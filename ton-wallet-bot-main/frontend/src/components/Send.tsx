import { useState } from 'react'
import { Address } from '@ton/core'
import {
  computeCommission,
  fromNano,
  sendTon,
  type WalletKeys,
} from '../lib/ton'
import { COMMISSION_ADDRESS } from '../lib/config'
import { haptic } from '../lib/telegram'
import { TxSimulatorBadge } from './TxSimulatorBadge'
import { bumpUsage, listEntries } from '../lib/addressBook'

interface Props {
  keys: WalletKeys
  balanceNano: bigint
  onClose: () => void
  onSent: () => void
}

type Step = 'form' | 'confirm' | 'sending' | 'sent'

export function Send({ keys, balanceNano, onClose, onSent }: Props) {
  const [step, setStep] = useState<Step>('form')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const tryParse = () => {
    try {
      Address.parse(to.trim())
      return true
    } catch {
      return false
    }
  }

  let breakdown = null
  let amountValid = false
  try {
    if (amount) {
      breakdown = computeCommission(amount)
      amountValid = breakdown.amountNano > 0n
    }
  } catch {
    // ignore: invalid number
  }

  const balanceTon = fromNano(balanceNano)
  const exceedsBalance = breakdown ? breakdown.totalNano > balanceNano : false

  if (step === 'form') {
    return (
      <div className="min-h-full p-6 max-w-md mx-auto">
        <button onClick={onClose} className="text-ton-muted mb-4">
          ← Back
        </button>
        <h1 className="text-2xl font-bold mb-4">Send TON</h1>
        <label className="block text-xs text-ton-muted mb-1">Recipient</label>
        <input
          value={to}
          onChange={(e) => {
            setTo(e.target.value)
            setError(null)
          }}
          placeholder="UQ… or EQ… address"
          className="w-full px-4 py-3 bg-ton-card border border-ton-border rounded-xl font-mono text-sm mb-2 outline-none focus:border-ton-primary"
        />
        {listEntries().length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3 no-scrollbar -mx-1 px-1">
            {listEntries().slice(0, 8).map((e) => (
              <button
                key={e.address}
                onClick={() => {
                  setTo(e.address)
                  setError(null)
                }}
                className="shrink-0 flex items-center gap-1.5 bg-ton-card border border-ton-border rounded-full pl-1 pr-3 py-1 text-xs active:scale-[0.97]"
              >
                <span className="w-6 h-6 rounded-full bg-ton-dark flex items-center justify-center text-sm">
                  {e.emoji ?? '👤'}
                </span>
                <span className="font-medium">{e.name}</span>
              </button>
            ))}
          </div>
        )}
        <label className="block text-xs text-ton-muted mb-1">Amount (TON)</label>
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
          Balance: {balanceTon} TON
        </div>
        <label className="block text-xs text-ton-muted mb-1">
          Comment (optional)
        </label>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Memo / message"
          className="w-full px-4 py-3 bg-ton-card border border-ton-border rounded-xl mb-3 outline-none focus:border-ton-primary"
        />
        {breakdown && (
          <div className="bg-ton-card border border-ton-border rounded-xl p-4 mb-3 text-sm">
            <Row label="Amount" value={`${breakdown.amountTon} TON`} />
            <Row
              label={`Service fee (${breakdown.feePercent}%)`}
              value={`${breakdown.feeTon} TON`}
              muted
            />
            {breakdown.referrer && (
              <div className="text-xs text-ton-muted ml-3 -mt-1 mb-1">
                · service: {breakdown.serviceFeeTon} TON
                <br />
                · referrer: {breakdown.referralFeeTon} TON
              </div>
            )}
            <div className="border-t border-ton-border my-2" />
            <Row
              label="Total deducted"
              value={`${breakdown.totalTon} TON`}
              bold
            />
            <p className="text-xs text-ton-muted mt-2">
              Network gas (~0.005 TON) is paid separately from your balance.
            </p>
          </div>
        )}
        {error && <div className="text-red-400 text-sm mb-2">{error}</div>}
        <button
          disabled={!amountValid || !to || exceedsBalance || !tryParse()}
          onClick={() => {
            if (!tryParse()) {
              setError('Invalid TON address')
              return
            }
            if (exceedsBalance) {
              setError('Amount + fee exceeds balance')
              return
            }
            setStep('confirm')
          }}
          className="w-full py-3 rounded-xl bg-ton-primary hover:brightness-110 disabled:opacity-40 font-semibold"
        >
          Continue
        </button>
      </div>
    )
  }

  if (step === 'confirm' && breakdown) {
    return (
      <div className="min-h-full p-6 max-w-md mx-auto">
        <button onClick={() => setStep('form')} className="text-ton-muted mb-4">
          ← Back
        </button>
        <h1 className="text-2xl font-bold mb-4">Confirm transaction</h1>
        <TxSimulatorBadge
          fromAddress={keys.address}
          toAddress={to.trim()}
          amountNano={breakdown.amountNano}
          balanceNano={balanceNano}
        />
        <div className="bg-ton-card border border-ton-border rounded-xl p-4 mb-3">
          <div className="text-xs text-ton-muted mb-1">To</div>
          <div className="font-mono text-sm break-all mb-3">{to}</div>
          {comment && (
            <>
              <div className="text-xs text-ton-muted mb-1">Comment</div>
              <div className="text-sm break-all mb-3">{comment}</div>
            </>
          )}
          <Row label="Amount to recipient" value={`${breakdown.amountTon} TON`} />
          <Row
            label={`Service fee (${breakdown.feePercent}%)`}
            value={`${breakdown.feeTon} TON`}
            muted
          />
          {breakdown.referrer && (
            <div className="text-xs text-ton-muted ml-3 -mt-1 mb-1">
              · service: {breakdown.serviceFeeTon} TON
              <br />
              · referrer: {breakdown.referralFeeTon} TON
            </div>
          )}
          <div className="border-t border-ton-border my-2" />
          <Row label="Total" value={`${breakdown.totalTon} TON`} bold />
        </div>
        <details className="text-xs text-ton-muted mb-3">
          <summary className="cursor-pointer">
            Where does the service fee go?
          </summary>
          <div className="mt-2 break-all font-mono">{COMMISSION_ADDRESS}</div>
          <div className="mt-1">
            The fee is sent as a separate, visible on-chain message in the same
            transaction.
          </div>
        </details>
        {error && <div className="text-red-400 text-sm mb-2">{error}</div>}
        <button
          onClick={async () => {
            setStep('sending')
            setError(null)
            haptic('medium')
            try {
              await sendTon({
                keys,
                to: to.trim(),
                amountTon: amount,
                comment: comment.trim() || undefined,
              })
              haptic('success')
              bumpUsage(to.trim())
              setStep('sent')
            } catch (e) {
              haptic('error')
              setError(e instanceof Error ? e.message : 'Failed to send')
              setStep('confirm')
            }
          }}
          className="w-full py-3 rounded-xl bg-ton-primary hover:brightness-110 font-semibold"
        >
          Sign and send
        </button>
      </div>
    )
  }

  if (step === 'sending') {
    return (
      <div className="min-h-full p-6 flex flex-col items-center justify-center">
        <div className="animate-spin w-10 h-10 border-2 border-ton-primary border-t-transparent rounded-full mb-4" />
        <div className="text-ton-muted">Broadcasting transaction…</div>
      </div>
    )
  }

  // sent
  return (
    <div className="min-h-full p-6 max-w-md mx-auto flex flex-col items-center justify-center text-center">
      <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center text-3xl mb-4">
        🎉
      </div>
      <h1 className="text-2xl font-bold mb-2">Transaction sent</h1>
      <p className="text-ton-muted text-sm mb-6">
        It usually appears on-chain within a few seconds.
      </p>
      <button
        onClick={() => {
          onSent()
          onClose()
        }}
        className="w-full max-w-xs py-3 rounded-xl bg-ton-primary hover:brightness-110 font-semibold"
      >
        Done
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
