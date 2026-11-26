import { useEffect } from 'react'
import { haptic } from '../lib/telegram'

export const PIN_LENGTH = 6

interface Props {
  value: string
  onChange: (next: string) => void
  onComplete?: (pin: string) => void
  disabled?: boolean
  shake?: boolean
}

/**
 * 6-digit numeric keypad. Entered digits are masked as filled dots.
 *
 * The keypad emits `onComplete(pin)` when the value reaches PIN_LENGTH so
 * callers can auto-submit without an explicit "OK" button.
 */
export function PinPad({ value, onChange, onComplete, disabled, shake }: Props) {
  useEffect(() => {
    if (value.length === PIN_LENGTH && onComplete) {
      // Defer to next tick so React paints the last filled dot first.
      const t = setTimeout(() => onComplete(value), 50)
      return () => clearTimeout(t)
    }
  }, [value, onComplete])

  // Keyboard support — typing on a physical keyboard fills the PIN too.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (disabled) return
      if (/^[0-9]$/.test(e.key) && value.length < PIN_LENGTH) {
        onChange(value + e.key)
      } else if (e.key === 'Backspace') {
        onChange(value.slice(0, -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [value, onChange, disabled])

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

  function press(d: string) {
    if (disabled || value.length >= PIN_LENGTH) return
    haptic('light')
    onChange(value + d)
  }

  function backspace() {
    if (disabled || value.length === 0) return
    haptic('light')
    onChange(value.slice(0, -1))
  }

  return (
    <div className="w-full max-w-xs mx-auto">
      <div
        className={`flex justify-center gap-3 mb-8 transition-transform ${
          shake ? 'animate-pin-shake' : ''
        }`}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className={`w-3 h-3 rounded-full border-2 transition-all ${
              i < value.length
                ? 'bg-ton-primary border-ton-primary scale-110'
                : 'border-ton-border'
            }`}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {digits.map((d) => (
          <KeyButton key={d} onClick={() => press(d)} disabled={disabled}>
            {d}
          </KeyButton>
        ))}
        <div /> {/* empty slot left of zero */}
        <KeyButton onClick={() => press('0')} disabled={disabled}>
          0
        </KeyButton>
        <KeyButton onClick={backspace} disabled={disabled || value.length === 0}>
          ⌫
        </KeyButton>
      </div>
    </div>
  )
}

function KeyButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="aspect-square rounded-2xl bg-ton-card border border-ton-border text-2xl font-medium hover:bg-ton-card-hover active:scale-95 disabled:opacity-30 transition-all"
    >
      {children}
    </button>
  )
}
