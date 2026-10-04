import type { TenantApi } from './core'
import { hmacMatches } from './keys'

export const METER_EVENT = 'spends'
export const RETURN_URL = 'https://solenoid.systems/pricing'
export const STRIPE_VERSION = '2026-08-26.dahlia'
export const CHECKOUT_TTL_S = 60 * 60
const API = 'https://api.stripe.com/v1'
const TOLERANCE_S = 300

export type BillingEnv = { STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string; STRIPE_PRICE_PRO?: string; STRIPE_PRICE_SPENDS?: string; STRIPE_PORTAL_CONFIG?: string }
export type BillingConfig = { secretKey: string; webhookSecret: string; pricePro: string; priceSpends: string; portalConfig: string }
export type CheckoutSession = { id: string; url: string; expires: number }
export type Stripe = {
  checkout(tenant: string, customer: string | null, nowMs: number): Promise<CheckoutSession>
  portal(customer: string): Promise<string>
  meterEvent(e: { customer: string; value: number; identifier: string; timestamp: number }): Promise<void>
  cancelDuplicate(subscription: string): Promise<boolean>
}

export function billingConfig(env: BillingEnv): BillingConfig | null {
  const { STRIPE_SECRET_KEY: secretKey, STRIPE_WEBHOOK_SECRET: webhookSecret, STRIPE_PRICE_PRO: pricePro, STRIPE_PRICE_SPENDS: priceSpends, STRIPE_PORTAL_CONFIG: portalConfig } = env
  return secretKey && webhookSecret && pricePro && priceSpends && portalConfig ? { secretKey, webhookSecret, pricePro, priceSpends, portalConfig } : null
}

export function stripeClient(cfg: BillingConfig, f: typeof fetch = fetch): Stripe {
  async function call(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string> = {}, extra: Record<string, string> = {}): Promise<Record<string, any>> {
    const res = await f(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.secretKey}`, 'stripe-version': STRIPE_VERSION, 'content-type': 'application/x-www-form-urlencoded', ...extra },
      body: method === 'POST' ? new URLSearchParams(params).toString() : undefined,
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Stripe answered ${res.status} to ${method} ${path}`)
    return res.json()
  }
  return {
    async checkout(tenant, customer, nowMs) {
      const s = await call('POST', '/checkout/sessions', {
        mode: 'subscription',
        'line_items[0][price]': cfg.pricePro,
        'line_items[0][quantity]': '1',
        'line_items[1][price]': cfg.priceSpends,
        client_reference_id: tenant,
        'subscription_data[metadata][tenant]': tenant,
        success_url: RETURN_URL,
        cancel_url: RETURN_URL,
        expires_at: String(Math.floor(nowMs / 1000) + CHECKOUT_TTL_S),
        'payment_method_types[0]': 'card',
        ...(customer ? { customer } : {}),
      })
      return { id: s.id, url: s.url, expires: s.expires_at * 1000 }
    },
    portal: async (customer) => (await call('POST', '/billing_portal/sessions', { customer, configuration: cfg.portalConfig, return_url: RETURN_URL })).url,
    async meterEvent(e) {
      await call('POST', '/billing/meter_events', { event_name: METER_EVENT, 'payload[stripe_customer_id]': e.customer, 'payload[value]': String(e.value), identifier: e.identifier, timestamp: String(e.timestamp) }, { 'idempotency-key': e.identifier })
    },
    async cancelDuplicate(subscription) {
      if ((await call('GET', `/subscriptions/${subscription}`)).status === 'canceled') return false
      await call('DELETE', `/subscriptions/${subscription}`)
      return true
    },
  }
}

export async function verifySignature(secret: string, header: string | null, body: string, nowMs: number): Promise<boolean> {
  const fields = (header ?? '').split(',').map((kv) => kv.split('='))
  const t = fields.find(([k]) => k === 't')?.[1] ?? ''
  if (!/^[0-9]{1,12}$/.test(t) || Math.abs(nowMs / 1000 - Number(t)) > TOLERANCE_S) return false
  for (const [k, v] of fields) if (k === 'v1' && /^[0-9a-f]{64}$/.test(v ?? '') && (await hmacMatches(secret, `${t}.${body}`, v))) return true
  return false
}

export async function reportUsage(stub: Pick<TenantApi, 'meterDue' | 'meterCommit'>, stripe: Stripe, nowMs: number): Promise<void> {
  const due = await stub.meterDue()
  if (!due.ok || !due.value) return
  const { customer, identifier, value, to } = due.value
  if (value > 0) await stripe.meterEvent({ customer, value, identifier, timestamp: Math.floor(nowMs / 1000) })
  await stub.meterCommit(to)
}
