import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkLinks, gitEnv } from '../scripts/lib/links.mjs'

const AT = 'https://github.com/robinslange/solenoid/blob/launch/'
function fixture(pages: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'site-links-'))
  const dist = join(root, 'site/dist')
  mkdirSync(dist, { recursive: true })
  for (const [p, html] of Object.entries(pages)) writeFileSync(join(dist, p), html)
  mkdirSync(join(root, 'e2e/test'), { recursive: true })
  writeFileSync(join(root, 'e2e/test/concurrency.test.ts'), 'x')
  return { root, dist }
}
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd, encoding: 'utf8', env: gitEnv() })

describe('checkLinks, development mode', () => {
  it('passes internal links to files and ids, and GitHub links to files in the working tree', () => {
    const f = fixture({ 'index.html': `<a href="/docs#testing">d</a><a href="/llms.txt">l</a><a href="${AT}e2e/test/concurrency.test.ts">t</a><a href="https://example.com/x">x</a>`, 'docs.html': '<h2 id="testing">T</h2>', 'llms.txt': 'x' })
    expect(checkLinks(f.dist, { repoRoot: f.root })).toEqual([])
  })
  it('fails a missing page, a trailing-slash link, a missing id, a missing file and another ref', () => {
    const f = fixture({ 'index.html': `<a href="/nope">a</a><a href="/docs/">b</a><a href="/docs#gone">c</a><a href="${AT}e2e/nope.ts">d</a><a href="https://github.com/robinslange/solenoid/blob/main/e2e/test/concurrency.test.ts">e</a>`, 'docs.html': '<h2 id="testing">T</h2>' })
    expect(checkLinks(f.dist, { repoRoot: f.root })).toHaveLength(5)
  })
})

describe('checkLinks, launch mode', () => {
  function tagged() {
    const f = fixture({ 'index.html': `<a href="${AT}e2e/test/concurrency.test.ts">t</a>` })
    const origin = mkdtempSync(join(tmpdir(), 'site-origin-'))
    git(origin, 'init', '-q', '--bare')
    git(f.root, 'init', '-q')
    git(f.root, 'add', 'e2e')
    git(f.root, 'commit', '-q', '-m', 'snapshot')
    git(f.root, 'tag', 'launch')
    git(f.root, 'remote', 'add', 'origin', origin)
    return f
  }
  it('passes when the pushed tag is the local tag and holds every linked file', () => {
    const f = tagged()
    git(f.root, 'push', '-q', 'origin', 'launch')
    expect(checkLinks(f.dist, { repoRoot: f.root, launch: true })).toEqual([])
  })
  it('fails when the tag was never pushed', () => {
    const f = tagged()
    expect(checkLinks(f.dist, { repoRoot: f.root, launch: true })).toEqual([expect.stringContaining('the launch tag on origin')])
  })
  it('keeps to its own repositories when run from a git hook, which sets GIT_DIR to the real one', () => {
    const outer = mkdtempSync(join(tmpdir(), 'site-outer-'))
    git(outer, 'init', '-q')
    process.env.GIT_DIR = join(outer, '.git')
    try {
      const f = tagged()
      git(f.root, 'push', '-q', 'origin', 'launch')
      expect(checkLinks(f.dist, { repoRoot: f.root, launch: true })).toEqual([])
    } finally {
      delete process.env.GIT_DIR
    }
    expect(git(outer, 'rev-list', '--all').trim()).toBe('')
    expect(git(outer, 'config', '--get', 'core.bare').trim()).toBe('false')
  })
  it('fails when a linked file is not at the tag', () => {
    const f = tagged()
    git(f.root, 'push', '-q', 'origin', 'launch')
    writeFileSync(join(f.dist, 'index.html'), `<a href="${AT}e2e/later.ts">t</a>`)
    writeFileSync(join(f.root, 'e2e/later.ts'), 'x')
    expect(checkLinks(f.dist, { repoRoot: f.root, launch: true })).toHaveLength(1)
  })
})
