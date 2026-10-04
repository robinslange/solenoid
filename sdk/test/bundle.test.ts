import { execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { beforeAll, expect, it } from 'vitest'
import pkg from '../package.json'

const dist = `${__dirname}/../dist`
beforeAll(() => {
  rmSync(dist, { recursive: true, force: true })
  execSync('pnpm run build', { cwd: `${__dirname}/..`, stdio: 'ignore' })
})

it('builds a single-file bundle with no imports', () => {
  const src = readFileSync(`${dist}/solenoid.mjs`, 'utf8')
  expect(src).not.toMatch(/^\s*import\s/m)
  expect(src).toMatch(/export\s*\{/)
})

it('ships no Worker code: no testing export, no testing bundle, no ledger SQL', () => {
  expect(Object.keys(pkg.exports)).toEqual(['.', './node'])
  expect(existsSync(`${dist}/testing.mjs`)).toBe(false)
  for (const f of ['solenoid.mjs', 'node.mjs']) expect(readFileSync(`${dist}/${f}`, 'utf8')).not.toMatch(/CREATE TABLE|code_events|transactionSync/)
})
