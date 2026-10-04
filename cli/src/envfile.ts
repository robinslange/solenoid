import { appendFileSync, existsSync, readFileSync } from 'node:fs'

const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '')

export function appendEnvKey(path: string, key: string): 'added' | 'present' {
  const text = read(path)
  if (/^[ \t]*(?:export[ \t]+)?SOLENOID_KEY[ \t]*=/m.test(text)) return 'present'
  appendFileSync(path, `${text === '' || text.endsWith('\n') ? '' : '\n'}SOLENOID_KEY=${key}\n`)
  return 'added'
}

export const readEnvKey = (path: string): string | undefined =>
  /^[ \t]*(?:export[ \t]+)?SOLENOID_KEY[ \t]*=[ \t]*["']?(sk\.[^\s"']+)/m.exec(read(path))?.[1]
