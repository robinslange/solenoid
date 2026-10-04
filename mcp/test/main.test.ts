import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { signup, solenoid } from '@solenoid.systems/sdk'
import { testServer } from '../../testing/src/index'
import { clientFor, start } from '../src/main'
import { sandbox } from './setup'

describe('clientFor', () => {
  it('needs a spend key without --admin, and refuses an admin key there', () => {
    expect(() => clientFor([], {})).toThrow('SOLENOID_KEY')
    expect(() => clientFor([], { SOLENOID_KEY: 'sk.admin.abcdefghijkl.1.' + '0'.repeat(64) })).toThrow('--admin')
    expect(clientFor([], { SOLENOID_KEY: 'sk.spend.abcdefghijkl.1.0.YQ.' + '0'.repeat(64) }).admin).toBe(false)
  })
  it('reads the admin key from the credentials file with --admin', () => {
    const dir = join(sandbox, 'cfg-admin')
    mkdirSync(dir, { recursive: true })
    expect(() => clientFor(['--admin'], { SOLENOID_CONFIG_DIR: dir })).toThrow('solenoid login')
    writeFileSync(join(dir, 'credentials'), JSON.stringify({ api: 'https://api.solenoid.systems', admin_key: 'sk.admin.abcdefghijkl.1.' + '0'.repeat(64) }))
    expect(clientFor(['--admin'], { SOLENOID_CONFIG_DIR: dir }).admin).toBe(true)
  })
  it('reads the credentials under the home directory when SOLENOID_CONFIG_DIR is unset', () => {
    expect(() => clientFor(['--admin'], {})).toThrow('solenoid login')
    const dir = join(homedir(), '.config', 'solenoid')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'credentials'), JSON.stringify({ admin_key: 'sk.admin.abcdefghijkl.1.' + '0'.repeat(64) }))
    expect(clientFor(['--admin'], {}).admin).toBe(true)
  })
})

describe('--admin with a credentials file that holds no admin key', () => {
  const spendKey = 'sk.spend.abcdefghijkl.1.0.YQ.' + '0'.repeat(64)
  it.each([
    ['{}', '{}', {}],
    ['null', 'null', {}],
    ['{} with a spend key in the environment', '{}', { SOLENOID_KEY: spendKey }],
    ['an empty admin_key', '{"admin_key":""}', {}],
    ['a spend key as admin_key', JSON.stringify({ admin_key: spendKey }), {}],
    ['an array as admin_key', '{"admin_key":["sk.admin.abcdefghijkl.1."]}', {}],
  ])('%s refuses with the --admin error and serves nothing', async (label, file, extra) => {
    const dir = join(sandbox, `cfg-${label.replace(/\W+/g, '-')}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'credentials'), file)
    const env = { SOLENOID_CONFIG_DIR: dir, ...extra }
    expect(() => clientFor(['--admin'], env)).toThrow('--admin')
    expect(() => clientFor(['--admin'], env)).toThrow('solenoid login')
    const input = new PassThrough()
    const out: string[] = []
    input.end('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n')
    await expect(start(['--admin'], env, input, (s) => out.push(s))).rejects.toThrow('--admin')
    expect(out).toEqual([])
  })
})

describe('start', () => {
  it('serves tools/list and tools/call over the given streams', async () => {
    const server = await testServer()
    vi.stubGlobal('fetch', server.fetch)
    const { admin_key } = await signup({ api: server.api })
    const key = await solenoid({ key: admin_key, api: server.api }).deriveKey('acme')
    const input = new PassThrough()
    const out: string[] = []
    const done = start([], { SOLENOID_KEY: key, SOLENOID_API: server.api }, input, (s) => out.push(s))
    input.write('{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}\n')
    input.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get","arguments":{"scope":"acme"}}}\n')
    input.end()
    await done
    const [init, list, call] = out.map((l) => JSON.parse(l))
    expect(init.result.serverInfo).toEqual({ name: 'solenoid', version: '2.0.0' })
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['get', 'log'])
    expect(JSON.parse(call.result.content[0].text).scope).toBe('acme')
  })
})
