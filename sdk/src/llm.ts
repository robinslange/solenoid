import { LimitExceeded, SolenoidError } from './errors.js'
import type { Amounts, Left, Price } from './types.js'

export function readUsage(res: unknown): { input: number; output: number } | null {
  const u = (res as { usage?: Record<string, number> })?.usage
  if (!u) return null
  if (typeof u.prompt_tokens === 'number') return { input: u.prompt_tokens, output: u.completion_tokens ?? 0 }
  if (typeof u.input_tokens === 'number') return { input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0 }
  return null
}

export function capOutput(left: { tokens?: number; usd?: number }, inputTokens: number, price: Price | undefined): number {
  const byTokens = left.tokens === undefined ? Infinity : left.tokens - inputTokens
  const byUsd = left.usd === undefined || !price ? Infinity : (left.usd - inputTokens * price.input) / price.output
  return Math.floor(Math.min(byTokens, byUsd))
}

export function estimateInput(req: Record<string, unknown>): number {
  const { model: _m, max_tokens: _a, max_completion_tokens: _b, ...rest } = req
  return Math.ceil((JSON.stringify(rest).length / 4) * 1.2)
}

export function leftFrom(limits: { unit: string; left: number | null; scope: string }[]): Record<string, Left> {
  const out: Record<string, Left> = {}
  for (const l of limits) if (l.left !== null && (!out[l.unit] || l.left < out[l.unit].left)) out[l.unit] = { scope: l.scope, left: l.left, resets: null }
  return out
}

export const costOf = (u: { input: number; output: number }, price: Price | undefined): Amounts =>
  ({ tokens: u.input + u.output, ...(price ? { usd: u.input * price.input + u.output * price.output } : {}) })

export function planCall(scope: string, req: Record<string, unknown>, left: Record<string, Left>, price: Price | undefined): { req: Record<string, unknown>; hold: Amounts | null } {
  if (left.usd && !price) throw new SolenoidError(0, 'unknown_price', { model: req.model })
  const input = estimateInput(req)
  const cap = capOutput({ tokens: left.tokens?.left, usd: left.usd?.left }, input, price)
  if (cap === Infinity) return { req, hold: null }
  if (cap < 1) {
    const unit = left.tokens && capOutput({ tokens: left.tokens.left }, input, price) < 1 ? 'tokens' : 'usd'
    throw new LimitExceeded(402, 'limit_exceeded', { scope: left[unit]?.scope ?? scope, unit, local: true })
  }
  const field = 'max_completion_tokens' in req ? 'max_completion_tokens' : 'max_tokens'
  const requested = typeof req[field] === 'number' ? (req[field] as number) : (price?.max_output ?? 4096)
  const out = Math.min(requested, cap)
  return { req: { ...req, [field]: out }, hold: costOf({ input, output: out }, price) }
}
