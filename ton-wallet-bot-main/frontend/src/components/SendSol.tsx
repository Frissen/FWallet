import { useState } from 'react'
import {
  type SolKeys,
  sendSolNative,
  sendSplToken,
  computeSolCommission,
  SOL_TOKENS,
} from '../lib/sol'

interface Props {
  keys: SolKeys
  mint?: string // SPL mint, if sending a token
  onClose: () => void
  onSent: () => void
}

export function SendSol({ keys, mint, onClose, onSent }: Props) {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const token = mint ? SOL_TOKENS.find((t) => t.mint === mint) : undefined
  const symbol = token ? token.symbol : 'SOL'

  let estFee = ''
  if (!token && amount && /^\d+(\.\d+)?$/.test(amount.replace(',', '.'))) {
    const b = computeSolCommission(amount.replace(',', '.'))
    estFee = `${(Number(b.serviceFee) / 1e9).toFixed(6)} SOL (${b.feePercent}%)`
  }

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      if (!to.trim()) throw new Error('Введи адрес получателя')
      if (!amount) throw new Error('Введи сумму')
      let txid: string
      if (token) {
        const r = await sendSplToken({
          keys,
          to: to.trim(),
          amountStr: amount.replace(',', '.'),
          token,
        })
        txid = r.txid
      } else {
        const r = await sendSolNative({
          keys,
          to: to.trim(),
          amountStr: amount.replace(',', '.'),
        })
        txid = r.txid
      }
      setDone(txid)
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
          <div className="text-xs text-ton-muted mb-4">{symbol} • Solana</div>
          <a
            href={`https://solscan.io/tx/${done}`}
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
        <h1 className="text-base font-bold">Отправить {symbol}</h1>
        <span className="w-12" />
      </div>
      <div className="space-y-3">
        <Field label="Адрес получателя" value={to} onChange={setTo} placeholder="..." />
        <Field
          label={`Сумма (${symbol})`}
          value={amount}
          onChange={setAmount}
          placeholder="0.0"
        />
        {estFee && (
          <p className="text-[11px] text-ton-muted">
            Комиссия сервиса: {estFee}
          </p>
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
