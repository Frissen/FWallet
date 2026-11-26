// P2P trust-based board, orchestrated through the @FwalletBot bot.
//
// The bot stores ads, opens deals between two TG accounts (anonymous —
// neither party sees the other's @username), forwards messages between them
// and tracks the deal lifecycle (open → fiat_paid → crypto_sent → done) with
// a 2-minute auto-release timer after the seller marks crypto sent.

import { P2P_API_BASE } from './config'
import { authHeaders } from './telegram'

export type AdSide = 'buy' | 'sell'
export type AdAsset =
  | 'TON'
  | 'ETH'
  | 'BNB'
  | 'SOL'
  | 'BTC'
  | 'USDT-ERC20'
  | 'USDC-ERC20'
export type AdCurrency = 'RUB' | 'USD' | 'EUR' | 'UAH' | 'KZT'

/** Banks / payment methods accepted by the bot. Must match NewAd.payment_method. */
export const PAYMENT_METHODS = [
  'Тинькофф',
  'Сбербанк',
  'Альфа-Банк',
  'ВТБ',
  'Райффайзен',
  'Газпромбанк',
  'Открытие',
  'СБП',
  'Другой',
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export interface P2PAd {
  id: string
  created_at: string
  side: AdSide
  asset: AdAsset
  currency: AdCurrency
  price: number
  min_amount: number
  max_amount: number
  payment_method: PaymentMethod
  /** Card number / SBP phone — only revealed inside an open deal. */
  payment_details?: string | null
  note?: string | null
}

export interface NewP2PAd {
  creator_tg_id: number
  side: AdSide
  asset: AdAsset
  currency: AdCurrency
  price: number
  min_amount: number
  max_amount: number
  payment_method: PaymentMethod
  payment_details: string
  note?: string
}

export type DealStatus =
  | 'open'
  | 'fiat_paid'
  | 'crypto_sent'
  | 'done'
  | 'cancelled'
  | 'expired'

export interface DealMessage {
  from_role: 'buyer' | 'seller'
  text: string
  at: string
  from_me?: boolean
}

export interface P2PDeal {
  id: string
  ad_id: string
  asset: AdAsset
  side: AdSide
  currency: AdCurrency
  price: number
  amount: number
  payment_method: PaymentMethod
  payment_details?: string | null
  status: DealStatus
  created_at: string
  fiat_paid_at?: string
  crypto_sent_at?: string
  done_at?: string
  auto_release_at?: number // unix seconds
  my_role?: 'buyer' | 'seller' | 'observer'
  buyer_address?: string | null
  messages: DealMessage[]
}

export async function listAds(filter: {
  side?: AdSide
  asset?: AdAsset
  currency?: AdCurrency
}): Promise<P2PAd[]> {
  const params = new URLSearchParams()
  if (filter.side) params.set('side', filter.side)
  if (filter.asset) params.set('asset', filter.asset)
  if (filter.currency) params.set('currency', filter.currency)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const r = await fetch(`${P2P_API_BASE}/p2p/ads${qs}`)
  if (!r.ok) throw new Error(`Сервер вернул ${r.status}`)
  return (await r.json()) as P2PAd[]
}

export async function listMyAds(tgId: number): Promise<P2PAd[]> {
  const r = await fetch(`${P2P_API_BASE}/p2p/ads/mine?tg_id=${tgId}`, {
    headers: authHeaders(),
  })
  if (!r.ok) return []
  return (await r.json()) as P2PAd[]
}

export async function createAd(ad: NewP2PAd): Promise<P2PAd> {
  const r = await fetch(`${P2P_API_BASE}/p2p/ads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(ad),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`Не удалось создать объявление (${r.status}) ${text}`)
  }
  return (await r.json()) as P2PAd
}

export async function deleteAd(id: string, tgId: number): Promise<void> {
  const r = await fetch(
    `${P2P_API_BASE}/p2p/ads/${encodeURIComponent(id)}?tg_id=${tgId}`,
    { method: 'DELETE', headers: authHeaders() },
  )
  if (!r.ok) throw new Error(`Не удалось удалить (${r.status})`)
}

export async function openDeal(params: {
  ad_id: string
  taker_tg_id: number
  amount: number
}): Promise<P2PDeal> {
  const r = await fetch(`${P2P_API_BASE}/p2p/deals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(params),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`Не удалось открыть сделку (${r.status}): ${text}`)
  }
  return (await r.json()) as P2PDeal
}

export async function getDeal(id: string, tgId: number): Promise<P2PDeal> {
  const r = await fetch(`${P2P_API_BASE}/p2p/deals/${id}?tg_id=${tgId}`, {
    headers: authHeaders(),
  })
  if (!r.ok) throw new Error(`Сделка не найдена (${r.status})`)
  return (await r.json()) as P2PDeal
}

export async function listMyDeals(tgId: number): Promise<P2PDeal[]> {
  const r = await fetch(`${P2P_API_BASE}/p2p/deals?tg_id=${tgId}`, {
    headers: authHeaders(),
  })
  if (!r.ok) return []
  return (await r.json()) as P2PDeal[]
}

export type DealActionKind = 'paid' | 'sent' | 'received' | 'cancel'

export async function dealAction(params: {
  deal_id: string
  tg_id: number
  action: DealActionKind
  buyer_address?: string
}): Promise<P2PDeal> {
  const r = await fetch(`${P2P_API_BASE}/p2p/deals/${params.deal_id}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      tg_id: params.tg_id,
      action: params.action,
      buyer_address: params.buyer_address,
    }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`Действие не выполнено (${r.status}): ${text}`)
  }
  return (await r.json()) as P2PDeal
}

export async function postDealMessage(params: {
  deal_id: string
  tg_id: number
  text: string
}): Promise<void> {
  const r = await fetch(`${P2P_API_BASE}/p2p/deals/${params.deal_id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ tg_id: params.tg_id, text: params.text }),
  })
  if (!r.ok) throw new Error(`Сообщение не отправлено (${r.status})`)
}
