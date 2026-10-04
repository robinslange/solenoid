import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Dev = { api: string; master: string; stop(): Promise<void> }

const worker = fileURLToPath(new URL('../worker', import.meta.url))
const devVars = `${worker}/.dev.vars`
const backup = `${worker}/.dev.vars.bak`

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer().once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      server.close(() => done(port))
    })
  })
}

export async function startWranglerDev(): Promise<Dev> {
  if (existsSync(backup)) {
    throw new Error(`refusing to start: ${backup} already exists, which means an earlier run crashed before restoring it. Resolve that by hand before running the e2e tests, so this run can't clobber a real .dev.vars.`)
  }
  const port = await freePort()
  const master = `e2e-master-${crypto.randomUUID()}`
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const signingKey = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const kid = 'e2e'
  if (existsSync(devVars)) renameSync(devVars, backup)
  writeFileSync(devVars, `MASTER=${master}\nSIGNING_KEY='${JSON.stringify(signingKey)}'\nSIGNING_KID=${kid}\n`)
  const state = mkdtempSync(join(tmpdir(), 'solenoid-e2e-state-'))
  const env = { ...process.env }
  delete env.SOLENOID_KEY
  delete env.SOLENOID_API
  let proc: ChildProcess | undefined = spawn(`${worker}/node_modules/.bin/wrangler`, ['dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', state, '--show-interactive-dev-session=false'], { cwd: worker, env, stdio: 'ignore', detached: true })
  let restored = false
  const stop = async () => {
    if (proc?.pid) process.kill(-proc.pid, 'SIGTERM')
    proc = undefined
    if (!restored) {
      restored = true
      unlinkSync(devVars)
      if (existsSync(backup)) renameSync(backup, devVars)
    }
    rmSync(state, { recursive: true, force: true })
  }
  const api = `http://127.0.0.1:${port}`
  for (let i = 0; i < 120; i++) {
    const keys = await fetch(`${api}/.well-known/solenoid.json`).then((r) => (r.ok ? (r.json() as Promise<{ keys: Record<string, JsonWebKey> }>) : null)).then((b) => b?.keys, () => undefined)
    if (keys) {
      if (keys[kid]?.x !== signingKey.x) {
        await stop()
        throw new Error(`refusing to run: the server on 127.0.0.1:${port} does not publish this run's signing key under this run's kid, so it is not the wrangler dev instance this run started. The e2e tests must only ever talk to their own instance, not a stale or foreign one.`)
      }
      return { api, master, stop }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  await stop()
  throw new Error(`wrangler dev did not start on :${port}`)
}
