import type { Io } from './auth-routes'
import { INTERNAL } from './auth'
import { normalizeEmail } from './codes'
import type { TenantApi } from './core'
import { ApiError, failResponse, json } from './errors'
import { TENANT_RE, verifyKey } from './keys'
import { codeMail, duplicateMail } from './mail'
import { billingConfig, reportUsage, stripeClient, verifySignature, type BillingEnv } from './stripe'

type TenantFor = (name: string) => TenantApi
const unavailable = () => json(503, { error: 'billing_unavailable' })
const tenantIn = (v: unknown): string | null => (typeof v === 'string' && TENANT_RE.test(v) ? v : null)

export async function billingCheckout(req: Request, env: BillingEnv & { MASTER: string }, tenantFor: TenantFor, io: Io): Promise<Response> {
  const { tenant, auth } = await verifyKey(req.headers.get('authorization'), env.MASTER)
  const cfg = billingConfig(env)
  if (!cfg) return unavailable()
  const stub = tenantFor(tenant)
  const r = await stub.billing(auth)
  if (!r.ok) return failResponse(r)
  const stripe = stripeClient(cfg, io.stripeFetch)
  if (r.value.plan === 'pro') return json(409, { error: 'already_pro', portal_url: await stripe.portal(r.value.customer!) })
  if (r.value.checkout) return json(200, { url: r.value.checkout })
  const session = await stripe.checkout(tenant, r.value.customer, Date.now())
  await stub.checkoutSaved(session.id, session.url, session.expires)
  return json(200, { url: session.url })
}

export async function billingWebhook(req: Request, env: BillingEnv, tenantFor: TenantFor, io: Io): Promise<Response> {
  const cfg = billingConfig(env)
  if (!cfg) return unavailable()
  const body = await req.text()
  if (!(await verifySignature(cfg.webhookSecret, req.headers.get('stripe-signature'), body, Date.now()))) throw new ApiError(400, 'invalid_signature')
  const { type, data } = JSON.parse(body) as { type: string; data: { object: Record<string, any> } }
  const o = data.object
  const stripe = stripeClient(cfg, io.stripeFetch)
  if (type === 'checkout.session.completed' && o.mode === 'subscription' && o.payment_status === 'paid') {
    const tenant = tenantIn(o.client_reference_id)
    if (tenant) {
      const stub = tenantFor(tenant)
      const r = await stub.billingStart(o.customer, o.subscription, o.id)
      if (r.ok && r.value.duplicate) {
        const cancelled = await stripe.cancelDuplicate(o.subscription)
        await stub.duplicateSettled(o.subscription)
        console.error(`tenant ${tenant} is already on Pro; the second subscription ${o.subscription} from session ${o.id} is no longer live. check whether it needs a refund`)
        io.waitUntil(io.mail(duplicateMail(tenant, o.subscription, o.id, cancelled)).catch((e) => console.error(e)))
      }
      const email = normalizeEmail(o.customer_details?.email)
      if (r.ok && r.value.started && email) {
        const code = await stub.attachStart(INTERNAL, email)
        if (code.ok) io.waitUntil(io.mail(codeMail(email, code.value.code, tenant, 'attach')).catch((e) => console.error(e)))
      }
    }
  }
  if (type === 'customer.subscription.deleted') {
    const tenant = tenantIn(o.metadata?.tenant)
    if (tenant) {
      const stub = tenantFor(tenant)
      const b = await stub.billing(INTERNAL)
      if (b.ok && b.value.plan === 'pro' && b.value.subscription === o.id) {
        await reportUsage(stub, stripe, Number.isFinite(o.ended_at) ? Math.min(Date.now(), o.ended_at * 1000 - 1000) : Date.now()).catch((e) =>
          console.error(`tenant ${tenant}: the final usage report for subscription ${o.id} failed, so its last unreported spends go unbilled`, e))
      }
      await stub.billingEnd(o.id)
    }
  }
  return json(200, { received: true })
}
