# Fwallet

Telegram bot backend + Mini App for **Fwallet**, a non-custodial wallet for TON, BTC, ETH/BNB and SOL.

- `/start`, `/wallet`, `/about` open the Mini App
- `/price <ticker>` returns the current price + a 7-day chart; inline queries (`@<bot> ton rub`) return the same chart
- A small JSON-backed P2P relay (open ads + anonymous deal chat) and a Telegram-id to wallet-address registry for on-chain referral payouts
- Pay-API for merchants (TON invoices)

The bot never holds private keys. The Mini App generates the seed on the device and encrypts it with the user's PIN; the encrypted vault is also mirrored to Telegram CloudStorage so the same Telegram account finds the wallet on another device.

## Run locally

```bash
uv sync
TELEGRAM_BOT_TOKEN=... uvicorn app.main:app --reload
```

Frontend: see `frontend/README.md`.

## Required env (backend)

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | from [@BotFather](https://t.me/BotFather). Also used to verify Mini App `initData` on P2P/referral endpoints |
| `TELEGRAM_WEBHOOK_SECRET` | long random string used in the webhook URL. **Do not leave the default** |
| `WALLET_APP_URL` | https URL of the deployed Mini App |
| `BOT_USERNAME` | bot username without `@` |
| `BOT_PUBLIC_URL` | public URL of this backend |

## API authentication

P2P and referral-registration endpoints require the header `X-Telegram-Init-Data` (the signed `Telegram.WebApp.initData`). The `tg_id` in the URL/body must match the verified user, otherwise the request is rejected with 401/403.
