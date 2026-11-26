"""Render a branded /price response card (logo + price + sparkline) with PIL.

Returns PNG bytes that can be served via FastAPI or sent through Telegram's
`sendPhoto`. The card style is loosely inspired by @send's ticker card: a
clean white panel with the coin logo + name on top-left, a "TICKER/FIAT"
label on top-right, the big price below, the 24h change in green/red, and a
filled sparkline along the bottom.

Data sources (chosen to avoid CoinGecko's aggressive rate-limiting on free
shared egress IPs like Render's):
  - **OKX** public market API for the live USDT-quoted price, 24h change
    and the 7-day hourly candles powering the sparkline.
  - **open.er-api.com** for the USD→fiat conversion (cached for 1 h).
  - **CoinGecko** *only* for the one-shot coin-logo download (cached for
    the lifetime of the process).
"""

from __future__ import annotations

import time
from io import BytesIO
from typing import Any

import httpx

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover - Pillow is a hard dep
    Image = None  # type: ignore


# ---- Font loader -----------------------------------------------------------

_FONT_PATHS_BOLD = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/home/ubuntu/.local/lib/python3.10/site-packages/matplotlib/mpl-data/fonts/ttf/DejaVuSans-Bold.ttf",
]
_FONT_PATHS_REGULAR = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/home/ubuntu/.local/lib/python3.10/site-packages/matplotlib/mpl-data/fonts/ttf/DejaVuSans.ttf",
]


def _font(size: int, bold: bool = False) -> Any:
    paths = _FONT_PATHS_BOLD if bold else _FONT_PATHS_REGULAR
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


# ---- Caches ----------------------------------------------------------------

_LOGO_CACHE: dict[str, bytes] = {}
_NAME_CACHE: dict[str, str] = {}
_CARD_CACHE: dict[tuple[str, str], tuple[float, bytes]] = {}
_FX_CACHE: tuple[float, dict[str, float]] | None = None
_CARD_TTL = 120.0  # seconds
_FX_TTL = 3600.0   # 1 hour


# ---- Symbol mapping --------------------------------------------------------

# `cg_id` is the CoinGecko id, used only for logo lookup. The display name
# falls back to a prettified ticker when CG is unavailable.
COIN_META: dict[str, dict[str, str]] = {
    "ton":   {"okx": "TON-USDT",  "cg": "the-open-network", "name": "Toncoin"},
    "btc":   {"okx": "BTC-USDT",  "cg": "bitcoin",          "name": "Bitcoin"},
    "eth":   {"okx": "ETH-USDT",  "cg": "ethereum",         "name": "Ethereum"},
    "sol":   {"okx": "SOL-USDT",  "cg": "solana",           "name": "Solana"},
    "usdc":  {"okx": "USDC-USDT", "cg": "usd-coin",         "name": "USD Coin"},
    "usdt":  {"okx": "",          "cg": "tether",           "name": "Tether USD"},
}

_OKX_HEADERS = {
    "User-Agent": "FwalletBot/1.0",
    "Accept": "application/json",
}


# ---- OKX market data -------------------------------------------------------


async def _okx_ticker(client: httpx.AsyncClient, inst: str) -> dict[str, float]:
    """Returns {last, open24h, high24h, low24h} or {} on failure."""
    try:
        r = await client.get(
            "https://www.okx.com/api/v5/market/ticker",
            params={"instId": inst},
            headers=_OKX_HEADERS,
            timeout=10.0,
        )
        if r.status_code != 200:
            print(f"[cards] okx ticker {inst} -> {r.status_code}", flush=True)
            return {}
        data = (r.json() or {}).get("data") or []
        if not data:
            return {}
        rec = data[0]
        return {
            "last": float(rec.get("last") or 0) or 0.0,
            "open24h": float(rec.get("open24h") or 0) or 0.0,
            "high24h": float(rec.get("high24h") or 0) or 0.0,
            "low24h": float(rec.get("low24h") or 0) or 0.0,
        }
    except Exception as exc:
        print(f"[cards] okx ticker {inst} EXC: {exc!r}", flush=True)
        return {}


async def _okx_candles(client: httpx.AsyncClient, inst: str, hours: int = 168) -> list[float]:
    """Returns hourly close prices, oldest → newest. Empty on failure."""
    try:
        r = await client.get(
            "https://www.okx.com/api/v5/market/candles",
            params={"instId": inst, "bar": "1H", "limit": str(hours)},
            headers=_OKX_HEADERS,
            timeout=10.0,
        )
        if r.status_code != 200:
            print(f"[cards] okx candles {inst} -> {r.status_code}", flush=True)
            return []
        data = (r.json() or {}).get("data") or []
        if not data:
            return []
        # OKX returns newest-first; reverse so the chart reads left→right.
        prices = [float(row[4]) for row in reversed(data)]
        return prices
    except Exception as exc:
        print(f"[cards] okx candles {inst} EXC: {exc!r}", flush=True)
        return []


# ---- USD → fiat FX rates (cached) ------------------------------------------


async def _fx_rates(client: httpx.AsyncClient) -> dict[str, float]:
    global _FX_CACHE
    now = time.time()
    if _FX_CACHE and now - _FX_CACHE[0] < _FX_TTL:
        return _FX_CACHE[1]
    try:
        r = await client.get(
            "https://open.er-api.com/v6/latest/USD",
            headers={"User-Agent": "FwalletBot/1.0"},
            timeout=10.0,
        )
        if r.status_code != 200:
            print(f"[cards] fx -> {r.status_code}", flush=True)
            return _FX_CACHE[1] if _FX_CACHE else {"USD": 1.0}
        rates = (r.json() or {}).get("rates") or {}
        # Coerce to floats and lowercase keys
        normalised = {k.upper(): float(v) for k, v in rates.items() if v}
        normalised.setdefault("USD", 1.0)
        _FX_CACHE = (now, normalised)
        return normalised
    except Exception as exc:
        print(f"[cards] fx EXC: {exc!r}", flush=True)
        return _FX_CACHE[1] if _FX_CACHE else {"USD": 1.0}


# ---- Logo download (one-shot per process via CoinGecko) --------------------


async def _fetch_logo(client: httpx.AsyncClient, ticker: str, cg_id: str) -> bytes | None:
    if ticker in _LOGO_CACHE:
        return _LOGO_CACHE[ticker]
    if not cg_id:
        return None
    try:
        r = await client.get(
            f"https://api.coingecko.com/api/v3/coins/{cg_id}",
            params={
                "localization": "false",
                "tickers": "false",
                "market_data": "false",
                "community_data": "false",
                "developer_data": "false",
                "sparkline": "false",
            },
            headers={
                "User-Agent": "FwalletBot/1.0 (+https://github.com/Frissen/fwallet)",
                "Accept": "application/json",
            },
            timeout=10.0,
        )
        if r.status_code != 200:
            return None
        j = r.json()
        name = j.get("name")
        if name:
            _NAME_CACHE[ticker] = name
        url = (j.get("image") or {}).get("large") or (j.get("image") or {}).get("small")
        if not url:
            return None
        lr = await client.get(url, timeout=10.0)
        if lr.status_code == 200:
            _LOGO_CACHE[ticker] = lr.content
            return lr.content
    except Exception as exc:
        print(f"[cards] logo {ticker} EXC: {exc!r}", flush=True)
    return None


# ---- Drawing ---------------------------------------------------------------


def _draw_card(
    *,
    ticker: str,
    name: str,
    fiat: str,
    price_native: float,
    change_24h: float | None,
    history: list[float],
    logo_bytes: bytes | None,
) -> bytes:
    W, H = 900, 560
    bg = (255, 255, 255)
    img = Image.new("RGB", (W, H), bg)
    draw = ImageDraw.Draw(img)

    pad = 44
    font_title = _font(36, bold=True)
    font_pair = _font(22, bold=True)
    font_price = _font(96, bold=True)
    font_change = _font(32, bold=True)

    text_x = pad
    if logo_bytes:
        try:
            logo = Image.open(BytesIO(logo_bytes)).convert("RGBA")
            logo = logo.resize((56, 56), Image.LANCZOS)
            img.paste(logo, (pad, pad), logo)
            text_x = pad + 56 + 14
        except Exception:
            text_x = pad
    draw.text((text_x, pad + 8), name, font=font_title, fill=(15, 23, 42))

    pair = f"{ticker.upper()}/{fiat.upper()}"
    bbox = draw.textbbox((0, 0), pair, font=font_pair)
    pw = bbox[2] - bbox[0]
    draw.text(
        (W - pad - pw, pad + 18), pair, font=font_pair, fill=(148, 163, 184)
    )

    if fiat == "rub":
        price_str = f"{price_native:,.2f} ₽".replace(",", " ")
    elif fiat == "usd":
        price_str = f"${price_native:,.2f}"
    elif fiat == "eur":
        price_str = f"€{price_native:,.2f}"
    else:
        price_str = f"{price_native:,.2f} {fiat.upper()}"
    draw.text((pad, 140), price_str, font=font_price, fill=(15, 23, 42))

    if change_24h is not None:
        up = change_24h >= 0
        arrow = "▲" if up else "▼"
        col = (22, 163, 74) if up else (220, 38, 38)
        chg_str = f"{arrow} {abs(change_24h):.2f}%  24h"
        draw.text((pad, 250), chg_str, font=font_change, fill=col)

    if len(history) >= 2:
        if len(history) > 240:
            step = len(history) // 240
            history = history[::step]
        pmin = min(history)
        pmax = max(history)
        prng = pmax - pmin if pmax > pmin else 1.0
        chart_left = pad
        chart_right = W - pad
        chart_top = 320
        chart_bottom = H - pad
        n = len(history)
        points: list[tuple[float, float]] = []
        for i, p in enumerate(history):
            x = chart_left + i * (chart_right - chart_left) / (n - 1)
            y = chart_bottom - (p - pmin) / prng * (chart_bottom - chart_top)
            points.append((x, y))

        up = history[-1] >= history[0]
        line_col = (22, 163, 74) if up else (220, 38, 38)
        fill_col = (22, 163, 74, 56) if up else (220, 38, 38, 56)

        overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        odraw = ImageDraw.Draw(overlay)
        poly: list[tuple[float, float]] = list(points) + [
            (chart_right, chart_bottom),
            (chart_left, chart_bottom),
        ]
        odraw.polygon(poly, fill=fill_col)
        img.paste(overlay, (0, 0), overlay)

        for i in range(len(points) - 1):
            draw.line([points[i], points[i + 1]], fill=line_col, width=5)

        font_label = _font(18)
        draw.text(
            (chart_left, H - 26),
            f"7d · OKX {ticker.upper()}/USDT",
            font=font_label,
            fill=(148, 163, 184),
        )
        draw.text(
            (chart_right - 130, chart_top - 4),
            f"high {pmax:,.4g}",
            font=font_label,
            fill=(148, 163, 184),
        )
        draw.text(
            (chart_right - 130, chart_bottom - 22),
            f"low  {pmin:,.4g}",
            font=font_label,
            fill=(148, 163, 184),
        )

    out = BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue()


# ---- Public API ------------------------------------------------------------


async def render_price_card(
    ticker: str, cg_id: str, fiat: str = "rub"
) -> bytes | None:
    """Return PNG bytes for a price card, or None on hard failure.

    `cg_id` is kept for backward compatibility — the OKX-based pipeline
    looks up its symbols in `COIN_META`.

    Cached for `_CARD_TTL` seconds per (ticker, fiat).
    """
    if Image is None:
        print(f"[cards] PIL unavailable", flush=True)
        return None
    ticker = ticker.lower()
    meta = COIN_META.get(ticker)
    if not meta:
        return None
    inst = meta["okx"]
    name = _NAME_CACHE.get(ticker) or meta["name"]
    fiat = fiat.lower()

    cache_key = (ticker, fiat)
    cached = _CARD_CACHE.get(cache_key)
    now = time.time()
    if cached and now - cached[0] < _CARD_TTL:
        return cached[1]

    async with httpx.AsyncClient(timeout=12.0) as client:
        if inst:
            ticker_data = await _okx_ticker(client, inst)
            history = await _okx_candles(client, inst, hours=168)
        else:
            ticker_data = {"last": 1.0, "open24h": 1.0}
            history = []
        rates = await _fx_rates(client)
        logo = await _fetch_logo(client, ticker, meta.get("cg", ""))
        # Refresh display name if logo call updated cache
        name = _NAME_CACHE.get(ticker) or name

    last_usd = ticker_data.get("last") or 0.0
    if last_usd <= 0:
        print(f"[cards] no usd price for {ticker}", flush=True)
        return None

    open24h = ticker_data.get("open24h") or 0.0
    change_24h = (
        (last_usd - open24h) / open24h * 100.0 if open24h > 0 else None
    )

    fiat_rate = rates.get(fiat.upper(), 1.0)
    price_native = last_usd * fiat_rate

    history_native = [p * fiat_rate for p in history] if history else []

    try:
        png = _draw_card(
            ticker=ticker,
            name=name,
            fiat=fiat,
            price_native=price_native,
            change_24h=change_24h,
            history=history_native,
            logo_bytes=logo,
        )
    except Exception as exc:
        print(f"[cards] draw failed for {ticker}: {exc!r}", flush=True)
        return None
    _CARD_CACHE[cache_key] = (now, png)
    return png


async def fetch_quote_okx(
    ticker: str, fiats: list[str]
) -> dict[str, float | None]:
    """Fast price+24h-change lookup via OKX + cached FX.

    Returns a dict like ``{"usd": 2.41, "rub": 184.5, "chg": 27.6}`` where
    ``chg`` is the 24h % change. On failure returns ``{}``.
    """
    ticker = ticker.lower()
    inst_id = (COIN_META.get(ticker) or {}).get("okx") or f"{ticker.upper()}-USDT"
    if ticker == "usdt":
        async with httpx.AsyncClient(timeout=12.0) as client:
            rates = await _fx_rates(client)
        out: dict[str, float | None] = {"chg": 0.0}
        for f in fiats:
            out[f] = rates.get(f.upper(), 1.0)
        return out
    async with httpx.AsyncClient(timeout=12.0) as client:
        tdata = await _okx_ticker(client, inst_id)
        rates = await _fx_rates(client)
    last = tdata.get("last") or 0.0
    if last <= 0:
        return {}
    open24h = tdata.get("open24h") or 0.0
    chg = (last - open24h) / open24h * 100.0 if open24h > 0 else None
    out2: dict[str, float | None] = {"chg": chg}
    for f in fiats:
        out2[f] = last * rates.get(f.upper(), 1.0)
    return out2


__all__ = ["render_price_card", "COIN_META", "fetch_quote_okx"]
