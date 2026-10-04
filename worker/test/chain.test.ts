import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { GENESIS, b64url, b64urlDecode, entryHash, fromHex, hex, importSigningKey, jcs, publicJwk, signHash, verifyChain, type Sealed } from '../src/chain'

describe('jcs', () => {
  it('sorts keys recursively and drops undefined', () => {
    expect(jcs({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[1,{"y":2,"z":1}]},"b":1}')
  })
})

async function build(n: number): Promise<Sealed[]> {
  const key = await importSigningKey(env.SIGNING_KEY)
  const out: Sealed[] = []
  let prev = GENESIS
  for (let seq = 1; seq <= n; seq++) {
    const e = { seq, kind: 'spend' as const, scope: 'a/b', body: { usd: seq / 10 }, at: new Date(seq * 1000).toISOString(), kid: 'k1' }
    const hash = await entryHash(prev, e)
    out.push({ ...e, prev, hash, sig: await signHash(key, hash) })
    prev = hash
  }
  return out
}

const TAMPER: Record<string, (c: Sealed[]) => unknown> = {
  body: () => ({ usd: 99 }), scope: () => 'x', at: () => new Date(0).toISOString(), seq: () => 42,
  prev: () => 'f'.repeat(64), sig: (c) => c[1].sig, kind: () => 'limit', kid: () => 'k2', hash: () => 'e'.repeat(64),
}

describe('chain', () => {
  it('imports a signing key that Node exported with alg set', async () => {
    await expect(importSigningKey(env.SIGNING_KEY)).resolves.toBeDefined()
  })
  it('verifies an untouched chain', async () => {
    expect(await verifyChain(await build(5), publicJwk(env.SIGNING_KEY))).toBe(true)
  })
  it.each(Object.keys(TAMPER))('fails when %s of one entry is altered', async (field) => {
    const chain = await build(5)
    ;(chain[2] as unknown as Record<string, unknown>)[field] = TAMPER[field](chain)
    expect(await verifyChain(chain, publicJwk(env.SIGNING_KEY))).toBe(false)
  })
  it('fails when an entry is removed', async () => {
    const chain = await build(5)
    chain.splice(2, 1)
    expect(await verifyChain(chain, publicJwk(env.SIGNING_KEY))).toBe(false)
  })
  it('hashes the raw genesis bytes, not the utf8 of the hex string', async () => {
    const e = { seq: 1, kind: 'spend' as const, scope: 'a/b', body: { usd: 1 }, at: new Date(1000).toISOString(), kid: 'k1' }
    const body = new TextEncoder().encode(jcs({ seq: e.seq, kind: e.kind, scope: e.scope, body: e.body, at: e.at, kid: e.kid }))
    const msg = new Uint8Array(32 + body.length)
    msg.set(body, 32)
    const digest = await crypto.subtle.digest('SHA-256', msg)
    const expected = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(await entryHash(GENESIS, e)).toBe(expected)
  })
  it('fromHex round-trips through hex', () => {
    expect(fromHex(GENESIS)).toEqual(new Uint8Array(32))
    expect(fromHex('ff00')).toEqual(new Uint8Array([255, 0]))
  })
  it.each(['x', 'abc', 'ZZ'])('fromHex throws on malformed hex %s', (h) => {
    expect(() => fromHex(h)).toThrow()
  })
  it('fails verification when prev is not well-formed hex, without throwing', async () => {
    const chain = await build(3)
    ;(chain[0] as unknown as Record<string, unknown>).prev = 'x'
    expect(await verifyChain(chain, publicJwk(env.SIGNING_KEY))).toBe(false)
  })
  it('fails verification when hash is uppercase', async () => {
    const chain = await build(3)
    chain[2].hash = chain[2].hash.toUpperCase()
    expect(await verifyChain(chain, publicJwk(env.SIGNING_KEY))).toBe(false)
  })
})

async function seal(prev: string, seq: number): Promise<Sealed> {
  const key = await importSigningKey(env.SIGNING_KEY)
  const e = { seq, kind: 'spend' as const, scope: 'a', body: { usd: seq }, at: new Date(seq * 1000).toISOString(), kid: 'k1' }
  const hash = await entryHash(prev, e)
  return { ...e, prev, hash, sig: await signHash(key, hash) }
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const twinLast = (s: string) => s.slice(0, -1) + B64URL[B64URL.indexOf(s.at(-1)!) ^ 1]

describe('chain edges', () => {
  it('names the problem when hex is malformed', () => {
    expect(() => fromHex('x')).toThrow('invalid hex')
  })
  it('round-trips a full 32-byte hash through hex', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => 255 - i * 7)
    expect(fromHex(hex(bytes.buffer))).toEqual(bytes)
    expect(fromHex('ffff')).toEqual(new Uint8Array([255, 255]))
  })
  it('decodes only canonical base64url: padding, + and /, whitespace and set unused bits in the last character are refused', () => {
    const bytes = Uint8Array.from([0xfb, 0xef, 0xbe, 0xff, 0xff, 0xff, ...Array.from({ length: 58 }, (_, i) => i * 4 + 3)])
    const s = b64url(bytes.buffer)
    expect(s).toMatch(/^----____/)
    expect(b64urlDecode(s)).toEqual(bytes)
    for (const bad of [twinLast(s), `${s}==`, s.replace(/-/g, '+'), s.replace(/_/g, '/'), ` ${s}`, `${s.slice(0, 4)} ${s.slice(4)}`]) {
      expect(() => b64urlDecode(bad)).toThrow()
    }
  })
  it('refuses a signature whose last character differs only in unused bits', async () => {
    const chain = await build(3)
    expect(await verifyChain(chain, publicJwk(env.SIGNING_KEY))).toBe(true)
    chain[1].sig = twinLast(chain[1].sig)
    expect(await verifyChain(chain, publicJwk(env.SIGNING_KEY))).toBe(false)
  })
  it('strips all base64 padding', () => {
    expect(b64url(new Uint8Array([0]).buffer)).toBe('AA')
  })
  it('hashes over the previous hash, so the same entry under another prev hashes differently', async () => {
    const e = { seq: 2, kind: 'spend' as const, scope: 'a', body: { usd: 1 }, at: new Date(1000).toISOString(), kid: 'k1' }
    const prev = 'ab'.repeat(32)
    const body = new TextEncoder().encode(jcs(e))
    const msg = new Uint8Array(32 + body.length)
    msg.set(fromHex(prev))
    msg.set(body, 32)
    expect(await entryHash(prev, e)).toBe(hex(await crypto.subtle.digest('SHA-256', msg)))
  })
  it.each([`a${'0'.repeat(64)}`, `${'0'.repeat(64)}a`])('returns false, without throwing, for a prev of 65 characters (%s)', async (prev) => {
    const chain = await build(2)
    chain[0].prev = prev
    expect(await verifyChain(chain, publicJwk(env.SIGNING_KEY))).toBe(false)
  })
  it('fails on a gap in seq even when every prev links', async () => {
    const first = await seal(GENESIS, 1)
    expect(await verifyChain([first, await seal(first.hash, 3)], publicJwk(env.SIGNING_KEY))).toBe(false)
  })
  it('fails on a broken prev link even when seq is consecutive', async () => {
    const first = await seal(GENESIS, 1)
    expect(await verifyChain([first, await seal('cd'.repeat(32), 2)], publicJwk(env.SIGNING_KEY))).toBe(false)
  })
})
