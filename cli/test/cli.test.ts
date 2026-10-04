import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { solenoid as sdk } from '@solenoid.systems/sdk'
import { fileStore } from '@solenoid.systems/sdk/node'
import type { TestServer } from '../../testing/src/index'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatError, tenantOf } from '../src/commands'
import { freshServer, solenoid, tempDir, useConfigDir } from './run'
import { assertInSandbox, sandbox } from './setup'

const NOW = Date.parse('2026-03-04T05:06:07.000Z')
let server: TestServer
let config: string
let cwd: string
const run = (...args: string[]) => solenoid(cwd, ...args)
const creds = () => JSON.parse(readFileSync(join(config, 'credentials'), 'utf8')) as { api: string; admin_key: string }
const saveCreds = (c: { api: string; admin_key: string }) => {
  mkdirSync(config, { recursive: true })
  writeFileSync(join(config, 'credentials'), JSON.stringify(c))
}
const client = (key: string) => sdk({ key, api: server.api, fetch: server.fetch })
const sdkAdmin = () => client(creds().admin_key)
async function loggedIn(): Promise<string> {
  const { admin_key } = await server.signup()
  saveCreds({ api: server.api, admin_key })
  return admin_key
}
const INVALID_KEY = 'solenoid: invalid_key (401). this admin key (it starts sk.admin.) is invalid or was rotated elsewhere; ' +
  'run `solenoid login <admin-key>` with the current one. `solenoid key <scope>` cannot fix this, because deriving a key ' +
  'also needs a working admin key. a deployed spend key (starts sk.spend.) failing the same way has two possible causes. ' +
  'if its own scope was rotated, the admin key still works: derive a fresh one with `solenoid key <scope>` and redeploy it. ' +
  'if the admin key itself was rotated, every spend key now fails: log in with the current admin key first ' +
  '(`solenoid login <admin-key>`), then re-derive and redeploy. if the admin key is lost, `solenoid recover <email>` gets it back when the account has a recovery email.'
const BAD_ENV_API = 'solenoid: SOLENOID_API must be an http or https URL, such as https://api.solenoid.systems, with no user, password, query or fragment and on a port that fetch allows. fix it, or unset it to use that address.'
const badSavedApi = () => `solenoid: the api saved in ${join(config, 'credentials')} is not an http or https URL with no user, password, query or fragment and on a port that fetch allows. ` +
  'run `solenoid login <admin-key>` with SOLENOID_API set to your account\'s API, such as https://api.solenoid.systems, to save it again.'
const OUTAGE_NEXT = (s: string) =>
  `retry once solenoid is reachable. to let spends at "${s}" through a later outage, every limit that applies there, including those on parent scopes, must fail open. ` +
  `once solenoid is reachable (solenoid limit needs it too), run \`solenoid ls ${s}\`, and for each limit it lists run ` +
  '`solenoid limit <its scope> <unit>=<its limit> --per <its per> --warn-at <its warn-at> --on-outage open`, leaving out --per for a lifetime limit ' +
  'and --warn-at for a limit with none, because the command replaces the whole limit. the next spend that reaches solenoid then records the new mode in your outage cache.'
const FAILS_CLOSED = (s: string) =>
  `solenoid: the spend was refused because solenoid could not be reached, and your outage cache does not say the limits on "${s}" fail open. ${OUTAGE_NEXT(s)}`
const ok = (out: string) => ({ code: 0, out: `${out}\n`, err: '' })
const fails = (err: string) => ({ code: 1, out: '', err: `${err}\n` })

beforeEach(async () => {
  server = await freshServer()
  server.setNow(NOW)
  config = useConfigDir()
  cwd = tempDir('proj-')
})

describe('the sandbox', () => {
  it('keeps HOME, the config dir and the working directory inside the test sandbox', () => {
    expect(process.env.HOME?.startsWith(`${sandbox}/`)).toBe(true)
    expect(config.startsWith(`${sandbox}/`)).toBe(true)
    expect(cwd.startsWith(`${sandbox}/`)).toBe(true)
  })
})

const HELP = [
  'solenoid keeps an agent inside a spend limit: a spend that would go over is refused before the action runs, and every recorded spend returns a signed receipt.',
  '',
  'start with: solenoid init <scope>',
  '',
  'commands:',
  '  init [scope] [--email address] [--force]                            create an account; with --email, start attaching a recovery email',
  '  email <address> [code] [--rotate]                                   attach a recovery email: the first run sends a code, the second confirms it; --rotate on the second also replaces the admin key and revokes every spend key',
  '  recover <email> [code] [--tenant id] [--rotate] [--force]           get the admin key back by email; --rotate also revokes the old admin key and every spend key',
  '  login <admin-key>                                                   use an existing account\'s admin key on this machine',
  '  key <scope>                                                         print a spend key for <scope>',
  '  limit <scope> <unit>=<n|off>... [--per p] [--on-outage m] [--warn-at f]',
  '                                                                       set or remove a limit (per: hour, day, week, month, child, child-day; on-outage: open, closed; warn-at: a fraction such as 0.8)',
  '  spend <scope> <unit>=<n>...                                         record a spend and check it against every limit at and above <scope>',
  '  ls [scope]                                                          show the limits and children at <scope>',
  '  log [scope] [--before n]                                            show recent entries at <scope>',
  '  rotate <scope> --yes                                                revoke every key derived for <scope>',
  '  rotate --admin --yes                                                revoke the admin key and every spend key',
  '  upgrade                                                             opens Stripe Checkout to move this account to Pro, or prints the billing portal link when already on Pro',
].join('\n')

describe('help and unknown commands', () => {
  it('prints the help screen for "help" and for no command, and exits 0', async () => {
    expect(await run('help')).toEqual(ok(HELP))
    expect(await run()).toEqual(ok(HELP))
  })
  it('refuses an unknown command on stderr with exit code 1', async () => {
    expect(await run('frobnicate')).toEqual(fails('solenoid: unknown command "frobnicate"; run `solenoid help` to see the commands'))
  })
  it('refuses an unknown flag with one solenoid: line and exit code 1, before any request', async () => {
    const help = 'run `solenoid help` to see the options'
    expect(await run('ls', '--bogus')).toEqual(fails(`solenoid: unknown option "--bogus"; ${help}`))
    expect(await run('ls', '--bogus=1')).toEqual(fails(`solenoid: unknown option "--bogus"; ${help}`))
    expect(await run('ls', '-x')).toEqual(fails(`solenoid: unknown option "-x"; ${help}`))
  })
  it.each([['limit', 'acme', 'n=1', '--warn-at', '-0.5'], ['limit', 'acme', 'n=1', '--per', '--on-outage', 'open'], ['log', 'acme', '--before', '-1'], ['limit', 'acme', 'n=1', '--on-outage', '-x']])(
    'points a flag given a value that starts with "-" at the --flag=value form: %j',
    async (...args) => {
      const flag = args.find((a) => a.startsWith('--'))!
      expect(await run(...args)).toEqual(fails(`solenoid: "${flag}" needs a value, and a value that starts with "-" must be written as ${flag}=<value>; run \`solenoid help\` to see the options`))
    },
  )
  it('refuses a flag missing its value, or given one it does not take', async () => {
    expect(await run('log', 'acme', '--before')).toEqual(fails('solenoid: "--before" needs a value; run `solenoid help` to see the options'))
    expect(await run('rotate', 'acme', '--yes=1')).toEqual(fails('solenoid: "--yes" takes no value; run `solenoid help` to see the options'))
  })
})

describe('init', () => {
  it('mints an account, saves it privately, and writes no .env without a scope', async () => {
    const r = await run('init')
    const { api, admin_key } = creds()
    expect(api).toBe(server.api)
    expect(admin_key).toMatch(/^sk\.admin\./)
    const tenant = admin_key.split('.')[2]
    expect(r).toEqual(ok([
      `account: ${tenant}`,
      `admin key: ${admin_key}`,
      `it is saved at ${join(config, 'credentials')}. keep a copy somewhere safe: it can mint and revoke every other key.`,
      'attach a recovery email so you can get the admin key back if it is lost: `solenoid email <address>`.',
    ].join('\n')))
    expect(statSync(join(config, 'credentials')).mode & 0o777).toBe(0o600)
    expect(statSync(config).mode & 0o777).toBe(0o700)
    expect(existsSync(join(cwd, '.env'))).toBe(false)
    expect((await client(admin_key).get('')).scope).toBe('')
  })

  it('signs up against https://api.solenoid.systems when SOLENOID_API is unset', async () => {
    vi.stubEnv('SOLENOID_API', undefined)
    const urls: string[] = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input))
      return server.fetch(input, init)
    })
    expect((await run('init')).code).toBe(0)
    expect(urls).toEqual(['https://api.solenoid.systems/auth/signup'])
    expect(creds().api).toBe('https://api.solenoid.systems')
  })

  it('writes a spend key for the scope to a new .env in the working directory', async () => {
    const r = await run('init', 'acme')
    expect(r.code).toBe(0)
    expect(r.out.endsWith('\nspend key for "acme" written to .env\n')).toBe(true)
    const env = readFileSync(join(cwd, '.env'), 'utf8')
    expect(env).toMatch(/^SOLENOID_KEY=sk\.spend\.[^\n]+\n$/)
    const key = env.slice('SOLENOID_KEY='.length, -1)
    expect(await client(key).spend('acme/bot', { emails: 1 })).toMatchObject({ scope: 'acme/bot' })
    await expect(client(key).spend('other', { emails: 1 })).rejects.toMatchObject({ code: 'out_of_scope' })
  })

  it('strips leading and trailing slashes from the scope, and treats "/" as the root', async () => {
    expect((await run('init', '/acme/')).out).toMatch(/\nspend key for "acme" written to \.env\n$/)
    const root = tempDir('proj-')
    expect((await solenoid(root, 'init', '/', '--force')).out).toMatch(/\nspend key for "" written to \.env\n$/)
    const key = readFileSync(join(root, '.env'), 'utf8').slice('SOLENOID_KEY='.length, -1)
    expect(await client(key).spend('anything', { n: 1 })).toMatchObject({ scope: 'anything' })
  })

  it('appends to an existing .env, adding the missing final newline first', async () => {
    writeFileSync(join(cwd, '.env'), 'A=1')
    expect((await run('init', 'acme')).code).toBe(0)
    expect(readFileSync(join(cwd, '.env'), 'utf8')).toMatch(/^A=1\nSOLENOID_KEY=sk\.spend\.[^\n]+\n$/)
  })

  it('leaves a CRLF .env line ending as it is and appends an LF line', async () => {
    writeFileSync(join(cwd, '.env'), 'A=1\r\n')
    expect((await run('init', 'acme')).code).toBe(0)
    expect(readFileSync(join(cwd, '.env'), 'utf8')).toMatch(/^A=1\r\nSOLENOID_KEY=sk\.spend\.[^\n]+\n$/)
  })

  it('leaves an existing SOLENOID_KEY alone and prints the new key instead', async () => {
    writeFileSync(join(cwd, '.env'), 'SOLENOID_KEY=existing\r\nB=2\r\n')
    const r = await run('init', 'acme')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/\n\.env already has SOLENOID_KEY; it is left as is, and this key is not written there\. replace it yourself if you want this scope's spend key instead: sk\.spend\.[^\s]+\n$/)
    expect(readFileSync(join(cwd, '.env'), 'utf8')).toBe('SOLENOID_KEY=existing\r\nB=2\r\n')
  })

  it('refuses to run twice without --force, and keeps the saved key', async () => {
    await run('init')
    const before = creds()
    expect(await run('init', 'acme')).toEqual(fails(
      'solenoid: already initialised; --force creates another account and overwrites the saved admin key for this one, so you lose local access to it unless you saved it elsewhere',
    ))
    expect(creds()).toEqual(before)
    expect(existsSync(join(cwd, '.env'))).toBe(false)
  })

  it('creates another account with --force and overwrites the saved key', async () => {
    await run('init')
    const before = creds()
    expect((await run('init', '--force')).code).toBe(0)
    expect(creds().admin_key).not.toBe(before.admin_key)
    expect(creds().admin_key.split('.')[2]).not.toBe(before.admin_key.split('.')[2])
  })

  it('rejects a bad scope before signing up, so no account is made and nothing is saved', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input))
      return server.fetch(input, init)
    })
    expect(await run('init', 'Acme')).toEqual(fails(
      'solenoid: invalid scope "Acme". a scope is up to 8 segments separated by "/", each 1 to 64 characters of lowercase a-z, 0-9, . _ -, and not made only of dots.',
    ))
    expect(urls).toEqual([])
    expect(existsSync(join(config, 'credentials'))).toBe(false)
    expect(existsSync(join(cwd, '.env'))).toBe(false)
  })

  it('rejects a bad scope before the already-initialised check, and keeps the saved key', async () => {
    await run('init')
    const before = readFileSync(join(config, 'credentials'))
    expect((await run('init', 'Acme', '--force')).err).toMatch(/^solenoid: invalid scope "Acme"\./)
    expect(readFileSync(join(config, 'credentials'))).toEqual(before)
  })

  it('reports a failed signup on stderr', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: 'rate_limited' }, { status: 429 }))
    expect(await run('init')).toEqual(fails('solenoid: rate_limited (429). signups from one network are limited per day. wait up to a day, then try again.'))
    expect(existsSync(join(config, 'credentials'))).toBe(false)
  })

  it('refuses a SOLENOID_API that is not a URL instead of calling it an outage, and saves nothing', async () => {
    vi.stubEnv('SOLENOID_API', 'api.solenoid.systems')
    expect(await run('init', 'acme')).toEqual(fails(BAD_ENV_API))
    expect(existsSync(join(config, 'credentials'))).toBe(false)
  })
})

describe('login', () => {
  it('saves a working admin key privately', async () => {
    const { admin_key } = await server.signup()
    expect(await run('login', admin_key)).toEqual(ok('logged in'))
    expect(creds()).toEqual({ api: server.api, admin_key })
    expect(statSync(join(config, 'credentials')).mode & 0o777).toBe(0o600)
    expect((await run('ls')).code).toBe(0)
  })

  it('refuses anything that is not an admin key, and leaves saved credentials byte for byte', async () => {
    const msg = 'solenoid: login needs an admin key (sk.admin.…)'
    expect(await run('login')).toEqual(fails(msg))
    expect(existsSync(join(config, 'credentials'))).toBe(false)
    const admin = await loggedIn()
    const before = readFileSync(join(config, 'credentials'))
    expect(await run('login', 'sk.spend.abc')).toEqual(fails(msg))
    expect(await run('login', 'xsk.admin.abc')).toEqual(fails(msg))
    expect(await run('login', await client(admin).deriveKey('acme'))).toEqual(fails(msg))
    expect(readFileSync(join(config, 'credentials'))).toEqual(before)
  })

  it('checks a well-formed key with the service before saving it, and keeps the working one on invalid_key', async () => {
    await loggedIn()
    const before = readFileSync(join(config, 'credentials'))
    expect(await run('login', 'sk.admin.nosuchtenant.0.deadbeef')).toEqual(fails(INVALID_KEY))
    expect(readFileSync(join(config, 'credentials'))).toEqual(before)
    expect((await run('ls')).code).toBe(0)
  })

  it('saves nothing when there was no file and the service rejects the key', async () => {
    expect(await run('login', 'sk.admin.nosuchtenant.0.deadbeef')).toEqual(fails(INVALID_KEY))
    expect(existsSync(join(config, 'credentials'))).toBe(false)
  })

  it('saves nothing when solenoid is unreachable', async () => {
    const { admin_key } = await server.signup()
    server.outage(true)
    expect(await run('login', admin_key)).toEqual(fails('solenoid unreachable'))
    expect(existsSync(join(config, 'credentials'))).toBe(false)
  })
})

describe('a bad API address', () => {
  it('refuses a bad SOLENOID_API at login with CLI wording, and saves nothing', async () => {
    const { admin_key } = await server.signup()
    vi.stubEnv('SOLENOID_API', 'http://user:pass@127.0.0.1:8787')
    expect(await run('login', admin_key)).toEqual(fails(BAD_ENV_API))
    expect(existsSync(join(config, 'credentials'))).toBe(false)
  })

  it('refuses a SOLENOID_API on a port that fetch blocks, instead of reporting every call as an outage', async () => {
    const { admin_key } = await server.signup()
    vi.stubEnv('SOLENOID_API', 'http://127.0.0.1:6000')
    expect(await run('login', admin_key)).toEqual(fails(BAD_ENV_API))
    expect(await run('init')).toEqual(fails(BAD_ENV_API))
    saveCreds({ api: 'http://127.0.0.1:6000', admin_key })
    expect(await run('spend', 'acme', 'n=1')).toEqual(fails(badSavedApi()))
  })

  it('saves the parsed SOLENOID_API at login and init, not the raw value', async () => {
    const { admin_key } = await server.signup()
    vi.stubEnv('SOLENOID_API', ` ${server.api.toUpperCase()}/ `)
    expect(await run('login', admin_key)).toEqual(ok('logged in'))
    expect(creds().api).toBe(server.api)
    expect((await run('init', '--force')).code).toBe(0)
    expect(creds().api).toBe(server.api)
  })

  it.each(['ls', 'key', 'rotate'])('points %s at the saved api when that is the bad one', async (cmd) => {
    const { admin_key } = await server.signup()
    saveCreds({ api: 'api.solenoid.systems', admin_key })
    const args = cmd === 'rotate' ? ['rotate', '--admin', '--yes'] : [cmd, 'acme']
    expect(await run(...args)).toEqual(fails(badSavedApi()))
  })

  it('passes through a client error that is not about the api', async () => {
    saveCreds({ api: server.api } as { api: string; admin_key: string })
    expect(await run('ls')).toEqual(fails('solenoid: set SOLENOID_KEY or pass { key }'))
  })
})

describe('commands that need a login', () => {
  const NOT_LOGGED_IN = 'solenoid: not logged in: run `solenoid init <scope>` for a new account, or `solenoid login <admin-key>` for an existing one'
  it.each([['key', 'acme'], ['limit', 'acme', 'n=1'], ['spend', 'acme', 'n=1'], ['ls'], ['log'], ['rotate', 'acme', '--yes'], ['rotate', '--admin', '--yes']])(
    '%s says how to log in when there are no credentials',
    async (...args) => {
      expect(await run(...args)).toEqual(fails(NOT_LOGGED_IN))
    },
  )
})

describe('key', () => {
  it('prints a spend key that works for the scope and under it, and nowhere else', async () => {
    await loggedIn()
    const r = await run('key', 'acme')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^sk\.spend\.[^\s]+\n$/)
    const key = r.out.trim()
    expect(await client(key).spend('acme/bot', { n: 1 })).toMatchObject({ scope: 'acme/bot' })
    await expect(client(key).spend('other', { n: 1 })).rejects.toMatchObject({ code: 'out_of_scope' })
  })

  it('derives the key at the scope\'s current epoch', async () => {
    const admin = await loggedIn()
    await client(admin).rotate('acme')
    const key = (await run('key', 'acme')).out.trim()
    expect(await client(key).spend('acme', { n: 1 })).toMatchObject({ scope: 'acme' })
  })

  it('strips any number of leading and trailing slashes', async () => {
    await loggedIn()
    const key = (await run('key', '//acme/bot//')).out.trim()
    expect(await client(key).spend('acme/bot', { n: 1 })).toMatchObject({ scope: 'acme/bot' })
    await expect(client(key).spend('acme', { n: 1 })).rejects.toMatchObject({ code: 'out_of_scope' })
  })

  it('prints a root key when no scope is given', async () => {
    await loggedIn()
    const key = (await run('key')).out.trim()
    expect(await client(key).spend('anything', { n: 1 })).toMatchObject({ scope: 'anything' })
  })

  it('rejects a bad scope', async () => {
    await loggedIn()
    expect((await run('key', 'a//b')).err).toMatch(/^solenoid: invalid scope "a\/\/b"\. a scope is up to 8 segments/)
  })
})

describe('limit and ls', () => {
  beforeEach(async () => { await loggedIn() })

  it('sets a limit with every flag and shows the scope', async () => {
    expect(await run('limit', 'acme', 'emails=5', '--per', 'day', '--on-outage', 'open', '--warn-at', '0.5')).toEqual(ok([
      'acme',
      'emails       5        day       used 0  left 5  (acme, open, warn at 0.5)',
    ].join('\n')))
  })

  it('defaults to a lifetime, fail-closed limit with no warning', async () => {
    expect(await run('limit', 'acme', 'usd=12.5', 'emails=3')).toEqual(ok([
      'acme',
      'emails       3        lifetime  used 0  left 3  (acme, closed)',
      'usd          12.5     lifetime  used 0  left 12.5  (acme, closed)',
    ].join('\n')))
  })

  it('removes a limit with "off"', async () => {
    await run('limit', 'acme', 'emails=5')
    expect(await run('limit', 'acme', 'emails=off')).toEqual(ok('acme\n(no limits)'))
  })

  it('shows limits inherited from above, children, and "/" for the root', async () => {
    await run('limit', '/', 'usd=100')
    await run('limit', 'acme', 'emails=2', '--per', 'hour')
    await run('spend', 'acme/bot', 'emails=1')
    await run('spend', 'acme/bat', 'usd=1')
    expect(await run('ls', 'acme')).toEqual(ok([
      'acme',
      'usd          100      lifetime  used 1  left 99  (/, closed)',
      'emails       2        hour      used 1  left 1  (acme, closed)',
      'children: bat bot',
    ].join('\n')))
    expect(await run('ls')).toEqual(ok([
      '/',
      'usd          100      lifetime  used 1  left 99  (/, closed)',
      'children: acme',
    ].join('\n')))
    expect(await run('ls', '/')).toEqual(await run('ls'))
  })

  it('says a per-child limit is tracked separately', async () => {
    await run('limit', 'acme', 'refunds=1', '--per', 'child')
    expect(await run('ls', 'acme')).toEqual(ok([
      'acme',
      'refunds      1        child     tracked separately per child  (acme, closed)',
    ].join('\n')))
  })

  it('refuses a malformed pair before any request', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('no request expected') })
    expect(await run('limit', 'acme', 'emails')).toEqual(fails('solenoid: expected unit=value, got "emails"'))
    expect(await run('limit', 'acme', '=5')).toEqual(fails('solenoid: expected unit=value, got "=5"'))
    expect(await run('limit', 'acme', 'emails=lots')).toEqual(fails('solenoid: not a decimal number: "emails=lots"'))
    expect(await run('limit', 'acme', 'emails=Infinity')).toEqual(fails('solenoid: not a decimal number: "emails=Infinity"'))
  })

  it('reports each invalid_limit field from the service with its own next step', async () => {
    expect(await run('limit', 'acme')).toEqual(fails('solenoid: invalid_limit (400). give at least one <unit>=<n|off> pair, or a rotate flag.'))
    expect(await run('limit', 'acme', 'n=1', '--per', 'fortnight')).toEqual(fails('solenoid: invalid_limit (400). "--per" must be one of hour, day, week, month, child, child-day.'))
    expect(await run('limit', 'acme', 'n=1', '--on-outage', 'maybe')).toEqual(fails('solenoid: invalid_limit (400). "--on-outage" must be open or closed.'))
    expect(await run('limit', 'acme', 'n=1', '--warn-at', '2')).toEqual(fails('solenoid: invalid_limit (400). "--warn-at" must be a fraction greater than 0 and up to 1.'))
    expect(await run('limit', 'acme', 'n=-1')).toEqual(fails('solenoid: invalid_limit (400). the value for "n" must be a number, or "off" to remove it.'))
    expect(await run('ls', 'acme')).toEqual(ok('acme\n(no limits)'))
  })

  it('reports an invalid unit name', async () => {
    expect(await run('limit', 'acme', 'Emails=1')).toEqual(fails(
      'solenoid: invalid_unit (400). "Emails" is not a valid unit name. a unit is lowercase, starts with a letter, and matches [a-z][a-z0-9_]{0,31} ("spends" is reserved).',
    ))
  })

  it('refuses a pair with no value or more than one "=", and a "--warn-at" that is not a number, before any request', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('no request expected') })
    expect(await run('limit', 'acme', 'n=')).toEqual(fails('solenoid: expected unit=value, got "n="'))
    expect(await run('limit', 'acme', 'n=1=2')).toEqual(fails('solenoid: expected unit=value, got "n=1=2"'))
    expect(await run('limit', 'acme', 'n==1')).toEqual(fails('solenoid: expected unit=value, got "n==1"'))
    expect(await run('limit', 'acme', 'n= ')).toEqual(fails('solenoid: not a decimal number: "n= "'))
    for (const v of ['0x10', '0b11', '0o7', '1e3', '1E3', ' 5', '5 ', '+-1', '1.2.3', '.', 'Infinity']) {
      expect(await run('limit', 'acme', `n=${v}`)).toEqual(fails(`solenoid: not a decimal number: "n=${v}"`))
    }
    expect(await run('spend', 'acme', 'n=0x10')).toEqual(fails('solenoid: not a decimal number: "n=0x10"'))
    expect(await run('spend', 'acme', 'n=')).toEqual(fails('solenoid: expected unit=value, got "n="'))
    expect(await run('spend', 'acme', 'n=1=2')).toEqual(fails('solenoid: expected unit=value, got "n=1=2"'))
    for (const w of ['soon', '', ' ', 'Infinity', '1e999', '0x1', '1e-1', '8e-1']) {
      expect(await run('limit', 'acme', 'n=1', '--warn-at', w)).toEqual(fails(`solenoid: "--warn-at" takes a decimal fraction greater than 0 and up to 1, such as 0.8; "${w}" is not a decimal number.`))
    }
  })

  it('refuses a "--warn-at" number out of range through the service', async () => {
    for (const w of ['0', '-0.5', '1.01']) {
      expect(await run('limit', 'acme', 'n=1', `--warn-at=${w}`)).toEqual(fails('solenoid: invalid_limit (400). "--warn-at" must be a fraction greater than 0 and up to 1.'))
    }
    expect(await run('limit', 'acme', 'n=1', '--warn-at', '1')).toEqual(ok('acme\nn            1        lifetime  used 0  left 1  (acme, closed, warn at 1)'))
  })

  it('refuses a leading plus, a leading point and a trailing point: a decimal is digits with an optional minus and fraction', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('no request expected') })
    for (const v of ['+5', '.5', '5.', '.55', '-.5', '+0.5']) {
      expect(await run('limit', 'acme', `n=${v}`)).toEqual(fails(`solenoid: not a decimal number: "n=${v}"`))
      expect(await run('limit', 'acme', 'n=1', `--warn-at=${v}`)).toEqual(fails(`solenoid: "--warn-at" takes a decimal fraction greater than 0 and up to 1, such as 0.8; "${v}" is not a decimal number.`))
    }
  })

  it('accepts multi-digit integers and decimals with several fraction digits', async () => {
    expect(await run('limit', 'acme', 'n=0.55', 'm=12', '--warn-at', '0.25')).toEqual(ok(
      'acme\nm            12       lifetime  used 0  left 12  (acme, closed, warn at 0.25)\nn            0.55     lifetime  used 0  left 0.55  (acme, closed, warn at 0.25)',
    ))
  })

  it('pins: a unit named like a flag is shadowed by the flag, or read as the flag', async () => {
    expect(await run('limit', 'acme', 'per=5')).toEqual(fails('solenoid: invalid_limit (400). "--per" must be one of hour, day, week, month, child, child-day.'))
    expect(await run('limit', 'acme', 'per=5', '--per', 'day')).toEqual(fails('solenoid: invalid_limit (400). give at least one <unit>=<n|off> pair, or a rotate flag.'))
    expect(await run('limit', 'acme', 'warn_at=0.5', 'n=1')).toEqual(ok('acme\nn            1        lifetime  used 0  left 1  (acme, closed, warn at 0.5)'))
  })
})

describe('spend', () => {
  beforeEach(async () => { await loggedIn() })

  it('records a spend and prints its receipt id and sequence number', async () => {
    const r = await run('spend', 'acme/bot', 'emails=2', 'usd=0.25')
    expect(r).toEqual(ok('rcp_1 seq 1'))
    const [entry] = (await run('log', 'acme')).out.split('\n')
    expect(entry).toBe(`     1  2026-03-04T05:06:07.000Z  spend  acme/bot                       {"emails":2,"usd":0.25}`)
  })

  it('refuses a spend over the limit with exit code 1 and the next step on stderr', async () => {
    await run('limit', 'acme', 'emails=2', '--per', 'day')
    await run('spend', 'acme/bot', 'emails=2')
    expect(await run('spend', 'acme/bot', 'emails=1')).toEqual(fails(
      'solenoid: limit_exceeded (402). the limit on "acme" for "emails" is reached (used 2 of 2); it resets at 2026-03-05T00:00:00.000Z. ' +
      'raise it with `solenoid limit acme emails=<n>`, or remove it with `solenoid limit acme emails=off`.',
    ))
  })

  it('refuses "off", a non-number and a malformed pair before any request', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('no request expected') })
    expect(await run('spend', 'acme', 'emails=off')).toEqual(fails('solenoid: spend does not take "off"; give a number for "emails"'))
    expect(await run('spend', 'acme', 'emails=1', 'usd=off')).toEqual(fails('solenoid: spend does not take "off"; give a number for "usd"'))
    expect(await run('spend', 'acme', 'emails=x')).toEqual(fails('solenoid: not a decimal number: "emails=x"'))
    expect(await run('spend', 'acme', 'emails')).toEqual(fails('solenoid: expected unit=value, got "emails"'))
    expect(await run('spend', 'acme')).toEqual(fails('solenoid: nothing to spend'))
    expect(await run('spend', 'acme', 'emails=-1')).toEqual(fails('solenoid: invalid amount for emails'))
    expect(await run('spend', 'ACME', 'emails=1')).toEqual(fails(
      'solenoid: invalid scope "ACME". a scope is up to 8 segments separated by "/", each 1 to 64 characters of lowercase a-z, 0-9, . _ -, and not made only of dots.',
    ))
  })

  it('refuses an invalid unit name from the service', async () => {
    expect((await run('spend', 'acme', 'spends=1')).err).toBe(
      'solenoid: invalid_unit (400). "spends" is not a valid unit name. a unit is lowercase, starts with a letter, and matches [a-z][a-z0-9_]{0,31} ("spends" is reserved).\n',
    )
  })

  it('fails closed when solenoid is unreachable and nothing is cached, with a runnable command for the scope', async () => {
    server.outage(true)
    expect(await run('spend', 'acme/bot', 'emails=1')).toEqual(fails(FAILS_CLOSED('acme/bot')))
  })

  it('fails open under an on-outage open limit once a spend has cached its mode, and records nothing', async () => {
    await run('limit', 'acme', 'emails=5', '--on-outage', 'open')
    expect((await run('spend', 'acme', 'emails=1')).code).toBe(0)
    server.outage(true)
    expect(await run('spend', 'acme/bot', 'emails=1')).toEqual(ok(
      'solenoid could not be reached, and your outage cache says the limits on "acme/bot" fail open, so the spend went ahead without a record.',
    ))
    server.outage(false)
    expect((await sdkAdmin().get('')).entries.filter((e) => e.kind === 'spend')).toHaveLength(1)
  })

  it('prints the root scope as "/" when a root spend fails closed or open', async () => {
    server.outage(true)
    expect(await run('spend', '/', 'emails=1')).toEqual(fails(FAILS_CLOSED('/')))
    server.outage(false)
    await run('limit', '/', 'emails=5', '--on-outage', 'open')
    await run('spend', '/', 'emails=1')
    server.outage(true)
    expect(await run('spend', '/', 'emails=1')).toEqual(ok(
      'solenoid could not be reached, and your outage cache says the limits on "/" fail open, so the spend went ahead without a record.',
    ))
  })

  it('reports a recorded spend as done when the outage cache cannot be written, so a retry does not spend twice', async () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    const home = join(tempDir('home-'), 'a-file')
    writeFileSync(home, '')
    vi.stubEnv('HOME', home)
    await run('limit', 'acme', 'emails=5', '--on-outage', 'open')
    expect(await run('spend', 'acme', 'emails=1')).toEqual(ok('rcp_2 seq 2'))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/^solenoid: could not save the outage cache at .*: ENOTDIR/)
    expect((await sdkAdmin().get('acme')).limits[0]).toMatchObject({ used: 1 })
  })

  it('fails closed under an on-outage closed limit even with its mode cached', async () => {
    await run('limit', 'acme', 'emails=5')
    await run('spend', 'acme', 'emails=1')
    server.outage(true)
    expect(await run('spend', 'acme', 'emails=1')).toEqual(fails(FAILS_CLOSED('acme')))
  })

  it('reaches the outage cache only through the guarded homedir, so a HOME outside the sandbox throws before any file is touched', async () => {
    vi.stubEnv('HOME', join(sandbox, '..', 'not-a-sandbox'))
    expect(() => fileStore()).toThrow(/^test HOME is not a sandbox/)
    expect(await run('spend', 'acme', 'emails=1')).toEqual(fails(`solenoid: test HOME is not a sandbox: ${join(sandbox, '..', 'not-a-sandbox')}`))
  })

  it('keeps the outage cache in the sandboxed home, where SDK clients on the default fileStore() read it too', async () => {
    const admin_key = creds().admin_key
    await run('limit', 'acme', 'emails=5', '--on-outage', 'open')
    await run('spend', 'acme', 'emails=1')
    const file = assertInSandbox(join(homedir(), '.cache', 'solenoid', 'outage.json'))
    expect(file.startsWith(`${process.env.HOME}${sep}`)).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ acme: 'open' })
    server.outage(true)
    expect(await sdk({ key: admin_key, api: server.api, fetch: server.fetch, store: fileStore() }).spend('acme/x', { emails: 1 })).toBeNull()
  })
})

describe('log', () => {
  beforeEach(async () => { await loggedIn() })

  it('prints newest first with the root shown as "/"', async () => {
    await run('limit', '/', 'n=10')
    await run('spend', 'acme', 'n=1')
    expect(await run('log')).toEqual(ok([
      '     2  2026-03-04T05:06:07.000Z  spend  acme                           {"n":1}',
      '     1  2026-03-04T05:06:07.000Z  limit  /                              {"limits":{"n":10},"per":null,"on_outage":"closed"}',
    ].join('\n')))
  })

  it('prints nothing for a scope with no entries', async () => {
    expect(await run('log', 'acme')).toEqual(ok(''))
  })

  it('pages with --before and prints the next command while there are more', async () => {
    const admin = sdkAdmin()
    for (let i = 0; i < 52; i++) await admin.spend('acme', { n: 1 })
    const first = (await run('log', 'acme')).out.split('\n')
    expect(first).toHaveLength(52)
    expect(first[0]).toMatch(/^    52  /)
    expect(first[49]).toMatch(/^     3  /)
    expect(first[50]).toBe('more: solenoid log acme --before 3')
    const second = (await run('log', 'acme', '--before', '3')).out.split('\n')
    expect(second.map((l) => l.slice(0, 6))).toEqual(['     2', '     1', ''])
    expect((await run('log', '--before', '3')).out.split('\n')).toHaveLength(3)
  })

  it('pins: the root scope\'s "more:" line has two spaces where the scope would go', async () => {
    const admin = sdkAdmin()
    for (let i = 0; i < 51; i++) await admin.spend('acme', { n: 1 })
    expect((await run('log')).out.split('\n').at(-2)).toBe('more: solenoid log  --before 2')
  })

  it('pins: "--before" that is not a number reaches the service as NaN and gets no next step', async () => {
    expect(await run('log', 'acme', '--before', 'abc')).toEqual(fails('solenoid: invalid_before (400)'))
  })
})

describe('rotate', () => {
  it('asks for --yes before rotating a scope, and rotates nothing', async () => {
    const admin = await loggedIn()
    const key = await client(admin).deriveKey('acme')
    expect(await run('rotate', 'acme')).toEqual(fails(
      'solenoid: this revokes every key derived for "acme": every deployed copy will fail with invalid_key. keys derived separately for scopes under "acme" keep working. ' +
      're-run with --yes to confirm; this command then prints a fresh key for "acme" to redeploy, so no separate `solenoid key` run is needed.',
    ))
    expect(await client(key).spend('acme', { n: 1 })).toMatchObject({ scope: 'acme' })
  })

  it('asks for --yes before rotating the admin key, and rotates nothing', async () => {
    const admin = await loggedIn()
    expect(await run('rotate', '--admin')).toEqual(fails(
      'solenoid: rotating the admin key revokes every key: this admin key, and every spend key derived from it, across every scope. re-run with --yes to confirm; ' +
      'this command then prints and saves the new admin key for you (no separate `solenoid login` needed), but every spend key must still be re-derived with ' +
      '`solenoid key <scope>` and redeployed.',
    ))
    expect(creds().admin_key).toBe(admin)
    expect((await client(admin).get('')).scope).toBe('')
  })

  it('rejects a bad scope before asking for confirmation', async () => {
    await loggedIn()
    expect((await run('rotate', 'ACME')).err).toMatch(/^solenoid: invalid scope "ACME"\./)
  })

  it('revokes the scope\'s keys and prints a fresh one that works', async () => {
    const admin = await loggedIn()
    const old = await client(admin).deriveKey('acme')
    const r = await run('rotate', 'acme', '--yes')
    const key = /new key: (sk\.spend\.[^\s]+?)\. redeploy/.exec(r.out)?.[1] ?? ''
    expect(r).toEqual(ok(`every key derived for "acme" before now is revoked. new key: ${key}. redeploy it wherever the old one was used; no further \`solenoid key\` run is needed.`))
    await expect(client(old).spend('acme', { n: 1 })).rejects.toMatchObject({ code: 'invalid_key' })
    expect(await client(key).spend('acme', { n: 1 })).toMatchObject({ scope: 'acme' })
    expect((await run('rotate', 'acme', '--yes')).out).not.toContain(key)
  })

  it('rotates the admin key, saves the new one privately and keeps working', async () => {
    const admin = await loggedIn()
    await run('limit', 'acme', 'emails=1')
    const r = await run('rotate', '--admin', '--yes')
    const fresh = creds().admin_key
    expect(fresh).toMatch(/^sk\.admin\./)
    expect(fresh).not.toBe(admin)
    expect(creds().api).toBe(server.api)
    expect(r).toEqual(ok([
      `new admin key: ${fresh}`,
      `it is saved at ${join(config, 'credentials')}, and this CLI uses it from here on. back it up somewhere safe.`,
      'every previous key (admin and spend) now fails. re-derive each spend key with `solenoid key <scope>` and redeploy them.',
    ].join('\n')))
    expect(statSync(join(config, 'credentials')).mode & 0o777).toBe(0o600)
    await expect(client(admin).get('')).rejects.toMatchObject({ code: 'invalid_key' })
    expect((await run('ls', 'acme')).out).toMatch(/^acme\nemails/)
  })

  it('prints the new admin key before saving it, and says it is the only copy when the save fails', async () => {
    const admin = await loggedIn()
    const file = join(config, 'credentials')
    chmodSync(file, 0o400)
    const r = await run('rotate', '--admin', '--yes')
    const fresh = /^new admin key: (sk\.admin\.\S+)\n$/.exec(r.out)?.[1] ?? ''
    expect(r).toEqual({
      code: 1,
      out: `new admin key: ${fresh}\n`,
      err: 'solenoid: the new admin key printed on stdout is the only copy. copy it somewhere safe now. every previous key, admin and spend, already fails. ' +
        `once ${file} is writable, run \`SOLENOID_API=${server.api} solenoid login <admin-key>\` with it, then re-derive each spend key with \`solenoid key <scope>\` and redeploy them. ` +
        `saving failed with: EACCES: permission denied, open '${file}'\n`,
    })
    expect(creds().admin_key).toBe(admin)
    expect((await client(fresh).get('')).scope).toBe('')
    await expect(client(admin).get('')).rejects.toMatchObject({ code: 'invalid_key' })
  })

  it('says the rotation may have gone through when its request fails without an answer, and never retries it', async () => {
    const admin = await loggedIn()
    let puts = 0
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await server.fetch(input, init)
      if (init?.method !== 'PUT') return res
      puts++
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    expect(await run('rotate', '--admin', '--yes')).toEqual(fails(
      'solenoid: the rotation request failed before solenoid confirmed it, so it may have gone through. wait a minute, since the request may still be on its way, then check with `solenoid ls`. ' +
      'if it works, nothing changed: run `solenoid rotate --admin --yes` again. if it fails with invalid_key, the rotation went through. its new admin key was lost. ' +
      'if the account has a recovery email, `solenoid recover <email>` returns the current key. ' +
      'otherwise start a new account with `solenoid init --force`, which overwrites the saved admin key.',
    ))
    expect(puts).toBe(1)
    expect(creds().admin_key).toBe(admin)
    expect((await run('ls')).err).toMatch(/^solenoid: invalid_key \(401\)/)
  })

  it('passes a refusal of the rotation through, printing no key', async () => {
    saveCreds({ api: server.api, admin_key: 'sk.admin.nosuchtenant.0.deadbeef' })
    const r = await run('rotate', '--admin', '--yes')
    expect([r.code, r.out]).toEqual([1, ''])
    expect(r.err).toMatch(/^solenoid: invalid_key \(401\)\. /)
  })

  it('waits longer than the default two seconds for the rotation to answer', async () => {
    await loggedIn()
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'PUT') return server.fetch(input, init)
      return new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(server.fetch(input, init)), 2500)
        init.signal!.addEventListener('abort', () => { clearTimeout(t); reject(init.signal!.reason) })
      })
    })
    const r = await run('rotate', '--admin', '--yes')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^new admin key: sk\.admin\./)
  })
})

describe('API errors', () => {
  it('explains invalid_key with exit code 1', async () => {
    saveCreds({ api: server.api, admin_key: 'sk.admin.nosuchtenant.0.deadbeef' })
    const r = await run('ls')
    expect(r.code).toBe(1)
    expect(r.out).toBe('')
    expect(r.err).toMatch(/^solenoid: invalid_key \(401\)\. this admin key \(it starts sk\.admin\.\) is invalid or was rotated elsewhere;.*then re-derive and redeploy\. if the admin key is lost, `solenoid recover <email>` gets it back when the account has a recovery email\.\n$/)
  })

  it('explains admin_required when the saved key is a spend key', async () => {
    const admin = (await server.signup()).admin_key
    saveCreds({ api: server.api, admin_key: await client(admin).deriveKey('acme') })
    expect(await run('limit', 'acme', 'n=1')).toEqual(fails('solenoid: admin_required (403). this needs the admin key. run `solenoid login <admin-key>` first.'))
  })

  it('explains out_of_scope with both scopes', async () => {
    const admin = (await server.signup()).admin_key
    saveCreds({ api: server.api, admin_key: await client(admin).deriveKey('acme') })
    expect(await run('spend', 'other', 'n=1')).toEqual(fails(
      'solenoid: out_of_scope (403). the key only covers "acme" and scopes under it, not "other". use a key derived for "other" or an ancestor of it.',
    ))
  })

  it('pins: a read during an outage says only "solenoid unreachable"', async () => {
    await loggedIn()
    server.outage(true)
    expect(await run('ls', 'acme')).toEqual(fails('solenoid unreachable'))
  })

  it('pins: a limit during an outage is not retried', async () => {
    await loggedIn()
    server.outage(true)
    expect(await run('limit', 'acme', 'n=1')).toEqual(fails('solenoid: request failed and is not safe to retry'))
  })

  it('reads a credentials file written by hand, whatever its mode', async () => {
    const admin = await loggedIn()
    chmodSync(join(config, 'credentials'), 0o644)
    expect((await run('ls')).code).toBe(0)
    expect(creds().admin_key).toBe(admin)
  })
})

const codeIn = (text: string) => /\b(\d{6})\b/.exec(text)![1]
const MIXED = ' Robin@Example.COM '
const onlyLowercase = (out: string) => {
  const found = out.match(/robin@example\.com/gi) ?? []
  expect(found.length).toBeGreaterThan(0)
  expect(found.filter((m) => m !== 'robin@example.com')).toEqual([])
  expect(out).not.toMatch(/\s{2}robin@example\.com|robin@example\.com\s{2}/i)
}
const rateLimited = (cmd: string) => `${formatError(Object.assign(new Error('solenoid: rate_limited (429)'), { code: 'rate_limited' }), cmd)}\n`
const suggested = (out: string) => /`(solenoid recover [^`]*)`/.exec(out)?.[1]
const keyLine = (out: string, key: string) => expect(out.split('\n').some((l) => l.endsWith(key))).toBe(true)

describe('recovery email', () => {
  it('init --email sends a code, and init without it says how to attach one', async () => {
    const server = await freshServer(); useConfigDir(); const cwd = tempDir('cwd-')
    const r = await solenoid(cwd, 'init', 'acme', '--email', MIXED)
    expect(r.code).toBe(0)
    expect(r.out).toContain('`solenoid email robin@example.com <code>`')
    onlyLowercase(r.out)
    expect((await server.outbox()).map((m) => m.to)).toEqual(['robin@example.com'])
    useConfigDir()
    const plain = await solenoid(tempDir('cwd-'), 'init')
    expect(plain.out).toContain('solenoid email <address>')
  })

  it('init --email keeps the new account when the send fails', async () => {
    const server = await freshServer(); const dir = useConfigDir()
    server.mailDown(true)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await solenoid(tempDir('cwd-'), 'init', '--email', MIXED)
    expect(r.code).toBe(0)
    expect(readFileSync(`${dir}/credentials`, 'utf8')).toContain('sk.admin.')
    expect(r.out).toContain('(email_failed)')
    expect(r.out).toContain('`solenoid email robin@example.com`')
    expect(r.out).not.toContain('solenoid:')
    onlyLowercase(r.out)
    expect(logged).toHaveBeenCalledWith(new Error('mail is down'))
  })

  it('init --email offers the retry only when a retry can work', async () => {
    const server = await freshServer()
    useConfigDir()
    const bad = await solenoid(tempDir('cwd-'), 'init', '--email', 'not-an-address')
    expect(bad.code).toBe(0)
    expect(bad.out).toContain('not-an-address')
    expect(bad.out).toContain('(invalid_email)')
    expect(bad.out).toContain('`solenoid email <address>`')
    expect(bad.out).not.toContain('solenoid email not-an-address')
    const answer = (res: () => Promise<Response>) => vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/auth/email') ? res() : server.fetch(input, init))
    answer(() => Promise.reject(new TypeError('fetch failed')))
    useConfigDir()
    const down = await solenoid(tempDir('cwd-'), 'init', '--email', 'robin@example.com')
    expect(down.code).toBe(0)
    expect(down.out).toContain('`solenoid email robin@example.com`')
    expect(down.out).not.toContain('solenoid:')
    answer(async () => Response.json({ error: 'rate_limited' }, { status: 429 }))
    useConfigDir()
    const limited = await solenoid(tempDir('cwd-'), 'init', '--email', 'robin@example.com')
    expect(limited.code).toBe(0)
    expect(limited.out).toContain('(rate_limited)')
    expect(limited.out).toContain('`solenoid email <address>`')
    expect(limited.out).not.toContain('solenoid email robin@example.com')
  })

  it('email sends a code, refuses a wrong one, and confirms the right one', async () => {
    const server = await freshServer(); useConfigDir(); const cwd = tempDir('cwd-')
    await solenoid(cwd, 'init')
    const sent = await solenoid(cwd, 'email', MIXED)
    expect(sent.code).toBe(0)
    expect(sent.out).toContain('solenoid email robin@example.com')
    onlyLowercase(sent.out)
    expect((await server.outbox()).map((m) => m.to)).toEqual(['robin@example.com'])
    const c = codeIn((await server.outbox())[0].text)
    const wrong = await solenoid(cwd, 'email', 'robin@example.com', c === '000000' ? '000001' : '000000')
    expect(wrong.code).toBe(1)
    expect(wrong.err).toMatch(/^solenoid: invalid_code \(400\)\. /)
    const before = readFileSync(`${process.env.SOLENOID_CONFIG_DIR}/credentials`, 'utf8')
    const ok = await solenoid(cwd, 'email', 'robin@example.com', c)
    expect(ok).toEqual({
      code: 0,
      out: `robin@example.com can now recover the admin key of account ${tenantOf(JSON.parse(before).admin_key)}. keep the confirmation email: it names the account ID, which recovery asks for.\n`,
      err: '',
    })
    expect(readFileSync(`${process.env.SOLENOID_CONFIG_DIR}/credentials`, 'utf8')).toBe(before)
  })

  it('email names the per-address and per-account limits when it is rate limited', async () => {
    await freshServer(); useConfigDir(); const cwd = tempDir('cwd-')
    await solenoid(cwd, 'init')
    for (let i = 0; i < 5; i++) expect((await solenoid(cwd, 'email', 'robin@example.com')).code).toBe(0)
    expect(await solenoid(cwd, 'email', 'robin@example.com')).toEqual({ code: 1, out: '', err: rateLimited('email') })
  })

  it('email with no address says how to use it', async () => {
    await freshServer(); useConfigDir(); const cwd = tempDir('cwd-')
    await solenoid(cwd, 'init')
    const r = await solenoid(cwd, 'email')
    expect(r.code).toBe(1)
    expect(r.err).toContain('solenoid email <address>')
  })
})

describe('email --rotate', () => {
  async function codeSentTo(email = 'robin@example.com') {
    await run('email', email)
    return codeIn((await server.outbox()).at(-1)!.text)
  }

  it('attaches the address and replaces the admin key in one step, printing the new key before saving it', async () => {
    const admin = await loggedIn()
    const spendKey = await client(admin).deriveKey('acme')
    const c = await codeSentTo()
    const r = await run('email', 'robin@example.com', c, '--rotate')
    const fresh = creds().admin_key
    expect(fresh).not.toBe(admin)
    expect(r).toEqual(ok([
      `new admin key: ${fresh}`,
      `robin@example.com can now recover the admin key of account ${tenantOf(admin)}. keep the confirmation email: it names the account ID, which recovery asks for.`,
      `the new admin key is saved at ${join(config, 'credentials')}, and this CLI uses it from here on. back it up somewhere safe.`,
      'every previous key (admin and spend) now fails. re-derive each spend key with `solenoid key <scope>` and redeploy them.',
    ].join('\n')))
    expect(creds().api).toBe(server.api)
    expect(statSync(join(config, 'credentials')).mode & 0o777).toBe(0o600)
    await expect(client(admin).get('')).rejects.toMatchObject({ code: 'invalid_key' })
    await expect(client(spendKey).get('acme')).rejects.toMatchObject({ code: 'invalid_key' })
    expect((await run('ls')).code).toBe(0)
  })

  it('says the printed key is the only copy when the save fails', async () => {
    const admin = await loggedIn()
    const c = await codeSentTo()
    const file = join(config, 'credentials')
    chmodSync(file, 0o400)
    const r = await run('email', 'robin@example.com', c, '--rotate')
    const fresh = /^new admin key: (sk\.admin\.\S+)\n$/.exec(r.out)?.[1] ?? ''
    expect(r).toEqual({
      code: 1,
      out: `new admin key: ${fresh}\n`,
      err: 'solenoid: the new admin key printed on stdout is the only copy. copy it somewhere safe now. every previous key, admin and spend, already fails. ' +
        `once ${file} is writable, run \`SOLENOID_API=${server.api} solenoid login <admin-key>\` with it, then re-derive each spend key with \`solenoid key <scope>\` and redeploy them. ` +
        `saving failed with: EACCES: permission denied, open '${file}'\n`,
    })
    expect(creds().admin_key).toBe(admin)
    expect((await client(fresh).get('')).scope).toBe('')
  })

  it('says the change may have gone through when its request fails without an answer, and never retries it', async () => {
    const admin = await loggedIn()
    const c = await codeSentTo()
    let verifies = 0
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await server.fetch(input, init)
      if (!String(init?.body).includes('"code"')) return res
      verifies++
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    expect(await run('email', 'robin@example.com', c, '--rotate')).toEqual(fails(
      [
        'solenoid: the request failed before solenoid confirmed it, so it may have gone through. wait a minute, then run `solenoid ls`.',
        'if `solenoid ls` works, nothing changed, but the code may be used up. get a new code with `solenoid email robin@example.com`, then run `solenoid email robin@example.com <code> --rotate` again.',
        'if it fails with invalid_key, the admin key was replaced, by this change or by someone else first. run `solenoid recover robin@example.com`.',
        'if a code arrives, robin@example.com is the recovery email. `solenoid recover robin@example.com <code>` prints and saves the current admin key. then re-derive each spend key with `solenoid key <scope>` and redeploy them.',
        'if no code arrives within a few minutes, and robin@example.com has had fewer than 5 codes this hour, robin@example.com is not the recovery email. someone else replaced the key, and robin@example.com can\'t recover the account. `solenoid init --force` starts a new account and overwrites the saved admin key.',
        'if solenoid still can\'t be reached, wait, then run `solenoid ls` again.',
      ].join('\n'),
    ))
    expect(verifies).toBe(1)
    expect(creds().admin_key).toBe(admin)
    expect((await run('ls')).err).toMatch(/^solenoid: invalid_key \(401\)/)
  })

  it('waits for a change that takes longer than the default two seconds to answer', async () => {
    await loggedIn()
    const c = await codeSentTo()
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(init?.body).includes('"code"')) return server.fetch(input, init)
      return new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(server.fetch(input, init)), 2500)
        init!.signal!.addEventListener('abort', () => { clearTimeout(t); reject(init!.signal!.reason) })
      })
    })
    const r = await run('email', 'robin@example.com', c, '--rotate')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^new admin key: sk\.admin\./)
  })

  it('passes a wrong code through, printing no key and changing nothing', async () => {
    const admin = await loggedIn()
    const c = await codeSentTo()
    const r = await run('email', 'robin@example.com', c === '000000' ? '000001' : '000000', '--rotate')
    expect([r.code, r.out]).toEqual([1, ''])
    expect(r.err).toMatch(/^solenoid: invalid_code \(400\)\. /)
    expect(creds().admin_key).toBe(admin)
    expect((await client(admin).get('')).scope).toBe('')
  })

  it('refuses --rotate on the run that sends the code, before any request', async () => {
    await loggedIn()
    const requests = vi.fn(server.fetch)
    vi.stubGlobal('fetch', requests)
    expect(await run('email', MIXED, '--rotate')).toEqual(fails(
      'solenoid: --rotate goes on the second run, the one that confirms the code. nothing was sent. run `solenoid email robin@example.com` to get a code, then `solenoid email robin@example.com <code> --rotate`.',
    ))
    expect(requests).not.toHaveBeenCalled()
    expect(await server.outbox()).toEqual([])
  })
})

describe('recover', () => {
  async function attachedAccount() {
    const server = await freshServer(); const dir = useConfigDir(); const cwd = tempDir('cwd-')
    await solenoid(cwd, 'init', 'acme')
    await solenoid(cwd, 'email', 'robin@example.com')
    await solenoid(cwd, 'email', 'robin@example.com', codeIn((await server.outbox())[0].text))
    const creds = readFileSync(`${dir}/credentials`, 'utf8')
    return { server, dir, cwd, creds, adminKey: JSON.parse(creds).admin_key as string }
  }

  it('finds the tenant in ./.env and restores the same admin key', async () => {
    const { server, dir, cwd, adminKey } = await attachedAccount()
    rmSync(`${dir}/credentials`)
    const asked = await solenoid(cwd, 'recover', MIXED)
    expect(asked.code).toBe(0)
    expect(suggested(asked.out)).toBe('solenoid recover robin@example.com <code>')
    expect(asked.out).toContain('--rotate')
    expect(asked.out).toContain(adminKey.split('.')[2])
    onlyLowercase(asked.out)
    const r = await solenoid(cwd, 'recover', 'robin@example.com', codeIn((await server.outbox()).at(-1)!.text))
    expect(r.code).toBe(0)
    keyLine(r.out, adminKey)
    expect(r.out).toContain(join(dir, 'credentials'))
    expect(JSON.parse(readFileSync(`${dir}/credentials`, 'utf8')).admin_key).toBe(adminKey)
  })

  it('takes the tenant from --tenant, SOLENOID_KEY or the saved admin key, and asks for it when nothing names one', async () => {
    const { server, dir, adminKey } = await attachedAccount()
    const bare = tempDir('cwd-')
    const fromSaved = await solenoid(bare, 'recover', 'robin@example.com')
    expect(fromSaved.code).toBe(0)
    expect(fromSaved.out).toContain(adminKey.split('.')[2])
    rmSync(`${dir}/credentials`)
    const none = await solenoid(bare, 'recover', 'robin@example.com')
    expect(none.code).toBe(1)
    expect(none.err).toContain('--tenant')
    expect(none.err).not.toContain('undefined')
    const tenant = adminKey.split('.')[2]
    vi.stubEnv('SOLENOID_KEY', `sk.spend.${tenant}.1.0.YWNtZQ.${'0'.repeat(64)}`)
    expect((await solenoid(bare, 'recover', 'robin@example.com')).code).toBe(0)
    vi.stubEnv('SOLENOID_KEY', '')
    const flagged = await solenoid(bare, 'recover', 'robin@example.com', '--tenant', tenant)
    expect(flagged.code).toBe(0)
    expect(suggested(flagged.out)).toBe(`solenoid recover robin@example.com <code> --tenant ${tenant}`)
    expect((await server.outbox()).length).toBeGreaterThanOrEqual(4)
  })

  it('--rotate saves a new key and revokes the old one', async () => {
    const { server, dir, cwd, adminKey } = await attachedAccount()
    await solenoid(cwd, 'recover', 'robin@example.com')
    const r = await solenoid(cwd, 'recover', 'robin@example.com', codeIn((await server.outbox()).at(-1)!.text), '--rotate')
    expect(r.code).toBe(0)
    const saved = JSON.parse(readFileSync(`${dir}/credentials`, 'utf8')).admin_key
    expect(saved).not.toBe(adminKey)
    keyLine(r.out, saved)
    expect(r.out).toContain(join(dir, 'credentials'))
    await expect(client(adminKey).get('')).rejects.toMatchObject({ code: 'invalid_key' })
    expect((await solenoid(cwd, 'ls')).code).toBe(0)
  })

  it('refuses to overwrite a different saved account without --force', async () => {
    const { server, dir, cwd } = await attachedAccount()
    const tenant = JSON.parse(readFileSync(`${dir}/credentials`, 'utf8')).admin_key.split('.')[2]
    const other = useConfigDir()
    await solenoid(tempDir('cwd-'), 'init')
    const before = readFileSync(`${other}/credentials`, 'utf8')
    await solenoid(cwd, 'recover', 'robin@example.com', '--tenant', tenant)
    const r = await solenoid(cwd, 'recover', 'robin@example.com', codeIn((await server.outbox()).at(-1)!.text), '--tenant', tenant)
    expect(r.code).toBe(1)
    expect(r.err).toContain('--force')
    expect(readFileSync(`${other}/credentials`, 'utf8')).toBe(before)
    const forced = await solenoid(cwd, 'recover', 'robin@example.com', codeIn((await server.outbox()).at(-1)!.text), '--tenant', tenant, '--force')
    expect(forced.code).toBe(0)
    expect(tenantOf(JSON.parse(readFileSync(`${other}/credentials`, 'utf8')).admin_key)).toBe(tenant)
  })

  async function unwritableConfig() {
    const parent = tempDir('locked-')
    chmodSync(parent, 0o500)
    const dir = join(parent, 'solenoid')
    vi.stubEnv('SOLENOID_CONFIG_DIR', dir)
    return { dir, unlock: () => chmodSync(parent, 0o700) }
  }

  it('--rotate prints the new admin key before saving it, and says it is the only copy when the save fails', async () => {
    const { server, cwd, adminKey } = await attachedAccount()
    const tenant = tenantOf(adminKey)!
    await solenoid(cwd, 'recover', 'robin@example.com')
    const { dir, unlock } = await unwritableConfig()
    try {
      const r = await solenoid(cwd, 'recover', 'robin@example.com', codeIn((await server.outbox()).at(-1)!.text), '--tenant', tenant, '--rotate')
      const fresh = /^new admin key: (sk\.admin\.\S+)\n$/.exec(r.out)?.[1] ?? ''
      expect(r).toEqual({
        code: 1,
        out: `new admin key: ${fresh}\n`,
        err: 'solenoid: the new admin key printed on stdout is the only copy. copy it somewhere safe now. every previous key, admin and spend, already fails. ' +
          `once ${join(dir, 'credentials')} is writable, run \`SOLENOID_API=${server.api} solenoid login <admin-key>\` with it, then re-derive each spend key with \`solenoid key <scope>\` and redeploy them. ` +
          `saving failed with: EACCES: permission denied, mkdir '${dir}'\n`,
      })
      expect(existsSync(dir)).toBe(false)
      const api = (key: string) => sdk({ key, api: server.api, fetch: server.fetch })
      expect((await api(fresh).get('')).scope).toBe('')
      await expect(api(adminKey).get('')).rejects.toMatchObject({ code: 'invalid_key' })
    } finally {
      unlock()
    }
  })

  it('prints the admin key before saving it, and says the printed key works when the save fails', async () => {
    const { server, cwd, adminKey } = await attachedAccount()
    const tenant = tenantOf(adminKey)!
    await solenoid(cwd, 'recover', 'robin@example.com')
    const { dir, unlock } = await unwritableConfig()
    try {
      const r = await solenoid(cwd, 'recover', 'robin@example.com', codeIn((await server.outbox()).at(-1)!.text), '--tenant', tenant)
      expect(r).toEqual({
        code: 1,
        out: `admin key: ${adminKey}\n`,
        err: 'solenoid: the admin key printed on stdout works, and so does every deployed spend key. saving it failed, so copy it somewhere safe now. ' +
          `once ${join(dir, 'credentials')} is writable, run \`SOLENOID_API=${server.api} solenoid login <admin-key>\` with it. ` +
          `saving failed with: EACCES: permission denied, mkdir '${dir}'\n`,
      })
      expect(existsSync(dir)).toBe(false)
    } finally {
      unlock()
    }
  })

  it('refuses to replace a credentials file it cannot read without --force, keeps the code good, and replaces it with --force', async () => {
    const { server, dir, cwd, adminKey } = await attachedAccount()
    const tenant = tenantOf(adminKey)!
    const file = join(dir, 'credentials')
    for (const broken of ['{"api": "http://127.0.0.1", "admin_key": ', 'null', '{}']) {
      writeFileSync(file, broken)
      const asked = await solenoid(cwd, 'recover', 'robin@example.com', '--tenant', tenant)
      expect(asked.code).toBe(0)
      const c = codeIn((await server.outbox()).at(-1)!.text)
      const r = await solenoid(cwd, 'recover', 'robin@example.com', c, '--tenant', tenant)
      expect(r).toEqual({ code: 1, out: '', err: `solenoid: ${file} holds no admin key solenoid can read. the code is still good: re-run with --force to replace the file, or delete it and re-run.\n` })
      expect(readFileSync(file, 'utf8')).toBe(broken)
      const forced = await solenoid(cwd, 'recover', 'robin@example.com', c, '--tenant', tenant, '--force')
      expect(forced.code).toBe(0)
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ api: server.api, admin_key: adminKey })
    }
  })

  it('treats a credentials file it cannot read as naming no account', async () => {
    const { dir } = await attachedAccount()
    writeFileSync(join(dir, 'credentials'), 'not json')
    const r = await solenoid(tempDir('cwd-'), 'recover', 'robin@example.com')
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/^solenoid: recover needs the account ID: pass --tenant <id>\./)
  })

  it('recover names the per-network limit when it is rate limited', async () => {
    const server = await freshServer(); useConfigDir()
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/auth/recover') ? Promise.resolve(Response.json({ error: 'rate_limited' }, { status: 429 })) : server.fetch(input, init))
    expect(await solenoid(tempDir('cwd-'), 'recover', 'robin@example.com', '--tenant', 'abcdefghijkl')).toEqual({ code: 1, out: '', err: rateLimited('recover') })
  })

  it.each(['ABCDEFGHIJKL', 'abcdefghijk', 'abcdefghijkl1', 'xabcdefghijkl', 'abcdefghijklx', 'abcdefghij01'])('refuses --tenant %j before any request', async (bad) => {
    await freshServer(); useConfigDir()
    const urls: string[] = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => { urls.push(String(input)); return Promise.reject(new Error('no request expected')) })
    const r = await solenoid(tempDir('cwd-'), 'recover', 'robin@example.com', '--tenant', bad)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(new RegExp(`^solenoid: "${bad}" [^\n]*--tenant[^\n]*\n$`))
    expect(urls).toEqual([])
  })

  it('prefers --tenant to SOLENOID_KEY, SOLENOID_KEY to ./.env, and ./.env to the saved admin key', async () => {
    const { adminKey, cwd } = await attachedAccount()
    const a = adminKey.split('.')[2]
    useConfigDir()
    await solenoid(tempDir('cwd-'), 'init')
    const b = tenantOf(JSON.parse(readFileSync(`${process.env.SOLENOID_CONFIG_DIR}/credentials`, 'utf8')).admin_key)!
    const named = async (...args: string[]) => {
      const r = await solenoid(cwd, 'recover', 'robin@example.com', ...args)
      expect(r.code).toBe(0)
      return [r.out.includes(a), r.out.includes(b)]
    }
    expect(await named()).toEqual([true, false])
    vi.stubEnv('SOLENOID_KEY', `sk.spend.${b}.1.0.YWNtZQ.${'0'.repeat(64)}`)
    expect(await named()).toEqual([false, true])
    expect(await named('--tenant', a)).toEqual([true, false])
  })

  it('restores without --force when the saved admin key is the same account', async () => {
    const { server, dir, cwd, adminKey } = await attachedAccount()
    await solenoid(cwd, 'recover', 'robin@example.com')
    const r = await solenoid(cwd, 'recover', 'robin@example.com', codeIn((await server.outbox()).at(-1)!.text))
    expect(r.code).toBe(0)
    expect(JSON.parse(readFileSync(`${dir}/credentials`, 'utf8')).admin_key).toBe(adminKey)
  })

  it('recover with no email says how to use it', async () => {
    await freshServer(); useConfigDir()
    const r = await solenoid(tempDir('cwd-'), 'recover', '--tenant', 'abcdefghijkl')
    expect(r.code).toBe(1)
    expect(r.err).toContain('solenoid recover <email>')
  })
})

describe('tenantOf', () => {
  const t = 'abcdefghij23'
  it.each([
    [`sk.admin.${t}.1.ff`, t],
    [`sk.spend.${t}.1.0.YWNtZQ.ff`, t],
    [`xsk.spend.${t}.1.ff`, undefined],
    [`sk.other.${t}.1.ff`, undefined],
    [`sk.spend.${t.slice(1)}.1.ff`, undefined],
    [`sk.spend.${t}a.1.ff`, undefined],
    [`sk.spend.${t.toUpperCase()}.1.ff`, undefined],
    [undefined, undefined],
  ])('reads the account ID of %j as %j', (key, tenant) => {
    expect(tenantOf(key)).toBe(tenant)
  })
})
