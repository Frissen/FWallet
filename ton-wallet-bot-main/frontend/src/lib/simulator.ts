/**
 * Tx simulator — heuristic risk analysis for outgoing TON transfers.
 * Uses TonAPI v2 (free, no key) to check destination metadata + scam tags.
 */

import { getTransactions } from './ton'

export type RiskLevel = 'safe' | 'caution' | 'danger'

export interface SimulationCheck {
  /** Stable id, e.g. 'known-recipient'. */
  id: string
  level: RiskLevel
  title: string
  description: string
}

export interface SimulationResult {
  level: RiskLevel
  /** 0-100 numeric score. */
  score: number
  checks: SimulationCheck[]
  /** Short human summary. */
  summary: string
}

interface TonApiAccount {
  is_scam?: boolean
  is_wallet?: boolean
  status?: string
  name?: string
}

async function fetchAccount(addr: string): Promise<TonApiAccount | null> {
  try {
    const r = await fetch(`https://tonapi.io/v2/accounts/${addr}`, {
      headers: { Accept: 'application/json' },
    })
    if (!r.ok) return null
    return (await r.json()) as TonApiAccount
  } catch {
    return null
  }
}

const OFFICIAL_ADDRESSES = new Set<string>([
  // Platform commission collector (filled at build via config)
  // We hard-code here too so simulator works without circular import.
  'UQABzjR08FCqluFyBlW2kYPUSDdeYD1LGq5t0iHojJGnHnQU',
])

export async function simulateTonTransfer(params: {
  fromAddress: string
  toAddress: string
  amountNano: bigint
  balanceNano: bigint
}): Promise<SimulationResult> {
  const checks: SimulationCheck[] = []
  let score = 0 // 0 = safe; +N for each risk; cap 100

  // 1. Official address?
  if (OFFICIAL_ADDRESSES.has(params.toAddress)) {
    checks.push({
      id: 'official',
      level: 'safe',
      title: 'Официальный адрес',
      description: 'Это служебный адрес Fwallet, безопасно',
    })
  }

  // 2. Self-transfer?
  if (params.toAddress === params.fromAddress) {
    checks.push({
      id: 'self',
      level: 'caution',
      title: 'Перевод самому себе',
      description: 'Адрес получателя совпадает с твоим. Проверь, что это намеренно',
    })
    score += 10
  }

  // 3. Big share of balance?
  if (params.balanceNano > 0n) {
    const ratio = Number(params.amountNano) / Number(params.balanceNano)
    if (ratio >= 0.95) {
      checks.push({
        id: 'big-amount',
        level: 'caution',
        title: `${Math.round(ratio * 100)}% от баланса`,
        description: 'Ты собираешься отправить почти всё. Убедись, что это не ошибка',
      })
      score += 15
    } else if (ratio >= 0.5) {
      checks.push({
        id: 'half-amount',
        level: 'caution',
        title: `${Math.round(ratio * 100)}% от баланса`,
        description: 'Крупный перевод',
      })
      score += 5
    }
  }

  // 4. Destination history check (TonAPI in parallel with our own history)
  const [destInfo, ourHistory] = await Promise.all([
    fetchAccount(params.toAddress),
    getTransactions(params.fromAddress, 30).catch(() => []),
  ])

  if (destInfo?.is_scam) {
    checks.push({
      id: 'scam',
      level: 'danger',
      title: 'Адрес помечен как мошеннический',
      description: 'TonAPI сообщает что этот адрес связан со скамом. Не отправляй',
    })
    score += 80
  }

  if (destInfo && destInfo.status && destInfo.status !== 'active') {
    checks.push({
      id: 'inactive',
      level: 'caution',
      title: 'Кошелёк-получатель неактивирован',
      description: 'Контракт ещё не запущен. Перевод дойдёт, но он может быть необычным',
    })
    score += 5
  }

  if (destInfo?.name) {
    checks.push({
      id: 'named',
      level: 'safe',
      title: `Известный адрес: ${destInfo.name}`,
      description: 'Адрес имеет публичное имя в TonAPI',
    })
  }

  // 5. Have we transacted with this address before?
  const knownBefore = ourHistory.some((tx) => {
    return tx.outMessages.some(
      (m) =>
        normalizeAddress(m.to) === normalizeAddress(params.toAddress),
    )
  })
  if (knownBefore && !OFFICIAL_ADDRESSES.has(params.toAddress)) {
    checks.push({
      id: 'known',
      level: 'safe',
      title: 'Ты отправлял сюда раньше',
      description: 'Адрес встречался в твоей истории — снижаем риск',
    })
  } else if (
    !OFFICIAL_ADDRESSES.has(params.toAddress) &&
    !destInfo?.name
  ) {
    checks.push({
      id: 'new',
      level: 'caution',
      title: 'Новый адрес',
      description: 'Ты ещё ни разу не отправлял на этот адрес. Проверь его внимательно',
    })
    score += 8
  }

  // Determine final level
  let level: RiskLevel = 'safe'
  if (score >= 50) level = 'danger'
  else if (score >= 15) level = 'caution'

  let summary: string
  if (level === 'danger') {
    summary = 'Высокий риск — не подписывай пока не разберёшься'
  } else if (level === 'caution') {
    summary = 'Стоит дважды проверить детали'
  } else {
    summary = 'Транзакция выглядит обычной'
  }

  return { level, score: Math.min(100, score), checks, summary }
}

/**
 * Normalize a TON address for comparison. Returns lower-cased base64url form
 * stripped of the bounce/non-bounce flag prefix. Cheap and good-enough for
 * "did we send here before?" matching.
 */
function normalizeAddress(a: string): string {
  if (!a) return ''
  return a.replace(/^(EQ|UQ|kQ|0Q|Ef|Uf)/, '').toLowerCase()
}
