import { useEffect, useRef, useState } from 'react'
import { copyText } from '../lib/clipboard'
import { markBackedUp } from '../lib/storage'
import { haptic } from '../lib/telegram'

interface Props {
  mnemonic: string[]
  onClose: () => void
  /** Called after the user confirms they saved the phrase. */
  onSaved?: () => void
}

// Seed phrase viewer. Deliberately cheap to render: no CSS blur filters (they
// are very slow on mobile WebViews) — hidden words are plain dots — and the
// copy action uses a WebView-safe fallback with visible feedback.
export function SeedBackup({ mnemonic, onClose, onSaved }: Props) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    [],
  )

  async function onCopy() {
    const ok = await copyText(mnemonic.join(' '))
    haptic(ok ? 'success' : 'error')
    setCopied(ok ? 'ok' : 'fail')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(null), 2500)
  }

  return (
    <div className="min-h-full p-5 max-w-md mx-auto pb-24">
      <h1 className="text-2xl font-bold mb-2">Seed-фраза</h1>
      <p className="text-ton-muted text-sm mb-4">
        Это 24 слова для восстановления кошелька. Любой, кто их знает,
        получает доступ к средствам. Никому не показывай и не отправляй в
        чат. Восстановить фразу, если её потерять, нельзя.
      </p>

      <div className="fw-card p-4 mb-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {mnemonic.map((w, i) => (
            <div key={i} className="flex items-baseline gap-2 text-sm">
              <span className="text-ton-muted w-6 text-right tabular-nums">
                {i + 1}
              </span>
              <span className="font-mono">{revealed ? w : '••••••'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          onClick={() => setRevealed((r) => !r)}
          className="py-3 rounded-xl bg-ton-card border border-ton-border font-semibold"
        >
          {revealed ? 'Скрыть' : 'Показать'}
        </button>
        <button
          onClick={onCopy}
          disabled={!revealed}
          className="py-3 rounded-xl bg-ton-card border border-ton-border font-semibold disabled:opacity-40"
        >
          {copied === 'ok'
            ? 'Скопировано ✓'
            : copied === 'fail'
              ? 'Не вышло'
              : 'Скопировать'}
        </button>
      </div>
      {copied === 'fail' && (
        <p className="text-amber-400 text-xs mb-3">
          Не удалось скопировать автоматически. Нажми «Показать» и запиши
          слова вручную по порядку.
        </p>
      )}

      <button
        onClick={() => {
          markBackedUp()
          haptic('success')
          onSaved?.()
          onClose()
        }}
        className="w-full py-3.5 rounded-xl fw-cta-primary font-semibold mb-2"
      >
        Я сохранил фразу
      </button>
      <button onClick={onClose} className="w-full py-3 text-ton-muted text-sm">
        Закрыть
      </button>
    </div>
  )
}
