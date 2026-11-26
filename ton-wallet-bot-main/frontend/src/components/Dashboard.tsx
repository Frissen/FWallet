import { useEffect, useState } from 'react'
import { TabBar, type TabKey } from './TabBar'
import { HomeTab } from './HomeTab'
import { SwapTab } from './SwapTab'
import { ChequesTab } from './ChequesTab'
import { P2PTab } from './P2PTab'
import { MoreTab } from './MoreTab'
import { type WalletKeys } from '../lib/ton'
import { deriveAllChains, type MultiChainKeys } from '../lib/wallet'
import { readPendingChequeSecretFromUrl } from '../lib/cheque'
import { registerAddresses } from '../lib/referral'
import { isBackedUp } from '../lib/storage'
import { SeedBackup } from './SeedBackup'

type InitialTab = 'home' | 'p2p' | 'swap' | 'more' | 'cheques'

interface Props {
  keys: WalletKeys
  initialTab?: InitialTab | null
  onLock: () => void
  onForget: () => void
}

export function Dashboard({ keys, initialTab, onLock, onForget }: Props) {
  // 'cheques' is a virtual tab — opens the cheques modal on the home tab.
  const tabSeed: TabKey =
    initialTab === 'p2p' || initialTab === 'swap' || initialTab === 'more'
      ? initialTab
      : 'home'
  const [tab, setTab] = useState<TabKey>(tabSeed)
  const [chequesOpen, setChequesOpen] = useState<boolean>(
    initialTab === 'cheques' || readPendingChequeSecretFromUrl() !== null,
  )
  const [allKeys, setAllKeys] = useState<MultiChainKeys | null>(null)
  const [needsBackup, setNeedsBackup] = useState<boolean>(() => !isBackedUp())
  const [backupOpen, setBackupOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const out = await deriveAllChains(keys)
        if (cancelled) return
        setAllKeys(out)
        await registerAddresses({
          ton_address: keys.address,
          eth_address: out.evm?.address,
          bsc_address: out.evm?.address,
          sol_address: out.sol?.publicKey,
          btc_address: out.btc?.address,
        })
      } catch (e) {
        console.error('deriveAllChains failed', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [keys])

  if (backupOpen) {
    return (
      <div className="min-h-full bg-ton-dark text-white">
        <SeedBackup
          mnemonic={keys.mnemonic}
          onClose={() => setBackupOpen(false)}
          onSaved={() => setNeedsBackup(false)}
        />
      </div>
    )
  }

  if (chequesOpen) {
    return (
      <div className="min-h-full bg-ton-dark text-white">
        <div className="max-w-md mx-auto pb-32">
          <ChequesTab
            keys={keys}
            balanceNano={0n}
            onAfterAction={() => undefined}
            onClose={() => setChequesOpen(false)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-ton-dark text-white">
      <div className="max-w-md mx-auto">
        {needsBackup && (
          <button
            onClick={() => setBackupOpen(true)}
            className="mx-4 mt-4 w-[calc(100%-2rem)] text-left rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 active:scale-[0.99] transition"
          >
            <div className="text-sm font-semibold text-amber-300">
              Сохрани seed-фразу
            </div>
            <div className="text-xs text-amber-200/80 mt-0.5">
              Без неё не восстановить кошелёк. Нажми, чтобы показать и
              скопировать 24 слова.
            </div>
          </button>
        )}
        {tab === 'home' && (
          <HomeTab
            keys={keys}
            all={allKeys}
            onOpenCheques={() => setChequesOpen(true)}
          />
        )}
        {tab === 'p2p' && <P2PTab keys={keys} all={allKeys} />}
        {tab === 'swap' && <SwapTab keys={keys} all={allKeys} />}
        {tab === 'more' && (
          <MoreTab
            keys={keys}
            all={allKeys}
            onLock={onLock}
            onForget={onForget}
            onOpenCheques={() => setChequesOpen(true)}
          />
        )}
      </div>
      <TabBar active={tab} onChange={setTab} />
    </div>
  )
}
