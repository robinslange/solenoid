import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFiles } from '../../scripts/lib/files.mjs'

export const DIST = fileURLToPath(new URL('../../dist', import.meta.url))
export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const built = () => { if (!existsSync(join(DIST, 'index.html'))) throw new Error('site/dist is missing: run pnpm --filter @solenoid/site build first (pnpm test does)') }
export const readDist = (p: string) => { built(); return readFileSync(join(DIST, p), 'utf8') }
export const htmlPages = () => { built(); return listFiles(DIST).filter((p) => p.endsWith('.html')) }
