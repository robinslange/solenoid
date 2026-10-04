import { describe, expect, it } from 'vitest'
import { parseLimitValue, parseSettle, parseSpend } from '../src/amounts'
import { ApiError } from '../src/errors'

const code = (fn: () => unknown) => { try { fn(); return 'none' } catch (e) { return (e as ApiError).code } }

describe('parseSpend', () => {
  it('converts units to micro-units', () => {
    expect(parseSpend({ usd: 0.0123, emails: 1 })).toEqual({ usd: 12300, emails: 1_000_000 })
  })
  it.each([
    [{}, 'invalid_amount'], [[], 'invalid_amount'], [null, 'invalid_amount'],
    [{ usd: 0 }, 'invalid_amount'], [{ usd: -1 }, 'invalid_amount'], [{ usd: '1' }, 'invalid_amount'],
    [{ usd: 0.0000001 }, 'invalid_amount'], [{ USD: 1 }, 'invalid_unit'], [{ spends: 1 }, 'invalid_unit'],
    [{ usd: 1e12 }, 'invalid_amount'],
  ])('rejects %j with %s', (body, c) => { expect(code(() => parseSpend(body))).toBe(c) })
})

describe('parseSettle', () => {
  it('accepts zero, which releases a hold', () => {
    expect(parseSettle({ usd: 0, tokens: 12 })).toEqual({ usd: 0, tokens: 12_000_000 })
  })
  it('still rejects negatives and empty bodies', () => {
    expect(code(() => parseSettle({ usd: -1 }))).toBe('invalid_amount')
    expect(code(() => parseSettle({}))).toBe('invalid_amount')
  })
})

describe('parseLimitValue', () => {
  it('accepts zero as a kill switch and null as removal', () => {
    expect(parseLimitValue(0)).toBe(0)
    expect(parseLimitValue(null)).toBeNull()
    expect(parseLimitValue(2.5)).toBe(2_500_000)
  })
  it('rejects negatives', () => { expect(() => parseLimitValue(-1)).toThrow(ApiError) })
})

const detail = (fn: () => unknown) => { try { fn(); return undefined } catch (e) { return (e as ApiError).detail } }

describe('amount grammar edges', () => {
  it.each(['1usd', 'usd-x', `u${'x'.repeat(32)}`])('rejects the unit %s and names it', (unit) => {
    expect(code(() => parseSpend({ [unit]: 1 }))).toBe('invalid_unit')
    expect(detail(() => parseSpend({ [unit]: 1 }))).toEqual({ unit })
  })
  it('accepts a 32-character unit', () => {
    expect(parseSpend({ [`u${'x'.repeat(31)}`]: 1 })).toEqual({ [`u${'x'.repeat(31)}`]: 1_000_000 })
  })
  it('rejects a string body rather than reading its characters as units', () => {
    expect(code(() => parseSpend('ab'))).toBe('invalid_amount')
  })
  it('takes up to 16 units and no more', () => {
    const units = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`u${i}`, 1]))
    expect(Object.keys(parseSpend(units(16)))).toHaveLength(16)
    expect(code(() => parseSpend(units(17)))).toBe('invalid_amount')
  })
  it('caps an amount at 1e15 micro-units', () => {
    expect(parseSpend({ usd: 1e9 })).toEqual({ usd: 1e15 })
    expect(code(() => parseSpend({ usd: 2e9 }))).toBe('invalid_amount')
  })
  it.each([Infinity, NaN, true])('rejects %s', (v) => { expect(code(() => parseSpend({ usd: v }))).toBe('invalid_amount') })
})
