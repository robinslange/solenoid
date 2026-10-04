import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterAll, beforeEach, vi } from 'vitest'
import { credsPath } from '../src/config'

vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>()
  const { sep } = await import('node:path')
  const homedir = () => {
    const home = process.env.HOME
    if (!home?.includes(`${sep}solenoid-cli-test-`)) throw new Error(`test HOME is not a sandbox: ${home}`)
    return home
  }
  return { ...os, homedir }
})

export const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'solenoid-cli-test-')))

export function assertInSandbox(path: string): string {
  if (!path.startsWith(sandbox + sep)) throw new Error(`refusing to touch ${path}: it is outside the test sandbox ${sandbox}`)
  return path
}

delete process.env.SOLENOID_KEY
delete process.env.SOLENOID_API

const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.hostname !== '127.0.0.1') return Promise.reject(new TypeError(`test setup refuses a real fetch to ${url.origin}; only the local shim on 127.0.0.1 is reachable`))
  return realFetch(input, init)
}
process.env.HOME = join(sandbox, 'home')
process.env.SOLENOID_CONFIG_DIR = join(sandbox, 'config')
mkdirSync(process.env.HOME)

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('a test reached fetch without stubbing it')))
  vi.stubEnv('HOME', mkdtempSync(join(sandbox, 'home-')))
  assertInSandbox(homedir())
  assertInSandbox(join(homedir(), '.cache', 'solenoid'))
  delete process.env.SOLENOID_CONFIG_DIR
  try {
    assertInSandbox(credsPath())
  } finally {
    process.env.SOLENOID_CONFIG_DIR = join(sandbox, 'config')
  }
  assertInSandbox(credsPath())
})

afterAll(() => rmSync(sandbox, { recursive: true, force: true }))
