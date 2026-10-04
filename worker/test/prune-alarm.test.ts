import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { TenantDO } from '../src/tenant'
import { ADMIN, armedFor, setNow, tenant, type Stub } from './helpers'

const T0 = Date.UTC(2026, 9, 1, 10)
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const EMAIL = 'robin@example.com'

const rows = (stub: Stub) => runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => ({
  nextPrune: (s.storage.sql.exec("SELECT v FROM meta WHERE k = 'next_prune'").toArray()[0]?.v as string | undefined) ?? null,
  codes: s.storage.sql.exec('SELECT count(*) AS n FROM codes').one().n as number,
  events: s.storage.sql.exec('SELECT count(*) AS n FROM code_events').one().n as number,
}))
const state = async (stub: Stub) => ({ ...(await rows(stub)), armedFor: await armedFor(stub) })
const wallAlarm = (stub: Stub) => runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => s.storage.getAlarm())
const near = (actual: number | null, expected: number) => {
  expect(actual).not.toBeNull()
  expect(Math.abs(actual! - expected)).toBeLessThan(5_000)
}

describe('code rows are pruned on time by the alarm', () => {
  it('schedules a prune one day after the first code row, and a later row does not push it back', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    expect(await state(stub)).toEqual({ nextPrune: null, armedFor: null, codes: 0, events: 0 })
    expect((await stub.attachStart(ADMIN, EMAIL)).ok).toBe(true)
    const first = await state(stub)
    expect(first).toMatchObject({ nextPrune: String(T0 + DAY), codes: 1, events: 1 })
    near(first.armedFor, T0 + DAY)
    await setNow(stub, T0 + HOUR)
    await stub.attachStart(ADMIN, EMAIL)
    const second = await state(stub)
    expect(second).toMatchObject({ nextPrune: String(T0 + DAY), codes: 1, events: 2 })
    near(second.armedFor, T0 + DAY)
  })

  it('arms the alarm at the due time itself when the clock is the real one', async () => {
    const stub = await tenant()
    const before = Date.now()
    await stub.attachStart(ADMIN, EMAIL)
    const { nextPrune } = await rows(stub)
    expect(Number(nextPrune)).toBeGreaterThanOrEqual(before + DAY)
    expect(await wallAlarm(stub)).toBe(Number(nextPrune))
  })

  it('schedules a prune for code rows written before the alarm existed, when the object next wakes', async () => {
    const stub = await tenant()
    const at = Date.now()
    await runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => {
      s.storage.sql.exec("INSERT INTO code_events (kind, purpose, email, at) VALUES ('send', 'attach', ?, ?)", EMAIL, at)
    })
    expect((await rows(stub)).nextPrune).toBeNull()
    await evictDurableObject(stub)
    expect((await rows(stub)).nextPrune).toBe(String(at + DAY))
    expect(await wallAlarm(stub)).toBe(at + DAY)
  })

  it('leaves an existing due time and its alarm alone when the object wakes', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    await stub.attachStart(ADMIN, EMAIL)
    const parked = await wallAlarm(stub)
    await evictDurableObject(stub)
    expect((await rows(stub)).nextPrune).toBe(String(T0 + DAY))
    expect(await wallAlarm(stub)).toBe(parked)
  })

  it('arms a due time that was left without an alarm when the object wakes', async () => {
    const stub = await tenant()
    await stub.attachStart(ADMIN, EMAIL)
    const { nextPrune } = await rows(stub)
    await runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => s.storage.deleteAlarm())
    await evictDurableObject(stub)
    expect((await rows(stub)).nextPrune).toBe(nextPrune)
    expect(await wallAlarm(stub)).toBe(Number(nextPrune))
  })

  it('keeps an alarm another job armed when the object wakes, and moves it earlier for code rows it finds', async () => {
    const stub = await tenant()
    const meterAt = Date.now() + 7 * DAY
    await runInDurableObject(stub, async (_i: TenantDO, s: DurableObjectState) => {
      s.storage.sql.exec("INSERT INTO meta (k, v) VALUES ('next_meter', ?)", String(meterAt))
      await s.storage.setAlarm(meterAt + 1)
    })
    await evictDurableObject(stub)
    expect(await wallAlarm(stub)).toBe(meterAt + 1)
    const at = Date.now()
    await runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => {
      s.storage.sql.exec("INSERT INTO code_events (kind, purpose, email, at) VALUES ('send', 'attach', ?, ?)", EMAIL, at)
    })
    await evictDurableObject(stub)
    expect((await rows(stub)).nextPrune).toBe(String(at + DAY))
    expect(await wallAlarm(stub)).toBe(at + DAY)
  })

  it('schedules on every kind of code row: a failed redemption and an unmatched recovery request', async () => {
    const failed = await tenant()
    await setNow(failed, T0)
    expect(await failed.attachVerify(ADMIN, EMAIL, '000000', false)).toMatchObject({ ok: false, error: 'invalid_code' })
    expect(await state(failed)).toMatchObject({ nextPrune: String(T0 + DAY), events: 1 })
    const asked = await tenant()
    await setNow(asked, T0)
    expect(await asked.recoverStart(EMAIL)).toEqual({ ok: true, value: { code: null } })
    expect(await state(asked)).toMatchObject({ nextPrune: String(T0 + DAY), events: 1 })
  })

  it('does nothing when it fires before the prune is due', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    await stub.attachStart(ADMIN, EMAIL)
    await setNow(stub, T0 + DAY - 1)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    const after = await state(stub)
    expect(after).toMatchObject({ nextPrune: String(T0 + DAY), codes: 1, events: 1 })
    near(after.armedFor, T0 + DAY)
  })

  it('prunes what has expired, re-arms for the next row, then stops', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    await stub.attachStart(ADMIN, EMAIL)
    await setNow(stub, T0 + HOUR)
    await stub.attachStart(ADMIN, EMAIL)
    await setNow(stub, T0 + DAY)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    const mid = await state(stub)
    expect(mid).toMatchObject({ codes: 0, events: 1, nextPrune: String(T0 + HOUR + DAY) })
    near(mid.armedFor, T0 + HOUR + DAY)
    await setNow(stub, T0 + HOUR + DAY)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await state(stub)).toEqual({ nextPrune: null, armedFor: null, codes: 0, events: 0 })
  })
})
