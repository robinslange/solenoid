import { execFile, execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testServer } from '../../testing/src/index'
import { tempDir } from './run'
import { assertInSandbox } from './setup'

const BIN = join(__dirname, '../dist/solenoid.mjs')
let config: string, cwd: string, env: NodeJS.ProcessEnv, http: Server

const run = (...args: string[]) => promisify(execFile)('node', [BIN, ...args], { cwd, env, encoding: 'utf8' })

beforeAll(async () => {
  execFileSync('pnpm', ['run', 'build'], { cwd: join(__dirname, '..') })
  config = join(tempDir('home-'), 'solenoid')
  cwd = tempDir('proj-')
  const server = await testServer()
  http = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c)
    const body = Buffer.concat(chunks)
    const headers = Object.fromEntries(['authorization', 'content-type', 'idempotency-key'].flatMap((h) => (req.headers[h] ? [[h, String(req.headers[h])]] : [])))
    const r = await server.fetch(`${server.api}${req.url}`, { method: req.method, headers, body: body.length ? body : undefined })
    r.headers.forEach((v, k) => res.setHeader(k, v))
    res.writeHead(r.status).end(await r.text())
  })
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done))
  env = {
    PATH: process.env.PATH,
    HOME: assertInSandbox(process.env.HOME ?? ''),
    SOLENOID_API: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    SOLENOID_CONFIG_DIR: config,
  }
})
afterAll(() => { http?.close() })

describe('the built binary', () => {
  it('prints help and exits 0', async () => {
    expect((await run('help')).stdout).toMatch(/^solenoid keeps an agent inside a spend limit[^]*rotate --admin --yes {48}revoke the admin key and every spend key\n {2}upgrade +\S[^\n]*\n$/)
  })

  it('refuses an unknown flag with one solenoid: line and no stack trace', async () => {
    await expect(run('ls', '--bogus')).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'solenoid: unknown option "--bogus"; run `solenoid help` to see the options\n',
    })
  })

  it('inits with a spend key in .env, and refuses an over-limit spend with exit code 1 on stderr', async () => {
    expect((await run('init', 'acme')).stdout).toMatch(/\nspend key for "acme" written to \.env\n$/)
    expect(statSync(join(config, 'credentials')).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(cwd, '.env'), 'utf8')).toMatch(/^SOLENOID_KEY=sk\.spend\./)
    await run('limit', 'acme', 'emails=1')
    await run('spend', 'acme/bot', 'emails=1')
    await expect(run('spend', 'acme/bot', 'emails=1')).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'solenoid: limit_exceeded (402). the limit on "acme" for "emails" is reached (used 1 of 1); it has no window, so only raising it or removing it helps. ' +
        'raise it with `solenoid limit acme emails=<n>`, or remove it with `solenoid limit acme emails=off`.\n',
    })
  })
})
