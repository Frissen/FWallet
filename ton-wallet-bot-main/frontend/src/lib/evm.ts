// EVM chains: Ethereum mainnet and BNB Smart Chain.
//
// We derive a single secp256k1 private key deterministically from the user's
// TON 24-word mnemonic (NOT BIP-39 / BIP-44). This means the resulting EVM
// address can only be recovered by re-running this app's derivation; it
// won't show up in MetaMask out of the box. Settings exposes the raw hex
// private key so the user can import it manually if they want.

import {
  JsonRpcProvider,
  Wallet,
  Contract,
  formatEther,
  parseEther,
  parseUnits,
  formatUnits,
} from 'ethers'

// ---------------------------------------------------------------------------
// Chain registry
// ---------------------------------------------------------------------------

export interface EvmChainConfig {
  id: 'eth' | 'bsc'
  name: string
  symbol: string
  chainId: number
  rpcUrl: string
  explorer: string
  // Token list shown in the UI (top stables only).
  tokens: EvmTokenConfig[]
}

export interface EvmTokenConfig {
  symbol: string
  name: string
  address: string
  decimals: number
}

export const EVM_CHAINS: Record<EvmChainConfig['id'], EvmChainConfig> = {
  eth: {
    id: 'eth',
    name: 'Ethereum',
    symbol: 'ETH',
    chainId: 1,
    rpcUrl: 'https://eth.llamarpc.com',
    explorer: 'https://etherscan.io',
    tokens: [
      {
        symbol: 'USDT',
        name: 'Tether USD',
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        decimals: 6,
      },
      {
        symbol: 'USDC',
        name: 'USD Coin',
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0cE3606eB48',
        decimals: 6,
      },
    ],
  },
  bsc: {
    id: 'bsc',
    name: 'BNB Chain',
    symbol: 'BNB',
    chainId: 56,
    rpcUrl: 'https://bsc-dataseed.binance.org',
    explorer: 'https://bscscan.com',
    tokens: [
      {
        symbol: 'USDT',
        name: 'Tether USD',
        address: '0x55d398326f99059fF775485246999027B3197955',
        decimals: 18,
      },
      {
        symbol: 'BUSD',
        name: 'Binance USD',
        address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
        decimals: 18,
      },
    ],
  },
}

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
] as const

const _providers: Partial<Record<EvmChainConfig['id'], JsonRpcProvider>> = {}
function provider(chain: EvmChainConfig): JsonRpcProvider {
  let p = _providers[chain.id]
  if (!p) {
    p = new JsonRpcProvider(chain.rpcUrl, chain.chainId)
    _providers[chain.id] = p
  }
  return p
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export interface EvmKeys {
  privateKeyHex: string
  address: string
}

async function evmPrivateKeyFromMnemonic(mnemonic: string[]): Promise<string> {
  const data = new TextEncoder().encode(`evm:${mnemonic.join(' ')}`)
  const digest = await crypto.subtle.digest('SHA-512', data)
  const priv = new Uint8Array(digest).subarray(0, 32)
  return (
    '0x' +
    Array.from(priv)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  )
}

export async function evmKeysFromMnemonic(mnemonic: string[]): Promise<EvmKeys> {
  const privateKeyHex = await evmPrivateKeyFromMnemonic(mnemonic)
  const w = new Wallet(privateKeyHex)
  return { privateKeyHex, address: w.address }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getEvmNativeBalance(
  chain: EvmChainConfig,
  address: string,
): Promise<bigint> {
  const p = provider(chain)
  return await p.getBalance(address)
}

export async function getEvmTokenBalance(
  chain: EvmChainConfig,
  token: EvmTokenConfig,
  address: string,
): Promise<bigint> {
  const p = provider(chain)
  const c = new Contract(token.address, ERC20_ABI, p)
  const balanceFn = c.getFunction('balanceOf') as unknown as (
    a: string,
  ) => Promise<bigint>
  const raw = await balanceFn(address)
  return raw
}

export function formatEvmNative(units: bigint): string {
  return Number(formatEther(units)).toFixed(5)
}

export function formatEvmToken(units: bigint, decimals: number, dp = 4): string {
  return Number(formatUnits(units, decimals)).toFixed(dp)
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface EvmSendBreakdown {
  amount: bigint
  serviceFee: bigint
  totalDebit: bigint
  amountStr: string
  serviceFeeStr: string
  totalDebitStr: string
  feePercent: string
}

import {
  COMMISSION_RATES,
  type CommissionContext,
  BPS_DENOMINATOR,
} from './config'
import { lookupReferrerAddress } from './referral'

export const EVM_COMMISSION_ADDRESS: string =
  import.meta.env.VITE_EVM_COMMISSION_ADDRESS ?? ''

export function computeEvmCommission(
  amountStr: string,
  decimals: number,
  ctx: CommissionContext = 'send',
): EvmSendBreakdown {
  const rate = COMMISSION_RATES[ctx]
  const amount = decimals === 18 ? parseEther(amountStr) : parseUnits(amountStr, decimals)
  const serviceFee = (amount * BigInt(rate.totalBps)) / BigInt(BPS_DENOMINATOR)
  const totalDebit = amount + serviceFee
  return {
    amount,
    serviceFee,
    totalDebit,
    amountStr: formatUnits(amount, decimals),
    serviceFeeStr: formatUnits(serviceFee, decimals),
    totalDebitStr: formatUnits(totalDebit, decimals),
    feePercent: (rate.totalBps / 100).toFixed(2),
  }
}

export interface EvmSendNativeParams {
  chain: EvmChainConfig
  keys: EvmKeys
  to: string
  amountStr: string // human ETH/BNB string
  context?: CommissionContext
}

export async function sendEvmNative(
  params: EvmSendNativeParams,
): Promise<{ txid: string; commission: EvmSendBreakdown }> {
  const { chain, keys, to, amountStr } = params
  const ctx: CommissionContext = params.context ?? 'send'
  const p = provider(chain)
  const wallet = new Wallet(keys.privateKeyHex, p)
  const breakdown = computeEvmCommission(amountStr, 18, ctx)

  const main = await wallet.sendTransaction({
    to,
    value: breakdown.amount,
  })

  // Split: referralBps to referrer (if registered), the rest to commission.
  const rate = COMMISSION_RATES[ctx]
  const referralUnits =
    (breakdown.amount * BigInt(rate.referralBps)) / BigInt(BPS_DENOMINATOR)
  const referrerAddress =
    referralUnits > 0n ? await lookupReferrerAddress(chain.id).catch(() => null) : null
  let serviceFee = breakdown.serviceFee
  if (referralUnits > 0n && !referrerAddress) {
    // No registered ref address — service fee absorbs the rebate.
  } else if (referralUnits > 0n && referrerAddress) {
    serviceFee = breakdown.serviceFee - referralUnits
  }

  if (EVM_COMMISSION_ADDRESS && serviceFee > 0n) {
    try {
      await wallet.sendTransaction({
        to: EVM_COMMISSION_ADDRESS,
        value: serviceFee,
      })
    } catch (e) {
      console.warn('EVM service fee tx failed', e)
    }
  }

  if (referrerAddress && referralUnits > 0n) {
    try {
      await wallet.sendTransaction({
        to: referrerAddress,
        value: referralUnits,
      })
    } catch (e) {
      console.warn('EVM referral tx failed', e)
    }
  }

  return { txid: main.hash, commission: breakdown }
}

export interface EvmSendTokenParams {
  chain: EvmChainConfig
  token: EvmTokenConfig
  keys: EvmKeys
  to: string
  amountStr: string
  context?: CommissionContext
}

export async function sendEvmToken(
  params: EvmSendTokenParams,
): Promise<{ txid: string; commission: EvmSendBreakdown }> {
  const { chain, token, keys, to, amountStr } = params
  const ctx: CommissionContext = params.context ?? 'send'
  const p = provider(chain)
  const wallet = new Wallet(keys.privateKeyHex, p)
  const c = new Contract(token.address, ERC20_ABI, wallet)
  const breakdown = computeEvmCommission(amountStr, token.decimals, ctx)

  const transferFn = c.getFunction('transfer') as unknown as (
    to: string,
    amount: bigint,
  ) => Promise<{ hash: string }>

  const main = await transferFn(to, breakdown.amount)

  const rate = COMMISSION_RATES[ctx]
  const referralUnits =
    (breakdown.amount * BigInt(rate.referralBps)) / BigInt(BPS_DENOMINATOR)
  const referrerAddress =
    referralUnits > 0n ? await lookupReferrerAddress(chain.id).catch(() => null) : null
  let serviceFee = breakdown.serviceFee
  if (referralUnits > 0n && referrerAddress) {
    serviceFee = breakdown.serviceFee - referralUnits
  }

  if (EVM_COMMISSION_ADDRESS && serviceFee > 0n) {
    try {
      await transferFn(EVM_COMMISSION_ADDRESS, serviceFee)
    } catch (e) {
      console.warn('EVM token service fee tx failed', e)
    }
  }

  if (referrerAddress && referralUnits > 0n) {
    try {
      await transferFn(referrerAddress, referralUnits)
    } catch (e) {
      console.warn('EVM token referral tx failed', e)
    }
  }

  return { txid: main.hash, commission: breakdown }
}
