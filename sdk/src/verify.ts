import { enc, fromHex, hex } from './bytes.js'
import type { Receipt } from './types.js'

const HEX64 = /^[0-9a-f]{64}$/

const b64url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  const out = Uint8Array.from(b, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
  if (b64url(out) !== s) throw new SyntaxError()
  return out
}

export function jcs(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${jcs(o[k])}`).join(',')}}`
}

async function entryHash(prev: string, r: Pick<Receipt, 'seq' | 'kind' | 'scope' | 'body' | 'at' | 'kid'>): Promise<string> {
  const body = enc.encode(jcs({ seq: r.seq, kind: r.kind, scope: r.scope, body: r.body, at: r.at, kid: r.kid }))
  const msg = new Uint8Array(32 + body.length)
  msg.set(fromHex(prev))
  msg.set(body, 32)
  return hex(await crypto.subtle.digest('SHA-256', msg))
}

export async function verifyReceipt(r: Receipt, jwk: JsonWebKey): Promise<boolean> {
  if (!HEX64.test(r.prev) || !HEX64.test(r.hash)) return false
  if ((await entryHash(r.prev, r)) !== r.hash) return false
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify'])
  try {
    return await crypto.subtle.verify('Ed25519', key, b64urlDecode(r.sig), fromHex(r.hash))
  } catch {
    return false
  }
}

export async function verifyChain(ascending: Receipt[], keys: Record<string, JsonWebKey>): Promise<boolean> {
  for (let i = 0; i < ascending.length; i++) {
    const r = ascending[i]
    if (i > 0 && (r.prev !== ascending[i - 1].hash || r.seq !== ascending[i - 1].seq + 1)) return false
    const jwk = Object.hasOwn(keys, r.kid) ? keys[r.kid] : undefined
    if (!jwk || !(await verifyReceipt(r, jwk))) return false
  }
  return true
}
