import { parse } from 'parse5'

const HIDDEN = new Set(['script', 'style', 'template', 'noscript'])
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'nav', 'main', 'ol', 'ul', 'li', 'pre', 'table', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'figure', 'figcaption', 'blockquote'])

export const root = (html) => parse(html)
export const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value

export function* walk(node) {
  yield node
  for (const c of node.childNodes ?? []) yield* walk(c)
}

export function elementById(html, id) {
  for (const n of walk(root(html))) if (attr(n, 'id') === id) return n
  return null
}

export const headingIds = (node) => [...walk(node)].filter((n) => /^h[1-6]$/.test(n.nodeName)).map((n) => attr(n, 'id'))

export function textOf(node) {
  let out = ''
  const visit = (n) => {
    if (HIDDEN.has(n.nodeName)) return
    if (n.nodeName === '#text') out += n.value
    if (BLOCK.has(n.nodeName)) out += '\n'
    for (const c of n.childNodes ?? []) visit(c)
    if (BLOCK.has(n.nodeName)) out += '\n'
  }
  visit(node)
  return out.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}

export function textNodes(html, skip) {
  const out = []
  const visit = (n) => {
    if (skip.has(n.nodeName)) return
    if (n.nodeName === '#text' && n.value.trim()) out.push(n.value)
    for (const c of n.childNodes ?? []) visit(c)
  }
  visit(root(html))
  return out
}
