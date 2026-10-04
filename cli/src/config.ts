import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type Creds = { api: string; admin_key: string }
const dir = () => process.env.SOLENOID_CONFIG_DIR ?? join(homedir(), '.config', 'solenoid')
const file = () => join(dir(), 'credentials')

export const credsPath = () => file()
export const hasCreds = () => existsSync(file())
export function readCreds(): Creds {
  if (!hasCreds()) throw new Error('not logged in: run `solenoid init <scope>` for a new account, or `solenoid login <admin-key>` for an existing one')
  return JSON.parse(readFileSync(file(), 'utf8')) as Creds
}
export function writeCreds(c: Creds): void {
  mkdirSync(dir(), { recursive: true, mode: 0o700 })
  chmodSync(dir(), 0o700)
  writeFileSync(file(), JSON.stringify(c, null, 2), { mode: 0o600 })
  chmodSync(file(), 0o600)
}
export const apiBase = () => process.env.SOLENOID_API ?? 'https://api.solenoid.systems'
