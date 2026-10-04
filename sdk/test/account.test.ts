import { describe, expect, it, vi } from 'vitest'
import { Outage, SolenoidError, recover, requestRecovery, signup, solenoid } from '../src/index'
import { testServer, type Mail } from '../../testing/src/index'

const codeIn = (m: Mail) => /\b(\d{6})\b/.exec(m.text)![1]

async function setup() {
  const server = await testServer()
  const o = { api: server.api, fetch: server.fetch }
  const acct = await signup(o)
  const admin = solenoid({ key: acct.admin_key, api: server.api, fetch: server.fetch })
  return { server, o, acct, admin }
}

describe('account functions', () => {
  it('signs up with an injected fetch, and still takes a bare api string', async () => {
    const { acct } = await setup()
    expect(acct.admin_key).toMatch(/^sk\.admin\./)
    await expect(signup('ftp://nope')).rejects.toThrow(TypeError)
  })

  it('attaches an email with the code from the outbox', async () => {
    const { server, admin, acct } = await setup()
    await admin.sendEmailCode('Robin@Example.com')
    const [m] = await server.outbox()
    expect(m.to).toBe('robin@example.com')
    await expect(admin.verifyEmail('robin@example.com', codeIn(m) === '000000' ? '000001' : '000000')).rejects.toMatchObject({ code: 'invalid_code', status: 400 })
    expect(await admin.verifyEmail('robin@example.com', codeIn(m))).toEqual({ tenant: acct.tenant, email: 'robin@example.com' })
  })

  it('attaches an email and rotates the admin key in one call, revoking the calling key', async () => {
    const { server, admin, acct } = await setup()
    const spender = solenoid({ key: await admin.deriveKey('acme'), api: server.api, fetch: server.fetch })
    await admin.sendEmailCode('robin@example.com')
    const r = await admin.verifyEmail('robin@example.com', codeIn((await server.outbox())[0]), { rotate: true })
    expect(r).toEqual({ tenant: acct.tenant, email: 'robin@example.com', admin_key: expect.stringMatching(/^sk\.admin\./) })
    expect(r.admin_key).not.toBe(acct.admin_key)
    await expect(admin.get('')).rejects.toMatchObject({ code: 'invalid_key' })
    await expect(spender.get('acme')).rejects.toMatchObject({ code: 'invalid_key' })
    expect((await solenoid({ key: r.admin_key!, api: server.api, fetch: server.fetch }).get('')).scope).toBe('')
  })

  it('requests recovery the same way for any email, and recovers or rotates the key', async () => {
    const { server, admin, acct, o } = await setup()
    await admin.sendEmailCode('robin@example.com')
    await admin.verifyEmail('robin@example.com', codeIn((await server.outbox())[0]))
    expect(await requestRecovery(acct.tenant, 'stranger@example.com', o)).toBeUndefined()
    expect(await requestRecovery(acct.tenant, 'robin@example.com', o)).toBeUndefined()
    const box = await server.outbox()
    expect(box.map((m) => m.to)).toEqual(['robin@example.com', 'robin@example.com', 'robin@example.com'])
    expect(await recover(acct.tenant, 'robin@example.com', codeIn(box[2]), o)).toEqual(acct)
    await requestRecovery(acct.tenant, 'robin@example.com', o)
    const rotated = await recover(acct.tenant, 'robin@example.com', codeIn((await server.outbox()).at(-1)!), { ...o, rotate: true })
    expect(rotated.admin_key).not.toBe(acct.admin_key)
    await expect(admin.get('')).rejects.toMatchObject({ code: 'invalid_key' })
  })

  it('surfaces a failed send as email_failed and an unreachable service as Outage', async () => {
    const { server, admin, acct, o } = await setup()
    server.mailDown(true)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(admin.sendEmailCode('robin@example.com')).rejects.toMatchObject({ status: 502, code: 'email_failed' })
    expect(logged).toHaveBeenCalledWith(new Error('mail is down'))
    logged.mockRestore()
    server.mailDown(false)
    server.outage(true)
    const e = await requestRecovery(acct.tenant, 'robin@example.com', o).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(Outage)
    expect(e).toMatchObject({ message: 'solenoid unreachable', cause: expect.any(TypeError) })
    await expect(recover(acct.tenant, 'robin@example.com', '123456', o)).rejects.toBeInstanceOf(Outage)
  })

  it('throws SolenoidError for a refused request', async () => {
    const { acct, o } = await setup()
    await expect(recover(acct.tenant, 'robin@example.com', '123456', o)).rejects.toBeInstanceOf(SolenoidError)
    await expect(requestRecovery('NOPE', 'robin@example.com', o)).rejects.toMatchObject({ code: 'invalid_request' })
  })
})

describe('checkout', () => {
  it('posts to /billing/checkout with the admin key and no idempotency key, and returns the url', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"url":"https://checkout.stripe.test/c/1"}', { status: 200 }))
    expect(await solenoid({ key: 'sk.admin.x', api: 'http://x', fetch: f }).checkout()).toEqual({ url: 'https://checkout.stripe.test/c/1' })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('http://x/billing/checkout')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk.admin.x' })
    expect(init.headers).not.toHaveProperty('idempotency-key')
  })
  it('surfaces 409 already_pro with the portal url, and the test server as 503 billing_unavailable', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"error":"already_pro","portal_url":"https://billing.stripe.test/p/1"}', { status: 409 }))
    await expect(solenoid({ key: 'sk.admin.x', api: 'http://x', fetch: f }).checkout()).rejects.toMatchObject({ status: 409, code: 'already_pro', detail: { portal_url: 'https://billing.stripe.test/p/1' } })
    const { admin } = await setup()
    await expect(admin.checkout()).rejects.toMatchObject({ status: 503, code: 'billing_unavailable' })
  })
})

describe('account functions at the fetch boundary', () => {
  const answer = (status: number, body: string) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, { status }))
  const failure = (p: Promise<unknown>) => p.then(() => { throw new Error('expected a rejection') }, (e: unknown) => e)

  it('posts JSON to /auth/recover, with rotate only when asked', async () => {
    const f = answer(202, '{"status":"accepted"}')
    const o = { api: 'http://x/', fetch: f as unknown as typeof fetch }
    await requestRecovery('abcdefghijkl', 'a@b.cd', o)
    await failure(recover('abcdefghijkl', 'a@b.cd', '123456', o))
    await failure(recover('abcdefghijkl', 'a@b.cd', '123456', { ...o, rotate: true }))
    expect(f.mock.calls.map(([url, init]) => [url, init!.method, init!.headers, init!.body])).toEqual([
      ['http://x/auth/recover', 'POST', { 'content-type': 'application/json' }, '{"tenant":"abcdefghijkl","email":"a@b.cd"}'],
      ['http://x/auth/recover', 'POST', { 'content-type': 'application/json' }, '{"tenant":"abcdefghijkl","email":"a@b.cd","code":"123456"}'],
      ['http://x/auth/recover', 'POST', { 'content-type': 'application/json' }, '{"tenant":"abcdefghijkl","email":"a@b.cd","code":"123456","rotate":true}'],
    ])
  })

  it.each([
    [500, '{"error":"internal"}'],
    [502, '{"error":"bad_gateway"}'],
    [503, '<html>unavailable</html>'],
  ])('treats a %i as an outage, once, without retrying', async (status, body) => {
    const f = answer(status, body)
    const e = await failure(requestRecovery('abcdefghijkl', 'a@b.cd', { api: 'http://x', fetch: f as unknown as typeof fetch }))
    expect(e).toBeInstanceOf(Outage)
    expect((e as Error).message).toBe(`HTTP ${status}`)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('treats a 502 email_failed as a refusal, not an outage', async () => {
    const f = answer(502, '{"error":"email_failed"}')
    const e = await failure(recover('abcdefghijkl', 'a@b.cd', '123456', { api: 'http://x', fetch: f as unknown as typeof fetch }))
    expect(e).toBeInstanceOf(SolenoidError)
    expect(e).toMatchObject({ status: 502, code: 'email_failed' })
  })

  it('wraps a network failure as an Outage and keeps the cause', async () => {
    const cause = new TypeError('network')
    const e = await failure(signup({ api: 'http://x', fetch: vi.fn().mockRejectedValue(cause) }))
    expect(e).toBeInstanceOf(Outage)
    expect(e).toMatchObject({ message: 'solenoid unreachable', cause })
  })

  it('gives the client email calls at least 10 seconds, whatever timeoutMs says, and never retries them', async () => {
    const slow = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((done, fail) => {
      const t = setTimeout(() => done(new Response('{"email":"a@b.cd","status":"code_sent"}', { status: 202 })), 60)
      init.signal!.addEventListener('abort', () => { clearTimeout(t); fail(init.signal!.reason) })
    }))
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: slow as unknown as typeof fetch, timeoutMs: 20 })
    expect(await sol.sendEmailCode('a@b.cd')).toBeUndefined()
    expect(slow.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([['http://x/auth/email', 'POST', '{"email":"a@b.cd"}']])
    const refused = vi.fn().mockResolvedValue(new Response('{"error":"invalid_code"}', { status: 400 }))
    await expect(solenoid({ key: 'sk.x', api: 'http://x', fetch: refused }).verifyEmail('a@b.cd', '123456')).rejects.toMatchObject({ code: 'invalid_code' })
    expect(refused).toHaveBeenCalledTimes(1)
  })

  it('sends rotate on verifyEmail only when asked', async () => {
    const f = vi.fn(async () => new Response('{"tenant":"abcdefghijkl","email":"a@b.cd"}', { status: 200 }))
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f as unknown as typeof fetch })
    await sol.verifyEmail('a@b.cd', '123456')
    await sol.verifyEmail('a@b.cd', '123456', { rotate: false })
    await sol.verifyEmail('a@b.cd', '123456', { rotate: true })
    expect(f.mock.calls.map((c) => (c as unknown as [string, RequestInit])[1].body)).toEqual([
      '{"email":"a@b.cd","code":"123456"}',
      '{"email":"a@b.cd","code":"123456"}',
      '{"email":"a@b.cd","code":"123456","rotate":true}',
    ])
  })
})
