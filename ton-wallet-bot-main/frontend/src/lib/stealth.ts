/**
 * Stealth mode — instantly hides all balances and asset values.
 *
 * Two triggers:
 *  - manual toggle (icon in HomeTab top bar)
 *  - phone shake (DeviceMotion API, free, no permissions on Android,
 *    on iOS 13+ requires user gesture to enable once)
 *
 * State is broadcast via the `aw:stealth` CustomEvent so any component
 * (HomeTab, ActivityFeed, ProfileCard, etc.) can react without prop
 * drilling.
 */

const STORAGE_KEY = 'aw:stealth:v1'
const EVENT = 'aw:stealth'

let listenersInstalled = false
let shakeBaseline = { x: 0, y: 0, z: 0, t: 0 }

export function isStealth(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function setStealth(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: on }))
  } catch {
    // ignore
  }
}

export function toggleStealth(): boolean {
  const next = !isStealth()
  setStealth(next)
  return next
}

export function subscribeStealth(cb: (on: boolean) => void): () => void {
  const handler = (e: Event) => {
    const ev = e as CustomEvent<boolean>
    cb(!!ev.detail)
  }
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

/** Install global shake-to-stealth listener. Idempotent. */
export function installShakeListener(): void {
  if (listenersInstalled) return
  listenersInstalled = true
  const handler = (ev: DeviceMotionEvent) => {
    const a = ev.accelerationIncludingGravity
    if (!a || a.x == null || a.y == null || a.z == null) return
    const now = Date.now()
    if (now - shakeBaseline.t < 80) return
    const dx = Math.abs((a.x ?? 0) - shakeBaseline.x)
    const dy = Math.abs((a.y ?? 0) - shakeBaseline.y)
    const dz = Math.abs((a.z ?? 0) - shakeBaseline.z)
    shakeBaseline = { x: a.x ?? 0, y: a.y ?? 0, z: a.z ?? 0, t: now }
    // Threshold tuned to a deliberate flick, not casual movement.
    if (dx + dy + dz > 28) {
      toggleStealth()
    }
  }
  try {
    window.addEventListener('devicemotion', handler, { passive: true })
  } catch {
    // ignore
  }
}

/** iOS 13+ requires user gesture to request DeviceMotion permission. */
export async function requestShakePermissionIfNeeded(): Promise<boolean> {
  const D = (
    window as unknown as {
      DeviceMotionEvent?: { requestPermission?: () => Promise<string> }
    }
  ).DeviceMotionEvent
  if (D && typeof D.requestPermission === 'function') {
    try {
      const res = await D.requestPermission()
      return res === 'granted'
    } catch {
      return false
    }
  }
  return true
}
