import { expect, it } from 'vitest'
import { checkLinks } from '../../scripts/lib/links.mjs'
import { lintHtml } from '../../scripts/lib/lint.mjs'
import { DIST, REPO_ROOT, htmlPages, readDist } from './dist'

it('has no broken internal link, and every GitHub link names a file in the working tree', () => {
  expect(checkLinks(DIST, { repoRoot: REPO_ROOT })).toEqual([])
})

it('keeps the house style in every text node of every page', () => {
  expect(htmlPages().flatMap((p) => lintHtml(readDist(p)).map((x) => `${p}: ${x}`))).toEqual([])
})
