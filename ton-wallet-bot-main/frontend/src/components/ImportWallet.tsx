import { useState } from 'react'
import { walletFromMnemonic, type WalletKeys } from '../lib/ton'
import { encryptMnemonic } from '../lib/crypto'
import { persistVault } from '../lib/cloudVault'
import { PinPad, PIN_LENGTH } from './PinPad'
import { haptic } from '../lib/telegram'
import { markBackedUp } from '../lib/storage'

interface Props {
  onImported: (keys: WalletKeys) => void
  onBack: () => void
}

type Step = 'mnemonic' | 'pin' | 'pin-confirm'

export function ImportWallet({ onImported, onBack }: Props) {
  const [step, setStep] = useState<Step>('mnemonic')
  const [mnemonic, setMnemonic] = useState('')
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)

  if (step === 'mnemonic') {
    return (
      <div className="min-h-full p-6 max-w-md mx-auto">
        <h1 className="text-2xl font-bold mb-2">Импорт кошелька</h1>
        <p className="text-ton-muted text-sm mb-4">
          Вставь свою seed-фразу из 24 слов. Она обрабатывается локально и не
          покидает устройство.
        </p>
        <textarea
          value={mnemonic}
          onChange={(e) => {
            setMnemonic(e.target.value)
            setError(null)
          }}
          placeholder="word1 word2 word3 …"
          rows={4}
          className="w-full px-4 py-3 bg-ton-card border border-ton-border rounded-xl font-mono text-sm mb-3 outline-none focus:border-ton-primary"
        />
        {error && <div className="text-red-400 text-sm mb-2">{error}</div>}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onBack}
            className="flex-1 py-3 rounded-xl bg-ton-card border border-ton-border"
          >
            Назад
          </button>
          <button
            onClick={() => {
              const words = mnemonic
                .trim()
                .split(/\s+/)
                .map((w) => w.toLowerCase())
              if (words.length !== 24) {
                setError('Фраза должна содержать 24 слова')
                return
              }
              setStep('pin')
            }}
            className="flex-1 py-3 rounded-xl bg-ton-primary hover:brightness-110 font-semibold"
          >
            Далее
          </button>
        </div>
      </div>
    )
  }

  if (step === 'pin') {
    return (
      <div className="min-h-full p-6 max-w-md mx-auto flex flex-col">
        <h1 className="text-2xl font-bold mb-2">Придумай PIN-код</h1>
        <p className="text-ton-muted text-sm mb-6">
          6 цифр для разблокировки кошелька на этом устройстве.
        </p>
        <PinPad
          value={pin1}
          onChange={(v) => {
            setError(null)
            setPin1(v)
          }}
          onComplete={() => setStep('pin-confirm')}
        />
        <button
          onClick={() => setStep('mnemonic')}
          className="text-ton-muted text-sm mt-6"
        >
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
            const words = mnemonic.trim().split(/\s+/).map((w) => w.toLowerCase())
            const keys = await walletFromMnemonic(words)
            const vault = await encryptMnemonic(words.join(' '), pin1)
            persistVault({
              vault,
              address: keys.address,
              createdAt: Date.now(),
            })
            haptic('success')
            markBackedUp()
            onImported(keys)
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось импортировать')
          } finally {
            setBusy(false)
          }
        }}
      />
      {error && (
        <div className="text-red-400 text-sm mt-4 text-center">{error}</div>
      )}
      {busy && (
        <div className="text-ton-muted text-sm mt-4 text-center">
          Шифрование…
        </div>
      )}
      <button
        onClick={() => {
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
