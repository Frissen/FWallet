/**
 * Activity feed for a TON address.
 * Pulls recent events from TonAPI v2 and normalises them into a UI-friendly
 * shape (transfers in/out, jetton transfers, NFT moves, contract calls).
 *
 * Free public endpoint, no key required.
 */

export type ActivityKind =
  | 'ton_in'
  | 'ton_out'
  | 'jetton_in'
  | 'jetton_out'
  | 'nft_in'
  | 'nft_out'
  | 'contract'

export interface ActivityItem {
  id: string
  ts: number
  kind: ActivityKind
  /** Human-readable amount (already formatted with symbol). */
  amount: string
  /** Counterparty address (raw or aliased). */
  counterparty: string
  /** Short label for the action, e.g. "Получено", "Свап", "NFT отправлен". */
  label: string
}

interface RawAction {
  type?: string
  status?: string
  TonTransfer?: {
    amount?: number
    sender?: { address?: string }
    recipient?: { address?: string }
  }
  JettonTransfer?: {
    amount?: string
    sender?: { address?: string }
    recipient?: { address?: string }
    jetton?: { symbol?: string; decimals?: number }
  }
  NftItemTransfer?: {
    sender?: { address?: string }
    recipient?: { address?: string }
    nft?: string
  }
  ContractDeploy?: { interfaces?: string[] }
}

interface RawEvent {
  event_id: string
  timestamp: number
  actions: RawAction[]
}

interface TonApiEventsResponse {
  events?: RawEvent[]
}

const TONAPI_BASE = 'https://tonapi.io/v2'

function shortAddr(a?: string): string {
  if (!a) return ''
  if (a.length < 12) return a
  return `${a.slice(0, 4)}…${a.slice(-4)}`
}

function fmtTon(nano: number): string {
  const t = nano / 1e9
  if (t < 0.001) return `${t.toFixed(6)} TON`
  if (t < 1) return `${t.toFixed(4)} TON`
  return `${t.toFixed(2)} TON`
}

function fmtJetton(raw: string, decimals = 9, symbol = ''): string {
  const v = Number(raw) / Math.pow(10, decimals)
  const s = v < 0.001 ? v.toFixed(6) : v < 1 ? v.toFixed(4) : v.toFixed(2)
  return symbol ? `${s} ${symbol}` : s
}

export async function fetchActivity(
  address: string,
  limit = 12,
): Promise<ActivityItem[]> {
  if (!address) return []
  const url = `${TONAPI_BASE}/accounts/${address}/events?limit=${limit}`
  let resp: Response
  try {
    resp = await fetch(url, { headers: { Accept: 'application/json' } })
  } catch {
    return []
  }
  if (!resp.ok) return []
  let data: TonApiEventsResponse
  try {
    data = (await resp.json()) as TonApiEventsResponse
  } catch {
    return []
  }
  const events = data.events ?? []
  const items: ActivityItem[] = []
  for (const ev of events) {
    for (const ac of ev.actions ?? []) {
      const t = ac.type
      if (t === 'TonTransfer' && ac.TonTransfer) {
        const tr = ac.TonTransfer
        const out = tr.sender?.address === address
        items.push({
          id: `${ev.event_id}:${items.length}`,
          ts: ev.timestamp * 1000,
          kind: out ? 'ton_out' : 'ton_in',
          amount: fmtTon(Number(tr.amount ?? 0)),
          counterparty: shortAddr(out ? tr.recipient?.address : tr.sender?.address),
          label: out ? 'Отправлено' : 'Получено',
        })
        break
      }
      if (t === 'JettonTransfer' && ac.JettonTransfer) {
        const tr = ac.JettonTransfer
        const out = tr.sender?.address === address
        items.push({
          id: `${ev.event_id}:${items.length}`,
          ts: ev.timestamp * 1000,
          kind: out ? 'jetton_out' : 'jetton_in',
          amount: fmtJetton(
            tr.amount ?? '0',
            tr.jetton?.decimals ?? 9,
            tr.jetton?.symbol ?? '',
          ),
          counterparty: shortAddr(out ? tr.recipient?.address : tr.sender?.address),
          label: out ? 'Жетон отправлен' : 'Жетон получен',
        })
        break
      }
      if (t === 'NftItemTransfer' && ac.NftItemTransfer) {
        const tr = ac.NftItemTransfer
        const out = tr.sender?.address === address
        items.push({
          id: `${ev.event_id}:${items.length}`,
          ts: ev.timestamp * 1000,
          kind: out ? 'nft_out' : 'nft_in',
          amount: 'NFT',
          counterparty: shortAddr(out ? tr.recipient?.address : tr.sender?.address),
          label: out ? 'NFT отправлен' : 'NFT получен',
        })
        break
      }
      if (t === 'ContractDeploy' || t === 'SmartContractExec') {
        items.push({
          id: `${ev.event_id}:${items.length}`,
          ts: ev.timestamp * 1000,
          kind: 'contract',
          amount: '',
          counterparty: '',
          label: 'Контракт',
        })
        break
      }
    }
  }
  return items
}

export function formatTimeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'только что'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч назад`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d} дн назад`
  const date = new Date(ts)
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
