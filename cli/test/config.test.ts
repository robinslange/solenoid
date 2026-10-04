import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { apiBase, credsPath, hasCreds, readCreds, writeCreds } from '../src/config'
import { tempDir } from './run'
import { assertInSandbox } from './setup'

describe('config', () => {
  it('defaults to ~/.config/solenoid/credentials, under the sandboxed HOME', () => {
    vi.stubEnv('SOLENOID_CONFIG_DIR', undefined)
    expect(credsPath()).toBe(join(assertInSandbox(process.env.HOME ?? ''), '.config', 'solenoid', 'credentials'))
    expect(hasCreds()).toBe(false)
  })

  it('uses SOLENOID_CONFIG_DIR when it is set', () => {
    const dir = tempDir('cfg-')
    vi.stubEnv('SOLENOID_CONFIG_DIR', dir)
    expect(credsPath()).toBe(join(dir, 'credentials'))
  })

  it('says how to log in when there are no credentials', () => {
    vi.stubEnv('SOLENOID_CONFIG_DIR', tempDir('cfg-'))
    expect(hasCreds()).toBe(false)
    expect(() => readCreds()).toThrow(new Error('not logged in: run `solenoid init <scope>` for a new account, or `solenoid login <admin-key>` for an existing one'))
  })

  it('writes credentials that read back, creating the directory 0700 and the file 0600', () => {
    const dir = join(tempDir('cfg-'), 'a', 'b')
    vi.stubEnv('SOLENOID_CONFIG_DIR', dir)
    writeCreds({ api: 'http://example', admin_key: 'sk.admin.x' })
    expect(hasCreds()).toBe(true)
    expect(readCreds()).toEqual({ api: 'http://example', admin_key: 'sk.admin.x' })
    expect(readFileSync(join(dir, 'credentials'), 'utf8')).toBe('{\n  "api": "http://example",\n  "admin_key": "sk.admin.x"\n}')
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(join(dir, 'credentials')).mode & 0o777).toBe(0o600)
  })

  it('tightens a pre-existing directory to 0700 and a pre-existing file to 0600', () => {
    const dir = tempDir('cfg-')
    chmodSync(dir, 0o755)
    writeFileSync(join(dir, 'credentials'), '{}', { mode: 0o644 })
    vi.stubEnv('SOLENOID_CONFIG_DIR', dir)
    writeCreds({ api: 'http://example', admin_key: 'sk.admin.x' })
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(join(dir, 'credentials')).mode & 0o777).toBe(0o600)
  })

  it('points at https://api.solenoid.systems unless SOLENOID_API is set', () => {
    vi.stubEnv('SOLENOID_API', undefined)
    expect(apiBase()).toBe('https://api.solenoid.systems')
    vi.stubEnv('SOLENOID_API', 'http://127.0.0.1:1')
    expect(apiBase()).toBe('http://127.0.0.1:1')
  })
})
