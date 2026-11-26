// TON Cheques.
//
// A "cheque" is a one-time-use, bearer-style transfer. The sender creates
// a fresh ephemeral TON wallet, funds it with (face value + a small gas
// reserve), and shares the ephemeral mnemonic embedded in a URL. Anyone
// who has that URL can claim the cheque (sweeping the ephemeral balance
// into their own wallet).
//
// A 1% service fee on the face value is charged at creation: the sender
// signs a SINGLE transaction that contains three messages — fund-cheque,
// service-fee, and (if a referrer is set) referral-fee.
//
// Security note: the secret is in the URL. Anyone with the URL controls
// the funds. Treat cheque links like cash.

import {
  WalletContractV4,
  internal,
} from '@ton/ton'
import {
  Address,
  toNano,
  fromNano,
  SendMode,
} from '@ton/core'
import {
  mnemonicNew,
  mnemonicToPrivateKey,
  mnemonicValidate,
} from '@ton/crypto'
import {
  COMMISSION_ADDRESS,
  CHEQUE_FEE_BPS,
  BPS_DENOMINATOR,
  BOT_DEEPLINK_BASE,
  APP_BASE_URL,
} from './config'
import {
  getClient,
  invalidateReadCache,
  type WalletKeys,
} from './ton'

// Reserve a little extra TON inside the cheque wallet so the claim
// transaction has gas. Tuned conservatively: 0.05 TON covers a v4 deploy
// + transfer comfortably.
const CHEQUE_GAS_RESERVE_NANO = toNano('0.05')

export interface ChequeBreakdown {
  faceNano: bigint
  feeNano: bigint
  serviceFeeNano: bigint
  gasNano: bigint
  totalNano: bigint
  faceTon: string
  feeTon: string
  totalTon: string
  feePercent: string
}

export function computeChequeBreakdown(faceTon: string): ChequeBreakdown {
  const faceNano = toNano(faceTon)
  const feeNano = (faceNano * BigInt(CHEQUE_FEE_BPS)) / BigInt(BPS_DENOMINATOR)
  const gasNano = CHEQUE_GAS_RESERVE_NANO
  const totalNano = faceNano + feeNano + gasNano
  return {
    faceNano,
    feeNano,
    serviceFeeNano: feeNano,
    gasNano,
    totalNano,
    faceTon: fromNano(faceNano),
    feeTon: fromNano(feeNano),
    totalTon: fromNano(totalNano),
    feePercent: (CHEQUE_FEE_BPS / 100).toFixed(2),
  }
}

export interface CreatedCheque {
  ephemeralMnemonic: string[]
  ephemeralAddress: string
  faceNano: bigint
  faceTon: string
  webLink: string
  tgLink: string
  rawSecret: string
}

function encodeChequeSecret(mnemonic: string[]): string {
  // Encode space-joined mnemonic as URL-safe base64 (no padding).
  const text = mnemonic.join(' ')
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

export function decodeChequeSecret(secret: string): string[] {
  // Telegram's startapp param is restricted to [A-Za-z0-9_-]{1,64}, so a real
  // 24-word mnemonic won't fit there directly; we work around that by ALSO
  // accepting a longer secret in the web URL hash. See createChequeLink for
  // the dual-link strategy.
  let normalized = secret.replaceAll('-', '+').replaceAll('_', '/')
  while (normalized.length % 4 !== 0) normalized += '='
  const bin = atob(normalized)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes).split(' ')
}

/**
 * Create a TON cheque from the user's wallet. Returns a link the sender can
 * share. The recipient can claim by opening the link in our app.
 */
export async function createCheque(
  senderKeys: WalletKeys,
  faceTonAmount: string,
): Promise<CreatedCheque> {
  const breakdown = computeChequeBreakdown(faceTonAmount)

  // 1. Generate ephemeral wallet that will hold the cheque face value.
  const ephemeralMnemonic = await mnemonicNew(24)
  const ephemeralKp = await mnemonicToPrivateKey(ephemeralMnemonic)
  const ephemeralWallet = WalletContractV4.create({
    workchain: 0,
    publicKey: ephemeralKp.publicKey,
  })
  const ephemeralAddress = ephemeralWallet.address.toString({
    bounceable: false,
    urlSafe: true,
  })

  // 2. From sender's wallet: fund cheque + pay 1% (split across service
  //    and referrer if any) in a single signed transaction.
  const client = getClient()
  const senderWallet = WalletContractV4.create({
    workchain: 0,
    publicKey: senderKeys.publicKey,
  })
  const opened = client.open(senderWallet)
  const seqno = await opened.getSeqno()

  // Under the v3 ledger model the entire cheque fee (1%) goes to the
  // operator's commission address, and the referrer's 0.5% cut is credited
  // virtually on the bot.
  const messages = [
    internal({
      to: ephemeralWallet.address,
      value: breakdown.faceNano + breakdown.gasNano,
      bounce: false,
      body: 'cheque',
    }),
    internal({
      to: Address.parse(COMMISSION_ADDRESS),
      value: breakdown.feeNano,
      bounce: false,
      body: 'cheque fee',
    }),
  ]

  await opened.sendTransfer({
    seqno,
    secretKey: senderKeys.secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages,
  })
  invalidateReadCache()

  // 3. Build share links. The full secret goes in the web URL fragment;
  //    the Telegram deeplink only carries a 16-char "ID" used to fetch
  //    the secret from local-storage of the wallet host (NOT a backend).
  //    For MVP simplicity, we put the full secret in the web URL fragment
  //    and Telegram users open the same URL via the WebApp.
  const rawSecret = encodeChequeSecret(ephemeralMnemonic)
  const webLink = `${APP_BASE_URL}/#cheque=${rawSecret}`
  // For the Telegram deeplink we use startapp=claim and the WebApp itself
  // re-reads window.location.hash because Telegram preserves the fragment
  // when launching the WebApp.
  const tgLink = `${BOT_DEEPLINK_BASE}/Wallet?startapp=cheque#cheque=${rawSecret}`

  return {
    ephemeralMnemonic,
    ephemeralAddress,
    faceNano: breakdown.faceNano,
    faceTon: breakdown.faceTon,
    webLink,
    tgLink,
    rawSecret,
  }
}

export interface ClaimableCheque {
  mnemonic: string[]
  ephemeralAddress: string
  balanceNano: bigint
  balanceTon: string
}

/**
 * Read the ephemeral wallet behind a cheque secret. Used to preview the
 * cheque before claiming.
 */
export async function inspectCheque(secret: string): Promise<ClaimableCheque> {
  const mnemonic = decodeChequeSecret(secret)
  const valid = await mnemonicValidate(mnemonic)
  if (!valid) throw new Error('Invalid cheque secret')
  const kp = await mnemonicToPrivateKey(mnemonic)
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: kp.publicKey })
  const ephemeralAddress = wallet.address.toString({ bounceable: false, urlSafe: true })
  const client = getClient()
  const balanceNano = await client.getBalance(wallet.address)
  return {
    mnemonic,
    ephemeralAddress,
    balanceNano,
    balanceTon: fromNano(balanceNano),
  }
}

/**
 * Claim a cheque by sweeping the ephemeral wallet's full balance into the
 * caller's address.
 */
export async function claimCheque(
  secret: string,
  toAddress: string,
): Promise<{ amountNano: bigint }> {
  const cheque = await inspectCheque(secret)
  if (cheque.balanceNano <= 0n) {
    throw new Error('Cheque is empty (already claimed or never funded)')
  }
  const kp = await mnemonicToPrivateKey(cheque.mnemonic)
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: kp.publicKey })
  const client = getClient()
  const opened = client.open(wallet)
  let seqno = 0
  try {
    seqno = await opened.getSeqno()
  } catch {
    // Wallet might not be deployed yet; first transfer also deploys the
    // contract. seqno=0 is correct in that case.
    seqno = 0
  }

  // CARRY_ALL_REMAINING_BALANCE means we don't have to compute the gas
  // ourselves; the wallet self-empties.
  const sendMode =
    SendMode.CARRY_ALL_REMAINING_BALANCE + SendMode.IGNORE_ERRORS

  await opened.sendTransfer({
    seqno,
    secretKey: kp.secretKey,
    sendMode,
    messages: [
      internal({
        to: Address.parse(toAddress),
        value: 1n, // ignored due to CARRY_ALL_REMAINING_BALANCE
        bounce: false,
        body: 'cheque claim',
      }),
    ],
  })
  invalidateReadCache()
  return { amountNano: cheque.balanceNano }
}

/**
 * If the page was opened with a cheque secret in the URL fragment, return it.
 * Returns null if no cheque is pending.
 */
export function readPendingChequeSecretFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash || ''
  const match = hash.match(/cheque=([A-Za-z0-9_\-+/=]+)/)
  return match ? match[1] : null
}

export function clearPendingChequeFromUrl(): void {
  if (typeof window === 'undefined') return
  if (window.location.hash.includes('cheque=')) {
    history.replaceState(null, '', window.location.pathname + window.location.search)
  }
}
