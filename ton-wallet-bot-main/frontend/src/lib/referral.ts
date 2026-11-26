// Referral system: based on Telegram user_id (NOT a wallet address).
//
// Flow:
//   1. New user opens the wallet via `t.me/<bot>?start=ref_<TG_ID>`
//      (or browser ?ref=<TG_ID>). We save the referrer's TG ID locally.
//   2. On wallet creation/unlock, we POST our own TG ID + per-chain addresses
//      to the bot backend so other users can resolve us by TG ID.
//   3. On every Send, the wallet asks the bot for the referrer's address on
//      the current chain and routes 0.5% there as a separate message.
//   4. If the referrer hasn't registered (no address for that chain), the
//      0.5% rolls back into the main service fee.

import {
  STORAGE_KEY_REFERRER,
  LEGACY_STORAGE_KEYS,
  P2P_API_BASE,
  BOT_USERNAME,
} from './config'
import { authHeaders } from './telegram'

const STORAGE_KEY_TG_ID = 'fwallet:tg_id:v1'
// Re-register on every wallet unlock. Backend is idempotent and the call is
// cheap (~50ms), and this protects us against the bot losing its registry
// (e.g. after a redeploy of the volume).

interface TelegramInitDataUnsafe {
  start_param?: string
  user?: { id?: number; username?: string }
}

function getTelegramWebApp(): { initDataUnsafe?: TelegramInitDataUnsafe } | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: TelegramInitDataUnsafe } } })
    .Telegram?.WebApp
}

function isValidTgId(s: string): boolean {
  return /^\d{4,15}$/.test(s)
}

/** Capture our own TG user id (if launched inside Telegram) and the referrer
 * TG id (from start_param or ?ref=). Idempotent. */
export function captureReferrerFromLocation(): void {
  if (typeof window === 'undefined') return

  const tg = getTelegramWebApp()
  // 1) Save own TG id when present.
  const myId = tg?.initDataUnsafe?.user?.id
  if (myId) {
    localStorage.setItem(STORAGE_KEY_TG_ID, String(myId))
  }

  // 2) Capture referrer if we don't already have one.
  if (localStorage.getItem(STORAGE_KEY_REFERRER)) return

  let candidate: string | null = null
  const params = new URLSearchParams(window.location.search)
  const fromQuery = params.get('ref')
  if (fromQuery) candidate = fromQuery

  const startParam = tg?.initDataUnsafe?.start_param
  if (!candidate && startParam?.startsWith('ref_')) {
    candidate = startParam.slice(4)
  }

  if (!candidate || !isValidTgId(candidate)) return
  // Don't self-refer.
  if (myId && String(myId) === candidate) return
  localStorage.setItem(STORAGE_KEY_REFERRER, candidate)
}

export function getStoredReferrerTgId(): string | null {
  if (typeof window === 'undefined') return null
  let v = localStorage.getItem(STORAGE_KEY_REFERRER)
  if (!v) {
    // Migrate the pre-Fwallet storage key.
    for (const legacy of LEGACY_STORAGE_KEYS.referrer) {
      const old = localStorage.getItem(legacy)
      if (old) {
        localStorage.setItem(STORAGE_KEY_REFERRER, old)
        v = old
        break
      }
    }
  }
  if (!v || !isValidTgId(v)) return null
  return v
}

export function getMyTgId(): string | null {
  if (typeof window === 'undefined') return null
  const v = localStorage.getItem(STORAGE_KEY_TG_ID)
  return v && isValidTgId(v) ? v : null
}

export function clearReferrer(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY_REFERRER)
}

export function buildReferralLink(myTgId: string): string {
  return `https://t.me/${BOT_USERNAME}?start=ref_${myTgId}`
}

// ---------------------------------------------------------------------------
// Backend registration / lookup
// ---------------------------------------------------------------------------

export interface AddressBundle {
  ton_address?: string
  eth_address?: string
  bsc_address?: string
  sol_address?: string
  btc_address?: string
}

/** POST our addresses to the bot for referral lookup. Idempotent — safe to
 * call on every Dashboard mount; the backend just overwrites the existing
 * row. */
export async function registerAddresses(addresses: AddressBundle): Promise<void> {
  const tgId = getMyTgId()
  if (!tgId) return // not running inside Telegram
  try {
    await fetch(`${P2P_API_BASE}/referral/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ tg_id: Number(tgId), ...addresses }),
    })
  } catch {
    // ignore — non-critical
  }
}

export type ReferralChain = 'ton' | 'eth' | 'bsc' | 'sol' | 'btc'

/** Look up the referrer's wallet address for the given chain. Returns null
 * when no referrer is set, or when the referrer hasn't registered an
 * address for this chain — in that case the rebate folds back into the
 * service fee. */
export async function lookupReferrerAddress(
  chain: ReferralChain,
): Promise<string | null> {
  const tgId = getStoredReferrerTgId()
  if (!tgId) return null
  try {
    const r = await fetch(`${P2P_API_BASE}/referral/lookup/${tgId}?chain=${chain}`)
    if (!r.ok) return null
    const j = (await r.json()) as { address?: string }
    return j.address ?? null
  } catch {
    return null
  }
}
