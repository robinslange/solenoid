import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { sandbox } from './setup'

const SCRIPT = resolve(__dirname, '../../scripts/scrub-check.mjs')
const run = (cwd: string, ...patterns: string[]) => spawnSync(process.execPath, [SCRIPT, ...patterns], { cwd, encoding: 'utf8' })

it('lists staged lines holding any pattern, ignores untracked and unstaged text, and exits 1 only on a hit', () => {
  const dir = mkdtempSync(join(sandbox, 'scrub-'))
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: dir })
  git('init', '-q')
  writeFileSync(join(dir, 'a.md'), 'clean\nreach me at someone@example.org\n')
  git('add', 'a.md')
  writeFileSync(join(dir, 'b.md'), 'untracked: someone@example.org\n')
  const hit = run(dir, 'someone@example.org', '/home/nobody/')
  expect(hit.status).toBe(1)
  expect(hit.stdout).toBe('a.md:2:reach me at someone@example.org\n')
  const clean = run(dir, 'nobody@example.org')
  expect([clean.status, clean.stdout]).toEqual([0, 'no tracked file contains any of the 1 patterns\n'])
  expect(run(dir).status).toBe(2)
  writeFileSync(join(dir, 'pats'), '# one per line\n\nsomeone@example.org\n')
  const fromFile = run(dir, '--from', 'pats')
  expect([fromFile.status, fromFile.stdout]).toEqual([1, 'a.md:2:reach me at someone@example.org\n'])
  writeFileSync(join(dir, 'empty'), '# nothing yet\n')
  expect([run(dir, '--from', 'empty').status, run(dir, '--from', 'empty').stdout]).toEqual([0, 'no patterns to check\n'])
  writeFileSync(join(dir, 'a.md'), 'clean\n')
  expect(run(dir, 'someone@example.org').status).toBe(1)
  git('add', 'a.md')
  writeFileSync(join(dir, 'a.md'), 'clean\nsomeone@example.org, unstaged\n')
  expect(run(dir, 'someone@example.org').status).toBe(0)
})
