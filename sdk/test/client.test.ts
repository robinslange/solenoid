import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LimitExceeded, Outage, SolenoidError, SolenoidUnavailable, signup, solenoid, verifyChain, type Receipt } from '../src/index'
import { entryHash, signHash } from '../../worker/src/chain'
import { handle, type RouterEnv } from '../../worker/src/router'
import { testServer, type TestServer } from '../../testing/src/index'

let server: TestServer, http: Server, shim: string
beforeAll(async () => {
  server = await testServer()
  http = createServer(async (req, res) => {
    const r = await server.fetch(`${server.api}${req.url}`, { method: req.method })
    res.writeHead(r.status, { 'content-type': 'application/json' }).end(await r.text())
  })
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done))
  shim = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
})
afterAll(() => { http?.close() })
afterEach(() => { vi.unstubAllEnvs() })

async function account(f: typeof fetch = server.fetch) {
  const { admin_key } = await server.signup()
  const admin = solenoid({ key: admin_key, api: server.api, fetch: server.fetch })
  const agent = async (scope: string, o: Parameters<typeof solenoid>[0] = {}) => solenoid({ key: await admin.deriveKey(scope), api: server.api, fetch: f, ...o })
  return { admin_key, admin, agent }
}
const counting = () => {
  const calls: string[] = []
  const f: typeof fetch = (input, init) => { calls.push(`${init?.method ?? 'GET'} ${String(input).slice(server.api.length)}`); return server.fetch(input, init) }
  return { calls, f }
}
const usage = (i: number, o: number) => ({ usage: { prompt_tokens: i, completion_tokens: o } })

const API_ERROR = new TypeError('solenoid: the API must be an http or https URL, such as https://api.solenoid.systems, with no user, password, query or fragment and on a port that fetch allows; set SOLENOID_API or pass { api }')
const FETCH_BLOCKED_PORTS = [
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]
const BAD_APIS = ['api.solenoid.systems', 'localhost:8787', 'ftp://api.solenoid.systems', '', '  ', 'http://u:p@127.0.0.1:8787', 'http://u@127.0.0.1:8787', 'http://127.0.0.1:6000', 'http://localhost:5060', 'https://api.test:10080', 'http://127.0.0.1:0', 'https://api.test:0', 'https://api.solenoid.systems/?x=1', 'https://api.solenoid.systems/#top']

describe('signup', () => {
  it('mints an account over real HTTP, trimming a trailing slash from the API', async () => {
    const acct = await signup(`${shim}/`)
    expect(acct.admin_key).toMatch(new RegExp(`^sk\\.admin\\.${acct.tenant}\\.1\\.[0-9a-f]{64}$`))
    expect(await solenoid({ key: acct.admin_key, api: server.api, fetch: server.fetch }).get('')).toMatchObject({ scope: '', epoch: 0 })
  })
  it('reads SOLENOID_API when no API is given', async () => {
    vi.stubEnv('SOLENOID_API', shim)
    expect((await signup()).admin_key).toMatch(/^sk\.admin\./)
  })
  it('defaults to the production API', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ tenant: 't', admin_key: 'k' }), { status: 201 }))
    vi.stubGlobal('fetch', f)
    try {
      expect(await signup()).toEqual({ tenant: 't', admin_key: 'k' })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(f.mock.calls[0]).toEqual(['https://api.solenoid.systems/auth/signup', expect.objectContaining({ method: 'POST' })])
    expect(f.mock.calls[0][1]).not.toHaveProperty('body')
  })
  it.each(BAD_APIS)('refuses %j as the API before any request', async (api) => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    try {
      await expect(signup(api)).rejects.toThrow(API_ERROR)
    } finally {
      vi.unstubAllGlobals()
    }
    expect(f).not.toHaveBeenCalled()
  })
  it('throws the error the server answered with when it does not answer 201', async () => {
    const e = await signup(`${shim}/elsewhere`).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(SolenoidError)
    expect(e).toMatchObject({ status: 404, code: 'not_found' })
  })
})

describe('client configuration', () => {
  const view = { scope: '', epoch: 0, limits: [], children: [], entries: [], next: null }
  const capture = () => vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(view), { status: 200 }))

  it('refuses to build without a key', () => {
    expect(() => solenoid({ api: 'http://x' })).toThrow(new TypeError('solenoid: set SOLENOID_KEY or pass { key }'))
  })
  it.each(BAD_APIS)('refuses %j as the API when it is built, even with open cached, instead of treating it as an outage', (api) => {
    const f = vi.fn()
    const build = () => solenoid({ key: 'sk.x', api, fetch: f, store: { get: () => 'open', set: () => {} } })
    expect(build).toThrow(API_ERROR)
    vi.stubEnv('SOLENOID_API', api)
    expect(() => solenoid({ key: 'sk.x', fetch: f })).toThrow(TypeError)
    expect(f).not.toHaveBeenCalled()
  })
  it.each([
    ['http://127.0.0.1:8787 ', 'http://127.0.0.1:8787/v1/a'],
    ['\thttps://api.test/base/ ', 'https://api.test/base/v1/a'],
    ['HTTPS://API.test', 'https://api.test/v1/a'],
    ['https://api.test/?', 'https://api.test/v1/a'],
  ])('sends to the parsed form of %j', async (api, url) => {
    const f = capture()
    await solenoid({ key: 'sk.x', api, fetch: f as unknown as typeof fetch }).get('a')
    expect(f.mock.calls[0][0]).toBe(url)
  })
  it('refuses exactly the ports that fetch blocks, since a request to one fails the same way on every retry', async () => {
    for (const port of FETCH_BLOCKED_PORTS) {
      const refused = await fetch(`http://127.0.0.1:${port}/`).catch((e: Error) => (e.cause as Error).message)
      expect(refused).toBe('bad port')
      expect(() => solenoid({ key: 'sk.x', api: `http://127.0.0.1:${port}`, fetch: vi.fn() })).toThrow(API_ERROR)
      for (const near of [port - 1, port + 1].filter((p) => p > 0 && !FETCH_BLOCKED_PORTS.includes(p))) {
        expect(() => solenoid({ key: 'sk.x', api: `http://127.0.0.1:${near}`, fetch: vi.fn() })).not.toThrow()
      }
    }
  })
  it.each([
    ['http://api.test', 'http://api.test/v1/a'],
    ['https://api.test', 'https://api.test/v1/a'],
    ['http://api.test:80', 'http://api.test/v1/a'],
    ['https://api.test:443/', 'https://api.test/v1/a'],
    [undefined, 'https://api.solenoid.systems/v1/a'],
  ])('accepts %j on its default port, which fetch allows', async (api, url) => {
    const f = capture()
    await solenoid({ key: 'sk.x', api, fetch: f as unknown as typeof fetch }).get('a')
    expect(f.mock.calls[0][0]).toBe(url)
  })
  it('signs up at the parsed form of the API', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ tenant: 't', admin_key: 'k' }), { status: 201 }))
    vi.stubGlobal('fetch', f)
    try {
      await signup('https://api.test/ ')
    } finally {
      vi.unstubAllGlobals()
    }
    expect(f.mock.calls[0][0]).toBe('https://api.test/auth/signup')
  })
  it('accepts an http API, as a local server uses', async () => {
    const f = capture()
    await solenoid({ key: 'sk.x', api: 'http://127.0.0.1:8787/', fetch: f as unknown as typeof fetch }).get('a')
    expect(f.mock.calls[0][0]).toBe('http://127.0.0.1:8787/v1/a')
  })
  it('reads SOLENOID_KEY and SOLENOID_API from the environment', async () => {
    vi.stubEnv('SOLENOID_KEY', 'sk.from-env')
    vi.stubEnv('SOLENOID_API', 'http://env.test/')
    const f = capture()
    await solenoid({ fetch: f as unknown as typeof fetch }).get('a')
    expect(f.mock.calls[0][0]).toBe('http://env.test/v1/a')
    expect((f.mock.calls[0][1]!.headers as Record<string, string>).authorization).toBe('Bearer sk.from-env')
  })
  it('prefers the api option to SOLENOID_API, and trims its trailing slash', async () => {
    vi.stubEnv('SOLENOID_API', 'http://env.test')
    const f = capture()
    await solenoid({ key: 'sk.x', api: 'http://opt.test/', fetch: f as unknown as typeof fetch }).get('a')
    expect(f.mock.calls[0][0]).toBe('http://opt.test/v1/a')
  })
  it('defaults to the production API', async () => {
    const f = capture()
    await solenoid({ key: 'sk.x', fetch: f as unknown as typeof fetch }).get('a')
    expect(f.mock.calls[0][0]).toBe('https://api.solenoid.systems/v1/a')
  })
  it('uses the global fetch when none is given', async () => {
    const f = capture()
    vi.stubGlobal('fetch', f)
    try {
      await solenoid({ key: 'sk.x', api: 'http://x' }).get('a')
    } finally {
      vi.unstubAllGlobals()
    }
    expect(f).toHaveBeenCalledOnce()
  })
  it('builds where there is no process global, as in a browser or a Worker', async () => {
    const f = capture()
    vi.stubGlobal('process', undefined)
    let sol
    try {
      sol = solenoid({ key: 'sk.x', fetch: f as unknown as typeof fetch })
    } finally {
      vi.unstubAllGlobals()
    }
    await sol.get('a')
    expect(f.mock.calls[0][0]).toBe('https://api.solenoid.systems/v1/a')
  })
  it('checks the scope when at() is called, before any request', () => {
    const f = capture()
    expect(() => solenoid({ key: 'sk.x', api: 'http://x', fetch: f as unknown as typeof fetch }).at('Acme')).toThrow(TypeError)
    expect(f).not.toHaveBeenCalled()
  })
  it('names each run with a base-36 timestamp and six random base-36 characters', async () => {
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: capture() as unknown as typeof fetch })
    const ids = await Promise.all(Array.from({ length: 50 }, () => sol.run('', async (r) => r.scope)))
    const stamp = Date.now().toString(36).length
    for (const id of ids) expect(id).toMatch(new RegExp(`^run-[0-9a-z]{${stamp + 6}}$`))
    expect(new Set(ids).size).toBe(50)
  })
})

describe('admin operations against the real ledger', () => {
  it('rotates the admin key: the new one works and the old one is refused', async () => {
    const { admin } = await account()
    const next = await admin.rotateAdmin()
    expect(next).toMatch(/^sk\.admin\.[a-z2-7]{12}\.2\.[0-9a-f]{64}$/)
    expect(await solenoid({ key: next, api: server.api, fetch: server.fetch }).get('')).toMatchObject({ scope: '' })
    await expect(admin.get('')).rejects.toMatchObject({ status: 401, code: 'invalid_key' })
  })
  it('pages entries with before', async () => {
    const { admin } = await account()
    for (let i = 0; i < 3; i++) await admin.spend('a', { n: 1 })
    const all = (await admin.get('')).entries
    const below = await admin.get('', { before: all[0].seq })
    expect(below.entries.map((e) => e.seq)).toEqual(all.slice(1).map((e) => e.seq))
  })
  it('derives a key at an explicit epoch without reading the scope', async () => {
    const { admin, admin_key } = await account()
    const { calls, f } = counting()
    const counted = solenoid({ key: admin_key, api: server.api, fetch: f })
    await admin.rotate('a')
    const stale = await counted.deriveKey('a', 0)
    expect(calls).toEqual([])
    await expect(solenoid({ key: stale, api: server.api, fetch: server.fetch }).spend('a', { n: 1 })).rejects.toMatchObject({ code: 'invalid_key' })
    const fresh = await counted.deriveKey('a')
    expect(calls).toEqual(['GET /v1/a'])
    expect(await solenoid({ key: fresh, api: server.api, fetch: server.fetch }).spend('a', { n: 1 })).not.toBeNull()
  })
  it('settles a hold through the same idempotency key, and returns its receipt', async () => {
    const { admin } = await account()
    await admin.spend('a', { n: 3 }, { idempotencyKey: 'h-1' })
    const r = await admin._internal.settle('a', 'h-1', { n: 1 })
    expect(r).toMatchObject({ kind: 'settle', scope: 'a', body: { actual: { n: 1 } } })
  })
})

describe('outage modes', () => {
  it('reports closed for a scope with nothing cached', async () => {
    expect(await solenoid({ key: 'sk.x', api: 'http://x' })._internal.modeFor('a/b')).toBe('closed')
  })
  it('returns null from a settle that fails open during an outage', async () => {
    const { admin, agent } = await account()
    await admin.limit('a', { n: 5, on_outage: 'open' })
    let down = false
    const bot = await agent('a', { fetch: (i, init) => (down ? Promise.reject(new TypeError('fetch failed')) : server.fetch(i, init)) })
    await bot.spend('a', { n: 2 }, { idempotencyKey: 'h-2' })
    down = true
    expect(await bot._internal.settle('a', 'h-2', { n: 1 })).toBeNull()
  })
})

describe('warnings', () => {
  it('calls onWarn only when a spend crosses warn_at, and is fine without an onWarn', async () => {
    const { admin, agent } = await account()
    await admin.limit('a', { n: 10, warn_at: 0.5 })
    const onWarn = vi.fn()
    const bot = await agent('a', { onWarn })
    await bot.spend('a', { n: 1 })
    expect(onWarn).not.toHaveBeenCalled()
    await bot.spend('a', { n: 5 })
    expect(onWarn).toHaveBeenCalledWith([{ scope: 'a', unit: 'n', used: 6, limit: 10 }])
    expect(await (await agent('a')).spend('a', { n: 1 })).not.toBeNull()
  })
  it('accepts a response with no warnings field', async () => {
    const body = { receipt: { id: 'r' }, remaining: {}, on_outage: 'closed' }
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(body))) })
    expect(await sol.spend('a', { n: 1 })).toEqual({ id: 'r' })
  })
})

describe('verify against the published keys', () => {
  it('refuses a receipt signed under a kid the server does not publish', async () => {
    const { admin } = await account()
    const r = (await admin.spend('a', { n: 1 }))!
    expect(await admin.verify(r)).toBe(true)
    expect(await admin.verify({ ...r, kid: 'k9' })).toBe(false)
  })
  it('verifies receipts signed before a signing key rotation once the old key is published as retired', async () => {
    const { admin_key, admin } = await account()
    const before = [(await admin.spend('a', { n: 1 }))!, (await admin.spend('a', { n: 2 }))!]
    const { keys } = (await (await server.fetch(`${server.api}/.well-known/solenoid.json`)).json()) as { keys: Record<string, JsonWebKey> }
    const next = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const rotated = { MASTER: 'unused', SIGNING_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', next.privateKey)), SIGNING_KID: 'k2' }
    const after = (env: RouterEnv): typeof fetch => async (input, init) =>
      handle(new Request(input, init), env, () => { throw new Error('only the well-known keys are read') }, { mail: async () => {}, waitUntil: () => {} })
    const bare = solenoid({ key: admin_key, api: server.api, fetch: after(rotated) })
    expect(await bare.verify(before[0])).toBe(false)
    const withRetired = solenoid({ key: admin_key, api: server.api, fetch: after({ ...rotated, RETIRED_SIGNING_KEYS: JSON.stringify({ k1: keys.k1 }) }) })
    expect(await withRetired.verify(before[0])).toBe(true)
    expect(await withRetired.verifyChain(before)).toBe(true)
  })
  const publishedKeys = async () => ((await (await server.fetch(`${server.api}/.well-known/solenoid.json`)).json()) as { keys: Record<string, JsonWebKey> }).keys
  const ed25519 = async () => (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const sealAfter = async (prev: Receipt, kid: string, key: CryptoKey): Promise<Receipt> => {
    const e = { seq: prev.seq + 1, kind: 'spend' as const, scope: prev.scope, body: { n: 1 }, at: prev.at, kid }
    const hash = await entryHash(prev.hash, e)
    return { ...e, id: `r${e.seq}`, prev: prev.hash, hash, sig: await signHash(key, hash), replay: false }
  }
  it('refetches the published keys once when a receipt names a kid it has not seen, so a key rotated in after the first fetch verifies', async () => {
    const { admin_key, admin } = await account()
    const old = (await admin.spend('a', { n: 1 }))!
    const next = await ed25519()
    const rotated: RouterEnv = { MASTER: 'unused', SIGNING_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', next.privateKey)), SIGNING_KID: 'k2', RETIRED_SIGNING_KEYS: JSON.stringify({ k1: (await publishedKeys()).k1 }) }
    const calls: string[] = []
    let source: typeof fetch = server.fetch
    const client = solenoid({ key: admin_key, api: server.api, fetch: (input, init) => { calls.push(String(input).slice(server.api.length)); return source(input, init) } })
    expect(await client.verify(old)).toBe(true)
    source = async (input, init) => handle(new Request(input, init), rotated, () => { throw new Error('only the well-known keys are read') }, { mail: async () => {}, waitUntil: () => {} })
    const fresh = await sealAfter(old, 'k2', next.privateKey)
    expect(await client.verify(fresh)).toBe(true)
    expect(await client.verifyChain([old, fresh])).toBe(true)
    expect(await client.verify(old)).toBe(true)
    expect(calls).toEqual([KEYS, FRESH])
  })
  const KEYS = '/.well-known/solenoid.json'
  const FRESH = expect.stringMatching(/^\/\.well-known\/solenoid\.json\?t=\d+$/)
  const keyFetches = (source: () => typeof fetch = () => server.fetch) => {
    const urls: string[] = []
    const f: typeof fetch = (input, init) => { urls.push(`${String(input).slice(server.api.length)}${init?.cache ? ` cache=${init.cache}` : ''}`); return source()(input, init) }
    return { urls, f }
  }
  it('refetches for a kid it lacks at most once every 5 seconds, at a fresh URL that no HTTP cache holds, then refuses it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.UTC(2030, 0, 1))
      const { admin_key, admin } = await account()
      const { urls, f } = keyFetches()
      const counted = solenoid({ key: admin_key, api: server.api, fetch: f })
      const r = (await admin.spend('a', { n: 1 }))!
      expect(await counted.verify(r)).toBe(true)
      expect(await counted.verify({ ...r, kid: 'k9' })).toBe(false)
      expect(await counted.verifyChain([r, { ...r, kid: 'k9' }])).toBe(false)
      vi.setSystemTime(Date.UTC(2030, 0, 1) + 4_999)
      expect(await counted.verify({ ...r, kid: 'k8' })).toBe(false)
      expect(urls).toEqual([KEYS, `${KEYS}?t=${Date.UTC(2030, 0, 1)}`])
      vi.setSystemTime(Date.UTC(2030, 0, 1) + 5_000)
      expect(await counted.verify({ ...r, kid: 'k8' })).toBe(false)
      expect(await counted.verify(r)).toBe(true)
      expect(urls).toEqual([KEYS, `${KEYS}?t=${Date.UTC(2030, 0, 1)}`, `${KEYS}?t=${Date.UTC(2030, 0, 1) + 5_000}`])
    } finally {
      vi.useRealTimers()
    }
  })
  it('shares one refetch among concurrent checks of kids it lacks', async () => {
    const { admin_key, admin } = await account()
    const { urls, f } = keyFetches()
    const counted = solenoid({ key: admin_key, api: server.api, fetch: f })
    const r = (await admin.spend('a', { n: 1 }))!
    expect(await Promise.all(Array.from({ length: 20 }, (_, i) => counted.verify(i % 2 ? r : { ...r, kid: `k${i + 10}` })))).toEqual(Array.from({ length: 20 }, (_, i) => i % 2 === 1))
    expect(urls).toEqual([KEYS, FRESH])
  })
  it('lets every concurrent check of a newly rotated kid wait for the one refetch, and all of them verify', async () => {
    const { admin_key, admin } = await account()
    const old = (await admin.spend('a', { n: 1 }))!
    const next = await ed25519()
    const rotated: RouterEnv = { MASTER: 'unused', SIGNING_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', next.privateKey)), SIGNING_KID: 'k2', RETIRED_SIGNING_KEYS: JSON.stringify({ k1: (await publishedKeys()).k1 }) }
    let source: typeof fetch = server.fetch
    const { urls, f } = keyFetches(() => source)
    const client = solenoid({ key: admin_key, api: server.api, fetch: f })
    expect(await client.verify(old)).toBe(true)
    source = async (input, init) => handle(new Request(input, init), rotated, () => { throw new Error('only the well-known keys are read') }, { mail: async () => {}, waitUntil: () => {} })
    const fresh = await sealAfter(old, 'k2', next.privateKey)
    expect(await Promise.all(Array.from({ length: 10 }, () => client.verify(fresh)))).toEqual(Array(10).fill(true))
    expect(urls).toEqual([KEYS, FRESH])
  })
  it('refetches for a chain when any one of its kids is missing, even if the others are held', async () => {
    const { admin_key, admin } = await account()
    const old = (await admin.spend('a', { n: 1 }))!
    const next = await ed25519()
    const rotated: RouterEnv = { MASTER: 'unused', SIGNING_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', next.privateKey)), SIGNING_KID: 'k2', RETIRED_SIGNING_KEYS: JSON.stringify({ k1: (await publishedKeys()).k1 }) }
    let source: typeof fetch = server.fetch
    const { urls, f } = keyFetches(() => source)
    const client = solenoid({ key: admin_key, api: server.api, fetch: f })
    expect(await client.verify(old)).toBe(true)
    source = async (input, init) => handle(new Request(input, init), rotated, () => { throw new Error('only the well-known keys are read') }, { mail: async () => {}, waitUntil: () => {} })
    expect(await client.verifyChain([old, await sealAfter(old, 'k2', next.privateKey)])).toBe(true)
    expect(urls).toEqual([KEYS, FRESH])
  })
  it('returns false, without throwing, when a fetch throws synchronously on the refetch', async () => {
    const { admin_key, admin } = await account()
    const r = (await admin.spend('a', { n: 1 }))!
    let calls = 0
    const f = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (++calls > 1) throw new TypeError('fetch threw synchronously')
      return server.fetch(input, init)
    }) as typeof fetch
    const client = solenoid({ key: admin_key, api: server.api, fetch: f })
    expect(await client.verify(r)).toBe(true)
    expect(await client.verify({ ...r, kid: 'k9' })).toBe(false)
    expect(await client.verify(r)).toBe(true)
    expect(calls).toBe(2)
  })
  it('rejects, without throwing synchronously, when a fetch throws synchronously before any keys are held', async () => {
    const client = solenoid({ key: 'sk.x', api: 'http://x', fetch: (() => { throw new TypeError('fetch threw synchronously') }) as typeof fetch })
    const p = client.verifyChain([])
    await expect(p).rejects.toThrow('fetch threw synchronously')
  })
  it('keeps the keys it has when a refetch fails, so known kids still verify and the unknown one gets false', async () => {
    const { admin_key, admin } = await account()
    const { urls, f } = keyFetches()
    const client = solenoid({ key: admin_key, api: server.api, fetch: f })
    const r = (await admin.spend('a', { n: 1 }))!
    expect(await client.verify(r)).toBe(true)
    server.outage(true)
    try {
      expect(await client.verify({ ...r, kid: 'k9' })).toBe(false)
      expect(await client.verify(r)).toBe(true)
      expect(await client.verifyChain([r])).toBe(true)
    } finally {
      server.outage(false)
    }
    expect(urls).toEqual([KEYS, FRESH])
  })
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('refuses a receipt signed under the kid %s with false, reading only the published keys themselves', async (kid) => {
    const { admin } = await account()
    const r = (await admin.spend('a', { n: 1 }))!
    const forged = await sealAfter(r, kid, (await ed25519()).privateKey)
    expect(await admin.verify(forged)).toBe(false)
    expect(await admin.verifyChain([r, forged])).toBe(false)
    expect(await verifyChain([r, forged], await publishedKeys())).toBe(false)
  })
  it('fetches the published keys once and reuses them', async () => {
    const { admin_key, admin } = await account()
    const { calls, f } = counting()
    const counted = solenoid({ key: admin_key, api: server.api, fetch: f })
    const r = (await admin.spend('a', { n: 1 }))!
    await counted.verify(r)
    await counted.verifyChain([r])
    expect(calls).toEqual(['GET /.well-known/solenoid.json'])
  })
  it('treats a failed key fetch as an outage and tries again next time', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: {} })))
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f })
    const e = await sol.verifyChain([]).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(Outage)
    expect((e as Error).message).toBe('HTTP 503')
    expect(await sol.verifyChain([])).toBe(true)
  })
  it('times the key fetch out after timeoutMs', async () => {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))))
    const e = await solenoid({ key: 'sk.x', api: 'http://x', fetch: f as unknown as typeof fetch, timeoutMs: 20 }).verifyChain([]).catch((x: unknown) => x)
    expect((e as Error).name).toBe('TimeoutError')
  })
})

describe('at(scope).llm against the real ledger', () => {
  it('skips the budget read while the cache holds a tokens or usd figure for the scope', async () => {
    for (const unit of ['tokens', 'usd']) {
      const { admin, agent } = await account()
      await admin.limit('a', { [unit]: 1000 })
      const { calls, f } = counting()
      const bot = await agent('a', { fetch: f, prices: { m: { input: 1e-6, output: 1e-6 } } })
      await bot.spend('a', { [unit]: 1 })
      calls.length = 0
      await bot.at('a').llm(async () => usage(1, 1), { model: 'm', messages: [] })
      expect(calls).toEqual(['POST /v1/a', 'POST /v1/a'])
    }
  })
  it('rethrows a refusal from the budget read instead of treating it as an outage', async () => {
    const { admin } = await account()
    await admin.limit('a', { tokens: 1000, on_outage: 'open' })
    const real = await admin.deriveKey('a')
    const forged = solenoid({ key: `${real.slice(0, -1)}${real.endsWith('0') ? '1' : '0'}`, api: server.api, fetch: server.fetch, store: { get: () => 'open', set: () => {} } })
    const provider = vi.fn()
    await expect(forged.at('a').llm(provider, { model: 'm', messages: [] })).rejects.toMatchObject({ status: 401, code: 'invalid_key' })
    expect(provider).not.toHaveBeenCalled()
  })
  it('spends nothing after an unlimited call whose response has no usage', async () => {
    const { agent } = await account()
    const { calls, f } = counting()
    const bot = await agent('a', { fetch: f })
    expect(await bot.at('a').llm(async () => ({ text: 'hi' }), { model: 'm', messages: [] })).toEqual({ text: 'hi' })
    expect(calls).toEqual(['GET /v1/a'])
  })
  it.each([false, true])('caches a limit it learns of after the call, and refuses the next call after reading the budget again (other units cached: %s)', async (other) => {
    const { admin, agent } = await account()
    await admin.limit('a', { emails: 5 })
    const { calls, f } = counting()
    const bot = await agent('a', { fetch: f })
    if (other) await bot.spend('a', { emails: 1 })
    const res = await bot.at('a').llm(async () => { await admin.limit('a', { tokens: 1 }); return usage(3, 4) }, { model: 'm', messages: [] })
    expect(res).toEqual(usage(3, 4))
    calls.length = 0
    const provider = vi.fn()
    const e = await bot.at('a').llm(provider, { model: 'm', messages: [] }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(LimitExceeded)
    expect(e).toMatchObject({ scope: 'a', unit: 'tokens', detail: { local: true } })
    expect(provider).not.toHaveBeenCalled()
    expect(calls).toEqual(['GET /v1/a'])
    const tokens = { tokens: { scope: 'a', left: 0, resets: null } }
    expect(bot._internal.remaining.get('a')).toEqual(other ? { emails: { scope: 'a', left: 4, resets: null }, ...tokens } : tokens)
  })
  it('throws when the spend after an unlimited call is refused for any reason other than the limit or an outage', async () => {
    const { admin, agent } = await account()
    const bot = await agent('a')
    await expect(bot.at('a').llm(async () => { await admin.rotate('a'); return usage(1, 1) }, { model: 'm', messages: [] })).rejects.toMatchObject({ status: 401, code: 'invalid_key' })
  })
  it('does not settle a hold that failed open, whether the provider answers or throws', async () => {
    const { admin, agent } = await account()
    await admin.limit('a', { tokens: 10_000, on_outage: 'open' })
    let down = false
    let posts = 0
    const f: typeof fetch = (input, init) => {
      if (!down) return server.fetch(input, init)
      posts++
      return Promise.reject(new TypeError('fetch failed'))
    }
    const bot = await agent('a', { fetch: f, prices: { m: { input: 1e-6, output: 1e-6 } } })
    await bot.spend('a', { tokens: 1 })
    down = true
    expect(await bot.at('a').llm(async () => usage(1, 1), { model: 'm', messages: [] })).toEqual(usage(1, 1))
    expect(posts).toBe(2)
    await expect(bot.at('a').llm(async () => { throw new Error('provider down') }, { model: 'm', messages: [] })).rejects.toThrow('provider down')
    expect(posts).toBe(4)
  })
  it('holds for a request with no model, pricing only tokens', async () => {
    const { admin, agent } = await account()
    await admin.limit('a', { tokens: 10_000 })
    const bot = await agent('a')
    await bot.at('a').llm(async () => usage(2, 3), { messages: [] })
    expect((await admin.get('a')).limits[0].used).toBe(5)
  })
  it('reads the budget again before refusing locally, so a window reset or a raised limit lets the next call through', async () => {
    const start = Date.UTC(2030, 0, 1, 10, 30)
    server.setNow(start)
    try {
      const { admin, agent } = await account()
      await admin.limit('a', { tokens: 200, per: 'hour' })
      const { calls, f } = counting()
      const bot = await agent('a', { fetch: f, prices: { m: { input: 1e-6, output: 1e-6 } } })
      const provider = vi.fn(async () => usage(190, 5))
      await bot.at('a').llm(provider, { model: 'm', messages: [] })
      expect(bot._internal.remaining.get('a')).toEqual({ tokens: { scope: 'a', left: 5, resets: '2030-01-01T11:00:00.000Z' } })
      calls.length = 0
      await expect(bot.at('a').llm(provider, { model: 'm', messages: [] })).rejects.toMatchObject({ unit: 'tokens', detail: { local: true } })
      expect(calls).toEqual(['GET /v1/a'])
      server.setNow(start + 3 * 3600_000)
      await bot.at('a').llm(provider, { model: 'm', messages: [] })
      await expect(bot.at('a').llm(provider, { model: 'm', messages: [] })).rejects.toBeInstanceOf(LimitExceeded)
      await admin.limit('a', { tokens: 1_000_000, per: 'hour' })
      await bot.at('a').llm(provider, { model: 'm', messages: [] })
      expect(provider).toHaveBeenCalledTimes(3)
    } finally {
      server.setNow(Date.now())
    }
  })
  it('reads the budget again once any cached figure reaches its reset time, and not before', async () => {
    const start = Date.UTC(2030, 0, 1, 10, 30)
    const reset = Date.UTC(2030, 0, 1, 11)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(start)
      server.setNow(start)
      const { admin, agent } = await account()
      await admin.limit('a', { tokens: 300, per: 'hour' })
      await admin.limit('a', { emails: 5 })
      const { calls, f } = counting()
      const bot = await agent('a', { fetch: f, prices: { m: { input: 1e-6, output: 1e-6 } } })
      await bot.spend('a', { tokens: 1, emails: 1 })
      expect(bot._internal.remaining.get('a')).toEqual({ tokens: { scope: 'a', left: 299, resets: '2030-01-01T11:00:00.000Z' }, emails: { scope: 'a', left: 4, resets: null } })
      const seen: unknown[] = []
      const provider = async (req: { max_tokens?: number }) => { seen.push(req.max_tokens); return usage(100, 100) }
      calls.length = 0
      await bot.at('a').llm(provider, { model: 'm', max_tokens: 100, messages: [] })
      expect(calls).toEqual(['POST /v1/a', 'POST /v1/a'])
      expect(bot._internal.remaining.get('a')!.tokens.left).toBe(99)
      vi.setSystemTime(reset)
      server.setNow(reset)
      await bot.at('a').llm(provider, { model: 'm', max_tokens: 150, messages: [] })
      expect(seen).toEqual([100, 150])
      expect(calls).toEqual(['POST /v1/a', 'POST /v1/a', 'GET /v1/a', 'POST /v1/a', 'POST /v1/a'])
    } finally {
      vi.useRealTimers()
      server.setNow(Date.now())
    }
  })
  it('reads the budget for every unpriced call, so a usd limit added later refuses it as unknown_price', async () => {
    const { admin, agent } = await account()
    await admin.limit('a', { tokens: 1_000_000 })
    const bot = await agent('a')
    const provider = vi.fn(async () => usage(100_000, 100_000))
    await bot.at('a').llm(provider, { model: 'unpriced', messages: [] })
    expect(bot._internal.remaining.get('a')).toHaveProperty('tokens')
    await admin.limit('a', { usd: 0.000001 })
    await expect(bot.at('a').llm(provider, { model: 'unpriced', messages: [] })).rejects.toMatchObject({ status: 0, code: 'unknown_price' })
    expect(provider).toHaveBeenCalledTimes(1)
    expect((await admin.get('a')).limits.find((l) => l.unit === 'usd')!.used).toBe(0)
  })
  it('fails closed when the budget read is down and nothing is cached', async () => {
    const { agent } = await account()
    const bot = await agent('a', { fetch: () => Promise.reject(new TypeError('fetch failed')) })
    await expect(bot.at('a').llm(vi.fn(), { model: 'm', messages: [] })).rejects.toBeInstanceOf(SolenoidUnavailable)
  })
})
