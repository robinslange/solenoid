import { enc, hex } from './bytes.js'

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function deriveSpendKey(adminKey: string, scope: string, epoch: number): Promise<string> {
  const [sk, kind, tenant, gen, secret] = adminKey.split('.')
  if (sk !== 'sk' || kind !== 'admin' || !secret) throw new TypeError('solenoid: deriving a key needs the admin key')
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return `sk.spend.${tenant}.${gen}.${epoch}.${b64url(scope)}.${hex(await crypto.subtle.sign('HMAC', k, enc.encode(`spend:${scope}:${epoch}`)))}`
}
