import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { checkSingleSource } from '../scripts/lib/single-source.mjs'

const LLMS = '# Solenoid\n\nThe first line…\n'
const README = '# @solenoid.systems/sdk\n\n## Quickstart\n\n```sh\n# not a heading\n```\n\n## Model calls: `at(scope).llm` and `run`\n'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const DOCS = (hash = sha(README), ids = ['solenoidsystemssdk', 'quickstart', 'model-calls-atscopellm-and-run']) =>
  `<html><body><article id="readme" data-source-sha256="${hash}">${ids.map((id) => `<h2 id="${id}">x</h2>`).join('')}</article></body></html>`

function fixture(o: { llms?: string; full?: string; docs?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'site-single-'))
  mkdirSync(join(root, 'sdk'))
  mkdirSync(join(root, 'dist'))
  writeFileSync(join(root, 'sdk/llms.txt'), LLMS)
  writeFileSync(join(root, 'sdk/README.md'), README)
  writeFileSync(join(root, 'dist/llms.txt'), o.llms ?? LLMS)
  writeFileSync(join(root, 'dist/llms-full.txt'), o.full ?? `${LLMS}\n${README}`)
  writeFileSync(join(root, 'dist/docs.html'), o.docs ?? DOCS())
  return { dist: join(root, 'dist'), root }
}

describe('checkSingleSource', () => {
  it('passes a build made from the current files', () => {
    const f = fixture()
    expect(checkSingleSource(f.dist, f.root)).toEqual([])
  })
  it('fails on one changed byte in either text file, or a missing separator', () => {
    for (const o of [{ llms: LLMS.replace('…', '...') }, { full: `${LLMS}${README}` }, { full: `${LLMS}\n${README}\n` }]) {
      const f = fixture(o)
      expect(checkSingleSource(f.dist, f.root)).toHaveLength(1)
    }
  })
  it('fails when /docs was built from another README or renders other headings', () => {
    for (const docs of [DOCS(sha('old')), DOCS(undefined, ['solenoidsystemssdk', 'quickstart']), '<html><body></body></html>']) {
      const f = fixture({ docs })
      expect(checkSingleSource(f.dist, f.root)).toHaveLength(1)
    }
  })
})
