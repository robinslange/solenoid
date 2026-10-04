import type { TenantApi } from './core'
import { resendMailer } from './mail'
import { handle } from './router'

export { ipKey } from './router'
export { TenantDO } from './tenant'

export default {
  fetch: (req, env, ctx) =>
    handle(req, env, (name) => env.TENANT.get(env.TENANT.idFromName(name)) as unknown as TenantApi, {
      mail: resendMailer(env.RESEND_API_KEY, env.MAIL_FROM),
      waitUntil: (p) => ctx.waitUntil(p),
    }),
} satisfies ExportedHandler<Cloudflare.Env>
