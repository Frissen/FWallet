// Lightweight client-side price feed.
//
// We fetch quotes from OKX (no auth, no rate limit issues from browser) and
// — for fiat conversion — from open.er-api.com. Results are cached in
// memory for a minute so the wallet UI doesn't hammer the network on every
// re-render.

export type Symbol = 'TON' | 'BTC' | 'ETH' | 'BNB' | 'SOL' | 'USDT' | 'USDC'

export interface Quote {
  symbol: Symbol
  /** Spot price quoted in USD (or USDT, treated equivalently). */
  priceUsd: number
  /** 24h change as a fraction. 0.05 means +5%. */
  change24h: number
}

export interface PriceFeed {
  quotes: Record<Symbol, Quote>
  /** Cross-rate from USD to the user's preferred fiat currency. */
  fiatRate: number
  fiat: string
}

interface CacheEntry {
  ts: number
  data: PriceFeed
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, CacheEntry>()

const SYMBOLS: Symbol[] = ['TON', 'BTC', 'ETH', 'BNB', 'SOL', 'USDT', 'USDC']

async function fetchOkxQuote(symbol: Symbol): Promise<Quote | null> {
  // OKX quotes USDT and USDC against USDT itself which would be a no-op;
  // pin them to $1.0 — close enough for wallet UI, and saves the request.
  if (symbol === 'USDT' || symbol === 'USDC') {
    return { symbol, priceUsd: 1, change24h: 0 }
  }
  try {
    const r = await fetch(
      `https://www.okx.com/api/v5/market/ticker?instId=${symbol}-USDT`,
    )
    if (!r.ok) return null
    const j = (await r.json()) as {
      data?: { last?: string; open24h?: string }[]
    }
    const row = j.data?.[0]
    if (!row?.last || !row?.open24h) return null
    const last = Number(row.last)
    const open = Number(row.open24h)
    if (!Number.isFinite(last) || !Number.isFinite(open) || open === 0) {
      return null
    }
    return { symbol, priceUsd: last, change24h: (last - open) / open }
  } catch {
    return null
  }
}

async function fetchFiatRate(fiat: string): Promise<number> {
  if (fiat === 'USD') return 1
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/USD`)
    if (!r.ok) return 1
    const j = (await r.json()) as { rates?: Record<string, number> }
    const rate = j.rates?.[fiat]
    return Number.isFinite(rate) && rate ? Number(rate) : 1
  } catch {
    return 1
  }
}

export async function getPriceFeed(fiat = 'RUB'): Promise<PriceFeed> {
  const key = fiat.toUpperCase()
  const hit = cache.get(key)
  const now = Date.now()
  if (hit && now - hit.ts < CACHE_TTL_MS) return hit.data

  const [quotes, fiatRate] = await Promise.all([
    Promise.all(SYMBOLS.map(fetchOkxQuote)),
    fetchFiatRate(key),
  ])
  const map = {} as Record<Symbol, Quote>
  for (const q of quotes) {
    if (q) map[q.symbol] = q
  }
  // Fallbacks so the UI doesn't crash if a particular ticker is unavailable.
  for (const s of SYMBOLS) {
    if (!map[s]) map[s] = { symbol: s, priceUsd: 0, change24h: 0 }
  }
  const data: PriceFeed = { quotes: map, fiatRate, fiat: key }
  cache.set(key, { ts: now, data })
  return data
}

export function formatFiat(amount: number, fiat: string): string {
  const formatter = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const symbol = fiat === 'RUB' ? '₽' : fiat === 'USD' ? '$' : fiat
  const sym = fiat === 'RUB' || fiat === 'USD' ? symbol : symbol + ' '
  return `${sym}${formatter.format(amount)}`
}

export function formatChange(change: number): { text: string; positive: boolean } {
  const positive = change >= 0
  const pct = (Math.abs(change) * 100).toFixed(2)
  return { text: `${positive ? '+' : '−'}${pct}%`, positive }
}
