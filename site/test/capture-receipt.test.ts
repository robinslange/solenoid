import { solenoid } from '@solenoid.systems/sdk'
import { describe, expect, it } from 'vitest'
import { testServer } from '../../testing/src/index'
import { capture } from '../scripts/capture-receipt.mjs'

async function demo() {
  const server = await testServer()
  const { admin_key } = await server.signup()
  const spendKey = await solenoid({ key: admin_key, api: server.api, fetch: server.fetch }).deriveKey('support-bot')
  return { server, o: { adminKey: admin_key, spendKey, api: server.api, scope: 'support-bot/c-1', unit: 'emails', fetch: server.fetch } }
}

describe('capture', () => {
  it("makes one spend and returns its receipt, the account's chain ascending, and the published keys", async () => {
    const { o } = await demo()
    const out = await capture(o)
    expect(out.receipt.receipt).toMatchObject({ seq: 1, kind: 'spend', scope: 'support-bot/c-1', body: { emails: 1 }, kid: 'k1' })
    expect(out.receipt.chain).toEqual([out.receipt.receipt])
    expect(Object.keys(out.keys)).toEqual(['k1'])
  })
  it('refuses to save a receipt that does not verify against the keys it fetched', async () => {
    const { o } = await demo()
    const other = await testServer()
    const f = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/.well-known/solenoid.json') ? other.fetch(input, init) : o.fetch(input, init)) as typeof fetch
    await expect(capture({ ...o, fetch: f })).rejects.toThrow('does not verify')
  })
})
