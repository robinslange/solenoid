import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_SENDS_PER_HOUR } from '../src/codes'
import type { TenantApi } from '../src/core'
import { adminKey, spendKey, verifyKey } from '../src/keys'
import type { Mail } from '../src/mail'
import { handle, type Io } from '../src/router'
import type { TenantDO } from '../src/tenant'

let mails: Mail[] = []
let pending: Promise<unknown>[] = []
let mailDown = false
let neverSend = false
const io: Io = {
  mail: async (m) => {
    if (neverSend) return new Promise(() => {})
    if (mailDown) throw new Error('resend down')
    mails.push(m)
  },
  waitUntil: (p) => { pending.push(p) },
}
const tenantFor = (n: string) => env.TENANT.get(env.TENANT.idFromName(n)) as unknown as TenantApi
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  handle(new Request(`https://api.test${path}`, { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.7', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env, tenantFor, io)
const settled = async () => { await Promise.all(pending); pending = [] }
const codeIn = (m: Mail) => /\b(\d{6})\b/.exec(m.text)![1]

async function account() {
  const { tenant, admin_key } = (await (await post('/auth/signup', {})).json()) as { tenant: string; admin_key: string }
  return { tenant, admin_key, auth: { authorization: `Bearer ${admin_key}` } }
}

async function attach(a: Awaited<ReturnType<typeof account>>, email = 'robin@example.com') {
  expect((await post('/auth/email', { email }, a.auth)).status).toBe(202)
  const c = codeIn(mails.at(-1)!)
  expect((await post('/auth/email', { email, code: c }, a.auth)).status).toBe(200)
}

beforeEach(() => { mails = []; pending = []; mailDown = false; neverSend = false })
afterEach(() => { vi.restoreAllMocks() })

describe('POST /auth/email', () => {
  it('needs an admin key', async () => {
    const a = await account()
    expect((await post('/auth/email', { email: 'a@b.cd' })).status).toBe(401)
    const spend = await spendKey(a.admin_key, 'acme', 0)
    const r = await post('/auth/email', { email: 'a@b.cd' }, { authorization: `Bearer ${spend}` })
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ error: 'admin_required' })
  })

  it('refuses a malformed body, email or code', async () => {
    const a = await account()
    expect(await (await post('/auth/email', 'not json', a.auth)).json()).toEqual({ error: 'invalid_request' })
    for (const b of [[1], null, 1, '"robin@example.com"', true]) {
      const r = await post('/auth/email', typeof b === 'string' ? b : JSON.stringify(b), a.auth)
      expect([r.status, await r.json()]).toEqual([400, { error: 'invalid_request' }])
    }
    expect(await (await post('/auth/email', { email: 'nope' }, a.auth)).json()).toEqual({ error: 'invalid_email' })
    for (const code of ['12345', '1234567', 123456, 'abcdef']) {
      const r = await post('/auth/email', { email: 'a@b.cd', code }, a.auth)
      expect([r.status, await r.json()]).toEqual([400, { error: 'invalid_code' }])
    }
  })

  it('sends a code to the normalized address, attaches it with the code, then confirms by email', async () => {
    const a = await account()
    const r = await post('/auth/email', { email: ' Robin@Example.COM ' }, a.auth)
    expect([r.status, await r.json()]).toEqual([202, { email: 'robin@example.com', status: 'code_sent' }])
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toBe('robin@example.com')
    expect(mails[0].text).toContain(a.tenant)
    const v = await post('/auth/email', { email: 'ROBIN@example.com', code: codeIn(mails[0]) }, a.auth)
    expect([v.status, await v.json()]).toEqual([200, { tenant: a.tenant, email: 'robin@example.com' }])
    await settled()
    expect(mails).toHaveLength(2)
    expect(mails[1].to).toBe('robin@example.com')
    expect(mails[1].text).toContain(a.tenant)
  })

  it('tells the previous address when the recovery email changes, without naming the new one', async () => {
    const a = await account()
    await attach(a)
    await settled()
    mails = []
    await attach(a, 'new@example.com')
    await settled()
    const notice = mails.find((m) => m.to === 'robin@example.com')!
    expect(notice.text).toContain(a.tenant)
    expect(notice.text).not.toContain('new@example.com')
    expect(mails.map((m) => m.to).sort()).toEqual(['new@example.com', 'new@example.com', 'robin@example.com'])
  })

  it('answers 502 when the send fails, attaches nothing, and works on the next request', async () => {
    const a = await account()
    mailDown = true
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await post('/auth/email', { email: 'robin@example.com' }, a.auth)
    expect([r.status, await r.json()]).toEqual([502, { error: 'email_failed' }])
    expect(logged).toHaveBeenCalledWith(new Error('resend down'))
    mailDown = false
    expect((await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com' })).status).toBe(202)
    await settled()
    expect(mails).toHaveLength(0)
    await attach(a)
  })

  it('refuses the right code sent as anything but a string, on both routes', async () => {
    const a = await account()
    await post('/auth/email', { email: 'robin@example.com' }, a.auth)
    const r = await post('/auth/email', { email: 'robin@example.com', code: [codeIn(mails[0])] }, a.auth)
    expect([r.status, await r.json()]).toEqual([400, { error: 'invalid_code' }])
    expect((await post('/auth/email', { email: 'robin@example.com', code: codeIn(mails[0]) }, a.auth)).status).toBe(200)
    await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com' })
    await settled()
    const code = codeIn(mails.at(-1)!)
    const rec = await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com', code: [code] })
    expect([rec.status, await rec.json()]).toEqual([400, { error: 'invalid_code' }])
    expect((await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com', code })).status).toBe(200)
  })

  it('refuses a wrong code and attaches nothing', async () => {
    const a = await account()
    await post('/auth/email', { email: 'robin@example.com' }, a.auth)
    const wrong = String((Number(codeIn(mails[0])) + 1) % 1_000_000).padStart(6, '0')
    const r = await post('/auth/email', { email: 'robin@example.com', code: wrong }, a.auth)
    expect([r.status, await r.json()]).toEqual([400, { error: 'invalid_code' }])
    await settled()
    expect(mails).toHaveLength(1)
    await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com' })
    await settled()
    expect(mails).toHaveLength(1)
  })

  it('attaches even when the confirmation send fails after the answer', async () => {
    const a = await account()
    await post('/auth/email', { email: 'robin@example.com' }, a.auth)
    mailDown = true
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await post('/auth/email', { email: 'robin@example.com', code: codeIn(mails[0]) }, a.auth)
    expect([r.status, await r.json()]).toEqual([200, { tenant: a.tenant, email: 'robin@example.com' }])
    await settled()
    expect(logged).toHaveBeenCalledWith(new Error('resend down'))
    mailDown = false
    await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com' })
    await settled()
    expect(mails.map((m) => m.to)).toEqual(['robin@example.com', 'robin@example.com'])
  })

  it('refuses a non-boolean rotate on both branches before sending anything, and ignores a boolean one on the send', async () => {
    const a = await account()
    for (const b of [{ rotate: 'yes' }, { rotate: 1 }, { rotate: null }, { code: '123456', rotate: 'yes' }]) {
      const r = await post('/auth/email', { email: 'robin@example.com', ...b }, a.auth)
      expect([r.status, await r.json()]).toEqual([400, { error: 'invalid_request', field: 'rotate' }])
    }
    expect(mails).toHaveLength(0)
    for (const rotate of [true, false]) {
      const r = await post('/auth/email', { email: 'robin@example.com', rotate }, a.auth)
      expect([r.status, await r.json()]).toEqual([202, { email: 'robin@example.com', status: 'code_sent' }])
    }
    const v = await post('/auth/email', { email: 'robin@example.com', code: codeIn(mails[1]), rotate: false }, a.auth)
    expect([v.status, await v.json()]).toEqual([200, { tenant: a.tenant, email: 'robin@example.com' }])
  })

  it('attaches and returns a new admin key with rotate, and the old admin and spend keys stop working', async () => {
    const a = await account()
    await attach(a, 'thief@example.com')
    await settled()
    mails = []
    const spend = await spendKey(a.admin_key, 'acme', 0)
    await post('/auth/email', { email: 'robin@example.com' }, a.auth)
    const denied = await post('/auth/email', { email: 'robin@example.com', code: codeIn(mails[0]), rotate: true }, { authorization: `Bearer ${spend}` })
    expect([denied.status, await denied.json()]).toEqual([403, { error: 'admin_required' }])
    const r = await post('/auth/email', { email: 'robin@example.com', code: codeIn(mails[0]), rotate: true }, a.auth)
    const newKey = await adminKey(env.MASTER, a.tenant, 2)
    expect([r.status, await r.json()]).toEqual([200, { tenant: a.tenant, email: 'robin@example.com', admin_key: newKey }])
    await settled()
    expect(mails.map((m) => m.to).sort()).toEqual(['robin@example.com', 'robin@example.com', 'thief@example.com'])
    const get = (key: string) => handle(new Request('https://api.test/v1/', { headers: { authorization: `Bearer ${key}` } }), env, tenantFor, io)
    expect((await get(newKey)).status).toBe(200)
    expect((await get(a.admin_key)).status).toBe(401)
    expect((await get(spend)).status).toBe(401)
    for (const b of [{ email: 'thief@example.com' }, { email: 'thief@example.com', code: '123456' }]) {
      const again = await post('/auth/email', b, a.auth)
      expect([again.status, await again.json()]).toEqual([401, { error: 'invalid_key' }])
    }
  })

  it('answers 429 on the sixth code request for one email in an hour', async () => {
    const a = await account()
    for (let i = 0; i < 5; i++) expect((await post('/auth/email', { email: 'robin@example.com' }, a.auth)).status).toBe(202)
    const r = await post('/auth/email', { email: 'robin@example.com' }, a.auth)
    expect([r.status, await r.json()]).toEqual([429, { error: 'rate_limited' }])
  })
})

describe('POST /auth/recover', () => {
  it('answers the same 202 whether or not the email matches, without waiting for the send', async () => {
    const a = await account()
    await attach(a)
    await settled()
    mails = []
    neverSend = true
    const match = await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com' })
    const other = await post('/auth/recover', { tenant: a.tenant, email: 'stranger@example.com' })
    expect([match.status, await match.json()]).toEqual([202, { status: 'accepted' }])
    expect([other.status, await other.json()]).toEqual([202, { status: 'accepted' }])
    expect(pending).toHaveLength(1)
  })

  it('answers the same 202 after the per-email send limit is spent, and stops mailing', async () => {
    const a = await account()
    await attach(a)
    await settled()
    mails = []
    const answers: [number, string][] = []
    for (let i = 0; i < 6; i++) {
      const r = await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com' })
      answers.push([r.status, await r.text()])
    }
    await settled()
    expect(answers).toEqual(Array(6).fill([202, JSON.stringify({ status: 'accepted' })]))
    expect(mails.map((m) => m.to)).toEqual(Array(MAX_SENDS_PER_HOUR - 1).fill('robin@example.com'))
  })

  it('mails a code only to the recovery address', async () => {
    const a = await account()
    await attach(a)
    mails = []
    await post('/auth/recover', { tenant: a.tenant, email: 'stranger@example.com' })
    await post('/auth/recover', { tenant: a.tenant, email: 'Robin@Example.com' })
    await settled()
    expect(mails.map((m) => m.to)).toEqual(['robin@example.com'])
  })

  it('returns the current admin key, or a rotated one that revokes the old', async () => {
    const a = await account()
    await attach(a)
    await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com' })
    await settled()
    const same = await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com', code: codeIn(mails.at(-1)!) })
    expect([same.status, await same.json()]).toEqual([200, { tenant: a.tenant, admin_key: a.admin_key }])
    await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com' })
    await settled()
    const rotated = await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com', code: codeIn(mails.at(-1)!), rotate: true })
    const body = (await rotated.json()) as { admin_key: string }
    expect(body.admin_key).toBe(await adminKey(env.MASTER, a.tenant, 2))
    const old = await handle(new Request('https://api.test/v1/', { headers: a.auth }), env, tenantFor, io)
    expect(old.status).toBe(401)
  })

  it('refuses a wrong code, a malformed tenant and a non-boolean rotate', async () => {
    const a = await account()
    await attach(a)
    expect(await (await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com', code: '000000' })).json()).toEqual({ error: 'invalid_code' })
    for (const tenant of ['NOPE', [a.tenant], undefined]) {
      expect(await (await post('/auth/recover', { tenant, email: 'robin@example.com' })).json()).toEqual({ error: 'invalid_request', field: 'tenant' })
    }
    expect(await (await post('/auth/recover', { tenant: a.tenant, email: 'x' })).json()).toEqual({ error: 'invalid_email' })
    for (const b of [{ code: '123456', rotate: 'yes' }, { rotate: 'yes' }, { rotate: 1 }]) {
      const r = await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com', ...b })
      expect([r.status, await r.json()]).toEqual([400, { error: 'invalid_request', field: 'rotate' }])
    }
  })

  it('refuses the old admin key on both /auth/email branches after a rotating recovery', async () => {
    const a = await account()
    await attach(a)
    await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com' })
    await settled()
    const rotated = await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com', code: codeIn(mails.at(-1)!), rotate: true })
    expect(rotated.status).toBe(200)
    for (const b of [{ email: 'new@example.com' }, { email: 'new@example.com', code: '123456' }]) {
      const r = await post('/auth/email', b, a.auth)
      expect([r.status, await r.json()]).toEqual([401, { error: 'invalid_key' }])
    }
  })

  it('answers for the ops tenant without reaching its Durable Object, even when it has a recovery address', async () => {
    const opsAuth = { authorization: `Bearer ${await adminKey(env.MASTER, 'solenoidops2', 1)}` }
    await post('/auth/signup', {}, { 'cf-connecting-ip': '198.51.100.97' })
    expect((await post('/auth/email', { email: 'ops@example.com' }, opsAuth)).status).toBe(202)
    expect((await post('/auth/email', { email: 'ops@example.com', code: codeIn(mails.at(-1)!) }, opsAuth)).status).toBe(200)
    await settled()
    mails = []
    const events = () => runInDurableObject(env.TENANT.get(env.TENANT.idFromName('solenoidops2')), (_i: TenantDO, s: DurableObjectState) =>
      s.storage.sql.exec('SELECT kind, purpose, email FROM code_events ORDER BY rowid').toArray())
    const before = await events()
    const asked = await post('/auth/recover', { tenant: 'solenoidops2', email: 'ops@example.com' })
    expect([asked.status, await asked.json()]).toEqual([202, { status: 'accepted' }])
    for (const b of [{ code: '123456' }, { code: '123456', rotate: true }]) {
      const r = await post('/auth/recover', { tenant: 'solenoidops2', email: 'ops@example.com', ...b })
      expect([r.status, await r.json()]).toEqual([400, { error: 'invalid_code' }])
    }
    await settled()
    expect(mails).toEqual([])
    expect(await events()).toEqual(before)
  })

  it('limits recovery calls per IP through the ops tenant', async () => {
    const ops = await adminKey(env.MASTER, 'solenoidops2', 1)
    await post('/auth/signup', {}, { 'cf-connecting-ip': '198.51.100.99' })
    const put = await handle(new Request('https://api.test/v1/recoveries', { method: 'PUT', headers: { authorization: `Bearer ${ops}` }, body: JSON.stringify({ recoveries: 2, per: 'child-day' }) }), env, tenantFor, io)
    expect(put.status).toBe(200)
    const call = () => post('/auth/recover', { tenant: 'abcdefghijkl', email: 'a@b.cd' }, { 'cf-connecting-ip': '203.0.113.50' })
    expect((await call()).status).toBe(202)
    expect((await call()).status).toBe(202)
    const third = await call()
    expect([third.status, await third.json()]).toEqual([429, { error: 'rate_limited' }])
  })

  it('limits code redemptions per IP too, and spends nothing on a body that is not JSON', async () => {
    const ops = await adminKey(env.MASTER, 'solenoidops2', 1)
    await post('/auth/signup', {}, { 'cf-connecting-ip': '198.51.100.98' })
    const put = await handle(new Request('https://api.test/v1/recoveries', { method: 'PUT', headers: { authorization: `Bearer ${ops}` }, body: JSON.stringify({ recoveries: 2, per: 'child-day' }) }), env, tenantFor, io)
    expect(put.status).toBe(200)
    const from = (ip: string, body: unknown) => post('/auth/recover', body, { 'cf-connecting-ip': ip })
    const junk = await from('203.0.113.60', 'not json')
    expect([junk.status, await junk.json()]).toEqual([400, { error: 'invalid_request' }])
    expect((await from('203.0.113.60', { tenant: 'abcdefghijkl', email: 'a@b.cd' })).status).toBe(202)
    expect((await from('203.0.113.60', { tenant: 'abcdefghijkl', email: 'a@b.cd' })).status).toBe(202)
    const third = await from('203.0.113.60', { tenant: 'abcdefghijkl', email: 'a@b.cd' })
    expect([third.status, await third.json()]).toEqual([429, { error: 'rate_limited' }])
    expect((await from('203.0.113.61', { tenant: 'abcdefghijkl', email: 'a@b.cd' })).status).toBe(202)
    expect((await from('203.0.113.61', { tenant: 'abcdefghijkl', email: 'a@b.cd' })).status).toBe(202)
    const guess = await from('203.0.113.61', { tenant: 'abcdefghijkl', email: 'a@b.cd', code: '000000' })
    expect([guess.status, await guess.json()]).toEqual([429, { error: 'rate_limited' }])
  })
})

describe('the deployed entry', () => {
  it('serves /auth/email and /auth/recover only to POST', async () => {
    for (const path of ['/auth/email', '/auth/recover']) {
      const r = await SELF.fetch(`https://api.test${path}`)
      expect([r.status, await r.json()]).toEqual([404, { error: 'not_found' }])
    }
  })

  it('answers 502 on /auth/email when no Resend key is configured', async () => {
    const signed = (await (await SELF.fetch('https://api.test/auth/signup', { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.123' } })).json()) as { admin_key: string }
    const r = await SELF.fetch('https://api.test/auth/email', { method: 'POST', headers: { authorization: `Bearer ${signed.admin_key}` }, body: JSON.stringify({ email: 'a@b.cd' }) })
    expect([r.status, await r.json()]).toEqual([502, { error: 'email_failed' }])
  })

  it('answers 202 on /auth/recover for the recovery address through the real entry, though the send fails', async () => {
    const signed = (await (await SELF.fetch('https://api.test/auth/signup', { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.125' } })).json()) as { tenant: string; admin_key: string }
    const { auth } = await verifyKey(`Bearer ${signed.admin_key}`, env.MASTER)
    const stub = tenantFor(signed.tenant)
    const started = (await stub.attachStart(auth, 'robin@example.com')) as { ok: true; value: { code: string } }
    expect((await stub.attachVerify(auth, 'robin@example.com', started.value.code, false)).ok).toBe(true)
    const r = await SELF.fetch('https://api.test/auth/recover', { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.125' }, body: JSON.stringify({ tenant: signed.tenant, email: 'robin@example.com' }) })
    expect([r.status, await r.json()]).toEqual([202, { status: 'accepted' }])
  })

  it('answers 202 on /auth/recover through the real entry', async () => {
    const r = await SELF.fetch('https://api.test/auth/recover', { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.124' }, body: JSON.stringify({ tenant: 'abcdefghijkl', email: 'a@b.cd' }) })
    expect([r.status, await r.json()]).toEqual([202, { status: 'accepted' }])
  })
})
