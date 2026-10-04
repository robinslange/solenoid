import { describe, expect, it } from 'vitest'
import { limitBody } from '../src/commands'

describe('limitBody', () => {
  it('sends only the pairs when no flags were passed', () => {
    expect(limitBody(['emails=2'], {})).toEqual({ emails: 2 })
  })
  it('turns off a unit with "off"', () => {
    expect(limitBody(['emails=off'], {})).toEqual({ emails: null })
  })
  it('includes per, on-outage and warn-at only when the user passed them', () => {
    expect(limitBody(['usd=20'], { per: 'day', 'on-outage': 'open', 'warn-at': '0.8' })).toEqual({
      usd: 20,
      per: 'day',
      on_outage: 'open',
      warn_at: 0.8,
    })
  })
  it('never sends on_outage: "closed" when the flag is absent', () => {
    const body = limitBody(['emails=2'], { per: 'day' })
    expect(body).toEqual({ emails: 2, per: 'day' })
    expect(body).not.toHaveProperty('on_outage')
  })
})
