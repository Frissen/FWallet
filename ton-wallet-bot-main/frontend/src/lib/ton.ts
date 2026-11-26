import { mnemonicNew, mnemonicToPrivateKey, mnemonicValidate } from '@ton/crypto'
import { WalletContractV4, TonClient, internal } from '@ton/ton'
import { Address, toNano, fromNano, SendMode } from '@ton/core'
import {
  COMMISSION_ADDRESS,
  COMMISSION_RATES,
  type CommissionContext,
  BPS_DENOMINATOR,
  TONCENTER_ENDPOINT,
  TONCENTER_REST_BASE,
  TONCENTER_API_KEY,
  READ_CACHE_TTL_MS,
} from './config'
import { getStoredReferrerTgId, lookupReferrerAddress } from './referral'

// Throttle + retry helpers shared by TonClient and direct REST calls. The
// public TON Center endpoint rate-limits aggressively (1 req/s without an API
// key, ~10 req/s with one), so we serialize calls through a single mutex,
// retry on HTTP 429, and cache reads for a few seconds.
let inflight: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = inflight.then(fn, fn)
  inflight = next.catch(() => undefined)
  return next
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const MAX_ATTEMPTS = 5
  let lastErr: unknown = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      const is429 = /429|rate ?limit|too many requests/i.test(msg)
      if (!is429 || attempt === MAX_ATTEMPTS - 1) break
      const backoff = Math.min(8_000, 600 * 2 ** attempt) + Math.random() * 200
      console.warn(`${label}: rate-limited, retrying in ${Math.round(backoff)}ms`)
      await sleep(backoff)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

interface CacheEntry<T> {
  value: T
  expires: number
}
const readCache = new Map<string, CacheEntry<unknown>>()
async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = readCache.get(key) as CacheEntry<T> | undefined
  if (hit && hit.expires > now) return hit.value
  const value = await fetcher()
  readCache.set(key, { value, expires: now + ttlMs })
  return value
}
export function invalidateReadCache(): void {
  readCache.clear()
}

export interface WalletKeys {
  mnemonic: string[]
  publicKey: Buffer
  secretKey: Buffer
  address: string // user-friendly, non-bounceable (UQ...)
  rawAddress: string // raw "0:..." form
}

export async function generateNewWallet(): Promise<WalletKeys> {
  const mnemonic = await mnemonicNew(24)
  return await walletFromMnemonic(mnemonic)
}

export async function walletFromMnemonic(mnemonic: string[]): Promise<WalletKeys> {
  const valid = await mnemonicValidate(mnemonic)
  if (!valid) {
    throw new Error('Invalid mnemonic')
  }
  const keyPair = await mnemonicToPrivateKey(mnemonic)
  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  })
  return {
    mnemonic,
    publicKey: keyPair.publicKey,
    secretKey: keyPair.secretKey,
    address: wallet.address.toString({ bounceable: false, urlSafe: true }),
    rawAddress: wallet.address.toRawString(),
  }
}

export function getClient(): TonClient {
  return new TonClient({
    endpoint: TONCENTER_ENDPOINT,
    apiKey: TONCENTER_API_KEY || undefined,
  })
}

export async function getBalance(address: string): Promise<bigint> {
  const cacheKey = `balance:${address}`
  return cached(cacheKey, READ_CACHE_TTL_MS, () =>
    withRetry(
      () =>
        serialize(async () => {
          const client = getClient()
          return await client.getBalance(Address.parse(address))
        }),
      'getBalance',
    ),
  )
}

export interface CommissionBreakdown {
  amountNano: bigint
  feeNano: bigint // total (service + referral)
  serviceFeeNano: bigint // goes to COMMISSION_ADDRESS
  referralFeeNano: bigint // goes to referrer (zero if none)
  totalNano: bigint
  amountTon: string
  feeTon: string
  serviceFeeTon: string
  referralFeeTon: string
  totalTon: string
  feePercent: string
  referrer: string | null // TG ID of the referrer when set
}

export function computeCommission(
  amountTon: string,
  ctx: CommissionContext = 'send',
): CommissionBreakdown {
  const rate = COMMISSION_RATES[ctx]
  const amountNano = toNano(amountTon)
  const feeNano = (amountNano * BigInt(rate.totalBps)) / BigInt(BPS_DENOMINATOR)
  const referrer = getStoredReferrerTgId()
  const referralFeeNano = referrer
    ? (amountNano * BigInt(rate.referralBps)) / BigInt(BPS_DENOMINATOR)
    : 0n
  const serviceFeeNano = feeNano - referralFeeNano
  const totalNano = amountNano + feeNano
  return {
    amountNano,
    feeNano,
    serviceFeeNano,
    referralFeeNano,
    totalNano,
    amountTon: fromNano(amountNano),
    feeTon: fromNano(feeNano),
    serviceFeeTon: fromNano(serviceFeeNano),
    referralFeeTon: fromNano(referralFeeNano),
    totalTon: fromNano(totalNano),
    feePercent: (rate.totalBps / 100).toFixed(2),
    referrer,
  }
}

export interface SendParams {
  keys: WalletKeys
  to: string
  amountTon: string
  comment?: string
  /** Commission context: 'send' (default) | 'p2p' | 'swap'. Determines
   *  the fee rate and which ledger context the referral credit lands in. */
  context?: CommissionContext
}

export async function sendTon(params: SendParams): Promise<{ commission: CommissionBreakdown }> {
  const { keys, to, amountTon, comment } = params
  const context: CommissionContext = params.context ?? 'send'

  // Validate destination up-front so we never send the commission half of a
  // failed transfer.
  const destination = Address.parse(to)
  const commissionDestination = Address.parse(COMMISSION_ADDRESS)
  const commission = computeCommission(amountTon, context)

  const client = getClient()
  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keys.publicKey,
  })
  const opened = client.open(wallet)

  const seqno = await withRetry(
    () => serialize(() => opened.getSeqno()),
    'getSeqno',
  )

  const sendMode = SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS

  // On-chain referral rebate: if the referrer has registered a TON address,
  // their cut goes directly to them. Otherwise it folds back into the
  // service fee.
  const referrerAddress =
    commission.referralFeeNano > 0n
      ? await lookupReferrerAddress('ton').catch(() => null)
      : null
  let serviceFeeNano = commission.serviceFeeNano
  let referralFeeNano = commission.referralFeeNano
  if (referralFeeNano > 0n && !referrerAddress) {
    serviceFeeNano = serviceFeeNano + referralFeeNano
    referralFeeNano = 0n
  }

  const messages = [
    internal({
      to: destination,
      value: commission.amountNano,
      bounce: false,
      body: comment || undefined,
    }),
    internal({
      to: commissionDestination,
      value: serviceFeeNano,
      bounce: false,
      body: 'service fee',
    }),
  ]
  if (referralFeeNano > 0n && referrerAddress) {
    try {
      messages.push(
        internal({
          to: Address.parse(referrerAddress),
          value: referralFeeNano,
          bounce: false,
          body: 'referral',
        }),
      )
    } catch {
      // Bad referrer address — fold back into service fee.
      messages[1] = internal({
        to: commissionDestination,
        value: serviceFeeNano + referralFeeNano,
        bounce: false,
        body: 'service fee',
      })
    }
  }

  await withRetry(
    () =>
      serialize(() =>
        opened.sendTransfer({
          seqno,
          secretKey: keys.secretKey,
          sendMode,
          messages,
        }),
      ),
    'sendTransfer',
  )

  // Bust read caches so the user sees the new tx / lower balance immediately
  // after the next refresh.
  invalidateReadCache()

  return { commission }
}

/**
 * Send TON directly with no commission split. Used by donations, social-recovery
 * setup, and other internal flows where we don't want to skim a fee.
 */
export async function sendTonDirect(params: {
  keys: WalletKeys
  to: string
  amountTon: string
  comment?: string
}): Promise<void> {
  const destination = Address.parse(params.to)
  const value = toNano(params.amountTon)
  const client = getClient()
  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: params.keys.publicKey,
  })
  const opened = client.open(wallet)
  const seqno = await withRetry(
    () => serialize(() => opened.getSeqno()),
    'getSeqno',
  )
  const sendMode = SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS
  await withRetry(
    () =>
      serialize(() =>
        opened.sendTransfer({
          seqno,
          secretKey: params.keys.secretKey,
          sendMode,
          messages: [
            internal({
              to: destination,
              value,
              bounce: false,
              body: params.comment || undefined,
            }),
          ],
        }),
      ),
    'sendTransferDirect',
  )
  invalidateReadCache()
}

export interface TonTx {
  hash: string
  utime: number
  inMessageFromAddr: string | null
  inMessageValue: string // nano
  outMessages: { to: string; value: string }[]
  comment: string | null
}

interface ToncenterTxResp {
  ok: boolean
  result?: ToncenterTx[]
  error?: string
}
interface ToncenterTx {
  transaction_id: { hash: string; lt: string }
  utime: number
  in_msg?: ToncenterMsg
  out_msgs?: ToncenterMsg[]
}
interface ToncenterMsg {
  source?: string
  destination?: string
  value?: string
  message?: string
}

export async function getTransactions(address: string, limit = 15): Promise<TonTx[]> {
  const cacheKey = `txs:${address}:${limit}`
  return cached(cacheKey, READ_CACHE_TTL_MS, () =>
    withRetry(
      () =>
        serialize(async () => {
          const url = new URL(`${TONCENTER_REST_BASE}/getTransactions`)
          url.searchParams.set('address', address)
          url.searchParams.set('limit', String(limit))
          url.searchParams.set('archival', 'true')
          const headers: Record<string, string> = {}
          if (TONCENTER_API_KEY) headers['X-API-Key'] = TONCENTER_API_KEY
          const resp = await fetch(url.toString(), { headers })
          if (resp.status === 429) {
            throw new Error('TonCenter HTTP 429 (rate limited)')
          }
          if (!resp.ok) {
            throw new Error(`TonCenter HTTP ${resp.status}`)
          }
          const data = (await resp.json()) as ToncenterTxResp
          if (!data.ok || !data.result) return []
          return data.result.map((tx) => ({
            hash: tx.transaction_id.hash,
            utime: tx.utime,
            inMessageFromAddr: tx.in_msg?.source || null,
            inMessageValue: tx.in_msg?.value || '0',
            outMessages: (tx.out_msgs || []).map((m) => ({
              to: m.destination || '',
              value: m.value || '0',
            })),
            comment: tx.in_msg?.message || null,
          }))
        }),
      'getTransactions',
    ),
  )
}

// ---- Pay-API: invoice payment ----------------------------------------------

export interface InvoicePaymentParams {
  keys: WalletKeys
  /** invoice id like "inv_abc12345" — used as the on-chain text comment so
   *  the bot's scanner can match it to the right invoice. */
  invoiceId: string
  merchantAddress: string
  merchantAmountNano: bigint
  platformFeeAddress: string
  platformFeeNano: bigint
}

/** Pay an Fwallet invoice in a single TON transaction.
 *
 * The transaction carries up to two outgoing messages:
 *   1) merchantAmountNano TON → merchant_address with comment = invoice_id
 *   2) platformFeeNano TON   → platform_fee_address with comment = "Fwallet fee"
 *
 * The bot's blockchain watcher polls the merchant's address every minute and
 * matches the comment of message (1) to flip the invoice to ``paid``.
 */
export async function sendInvoicePayment(
  p: InvoicePaymentParams,
): Promise<void> {
  const merchantDest = Address.parse(p.merchantAddress)
  const platformDest = Address.parse(p.platformFeeAddress)
  const client = getClient()
  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: p.keys.publicKey,
  })
  const opened = client.open(wallet)
  const seqno = await withRetry(
    () => serialize(() => opened.getSeqno()),
    'getSeqno',
  )
  const messages = [
    internal({
      to: merchantDest,
      value: p.merchantAmountNano,
      bounce: false,
      body: p.invoiceId,
    }),
  ]
  if (p.platformFeeNano > 0n) {
    messages.push(
      internal({
        to: platformDest,
        value: p.platformFeeNano,
        bounce: false,
        body: 'Fwallet fee',
      }),
    )
  }
  await withRetry(
    () =>
      serialize(() =>
        opened.sendTransfer({
          seqno,
          secretKey: p.keys.secretKey,
          sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
          messages,
        }),
      ),
    'sendInvoicePayment',
  )
  invalidateReadCache()
}

export { fromNano, toNano }
