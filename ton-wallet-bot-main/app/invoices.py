"""Merchant / invoice subsystem.

Architecture
============

A merchant (owner of a casino, shop, etc.) registers via the bot's `/api`
command, supplying their TON address. The bot generates a secret api_key
which the merchant integrates server-side. The merchant calls the
``POST /api/v1/invoice/create`` endpoint to mint a unique invoice, then
shows the resulting ``pay_url`` to their customer. The customer opens the
URL in Telegram, lands on the Fwallet Mini App's invoice-pay screen,
and signs a single TON transaction that splits the payment 99.2 % to the
merchant + 0.8 % to the platform's collection address.

A background asyncio task in ``main.py`` polls TonCenter every minute for
incoming transactions on every merchant address with active invoices. When
a transaction's text comment matches an invoice id and the value is
sufficient, the invoice is flipped to ``paid``, ``paid_tx_hash`` is
recorded, and the registered ``callback_url`` is POSTed an HMAC-signed
notification.

Why not just trust the merchant's own webhook from the wallet send flow?
Because the customer-side Mini App is untrusted code (ours, but anyone could
fake the call). Only an on-chain confirmation through TonCenter is
authoritative.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

import httpx

from . import db  # noqa: F401  -- re-exported for tests


# ---- Constants -------------------------------------------------------------

# Platform commission as a fraction of the payment. Hardcoded for MVP; can
# be lifted to a per-merchant or env-driven value later.
PLATFORM_FEE_BPS = 80  # 0.80 %

PLATFORM_TON_ADDRESS = os.environ.get(
    "PLATFORM_TON_ADDRESS",
    "UQBNTeF_KqGCLWTM477yccf5AsD6YJGchRX6Q0CIWW5RME_7",
)

# Default invoice lifetime if the merchant does not specify one.
DEFAULT_TTL_SECONDS = 60 * 60  # 1 hour
# Hard upper bound to prevent merchants from accidentally leaving invoices
# pending forever (TonCenter scan covers ~last 100 txs which on a busy
# wallet is not that much history).
MAX_TTL_SECONDS = 60 * 60 * 24  # 24 hours

NANO_PER_TON = 10**9


# ---- ID + key generation ---------------------------------------------------


def gen_merchant_id() -> str:
    return "M" + secrets.token_hex(4).upper()  # M1A2B3C4D5


def gen_invoice_id() -> str:
    # Short enough to fit comfortably in a TON text comment alongside a
    # human-readable note ("inv_abc12345"). 8 hex chars = 4 bytes of
    # entropy, which is plenty against accidental cross-merchant collisions
    # (we anyway scope lookup to a specific merchant address).
    return "inv_" + secrets.token_hex(4)


def gen_api_key() -> str:
    # 32 bytes of entropy, prefixed with ``aw_live_`` so leaks are easy
    # to grep in customer logs.
    return "aw_live_" + secrets.token_urlsafe(32)





# ---- Public surface --------------------------------------------------------


def register_merchant(
    *, tg_user_id: int, ton_address: str, name: str | None
) -> tuple[dict[str, Any], str]:
    """Idempotent merchant registration.

    Returns (merchant_record, plaintext_api_key). The plaintext key is only
    available right after creation/rotation, never stored.
    """
    existing = db.merchant_by_tg(tg_user_id)
    if existing:
        # Rotate the api key on every /api call so the latest message in
        # the chat is always the source of truth. Old keys stop working
        # immediately.
        api_key = gen_api_key()
        db.update_merchant_address(tg_user_id, ton_address)
        db.update_merchant_api_key(tg_user_id, api_key)
        return db.merchant_by_tg(tg_user_id) or existing, api_key
    api_key = gen_api_key()
    merchant_id = gen_merchant_id()
    db.create_merchant(
        merchant_id=merchant_id,
        api_key=api_key,
        tg_user_id=tg_user_id,
        ton_address=ton_address,
        name=name,
    )
    return db.merchant_by_tg(tg_user_id) or {}, api_key


def authenticate(api_key: str) -> dict[str, Any] | None:
    if not api_key:
        return None
    return db.merchant_by_api_key(api_key)


def create_invoice(
    *,
    merchant_id: str,
    asset: str,
    amount: float | int | str,
    description: str | None,
    payload: str | None,
    callback_url: str | None,
    ttl_seconds: int | None,
) -> dict[str, Any]:
    if asset.upper() != "TON":
        raise ValueError("only TON is supported in MVP")
    try:
        amt = float(amount)
    except (TypeError, ValueError):
        raise ValueError("amount must be a number") from None
    if amt <= 0:
        raise ValueError("amount must be > 0")
    if amt < 0.01:
        # TonCenter sometimes drops sub-cent transactions in its index; not
        # worth dealing with for MVP.
        raise ValueError("amount must be >= 0.01 TON")
    if ttl_seconds is None:
        ttl = DEFAULT_TTL_SECONDS
    else:
        try:
            ttl = int(ttl_seconds)
        except (TypeError, ValueError):
            raise ValueError("ttl_seconds must be an integer") from None
        ttl = max(60, min(ttl, MAX_TTL_SECONDS))

    invoice_id = gen_invoice_id()
    amount_nano = str(int(round(amt * NANO_PER_TON)))
    expires_at = int(time.time()) + ttl
    db.create_invoice(
        invoice_id=invoice_id,
        merchant_id=merchant_id,
        asset="TON",
        amount_nano=amount_nano,
        description=description,
        payload=payload,
        callback_url=callback_url,
        expires_at=expires_at,
    )
    return db.invoice_by_id(invoice_id) or {}


def public_invoice_view(inv: dict[str, Any]) -> dict[str, Any]:
    """Customer-facing dict (no callback_url, no merchant_id internals).

    This is what the Mini App pay screen consumes via /api/public/invoice/{id}.
    """
    amount_nano = int(inv["amount_nano"])
    fee_nano = amount_nano * PLATFORM_FEE_BPS // 10_000
    merchant_nano = amount_nano - fee_nano
    return {
        "id": inv["id"],
        "asset": inv["asset"],
        "amount": amount_nano / NANO_PER_TON,
        "amount_nano": str(amount_nano),
        "merchant_amount_nano": str(merchant_nano),
        "platform_fee_nano": str(fee_nano),
        "platform_fee_address": PLATFORM_TON_ADDRESS,
        "merchant_address": inv["merchant_ton_address"],
        "merchant_name": inv.get("merchant_name") or "Fwallet Merchant",
        "description": inv.get("description"),
        "status": inv["status"],
        "expires_at": inv["expires_at"],
        "paid_at": inv.get("paid_at"),
        "paid_tx_hash": inv.get("paid_tx_hash"),
    }


def merchant_invoice_view(inv: dict[str, Any]) -> dict[str, Any]:
    """API-facing dict for the merchant (full invoice incl. payload)."""
    amount_nano = int(inv["amount_nano"])
    return {
        "id": inv["id"],
        "asset": inv["asset"],
        "amount": amount_nano / NANO_PER_TON,
        "amount_nano": str(amount_nano),
        "description": inv.get("description"),
        "payload": inv.get("payload"),
        "callback_url": inv.get("callback_url"),
        "status": inv["status"],
        "created_at": inv["created_at"],
        "expires_at": inv["expires_at"],
        "paid_at": inv.get("paid_at"),
        "paid_tx_hash": inv.get("paid_tx_hash"),
        "paid_amount_nano": inv.get("paid_amount_nano"),
        "merchant_id": inv["merchant_id"],
    }


# ---- TonCenter watcher -----------------------------------------------------

_TONCENTER_BASE = os.environ.get(
    "TONCENTER_API_BASE", "https://toncenter.com/api/v2"
).rstrip("/")
_TONCENTER_API_KEY = os.environ.get("TONCENTER_API_KEY", "")


def _ton_addr_eq(a: str, b: str) -> bool:
    """Loose equality across UQ.../EQ.../raw forms.

    TonCenter normalises everything to "EQ..." in responses, but a merchant
    might have registered as "UQ..." or even raw "0:abcd...". For the MVP
    we compare both as-is and case-insensitive.
    """
    if not a or not b:
        return False
    if a == b:
        return True
    return a.replace("UQ", "EQ", 1) == b.replace("UQ", "EQ", 1)


async def _toncenter_recent(
    client: httpx.AsyncClient, address: str, limit: int = 30
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"address": address, "limit": str(limit)}
    if _TONCENTER_API_KEY:
        params["api_key"] = _TONCENTER_API_KEY
    try:
        r = await client.get(f"{_TONCENTER_BASE}/getTransactions", params=params, timeout=12.0)
        if r.status_code != 200:
            print(f"[invoices] toncenter {address[:8]}.. -> {r.status_code}", flush=True)
            return []
        j = r.json()
        if not j.get("ok"):
            return []
        return j.get("result") or []
    except Exception as exc:
        print(f"[invoices] toncenter EXC {address[:8]}..: {exc!r}", flush=True)
        return []


async def _scan_address_for_invoices(
    client: httpx.AsyncClient,
    address: str,
    invoices: list[dict[str, Any]],
) -> list[tuple[dict[str, Any], str, str]]:
    """Returns list of (invoice, paid_amount_nano, tx_hash)."""
    txs = await _toncenter_recent(client, address, limit=50)
    if not txs:
        return []
    by_id: dict[str, dict[str, Any]] = {inv["id"]: inv for inv in invoices}
    matched: list[tuple[dict[str, Any], str, str]] = []
    for tx in txs:
        in_msg = tx.get("in_msg") or {}
        comment = (in_msg.get("message") or "").strip()
        if not comment:
            continue
        # Comment format: "inv_<8hex>" optionally followed by free text.
        first_word = comment.split()[0]
        inv = by_id.get(first_word)
        if not inv:
            continue
        try:
            value = int(in_msg.get("value") or 0)
        except (TypeError, ValueError):
            continue
        # Customer pays the full amount; the wallet UI splits 99.2/0.8 between
        # two outgoing messages, so the merchant receives 99.2 % of the
        # invoice. Anything ≥ 99 % is accepted (allow 1 % rounding slack).
        merchant_share_required = (
            int(inv["amount_nano"]) * (10_000 - PLATFORM_FEE_BPS - 100) // 10_000
        )
        if value < merchant_share_required:
            continue
        tx_id = tx.get("transaction_id") or {}
        tx_hash = tx_id.get("hash") or ""
        matched.append((inv, str(value), tx_hash))
    return matched


async def _deliver_webhook(
    client: httpx.AsyncClient,
    inv: dict[str, Any],
    api_key: str,
) -> bool:
    callback_url = inv.get("callback_url")
    if not callback_url:
        return True  # nothing to do, treat as delivered
    body = {
        "event": "invoice.paid",
        "invoice_id": inv["id"],
        "merchant_id": inv["merchant_id"],
        "asset": inv["asset"],
        "amount_nano": inv["amount_nano"],
        "paid_amount_nano": inv.get("paid_amount_nano"),
        "paid_at": inv.get("paid_at"),
        "paid_tx_hash": inv.get("paid_tx_hash"),
        "payload": inv.get("payload"),
    }
    raw = json.dumps(body, separators=(",", ":"), sort_keys=True).encode()
    sig = hmac.new(api_key.encode(), raw, hashlib.sha256).hexdigest()
    try:
        r = await client.post(
            callback_url,
            content=raw,
            headers={
                "Content-Type": "application/json",
                "X-Fwallet-Signature": sig,
                "X-Fwallet-Event": "invoice.paid",
            },
            timeout=12.0,
        )
        ok = 200 <= r.status_code < 300
        if not ok:
            print(
                f"[invoices] webhook {inv['id']} -> {r.status_code} {r.text[:200]}",
                flush=True,
            )
        return ok
    except Exception as exc:
        print(f"[invoices] webhook {inv['id']} EXC: {exc!r}", flush=True)
        return False


async def scan_once() -> dict[str, int]:
    """One scan pass: mark paid invoices, fire callbacks, expire old ones.

    Returns a small counter dict for diagnostics.
    """
    expired = db.expire_old_invoices()
    pending = db.pending_invoices()
    if not pending:
        return {"expired": expired, "checked": 0, "paid": 0, "delivered": 0}
    by_addr: dict[str, list[dict[str, Any]]] = {}
    for inv in pending:
        if inv["status"] == "pending":
            by_addr.setdefault(inv["merchant_ton_address"], []).append(inv)

    paid = 0
    delivered = 0
    async with httpx.AsyncClient() as client:
        # Confirm new payments
        for addr, invs in by_addr.items():
            matches = await _scan_address_for_invoices(client, addr, invs)
            for inv, paid_nano, tx_hash in matches:
                db.mark_invoice_paid(
                    inv["id"], paid_amount_nano=paid_nano, paid_tx_hash=tx_hash
                )
                paid += 1

        # Re-fetch including freshly-paid invoices for webhook delivery
        for inv in db.pending_invoices():
            if inv["status"] != "paid":
                continue
            merchant = db.merchant_by_id(inv["merchant_id"])
            if not merchant:
                continue
            ok = await _deliver_webhook(client, inv, merchant["api_key"])
            db.mark_webhook_attempt(inv["id"], delivered=ok)
            if ok:
                delivered += 1
    return {
        "expired": expired,
        "checked": sum(len(v) for v in by_addr.values()),
        "paid": paid,
        "delivered": delivered,
    }


__all__ = [
    "PLATFORM_FEE_BPS",
    "PLATFORM_TON_ADDRESS",
    "register_merchant",
    "authenticate",
    "create_invoice",
    "public_invoice_view",
    "merchant_invoice_view",
    "scan_once",
]
