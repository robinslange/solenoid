import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LimitExceeded } from '@solenoid.systems/sdk'
import { describe, expect, it } from 'vitest'
import { client, code, ok, user } from './harness'

const adminKey = (config: string) => (JSON.parse(readFileSync(join(config, 'credentials'), 'utf8')) as { admin_key: string }).admin_key

describe('concurrent callers against the local Worker', () => {
  it('lets exactly L of N concurrent SDK spends through, each from its own client', async () => {
    const u = user()
    await ok(u.cli('init'))
    await ok(u.cli('limit', 'acme', 'calls=7'))
    const key = await ok(u.cli('key', 'acme/bot'))
    const results = await Promise.all(Array.from({ length: 30 }, () => code(client(key).spend('acme/bot', { calls: 1 }))))
    expect(results.filter((r) => r === 'ok')).toHaveLength(7)
    expect(results.filter((r) => r === '402 limit_exceeded')).toHaveLength(23)
    expect(await ok(u.cli('ls', 'acme'))).toMatch(/^calls +7 +lifetime +used 7 +left 0 /m)
  })

  it('holds before each model call and settles after, so concurrent run.llm calls cannot overshoot a tokens limit', async () => {
    const u = user()
    await ok(u.cli('init'))
    await ok(u.cli('limit', 'acme', 'tokens=500', '--per', 'day'))
    const key = await ok(u.cli('key', 'acme/agent'))
    const allowed: number[] = []
    const provider = async (req: { max_tokens: number }) => {
      allowed.push(req.max_tokens)
      await new Promise((r) => setTimeout(r, 100))
      return { usage: { prompt_tokens: 14, completion_tokens: 20 } }
    }
    const req = { model: 'e2e-model', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }
    const outcomes = await Promise.all(Array.from({ length: 10 }, () =>
      client(key).run('acme/agent', (r) => r.llm(provider, req)).then(() => 'ok', (e: unknown) => (e instanceof LimitExceeded ? `${e.status} ${e.unit}` : String(e)))))

    const succeeded = outcomes.filter((o) => o === 'ok').length
    expect(succeeded).toBeGreaterThan(0)
    expect(outcomes.filter((o) => o !== 'ok')).toEqual(Array(10 - succeeded).fill('402 tokens'))
    expect(allowed).toHaveLength(succeeded)
    expect(allowed.every((n) => n >= 1 && n <= 100)).toBe(true)
    expect(allowed.reduce((worst, n) => worst + 14 + n, 0)).toBeLessThanOrEqual(500)
    expect(await ok(u.cli('ls', 'acme'))).toMatch(new RegExp(`^tokens +500 +day +used ${34 * succeeded} +left ${500 - 34 * succeeded} `, 'm'))

    const { entries } = await client(adminKey(u.config)).get('acme/agent')
    const holds = new Map<number, number>()
    let outstanding = 0
    for (const e of [...entries].reverse()) {
      if (e.kind === 'spend') holds.set(e.seq, e.body.tokens as number)
      const change = e.kind === 'spend' ? (e.body.tokens as number) : (e.body.actual as { tokens: number }).tokens - holds.get(e.body.ref as number)!
      outstanding += change
      expect(outstanding).toBeLessThanOrEqual(500)
    }
    expect([...holds.values()].sort()).toEqual(allowed.map((n) => 14 + n).sort())
    expect(entries.filter((e) => e.kind === 'settle').map((e) => e.body.ref).sort()).toEqual([...holds.keys()].sort())
    expect(outstanding).toBe(34 * succeeded)
  })

  it('lets a per: child limit act as an at-most-once guard under concurrent retries', async () => {
    const u = user()
    await ok(u.cli('init'))
    await ok(u.cli('limit', 'acme/refunds', 'refunds=1', '--per', 'child'))
    const key = await ok(u.cli('key', 'acme/refunds'))
    const attempts = await Promise.all(Array.from({ length: 8 }, () => code(client(key).spend('acme/refunds/order-1', { refunds: 1 }))))
    expect(attempts.filter((r) => r === 'ok')).toHaveLength(1)
    expect(attempts.filter((r) => r === '402 limit_exceeded')).toHaveLength(7)
    expect(await code(client(key).spend('acme/refunds/order-1/partial', { refunds: 1 }))).toBe('402 limit_exceeded')
    expect(await code(client(key).spend('acme/refunds/order-2', { refunds: 1 }))).toBe('ok')

    const bot = client(key)
    const first = await bot.spend('acme/refunds/order-3', { refunds: 1 }, { idempotencyKey: 'refund-order-3' })
    const retried = await bot.spend('acme/refunds/order-3', { refunds: 1 }, { idempotencyKey: 'refund-order-3' })
    expect(retried).toEqual({ ...first!, replay: true })
    expect(await ok(u.cli('ls', 'acme/refunds'))).toMatch(/^refunds +1 +child +tracked separately per child/m)
  })
})
