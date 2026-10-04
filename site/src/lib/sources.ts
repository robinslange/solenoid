import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')
export const repoFile = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8')
