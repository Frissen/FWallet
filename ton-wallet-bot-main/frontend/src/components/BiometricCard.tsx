import { useEffect, useState } from 'react'
import {
  biometricLabel,
  clearBiometric,
  detectBackend,
  enrollBiometric,
  isBiometricEnrolled,
} from '../lib/biometric'
import { decryptMnemonic } from '../lib/crypto'
import { loadVault } from '../lib/storage'
import { PinPad, PIN_LENGTH } from './PinPad'

/**
 * Settings card for managing Face ID / Touch ID quick-unlock.
 *
 * Enrolling asks for the current PIN once. We verify it against the
 * on-device vault before storing — that way we never wrap a wrong PIN
 * which would lock the user out of biometric unlock until they reset.
 */
export function BiometricCard() {
  const [backend, setBackend] = useState<'tg' | 'webauthn' | 'none' | null>(
    null,
  )
  const [label, setLabel] = useState('Face ID / Touch ID')
  const [enrolled, setEnrolled] = useState(isBiometricEnrolled())
  const [mode, setMode] = useState<'idle' | 'pin' | 'working'>('idle')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    void detectBackend().then(setBackend)
    void biometricLabel().then(setLabel)
  }, [])

  function startEnroll() {
    setError(null)
    setInfo(null)
    setPin('')
    setMode('pin')
  }

  function disable() {
    clearBiometric()
    setEnrolled(false)
    setInfo(`${label} отключён`)
    setError(null)
  }

  async function confirmPin(value: string) {
    if (value.length !== PIN_LENGTH) return
    setMode('working')
    setError(null)
    setInfo(null)
    try {
      const vault = loadVault()
      if (!vault) throw new Error('Кошелёк не найден')
      // Verify PIN against the vault first so we never store a wrong one.
      await decryptMnemonic(vault.vault, value)
      await enrollBiometric(value)
      setEnrolled(true)
      setInfo(`${label} настроен — теперь можно входить без PIN`)
      setMode('idle')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/decrypt|operation/i.test(msg)) {
        setError('Неверный PIN')
      } else if (/cancel|NotAllowed|aborted|отменена/i.test(msg)) {
        setError('Отменено')
      } else {
        setError(msg || `Не удалось настроить ${label}`)
      }
      setMode('pin')
      setPin('')
    }
  }

  if (backend === null) return null

  return (
    <div className="bg-ton-card border border-ton-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold">{label}</h2>
        {enrolled && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            включено
          </span>
        )}
      </div>

      {backend === 'none' && (
        <p className="text-xs text-ton-muted">
          Биометрия не поддерживается ни Telegram-клиентом, ни этим
          браузером. Обнови Telegram до последней версии или открой Mini App
          через системный браузер.
        </p>
      )}

      {backend !== 'none' && mode === 'idle' && (
        <>
          <p className="text-xs text-ton-muted mb-3">
            Входи в кошелёк по {label} вместо PIN. PIN остаётся как
            запасной способ — он понадобится, если биометрия сбросится.
          </p>
          {!enrolled ? (
            <button
              onClick={startEnroll}
              className="w-full py-2.5 rounded-xl bg-ton-primary hover:brightness-110 text-sm font-semibold"
            >
              Включить {label}
            </button>
          ) : (
            <button
              onClick={disable}
              className="w-full py-2.5 rounded-xl bg-ton-card border border-ton-border hover:bg-ton-border text-sm font-semibold"
            >
              Отключить {label}
            </button>
          )}
        </>
      )}

      {backend !== 'none' && mode === 'pin' && (
        <>
          <p className="text-xs text-ton-muted mb-3 text-center">
            Подтверди текущий PIN, потом приложи {label}
          </p>
          <PinPad
            value={pin}
            onChange={(v) => {
              setPin(v)
              setError(null)
            }}
            onComplete={confirmPin}
            disabled={false}
          />
          <button
            onClick={() => {
              setMode('idle')
              setPin('')
              setError(null)
            }}
            className="w-full mt-3 text-xs text-ton-muted hover:text-ton-text"
          >
            Отмена
          </button>
        </>
      )}

      {backend !== 'none' && mode === 'working' && (
        <p className="text-xs text-ton-muted text-center py-4">
          Жди подтверждения {label}…
        </p>
      )}

      {error && (
        <p className="text-xs text-red-400 mt-3 text-center">{error}</p>
      )}
      {info && !error && (
        <p className="text-xs text-emerald-300 mt-3 text-center">{info}</p>
      )}
    </div>
  )
}
