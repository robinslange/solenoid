import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { solenoid, SolenoidError } from '@solenoid.systems/sdk'
import { inject } from 'vitest'
import { sandbox } from './setup'

export const api = inject('api')
const CLI = resolve(__dirname, '../../cli/dist/solenoid.mjs')

export type Result = { code: number; out: string; err: string }

function inSandbox(path: string): string {
  if (!path.startsWith(sandbox + sep)) throw new Error(`refusing to run: ${path} is outside the e2e sandbox ${sandbox}`)
  return path
}

export function user() {
  const root = mkdtempSync(join(sandbox, 'user-'))
  const home = inSandbox(join(root, 'home'))
  const cwd = inSandbox(join(root, 'project'))
  mkdirSync(home)
  mkdirSync(cwd)
  const env = { PATH: process.env.PATH, HOME: home, SOLENOID_CONFIG_DIR: inSandbox(join(home, '.config', 'solenoid')), SOLENOID_API: api }
  const cli = (...args: string[]) =>
    new Promise<Result>((done) => {
      execFile(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' }, (e, out, err) => done({ code: e ? (e.code as number) : 0, out, err }))
    })
  return { cli, cwd, config: env.SOLENOID_CONFIG_DIR }
}

export async function ok(r: Promise<Result>): Promise<string> {
  const { code, out, err } = await r
  if (code !== 0) throw new Error(`solenoid exited ${code}: ${err}`)
  return out.trimEnd()
}

export const client = (key: string) => solenoid({ key, api })

export const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof SolenoidError ? `${e.status} ${e.code}` : String(e)))
