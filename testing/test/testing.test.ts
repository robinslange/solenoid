import { describe, expect, it, vi } from 'vitest'
import { scenarios } from '../../contract/scenarios'
import { SolenoidUnavailable, solenoid } from '../../sdk/src/index'
import { testServer } from '../src/index'

describe('contract scenarios against testServer()', () => {
  for (const s of scenarios) it(s.name, async () => s.run(await testServer()))
})

describe('testServer()', () => {
  it('mints a distinct tenant and a working admin key on every signup', async () => {
    const server = await testServer()
    const a = await server.signup()
    const b = await server.signup()
    expect(a.tenant).toMatch(/^[a-z2-7]{12}$/)
    expect(a.admin_key).toMatch(new RegExp(`^sk\\.admin\\.${a.tenant}\\.1\\.[0-9a-f]{64}$`))
    expect(b.tenant).not.toBe(a.tenant)
    const view = await solenoid({ key: a.admin_key, api: server.api, fetch: server.fetch }).get('')
    expect(view).toMatchObject({ scope: '', epoch: 0, entries: [] })
  })
  it('keeps each server and each tenant apart', async () => {
    const one = await testServer()
    const two = await testServer()
    const { admin_key } = await one.signup()
    await expect(solenoid({ key: admin_key, api: two.api, fetch: two.fetch }).get('')).rejects.toMatchObject({ status: 401, code: 'invalid_key' })
  })
  it('stamps receipts with the clock set by setNow', async () => {
    const server = await testServer()
    server.setNow(Date.UTC(2031, 5, 1))
    const { admin_key } = await server.signup()
    const r = await solenoid({ key: admin_key, api: server.api, fetch: server.fetch }).spend('a', { n: 1 })
    expect(r!.at).toBe('2031-06-01T00:00:00.000Z')
  })
  it('rejects every request like a network failure while outage is on, and recovers when it is off', async () => {
    const server = await testServer()
    const { admin_key } = await server.signup()
    const client = solenoid({ key: admin_key, api: server.api, fetch: server.fetch })
    server.outage(true)
    await expect(server.fetch(`${server.api}/.well-known/solenoid.json`)).rejects.toThrow(new TypeError('fetch failed'))
    await expect(client.spend('a', { n: 1 })).rejects.toBeInstanceOf(SolenoidUnavailable)
    server.outage(false)
    expect(await client.spend('a', { n: 1 })).not.toBeNull()
  })
  it('publishes the public half of its signing key, and nothing private', async () => {
    const server = await testServer()
    const { keys } = (await (await server.fetch(`${server.api}/.well-known/solenoid.json`)).json()) as { keys: Record<string, JsonWebKey> }
    expect(Object.keys(keys)).toEqual(['k1'])
    expect(keys.k1).toEqual({ kty: 'OKP', crv: 'Ed25519', x: expect.any(String) })
  })
  it('serves the published keys with a query string on the URL too, as a cache-busting refetch sends', async () => {
    const server = await testServer()
    const plain = await (await server.fetch(`${server.api}/.well-known/solenoid.json`)).json()
    const res = await server.fetch(`${server.api}/.well-known/solenoid.json?t=${Date.now()}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(plain)
  })
  it('answers HTTP errors the way the Worker does', async () => {
    const server = await testServer()
    const res = await server.fetch(`${server.api}/v1/a`, { method: 'POST', body: '{}' })
    expect([res.status, await res.json()]).toEqual([401, { error: 'invalid_key' }])
    expect((await server.fetch(`${server.api}/nope`)).status).toBe(404)
  })
  it('rotates the admin key once when the same recovery code arrives twice at once', async () => {
    const server = await testServer()
    const post = (path: string, body: unknown, key?: string) => server.fetch(`${server.api}${path}`, { method: 'POST', headers: key ? { authorization: `Bearer ${key}` } : {}, body: JSON.stringify(body) })
    const { tenant, admin_key } = await server.signup()
    const last = async () => /\b(\d{6})\b/.exec((await server.outbox()).at(-1)!.text)![1]
    await post('/auth/email', { email: 'a@b.cd' }, admin_key)
    await post('/auth/email', { email: 'a@b.cd', code: await last() }, admin_key)
    await post('/auth/recover', { tenant, email: 'a@b.cd' })
    const code = await last()
    const both = await Promise.all([1, 2].map(() => post('/auth/recover', { tenant, email: 'a@b.cd', code, rotate: true })))
    expect(both.map((r) => r.status).sort()).toEqual([200, 400])
    const ok = (await both.find((r) => r.status === 200)!.json()) as { admin_key: string }
    expect(ok.admin_key.split('.')[3]).toBe('2')
  })
  it('seals two concurrent recoveries with different codes one after the other', async () => {
    const server = await testServer()
    const post = (path: string, body: unknown, key?: string) => server.fetch(`${server.api}${path}`, { method: 'POST', headers: key ? { authorization: `Bearer ${key}` } : {}, body: JSON.stringify(body) })
    const { tenant, admin_key } = await server.signup()
    const codes = async () => (await server.outbox()).flatMap((m) => /\b(\d{6})\b/.exec(m.text)?.slice(1) ?? [])
    await post('/auth/email', { email: 'a@b.cd' }, admin_key)
    await post('/auth/email', { email: 'a@b.cd', code: (await codes()).at(-1) }, admin_key)
    await post('/auth/recover', { tenant, email: 'a@b.cd' })
    await post('/auth/recover', { tenant, email: 'a@b.cd' })
    const both = await Promise.all((await codes()).slice(-2).map((code) => post('/auth/recover', { tenant, email: 'a@b.cd', code, rotate: true })))
    expect(both.map((r) => r.status)).toEqual([200, 200])
    const gens = await Promise.all(both.map(async (r) => ((await r.json()) as { admin_key: string }).admin_key.split('.')[3]))
    expect(gens.sort()).toEqual(['2', '3'])
  })
  it('fails the code send with email_failed while mail is down, and sends again once it is back', async () => {
    const server = await testServer()
    const { admin_key } = await server.signup()
    const post = () => server.fetch(`${server.api}/auth/email`, { method: 'POST', headers: { authorization: `Bearer ${admin_key}` }, body: JSON.stringify({ email: 'a@b.cd' }) })
    server.mailDown(true)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const down = await post()
    expect([down.status, await down.json()]).toEqual([502, { error: 'email_failed' }])
    expect(logged).toHaveBeenCalledWith(new Error('mail is down'))
    logged.mockRestore()
    expect(await server.outbox()).toEqual([])
    server.mailDown(false)
    expect((await post()).status).toBe(202)
    expect((await server.outbox()).map((m) => m.to)).toEqual(['a@b.cd'])
  })
})
