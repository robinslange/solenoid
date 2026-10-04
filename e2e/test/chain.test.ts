import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Receipt } from '@solenoid.systems/sdk'
import { expect, it } from 'vitest'
import { client, code, ok, user } from './harness'

it('verifies the hash chain over every GET page after a mixed sequence of CLI and SDK writes, and rejects it once an entry is altered', async () => {
  const u = user()
  await ok(u.cli('init', 'acme'))
  const admin = client((JSON.parse(readFileSync(join(u.config, 'credentials'), 'utf8')) as { admin_key: string }).admin_key)
  const envKey = /^SOLENOID_KEY=(\S+)$/m.exec(readFileSync(join(u.cwd, '.env'), 'utf8'))![1]!
  await ok(u.cli('limit', 'acme', 'emails=60', 'tokens=10000', '--per', 'day'))
  const bot = client(envKey)
  await Promise.all(Array.from({ length: 52 }, (_, i) => bot.spend(`acme/bot/run-${i}`, { emails: 1 })))
  await ok(u.cli('spend', 'acme/cli', 'emails=2'))
  expect(await code(bot.spend('acme/bot', { emails: 7 }))).toBe('402 limit_exceeded')
  const first = await bot.spend('acme/bot', { emails: 1 }, { idempotencyKey: 'once' })
  expect(await bot.spend('acme/bot', { emails: 1 }, { idempotencyKey: 'once' })).toEqual({ ...first!, replay: true })
  await bot.at('acme/bot').llm(async () => ({ usage: { prompt_tokens: 5, completion_tokens: 5 } }), { model: 'e2e-model', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] })
  await ok(u.cli('rotate', 'acme/old', '--yes'))
  await ok(u.cli('limit', 'acme', 'emails=off'))

  const pages: Receipt[][] = []
  for (let before: number | undefined; ;) {
    const view = await admin.get('', { before })
    pages.push(view.entries)
    if (view.next === null) break
    before = view.next
  }
  expect(pages.map((p) => p.length)).toEqual([50, 9])
  const chain = pages.flat().reverse()
  expect(chain.map((e) => e.seq)).toEqual(Array.from({ length: 59 }, (_, i) => i + 1))
  expect(chain.map((e) => e.kind)).toEqual(['limit', ...Array(55).fill('spend'), 'settle', 'rotate', 'limit'])
  expect(await admin.verifyChain(chain)).toBe(true)

  const log = await ok(u.cli('log', '', '--before', String(chain.length + 1)))
  expect(log.split('\n')).toHaveLength(51)
  expect(log).toMatch(/\nmore: solenoid log  --before 10$/)

  const tampered = chain.map((e) => (e.seq === 30 ? { ...e, body: { emails: 5 } } : e))
  expect(await admin.verifyChain(tampered)).toBe(false)
  expect(await admin.verifyChain(chain.filter((e) => e.seq !== 30))).toBe(false)
})
