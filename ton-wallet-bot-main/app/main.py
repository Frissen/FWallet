"""Webhook handler for the @FwalletBot Telegram bot + P2P / referral
backend.

The bot routes /start aliases to an "Open Wallet" inline button, but it now
also acts as an anonymous-relay coordinator for P2P trades and a registry
that maps Telegram user IDs to per-chain wallet addresses for the referral
program.

State is persisted to JSON files on the local volume — fine for an MVP.
There is no escrow: the bot only orchestrates the deal flow (open → fiat_paid
→ crypto_sent → done) and forwards messages between counterparties without
ever revealing their @usernames.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import os
import time
import uuid
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from .cards import render_price_card
from .commands import (
    PRICE_IDS,
    COMMANDS_LIST,
    HELP_TEXT,
    cmd_price,
    install_commands,
)
from .auth import require_user
from .inline import handle_inline_query

# ---- Telegram bot config ---------------------------------------------------

# Bot token must be provided via the TELEGRAM_BOT_TOKEN env var on the host.
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
WEBHOOK_SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "ton-wallet-webhook")
BOT_PUBLIC_URL = os.environ.get(
    "BOT_PUBLIC_URL", "https://ton-wallet-bot-vgur.onrender.com"
).rstrip("/")
# The bot now serves the Mini App itself (see StaticFiles mount at the bottom
# of this module), so by default the WebApp button points at our own public
# URL. Override with WALLET_APP_URL to point Telegram at a different host
# (useful while developing the frontend on devinapps / Vercel preview).
APP_URL = os.environ.get("WALLET_APP_URL", BOT_PUBLIC_URL)
BOT_USERNAME = os.environ.get("BOT_USERNAME", "FwalletBot")

# Path to the built Mini App produced by the frontend Docker stage.
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "static_frontend"

TG_API = f"https://api.telegram.org/bot{BOT_TOKEN}"


def _auth(request: Request, claimed_tg_id: int) -> int:
    """Verify the caller really is ``claimed_tg_id`` (Mini App initData)."""
    return require_user(request, claimed_tg_id, BOT_TOKEN)

# ---- App -------------------------------------------------------------------

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/status")
async def api_status() -> dict[str, str]:
    """Lightweight machine-readable status. Previously lived at `/`, but `/`
    now serves the Mini App from the static frontend bundle."""
    return {"status": "ok", "bot": "fwallet"}


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/stats")
async def stats() -> dict:
    """Aggregate counters across the on-disk registry. No PII, no addresses."""
    refs = _load_json(_REFERRALS_FILE, {})
    ads = _load_json(_ADS_FILE, [])
    deals = _load_json(_DEALS_FILE, [])

    per_chain: dict[str, int] = {}
    for rec in refs.values():
        for k in (
            "ton_address",
            "eth_address",
            "bsc_address",
            "sol_address",
            "btc_address",
        ):
            if rec.get(k):
                chain = k.replace("_address", "")
                per_chain[chain] = per_chain.get(chain, 0) + 1

    deal_states: dict[str, int] = {}
    for d in deals:
        s = d.get("state") or d.get("status") or "unknown"
        deal_states[s] = deal_states.get(s, 0) + 1

    return {
        "registered_users": len(refs),
        "registered_users_per_chain": per_chain,
        "ads_open": sum(1 for a in ads if not a.get("deleted")),
        "ads_total": len(ads),
        "deals_total": len(deals),
        "deals_by_state": deal_states,
    }


# ---- Storage ---------------------------------------------------------------

_DATA_DIR = Path(os.environ.get("DATA_DIR", "/tmp/fwallet-bot"))
_DATA_DIR.mkdir(parents=True, exist_ok=True)
_ADS_FILE = _DATA_DIR / "ads.json"
_DEALS_FILE = _DATA_DIR / "deals.json"
_REFERRALS_FILE = _DATA_DIR / "referrals.json"
_RESET_MARKER = _DATA_DIR / "_ads_reset_v3"


def _load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def _save_json(path: Path, value) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    tmp.replace(path)


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# One-shot wipe of legacy ads (round 1 schema). Older ads have a `contact`
# field instead of the new payment_method/bank/card structure and would not
# render or be operable in the current UI. We delete the file once and leave
# a marker so we don't loop on every restart.
if not _RESET_MARKER.exists():
    for _f in (_ADS_FILE, _DEALS_FILE):
        if _f.exists():
            try:
                _f.unlink()
            except Exception:
                pass
    _RESET_MARKER.write_text("reset")


# ---- Bot helpers -----------------------------------------------------------

_PAY_API_DOCS_HTML = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fwallet Pay API</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0e1620; color:#e2e8f0; font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; max-width:780px; margin:0 auto; padding:24px; line-height:1.55; }
  h1 { font-size:28px; margin:0 0 4px; }
  h2 { font-size:20px; margin:32px 0 8px; border-bottom:1px solid #233045; padding-bottom:4px; }
  h3 { font-size:16px; margin:20px 0 6px; color:#7dd3fc; }
  code, pre { font-family:ui-monospace,Menlo,monospace; font-size:13px; }
  code { background:#1a2332; padding:1px 6px; border-radius:4px; }
  pre { background:#0a1018; border:1px solid #233045; border-radius:8px; padding:12px 14px; overflow-x:auto; }
  a { color:#7dd3fc; }
  table { border-collapse:collapse; width:100%; margin:8px 0; font-size:14px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid #233045; }
  .muted { color:#94a3b8; font-size:13px; }
  .pill { display:inline-block; padding:1px 8px; border-radius:12px; font-size:11px; font-weight:600; }
  .pill-ok { background:#0e3a23; color:#86efac; }
  .pill-warn { background:#3a2a0e; color:#fcd34d; }
</style>
</head>
<body>
<h1>Fwallet Pay API</h1>
<div class="muted">Принимай TON-платежи в свой проект. Платёж проходит on-chain напрямую в твой кошелёк, ты получаешь webhook о зачислении.</div>

<h2>1. Регистрация проекта</h2>
<p>Открой бота <a href="https://t.me/FwalletBot">@FwalletBot</a> и отправь:</p>
<pre>/api UQYourTonAddressXXXXXXXXXXXXXXXXXXXXXXXXXXXX</pre>
<p>Бот ответит твоим <code>merchant_id</code> и <code>api_key</code>. <code>api_key</code> — это секрет, не светите его в клиентском коде. Каждый вызов <code>/api</code> перевыпускает ключ; старый перестаёт работать сразу.</p>

<h2>2. Создание счёта</h2>
<pre>POST __BOT_PUBLIC_URL__/api/v1/invoice/create
Headers:
  X-API-Key: aw_live_xxx...
  Content-Type: application/json
Body:
{
  "amount": 5,
  "asset": "TON",
  "description": "Пополнение баланса в Casino-X",
  "payload": "user_4521",
  "callback_url": "https://your-site.com/webhook/fwallet",
  "ttl_seconds": 3600
}</pre>

<table>
<tr><th>Поле</th><th>Тип</th><th>Описание</th></tr>
<tr><td><code>amount</code></td><td>number</td><td>Сумма счёта в TON. Минимум 0.01.</td></tr>
<tr><td><code>asset</code></td><td>string</td><td>Только <code>"TON"</code> в MVP.</td></tr>
<tr><td><code>description</code></td><td>string?</td><td>Описание для покупателя (видит на экране оплаты).</td></tr>
<tr><td><code>payload</code></td><td>string?</td><td>Произвольная строка, вернётся в webhook'е (сюда удобно класть user_id).</td></tr>
<tr><td><code>callback_url</code></td><td>string?</td><td>URL твоего бэка для webhook'а об оплате.</td></tr>
<tr><td><code>ttl_seconds</code></td><td>int?</td><td>Время жизни счёта (60..86400). По умолчанию 3600.</td></tr>
</table>

<h3>Ответ</h3>
<pre>{
  "invoice": {
    "id": "inv_a1b2c3d4",
    "asset": "TON",
    "amount": 5,
    "amount_nano": "5000000000",
    "status": "pending",
    "created_at": 1730000000,
    "expires_at": 1730003600,
    "merchant_id": "M1234ABCD"
  },
  "pay_url": "https://t.me/FwalletBot?startapp=invoice_a1b2c3d4",
  "mini_app_url": "__APP_URL__/?invoice=inv_a1b2c3d4"
}</pre>
<p>Покажи покупателю кнопку "Оплатить" со ссылкой <code>pay_url</code>. Откроется Fwallet → экран оплаты → один тап для подписания транзакции.</p>

<h2>3. Webhook об оплате</h2>
<p>Когда платёж подтверждается в блокчейне, на твой <code>callback_url</code> прилетает <code>POST</code>:</p>
<pre>POST https://your-site.com/webhook/fwallet
Headers:
  Content-Type: application/json
  X-Fwallet-Event: invoice.paid
  X-Fwallet-Signature: 5e88...0a3b   # hex HMAC-SHA256
Body:
{
  "event": "invoice.paid",
  "invoice_id": "inv_a1b2c3d4",
  "merchant_id": "M1234ABCD",
  "asset": "TON",
  "amount_nano": "5000000000",
  "paid_amount_nano": "4960000000",
  "paid_at": 1730000123,
  "paid_tx_hash": "10cueLe9D29SwqDtjUFuvuktK2csiG1eTT7kxAw2+mQ=",
  "payload": "user_4521"
}</pre>
<p><span class="pill pill-warn">Важно</span> <code>paid_amount_nano</code> = 99.2 % от <code>amount_nano</code> (комиссия платформы 0.8 % уходит отдельным сообщением в той же транзакции). Это нормально, отнеситесь к значению в <code>amount_nano</code> как к "сколько обещал заплатить покупатель".</p>

<h3>Проверка подписи</h3>
<p>Заголовок <code>X-Fwallet-Signature</code> — это <code>hex(HMAC_SHA256(api_key, raw_body))</code>. Тело сериализовано детерминированно (отсортированные ключи, без пробелов).</p>
<pre><span style="color:#7dd3fc">// Node.js</span>
const sig = req.headers['x-fwallet-signature']
const expected = require('crypto')
  .createHmac('sha256', process.env.FWALLET_API_KEY)
  .update(JSON.stringify(req.body, Object.keys(req.body).sort()))
  .digest('hex')
if (sig !== expected) return res.status(401).end()</pre>

<pre><span style="color:#7dd3fc"># Python</span>
import hmac, hashlib, json
def verify(api_key: str, raw_body: bytes, sig_header: str) -> bool:
    expected = hmac.new(api_key.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig_header)</pre>

<p>Подпись считается от сырого тела (как пришло). Не пересериализуй JSON перед HMAC.</p>

<h3>Retry-логика</h3>
<p>При ошибке доставки (любой не-2xx ответ или таймаут) сервис делает до 6 попыток с интервалом 60 секунд. После 6 неудач счёт остаётся помеченным как <code>paid</code> в нашей БД, но webhook не доставляется. Используй <code>GET /api/v1/invoice/{id}</code> для верификации.</p>

<h2>4. Получение статуса счёта</h2>
<pre>GET __BOT_PUBLIC_URL__/api/v1/invoice/inv_a1b2c3d4
Headers:
  X-API-Key: aw_live_xxx...</pre>

<pre>GET __BOT_PUBLIC_URL__/api/v1/invoices?limit=50
Headers:
  X-API-Key: aw_live_xxx...</pre>

<h2>5. Комиссия платформы</h2>
<ul>
  <li>0.8 % от суммы счёта вычитается из <em>входящего</em> платежа: магазин получает 99.2 %, Fwallet — 0.8 %. Покупатель платит ровно <code>amount</code>.</li>
  <li>Нет ежемесячных платежей, нет KYC, нет комиссии за создание счёта.</li>
</ul>

<h2>6. Ограничения MVP</h2>
<ul>
  <li>Только <code>TON</code>. USDT-jetton, ETH, BNB, SOL, BTC — позже.</li>
  <li>Подтверждение оплаты ~30-90 секунд (одно chain-confirmation на TonCenter).</li>
  <li>Минимальная сумма 0.01 TON.</li>
  <li>База данных счетов на free-инфраструктуре эфемерна — при редеплое очищается. Уже оплаченные счета остаются на блокчейне навсегда; pending счета будут потеряны (просто пересоздай).</li>
  <li>Сейчас в MVP один merchant на один Telegram-аккаунт. Если нужно несколько проектов — пиши <a href="https://t.me/FwalletBot">@FwalletBot</a>.</li>
</ul>

<h2>7. Поддержка</h2>
<p>Вопросы / баги — <a href="https://t.me/FwalletBot">@FwalletBot</a>.</p>

<div style="margin-top:48px; padding-top:16px; border-top:1px solid #233045; color:#64748b; font-size:12px;">
Fwallet Pay API · MVP · TON only
</div>
</body>
</html>"""


WELCOME_TEXT = (
    "👋 *Fwallet*\n\n"
    "Анонимный некастодиальный кошелёк: TON, ETH/BNB/SOL/BTC,"
    " чеки, P2P, свапы.\n\n"
    "• Seed-фраза создаётся и хранится только у тебя.\n"
    "• Шифрование AES-GCM (PBKDF2, 250k итераций).\n"
    "• Без регистрации, KYC, аналитики, трекеров.\n"
    "• Service fee 3.5%, 0.5% можно зарабатывать на рефералах.\n\n"
    "Жми кнопку ниже 👇"
)

ABOUT_TEXT = (
    "*Fwallet — некастодиальный*\n\n"
    "Service fee: 3.50% от суммы, отдельным сообщением в той же транзакции.\n"
    "Реф-программа: 0.50% из этих 3.5% уходит пригласившему по его TG ID.\n"
    "Чеки: 1.00% при создании.\n\n"
    "Бэкенд хранит P2P-объявления и маппинг TG-ID → адрес для рефералки. "
    "Ключи никогда не уходят с устройства."
)


def _open_wallet_keyboard(start_app: str | None = None) -> dict:
    url = APP_URL
    return {
        "inline_keyboard": [
            [
                {
                    "text": "🔓 Open Wallet",
                    "web_app": {
                        "url": url + (f"?_={start_app}" if start_app else ""),
                    },
                }
            ]
        ]
    }


def _open_invoice_keyboard(invoice_id: str) -> dict:
    """Inline keyboard pointing the Mini App at the invoice payment screen."""
    return {
        "inline_keyboard": [
            [
                {
                    "text": "🧾 Открыть счёт",
                    "web_app": {"url": f"{APP_URL}/?invoice={invoice_id}"},
                }
            ]
        ]
    }


def _main_inline_keyboard() -> dict:
    """Crypto Bot–style inline keyboard attached under the welcome message.

    3×2 grid of Web App buttons that open the Mini App on a specific tab
    via ``?tab=<name>``. ``Pay-API`` goes to the bot's own docs page.
    """
    def app_btn(text: str, tab: str | None = None) -> dict:
        url = APP_URL if not tab else f"{APP_URL}/?tab={tab}"
        return {"text": text, "web_app": {"url": url}}

    docs_url = f"{BOT_PUBLIC_URL}/docs/pay"
    return {
        "inline_keyboard": [
            [app_btn("💳 Кошелёк"),    app_btn("🔄 Обмен", "swap")],
            [app_btn("👥 P2P", "p2p"), app_btn("🧾 Чеки", "cheques")],
            [
                {"text": "💸 Pay-API", "web_app": {"url": docs_url}},
                app_btn("⚙️ Настройки", "more"),
            ],
        ],
    }

_BOT_USERNAME = "FwalletBot"

# One-time removal of any legacy reply keyboard. Telegram caches reply
# keyboards on the user's device; the only way to clear them is for the
# bot to send a message with ``reply_markup={"remove_keyboard": True}``.
# We do this once per chat per process run on the first incoming message.
_KB_WIPED: set[int] = set()


@app.on_event("startup")
async def _on_startup() -> None:
    """Register the slash-command menu, cache bot username, start scanner."""
    global _BOT_USERNAME
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{TG_API}/getMe")
            data = r.json()
            if data.get("ok"):
                _BOT_USERNAME = data["result"].get("username") or _BOT_USERNAME
    except Exception:
        pass
    if WEBHOOK_SECRET == "ton-wallet-webhook":
        print(
            "[security] TELEGRAM_WEBHOOK_SECRET is the public default - set a "
            "long random value and re-register the webhook.",
            flush=True,
        )
    await install_commands(TG_API)
    asyncio.create_task(_invoice_scanner_loop())


async def _invoice_scanner_loop() -> None:
    """Background task: scan blockchain for paid invoices every minute.

    Logged silently on failure; never raises out (don't kill the worker
    thread). This co-exists with the cron-pinged /api/v1/scan endpoint —
    whichever fires first will mark the invoice paid, the other becomes a
    no-op on the second run.
    """
    from . import invoices as inv_mod
    while True:
        try:
            res = await inv_mod.scan_once()
            if any(res.get(k) for k in ("paid", "delivered", "expired")):
                print(f"[invoices] scan: {res}", flush=True)
        except Exception as exc:
            print(f"[invoices] scan loop EXC: {exc!r}", flush=True)
        await asyncio.sleep(60)


async def _handle_text_command(
    client: httpx.AsyncClient,
    user_tg_id: int,
    chat_id: int,
    text: str,
) -> bool:
    """Dispatch a slash command. Returns True if handled."""
    head = text.split(maxsplit=1)[0].lower()

    if head == "/help":
        await _send_message(client, chat_id, HELP_TEXT, no_button=True)
        return True

    if head == "/price":
        body, sym, fiat = await cmd_price(text)
        if sym:
            keyboard = _price_keyboard(sym, fiat, in_chat=True)
            from .cards import render_price_card, COIN_META
            cg_id = (COIN_META.get(sym) or {}).get("cg", "")
            png = await render_price_card(sym, cg_id, fiat)
            if png:
                await _send_photo_bytes(
                    client, chat_id, png, body, reply_markup=keyboard
                )
            else:
                await _send_message(client, chat_id, body, no_button=True)
        else:
            await _send_message(client, chat_id, body, no_button=True)
        return True

    if head == "/api":
        from . import invoices
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            help_msg = (
                "🔌 *Fwallet Pay API*\n\n"
                "Принимай оплату TON в свой проект (магазин, казино, бот) — "
                "клиент платит со своего Fwallet, тебе на адрес "
                "приходит TON, твой бэк получает webhook.\n\n"
                "*Регистрация:* отправь свой TON-адрес как аргумент команды:\n"
                "`/api UQ...your_ton_address...`\n\n"
                "Бот выдаст `merchant_id` и `api_key` — это твои реквизиты "
                "для серверной интеграции. Документация: "
                f"{APP_URL}/docs/pay\n\n"
                "ℹ Каждый вызов `/api` *перевыпускает* api_key (старый "
                "перестаёт работать). Адрес и merchant_id остаются те же."
            )
            await _send_message(client, chat_id, help_msg, no_button=True)
            return True
        addr = parts[1].strip()
        if len(addr) < 10 or not (
            addr.startswith("UQ")
            or addr.startswith("EQ")
            or addr.startswith("0:")
        ):
            await _send_message(
                client,
                chat_id,
                "❌ Похоже это не TON-адрес. Жду формата `UQ...`, `EQ...` "
                "или `0:<hex>`.",
                no_button=True,
            )
            return True
        try:
            merchant, api_key = invoices.register_merchant(
                tg_user_id=user_tg_id, ton_address=addr, name=None
            )
        except Exception as exc:
            await _send_message(
                client,
                chat_id,
                f"❌ Не получилось зарегистрировать: `{exc!r}`",
                no_button=True,
            )
            return True
        msg = (
            "✅ *Проект зарегистрирован*\n\n"
            f"`merchant_id` (публичный): `{merchant['id']}`\n"
            f"`api_key` (СЕКРЕТ — сохрани, второй раз не покажу):\n"
            f"`{api_key}`\n\n"
            f"`ton_address` (адрес зачисления): `{merchant['ton_address']}`\n\n"
            "*Создание счёта:*\n"
            "```\n"
            f"curl -X POST {BOT_PUBLIC_URL}/api/v1/invoice/create \\\n"
            f"  -H \"X-API-Key: {api_key[:24]}...\" \\\n"
            "  -H \"Content-Type: application/json\" \\\n"
            "  -d '{\"amount\":1, \"asset\":\"TON\","
            " \"description\":\"Test payment\","
            " \"payload\":\"order_42\","
            " \"callback_url\":\"https://your-site.com/webhook\"}'\n"
            "```\n\n"
            f"Документация: {APP_URL}/docs/pay\n"
            "Webhook подписывается HMAC-SHA256 (`X-Fwallet-Signature`) "
            "с твоим `api_key` в качестве ключа.\n\n"
            "Комиссия платформы: 0.8 % (вычитается из суммы счёта)."
        )
        await _send_message(client, chat_id, msg, no_button=True)
        return True

    if head == "/commands":
        # alias for /help
        await _send_message(client, chat_id, HELP_TEXT, no_button=True)
        return True

    return False


# Reference COMMANDS_LIST so editors don't strip the import.
_ = COMMANDS_LIST


async def _send_message(
    client: httpx.AsyncClient,
    chat_id: int,
    text: str,
    *,
    start_app: str | None = None,
    plain: bool = False,
    no_button: bool = False,
    main_kb: bool = False,
) -> None:
    """Send a Telegram message.

    plain=True   → no Markdown, no inline button (used for relayed P2P chat)
    no_button=True → Markdown allowed, but skip the inline button
                     (used for command replies that should not look like a
                     wallet ad)
    main_kb=True → attach the Crypto-Bot-style 3×2 inline keyboard
                   (used on /start and /menu).
    """
    payload: dict = {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": True,
    }
    if not plain:
        payload["parse_mode"] = "Markdown"
        if main_kb:
            payload["reply_markup"] = _main_inline_keyboard()
        elif not no_button:
            payload["reply_markup"] = _open_wallet_keyboard(start_app=start_app)
    try:
        await client.post(f"{TG_API}/sendMessage", json=payload, timeout=10.0)
    except Exception:
        # Best-effort; don't fail webhook if Telegram is flaky.
        pass


async def _send_photo(
    client: httpx.AsyncClient,
    chat_id: int,
    photo_url: str,
    caption: str,
    *,
    reply_markup: dict | None = None,
) -> None:
    """Send a photo by URL with Markdown caption. Falls back to text."""
    payload: dict = {
        "chat_id": chat_id,
        "photo": photo_url,
        "caption": caption,
        "parse_mode": "Markdown",
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    try:
        r = await client.post(f"{TG_API}/sendPhoto", json=payload, timeout=20.0)
        if r.status_code != 200:
            print(f"[bot] sendPhoto url -> {r.status_code} {r.text[:200]}", flush=True)
            await _send_message(client, chat_id, caption, no_button=True)
    except Exception as exc:
        print(f"[bot] sendPhoto url EXC: {exc!r}", flush=True)
        await _send_message(client, chat_id, caption, no_button=True)


async def _send_photo_bytes(
    client: httpx.AsyncClient,
    chat_id: int,
    photo_bytes: bytes,
    caption: str,
    *,
    reply_markup: dict | None = None,
) -> None:
    """Upload a photo as multipart so it does not depend on Telegram being
    able to fetch our public URL (which can race the cold-start on Render).
    Falls back to plain text on failure.
    """
    import json as _json
    data: dict = {
        "chat_id": str(chat_id),
        "caption": caption,
        "parse_mode": "Markdown",
    }
    if reply_markup is not None:
        data["reply_markup"] = _json.dumps(reply_markup)
    files = {"photo": ("card.png", photo_bytes, "image/png")}
    try:
        r = await client.post(
            f"{TG_API}/sendPhoto", data=data, files=files, timeout=30.0
        )
        if r.status_code != 200:
            print(f"[bot] sendPhoto bytes -> {r.status_code} {r.text[:200]}", flush=True)
            await _send_message(client, chat_id, caption, no_button=True)
    except Exception as exc:
        print(f"[bot] sendPhoto bytes EXC: {exc!r}", flush=True)
        await _send_message(client, chat_id, caption, no_button=True)


def _price_keyboard(sym: str, fiat: str, *, in_chat: bool) -> dict:
    """Inline keyboard under a price card.

    in_chat=True  → private chat with the bot, can use web_app + callback_data.
    in_chat=False → message sent via inline mode; web_app/callback are not
                    allowed there, so we use url buttons that deep-link to
                    the bot's startapp param.
    """
    if in_chat:
        return {
            "inline_keyboard": [
                [
                    {
                        "text": "🔄 Обновить курс",
                        "callback_data": f"refresh:{sym}:{fiat}",
                    },
                ],
            ],
        }
    return {"inline_keyboard": []}


async def _handle_callback_query(cq: dict) -> None:
    """Handle inline-keyboard button taps. Currently only `refresh:<sym>:<fiat>`."""
    cq_id = cq.get("id")
    data = cq.get("data") or ""
    msg = cq.get("message") or {}
    chat_id = (msg.get("chat") or {}).get("id")
    message_id = msg.get("message_id")

    async with httpx.AsyncClient() as client:
        # Always ack so Telegram stops the spinner
        try:
            await client.post(
                f"{TG_API}/answerCallbackQuery",
                json={"callback_query_id": cq_id, "text": "Обновляю…"},
                timeout=8.0,
            )
        except Exception:
            pass

        if not data.startswith("refresh:") or chat_id is None or message_id is None:
            return
        try:
            _, sym, fiat = data.split(":", 2)
        except ValueError:
            return

        # Refetch quote + edit caption + bump card URL so Telegram re-fetches
        body, parsed_sym, parsed_fiat = await cmd_price(f"/price {sym} {fiat}")
        if not parsed_sym:
            return
        new_card_url = (
            f"{BOT_PUBLIC_URL}/cards/{parsed_sym}.png"
            f"?fiat={parsed_fiat}&t={int(time.time())}"
        )
        keyboard = _price_keyboard(parsed_sym, parsed_fiat, in_chat=True)
        try:
            await client.post(
                f"{TG_API}/editMessageMedia",
                json={
                    "chat_id": chat_id,
                    "message_id": message_id,
                    "media": {
                        "type": "photo",
                        "media": new_card_url,
                        "caption": body,
                        "parse_mode": "Markdown",
                    },
                    "reply_markup": keyboard,
                },
                timeout=15.0,
            )
        except Exception:
            pass


# ---- /cards/{ticker}.png — branded price card image ------------------------


@app.get("/docs/pay")
async def docs_pay() -> Response:
    html = _PAY_API_DOCS_HTML.replace("__BOT_PUBLIC_URL__", BOT_PUBLIC_URL).replace(
        "__APP_URL__", APP_URL
    )
    return Response(content=html, media_type="text/html; charset=utf-8")


@app.get("/cards/{ticker}.png")
async def card_png(ticker: str, fiat: str = "rub", t: int | None = None):
    sym = ticker.lower().strip()
    cg_id = PRICE_IDS.get(sym)
    if not cg_id:
        raise HTTPException(status_code=404, detail="unknown ticker")
    fiat = (fiat or "rub").lower()
    if fiat not in ("usd", "rub", "eur"):
        fiat = "rub"
    png = await render_price_card(sym, cg_id, fiat)
    if png is None:
        raise HTTPException(status_code=502, detail="card render failed")
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=120"},
    )



# ---- Pay API: invoices --------------------------------------------------------


def _api_key_from_request(request: Request) -> str:
    raw = request.headers.get("X-API-Key") or ""
    if not raw:
        auth = request.headers.get("Authorization") or ""
        if auth.startswith("Bearer "):
            raw = auth[7:].strip()
    return raw


class _CreateInvoiceBody(BaseModel):
    amount: float = Field(..., gt=0)
    asset: str = Field("TON")
    description: str | None = Field(None, max_length=200)
    payload: str | None = Field(None, max_length=200)
    callback_url: str | None = Field(None, max_length=500)
    ttl_seconds: int | None = Field(None, ge=60, le=86400)


@app.post("/api/v1/invoice/create")
async def api_create_invoice(body: _CreateInvoiceBody, request: Request):
    from . import invoices as inv_mod

    merchant = inv_mod.authenticate(_api_key_from_request(request))
    if not merchant:
        raise HTTPException(status_code=401, detail="bad api key")
    try:
        inv = inv_mod.create_invoice(
            merchant_id=merchant["id"],
            asset=body.asset,
            amount=body.amount,
            description=body.description,
            payload=body.payload,
            callback_url=body.callback_url,
            ttl_seconds=body.ttl_seconds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # We use ``?start=inv_<id>`` (not ``?startapp=``) because the bot opens
    # its Mini App via a web_app inline button rather than a Direct Link Mini
    # App registered through BotFather. When Telegram opens the bot via this
    # link it auto-sends ``/start inv_<id>`` and our /start handler replies
    # with an "Open invoice" button that points the Mini App at
    # ``$APP_URL/?invoice=<id>``.
    pay_url = f"https://t.me/{BOT_USERNAME}?start={inv['id']}"
    return {
        "invoice": inv_mod.merchant_invoice_view(inv),
        "pay_url": pay_url,
        "mini_app_url": f"{APP_URL}/?invoice={inv['id']}",
    }


@app.get("/api/v1/invoice/{invoice_id}")
async def api_get_invoice(invoice_id: str, request: Request):
    from . import invoices as inv_mod
    from . import db as db_mod

    merchant = inv_mod.authenticate(_api_key_from_request(request))
    if not merchant:
        raise HTTPException(status_code=401, detail="bad api key")
    inv = db_mod.invoice_by_id(invoice_id)
    if not inv or inv["merchant_id"] != merchant["id"]:
        raise HTTPException(status_code=404, detail="not found")
    return {"invoice": inv_mod.merchant_invoice_view(inv)}


@app.get("/api/v1/invoices")
async def api_list_invoices(request: Request, limit: int = 50):
    from . import invoices as inv_mod
    from . import db as db_mod

    merchant = inv_mod.authenticate(_api_key_from_request(request))
    if not merchant:
        raise HTTPException(status_code=401, detail="bad api key")
    rows = db_mod.list_invoices_by_merchant(merchant["id"], limit=min(200, max(1, limit)))
    return {"invoices": [inv_mod.merchant_invoice_view(r) for r in rows]}


@app.get("/api/public/invoice/{invoice_id}")
async def api_public_invoice(invoice_id: str):
    """Customer-facing endpoint consumed by the Mini App pay screen.

    No auth — the invoice id is itself the secret. Anyone with the id can
    see the payment details and pay; this is intentional, just like a
    Crypto Bot pay link.
    """
    from . import invoices as inv_mod
    from . import db as db_mod

    inv = db_mod.invoice_by_id(invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="not found")
    return inv_mod.public_invoice_view(inv)


@app.post("/api/v1/scan")
async def api_scan(request: Request):
    """Manual trigger for the on-chain scanner.

    Authentication is via the same WEBHOOK_SECRET so external cron jobs
    (cron-job.org) can keep the bot awake on Render free without exposing
    the endpoint to abuse.
    """
    from . import invoices as inv_mod

    secret = request.query_params.get("secret") or ""
    if WEBHOOK_SECRET and secret != WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="forbidden")
    return await inv_mod.scan_once()


# ---- Webhook ---------------------------------------------------------------


@app.post("/webhook/{token_path}")
async def webhook(token_path: str, request: Request) -> dict[str, bool]:
    if WEBHOOK_SECRET and not hmac.compare_digest(token_path, WEBHOOK_SECRET):
        return {"ok": False}

    update = await request.json()

    # Inline queries (typing `@FwalletBot ton rub` in any chat).
    if "inline_query" in update:
        await handle_inline_query(TG_API, update["inline_query"])
        return {"ok": True}

    # Inline keyboard callbacks (Refresh button under price card etc.)
    if "callback_query" in update:
        await _handle_callback_query(update["callback_query"])
        return {"ok": True}

    message = update.get("message") or update.get("edited_message")
    if not message:
        return {"ok": True}

    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    from_user = message.get("from") or {}
    user_tg_id = from_user.get("id")
    text = (message.get("text") or "").strip()
    if chat_id is None:
        return {"ok": True}

    async with httpx.AsyncClient() as client:
        # One-time wipe of any legacy reply keyboard cached on the user's
        # device. We piggy-back on the very first incoming message per
        # chat per process run: send a throwaway message with
        # ``remove_keyboard``, then delete it so the user sees nothing
        # except the legacy keyboard disappearing.
        if chat_id not in _KB_WIPED:
            _KB_WIPED.add(chat_id)
            try:
                r = await client.post(
                    f"{TG_API}/sendMessage",
                    json={
                        "chat_id": chat_id,
                        "text": "·",
                        "reply_markup": {"remove_keyboard": True},
                        "disable_notification": True,
                    },
                    timeout=10.0,
                )
                msg_id = (r.json().get("result") or {}).get("message_id")
                if msg_id:
                    await client.post(
                        f"{TG_API}/deleteMessage",
                        json={"chat_id": chat_id, "message_id": msg_id},
                        timeout=10.0,
                    )
            except Exception:
                pass

        # Handle /start, /wallet, /about with the regular Open Wallet button.
        if text.startswith("/start"):
            payload = text[len("/start") :].strip() or None
            # Pay-API deep link: ``/start inv_<id>`` opens the invoice screen
            # in the Mini App with a single tap.
            if payload and payload.startswith("inv_"):
                from . import db as inv_db
                from . import invoices as inv_mod
                inv = inv_db.invoice_by_id(payload)
                if inv:
                    pub = inv_mod.public_invoice_view(inv)
                    msg = (
                        "🧾 *Счёт на оплату*\n\n"
                        f"Магазин: *{pub['merchant_name']}*\n"
                        f"Сумма: *{pub['amount']} {pub['asset']}*\n"
                    )
                    if pub.get("description"):
                        msg += f"Описание: {pub['description']}\n"
                    msg += "\nЖми кнопку, чтобы открыть экран оплаты."
                    payload_dict = {
                        "chat_id": chat_id,
                        "text": msg,
                        "parse_mode": "Markdown",
                        "reply_markup": _open_invoice_keyboard(payload),
                    }
                    try:
                        await client.post(
                            f"{TG_API}/sendMessage",
                            json=payload_dict,
                            timeout=10.0,
                        )
                    except Exception:
                        pass
                    return {"ok": True}
                # Unknown / expired invoice — fall through to default welcome.
            await _send_message(
                client, chat_id, WELCOME_TEXT, start_app=payload, main_kb=True
            )
            return {"ok": True}
        if text.startswith("/wallet"):
            await _send_message(client, chat_id, WELCOME_TEXT)
            return {"ok": True}
        if text.startswith("/about"):
            await _send_message(client, chat_id, ABOUT_TEXT)
            return {"ok": True}
        if text.startswith("/menu"):
            await _send_message(
                client, chat_id, "🏠 Главное меню", main_kb=True
            )
            return {"ok": True}

        # Other text commands. Strip @bot suffix some clients append.
        if text.startswith("/") and user_tg_id is not None:
            cmd_text = (
                text.split("@", 1)[0]
                if "@" in text.split()[0]
                else text
            )
            handled = await _handle_text_command(
                client, int(user_tg_id), chat_id, cmd_text
            )
            if handled:
                return {"ok": True}

        # In-deal commands and message relay.
        if user_tg_id is not None:
            deal = _find_active_deal(int(user_tg_id))
            if deal is not None:
                handled = await _handle_deal_message(
                    client, deal, int(user_tg_id), text
                )
                if handled:
                    return {"ok": True}

        # Fallback: any other text — reply with the standard welcome.
        await _send_message(client, chat_id, WELCOME_TEXT)

    return {"ok": True}


# ---- P2P ad board (anonymous via creator_tg_id) ----------------------------


class NewAd(BaseModel):
    creator_tg_id: int = Field(gt=0)
    side: Literal["buy", "sell"]
    asset: Literal["TON", "ETH", "BNB", "SOL", "BTC", "USDT-ERC20", "USDC-ERC20"]
    currency: Literal["RUB", "USD", "EUR", "UAH", "KZT"]
    price: float = Field(gt=0)
    min_amount: float = Field(gt=0)
    max_amount: float = Field(gt=0)
    payment_method: Literal[
        "Тинькофф",
        "Сбербанк",
        "Альфа-Банк",
        "ВТБ",
        "Райффайзен",
        "Газпромбанк",
        "Открытие",
        "СБП",
        "Другой",
    ]
    payment_details: str = Field(min_length=4, max_length=120)
    note: str | None = Field(default=None, max_length=500)

    @field_validator("max_amount")
    @classmethod
    def _max_ge_min(cls, v: float, info) -> float:
        min_amount = info.data.get("min_amount")
        if isinstance(min_amount, (int, float)) and v < min_amount:
            raise ValueError("max_amount must be >= min_amount")
        return v


def _public_ad(ad: dict) -> dict:
    """Strip TG IDs and private payment details from the ad listing.

    Payment details (card number, SBP phone) are revealed only after a deal
    is opened — see _public_deal.
    """
    return {
        k: v for k, v in ad.items() if k not in ("creator_tg_id", "payment_details")
    }


@app.get("/p2p/ads")
async def list_p2p_ads(
    side: str | None = Query(default=None, pattern=r"^(buy|sell)$"),
    asset: str | None = Query(default=None),
    currency: str | None = Query(default=None),
) -> list[dict]:
    ads = _load_json(_ADS_FILE, [])
    ads.sort(key=lambda a: a.get("created_at", ""), reverse=True)
    out: list[dict] = []
    for ad in ads:
        if side and ad.get("side") != side:
            continue
        if asset and ad.get("asset") != asset:
            continue
        if currency and ad.get("currency") != currency:
            continue
        out.append(_public_ad(ad))
    return out


@app.get("/p2p/ads/mine")
async def list_my_ads(request: Request, tg_id: int = Query(...)) -> list[dict]:
    _auth(request, tg_id)
    ads = _load_json(_ADS_FILE, [])
    return [
        _public_ad(ad) for ad in ads if int(ad.get("creator_tg_id", 0)) == tg_id
    ]


@app.post("/p2p/ads")
async def create_p2p_ad(ad: NewAd, request: Request) -> dict:
    _auth(request, ad.creator_tg_id)
    ads = _load_json(_ADS_FILE, [])
    if len(ads) > 500:
        ads.sort(key=lambda a: a.get("created_at", ""))
        ads = ads[-500:]
    new_ad = ad.model_dump()
    new_ad["id"] = str(uuid.uuid4())
    new_ad["created_at"] = _now_iso()
    ads.append(new_ad)
    _save_json(_ADS_FILE, ads)
    return _public_ad(new_ad)


@app.delete("/p2p/ads/{ad_id}")
async def delete_p2p_ad(
    ad_id: str, request: Request, tg_id: int = Query(...)
) -> dict:
    _auth(request, tg_id)
    ads = _load_json(_ADS_FILE, [])
    target = next((a for a in ads if a["id"] == ad_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Ad not found")
    if int(target.get("creator_tg_id", 0)) != tg_id:
        raise HTTPException(status_code=403, detail="Not your ad")
    ads = [ad for ad in ads if ad["id"] != ad_id]
    _save_json(_ADS_FILE, ads)
    return {"ok": True}


# ---- P2P deals: anonymous relay --------------------------------------------


class NewDeal(BaseModel):
    ad_id: str
    taker_tg_id: int = Field(gt=0)
    amount: float = Field(gt=0)


def _public_deal(deal: dict, viewer_tg_id: int | None = None) -> dict:
    """Hide counterparty TG IDs; messages keep only the 'role' relative to viewer."""
    out = {
        "id": deal["id"],
        "ad_id": deal["ad_id"],
        "asset": deal.get("asset"),
        "side": deal.get("side"),
        "currency": deal.get("currency"),
        "price": deal.get("price"),
        "amount": deal.get("amount"),
        "payment_method": deal.get("payment_method"),
        "payment_details": deal.get("payment_details"),
        "status": deal["status"],
        "created_at": deal["created_at"],
        "fiat_paid_at": deal.get("fiat_paid_at"),
        "crypto_sent_at": deal.get("crypto_sent_at"),
        "done_at": deal.get("done_at"),
        "auto_release_at": deal.get("auto_release_at"),
        "messages": [],
        "buyer_address": deal.get("buyer_address"),
    }
    # Determine viewer role.
    if viewer_tg_id is not None:
        if int(viewer_tg_id) == int(deal["buyer_tg_id"]):
            out["my_role"] = "buyer"
        elif int(viewer_tg_id) == int(deal["seller_tg_id"]):
            out["my_role"] = "seller"
        else:
            out["my_role"] = "observer"
    for m in deal.get("messages", []):
        msg = {
            "from_role": (
                "buyer"
                if int(m["from_tg_id"]) == int(deal["buyer_tg_id"])
                else "seller"
            ),
            "text": m["text"],
            "at": m["at"],
        }
        if viewer_tg_id is not None:
            msg["from_me"] = int(m["from_tg_id"]) == int(viewer_tg_id)
        out["messages"].append(msg)
    return out


def _resolve_roles(ad: dict, taker_tg_id: int) -> tuple[int, int]:
    """Return (buyer_tg_id, seller_tg_id) given an ad and its taker."""
    creator = int(ad["creator_tg_id"])
    if ad["side"] == "sell":  # creator sells crypto → taker is buyer
        return taker_tg_id, creator
    else:  # creator buys crypto → taker is seller
        return creator, taker_tg_id


def _find_active_deal(tg_id: int) -> dict | None:
    deals = _load_json(_DEALS_FILE, [])
    for d in deals:
        if d.get("status") in ("done", "cancelled", "expired"):
            continue
        if int(d.get("buyer_tg_id", 0)) == tg_id or int(d.get("seller_tg_id", 0)) == tg_id:
            return d
    return None


def _save_deal(deal: dict) -> None:
    deals = _load_json(_DEALS_FILE, [])
    out = [d for d in deals if d["id"] != deal["id"]]
    out.append(deal)
    _save_json(_DEALS_FILE, out)


def _maybe_auto_release(deal: dict) -> dict:
    """If 2-min timer has elapsed since crypto_sent, auto-mark done."""
    if deal.get("status") == "crypto_sent":
        auto_at = deal.get("auto_release_at")
        if auto_at and time.time() >= auto_at:
            deal["status"] = "done"
            deal["done_at"] = _now_iso()
            _save_deal(deal)
    return deal


@app.post("/p2p/deals")
async def create_deal(req: NewDeal, request: Request) -> dict:
    _auth(request, req.taker_tg_id)
    ads = _load_json(_ADS_FILE, [])
    ad = next((a for a in ads if a["id"] == req.ad_id), None)
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found")
    if int(ad["creator_tg_id"]) == req.taker_tg_id:
        raise HTTPException(status_code=400, detail="Cannot trade with yourself")
    if req.amount < ad["min_amount"] or req.amount > ad["max_amount"]:
        raise HTTPException(
            status_code=400,
            detail=f"Сумма должна быть от {ad['min_amount']} до {ad['max_amount']}",
        )

    # Reject if either party already has an active deal.
    if _find_active_deal(req.taker_tg_id) is not None:
        raise HTTPException(status_code=409, detail="У тебя уже есть активная сделка")
    if _find_active_deal(int(ad["creator_tg_id"])) is not None:
        raise HTTPException(
            status_code=409, detail="У продавца/покупателя уже есть активная сделка"
        )

    buyer_tg_id, seller_tg_id = _resolve_roles(ad, req.taker_tg_id)
    deal = {
        "id": str(uuid.uuid4()),
        "ad_id": ad["id"],
        "asset": ad["asset"],
        "side": ad["side"],
        "currency": ad["currency"],
        "price": ad["price"],
        "amount": req.amount,
        "payment_method": ad["payment_method"],
        "payment_details": ad.get("payment_details"),
        "buyer_tg_id": buyer_tg_id,
        "seller_tg_id": seller_tg_id,
        "status": "open",
        "created_at": _now_iso(),
        "messages": [],
    }
    _save_deal(deal)

    intro = (
        f"🤝 Сделка #{deal['id'][:8]} открыта\n"
        f"Актив: {deal['asset']}, сумма: {deal['amount']} {deal['asset']}, "
        f"цена: {deal['price']} {deal['currency']} / 1 {deal['asset']}\n"
        f"Способ: {deal['payment_method']}\n"
        f"Реквизиты: {deal.get('payment_details', '—')}\n\n"
        "Я буду пересылать сообщения между сторонами анонимно.\n"
        "Команды:\n"
        "  /paid — покупатель: я перевёл деньги\n"
        "  /sent — продавец: крипта отправлена (запустит таймер 2 мин)\n"
        "  /received — покупатель: получил крипту (закроет сделку)\n"
        "  /cancel — отменить сделку\n\n"
        "⚠️ Эскроу нет. Внимательно проверяйте поступления."
    )

    async with httpx.AsyncClient() as client:
        await _send_message(client, buyer_tg_id, intro, plain=True)
        await _send_message(client, seller_tg_id, intro, plain=True)

    return _public_deal(deal, viewer_tg_id=req.taker_tg_id)


@app.get("/p2p/deals/{deal_id}")
async def get_deal(
    deal_id: str, request: Request, tg_id: int = Query(...)
) -> dict:
    _auth(request, tg_id)
    deals = _load_json(_DEALS_FILE, [])
    deal = next((d for d in deals if d["id"] == deal_id), None)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    deal = _maybe_auto_release(deal)
    return _public_deal(deal, viewer_tg_id=tg_id)


@app.get("/p2p/deals")
async def list_my_deals(request: Request, tg_id: int = Query(...)) -> list[dict]:
    _auth(request, tg_id)
    deals = _load_json(_DEALS_FILE, [])
    out: list[dict] = []
    for d in deals:
        if int(d.get("buyer_tg_id", 0)) == tg_id or int(d.get("seller_tg_id", 0)) == tg_id:
            d = _maybe_auto_release(d)
            out.append(_public_deal(d, viewer_tg_id=tg_id))
    out.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return out


class DealAction(BaseModel):
    tg_id: int = Field(gt=0)
    action: Literal["paid", "sent", "received", "cancel"]
    buyer_address: str | None = None  # used when buyer sets address


@app.post("/p2p/deals/{deal_id}/action")
async def deal_action(deal_id: str, req: DealAction, request: Request) -> dict:
    _auth(request, req.tg_id)
    deals = _load_json(_DEALS_FILE, [])
    deal = next((d for d in deals if d["id"] == deal_id), None)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    is_buyer = int(req.tg_id) == int(deal["buyer_tg_id"])
    is_seller = int(req.tg_id) == int(deal["seller_tg_id"])
    if not is_buyer and not is_seller:
        raise HTTPException(status_code=403, detail="Not your deal")

    other_tg_id = deal["seller_tg_id"] if is_buyer else deal["buyer_tg_id"]
    notify = ""

    if req.action == "paid":
        if not is_buyer:
            raise HTTPException(status_code=400, detail="Только покупатель")
        if deal["status"] != "open":
            raise HTTPException(status_code=400, detail="Неверный статус")
        deal["status"] = "fiat_paid"
        deal["fiat_paid_at"] = _now_iso()
        if req.buyer_address:
            deal["buyer_address"] = req.buyer_address
        notify = (
            "💸 Покупатель пометил оплату как отправленную. "
            "Проверьте поступление и нажмите /sent когда отправите крипту."
        )
    elif req.action == "sent":
        if not is_seller:
            raise HTTPException(status_code=400, detail="Только продавец")
        if deal["status"] not in ("open", "fiat_paid"):
            raise HTTPException(status_code=400, detail="Неверный статус")
        deal["status"] = "crypto_sent"
        deal["crypto_sent_at"] = _now_iso()
        deal["auto_release_at"] = time.time() + 120  # 2 minutes
        notify = (
            "✅ Продавец пометил отправку крипты. Запущен таймер 2 минуты — "
            "если за это время не нажмёшь /received, сделка закроется автоматически."
        )
    elif req.action == "received":
        if not is_buyer:
            raise HTTPException(status_code=400, detail="Только покупатель")
        deal["status"] = "done"
        deal["done_at"] = _now_iso()
        notify = "🎉 Покупатель подтвердил получение. Сделка закрыта."
    elif req.action == "cancel":
        if deal["status"] in ("done", "cancelled", "expired"):
            raise HTTPException(status_code=400, detail="Уже закрыта")
        deal["status"] = "cancelled"
        deal["done_at"] = _now_iso()
        notify = "❌ Сделка отменена."

    _save_deal(deal)

    if notify:
        async with httpx.AsyncClient() as client:
            await _send_message(client, other_tg_id, notify, plain=True)
            await _send_message(client, req.tg_id, notify, plain=True)

    return _public_deal(deal, viewer_tg_id=req.tg_id)


class DealMessage(BaseModel):
    tg_id: int = Field(gt=0)
    text: str = Field(min_length=1, max_length=2000)


@app.post("/p2p/deals/{deal_id}/messages")
async def post_deal_message(
    deal_id: str, req: DealMessage, request: Request
) -> dict:
    _auth(request, req.tg_id)
    deals = _load_json(_DEALS_FILE, [])
    deal = next((d for d in deals if d["id"] == deal_id), None)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    if int(req.tg_id) not in (int(deal["buyer_tg_id"]), int(deal["seller_tg_id"])):
        raise HTTPException(status_code=403, detail="Not your deal")
    if deal["status"] in ("done", "cancelled", "expired"):
        raise HTTPException(status_code=400, detail="Сделка закрыта")

    msg = {"from_tg_id": int(req.tg_id), "text": req.text, "at": _now_iso()}
    deal.setdefault("messages", []).append(msg)
    _save_deal(deal)

    other = (
        deal["seller_tg_id"]
        if int(req.tg_id) == int(deal["buyer_tg_id"])
        else deal["buyer_tg_id"]
    )
    other_role_label = "Контрагент"
    relay = f"💬 {other_role_label}: {req.text}"
    async with httpx.AsyncClient() as client:
        await _send_message(client, other, relay, plain=True)
    return {"ok": True}


async def _handle_deal_message(
    client: httpx.AsyncClient, deal: dict, sender_tg_id: int, text: str
) -> bool:
    """Route an incoming Telegram DM to the deal flow.

    Returns True when the message was consumed (so the caller skips the
    default WELCOME_TEXT response).
    """
    if deal["status"] in ("done", "cancelled", "expired"):
        return False

    is_buyer = sender_tg_id == int(deal["buyer_tg_id"])
    is_seller = sender_tg_id == int(deal["seller_tg_id"])
    if not is_buyer and not is_seller:
        return False

    other = deal["seller_tg_id"] if is_buyer else deal["buyer_tg_id"]
    cmd = text.strip().lower()

    if cmd == "/paid":
        if is_buyer and deal["status"] == "open":
            deal["status"] = "fiat_paid"
            deal["fiat_paid_at"] = _now_iso()
            _save_deal(deal)
            await _send_message(client, other, "💸 Покупатель пометил оплату.", plain=True)
            await _send_message(client, sender_tg_id, "Принято.", plain=True)
        else:
            await _send_message(
                client, sender_tg_id, "Команда недоступна сейчас.", plain=True
            )
        return True
    if cmd == "/sent":
        if is_seller and deal["status"] in ("open", "fiat_paid"):
            deal["status"] = "crypto_sent"
            deal["crypto_sent_at"] = _now_iso()
            deal["auto_release_at"] = time.time() + 120
            _save_deal(deal)
            await _send_message(
                client,
                other,
                "✅ Продавец отправил крипту. Таймер 2 мин до авто-закрытия.",
                plain=True,
            )
            await _send_message(client, sender_tg_id, "Принято. Жду подтверждения.", plain=True)
        else:
            await _send_message(
                client, sender_tg_id, "Команда недоступна сейчас.", plain=True
            )
        return True
    if cmd == "/received":
        if is_buyer:
            deal["status"] = "done"
            deal["done_at"] = _now_iso()
            _save_deal(deal)
            await _send_message(client, other, "🎉 Покупатель подтвердил получение.", plain=True)
            await _send_message(client, sender_tg_id, "Сделка закрыта.", plain=True)
        else:
            await _send_message(client, sender_tg_id, "Только покупатель.", plain=True)
        return True
    if cmd == "/cancel":
        deal["status"] = "cancelled"
        deal["done_at"] = _now_iso()
        _save_deal(deal)
        await _send_message(client, other, "❌ Контрагент отменил сделку.", plain=True)
        await _send_message(client, sender_tg_id, "Сделка отменена.", plain=True)
        return True

    # Plain text → relay anonymously.
    deal.setdefault("messages", []).append(
        {"from_tg_id": sender_tg_id, "text": text, "at": _now_iso()}
    )
    _save_deal(deal)
    await _send_message(client, other, f"💬 Контрагент: {text}", plain=True)
    return True


# ---- Referral registry -----------------------------------------------------


class ReferralRegister(BaseModel):
    tg_id: int = Field(gt=0)
    ton_address: str | None = None
    eth_address: str | None = None
    bsc_address: str | None = None
    sol_address: str | None = None
    btc_address: str | None = None


@app.post("/referral/register")
async def register_addresses(req: ReferralRegister, request: Request) -> dict:
    _auth(request, req.tg_id)
    refs = _load_json(_REFERRALS_FILE, {})
    key = str(req.tg_id)
    cur = refs.get(key, {})
    payload = req.model_dump()
    payload.pop("tg_id")
    for k, v in payload.items():
        if v:
            cur[k] = v
    cur["updated_at"] = _now_iso()
    refs[key] = cur
    _save_json(_REFERRALS_FILE, refs)
    return {"ok": True}


@app.get("/referral/lookup/{tg_id}")
async def lookup_referral(tg_id: int, chain: str | None = Query(default=None)) -> dict:
    refs = _load_json(_REFERRALS_FILE, {})
    rec = refs.get(str(tg_id))
    if not rec:
        raise HTTPException(status_code=404, detail="Not registered")
    if chain:
        key = {
            "ton": "ton_address",
            "eth": "eth_address",
            "bsc": "bsc_address",
            "sol": "sol_address",
            "btc": "btc_address",
        }.get(chain)
        if not key or not rec.get(key):
            raise HTTPException(status_code=404, detail="No address for chain")
        return {"chain": chain, "address": rec[key]}
    return rec




# ── Static Mini App ───────────────────────────────────────────────────────
# The frontend is built in the Docker `frontend` stage and copied into
# `static_frontend/`. Mounted last so all the API routes above shadow it
# for their specific paths; everything else (`/`, `/assets/*`, etc.) is
# served from the bundle. `html=True` makes `/` resolve to `index.html`.
#
# The SPA uses query-string params (`?invoice=`, `?tab=`, `?profile=`) — no
# deep paths — so we don't need an extra SPA-fallback route.
if FRONTEND_DIR.is_dir():
    app.mount(
        "/",
        StaticFiles(directory=FRONTEND_DIR, html=True),
        name="frontend",
    )
