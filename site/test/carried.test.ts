import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listFiles } from '../scripts/lib/files.mjs'

const site = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))
const FONTS = ['archivo-latin-400-normal.woff2', 'archivo-latin-500-normal.woff2', 'archivo-latin-700-normal.woff2', 'archivo-latin-900-normal.woff2', 'jetbrains-mono-latin-400-normal.woff2']

describe('what came over from the old site', () => {
  it('ships the five font files, each named by exactly one local @font-face rule, with the OFL beside them', () => {
    expect(readdirSync(site('public/fonts')).filter((f) => f.endsWith('.woff2')).sort()).toEqual(FONTS)
    const layout = readFileSync(site('src/layouts/Layout.astro'), 'utf8')
    expect([...layout.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((m) => m[1]).sort()).toEqual(FONTS)
    expect(layout).not.toMatch(/@fontsource/)
    for (const f of ['OFL-Archivo.txt', 'OFL-JetBrainsMono.txt']) expect(readFileSync(site(`public/fonts/${f}`), 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })

  it('asks for no JetBrains Mono weight that has no file', () => {
    for (const f of listFiles(site('src')).filter((p) => /\.(astro|ts)$/.test(p))) {
      for (const [, cls] of readFileSync(site(`src/${f}`), 'utf8').matchAll(/class(?::list)?=\{?["'`[]([^"'`\]]*)/g)) {
        if (/\bfont-mono\b/.test(cls)) expect(cls, `${f}: ${cls}`).not.toMatch(/\bfont-(medium|semibold|bold|extrabold|black)\b/)
      }
    }
  })

  it('has no view transitions, page-load events or [DIAG] logging', () => {
    for (const f of listFiles(site('src'))) {
      const text = readFileSync(site(`src/${f}`), 'utf8')
      expect(text, f).not.toMatch(/ClientRouter|astro:page-load|astro:after-swap|transition:persist|\[DIAG\]|console\.log/)
    }
  })

  it('keeps the favicon', () => {
    expect(existsSync(site('public/favicon.svg'))).toBe(true)
  })
})
