import { useCallback, useEffect, useMemo, useState } from 'react'
import { fromNano, getBalance, type WalletKeys } from '../lib/ton'
import {
  EVM_CHAINS,
  formatEvmNative,
  formatEvmToken,
  getEvmNativeBalance,
  getEvmTokenBalance,
} from '../lib/evm'
import { formatBtc, getBtcBalance } from '../lib/btc'
import { formatSol, formatSpl, getSolBalance, getSplBalance, SOL_TOKENS } from '../lib/sol'
import { type MultiChainKeys } from '../lib/wallet'
import {
  formatChange,
  formatFiat,
  getPriceFeed,
  type PriceFeed,
  type Symbol as PriceSymbol,
} from '../lib/prices'
import { Send } from './Send'
import { Receive } from './Receive'
import { ActivityFeed } from './ActivityFeed'
import {
  installShakeListener,
  isStealth,
  subscribeStealth,
  toggleStealth,
} from '../lib/stealth'

interface Props {
  keys: WalletKeys
  all: MultiChainKeys | null
  onOpenCheques: () => void
}

type View = 'home' | 'send' | 'receive'

interface AssetRow {
  /** Stable identifier (used as React key). */
  id: string
  symbol: PriceSymbol
  name: string
  network: string
  /** Logo URL (CryptoIcons CDN). */
  logo: string
  /** Balance in human-readable units. Empty / dash while loading. */
  balance: string
  /** Numeric balance for fiat conversion. */
  balanceNum: number
}

const HIDE_BAL_KEY = 'aw:home:hide-bal'

export function HomeTab({ keys, all, onOpenCheques }: Props) {
  const [view, setView] = useState<View>('home')
  const [hidden, setHidden] = useState<boolean>(() => {
    try {
      return localStorage.getItem(HIDE_BAL_KEY) === '1'
    } catch {
      return false
    }
  })
  const [tonBal, setTonBal] = useState<bigint>(0n)
  const [evmNative, setEvmNative] = useState<Record<string, bigint>>({})
  const [evmTokens, setEvmTokens] = useState<Record<string, bigint>>({})
  const [solBal, setSolBal] = useState<bigint>(0n)
  const [splBal, setSplBal] = useState<bigint>(0n)
  const [btcBal, setBtcBal] = useState<bigint>(0n)
  const [feed, setFeed] = useState<PriceFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stealth, setStealthState] = useState<boolean>(() => isStealth())

  useEffect(() => {
    installShakeListener()
    const unsub = subscribeStealth(setStealthState)
    return () => unsub()
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const tasks: Promise<unknown>[] = []
      tasks.push(
        getBalance(keys.address)
          .then(setTonBal)
          .catch(() => undefined),
      )
      tasks.push(getPriceFeed('RUB').then(setFeed).catch(() => undefined))
      if (all?.evm) {
        for (const chain of Object.values(EVM_CHAINS)) {
          tasks.push(
            getEvmNativeBalance(chain, all.evm.address)
              .then((b) =>
                setEvmNative((prev) => ({ ...prev, [chain.id]: b })),
              )
              .catch(() => undefined),
          )
          for (const token of chain.tokens) {
            tasks.push(
              getEvmTokenBalance(chain, token, all.evm.address)
                .then((b) =>
                  setEvmTokens((prev) => ({
                    ...prev,
                    [`${chain.id}:${token.symbol}`]: b,
                  })),
                )
                .catch(() => undefined),
            )
          }
        }
      }
      if (all?.sol) {
        tasks.push(
          getSolBalance(all.sol.publicKey)
            .then(setSolBal)
            .catch(() => undefined),
        )
        const usdc = SOL_TOKENS[0]
        if (usdc) {
          tasks.push(
            getSplBalance(all.sol.publicKey, usdc.mint)
              .then(setSplBal)
              .catch(() => undefined),
          )
        }
      }
      if (all?.btc) {
        tasks.push(
          getBtcBalance(all.btc.address)
            .then(setBtcBal)
            .catch(() => undefined),
        )
      }
      await Promise.all(tasks)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [keys.address, all])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const assets: AssetRow[] = useMemo(() => {
    const out: AssetRow[] = []
    out.push({
      id: 'ton',
      symbol: 'TON',
      name: 'Toncoin',
      network: 'TON',
      logo: 'https://assets.coingecko.com/coins/images/17980/large/ton_symbol.png',
      balance: fromNano(tonBal),
      balanceNum: Number(fromNano(tonBal)),
    })
    if (all?.btc) {
      const human = formatBtc(btcBal)
      out.push({
        id: 'btc',
        symbol: 'BTC',
        name: 'Bitcoin',
        network: 'BTC',
        logo: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
        balance: human,
        balanceNum: Number(human),
      })
    }
    if (all?.evm) {
      for (const chain of Object.values(EVM_CHAINS)) {
        const native = evmNative[chain.id] ?? 0n
        const human = formatEvmNative(native)
        out.push({
          id: `evm-${chain.id}`,
          symbol: chain.symbol as PriceSymbol,
          name: chain.symbol === 'ETH' ? 'Ethereum' : 'BNB Chain',
          network: chain.symbol,
          logo:
            chain.symbol === 'ETH'
              ? 'https://assets.coingecko.com/coins/images/279/large/ethereum.png'
              : 'https://assets.coingecko.com/coins/images/825/large/binance-coin-logo.png',
          balance: human,
          balanceNum: Number(human),
        })
        for (const token of chain.tokens) {
          // Only show USDT/USDC, dedup BUSD etc.
          if (token.symbol !== 'USDT' && token.symbol !== 'USDC') continue
          const raw = evmTokens[`${chain.id}:${token.symbol}`] ?? 0n
          const human = formatEvmToken(raw, token.decimals)
          // Skip zero token balance to keep the list short — except for the
          // primary chain to advertise the asset is supported.
          if (raw === 0n && chain.id !== 'eth') continue
          out.push({
            id: `${chain.id}-${token.symbol}`,
            symbol: token.symbol as PriceSymbol,
            name: token.symbol === 'USDT' ? 'Tether' : 'USD Coin',
            network: chain.symbol,
            logo:
              token.symbol === 'USDT'
                ? 'https://assets.coingecko.com/coins/images/325/large/Tether.png'
                : 'https://assets.coingecko.com/coins/images/6319/large/usdc.png',
            balance: human,
            balanceNum: Number(human),
          })
        }
      }
    }
    if (all?.sol) {
      const human = formatSol(solBal)
      out.push({
        id: 'sol',
        symbol: 'SOL',
        name: 'Solana',
        network: 'SOL',
        logo: 'https://assets.coingecko.com/coins/images/4128/large/solana.png',
        balance: human,
        balanceNum: Number(human),
      })
      const usdc = SOL_TOKENS[0]
      if (usdc) {
        const human = formatSpl(splBal, usdc.decimals)
        out.push({
          id: 'sol-usdc',
          symbol: 'USDC',
          name: 'USD Coin',
          network: 'SOL',
          logo: 'https://assets.coingecko.com/coins/images/6319/large/usdc.png',
          balance: human,
          balanceNum: Number(human),
        })
      }
    }
    return out
  }, [all, tonBal, evmNative, evmTokens, solBal, splBal, btcBal])

  const totalFiat = useMemo(() => {
    if (!feed) return 0
    return assets.reduce((acc, a) => {
      const q = feed.quotes[a.symbol]
      if (!q) return acc
      return acc + a.balanceNum * q.priceUsd * feed.fiatRate
    }, 0)
  }, [assets, feed])

  if (view === 'send') {
    return (
      <Send
        keys={keys}
        balanceNano={tonBal}
        onClose={() => setView('home')}
        onSent={() => {
          void refresh()
        }}
      />
    )
  }
  if (view === 'receive') {
    return <Receive address={keys.address} onClose={() => setView('home')} />
  }

  const fiatLabel = feed ? feed.fiat : 'RUB'
  const totalText = stealth
    ? formatFiat(0, fiatLabel)
    : hidden
      ? '••••'
      : formatFiat(totalFiat, fiatLabel)
  const short = `${keys.address.slice(0, 4)}…${keys.address.slice(-4)}`

  return (
    <div className="px-4 pt-3 pb-32">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => {
            void navigator.clipboard.writeText(keys.address)
          }}
          className="px-3 py-1.5 rounded-full bg-ton-card border border-ton-border text-xs font-mono active:scale-95"
          title="Скопировать адрес"
        >
          {short}
        </button>
        <div className="flex gap-2">
          <IconButton
            onClick={() => toggleStealth()}
            title={stealth ? 'Выйти из режима невидимки' : 'Режим невидимки'}
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              {stealth ? (
                <path
                  d="M4 12c.7-2 2.8-5 8-5 1.7 0 3.1.3 4.3.9M20 12c-.5 1.3-1.6 2.8-3.2 4M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ) : (
                <>
                  <path
                    d="M12 3a4 4 0 0 1 4 4v2"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M5 11h14l-1 8a3 3 0 0 1-3 2.5H9A3 3 0 0 1 6 19l-1-8z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                </>
              )}
            </svg>
          </IconButton>
          <IconButton onClick={() => void refresh()} title="Обновить">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`}
            >
              <path
                d="M4 12a8 8 0 0 1 13.5-5.8L20 4M20 12a8 8 0 0 1-13.5 5.8L4 20"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M20 4v4h-4M4 20v-4h4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </IconButton>
        </div>
      </div>

      {stealth && (
        <div className="mb-3 flex items-center gap-2 rounded-2xl border border-ton-border bg-ton-card/60 px-3 py-2 text-[11px] text-ton-muted">
          <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-ton-primary shrink-0">
            <path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7l7-4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
          </svg>
          Режим невидимки. Балансы скрыты. Тряхни телефон или нажми иконку, чтобы выйти.
        </div>
      )}

      {/* Hero balance card */}
      <div className="fw-hero px-5 pt-4 pb-4 mb-5">
        <div className="relative z-10">
          <div className="text-center text-[9px] uppercase tracking-[0.18em] text-ton-muted mb-0.5">
            Общий баланс · {fiatLabel}
          </div>
          <div className="flex items-center justify-center gap-2">
            <span className="text-[32px] leading-tight font-bold tracking-tight">{totalText}</span>
            <button
              onClick={() => {
                const next = !hidden
                setHidden(next)
                try {
                  localStorage.setItem(HIDE_BAL_KEY, next ? '1' : '0')
                } catch {
                  // ignore
                }
              }}
              className="text-ton-muted active:scale-90 -translate-y-1"
              title={hidden ? 'Показать баланс' : 'Скрыть баланс'}
            >
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
            {hidden ? (
              <path
                d="M3 3l18 18M9.88 9.88a3 3 0 0 0 4.24 4.24M10.74 5.08A10.4 10.4 0 0 1 12 5c5 0 9 4.5 10 7-0.46 1.16-1.43 2.7-2.86 4.05M6.4 6.4C4.27 8 2.92 10 2 12c1 2.5 5 7 10 7 1.74 0 3.34-.36 4.7-.95"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ) : (
              <>
                <path
                  d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
              </>
            )}
          </svg>
            </button>
          </div>
        </div>

        <div className="relative z-10 flex justify-center gap-6 mt-3">
        <RoundCta
          onClick={() => setView('receive')}
          label="Пополнить"
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
              <path
                d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
        />
        <RoundCta
          onClick={() => setView('send')}
          label="Вывести"
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
              <path
                d="M12 20V8m0 0l-5 5m5-5l5 5M4 4h16"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
        />
        <RoundCta
          onClick={onOpenCheques}
          label="Чеки"
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
              <path
                d="M6 4h12v17l-3-2-3 2-3-2-3 2V4Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M9 9h6M9 13h6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          }
        />
        </div>
      </div>

      {/* Asset list header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="text-base font-semibold">Мои активы</div>
        <button
          onClick={() => void refresh()}
          className="text-ton-primary text-xs font-medium active:scale-95"
        >
          Обновить
        </button>
      </div>

      {error && (
        <div className="mb-3 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-2xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="rounded-3xl bg-ton-card border border-ton-border divide-y divide-ton-border overflow-hidden">
        {assets.map((a) => {
          const q = feed?.quotes[a.symbol]
          const change = q ? formatChange(q.change24h) : null
          const fiatVal =
            q && feed ? a.balanceNum * q.priceUsd * feed.fiatRate : 0
          return (
            <div
              key={a.id}
              className="flex items-center px-4 py-3 active:bg-ton-card-hover transition"
            >
              <div className="w-10 h-10 rounded-full bg-ton-dark overflow-hidden flex items-center justify-center text-xs font-bold mr-3">
                <img
                  src={a.logo}
                  alt={a.symbol}
                  className="w-10 h-10 object-cover"
                  onError={(e) => {
                    ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                  }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{a.name}</div>
                <div className="text-xs text-ton-muted flex items-center gap-1.5">
                  {q ? (
                    <>
                      <span>${formatPrice(q.priceUsd)}</span>
                      {change && (
                        <span
                          className={
                            change.positive
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }
                        >
                          {change.text}
                        </span>
                      )}
                    </>
                  ) : (
                    <span>·</span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">
                  {stealth
                    ? `0 ${a.symbol}`
                    : hidden
                      ? '••••'
                      : `${a.balance} ${a.symbol}`}
                </div>
                <div className="text-xs text-ton-muted tabular-nums">
                  {stealth
                    ? formatFiat(0, fiatLabel)
                    : hidden
                      ? ''
                      : formatFiat(fiatVal, fiatLabel)}
                </div>
              </div>
            </div>
          )
        })}
        {assets.length === 0 && (
          <div className="text-sm text-ton-muted py-8 text-center">
            Загружаем балансы…
          </div>
        )}
      </div>

      {/* Recent on-chain activity */}
      {!stealth && (
        <div className="mt-5">
          <ActivityFeed address={keys.address} limit={6} />
        </div>
      )}
    </div>
  )
}

function IconButton({
  onClick,
  children,
  title,
}: {
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-10 h-10 rounded-full bg-ton-card border border-ton-border text-white/80 flex items-center justify-center active:scale-95"
    >
      {children}
    </button>
  )
}

function RoundCta({
  onClick,
  label,
  icon,
}: {
  onClick: () => void
  label: string
  icon: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 active:scale-95 transition"
    >
      <span className="fw-cta-primary w-11 h-11 rounded-full flex items-center justify-center">
        {icon}
      </span>
      <span className="text-[11px] text-ton-text/90 font-medium">{label}</span>
    </button>
  )
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(0)
  if (price >= 1) return price.toFixed(2)
  return price.toFixed(4)
}
