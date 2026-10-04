import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { ADMIN, limit, setBillable, setNow, spend, sql, tenant, u, type Stub } from './helpers'
import { publicJwk, verifyChain, type Sealed } from '../src/chain'
import type { Auth } from '../src/auth'
import type { PutReq, TenantDO, View } from '../src/tenant'

const SPEND_KEY = (keyScope: string, epoch = 0): Auth => ({ kind: 'spend', gen: 1, epoch, keyScope })
const put = (o: Partial<PutReq>): PutReq => ({ limits: {}, per: null, onOutage: 'closed', warnAt: null, rotateKeys: false, rotateAdmin: false, ...o })

async function allEntries(s: Stub): Promise<Sealed[]> {
  const out: Sealed[] = []
  let before: number | undefined
  for (;;) {
    const g = await s.get(ADMIN, '', before)
    if (!g.ok) throw new Error(g.error)
    const v = g.value as unknown as View
    for (const e of v.entries) out.push(e)
    if (v.next === null) return out.reverse()
    before = v.next
  }
}

describe('put', () => {
  it('starts a new limit from the true usage of its window, holds and settles included', async () => {
    const s = await tenant()
    await setNow(s, Date.UTC(2026, 8, 24, 10))
    await spend(s, 'acme/a', { usd: u(3) })
    await s.spend(ADMIN, 'acme/b', { usd: u(6) }, 'hold', 'h')
    await s.settle(ADMIN, 'acme/b', 'hold', { usd: u(4) }, 's')
    await spend(s, 'other', { usd: u(50) })
    const v = await limit(s, 'acme', 'usd', u(10), 'day')
    expect(v.limits).toContainEqual(expect.objectContaining({ scope: 'acme', unit: 'usd', used: 7, left: 3 }))
    expect(await spend(s, 'acme/c', { usd: u(3.5) })).toMatchObject({ status: 402 })
  })

  it('backfills a settle only when the hold it settles falls in the window being backfilled', async () => {
    const s = await tenant()
    await setNow(s, Date.UTC(2026, 8, 24, 23, 59))
    await s.spend(ADMIN, 'acme', { usd: u(5) }, 'hold', 'h')
    await setNow(s, Date.UTC(2026, 8, 25, 0, 1))
    await s.settle(ADMIN, 'acme', 'hold', { usd: u(1) }, 's')
    const v = await limit(s, 'acme', 'usd', u(10), 'day')
    expect(v.limits).toContainEqual(expect.objectContaining({ scope: 'acme', unit: 'usd', used: 0, left: 10 }))
    expect((await spend(s, 'acme/x', { usd: u(10) })).ok).toBe(true)
    expect(await spend(s, 'acme/x', { usd: u(0.01) })).toMatchObject({ status: 402 })
  })

  it('backfills a settle across a window boundary for a lifetime limit, since the hold and the settle share one window', async () => {
    const s = await tenant()
    await setNow(s, Date.UTC(2026, 8, 24, 23, 59))
    await s.spend(ADMIN, 'acme', { usd: u(5) }, 'hold', 'h')
    await setNow(s, Date.UTC(2026, 8, 25, 0, 1))
    await s.settle(ADMIN, 'acme', 'hold', { usd: u(1) }, 's')
    const v = await limit(s, 'acme', 'usd', u(10))
    expect(v.limits).toContainEqual(expect.objectContaining({ scope: 'acme', unit: 'usd', used: 1, left: 9 }))
  })

  it('backfills per-child usage for each child separately, and shows the limit at its own scope', async () => {
    const s = await tenant()
    await spend(s, 'r/o-1', { refunds: u(1) })
    const v = await limit(s, 'r', 'refunds', u(1), 'child')
    expect(v.limits).toEqual([expect.objectContaining({ scope: 'r', unit: 'refunds', limit: 1, per: 'child', used: null, left: null })])
    expect(await spend(s, 'r/o-1', { refunds: u(1) })).toMatchObject({ status: 402 })
    expect((await spend(s, 'r/o-2', { refunds: u(1) })).ok).toBe(true)
  })

  it('treats 0 as a kill switch and null as removal', async () => {
    const s = await tenant()
    await limit(s, 'bot', 'usd', 0)
    expect(await spend(s, 'bot/run', { usd: u(0.01) })).toMatchObject({ status: 402 })
    await limit(s, 'bot', 'usd', null)
    expect((await spend(s, 'bot/run', { usd: u(0.01) })).ok).toBe(true)
  })

  it('stores warn_at and reports it in views', async () => {
    const s = await tenant()
    const v = await limit(s, 'a', 'usd', u(10), null, 'closed', 0.8)
    expect(v.limits[0]).toMatchObject({ warn_at: 0.8 })
  })

  it('keeps a chain that verifies through a seeded random mix of operations, and fails on any tampered field', async () => {
    const s = await tenant()
    let seed = 42
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n)
    for (let i = 0; i < 60; i++) {
      const op = rnd(4)
      const scope = ['a', 'a/x', 'b', 'b/y/z'][rnd(4)]
      if (op === 0) await limit(s, scope, 'usd', u(rnd(100) + 50), (['day', null, 'child'] as const)[rnd(3)])
      else if (op === 1) { await s.spend(ADMIN, scope, { usd: u(1) }, `k${i}`, `h${i}`); await s.settle(ADMIN, scope, `k${i}`, { usd: u(0.5) }, `s${i}`) }
      else if (op === 2) await s.put(ADMIN, scope, put({ rotateKeys: true }))
      else await spend(s, scope, { usd: u(0.25), calls: u(1) })
    }
    const jwk = publicJwk(env.SIGNING_KEY)
    expect(await verifyChain(await allEntries(s), jwk)).toBe(true)
    for (const col of ['body', 'scope', 'at', 'kind', 'kid', 'prev', 'hash', 'sig']) {
      const t = await tenant()
      await spend(t, 'a', { n: u(1) })
      await spend(t, 'a', { n: u(2) })
      await sql(t, `UPDATE entries SET ${col} = ? WHERE seq = 1`, col === 'body' ? '{"n":9}' : col === 'kind' ? 'limit' : 'x')
      expect(await verifyChain(await allEntries(t), jwk)).toBe(false)
    }
  })

  it('bumps the scope epoch on rotate_keys, and the generation on rotate_admin', async () => {
    const s = await tenant()
    const r = await s.put(ADMIN, 'a', put({ rotateKeys: true }))
    expect(r.ok && r.value.epoch).toBe(1)
    expect(await spend(s, 'a/x', { usd: u(1) }, SPEND_KEY('a', 0))).toMatchObject({ status: 401 })
    expect((await spend(s, 'a/x', { usd: u(1) }, SPEND_KEY('a', 1))).ok).toBe(true)
    const r2 = await s.put(ADMIN, '', put({ rotateAdmin: true }))
    expect(r2.ok && r2.value.gen).toBe(2)
    expect(await spend(s, 'a/x', { usd: u(1) })).toMatchObject({ status: 401 })
  })

  it('refuses rotate_admin below the root, the reserved unit, and spend keys', async () => {
    const s = await tenant()
    expect(await s.put(ADMIN, 'a', put({ rotateAdmin: true }))).toMatchObject({ status: 400 })
    expect(await s.put(ADMIN, '', put({ limits: { spends: u(1) } }))).toMatchObject({ status: 403, error: 'plan_owned' })
    expect(await s.put(SPEND_KEY(''), 'a', put({ limits: { usd: u(1) } }))).toMatchObject({ status: 403, error: 'admin_required' })
  })

  it('does not count limit changes as billable spends', async () => {
    const s = await tenant('free')
    await spend(s, 'a', { x: u(1) })
    await setBillable(s, 99_999)
    await limit(s, 'a', 'y', u(5))
    expect((await spend(s, 'a', { x: u(1) })).ok).toBe(true)
  })
})

describe('get', () => {
  it('shows every limit that applies at a scope, from its point of view', async () => {
    const s = await tenant()
    await limit(s, '', 'usd', u(100))
    await limit(s, 'acme', 'usd', u(10))
    await spend(s, 'acme/bot', { usd: u(2) })
    const g = await s.get(ADMIN, 'acme/bot')
    expect(g.ok && g.value.limits.map((l) => [l.scope, l.left])).toEqual(expect.arrayContaining([['', 98], ['acme', 8]]))
  })

  it('lists direct children and pages entries newest first', async () => {
    const s = await tenant()
    for (let i = 0; i < 55; i++) await spend(s, `acme/run-${i % 3}/x`, { n: u(1) })
    await spend(s, 'acme2', { n: u(1) })
    const g = await s.get(ADMIN, 'acme')
    if (!g.ok) throw new Error(g.error)
    const v = g.value as unknown as View
    expect(v.children).toEqual(['run-0', 'run-1', 'run-2'])
    expect(v.entries).toHaveLength(50)
    expect(v.entries.every((e) => e.scope.startsWith('acme/'))).toBe(true)
    const g2 = await s.get(ADMIN, 'acme', v.next!)
    if (!g2.ok) throw new Error(g2.error)
    const v2 = g2.value as unknown as View
    expect(v2.entries).toHaveLength(5)
    expect(v2.next).toBeNull()
  })

  it('confines a spend key to its subtree', async () => {
    const s = await tenant()
    expect((await s.get(SPEND_KEY('acme'), 'acme/bot')).ok).toBe(true)
    expect(await s.get(SPEND_KEY('acme'), 'other')).toMatchObject({ status: 403, error: 'out_of_scope' })
    expect(await spend(s, 'acme2', { n: u(1) }, SPEND_KEY('acme'))).toMatchObject({ status: 403 })
  })
})

const counters = (s: Stub) =>
  runInDurableObject(s, (_i: TenantDO, state: DurableObjectState) =>
    state.storage.sql.exec('SELECT limit_scope, unit, scope, used FROM counters ORDER BY scope').toArray())

const view = async (s: Stub, scope: string, before?: number, auth: Auth = ADMIN): Promise<View> => {
  const g = await s.get(auth, scope, before)
  if (!g.ok) throw new Error(g.error)
  return g.value as unknown as View
}

describe('put edges', () => {
  it('records a limit PUT in the chain with its exact body, and leaves the key epoch alone', async () => {
    const s = await tenant()
    const v = await limit(s, 'a/b', 'usd', u(5), 'day', 'open', 0.8)
    expect(v.epoch).toBe(0)
    await limit(s, 'a/b', 'usd', null)
    const [removed, set] = (await view(s, 'a/b')).entries
    expect(set).toMatchObject({ kind: 'limit', scope: 'a/b', body: { limits: { usd: 5 }, per: 'day', on_outage: 'open', warn_at: 0.8 }, replay: false })
    expect(removed).toMatchObject({ kind: 'limit', body: { limits: { usd: null }, per: null, on_outage: 'closed' } })
    expect(Object.keys(set.body).sort()).toEqual(['limits', 'on_outage', 'per', 'warn_at'])
    expect(Object.keys(removed.body).sort()).toEqual(['limits', 'on_outage', 'per'])
  })

  it('records rotations as rotate entries that say what rotated', async () => {
    const s = await tenant()
    await s.put(ADMIN, 'a', put({ rotateKeys: true }))
    await s.put(ADMIN, '', put({ rotateAdmin: true }))
    const [admin, keys] = (await view(s, '', undefined, { ...ADMIN, gen: 2 })).entries
    expect(keys).toMatchObject({ kind: 'rotate', scope: 'a', body: { limits: {}, rotate_keys: true } })
    expect(keys.body).not.toHaveProperty('rotate_admin')
    expect(admin).toMatchObject({ kind: 'rotate', scope: '', body: { limits: {}, rotate_admin: true } })
    expect(admin.body).not.toHaveProperty('rotate_keys')
  })

  it('refuses rotate_admin below the root with the reason', async () => {
    const s = await tenant()
    expect(await s.put(ADMIN, 'a', put({ rotateAdmin: true }))).toEqual({ ok: false, status: 400, error: 'invalid_limit', detail: { reason: 'rotate_admin is only allowed on the root scope' } })
  })

  it('brings a limited scope into existence as a child of its parent, and never lists the root as a child', async () => {
    const s = await tenant()
    await limit(s, 'a/b/c', 'usd', u(1))
    expect((await view(s, 'a/b')).children).toEqual(['c'])
    expect((await view(s, '')).children).toEqual(['a'])
  })

  it('keeps no counter for a removed limit, and none for a child with nothing to count', async () => {
    const s = await tenant()
    await spend(s, 'r/x', { calls: u(1) })
    await spend(s, 'r/y', { usd: u(2) })
    await s.spend(ADMIN, 'r/z', { tokens: u(9) }, 'hold', 'h')
    await s.settle(ADMIN, 'r/z', 'hold', { tokens: u(4) }, 's')
    await limit(s, 'r', 'usd', u(5), 'child')
    expect(await counters(s)).toEqual([{ limit_scope: 'r', unit: 'usd', scope: 'r/y', used: u(2) }])
    await limit(s, 'r', 'usd', null)
    expect(await counters(s)).toEqual([])
  })
})

describe('get edges', () => {
  it('ends paging with next null at exactly one full page', async () => {
    const s = await tenant()
    for (let i = 0; i < 50; i++) await spend(s, 'a', { n: u(1) })
    const v = await view(s, 'a')
    expect(v.entries).toHaveLength(50)
    expect(v.next).toBeNull()
    await spend(s, 'a', { n: u(1) })
    const v2 = await view(s, 'a')
    expect(v2.next).toBe(2)
    expect((await view(s, 'a', v2.next!)).entries.map((e) => e.seq)).toEqual([1])
  })
})
