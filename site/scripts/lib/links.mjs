import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFiles } from './files.mjs'
import { attr, root, walk } from './html.mjs'

const SITE = 'https://solenoid.systems'
const REPO = 'https://github.com/robinslange/solenoid'
const TAG = 'launch'

function fileFor(dist, pathname) {
  const p = decodeURIComponent(pathname)
  if (p === '/') return 'index.html'
  if (p.endsWith('/')) return undefined
  return [p.slice(1), `${p.slice(1)}.html`].find((f) => existsSync(join(dist, f)))
}

export function checkLinks(dist, { repoRoot, launch = false, git = (args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }) }) {
  const problems = []
  let atTag = null
  if (launch) {
    const remote = git(['ls-remote', '--tags', 'origin', `refs/tags/${TAG}`]).split('\t')[0].trim()
    const local = git(['rev-parse', `refs/tags/${TAG}`]).trim()
    if (remote !== local) problems.push(`the ${TAG} tag on origin (${remote || 'missing'}) is not the local ${TAG} tag (${local})`)
    atTag = new Set(git(['ls-tree', '-r', '--name-only', TAG]).split('\n').filter(Boolean))
  }
  const idCache = new Map()
  const idsIn = (file) => {
    if (!idCache.has(file)) idCache.set(file, new Set([...walk(root(readFileSync(join(dist, file), 'utf8')))].map((n) => attr(n, 'id')).filter(Boolean)))
    return idCache.get(file)
  }
  for (const page of listFiles(dist).filter((p) => p.endsWith('.html'))) {
    for (const n of walk(root(readFileSync(join(dist, page), 'utf8')))) {
      const href = n.nodeName === 'a' ? attr(n, 'href') : undefined
      if (!href || href.startsWith('mailto:')) continue
      const url = new URL(href, `${SITE}/${page}`)
      if (url.origin === SITE) {
        const file = fileFor(dist, url.pathname)
        if (!file) problems.push(`${page}: ${href} has no file in dist`)
        else if (url.hash && file.endsWith('.html') && !idsIn(file).has(decodeURIComponent(url.hash.slice(1)))) problems.push(`${page}: ${href} names no id in ${file}`)
      } else if (href.startsWith(`${REPO}/blob/`) || href.startsWith(`${REPO}/tree/`)) {
        const [kind, ref, ...rest] = url.pathname.split('/').slice(3)
        const path = rest.join('/')
        if (ref !== TAG) problems.push(`${page}: ${href} links ${ref}, not the ${TAG} tag`)
        else if (!atTag && !existsSync(join(repoRoot, path))) problems.push(`${page}: ${href} names ${path}, which is not in the working tree`)
        else if (atTag && !(kind === 'blob' ? atTag.has(path) : [...atTag].some((f) => f.startsWith(`${path}/`)))) problems.push(`${page}: ${href} names ${path}, which is not at the ${TAG} tag`)
      }
    }
  }
  return problems
}
