import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { TenantDO } from '../src/tenant'
import { ADMIN, limit, setBillable, setNow, spend, tenant, u } from './helpers'
import type { Stub } from './helpers'

const entryCount = (s: Stub) =>
  runInDurableObject(s, (_i: TenantDO, state: DurableObjectState) =>
    (state.storage.sql.exec('SELECT count(*) AS n FROM entries').toArray()[0] as { n: number }).n)

describe('settle', () => {
  it('moves usage from the held amount to the actual amount', async () => {
    const s = await tenant()
    await limit(s, 'a', 'usd', u(10))
    const h = await s.spend(ADMIN, 'a/r', { usd: u(6) }, 'k1', 'h1')
    if (!h.ok) throw new Error(h.error)
    const r = await s.settle(ADMIN, 'a/r', 'k1', { usd: u(2) }, 's1')
    if (!r.ok) throw new Error(r.error)
    expect(r.value.remaining.usd.left).toBe(8)
    expect(r.value.receipt).toMatchObject({ kind: 'settle', scope: 'a/r', body: { ref: h.value.receipt.seq, held: { usd: 6 }, actual: { usd: 2 } } })
  })

  it('releases a hold when settled to zero, and records usage past the limit', async () => {
    const s = await tenant()
    await limit(s, 'a', 'usd', u(10))
    await s.spend(ADMIN, 'a', { usd: u(9) }, 'k1', 'h1')
    await s.settle(ADMIN, 'a', 'k1', { usd: 0 }, 's1')
    await s.spend(ADMIN, 'a', { usd: u(5) }, 'k2', 'h2')
    const over = await s.settle(ADMIN, 'a', 'k2', { usd: u(12) }, 's2')
    expect(over.ok && over.value.remaining.usd.left).toBe(-2)
    expect(await spend(s, 'a', { usd: u(0.01) })).toMatchObject({ status: 402 })
  })

  it('replays a repeated settle and refuses a different one', async () => {
    const s = await tenant()
    await s.spend(ADMIN, 'a', { usd: u(3) }, 'k1', 'h1')
    const first = await s.settle(ADMIN, 'a', 'k1', { usd: u(1) }, 's1')
    const again = await s.settle(ADMIN, 'a', 'k1', { usd: u(1) }, 's1')
    if (!first.ok || !again.ok) throw new Error('expected ok')
    expect(again.value.receipt).toEqual({ ...first.value.receipt, replay: true })
    expect(await s.settle(ADMIN, 'a', 'k1', { usd: u(2) }, 's2')).toMatchObject({ status: 409 })
  })

  it('404s an unknown key, and 409s a key held at another scope', async () => {
    const s = await tenant()
    expect(await s.settle(ADMIN, 'a', 'nope', { usd: 0 }, 's')).toMatchObject({ status: 404, error: 'unknown_spend' })
    await s.spend(ADMIN, 'a', { usd: u(1) }, 'k1', 'h1')
    expect(await s.settle(ADMIN, 'b', 'k1', { usd: 0 }, 's')).toMatchObject({ status: 409 })
  })

  it('leaves a counter alone once its window has rolled over', async () => {
    const s = await tenant()
    await limit(s, 'a', 'usd', u(10), 'day')
    await setNow(s, Date.UTC(2026, 8, 24, 23, 59))
    await s.spend(ADMIN, 'a', { usd: u(5) }, 'k1', 'h1')
    await setNow(s, Date.UTC(2026, 8, 25, 0, 1))
    const r = await s.settle(ADMIN, 'a', 'k1', { usd: u(1) }, 's1')
    expect(r.ok && r.value.remaining.usd.left).toBe(10)
  })

  it('refuses an actual naming a unit the hold did not have, and changes nothing', async () => {
    const s = await tenant()
    await limit(s, 'a', 'usd', u(5))
    await s.spend(ADMIN, 'a', { usd: u(3) }, 'k1', 'h1')
    const before = await entryCount(s)
    expect(await s.settle(ADMIN, 'a', 'k1', { usd: u(1), calls: u(1) }, 's1')).toMatchObject({ status: 400, error: 'invalid_unit', detail: { unit: 'calls' } })
    expect(await entryCount(s)).toBe(before)
    expect(await spend(s, 'a', { usd: u(2) })).toMatchObject({ ok: true })
    expect(await spend(s, 'a', { usd: u(0.01) })).toMatchObject({ status: 402 })
  })

  it('refuses an actual that drops a unit the hold had, and changes nothing', async () => {
    const s = await tenant()
    await s.spend(ADMIN, 'a', { tokens: u(3), usd: u(1) }, 'k1', 'h1')
    const before = await entryCount(s)
    expect(await s.settle(ADMIN, 'a', 'k1', { usd: u(1) }, 's1')).toMatchObject({ status: 400, error: 'invalid_unit', detail: { unit: 'tokens' } })
    expect(await entryCount(s)).toBe(before)
  })

  it('is not billed', async () => {
    const s = await tenant('free')
    await s.spend(ADMIN, 'a', { usd: u(1) }, 'k1', 'h1')
    await setBillable(s, 99_999)
    await s.settle(ADMIN, 'a', 'k1', { usd: u(1) }, 's1')
    expect((await spend(s, 'a', { usd: u(1) })).ok).toBe(true)
  })
})

describe('settle edges', () => {
  it('confines a spend key to its subtree', async () => {
    const s = await tenant()
    await s.spend(ADMIN, 'b', { usd: u(1) }, 'k1', 'h1')
    expect(await s.settle({ kind: 'spend', gen: 1, epoch: 0, keyScope: 'a' }, 'b', 'k1', { usd: u(1) }, 's1')).toMatchObject({ status: 403, error: 'out_of_scope' })
  })

  it('treats a key that names a settle, not a spend, as unknown', async () => {
    const s = await tenant()
    await s.spend(ADMIN, 'a', { usd: u(1) }, 'k1', 'h1')
    await s.settle(ADMIN, 'a', 'k1', { usd: u(1) }, 's1')
    expect(await s.settle(ADMIN, 'a', 'k1#settle', { usd: u(1) }, 's2')).toMatchObject({ status: 404, error: 'unknown_spend' })
  })

  it('names the conflict for another scope and for another actual', async () => {
    const s = await tenant()
    await s.spend(ADMIN, 'a', { usd: u(3) }, 'k1', 'h1')
    expect(await s.settle(ADMIN, 'b', 'k1', { usd: u(1) }, 's1')).toMatchObject({ status: 409, error: 'idempotency_conflict' })
    await s.settle(ADMIN, 'a', 'k1', { usd: u(1) }, 's1')
    expect(await s.settle(ADMIN, 'a', 'k1', { usd: u(2) }, 's2')).toMatchObject({ status: 409, error: 'idempotency_conflict' })
  })

  it('marks a first settle as no replay', async () => {
    const s = await tenant()
    await s.spend(ADMIN, 'a', { usd: u(3) }, 'k1', 'h1')
    const r = await s.settle(ADMIN, 'a', 'k1', { usd: u(1) }, 's1')
    expect(r.ok && r.value.receipt.replay).toBe(false)
  })
})
