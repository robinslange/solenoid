import { describe, expect, it, vi } from 'vitest'
import { LimitExceeded, Outage, SolenoidError, SolenoidUnavailable, solenoid } from '../src/index'

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const OK = (remaining = {}, on_outage = 'open', warnings: unknown[] = []) => ({ receipt: { id: 'rcp_1' }, remaining, on_outage, warnings })
const mapStore = (m: Map<string, 'open' | 'closed'>) => ({ get: (s: string) => m.get(s), set: (s: string, v: 'open' | 'closed') => void m.set(s, v) })
const down = () => vi.fn().mockRejectedValue(new TypeError('network'))
const stalled = () => new Response(new ReadableStream({ start: (c) => c.error(new TypeError('network')) }), { status: 200 })

describe('transport', () => {
  it('retries a keyed spend once with the same idempotency key', async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(res(200, OK()))
    await solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).spend('a', { n: 1 })
    const keys = f.mock.calls.map((c) => (c[1].headers as Record<string, string>)['idempotency-key'])
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })
  it('never retries a PUT, so a rotation cannot happen twice', async () => {
    const f = down()
    await expect(solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).rotate('a')).rejects.toThrow()
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('fails closed during an outage when nothing is cached, and open when the scope said so', async () => {
    const m = new Map<string, 'open' | 'closed'>()
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: down(), store: mapStore(m) })
    await expect(sol.spend('a', { n: 1 })).rejects.toBeInstanceOf(SolenoidUnavailable)
    m.set('a', 'open')
    expect(await sol.spend('a', { n: 1 })).toBeNull()
  })
  it("inherits the nearest ancestor's cached mode for a scope it has never seen", async () => {
    const m = new Map<string, 'open' | 'closed'>([['learning-loop/research', 'open']])
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: down(), store: mapStore(m) })
    expect(await sol.spend('learning-loop/research/new-session', { n: 1 })).toBeNull()
  })
  it("caches the mode at the limit's scope, so sibling scopes inherit it", async () => {
    const m = new Map<string, 'open' | 'closed'>()
    const f = vi.fn().mockResolvedValueOnce(res(200, OK({ n: { scope: 'a', left: 5, resets: null } }))).mockRejectedValue(new TypeError('network'))
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f, store: mapStore(m) })
    await sol.spend('a/one', { n: 1 })
    expect(await sol.spend('a/two', { n: 1 })).toBeNull()
  })
  it('turns 402 into LimitExceeded and never treats a 4xx as an outage', async () => {
    const f = vi.fn().mockResolvedValue(res(402, { error: 'limit_exceeded', scope: 'a', unit: 'n', resets: null }))
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f, store: { get: () => 'open', set: () => {} } })
    const e = await sol.spend('a', { n: 1 }).catch((x) => x)
    expect(e).toBeInstanceOf(LimitExceeded)
    expect(e.scope).toBe('a')
    expect(f).toHaveBeenCalledTimes(1)
  })
  it.each(['acme/..', 'acme/%2e%2e', 'Acme', 'a//b'])('refuses the scope %s before making any request', async (scope) => {
    const f = vi.fn()
    await expect(solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).spend(scope, { n: 1 })).rejects.toBeInstanceOf(TypeError)
    expect(f).not.toHaveBeenCalled()
  })
  it('passes warnings to onWarn', async () => {
    const onWarn = vi.fn()
    const w = [{ scope: 'a', unit: 'usd', used: 8, limit: 10 }]
    await solenoid({ key: 'sk.x', api: 'http://x', fetch: vi.fn().mockResolvedValue(res(200, OK({}, 'closed', w))), onWarn }).spend('a', { usd: 1 })
    expect(onWarn).toHaveBeenCalledWith(w)
  })
  it('retries a keyed spend when a 2xx body read aborts mid-stream, instead of treating the abort as an empty success', async () => {
    const f = vi.fn().mockResolvedValueOnce(stalled()).mockResolvedValueOnce(res(200, OK()))
    await solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).spend('a', { n: 1 })
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('treats a body-read abort on a 2xx as an outage: open when cached, SolenoidUnavailable when not', async () => {
    const m = new Map<string, 'open' | 'closed'>([['a', 'open']])
    const open = solenoid({ key: 'sk.x', api: 'http://x', fetch: vi.fn().mockResolvedValue(stalled()), store: mapStore(m) })
    expect(await open.spend('a', { n: 1 })).toBeNull()
    const closed = solenoid({ key: 'sk.x', api: 'http://x', fetch: vi.fn().mockResolvedValue(stalled()) })
    await expect(closed.spend('a', { n: 1 })).rejects.toBeInstanceOf(SolenoidUnavailable)
  })
  it("merges a spend's remaining cache into what's already cached for the scope, instead of replacing it", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res(200, OK({ tokens: { scope: 'a', left: 10, resets: null } })))
      .mockResolvedValueOnce(res(200, OK({ emails: { scope: 'a', left: 2, resets: null } })))
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f })
    await sol.spend('a', { tokens: 1 })
    await sol.spend('a', { emails: 1 })
    expect(sol._internal.remaining.get('a')).toEqual({
      tokens: { scope: 'a', left: 10, resets: null },
      emails: { scope: 'a', left: 2, resets: null },
    })
  })
})

describe('well-known keys', () => {
  it('does not cache a failed fetch forever: a later verify recovers once the network does', async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(res(200, { keys: { k1: { kty: 'OKP' } } }))
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f })
    const receipt = {
      id: 'rcp_1', seq: 1, kind: 'spend', scope: 'a', body: {}, at: new Date().toISOString(),
      kid: 'k1', prev: '0'.repeat(64), hash: '1'.repeat(64), sig: 'AA', replay: false,
    } as unknown as Parameters<ReturnType<typeof solenoid>['verify']>[0]
    await expect(sol.verify(receipt)).rejects.toThrow()
    await expect(sol.verify(receipt)).resolves.toBe(false)
    expect(f).toHaveBeenCalledTimes(2)
  })
})

describe('transport branches', () => {
  const view = { scope: 'a', epoch: 0, limits: [], children: [], entries: [], next: null }
  const hangs = () => vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))))
  const failure = (p: Promise<unknown>) => p.then(() => { throw new Error('expected a rejection') }, (e: Error & { cause?: Error & { cause?: Error } }) => e)

  it('gives up on a request that outlives timeoutMs, retrying a GET once', async () => {
    const f = hangs()
    const e = await failure(solenoid({ key: 'sk.x', api: 'http://x', fetch: f as unknown as typeof fetch, timeoutMs: 20 }).get('a'))
    expect(e).toBeInstanceOf(Outage)
    expect(e.message).toBe('solenoid unreachable')
    expect(e.cause).toBeInstanceOf(DOMException)
    expect(e.cause!.name).toBe('TimeoutError')
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('does not retry a timed-out PUT, and says why', async () => {
    const f = hangs()
    const e = await failure(solenoid({ key: 'sk.x', api: 'http://x', fetch: f as unknown as typeof fetch, timeoutMs: 20 }).limit('a', { n: 1 }))
    expect(e).toBeInstanceOf(Outage)
    expect(e.message).toBe('request failed and is not safe to retry')
    expect(e.cause!.name).toBe('TimeoutError')
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('treats an aborted request as transient', async () => {
    const f = vi.fn().mockRejectedValueOnce(new DOMException('aborted', 'AbortError')).mockResolvedValueOnce(res(200, view))
    expect(await solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).get('a')).toEqual(view)
  })
  it('passes any other DOMException through untouched', async () => {
    const odd = new DOMException('nope', 'NotSupportedError')
    const e = await failure(solenoid({ key: 'sk.x', api: 'http://x', fetch: vi.fn().mockRejectedValue(odd) }).get('a'))
    expect(e).toBe(odd)
  })
  it('retries a GET once after a network error', async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(res(200, view))
    expect(await solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).get('a')).toEqual(view)
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('reports a 4xx on the retry as the refusal it is, not as an outage', async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(res(403, { error: 'out_of_scope' }))
    const e = await failure(solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).get('a'))
    expect(e).toBeInstanceOf(SolenoidError)
    expect(e).toMatchObject({ status: 403, code: 'out_of_scope' })
  })
  it.each([500, 502, 503])('treats a %i as an outage, even with a body that is not JSON', async (status) => {
    const f = vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status }))
    const e = await failure(solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).get('a'))
    expect(e).toBeInstanceOf(Outage)
    expect(e.cause).toBeInstanceOf(Outage)
    expect(e.cause!.message).toBe(`HTTP ${status}`)
    expect(f).toHaveBeenCalledTimes(2)
    const closed = await failure(solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).spend('a', { n: 1 }))
    expect(closed).toBeInstanceOf(SolenoidUnavailable)
  })
  it('treats a 502 email_failed as the refusal it is, not as an outage, and never retries it', async () => {
    const f = vi.fn().mockResolvedValue(res(502, { error: 'email_failed' }))
    const e = await failure(solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).get('a'))
    expect(e).toBeInstanceOf(SolenoidError)
    expect(e).toMatchObject({ status: 502, code: 'email_failed' })
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('treats a 503 billing_unavailable as a refusal, not an outage, and never retries it', async () => {
    const f = vi.fn().mockResolvedValue(res(503, { error: 'billing_unavailable' }))
    const e = await failure(solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).get('a'))
    expect(e).toBeInstanceOf(SolenoidError)
    expect(e).toMatchObject({ status: 503, code: 'billing_unavailable' })
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('never retries a 4xx GET, and names a 4xx with no JSON body "unknown"', async () => {
    const f = vi.fn().mockResolvedValue(new Response('not json', { status: 404 }))
    const e = await failure(solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).get('a'))
    expect(e).toMatchObject({ status: 404, code: 'unknown' })
    expect(e).not.toBeInstanceOf(LimitExceeded)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('throws the raw SyntaxError when a 2xx body is not JSON, without retrying', async () => {
    const f = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }))
    const e = await failure(solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).spend('a', { n: 1 }))
    expect(e).toBeInstanceOf(SyntaxError)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('sends the key, a JSON content type, the idempotency key only when there is one, and no body on a GET', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(200, OK())).mockResolvedValueOnce(res(200, view))
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f })
    await sol.spend('a', { n: 1 }, { idempotencyKey: 'k-1' })
    await sol.get('a')
    const [[postUrl, post], [getUrl, get]] = f.mock.calls as [string, RequestInit][]
    expect([postUrl, post.method, post.body, post.headers]).toEqual(['http://x/v1/a', 'POST', '{"n":1}', { authorization: 'Bearer sk.x', 'content-type': 'application/json', 'idempotency-key': 'k-1' }])
    expect([getUrl, get.method, get.body, get.headers]).toEqual(['http://x/v1/a', 'GET', undefined, { authorization: 'Bearer sk.x', 'content-type': 'application/json' }])
  })
})
