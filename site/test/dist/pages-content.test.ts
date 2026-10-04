import { describe, expect, it } from 'vitest'
import { attr, root, textOf, walk } from '../../scripts/lib/html.mjs'
import { readDist } from './dist'

const text = (page: string) => textOf([...walk(root(readDist(page)))].find((n) => n.nodeName === 'main'))
const hrefs = (page: string) => [...walk(root(readDist(page)))].filter((n) => n.nodeName === 'a').map((n) => attr(n, 'href'))

describe('the other pages', () => {
  it('prices Free and Pro in USD, and shows init before upgrade', () => {
    const t = text('pricing.html')
    for (const s of ['100,000', '$29 USD', '2M', '$10 USD', 'npx @solenoid.systems/cli init support-bot']) expect(t).toContain(s)
    expect(t.indexOf('npx @solenoid.systems/cli init support-bot')).toBeLessThan(t.indexOf('npx @solenoid.systems/cli upgrade'))
    expect(t).toContain('no partial refunds')
  })
  it('names the agency, the contact and every processor on /privacy', () => {
    const t = text('privacy.html')
    for (const s of ['Robin Lange, trading as omit', 'privacy@solenoid.systems', 'Privacy Act 2020', 'Umami', 'Resend', 'Stripe', 'Cloudflare', 'client_reference_id']) expect(t).toContain(s)
  })
  it('cites a source for each third party and the Act on /privacy', () => {
    expect(hrefs('privacy.html')).toEqual(expect.arrayContaining([
      'https://www.legislation.govt.nz/act/public/2020/0031/latest/LMS23223.html',
      'https://www.legislation.govt.nz/act/public/2020/0031/latest/LMS153150.html',
      'https://www.legislation.govt.nz/act/public/2020/0031/latest/LMS134243.html',
      'https://developers.cloudflare.com/durable-objects/reference/data-location/',
      'https://developers.cloudflare.com/workers/observability/logs/workers-logs/',
      'https://umami.is/docs/faq',
      'https://umami.is/docs/tracker-configuration',
      'https://www.cloudflare.com/privacypolicy/',
      'https://stripe.com/privacy',
      'https://resend.com/legal/privacy-policy',
    ]))
  })
  it('cites each incident on /why', () => {
    expect(hrefs('why.html')).toEqual(expect.arrayContaining([
      'https://x.com/summeryue0/status/2025774069124399363',
      'https://techcrunch.com/2026/02/23/a-meta-ai-security-researcher-said-an-openclaw-agent-ran-amok-on-her-inbox/',
      'https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/',
      'https://www.saastr.com/a-great-year-with-our-20-ai-agents-but-a-rough-week',
      'https://support.zendesk.com/hc/en-us/articles/11046894936218-Service-Incident-July-14-2026-AI-Agents-Multiple-Pods-AI-Agents-Repeating-Messages',
    ]))
  })
  it('links / and /docs from the 404 page', () => {
    expect(hrefs('404.html')).toEqual(expect.arrayContaining(['/', '/docs']))
  })
})
