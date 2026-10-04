import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { solenoid, verifyChain } from '@solenoid.systems/sdk'

export async function capture({ adminKey, spendKey, api, scope, unit, fetch: f = globalThis.fetch }) {
  const receipt = await solenoid({ key: spendKey, api, fetch: f }).spend(scope, { [unit]: 1 })
  if (!receipt) throw new Error('the spend returned null, so nothing was recorded')
  const chain = (await solenoid({ key: adminKey, api, fetch: f }).get('')).entries.slice().reverse()
  const { keys } = await (await f(`${api}/.well-known/solenoid.json`)).json()
  if (!(await verifyChain([receipt], keys)) || !(await verifyChain(chain, keys))) throw new Error('the receipt or the chain does not verify against the published keys')
  return { receipt: { receipt, chain }, keys }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [scope, unit] = process.argv.slice(2)
  const dir = process.env.SOLENOID_CONFIG_DIR
  const spendKey = process.env.SOLENOID_KEY
  if (!scope || !unit || !dir || !spendKey) {
    console.error('usage: SOLENOID_CONFIG_DIR=<throwaway dir> SOLENOID_KEY=<spend key> node site/scripts/capture-receipt.mjs <scope> <unit>')
    process.exit(2)
  }
  const { api, admin_key } = JSON.parse(readFileSync(join(dir, 'credentials'), 'utf8'))
  const out = await capture({ adminKey: admin_key, spendKey, api, scope, unit })
  const data = fileURLToPath(new URL('../src/data/', import.meta.url))
  writeFileSync(join(data, 'receipt.json'), `${JSON.stringify(out.receipt, null, 2)}\n`)
  writeFileSync(join(data, 'keys.json'), `${JSON.stringify(out.keys, null, 2)}\n`)
  console.log(`saved receipt ${out.receipt.receipt.id} of account ${spendKey.split('.')[2]}`)
}
