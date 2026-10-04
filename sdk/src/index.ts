import { cleanAmounts } from './amounts.js'
import { LimitExceeded, Outage, SolenoidError, SolenoidUnavailable, toError } from './errors.js'
import { call, type Transport } from './http.js'
import { deriveSpendKey } from './keys.js'
import { costOf, leftFrom, planCall, readUsage } from './llm.js'
import pricesJson from './prices.json'
import { checkScope, nearestFirst } from './scope.js'
import type { Amounts, Left, Mode, OutageStore, Price, Prices, Receipt, SpendResponse, View, Warning } from './types.js'
import { verifyChain } from './verify.js'

export * from './errors.js'
export * from './types.js'
export { checkScope } from './scope.js'
export { verifyChain, verifyReceipt } from './verify.js'

export type Options = { key?: string; api?: string; timeoutMs?: number; store?: OutageStore; fetch?: typeof fetch; prices?: Prices; onWarn?: (w: Warning[]) => void }

const DEFAULT_API = 'https://api.solenoid.systems'
const KEY_REFETCH_MS = 5_000
const envVar = (name: string): string | undefined => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[name]
const { _checked, ...BUNDLED_PRICES } = pricesJson as Record<string, unknown>

export type Run = {
  scope: string
  spend(amounts: Amounts): Promise<Receipt | null>
  llm<Req extends object, Res>(call: (req: Req) => Promise<Res>, req: Req, o?: { price?: Price }): Promise<Res>
}

const expired = (left: Record<string, Left>): boolean => Object.values(left).some((l) => l.resets !== null && Date.parse(l.resets) <= Date.now())
const tryPlan = (...a: Parameters<typeof planCall>): ReturnType<typeof planCall> | null => { try { return planCall(...a) } catch { return null } }

// https://fetch.spec.whatwg.org/#bad-port
const FETCH_BLOCKED_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
])

export function checkApi(api: string): string {
  let u: URL | undefined
  try { u = new URL(api) } catch {}
  if (!u || !['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || (u.port !== '' && FETCH_BLOCKED_PORTS.has(Number(u.port)))) {
    throw new TypeError(`solenoid: the API must be an http or https URL, such as ${DEFAULT_API}, with no user, password, query or fragment and on a port that fetch allows; set SOLENOID_API or pass { api }`)
  }
  return (u.origin + u.pathname).replace(/\/$/, '')
}

function memoryStore(): OutageStore {
  const m = new Map<string, Mode>()
  return { get: (s) => m.get(s), set: (s, v) => void m.set(s, v) }
}

export type AccountOptions = { api?: string; fetch?: typeof fetch }

const AUTH_TIMEOUT_MS = 10_000

async function authPost<T>(o: AccountOptions, path: string, body: unknown, expect: number): Promise<T> {
  const url = `${checkApi(o.api ?? envVar('SOLENOID_API') ?? DEFAULT_API)}${path}`
  const f = o.fetch ?? globalThis.fetch.bind(globalThis)
  const init: RequestInit = body === undefined ? { method: 'POST' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  let res: Response
  try {
    res = await f(url, { ...init, signal: AbortSignal.timeout(AUTH_TIMEOUT_MS) })
  } catch (e) {
    throw new Outage('solenoid unreachable', { cause: e })
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.status === expect) return data as T
  throw res.status >= 500 && data.error !== 'email_failed' ? new Outage(`HTTP ${res.status}`) : toError(res.status, data)
}

export const signup = (o: string | AccountOptions = {}): Promise<{ tenant: string; admin_key: string }> =>
  authPost(typeof o === 'string' ? { api: o } : o, '/auth/signup', undefined, 201)

export const requestRecovery = async (tenant: string, email: string, o: AccountOptions = {}): Promise<void> => {
  await authPost(o, '/auth/recover', { tenant, email }, 202)
}

export const recover = (tenant: string, email: string, code: string, o: AccountOptions & { rotate?: boolean } = {}): Promise<{ tenant: string; admin_key: string }> =>
  authPost(o, '/auth/recover', { tenant, email, code, ...(o.rotate ? { rotate: true } : {}) }, 200)

export function solenoid(opts: Options = {}) {
  const key = opts.key ?? envVar('SOLENOID_KEY')
  if (!key) throw new TypeError('solenoid: set SOLENOID_KEY or pass { key }')
  const t: Transport = { api: checkApi(opts.api ?? envVar('SOLENOID_API') ?? DEFAULT_API), key, timeoutMs: opts.timeoutMs ?? 2000, fetch: opts.fetch ?? globalThis.fetch.bind(globalThis) }
  const store = opts.store ?? memoryStore()
  const remaining = new Map<string, SpendResponse['remaining']>()
  let keys: Record<string, JsonWebKey> | undefined
  let fetching: Promise<Record<string, JsonWebKey>> | undefined
  let refetchedAt = -Infinity
  const path = (scope: string) => `/v1/${checkScope(scope)}`
  const fetchKeys = (query = '') =>
    (fetching ??= Promise.resolve()
      .then(() => t.fetch(`${t.api}/.well-known/solenoid.json${query}`, { signal: AbortSignal.timeout(t.timeoutMs) }))
      .then(async (r) => {
        if (!r.ok) throw new Outage(`HTTP ${r.status}`)
        return (keys = ((await r.json()) as { keys: Record<string, JsonWebKey> }).keys)
      })
      .finally(() => { fetching = undefined }))

  async function modeFor(scope: string): Promise<Mode> {
    for (const s of nearestFirst(scope)) {
      const m = await store.get(s)
      if (m) return m
    }
    return 'closed'
  }

  async function post(scope: string, body: unknown, idem: string): Promise<SpendResponse | null> {
    const p = path(scope)
    try {
      const r = await call<SpendResponse>(t, 'POST', p, body, idem)
      remaining.set(scope, { ...remaining.get(scope), ...r.remaining })
      for (const s of new Set([scope, ...Object.values(r.remaining).map((x) => x.scope)])) await store.set(s, r.on_outage)
      if (r.warnings?.length) opts.onWarn?.(r.warnings)
      return r
    } catch (e) {
      if (!(e instanceof Outage)) throw e
      if ((await modeFor(scope)) === 'open') return null
      throw new SolenoidUnavailable(scope, e)
    }
  }

  const spend = async (scope: string, amounts: Amounts, o: { idempotencyKey?: string } = {}): Promise<Receipt | null> =>
    (await post(scope, cleanAmounts(amounts), o.idempotencyKey ?? crypto.randomUUID()))?.receipt ?? null
  const settle = async (scope: string, idem: string, actual: Amounts): Promise<Receipt | null> =>
    (await post(scope, { settle: cleanAmounts(actual, true) }, idem))?.receipt ?? null

  const limit = (scope: string, body: Record<string, number | string | null>) => call<View>(t, 'PUT', path(scope), body)
  const rotate = (scope: string) => call<View>(t, 'PUT', path(scope), { rotate_keys: true })
  const rotateAdmin = async () => (await call<{ admin_key: string }>(t, 'PUT', path(''), { rotate_admin: true })).admin_key
  const authT = { ...t, timeoutMs: Math.max(t.timeoutMs, AUTH_TIMEOUT_MS) }
  const sendEmailCode = async (email: string): Promise<void> => { await call(authT, 'POST', '/auth/email', { email }) }
  const checkout = () => call<{ url: string }>(authT, 'POST', '/billing/checkout', {})
  const verifyEmail = (email: string, code: string, o: { rotate?: boolean } = {}) =>
    call<{ tenant: string; email: string; admin_key?: string }>(authT, 'POST', '/auth/email', { email, code, ...(o.rotate ? { rotate: true } : {}) })
  const get = (scope: string, o: { before?: number } = {}) => call<View>(t, 'GET', path(scope) + (o.before === undefined ? '' : `?before=${o.before}`))

  async function keysFor(kids: string[]): Promise<Record<string, JsonWebKey>> {
    const have = keys ?? (await fetchKeys())
    if (kids.every((kid) => Object.hasOwn(have, kid))) return have
    if (Date.now() - refetchedAt >= KEY_REFETCH_MS) {
      refetchedAt = Date.now()
      fetchKeys(`?t=${refetchedAt}`)
    }
    return fetching ? fetching.catch(() => have) : have
  }
  const verify = async (receipt: Receipt): Promise<boolean> => verifyChain([receipt], await keysFor([receipt.kid]))

  const deriveKey = async (scope: string, epoch?: number): Promise<string> => deriveSpendKey(key!, checkScope(scope), epoch ?? (await get(scope)).epoch)

  const priceTable: Prices = { ...(BUNDLED_PRICES as Prices), ...(opts.prices ?? {}) }
  const runId = () => `run-${Date.now().toString(36)}${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join('')}`
  const quietly = <T>(p: Promise<T>) => p.catch((e) => { if (e instanceof SolenoidError || e instanceof SolenoidUnavailable) return null; throw e })

  function at(scope: string): Run {
    checkScope(scope)
    return {
      scope,
      spend: (amounts) => spend(scope, amounts),
      async llm(callFn, req, o = {}) {
        const r = req as Record<string, unknown>
        const price = o.price ?? priceTable[String(r.model ?? '')]
        const cached = remaining.get(scope)
        let plan = cached && price && ('tokens' in cached || 'usd' in cached) && !expired(cached) ? tryPlan(scope, r, cached, price) : null
        if (!plan) {
          let left
          try {
            left = leftFrom((await call<View>(t, 'GET', path(scope))).limits)
          } catch (e) {
            if (!(e instanceof Outage)) throw e
            if ((await modeFor(scope)) !== 'open') throw new SolenoidUnavailable(scope, e)
            return callFn(req)
          }
          plan = planCall(scope, r, left, price)
        }
        if (!plan.hold) {
          const res = await callFn(req)
          const usage = readUsage(res)
          if (usage) {
            await spend(scope, costOf(usage, price)).catch((e) => {
              if (e instanceof LimitExceeded) {
                remaining.set(scope, { ...(remaining.get(scope) ?? {}), [e.unit]: { scope: e.scope, left: 0, resets: e.resets } })
                return null
              }
              if (e instanceof SolenoidUnavailable) return null
              throw e
            })
          }
          return res
        }
        const hold = plan.hold
        const idem = crypto.randomUUID()
        const held = await spend(scope, hold, { idempotencyKey: idem })
        let res
        try {
          res = await callFn(plan.req as typeof req)
        } catch (e) {
          if (held) await quietly(settle(scope, idem, Object.fromEntries(Object.keys(hold).map((u) => [u, 0]))))
          throw e
        }
        const usage = readUsage(res)
        const cost = usage ? costOf(usage, price) : hold
        if (held) await quietly(settle(scope, idem, Object.fromEntries(Object.keys(hold).map((u) => [u, cost[u] ?? 0]))))
        return res
      },
    }
  }

  const run = <T>(scope: string, fn: (r: Run) => Promise<T>): Promise<T> => fn(at(scope ? `${checkScope(scope)}/${runId()}` : runId()))

  return {
    spend, limit, rotate, rotateAdmin, sendEmailCode, verifyEmail, checkout, get, verify,
    verifyChain: async (entries: Receipt[]): Promise<boolean> => verifyChain(entries, await keysFor(entries.map((e) => e.kid))),
    deriveKey, at, run,
    _internal: { t, remaining, modeFor, settle, path },
  }
}

export type Client = ReturnType<typeof solenoid>
