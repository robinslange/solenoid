import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { LimitExceeded, SolenoidError } from '@solenoid.systems/sdk'
import { describe, expect, it } from 'vitest'
import { api, client, code, ok, user } from './harness'

const envKey = (cwd: string) => /^SOLENOID_KEY=(sk\.spend\.\S+)$/m.exec(readFileSync(join(cwd, '.env'), 'utf8'))![1]!
const savedAdmin = (config: string) => JSON.parse(readFileSync(join(config, 'credentials'), 'utf8')) as { api: string; admin_key: string }

describe('the CLI and SDK against the local Worker', () => {
  it('inits an account, sets a limit and spends until the Worker refuses with 402', async () => {
    const u = user()
    expect(await ok(u.cli('init', 'acme'))).toMatch(/^account: [a-z2-7]{12}\nadmin key: sk\.admin\.[a-z2-7]{12}\.1\.[0-9a-f]{64}\n[^]*\nspend key for "acme" written to \.env$/)
    expect(statSync(join(u.config, 'credentials')).mode & 0o777).toBe(0o600)
    expect(savedAdmin(u.config).api).toBe(api)
    await ok(u.cli('limit', 'acme', 'emails=3'))
    for (let i = 0; i < 3; i++) expect(await ok(u.cli('spend', 'acme/bot', 'emails=1'))).toMatch(/^\S+ seq \d+$/)
    expect(await u.cli('spend', 'acme/bot', 'emails=1')).toEqual({
      code: 1,
      out: '',
      err: 'solenoid: limit_exceeded (402). the limit on "acme" for "emails" is reached (used 3 of 3); it has no window, so only raising it or removing it helps. ' +
        'raise it with `solenoid limit acme emails=<n>`, or remove it with `solenoid limit acme emails=off`.\n',
    })
    const refused = await client(envKey(u.cwd)).spend('acme/bot', { emails: 1 }).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(LimitExceeded)
    expect(refused).toMatchObject({ status: 402, scope: 'acme', unit: 'emails' })
    expect(await ok(u.cli('ls', 'acme'))).toMatch(/^emails +3 +lifetime +used 3 +left 0 +\(acme, closed\)$/m)
  })

  it('lets a derived spend key spend at and under its scope, and refuses anything outside it with 403', async () => {
    const u = user()
    await ok(u.cli('init'))
    const key = await ok(u.cli('key', 'acme/bot'))
    expect(key).toMatch(/^sk\.spend\.[a-z2-7]{12}\.1\.0\.\S+\.[0-9a-f]{64}$/)
    const bot = client(key)
    const receipt = await bot.spend('acme/bot/run-1', { calls: 1 })
    expect(receipt).toMatchObject({ kind: 'spend', scope: 'acme/bot/run-1', body: { calls: 1 } })
    expect(await bot.verify(receipt!)).toBe(true)
    expect(await code(bot.spend('acme/bot', { calls: 1 }))).toBe('ok')
    const outside = await bot.spend('acme/other', { calls: 1 }).catch((e: unknown) => e)
    expect(outside).toBeInstanceOf(SolenoidError)
    expect(outside).toMatchObject({ status: 403, code: 'out_of_scope', detail: { scope: 'acme/other', key_scope: 'acme/bot' } })
    expect(await code(bot.spend('acme', { calls: 1 }))).toBe('403 out_of_scope')
    expect(await code(bot.limit('acme/bot', { calls: 100 }))).toBe('403 admin_required')
    expect(await ok(u.cli('log', 'acme'))).toMatch(/^ +\d+ +\S+ +spend +acme\/bot +\{"calls":1\}\n +\d+ +\S+ +spend +acme\/bot\/run-1 +\{"calls":1\}$/)
  })

  it('revokes the keys of a rotated scope with 401, and leaves keys derived for scopes under it working', async () => {
    const u = user()
    await ok(u.cli('init'))
    const old = client(await ok(u.cli('key', 'acme/bot')))
    const under = client(await ok(u.cli('key', 'acme/bot/sub')))
    expect(await u.cli('rotate', 'acme/bot')).toMatchObject({ code: 1, out: '', err: expect.stringMatching(/^solenoid: this revokes every key derived for "acme\/bot"/) })
    expect(await code(old.spend('acme/bot', { calls: 1 }))).toBe('ok')

    const rotated = await ok(u.cli('rotate', 'acme/bot', '--yes'))
    const fresh = /new key: (sk\.spend\.\S+)\./.exec(rotated)![1]!
    expect(fresh).toMatch(/^sk\.spend\.[a-z2-7]{12}\.1\.1\./)
    expect(await code(old.spend('acme/bot', { calls: 1 }))).toBe('401 invalid_key')
    expect(await code(client(fresh).spend('acme/bot', { calls: 1 }))).toBe('ok')
    expect(await code(under.spend('acme/bot/sub', { calls: 1 }))).toBe('ok')
    expect(await ok(u.cli('key', 'acme/bot'))).toBe(fresh)
  })

  it('revokes the old admin key and every spend key when the admin key rotates, and keeps the CLI working on the new one', async () => {
    const u = user()
    await ok(u.cli('init', 'acme'))
    const oldAdmin = savedAdmin(u.config).admin_key
    const fromEnv = client(envKey(u.cwd))
    const other = client(await ok(u.cli('key', 'beta')))
    expect(await code(fromEnv.spend('acme', { calls: 1 }))).toBe('ok')
    expect(await code(other.spend('beta', { calls: 1 }))).toBe('ok')

    const rotated = await ok(u.cli('rotate', '--admin', '--yes'))
    const newAdmin = /^new admin key: (sk\.admin\.\S+)$/m.exec(rotated)![1]!
    expect(newAdmin).toMatch(/^sk\.admin\.[a-z2-7]{12}\.2\.[0-9a-f]{64}$/)
    expect(savedAdmin(u.config).admin_key).toBe(newAdmin)

    expect(await code(client(oldAdmin).get(''))).toBe('401 invalid_key')
    expect(await code(fromEnv.spend('acme', { calls: 1 }))).toBe('401 invalid_key')
    expect(await code(other.spend('beta', { calls: 1 }))).toBe('401 invalid_key')
    const stranger = user()
    expect(await stranger.cli('login', oldAdmin)).toMatchObject({ code: 1, err: expect.stringMatching(/^solenoid: invalid_key \(401\)\. this admin key/) })
    expect(await ok(stranger.cli('login', newAdmin))).toBe('logged in')

    expect(await ok(u.cli('ls'))).toMatch(/^\/\n\(no limits\)\nchildren: acme beta$/)
    expect(await code(client(await ok(u.cli('key', 'acme'))).spend('acme', { calls: 1 }))).toBe('ok')
  })
})
