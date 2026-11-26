# Fwallet — frontend (Telegram Mini App)

Non-custodial multi-chain wallet (TON, BTC, ETH/BNB, SOL) that runs as a Telegram Mini App.

- **Keys stay on the device.** The 24-word seed is generated in the browser and encrypted with a 6-digit PIN (AES-GCM, PBKDF2 600k).
- **Bound to the Telegram account.** The PIN-encrypted vault is mirrored to Telegram CloudStorage, so the same account finds the wallet on another device and only asks for the PIN. The seed itself is never uploaded in plaintext. The cloud copy can be removed in Settings.
- **Seed backup after creation.** Creating a wallet only needs a PIN; a banner then asks the user to save the seed (Settings → Seed-фраза at any time).

## Run

```bash
npm install
npm run dev
npm run build
```

## Environment (`.env.production` / Vite env)

| Variable | Purpose |
| --- | --- |
| `VITE_BOT_USERNAME` | username of the Fwallet bot, without `@` (default `FwalletBot`) |
| `VITE_MINIAPP_SHORTNAME` | Mini App short name from @BotFather (default `Wallet`) |
| `VITE_APP_BASE_URL` | public URL of the deployed Mini App |
| `VITE_P2P_API_BASE` | URL of the Fwallet bot backend |
| `VITE_TONCENTER_API_KEY` | TON Center API key |
| `VITE_CHANGENOW_API_KEY` | ChangeNOW key for swaps |

Anything prefixed `VITE_` is embedded in the public JS bundle — never put a secret there.

## Storage

The encrypted vault lives in `localStorage` under `fwallet:vault:v1` (old `ton-wallet:vault:v1` is migrated automatically) and in Telegram CloudStorage under `fwallet_vault_v1`.
