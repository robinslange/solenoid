import fc from 'fast-check'
import { beforeAll, describe, expect, it } from 'vitest'
import { entryHash, jcs as workerJcs, signHash } from '../../worker/src/chain'
import { ancestors, parseScope } from '../../worker/src/scope'
import { ceilMicro } from '../src/amounts'
import { SolenoidUnavailable, LimitExceeded, solenoid, type Receipt } from '../src/index'
import { estimateInput, planCall } from '../src/llm'
import { checkScope } from '../src/scope'
import { testServer } from '../../testing/src/index'
import { jcs, verifyChain, verifyReceipt } from '../src/verify'

describe('ceilMicro', () => {
  const tolerance = (m: number) => Number.EPSILON * 8 * Math.max(1, Math.abs(m))

  it('rounds up to a whole number of micro-units, by less than one micro-unit', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1e9, noNaN: true }), (v) => {
      const m = v * 1e6
      const micros = Math.round(ceilMicro(v) * 1e6)
      expect(ceilMicro(v)).toBe(micros / 1e6)
      expect(micros).toBeGreaterThanOrEqual(m - tolerance(m))
      expect(micros).toBeLessThan(m + 1)
    }), { numRuns: 2000 })
  })
  it('is at least the input, except where float error in v * 1e6 is all that separates them', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1e9, noNaN: true }), (v) => {
      if (ceilMicro(v) < v) expect(v * 1e6 - Math.round(v * 1e6)).toBeLessThanOrEqual(tolerance(v * 1e6))
    }), { numRuns: 2000 })
  })
  it('returns an amount that already has six decimals unchanged', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1e15 }), (micros) => {
      expect(ceilMicro(micros / 1e6)).toBe(micros / 1e6)
    }), { numRuns: 2000 })
  })
})

describe('the max_tokens cap', () => {
  const price = fc.record({ input: fc.double({ min: 1e-9, max: 1e-4, noNaN: true }), output: fc.double({ min: 1e-9, max: 1e-4, noNaN: true }) })
  const left = fc.record({
    tokens: fc.option(fc.integer({ min: 0, max: 200_000 }), { nil: undefined }),
    usd: fc.option(fc.double({ min: 0, max: 5, noNaN: true }), { nil: undefined }),
  })
  const req = fc.record({
    field: fc.constantFrom('max_tokens', 'max_completion_tokens', null),
    requested: fc.integer({ min: 1, max: 100_000 }),
    content: fc.string({ maxLength: 4000 }),
  })

  it('never asks for more than requested, and fits the input plus the cap in what is left whenever the call goes ahead', () => {
    fc.assert(fc.property(price, left, req, (p, l, r) => {
      const body: Record<string, unknown> = { model: 'm', messages: [{ role: 'user', content: r.content }], ...(r.field ? { [r.field]: r.requested } : {}) }
      const lefts = {
        ...(l.tokens === undefined ? {} : { tokens: { scope: 's', left: l.tokens, resets: null } }),
        ...(l.usd === undefined ? {} : { usd: { scope: 's', left: l.usd, resets: null } }),
      }
      const input = estimateInput(body)
      const oneMore = (l.tokens === undefined || input + 1 <= l.tokens) && (l.usd === undefined || input * p.input + p.output <= l.usd)
      let plan
      try {
        plan = planCall('s', body, lefts, p)
      } catch (e) {
        expect(e).toBeInstanceOf(LimitExceeded)
        expect(oneMore).toBe(false)
        return
      }
      if (plan.hold === null) {
        expect(lefts).toEqual({})
        return
      }
      const field = r.field ?? 'max_tokens'
      const cap = plan.req[field] as number
      const requested = r.field ? r.requested : 4096
      expect(Number.isInteger(cap)).toBe(true)
      expect(cap).toBeGreaterThanOrEqual(1)
      expect(cap).toBeLessThanOrEqual(requested)
      if (l.tokens !== undefined) expect(input + cap).toBeLessThanOrEqual(l.tokens)
      if (l.usd !== undefined) expect(input * p.input + cap * p.output).toBeLessThanOrEqual(l.usd * (1 + 1e-12))
      expect(plan.hold.tokens).toBe(input + cap)
    }), { numRuns: 3000 })
  })
})

describe('scope grammar', () => {
  const accepts = (f: () => unknown) => { try { f(); return true } catch { return false } }
  const segment = fc.oneof(
    fc.constantFrom('.', '..', '...', '%2e', '%2E', 'A', 'Acme', 'a', 'a.b', '.a', 'a.', '-', '_', '', 'a'.repeat(64), 'a'.repeat(65)),
    fc.stringMatching(/^[a-z0-9._-]{1,66}$/),
    fc.string({ unit: 'binary-ascii', minLength: 0, maxLength: 6 }),
  )
  const scope = fc.array(segment, { minLength: 0, maxLength: 10 }).map((s) => s.join('/'))

  it("accepts exactly the scopes the Worker's parseScope accepts as written", () => {
    fc.assert(fc.property(scope, (s) => {
      const worker = accepts(() => parseScope(s)) && parseScope(s) === s
      expect(accepts(() => checkScope(s))).toBe(worker)
    }), { numRuns: 5000 })
  })
  it('refuses the trailing slash the Worker would strip, rather than sending a scope the Worker rewrites', () => {
    expect(parseScope('a/')).toBe('a')
    expect(accepts(() => checkScope('a/'))).toBe(false)
  })
})

describe('jcs', () => {
  it('matches the Worker byte for byte and parses back to the same value', () => {
    fc.assert(fc.property(fc.jsonValue(), (v) => {
      expect(jcs(v)).toBe(workerJcs(v))
      expect(JSON.parse(jcs(v))).toEqual(JSON.parse(JSON.stringify(v)))
    }), { numRuns: 1000 })
  })
  it('sorts keys and drops undefined values at any depth', () => {
    expect(jcs({ b: [1, null, { d: undefined, c: 'x' }], a: undefined, c: null })).toBe('{"b":[1,null,{"c":"x"}],"c":null}')
  })
})

describe('receipt and chain tampering', () => {
  let chain: Receipt[], keys: Record<string, JsonWebKey>, verify: (r: Receipt) => Promise<boolean>
  beforeAll(async () => {
    const server = await testServer()
    const admin = solenoid({ key: (await server.signup()).admin_key, api: server.api, fetch: server.fetch })
    await admin.limit('a', { n: 10, per: 'day' })
    await admin.spend('a/b', { n: 2 }, { idempotencyKey: 'h' })
    await admin._internal.settle('a/b', 'h', { n: 1 })
    await admin.rotate('a')
    await admin.spend('a', { n: 1, usd: 0.25 })
    chain = [...(await admin.get('')).entries].reverse()
    keys = ((await (await server.fetch(`${server.api}/.well-known/solenoid.json`)).json()) as { keys: Record<string, JsonWebKey> }).keys
    verify = admin.verify
  })

  const FIELDS = ['seq', 'kind', 'scope', 'body', 'at', 'kid', 'prev', 'hash', 'sig'] as const
  const tamper = (r: Receipt, field: (typeof FIELDS)[number], salt: number): Receipt => {
    const flip = (s: string, i: number) => { const j = i % s.length; return s.slice(0, j) + (s[j] === 'a' ? 'b' : 'a') + s.slice(j + 1) }
    switch (field) {
      case 'seq': return { ...r, seq: r.seq + 1 + (salt % 5) }
      case 'kind': return { ...r, kind: (['spend', 'settle', 'limit', 'rotate'] as const).filter((k) => k !== r.kind)[salt % 3] }
      case 'scope': return { ...r, scope: `${r.scope}/x${salt}` }
      case 'body': return { ...r, body: { ...r.body, [`k${salt % 3}`]: salt } }
      case 'at': return { ...r, at: new Date(Date.parse(r.at) + 1 + salt).toISOString() }
      case 'kid': return { ...r, kid: `k${2 + (salt % 5)}` }
      case 'sig': return { ...r, sig: flip(r.sig, salt % (r.sig.length - 1)) }
      default: return { ...r, [field]: flip(r[field], salt) }
    }
  }

  it('verifies the untouched chain and every receipt in it', async () => {
    expect(chain.map((r) => r.kind)).toEqual(['limit', 'spend', 'settle', 'rotate', 'spend'])
    expect(await verifyChain(chain, keys)).toBe(true)
    for (const r of chain) expect(await verify(r)).toBe(true)
  })
  it('fails verify and verifyChain after any single-field tamper of any entry', async () => {
    await fc.assert(fc.asyncProperty(fc.nat({ max: 4 }), fc.constantFrom(...FIELDS), fc.nat({ max: 1000 }), async (i, field, salt) => {
      const bad = tamper(chain[i], field, salt)
      expect(await verify(bad)).toBe(false)
      expect(await verifyChain(chain.map((r, j) => (j === i ? bad : r)), keys)).toBe(false)
    }), { numRuns: 300 })
  })
  it('refuses a malformed prev or hash with false, not an exception', async () => {
    const r = chain[1]
    for (const bad of ['zz' + r.prev, r.prev + 'zz', r.prev.toUpperCase().replace(/^./, 'G'), r.prev.slice(2)]) {
      expect(await verifyReceipt({ ...r, prev: bad }, keys.k1)).toBe(false)
      expect(await verifyReceipt({ ...r, hash: bad }, keys.k1)).toBe(false)
    }
  })
  it('refuses a signature that is not canonical base64url, though it decodes to the same bytes', async () => {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    for (const r of chain) {
      expect(await verifyReceipt(r, keys.k1)).toBe(true)
      const twin = r.sig.slice(0, -1) + A[A.indexOf(r.sig.at(-1)!) ^ 1]
      for (const sig of [twin, `${r.sig}==`, r.sig.replace(/-/g, '+').replace(/_/g, '/'), ` ${r.sig}`].filter((x) => x !== r.sig)) {
        expect(await verifyReceipt({ ...r, sig }, keys.k1)).toBe(false)
        expect(await verify({ ...r, sig })).toBe(false)
      }
    }
  })
  it('still verifies every receipt the server signs', async () => {
    const server = await testServer()
    const admin = solenoid({ key: (await server.signup()).admin_key, api: server.api, fetch: server.fetch })
    const receipts = []
    for (let i = 0; i < 64; i++) receipts.push((await admin.spend(`s${i % 5}`, { n: i + 1 }))!)
    for (const r of receipts) expect(await admin.verify(r)).toBe(true)
    expect(await admin.verifyChain([...(await admin.get('')).entries].reverse())).toBe(true)
  })
  it('refuses a signature that is not base64url with false', async () => {
    expect(await verifyReceipt({ ...chain[1], sig: '!!!' }, keys.k1)).toBe(false)
  })
})

describe('chain links', () => {
  it('refuses entries that are each validly signed but do not follow one another', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const keys = { k1: await crypto.subtle.exportKey('jwk', pair.publicKey) }
    const seal = async (seq: number, prev: string): Promise<Receipt> => {
      const e = { seq, kind: 'spend' as const, scope: 'a', body: { n: seq }, at: '2030-01-01T00:00:00.000Z', kid: 'k1' }
      const hash = await entryHash(prev, e)
      return { ...e, id: `r${seq}`, prev, hash, sig: await signHash(pair.privateKey, hash), replay: false }
    }
    const genesis = '0'.repeat(64)
    const one = await seal(1, genesis)
    expect(await verifyChain([one, await seal(2, one.hash)], keys)).toBe(true)
    expect(await verifyChain([one, await seal(3, one.hash)], keys)).toBe(false)
    expect(await verifyChain([one, await seal(1, one.hash)], keys)).toBe(false)
    expect(await verifyChain([one, await seal(2, genesis)], keys)).toBe(false)
  })
})

describe('the outage decision', () => {
  const seg = fc.constantFrom('a', 'b', 'c')
  const scope = fc.array(seg, { minLength: 0, maxLength: 4 }).map((s) => s.join('/'))
  const cache = fc.dictionary(scope, fc.constantFrom('open' as const, 'closed' as const), { maxKeys: 8 })

  it('fails open exactly when the scope or its nearest cached ancestor is open, and closed otherwise', async () => {
    await fc.assert(fc.asyncProperty(scope, cache, fc.boolean(), async (s, modes, viaLlm) => {
      const nearest = ancestors(s).reverse().find((a) => a in modes)
      const expected = nearest !== undefined && modes[nearest] === 'open'
      const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: () => Promise.reject(new TypeError('fetch failed')), store: { get: (k) => modes[k], set: () => {} } })
      let called = false
      const act = viaLlm ? sol.at(s).llm(async () => { called = true; return {} }, { model: 'm', messages: [] }) : sol.spend(s, { n: 1 })
      const outcome = await act.then((r) => r, (e: unknown) => e)
      if (expected) {
        expect(outcome).toEqual(viaLlm ? {} : null)
        expect(called).toBe(viaLlm)
      } else {
        expect(outcome).toBeInstanceOf(SolenoidUnavailable)
        expect((outcome as SolenoidUnavailable).scope).toBe(s)
        expect(called).toBe(false)
      }
    }), { numRuns: 500 })
  })
})
