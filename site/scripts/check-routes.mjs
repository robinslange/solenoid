import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkRoutes } from './lib/routes.mjs'

const origin = process.argv[2]
if (!origin) { console.error('usage: node site/scripts/check-routes.mjs <origin>'); process.exit(2) }
const paths = readFileSync(fileURLToPath(new URL('../test/fixtures/old-paths.txt', import.meta.url)), 'utf8').split('\n').filter(Boolean)
const problems = await checkRoutes(origin, paths)
for (const p of problems) console.error(p)
console.log(`${paths.length} old paths checked against ${origin}: ${problems.length} problems`)
process.exitCode = problems.length ? 1 : 0
