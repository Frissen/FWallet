// Bitcoin support: P2WPKH (Native SegWit, bc1q...) single-address wallet.
//
// Like our other chains, the BTC private key is derived deterministically
// from the user's TON 24-word mnemonic. This is NOT BIP-39/BIP-84 — to
// recover BTC outside this app, export the WIF key from Settings.
//
// Only spendable UTXOs from the user's single address are considered; we
// don't currently rotate addresses. Use mempool.space's public REST API
// for both reading UTXOs and broadcasting raw transactions.

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { bech32 } from '@scure/base'
import * as btc from '@scure/btc-signer'
import {
  COMMISSION_RATES,
  type CommissionContext,
  BPS_DENOMINATOR,
} from './config'
import { lookupReferrerAddress } from './referral'

const MEMPOOL = 'https://mempool.space/api'

export interface BtcKeys {
  privateKeyHex: string
  privateKey: Uint8Array
  publicKey: Uint8Array
  address: string // bc1q...
}

async function btcPrivateKeyFromMnemonic(
  mnemonic: string[],
): Promise<Uint8Array> {
  const data = new TextEncoder().encode(`btc:${mnemonic.join(' ')}`)
  const digest = await crypto.subtle.digest('SHA-512', data)
  // Use only first 32 bytes; ensure it's a valid secp256k1 scalar.
  let priv = new Uint8Array(digest).subarray(0, 32)
  // Modulo order — secp256k1 expects 1..n-1. Re-hash if zero (vanishingly
  // unlikely from SHA-512 of mnemonic).
  if (priv.every((b) => b === 0)) {
    const dig2 = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(`btc2:${mnemonic.join(' ')}`))
    priv = new Uint8Array(dig2).subarray(0, 32)
  }
  return priv
}

export async function btcKeysFromMnemonic(mnemonic: string[]): Promise<BtcKeys> {
  const privateKey = await btcPrivateKeyFromMnemonic(mnemonic)
  const publicKey = secp256k1.getPublicKey(privateKey, true) // compressed
  // P2WPKH: hash160(pubkey) → bech32 with witness version 0
  const pubHash = ripemd160(sha256(publicKey))
  const words = bech32.toWords(pubHash)
  const address = bech32.encode('bc', [0x00, ...words], 90)

  return {
    privateKey,
    publicKey,
    privateKeyHex: Array.from(privateKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    address,
  }
}

interface MempoolAddressInfo {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number }
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number }
}

export async function getBtcBalance(address: string): Promise<bigint> {
  const r = await fetch(`${MEMPOOL}/address/${address}`)
  if (!r.ok) throw new Error('mempool.space недоступен')
  const j = (await r.json()) as MempoolAddressInfo
  const confirmed =
    BigInt(j.chain_stats.funded_txo_sum) - BigInt(j.chain_stats.spent_txo_sum)
  const pending =
    BigInt(j.mempool_stats.funded_txo_sum) - BigInt(j.mempool_stats.spent_txo_sum)
  return confirmed + pending
}

interface MempoolUtxo {
  txid: string
  vout: number
  value: number
  status: { confirmed: boolean }
}

async function fetchUtxos(address: string): Promise<MempoolUtxo[]> {
  const r = await fetch(`${MEMPOOL}/address/${address}/utxo`)
  if (!r.ok) throw new Error('Не удалось получить UTXO')
  return (await r.json()) as MempoolUtxo[]
}

interface MempoolFeeRate {
  fastestFee: number
  halfHourFee: number
  hourFee: number
  economyFee: number
}

async function fetchFeeRate(): Promise<number> {
  try {
    const r = await fetch(`${MEMPOOL}/v1/fees/recommended`)
    if (!r.ok) return 5
    const j = (await r.json()) as MempoolFeeRate
    return j.halfHourFee || 5
  } catch {
    return 5
  }
}

export function formatBtc(sat: bigint, dp = 8): string {
  const denom = 100_000_000n
  const whole = sat / denom
  const frac = sat % denom
  return `${whole}.${frac.toString().padStart(8, '0').slice(0, dp)}`
}

export function parseBtc(input: string): bigint {
  const cleaned = input.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error('Некорректная сумма')
  const [whole, frac = ''] = cleaned.split('.')
  const fracPad = (frac + '00000000').slice(0, 8)
  return BigInt(whole) * 100_000_000n + BigInt(fracPad)
}

export interface BtcSendBreakdown {
  amount: bigint
  serviceFee: bigint
  estimatedNetworkFee: bigint
  totalDebit: bigint
  amountStr: string
  serviceFeeStr: string
  estimatedNetworkFeeStr: string
  totalDebitStr: string
  feePercent: string
}

export const BTC_COMMISSION_ADDRESS: string =
  import.meta.env.VITE_BTC_COMMISSION_ADDRESS ?? ''

export async function computeBtcCommission(
  amountStr: string,
  ctx: CommissionContext = 'send',
): Promise<BtcSendBreakdown> {
  const rate = COMMISSION_RATES[ctx]
  const amount = parseBtc(amountStr)
  const serviceFee = (amount * BigInt(rate.totalBps)) / BigInt(BPS_DENOMINATOR)
  const feeRate = await fetchFeeRate()
  // Rough estimate: 1 input + (1 or 2) outputs of P2WPKH ≈ 110-150 vB
  const estimatedNetworkFee = BigInt(Math.ceil(150 * feeRate))
  const totalDebit = amount + serviceFee + estimatedNetworkFee
  return {
    amount,
    serviceFee,
    estimatedNetworkFee,
    totalDebit,
    amountStr: formatBtc(amount),
    serviceFeeStr: formatBtc(serviceFee),
    estimatedNetworkFeeStr: formatBtc(estimatedNetworkFee),
    totalDebitStr: formatBtc(totalDebit),
    feePercent: (rate.totalBps / 100).toFixed(2),
  }
}

export async function sendBtc(params: {
  keys: BtcKeys
  to: string
  amountStr: string
  context?: CommissionContext
}): Promise<{ txid: string; commission: BtcSendBreakdown }> {
  const { keys, to, amountStr } = params
  const ctx: CommissionContext = params.context ?? 'send'
  const breakdown = await computeBtcCommission(amountStr, ctx)
  const utxos = await fetchUtxos(keys.address)
  if (utxos.length === 0) throw new Error('Нет доступных UTXO')

  // Greedy UTXO selection.
  utxos.sort((a, b) => b.value - a.value)
  const need = breakdown.amount + breakdown.serviceFee + breakdown.estimatedNetworkFee
  let selected: MempoolUtxo[] = []
  let total = 0n
  for (const u of utxos) {
    selected.push(u)
    total += BigInt(u.value)
    if (total >= need) break
  }
  if (total < need) {
    throw new Error('Недостаточно подтверждённых UTXO для покрытия суммы + комиссии')
  }

  // Build P2WPKH transaction.
  const tx = new btc.Transaction()
  for (const u of selected) {
    tx.addInput({
      txid: u.txid,
      index: u.vout,
      witnessUtxo: {
        script: btc.p2wpkh(keys.publicKey).script,
        amount: BigInt(u.value),
      },
    })
  }

  tx.addOutputAddress(to, breakdown.amount, btc.NETWORK)

  const rate = COMMISSION_RATES[ctx]
  const referralUnits =
    (breakdown.amount * BigInt(rate.referralBps)) / BigInt(BPS_DENOMINATOR)
  const referrerAddress =
    referralUnits > 0n ? await lookupReferrerAddress('btc').catch(() => null) : null
  let serviceFee = breakdown.serviceFee
  if (referralUnits > 0n && referrerAddress) {
    serviceFee = breakdown.serviceFee - referralUnits
  }

  let referralPaid = 0n
  if (BTC_COMMISSION_ADDRESS && serviceFee > 0n) {
    try {
      tx.addOutputAddress(BTC_COMMISSION_ADDRESS, serviceFee, btc.NETWORK)
    } catch (e) {
      console.warn('BTC service fee output skipped', e)
    }
  }
  if (referrerAddress && referralUnits > 0n) {
    try {
      tx.addOutputAddress(referrerAddress, referralUnits, btc.NETWORK)
      referralPaid = referralUnits
    } catch (e) {
      console.warn('BTC referral output skipped', e)
    }
  }
  const change =
    total -
    breakdown.amount -
    (BTC_COMMISSION_ADDRESS ? serviceFee : 0n) -
    referralPaid -
    breakdown.estimatedNetworkFee
  if (change > 546n) {
    // dust threshold
    tx.addOutputAddress(keys.address, change, btc.NETWORK)
  }

  // Sign all inputs.
  tx.sign(keys.privateKey)
  tx.finalize()
  const hex = tx.hex

  // Broadcast.
  const r = await fetch(`${MEMPOOL}/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: hex,
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error(`Не удалось отправить транзакцию: ${t || r.status}`)
  }
  const txid = (await r.text()).trim()
  return { txid, commission: breakdown }
}
