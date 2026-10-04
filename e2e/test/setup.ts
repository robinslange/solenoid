import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, inject } from 'vitest'

delete process.env.SOLENOID_KEY
delete process.env.SOLENOID_API

const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.hostname !== '127.0.0.1') return Promise.reject(new TypeError(`test setup refuses a real fetch to ${url.origin}; only the local shim on 127.0.0.1 is reachable`))
  return realFetch(input, init)
}

const api = new URL(inject('api'))
if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || api.pathname !== '/') throw new Error(`refusing to run: the e2e API ${api} is not the local wrangler dev instance`)

export const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'solenoid-e2e-')))
afterAll(() => rmSync(sandbox, { recursive: true, force: true }))
