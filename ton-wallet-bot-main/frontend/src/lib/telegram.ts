// Minimal, typed wrapper around the Telegram WebApp JS bridge.
// Loaded via the <script> tag in index.html; if the wallet is opened in a
// regular browser (not inside Telegram) all helpers become safe no-ops.

interface TelegramThemeParams {
  bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  secondary_bg_color?: string
}

interface TelegramHapticFeedback {
  impactOccurred: (
    style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft',
  ) => void
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void
  selectionChanged: () => void
}

export interface TelegramBiometricManager {
  isInited: boolean
  isBiometricAvailable: boolean
  biometricType: 'finger' | 'face' | 'unknown'
  isAccessRequested: boolean
  isAccessGranted: boolean
  isBiometricTokenSaved: boolean
  deviceId: string
  init: (callback?: () => void) => TelegramBiometricManager
  requestAccess: (
    params: { reason?: string },
    callback?: (granted: boolean) => void,
  ) => TelegramBiometricManager
  authenticate: (
    params: { reason?: string },
    callback?: (success: boolean, token?: string) => void,
  ) => TelegramBiometricManager
  updateBiometricToken: (
    token: string,
    callback?: (updated: boolean) => void,
  ) => TelegramBiometricManager
  openSettings: () => TelegramBiometricManager
}

export interface TelegramCloudStorage {
  setItem: (
    key: string,
    value: string,
    cb?: (err: string | null, stored?: boolean) => void,
  ) => void
  getItem: (
    key: string,
    cb: (err: string | null, value?: string) => void,
  ) => void
  removeItem: (
    key: string,
    cb?: (err: string | null, removed?: boolean) => void,
  ) => void
}

interface TelegramWebApp {
  ready: () => void
  expand: () => void
  close: () => void
  initData: string
  initDataUnsafe: {
    user?: { id: number; first_name?: string }
    start_param?: string
  }
  themeParams: TelegramThemeParams
  colorScheme: 'light' | 'dark'
  HapticFeedback: TelegramHapticFeedback
  setHeaderColor: (color: string) => void
  setBackgroundColor: (color: string) => void
  BiometricManager?: TelegramBiometricManager
  CloudStorage?: TelegramCloudStorage
  openLink?: (url: string) => void
  version?: string
  platform?: string
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null
}

export function isInsideTelegram(): boolean {
  return !!getTelegramWebApp()?.initData
}

/** Reads the active theme's --ton-dark from CSS, or falls back to default dark. */
function readThemeBg(): string {
  try {
    const c = getComputedStyle(document.documentElement)
      .getPropertyValue('--ton-dark')
      .trim()
    if (c && /^#[0-9A-Fa-f]{3,8}$/.test(c)) return c
  } catch {
    // ignore
  }
  return '#0A0E16'
}

export function syncTelegramChrome(): void {
  const tg = getTelegramWebApp()
  if (!tg) return
  const bg = readThemeBg()
  try {
    tg.setHeaderColor(bg)
    tg.setBackgroundColor(bg)
  } catch {
    // ignore
  }
}

export function initTelegram(): void {
  const tg = getTelegramWebApp()
  if (!tg) return
  try {
    tg.ready()
    tg.expand()
    syncTelegramChrome()
  } catch {
    // Older clients may not support every call; ignore.
  }
}

export function haptic(
  type: 'success' | 'error' | 'warning' | 'light' | 'medium' | 'heavy',
): void {
  const tg = getTelegramWebApp()
  if (!tg) return
  try {
    if (type === 'success' || type === 'error' || type === 'warning') {
      tg.HapticFeedback.notificationOccurred(type)
    } else {
      tg.HapticFeedback.impactOccurred(type)
    }
  } catch {
    // ignore
  }
}

/** Header proving to the backend which Telegram user is calling (the signed
 * Mini App initData). Empty outside Telegram. */
export function authHeaders(): Record<string, string> {
  const d = getTelegramWebApp()?.initData
  return d ? { 'X-Telegram-Init-Data': d } : {}
}
