import { spawn } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = fileURLToPath(new URL('../..', import.meta.url))

const freePort = () => new Promise((done, fail) => {
  const s = createServer().once('error', fail)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)) })
})

export async function startSite() {
  const port = await freePort()
  const env = { ...process.env }
  delete env.SOLENOID_KEY
  delete env.SOLENOID_API
  const logDir = mkdtempSync(join(tmpdir(), 'solenoid-site-dev-'))
  const log = openSync(join(logDir, 'wrangler.log'), 'w')
  const proc = spawn(`${site}/node_modules/.bin/wrangler`, ['dev', '--port', String(port), '--ip', '127.0.0.1', '--show-interactive-dev-session=false'], { cwd: site, env, stdio: ['ignore', log, log], detached: true })
  const stop = () => {
    if (proc.pid) try { process.kill(-proc.pid, 'SIGTERM') } catch {}
    closeSync(log)
    rmSync(logDir, { recursive: true, force: true })
  }
  const origin = `http://127.0.0.1:${port}`
  for (let i = 0; i < 120 && proc.exitCode === null; i++) {
    if (await fetch(`${origin}/favicon.svg`).then((r) => r.ok, () => false)) return { origin, stop }
    await new Promise((r) => setTimeout(r, 500))
  }
  const tail = readFileSync(join(logDir, 'wrangler.log'), 'utf8').split('\n').slice(-20).join('\n')
  stop()
  throw new Error(`wrangler dev did not serve site/dist on :${port}. Its last output:\n${tail}`)
}
