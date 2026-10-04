import { describe, expect, it } from 'vitest'
import { lineFor, raceFrom, type Call } from '../record-race.ts'

const LS = 'acme\ncalls        7        lifetime  used 7  left 0  (acme, closed)'
const call = (n: number, at_ms: number, ok: boolean): Call => ({ n, at_ms, outcome: ok ? { recorded: `rcp_${n}` } : { refused: '402 limit_exceeded' } })
const race = (recorded = 7, total = 30, refusal = '402 limit_exceeded') =>
  Array.from({ length: total }, (_, i) => (i < recorded ? call(i + 1, 90 - i, true) : { ...call(i + 1, 90 - i, false), outcome: { refused: refusal } }))

describe('raceFrom', () => {
  it('keeps the counts, and one line per call ordered by settle time', () => {
    const r = raceFrom(race(), LS, { 'e2e/test/concurrency.test.ts': 'a', 'e2e/record-race.ts': 'b' })
    expect(r).toMatchObject({ limit: 7, calls: 30, recorded: 7, refused: 23, sources: { 'e2e/test/concurrency.test.ts': 'a', 'e2e/record-race.ts': 'b' } })
    expect(r.lines.map((l) => l.at_ms)).toEqual(Array.from({ length: 30 }, (_, i) => 61 + i))
    expect(r.lines[29].text).toBe(lineFor(call(1, 90, true)))
  })
  it('refuses a run whose counts differ from the test, so nothing is written', () => {
    for (const [calls, ls] of [[race(8), LS], [race(6), LS], [race(7, 29), LS], [race(7, 30, '401 invalid_key'), LS], [race(), LS.replace('used 7', 'used 8')]] as const) {
      expect(() => raceFrom([...calls], ls, {})).toThrow('the race did not hold')
    }
  })
})

describe('lineFor', () => {
  it('shows which spend it was and its outcome, with no timing', () => {
    expect(lineFor({ n: 12, at_ms: 38, outcome: { recorded: 'rcp_5' } })).toBe('spend 12  recorded as rcp_5')
    expect(lineFor({ n: 3, at_ms: 41, outcome: { refused: '402 limit_exceeded' } })).toBe('spend  3  refused: 402 limit_exceeded')
  })
})
