import { INTERNAL } from './auth'
import type { TenantApi } from './core'
import { failResponse, json } from './errors'
import { hmacHex } from './keys'

export const OPS_TENANT = 'solenoidops2'

export function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const [head, tail = ''] = ip.split('::')
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : []
  return [...h, ...Array(8 - h.length - t.length).fill('0'), ...t].slice(0, 4).map((x) => x.padStart(4, '0')).join(':')
}

export async function perIp(req: Request, master: string, tenantFor: (name: string) => TenantApi, unit: 'signups' | 'recoveries'): Promise<Response | null> {
  const ops = tenantFor(OPS_TENANT)
  await ops.init(OPS_TENANT, 'internal')
  const who = (await hmacHex(master, `ip:${ipKey(req.headers.get('cf-connecting-ip') ?? 'unknown')}`)).slice(0, 16)
  const r = await ops.spend(INTERNAL, `${unit}/${who}`, { [unit]: 1_000_000 }, crypto.randomUUID(), '')
  if (r.ok) return null
  return r.status === 402 ? json(429, { error: 'rate_limited' }) : failResponse(r)
}
