import type { TenantDO } from './tenant'

declare global {
  namespace Cloudflare {
    interface Env { TENANT: DurableObjectNamespace<TenantDO>; MASTER: string; SIGNING_KEY: string; SIGNING_KID: string; RETIRED_SIGNING_KEYS?: string | Record<string, JsonWebKey>; RESEND_API_KEY?: string; MAIL_FROM: string; STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string; STRIPE_PRICE_PRO?: string; STRIPE_PRICE_SPENDS?: string; STRIPE_PORTAL_CONFIG?: string }
  }
}
export {}
