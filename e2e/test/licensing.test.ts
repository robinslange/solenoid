import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = (p: string) => resolve(__dirname, '../..', p)
const read = (p: string) => readFileSync(repo(p), 'utf8')
const pkg = (d: string) => JSON.parse(read(`${d}/package.json`)) as Record<string, any>
const FSL = ['worker', 'testing', 'e2e', 'docs/superpowers']
const MIT = ['sdk', 'cli', 'mcp', 'contract', 'site', 'docs']

describe('the license split', () => {
  it('gives every directory its LICENSE, naming the licensor, and the repository root none', () => {
    for (const d of FSL) {
      expect(read(`${d}/LICENSE`), d).toMatch(/^# Functional Source License, Version 1\.1, ALv2 Future License\n/)
      expect(read(`${d}/LICENSE`), d).toContain('Copyright 2026 Robin Lange, trading as omit')
      expect(read(`${d}/LICENSE`), d).not.toContain('${')
    }
    for (const d of MIT) {
      expect(read(`${d}/LICENSE`), d).toMatch(/^MIT License\n\nCopyright \(c\) 2026 Robin Lange, trading as omit\n/)
    }
    expect(existsSync(repo('LICENSE'))).toBe(false)
    expect(read('site/public/fonts/OFL-Archivo.txt')).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })

  it('declares the same license in every package.json', () => {
    for (const d of ['worker', 'testing', 'e2e']) expect(pkg(d).license, d).toBe('FSL-1.1-ALv2')
    for (const d of ['sdk', 'cli', 'mcp', 'site']) expect(pkg(d).license, d).toBe('MIT')
  })

  it('points each published package at the repository, the site and the issue tracker', () => {
    for (const d of ['sdk', 'cli', 'mcp', 'testing']) {
      expect(pkg(d), d).toMatchObject({
        repository: { type: 'git', url: 'git+https://github.com/robinslange/solenoid.git', directory: d },
        homepage: 'https://solenoid.systems',
        bugs: { url: 'https://github.com/robinslange/solenoid/issues' },
      })
    }
  })

  it('maps every directory in LICENSING.md, and never calls the server open source', () => {
    const map = read('LICENSING.md')
    for (const d of [...FSL, ...MIT, 'site/public/fonts', 'scripts', '.github']) expect(map, d).toContain(`\`${d}/\``)
    expect(map).toContain('Robin Lange, trading as omit')
    expect(map).not.toMatch(/open[\s-]source/i)
  })

  it('runs the scrub check on every commit once the local pattern file exists, and never commits that file', () => {
    expect(read('.gitignore').split('\n')).toContain('.scrub-patterns')
    expect(read('lefthook.yml')).toContain('test ! -f .scrub-patterns || node scripts/scrub-check.mjs --from .scrub-patterns')
  })
})
