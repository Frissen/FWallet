import { useEffect, useMemo, useState } from 'react'
import {
  SUPPORTED_FROM,
  getSwapQuote,
  createSwap,
  type QuoteResult,
  type CreatedSwap,
} from '../lib/swap'
import { type WalletKeys } from '../lib/ton'
import { type MultiChainKeys } from '../lib/wallet'

interface Props {
  keys: WalletKeys
  all: MultiChainKeys | null
}

export function SwapTab({ keys, all }: Props) {
  const [from, setFrom] = useState<(typeof SUPPORTED_FROM)[number]>(SUPPORTED_FROM[0])
  const btcOption = SUPPORTED_FROM.find((o) => o.ticker === 'btc') ?? SUPPORTED_FROM[0]
  const [to, setTo] = useState<(typeof SUPPORTED_FROM)[number]>(btcOption)
  const [amount, setAmount] = useState('1')
  const [quote, setQuote] = useState<QuoteResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedSwap | null>(null)

  const payoutAddress = useMemo(() => {
    switch (to.network) {
      case 'ton':
        return keys.address
      case 'eth':
      case 'bsc':
        return all?.evm?.address ?? ''
      case 'sol':
        return all?.sol?.publicKey ?? ''
      case 'btc':
        return all?.btc?.address ?? ''
      default:
        return ''
    }
  }, [to.network, keys.address, all])

  // Refresh quote with debounce when inputs change.
  useEffect(() => {
    if (!amount || (from.ticker === to.ticker && from.network === to.network)) {
      setQuote(null)
      return
    }
    setError(null)
    let cancelled = false
    const id = setTimeout(async () => {
      try {
        const q = await getSwapQuote(
          {
            from: from.ticker,
            to: to.ticker,
            fromNetwork: from.network,
            toNetwork: to.network,
          },
          amount.replace(',', '.'),
        )
        if (!cancelled) {
          setQuote(q)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Ошибка котировки')
          setQuote(null)
        }
      }
    }, 600)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [from, to, amount])

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      if (!payoutAddress) {
        throw new Error(`Нет адреса в сети ${to.network}. Дождись загрузки ключей.`)
      }
      const swap = await createSwap({
        pair: {
          from: from.ticker,
          to: to.ticker,
          fromNetwork: from.network,
          toNetwork: to.network,
        },
        fromAmount: amount.replace(',', '.'),
        payoutAddress,
        rateId: quote?.rateId,
      })
      setCreated(swap)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <div className="p-5 max-w-md mx-auto pb-24">
        <h1 className="text-xl font-bold mb-4">Свап создан</h1>
        <div className="bg-ton-card border border-ton-border rounded-2xl p-4 space-y-3">
          <Row
            label="Отправь точную сумму"
            value={`${created.payinAmount} ${from.label}`}
          />
          <div>
            <div className="text-xs text-ton-muted mb-1">На адрес агрегатора</div>
            <div className="font-mono text-[11px] break-all bg-ton-card/60 border border-ton-border rounded-lg p-2">
              {created.payinAddress}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(created.payinAddress)}
              className="text-xs text-ton-primary hover:underline mt-1"
            >
              Скопировать
            </button>
          </div>
          <Row label="Получишь (примерно)" value={`${created.expectedAmount} ${to.label}`} />
          <Row label="На свой адрес" value={created.payoutAddress} mono />
          <Row label="ID транзакции" value={created.id} mono />
        </div>
        <p className="text-xs text-ton-muted mt-3">
          Открой кошелёк {from.label}, отправь точную сумму на адрес выше.
          Агрегатор получит, обменяет и пришлёт {to.label} на твой адрес —
          обычно 5-30 мин.
        </p>
        <button
          onClick={() => setCreated(null)}
          className="w-full py-3 rounded-xl bg-ton-card border border-ton-border hover:bg-ton-border font-semibold mt-3"
        >
          Новый свап
        </button>
      </div>
    )
  }

  return (
    <div className="p-5 max-w-md mx-auto pb-24 space-y-4">
      <h1 className="text-xl font-bold">Обмен криптовалют</h1>
      <p className="text-xs text-ton-muted">
        Кросс-чейн обмен через ChangeNOW. Без KYC. Деньги уходят на адрес
        агрегатора, оттуда — на твой адрес назначения. Сервисная комиссия{' '}
        {quote?.feePercent ?? '3.50'}% уже учтена в сумме «получишь».
      </p>

      <Card title="Отдаёшь">
        <Selector
          options={SUPPORTED_FROM}
          value={from}
          onChange={setFrom}
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          className="w-full mt-2 px-3 py-2.5 bg-ton-card border border-ton-border rounded-xl text-base focus:outline-none focus:border-ton-primary"
          placeholder="Сумма"
        />
      </Card>

      <div className="text-center text-2xl text-ton-muted">↓</div>

      <Card title="Получишь">
        <Selector
          options={SUPPORTED_FROM.filter((x) => x.ticker !== from.ticker)}
          value={to}
          onChange={setTo}
        />
        <div className="mt-2 px-3 py-2.5 bg-ton-card/60 border border-ton-border rounded-xl text-base">
          {quote ? `≈ ${quote.toAmount} ${to.label}` : '—'}
        </div>
        {quote && (
          <div className="text-[11px] text-ton-muted mt-2 space-y-0.5">
            <div>До комиссии: {quote.toAmountGross} {to.label}</div>
            <div>Комиссия сервиса: {quote.serviceFee} {to.label}</div>
            {quote.minAmount > 0 && (
              <div>
                Мин. сумма: {quote.minAmount} {from.label}
                {quote.maxAmount ? `, макс: ${quote.maxAmount}` : ''}
              </div>
            )}
          </div>
        )}
      </Card>

      {error && <div className="text-red-400 text-sm">{error}</div>}

      <button
        onClick={submit}
        disabled={busy || !quote || !payoutAddress}
        className="w-full py-3 rounded-xl bg-ton-primary hover:brightness-110 font-semibold disabled:opacity-40"
      >
        {busy ? 'Создаём…' : 'Создать обмен'}
      </button>
    </div>
  )
}

function Card({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-ton-card border border-ton-border rounded-2xl p-4">
      <div className="text-xs text-ton-muted mb-2">{title}</div>
      {children}
    </div>
  )
}

function Selector<T extends { ticker: string; label: string; network: string }>({
  options,
  value,
  onChange,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
}) {
  // Tickers can repeat across networks (e.g. usdt on trx/eth/bsc), so the
  // option value must be ticker+network.
  const key = (o: T) => `${o.ticker}@${o.network}`
  return (
    <select
      value={key(value)}
      onChange={(e) => {
        const next = options.find((o) => key(o) === e.target.value)
        if (next) onChange(next)
      }}
      className="w-full px-3 py-2.5 bg-ton-card border border-ton-border rounded-xl text-sm focus:outline-none focus:border-ton-primary"
    >
      {options.map((o) => (
        <option key={key(o)} value={key(o)}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <div className="text-xs text-ton-muted mb-1">{label}</div>
      <div className={mono ? 'font-mono text-[11px] break-all' : 'text-sm font-semibold'}>
        {value}
      </div>
    </div>
  )
}
