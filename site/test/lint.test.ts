import { describe, expect, it } from 'vitest'
import { lintHtml } from '../scripts/lib/lint.mjs'

const page = (body: string) => `<html><head><title>T</title></head><body>${body}</body></html>`

describe('lintHtml', () => {
  it('flags dashes, double hyphens and the banned phrases in text', () => {
    for (const bad of ['a — b', 'a – b', 'run it -- now', 'served at the edge', 'This would have prevented it', 'fully open source', 'Open-source server']) {
      expect(lintHtml(page(`<p>${bad}</p>`)), bad).toHaveLength(1)
    }
  })
  it('reads text nodes only: code, pre, scripts, styles, comments and attributes pass', () => {
    const html = page('<p>Clean prose.</p><code>--rotate</code><pre>a -- b</pre><script>x--</script><style>a{}</style><!-- a -- b --><a href="#--env-filefile" title="open source">link</a>')
    expect(lintHtml(html)).toEqual([])
  })
  it('lints the title too', () => {
    expect(lintHtml('<html><head><title>A — B</title></head><body></body></html>')).toHaveLength(1)
  })
})
