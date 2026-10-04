import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFiles } from './lib/files.mjs'

const OLD = process.argv[2] ?? join(homedir(), 'dev', 'solenoid.systems')
const git = (...args) => execFileSync('git', ['-C', OLD, ...args], { encoding: 'utf8' }).split('\n').filter(Boolean)

const sitemap = await (await fetch('https://solenoid.systems/sitemap-0.xml')).text()
const fromSitemap = [...sitemap.matchAll(/<loc>https:\/\/solenoid\.systems([^<]*)<\/loc>/g)].map((m) => m[1] || '/')
if (fromSitemap.length === 0) throw new Error('the live sitemap listed no URLs; is solenoid.systems still the old site?')
const fromPublic = git('ls-files', 'public').map((p) => p.slice('public'.length))
const fromDist = listFiles(join(OLD, 'dist')).map((p) => `/${p}`).filter((p) => !p.startsWith('/_astro/'))
const fromPages = git('ls-files', 'src/pages').filter((p) => !p.includes('[')).map((p) => p.replace(/^src\/pages/, '').replace(/\.(astro|ts)$/, '').replace(/\/index$/, '') || '/')
const extra = ['/api/health', '/status', '/sitemap-index.xml', '/rss.xml']

const paths = [...new Set([...fromSitemap, ...fromPublic, ...fromDist, ...fromPages, ...extra])].sort()
writeFileSync(fileURLToPath(new URL('../test/fixtures/old-paths.txt', import.meta.url)), `${paths.join('\n')}\n`)
console.log(`${paths.length} paths: ${fromSitemap.length} from the sitemap, ${fromPublic.length} public files, ${fromDist.length} dist files, ${fromPages.length} page routes`)
