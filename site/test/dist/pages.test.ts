import { describe, expect, it } from 'vitest'
import { checkSingleSource } from '../../scripts/lib/single-source.mjs'
import { attr, root, walk } from '../../scripts/lib/html.mjs'
import { DIST, REPO_ROOT, htmlPages, readDist } from './dist'

const metas = (html: string) => {
  const out: Record<string, string> = {}
  for (const n of walk(root(html))) {
    if (n.nodeName === 'meta') out[attr(n, 'name') ?? attr(n, 'property') ?? ''] = attr(n, 'content') ?? ''
    if (n.nodeName === 'link' && attr(n, 'rel') === 'canonical') out.canonical = attr(n, 'href') ?? ''
  }
  return out
}

describe('the built site', () => {
  it('serves llms.txt, llms-full.txt and /docs from the SDK files and nothing else', () => {
    expect(checkSingleSource(DIST, REPO_ROOT)).toEqual([])
  })
  it('gives every page a description, an apex canonical link, and Open Graph and Twitter text tags', () => {
    for (const page of htmlPages()) {
      const m = metas(readDist(page))
      expect(m.description, page).toMatch(/\S/)
      expect(m.canonical, page).toMatch(/^https:\/\/solenoid\.systems(\/|$)/)
      for (const k of ['og:title', 'og:description', 'twitter:card', 'twitter:title', 'twitter:description']) expect(m[k], `${page} ${k}`).toMatch(/\S/)
    }
  })
  it('draws the magnetic field on the landing page and not on /docs', () => {
    expect(readDist('index.html')).toContain('id="magnetic-field"')
    expect(readDist('docs.html')).not.toContain('id="magnetic-field"')
  })
  it('builds /pricing-style flat files and a sitemap under the old names', () => {
    expect(htmlPages()).toEqual(expect.arrayContaining(['index.html', 'docs.html']))
    expect(readDist('sitemap-index.xml')).toContain('https://solenoid.systems/sitemap-0.xml')
    expect(readDist('sitemap-0.xml')).toContain('<loc>https://solenoid.systems/docs</loc>')
  })
})
