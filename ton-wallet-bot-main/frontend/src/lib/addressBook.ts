/**
 * Local address book. Stores aliases for TON addresses in localStorage.
 * No server, no sync — pure-local convenience for repeated sends.
 */

const KEY = 'aw:addrbook:v1'

export interface AddressEntry {
  address: string
  name: string
  /** Optional emoji to show next to the name. */
  emoji?: string
  /** Unix ms timestamp of last use; used for sort. */
  lastUsed: number
  /** How many times the user has sent to this address. */
  count: number
}

function load(): AddressEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter(
      (x): x is AddressEntry =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as AddressEntry).address === 'string' &&
        typeof (x as AddressEntry).name === 'string',
    )
  } catch {
    return []
  }
}

function save(list: AddressEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

export function listEntries(): AddressEntry[] {
  return load().sort((a, b) => b.lastUsed - a.lastUsed)
}

export function findByAddress(address: string): AddressEntry | null {
  const list = load()
  return list.find((e) => e.address === address) ?? null
}

export function upsertEntry(
  address: string,
  name: string,
  emoji?: string,
): AddressEntry {
  const list = load()
  const idx = list.findIndex((e) => e.address === address)
  const now = Date.now()
  if (idx >= 0) {
    list[idx] = { ...list[idx], name, emoji, lastUsed: now }
  } else {
    list.push({ address, name, emoji, lastUsed: now, count: 0 })
  }
  save(list)
  return list.find((e) => e.address === address)!
}

export function bumpUsage(address: string): void {
  const list = load()
  const idx = list.findIndex((e) => e.address === address)
  if (idx < 0) return
  list[idx] = {
    ...list[idx],
    lastUsed: Date.now(),
    count: (list[idx].count ?? 0) + 1,
  }
  save(list)
}

export function removeEntry(address: string): void {
  save(load().filter((e) => e.address !== address))
}
