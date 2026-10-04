import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFiles } from './lib/files.mjs'
import { checkLinks } from './lib/links.mjs'
import { lintHtml } from './lib/lint.mjs'
import { checkSingleSource } from './lib/single-source.mjs'

const dist = fileURLToPath(new URL('../dist', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const launch = process.argv.includes('--launch')
const problems = [
  ...checkSingleSource(dist, repoRoot),
  ...checkLinks(dist, { repoRoot, launch }),
  ...listFiles(dist).filter((p) => p.endsWith('.html')).flatMap((p) => lintHtml(readFileSync(join(dist, p), 'utf8')).map((x) => `${p}: ${x}`)),
]
for (const p of problems) console.error(p)
console.log(`${launch ? 'launch' : 'development'} checks over site/dist: ${problems.length} problems`)
process.exitCode = problems.length ? 1 : 0
