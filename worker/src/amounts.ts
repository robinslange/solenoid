import { ApiError } from './errors'

export const MICRO = 1_000_000
export const UNIT = /^[a-z][a-z0-9_]{0,31}$/
const MAX_UNITS = 16

export const toMicroUnits = (v: number): number => Math.round(v * MICRO)

function toMicro(v: unknown, allowZero: boolean): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ApiError(400, 'invalid_amount')
  const m = toMicroUnits(v)
  if (m < 0 || (!allowZero && m === 0) || !Number.isSafeInteger(m) || m > 1e15) throw new ApiError(400, 'invalid_amount')
  return m
}

function parseAmounts(body: unknown, allowZero: boolean): Record<string, number> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'invalid_amount')
  const entries = Object.entries(body)
  if (entries.length === 0 || entries.length > MAX_UNITS) throw new ApiError(400, 'invalid_amount')
  const out: Record<string, number> = {}
  for (const [unit, v] of entries) {
    if (!UNIT.test(unit) || unit === 'spends') throw new ApiError(400, 'invalid_unit', { unit })
    out[unit] = toMicro(v, allowZero)
  }
  return out
}

export const parseSpend = (body: unknown) => parseAmounts(body, false)
export const parseSettle = (body: unknown) => parseAmounts(body, true)
export const parseLimitValue = (v: unknown): number | null => (v === null ? null : toMicro(v, true))
export const fromMicro = (m: number): number => m / MICRO
