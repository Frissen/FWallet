"""Telegram Mini App ``initData`` verification.

The Mini App sends ``Telegram.WebApp.initData`` in the ``X-Telegram-Init-Data``
header. We validate its HMAC signature with the bot token (see
https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
so API handlers can trust *who* is calling instead of a ``tg_id`` the client
claims in the URL/body.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from fastapi import HTTPException, Request

INIT_DATA_HEADER = "X-Telegram-Init-Data"
# initData is created when the Mini App opens. Reject stale payloads to limit
# replay of a leaked one.
MAX_AGE_SECONDS = 24 * 60 * 60


def verify_init_data(init_data: str, bot_token: str) -> int | None:
    """Return the verified Telegram user id, or None if invalid/expired."""
    if not init_data or not bot_token:
        return None
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    except ValueError:
        return None
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        return None

    check_string = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received_hash):
        return None

    try:
        auth_date = int(pairs.get("auth_date", "0"))
    except ValueError:
        return None
    if auth_date <= 0 or time.time() - auth_date > MAX_AGE_SECONDS:
        return None

    try:
        user = json.loads(pairs.get("user", "{}"))
        uid = int(user["id"])
    except (ValueError, KeyError, TypeError):
        return None
    return uid if uid > 0 else None


def require_user(request: Request, claimed_tg_id: int, bot_token: str) -> int:
    """Raise 401/403 unless the caller proves they are ``claimed_tg_id``."""
    uid = verify_init_data(request.headers.get(INIT_DATA_HEADER, ""), bot_token)
    if uid is None:
        raise HTTPException(status_code=401, detail="Open Fwallet inside Telegram")
    if uid != int(claimed_tg_id):
        raise HTTPException(status_code=403, detail="tg_id does not match session")
    return uid
