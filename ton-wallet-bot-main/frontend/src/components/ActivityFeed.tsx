import { useEffect, useState } from 'react'
import {
  fetchActivity,
  formatTimeAgo,
  type ActivityItem,
} from '../lib/activity'

interface Props {
  address: string
  /** Max items to display in the compact home preview. */
  limit?: number
  /** Compact mode hides the header. */
  compact?: boolean
}

export function ActivityFeed({ address, limit = 6, compact }: Props) {
  const [items, setItems] = useState<ActivityItem[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!address) return
    setError(false)
    setItems(null)
    void fetchActivity(address, limit).then(
      (data) => {
        if (!cancelled) setItems(data)
      },
      () => {
        if (!cancelled) setError(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [address, limit])

  if (!address) return null

  return (
    <div className="fw-card p-4">
      {!compact && (
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Активность</h2>
          <span className="text-[10px] text-ton-muted">{items?.length ?? 0}</span>
        </div>
      )}
      {error && (
        <div className="text-xs text-ton-muted py-4 text-center">
          Не удалось загрузить активность
        </div>
      )}
      {!error && items === null && (
        <div className="text-xs text-ton-muted py-4 text-center">Загрузка…</div>
      )}
      {!error && items !== null && items.length === 0 && (
        <div className="text-xs text-ton-muted py-4 text-center">
          Пока тут пусто. Сделай первый перевод — и история появится здесь.
        </div>
      )}
      {!error && items !== null && items.length > 0 && (
        <ul className="divide-y divide-ton-border -mx-1">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-1 py-2.5">
              <span
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                style={iconStyle(it.kind)}
              >
                <ActivityIcon kind={it.kind} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{it.label}</div>
                {it.counterparty && (
                  <div className="text-[11px] text-ton-muted truncate">
                    {it.counterparty}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div
                  className={`text-sm font-semibold ${amountColor(it.kind)}`}
                >
                  {amountSign(it.kind)}
                  {it.amount}
                </div>
                <div className="text-[10px] text-ton-muted">
                  {formatTimeAgo(it.ts)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function iconStyle(kind: string): React.CSSProperties {
  const palette: Record<string, string> = {
    ton_in: '#34D399',
    ton_out: '#F87171',
    jetton_in: '#22D3EE',
    jetton_out: '#FB923C',
    nft_in: '#F472B6',
    nft_out: '#A78BFA',
    contract: '#FACC15',
  }
  const c = palette[kind] ?? '#3390EC'
  return {
    background: `color-mix(in srgb, ${c} 18%, transparent)`,
    color: c,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 30%, transparent)`,
  }
}

function amountSign(kind: string): string {
  if (kind.endsWith('_in')) return '+ '
  if (kind.endsWith('_out')) return '− '
  return ''
}

function amountColor(kind: string): string {
  if (kind.endsWith('_in')) return 'text-emerald-400'
  if (kind.endsWith('_out')) return 'text-rose-300'
  return ''
}

function ActivityIcon({ kind }: { kind: string }) {
  if (kind === 'ton_in' || kind === 'jetton_in' || kind === 'nft_in') {
    return (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none">
        <path
          d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (kind === 'contract') {
    return (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none">
        <path
          d="M9 4h6l5 5v11a0 0 0 0 1 0 0H4V4h5z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none">
      <path
        d="M12 20V8m0 0l-5 5m5-5l5 5M4 4h16"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
