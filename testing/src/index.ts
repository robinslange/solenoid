import { Tenant, type TenantApi } from '../../worker/src/core'
import type { Mail } from '../../worker/src/mail'
import { handle } from '../../worker/src/router'
import { sqlOver } from './sql'

export type { Mail }

export type TestServer = {
  fetch: typeof fetch
  api: string
  signup(): Promise<{ tenant: string; admin_key: string }>
  setNow(ms: number): void
  outage(on: boolean): void
  outbox(): Promise<Mail[]>
  mailDown(on: boolean): void
}

const API = 'http://solenoid.test'

async function sqlite(): Promise<typeof import('node:sqlite')> {
  try {
    return await import('node:sqlite')
  } catch (cause) {
    throw new Error(`testServer() needs node:sqlite, which Node ships from 22.5 (behind --experimental-sqlite on 22.5 to 22.12 and 23.0 to 23.3). This is Node ${process.version}.`, { cause })
  }
}

export async function testServer(): Promise<TestServer> {
  const { DatabaseSync } = await sqlite()
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const env = { MASTER: crypto.randomUUID(), SIGNING_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)), SIGNING_KID: 'k1' }
  let clock = () => Date.now()
  let down = false
  const tenants = new Map<string, TenantApi>()
  const tenantFor = (name: string): TenantApi => {
    // Stryker disable next-line StringLiteral: SQLite gives an empty filename a private temporary database too, so tenants stay apart (MUTATION-SUMMARY, testing)
    const t = tenants.get(name) ?? new Tenant(sqlOver(new DatabaseSync(':memory:')), env, () => clock())
    tenants.set(name, t)
    return t
  }
  const sent: Mail[] = []
  const pending = new Set<Promise<unknown>>()
  let mailOff = false
  const io = {
    mail: async (m: Mail) => { if (mailOff) throw new Error('mail is down'); sent.push(m) },
    // Stryker disable next-line all: a redundant guard for a mailer that awaits before it records; this one records synchronously (MUTATION-SUMMARY, testing)
    waitUntil: (p: Promise<unknown>) => { pending.add(p); void p.finally(() => pending.delete(p)) },
  }
  const serve = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (down) throw new TypeError('fetch failed')
    return handle(new Request(input, init), env, tenantFor, io)
  }
  return {
    fetch: serve,
    api: API,
    signup: async () => (await serve(`${API}/auth/signup`, { method: 'POST' })).json(),
    setNow: (ms) => { clock = () => ms },
    outage: (on) => { down = on },
    outbox: async () => { await Promise.all(pending); return [...sent] },
    mailDown: (on) => { mailOff = on },
  }
}
