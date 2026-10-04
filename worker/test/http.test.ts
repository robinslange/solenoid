import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { GENESIS, entryHash, importSigningKey, publicJwk, signHash, verifyChain } from '../src/chain'
import { adminKey, spendKey } from '../src/keys'

type Json = Record<string, any>
async function newTenant(): Promise<string> {
  const tenant = Array.from({ length: 12 }, () => 'abcdefghijklmnopqrstuvwxyz234567'[Math.floor(Math.random() * 32)]).join('')
  await env.TENANT.get(env.TENANT.idFromName(tenant)).init(tenant, 'free')
  return adminKey(env.MASTER, tenant, 1)
}
const call = (method: string, path: string, key: string | null, body?: unknown, idem?: string) =>
  SELF.fetch(`https://api.test${path}`, {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(idem ? { 'idempotency-key': idem } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
const body = async (r: Response) => (await r.json()) as Json

describe('http', () => {
  it('spends, limits and reads through the API', async () => {
    const admin = await newTenant()
    expect((await call('PUT', '/v1/acme', admin, { usd: 1, per: 'day', on_outage: 'open', warn_at: 0.5 })).status).toBe(200)
    const agent = await spendKey(admin, 'acme/bot', 0)
    const ok = await call('POST', '/v1/acme/bot/run-1', agent, { usd: 0.75 }, 'i1')
    expect(ok.status).toBe(200)
    expect(await body(ok)).toMatchObject({ remaining: { usd: { scope: 'acme', left: 0.25 } }, on_outage: 'open', warnings: [{ scope: 'acme', unit: 'usd' }] })
    const blocked = await call('POST', '/v1/acme/bot/run-2', agent, { usd: 0.5 }, 'i2')
    expect(blocked.status).toBe(402)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await body(blocked)).toMatchObject({ error: 'limit_exceeded', scope: 'acme', unit: 'usd' })
    expect((await call('GET', '/v1/acme', agent)).status).toBe(403)
    expect((await call('GET', '/v1/acme/bot', agent)).status).toBe(200)
  })

  it('holds and settles over HTTP with one idempotency key', async () => {
    const admin = await newTenant()
    await call('PUT', '/v1/a', admin, { tokens: 1000 })
    await call('POST', '/v1/a', admin, { tokens: 900 }, 'llm-1')
    const settled = await call('POST', '/v1/a', admin, { settle: { tokens: 120 } }, 'llm-1')
    expect(await body(settled)).toMatchObject({ receipt: { kind: 'settle' }, remaining: { tokens: { left: 880 } } })
  })

  it('treats key order and whitespace as the same body, but another scope as a conflict', async () => {
    const admin = await newTenant()
    await call('POST', '/v1/a', admin, '{"x":1,"y":2}', 'same')
    expect((await body(await call('POST', '/v1/a', admin, '{ "y": 2, "x": 1 }', 'same'))).receipt.replay).toBe(true)
    expect((await call('POST', '/v1/b', admin, '{"x":1,"y":2}', 'same')).status).toBe(409)
  })

  it.each([
    ['POST', '/v1/a', { x: 1 }, undefined, 400, 'missing_idempotency_key'],
    ['POST', '/v1/a', { x: 1 }, 'has#hash', 400, 'invalid_idempotency_key'],
    ['POST', '/v1/A', { x: 1 }, 'k', 400, 'invalid_scope'],
    ['POST', '/v1/a', 'not json', 'k', 400, 'invalid_amount'],
    ['POST', '/v1/a', { settle: { x: 1 } }, 'never-held', 404, 'unknown_spend'],
    ['PUT', '/v1/a', 'not json', undefined, 400, 'invalid_limit'],
    ['PUT', '/v1/a', {}, undefined, 400, 'invalid_limit'],
    ['PUT', '/v1/a', { x: 1, per: 'fortnight' }, undefined, 400, 'invalid_limit'],
    ['PUT', '/v1/a', { x: 1, on_outage: 'maybe' }, undefined, 400, 'invalid_limit'],
    ['PUT', '/v1/a', { x: 1, warn_at: 1.5 }, undefined, 400, 'invalid_limit'],
    ['PUT', '/v1/a', { rotate_keys: 'yes' }, undefined, 400, 'invalid_limit'],
    ['GET', '/v1/a?before=abc', undefined, undefined, 400, 'invalid_before'],
    ['DELETE', '/v1/a', undefined, undefined, 405, 'method_not_allowed'],
  ])('%s %s %j → %i %s', async (method, path, b, idem, status, error) => {
    const res = await call(method, path, await newTenant(), b, idem)
    expect(res.status).toBe(status)
    expect((await body(res)).error).toBe(error)
  })

  it('refuses a missing key, and serves unknown paths as 404', async () => {
    expect((await call('GET', '/v1/', null)).status).toBe(401)
    expect((await call('GET', '/nope', null)).status).toBe(404)
  })

  it('rejects a non-ASCII byte in the key as 401, not 500', async () => {
    const admin = await newTenant()
    const bad = admin.replace(/[0-9a-f]$/, 'é')
    expect((await call('GET', '/v1/', bad)).status).toBe(401)
  })

  it('returns a new admin key from rotate_admin, and the old one stops working', async () => {
    const admin = await newTenant()
    const { admin_key } = await body(await call('PUT', '/v1/', admin, { rotate_admin: true }))
    expect(admin_key).toMatch(/\.2\.[0-9a-f]{64}$/)
    expect((await call('GET', '/v1/', admin)).status).toBe(401)
    expect((await call('GET', '/v1/', admin_key)).status).toBe(200)
  })

  it('publishes the receipt-signing public key and nothing private', async () => {
    const { keys } = await body(await SELF.fetch('https://api.test/.well-known/solenoid.json'))
    expect(keys.k1).toEqual({ kty: 'OKP', crv: 'Ed25519', x: expect.any(String) })
  })
})

describe('signing key rotation', () => {
  const retired = () => (JSON.parse(env.RETIRED_SIGNING_KEYS as string) as Record<string, JsonWebKey>).k0

  it('publishes each retired key by its kid, public parts only, and lets the current kid win a clash', async () => {
    const { keys } = await body(await SELF.fetch('https://api.test/.well-known/solenoid.json'))
    expect(keys).toEqual({ k0: { kty: 'OKP', crv: 'Ed25519', x: retired().x }, k1: publicJwk(env.SIGNING_KEY) })
  })

  it('still verifies a receipt signed under a retired kid, and each kid only under its own key', async () => {
    const { keys } = await body(await SELF.fetch('https://api.test/.well-known/solenoid.json'))
    const e = { seq: 1, kind: 'spend' as const, scope: 'a', body: { usd: 1 }, at: new Date(0).toISOString(), kid: 'k0' }
    const hash = await entryHash(GENESIS, e)
    const old = { ...e, prev: GENESIS, hash, sig: await signHash(await importSigningKey(JSON.stringify(retired())), hash) }
    expect(await verifyChain([old], keys[old.kid])).toBe(true)
    expect(await verifyChain([old], keys.k1)).toBe(false)
  })

  const withRetired = async (value: unknown) => {
    const saved = env.RETIRED_SIGNING_KEYS
    ;env.RETIRED_SIGNING_KEYS = value as string
    try {
      const r = await SELF.fetch('https://api.test/.well-known/solenoid.json')
      return { status: r.status, ...(await body(r)) }
    } finally {
      ;env.RETIRED_SIGNING_KEYS = saved
    }
  }
  const pub = () => ({ kty: 'OKP', crv: 'Ed25519', x: retired().x })

  it.each([undefined, '', 'not json', '{"k0":', 'null', '5', '"k0"', '[]', 12])('ignores a retired-keys value of %j and still publishes the current key', async (value) => {
    expect(await withRetired(value)).toEqual({ status: 200, keys: { k1: publicJwk(env.SIGNING_KEY) } })
  })

  it('skips each retired entry that is not a public key, and keeps the rest', async () => {
    const value = JSON.stringify({ gone: null, text: 'x', empty: {}, nox: { kty: 'OKP', crv: 'Ed25519' }, k0: pub() })
    expect(await withRetired(value)).toEqual({ status: 200, keys: { k0: pub(), k1: publicJwk(env.SIGNING_KEY) } })
  })

  it('reads the retired keys from an object as well as a JSON string, as wrangler.jsonc can give either', async () => {
    expect(await withRetired({ k0: pub(), gone: null })).toEqual({ status: 200, keys: { k0: pub(), k1: publicJwk(env.SIGNING_KEY) } })
  })
})
