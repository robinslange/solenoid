import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spendKey } from '../../worker/src/keys'
import { fromHex } from '../src/bytes'
import { LimitExceeded, Outage, SolenoidError, SolenoidUnavailable, toError } from '../src/errors'
import { deriveSpendKey } from '../src/keys'
import { costOf, estimateInput, leftFrom, planCall, readUsage } from '../src/llm'
import { fileStore } from '../src/node'
import { checkScope, nearestFirst } from '../src/scope'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('node:sqlite')
  vi.doUnmock('node:os')
  vi.resetModules()
})

describe('errors', () => {
  it('maps 402 to LimitExceeded with its detail, and anything else to a plain SolenoidError', () => {
    const limit = toError(402, { error: 'limit_exceeded', scope: 'a', unit: 'usd', resets: '2030-01-01T00:00:00.000Z' })
    expect(limit).toBeInstanceOf(LimitExceeded)
    expect([limit.status, limit.code, limit.message]).toEqual([402, 'limit_exceeded', 'solenoid: limit_exceeded (402)'])
    expect([(limit as LimitExceeded).scope, (limit as LimitExceeded).unit, (limit as LimitExceeded).resets]).toEqual(['a', 'usd', '2030-01-01T00:00:00.000Z'])
    expect(limit.detail).toEqual({ scope: 'a', unit: 'usd', resets: '2030-01-01T00:00:00.000Z' })
    const lifetime = toError(402, { error: 'limit_exceeded', scope: 'a', unit: 'n' }) as LimitExceeded
    expect(lifetime.resets).toBeNull()
    const denied = toError(403, { error: 'out_of_scope', scope: 'b' })
    expect(denied).not.toBeInstanceOf(LimitExceeded)
    expect([denied.status, denied.code, denied.detail]).toEqual([403, 'out_of_scope', { scope: 'b' }])
  })
  it('names an error with no string code "unknown"', () => {
    expect(toError(400, { error: 7 }).code).toBe('unknown')
    expect(toError(400, {}).code).toBe('unknown')
  })
  it('says which scope failed closed and keeps the cause', () => {
    const cause = new Outage('HTTP 503')
    const e = new SolenoidUnavailable('acme/bot', cause)
    expect(e.message).toBe('solenoid is unreachable and the limits on "acme/bot" fail closed')
    expect([e.scope, e.cause]).toEqual(['acme/bot', cause])
  })
})

describe('scope grammar', () => {
  it.each([
    ['.', false], ['..', false], ['...', false], ['a/.', false], ['a/../b', false], ['%2e', false], ['A', false], ['a/', false], ['/a', false],
    ['a'.repeat(64), true], ['a'.repeat(65), false], ['.a', true], ['a.', true], ['a..b', true], ['a-b_c.d', true],
    [Array(8).fill('s').join('/'), true], [Array(9).fill('s').join('/'), false], ['aB', false], ['', true],
  ])('checkScope(%j) accepts: %s', (scope, ok) => {
    if (ok) expect(checkScope(scope)).toBe(scope)
    else expect(() => checkScope(scope)).toThrow(new TypeError(`solenoid: invalid scope "${scope}"`))
  })
  it('lists a scope and its ancestors nearest first, ending at the root', () => {
    expect(nearestFirst('')).toEqual([''])
    expect(nearestFirst('a')).toEqual(['a', ''])
    expect(nearestFirst('a/b/c')).toEqual(['a/b/c', 'a/b', 'a', ''])
  })
})

describe('deriveSpendKey', () => {
  const admin = `sk.admin.abcdefghijkl.3.${'f'.repeat(64)}`
  it.each(['', 'a', 'ab', 'abc', 'acme/bot', 'a.b/c-d/e_f'])('derives the same key for %j as the Worker does', async (scope) => {
    expect(await deriveSpendKey(admin, scope, 5)).toBe(await spendKey(admin, scope, 5))
  })
  it.each(['sk.spend.abcdefghijkl.3.0.YQ.aa', `xk.admin.abcdefghijkl.3.${'f'.repeat(64)}`, 'sk.admin.abcdefghijkl.3', 'sk.admin.abcdefghijkl.3.'])('refuses %j, which is not an admin key', async (key) => {
    await expect(deriveSpendKey(key, 'a', 0)).rejects.toThrow(new TypeError('solenoid: deriving a key needs the admin key'))
  })
})

describe('fromHex', () => {
  it('decodes lowercase hex pairs', () => {
    expect([...fromHex('00ff10')]).toEqual([0, 255, 16])
    expect([...fromHex('')]).toEqual([])
  })
  it.each(['abc', 'zz00', '00zz', 'AB', '0x00'])('refuses %j', (h) => {
    expect(() => fromHex(h)).toThrow(new Error('invalid hex'))
  })
})

describe('llm arithmetic', () => {
  it('estimates input as 1.2 tokens per four characters of the request, minus model and caps', () => {
    expect(estimateInput({ model: 'm', max_tokens: 9, max_completion_tokens: 9, messages: [] })).toBe(Math.ceil((15 / 4) * 1.2))
    expect(estimateInput({ messages: [{ role: 'user', content: 'x'.repeat(100) }] })).toBe(Math.ceil((JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(100) }] }).length / 4) * 1.2))
  })
  it('takes the smallest left per unit and skips unlimited ones', () => {
    expect(leftFrom([
      { unit: 'tokens', left: 50, scope: 'a' },
      { unit: 'tokens', left: 20, scope: 'a/b' },
      { unit: 'tokens', left: 30, scope: '' },
      { unit: 'usd', left: null, scope: 'a' },
      { unit: 'usd', left: 2, scope: '' },
      { unit: 'usd', left: 2, scope: 'a' },
    ])).toEqual({ tokens: { scope: 'a/b', left: 20, resets: null }, usd: { scope: '', left: 2, resets: null } })
    expect(leftFrom([{ unit: 'n', left: null, scope: 'a' }])).toEqual({})
  })
  it('reads no usage from a missing, empty or unknown usage object', () => {
    expect(readUsage(null)).toBeNull()
    expect(readUsage({ usage: {} })).toBeNull()
    expect(readUsage({ usage: { prompt_tokens: 4 } })).toEqual({ input: 4, output: 0 })
    expect(readUsage({ usage: { input_tokens: 4 } })).toEqual({ input: 4, output: 0 })
  })
  it('prices Anthropic cache writes and reads at the full input rate', () => {
    const usage = readUsage({ usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 5 } })!
    expect(costOf(usage, { input: 1e-6, output: 4e-6 })).toEqual({ tokens: 1115, usd: 1110 * 1e-6 + 5 * 4e-6 })
  })
  it('plans no hold and leaves the request alone when nothing limits tokens or usd', () => {
    const req = { model: 'm', messages: [] }
    const plan = planCall('s', req, {}, undefined)
    expect(plan).toEqual({ req, hold: null })
    expect(plan.req).toBe(req)
  })
  it('lets a call through with exactly one output token left', () => {
    const req = { model: 'm', messages: [] }
    const plan = planCall('s', req, { tokens: { scope: 's', left: estimateInput(req) + 1, resets: null } }, undefined)
    expect(plan.req.max_tokens).toBe(1)
  })
  it('refuses locally when not one output token fits, naming the unit and scope that ran out', () => {
    const req = { model: 'm', messages: [] }
    const input = estimateInput(req)
    const P = { input: 1e-6, output: 1e-6 }
    const refusal = (left: Parameters<typeof planCall>[2]) => { try { planCall('s/run', req, left, P) } catch (e) { return e } }
    const byTokens = refusal({ tokens: { scope: 's', left: input, resets: null }, usd: { scope: '', left: 1, resets: null } })
    expect(byTokens).toBeInstanceOf(LimitExceeded)
    expect(byTokens).toMatchObject({ status: 402, code: 'limit_exceeded', detail: { scope: 's', unit: 'tokens', local: true } })
    const byUsd = refusal({ tokens: { scope: 's', left: 1e6, resets: null }, usd: { scope: '', left: input * 1e-6, resets: null } })
    expect(byUsd).toMatchObject({ code: 'limit_exceeded', detail: { scope: '', unit: 'usd', local: true } })
    const usdWithOneTokenLeft = refusal({ tokens: { scope: 's', left: input + 1, resets: null }, usd: { scope: '', left: input * 1e-6, resets: null } })
    expect(usdWithOneTokenLeft).toMatchObject({ detail: { scope: '', unit: 'usd' } })
    const usdOnly = refusal({ usd: { scope: 'u', left: 0, resets: null } })
    expect(usdOnly).toMatchObject({ detail: { scope: 'u', unit: 'usd', local: true } })
  })
  it('names the model in an unknown_price refusal', () => {
    expect(() => planCall('s', { model: 'x' }, { usd: { scope: 's', left: 1, resets: null } }, undefined)).toThrow(SolenoidError)
    try { planCall('s', { model: 'x' }, { usd: { scope: 's', left: 1, resets: null } }, undefined) } catch (e) {
      expect(e).toMatchObject({ status: 0, code: 'unknown_price', detail: { model: 'x' } })
    }
  })
})

describe('fileStore', () => {
  it('defaults to ~/.cache/solenoid, read without writing so a missed mock cannot touch the real home', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sol-home-'))
    mkdirSync(join(home, '.cache', 'solenoid'), { recursive: true })
    writeFileSync(join(home, '.cache', 'solenoid', 'outage.json'), JSON.stringify({ 'sol-test/default-dir': 'open' }))
    vi.doMock('node:os', async (real) => ({ ...(await real<typeof import('node:os')>()), homedir: () => home }))
    expect((await import('node:os')).homedir()).toBe(home)
    const { fileStore: store } = await import('../src/node')
    expect(store().get('sol-test/default-dir')).toBe('open')
  })
  it('does not rewrite the file when the mode is unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sol-'))
    fileStore(dir).set('a', 'open')
    const before = statSync(join(dir, 'outage.json')).ino
    fileStore(dir).set('a', 'open')
    expect(statSync(join(dir, 'outage.json')).ino).toBe(before)
    fileStore(dir).set('a', 'closed')
    expect(fileStore(dir).get('a')).toBe('closed')
  })
})
