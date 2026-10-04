import { spawn } from 'node:child_process'

export function openUrl(url: string): Promise<boolean> {
  const [cmd, args] = process.env.BROWSER ? [process.env.BROWSER, [url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : ['xdg-open', [url]]
  return new Promise((done) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
      child.once('spawn', () => { child.unref(); done(true) })
      child.once('error', () => done(false))
    } catch {
      done(false)
    }
  })
}
