import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestServer } from '../../testing/src/index'
import { freshServer, solenoid, tempDir, useConfigDir } from './run'

let server: TestServer
let cwd: string
let tenant: string
let openerLog: string
const run = (...args: string[]) => solenoid(cwd, ...args)
const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
  new URL(String(input)).pathname === '/billing/checkout' ? Promise.resolve(Response.json(body, { status })) : server.fetch(input, init))

beforeEach(async () => {
  const bin = tempDir('bin-')
  openerLog = join(bin, 'opened')
  for (const name of ['open', 'xdg-open']) writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${openerLog}"\n`, { mode: 0o755 })
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
  vi.stubEnv('BROWSER', 'true')
  server = await freshServer()
  const config = useConfigDir()
  cwd = tempDir('proj-')
  const acct = await server.signup()
  tenant = acct.tenant
  mkdirSync(config, { recursive: true })
  writeFileSync(join(config, 'credentials'), JSON.stringify({ api: server.api, admin_key: acct.admin_key }))
})

describe('upgrade', () => {
  it('opens Stripe Checkout with the browser command, prints the url, and exits 0', async () => {
    answer(200, { url: 'https://checkout.stripe.test/c/1' })
    const r = await run('upgrade')
    expect([r.code, r.err]).toEqual([0, ''])
    expect(r.out.split('\n')[0]).not.toBe('')
    expect(r.out.split('\n')[1]).toBe('https://checkout.stripe.test/c/1')
    expect(r.out).toContain('solenoid email')
  })

  it('passes the url as an argument to a custom BROWSER command', async () => {
    const custom = join(tempDir('bin-'), 'browser')
    writeFileSync(custom, `#!/bin/sh\necho "$*" >> "${openerLog}"\n`, { mode: 0o755 })
    vi.stubEnv('BROWSER', custom)
    answer(200, { url: 'https://checkout.stripe.test/c/1' })
    const r = await run('upgrade')
    expect([r.code, r.err]).toEqual([0, ''])
    await vi.waitFor(() => expect(readFileSync(openerLog, 'utf8')).toBe('https://checkout.stripe.test/c/1\n'))
  })

  it('still prints the url, says the browser did not open, and exits 0 when the opener is missing', async () => {
    answer(200, { url: 'https://checkout.stripe.test/c/1' })
    const opened = await run('upgrade')
    vi.stubEnv('BROWSER', 'solenoid-test-no-such-opener')
    const missing = await run('upgrade')
    expect([missing.code, missing.err]).toEqual([0, ''])
    expect(missing.out.split('\n')[0]).not.toBe('')
    expect(missing.out.split('\n')[1]).toBe('https://checkout.stripe.test/c/1')
    expect(missing.out.split('\n')[0]).not.toBe(opened.out.split('\n')[0])
  })

  it("uses the platform's opener when BROWSER is unset", async () => {
    vi.stubEnv('BROWSER', undefined)
    answer(200, { url: 'https://checkout.stripe.test/c/1' })
    const r = await run('upgrade')
    expect([r.code, r.err]).toEqual([0, ''])
    await vi.waitFor(() => expect(readFileSync(openerLog, 'utf8')).toBe(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} https://checkout.stripe.test/c/1\n`))
  })

  it('prints the billing portal link for an account already on Pro, and exits 0', async () => {
    answer(409, { error: 'already_pro', portal_url: 'https://billing.stripe.test/p/1' })
    const r = await run('upgrade')
    expect([r.code, r.err]).toEqual([0, ''])
    expect(r.out).toContain(tenant)
    expect(r.out).toContain('https://billing.stripe.test/p/1')
  })

  it('explains a 503 billing_unavailable on stderr, and exits 1', async () => {
    const r = await run('upgrade')
    expect(r.code).toBe(1)
    expect(r.out).toBe('')
    expect(r.err).toMatch(/^solenoid: billing_unavailable \(503\)\. \S/)
  })

  it('says checkout could not start when the call fails in transit', async () => {
    answer(500, { error: 'internal' })
    const r = await run('upgrade')
    expect(r.code).toBe(1)
    expect(r.err).toContain('solenoid upgrade')
  })

  it('needs saved credentials, and calls nothing without them', async () => {
    useConfigDir()
    answer(200, { url: 'https://checkout.stripe.test/c/1' })
    const r = await run('upgrade')
    expect(r.code).toBe(1)
    expect(r.err).toContain('solenoid init <scope>')
  })
})
