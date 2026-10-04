import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { checkRoutes } from '../../scripts/lib/routes.mjs'
import { startSite } from '../../scripts/lib/serve.mjs'
import { readDist } from './dist'

let site: { origin: string; stop(): void }
beforeAll(async () => { readDist('index.html'); site = await startSite() })
afterAll(() => site?.stop())

it('answers every old path, rule, header and page as the spec says, under wrangler dev over dist', async () => {
  const paths = readFileSync(fileURLToPath(new URL('../fixtures/old-paths.txt', import.meta.url)), 'utf8').split('\n').filter(Boolean)
  expect(paths.length).toBeGreaterThan(200)
  expect(paths.some((p) => p.startsWith('/_astro/'))).toBe(false)
  expect(await checkRoutes(site.origin, paths)).toEqual([])
})
