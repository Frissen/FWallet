import { useEffect, useState } from 'react'
import { type WalletKeys, getBalance, fromNano } from '../lib/ton'
import { type MultiChainKeys } from '../lib/wallet'
import {
  EVM_CHAINS,
  formatEvmNative,
  formatEvmToken,
  getEvmNativeBalance,
  getEvmTokenBalance,
  type EvmChainConfig,
  type EvmTokenConfig,
} from '../lib/evm'
import {
  formatSol,
  formatSpl,
  getSolBalance,
  getSplBalance,
  SOL_TOKENS,
} from '../lib/sol'
import { formatBtc, getBtcBalance } from '../lib/btc'
import { Receive } from './Receive'
import { SendEvm } from './SendEvm'
import { SendSol } from './SendSol'
import { SendBtc } from './SendBtc'

interface Props {
  keys: WalletKeys
  all: MultiChainKeys | null
}

type Drawer =
  | { kind: 'send-evm'; chain: EvmChainConfig; token?: EvmTokenConfig }
  | { kind: 'send-sol'; mint?: string }
  | { kind: 'send-btc' }
  | { kind: 'receive'; address: string; label: string }
  | null

export function WalletsTab({ keys, all }: Props) {
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const refresh = () => setRefreshTick((x) => x + 1)

  if (drawer?.kind === 'receive') {
    return (
      <Receive address={drawer.address} onClose={() => setDrawer(null)} />
    )
  }
  if (drawer?.kind === 'send-evm' && all?.evm) {
    return (
      <SendEvm
        chain={drawer.chain}
        token={drawer.token}
        keys={all.evm}
        onClose={() => setDrawer(null)}
        onSent={refresh}
      />
    )
  }
  if (drawer?.kind === 'send-sol' && all?.sol) {
    return (
      <SendSol
        keys={all.sol}
        mint={drawer.mint}
        onClose={() => setDrawer(null)}
        onSent={refresh}
      />
    )
  }
  if (drawer?.kind === 'send-btc' && all?.btc) {
    return (
      <SendBtc
        keys={all.btc}
        onClose={() => setDrawer(null)}
        onSent={refresh}
      />
    )
  }

  return (
    <div className="p-5 max-w-md mx-auto pb-24 space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold">Кошельки</h1>
        <button
          onClick={refresh}
          className="px-3 py-1.5 rounded-full bg-ton-card border border-ton-border text-xs hover:bg-ton-border"
        >
          Обновить
        </button>
      </div>

      <TonCard
        keys={keys}
        tick={refreshTick}
        onReceive={() =>
          setDrawer({ kind: 'receive', address: keys.address, label: 'TON' })
        }
      />

      {all?.evm && (
        <>
          <EvmCard
            chain={EVM_CHAINS.eth}
            keys={all.evm}
            tick={refreshTick}
            onSendNative={() =>
              setDrawer({ kind: 'send-evm', chain: EVM_CHAINS.eth })
            }
            onSendToken={(token) =>
              setDrawer({ kind: 'send-evm', chain: EVM_CHAINS.eth, token })
            }
            onReceive={() =>
              setDrawer({ kind: 'receive', address: all.evm!.address, label: 'ETH' })
            }
          />
          <EvmCard
            chain={EVM_CHAINS.bsc}
            keys={all.evm}
            tick={refreshTick}
            onSendNative={() =>
              setDrawer({ kind: 'send-evm', chain: EVM_CHAINS.bsc })
            }
            onSendToken={(token) =>
              setDrawer({ kind: 'send-evm', chain: EVM_CHAINS.bsc, token })
            }
            onReceive={() =>
              setDrawer({ kind: 'receive', address: all.evm!.address, label: 'BNB' })
            }
          />
        </>
      )}

      {all?.sol && (
        <SolCard
          keys={all.sol}
          tick={refreshTick}
          onSendNative={() => setDrawer({ kind: 'send-sol' })}
          onSendUsdc={() =>
            setDrawer({ kind: 'send-sol', mint: SOL_TOKENS[0].mint })
          }
          onReceive={() =>
            setDrawer({ kind: 'receive', address: all.sol!.publicKey, label: 'SOL' })
          }
        />
      )}

      {all?.btc && (
        <BtcCard
          address={all.btc.address}
          tick={refreshTick}
          onSend={() => setDrawer({ kind: 'send-btc' })}
          onReceive={() =>
            setDrawer({ kind: 'receive', address: all.btc!.address, label: 'BTC' })
          }
        />
      )}

      {!all && (
        <div className="text-sm text-ton-muted py-8 text-center bg-ton-card/40 rounded-xl">
          Загружаем ключи всех сетей…
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-chain cards
// ---------------------------------------------------------------------------

function ChainCard({
  title,
  symbol,
  address,
  balanceLine,
  tokens,
  onSendNative,
  onReceive,
}: {
  title: string
  symbol: string
  address: string
  balanceLine: string
  tokens?: { symbol: string; balance: string; onSend?: () => void }[]
  onSendNative?: () => void
  onReceive: () => void
}) {
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`
  return (
    <div className="bg-ton-card border border-ton-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-[11px] text-ton-muted font-mono">{short}</div>
        </div>
        <div className="text-right">
          <div className="text-base font-semibold">{balanceLine}</div>
          <div className="text-[10px] text-ton-muted uppercase">{symbol}</div>
        </div>
      </div>
      <div className="flex gap-2 mt-2">
        {onSendNative && (
          <button
            onClick={onSendNative}
            className="flex-1 py-2 rounded-xl bg-ton-primary hover:brightness-110 text-xs font-semibold"
          >
            Отправить {symbol}
          </button>
        )}
        <button
          onClick={onReceive}
          className="flex-1 py-2 rounded-xl bg-ton-card border border-ton-border hover:bg-ton-border text-xs font-semibold"
        >
          Получить
        </button>
      </div>
      {tokens && tokens.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {tokens.map((t) => (
            <div
              key={t.symbol}
              className="flex items-center justify-between bg-ton-card/60 border border-ton-border rounded-lg px-3 py-2"
            >
              <div className="text-xs">{t.symbol}</div>
              <div className="flex items-center gap-2">
                <div className="text-xs font-mono">{t.balance}</div>
                {t.onSend && (
                  <button
                    onClick={t.onSend}
                    className="text-[11px] text-ton-primary hover:underline"
                  >
                    Отправить
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TonCard({
  keys,
  tick,
  onReceive,
}: {
  keys: WalletKeys
  tick: number
  onReceive: () => void
}) {
  const [bal, setBal] = useState<string>('—')
  useEffect(() => {
    void (async () => {
      try {
        const b = await getBalance(keys.address)
        setBal(fromNano(b))
      } catch {
        setBal('—')
      }
    })()
  }, [keys.address, tick])
  return (
    <ChainCard
      title="TON"
      symbol="TON"
      address={keys.address}
      balanceLine={bal}
      onReceive={onReceive}
    />
  )
}

function EvmCard({
  chain,
  keys,
  tick,
  onSendNative,
  onSendToken,
  onReceive,
}: {
  chain: EvmChainConfig
  keys: NonNullable<MultiChainKeys['evm']>
  tick: number
  onSendNative: () => void
  onSendToken: (token: EvmTokenConfig) => void
  onReceive: () => void
}) {
  const [native, setNative] = useState<string>('—')
  const [tokens, setTokens] = useState<{ symbol: string; balance: string; onSend?: () => void }[]>(
    [],
  )
  useEffect(() => {
    void (async () => {
      try {
        const n = await getEvmNativeBalance(chain, keys.address)
        setNative(formatEvmNative(n))
      } catch {
        setNative('—')
      }
      const tr = await Promise.all(
        chain.tokens.map(async (t) => {
          try {
            const b = await getEvmTokenBalance(chain, t, keys.address)
            return {
              symbol: `${t.symbol} (${chain.symbol === 'ETH' ? 'ERC-20' : 'BEP-20'})`,
              balance: formatEvmToken(b, t.decimals),
              onSend: () => onSendToken(t),
            }
          } catch {
            return {
              symbol: `${t.symbol}`,
              balance: '—',
              onSend: () => onSendToken(t),
            }
          }
        }),
      )
      setTokens(tr)
    })()
  }, [chain, keys.address, tick, onSendToken])
  return (
    <ChainCard
      title={chain.name}
      symbol={chain.symbol}
      address={keys.address}
      balanceLine={native}
      tokens={tokens}
      onSendNative={onSendNative}
      onReceive={onReceive}
    />
  )
}

function SolCard({
  keys,
  tick,
  onSendNative,
  onSendUsdc,
  onReceive,
}: {
  keys: NonNullable<MultiChainKeys['sol']>
  tick: number
  onSendNative: () => void
  onSendUsdc: () => void
  onReceive: () => void
}) {
  const [bal, setBal] = useState<string>('—')
  const [usdc, setUsdc] = useState<string>('—')
  useEffect(() => {
    void (async () => {
      try {
        const b = await getSolBalance(keys.publicKey)
        setBal(formatSol(b))
      } catch {
        setBal('—')
      }
      try {
        const u = await getSplBalance(keys.publicKey, SOL_TOKENS[0].mint)
        setUsdc(formatSpl(u, SOL_TOKENS[0].decimals))
      } catch {
        setUsdc('—')
      }
    })()
  }, [keys.publicKey, tick])
  return (
    <ChainCard
      title="Solana"
      symbol="SOL"
      address={keys.publicKey}
      balanceLine={bal}
      tokens={[{ symbol: 'USDC (SPL)', balance: usdc, onSend: onSendUsdc }]}
      onSendNative={onSendNative}
      onReceive={onReceive}
    />
  )
}

function BtcCard({
  address,
  tick,
  onSend,
  onReceive,
}: {
  address: string
  tick: number
  onSend: () => void
  onReceive: () => void
}) {
  const [bal, setBal] = useState<string>('—')
  useEffect(() => {
    void (async () => {
      try {
        const b = await getBtcBalance(address)
        setBal(formatBtc(b))
      } catch {
        setBal('—')
      }
    })()
  }, [address, tick])
  return (
    <ChainCard
      title="Bitcoin"
      symbol="BTC"
      address={address}
      balanceLine={bal}
      onSendNative={onSend}
      onReceive={onReceive}
    />
  )
}
