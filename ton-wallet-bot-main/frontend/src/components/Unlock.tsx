import { useEffect, useRef, useState } from 'react'
import { decryptMnemonic } from '../lib/crypto'
import { walletFromMnemonic, type WalletKeys } from '../lib/ton'
import { type StoredVault } from '../lib/storage'
import { wipeWallet } from '../lib/cloudVault'
import {
  clearBiometric,
  isBiometricEnrolled,
  unlockWithBiometric,
} from '../lib/biometric'
import { PinPad, PIN_LENGTH } from './PinPad'
import { haptic } from '../lib/telegram'

interface Props {
  vault: StoredVault
  onUnlocked: (keys: WalletKeys) => void
  onForget: () => void
}

export function Unlock({ vault, onUnlocked, onForget }: Props) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)
  const bioEnrolled = isBiometricEnrolled()
  const triedAutoBio = useRef(false)

  async function tryUnlock(value: string) {
    if (value.length !== PIN_LENGTH || busy) return
    setBusy(true)
    setError(null)
    try {
      const phrase = await decryptMnemonic(vault.vault, value)
      const keys = await walletFromMnemonic(phrase.split(' '))
      haptic('success')
      onUnlocked(keys)
    } catch {
      haptic('error')
      setError('Неверный код')
      setShake(true)
      setTimeout(() => {
        setPin('')
        setShake(false)
      }, 400)
    } finally {
      setBusy(false)
    }
  }

  async function tryBio() {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      const recoveredPin = await unlockWithBiometric()
      const phrase = await decryptMnemonic(vault.vault, recoveredPin)
      const keys = await walletFromMnemonic(phrase.split(' '))
      haptic('success')
      onUnlocked(keys)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Quietly swallow user-cancelled prompts; surface real failures.
      const cancelled =
        /cancel|NotAllowed|aborted|отменена/i.test(msg)
      if (!cancelled) {
        setError(msg || 'Face ID не сработал — введи PIN')
      }
    } finally {
      setBusy(false)
    }
  }

  // Auto-prompt Face ID once on mount if it's enrolled.
  useEffect(() => {
    if (bioEnrolled && !triedAutoBio.current) {
      triedAutoBio.current = true
      void tryBio()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-6">
      <div className="w-14 h-14 rounded-2xl bg-ton-primary flex items-center justify-center text-2xl mb-4">
        🔒
      </div>
      <h1 className="text-2xl font-bold mb-1">С возвращением</h1>
      <p className="text-ton-muted text-sm mb-1 font-mono break-all max-w-xs text-center">
        {vault.address.slice(0, 6)}…{vault.address.slice(-6)}
      </p>
      <p className="text-ton-muted text-sm mb-8">
        {bioEnrolled
          ? 'Используй Face ID или введи PIN'
          : 'Введите PIN-код для разблокировки'}
      </p>

      {bioEnrolled && (
        <button
          onClick={tryBio}
          disabled={busy}
          className="mb-6 flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-ton-primary/15 border border-ton-primary/30 text-ton-primary text-sm font-semibold hover:bg-ton-primary/25 disabled:opacity-50"
        >
          <span aria-hidden>🪪</span>
          <span>Войти по Face&nbsp;ID</span>
        </button>
      )}

      <PinPad
        value={pin}
        onChange={(v) => {
          setError(null)
          setPin(v)
        }}
        onComplete={tryUnlock}
        disabled={busy}
        shake={shake}
      />

      {error && (
        <div className="text-red-400 text-sm mt-4 text-center">{error}</div>
      )}
      {busy && (
        <div className="text-ton-muted text-sm mt-4 text-center">
          Расшифровка…
        </div>
      )}

      <button
        onClick={() => {
          if (
            confirm(
              'Кошелёк будет удалён с устройства и из облака Telegram. Убедись, что у тебя сохранена seed-фраза.',
            )
          ) {
            clearBiometric()
            void wipeWallet()
            onForget()
          }
        }}
        className="text-ton-muted text-xs mt-8 hover:text-red-400"
      >
        Забыть кошелёк
      </button>
    </div>
  )
}
