// Service commission settings.
// Total fee on every outgoing TON / Jetton transfer. The fee is shown
// transparently to the user in the send-confirmation UI before they sign.
export const COMMISSION_ADDRESS =
  'UQABzjR08FCqluFyBlW2kYPUSDdeYD1LGq5t0iHojJGnHnQU'

// Total commission, in basis points (1 bp = 0.01%). Different contexts use
// different rates — see COMMISSION_RATES below.
export const COMMISSION_BPS = 350 // legacy, equals SEND total (3.50%)

// Out of the SEND total, this much goes to the referrer (if any). The remainder
// goes to the main commission address. With no referrer, all goes to the main.
export const REFERRAL_BPS = 50 // legacy, equals SEND referral cut (0.50%)

export const BPS_DENOMINATOR = 10_000

/** Per-context commission breakdown.
 *
 * `total` is what the user pays on top of the principal. `referral` is the
 * portion of `total` virtually credited to the referrer (if any). The rest
 * goes to the operator's commission address.
 *
 * P2P transactions get a discount because the user is moving value
 * earned through hard work elsewhere; swaps are smaller transactions
 * with a thinner referral cut.
 */
export type CommissionContext = 'send' | 'p2p' | 'swap'
export const COMMISSION_RATES: Record<
  CommissionContext,
  { totalBps: number; referralBps: number }
> = {
  send: { totalBps: 350, referralBps: 50 }, // 3.50% / 0.50%
  p2p:  { totalBps: 260, referralBps: 30 }, // 2.60% / 0.30%
  swap: { totalBps: 305, referralBps: 5  }, // 3.05% / 0.05%
}

// Cheques: 1% fee charged when issuing a cheque. The fee is paid out of the
// face value of the cheque itself: cheques amount = X, sender pays X + 1% +
// gas, the recipient receives X (after gas), and the 1% goes to the main
// commission address as a separate visible message.
export const CHEQUE_FEE_BPS = 100 // 1.00%

// TON Center API. With a free API key from @tonapibot the limit is ~10 req/s;
// without one it's ~1 req/s and you'll hit HTTP 429 quickly.
export const TONCENTER_ENDPOINT = 'https://toncenter.com/api/v2/jsonRPC'
export const TONCENTER_REST_BASE = 'https://toncenter.com/api/v2'
export const TONCENTER_API_KEY: string =
  import.meta.env.VITE_TONCENTER_API_KEY ?? ''

// How long to cache balance / tx-history responses in memory before re-fetching.
export const READ_CACHE_TTL_MS = 8_000

// Storage keys (pre-Fwallet keys are migrated on first load, see storage.ts)
export const STORAGE_KEY_VAULT = 'fwallet:vault:v1'
export const STORAGE_KEY_REFERRER = 'fwallet:referrer:v1'
export const LEGACY_STORAGE_KEYS = {
  vault: ['ton-wallet:vault:v1'],
  referrer: ['ton-wallet:referrer:v1'],
}

// P2P board backend
export const P2P_API_BASE: string =
  import.meta.env.VITE_P2P_API_BASE ?? 'https://ton-wallet-bot-vgur.onrender.com'

// Telegram bot used for cheques + referral links. Set VITE_BOT_USERNAME to the
// real @username of your Fwallet bot (without the @) and VITE_MINIAPP_SHORTNAME
// to the Mini App short name registered in @BotFather.
export const BOT_USERNAME: string =
  import.meta.env.VITE_BOT_USERNAME ?? 'FwalletBot'
export const MINIAPP_SHORTNAME: string =
  import.meta.env.VITE_MINIAPP_SHORTNAME ?? 'Wallet'
export const BOT_DEEPLINK_BASE = `https://t.me/${BOT_USERNAME}`
export const APP_BASE_URL: string =
  import.meta.env.VITE_APP_BASE_URL ?? 'https://dist-lbgvezwb.devinapps.com'

export const APP_NAME = 'Fwallet'
