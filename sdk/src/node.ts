import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Mode, OutageStore } from './types.js'

export function fileStore(dir = join(homedir(), '.cache', 'solenoid')): OutageStore {
  const file = join(dir, 'outage.json')
  const read = (): Record<string, Mode> => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return {} } }
  return {
    get: (scope) => read()[scope],
    set(scope, v) {
      const all = read()
      if (all[scope] === v) return
      all[scope] = v
      try {
        mkdirSync(dir, { recursive: true })
        const tmp = `${file}.${process.pid}.tmp`
        writeFileSync(tmp, JSON.stringify(all))
        renameSync(tmp, file)
      } catch (e) {
        process.emitWarning(`solenoid: could not save the outage cache at ${file}: ${(e as Error).message}`)
      }
    },
  }
}
