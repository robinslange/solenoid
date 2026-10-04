import { parseArgs } from 'node:util'
import { argError, dispatch, formatError } from './commands'

let cmd: string | undefined

async function main(): Promise<string> {
  let parsed
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: { per: { type: 'string' }, 'on-outage': { type: 'string' }, 'warn-at': { type: 'string' }, before: { type: 'string' }, yes: { type: 'boolean' }, admin: { type: 'boolean' }, force: { type: 'boolean' }, email: { type: 'string' }, tenant: { type: 'string' }, rotate: { type: 'boolean' } },
    })
  } catch (e) {
    throw argError(e as Error)
  }
  const [first = 'help', ...pos] = parsed.positionals
  cmd = first
  return dispatch(cmd, pos, parsed.values)
}

export const done = main().then(
  (out) => { process.stdout.write(`${out}\n`) },
  (e: Error) => { process.stderr.write(`${formatError(e, cmd)}\n`); process.exit(1) },
)
