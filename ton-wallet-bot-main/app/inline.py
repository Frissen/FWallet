"""Inline-mode handler.

When the user types `@FwalletBot <query>` in any chat, Telegram sends
an inline_query update. We parse the query as a price lookup and respond
with one or more InlineQueryResultArticle entries.

Supported query forms:
  ton           → TON in USD + RUB
  ton rub       → TON in RUB
  btc usd       → BTC in USD
  10 ton        → 10 TON in USD + RUB
  10 ton rub    → 10 TON in RUB
"""

from __future__ import annotations

import time
import uuid
from decimal import Decimal, InvalidOperation

import os

import httpx

from .cards import render_price_card, fetch_quote_okx


_BOT_PUBLIC_URL = os.environ.get(
    "BOT_PUBLIC_URL", "https://ton-wallet-bot-vgur.onrender.com"
).rstrip("/")
_BOT_USERNAME = os.environ.get("BOT_USERNAME", "FwalletBot")

# Same coingecko id table as commands.cmd_price (kept here to avoid circular
# imports). Keep in sync.
PRICE_IDS: dict[str, str] = {
    "ton": "the-open-network",
    "btc": "bitcoin",
    "eth": "ethereum",
    "sol": "solana",
    "trx": "tron",
    "usdt": "tether",
    "usdc": "usd-coin",
    "doge": "dogecoin",
    "ada": "cardano",
    "xrp": "ripple",
    "matic": "matic-network",
    "ltc": "litecoin",
    "dot": "polkadot",
    "link": "chainlink",
    "atom": "cosmos",
    "near": "near",
    "avax": "avalanche-2",
    "shib": "shiba-inu",
    "pepe": "pepe",
    "hmstr": "hamster-kombat",
    "not": "notcoin",
    "dogs": "dogs-2",
}

_FIATS = {"usd", "rub", "eur", "uah", "kzt"}

# Tiny in-memory cache so we don't hammer CoinGecko while the user types.
_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL = 30.0


async def _coingecko_price(ids: list[str], vs: list[str]) -> dict:
    key = f"{','.join(sorted(ids))}|{','.join(sorted(vs))}"
    now = time.time()
    cached = _cache.get(key)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]
    async with httpx.AsyncClient(timeout=8.0) as client:
        r = await client.get(
            "https://api.coingecko.com/api/v3/simple/price",
            params={
                "ids": ",".join(ids),
                "vs_currencies": ",".join(vs),
                "include_24hr_change": "true",
            },
        )
        r.raise_for_status()
        data = r.json()
    _cache[key] = (now, data)
    return data


def _parse_query(q: str) -> tuple[Decimal | None, str | None, list[str]]:
    """Returns (amount?, ticker?, [vs_currencies]).

    Examples:
      ""             → (None, None, [])
      "ton"          → (None, "ton", ["usd", "rub"])
      "ton rub"      → (None, "ton", ["rub"])
      "10 ton"       → (10, "ton", ["usd", "rub"])
      "10 ton rub"   → (10, "ton", ["rub"])
      "ton usd rub"  → (None, "ton", ["usd", "rub"])
    """
    parts = [p.lower().strip() for p in q.strip().split() if p.strip()]
    amount: Decimal | None = None
    ticker: str | None = None
    vs: list[str] = []
    for p in parts:
        if amount is None and ticker is None:
            try:
                amount = Decimal(p)
                continue
            except InvalidOperation:
                pass
        if ticker is None and p in PRICE_IDS:
            ticker = p
            continue
        if p in _FIATS:
            vs.append(p)
            continue
    if not vs and ticker is not None:
        vs = ["usd", "rub"]
    return amount, ticker, vs


def _fmt(num: float | Decimal) -> str:
    s = f"{num:.6g}" if abs(float(num)) < 1 else f"{num:,.4f}"
    s = s.rstrip("0").rstrip(".") if "." in s else s
    return s


def _supported_help_article() -> dict:
    return {
        "type": "article",
        "id": str(uuid.uuid4()),
        "title": "💱 Курс крипты",
        "description": "Введи тикер (например: ton rub, 10 btc usd)",
        "input_message_content": {
            "message_text": (
                "💱 *Fwallet — inline*\n\n"
                "Использование: `@FwalletBot <тикер> [<фиат>]`\n\n"
                "Примеры:\n"
                "• `@FwalletBot ton`\n"
                "• `@FwalletBot ton rub`\n"
                "• `@FwalletBot 10 btc usd`\n\n"
                f"Поддержано: {', '.join(sorted(PRICE_IDS))}"
            ),
            "parse_mode": "Markdown",
        },
    }


def _unknown_ticker_article(query: str) -> dict:
    return {
        "type": "article",
        "id": str(uuid.uuid4()),
        "title": "❌ Не знаю такой тикер",
        "description": f'Запрос "{query}". Доступные: ton, btc, eth, sol, …',
        "input_message_content": {
            "message_text": (
                f"❌ Не знаю тикер из запроса `{query}`.\n"
                f"Поддержано: {', '.join(sorted(PRICE_IDS))}"
            ),
            "parse_mode": "Markdown",
        },
    }


async def _build_results(query: str) -> list[dict]:
    if not query.strip():
        return [_supported_help_article()]
    amount, ticker, vs = _parse_query(query)
    if ticker is None:
        return [_unknown_ticker_article(query)]
    cg_id = PRICE_IDS[ticker]

    try:
        rec = await fetch_quote_okx(ticker, vs)
    except Exception as exc:
        return [{
            "type": "article",
            "id": str(uuid.uuid4()),
            "title": "❌ Ошибка котировки",
            "description": str(exc)[:80],
            "input_message_content": {
                "message_text": f"❌ Котировка не пришла: `{str(exc)[:120]}`",
                "parse_mode": "Markdown",
            },
        }]
    if not rec or all(rec.get(c) is None for c in vs):
        return [_unknown_ticker_article(query)]

    chg = rec.get("chg")
    arrow = ""
    if chg is not None:
        arrow = "📈" if chg >= 0 else "📉"

    fiat_labels = {"usd": "$", "rub": "₽", "eur": "€", "uah": "₴", "kzt": "₸"}
    lines: list[str] = []
    description_bits: list[str] = []
    title_bits: list[str] = []
    for cur in vs:
        price = rec.get(cur)
        if price is None:
            continue
        if amount is not None:
            total = float(price) * float(amount)
            lines.append(
                f"{_fmt(amount)} {ticker.upper()} = "
                f"`{_fmt(total)}` {fiat_labels.get(cur, cur.upper())}"
            )
            description_bits.append(
                f"{_fmt(amount)} {ticker.upper()} ≈ {_fmt(total)} {cur.upper()}"
            )
            title_bits.append(f"{_fmt(total)} {cur.upper()}")
        else:
            lines.append(
                f"1 {ticker.upper()} = `{_fmt(price)}` "
                f"{fiat_labels.get(cur, cur.upper())}"
            )
            description_bits.append(
                f"1 {ticker.upper()} ≈ {_fmt(price)} {cur.upper()}"
            )
            title_bits.append(f"{_fmt(price)} {cur.upper()}")

    title = (
        f"{ticker.upper()}: "
        + " / ".join(title_bits)
        + (f"  {arrow}" if arrow else "")
    )
    chg_line = (
        f"  {arrow} {chg:+.2f}% 24h" if chg is not None else ""
    )
    body = (
        f"💱 *{ticker.upper()}*{chg_line}\n\n"
        + "\n".join(lines)
        + ("\n\n_Курс OKX, обновлён только что._" if lines else "")
    )

    # Pre-warm the card so that when Telegram fetches /cards/{ticker}.png it
    # hits the in-memory cache instantly — otherwise on a cold Render
    # container the photo URL can time out and Telegram caches a blank.
    card_fiat = vs[0] if vs and vs[0] in ("usd", "rub", "eur") else "rub"
    card_bytes = await render_price_card(ticker, cg_id, card_fiat)

    article_result: dict = {
        "type": "article",
        "id": str(uuid.uuid4()),
        "title": title,
        "description": " · ".join(description_bits)[:120],
        "input_message_content": {"message_text": body, "parse_mode": "Markdown"},
    }

    if not card_bytes:
        return [article_result]

    card_url = (
        f"{_BOT_PUBLIC_URL}/cards/{ticker}.png"
        f"?fiat={card_fiat}&t={int(time.time() // 60)}"
    )
    photo_result: dict = {
        "type": "photo",
        "id": str(uuid.uuid4()),
        "photo_url": card_url,
        "thumb_url": card_url,
        "title": title,
        "description": " · ".join(description_bits)[:120],
        "caption": body,
        "parse_mode": "Markdown",
    }
    return [photo_result]


async def handle_inline_query(tg_api: str, q: dict) -> None:
    query_id = q.get("id")
    text = q.get("query") or ""
    if not query_id:
        return
    try:
        results = await _build_results(text)
        async with httpx.AsyncClient(timeout=8.0) as client:
            await client.post(
                f"{tg_api}/answerInlineQuery",
                json={
                    "inline_query_id": query_id,
                    "results": results,
                    "cache_time": 30,
                    "is_personal": False,
                },
            )
    except Exception:
        # Best-effort; nothing we can do if Telegram is unreachable.
        pass
