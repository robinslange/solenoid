import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { adminKey, spendKey } from '../src/keys'
import { setBillable } from './helpers'

type Json = Record<string, any>
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
const stubOf = (tenant: string) => env.TENANT.get(env.TENANT.idFromName(tenant))
async function newTenant(): Promise<{ tenant: string; admin: string }> {
  const tenant = Array.from({ length: 12 }, () => B32[Math.floor(Math.random() * 32)]).join('')
  await stubOf(tenant).init(tenant, 'free')
  return { tenant, admin: await adminKey(env.MASTER, tenant, 1) }
}
const call = (method: string, path: string, key: string | null, body?: unknown, idem?: string) =>
  SELF.fetch(`https://api.test${path}`, {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(idem ? { 'idempotency-key': idem } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
const reply = async (r: Response): Promise<Json> => ({ status: r.status, ...((await r.json()) as Json) })

describe('routes', () => {
  it('serves the public keys as cacheable JSON, and only to GET', async () => {
    const r = await SELF.fetch('https://api.test/.well-known/solenoid.json')
    expect(r.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(r.headers.get('content-type')).toBe('application/json')
    expect(await reply(await SELF.fetch('https://api.test/.well-known/solenoid.json', { method: 'POST' }))).toEqual({ status: 404, error: 'not_found' })
  })

  it('serves signup only to POST, and 404s unknown paths by code', async () => {
    expect(await reply(await SELF.fetch('https://api.test/auth/signup'))).toEqual({ status: 404, error: 'not_found' })
    expect(await reply(await SELF.fetch('https://api.test/v2/a'))).toEqual({ status: 404, error: 'not_found' })
  })

  it('treats /v1 without a trailing slash as the tenant root', async () => {
    const { admin } = await newTenant()
    expect(await reply(await call('GET', '/v1', admin))).toMatchObject({ status: 200, scope: '' })
  })

  it('answers a PUT with the scope view, and no admin key unless the admin key rotated', async () => {
    const { admin } = await newTenant()
    const r = await reply(await call('PUT', '/v1/acme', admin, { usd: 5, per: 'day' }))
    expect(r).toMatchObject({ status: 200, scope: 'acme', limits: [{ scope: 'acme', unit: 'usd', limit: 5, per: 'day', on_outage: 'closed', used: 0, left: 5 }] })
    expect(r).not.toHaveProperty('admin_key')
  })

  it('lists children at any depth and pages entries with next', async () => {
    const { admin } = await newTenant()
    for (let i = 1; i <= 51; i++) expect((await call('POST', '/v1/acme/bot/run-1', admin, { n: 1 }, `p${i}`)).status).toBe(200)
    const first = await reply(await call('GET', '/v1/acme/bot', admin))
    expect(first.children).toEqual(['run-1'])
    expect(first.entries).toHaveLength(50)
    expect(first.entries[0]).toMatchObject({ seq: 51, replay: false })
    expect(first.next).toBe(2)
    const second = await reply(await call('GET', `/v1/acme/bot?before=${first.next}`, admin))
    expect(second.entries.map((e: Json) => e.seq)).toEqual([1])
    expect(second.next).toBeNull()
    expect((await reply(await call('GET', '/v1/acme/bot?before=0', admin))).entries).toEqual([])
    expect((await reply(await call('GET', '/v1/acme/bot?before=10', admin))).entries.map((e: Json) => e.seq)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('replays with remaining and on_outage from the current state', async () => {
    const { admin } = await newTenant()
    await call('PUT', '/v1/a', admin, { usd: 10 })
    const first = await reply(await call('POST', '/v1/a', admin, { usd: 1 }, 'r1'))
    expect(first).toMatchObject({ remaining: { usd: { left: 9 } }, on_outage: 'closed' })
    await call('POST', '/v1/a', admin, { usd: 2 }, 'r2')
    await call('PUT', '/v1/a', admin, { usd: 10, on_outage: 'open' })
    const again = await reply(await call('POST', '/v1/a', admin, { usd: 1 }, 'r1'))
    expect(again).toMatchObject({ status: 200, receipt: { ...first.receipt, replay: true }, remaining: { usd: { scope: 'a', left: 7 } }, on_outage: 'open' })
  })

  it('settles over HTTP as a fresh receipt, and refuses a different actual under the same key', async () => {
    const { admin } = await newTenant()
    await call('POST', '/v1/a', admin, { tokens: 900 }, 'llm-1')
    expect(await reply(await call('POST', '/v1/a', admin, { settle: { tokens: 120 } }, 'llm-1'))).toMatchObject({ status: 200, receipt: { kind: 'settle', replay: false } })
    expect(await reply(await call('POST', '/v1/a', admin, { settle: { tokens: 121 } }, 'llm-1'))).toEqual({ status: 409, error: 'idempotency_conflict' })
  })
})

describe('errors table', () => {
  it.each([
    ['POST', '/v1/A', { x: 1 }, 'k', { error: 'invalid_scope', scope: 'A' }],
    ['POST', '/v1/a', 'null', 'k', { error: 'invalid_amount' }],
    ['POST', '/v1/a', '5', 'k', { error: 'invalid_amount' }],
    ['POST', '/v1/a', '"settle"', 'k', { error: 'invalid_amount' }],
    ['POST', '/v1/a', '[]', 'k', { error: 'invalid_amount' }],
    ['POST', '/v1/a', { usd: 0 }, 'k', { error: 'invalid_amount' }],
    ['POST', '/v1/a', { USD: 1 }, 'k', { error: 'invalid_unit', unit: 'USD' }],
    ['POST', '/v1/a', { spends: 1 }, 'k', { error: 'invalid_unit', unit: 'spends' }],
    ['POST', '/v1/a', { x: 1 }, 'x'.repeat(256), { error: 'invalid_idempotency_key' }],
    ['PUT', '/v1/a', { USD: 1 }, undefined, { error: 'invalid_unit', unit: 'USD' }],
    ['PUT', '/v1/a', { usd: 1, per: 'fortnight' }, undefined, { error: 'invalid_limit', field: 'per' }],
    ['PUT', '/v1/a', { rotate_admin: true }, undefined, { error: 'invalid_limit', reason: 'rotate_admin is only allowed on the root scope' }],
    ['PUT', '/v1/', { spends: 5 }, undefined, { error: 'plan_owned' }],
  ])('%s %s %j → %j', async (method, path, b, idem, expected) => {
    const res = await call(method, path, (await newTenant()).admin, b, idem)
    const status = { invalid_limit: 400, plan_owned: 403 }[expected.error as string] ?? 400
    expect(await reply(res)).toEqual({ status, ...expected })
  })

  it('accepts an idempotency key of exactly 255 characters', async () => {
    expect((await call('POST', '/v1/a', (await newTenant()).admin, { x: 1 }, 'x'.repeat(255))).status).toBe(200)
  })

  it.each(['a1', '1a', '-1', '1.5', ''])('refuses before=%j', async (before) => {
    expect(await reply(await call('GET', `/v1/a?before=${before}`, (await newTenant()).admin))).toEqual({ status: 400, error: 'invalid_before' })
  })

  it('refuses a key that fails its MAC, or has a stale generation or epoch, as invalid_key', async () => {
    const { admin } = await newTenant()
    const flipped = admin.replace(/.$/, (c) => (c === '0' ? '1' : '0'))
    expect(await reply(await call('GET', '/v1/', flipped))).toEqual({ status: 401, error: 'invalid_key' })
    const old = await spendKey(admin, 'acme', 0)
    await call('PUT', '/v1/acme', admin, { rotate_keys: true })
    expect(await reply(await call('POST', '/v1/acme', old, { x: 1 }, 'e1'))).toEqual({ status: 401, error: 'invalid_key' })
    expect((await call('POST', '/v1/acme', await spendKey(admin, 'acme', 1), { x: 1 }, 'e2')).status).toBe(200)
    await call('PUT', '/v1/', admin, { rotate_admin: true })
    expect(await reply(await call('GET', '/v1/', admin))).toEqual({ status: 401, error: 'invalid_key' })
  })

  it('refuses a spend key outside its scope with both scopes named, and any PUT as admin_required', async () => {
    const { admin } = await newTenant()
    const bot = await spendKey(admin, 'acme/bot', 0)
    expect(await reply(await call('GET', '/v1/acme', bot))).toEqual({ status: 403, error: 'out_of_scope', scope: 'acme', key_scope: 'acme/bot' })
    expect(await reply(await call('PUT', '/v1/acme/bot', bot, { usd: 1 }))).toEqual({ status: 403, error: 'admin_required' })
  })

  it('refuses a reused key with a different body at the same scope', async () => {
    const { admin } = await newTenant()
    await call('POST', '/v1/a', admin, { x: 1 }, 'same')
    expect(await reply(await call('POST', '/v1/a', admin, { x: 2 }, 'same'))).toEqual({ status: 409, error: 'idempotency_conflict' })
  })

  it('details a windowed 402 and sets Retry-After to the seconds until it resets', async () => {
    const { admin } = await newTenant()
    await call('PUT', '/v1/a', admin, { calls: 1, per: 'hour' })
    await call('POST', '/v1/a', admin, { calls: 1 }, 'w1')
    const res = await call('POST', '/v1/a/b', admin, { calls: 0.5 }, 'w2')
    const now = Date.now()
    const resets = new Date(Math.floor(now / 3_600_000) * 3_600_000 + 3_600_000).toISOString()
    expect(await reply(res)).toEqual({ status: 402, error: 'limit_exceeded', scope: 'a', unit: 'calls', limit: 1, used: 1, requested: 0.5, resets })
    const wait = Math.ceil((Date.parse(resets) - now) / 1000)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(wait - 1)
    expect(Number(res.headers.get('retry-after'))).toBeLessThanOrEqual(wait + 1)
  })

  it('details a lifetime 402 with resets null and no Retry-After', async () => {
    const { admin } = await newTenant()
    await call('PUT', '/v1/a', admin, { usd: 0 })
    const res = await call('POST', '/v1/a', admin, { usd: 0.01 }, 'l1')
    expect(res.headers.get('retry-after')).toBeNull()
    expect(await reply(res)).toEqual({ status: 402, error: 'limit_exceeded', scope: 'a', unit: 'usd', limit: 0, used: 0, requested: 0.01, resets: null })
  })

  it('reports an exhausted plan as a 402 at scope "" for unit spends', async () => {
    const { tenant, admin } = await newTenant()
    await call('POST', '/v1/a', admin, { x: 1 }, 'b1')
    await setBillable(stubOf(tenant), 100_000)
    const res = await call('POST', '/v1/a', admin, { x: 1 }, 'b2')
    const d = new Date()
    const resets = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString()
    expect(await reply(res)).toEqual({ status: 402, error: 'limit_exceeded', scope: '', unit: 'spends', limit: 100_000, used: 100_000, requested: 1, resets })
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
  })
})

describe('units named after Object.prototype members', () => {
  it('limits, spends, settles and reports a unit named constructor like any other', async () => {
    const { admin } = await newTenant()
    expect((await call('POST', '/v1/acme', admin, { usd: 1 }, 'before')).status).toBe(200)
    expect(await reply(await call('PUT', '/v1/acme', admin, { constructor: 10 }))).toMatchObject({ status: 200, limits: [{ unit: 'constructor', limit: 10, used: 0, left: 10 }] })
    expect(await reply(await call('POST', '/v1/acme', admin, { constructor: 5, usd: 1 }, 'h1'))).toMatchObject({ status: 200, remaining: { constructor: { scope: 'acme', left: 5 } } })
    expect(await reply(await call('POST', '/v1/acme', admin, { settle: { usd: 1 } }, 'h1'))).toEqual({ status: 400, error: 'invalid_unit', unit: 'constructor' })
    expect(await reply(await call('POST', '/v1/acme', admin, { settle: { constructor: 2, usd: 1 } }, 'h1'))).toMatchObject({ status: 200, remaining: { constructor: { left: 8 } } })
    expect(await reply(await call('PUT', '/v1/acme', admin, { constructor: 10 }))).toMatchObject({ status: 200, limits: [{ unit: 'constructor', used: 2, left: 8 }] })
    expect(await reply(await call('GET', '/v1/acme', admin))).toMatchObject({ status: 200, limits: [{ unit: 'constructor', used: 2, left: 8 }] })
  })

  it('refuses a settle that names constructor when the hold did not', async () => {
    const { admin } = await newTenant()
    expect((await call('POST', '/v1/acme', admin, { usd: 1 }, 'h1')).status).toBe(200)
    expect(await reply(await call('POST', '/v1/acme', admin, { settle: { usd: 1, constructor: 1 } }, 'h1'))).toEqual({ status: 400, error: 'invalid_unit', unit: 'constructor' })
  })

  it.each(['toString', '__proto__', 'hasOwnProperty'])('refuses %s as a unit in a PUT, a spend and a settle', async (unit) => {
    const { admin } = await newTenant()
    const body = `{"${unit}":1}`
    expect(await reply(await call('PUT', '/v1/acme', admin, body))).toEqual({ status: 400, error: 'invalid_unit', unit })
    expect(await reply(await call('POST', '/v1/acme', admin, body, 's1'))).toEqual({ status: 400, error: 'invalid_unit', unit })
    expect((await call('POST', '/v1/acme', admin, { usd: 1 }, 'h1')).status).toBe(200)
    expect(await reply(await call('POST', '/v1/acme', admin, `{"settle":{"usd":1,"${unit}":1}}`, 'h1'))).toEqual({ status: 400, error: 'invalid_unit', unit })
  })
})
