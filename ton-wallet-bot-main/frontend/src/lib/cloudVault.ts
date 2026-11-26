// Telegram Cloud backup of the *encrypted* vault.
//
// The wallet is bound to the user's Telegram account: the PIN-encrypted vault
// is mirrored to Telegram.WebApp.CloudStorage (scoped to this bot + this TG
// user), so opening Fwallet on another device with the same Telegram account
// finds the wallet and only asks for the PIN. The seed phrase is never sent
// anywhere in plaintext — only the AES-GCM ciphertext produced from the PIN.
//
// Trade-off: a 6-digit PIN is weak against offline brute force, so anyone who
// could read the cloud blob could eventually crack it. Users can remove the
// cloud copy at any time in Settings.

import { getTelegramWebApp } from './telegram'
import { clearVault, loadVault, saveVault, type StoredVault } from './storage'

const CLOUD_KEY = 'fwallet_vault_v1'
const CLOUD_TIMEOUT_MS = 4000

export function cloudAvailable(): boolean {
  const tg = getTelegramWebApp()
  return !!tg?.initData && !!tg.CloudStorage
}

function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), CLOUD_TIMEOUT_MS)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      () => {
        clearTimeout(t)
        resolve(fallback)
      },
    )
  })
}

export function saveVaultToCloud(v: StoredVault): Promise<boolean> {
  const cs = getTelegramWebApp()?.CloudStorage
  if (!cs) return Promise.resolve(false)
  return withTimeout(
    new Promise<boolean>((resolve) => {
      cs.setItem(CLOUD_KEY, JSON.stringify(v), (err, stored) =>
        resolve(!err && !!stored),
      )
    }),
    false,
  )
}

export function loadVaultFromCloud(): Promise<StoredVault | null> {
  const cs = getTelegramWebApp()?.CloudStorage
  if (!cs) return Promise.resolve(null)
  return withTimeout(
    new Promise<StoredVault | null>((resolve) => {
      cs.getItem(CLOUD_KEY, (err, value) => {
        if (err || !value) return resolve(null)
        try {
          const v = JSON.parse(value) as StoredVault
          resolve(v?.vault?.ct && v?.address ? v : null)
        } catch {
          resolve(null)
        }
      })
    }),
    null,
  )
}

export function hasCloudBackup(): Promise<boolean> {
  return loadVaultFromCloud().then((v) => v !== null)
}

export function clearVaultFromCloud(): Promise<boolean> {
  const cs = getTelegramWebApp()?.CloudStorage
  if (!cs) return Promise.resolve(false)
  return withTimeout(
    new Promise<boolean>((resolve) => {
      cs.removeItem(CLOUD_KEY, (err, removed) => resolve(!err && !!removed))
    }),
    false,
  )
}

/** Save a freshly created / imported vault locally and mirror it to the
 * Telegram cloud in the background (never blocks the UI). */
export function persistVault(v: StoredVault): void {
  saveVault(v)
  if (cloudAvailable()) void saveVaultToCloud(v)
}

/** Restore the vault from Telegram cloud when this device has none. */
export async function restoreVaultFromCloud(): Promise<StoredVault | null> {
  if (loadVault()) return loadVault()
  if (!cloudAvailable()) return null
  const v = await loadVaultFromCloud()
  if (v) saveVault(v)
  return v
}

/** Remove the wallet from this device AND from the Telegram cloud. */
export async function wipeWallet(): Promise<void> {
  clearVault()
  if (cloudAvailable()) await clearVaultFromCloud()
}
