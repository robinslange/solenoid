import { describe, expect, it } from 'vitest'
import { ancestors, childOn, lastSegment, parentOf, parseScope, within } from '../src/scope'
import { ApiError } from '../src/errors'

describe('parseScope', () => {
  it('accepts the root and nested scopes, stripping trailing slashes', () => {
    expect(parseScope('')).toBe('')
    expect(parseScope('acme/bot/run-1/')).toBe('acme/bot/run-1')
    expect(parseScope('a_b/c.d')).toBe('a_b/c.d')
  })
  it.each(['Acme', 'a b', 'a//b', '..', 'a/./b', 'a/%2e', 'x'.repeat(65), 'a/b/c/d/e/f/g/h/i'])('rejects %s', (raw) => {
    expect(() => parseScope(raw)).toThrow(ApiError)
  })
})

describe('tree helpers', () => {
  it('lists ancestors from the root down to the scope', () => {
    expect(ancestors('a/b/c')).toEqual(['', 'a', 'a/b', 'a/b/c'])
    expect(ancestors('')).toEqual([''])
  })
  it('treats a sibling with a shared prefix as outside', () => {
    expect(within('acme2/x', 'acme')).toBe(false)
    expect(within('acme/x', 'acme')).toBe(true)
    expect(within('anything', '')).toBe(true)
  })
  it('finds the child of a parent on the path to a scope', () => {
    expect(childOn('acme/refunds', 'acme/refunds/o-1/x')).toBe('acme/refunds/o-1')
    expect(childOn('', 'acme/x')).toBe('acme')
    expect(childOn('acme', 'acme')).toBeNull()
    expect(childOn('acme', 'other/x')).toBeNull()
  })
})

describe('scope grammar edges', () => {
  it('accepts segments that merely contain dots, and exactly eight segments', () => {
    expect(parseScope('.a/a./a..b')).toBe('.a/a./a..b')
    expect(parseScope('a/b/c/d/e/f/g/h')).toBe('a/b/c/d/e/f/g/h')
  })
  it('strips every trailing slash', () => {
    expect(parseScope('a//')).toBe('a')
  })
  it('names the raw scope it refused', () => {
    try { parseScope('a/B') } catch (e) { expect((e as ApiError).detail).toEqual({ scope: 'a/B' }); return }
    throw new Error('expected a throw')
  })
  it('splits a nested scope into its parent and last segment', () => {
    expect(parentOf('a/b/c')).toBe('a/b')
    expect(lastSegment('a/b/c')).toBe('c')
    expect(lastSegment('a')).toBe('a')
  })
})
