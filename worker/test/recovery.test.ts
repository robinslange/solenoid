import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { Auth } from '../src/auth'
import type { Receipt } from '../src/core'
import type { Result } from '../src/errors'
import type { TenantDO } from '../src/tenant'
import { ADMIN, setNow, spend, tenant, type Stub } from './helpers'

const SPEND: Auth = { kind: 'spend', gen: 1, epoch: 0, keyScope: 'acme' }
const EMAIL = 'robin@example.com'
const T0 = Date.UTC(2026, 8, 28, 10)
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const wrongFor = (c: string) => (c === '000000' ? '000001' : '000000')
const wrongForAll = (...cs: string[]) => ['000000', '000001', '000002', '000003'].find((w) => !cs.includes(w))!
const failEvents = (stub: Stub) =>
  runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => s.storage.sql.exec("SELECT count(*) AS n FROM code_events WHERE kind = 'fail'").toArray()[0].n as number)
const entries = (stub: Stub) =>
  runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => s.storage.sql.exec('SELECT count(*) AS n FROM entries').toArray()[0].n as number)
const meta = (stub: Stub, k: string) =>
  runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => s.storage.sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray()[0]?.v as string | undefined)

async function code(r: Promise<unknown>): Promise<string> {
  const x = (await r) as Result<{ code: string | null }>
  if (!x.ok || !x.value.code) throw new Error(`no code: ${JSON.stringify(x)}`)
  return x.value.code
}

async function attached(stub: Stub, email = EMAIL) {
  const c = await code(stub.attachStart(ADMIN, email))
  const r = await stub.attachVerify(ADMIN, email, c, false)
  if (!r.ok) throw new Error(`attach failed: ${r.error}`)
  return r.value
}

describe('attaching a recovery email', () => {
  it('needs the admin key and a current generation', async () => {
    const stub = await tenant()
    expect(await stub.attachStart(SPEND, EMAIL)).toMatchObject({ ok: false, status: 403, error: 'admin_required' })
    expect(await stub.attachStart({ ...ADMIN, gen: 2 }, EMAIL)).toMatchObject({ ok: false, status: 401, error: 'invalid_key' })
    expect(await stub.attachVerify(SPEND, EMAIL, '000000', false)).toMatchObject({ ok: false, status: 403, error: 'admin_required' })
  })

  it('attaches only with the right code, once, and reports the address it replaced', async () => {
    const stub = await tenant()
    const c = await code(stub.attachStart(ADMIN, EMAIL))
    expect(c).toMatch(/^[0-9]{6}$/)
    expect(await stub.attachVerify(ADMIN, EMAIL, wrongFor(c), false)).toMatchObject({ ok: false, status: 400, error: 'invalid_code' })
    expect(await stub.attachVerify(ADMIN, 'other@example.com', c, false)).toMatchObject({ ok: false, error: 'invalid_code' })
    expect(await stub.attachVerify(ADMIN, EMAIL, c, false)).toEqual({ ok: true, value: { email: EMAIL, previous: null, gen: 1 } })
    expect(await stub.attachVerify(ADMIN, EMAIL, c, false)).toMatchObject({ ok: false, error: 'invalid_code' })
    expect(await attached(stub, EMAIL)).toEqual({ email: EMAIL, previous: null, gen: 1 })
    expect(await attached(stub, 'new@example.com')).toEqual({ email: 'new@example.com', previous: EMAIL, gen: 1 })
    expect(await meta(stub, 'recovery_email')).toBe('new@example.com')
    expect(await entries(stub)).toBe(0)
    expect(await meta(stub, 'gen')).toBe('1')
  })

  it('prunes expired codes and day-old events on every send and every redemption', async () => {
    const stub = await tenant()
    const rows = () => runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => ({
      events: s.storage.sql.exec('SELECT kind, at FROM code_events ORDER BY rowid').toArray(),
      codes: s.storage.sql.exec('SELECT email FROM codes ORDER BY rowid').toArray(),
    }))
    await setNow(stub, T0)
    await code(stub.attachStart(ADMIN, EMAIL))
    await setNow(stub, T0 + 1)
    await stub.attachVerify(ADMIN, 'other@example.com', '000000', false)
    await setNow(stub, T0 + DAY)
    await code(stub.attachStart(ADMIN, 'other@example.com'))
    expect(await rows()).toEqual({ events: [{ kind: 'fail', at: T0 + 1 }, { kind: 'send', at: T0 + DAY }], codes: [{ email: 'other@example.com' }] })
    await setNow(stub, T0 + DAY + 15 * 60_000)
    await stub.attachVerify(ADMIN, 'other@example.com', '000000', false)
    expect(await rows()).toEqual({ events: [{ kind: 'send', at: T0 + DAY }, { kind: 'fail', at: T0 + DAY + 15 * 60_000 }], codes: [] })
  })

  it('accepts a code up to 15 minutes old, and not at 15 minutes', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    const c = await code(stub.attachStart(ADMIN, EMAIL))
    await setNow(stub, T0 + 15 * 60_000 - 1)
    expect(await stub.attachVerify(ADMIN, EMAIL, c, false)).toMatchObject({ ok: true })
    await setNow(stub, T0)
    const d = await code(stub.attachStart(ADMIN, EMAIL))
    await setNow(stub, T0 + 15 * 60_000)
    expect(await stub.attachVerify(ADMIN, EMAIL, d, false)).toMatchObject({ ok: false, error: 'invalid_code' })
  })

  it('keeps the three newest codes valid', async () => {
    const stub = await tenant()
    const [c1, c2, c3, c4] = [await code(stub.attachStart(ADMIN, EMAIL)), await code(stub.attachStart(ADMIN, EMAIL)), await code(stub.attachStart(ADMIN, EMAIL)), await code(stub.attachStart(ADMIN, EMAIL))]
    expect(await stub.attachVerify(ADMIN, EMAIL, c2, false)).toMatchObject({ ok: true })
    expect(await stub.attachVerify(ADMIN, EMAIL, c4, false)).toMatchObject({ ok: true })
    expect(await stub.attachVerify(ADMIN, EMAIL, c3, false)).toMatchObject({ ok: true })
    if (![c2, c3, c4].includes(c1)) expect(await stub.attachVerify(ADMIN, EMAIL, c1, false)).toMatchObject({ ok: false, error: 'invalid_code' })
  })

  it('stops accepting any code after 5 wrong tries in an hour or 10 in a day', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    const c = await code(stub.attachStart(ADMIN, EMAIL))
    for (let i = 0; i < 5; i++) expect(await stub.attachVerify(ADMIN, EMAIL, wrongFor(c), false)).toMatchObject({ ok: false })
    expect(await stub.attachVerify(ADMIN, EMAIL, c, false)).toMatchObject({ ok: false, error: 'invalid_code' })
    await setNow(stub, T0 + HOUR)
    const d = await code(stub.attachStart(ADMIN, EMAIL))
    for (let i = 0; i < 4; i++) expect(await stub.attachVerify(ADMIN, EMAIL, wrongFor(d), false)).toMatchObject({ ok: false })
    expect(await stub.attachVerify(ADMIN, EMAIL, d, false)).toMatchObject({ ok: true })
    await setNow(stub, T0 + 2 * HOUR)
    const e = await code(stub.attachStart(ADMIN, EMAIL))
    expect(await stub.attachVerify(ADMIN, EMAIL, wrongFor(e), false)).toMatchObject({ ok: false })
    expect(await stub.attachVerify(ADMIN, EMAIL, e, false)).toMatchObject({ ok: false, error: 'invalid_code' })
    await setNow(stub, T0 + DAY + 1)
    const f = await code(stub.attachStart(ADMIN, EMAIL))
    expect(await stub.attachVerify(ADMIN, EMAIL, f, false)).toMatchObject({ ok: true })
  })

  it('checks each of 5 wrong tries in an hour against one live code, then refuses the 6th check, even with the right code', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    const c = await code(stub.attachStart(ADMIN, EMAIL))
    for (let i = 1; i <= 5; i++) {
      expect(await stub.attachVerify(ADMIN, EMAIL, wrongFor(c), false)).toMatchObject({ ok: false })
      expect(await failEvents(stub)).toBe(i)
    }
    expect(await stub.attachVerify(ADMIN, EMAIL, c, false)).toMatchObject({ ok: false, error: 'invalid_code' })
    expect(await failEvents(stub)).toBe(5)
  })

  it('counts a wrong try once for every live code it was checked against', async () => {
    const three = await tenant()
    await setNow(three, T0)
    const cs = [await code(three.attachStart(ADMIN, EMAIL)), await code(three.attachStart(ADMIN, EMAIL)), await code(three.attachStart(ADMIN, EMAIL))]
    expect(await three.attachVerify(ADMIN, EMAIL, wrongForAll(...cs), false)).toMatchObject({ ok: false })
    expect(await failEvents(three)).toBe(3)
    await setNow(three, T0 + 60_000)
    expect(await three.attachVerify(ADMIN, EMAIL, cs[2], false)).toMatchObject({ ok: false, error: 'invalid_code' })
    expect(await failEvents(three)).toBe(3)
    const one = await tenant()
    const c = await code(one.attachStart(ADMIN, EMAIL))
    for (let i = 0; i < 4; i++) expect(await one.attachVerify(ADMIN, EMAIL, wrongFor(c), false)).toMatchObject({ ok: false })
    expect(await one.attachVerify(ADMIN, EMAIL, c, false)).toMatchObject({ ok: true })
  })

  it('never lets the code checks in a day pass 10: at 9, a check against 3 live codes is refused, and against 1 it is made', async () => {
    const stub = await tenant()
    await setNow(stub, T0 - HOUR)
    await attached(stub)
    const threeCodes = async () => [await code(stub.recoverStart(EMAIL)), await code(stub.recoverStart(EMAIL)), await code(stub.recoverStart(EMAIL))]
    await setNow(stub, T0)
    const first = await threeCodes()
    expect(await stub.recoverFinish(EMAIL, wrongForAll(...first), false)).toMatchObject({ ok: false })
    await setNow(stub, T0 + 61 * 60_000)
    const second = await threeCodes()
    expect(await stub.recoverFinish(EMAIL, wrongForAll(...second), false)).toMatchObject({ ok: false })
    await setNow(stub, T0 + 122 * 60_000)
    const third = await threeCodes()
    expect(await stub.recoverFinish(EMAIL, wrongForAll(...third), false)).toMatchObject({ ok: false })
    expect(await failEvents(stub)).toBe(9)
    await setNow(stub, T0 + 183 * 60_000)
    const fourth = await threeCodes()
    expect(await stub.recoverFinish(EMAIL, fourth[2], false)).toMatchObject({ ok: false, error: 'invalid_code' })
    expect(await failEvents(stub)).toBe(9)
    await setNow(stub, T0 + 199 * 60_000)
    const last = await code(stub.recoverStart(EMAIL))
    expect(await stub.recoverFinish(EMAIL, wrongFor(last), false)).toMatchObject({ ok: false })
    expect(await failEvents(stub)).toBe(10)
    expect(await stub.recoverFinish(EMAIL, last, false)).toMatchObject({ ok: false, error: 'invalid_code' })
    expect(await failEvents(stub)).toBe(10)
    await setNow(stub, T0 + 244 * 60_000)
    const good = await code(stub.recoverStart(EMAIL))
    expect(await stub.recoverFinish(EMAIL, good, false)).toMatchObject({ ok: false, error: 'invalid_code' })
    await setNow(stub, T0 + DAY + 61 * 60_000 + 1)
    const after = await code(stub.recoverStart(EMAIL))
    expect(await stub.recoverFinish(EMAIL, after, false)).toMatchObject({ ok: true })
  })

  it('counts a wrong try at least once when no code is live', async () => {
    const stub = await tenant()
    for (let i = 0; i < 5; i++) expect(await stub.attachVerify(ADMIN, EMAIL, '000000', false)).toMatchObject({ ok: false })
    const c = await code(stub.attachStart(ADMIN, EMAIL))
    expect(await stub.attachVerify(ADMIN, EMAIL, c, false)).toMatchObject({ ok: false, error: 'invalid_code' })
  })

  it('locks each purpose on its own failures', async () => {
    const recoverLocked = await tenant()
    await attached(recoverLocked)
    const r = await code(recoverLocked.recoverStart(EMAIL))
    for (let i = 0; i < 5; i++) expect(await recoverLocked.recoverFinish(EMAIL, wrongFor(r), false)).toMatchObject({ ok: false })
    expect(await recoverLocked.recoverFinish(EMAIL, r, false)).toMatchObject({ ok: false, error: 'invalid_code' })
    expect(await attached(recoverLocked)).toEqual({ email: EMAIL, previous: null, gen: 1 })
    const attachLocked = await tenant()
    await attached(attachLocked)
    const a = await code(attachLocked.attachStart(ADMIN, EMAIL))
    for (let i = 0; i < 5; i++) expect(await attachLocked.attachVerify(ADMIN, EMAIL, wrongFor(a), false)).toMatchObject({ ok: false })
    expect(await attachLocked.attachVerify(ADMIN, EMAIL, a, false)).toMatchObject({ ok: false, error: 'invalid_code' })
    const c = await code(attachLocked.recoverStart(EMAIL))
    expect(await attachLocked.recoverFinish(EMAIL, c, false)).toEqual({ ok: true, value: { gen: 1 } })
  })

  it('allows five code requests per email per hour, across both purposes', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    await attached(stub)
    for (let i = 0; i < 2; i++) expect(await stub.attachStart(ADMIN, EMAIL)).toMatchObject({ ok: true })
    for (let i = 0; i < 2; i++) expect(await stub.recoverStart(EMAIL)).toMatchObject({ ok: true })
    expect(await stub.recoverStart(EMAIL)).toMatchObject({ ok: false, status: 429, error: 'rate_limited' })
    expect(await stub.attachStart(ADMIN, EMAIL)).toMatchObject({ ok: false, status: 429 })
    expect(await stub.attachStart(ADMIN, 'other@example.com')).toMatchObject({ ok: true })
    await setNow(stub, T0 + HOUR)
    expect(await stub.attachStart(ADMIN, EMAIL)).toMatchObject({ ok: true })
  })

  it('allows ten attach codes per tenant per day, whatever the addresses', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    for (let i = 0; i < 10; i++) expect(await stub.attachStart(ADMIN, `u${i}@example.com`)).toMatchObject({ ok: true })
    expect(await stub.attachStart(ADMIN, 'u10@example.com')).toMatchObject({ ok: false, status: 429, error: 'rate_limited' })
    expect(await stub.recoverStart(EMAIL)).toEqual({ ok: true, value: { code: null } })
    await setNow(stub, T0 + DAY)
    expect(await stub.attachStart(ADMIN, 'u10@example.com')).toMatchObject({ ok: true })
  })
})

describe('attaching a recovery email and rotating the admin key in one step', () => {
  it('sets the email, bumps the generation and seals one rotate entry that leaves the address off the chain', async () => {
    const stub = await tenant()
    expect((await stub.get(SPEND, 'acme')).ok).toBe(true)
    const c = await code(stub.attachStart(ADMIN, EMAIL))
    expect(await stub.attachVerify(ADMIN, EMAIL, c, true)).toEqual({ ok: true, value: { email: EMAIL, previous: null, gen: 2 } })
    expect(await meta(stub, 'recovery_email')).toBe(EMAIL)
    expect(await meta(stub, 'gen')).toBe('2')
    expect(await meta(stub, 'nonspend_month')).toBe('1')
    expect(await stub.get(ADMIN, '')).toMatchObject({ ok: false, status: 401, error: 'invalid_key' })
    expect(await spend(stub, 'acme', { calls: 1 }, SPEND)).toMatchObject({ ok: false, status: 401, error: 'invalid_key' })
    const v = await stub.get({ ...ADMIN, gen: 2 }, '')
    if (!v.ok) throw new Error('get failed')
    const [rotated, ...rest] = v.value.entries as unknown as Receipt[]
    expect(rotated).toMatchObject({ kind: 'rotate', scope: '', body: { rotate_admin: true, attach: true } })
    expect(Object.keys(rotated.body)).toEqual(['rotate_admin', 'attach'])
    expect(rest).toEqual([])
    const next = await spend(stub, 'a', { calls: 1 }, { ...ADMIN, gen: 2 })
    if (!next.ok) throw new Error('spend failed')
    expect(next.value.receipt).toMatchObject({ seq: rotated.seq + 1, prev: rotated.hash })
  })

  it('changes nothing when the code is wrong', async () => {
    const stub = await tenant()
    await attached(stub)
    const c = await code(stub.attachStart(ADMIN, 'new@example.com'))
    expect(await stub.attachVerify(ADMIN, 'new@example.com', wrongFor(c), true)).toEqual({ ok: false, status: 400, error: 'invalid_code' })
    expect(await meta(stub, 'recovery_email')).toBe(EMAIL)
    expect(await meta(stub, 'gen')).toBe('1')
    expect(await meta(stub, 'month')).toBeUndefined()
    expect(await entries(stub)).toBe(0)
    expect((await stub.get(ADMIN, '')).ok).toBe(true)
  })

  it('refuses the leaked key and keeps the owner\'s email after a rotating attach, whichever of two concurrent attaches runs first', async () => {
    const stub = await tenant()
    await attached(stub)
    const theirs = await code(stub.attachStart(ADMIN, 'thief@example.com'))
    expect(await stub.attachVerify(ADMIN, 'thief@example.com', theirs, false)).toMatchObject({ ok: true })
    const later = await code(stub.attachStart(ADMIN, 'thief@example.com'))
    const mine = await code(stub.attachStart(ADMIN, EMAIL))
    const verify = (email: string, c: string, rotate: boolean) => stub.attachVerify(ADMIN, email, c, rotate) as unknown as Promise<Result<unknown>>
    const [owner] = await Promise.all([verify(EMAIL, mine, true), verify('thief@example.com', later, false)])
    expect(owner).toEqual({ ok: true, value: { email: EMAIL, previous: 'thief@example.com', gen: 2 } })
    expect(await stub.attachVerify(ADMIN, 'thief@example.com', later, false)).toMatchObject({ ok: false, status: 401, error: 'invalid_key' })
    expect(await stub.attachStart(ADMIN, 'thief@example.com')).toMatchObject({ ok: false, status: 401, error: 'invalid_key' })
    expect(await meta(stub, 'recovery_email')).toBe(EMAIL)
    const r = await code(stub.recoverStart(EMAIL))
    expect(await stub.recoverFinish(EMAIL, r, false)).toEqual({ ok: true, value: { gen: 2 } })
  })
})

describe('recovering the admin key', () => {
  it('returns no code for an email that is not the recovery address', async () => {
    const stub = await tenant()
    await attached(stub)
    expect(await stub.recoverStart('stranger@example.com')).toEqual({ ok: true, value: { code: null } })
  })

  it('answers an uninitialised tenant with no code and no rate limit', async () => {
    const empty = env.TENANT.get(env.TENANT.idFromName(crypto.randomUUID()))
    for (let i = 0; i < 6; i++) expect(await empty.recoverStart(EMAIL)).toEqual({ ok: true, value: { code: null } })
    expect(await empty.recoverFinish(EMAIL, '123456', false)).toMatchObject({ ok: false, status: 400, error: 'invalid_code' })
  })

  it('re-derives the current generation without rotating, and rotates once with rotate', async () => {
    const stub = await tenant()
    await attached(stub)
    const c = await code(stub.recoverStart(EMAIL))
    expect(await stub.recoverFinish(EMAIL, wrongFor(c), false)).toEqual({ ok: false, status: 400, error: 'invalid_code' })
    expect(await stub.recoverFinish(EMAIL, c, false)).toEqual({ ok: true, value: { gen: 1 } })
    expect((await stub.get(ADMIN, '')).ok).toBe(true)
    const r = await code(stub.recoverStart(EMAIL))
    expect(await stub.recoverFinish(EMAIL, r, true)).toEqual({ ok: true, value: { gen: 2 } })
    expect(await stub.get(ADMIN, '')).toMatchObject({ ok: false, status: 401, error: 'invalid_key' })
    const v = await stub.get({ ...ADMIN, gen: 2 }, '')
    if (!v.ok) throw new Error('get failed')
    expect(v.value.entries[0]).toMatchObject({ kind: 'rotate', scope: '', body: { rotate_admin: true, recovery: true } })
    expect(await meta(stub, 'nonspend_month')).toBe('1')
    const next = await spend(stub, 'a', { calls: 1 }, { ...ADMIN, gen: 2 })
    if (!next.ok) throw new Error('spend failed')
    expect(next.value.receipt).toMatchObject({ seq: v.value.entries[0].seq + 1, prev: v.value.entries[0].hash })
  })

  it('refuses a recovery code for an email that is no longer the recovery address', async () => {
    const stub = await tenant()
    await attached(stub)
    const c = await code(stub.recoverStart(EMAIL))
    await attached(stub, 'new@example.com')
    expect(await stub.recoverFinish(EMAIL, c, false)).toMatchObject({ ok: false, error: 'invalid_code' })
  })

  it('rotates once when the same code arrives twice at once', async () => {
    const stub = await tenant()
    await attached(stub)
    const c = await code(stub.recoverStart(EMAIL))
    const finish = () => stub.recoverFinish(EMAIL, c, true) as unknown as Promise<Result<{ gen: number }>>
    const both = await Promise.all([finish(), finish()])
    expect(both).toContainEqual({ ok: true, value: { gen: 2 } })
    expect(both).toContainEqual({ ok: false, status: 400, error: 'invalid_code' })
    expect((await stub.get({ ...ADMIN, gen: 2 }, '')).ok).toBe(true)
  })
})
