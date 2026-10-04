import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startSite } from './lib/serve.mjs'

const PAGES = ['/', '/pricing', '/why', '/privacy', '/docs', '/no-such-page']
const WIDTHS = [375, 1280]
const out = fileURLToPath(new URL('../reports/screenshots/', import.meta.url))
mkdirSync(out, { recursive: true })
const site = await startSite()
const browser = await chromium.launch()
try {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.route('https://analytics.omit.nz/**', (r) => r.abort())
    for (const p of PAGES) {
      await page.goto(site.origin + p, { waitUntil: 'load' })
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${out}${(p.slice(1) || 'index').replace(/\W+/g, '-')}-${width}.png`, fullPage: true })
    }
    await page.close()
  }
} finally {
  await browser.close()
  site.stop()
}
console.log(`screenshots in ${out}`)
