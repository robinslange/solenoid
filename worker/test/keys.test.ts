import { describe, expect, it } from 'vitest'
import { b64url } from '../src/chain'
import { adminKey, hmacHex, spendKey, verifyKey } from '../src/keys'

const M = 'test-master-secret'
const T = 'abcdefghijkl'

describe('keys', () => {
  it('verifies an admin key it minted', async () => {
    const k = await adminKey(M, T, 1)
    expect(k).toMatch(/^sk\.admin\.abcdefghijkl\.1\.[0-9a-f]{64}$/)
    expect(await verifyKey(`Bearer ${k}`, M)).toEqual({ tenant: T, auth: { kind: 'admin', gen: 1, epoch: 0, keyScope: '' } })
  })
  it('verifies spend keys derived offline, including the root scope', async () => {
    const a = await adminKey(M, T, 1)
    expect((await verifyKey(`Bearer ${await spendKey(a, 'acme/bot', 2)}`, M)).auth).toEqual({ kind: 'spend', gen: 1, epoch: 2, keyScope: 'acme/bot' })
    expect((await verifyKey(`Bearer ${await spendKey(a, '', 0)}`, M)).auth.keyScope).toBe('')
  })
  it('rejects forged, mangled and cross-tenant keys', async () => {
    const a = await adminKey(M, T, 1)
    const s = await spendKey(a, 'acme', 0)
    const bad = [
      null, 'Basic x', `Bearer ${a}x`, `Bearer ${a.replace('.1.', '.2.')}`,
      `Bearer ${s.replace(/[0-9a-f]$/, (c) => (c === '0' ? '1' : '0'))}`,
      `Bearer ${s.replace(btoa('acme').replace(/=+$/, ''), btoa('other').replace(/=+$/, ''))}`,
      `Bearer ${await adminKey('other-master', T, 1)}`,
      `Bearer ${(await adminKey(M, 'mnopqrstuvwx', 1)).replace('mnopqrstuvwx', T)}`,
      `Bearer ${a.replace('.1.', '.01.')}`,
      `Bearer ${a.replace(/[0-9a-f]$/, 'é')}`,
      `Bearer ${s.replace(/[0-9a-f]$/, 'é')}`,
    ]
    for (const h of bad) await expect(verifyKey(h, M)).rejects.toMatchObject({ status: 401, code: 'invalid_key' })
  })
})

const rejects = async (header: string) => expect(verifyKey(header, M)).rejects.toMatchObject({ status: 401, code: 'invalid_key' })
const b64 = (s: string) => b64url(new TextEncoder().encode(s).buffer as ArrayBuffer)

describe('key grammar edges', () => {
  it('accepts a multi-digit generation and refuses generation 0', async () => {
    expect((await verifyKey(`Bearer ${await adminKey(M, T, 10)}`, M)).auth.gen).toBe(10)
    await rejects(`Bearer ${await adminKey(M, T, 0)}`)
  })
  it('refuses a tenant id one character too long at either end, even with a valid MAC', async () => {
    await rejects(`Bearer ${await adminKey(M, `x${T}`, 1)}`)
    await rejects(`Bearer ${await adminKey(M, `${T}x`, 1)}`)
  })
  it('refuses a key cut short before its tenant or generation', async () => {
    await rejects('Bearer sk.admin')
    await rejects(`Bearer sk.admin.${T}`)
  })
  it('anchors the Bearer header at both ends', async () => {
    const a = await adminKey(M, T, 1)
    await rejects(`Token Bearer ${a}`)
    await rejects(`Bearer ${a} x`)
  })
  it('refuses a key whose kind does not match its shape', async () => {
    const a = await adminKey(M, T, 1)
    const secret = a.split('.')[4]
    const s = await spendKey(a, 'acme', 0)
    await rejects(`Bearer sk.spend.${T}.1.${secret}`)
    await rejects(`Bearer ${a}.x.y`)
    await rejects(`Bearer ${s.replace('sk.spend.', 'sk.admin.')}`)
    await rejects(`Bearer ${s}.x`)
  })
  it('refuses a MAC with anything before or after its 64 hex characters as invalid_key', async () => {
    const a = await adminKey(M, T, 1)
    const [, , , , mac] = a.split('.')
    const s = await spendKey(a, 'acme', 0)
    await rejects(`Bearer ${a.replace(mac, `zz${mac}`)}`)
    await rejects(`Bearer ${a}zz`)
    await rejects(`Bearer ${s.replace(/[0-9a-f]{64}$/, (m) => `zz${m}`)}`)
    await rejects(`Bearer ${s}zz`)
  })
  it('refuses a spend key whose scope field is outside the grammar, whatever it carries as a MAC', async () => {
    const secret = (await adminKey(M, T, 1)).split('.')[4]
    for (const signed of ['A', 'undefined']) await rejects(`Bearer sk.spend.${T}.1.0.${b64('A')}.${await hmacHex(secret, `spend:${signed}:0`)}`)
  })
})

describe('the spend key scope field', () => {
  const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  it.each(['acme', 'acme/bot'])('refuses a key for %s whose scope field is not canonical base64url, though it decodes to the same scope', async (scope) => {
    const s = await spendKey(await adminKey(M, T, 1), scope, 0)
    const field = b64(scope)
    expect(s).toContain(`.${field}.`)
    expect((await verifyKey(`Bearer ${s}`, M)).auth.keyScope).toBe(scope)
    const twin = field.slice(0, -1) + B64URL[B64URL.indexOf(field.at(-1)!) ^ 1]
    for (const bad of [twin, `${field}${'='.repeat(4 - (field.length % 4))}`]) await rejects(`Bearer ${s.replace(`.${field}.`, `.${bad}.`)}`)
  })
  it('still accepts every key it mints, for scopes of every length mod 3', async () => {
    const a = await adminKey(M, T, 1)
    for (const scope of ['', 'a', 'ab', 'abc', 'acme', 'acme/b', 'acme/bot', 'acme/bot/x', 'x-y_z.0/9', 'a'.repeat(64)]) {
      expect((await verifyKey(`Bearer ${await spendKey(a, scope, 3)}`, M)).auth).toEqual({ kind: 'spend', gen: 1, epoch: 3, keyScope: scope })
    }
  })
})
