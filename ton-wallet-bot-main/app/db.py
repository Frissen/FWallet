"""SQLite storage for the merchant/invoice subsystem.

We deliberately keep this small and synchronous — it is called from inside
async request handlers via `to_thread.run_sync` (or via the simple wrappers
below that are themselves fast-enough to run inline).

Persistence note: on Render free tier we do NOT have a persistent disk.
The DB lives at `/tmp/fwallet-bot/invoices.db` and will be wiped on every
redeploy. For MVP this is acceptable: paid invoices have already triggered
their webhook before redeploy, and merchants can recreate any pending
invoices. When we move off free-tier we can swap this module for a Postgres
adapter without touching call sites.
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any


_DATA_DIR = Path(os.environ.get("DATA_DIR", "/tmp/fwallet-bot"))
_DATA_DIR.mkdir(parents=True, exist_ok=True)
_DB_PATH = _DATA_DIR / "invoices.db"

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    c = sqlite3.connect(str(_DB_PATH), check_same_thread=False, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA foreign_keys=ON")
    _conn = c
    _migrate(c)
    return c


def _migrate(c: sqlite3.Connection) -> None:
    c.executescript("""
        CREATE TABLE IF NOT EXISTS merchants (
            id            TEXT PRIMARY KEY,
            api_key       TEXT NOT NULL UNIQUE,
            tg_user_id    INTEGER UNIQUE NOT NULL,
            ton_address   TEXT NOT NULL,
            name          TEXT,
            created_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_merchants_tg ON merchants(tg_user_id);

        CREATE TABLE IF NOT EXISTS invoices (
            id                   TEXT PRIMARY KEY,
            merchant_id          TEXT NOT NULL,
            asset                TEXT NOT NULL,
            amount_nano          TEXT NOT NULL,
            description          TEXT,
            payload              TEXT,
            callback_url         TEXT,
            status               TEXT NOT NULL,
            created_at           INTEGER NOT NULL,
            expires_at           INTEGER NOT NULL,
            paid_at              INTEGER,
            paid_tx_hash         TEXT,
            paid_amount_nano     TEXT,
            webhook_attempts     INTEGER NOT NULL DEFAULT 0,
            webhook_delivered_at INTEGER,
            FOREIGN KEY (merchant_id) REFERENCES merchants(id)
        );
        CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status);
        CREATE INDEX IF NOT EXISTS idx_invoices_merchant ON invoices(merchant_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_created  ON invoices(created_at);
    """)


# ---- Merchants -------------------------------------------------------------


def merchant_by_tg(tg_user_id: int) -> dict[str, Any] | None:
    c = _connect()
    with _lock:
        row = c.execute(
            "SELECT * FROM merchants WHERE tg_user_id = ?", (tg_user_id,)
        ).fetchone()
    return dict(row) if row else None


def merchant_by_id(merchant_id: str) -> dict[str, Any] | None:
    c = _connect()
    with _lock:
        row = c.execute(
            "SELECT * FROM merchants WHERE id = ?", (merchant_id,)
        ).fetchone()
    return dict(row) if row else None


def merchant_by_api_key(api_key: str) -> dict[str, Any] | None:
    c = _connect()
    with _lock:
        row = c.execute(
            "SELECT * FROM merchants WHERE api_key = ?", (api_key,)
        ).fetchone()
    return dict(row) if row else None


def create_merchant(
    *,
    merchant_id: str,
    api_key: str,
    tg_user_id: int,
    ton_address: str,
    name: str | None = None,
) -> None:
    c = _connect()
    with _lock:
        c.execute(
            "INSERT INTO merchants (id, api_key, tg_user_id, ton_address, name, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (merchant_id, api_key, tg_user_id, ton_address, name, int(time.time())),
        )


def update_merchant_address(tg_user_id: int, ton_address: str) -> None:
    c = _connect()
    with _lock:
        c.execute(
            "UPDATE merchants SET ton_address = ? WHERE tg_user_id = ?",
            (ton_address, tg_user_id),
        )


def update_merchant_api_key(tg_user_id: int, api_key: str) -> None:
    c = _connect()
    with _lock:
        c.execute(
            "UPDATE merchants SET api_key = ? WHERE tg_user_id = ?",
            (api_key, tg_user_id),
        )


# ---- Invoices --------------------------------------------------------------


def create_invoice(
    *,
    invoice_id: str,
    merchant_id: str,
    asset: str,
    amount_nano: str,
    description: str | None,
    payload: str | None,
    callback_url: str | None,
    expires_at: int,
) -> None:
    c = _connect()
    with _lock:
        c.execute(
            "INSERT INTO invoices "
            "(id, merchant_id, asset, amount_nano, description, payload, "
            " callback_url, status, created_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
            (
                invoice_id,
                merchant_id,
                asset,
                amount_nano,
                description,
                payload,
                callback_url,
                int(time.time()),
                expires_at,
            ),
        )


def invoice_by_id(invoice_id: str) -> dict[str, Any] | None:
    c = _connect()
    with _lock:
        row = c.execute(
            "SELECT i.*, m.ton_address AS merchant_ton_address, m.name AS merchant_name "
            "FROM invoices i JOIN merchants m ON m.id = i.merchant_id "
            "WHERE i.id = ?",
            (invoice_id,),
        ).fetchone()
    return dict(row) if row else None


def list_invoices_by_merchant(
    merchant_id: str, *, limit: int = 100
) -> list[dict[str, Any]]:
    c = _connect()
    with _lock:
        rows = c.execute(
            "SELECT * FROM invoices WHERE merchant_id = ? "
            "ORDER BY created_at DESC LIMIT ?",
            (merchant_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def pending_invoices() -> list[dict[str, Any]]:
    """All invoices waiting for payment (or for webhook retry)."""
    c = _connect()
    now = int(time.time())
    with _lock:
        # Status 'pending' with not-yet-expired, OR status 'paid' but webhook
        # not yet delivered (so we keep retrying delivery).
        rows = c.execute(
            "SELECT i.*, m.ton_address AS merchant_ton_address "
            "FROM invoices i JOIN merchants m ON m.id = i.merchant_id "
            "WHERE (i.status = 'pending' AND i.expires_at > ?) "
            "   OR (i.status = 'paid' AND i.webhook_delivered_at IS NULL "
            "        AND i.callback_url IS NOT NULL "
            "        AND i.webhook_attempts < 6)",
            (now,),
        ).fetchall()
    return [dict(r) for r in rows]


def mark_invoice_paid(
    invoice_id: str, *, paid_amount_nano: str, paid_tx_hash: str
) -> None:
    c = _connect()
    with _lock:
        c.execute(
            "UPDATE invoices SET status = 'paid', paid_at = ?, "
            "paid_amount_nano = ?, paid_tx_hash = ? "
            "WHERE id = ? AND status = 'pending'",
            (int(time.time()), paid_amount_nano, paid_tx_hash, invoice_id),
        )


def mark_webhook_attempt(invoice_id: str, *, delivered: bool) -> None:
    c = _connect()
    now = int(time.time())
    with _lock:
        if delivered:
            c.execute(
                "UPDATE invoices SET webhook_attempts = webhook_attempts + 1, "
                "webhook_delivered_at = ? WHERE id = ?",
                (now, invoice_id),
            )
        else:
            c.execute(
                "UPDATE invoices SET webhook_attempts = webhook_attempts + 1 "
                "WHERE id = ?",
                (invoice_id,),
            )


def expire_old_invoices() -> int:
    c = _connect()
    now = int(time.time())
    with _lock:
        cur = c.execute(
            "UPDATE invoices SET status = 'expired' "
            "WHERE status = 'pending' AND expires_at <= ?",
            (now,),
        )
        return cur.rowcount


__all__ = [
    "merchant_by_tg",
    "merchant_by_id",
    "merchant_by_api_key",
    "create_merchant",
    "update_merchant_address",
    "update_merchant_api_key",
    "create_invoice",
    "invoice_by_id",
    "list_invoices_by_merchant",
    "pending_invoices",
    "mark_invoice_paid",
    "mark_webhook_attempt",
    "expire_old_invoices",
]
