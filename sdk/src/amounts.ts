import type { Amounts } from './types.js'

export const ceilMicro = (v: number): number => {
  const m = v * 1e6, r = Math.round(m)
  return (Math.abs(m - r) <= Number.EPSILON * 8 * Math.max(1, Math.abs(m)) ? r : Math.ceil(m)) / 1e6
}

export function cleanAmounts(a: Amounts, allowZero = false): Amounts {
  const out: Amounts = {}
  for (const [unit, v] of Object.entries(a)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new TypeError(`solenoid: invalid amount for ${unit}`)
    const c = ceilMicro(v)
    if (c > 0 || allowZero) out[unit] = c
  }
  if (Object.keys(out).length === 0) throw new TypeError('solenoid: nothing to spend')
  return out
}
