export type Kind = 'spend' | 'settle' | 'limit' | 'rotate'
export type Sealed = { seq: number; kind: Kind; scope: string; body: Record<string, any>; at: string; kid: string; prev: string; hash: string; sig: string }

export const GENESIS = '0'.repeat(64)
const enc = new TextEncoder()

export const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const HEX_PAIRS = /^(?:[0-9a-f]{2})*$/
const HEX64 = /^[0-9a-f]{64}$/
export function fromHex(h: string): Uint8Array<ArrayBuffer> {
  if (!HEX_PAIRS.test(h)) throw new Error('invalid hex')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}
export const b64url = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  const out = Uint8Array.from(b, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
  if (b64url(out.buffer) !== s) throw new SyntaxError()
  return out
}
export const sha256hex = async (s: string): Promise<string> => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))

export function jcs(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${jcs(o[k])}`).join(',')}}`
}

export async function entryHash(prev: string, e: Pick<Sealed, 'seq' | 'kind' | 'scope' | 'body' | 'at' | 'kid'>): Promise<string> {
  const body = enc.encode(jcs({ seq: e.seq, kind: e.kind, scope: e.scope, body: e.body, at: e.at, kid: e.kid }))
  const msg = new Uint8Array(32 + body.length)
  msg.set(fromHex(prev))
  msg.set(body, 32)
  return hex(await crypto.subtle.digest('SHA-256', msg))
}

export function importSigningKey(jwkJson: string): Promise<CryptoKey> {
  const { kty, crv, x, d } = JSON.parse(jwkJson) as JsonWebKey
  return crypto.subtle.importKey('jwk', { kty, crv, x, d }, { name: 'Ed25519' }, false, ['sign'])
}

export const signHash = async (key: CryptoKey, hash: string): Promise<string> => b64url(await crypto.subtle.sign('Ed25519', key, fromHex(hash)))

export function publicJwk(jwkJson: string): JsonWebKey {
  const { kty, crv, x } = JSON.parse(jwkJson) as JsonWebKey
  return { kty, crv, x }
}

export async function verifyChain(entries: Sealed[], jwk: JsonWebKey): Promise<boolean> {
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify'])
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (!HEX64.test(e.prev) || !HEX64.test(e.hash)) return false
    if (i > 0 && (e.prev !== entries[i - 1].hash || e.seq !== entries[i - 1].seq + 1)) return false
    if ((await entryHash(e.prev, e)) !== e.hash) return false
    try {
      if (!(await crypto.subtle.verify('Ed25519', key, b64urlDecode(e.sig), fromHex(e.hash)))) return false
    } catch {
      return false
    }
  }
  return true
}
