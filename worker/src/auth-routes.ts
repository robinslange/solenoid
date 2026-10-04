import { CODE_RE, normalizeEmail } from './codes'
import type { TenantApi } from './core'
import { ApiError, fail, failResponse, json, ok } from './errors'
import { adminKey, TENANT_RE, verifyKey } from './keys'
import { changedMail, codeMail, confirmMail, type Mailer } from './mail'
import { OPS_TENANT, perIp } from './ops'

type TenantFor = (name: string) => TenantApi
export type Io = { mail: Mailer; waitUntil(p: Promise<unknown>): void; stripeFetch?: typeof fetch }

async function body(req: Request): Promise<Record<string, unknown>> {
  let b: unknown
  try { b = JSON.parse(await req.text()) } catch { throw new ApiError(400, 'invalid_request') }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'invalid_request')
  return b as Record<string, unknown>
}

const emailOf = (b: Record<string, unknown>): string => {
  const email = normalizeEmail(b.email)
  if (!email) throw new ApiError(400, 'invalid_email')
  return email
}

const codeOf = (b: Record<string, unknown>): string => {
  if (typeof b.code !== 'string' || !CODE_RE.test(b.code)) throw new ApiError(400, 'invalid_code')
  return b.code
}

const UNRECOVERABLE: Pick<TenantApi, 'recoverStart' | 'recoverFinish'> = {
  recoverStart: async () => ok({ code: null }),
  recoverFinish: async () => fail(400, 'invalid_code'),
}

const rotateOf = (b: Record<string, unknown>): boolean => {
  if (b.rotate !== undefined && typeof b.rotate !== 'boolean') throw new ApiError(400, 'invalid_request', { field: 'rotate' })
  return b.rotate === true
}

const later = (io: Io, send: Promise<void>) => io.waitUntil(send.catch((e) => console.error(e)))

export async function authEmail(req: Request, master: string, tenantFor: TenantFor, io: Io): Promise<Response> {
  const { tenant, auth } = await verifyKey(req.headers.get('authorization'), master)
  const b = await body(req)
  const email = emailOf(b)
  const rotate = rotateOf(b)
  const stub = tenantFor(tenant)
  if (b.code === undefined) {
    const r = await stub.attachStart(auth, email)
    if (!r.ok) return failResponse(r)
    try {
      await io.mail(codeMail(email, r.value.code, tenant, 'attach'))
    } catch (e) {
      console.error(e)
      return json(502, { error: 'email_failed' })
    }
    return json(202, { email, status: 'code_sent' })
  }
  const r = await stub.attachVerify(auth, email, codeOf(b), rotate)
  if (!r.ok) return failResponse(r)
  later(io, io.mail(confirmMail(email, tenant)))
  if (r.value.previous) later(io, io.mail(changedMail(r.value.previous, tenant)))
  if (!rotate) return json(200, { tenant, email })
  return json(200, { tenant, email, admin_key: await adminKey(master, tenant, r.value.gen) })
}

export async function authRecover(req: Request, master: string, tenantFor: TenantFor, io: Io): Promise<Response> {
  const b = await body(req)
  const limited = await perIp(req, master, tenantFor, 'recoveries')
  if (limited) return limited
  if (typeof b.tenant !== 'string' || !TENANT_RE.test(b.tenant)) throw new ApiError(400, 'invalid_request', { field: 'tenant' })
  const tenant = b.tenant
  const email = emailOf(b)
  const rotate = rotateOf(b)
  const stub = tenant === OPS_TENANT ? UNRECOVERABLE : tenantFor(tenant)
  if (b.code === undefined) {
    const r = await stub.recoverStart(email)
    if (r.ok && r.value.code) later(io, io.mail(codeMail(email, r.value.code, tenant, 'recover')))
    return json(202, { status: 'accepted' })
  }
  const r = await stub.recoverFinish(email, codeOf(b), rotate)
  if (!r.ok) return failResponse(r)
  return json(200, { tenant, admin_key: await adminKey(master, tenant, r.value.gen) })
}
