import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import GithubSlugger from 'github-slugger'
import { attr, elementById, headingIds } from './html.mjs'

const plain = (s) => s.replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

function readmeSlugs(md) {
  const slugger = new GithubSlugger()
  const out = []
  let fence = false
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) fence = !fence
    const m = !fence && /^#{1,6}\s+(.*?)\s*$/.exec(line)
    if (m) out.push(slugger.slug(plain(m[1])))
  }
  return out
}

export function checkSingleSource(dist, repoRoot) {
  const problems = []
  const llms = readFileSync(join(repoRoot, 'sdk/llms.txt'))
  const readme = readFileSync(join(repoRoot, 'sdk/README.md'))
  if (!readFileSync(join(dist, 'llms.txt')).equals(llms)) problems.push('dist/llms.txt differs from sdk/llms.txt')
  if (!readFileSync(join(dist, 'llms-full.txt')).equals(Buffer.concat([llms, Buffer.from('\n'), readme]))) problems.push('dist/llms-full.txt differs from sdk/llms.txt, then one newline, then sdk/README.md')
  const article = existsSync(join(dist, 'docs.html')) ? elementById(readFileSync(join(dist, 'docs.html'), 'utf8'), 'readme') : null
  if (!article) problems.push('dist/docs.html has no <article id="readme">')
  else if (attr(article, 'data-source-sha256') !== createHash('sha256').update(readme).digest('hex')) problems.push('/docs was built from another sdk/README.md; rebuild the site')
  else if (JSON.stringify(headingIds(article)) !== JSON.stringify(readmeSlugs(readme.toString()))) problems.push(`/docs renders headings ${JSON.stringify(headingIds(article))}, and sdk/README.md has ${JSON.stringify(readmeSlugs(readme.toString()))}`)
  return problems
}
