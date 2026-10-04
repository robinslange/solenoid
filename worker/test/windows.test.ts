import { describe, expect, it } from 'vitest'
import { nextReset, windowStart } from '../src/windows'

const T = Date.UTC(2026, 8, 24, 13, 45, 12) // Thursday 2026-09-24 13:45:12Z

describe('windows', () => {
  it('aligns to UTC calendar boundaries', () => {
    expect(windowStart('hour', T)).toBe(Date.UTC(2026, 8, 24, 13))
    expect(windowStart('day', T)).toBe(Date.UTC(2026, 8, 24))
    expect(windowStart('child-day', T)).toBe(Date.UTC(2026, 8, 24))
    expect(windowStart('week', T)).toBe(Date.UTC(2026, 8, 21))
    expect(windowStart('month', T)).toBe(Date.UTC(2026, 8, 1))
    expect(windowStart(null, T)).toBe(0)
    expect(windowStart('child', T)).toBe(0)
  })
  it('reports the next reset, or null for lifetime limits', () => {
    expect(nextReset('month', T)).toBe(Date.UTC(2026, 9, 1))
    expect(nextReset('month', Date.UTC(2026, 11, 31, 23))).toBe(Date.UTC(2027, 0, 1))
    expect(nextReset('week', T)).toBe(Date.UTC(2026, 8, 28))
    expect(nextReset(null, T)).toBeNull()
    expect(nextReset('child', T)).toBeNull()
  })
  it('puts Sunday in the week that started the Monday before', () => {
    expect(windowStart('week', Date.UTC(2026, 8, 27, 23))).toBe(Date.UTC(2026, 8, 21))
  })
})

describe('next reset per window', () => {
  it('ends an hour, a day and a per-child day at their boundaries', () => {
    expect(nextReset('hour', T)).toBe(Date.UTC(2026, 8, 24, 14))
    expect(nextReset('day', T)).toBe(Date.UTC(2026, 8, 25))
    expect(nextReset('child-day', T)).toBe(Date.UTC(2026, 8, 25))
  })
})
