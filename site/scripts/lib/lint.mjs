import { textNodes } from './html.mjs'

const SKIP = new Set(['code', 'pre', 'script', 'style', 'template', 'noscript'])
export const RULES = [
  [/[–—]/, 'an en or em dash'],
  [/--/, '"--" in prose'],
  [/at the edge/i, '"at the edge"'],
  [/would have prevented/i, '"would have prevented"'],
  [/open[\s-]source/i, '"open source"'],
]

export const lintHtml = (html) =>
  textNodes(html, SKIP).flatMap((t) => RULES.filter(([re]) => re.test(t)).map(([, what]) => `${what}: "${t.trim().slice(0, 80)}"`))
