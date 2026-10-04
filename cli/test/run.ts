import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { vi } from 'vitest'
import { testServer, type TestServer } from '../../testing/src/index'
import { assertInSandbox, sandbox } from './setup'

export type Result = { code: number; out: string; err: string }

export const tempDir = (prefix: string) => assertInSandbox(mkdtempSync(join(sandbox, prefix)))

export async function freshServer(): Promise<TestServer> {
  const server = await testServer()
  vi.stubGlobal('fetch', server.fetch)
  vi.stubEnv('SOLENOID_API', server.api)
  return server
}

export function useConfigDir(): string {
  const dir = join(tempDir('home-'), 'solenoid')
  vi.stubEnv('SOLENOID_CONFIG_DIR', dir)
  return dir
}

export async function solenoid(cwd: string, ...args: string[]): Promise<Result> {
  assertInSandbox(cwd)
  let out = ''
  let err = ''
  let code = 0
  const argv = process.argv
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out += String(s); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err += String(s); return true })
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => { code = c ?? 0 }) as typeof process.exit)
  vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  process.argv = [argv[0]!, 'solenoid', ...args]
  vi.resetModules()
  try {
    await (await import('../src/main')).done
    return { code, out, err }
  } finally {
    process.argv = argv
    vi.mocked(process.stdout.write).mockRestore()
    vi.mocked(process.stderr.write).mockRestore()
    vi.mocked(process.exit).mockRestore()
    vi.mocked(process.cwd).mockRestore()
  }
}
