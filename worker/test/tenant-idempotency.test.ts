import { describe, expect, it } from 'vitest'
import { ADMIN, limit, sql, tenant, u } from './helpers'
import type { Auth } from '../src/auth'

describe('idempotency', () => {
  it('replays the original receipt without spending again', async () => {
    const s = await tenant()
    await limit(s, 'a', 'calls', u(1))
    const first = await s.spend(ADMIN, 'a', { calls: u(1) }, 'key-1', 'h1')
    const again = await s.spend(ADMIN, 'a', { calls: u(1) }, 'key-1', 'h1')
    if (!first.ok || !again.ok) throw new Error('expected ok')
    expect(again.value.receipt).toEqual({ ...first.value.receipt, replay: true })
    expect(again.value.remaining.calls.left).toBe(0)
  })
  it('refuses the same key with a different body', async () => {
    const s = await tenant()
    await s.spend(ADMIN, 'a', { calls: u(1) }, 'key-1', 'h1')
    expect(await s.spend(ADMIN, 'a', { calls: u(2) }, 'key-1', 'h2')).toMatchObject({ ok: false, status: 409, error: 'idempotency_conflict' })
  })
  it('refuses the same key at another scope, so no limit is bypassed and no receipt leaks', async () => {
    const s = await tenant()
    await limit(s, 'b', 'emails', 0)
    await s.spend(ADMIN, 'a/x', { emails: u(1) }, 'order-7', 'H')
    expect(await s.spend(ADMIN, 'b/y', { emails: u(1) }, 'order-7', 'H')).toMatchObject({ status: 409 })
    const confined: Auth = { kind: 'spend', gen: 1, epoch: 0, keyScope: 'b' }
    const r = await s.spend(confined, 'b/y', { emails: u(1) }, 'order-7', 'H')
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain('a/x')
  })
  it('replays even when the limit has since run out', async () => {
    const s = await tenant()
    await limit(s, 'a', 'calls', u(1))
    await s.spend(ADMIN, 'a', { calls: u(1) }, 'key-1', 'h1')
    expect((await s.spend(ADMIN, 'a', { calls: u(1) }, 'key-1', 'h1')).ok).toBe(true)
  })
  it('keeps idempotency keys unique in storage too, not only in code', async () => {
    const s = await tenant()
    await s.spend(ADMIN, 'a', { calls: u(1) }, 'key-1', 'h1')
    const insert = (seq: number, idem: string | null) =>
      sql(s, "INSERT INTO entries (seq, kind, scope, body, at, kid, idem, prev, hash, sig) VALUES (?, 'spend', 'a', '{}', 'x', 'k1', ?, 'p', 'h', 's')", seq, idem)
    await expect(insert(90, 'key-1')).rejects.toThrow(/UNIQUE/)
    await insert(91, null)
    await insert(92, null)
  })
})
