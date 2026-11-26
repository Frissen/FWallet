import { useEffect, useMemo, useState } from 'react'
import {
  listAds,
  listMyAds,
  listMyDeals,
  createAd,
  deleteAd,
  openDeal,
  getDeal,
  dealAction,
  postDealMessage,
  type P2PAd,
  type AdAsset,
  type AdCurrency,
  type AdSide,
  type P2PDeal,
  type PaymentMethod,
  PAYMENT_METHODS,
} from '../lib/p2p'
import { getMyTgId } from '../lib/referral'
import { BOT_USERNAME } from '../lib/config'
import { type WalletKeys, getBalance, fromNano } from '../lib/ton'
import { type MultiChainKeys } from '../lib/wallet'
import { getBtcBalance, formatBtc } from '../lib/btc'
import { getSolBalance, formatSol } from '../lib/sol'
import {
  EVM_CHAINS,
  getEvmNativeBalance,
  getEvmTokenBalance,
} from '../lib/evm'
import { formatUnits } from 'ethers'

const ASSETS: AdAsset[] = [
  'TON',
  'ETH',
  'BNB',
  'SOL',
  'BTC',
  'USDT-ERC20',
  'USDC-ERC20',
]
const CURRENCIES: AdCurrency[] = ['RUB', 'USD', 'EUR', 'UAH', 'KZT']

interface P2PTabProps {
  keys: WalletKeys
  all: MultiChainKeys | null
}

export function P2PTab({ keys, all }: P2PTabProps) {
  const tgId = getMyTgId()
  const [view, setView] = useState<'board' | 'mine' | 'create' | 'deal'>('board')
  const [activeDeal, setActiveDeal] = useState<P2PDeal | null>(null)

  if (!tgId) {
    return (
      <div className="p-5 max-w-md mx-auto pb-24">
        <h1 className="text-xl font-bold mb-3">P2P</h1>
        <div className="bg-ton-card border border-ton-border rounded-2xl p-4 text-sm">
          P2P доска работает только внутри Telegram (нужен твой TG ID для
          анонимной сделки через бота). Открой кошелёк через{' '}
          <a
            href={`https://t.me/${BOT_USERNAME}`}
            target="_blank"
            rel="noreferrer"
            className="text-ton-primary hover:underline"
          >
            @{BOT_USERNAME}
          </a>{' '}
          и попробуй снова.
        </div>
      </div>
    )
  }

  if (view === 'deal' && activeDeal) {
    return (
      <DealView
        deal={activeDeal}
        tgId={Number(tgId)}
        onUpdate={(d) => setActiveDeal(d)}
        onClose={() => {
          setActiveDeal(null)
          setView('mine')
        }}
      />
    )
  }
  if (view === 'create') {
    return (
      <CreateAdView
        tgId={Number(tgId)}
        keys={keys}
        all={all}
        onClose={() => setView('board')}
      />
    )
  }

  return (
    <div className="p-5 max-w-md mx-auto pb-24 space-y-4">
      <h1 className="text-xl font-bold">P2P</h1>
      <div className="grid grid-cols-3 gap-2">
        <TabBtn active={view === 'board'} onClick={() => setView('board')}>
          Доска
        </TabBtn>
        <TabBtn active={view === 'mine'} onClick={() => setView('mine')}>
          Мои
        </TabBtn>
        <TabBtn active={false} onClick={() => setView('create')}>
          + Объявление
        </TabBtn>
      </div>

      {view === 'board' && (
        <BoardView
          tgId={Number(tgId)}
          onOpenDeal={(d) => {
            setActiveDeal(d)
            setView('deal')
          }}
        />
      )}
      {view === 'mine' && (
        <MyView
          tgId={Number(tgId)}
          onOpenDeal={(d) => {
            setActiveDeal(d)
            setView('deal')
          }}
        />
      )}
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`py-2 rounded-xl text-xs font-semibold transition ${
        active
          ? 'bg-ton-primary text-white'
          : 'bg-ton-card border border-ton-border hover:bg-ton-border text-ton-muted'
      }`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Board view (all open ads)
// ---------------------------------------------------------------------------

function BoardView({
  tgId,
  onOpenDeal,
}: {
  tgId: number
  onOpenDeal: (deal: P2PDeal) => void
}) {
  const [ads, setAds] = useState<P2PAd[] | null>(null)
  const [side, setSide] = useState<AdSide | undefined>(undefined)
  const [asset, setAsset] = useState<AdAsset | undefined>(undefined)
  const [currency, setCurrency] = useState<AdCurrency | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<P2PAd | null>(null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const list = await listAds({ side, asset, currency })
        setAds(list)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка')
      }
    })()
  }, [side, asset, currency])

  const submit = async () => {
    if (!open || !amount) return
    setBusy(true)
    setError(null)
    try {
      const deal = await openDeal({
        ad_id: open.id,
        taker_tg_id: tgId,
        amount: Number(amount.replace(',', '.')),
      })
      onOpenDeal(deal)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  if (open) {
    return (
      <div className="bg-ton-card border border-ton-border rounded-2xl p-4 space-y-3">
        <h2 className="text-sm font-semibold">Открыть сделку</h2>
        <div className="text-xs text-ton-muted">
          {open.side === 'sell' ? 'Продаёт' : 'Покупает'} {open.asset} за{' '}
          {open.currency} по {open.price}, способ: {open.payment_method}
        </div>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`Сумма (${open.min_amount}–${open.max_amount} ${open.asset})`}
          className="w-full px-3 py-2.5 bg-ton-card border border-ton-border rounded-xl text-sm focus:outline-none focus:border-ton-primary"
        />
        {error && <div className="text-red-400 text-xs">{error}</div>}
        <div className="flex gap-2">
          <button
            onClick={() => setOpen(null)}
            className="flex-1 py-2 rounded-xl bg-ton-card border border-ton-border text-sm"
          >
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={busy || !amount}
            className="flex-1 py-2 rounded-xl bg-ton-primary hover:brightness-110 text-sm font-semibold disabled:opacity-40"
          >
            {busy ? '…' : 'Открыть'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Sel value={side ?? ''} onChange={(v) => setSide((v || undefined) as AdSide)} options={[
          { v: '', label: 'все' },
          { v: 'sell', label: 'продают' },
          { v: 'buy', label: 'покупают' },
        ]} />
        <Sel value={asset ?? ''} onChange={(v) => setAsset((v || undefined) as AdAsset)} options={[
          { v: '', label: 'актив' },
          ...ASSETS.map((a) => ({ v: a, label: a })),
        ]} />
        <Sel value={currency ?? ''} onChange={(v) => setCurrency((v || undefined) as AdCurrency)} options={[
          { v: '', label: 'валюта' },
          ...CURRENCIES.map((c) => ({ v: c, label: c })),
        ]} />
      </div>

      {error && <div className="text-red-400 text-sm">{error}</div>}
      {ads === null && <div className="text-ton-muted text-sm">Загружаем…</div>}
      {ads && ads.length === 0 && (
        <div className="text-ton-muted text-sm bg-ton-card/50 rounded-xl p-4 text-center">
          Объявлений пока нет.
        </div>
      )}
      <div className="space-y-2">
        {ads?.map((ad) => (
          <button
            key={ad.id}
            onClick={() => {
              setOpen(ad)
              setAmount('')
            }}
            className="w-full text-left bg-ton-card border border-ton-border rounded-xl p-3 hover:bg-ton-border"
          >
            <div className="flex items-baseline justify-between mb-1">
              <span className="font-semibold text-sm">
                {ad.side === 'sell' ? '🟢 продаёт' : '🔵 покупает'} {ad.asset}
              </span>
              <span className="text-sm font-mono">
                {ad.price} {ad.currency}
              </span>
            </div>
            <div className="text-[11px] text-ton-muted">
              {ad.payment_method} · {ad.min_amount}–{ad.max_amount} {ad.asset}
            </div>
            {ad.note && (
              <div className="text-[11px] text-ton-muted mt-1 line-clamp-2">{ad.note}</div>
            )}
          </button>
        ))}
      </div>
    </>
  )
}

function Sel({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { v: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-ton-card border border-ton-border rounded-lg px-2 py-1.5 text-xs focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>{o.label}</option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Mine: my ads + active deals
// ---------------------------------------------------------------------------

function MyView({
  tgId,
  onOpenDeal,
}: {
  tgId: number
  onOpenDeal: (deal: P2PDeal) => void
}) {
  const [deals, setDeals] = useState<P2PDeal[]>([])
  const [error, setError] = useState<string | null>(null)
  const refresh = async () => {
    try {
      const d = await listMyDeals(tgId)
      setDeals(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }
  useEffect(() => {
    void refresh()
  }, [tgId])

  return (
    <>
      <h2 className="text-xs uppercase text-ton-muted">Мои сделки</h2>
      {error && <div className="text-red-400 text-sm">{error}</div>}
      {deals.length === 0 && (
        <div className="text-ton-muted text-sm bg-ton-card/50 rounded-xl p-4 text-center">
          Активных сделок нет.
        </div>
      )}
      <div className="space-y-2">
        {deals.map((d) => (
          <button
            key={d.id}
            onClick={() => onOpenDeal(d)}
            className="w-full text-left bg-ton-card border border-ton-border rounded-xl p-3 hover:bg-ton-border"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold">
                {d.amount} {d.asset} ↔ {(d.amount * d.price).toFixed(2)} {d.currency}
              </span>
              <DealBadge status={d.status} />
            </div>
            <div className="text-[11px] text-ton-muted">
              Роль: {d.my_role === 'buyer' ? 'покупатель' : 'продавец'} ·{' '}
              {d.payment_method}
            </div>
          </button>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Create ad
// ---------------------------------------------------------------------------

function CreateAdView({
  tgId,
  keys,
  all,
  onClose,
}: {
  tgId: number
  keys: WalletKeys
  all: MultiChainKeys | null
  onClose: () => void
}) {
  const [side, setSide] = useState<AdSide>('sell')
  const [asset, setAsset] = useState<AdAsset>('TON')
  const [currency, setCurrency] = useState<AdCurrency>('RUB')
  const [price, setPrice] = useState('')
  const [minA, setMinA] = useState('')
  const [maxA, setMaxA] = useState('')
  const [pm, setPm] = useState<PaymentMethod>('Тинькофф')
  const [pmDetails, setPmDetails] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mineList, setMineList] = useState<P2PAd[]>([])
  const [balance, setBalance] = useState<string | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const r = await listMyAds(tgId)
        setMineList(r)
      } catch {
        // ignore
      }
    })()
  }, [tgId])

  // Balance lookup is needed only for SELL ads — you can't sell what you
  // don't have. We fetch the chain-native balance for the selected asset
  // when side==='sell' and re-fetch on asset change.
  useEffect(() => {
    if (side !== 'sell') {
      setBalance(null)
      return
    }
    let cancelled = false
    setBalanceLoading(true)
    void (async () => {
      try {
        const b = await fetchAssetBalance(asset, keys, all)
        if (!cancelled) setBalance(b)
      } catch {
        if (!cancelled) setBalance(null)
      } finally {
        if (!cancelled) setBalanceLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [asset, side, keys, all])

  const maxNum = useMemo(
    () => (maxA ? Number(maxA.replace(',', '.')) : NaN),
    [maxA],
  )
  const balanceNum = balance != null ? Number(balance) : null
  const balanceInsufficient =
    side === 'sell' &&
    balanceNum !== null &&
    !Number.isNaN(maxNum) &&
    maxNum > balanceNum

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (side === 'sell' && balanceInsufficient) {
        throw new Error(
          `Недостаточно ${asset} на балансе (есть ${balance ?? '0'}, нужно хотя бы ${maxA}).`,
        )
      }
      await createAd({
        creator_tg_id: tgId,
        side,
        asset,
        currency,
        price: Number(price.replace(',', '.')),
        min_amount: Number(minA.replace(',', '.')),
        max_amount: Number(maxA.replace(',', '.')),
        payment_method: pm,
        payment_details: pmDetails.trim(),
        note: note || undefined,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-5 max-w-md mx-auto pb-24 space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onClose} className="text-sm text-ton-muted">
          ← Назад
        </button>
        <h1 className="text-base font-bold">Новое объявление</h1>
        <span className="w-12" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SegBtn active={side === 'sell'} onClick={() => setSide('sell')}>
          🟢 Продаю
        </SegBtn>
        <SegBtn active={side === 'buy'} onClick={() => setSide('buy')}>
          🔵 Покупаю
        </SegBtn>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Актив">
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value as AdAsset)}
            className="w-full px-3 py-2.5 bg-ton-card border border-ton-border rounded-xl text-sm"
          >
            {ASSETS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </Field>
        <Field label="Фиатная валюта">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as AdCurrency)}
            className="w-full px-3 py-2.5 bg-ton-card border border-ton-border rounded-xl text-sm"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={`Цена 1 ${asset} в ${currency}`}>
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="например 350"
          className="w-full px-3 py-2.5 bg-ton-card border border-ton-border rounded-xl text-sm"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Мин">
          <input
            value={minA}
            onChange={(e) => setMinA(e.target.value)}
            placeholder="0.5"
            className="w-full px-3 py-2.5 bg-ton-card border border-ton-border rounded-xl text-sm"
          />
        </Field>
        <Field label="Макс">
          <input
            value={maxA}
            onChange={(e) => setMaxA(e.target.value)}
            placeholder="100"
            className="w-full px-3 py-2.5 bg-ton-card border border-ton-border rounded-xl text-sm"
          />
        </Field>
      </div>

      <Field label="Банк / способ оплаты">
        <select
          value={pm}
          onChange={(e) => setPm(e.target.value as PaymentMethod)}
          className="w-full px-3 py-2.5 bg-ton-card border border-ton-border rounded-xl text-sm"
        >
          {PAYMENT_METHODS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label={
          pm === 'СБП'
            ? 'Номер телефона / ник СБП'
            : 'Номер карты или реквизиты'
        }
      >
        <input
          value={pmDetails}
          onChange={(e) => setPmDetails(e.target.value)}
          placeholder={
            pm === 'СБП' ? '+7 999 999 99 99' : '4276 1600 1234 5678'
          }
          className="w-full px-3 py-2.5 bg-ton-card border border-ton-border rounded-xl text-sm"
        />
      </Field>

      {side === 'sell' && (
        <div className="text-xs text-ton-muted">
          {balanceLoading ? (
            'Проверяем баланс…'
          ) : balance != null ? (
            <>
              Баланс: <span className="font-mono">{balance}</span> {asset}
              {balanceInsufficient && (
                <span className="text-red-400 ml-2">
                  ⚠ Недостаточно для max {maxA} {asset}
                </span>
              )}
            </>
          ) : (
            <span className="text-amber-400">
              Не удалось получить баланс {asset} — проверь сам.
            </span>
          )}
        </div>
      )}

      <Field label="Примечание (опционально)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 bg-ton-card border border-ton-border rounded-xl text-sm resize-none"
        />
      </Field>

      {error && <div className="text-red-400 text-sm">{error}</div>}
      <button
        onClick={submit}
        disabled={
          busy ||
          !price ||
          !minA ||
          !maxA ||
          !pm ||
          pmDetails.trim().length < 4 ||
          balanceInsufficient
        }
        className="w-full py-3 rounded-xl bg-ton-primary hover:brightness-110 font-semibold disabled:opacity-40"
      >
        {busy ? 'Публикуем…' : 'Опубликовать'}
      </button>

      {mineList.length > 0 && (
        <div className="pt-3">
          <h2 className="text-xs uppercase text-ton-muted mb-2">Мои объявления</h2>
          <div className="space-y-2">
            {mineList.map((ad) => (
              <div
                key={ad.id}
                className="bg-ton-card border border-ton-border rounded-xl p-3 flex items-center justify-between"
              >
                <div className="text-xs">
                  {ad.side === 'sell' ? 'Продаю' : 'Покупаю'} {ad.asset} ·{' '}
                  {ad.price} {ad.currency}
                </div>
                <button
                  onClick={async () => {
                    try {
                      await deleteAd(ad.id, tgId)
                      setMineList(mineList.filter((x) => x.id !== ad.id))
                    } catch (e) {
                      alert(e instanceof Error ? e.message : 'Ошибка')
                    }
                  }}
                  className="text-xs text-red-400 hover:underline"
                >
                  Удалить
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Returns a decimal string of the user's available balance for the given P2P
// asset, or null if we couldn't look it up (network error, missing chain
// keys, unsupported asset). Used to gate sell-ad creation on having enough
// crypto on hand.
async function fetchAssetBalance(
  asset: AdAsset,
  keys: WalletKeys,
  all: MultiChainKeys | null,
): Promise<string | null> {
  switch (asset) {
    case 'TON': {
      const b = await getBalance(keys.address)
      return fromNano(b)
    }
    case 'ETH': {
      if (!all?.evm) return null
      const b = await getEvmNativeBalance(EVM_CHAINS.eth, all.evm.address)
      return formatUnits(b, 18)
    }
    case 'BNB': {
      if (!all?.evm) return null
      const b = await getEvmNativeBalance(EVM_CHAINS.bsc, all.evm.address)
      return formatUnits(b, 18)
    }
    case 'USDT-ERC20': {
      if (!all?.evm) return null
      const tok = EVM_CHAINS.eth.tokens.find((t) => t.symbol === 'USDT')
      if (!tok) return null
      const b = await getEvmTokenBalance(EVM_CHAINS.eth, tok, all.evm.address)
      return formatUnits(b, tok.decimals)
    }
    case 'USDC-ERC20': {
      if (!all?.evm) return null
      const tok = EVM_CHAINS.eth.tokens.find((t) => t.symbol === 'USDC')
      if (!tok) return null
      const b = await getEvmTokenBalance(EVM_CHAINS.eth, tok, all.evm.address)
      return formatUnits(b, tok.decimals)
    }
    case 'SOL': {
      if (!all?.sol) return null
      const b = await getSolBalance(all.sol.publicKey)
      return formatSol(b, 9)
    }
    case 'BTC': {
      if (!all?.btc) return null
      const b = await getBtcBalance(all.btc.address)
      return formatBtc(b)
    }
    default:
      return null
  }
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs text-ton-muted mb-1">{label}</span>
      {children}
    </label>
  )
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`py-2 rounded-xl text-sm font-semibold ${
        active
          ? 'bg-ton-primary text-white'
          : 'bg-ton-card border border-ton-border text-ton-muted'
      }`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Active deal view
// ---------------------------------------------------------------------------

function DealView({
  deal,
  tgId,
  onUpdate,
  onClose,
}: {
  deal: P2PDeal
  tgId: number
  onUpdate: (d: P2PDeal) => void
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [autoLeft, setAutoLeft] = useState<number | null>(null)

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const updated = await getDeal(deal.id, tgId)
        onUpdate(updated)
      } catch {
        // ignore poll errors
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [deal.id, tgId, onUpdate])

  useEffect(() => {
    if (!deal.auto_release_at) {
      setAutoLeft(null)
      return
    }
    const tick = () => {
      const left = Math.max(0, Math.floor(deal.auto_release_at! - Date.now() / 1000))
      setAutoLeft(left)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [deal.auto_release_at])

  const act = async (action: 'paid' | 'sent' | 'received' | 'cancel') => {
    setBusy(true)
    setError(null)
    try {
      const r = await dealAction({ deal_id: deal.id, tg_id: tgId, action })
      onUpdate(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      await postDealMessage({ deal_id: deal.id, tg_id: tgId, text: text.trim() })
      setText('')
      const updated = await getDeal(deal.id, tgId)
      onUpdate(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  const isBuyer = deal.my_role === 'buyer'
  const isSeller = deal.my_role === 'seller'

  return (
    <div className="p-5 max-w-md mx-auto pb-24 space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onClose} className="text-sm text-ton-muted">← Назад</button>
        <h1 className="text-base font-bold">Сделка</h1>
        <DealBadge status={deal.status} />
      </div>

      <div className="bg-ton-card border border-ton-border rounded-2xl p-4 text-sm space-y-1">
        <div>
          {deal.amount} {deal.asset} ↔ {(deal.amount * deal.price).toFixed(2)}{' '}
          {deal.currency}
        </div>
        <div className="text-xs text-ton-muted">
          Цена: {deal.price} {deal.currency} / 1 {deal.asset} ·{' '}
          {deal.payment_method}
        </div>
        <div className="text-xs text-ton-muted">
          Ты — {deal.my_role === 'buyer' ? 'покупатель' : 'продавец'}
        </div>
        {autoLeft !== null && deal.status === 'crypto_sent' && (
          <div className="text-xs text-amber-400">
            Авто-закрытие через {autoLeft} сек
          </div>
        )}
      </div>

      <div className="bg-ton-card border border-ton-border rounded-2xl p-3 space-y-2">
        <h2 className="text-xs uppercase text-ton-muted">Анонимный чат</h2>
        <div className="max-h-60 overflow-y-auto space-y-1">
          {deal.messages.length === 0 && (
            <div className="text-[11px] text-ton-muted text-center py-3">
              Сообщений пока нет. Сторона видит твои сообщения как
              «Контрагент: …», без @username.
            </div>
          )}
          {deal.messages.map((m, i) => (
            <div
              key={i}
              className={`text-xs px-2.5 py-1.5 rounded-lg ${
                m.from_me
                  ? 'bg-ton-primary/30 ml-8'
                  : 'bg-ton-card/60 border border-ton-border mr-8'
              }`}
            >
              <div className="text-[10px] text-ton-muted mb-0.5">
                {m.from_me ? 'Ты' : 'Контрагент'}
              </div>
              {m.text}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Сообщение…"
            disabled={['done', 'cancelled', 'expired'].includes(deal.status)}
            className="flex-1 px-3 py-2 bg-ton-card border border-ton-border rounded-xl text-sm focus:outline-none focus:border-ton-primary disabled:opacity-40"
          />
          <button
            onClick={send}
            disabled={busy || !text.trim()}
            className="px-3 rounded-xl bg-ton-primary hover:brightness-110 text-sm disabled:opacity-40"
          >
            ↗
          </button>
        </div>
      </div>

      {error && <div className="text-red-400 text-sm">{error}</div>}

      <div className="grid grid-cols-2 gap-2">
        {isBuyer && deal.status === 'open' && (
          <Action onClick={() => act('paid')} busy={busy}>Я оплатил</Action>
        )}
        {isSeller && (deal.status === 'open' || deal.status === 'fiat_paid') && (
          <Action onClick={() => act('sent')} busy={busy}>Я отправил крипту</Action>
        )}
        {isBuyer && deal.status === 'crypto_sent' && (
          <Action onClick={() => act('received')} busy={busy}>Получил крипту</Action>
        )}
        {!['done', 'cancelled', 'expired'].includes(deal.status) && (
          <button
            onClick={() => act('cancel')}
            disabled={busy}
            className="py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm font-semibold disabled:opacity-40"
          >
            Отменить
          </button>
        )}
      </div>
    </div>
  )
}

function Action({
  onClick,
  busy,
  children,
}: {
  onClick: () => void
  busy: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="py-2.5 rounded-xl bg-ton-primary hover:brightness-110 text-sm font-semibold disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function DealBadge({ status }: { status: P2PDeal['status'] }) {
  const map: Record<P2PDeal['status'], { label: string; cls: string }> = {
    open: { label: 'открыта', cls: 'bg-blue-500/20 text-blue-300' },
    fiat_paid: { label: 'оплачено', cls: 'bg-amber-500/20 text-amber-300' },
    crypto_sent: { label: 'крипта отправлена', cls: 'bg-purple-500/20 text-purple-300' },
    done: { label: 'готово', cls: 'bg-green-500/20 text-green-300' },
    cancelled: { label: 'отменена', cls: 'bg-red-500/20 text-red-300' },
    expired: { label: 'просрочена', cls: 'bg-ton-card text-ton-muted' },
  }
  const m = map[status]
  return (
    <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${m.cls}`}>
      {m.label}
    </span>
  )
}
