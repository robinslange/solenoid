import { execFileSync, spawn } from 'node:child_process'
import { createServer, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { assertInSandbox } from './setup'

const BIN = join(__dirname, '../dist/solenoid-mcp.mjs')

function run(env: NodeJS.ProcessEnv, stdin: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn('node', [BIN], { env: { PATH: process.env.PATH, HOME: assertInSandbox(process.env.HOME ?? ''), ...env } })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => (stdout += d))
    p.stderr.on('data', (d) => (stderr += d))
    p.on('error', reject)
    p.on('close', (code) => resolve({ code, stdout, stderr }))
    p.stdin.end(stdin)
  })
}

async function closedPort(): Promise<number> {
  const s = createServer()
  await new Promise<void>((done) => s.listen(0, '127.0.0.1', done))
  const { port } = s.address() as AddressInfo
  await new Promise((done) => s.close(done))
  return port
}

beforeAll(() => {
  execFileSync('pnpm', ['run', 'build'], { cwd: join(__dirname, '..') })
})

describe('the built binary', () => {
  it('exits 1 with one solenoid-mcp: line on stderr and nothing on stdout when SOLENOID_KEY is unset', async () => {
    const r = await run({}, '')
    expect(r.code).toBe(1)
    expect(r.stdout).toBe('')
    expect(r.stderr).toMatch(/^solenoid-mcp: [^\n]*SOLENOID_KEY[^\n]*\n$/)
  })

  it('answers a ping with a spend key, without reaching the API', async () => {
    const r = await run(
      { SOLENOID_KEY: 'sk.spend.abcdefghijkl.1.0.YQ.' + '0'.repeat(64), SOLENOID_API: `http://127.0.0.1:${await closedPort()}` },
      '{"jsonrpc":"2.0","id":1,"method":"ping"}\n',
    )
    expect(r).toEqual({ code: 0, stdout: '{"jsonrpc":"2.0","id":1,"result":{"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"solenoid","version":"2.0.0"}}}}\n', stderr: '' })
  })
})
