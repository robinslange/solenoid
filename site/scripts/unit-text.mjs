import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { attr, elementById, root, textOf, walk } from './lib/html.mjs'
import { listFiles } from './lib/files.mjs'

const [a, b] = process.argv.slice(2)
if (a === '--meta' && b) {
  for (const page of listFiles(b).filter((p) => p.endsWith('.html'))) {
    const nodes = [...walk(root(readFileSync(join(b, page), 'utf8')))]
    const title = nodes.find((n) => n.nodeName === 'title')?.childNodes?.[0]?.value ?? ''
    const description = attr(nodes.find((n) => n.nodeName === 'meta' && attr(n, 'name') === 'description') ?? {}, 'content') ?? ''
    process.stdout.write(`${page}\n  title: ${title}\n  description: ${description}\n`)
  }
} else if (a) {
  const html = readFileSync(a, 'utf8')
  const node = b ? elementById(html, b.replace(/^#/, '')) : [...walk(root(html))].find((n) => n.nodeName === 'body')
  if (!node) { console.error(`no element ${b} in ${a}`); process.exit(1) }
  process.stdout.write(`${textOf(node)}\n`)
} else {
  console.error('usage: node site/scripts/unit-text.mjs <page.html> [#id] | --meta <dist dir>')
  process.exit(2)
}
