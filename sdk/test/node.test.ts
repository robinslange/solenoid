import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { solenoid } from '../src/index'
import { fileStore } from '../src/node'
import { testServer } from '../../testing/src/index'

afterEach(() => { vi.restoreAllMocks() })

it('persists outage modes across store instances, as separate processes would', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sol-'))
  fileStore(dir).set('a/b', 'open')
  expect(fileStore(dir).get('a/b')).toBe('open')
  expect(fileStore(dir).get('other')).toBeUndefined()
})

it('reads a corrupt cache file as empty rather than throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sol-'))
  writeFileSync(join(dir, 'outage.json'), '{not json')
  expect(fileStore(dir).get('a')).toBeUndefined()
})

const unwritable = () => {
  const blocker = join(mkdtempSync(join(tmpdir(), 'sol-')), 'a-file')
  writeFileSync(blocker, '')
  return join(blocker, 'cache')
}

it('treats a failed write as best effort: it warns and does not throw', () => {
  const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
  const dir = unwritable()
  expect(() => fileStore(dir).set('a', 'open')).not.toThrow()
  expect(warn).toHaveBeenCalledTimes(1)
  expect(warn.mock.calls[0][0]).toMatch(new RegExp(`^solenoid: could not save the outage cache at ${join(dir, 'outage.json')}: ENOTDIR`))
  expect(fileStore(dir).get('a')).toBeUndefined()
})

it('returns the receipt of a recorded spend when the outage cache cannot be written', async () => {
  vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
  const server = await testServer()
  const admin = solenoid({ key: (await server.signup()).admin_key, api: server.api, fetch: server.fetch, store: fileStore(unwritable()) })
  await admin.limit('acme', { n: 100, on_outage: 'open' })
  const r = await admin.spend('acme', { n: 1 })
  expect(r).toMatchObject({ kind: 'spend', scope: 'acme' })
  expect((await admin.get('acme')).limits[0]).toMatchObject({ used: 1 })
})
