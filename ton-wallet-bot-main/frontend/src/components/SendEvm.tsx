import { useState } from 'react'
import {
  type EvmChainConfig,
  type EvmTokenConfig,
  type EvmKeys,
  computeEvmCommission,
  sendEvmNative,
  sendEvmToken,
} from '../lib/evm'

interface Props {
  chain: EvmChainConfig
  token?: EvmTokenConfig
  keys: EvmKeys
  onClose: () => void
  onSent: () => void
}

export function SendEvm({ chain, token, keys, onClose, onSent }: Props) {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const isToken = !!token
  const symbol = isToken ? token!.symbol : chain.symbol
  const decimals = isToken ? token!.decimals : 18

  let breakdown: ReturnType<typeof computeEvmCommission> | null = null
  if (amount && /^\d+(\.\d+)?$/.test(amount.replace(',', '.'))) {
    try {
      breakdown = computeEvmCommission(amount.replace(',', '.'), decimals)
    } catch {
      breakdown = null
    }
  }

  const submit = async () => {
    if (!to || !amount) return
    setError(null)
    setBusy(true)
    try {
      if (!/^0x[a-fA-F0-9]{40}$/.test(to.trim())) {
        throw new Error('Некорректный адрес получателя')
      }
      let txid: string
      if (isToken) {
        const r = await sendEvmToken({
          chain,
          token: token!,
          keys,
          to: to.trim(),
          amountStr: amount.replace(',', '.'),
        })
        txid = r.txid
      } else {
        const r = await sendEvmNative({
          chain,
          keys,
          to: to.trim(),
          amountStr: amount.replace(',', '.'),
        })
        txid = r.txid
      }
      setDone(txid)
      onSent()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка отправки')
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
          <div className="text-xs text-ton-muted mb-4">{symbol} • {chain.name}</div>
          <a
            href={`${chain.explorer}/tx/${done}`}
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
        <button onClick={onClose} className="text-sm text-ton-muted">
          ← Назад
        </button>
        <h1 className="text-base font-bold">
          Отправить {symbol}
        </h1>
        <span className="w-12" />
      </div>
      <div className="space-y-3">
        <Field
          label="Адрес получателя"
          placeholder="0x…"
          value={to}
          onChange={setTo}
        />
        <Field
          label={`Сумма (${symbol})`}
          placeholder="0.0"
          value={amount}
          onChange={setAmount}
        />
        {breakdown && (
          <div className="bg-ton-card border border-ton-border rounded-xl p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-ton-muted">Сумма</span>
              <span>{breakdown.amountStr} {symbol}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ton-muted">Комиссия сервиса {breakdown.feePercent}%</span>
              <span>{breakdown.serviceFeeStr} {symbol}</span>
            </div>
            <div className="flex justify-between font-semibold pt-1 border-t border-ton-border">
              <span>Итого</span>
              <span>{breakdown.totalDebitStr} {symbol}</span>
            </div>
            <p className="text-[10px] text-amber-400 pt-1">
              Газ ({chain.symbol}) оплачивается отдельно из {chain.symbol}-баланса.
            </p>
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
  placeholder,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
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
