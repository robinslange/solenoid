import assert from 'node:assert/strict'
import { LimitExceeded, SolenoidError, SolenoidUnavailable, recover, requestRecovery, solenoid } from '../sdk/src/index'

export type Target = {
  fetch: typeof fetch
  api: string
  signup(): Promise<{ tenant: string; admin_key: string }>
  setNow?(ms: number): void
  outbox?(): Promise<{ to: string; subject: string; text: string }[]>
}

export type Scenario = { name: string; needsClock?: true; needsOutbox?: true; run(t: Target): Promise<void> }

async function account(t: Target, f: typeof fetch = t.fetch) {
  const { admin_key } = await t.signup()
  const admin = solenoid({ key: admin_key, api: t.api, fetch: f })
  const agent = async (scope: string) => solenoid({ key: await admin.deriveKey(scope), api: t.api, fetch: f })
  return { admin, agent }
}

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof SolenoidError ? e.code : String(e)))

export const scenarios: Scenario[] = [
  {
    name: 'lets exactly L of N concurrent spends through',
    async run(t) {
      const { admin, agent } = await account(t)
      await admin.limit('acme', { calls: 5 })
      const bot = await agent('acme/bot')
      const results = await Promise.all(Array.from({ length: 20 }, () => code(bot.spend('acme/bot', { calls: 1 }))))
      assert.equal(results.filter((r) => r === 'ok').length, 5)
      assert.equal(results.filter((r) => r === 'limit_exceeded').length, 15)
    },
  },
  {
    name: 'blocks a spend on the limit of an ancestor scope',
    async run(t) {
      const { admin, agent } = await account(t)
      await admin.limit('acme', { emails: 1 })
      const bot = await agent('acme')
      await bot.spend('acme/a/b', { emails: 1 })
      const refused = await bot.spend('acme/c', { emails: 1 }).catch((e: unknown) => e)
      assert.ok(refused instanceof LimitExceeded)
      assert.equal(refused.scope, 'acme')
    },
  },
  {
    name: 'counts a per: child limit separately for each child',
    async run(t) {
      const { admin, agent } = await account(t)
      await admin.limit('acme', { refunds: 1, per: 'child' })
      const bot = await agent('acme')
      await bot.spend('acme/u1/order', { refunds: 1 })
      assert.equal(await code(bot.spend('acme/u1', { refunds: 1 })), 'limit_exceeded')
      assert.equal(await code(bot.spend('acme/u2', { refunds: 1 })), 'ok')
    },
  },
  {
    name: 'opens a fresh window when the hour rolls over',
    needsClock: true,
    async run(t) {
      const start = Date.UTC(2030, 0, 1, 10, 30)
      t.setNow!(start)
      const { admin, agent } = await account(t)
      await admin.limit('acme', { calls: 1, per: 'hour' })
      const bot = await agent('acme')
      await bot.spend('acme', { calls: 1 })
      const refused = await bot.spend('acme', { calls: 1 }).catch((e: unknown) => e)
      assert.ok(refused instanceof LimitExceeded)
      assert.equal(refused.resets, '2030-01-01T11:00:00.000Z')
      t.setNow!(Date.UTC(2030, 0, 1, 11))
      assert.equal(await code(bot.spend('acme', { calls: 1 })), 'ok')
    },
  },
  {
    name: 'replays a spend under the same idempotency key, and refuses a different body with 409',
    async run(t) {
      const { admin, agent } = await account(t)
      await admin.limit('acme', { calls: 1 })
      const bot = await agent('acme')
      const first = await bot.spend('acme', { calls: 1 }, { idempotencyKey: 'order-7' })
      const again = await bot.spend('acme', { calls: 1 }, { idempotencyKey: 'order-7' })
      assert.deepEqual(again, { ...first!, replay: true })
      const conflict = await bot.spend('acme', { calls: 2 }, { idempotencyKey: 'order-7' }).catch((e: unknown) => e)
      assert.ok(conflict instanceof SolenoidError)
      assert.deepEqual([conflict.status, conflict.code], [409, 'idempotency_conflict'])
    },
  },
  {
    name: 'holds the worst case before a model call, then settles the actual usage',
    async run(t) {
      const { admin, agent } = await account(t)
      await admin.limit('acme', { tokens: 1000, per: 'day' })
      const bot = await agent('acme/bot')
      let calls = 0
      const provider = async (_req: object) => { calls++; return { usage: { prompt_tokens: 12, completion_tokens: 8 } } }
      await bot.at('acme/bot').llm(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
      assert.equal(calls, 1)
      const { entries } = await admin.get('acme/bot')
      const hold = entries.find((e) => e.kind === 'spend')!
      const settle = entries.find((e) => e.kind === 'settle')!
      assert.equal(settle.body.ref, hold.seq)
      assert.equal((await admin.get('acme')).limits.find((l) => l.unit === 'tokens')!.used, 20)
    },
  },
  {
    name: 'signs a hash chain that verifyChain accepts, and rejects once an entry is altered',
    async run(t) {
      const { admin, agent } = await account(t)
      await admin.limit('acme', { emails: 5, per: 'day' })
      const bot = await agent('acme/bot')
      for (const run of ['run-1', 'run-2', 'run-3']) await bot.spend(`acme/bot/${run}`, { emails: 1 })
      const chain = [...(await admin.get('acme')).entries].reverse()
      assert.equal(await admin.verifyChain(chain), true)
      assert.equal(await bot.verify(chain[1]), true)
      chain[1] = { ...chain[1], body: { emails: 5 } }
      assert.equal(await admin.verifyChain(chain), false)
      assert.equal(await bot.verify(chain[1]), false)
    },
  },
  {
    name: 'refuses a key derived before its scope was rotated with 401',
    async run(t) {
      const { admin, agent } = await account(t)
      const old = await agent('a')
      await admin.rotate('a')
      const refused = await old.spend('a', { n: 1 }).catch((e: unknown) => e)
      assert.ok(refused instanceof SolenoidError)
      assert.deepEqual([refused.status, refused.code], [401, 'invalid_key'])
      assert.notEqual(await (await agent('a')).spend('a', { n: 1 }), null)
    },
  },
  {
    name: 'limits, holds and settles a unit named constructor like any other',
    async run(t) {
      const { admin_key } = await t.signup()
      const admin = solenoid({ key: admin_key, api: t.api, fetch: t.fetch })
      const post = async (body: object, idem: string): Promise<Record<string, any>> => {
        const r = await t.fetch(`${t.api}/v1/acme`, { method: 'POST', headers: { authorization: `Bearer ${admin_key}`, 'idempotency-key': idem }, body: JSON.stringify(body) })
        return { status: r.status, ...((await r.json()) as Record<string, any>) }
      }
      await admin.spend('acme', { usd: 1 })
      await admin.limit('acme', { constructor: 10 })
      assert.equal((await post({ constructor: 5, usd: 1 }, 'h1')).remaining.constructor.left, 5)
      assert.deepEqual(await post({ settle: { usd: 1 } }, 'h1'), { status: 400, error: 'invalid_unit', unit: 'constructor' })
      assert.equal((await post({ settle: { constructor: 2, usd: 1 } }, 'h1')).status, 200)
      await admin.limit('acme', { constructor: 10 })
      assert.equal((await admin.get('acme')).limits.find((l) => l.unit === 'constructor')!.used, 2)
    },
  },
  {
    name: 'returns null in an outage where the limit fails open, and throws SolenoidUnavailable where it fails closed',
    async run(t) {
      let down = false
      const flaky: typeof fetch = (input, init) => (down ? Promise.reject(new TypeError('fetch failed')) : t.fetch(input, init))
      const { admin, agent } = await account(t, flaky)
      await admin.limit('open', { n: 10, on_outage: 'open' })
      await admin.limit('shut', { n: 10 })
      const bot = await agent('')
      await bot.spend('open', { n: 1 })
      await bot.spend('shut', { n: 1 })
      down = true
      assert.equal(await bot.spend('open', { n: 1 }), null)
      await assert.rejects(bot.spend('shut', { n: 1 }), SolenoidUnavailable)
    },
  },
  {
    name: 'recovers the admin key by email, and rotation revokes the old one',
    needsOutbox: true,
    async run(t) {
      const acct = await t.signup()
      const o = { api: t.api, fetch: t.fetch }
      const admin = solenoid({ key: acct.admin_key, ...o })
      const last = async () => /\b(\d{6})\b/.exec((await t.outbox!()).at(-1)!.text)![1]
      await admin.sendEmailCode('ops@example.com')
      await admin.verifyEmail('ops@example.com', await last())
      await requestRecovery(acct.tenant, 'ops@example.com', o)
      assert.deepEqual(await recover(acct.tenant, 'ops@example.com', await last(), o), acct)
      await requestRecovery(acct.tenant, 'ops@example.com', o)
      const rotated = await recover(acct.tenant, 'ops@example.com', await last(), { ...o, rotate: true })
      assert.notEqual(rotated.admin_key, acct.admin_key)
      assert.equal(await code(admin.get('')), 'invalid_key')
    },
  },
]
