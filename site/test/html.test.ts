import { describe, expect, it } from 'vitest'
import { elementById, headingIds, textNodes, textOf } from '../scripts/lib/html.mjs'

const PAGE = '<html><head><style>.a{}</style></head><body><section id="hero"><h1 id="x">One <code>init</code></h1><p>Two</p><script>var s = "no"</script><!-- note --></section></body></html>'

describe('html helpers', () => {
  it('finds an element by id, its heading ids, and its text by block', () => {
    const hero = elementById(PAGE, 'hero')!
    expect(headingIds(hero)).toEqual(['x'])
    expect(textOf(hero)).toBe('One init\nTwo')
    expect(elementById(PAGE, 'nope')).toBeNull()
  })
  it('lists text nodes without script, style, comments or the skipped tags', () => {
    expect(textNodes(PAGE, new Set(['script', 'style', 'code']))).toEqual(['One ', 'Two'])
  })
})
