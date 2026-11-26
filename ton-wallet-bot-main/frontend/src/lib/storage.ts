import { STORAGE_KEY_VAULT, LEGACY_STORAGE_KEYS } from './config'
import type { EncryptedVault } from './crypto'

export interface StoredVault {
  vault: EncryptedVault
  // Public, non-sensitive metadata so the lock screen can display the
  // address before the user enters the PIN.
  address: string
  createdAt: number
}

const BACKED_UP_KEY = 'fwallet:backed-up:v1'

function parse(raw: string | null): StoredVault | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as StoredVault
    if (v?.vault?.ct && v?.address) return v
  } catch {
    // ignore
  }
  return null
}

export function loadVault(): StoredVault | null {
  try {
    const current = parse(localStorage.getItem(STORAGE_KEY_VAULT))
    if (current) return current
    // One-time migration from the pre-Fwallet storage keys.
    for (const legacy of LEGACY_STORAGE_KEYS.vault) {
      const old = parse(localStorage.getItem(legacy))
      if (old) {
        localStorage.setItem(STORAGE_KEY_VAULT, JSON.stringify(old))
        // Wallets that existed before the backup banner are treated as
        // already backed up so existing users aren't nagged.
        localStorage.setItem(BACKED_UP_KEY, '1')
        return old
      }
    }
  } catch {
    // localStorage may be unavailable
  }
  return null
}

export function saveVault(v: StoredVault): void {
  localStorage.setItem(STORAGE_KEY_VAULT, JSON.stringify(v))
}

export function clearVault(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_VAULT)
    for (const legacy of LEGACY_STORAGE_KEYS.vault) {
      localStorage.removeItem(legacy)
    }
    localStorage.removeItem(BACKED_UP_KEY)
  } catch {
    // ignore
  }
}

export function isBackedUp(): boolean {
  try {
    return localStorage.getItem(BACKED_UP_KEY) === '1'
  } catch {
    return true
  }
}

export function markBackedUp(): void {
  try {
    localStorage.setItem(BACKED_UP_KEY, '1')
  } catch {
    // ignore
  }
}
