import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/errors'
import { parseJson, parsePut } from '../src/http'

const refusal = (body: unknown) => {
  try { parsePut(body) } catch (e) { const a = e as ApiError; return { status: a.status, error: a.code, ...a.detail } }
  throw new Error('expected a refusal')
}

describe('parseJson', () => {
  it('turns malformed JSON into a 400 with the given code', () => {
    expect(() => parseJson('{', 'invalid_amount')).toThrow(expect.objectContaining({ status: 400, code: 'invalid_amount' }))
    expect(parseJson('{"a":1}', 'x')).toEqual({ a: 1 })
  })
})

describe('parsePut', () => {
  it('reads control fields as controls, not as units', () => {
    expect(parsePut({ usd: 1, warn_at: 0.8, per: 'day', on_outage: 'open' })).toEqual({ limits: { usd: 1_000_000 }, per: 'day', onOutage: 'open', warnAt: 0.8, rotateKeys: false, rotateAdmin: false })
    expect(parsePut({ rotate_keys: true })).toMatchObject({ limits: {}, rotateKeys: true, rotateAdmin: false })
    expect(parsePut({ rotate_admin: true })).toMatchObject({ limits: {}, rotateKeys: false, rotateAdmin: true })
  })
  it('accepts warn_at of exactly 1', () => {
    expect(parsePut({ usd: 1, warn_at: 1 }).warnAt).toBe(1)
  })
  it.each([null, [1], 'ab', 5, {}, { rotate_keys: false }])('refuses the body %j with no field named', (body) => {
    expect(refusal(body)).toEqual({ status: 400, error: 'invalid_limit' })
  })
  it.each([
    [{ usd: 1, per: 'fortnight' }, 'per'],
    [{ usd: 1, on_outage: 'maybe' }, 'on_outage'],
    [{ usd: 1, warn_at: '0.5' }, 'warn_at'],
    [{ usd: 1, warn_at: 0 }, 'warn_at'],
    [{ usd: 1, warn_at: 1.5 }, 'warn_at'],
    [{ rotate_keys: 'yes' }, 'rotate_keys'],
    [{ rotate_admin: 'yes' }, 'rotate_admin'],
    [{ usd: -1 }, 'usd'],
    [{ usd: 'ten' }, 'usd'],
  ])('refuses %j and names the field %s', (body, field) => {
    expect(refusal(body)).toEqual({ status: 400, error: 'invalid_limit', field })
  })
  it('refuses a unit outside the grammar as invalid_unit', () => {
    expect(refusal({ USD: 1 })).toEqual({ status: 400, error: 'invalid_unit', unit: 'USD' })
  })
})
