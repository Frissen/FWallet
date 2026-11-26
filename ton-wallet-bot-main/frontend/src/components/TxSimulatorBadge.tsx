import { useEffect, useState } from 'react'
import { simulateTonTransfer, type SimulationResult } from '../lib/simulator'

interface Props {
  fromAddress: string
  toAddress: string
  amountNano: bigint
  balanceNano: bigint
}

export function TxSimulatorBadge(props: Props) {
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setResult(null)
    simulateTonTransfer({
      fromAddress: props.fromAddress,
      toAddress: props.toAddress,
      amountNano: props.amountNano,
      balanceNano: props.balanceNano,
    })
      .then((r) => {
        if (!cancelled) setResult(r)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [props.fromAddress, props.toAddress, props.amountNano, props.balanceNano])

  if (loading) {
    return (
      <div className="bg-ton-card border border-ton-border rounded-xl p-3 mb-3 text-xs text-ton-muted flex items-center gap-2">
        <span className="animate-spin w-3 h-3 border border-ton-primary border-t-transparent rounded-full" />
        Анализ транзакции…
      </div>
    )
  }

  if (!result) return null

  const palette =
    result.level === 'danger'
      ? {
          bg: 'bg-rose-500/10',
          border: 'border-rose-500/40',
          text: 'text-rose-300',
          icon: '⚠️',
        }
      : result.level === 'caution'
        ? {
            bg: 'bg-amber-500/10',
            border: 'border-amber-500/40',
            text: 'text-amber-300',
            icon: '⚠',
          }
        : {
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/30',
            text: 'text-emerald-300',
            icon: '✓',
          }

  return (
    <div className={`rounded-xl border ${palette.bg} ${palette.border} p-3 mb-3`}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-2 text-left"
      >
        <span className="text-base shrink-0">{palette.icon}</span>
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-semibold ${palette.text}`}>
            Fwallet Check · {result.summary}
          </div>
          <div className="text-[10px] text-ton-muted mt-0.5">
            Риск {result.score}/100 · {result.checks.length} проверок ·{' '}
            <span className="underline">{expanded ? 'свернуть' : 'показать детали'}</span>
          </div>
        </div>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {result.checks.map((c) => (
            <div
              key={c.id}
              className="flex items-start gap-2 text-[11px] leading-snug"
            >
              <span
                className={`shrink-0 ${
                  c.level === 'danger'
                    ? 'text-rose-300'
                    : c.level === 'caution'
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                }`}
              >
                {c.level === 'danger' ? '✕' : c.level === 'caution' ? '!' : '✓'}
              </span>
              <div className="flex-1">
                <div className="font-semibold">{c.title}</div>
                <div className="text-ton-muted">{c.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
