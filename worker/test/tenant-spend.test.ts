import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { Result } from '../src/errors'
import type { SpendOk } from '../src/tenant'
import { ADMIN, limit, setBillable, setNow, spend, tenant, u } from './helpers'
import { INTERNAL } from '../src/auth'

describe('spend', () => {
  it('records a spend with no limits and returns a signed receipt', async () => {
    const s = await tenant()
    const r = await spend(s, 'acme/bot', { emails: u(1) })
    expect(r.ok && r.value).toMatchObject({
      receipt: { id: 'rcp_1', seq: 1, kind: 'spend', scope: 'acme/bot', body: { emails: 1 }, replay: false },
      remaining: {}, on_outage: 'closed', warnings: [],
    })
  })

  it('blocks when an ancestor limit would be exceeded, and changes nothing', async () => {
    const s = await tenant()
    await limit(s, 'acme', 'usd', u(1))
    expect((await spend(s, 'acme/bot/run-1', { usd: u(0.6) })).ok).toBe(true)
    expect(await spend(s, 'acme/bot/run-2', { usd: u(0.6), tokens: u(10) })).toMatchObject({
      ok: false, status: 402, error: 'limit_exceeded', detail: { scope: 'acme', unit: 'usd', limit: 1, used: 0.6, requested: 0.6, resets: null },
    })
    const after = await spend(s, 'acme/bot/run-3', { usd: u(0.4) })
    expect(after.ok && after.value.remaining.usd).toEqual({ scope: 'acme', left: 0, resets: null })
  })

  it('reports the tightest limit per unit and the strictest outage mode', async () => {
    const s = await tenant()
    await limit(s, 'acme', 'usd', u(10), null, 'open')
    await limit(s, 'acme/bot', 'usd', u(2), null, 'open')
    const r = await spend(s, 'acme/bot', { usd: u(1) })
    expect(r.ok && r.value.remaining.usd).toEqual({ scope: 'acme/bot', left: 1, resets: null })
    expect(r.ok && r.value.on_outage).toBe('open')
    await limit(s, '', 'usd', u(100), null, 'closed')
    const r2 = await spend(s, 'acme/bot', { usd: u(0.1) })
    expect(r2.ok && r2.value.on_outage).toBe('closed')
  })

  it('gives each child its own copy of a per-child limit, and ignores it at the parent itself', async () => {
    const s = await tenant()
    await limit(s, 'acme/refunds', 'refunds', u(1), 'child')
    expect((await spend(s, 'acme/refunds/o-1', { refunds: u(1) })).ok).toBe(true)
    expect(await spend(s, 'acme/refunds/o-1/retry', { refunds: u(1) })).toMatchObject({ status: 402 })
    expect((await spend(s, 'acme/refunds/o-2', { refunds: u(1) })).ok).toBe(true)
    expect((await spend(s, 'acme/refunds', { refunds: u(5) })).ok).toBe(true)
  })

  it('resets windowed usage at the boundary', async () => {
    const s = await tenant()
    await limit(s, 'a', 'calls', u(1), 'day')
    await setNow(s, Date.UTC(2026, 8, 24, 23, 59))
    expect((await spend(s, 'a', { calls: u(1) })).ok).toBe(true)
    expect(await spend(s, 'a', { calls: u(1) })).toMatchObject({ status: 402, detail: { resets: '2026-09-25T00:00:00.000Z' } })
    await setNow(s, Date.UTC(2026, 8, 25, 0, 0))
    expect((await spend(s, 'a', { calls: u(1) })).ok).toBe(true)
  })

  it('warns once usage crosses warn_at, and not before', async () => {
    const s = await tenant()
    await limit(s, 'a', 'usd', u(10), null, 'closed', 0.8)
    const r1 = await spend(s, 'a', { usd: u(7) })
    expect(r1.ok && r1.value.warnings).toEqual([])
    const r2 = await spend(s, 'a/x', { usd: u(1) })
    expect(r2.ok && r2.value.warnings).toEqual([{ scope: 'a', unit: 'usd', used: 8, limit: 10 }])
  })

  it('warns exactly at the warn_at boundary despite float error', async () => {
    const s = await tenant()
    await limit(s, 'a', 'usd', u(10), null, 'closed', 0.07)
    const r = await spend(s, 'a', { usd: u(0.7) })
    expect(r.ok && r.value.warnings).toEqual([{ scope: 'a', unit: 'usd', used: 0.7, limit: 10 }])
  })

  it('lets exactly L of N concurrent spends through', async () => {
    const s = await tenant()
    await limit(s, 'a', 'calls', u(10))
    const rs = await Promise.all(Array.from({ length: 40 }, () => spend(s, 'a/b', { calls: u(1) }) as unknown as Promise<Result<SpendOk>>))
    expect(rs.filter((r) => r.ok)).toHaveLength(10)
    expect(rs.filter((r) => !r.ok && r.status === 402)).toHaveLength(30)
  })

  it('stops a free tenant at the monthly plan allowance, and never a pro one', async () => {
    const s = await tenant('free')
    await spend(s, 'a', { calls: u(1) })
    await setBillable(s, 100_000)
    expect(await spend(s, 'a', { calls: u(1) })).toMatchObject({ status: 402, detail: { scope: '', unit: 'spends', limit: 100_000 } })
    const pro = await tenant('pro')
    await spend(pro, 'a', { calls: u(1) })
    await setBillable(pro, 100_000)
    expect((await spend(pro, 'a', { calls: u(1) })).ok).toBe(true)
  })

  it('refuses every call to an uninitialised tenant', async () => {
    const stub = env.TENANT.get(env.TENANT.idFromName(crypto.randomUUID()))
    expect(await spend(stub, 'a', { calls: u(1) })).toMatchObject({ status: 401, error: 'invalid_key' })
  })
})

describe('spend edges', () => {
  it('reports the tighter ancestor when the deeper limit is looser, and the outermost scope on a tie', async () => {
    const s = await tenant()
    await limit(s, 'acme', 'usd', u(2))
    await limit(s, 'acme/bot', 'usd', u(10))
    const r = await spend(s, 'acme/bot', { usd: u(1) })
    expect(r.ok && r.value.remaining.usd).toEqual({ scope: 'acme', left: 1, resets: null })
    const t = await tenant()
    await limit(t, 'acme', 'usd', u(5))
    await limit(t, 'acme/bot', 'usd', u(5))
    const r2 = await spend(t, 'acme/bot', { usd: u(1) })
    expect(r2.ok && r2.value.remaining.usd).toEqual({ scope: 'acme', left: 4, resets: null })
  })

  it('never warns on a limit without warn_at', async () => {
    const s = await tenant()
    await limit(s, 'a', 'usd', u(1))
    const r = await spend(s, 'a', { usd: u(1) })
    expect(r.ok && r.value.warnings).toEqual([])
  })

  it('warns at exactly warn_at on a limit large enough to swallow the float tolerance', async () => {
    const s = await tenant()
    await limit(s, 'a', 'usd', u(1e9), null, 'closed', 0.5)
    const r = await spend(s, 'a', { usd: u(5e8) })
    expect(r.ok && r.value.warnings).toEqual([{ scope: 'a', unit: 'usd', used: 5e8, limit: 1e9 }])
  })

  it('refuses even internal calls to an uninitialised tenant', async () => {
    const stub = env.TENANT.get(env.TENANT.idFromName(crypto.randomUUID()))
    expect(await spend(stub, 'a', { calls: u(1) }, INTERNAL)).toMatchObject({ status: 401, error: 'invalid_key' })
  })

  it('initialises a tenant once, and a second init changes neither its plan nor its generation', async () => {
    const s = await tenant('pro')
    await s.put(ADMIN, '', { limits: {}, per: null, onOutage: 'closed', warnAt: null, rotateKeys: false, rotateAdmin: true })
    expect(await s.init('abcdefghijkl', 'free')).toBe(false)
    expect(await spend(s, 'a', { calls: u(1) })).toMatchObject({ status: 401 })
    const gen2 = { ...ADMIN, gen: 2 }
    await spend(s, 'a', { calls: u(1) }, gen2)
    await setBillable(s, 100_000)
    expect((await spend(s, 'a', { calls: u(1) }, gen2)).ok).toBe(true)
  })
})
