import { describe, expect, it } from 'vitest'
import { hmacHex } from '../src/keys'
import { billingConfig, stripeClient, verifySignature } from '../src/stripe'

const NOW = Date.UTC(2026, 9, 1, 12)
const T = Math.floor(NOW / 1000)
const header = async (body: string, secret = 'whsec_x', t: number | string = T) => `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`
const CFG = { secretKey: 'rk_x', webhookSecret: 'whsec_x', pricePro: 'price_pro', priceSpends: 'price_spends', portalConfig: 'bpc_x' }

describe('verifySignature', () => {
  it('accepts a v1 signature of "<t>.<body>" under the secret, within five minutes either way', async () => {
    expect(await verifySignature('whsec_x', await header('{"a":1}'), '{"a":1}', NOW)).toBe(true)
    expect(await verifySignature('whsec_x', await header('{"a":1}', 'whsec_x', T - 300), '{"a":1}', NOW)).toBe(true)
    expect(await verifySignature('whsec_x', await header('{"a":1}', 'whsec_x', T + 300), '{"a":1}', NOW)).toBe(true)
  })
  it('accepts one good v1 among several', async () => {
    const good = (await header('{}')).split(',')[1]
    expect(await verifySignature('whsec_x', `t=${T},v1=${'0'.repeat(64)},${good}`, '{}', NOW)).toBe(true)
  })
  it('reads t wherever it sits in the header', async () => {
    const good = (await header('{}')).split(',')[1]
    expect(await verifySignature('whsec_x', `${good},t=${T}`, '{}', NOW)).toBe(true)
  })
  it('refuses a wrong secret, another body, a stale or future time, and a missing or malformed header', async () => {
    expect(await verifySignature('whsec_y', await header('{}'), '{}', NOW)).toBe(false)
    expect(await verifySignature('whsec_x', await header('{}'), '{ }', NOW)).toBe(false)
    expect(await verifySignature('whsec_x', await header('{}', 'whsec_x', T - 301), '{}', NOW)).toBe(false)
    expect(await verifySignature('whsec_x', await header('{}', 'whsec_x', T + 301), '{}', NOW)).toBe(false)
    const v1 = (await header('{}')).split(',')[1]
    for (const h of [null, '', v1, `t=,${v1}`, `t=12x,${v1}`, `t=${T}`, `t=${T},v1`, `t=${T},v1=${'z'.repeat(64)}`, `t=${T},v0=${v1.slice(3)}`, `t=${T},v1=zz${v1.slice(3)}`, `t=${T},v1=${v1.slice(3)}zz`]) {
      expect(await verifySignature('whsec_x', h, '{}', NOW)).toBe(false)
    }
  })
  it('refuses a time that is not all digits even when the MAC is signed over it', async () => {
    expect(await verifySignature('whsec_x', await header('{}', 'whsec_x', `${T}x`), '{}', NOW)).toBe(false)
    expect(await verifySignature('whsec_x', await header('{}', 'whsec_x', `x${T}`), '{}', NOW)).toBe(false)
  })
})

describe('billingConfig', () => {
  const ALL = { STRIPE_SECRET_KEY: 'rk_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_SPENDS: 'price_spends', STRIPE_PORTAL_CONFIG: 'bpc_x' }
  it('needs all five values', () => {
    expect(billingConfig(ALL)).toEqual(CFG)
    for (const k of Object.keys(ALL)) {
      expect(billingConfig({ ...ALL, [k]: undefined })).toBeNull()
      expect(billingConfig({ ...ALL, [k]: '' })).toBeNull()
    }
  })
})

describe('stripeClient', () => {
  type Seen = { method: string; url: string; auth: string | null; version: string | null; type: string | null; key: string | null; form: Record<string, string> }
  const recorder = (answer: (method: string, url: string) => [number, unknown] = () => [200, { url: 'https://stripe.test/x' }]) => {
    const calls: Seen[] = []
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const h = req.headers
      const method = req.method
      calls.push({ method, url: req.url, auth: h.get('authorization'), version: h.get('stripe-version'), type: h.get('content-type'), key: h.get('idempotency-key'), form: Object.fromEntries(new URLSearchParams(await req.text())) })
      const [status, body] = answer(method, req.url)
      return Response.json(body, { status })
    }) as typeof fetch
    return { calls, f }
  }
  it('posts a form with the restricted key and a pinned API version, and returns the portal URL', async () => {
    const { calls, f } = recorder()
    expect(await stripeClient(CFG, f).portal('cus_1')).toBe('https://stripe.test/x')
    expect(calls).toEqual([{ method: 'POST', url: 'https://api.stripe.com/v1/billing_portal/sessions', auth: 'Bearer rk_x', version: '2026-08-26.dahlia', type: 'application/x-www-form-urlencoded', key: null, form: { customer: 'cus_1', configuration: 'bpc_x', return_url: 'https://solenoid.systems/pricing' } }])
  })
  it('opens a Checkout Session that expires in an hour, and returns its id, URL and expiry', async () => {
    const { calls, f } = recorder(() => [200, { id: 'cs_1', url: 'https://checkout.stripe.test/c/1', expires_at: T + 3600 }])
    expect(await stripeClient(CFG, f).checkout('abcdefghijkl', null, NOW)).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.test/c/1', expires: NOW + 3_600_000 })
    expect(calls[0].form.expires_at).toBe(String(T + 3600))
  })
  it('sends one meter event on the spends meter, with its identifier as the idempotency key', async () => {
    const { calls, f } = recorder(() => [200, {}])
    await stripeClient(CFG, f).meterEvent({ customer: 'cus_1', value: 3, identifier: 'abcdefghijkl:4-9', timestamp: 1_790_000_000 })
    expect(calls[0].url).toBe('https://api.stripe.com/v1/billing/meter_events')
    expect(calls[0].form).toEqual({ event_name: 'spends', 'payload[stripe_customer_id]': 'cus_1', 'payload[value]': '3', identifier: 'abcdefghijkl:4-9', timestamp: '1790000000' })
    expect(calls[0].key).toBe('abcdefghijkl:4-9')
  })
  it('cancels a duplicate subscription that is still live', async () => {
    const { calls, f } = recorder(() => [200, { status: 'active' }])
    expect(await stripeClient(CFG, f).cancelDuplicate('sub_2')).toBe(true)
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET https://api.stripe.com/v1/subscriptions/sub_2', 'DELETE https://api.stripe.com/v1/subscriptions/sub_2'])
  })
  it('leaves a duplicate that is already cancelled alone', async () => {
    const { calls, f } = recorder(() => [200, { status: 'canceled' }])
    expect(await stripeClient(CFG, f).cancelDuplicate('sub_2')).toBe(false)
    expect(calls.map((c) => c.method)).toEqual(['GET'])
  })
  it('throws on any answer but 2xx, naming the method, the status and the path', async () => {
    await expect(stripeClient(CFG, recorder(() => [402, {}]).f).meterEvent({ customer: 'c', value: 1, identifier: 'i', timestamp: 1 })).rejects.toThrow('Stripe answered 402 to POST /billing/meter_events')
  })
})
