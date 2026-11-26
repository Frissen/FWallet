import { useEffect, useState } from 'react'
import {
  computeChequeBreakdown,
  createCheque,
  inspectCheque,
  claimCheque,
  readPendingChequeSecretFromUrl,
  clearPendingChequeFromUrl,
  type CreatedCheque,
} from '../lib/cheque'
import { fromNano, type WalletKeys } from '../lib/ton'
import { haptic } from '../lib/telegram'

interface Props {
  keys: WalletKeys
  balanceNano: bigint
  onAfterAction: () => void
  onClose?: () => void
}

type View = 'menu' | 'create' | 'created' | 'claim'

export function ChequesTab({ keys, balanceNano, onAfterAction, onClose }: Props) {
  const [view, setView] = useState<View>('menu')
  const [pendingClaim, setPendingClaim] = useState<string | null>(null)

  // Auto-detect pending cheque from URL.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read URL once on mount
    const secret = readPendingChequeSecretFromUrl()
    if (secret) {
      setPendingClaim(secret)
      setView('claim')
    }
  }, [])

  if (view === 'create') {
    return (
      <CreateChequeView
        keys={keys}
        balanceNano={balanceNano}
        onCreated={() => {
          onAfterAction()
          setView('created')
        }}
        onCancel={() => setView('menu')}
      />
    )
  }
  if (view === 'created') {
    return <CreatedChequeView onDone={() => setView('menu')} />
  }
  if (view === 'claim' && pendingClaim) {
    return (
      <ClaimChequeView
        secret={pendingClaim}
        myAddress={keys.address}
        onDone={() => {
          clearPendingChequeFromUrl()
          setPendingClaim(null)
          onAfterAction()
          setView('menu')
        }}
        onCancel={() => {
          clearPendingChequeFromUrl()
          setPendingClaim(null)
          setView('menu')
        }}
      />
    )
  }
  return (
    <ChequeMenu
      onCreate={() => setView('create')}
      onClaim={() => setView('claim')}
      onClose={onClose}
    />
  )
}

function ChequeMenu({
  onCreate,
  onClaim,
  onClose,
}: {
  onCreate: () => void
  onClaim: () => void
  onClose?: () => void
}) {
  return (
    <div className="p-5 max-w-md mx-auto pb-24">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">TON Чеки</h1>
        {onClose && (
          <button onClick={onClose} className="text-sm text-ton-muted">
            ← Назад
          </button>
        )}
      </div>
      <p className="text-xs text-ton-muted mb-5">
        Перешли TON по ссылке. Получатель забирает чек одним кликом.
      </p>

      <div className="space-y-3">
        <button
          onClick={onCreate}
          className="w-full p-5 rounded-2xl bg-gradient-to-br from-ton-primary/30 to-ton-card border border-ton-border text-left hover:border-ton-primary transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-ton-primary/30 flex items-center justify-center text-xl">
              ✉
            </div>
            <div>
              <div className="font-semibold">Создать чек</div>
              <div className="text-xs text-ton-muted">
                Сгенерируй ссылку, любой по ней получит TON
              </div>
            </div>
          </div>
        </button>

        <button
          onClick={onClaim}
          className="w-full p-5 rounded-2xl bg-ton-card border border-ton-border text-left hover:border-ton-primary transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-xl">
              💌
            </div>
            <div>
              <div className="font-semibold">Получить по ссылке</div>
              <div className="text-xs text-ton-muted">
                Открой ссылку чека — забери TON на свой адрес
              </div>
            </div>
          </div>
        </button>
      </div>

      <div className="mt-6 text-xs text-ton-muted bg-ton-card/50 border border-ton-border rounded-xl p-3">
        Комиссия 1% от суммы чека списывается при создании. Ссылка чека
        содержит секрет — кто угодно с ней заберёт средства, обращайся как
        с наличными.
      </div>
    </div>
  )
}

function CreateChequeView({
  keys,
  balanceNano,
  onCreated,
  onCancel,
}: {
  keys: WalletKeys
  balanceNano: bigint
  onCreated: () => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedCheque | null>(null)
  const [copied, setCopied] = useState<'web' | 'tg' | null>(null)

  let breakdown = null
  try {
    if (amount) breakdown = computeChequeBreakdown(amount)
  } catch {
    // ignore
  }
  const exceeds = breakdown ? breakdown.totalNano > balanceNano : false
  const balanceTon = fromNano(balanceNano)

  if (created) {
    return (
      <div className="p-6 max-w-md mx-auto pb-24">
        <h1 className="text-2xl font-bold mb-2">Чек создан</h1>
        <p className="text-sm text-ton-muted mb-4">
          Перешли любую из ссылок ниже. Кто откроет первым — заберёт {created.faceTon} TON.
        </p>

        <LinkBlock
          label="Telegram-ссылка (открывается в боте)"
          link={created.tgLink}
          copied={copied === 'tg'}
          onCopy={() => {
            void navigator.clipboard.writeText(created.tgLink)
            setCopied('tg')
            setTimeout(() => setCopied(null), 2000)
          }}
        />
        <div className="h-3" />
        <LinkBlock
          label="Web-ссылка"
          link={created.webLink}
          copied={copied === 'web'}
          onCopy={() => {
            void navigator.clipboard.writeText(created.webLink)
            setCopied('web')
            setTimeout(() => setCopied(null), 2000)
          }}
        />

        <div className="mt-5 text-xs text-ton-muted bg-ton-card/60 border border-ton-border rounded-xl p-3">
          ⚠️ Не теряй ссылку — без неё TON не вернёшь. Если получатель
          не забрал, просто открой сам и забери обратно.
        </div>

        <button
          onClick={() => {
            onCreated()
          }}
          className="w-full mt-6 py-3 rounded-xl bg-ton-primary hover:brightness-110 font-semibold"
        >
          Готово
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-md mx-auto pb-24">
      <button onClick={onCancel} className="text-ton-muted mb-4">
        ← Back
      </button>
      <h1 className="text-2xl font-bold mb-4">Создать чек</h1>

      <label className="block text-xs text-ton-muted mb-1">Сумма чека (TON)</label>
      <input
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value.replace(/,/g, '.'))
          setError(null)
        }}
        inputMode="decimal"
        placeholder="0.00"
        className="w-full px-4 py-3 bg-ton-card border border-ton-border rounded-xl mb-1 outline-none focus:border-ton-primary"
      />
      <div className="text-xs text-ton-muted mb-3">
        Баланс: {balanceTon} TON
      </div>

      {breakdown && (
        <div className="bg-ton-card border border-ton-border rounded-xl p-4 mb-3 text-sm">
          <Row label="Сумма чека" value={`${breakdown.faceTon} TON`} />
          <Row
            label={`Комиссия чека (${breakdown.feePercent}%)`}
            value={`${breakdown.feeTon} TON`}
            muted
          />
          <Row
            label="Газ для получателя"
            value={`${fromNano(breakdown.gasNano)} TON`}
            muted
          />
          <div className="border-t border-ton-border my-2" />
          <Row label="Будет списано" value={`${breakdown.totalTon} TON`} bold />
        </div>
      )}

      {error && <div className="text-red-400 text-sm mb-2">{error}</div>}

      <button
        disabled={
          !breakdown || breakdown.faceNano <= 0n || exceeds || creating
        }
        onClick={async () => {
          if (!breakdown) return
          setCreating(true)
          setError(null)
          haptic('medium')
          try {
            const c = await createCheque(keys, amount)
            haptic('success')
            setCreated(c)
          } catch (e) {
            haptic('error')
            setError(e instanceof Error ? e.message : 'Не удалось создать чек')
          } finally {
            setCreating(false)
          }
        }}
        className="w-full py-3 rounded-xl bg-ton-primary hover:brightness-110 disabled:opacity-40 font-semibold"
      >
        {creating ? 'Создаю…' : 'Подписать и создать'}
      </button>
    </div>
  )
}

function CreatedChequeView({ onDone }: { onDone: () => void }) {
  return (
    <div className="p-6 max-w-md mx-auto pb-24 flex flex-col items-center justify-center text-center">
      <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center text-3xl mb-4">
        ✅
      </div>
      <h1 className="text-2xl font-bold mb-2">Готово</h1>
      <p className="text-ton-muted text-sm mb-6">
        Чек активен. Ссылку ты уже скопировал.
      </p>
      <button
        onClick={onDone}
        className="w-full max-w-xs py-3 rounded-xl bg-ton-primary hover:brightness-110 font-semibold"
      >
        В меню чеков
      </button>
    </div>
  )
}

function ClaimChequeView({
  secret: initialSecret,
  myAddress,
  onDone,
  onCancel,
}: {
  secret: string | null
  myAddress: string
  onDone: () => void
  onCancel: () => void
}) {
  const [secret, setSecret] = useState(initialSecret ?? '')
  const [info, setInfo] = useState<{
    address: string
    balanceTon: string
    balanceNano: bigint
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // If we got a secret from URL, auto-inspect once.
  const [autoTried, setAutoTried] = useState(false)
  useEffect(() => {
    if (initialSecret && !autoTried) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot auto-inspect
      setAutoTried(true)
      void doInspect(initialSecret)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSecret])

  async function doInspect(s: string) {
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      const r = await inspectCheque(s.trim())
      setInfo({
        address: r.ephemeralAddress,
        balanceTon: r.balanceTon,
        balanceNano: r.balanceNano,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось прочитать чек')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="p-6 max-w-md mx-auto pb-24 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center text-3xl mb-4">
          🎉
        </div>
        <h1 className="text-2xl font-bold mb-2">Чек получен</h1>
        <p className="text-ton-muted text-sm mb-6">
          Деньги уже летят к тебе. Появятся на балансе через несколько секунд.
        </p>
        <button
          onClick={onDone}
          className="w-full max-w-xs py-3 rounded-xl bg-ton-primary hover:brightness-110 font-semibold"
        >
          В меню
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-md mx-auto pb-24">
      <button onClick={onCancel} className="text-ton-muted mb-4">
        ← Back
      </button>
      <h1 className="text-2xl font-bold mb-4">Получить по ссылке</h1>

      <label className="block text-xs text-ton-muted mb-1">
        Ссылка или секрет чека
      </label>
      <textarea
        value={secret}
        onChange={(e) => {
          setSecret(extractSecret(e.target.value))
          setError(null)
        }}
        placeholder="https://…#cheque=…"
        rows={3}
        className="w-full px-4 py-3 bg-ton-card border border-ton-border rounded-xl font-mono text-xs mb-3 outline-none focus:border-ton-primary"
      />
      <button
        onClick={() => void doInspect(secret)}
        disabled={!secret || loading}
        className="w-full py-2.5 rounded-xl bg-ton-card border border-ton-border hover:bg-ton-border disabled:opacity-40 mb-3"
      >
        {loading ? 'Читаю…' : 'Проверить чек'}
      </button>

      {info && (
        <div className="bg-ton-card border border-ton-border rounded-xl p-4 mb-3 text-sm">
          <div className="text-xs text-ton-muted mb-1">Адрес чека</div>
          <div className="font-mono text-xs break-all mb-3">{info.address}</div>
          <Row label="Доступно" value={`${info.balanceTon} TON`} bold />
        </div>
      )}

      {error && <div className="text-red-400 text-sm mb-2">{error}</div>}

      {info && info.balanceNano > 0n && (
        <button
          onClick={async () => {
            setClaiming(true)
            setError(null)
            haptic('medium')
            try {
              await claimCheque(secret.trim(), myAddress)
              haptic('success')
              setDone(true)
            } catch (e) {
              haptic('error')
              setError(e instanceof Error ? e.message : 'Не удалось забрать чек')
            } finally {
              setClaiming(false)
            }
          }}
          disabled={claiming}
          className="w-full py-3 rounded-xl bg-ton-primary hover:brightness-110 disabled:opacity-40 font-semibold"
        >
          {claiming ? 'Забираю…' : `Забрать ${info.balanceTon} TON`}
        </button>
      )}
    </div>
  )
}

function extractSecret(input: string): string {
  const trimmed = input.trim()
  const match = trimmed.match(/cheque=([A-Za-z0-9_\-+/=]+)/)
  return match ? match[1] : trimmed
}

function LinkBlock({
  label,
  link,
  copied,
  onCopy,
}: {
  label: string
  link: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="bg-ton-card border border-ton-border rounded-xl p-3">
      <div className="text-xs text-ton-muted mb-1">{label}</div>
      <div className="font-mono text-[11px] break-all mb-2">{link}</div>
      <button
        onClick={onCopy}
        className="w-full py-2 rounded-lg bg-ton-border hover:bg-white/10 text-sm font-semibold"
      >
        {copied ? 'Скопировано!' : 'Скопировать'}
      </button>
    </div>
  )
}

function Row({
  label,
  value,
  bold,
  muted,
}: {
  label: string
  value: string
  bold?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex justify-between items-baseline py-1">
      <span className={`text-xs ${muted ? 'text-ton-muted' : 'text-ton-muted'}`}>
        {label}
      </span>
      <span
        className={`font-mono ${bold ? 'text-base font-semibold' : 'text-sm'}`}
      >
        {value}
      </span>
    </div>
  )
}
