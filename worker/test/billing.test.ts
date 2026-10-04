import { env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantApi } from '../src/core'
import { adminKey, hmacHex, spendKey } from '../src/keys'
import { duplicateMail, type Mail } from '../src/mail'
import { handle, type Io } from '../src/router'
import type { TenantDO } from '../src/tenant'
import { ADMIN, armedFor, limit, setBillable, setNow, spend, u, type Stub } from './helpers'

type Call = { method: string; url: string; form: Record<string, string>; key?: string }
const T0 = Date.UTC(2026, 9, 1, 10)
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'

let calls: Call[] = []
let stripeDown = false
let duplicateStatus = 'active'
let sessions = 0
const stripeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const method = String(init?.method)
  const form = Object.fromEntries(new URLSearchParams(init?.body ? String(init.body) : ''))
  calls.push({ method, url, form, key: new Headers(init?.headers).get('idempotency-key') ?? undefined })
  if (stripeDown) return Response.json({ error: { type: 'api_error' } }, { status: 500 })
  if (url.endsWith('/checkout/sessions')) {
    sessions++
    return Response.json({ id: `cs_${sessions}`, url: `https://checkout.stripe.test/c/${sessions}`, expires_at: Number(form.expires_at) })
  }
  if (url.endsWith('/billing_portal/sessions')) return Response.json({ url: 'https://billing.stripe.test/p/1' })
  if (url.includes('/subscriptions/')) return Response.json({ status: method === 'DELETE' ? 'canceled' : duplicateStatus })
  return Response.json({ object: 'billing.meter_event' })
}) as typeof fetch
let mails: Mail[] = []
let pending: Promise<unknown>[] = []
let noticeDown = false
let codeDown = false
const io: Io = {
  mail: async (m) => {
    if (noticeDown && m.to === 'security@solenoid.systems') throw new Error('resend down')
    if (codeDown && m.to !== 'security@solenoid.systems') throw new Error('resend down')
    mails.push(m)
  },
  waitUntil: (p) => { pending.push(p) },
  stripeFetch,
}
const settled = async () => { await Promise.all(pending); pending = [] }
const tenantFor = (n: string) => env.TENANT.get(env.TENANT.idFromName(n)) as unknown as TenantApi

async function account() {
  const tenant = Array.from({ length: 12 }, () => B32[Math.floor(Math.random() * 32)]).join('')
  const stub = env.TENANT.get(env.TENANT.idFromName(tenant))
  await stub.init(tenant, 'free')
  await runInDurableObject(stub, (i: TenantDO) => { i.stripeFetch = stripeFetch })
  return { tenant, stub, admin: { authorization: `Bearer ${await adminKey(env.MASTER, tenant, 1)}` } }
}
const post = (path: string, body: BodyInit, headers: Record<string, string> = {}, e: object = env) =>
  handle(new Request(`https://api.test${path}`, { method: 'POST', headers, body }), e as typeof env, tenantFor, io)
const checkout = (headers: Record<string, string>, e?: object) => post('/billing/checkout', '', headers, e)
async function webhook(event: unknown, secret = 'whsec_vitest') {
  const body = JSON.stringify(event)
  const t = Math.floor(Date.now() / 1000)
  return post('/billing/stripe', body, { 'stripe-signature': `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}` })
}
const completed = (tenant: string, sub = 'sub_1', email: unknown = ' Buyer@Example.COM ', extra: Record<string, unknown> = {}) => ({
  type: 'checkout.session.completed',
  data: { object: { id: `cs_for_${sub}`, mode: 'subscription', payment_status: 'paid', client_reference_id: tenant, customer: 'cus_1', subscription: sub, customer_details: { email }, ...extra } },
})
const deleted = (tenant: string, sub = 'sub_1', endedAt = Math.floor(Date.now() / 1000)) =>
  ({ type: 'customer.subscription.deleted', data: { object: { id: sub, ended_at: endedAt, metadata: { tenant } } } })
const meta = (stub: Stub, k: string) =>
  runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => s.storage.sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray()[0]?.v as string | undefined)
const head = (stub: Stub) =>
  runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => s.storage.sql.exec('SELECT coalesce(max(seq), 0) AS n FROM entries').one().n as number)
const near = (actual: number | null, expected: number) => {
  expect(actual).not.toBeNull()
  expect(Math.abs(actual! - expected)).toBeLessThan(5_000)
}
const meterCalls = () => calls.filter((c) => c.url.endsWith('/billing/meter_events'))
const sessionCalls = () => calls.filter((c) => c.url.endsWith('/checkout/sessions'))
const route = (c: Call) => `${c.method} ${c.url.replace('https://api.stripe.com/v1', '')}`

beforeEach(() => { calls = []; stripeDown = false; duplicateStatus = 'active'; noticeDown = false; codeDown = false; sessions = 0; mails = []; pending = [] })
afterEach(() => { vi.restoreAllMocks() })

describe('POST /billing/checkout', () => {
  it('answers 503 billing_unavailable while any Stripe value is unset, and calls Stripe for nothing', async () => {
    const { admin } = await account()
    for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_SPENDS', 'STRIPE_PORTAL_CONFIG']) {
      const r = await checkout(admin, { ...env, [k]: undefined })
      expect([r.status, await r.json()]).toEqual([503, { error: 'billing_unavailable' }])
    }
    expect(calls).toEqual([])
  })

  it('answers 404 to anything but POST on either billing route', async () => {
    const { admin } = await account()
    for (const path of ['/billing/checkout', '/billing/stripe']) {
      const r = await handle(new Request(`https://api.test${path}`, { headers: admin }), env, tenantFor, io)
      expect([r.status, await r.json()]).toEqual([404, { error: 'not_found' }])
    }
    expect(calls).toEqual([])
  })

  it('needs the current admin key', async () => {
    const { tenant } = await account()
    expect((await checkout({})).status).toBe(401)
    const spendOnly = await checkout({ authorization: `Bearer ${await spendKey(await adminKey(env.MASTER, tenant, 1), 'acme', 0)}` })
    expect([spendOnly.status, await spendOnly.json()]).toEqual([403, { error: 'admin_required' }])
    expect((await checkout({ authorization: `Bearer ${await adminKey(env.MASTER, tenant, 2)}` })).status).toBe(401)
    expect(calls).toEqual([])
  })

  it('creates a subscription Checkout Session carrying the tenant, with the metered price and no quantity for it, open for an hour', async () => {
    const { tenant, stub, admin } = await account()
    const r = await checkout(admin)
    expect([r.status, await r.json()]).toEqual([200, { url: 'https://checkout.stripe.test/c/1' }])
    expect(calls).toEqual([{
      method: 'POST',
      url: 'https://api.stripe.com/v1/checkout/sessions',
      form: {
        mode: 'subscription',
        'line_items[0][price]': 'price_pro', 'line_items[0][quantity]': '1',
        'line_items[1][price]': 'price_spends',
        client_reference_id: tenant, 'subscription_data[metadata][tenant]': tenant,
        success_url: 'https://solenoid.systems/pricing', cancel_url: 'https://solenoid.systems/pricing',
        expires_at: expect.stringMatching(/^\d{10}$/),
      },
    }])
    near(Number(calls[0].form.expires_at) * 1000, Date.now() + HOUR)
    expect(await meta(stub, 'checkout_session')).toBe('cs_1')
  })

  it('hands back the open session while more than five minutes are left, and only then opens another', async () => {
    const { stub, admin } = await account()
    await setNow(stub, T0)
    const expiresAt = (ms: number) => runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => {
      s.storage.sql.exec("UPDATE meta SET v = ? WHERE k = 'checkout_expires'", String(ms))
    })
    expect(await (await checkout(admin)).json()).toEqual({ url: 'https://checkout.stripe.test/c/1' })
    await expiresAt(T0 + 5 * 60_000 + 1)
    expect(await (await checkout(admin)).json()).toEqual({ url: 'https://checkout.stripe.test/c/1' })
    expect(sessionCalls()).toHaveLength(1)
    await expiresAt(T0 + 5 * 60_000)
    expect(await (await checkout(admin)).json()).toEqual({ url: 'https://checkout.stripe.test/c/2' })
  })

  it('forgets the open session once it completes', async () => {
    const { tenant, stub, admin } = await account()
    await checkout(admin)
    await webhook(completed(tenant, 'sub_1', null, { id: 'cs_1' }))
    for (const k of ['checkout_session', 'checkout_url', 'checkout_expires']) expect(await meta(stub, k)).toBeUndefined()
  })

  it('keeps the open session when another session completes', async () => {
    const { tenant, stub, admin } = await account()
    await checkout(admin)
    await webhook(completed(tenant, 'sub_1', null, { id: 'cs_other' }))
    expect(await meta(stub, 'checkout_session')).toBe('cs_1')
  })

  it('sends a Pro tenant to the billing portal with 409 already_pro', async () => {
    const { tenant, admin } = await account()
    await webhook(completed(tenant))
    calls = []
    const r = await checkout(admin)
    expect([r.status, await r.json()]).toEqual([409, { error: 'already_pro', portal_url: 'https://billing.stripe.test/p/1' }])
    expect(calls).toEqual([{ method: 'POST', url: 'https://api.stripe.com/v1/billing_portal/sessions', form: { customer: 'cus_1', configuration: 'bpc_vitest', return_url: 'https://solenoid.systems/pricing' } }])
  })

  it('reuses the Stripe customer when a former Pro tenant upgrades again', async () => {
    const { tenant, admin } = await account()
    await webhook(completed(tenant))
    await webhook(deleted(tenant))
    calls = []
    expect((await checkout(admin)).status).toBe(200)
    expect(calls[0].form.customer).toBe('cus_1')
  })

  it('answers 500 and logs it when Stripe fails', async () => {
    const { admin } = await account()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    stripeDown = true
    const r = await checkout(admin)
    expect([r.status, await r.json()]).toEqual([500, { error: 'internal' }])
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'Stripe answered 500 to POST /checkout/sessions' }))
  })

  it('calls Stripe through the global fetch when the Worker passes none, which the Worker tests refuse', async () => {
    const { admin } = await account()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await handle(new Request('https://api.test/billing/checkout', { method: 'POST', headers: admin }), env, tenantFor, { ...io, stripeFetch: undefined })
    expect([r.status, calls]).toEqual([500, []])
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'Stripe answered 599 to POST /checkout/sessions' }))
  })
})

describe('POST /billing/stripe', () => {
  it('answers 503 before reading the body while billing is unconfigured', async () => {
    const req = new Request('https://api.test/billing/stripe', { method: 'POST', body: '{"type":"checkout.session.completed"}' })
    const r = await handle(req, { ...env, STRIPE_WEBHOOK_SECRET: undefined } as typeof env, tenantFor, io)
    expect([r.status, await r.json()]).toEqual([503, { error: 'billing_unavailable' }])
    expect(req.bodyUsed).toBe(false)
  })

  it('refuses a bad signature with 400 and changes nothing', async () => {
    const { tenant, stub } = await account()
    const r = await webhook(completed(tenant), 'whsec_wrong')
    expect([r.status, await r.json()]).toEqual([400, { error: 'invalid_signature' }])
    const unsigned = await post('/billing/stripe', JSON.stringify(completed(tenant)))
    expect(unsigned.status).toBe(400)
    expect(await meta(stub, 'plan')).toBe('free')
  })

  it('makes the tenant Pro on checkout.session.completed, lifts the free cap, and mails a code to the checkout email', async () => {
    const { tenant, stub } = await account()
    await setNow(stub, T0)
    await spend(stub, 'a', { x: u(1) })
    await setBillable(stub, 100_000)
    expect(await spend(stub, 'a', { x: u(1) })).toMatchObject({ ok: false, status: 402 })
    const r = await webhook(completed(tenant))
    expect([r.status, await r.json()]).toEqual([200, { received: true }])
    expect(await meta(stub, 'plan')).toBe('pro')
    expect(await meta(stub, 'stripe_customer')).toBe('cus_1')
    expect(await meta(stub, 'stripe_subscription')).toBe('sub_1')
    expect(await meta(stub, 'meter_seq')).toBe(String(await head(stub)))
    expect(await meta(stub, 'next_meter')).toBe(String(T0 + DAY))
    near(await armedFor(stub), T0 + DAY)
    expect((await spend(stub, 'a', { x: u(1) })).ok).toBe(true)
    await settled()
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toBe('buyer@example.com')
    expect(mails[0].text).toContain(tenant)
  })

  it('treats a redelivered completion as done: no second code, and meter_seq stays put', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant))
    const from = await meta(stub, 'meter_seq')
    await spend(stub, 'a', { x: u(1) })
    expect((await webhook(completed(tenant))).status).toBe(200)
    await settled()
    expect(mails).toHaveLength(1)
    expect(await meta(stub, 'meter_seq')).toBe(from)
  })

  it('ignores a completion redelivered after cancellation, so the tenant stays free', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant))
    await webhook(deleted(tenant))
    expect((await webhook(completed(tenant))).status).toBe(200)
    expect(await meta(stub, 'plan')).toBe('free')
  })

  it('refuses a second subscription while Pro: it cancels the newcomer, logs it, mails security@ the IDs, and does so once', async () => {
    const { tenant, stub } = await account()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await webhook(completed(tenant, 'sub_1'))
    calls = []
    expect((await webhook(completed(tenant, 'sub_2'))).status).toBe(200)
    expect(await meta(stub, 'stripe_subscription')).toBe('sub_1')
    expect(await meta(stub, 'duplicate:sub_2')).toBe('cancelled')
    expect(calls.map(route)).toEqual(['GET /subscriptions/sub_2', 'DELETE /subscriptions/sub_2'])
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('sub_2'))
    await settled()
    expect(mails.map((m) => m.to)).toEqual(['buyer@example.com', 'security@solenoid.systems'])
    for (const id of [tenant, 'sub_2', 'cs_for_sub_2']) expect(mails[1].text).toContain(id)
    expect(mails[1]).toEqual(duplicateMail(tenant, 'sub_2', 'cs_for_sub_2', true))
    calls = []
    expect((await webhook(completed(tenant, 'sub_2'))).status).toBe(200)
    await settled()
    expect([calls, mails.length]).toEqual([[], 2])
  })

  it('says the duplicate had already ended, and cancels nothing, when Stripe reports it canceled', async () => {
    const { tenant, stub } = await account()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await webhook(completed(tenant, 'sub_1'))
    calls = []
    duplicateStatus = 'canceled'
    expect((await webhook(completed(tenant, 'sub_2'))).status).toBe(200)
    expect(calls.map(route)).toEqual(['GET /subscriptions/sub_2'])
    expect(await meta(stub, 'duplicate:sub_2')).toBe('cancelled')
    await settled()
    expect(mails[1]).toEqual(duplicateMail(tenant, 'sub_2', 'cs_for_sub_2', false))
  })

  it('still answers 200 when the duplicate notice cannot be sent, and logs the failure', async () => {
    const { tenant, stub } = await account()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await webhook(completed(tenant, 'sub_1'))
    noticeDown = true
    expect((await webhook(completed(tenant, 'sub_2'))).status).toBe(200)
    await settled()
    expect(await meta(stub, 'duplicate:sub_2')).toBe('cancelled')
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'resend down' }))
  })

  it('retries a duplicate cancel that failed, because Stripe redelivers the event', async () => {
    const { tenant, stub } = await account()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await webhook(completed(tenant, 'sub_1'))
    stripeDown = true
    expect((await webhook(completed(tenant, 'sub_2'))).status).toBe(500)
    expect(await meta(stub, 'duplicate:sub_2')).toBeUndefined()
    stripeDown = false
    calls = []
    expect((await webhook(completed(tenant, 'sub_2'))).status).toBe(200)
    expect(calls.map(route)).toEqual(['GET /subscriptions/sub_2', 'DELETE /subscriptions/sub_2'])
    expect(await meta(stub, 'duplicate:sub_2')).toBe('cancelled')
  })

  it('sends no code when the checkout has no usable email', async () => {
    for (const extra of [{ customer_details: { email: null } }, { customer_details: { email: 'not an address' } }, { customer_details: null }]) {
      const { tenant, stub } = await account()
      expect((await webhook(completed(tenant, 'sub_1', null, extra))).status).toBe(200)
      expect(await meta(stub, 'plan')).toBe('pro')
    }
    await settled()
    expect(mails).toEqual([])
  })

  it('still makes the tenant Pro when the address has used up its codes, and sends none', async () => {
    const { tenant, stub } = await account()
    for (let i = 0; i < 5; i++) await stub.attachStart(ADMIN, 'buyer@example.com')
    expect((await webhook(completed(tenant))).status).toBe(200)
    expect(await meta(stub, 'plan')).toBe('pro')
    await settled()
    expect(mails).toEqual([])
  })

  it('still answers 200 when the code cannot be sent, and logs the failure', async () => {
    const { tenant, stub } = await account()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    codeDown = true
    expect((await webhook(completed(tenant))).status).toBe(200)
    await settled()
    expect(await meta(stub, 'plan')).toBe('pro')
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'resend down' }))
  })

  it('ignores a completed session that is not a paid subscription', async () => {
    for (const extra of [{ mode: 'payment', subscription: null }, { payment_status: 'unpaid' }]) {
      const { tenant, stub } = await account()
      expect((await webhook(completed(tenant, 'sub_1', ' Buyer@Example.COM ', extra))).status).toBe(200)
      expect(await meta(stub, 'plan')).toBe('free')
    }
    await settled()
    expect(mails).toEqual([])
  })

  it('acknowledges and ignores an event for no tenant, or of another type', async () => {
    for (const event of [completed('nope'), completed('zzzzzzzzzzzz'), { type: 'checkout.session.completed', data: { object: {} } }, deleted('NOPE'), deleted('zzzzzzzzzzzz'), { type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } }, { type: 'invoice.paid', data: { object: {} } }]) {
      const r = await webhook(event)
      expect([r.status, await r.json()]).toEqual([200, { received: true }])
    }
    expect(await meta(env.TENANT.get(env.TENANT.idFromName('zzzzzzzzzzzz')), 'plan')).toBeUndefined()
    await settled()
    expect([calls, mails]).toEqual([[], []])
  })

  it('acts only on the two event types it handles, whatever the object carries', async () => {
    const { tenant, stub } = await account()
    await webhook({ ...completed(tenant), type: 'checkout.session.async_payment_succeeded' })
    expect(await meta(stub, 'plan')).toBe('free')
    await webhook(completed(tenant))
    await spend(stub, 'a', { x: u(1) })
    calls = []
    await webhook({ ...deleted(tenant), type: 'customer.subscription.updated' })
    expect(await meta(stub, 'plan')).toBe('pro')
    expect(calls).toEqual([])
  })

  it('reports the spends since the last report on customer.subscription.deleted, stamped inside the last period, then returns the tenant to free', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant))
    const from = Number(await meta(stub, 'meter_seq'))
    for (let i = 0; i < 3; i++) await spend(stub, 'a', { x: u(1) })
    await limit(stub, 'a', 'x', u(10))
    const endedAt = Math.floor(Date.now() / 1000) - 60
    expect((await webhook(deleted(tenant, 'sub_1', endedAt))).status).toBe(200)
    const [event] = meterCalls()
    expect(event.form).toEqual({ event_name: 'spends', 'payload[stripe_customer_id]': 'cus_1', 'payload[value]': '3', identifier: `${tenant}:${from}-${from + 4}`, timestamp: String(endedAt - 1) })
    expect(await meta(stub, 'plan')).toBe('free')
    expect(await meta(stub, 'next_meter')).toBeUndefined()
    expect(await meta(stub, 'meter_seq')).toBe(String(from + 4))
  })

  it('stamps the final report now when the subscription ends later than now', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant))
    await spend(stub, 'a', { x: u(1) })
    const before = Math.floor(Date.now() / 1000)
    await webhook(deleted(tenant, 'sub_1', before + 3600))
    const stamp = Number(meterCalls()[0].form.timestamp)
    expect(stamp).toBeGreaterThanOrEqual(before)
    expect(stamp).toBeLessThan(before + 60)
  })

  it('answers 500 and keeps the tenant Pro when the final report fails, then reports the same range on the retry', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant))
    await spend(stub, 'a', { x: u(1) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stripeDown = true
    expect((await webhook(deleted(tenant))).status).toBe(500)
    expect(await meta(stub, 'plan')).toBe('pro')
    await spend(stub, 'a', { x: u(1) })
    stripeDown = false
    expect((await webhook(deleted(tenant))).status).toBe(200)
    const [failed, retried] = meterCalls()
    expect(retried.form.identifier).toBe(failed.form.identifier)
    expect([failed.key, retried.key]).toEqual([failed.form.identifier, failed.form.identifier])
    expect([failed.form['payload[value]'], retried.form['payload[value]']]).toEqual(['1', '1'])
    expect(await meta(stub, 'plan')).toBe('free')
  })

  it('stamps the final report now when the deletion carries no ended_at', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant))
    await spend(stub, 'a', { x: u(1) })
    const before = Math.floor(Date.now() / 1000)
    const event = deleted(tenant)
    delete (event.data.object as { ended_at?: number }).ended_at
    expect((await webhook(event)).status).toBe(200)
    const stamp = Number(meterCalls()[0].form.timestamp)
    expect(stamp).toBeGreaterThanOrEqual(before)
    expect(stamp).toBeLessThan(before + 60)
    expect(await meta(stub, 'plan')).toBe('free')
  })

  it('ignores a deletion of another subscription, and reports nothing for it', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant, 'sub_2'))
    await spend(stub, 'a', { x: u(1) })
    await webhook(deleted(tenant, 'sub_1'))
    expect(await meta(stub, 'plan')).toBe('pro')
    expect(meterCalls()).toEqual([])
  })
})

describe('the ledger billing calls', () => {
  it('start nothing on an object with no tenant, or for a subscription it has seen', async () => {
    const empty = env.TENANT.get(env.TENANT.idFromName('zzzzzzzzzzzz'))
    expect(await empty.billingStart('cus_1', 'sub_1', 'cs_1')).toEqual({ ok: true, value: { started: false, duplicate: false } })
    const { stub } = await account()
    expect(await stub.billingStart('cus_1', 'sub_1', 'cs_1')).toEqual({ ok: true, value: { started: true, duplicate: false } })
    expect(await stub.billingStart('cus_1', 'sub_1', 'cs_1')).toEqual({ ok: true, value: { started: false, duplicate: false } })
    expect(await stub.billingStart('cus_1', 'sub_2', 'cs_2')).toEqual({ ok: true, value: { started: false, duplicate: true } })
  })

  it('end only the current subscription of a Pro tenant, dropping its report in flight', async () => {
    const { stub } = await account()
    await stub.billingStart('cus_1', 'sub_1', 'cs_1')
    await spend(stub, 'a', { x: u(1) })
    await stub.meterDue()
    expect(await stub.billingEnd('sub_2')).toEqual({ ok: true, value: { ended: false } })
    expect([await meta(stub, 'plan'), await meta(stub, 'meter_to')]).toEqual(['pro', String(await head(stub))])
    expect(await stub.billingEnd('sub_1')).toEqual({ ok: true, value: { ended: true } })
    expect([await meta(stub, 'plan'), await meta(stub, 'meter_to')]).toEqual(['free', undefined])
    expect(await stub.billingEnd('sub_1')).toEqual({ ok: true, value: { ended: false } })
  })
})

describe('the daily meter report', () => {
  it('reports new spends once, then the next day only the newer ones', async () => {
    const { tenant, stub } = await account()
    await setNow(stub, T0)
    await webhook(completed(tenant))
    const s0 = Number(await meta(stub, 'meter_seq'))
    for (let i = 0; i < 3; i++) await spend(stub, 'a', { x: u(1) })
    await setNow(stub, T0 + DAY)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(meterCalls().map((c) => c.form)).toEqual([{ event_name: 'spends', 'payload[stripe_customer_id]': 'cus_1', 'payload[value]': '3', identifier: `${tenant}:${s0}-${s0 + 3}`, timestamp: String((T0 + DAY) / 1000) }])
    expect(await meta(stub, 'meter_seq')).toBe(String(s0 + 3))
    near(await armedFor(stub), T0 + 2 * DAY)
    for (let i = 0; i < 2; i++) await spend(stub, 'a', { x: u(1) })
    await setNow(stub, T0 + 2 * DAY)
    await runDurableObjectAlarm(stub)
    expect(meterCalls()[1].form).toMatchObject({ 'payload[value]': '2', identifier: `${tenant}:${s0 + 3}-${s0 + 5}` })
  })

  it('sends nothing for a day of limit changes and replays, and moves on', async () => {
    const { tenant, stub } = await account()
    await setNow(stub, T0)
    await stub.spend(ADMIN, 'a', { x: u(1) }, 'once', 'h')
    await webhook(completed(tenant))
    await limit(stub, 'a', 'x', u(10))
    expect((await stub.spend(ADMIN, 'a', { x: u(1) }, 'once', 'h')).ok).toBe(true)
    await setNow(stub, T0 + DAY)
    await runDurableObjectAlarm(stub)
    expect(meterCalls()).toEqual([])
    expect(await meta(stub, 'meter_seq')).toBe(String(await head(stub)))
  })

  it('retries a failed report in an hour with the same range and identifier', async () => {
    const { tenant, stub } = await account()
    await setNow(stub, T0)
    await webhook(completed(tenant))
    await spend(stub, 'a', { x: u(1) })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    stripeDown = true
    await setNow(stub, T0 + DAY)
    await runDurableObjectAlarm(stub)
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'Stripe answered 500 to POST /billing/meter_events' }))
    const from = await meta(stub, 'meter_seq')
    near(await armedFor(stub), T0 + DAY + HOUR)
    await spend(stub, 'a', { x: u(1) })
    stripeDown = false
    await setNow(stub, T0 + DAY + HOUR)
    await runDurableObjectAlarm(stub)
    const [failed, retried] = meterCalls()
    expect(retried.form.identifier).toBe(failed.form.identifier)
    expect([failed.key, retried.key]).toEqual([failed.form.identifier, failed.form.identifier])
    expect(retried.form['payload[value]']).toBe('1')
    expect(await meta(stub, 'meter_seq')).not.toBe(from)
    near(await armedFor(stub), T0 + 2 * DAY + HOUR)
  })

  it('never moves meter_seq backwards, and clears only its own report in flight', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant))
    const from = Number(await meta(stub, 'meter_seq'))
    for (let i = 0; i < 3; i++) await spend(stub, 'a', { x: u(1) })
    expect(await stub.meterDue()).toMatchObject({ ok: true, value: { to: from + 3 } })
    await stub.meterCommit(from + 1)
    expect([await meta(stub, 'meter_seq'), await meta(stub, 'meter_to')]).toEqual([String(from + 1), String(from + 3)])
    await stub.meterCommit(from + 3)
    await stub.meterCommit(from + 1)
    expect([await meta(stub, 'meter_seq'), await meta(stub, 'meter_to')]).toEqual([String(from + 3), undefined])
  })

  it('arms one alarm for the earlier of the two jobs', async () => {
    const { tenant, stub } = await account()
    await setNow(stub, T0)
    await webhook(completed(tenant))
    await setNow(stub, T0 + 2 * HOUR)
    await stub.attachStart(ADMIN, 'robin@example.com')
    near(await armedFor(stub), T0 + DAY)
    await setNow(stub, T0 + DAY)
    await runDurableObjectAlarm(stub)
    expect(await meta(stub, 'next_prune')).toBe(String(T0 + 2 * HOUR + DAY))
    near(await armedFor(stub), T0 + 2 * HOUR + DAY)
  })

  it('stops the meter job, and reports nothing, when the tenant is no longer Pro', async () => {
    const { tenant, stub } = await account()
    await setNow(stub, T0)
    await webhook(completed(tenant))
    await spend(stub, 'a', { x: u(1) })
    await runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => { s.storage.sql.exec("UPDATE meta SET v = 'free' WHERE k = 'plan'") })
    const logged = vi.spyOn(console, 'error')
    await setNow(stub, T0 + DAY)
    await runDurableObjectAlarm(stub)
    expect(await meta(stub, 'next_meter')).toBeUndefined()
    expect(await armedFor(stub)).toBeNull()
    expect(meterCalls()).toEqual([])
    expect(logged).not.toHaveBeenCalled()
  })

  it('leaves the meter report alone when the alarm fires for a prune that falls due first', async () => {
    const { tenant, stub } = await account()
    await setNow(stub, T0)
    await stub.attachStart(ADMIN, 'robin@example.com')
    await setNow(stub, T0 + 2 * HOUR)
    await webhook(completed(tenant, 'sub_1', null))
    await spend(stub, 'a', { x: u(1) })
    near(await armedFor(stub), T0 + DAY)
    await setNow(stub, T0 + DAY)
    await runDurableObjectAlarm(stub)
    expect(meterCalls()).toEqual([])
    expect(await meta(stub, 'next_meter')).toBe(String(T0 + 2 * HOUR + DAY))
    near(await armedFor(stub), T0 + 2 * HOUR + DAY)
  })

  it('reports nothing and tries again in an hour while Stripe is unconfigured', async () => {
    const { tenant, stub } = await account()
    await setNow(stub, T0)
    await webhook(completed(tenant, 'sub_1', null))
    await spend(stub, 'a', { x: u(1) })
    const logged = vi.spyOn(console, 'error')
    await runInDurableObject(stub, (i: TenantDO) => {
      const d = i as unknown as { env: Cloudflare.Env }
      d.env = { ...d.env, STRIPE_SECRET_KEY: undefined }
    })
    await setNow(stub, T0 + DAY)
    await runDurableObjectAlarm(stub)
    expect(meterCalls()).toEqual([])
    expect(await meta(stub, 'meter_to')).toBeUndefined()
    expect(await meta(stub, 'next_meter')).toBe(String(T0 + DAY + HOUR))
    expect(logged).not.toHaveBeenCalled()
  })

  it('sends the report of a woken tenant through the global fetch, which the Worker tests refuse', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant, 'sub_1', null))
    await spend(stub, 'a', { x: u(1) })
    await evictDurableObject(stub)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await setNow(stub, Date.now() + DAY)
    await runDurableObjectAlarm(stub)
    expect(calls).toEqual([])
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'Stripe answered 599 to POST /billing/meter_events' }))
  })
})
