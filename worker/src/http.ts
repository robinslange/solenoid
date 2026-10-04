import { parseLimitValue, UNIT } from './amounts'
import { ApiError } from './errors'
import type { PutReq } from './core'
import { PERS, type Per } from './windows'

const CONTROL = new Set(['per', 'on_outage', 'warn_at', 'rotate_keys', 'rotate_admin'])

export function parseJson(text: string, code: string): unknown {
  try { return JSON.parse(text) } catch { throw new ApiError(400, code) }
}

export function parsePut(body: unknown): PutReq {
  const bad = (field?: string) => new ApiError(400, 'invalid_limit', field ? { field } : {})
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad()
  const b = body as Record<string, unknown>
  const per = (b.per ?? null) as Per
  if (per !== null && !PERS.includes(per)) throw bad('per')
  const onOutage = b.on_outage ?? 'closed'
  if (onOutage !== 'open' && onOutage !== 'closed') throw bad('on_outage')
  const warnAt = b.warn_at ?? null
  if (warnAt !== null && (typeof warnAt !== 'number' || !(warnAt > 0 && warnAt <= 1))) throw bad('warn_at')
  for (const f of ['rotate_keys', 'rotate_admin']) if (b[f] !== undefined && typeof b[f] !== 'boolean') throw bad(f)
  const limits: Record<string, number | null> = {}
  for (const [unit, v] of Object.entries(b)) {
    if (CONTROL.has(unit)) continue
    if (!UNIT.test(unit)) throw new ApiError(400, 'invalid_unit', { unit })
    try { limits[unit] = parseLimitValue(v) } catch { throw bad(unit) }
  }
  const rotateKeys = b.rotate_keys === true, rotateAdmin = b.rotate_admin === true
  if (Object.keys(limits).length === 0 && !rotateKeys && !rotateAdmin) throw bad()
  return { limits, per, onOutage, warnAt: warnAt as number | null, rotateKeys, rotateAdmin }
}
