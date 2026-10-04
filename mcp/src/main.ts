import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { solenoid, type Client } from '@solenoid.systems/sdk'
import { fileStore } from '@solenoid.systems/sdk/node'
import { server, serveStdio } from './protocol'
import { tools } from './tools'

export const VERSION = '2.0.0'
type Env = Record<string, string | undefined>
const credsFile = (env: Env) => join(env.SOLENOID_CONFIG_DIR ?? join(homedir(), '.config', 'solenoid'), 'credentials')

export function clientFor(argv: string[], env: Env): { admin: boolean; client: Client } {
  if (argv.includes('--admin')) {
    let c: { api?: string; admin_key?: unknown } | undefined
    try {
      c = JSON.parse(readFileSync(credsFile(env), 'utf8'))
    } catch {}
    if (typeof c?.admin_key !== 'string' || !c.admin_key.startsWith('sk.admin.')) {
      throw new Error(`--admin reads the admin key from ${credsFile(env)}, which is missing, unreadable or holds no admin key (one that starts sk.admin.). run \`solenoid init\` to create an account, or \`solenoid login <admin-key>\` if you already have one. if the file is there, check that you can read it and that it is valid JSON.`)
    }
    return { admin: true, client: solenoid({ key: c.admin_key, api: c.api, store: fileStore() }) }
  }
  const key = env.SOLENOID_KEY
  if (!key?.startsWith('sk.spend.')) {
    throw new Error(`set SOLENOID_KEY to a spend key (it starts sk.spend.). get one with \`solenoid key <scope>\`. an admin key is refused here: to act as the admin instead, start with --admin, which reads the admin key from ${credsFile(env)}.`)
  }
  return { admin: false, client: solenoid({ key, api: env.SOLENOID_API, store: fileStore() }) }
}

export async function start(argv: string[], env: Env, input: NodeJS.ReadableStream, write: (s: string) => void): Promise<void> {
  const { admin, client } = clientFor(argv, env)
  await serveStdio(server(tools(client, admin), { name: 'solenoid', version: VERSION }), input, write)
}
