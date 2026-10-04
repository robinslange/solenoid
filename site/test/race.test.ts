import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import race from '../src/data/race.json'

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url))

it('was recorded from the current test and recorder', () => {
  expect(Object.keys(race.sources).sort()).toEqual(['e2e/record-race.ts', 'e2e/test/concurrency.test.ts'])
  for (const [path, hash] of Object.entries(race.sources)) {
    expect(createHash('sha256').update(readFileSync(repo(path))).digest('hex'), `${path} changed after race.json was recorded. Re-run: pnpm --filter @solenoid/e2e run record-race`).toBe(hash)
  }
})

it('holds the counts the test asserts, one line per spend, in settle order', () => {
  expect(race).toMatchObject({ limit: 7, calls: 30, recorded: 7, refused: 23 })
  expect(race.lines).toHaveLength(30)
  const at = race.lines.map((l) => l.at_ms)
  expect(at).toEqual([...at].sort((a, b) => a - b))
})

it('shows no timing figure on any line, since local timings would read as a latency claim', () => {
  for (const l of race.lines) expect(l.text).not.toMatch(/\d\s*ms\b/)
})
