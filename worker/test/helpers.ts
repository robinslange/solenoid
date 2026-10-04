import { env, runInDurableObject } from 'cloudflare:test'
import type { Auth } from '../src/auth'
import type { TenantDO } from '../src/tenant'
import type { Per } from '../src/windows'

export type Stub = DurableObjectStub<TenantDO>
export const ADMIN: Auth = { kind: 'admin', gen: 1, epoch: 0, keyScope: '' }
export const u = (n: number) => Math.round(n * 1_000_000)

export async function tenant(plan: 'free' | 'pro' | 'internal' = 'free'): Promise<Stub> {
  const stub = env.TENANT.get(env.TENANT.idFromName(crypto.randomUUID()))
  await stub.init('abcdefghijkl', plan)
  return stub
}

export const sql = (stub: Stub, query: string, ...args: SqlStorageValue[]) =>
  runInDurableObject(stub, (_i: TenantDO, state: DurableObjectState) => { state.storage.sql.exec(query, ...args) })

export async function limit(stub: Stub, scope: string, unit: string, amount: number | null, per: Per = null, onOutage: 'open' | 'closed' = 'closed', warnAt: number | null = null) {
  const r = await stub.put(ADMIN, scope, { limits: { [unit]: amount }, per, onOutage, warnAt, rotateKeys: false, rotateAdmin: false })
  if (!r.ok) throw new Error(`put failed: ${r.error}`)
  return r.value
}

export const ALARM_PARK_MS = 365 * 24 * 60 * 60_000

export const setNow = (stub: Stub, t: number) => runInDurableObject(stub, (i: TenantDO) => {
  i.now = () => t
  i.alarmAt = (due) => Date.now() + ALARM_PARK_MS + due - t
})

export const armedFor = (stub: Stub) => runInDurableObject(stub, async (i: TenantDO, s: DurableObjectState) => {
  const a = await s.storage.getAlarm()
  return a === null ? null : a - Date.now() - ALARM_PARK_MS + i.now()
})

export async function setBillable(stub: Stub, n: number) {
  await sql(stub, "UPDATE meta SET v = CAST((SELECT coalesce(max(seq), 0) FROM entries) - ? AS TEXT) WHERE k = 'seq_month_start'", n)
  await sql(stub, "UPDATE meta SET v = '0' WHERE k = 'nonspend_month'")
}

let k = 0
export const spend = (stub: Stub, scope: string, amounts: Record<string, number>, auth: Auth = ADMIN) =>
  stub.spend(auth, scope, amounts, `idem-${++k}`, `hash-${k}`)
