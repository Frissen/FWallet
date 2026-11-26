import { useState } from 'react'
import { type WalletKeys } from '../lib/ton'
import { type MultiChainKeys } from '../lib/wallet'
import { ChequesTab } from './ChequesTab'
import { WalletsTab } from './WalletsTab'
import { SettingsTab } from './SettingsTab'
import { clearBiometric } from '../lib/biometric'
import { wipeWallet } from '../lib/cloudVault'
import { P2P_API_BASE, APP_NAME } from '../lib/config'
import { getTelegramWebApp } from '../lib/telegram'

interface Props {
  keys: WalletKeys
  all: MultiChainKeys | null
  onLock: () => void
  onForget: () => void
  onOpenCheques: () => void
}

type Sub = null | 'wallets' | 'cheques' | 'settings'

export function MoreTab(props: Props) {
  const [sub, setSub] = useState<Sub>(null)

  if (sub === 'wallets') {
    return (
      <BackFrame title="Все кошельки" onBack={() => setSub(null)}>
        <WalletsTab keys={props.keys} all={props.all} />
      </BackFrame>
    )
  }
  if (sub === 'cheques') {
    return (
      <BackFrame title="Чеки" onBack={() => setSub(null)}>
        <ChequesTab
          keys={props.keys}
          balanceNano={0n}
          onAfterAction={() => undefined}
          onClose={() => setSub(null)}
        />
      </BackFrame>
    )
  }
  if (sub === 'settings') {
    return (
      <BackFrame title="Настройки" onBack={() => setSub(null)}>
        <SettingsTab
          keys={props.keys}
          all={props.all}
          onLock={props.onLock}
          onForget={props.onForget}
          onOpenCheques={props.onOpenCheques}
        />
      </BackFrame>
    )
  }

  return (
    <div className="px-4 pt-4 pb-32">
      <h1 className="text-xl font-bold mb-5">Ещё</h1>
      <div className="grid grid-cols-2 gap-3">
        <Tile
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7">
              <rect x="3" y="6" width="18" height="12" rx="3" stroke="currentColor" strokeWidth="2" />
              <circle cx="16" cy="12" r="1.5" fill="currentColor" />
            </svg>
          }
          title="Все кошельки"
          subtitle="TON, BTC, ETH, SOL"
          accent="#4C8DFF"
          onClick={() => setSub('wallets')}
        />
        <Tile
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7">
              <path d="M6 4h12v17l-3-2-3 2-3-2-3 2V4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M9 9h6M9 13h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          }
          title="Чеки"
          subtitle="Отправь TON по ссылке"
          accent="#FACC15"
          onClick={() => setSub('cheques')}
        />
        <Tile
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7">
              <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H17a3 3 0 0 1 3 3v9a4 4 0 0 1-4 4H7a3 3 0 0 1-3-3V6.5Z" stroke="currentColor" strokeWidth="2" />
              <path d="M9 10h7M9 14h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          }
          title="Pay-API"
          subtitle="Приём TON-платежей"
          accent="#22D3EE"
          onClick={() => {
            const url = `${P2P_API_BASE}/docs/pay`
            const tg = getTelegramWebApp()
            if (tg?.openLink) tg.openLink(url)
            else window.open(url, '_blank')
          }}
        />
        <Tile
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
              <path d="M19 12a7 7 0 0 0-.1-1.1l2-1.5-2-3.4-2.3.9c-.5-.4-1.1-.7-1.7-1L14.5 3h-5l-.4 2.4c-.6.2-1.2.5-1.7 1l-2.3-1-2 3.5 2 1.5C5 11 5 11.5 5 12s0 1 .1 1.5l-2 1.5 2 3.4 2.3-.9c.5.4 1.1.7 1.7 1l.4 2.5h5l.4-2.4c.6-.2 1.2-.5 1.7-1l2.3.9 2-3.4-2-1.5c0-.5.1-1 .1-1.6Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          }
          title="Настройки"
          subtitle="Seed-фраза, безопасность"
          accent="#A78BFA"
          onClick={() => setSub('settings')}
        />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          onClick={props.onLock}
          className="rounded-2xl bg-ton-card border border-ton-border hover:bg-ton-card-hover py-3 px-4 text-sm font-medium active:scale-[0.98] flex items-center justify-center gap-2 transition"
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
            <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" />
          </svg>
          Заблокировать
        </button>
        <button
          onClick={() => {
            if (
              confirm(
                'Удалить кошелёк с этого устройства и из облака Telegram? Без seed-фразы восстановить его будет нельзя.',
              )
            ) {
              clearBiometric()
              void wipeWallet()
              props.onForget()
            }
          }}
          className="rounded-2xl bg-ton-card border border-ton-border hover:bg-ton-card-hover py-3 px-4 text-sm font-medium text-rose-400 active:scale-[0.98] flex items-center justify-center gap-2 transition"
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
            <path d="M5 7h14M10 11v6M14 11v6M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Удалить
        </button>
      </div>

      <p className="text-[11px] text-ton-muted text-center mt-6">
        {APP_NAME} · некастодиальный кошелёк
      </p>
    </div>
  )
}

function Tile({
  icon,
  title,
  subtitle,
  onClick,
  accent,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick: () => void
  accent?: string
}) {
  return (
    <button
      onClick={onClick}
      className="fw-tile p-4 text-left flex flex-col gap-3"
    >
      <span
        className="fw-tile-icon"
        style={accent ? ({ ['--accent' as string]: accent } as React.CSSProperties) : undefined}
      >
        {icon}
      </span>
      <div>
        <div className="font-semibold text-sm leading-tight">{title}</div>
        <div className="text-[11px] text-ton-muted mt-0.5 leading-snug">{subtitle}</div>
      </div>
    </button>
  )
}

function BackFrame({
  title,
  onBack,
  children,
}: {
  title: string
  onBack: () => void
  children: React.ReactNode
}) {
  return (
    <div className="pb-32">
      <div className="sticky top-0 z-10 bg-ton-dark/95 px-4 py-3 flex items-center gap-3 border-b border-ton-border">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full bg-ton-card border border-ton-border flex items-center justify-center active:scale-95"
          aria-label="Назад"
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
            <path
              d="M15 6l-6 6 6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="font-semibold">{title}</div>
      </div>
      {children}
    </div>
  )
}
