import { execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { beforeAll, expect, it } from 'vitest'
import pkg from '../package.json'

const dist = `${__dirname}/../dist`
beforeAll(() => {
  rmSync(dist, { recursive: true, force: true })
  execSync('pnpm run build', { cwd: `${__dirname}/..`, stdio: 'ignore' })
})

it('builds testing.mjs with the ledger inside it, importing only node:sqlite, at call time', async () => {
  const src = readFileSync(`${dist}/testing.mjs`, 'utf8')
  expect(src).not.toMatch(/^\s*import\s/m)
  expect([...src.matchAll(/import\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1])).toEqual(['node:sqlite'])
  const { testServer } = await import(`${dist}/testing.mjs`)
  const server = await testServer()
  expect((await server.signup()).admin_key).toMatch(/^sk\.admin\./)
})

it('is licensed FSL-1.1-ALv2 and ships its types', () => {
  expect(pkg.license).toBe('FSL-1.1-ALv2')
  expect(existsSync(`${dist}/types/testing/src/index.d.ts`)).toBe(true)
})
