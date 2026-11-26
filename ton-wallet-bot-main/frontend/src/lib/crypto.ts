// Password/PIN-based encryption of the wallet mnemonic using WebCrypto.
// AES-GCM with PBKDF2(SHA-256) over a per-vault random salt.
//
// New vaults use 600k iterations to make brute force of short PIN codes
// slower (~1.5s on a modern phone). v:1 vaults stick with 250k for
// backwards compatibility.

const PBKDF2_ITERATIONS_V1 = 250_000
const PBKDF2_ITERATIONS_V2 = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export interface EncryptedVault {
  v: 1 | 2
  salt: string
  iv: string
  ct: string
}

export async function encryptMnemonic(
  mnemonic: string,
  password: string,
): Promise<EncryptedVault> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS_V2)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(mnemonic),
  )
  return {
    v: 2,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ct)),
  }
}

export async function decryptMnemonic(
  vault: EncryptedVault,
  password: string,
): Promise<string> {
  const salt = fromBase64(vault.salt)
  const iv = fromBase64(vault.iv)
  const ct = fromBase64(vault.ct)
  const iterations = vault.v === 2 ? PBKDF2_ITERATIONS_V2 : PBKDF2_ITERATIONS_V1
  const key = await deriveKey(password, salt, iterations)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource,
  )
  return new TextDecoder().decode(pt)
}
