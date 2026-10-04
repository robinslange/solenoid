import { afterEach, describe, expect, it, vi } from 'vitest'
import { CODE_RE, hashCode, newCode, normalizeEmail } from '../src/codes'

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Robin@Example.COM ')).toBe('robin@example.com')
  })
  it('refuses what cannot be an address', () => {
    for (const bad of ['', 'a@b', 'a b@c.de', '@c.de', 'a@.de', 'a@@c.de', 'a@b..cd', 'a@b.cd.', 'a@b.c', 'a\u0000b@c.de', 'a@b_c.de', 42, null, undefined, {}]) {
      expect(normalizeEmail(bad)).toBeNull()
    }
  })
  it('accepts up to 64 characters before the @ and 254 in all', () => {
    expect(normalizeEmail(`${'a'.repeat(64)}@${'b'.repeat(185)}.de`)).toBe(`${'a'.repeat(64)}@${'b'.repeat(185)}.de`)
    expect(normalizeEmail(`${'a'.repeat(64)}@${'b'.repeat(186)}.de`)).toBe(`${'a'.repeat(64)}@${'b'.repeat(186)}.de`)
    expect(normalizeEmail(`${'a'.repeat(64)}@${'b'.repeat(187)}.de`)).toBeNull()
    expect(normalizeEmail(`${'a'.repeat(65)}@c.de`)).toBeNull()
  })
  it('accepts a domain with several labels', () => {
    expect(normalizeEmail('robin@mail.example.co.nz')).toBe('robin@mail.example.co.nz')
  })
})

describe('newCode', () => {
  afterEach(() => vi.restoreAllMocks())
  it('is six digits, and draws again above the unbiased range', () => {
    for (let i = 0; i < 500; i++) expect(newCode()).toMatch(CODE_RE)
    const draws = [4_294_000_000, 4_294_967_295, 5]
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((a: Uint32Array) => { a[0] = draws.shift()!; return a }) as typeof crypto.getRandomValues)
    expect(newCode()).toBe('000005')
    expect(draws).toEqual([])
  })
})

describe('CODE_RE', () => {
  it('matches six digits and nothing around them', () => {
    expect(CODE_RE.test('012345')).toBe(true)
    for (const bad of ['12345', '1234567', 'x123456', '123456x', ' 123456', '123456 ']) expect(CODE_RE.test(bad)).toBe(false)
  })
})

describe('hashCode', () => {
  it('binds the key, the purpose, the email and the code', async () => {
    const h = await hashCode('m', 'attach', 'a@b.cd', '123456')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    for (const other of [
      hashCode('n', 'attach', 'a@b.cd', '123456'),
      hashCode('m', 'recover', 'a@b.cd', '123456'),
      hashCode('m', 'attach', 'x@b.cd', '123456'),
      hashCode('m', 'attach', 'a@b.cd', '123457'),
    ]) expect(await other).not.toBe(h)
  })
})
