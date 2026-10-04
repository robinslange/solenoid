import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')

describe('serving config', () => {
  it('is an assets-only Worker that declares both custom domains', () => {
    const w = JSON.parse(read('wrangler.jsonc'))
    expect(w.name).toBe('solenoid-systems')
    expect(w.compatibility_date).toBe('2026-09-01')
    expect(w.main).toBeUndefined()
    expect(w.services).toBeUndefined()
    expect(w.assets).toEqual({ directory: './dist', not_found_handling: '404-page', html_handling: 'drop-trailing-slash' })
    expect(w.routes).toEqual([{ pattern: 'solenoid.systems', custom_domain: true }, { pattern: 'www.solenoid.systems', custom_domain: true }])
  })
  it('keeps _redirects inside Cloudflare limits, never redirects /_astro, and gives every exact rule a /* companion', () => {
    const rules = read('public/_redirects').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim().split(/\s+/))
    expect(rules.length).toBeLessThanOrEqual(2000)
    expect(rules.filter(([from]) => from.includes('*')).length).toBeLessThanOrEqual(100)
    expect(rules.some(([from]) => from.startsWith('/_astro'))).toBe(false)
    const froms = new Set(rules.map(([from]) => from))
    for (const [from] of rules) if (!from.includes('*') && !/\.(md|html|xml)$/.test(from)) expect(froms, from).toContain(`${from}/*`)
  })
  it('publishes a security.txt that has not expired', () => {
    const t = read('public/.well-known/security.txt')
    expect(t).toContain('Contact: mailto:security@solenoid.systems')
    expect(Date.parse(/^Expires: (.+)$/m.exec(t)![1])).toBeGreaterThan(Date.now())
  })
})
