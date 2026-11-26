// Solana support: native SOL + USDC SPL.
//
// Like our other chains, the Solana keypair is derived deterministically from
// the user's TON 24-word mnemonic. ed25519 needs only 32 bytes of seed, which
// we get by hashing the mnemonic with a chain-specific salt.

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  COMMISSION_RATES,
  type CommissionContext,
  BPS_DENOMINATOR,
} from './config'
import { lookupReferrerAddress } from './referral'

const RPC_URL = 'https://api.mainnet-beta.solana.com'
let _conn: Connection | null = null
function conn(): Connection {
  if (!_conn) _conn = new Connection(RPC_URL, 'confirmed')
  return _conn
}

export interface SolTokenConfig {
  symbol: string
  name: string
  mint: string
  decimals: number
}

export const SOL_TOKENS: SolTokenConfig[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8GUEGGkZwyTDt1v',
    decimals: 6,
  },
]

export interface SolKeys {
  publicKey: string
  secretKeyHex: string
  // Backing keypair (kept opaque to the caller).
  _kp: Keypair
}

export async function solKeysFromMnemonic(mnemonic: string[]): Promise<SolKeys> {
  const data = new TextEncoder().encode(`sol:${mnemonic.join(' ')}`)
  const digest = await crypto.subtle.digest('SHA-512', data)
  const seed = new Uint8Array(digest).subarray(0, 32)
  const kp = Keypair.fromSeed(seed)
  return {
    publicKey: kp.publicKey.toBase58(),
    secretKeyHex: Array.from(kp.secretKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    _kp: kp,
  }
}

export async function getSolBalance(address: string): Promise<bigint> {
  const lamports = await conn().getBalance(new PublicKey(address))
  return BigInt(lamports)
}

export function formatSol(lamports: bigint, dp = 5): string {
  return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(dp)
}

export async function getSplBalance(
  owner: string,
  mint: string,
): Promise<bigint> {
  try {
    const ata = await getAssociatedTokenAddress(
      new PublicKey(mint),
      new PublicKey(owner),
    )
    const info = await conn().getTokenAccountBalance(ata)
    return BigInt(info.value.amount)
  } catch {
    // Account doesn't exist yet → 0 balance.
    return 0n
  }
}

export function formatSpl(units: bigint, decimals: number, dp = 4): string {
  const denom = 10n ** BigInt(decimals)
  const whole = units / denom
  const frac = units % denom
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, dp)
  return `${whole}.${fracStr}`
}

export function parseSpl(input: string, decimals: number): bigint {
  const cleaned = input.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error('Некорректная сумма')
  const [whole, frac = ''] = cleaned.split('.')
  const fracPad = (frac + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPad)
}

export interface SolSendBreakdown {
  amount: bigint
  serviceFee: bigint
  totalDebit: bigint
  amountStr: string
  feePercent: string
}

export const SOL_COMMISSION_ADDRESS: string =
  import.meta.env.VITE_SOL_COMMISSION_ADDRESS ?? ''

export function computeSolCommission(
  amountStr: string,
  ctx: CommissionContext = 'send',
): SolSendBreakdown {
  const rate = COMMISSION_RATES[ctx]
  const amount = BigInt(Math.floor(Number(amountStr) * LAMPORTS_PER_SOL))
  const serviceFee = (amount * BigInt(rate.totalBps)) / BigInt(BPS_DENOMINATOR)
  const totalDebit = amount + serviceFee
  return {
    amount,
    serviceFee,
    totalDebit,
    amountStr,
    feePercent: (rate.totalBps / 100).toFixed(2),
  }
}

export async function sendSolNative(params: {
  keys: SolKeys
  to: string
  amountStr: string
  context?: CommissionContext
}): Promise<{ txid: string; commission: SolSendBreakdown }> {
  const { keys, to, amountStr } = params
  const ctx: CommissionContext = params.context ?? 'send'
  const breakdown = computeSolCommission(amountStr, ctx)
  const tx = new Transaction()
  tx.add(
    SystemProgram.transfer({
      fromPubkey: keys._kp.publicKey,
      toPubkey: new PublicKey(to),
      lamports: Number(breakdown.amount),
    }),
  )
  const rate = COMMISSION_RATES[ctx]
  const referralLamports =
    (breakdown.amount * BigInt(rate.referralBps)) / BigInt(BPS_DENOMINATOR)
  const referrerAddress =
    referralLamports > 0n ? await lookupReferrerAddress('sol').catch(() => null) : null
  let serviceFee = breakdown.serviceFee
  if (referralLamports > 0n && referrerAddress) {
    serviceFee = breakdown.serviceFee - referralLamports
  }

  if (SOL_COMMISSION_ADDRESS && serviceFee > 0n) {
    try {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: keys._kp.publicKey,
          toPubkey: new PublicKey(SOL_COMMISSION_ADDRESS),
          lamports: Number(serviceFee),
        }),
      )
    } catch (e) {
      console.warn('SOL service fee instruction skipped', e)
    }
  }
  if (referrerAddress && referralLamports > 0n) {
    try {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: keys._kp.publicKey,
          toPubkey: new PublicKey(referrerAddress),
          lamports: Number(referralLamports),
        }),
      )
    } catch (e) {
      console.warn('SOL referral instruction skipped', e)
    }
  }
  const txid = await sendAndConfirmTransaction(conn(), tx, [keys._kp])

  return { txid, commission: breakdown }
}

export async function sendSplToken(params: {
  keys: SolKeys
  to: string
  amountStr: string
  token: SolTokenConfig
  context?: CommissionContext
}): Promise<{ txid: string; commission: { amount: bigint; serviceFee: bigint; feePercent: string } }> {
  const { keys, to, amountStr, token } = params
  const ctx: CommissionContext = params.context ?? 'send'
  const rate = COMMISSION_RATES[ctx]
  const amount = parseSpl(amountStr, token.decimals)
  const serviceFee = (amount * BigInt(rate.totalBps)) / BigInt(BPS_DENOMINATOR)
  const mint = new PublicKey(token.mint)
  const owner = keys._kp.publicKey
  const dest = new PublicKey(to)
  const fromAta = await getAssociatedTokenAddress(mint, owner)
  const toAta = await getAssociatedTokenAddress(mint, dest)

  const tx = new Transaction()
  // Create destination ATA if it doesn't exist.
  const toAtaInfo = await conn().getAccountInfo(toAta)
  if (!toAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(owner, toAta, dest, mint),
    )
  }
  tx.add(
    createTransferInstruction(
      fromAta,
      toAta,
      owner,
      amount,
      [],
      TOKEN_PROGRAM_ID,
    ),
  )
  const referralUnits =
    (amount * BigInt(rate.referralBps)) / BigInt(BPS_DENOMINATOR)
  const referrerAddress =
    referralUnits > 0n ? await lookupReferrerAddress('sol').catch(() => null) : null
  let netServiceFee = serviceFee
  if (referralUnits > 0n && referrerAddress) {
    netServiceFee = serviceFee - referralUnits
  }

  if (SOL_COMMISSION_ADDRESS && netServiceFee > 0n) {
    try {
      const feeOwner = new PublicKey(SOL_COMMISSION_ADDRESS)
      const feeAta = await getAssociatedTokenAddress(mint, feeOwner)
      const feeAtaInfo = await conn().getAccountInfo(feeAta)
      if (!feeAtaInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(owner, feeAta, feeOwner, mint),
        )
      }
      tx.add(
        createTransferInstruction(fromAta, feeAta, owner, netServiceFee, [], TOKEN_PROGRAM_ID),
      )
    } catch (e) {
      console.warn('SOL token service fee instruction skipped', e)
    }
  }
  if (referrerAddress && referralUnits > 0n) {
    try {
      const refOwner = new PublicKey(referrerAddress)
      const refAta = await getAssociatedTokenAddress(mint, refOwner)
      const refAtaInfo = await conn().getAccountInfo(refAta)
      if (!refAtaInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(owner, refAta, refOwner, mint),
        )
      }
      tx.add(
        createTransferInstruction(fromAta, refAta, owner, referralUnits, [], TOKEN_PROGRAM_ID),
      )
    } catch (e) {
      console.warn('SOL token referral instruction skipped', e)
    }
  }
  const txid = await sendAndConfirmTransaction(conn(), tx, [keys._kp])

  return {
    txid,
    commission: {
      amount,
      serviceFee,
      feePercent: (rate.totalBps / 100).toFixed(2),
    },
  }
}
