import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const at = args.indexOf('--from')
const fromFile = at === -1 ? [] : readFileSync(args[at + 1], 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
const patterns = [...args.filter((_, i) => at === -1 || (i !== at && i !== at + 1)), ...fromFile]
if (patterns.length === 0 && at !== -1) {
  console.log('no patterns to check')
  process.exit(0)
}
if (patterns.length === 0) {
  console.error('usage: node scripts/scrub-check.mjs [--from <file>] [<pattern>...]  (fixed strings, matched in staged files)')
  process.exit(2)
}
let hits = ''
try {
  hits = execFileSync('git', ['grep', '--cached', '-n', '-I', '-F', ...patterns.flatMap((p) => ['-e', p]), '--', '.'], { encoding: 'utf8' })
} catch (e) {
  if (e.status !== 1) throw e
}
if (hits) {
  process.stdout.write(hits)
  process.exit(1)
}
console.log(`no tracked file contains any of the ${patterns.length} patterns`)
