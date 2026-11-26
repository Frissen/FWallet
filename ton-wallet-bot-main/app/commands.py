"""Telegram bot text command handlers.

Trimmed to the minimum: only /help, /price and /about. Wallet-aware
commands (/balance, /addresses, /ref, /withdraw, /p2p, /myads) were
removed because their RPC fan-out made the bot hard to host on a
small free-tier instance. The Mini App is the single source of truth
for those features.
"""

from __future__ import annotations

import json
import time
from typing import Any
from urllib.parse import quote

import httpx


# ---- /help -----------------------------------------------------------------

HELP_TEXT = (
    "📖 *Fwallet*\n\n"
    "*Кошелёк* — `/wallet` (или /start) открывает Mini App.\n"
    "Все операции — балансы, переводы, P2P, свапы — внутри приложения.\n\n"
    "*Прочее*\n"
    "/price `<тикер>` — курс + график (например `/price ton`)\n"
    "/api `<TON-адрес>` — выдать API-ключ для Pay-API (магазины, казино)\n"
    "/about — про сервис\n"
    "/help — эта справка\n\n"
    "*Inline-режим*\n"
    "Напиши в любом чате `@FwalletBot ton rub` или"
    " `@FwalletBot 10 btc` — выпадет курс."
)


# ---- /price ----------------------------------------------------------------

PRICE_IDS = {
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


# Chart URL cache: (cg_id, days) -> (timestamp, url)
_chart_cache: dict[tuple[str, int], tuple[float, str]] = {}
_CHART_TTL = 600.0  # 10 minutes


async def build_chart_url(
    client: httpx.AsyncClient,
    cg_id: str,
    ticker: str,
    days: int = 7,
) -> str | None:
    """Render a 7-day price line chart via quickchart.io and return its URL.

    Returns None on any failure (caller should send text-only response).
    """
    cache_key = (cg_id, days)
    cached = _chart_cache.get(cache_key)
    now = time.time()
    if cached and now - cached[0] < _CHART_TTL:
        return cached[1]

    try:
        params: dict[str, Any] = {"vs_currency": "usd", "days": days}
        # CoinGecko returns hourly granularity for days<=90, daily for >90.
        # For 7 days that's ~168 points — plenty.
        r = await client.get(
            f"https://api.coingecko.com/api/v3/coins/{cg_id}/market_chart",
            params=params,
            timeout=10.0,
        )
        r.raise_for_status()
        prices = r.json().get("prices") or []
        if len(prices) < 2:
            return None

        # Decimate to ~60 points so the chart URL stays compact.
        step = max(1, len(prices) // 60)
        sampled = prices[::step]
        if sampled[-1] is not prices[-1]:
            sampled.append(prices[-1])

        labels = [time.strftime("%d.%m", time.gmtime(p[0] / 1000)) for p in sampled]
        data = [round(float(p[1]), 8) for p in sampled]

        up = data[-1] >= data[0]
        line_color = "rgb(34,197,94)" if up else "rgb(239,68,68)"
        fill_color = "rgba(34,197,94,0.18)" if up else "rgba(239,68,68,0.18)"

        chart_config: dict[str, Any] = {
            "type": "line",
            "data": {
                "labels": labels,
                "datasets": [
                    {
                        "label": f"{ticker.upper()}/USD",
                        "data": data,
                        "borderColor": line_color,
                        "backgroundColor": fill_color,
                        "fill": True,
                        "pointRadius": 0,
                        "borderWidth": 2.5,
                        "tension": 0.35,
                    }
                ],
            },
            "options": {
                "plugins": {
                    "title": {
                        "display": True,
                        "text": f"{ticker.upper()} — {days}d (USD)",
                        "color": "#e2e8f0",
                        "font": {"size": 16, "weight": "bold"},
                    },
                    "legend": {"display": False},
                },
                "scales": {
                    "x": {
                        "ticks": {
                            "maxTicksLimit": 6,
                            "color": "#94a3b8",
                            "autoSkip": True,
                        },
                        "grid": {"color": "rgba(148,163,184,0.08)"},
                    },
                    "y": {
                        "ticks": {"color": "#94a3b8"},
                        "grid": {"color": "rgba(148,163,184,0.08)"},
                    },
                },
            },
        }

        # POST to /chart/create returns a short permanent URL we can hand to
        # Telegram's sendPhoto / InlineQueryResultPhoto without URL-length
        # worries.
        resp = await client.post(
            "https://quickchart.io/chart/create",
            json={
                "chart": chart_config,
                "backgroundColor": "#0f172a",
                "width": 720,
                "height": 420,
                "format": "png",
                "version": "4",
            },
            timeout=10.0,
        )
        resp.raise_for_status()
        body = resp.json()
        url = body.get("url") if body.get("success") else None
        if url:
            _chart_cache[cache_key] = (now, url)
        return url
    except Exception:
        return None


FIAT_SYMBOLS = {"usd": "$", "rub": "₽", "eur": "€", "uah": "₴", "kzt": "₸"}


def parse_price_args(text: str) -> tuple[str | None, str]:
    """Parse `/price ton rub` → ("ton", "rub"). Returns (None, "rub") for help."""
    parts = text.strip().split()
    if len(parts) < 2:
        return None, "rub"
    sym = parts[1].lower().lstrip("/").strip()
    fiat = "rub"
    for p in parts[2:]:
        pl = p.lower()
        if pl in FIAT_SYMBOLS:
            fiat = pl
            break
    return sym, fiat


async def fetch_quote(cg_id: str, ticker: str) -> dict[str, float | None]:
    """Returns {usd, rub, eur, chg} via OKX + open.er-api fiat rates.

    `cg_id` is unused (kept for signature stability). We look up the symbol
    on OKX directly because CoinGecko aggressively rate-limits Render's
    shared egress IPs.
    """
    from .cards import fetch_quote_okx

    try:
        return await fetch_quote_okx(ticker, ["usd", "rub", "eur"])
    except Exception:
        return {}


async def cmd_price(text: str) -> tuple[str, str | None, str]:
    """Returns (caption_text, ticker_or_None_on_error, fiat).

    When ticker is not None, caller knows it can render a card / keyboard.
    """
    sym, fiat = parse_price_args(text)
    if sym is None:
        return (
            "❌ Формат: `/price <тикер>` (например `/price ton`)\n"
            f"Поддержано: {', '.join(sorted(PRICE_IDS))}",
            None,
            fiat,
        )
    cg_id = PRICE_IDS.get(sym)
    if not cg_id:
        return (
            f"❌ Не знаю тикер `{sym}`. Поддержано: {', '.join(sorted(PRICE_IDS))}",
            None,
            fiat,
        )
    quote = await fetch_quote(cg_id, sym)
    price_native = quote.get(fiat) or quote.get("usd")
    if price_native is None:
        return (f"❌ Котировка для `{sym}` сейчас недоступна.", None, fiat)

    chg = quote.get("chg")
    arrow = ""
    chg_str = ""
    if chg is not None:
        arrow = "📈" if chg >= 0 else "📉"
        chg_str = f"  {arrow} `{chg:+.2f}%` 24h"

    sym_label = FIAT_SYMBOLS.get(fiat, fiat.upper())
    formatted = (
        f"{price_native:,.2f}".replace(",", " ") if price_native >= 1 else f"{price_native:.6g}"
    )
    body = f"💱 *{sym.upper()}*\n*{formatted} {sym_label}*{chg_str}"
    # Add USD/RUB cross-rate for non-fiat fiat
    if fiat != "rub" and quote.get("rub") is not None:
        body += f"\n`{quote['rub']:,.2f}` ₽".replace(",", " ")
    if fiat != "usd" and quote.get("usd") is not None:
        body += f"\n`{quote['usd']:,.4g}` $"
    return (body, sym, fiat)


# ---- setMyCommands ---------------------------------------------------------


COMMANDS_LIST: list[dict[str, Any]] = [
    {"command": "wallet", "description": "Открыть кошелёк"},
    {"command": "menu",   "description": "Главное меню"},
    {"command": "price",  "description": "Курс + график"},
    {"command": "api",    "description": "Pay-API для проектов (магазины, казино)"},
    {"command": "help",   "description": "Список команд"},
    {"command": "about",  "description": "Про сервис"},
]


async def install_commands(tg_api: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{tg_api}/setMyCommands",
                json={"commands": COMMANDS_LIST, "scope": {"type": "default"}},
            )
    except Exception:
        pass


__all__ = [
    "HELP_TEXT",
    "COMMANDS_LIST",
    "cmd_price",
    "build_chart_url",
    "install_commands",
    "quote",
    "json",
]
