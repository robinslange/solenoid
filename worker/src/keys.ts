import type { Auth } from './auth'
import { b64url, b64urlDecode, fromHex, hex } from './chain'
import { ApiError } from './errors'
import { parseScope } from './scope'

export const TENANT_RE = /^[a-z2-7]{12}$/
const NUM = /^(0|[1-9][0-9]{0,8})$/
const HEX64 = /^[0-9a-f]{64}$/
const enc = new TextEncoder()

const hmacKey = (key: string, use: 'sign' | 'verify') => crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [use])

export async function hmacHex(key: string, msg: string): Promise<string> {
  return hex(await crypto.subtle.sign('HMAC', await hmacKey(key, 'sign'), enc.encode(msg)))
}

export const hmacMatches = async (key: string, msg: string, macHex: string): Promise<boolean> =>
  crypto.subtle.verify('HMAC', await hmacKey(key, 'verify'), fromHex(macHex), enc.encode(msg))

const adminMsg = (tenant: string, gen: number) => `admin:${tenant}:${gen}`
const adminSecret = (master: string, tenant: string, gen: number) => hmacHex(master, adminMsg(tenant, gen))

export const adminKey = async (master: string, tenant: string, gen: number): Promise<string> =>
  `sk.admin.${tenant}.${gen}.${await adminSecret(master, tenant, gen)}`

export async function spendKey(adminKeyStr: string, scope: string, epoch: number): Promise<string> {
  const [, , tenant, gen, secret] = adminKeyStr.split('.')
  return `sk.spend.${tenant}.${gen}.${epoch}.${b64url(enc.encode(scope).buffer as ArrayBuffer)}.${await hmacHex(secret, `spend:${scope}:${epoch}`)}`
}

export async function verifyKey(header: string | null, master: string): Promise<{ tenant: string; auth: Auth }> {
  const bad = new ApiError(401, 'invalid_key')
  const m = header?.match(/^Bearer (sk\.\S+)$/)
  if (!m) throw bad
  const p = m[1].split('.')
  const [, kind, tenant, genS] = p
  if (!TENANT_RE.test(tenant ?? '') || !NUM.test(genS ?? '') || genS === '0') throw bad
  const gen = Number(genS)
  if (kind === 'admin' && p.length === 5) {
    if (!HEX64.test(p[4] ?? '') || !(await hmacMatches(master, adminMsg(tenant, gen), p[4]))) throw bad
    return { tenant, auth: { kind: 'admin', gen, epoch: 0, keyScope: '' } }
  }
  if (kind === 'spend' && p.length === 7) {
    const [, , , , epochS, scopeField, mac] = p
    if (!NUM.test(epochS) || !HEX64.test(mac ?? '')) throw bad
    let scope: string
    try { scope = parseScope(new TextDecoder().decode(b64urlDecode(scopeField))) } catch { throw bad }
    const epoch = Number(epochS)
    if (!(await hmacMatches(await adminSecret(master, tenant, gen), `spend:${scope}:${epoch}`, mac))) throw bad
    return { tenant, auth: { kind: 'spend', gen, epoch, keyScope: scope } }
  }
  throw bad
}
