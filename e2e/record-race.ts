import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { SolenoidError, solenoid } from '@solenoid.systems/sdk'
import { startWranglerDev } from './wrangler-dev.ts'

export type Call = { n: number; at_ms: number; outcome: { recorded: string } | { refused: string } }
export type Race = { limit: number; calls: number; recorded: number; refused: number; lines: { at_ms: number; text: string }[]; sources: Record<string, string> }

const LIMIT = 7
const CALLS = 30
const REFUSAL = '402 limit_exceeded'
const root = fileURLToPath(new URL('..', import.meta.url))
const SOURCES = ['e2e/test/concurrency.test.ts', 'e2e/record-race.ts']

export const lineFor = (c: Call): string =>
  `spend ${String(c.n).padStart(2)}  ${'recorded' in c.outcome ? `recorded as ${c.outcome.recorded}` : `refused: ${c.outcome.refused}`}`

export function raceFrom(calls: Call[], lsOut: string, sources: Record<string, string>): Race {
  const recorded = calls.filter((c) => 'recorded' in c.outcome).length
  const refused = calls.filter((c) => 'refused' in c.outcome && c.outcome.refused === REFUSAL).length
  if (calls.length !== CALLS || recorded !== LIMIT || refused !== CALLS - LIMIT || !/^calls +7 +lifetime +used 7 +left 0 /m.test(lsOut)) {
    throw new Error(`the race did not hold: ${recorded} recorded and ${refused} refused with ${REFUSAL}, of ${calls.length}; ls acme printed:\n${lsOut}`)
  }
  const lines = [...calls].sort((a, b) => a.at_ms - b.at_ms).map((c) => ({ at_ms: c.at_ms, text: lineFor(c) }))
  return { limit: LIMIT, calls: CALLS, recorded, refused, lines, sources }
}

async function main(): Promise<void> {
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'solenoid-race-')))
  try {
    const dev = await startWranglerDev()
    try {
      const home = join(box, 'home')
      const cwd = join(box, 'project')
      mkdirSync(home)
      mkdirSync(cwd)
      const env = { PATH: process.env.PATH, HOME: home, SOLENOID_CONFIG_DIR: join(home, '.config', 'solenoid'), SOLENOID_API: dev.api }
      const cli = async (...args: string[]) => (await promisify(execFile)(process.execPath, [join(root, 'cli/dist/solenoid.mjs'), ...args], { cwd, env, encoding: 'utf8' })).stdout.trimEnd()
      await cli('init')
      await cli('limit', 'acme', `calls=${LIMIT}`)
      const key = await cli('key', 'acme/bot')
      const t0 = performance.now()
      const now = () => Math.round(performance.now() - t0)
      const calls = await Promise.all(Array.from({ length: CALLS }, async (_, i): Promise<Call> => {
        const outcome = await solenoid({ key, api: dev.api }).spend('acme/bot', { calls: 1 }).then(
          (r) => ({ recorded: r!.id }),
          (e: unknown) => ({ refused: e instanceof SolenoidError ? `${e.status} ${e.code}` : String(e) }),
        )
        return { n: i + 1, at_ms: now(), outcome }
      }))
      const sources = Object.fromEntries(SOURCES.map((p) => [p, createHash('sha256').update(readFileSync(join(root, p))).digest('hex')]))
      const race = raceFrom(calls, await cli('ls', 'acme'), sources)
      writeFileSync(join(root, 'site/src/data/race.json'), `${JSON.stringify(race, null, 2)}\n`)
      console.log(`wrote site/src/data/race.json: ${race.recorded} recorded, ${race.refused} refused`)
    } finally {
      await dev.stop()
    }
  } finally {
    rmSync(box, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
}
