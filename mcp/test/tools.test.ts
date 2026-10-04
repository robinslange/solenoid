import { describe, expect, it } from 'vitest'
import { signup, solenoid } from '@solenoid.systems/sdk'
import { testServer } from '../../testing/src/index'
import { tools } from '../src/tools'

async function setup() {
  const server = await testServer()
  const o = { api: server.api, fetch: server.fetch }
  const { admin_key } = await signup(o)
  const admin = solenoid({ key: admin_key, ...o })
  await admin.limit('acme', { emails: 3, per: 'day' })
  await admin.spend('acme/bot', { emails: 1 })
  const byName = (list: ReturnType<typeof tools>) => Object.fromEntries(list.map((t) => [t.name, t]))
  return { admin, admin_key, o, byName }
}

describe('tools', () => {
  it('gives a spend key only get and log', async () => {
    const { admin, o, byName } = await setup()
    const agent = solenoid({ key: await admin.deriveKey('acme'), ...o })
    expect(tools(agent, false).map((t) => t.name)).toEqual(['get', 'log'])
    const got = JSON.parse(await byName(tools(agent, false)).get.call({ scope: 'acme/bot' }))
    expect(got).toMatchObject({ scope: 'acme/bot', limits: [{ scope: 'acme', unit: 'emails', limit: 3, used: 1, left: 2 }], children: [] })
    expect(got.entries).toBeUndefined()
    const log = JSON.parse(await byName(tools(agent, false)).log.call({ scope: 'acme' }))
    expect(log.entries[0]).toMatchObject({ kind: 'spend', scope: 'acme/bot' })
    expect(log.next).toBeNull()
  })

  it('pages log with before and refuses a bad before or scope', async () => {
    const { admin, byName } = await setup()
    const log = byName(tools(admin, true)).log
    const first = JSON.parse(await log.call({ scope: '' })).entries[0].seq
    expect(JSON.parse(await log.call({ scope: '', before: first })).entries.every((e: { seq: number }) => e.seq < first)).toBe(true)
    expect(JSON.parse(await log.call({ scope: '', before: 1 })).entries).toEqual([])
    await expect(log.call({ scope: '', before: 0 })).rejects.toThrow('"before" must be a positive integer')
    await expect(log.call({ scope: '', before: 1.5 })).rejects.toThrow('"before"')
    await expect(log.call({})).rejects.toThrow('"scope" must be a string')
    await expect(log.call({ scope: 'acme/..' })).rejects.toThrow('invalid scope')
  })

  it('lets the admin set and remove limits, and rotate a scope', async () => {
    const { admin, o, byName } = await setup()
    const t = byName(tools(admin, true))
    expect(tools(admin, true).map((x) => x.name)).toEqual(['get', 'log', 'set_limit', 'rotate'])
    const set = JSON.parse(await t.set_limit.call({ scope: 'acme', limits: { emails: 10 }, per: 'day', on_outage: 'open', warn_at: 0.8 }))
    expect(set.limits).toContainEqual(expect.objectContaining({ unit: 'emails', limit: 10, on_outage: 'open', warn_at: 0.8 }))
    const off = JSON.parse(await t.set_limit.call({ scope: 'acme', limits: { emails: null } }))
    expect(off.limits).toEqual([])
    await expect(t.set_limit.call({ scope: 'acme', limits: [1] })).rejects.toThrow('"limits" must be an object')
    await expect(t.set_limit.call({ scope: 'acme' })).rejects.toThrow('"limits"')
    await expect(t.set_limit.call({ scope: 'acme', limits: null })).rejects.toThrow('"limits"')
    await expect(t.set_limit.call({ scope: 'acme', limits: 'emails=3' })).rejects.toThrow('"limits"')
    await expect(t.set_limit.call({ limits: { emails: 3 } })).rejects.toThrow('"scope" must be a string')
    await expect(t.rotate.call({ scope: 7 })).rejects.toThrow('"scope" must be a string')
    const oldKey = await admin.deriveKey('acme')
    const r = JSON.parse(await t.rotate.call({ scope: 'acme' }))
    expect(r.scope).toBe('acme')
    expect(r.key).not.toBe(oldKey)
    await expect(solenoid({ key: oldKey, ...o }).get('acme')).rejects.toMatchObject({ code: 'invalid_key' })
    expect((await solenoid({ key: r.key, ...o }).get('acme')).scope).toBe('acme')
  })

  it('describes every tool and argument, and pins each schema', async () => {
    const { admin } = await setup()
    const descriptions: string[] = []
    const shape = JSON.parse(JSON.stringify(tools(admin, true), (k, v) => (k === 'description' ? void descriptions.push(v) : v)))
    expect(descriptions).toHaveLength(13)
    for (const d of descriptions) expect(d).toMatch(/\S/)
    const scope = { type: 'string' }
    const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false })
    expect(shape).toEqual([
      { name: 'get', inputSchema: obj({ scope }, ['scope']) },
      { name: 'log', inputSchema: obj({ scope, before: { type: 'integer', minimum: 1 } }, ['scope']) },
      {
        name: 'set_limit',
        inputSchema: obj({
          scope,
          limits: { type: 'object', additionalProperties: { type: ['number', 'null'] } },
          per: { enum: ['hour', 'day', 'week', 'month', 'child', 'child-day'] },
          on_outage: { enum: ['open', 'closed'] },
          warn_at: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        }, ['scope', 'limits']),
      },
      { name: 'rotate', inputSchema: obj({ scope }, ['scope']) },
    ])
  })

  it('refuses a control key or a value that is not a finite number or null in limits, before any request', async () => {
    const { admin, admin_key, o } = await setup()
    let requests = 0
    const counted = solenoid({ key: admin_key, api: o.api, fetch: (i, init) => { requests++; return o.fetch(i, init) } })
    const setLimit = tools(counted, true).find((t) => t.name === 'set_limit')!
    for (const limits of [
      { rotate_admin: true }, { rotate_admin: 1 }, { rotate_keys: true }, { rotate_keys: null }, { per: 'day' }, { per: 1 }, { on_outage: 'open' }, { on_outage: null }, { warn_at: 0.5 },
      { emails: true }, { emails: '3' }, { emails: NaN }, { emails: Infinity }, { emails: -Infinity }, { emails: {} },
    ]) {
      await expect(setLimit.call({ scope: '', limits }), JSON.stringify(limits)).rejects.toThrow('"limits"')
    }
    for (const limits of [5, true, 'emails=3', null, [1]]) await expect(setLimit.call({ scope: '', limits })).rejects.toThrow('"limits"')
    await expect(setLimit.call({ scope: '', limits: { Rotate_Admin: true } })).rejects.toThrow('"limits" cannot use Rotate_Admin as a unit')
    expect(requests).toBe(0)
    expect((await admin.get('')).scope).toBe('')
    expect(JSON.parse(await setLimit.call({ scope: 'acme', limits: { emails: 0, usd: null } })).limits).toContainEqual(expect.objectContaining({ unit: 'emails', limit: 0 }))
    expect(requests).toBe(1)
  })
})
