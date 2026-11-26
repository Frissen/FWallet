import { useEffect, useState } from 'react'
import {
  type BtcKeys,
  computeBtcCommission,
  sendBtc,
  type BtcSendBreakdown,
} from '../lib/btc'

interface Props {
  keys: BtcKeys
  onClose: () => void
  onSent: () => void
}

export function SendBtc({ keys, onClose, onSent }: Props) {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [breakdown, setBreakdown] = useState<BtcSendBreakdown | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // Compute breakdown reactively (network fee fetched async).
  useEffect(() => {
    if (!amount || !/^\d+(\.\d+)?$/.test(amount.replace(',', '.'))) {
      setBreakdown(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const b = await computeBtcCommission(amount.replace(',', '.'))
        if (!cancelled) setBreakdown(b)
      } catch {
        if (!cancelled) setBreakdown(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [amount])

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      if (!to.trim().startsWith('bc1') && !to.trim().startsWith('1') && !to.trim().startsWith('3')) {
        throw new Error('Адрес должен быть BTC mainnet')
      }
      const r = await sendBtc({ keys, to: to.trim(), amountStr: amount.replace(',', '.') })
      setDone(r.txid)
      onSent()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="p-5 max-w-md mx-auto">
        <div className="bg-ton-card border border-ton-border rounded-2xl p-6 text-center">
          <div className="text-3xl mb-2">✅</div>
          <div className="text-lg font-bold mb-1">Отправлено</div>
          <div className="text-xs text-ton-muted mb-4">BTC</div>
          <a
            href={`https://mempool.space/tx/${done}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-ton-primary break-all hover:underline"
          >
            {done}
          </a>
          <button
            onClick={onClose}
            className="mt-5 w-full py-3 rounded-xl bg-ton-primary hover:brightness-110 font-semibold"
          >
            Готово
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 max-w-md mx-auto pb-24">
      <div className="flex items-center justify-between mb-4">
        <button onClick={onClose} className="text-sm text-ton-muted">← Назад</button>
        <h1 className="text-base font-bold">Отправить BTC</h1>
        <span className="w-12" />
      </div>
      <div className="space-y-3">
        <Field
          label="Адрес получателя (bc1…)"
          value={to}
          onChange={setTo}
          placeholder="bc1..."
        />
        <Field
          label="Сумма (BTC)"
          value={amount}
          onChange={setAmount}
          placeholder="0.001"
        />
        {breakdown && (
          <div className="bg-ton-card border border-ton-border rounded-xl p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-ton-muted">Сумма</span>
              <span>{breakdown.amountStr} BTC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ton-muted">Комиссия сервиса {breakdown.feePercent}%</span>
              <span>{breakdown.serviceFeeStr} BTC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ton-muted">Сеть (примерно)</span>
              <span>{breakdown.estimatedNetworkFeeStr} BTC</span>
            </div>
            <div className="flex justify-between font-semibold pt-1 border-t border-ton-border">
              <span>Списание</span>
              <span>{breakdown.totalDebitStr} BTC</span>
            </div>
          </div>
        )}
        {error && <div className="text-red-400 text-sm">{error}</div>}
        <button
          onClick={submit}
          disabled={busy || !to || !amount}
          className="w-full py-3 rounded-xl bg-ton-primary hover:brightness-110 font-semibold disabled:opacity-40"
        >
          {busy ? 'Отправляем…' : 'Отправить'}
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <label className="block">
      <span className="block text-xs text-ton-muted mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 bg-ton-card border border-ton-border rounded-xl text-sm focus:outline-none focus:border-ton-primary"
      />
    </label>
  )
}
