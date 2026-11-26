// Face ID / Touch ID quick-unlock for the wallet.
//
// Two backends, picked at runtime:
//   1. **Telegram BiometricManager** (preferred whenever the Mini App
//      runs inside Telegram >= 7.2). Telegram stores the PIN as a
//      "biometric token" natively, encrypted by the OS and gated by
//      the user's biometric. No WebAuthn dance, no PRF requirements.
//   2. **WebAuthn + PRF** (fallback for browser-on-device or older
//      Telegram clients). We register a platform passkey, derive a
//      32-byte symmetric secret from the PRF extension, and wrap the
//      PIN with it in localStorage.
//
// The two paths store their state under different localStorage keys so
// switching environments simply re-enrolls.

import { getTelegramWebApp } from './telegram'

type Backend = 'tg' | 'webauthn' | 'none'

const BIO_KEY = 'awallet:bio:v1'           // WebAuthn bundle
const BIO_MARK = 'awallet:bio:tg:v1'       // Telegram enrolment marker
const PRF_SALT = new TextEncoder().encode('awallet:prf:v1')

interface BioBundle {
  credentialId: string  // base64
  encPin: string        // base64
  iv: string            // base64
}

function toB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

interface PrfResults {
  prf?: {
    enabled?: boolean
    results?: { first?: ArrayBuffer }
  }
}

function tgBiometric() {
  return getTelegramWebApp()?.BiometricManager ?? null
}

async function tgInit(): Promise<ReturnType<typeof tgBiometric>> {
  const bm = tgBiometric()
  if (!bm) return null
  if (bm.isInited) return bm
  return new Promise((resolve) => {
    try {
      bm.init(() => resolve(bm))
    } catch {
      resolve(null)
    }
  })
}

/** Determines which biometric backend is usable right now. Result may
 *  change between Telegram and browser, but is stable within a session. */
export async function detectBackend(): Promise<Backend> {
  const bm = await tgInit()
  if (bm && bm.isBiometricAvailable) return 'tg'
  // WebAuthn: be permissive — just require the constructor to exist.
  // We don't pre-check `isUserVerifyingPlatformAuthenticatorAvailable`
  // because it returns false in many in-app WebViews where create()
  // actually works once invoked by user gesture.
  if (typeof window !== 'undefined' && 'PublicKeyCredential' in window) {
    return 'webauthn'
  }
  return 'none'
}

/** True iff the user has already wrapped their PIN with one of the
 *  backends. Checks both keys so we keep working after the user moves
 *  between Telegram and browser on the same device (we'll re-enroll
 *  in the new context). */
export function isBiometricEnrolled(): boolean {
  return (
    !!localStorage.getItem(BIO_KEY) ||
    !!localStorage.getItem(BIO_MARK)
  )
}

/** Forget any saved wrapping. */
export function clearBiometric(): void {
  localStorage.removeItem(BIO_KEY)
  localStorage.removeItem(BIO_MARK)
}

// ─── Telegram BiometricManager path ────────────────────────────────────────

async function tgEnroll(pin: string): Promise<void> {
  const bm = await tgInit()
  if (!bm) throw new Error('BiometricManager недоступен')
  if (!bm.isBiometricAvailable) {
    throw new Error('Биометрия не настроена на устройстве')
  }
  if (!bm.isAccessGranted) {
    const granted: boolean = await new Promise((resolve) => {
      bm.requestAccess(
        { reason: 'Сохранить PIN под Face ID' },
        (ok) => resolve(ok),
      )
    })
    if (!granted) throw new Error('Доступ к биометрии не выдан')
  }
  const ok: boolean = await new Promise((resolve) => {
    bm.updateBiometricToken(pin, (updated) => resolve(updated))
  })
  if (!ok) throw new Error('Не удалось сохранить PIN в биометрии')
  localStorage.setItem(BIO_MARK, '1')
}

async function tgUnlock(): Promise<string> {
  const bm = await tgInit()
  if (!bm) throw new Error('BiometricManager недоступен')
  return await new Promise<string>((resolve, reject) => {
    bm.authenticate(
      { reason: 'Войти в кошелёк' },
      (success, token) => {
        if (!success) {
          reject(new Error('Биометрия не подтверждена'))
          return
        }
        if (!token) {
          reject(new Error('Биометрия не вернула PIN — переключи в Настройках'))
          return
        }
        resolve(token)
      },
    )
  })
}

// ─── WebAuthn + PRF path ───────────────────────────────────────────────────

async function fetchPrfSecret(
  credId: Uint8Array,
): Promise<ArrayBuffer | null> {
  const assert = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: credId as BufferSource }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: {
        prf: { eval: { first: PRF_SALT as BufferSource } },
      },
    } as PublicKeyCredentialRequestOptions,
  })) as PublicKeyCredential | null
  if (!assert) return null
  const ext = assert.getClientExtensionResults() as PrfResults
  return ext.prf?.results?.first ?? null
}

async function waEnroll(pin: string): Promise<void> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Fwallet' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'wallet',
        displayName: 'Fwallet',
      },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
        requireResidentKey: false,
      },
      timeout: 60_000,
      attestation: 'none',
      extensions: {
        prf: { eval: { first: PRF_SALT as BufferSource } },
      },
    } as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null

  if (!cred) throw new Error('Регистрация отменена')

  const ext = cred.getClientExtensionResults() as PrfResults
  let prfSecret: ArrayBuffer | null = ext.prf?.results?.first ?? null
  if (!prfSecret) {
    prfSecret = await fetchPrfSecret(new Uint8Array(cred.rawId))
    if (!prfSecret) {
      throw new Error('Браузер не поддерживает PRF (биометрия недоступна)')
    }
  }

  const key = await crypto.subtle.importKey(
    'raw',
    prfSecret,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      new TextEncoder().encode(pin),
    ),
  )

  const bundle: BioBundle = {
    credentialId: toB64(new Uint8Array(cred.rawId)),
    encPin: toB64(ct),
    iv: toB64(iv),
  }
  localStorage.setItem(BIO_KEY, JSON.stringify(bundle))
}

async function waUnlock(): Promise<string> {
  const raw = localStorage.getItem(BIO_KEY)
  if (!raw) throw new Error('Биометрия не настроена')
  const bundle = JSON.parse(raw) as BioBundle

  const prfSecret = await fetchPrfSecret(fromB64(bundle.credentialId))
  if (!prfSecret) throw new Error('Не удалось получить ключ из биометрии')

  const key = await crypto.subtle.importKey(
    'raw',
    prfSecret,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )
  const iv = fromB64(bundle.iv)
  const ct = fromB64(bundle.encPin)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource,
  )
  return new TextDecoder().decode(pt)
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Register the user's PIN under the current best biometric backend.
 *  Throws on cancellation or unsupported environment. */
export async function enrollBiometric(pin: string): Promise<Backend> {
  if (!pin) throw new Error('PIN required')
  const backend = await detectBackend()
  if (backend === 'tg') {
    await tgEnroll(pin)
    return 'tg'
  }
  if (backend === 'webauthn') {
    await waEnroll(pin)
    return 'webauthn'
  }
  throw new Error('Биометрия недоступна в этом окружении')
}

/** Trigger Face ID / Touch ID and recover the wrapped PIN. */
export async function unlockWithBiometric(): Promise<string> {
  // Prefer whichever backend has actual state. If the marker says
  // Telegram but Telegram isn't initialised yet, init it.
  if (localStorage.getItem(BIO_MARK)) {
    return tgUnlock()
  }
  if (localStorage.getItem(BIO_KEY)) {
    return waUnlock()
  }
  throw new Error('Биометрия не настроена')
}

/** Human-readable backend label for the Settings card. */
export async function biometricLabel(): Promise<string> {
  const bm = await tgInit()
  if (bm && bm.isBiometricAvailable) {
    if (bm.biometricType === 'face') return 'Face ID'
    if (bm.biometricType === 'finger') return 'Touch ID / отпечаток'
    return 'Биометрия'
  }
  return 'Face ID / Touch ID'
}
