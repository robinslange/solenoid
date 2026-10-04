import { describe, expect, it } from 'vitest'
import { ceilMicro, cleanAmounts } from '../src/amounts'

describe('cleanAmounts', () => {
  it('rounds tiny amounts up to one micro-unit instead of to zero', () => {
    expect(cleanAmounts({ usd: 0.0000001 })).toEqual({ usd: 0.000001 })
  })
  it('does not inflate exact decimals through float error, at any magnitude', () => {
    expect(cleanAmounts({ usd: 0.1, tokens: 1840 })).toEqual({ usd: 0.1, tokens: 1840 })
    expect(cleanAmounts({ usd: 0.3 - 0.2 })).toEqual({ usd: 0.1 })
    expect(ceilMicro(17561305.854471)).toBe(17561305.854471)
  })
  it('drops zero units and refuses an empty spend, unless zeros are allowed', () => {
    expect(cleanAmounts({ usd: 0, tokens: 3 })).toEqual({ tokens: 3 })
    expect(() => cleanAmounts({ usd: 0 })).toThrow(TypeError)
    expect(() => cleanAmounts({ usd: -1 })).toThrow(TypeError)
    expect(cleanAmounts({ usd: 0 }, true)).toEqual({ usd: 0 })
  })
})

describe('cleanAmounts refusals', () => {
  it('refuses a negative, NaN or infinite amount even alongside a valid one, naming the unit', () => {
    for (const bad of [-1, NaN, Infinity, -Infinity]) {
      expect(() => cleanAmounts({ tokens: 3, usd: bad })).toThrow(new TypeError('solenoid: invalid amount for usd'))
    }
    expect(() => cleanAmounts({ tokens: 3, usd: '1' as unknown as number })).toThrow(new TypeError('solenoid: invalid amount for usd'))
  })
  it('says there is nothing to spend when every unit rounds to zero', () => {
    expect(() => cleanAmounts({ usd: 0 })).toThrow(new TypeError('solenoid: nothing to spend'))
  })
  it('absorbs float error up to and including its tolerance of 8 ulps', () => {
    expect(ceilMicro(2 ** -49 / 1e6)).toBe(0)
    expect(ceilMicro(2 ** -48 / 1e6)).toBe(0.000001)
  })
})
