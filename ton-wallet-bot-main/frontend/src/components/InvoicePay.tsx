import { useEffect, useMemo, useState } from 'react'
import {
  fromNano,
  getBalance,
  sendInvoicePayment,
  type WalletKeys,
} from '../lib/ton'
import { P2P_API_BASE } from '../lib/config'
import { haptic } from '../lib/telegram'

interface PublicInvoice {
  id: string
  asset: string
  amount: number
  amount_nano: string
  merchant_amount_nano: string
  platform_fee_nano: string
  platform_fee_address: string
  merchant_address: string
  merchant_name: string
  description: string | null
  status: 'pending' | 'paid' | 'expired'
  expires_at: number
  paid_at: number | null
  paid_tx_hash: string | null
}

interface Props {
  invoiceId: string
  keys: WalletKeys | null
  onCreateWallet: () => void
  onClose: () => void
}

type Step = 'loading' | 'review' | 'paying' | 'paid' | 'expired' | 'error'

export function InvoicePay({ invoiceId, keys, onCreateWallet, onClose }: Props) {
  const [inv, setInv] = useState<PublicInvoice | null>(null)
  const [step, setStep] = useState<Step>('loading')
  const [error, setError] = useState<string | null>(null)
  const [balanceNano, setBalanceNano] = useState<bigint | null>(null)

  const fetchInvoice = async () => {
    try {
      const r = await fetch(`${P2P_API_BASE}/api/public/invoice/${invoiceId}`)
      if (r.status === 404) {
        setStep('error')
        setError('Счёт не найден или удалён')
        return
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as PublicInvoice
      setInv(data)
      if (data.status === 'paid') {
        setStep('paid')
      } else if (data.status === 'expired' || data.expires_at * 1000 < Date.now()) {
        setStep('expired')
      } else {
        setStep('review')
      }
    } catch (e) {
      setStep('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    fetchInvoice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId])

  // Poll for status updates while user is on the screen (every 5s).
  useEffect(() => {
    if (step !== 'review' && step !== 'paying') return
    const t = setInterval(() => {
      fetch(`${P2P_API_BASE}/api/public/invoice/${invoiceId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: PublicInvoice | null) => {
          if (!data) return
          if (data.status === 'paid') {
            setInv(data)
            setStep('paid')
          } else if (data.status === 'expired') {
            setInv(data)
            setStep('expired')
          }
        })
        .catch(() => {})
    }, 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, invoiceId])

  // Read wallet balance once we have keys + an invoice to pay.
  useEffect(() => {
    if (!keys || !inv || step !== 'review') return
    let alive = true
    getBalance(keys.address)
      .then((b) => {
        if (alive) setBalanceNano(b)
      })
      .catch(() => {
        if (alive) setBalanceNano(0n)
      })
    return () => {
      alive = false
    }
  }, [keys, inv, step])

  const totalNano = useMemo(() => {
    if (!inv) return 0n
    return BigInt(inv.amount_nano)
  }, [inv])

  const merchantNano = useMemo(() => {
    if (!inv) return 0n
    return BigInt(inv.merchant_amount_nano)
  }, [inv])

  const feeNano = useMemo(() => {
    if (!inv) return 0n
    return BigInt(inv.platform_fee_nano)
  }, [inv])

  const insufficient =
    balanceNano !== null && totalNano > 0n
      ? balanceNano < totalNano + 100_000_000n // ~0.1 TON gas reserve
      : false

  const handlePay = async () => {
    if (!keys || !inv) return
    setStep('paying')
    setError(null)
    haptic('medium')
    try {
      await sendInvoicePayment({
        keys,
        invoiceId: inv.id,
        merchantAddress: inv.merchant_address,
        merchantAmountNano: merchantNano,
        platformFeeAddress: inv.platform_fee_address,
        platformFeeNano: feeNano,
      })
      // Watcher will flip the invoice to "paid" when it sees the on-chain tx
      // (~30-90 s on TonCenter free tier). Poll every 5 s; the screen will
      // flip itself once `inv.status` becomes "paid".
      haptic('success')
    } catch (e) {
      haptic('error')
      setStep('review')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="min-h-full p-6 max-w-md mx-auto">
      <button onClick={onClose} className="text-ton-muted mb-4">
        ← Закрыть
      </button>
      <div className="bg-ton-card border border-ton-border rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-ton-primary flex items-center justify-center text-2xl">
            🧾
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-ton-muted">Счёт от</div>
            <div className="font-semibold truncate">
              {inv?.merchant_name || 'Fwallet'}
            </div>
          </div>
        </div>

        {step === 'loading' && (
          <div className="text-center py-8 text-ton-muted">
            Загружаю счёт…
          </div>
        )}

        {step === 'error' && (
          <div className="text-center py-8">
            <div className="text-red-400 mb-3">❌ {error || 'Ошибка'}</div>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-ton-card border border-ton-border"
            >
              Закрыть
            </button>
          </div>
        )}

        {step === 'expired' && (
          <div className="text-center py-8">
            <div className="text-yellow-400 mb-2">⏱ Срок счёта истёк</div>
            <div className="text-xs text-ton-muted mb-4">
              Запроси у магазина новый счёт.
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-ton-card border border-ton-border"
            >
              Закрыть
            </button>
          </div>
        )}

        {step === 'paid' && inv && (
          <div className="text-center py-6">
            <div className="text-green-400 text-3xl mb-2">✓</div>
            <div className="font-semibold mb-1">Оплачено</div>
            <div className="text-2xl font-bold mb-2">
              {inv.amount} {inv.asset}
            </div>
            {inv.description && (
              <div className="text-sm text-ton-muted mb-3">{inv.description}</div>
            )}
            {inv.paid_tx_hash && (
              <div className="text-xs text-ton-muted break-all mb-4">
                tx: {inv.paid_tx_hash.slice(0, 24)}…
              </div>
            )}
            <button
              onClick={onClose}
              className="px-6 py-3 rounded-xl bg-ton-primary font-semibold"
            >
              Готово
            </button>
          </div>
        )}

        {(step === 'review' || step === 'paying') && inv && (
          <>
            {inv.description && (
              <div className="text-sm text-ton-muted mb-3">
                {inv.description}
              </div>
            )}
            <div className="text-center py-2 mb-4">
              <div className="text-xs text-ton-muted">Сумма к оплате</div>
              <div className="text-4xl font-bold">
                {inv.amount} <span className="text-ton-muted text-2xl">{inv.asset}</span>
              </div>
            </div>
            <div className="bg-black/30 rounded-xl p-3 text-xs space-y-1.5 mb-4">
              <div className="flex justify-between">
                <span className="text-ton-muted">Магазину</span>
                <span className="font-mono">{fromNano(merchantNano)} TON</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ton-muted">Комиссия Fwallet 0.8%</span>
                <span className="font-mono">{fromNano(feeNano)} TON</span>
              </div>
              <div className="border-t border-ton-border pt-1.5 flex justify-between font-semibold">
                <span>Итого с твоего кошелька</span>
                <span className="font-mono">{fromNano(totalNano)} TON</span>
              </div>
              <div className="text-ton-muted text-[10px] pt-1">
                + сетевые комиссии TON (~0.01 TON)
              </div>
            </div>

            {!keys && (
              <div className="text-center py-3">
                <div className="text-xs text-ton-muted mb-3">
                  Чтобы оплатить, создай или импортируй кошелёк в Fwallet.
                </div>
                <button
                  onClick={onCreateWallet}
                  className="w-full py-3 rounded-xl bg-ton-primary font-semibold"
                >
                  Открыть кошелёк
                </button>
              </div>
            )}

            {keys && (
              <>
                <div className="text-xs text-ton-muted mb-2">
                  С кошелька <span className="font-mono">{keys.address.slice(0, 6)}…{keys.address.slice(-4)}</span>
                  {balanceNano !== null && (
                    <> · баланс {fromNano(balanceNano)} TON</>
                  )}
                </div>
                {error && (
                  <div className="text-red-400 text-xs mb-2">{error}</div>
                )}
                {insufficient && (
                  <div className="text-yellow-400 text-xs mb-2">
                    Недостаточно средств с учётом сетевой комиссии
                  </div>
                )}
                <button
                  onClick={handlePay}
                  disabled={step === 'paying' || insufficient}
                  className="w-full py-3 rounded-xl bg-ton-primary font-semibold disabled:opacity-50"
                >
                  {step === 'paying' ? 'Подписываю и жду подтверждения…' : 'Оплатить'}
                </button>
                {step === 'paying' && (
                  <div className="text-xs text-ton-muted text-center mt-3">
                    Транзакция отправлена. Магазин получит уведомление через ~30-60 секунд.
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
      <div className="text-xs text-ton-muted text-center mt-4">
        Платёж проходит напрямую on-chain, Fwallet не хранит средства.
      </div>
    </div>
  )
}
