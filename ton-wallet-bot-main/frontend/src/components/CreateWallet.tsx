import { useEffect, useState } from 'react'
import { generateNewWallet, type WalletKeys } from '../lib/ton'
import { encryptMnemonic } from '../lib/crypto'
import { persistVault, cloudAvailable } from '../lib/cloudVault'
import { PinPad, PIN_LENGTH } from './PinPad'
import { haptic } from '../lib/telegram'

interface Props {
  onCreated: (keys: WalletKeys) => void
  onBack: () => void
}

type Step = 'loading' | 'pin' | 'pin-confirm'

// Paint the spinner before the heavy crypto starts so the screen never looks
// frozen on slower phones.
function nextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 0)),
  )
}

export function CreateWallet({ onCreated, onBack }: Props) {
  const [step, setStep] = useState<Step>('loading')
  const [keys, setKeys] = useState<WalletKeys | null>(null)
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await nextPaint()
        const k = await generateNewWallet()
        if (!cancelled) {
          setKeys(k)
          setStep('pin')
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Не удалось создать кошелёк')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (step === 'loading' || !keys) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center p-6 text-center">
        {error ? (
          <>
            <div className="text-red-400 text-sm mb-4">{error}</div>
            <button
              onClick={onBack}
              className="px-6 py-3 rounded-xl bg-ton-card border border-ton-border font-semibold"
            >
              Назад
            </button>
          </>
        ) : (
          <>
            <div className="fw-spinner mb-4" aria-hidden />
            <div className="text-ton-muted">Создаём кошелёк…</div>
          </>
        )}
      </div>
    )
  }

  if (step === 'pin') {
    return (
      <div className="min-h-full p-6 max-w-md mx-auto flex flex-col">
        <h1 className="text-2xl font-bold mb-2">Придумай PIN-код</h1>
        <p className="text-ton-muted text-sm mb-6">
          6 цифр для входа в Fwallet.
          {cloudAvailable()
            ? ' Кошелёк будет привязан к твоему аккаунту Telegram и доступен на других устройствах по этому PIN.'
            : ''}{' '}
          Seed-фразу можно сохранить сразу после создания.
        </p>
        <PinPad
          value={pin1}
          onChange={(v) => {
            setError(null)
            setPin1(v)
          }}
          onComplete={() => setStep('pin-confirm')}
        />
        <button onClick={onBack} className="text-ton-muted text-sm mt-6">
          ← Назад
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-full p-6 max-w-md mx-auto flex flex-col">
      <h1 className="text-2xl font-bold mb-2">Повтори PIN-код</h1>
      <p className="text-ton-muted text-sm mb-6">
        Введи те же 6 цифр ещё раз.
      </p>
      <PinPad
        value={pin2}
        onChange={(v) => {
          setError(null)
          setPin2(v)
        }}
        shake={shake}
        disabled={busy}
        onComplete={async (value) => {
          if (value !== pin1) {
            haptic('error')
            setError('PIN-коды не совпадают.')
            setShake(true)
            setTimeout(() => {
              setPin2('')
              setShake(false)
            }, 400)
            return
          }
          if (pin1.length !== PIN_LENGTH) return
          setBusy(true)
          try {
            await nextPaint()
            const vault = await encryptMnemonic(keys.mnemonic.join(' '), pin1)
            // Saves locally and mirrors to the Telegram cloud in background.
            persistVault({
              vault,
              address: keys.address,
              createdAt: Date.now(),
            })
            haptic('success')
            onCreated(keys)
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось зашифровать')
          } finally {
            setBusy(false)
          }
        }}
      />
      {error && (
        <div className="text-red-400 text-sm mt-4 text-center">{error}</div>
      )}
      {busy && (
        <div className="flex items-center justify-center gap-2 text-ton-muted text-sm mt-4">
          <span className="fw-spinner fw-spinner-sm" aria-hidden />
          Шифрование…
        </div>
      )}
      <button
        onClick={() => {
          setPin1('')
          setPin2('')
          setStep('pin')
        }}
        className="text-ton-muted text-sm mt-6"
      >
        ← Назад
      </button>
    </div>
  )
}
