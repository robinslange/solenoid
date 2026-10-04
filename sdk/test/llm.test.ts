import { describe, expect, it, vi } from 'vitest'
import { capOutput, estimateInput, planCall, readUsage } from '../src/llm'
import { LimitExceeded, SolenoidUnavailable, solenoid } from '../src/index'

const P = { input: 1e-6, output: 4e-6 }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

describe('capOutput and readUsage', () => {
  it('is unconstrained with no token or usd limit', () => { expect(capOutput({}, 100, P)).toBe(Infinity) })
  it('caps by tokens left after the input', () => { expect(capOutput({ tokens: 1000 }, 300, P)).toBe(700) })
  it('takes the tighter of the token and usd caps', () => { expect(capOutput({ usd: 0.001, tokens: 10_000 }, 200, P)).toBe(200) })
  it('reads OpenAI-compatible and Anthropic usage shapes', () => {
    expect(readUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } })).toEqual({ input: 10, output: 5 })
    expect(readUsage({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } })).toEqual({ input: 15, output: 5 })
    expect(readUsage({})).toBeNull()
  })
})

describe('planCall (property)', () => {
  it('never plans a hold larger than what is left', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    let succeeded = 0
    for (let i = 0; i < 5000; i++) {
      const price = { input: rnd() * 1e-5, output: rnd() * 4e-5 + 1e-7 }
      const left = { tokens: { scope: 's', left: Math.floor(rnd() * 1e5), resets: null }, usd: { scope: 's', left: rnd() * 2, resets: null } }
      const req = { model: 'm', system: 'x'.repeat(Math.floor(rnd() * 500)), max_tokens: Math.floor(rnd() * 8000) + 1, messages: [{ role: 'user', content: 'x'.repeat(Math.floor(rnd() * 2000)) }] }
      try {
        const { hold } = planCall('s', req, left, price)
        expect(hold!.tokens).toBeLessThanOrEqual(left.tokens.left)
        expect(hold!.usd!).toBeLessThanOrEqual(left.usd.left + 1e-9)
        succeeded++
      } catch (e) {
        expect(e).toBeInstanceOf(LimitExceeded)
      }
    }
    // A plan that always throws would trivially satisfy the assertions above.
    // Require most iterations to actually produce a hold, so the property has teeth.
    expect(succeeded).toBeGreaterThan(4000)
  })
})

describe('planCall default output ceiling', () => {
  const left = { tokens: { scope: 's', left: 1_000_000, resets: null } }

  it('caps an unset max_tokens to 4096 instead of the whole remaining budget', () => {
    const req = { model: 'm', messages: [] }
    const { req: planned, hold } = planCall('s', req, left, undefined)
    expect(planned.max_tokens).toBe(4096)
    expect(hold!.tokens).toBe(estimateInput(req) + 4096)
    expect(hold!.tokens).toBeLessThan(left.tokens.left)
  })

  it('uses price.max_output as the default ceiling when the price declares one', () => {
    const req = { model: 'm', messages: [] }
    const price = { input: 1e-6, output: 4e-6, max_output: 500 }
    const { req: planned, hold } = planCall('s', req, left, price)
    expect(planned.max_tokens).toBe(500)
    expect(hold!.tokens).toBe(estimateInput(req) + 500)
  })

  it('leaves a requested max_tokens under the cap untouched', () => {
    const req = { model: 'm', max_tokens: 800, messages: [] }
    const { req: planned } = planCall('s', req, left, undefined)
    expect(planned.max_tokens).toBe(800)
  })
})

type Post = { body: Record<string, any>; idem: string }
function client(limits: object[], opts: { holdStatus?: number; getDown?: boolean; store?: Map<string, 'open' | 'closed'> } = {}) {
  const posts: Post[] = []
  const f = vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === 'GET') {
      if (opts.getDown) throw new TypeError('network')
      return json(200, { scope: 's', epoch: 0, limits, children: [], entries: [], next: null })
    }
    const body = JSON.parse(init.body as string)
    posts.push({ body, idem: (init.headers as Record<string, string>)['idempotency-key'] })
    if (!body.settle && opts.holdStatus === 402) return json(402, { error: 'limit_exceeded', scope: 's', unit: 'tokens', resets: null })
    return json(200, { receipt: { id: 'r' }, remaining: {}, on_outage: 'closed', warnings: [] })
  })
  const m = opts.store ?? new Map()
  const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f as unknown as typeof fetch, prices: { m: P }, store: { get: (s) => m.get(s), set: (s, v) => void m.set(s, v) } })
  return { posts, sol }
}
const usage = (i: number, o: number) => ({ usage: { prompt_tokens: i, completion_tokens: o } })

describe('at(scope).llm', () => {
  it('holds the worst case, calls with a capped max_tokens, then settles actual usage on the same key', async () => {
    const { posts, sol } = client([{ unit: 'tokens', left: 500, scope: 's' }])
    const provider = vi.fn(async (req: { max_tokens: number }) => usage(20, Math.min(30, req.max_tokens)))
    await sol.at('s').llm(provider, { model: 'm', max_tokens: 4096, messages: [{ role: 'user', content: 'hi' }] })
    const sent = provider.mock.calls[0][0].max_tokens
    expect(sent).toBeLessThan(500)
    expect(posts).toHaveLength(2)
    expect(posts[0].body.tokens).toBeLessThanOrEqual(500)
    expect(posts[1].body.settle.tokens).toBe(50)
    expect(posts[1].body.settle.usd).toBeCloseTo(20 * P.input + 30 * P.output, 6)
    expect(posts[1].idem).toBe(posts[0].idem)
  })

  it('never calls the provider when the hold is refused', async () => {
    const { sol } = client([{ unit: 'tokens', left: 500, scope: 's' }], { holdStatus: 402 })
    const provider = vi.fn()
    await expect(sol.at('s').llm(provider, { model: 'm', messages: [] })).rejects.toBeInstanceOf(LimitExceeded)
    expect(provider).not.toHaveBeenCalled()
  })

  it('releases the hold when the provider throws', async () => {
    const { posts, sol } = client([{ unit: 'tokens', left: 500, scope: 's' }])
    await expect(sol.at('s').llm(async () => { throw new Error('provider down') }, { model: 'm', messages: [] })).rejects.toThrow('provider down')
    expect(posts[1].body.settle).toEqual({ tokens: 0, usd: 0 })
  })

  it('keeps the hold when the response carries no usage', async () => {
    const { posts, sol } = client([{ unit: 'tokens', left: 500, scope: 's' }])
    await sol.at('s').llm(async () => ({}), { model: 'm', messages: [] })
    expect(posts[1].body.settle).toEqual({ tokens: posts[0].body.tokens, usd: posts[0].body.usd })
  })

  it('counts system prompts and tools in the input estimate', async () => {
    const { sol } = client([{ unit: 'tokens', left: 200, scope: 's' }])
    await expect(sol.at('s').llm(vi.fn(), { model: 'm', system: 'x'.repeat(2000), messages: [] })).rejects.toBeInstanceOf(LimitExceeded)
  })

  it('with no applicable limit, calls first and spends the actual usage once', async () => {
    const { posts, sol } = client([])
    await sol.at('s').llm(async () => usage(3, 4), { model: 'm', messages: [] })
    expect(posts).toHaveLength(1)
    expect(posts[0].body).toMatchObject({ tokens: 7 })
  })

  it('follows the cached outage mode when the budget read fails', async () => {
    const open = client([], { getDown: true, store: new Map([['s', 'open']]) })
    const provider = vi.fn(async () => usage(1, 1))
    await open.sol.at('s/child').llm(provider, { model: 'm', messages: [] })
    expect(provider).toHaveBeenCalled()
    const closed = client([], { getDown: true })
    await expect(closed.sol.at('s').llm(vi.fn(), { model: 'm', messages: [] })).rejects.toBeInstanceOf(SolenoidUnavailable)
  })

  it('refuses a usd limit on a model with no known price', async () => {
    const { sol } = client([{ unit: 'usd', left: 1, scope: 's' }])
    await expect(sol.at('s').llm(vi.fn(), { model: 'unknown-model', messages: [] })).rejects.toMatchObject({ code: 'unknown_price' })
  })

  it('writes max_completion_tokens when the request uses it', async () => {
    const { sol } = client([{ unit: 'tokens', left: 300, scope: 's' }])
    const provider = vi.fn(async (_req: Record<string, unknown>) => usage(1, 1))
    await sol.at('s').llm(provider, { model: 'm', max_completion_tokens: 9999, messages: [] })
    expect(provider.mock.calls[0][0]).not.toHaveProperty('max_tokens')
    expect(provider.mock.calls[0][0].max_completion_tokens as number).toBeLessThanOrEqual(300)
  })

  it('runs under a fresh child scope, including at the root', async () => {
    const { sol } = client([])
    expect(await sol.run('acme/bot', async (r) => r.scope)).toMatch(/^acme\/bot\/run-[a-z0-9]{12,}$/)
    expect(await sol.run('', async (r) => r.scope)).toMatch(/^run-[a-z0-9]{12,}$/)
  })

  it('does not trust a cached entry that holds only non-model units: it GETs and holds instead of skipping', async () => {
    const posts: Post[] = []
    let gets = 0
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'GET') {
        gets++
        return json(200, { scope: 's', epoch: 0, limits: [{ unit: 'tokens', left: 500, scope: 's' }], children: [], entries: [], next: null })
      }
      const body = JSON.parse(init.body as string)
      posts.push({ body, idem: (init.headers as Record<string, string>)['idempotency-key'] })
      const remaining = body.settle ? {} : { emails: { scope: 's', left: 9, resets: null } }
      return json(200, { receipt: { id: 'r' }, remaining, on_outage: 'closed', warnings: [] })
    })
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f as unknown as typeof fetch, prices: { m: P } })
    await sol.at('s').spend({ emails: 1 })
    expect(posts).toHaveLength(1)
    expect(gets).toBe(0)
    const provider = vi.fn(async () => usage(1, 1))
    await sol.at('s').llm(provider, { model: 'm', messages: [] })
    expect(gets).toBe(1)
    expect(posts).toHaveLength(3)
    expect(posts[1].body.tokens).toBeLessThanOrEqual(500)
    expect(posts[2].body.settle).toBeDefined()
  })

  it('names exactly the held units in the settle body', async () => {
    const { posts, sol } = client([{ unit: 'tokens', left: 500, scope: 's' }])
    const provider = vi.fn(async () => usage(1, 1))
    await sol.at('s').llm(provider, { model: 'unpriced', messages: [] })
    expect(Object.keys(posts[0].body).sort()).toEqual(['tokens'])
    expect(Object.keys(posts[1].body.settle)).toEqual(['tokens'])
  })

  it('does not hold the whole remaining budget when max_tokens is unset', async () => {
    const { posts, sol } = client([{ unit: 'tokens', left: 1_000_000, scope: 's' }])
    const provider = vi.fn(async (req: Record<string, unknown>) => usage(20, Math.min(30, req.max_tokens as number)))
    await sol.at('s').llm(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    expect(provider.mock.calls[0][0].max_tokens).toBe(4096)
    expect(posts[0].body.tokens).toBeLessThan(1_000_000)
  })

  it('still returns the response when the post-call spend fails closed on an outage', async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'GET') return json(200, { scope: 's', epoch: 0, limits: [], children: [], entries: [], next: null })
      throw new TypeError('network')
    })
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f as unknown as typeof fetch, prices: { m: P } })
    const res = await sol.at('s').llm(async () => usage(3, 4), { model: 'm', messages: [] })
    expect(res).toEqual(usage(3, 4))
  })

  it('still returns the response when the settle fails after a successful hold', async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'GET') return json(200, { scope: 's', epoch: 0, limits: [{ unit: 'tokens', left: 500, scope: 's' }], children: [], entries: [], next: null })
      const body = JSON.parse(init.body as string)
      if (body.settle) return json(409, { error: 'idempotency_conflict' })
      return json(200, { receipt: { id: 'r' }, remaining: {}, on_outage: 'closed', warnings: [] })
    })
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f as unknown as typeof fetch, prices: { m: P } })
    const res = await sol.at('s').llm(async () => usage(1, 1), { model: 'm', messages: [] })
    expect(res).toEqual(usage(1, 1))
  })

  it('still throws a genuinely unexpected settle error instead of swallowing it', async () => {
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'GET') return json(200, { scope: 's', epoch: 0, limits: [{ unit: 'tokens', left: 500, scope: 's' }], children: [], entries: [], next: null })
      const body = JSON.parse(init.body as string)
      if (body.settle) throw new Error('boom')
      return json(200, { receipt: { id: 'r' }, remaining: {}, on_outage: 'closed', warnings: [] })
    })
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f as unknown as typeof fetch, prices: { m: P } })
    await expect(sol.at('s').llm(async () => usage(1, 1), { model: 'm', messages: [] })).rejects.toThrow('boom')
  })
})
