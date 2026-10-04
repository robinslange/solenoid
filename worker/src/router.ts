import { parseSettle, parseSpend } from './amounts'
import { authEmail, authRecover, type Io } from './auth-routes'
import { billingCheckout, billingWebhook } from './billing-routes'
import { jcs, publicJwk, sha256hex } from './chain'
import { ApiError, failResponse, json, type Result } from './errors'
import { parseJson, parsePut } from './http'
import { adminKey, verifyKey } from './keys'
import { perIp } from './ops'
import { parseScope } from './scope'
import type { BillingEnv } from './stripe'
import type { TenantApi } from './core'

export type RouterEnv = BillingEnv & { MASTER: string; SIGNING_KEY: string; SIGNING_KID: string; RETIRED_SIGNING_KEYS?: string | Record<string, JsonWebKey> }
type TenantFor = (name: string) => TenantApi
export type { Io } from './auth-routes'
export { ipKey } from './ops'

const IDEM = /^[\x21\x22\x24-\x7e]{1,255}$/
const SEQ = /^(0|[1-9][0-9]{0,15})$/
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
const randomTenant = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => B32[b & 31]).join('')

async function signup(req: Request, env: RouterEnv, tenantFor: TenantFor): Promise<Response> {
  const limited = await perIp(req, env.MASTER, tenantFor, 'signups')
  if (limited) return limited
  for (let i = 0; i < 3; i++) {
    const tenant = randomTenant()
    if (await tenantFor(tenant).init(tenant, 'free')) return json(201, { tenant, admin_key: await adminKey(env.MASTER, tenant, 1) })
  }
  throw new Error('three tenant id collisions in a row')
}

function publicKeys(env: RouterEnv): Record<string, JsonWebKey> {
  let retired: unknown = env.RETIRED_SIGNING_KEYS
  try { retired = JSON.parse(retired as string) } catch {}
  const usable = Object.entries(retired ?? {}).filter(([, k]) => typeof k?.x === 'string') as [string, JsonWebKey][]
  return { ...Object.fromEntries(usable.map(([kid, { kty, crv, x }]) => [kid, { kty, crv, x }])), [env.SIGNING_KID]: publicJwk(env.SIGNING_KEY) }
}

const respond = <T>(r: Result<T>, extra: Record<string, unknown> = {}): Response =>
  r.ok ? json(200, { ...(r.value as object), ...extra }) : failResponse(r)

async function route(req: Request, env: RouterEnv, tenantFor: TenantFor, io: Io): Promise<Response> {
  const url = new URL(req.url)
  if (req.method === 'GET' && url.pathname === '/.well-known/solenoid.json') {
    return json(200, { keys: publicKeys(env) }, { 'cache-control': 'public, max-age=3600' })
  }
  if (req.method === 'POST' && url.pathname === '/auth/signup') return signup(req, env, tenantFor)
  if (req.method === 'POST' && url.pathname === '/auth/email') return authEmail(req, env.MASTER, tenantFor, io)
  if (req.method === 'POST' && url.pathname === '/auth/recover') return authRecover(req, env.MASTER, tenantFor, io)
  if (req.method === 'POST' && url.pathname === '/billing/checkout') return billingCheckout(req, env, tenantFor, io)
  if (req.method === 'POST' && url.pathname === '/billing/stripe') return billingWebhook(req, env, tenantFor, io)
  if (url.pathname !== '/v1' && !url.pathname.startsWith('/v1/')) throw new ApiError(404, 'not_found')
  if (!['GET', 'POST', 'PUT'].includes(req.method)) throw new ApiError(405, 'method_not_allowed')
  const scope = parseScope(url.pathname.slice(4))
  const { tenant, auth } = await verifyKey(req.headers.get('authorization'), env.MASTER)
  const stub = tenantFor(tenant)
  if (req.method === 'GET') {
    const before = url.searchParams.get('before')
    if (before !== null && !SEQ.test(before)) throw new ApiError(400, 'invalid_before')
    return respond(await stub.get(auth, scope, before === null ? undefined : Number(before)))
  }
  if (req.method === 'POST') {
    const idem = req.headers.get('idempotency-key')
    if (!idem) throw new ApiError(400, 'missing_idempotency_key')
    if (!IDEM.test(idem)) throw new ApiError(400, 'invalid_idempotency_key')
    const b = parseJson(await req.text(), 'invalid_amount')
    if (b && typeof b === 'object' && !Array.isArray(b) && 'settle' in b) {
      const actual = parseSettle((b as { settle: unknown }).settle)
      return respond(await stub.settle(auth, scope, idem, actual, await sha256hex(jcs({ scope, settle: actual }))))
    }
    const amounts = parseSpend(b)
    return respond(await stub.spend(auth, scope, amounts, idem, await sha256hex(jcs({ scope, amounts }))))
  }
  const put = parsePut(parseJson(await req.text(), 'invalid_limit'))
  const r = await stub.put(auth, scope, put)
  return respond(r, r.ok && put.rotateAdmin ? { admin_key: await adminKey(env.MASTER, tenant, r.value.gen) } : {})
}

export async function handle(req: Request, env: RouterEnv, tenantFor: TenantFor, io: Io): Promise<Response> {
  try {
    return await route(req, env, tenantFor, io)
  } catch (e) {
    if (e instanceof ApiError) return json(e.status, { error: e.code, ...e.detail })
    console.error(e)
    return json(500, { error: 'internal' })
  }
}
