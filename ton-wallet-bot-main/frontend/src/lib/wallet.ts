// Unified wallet derivation: from a single 24-word TON mnemonic we derive
// keys for TON, Ethereum/BSC, Solana and Bitcoin using deterministic
// per-chain SHA-512 mixers. None of the alt chains follow BIP-39/BIP-44, so
// the user must export the per-chain raw private key from Settings to
// recover funds outside of this app.
//
// Tron support has been removed from the UI. The `tron` field is kept on
// MultiChainKeys for backwards-compatibility with callers that still
// reference it, but it's always null.

import { type WalletKeys } from './ton'
import { evmKeysFromMnemonic, type EvmKeys } from './evm'
import { solKeysFromMnemonic, type SolKeys } from './sol'
import { btcKeysFromMnemonic, type BtcKeys } from './btc'

export interface MultiChainKeys {
  ton: WalletKeys
  tron: null
  evm: EvmKeys | null
  sol: SolKeys | null
  btc: BtcKeys | null
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export async function deriveAllChains(
  ton: WalletKeys,
): Promise<MultiChainKeys> {
  // Derive chains one at a time, yielding to the event loop in between: the
  // curve math runs on the main thread, and doing all three at once right
  // after the dashboard mounts makes the screen stutter on phones. If a chain
  // fails it stays null and the UI shows a placeholder instead of breaking.
  await yieldToMain()
  const evm = await evmKeysFromMnemonic(ton.mnemonic).catch((e) => {
    console.error('EVM derivation failed', e)
    return null
  })
  await yieldToMain()
  const sol = await solKeysFromMnemonic(ton.mnemonic).catch((e) => {
    console.error('Sol derivation failed', e)
    return null
  })
  await yieldToMain()
  const btc = await btcKeysFromMnemonic(ton.mnemonic).catch((e) => {
    console.error('Btc derivation failed', e)
    return null
  })

  return { ton, tron: null, evm, sol, btc }
}
