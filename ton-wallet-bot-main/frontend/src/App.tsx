import { useEffect, useMemo, useState } from 'react'
import { Welcome } from './components/Welcome'
import { CreateWallet } from './components/CreateWallet'
import { ImportWallet } from './components/ImportWallet'
import { Dashboard } from './components/Dashboard'
import { Unlock } from './components/Unlock'
import { InvoicePay } from './components/InvoicePay'
import { cloudAvailable, restoreVaultFromCloud } from './lib/cloudVault'
import { loadVault, type StoredVault } from './lib/storage'
import type { WalletKeys } from './lib/ton'

type Screen = 'welcome' | 'create' | 'import' | 'unlock' | 'dashboard'

function readInvoiceIdFromLaunch(): string | null {
  // 1) plain query string ?invoice=<id>
  try {
    const sp = new URLSearchParams(window.location.search)
    const q = sp.get('invoice')
    if (q && q.startsWith('inv_')) return q
  } catch {
    // ignore — non-browser env in tests
  }
  // 2) Telegram start_param coming from t.me/<bot>?startapp=inv_<id>
  try {
    const tg = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { start_param?: string } } } }).Telegram
    const sp = tg?.WebApp?.initDataUnsafe?.start_param
    if (sp && sp.startsWith('inv_')) return sp
  } catch {
    // ignore
  }
  return null
}

export type InitialTab = 'home' | 'p2p' | 'swap' | 'more' | 'cheques'

function readInitialTabFromLaunch(): InitialTab | null {
  // 1) plain ?tab=<name>
  try {
    const sp = new URLSearchParams(window.location.search)
    const t = sp.get('tab')
    if (t === 'home' || t === 'p2p' || t === 'swap' || t === 'more' || t === 'cheques') {
      return t
    }
  } catch {
    // ignore
  }
  // 2) Telegram start_param "tab_<name>"
  try {
    const tg = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { start_param?: string } } } }).Telegram
    const sp = tg?.WebApp?.initDataUnsafe?.start_param
    if (sp && sp.startsWith('tab_')) {
      const t = sp.slice(4)
      if (t === 'home' || t === 'p2p' || t === 'swap' || t === 'more' || t === 'cheques') {
        return t
      }
    }
  } catch {
    // ignore
  }
  return null
}

function App() {
  const initialVault = useMemo(() => loadVault(), [])
  const initialInvoiceId = useMemo(() => readInvoiceIdFromLaunch(), [])
  const initialTab = useMemo(() => readInitialTabFromLaunch(), [])
  const [vault, setVault] = useState<StoredVault | null>(initialVault)
  const [keys, setKeys] = useState<WalletKeys | null>(null)
  const [screen, setScreen] = useState<Screen>(
    initialVault ? 'unlock' : 'welcome',
  )
  const [invoiceId, setInvoiceId] = useState<string | null>(initialInvoiceId)
  // True while we look for this Telegram account's wallet in the cloud.
  const [restoring, setRestoring] = useState<boolean>(
    () => !initialVault && cloudAvailable(),
  )

  useEffect(() => {
    if (!restoring) return
    let cancelled = false
    void restoreVaultFromCloud().then((v) => {
      if (cancelled) return
      if (v) {
        setVault(v)
        setScreen('unlock')
      }
      setRestoring(false)
    })
    return () => {
      cancelled = true
    }
  }, [restoring])

  // Strip launch params from the URL once captured so subsequent navigations
  // (e.g. user closes the screen and re-opens the wallet) don't re-trigger.
  useEffect(() => {
    if (initialInvoiceId || initialTab) {
      try {
        const url = new URL(window.location.href)
        url.searchParams.delete('invoice')
        url.searchParams.delete('tab')
        window.history.replaceState({}, '', url.pathname + url.search)
      } catch {
        // ignore
      }
    }
  }, [initialInvoiceId, initialTab])

  if (restoring) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center p-6 text-center">
        <div className="fw-spinner mb-4" aria-hidden />
        <div className="text-ton-muted">Ищем твой кошелёк в Telegram…</div>
      </div>
    )
  }

  // Pay-API flow. While `invoiceId` is set, the user is in the invoice
  // payment funnel: if they have keys, show the pay screen directly; if
  // they have a vault but no keys, prompt them to unlock and bounce back;
  // if they have no vault yet, walk them through create / import and bounce
  // back. Closing the invoice from any of these screens bails out into the
  // normal wallet flow.
  if (invoiceId) {
    if (keys) {
      return (
        <InvoicePay
          invoiceId={invoiceId}
          keys={keys}
          onCreateWallet={() => undefined /* not reachable when keys present */}
          onClose={() => setInvoiceId(null)}
        />
      )
    }
    if (vault && screen !== 'create' && screen !== 'import') {
      return (
        <Unlock
          vault={vault}
          onUnlocked={(k) => setKeys(k)}
          onForget={() => {
            setVault(null)
            setScreen('welcome')
          }}
        />
      )
    }
    if (screen === 'create') {
      return (
        <CreateWallet
          onCreated={(k) => {
            setKeys(k)
            setVault(loadVault())
          }}
          onBack={() => setScreen('welcome')}
        />
      )
    }
    if (screen === 'import') {
      return (
        <ImportWallet
          onImported={(k) => {
            setKeys(k)
            setVault(loadVault())
          }}
          onBack={() => setScreen('welcome')}
        />
      )
    }
    if (screen === 'welcome') {
      return (
        <Welcome
          onCreate={() => setScreen('create')}
          onImport={() => setScreen('import')}
        />
      )
    }
    // No vault, no keys, untouched screen — show the invoice with an
    // "Open wallet" CTA pointing into onboarding.
    return (
      <InvoicePay
        invoiceId={invoiceId}
        keys={null}
        onCreateWallet={() => setScreen('welcome')}
        onClose={() => setInvoiceId(null)}
      />
    )
  }

  if (screen === 'dashboard' && keys) {
    return (
      <Dashboard
        keys={keys}
        initialTab={initialTab}
        onLock={() => {
          const v = loadVault()
          setKeys(null)
          if (v) {
            setVault(v)
            setScreen('unlock')
          } else {
            setVault(null)
            setScreen('welcome')
          }
        }}
        onForget={() => {
          setKeys(null)
          setVault(null)
          setScreen('welcome')
        }}
      />
    )
  }

  if (screen === 'unlock' && vault) {
    return (
      <Unlock
        vault={vault}
        onUnlocked={(k) => {
          setKeys(k)
          setScreen('dashboard')
        }}
        onForget={() => {
          setVault(null)
          setScreen('welcome')
        }}
      />
    )
  }

  if (screen === 'create') {
    return (
      <CreateWallet
        onCreated={(k) => {
          setKeys(k)
          setVault(loadVault())
          setScreen('dashboard')
        }}
        onBack={() => setScreen('welcome')}
      />
    )
  }
  if (screen === 'import') {
    return (
      <ImportWallet
        onImported={(k) => {
          setKeys(k)
          setVault(loadVault())
          setScreen('dashboard')
        }}
        onBack={() => setScreen('welcome')}
      />
    )
  }

  return (
    <Welcome
      onCreate={() => setScreen('create')}
      onImport={() => setScreen('import')}
    />
  )
}

export default App
