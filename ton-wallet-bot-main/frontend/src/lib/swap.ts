// Cross-chain swap support via ChangeNOW.
//
// ChangeNOW takes crypto in at one address and sends crypto out at the
// destination address. They briefly custody funds during the swap, which is
// the standard trade-off for non-KYC fixed-rate swaps. We add our own
// service fee on top of their published rate by quoting fromAmount and
// then deducting our cut before showing the user the final to-amount.

import { COMMISSION_RATES, BPS_DENOMINATOR } from './config'

// Swaps use the dedicated 'swap' commission split: total 3.05%, of which
// 0.05% is credited to the referrer's virtual ledger.
const SWAP_TOTAL_BPS = COMMISSION_RATES.swap.totalBps
export const SWAP_REFERRAL_BPS = COMMISSION_RATES.swap.referralBps

const CHANGENOW_API = 'https://api.changenow.io/v2'
const CHANGENOW_API_KEY: string = import.meta.env.VITE_CHANGENOW_API_KEY ?? ''

export interface SwapPair {
  from: string // ticker
  to: string
  fromNetwork?: string
  toNetwork?: string
}

// ChangeNOW disambiguates same-symbol stables by `network`, not by ticker —
// e.g. USDT-ERC20 is `usdt`+`eth`, USDT-BEP20 is `usdt`+`bsc`. Same for USDC.
export const SUPPORTED_FROM = [
  { ticker: 'ton', label: 'TON', network: 'ton' },
  { ticker: 'eth', label: 'ETH', network: 'eth' },
  { ticker: 'usdt', label: 'USDT (ERC-20)', network: 'eth' },
  { ticker: 'usdc', label: 'USDC (ERC-20)', network: 'eth' },
  { ticker: 'bnb', label: 'BNB (BSC)', network: 'bsc' },
  { ticker: 'usdt', label: 'USDT (BEP-20)', network: 'bsc' },
  { ticker: 'sol', label: 'SOL', network: 'sol' },
  { ticker: 'usdc', label: 'USDC (SPL)', network: 'sol' },
  { ticker: 'btc', label: 'BTC', network: 'btc' },
] as const

export interface QuoteResult {
  fromAmount: string
  toAmount: string // after deducting our fee
  toAmountGross: string
  serviceFee: string
  feePercent: string
  rateId?: string
  minAmount: number
  maxAmount: number
  estimatedTime: string
}

interface ChangeNowEstimate {
  fromAmount: number
  toAmount: number
  rateId?: string
  fromCurrency: string
  toCurrency: string
  estimatedAmount?: number
  transactionSpeedForecast?: string
}

interface ChangeNowMinMax {
  minAmount: number
  maxAmount: number | null
}

/** Get a quote for a swap. Returns the toAmount AFTER deducting our service
 * fee from the gross ChangeNOW estimate. */
export async function getSwapQuote(
  pair: SwapPair,
  fromAmount: string,
): Promise<QuoteResult> {
  if (!CHANGENOW_API_KEY) {
    throw new Error(
      'Свапы временно недоступны: не настроен ключ агрегатора (VITE_CHANGENOW_API_KEY).',
    )
  }

  const params = new URLSearchParams({
    fromCurrency: pair.from,
    toCurrency: pair.to,
    fromAmount,
    flow: 'standard',
  })
  if (pair.fromNetwork) params.set('fromNetwork', pair.fromNetwork)
  if (pair.toNetwork) params.set('toNetwork', pair.toNetwork)

  const headers = { 'x-changenow-api-key': CHANGENOW_API_KEY }
  const [estResp, rangeResp] = await Promise.all([
    fetch(`${CHANGENOW_API}/exchange/estimated-amount?${params.toString()}`, {
      headers,
    }),
    fetch(
      `${CHANGENOW_API}/exchange/min-amount?${new URLSearchParams({
        fromCurrency: pair.from,
        toCurrency: pair.to,
        ...(pair.fromNetwork ? { fromNetwork: pair.fromNetwork } : {}),
        ...(pair.toNetwork ? { toNetwork: pair.toNetwork } : {}),
      }).toString()}`,
      { headers },
    ),
  ])
  if (!estResp.ok) {
    const t = await estResp.text().catch(() => '')
    throw new Error(`Ошибка котировки: ${estResp.status} ${t}`)
  }
  const est = (await estResp.json()) as ChangeNowEstimate
  let range: ChangeNowMinMax = { minAmount: 0, maxAmount: null }
  if (rangeResp.ok) {
    range = (await rangeResp.json()) as ChangeNowMinMax
  }

  const grossOut = est.toAmount ?? est.estimatedAmount ?? 0
  const fee = (grossOut * SWAP_TOTAL_BPS) / BPS_DENOMINATOR
  const netOut = Math.max(0, grossOut - fee)

  return {
    fromAmount,
    toAmount: netOut.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''),
    toAmountGross: grossOut.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''),
    serviceFee: fee.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''),
    feePercent: (SWAP_TOTAL_BPS / 100).toFixed(2),
    rateId: est.rateId,
    minAmount: range.minAmount,
    maxAmount: range.maxAmount ?? 0,
    estimatedTime: est.transactionSpeedForecast ?? '—',
  }
}

export interface CreatedSwap {
  id: string
  payinAddress: string
  payinAmount: string
  payoutAddress: string
  expectedAmount: string
}

/** Create a swap transaction. Returns the deposit address the user should
 * send crypto to. */
export async function createSwap(params: {
  pair: SwapPair
  fromAmount: string
  payoutAddress: string
  rateId?: string
}): Promise<CreatedSwap> {
  if (!CHANGENOW_API_KEY) throw new Error('Свапы временно недоступны')
  const body = {
    fromCurrency: params.pair.from,
    toCurrency: params.pair.to,
    fromNetwork: params.pair.fromNetwork,
    toNetwork: params.pair.toNetwork,
    fromAmount: params.fromAmount,
    address: params.payoutAddress,
    flow: 'standard',
    type: 'direct',
    rateId: params.rateId,
  }
  const r = await fetch(`${CHANGENOW_API}/exchange`, {
    method: 'POST',
    headers: {
      'x-changenow-api-key': CHANGENOW_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error(`Не удалось создать свап: ${r.status} ${t}`)
  }
  const j = (await r.json()) as {
    id: string
    payinAddress: string
    payinAmount: string
    payoutAddress: string
    expectedAmount?: string
    toAmount?: string
  }
  return {
    id: j.id,
    payinAddress: j.payinAddress,
    payinAmount: j.payinAmount,
    payoutAddress: j.payoutAddress,
    expectedAmount: j.expectedAmount ?? j.toAmount ?? '0',
  }
}
