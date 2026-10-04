import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendEnvKey, readEnvKey } from '../src/envfile'
import { tempDir } from './run'

const tmp = () => join(tempDir('env-'), '.env')
const withText = (text: string) => { const p = tmp(); writeFileSync(p, text); return p }

describe('appendEnvKey', () => {
  it('creates the file when it is missing', () => {
    const p = tmp()
    expect(appendEnvKey(p, 'sk.spend.x')).toBe('added')
    expect(readFileSync(p, 'utf8')).toBe('SOLENOID_KEY=sk.spend.x\n')
  })
  it('appends to an empty file without a blank line', () => {
    const p = withText('')
    expect(appendEnvKey(p, 'sk.spend.x')).toBe('added')
    expect(readFileSync(p, 'utf8')).toBe('SOLENOID_KEY=sk.spend.x\n')
  })
  it('adds a newline first when the file does not end with one', () => {
    const p = withText('A=1')
    expect(appendEnvKey(p, 'sk.spend.x')).toBe('added')
    expect(readFileSync(p, 'utf8')).toBe('A=1\nSOLENOID_KEY=sk.spend.x\n')
  })
  it('adds no newline when the file already ends with one', () => {
    const p = withText('A=1\n')
    appendEnvKey(p, 'sk.spend.x')
    expect(readFileSync(p, 'utf8')).toBe('A=1\nSOLENOID_KEY=sk.spend.x\n')
  })
  it('treats a CRLF file as ending in a newline and appends an LF line', () => {
    const p = withText('A=1\r\n')
    expect(appendEnvKey(p, 'sk.spend.x')).toBe('added')
    expect(readFileSync(p, 'utf8')).toBe('A=1\r\nSOLENOID_KEY=sk.spend.x\n')
  })
  it('adds a newline to a CRLF file whose last line has none', () => {
    const p = withText('A=1\r\nB=2')
    appendEnvKey(p, 'sk.spend.x')
    expect(readFileSync(p, 'utf8')).toBe('A=1\r\nB=2\nSOLENOID_KEY=sk.spend.x\n')
  })
  it('leaves an existing SOLENOID_KEY untouched, on any line and with CRLF endings', () => {
    for (const text of ['SOLENOID_KEY=old\n', 'A=1\r\nSOLENOID_KEY=old\r\nB=2\r\n', 'A=1\nSOLENOID_KEY=']) {
      const p = withText(text)
      expect(appendEnvKey(p, 'sk.spend.x')).toBe('present')
      expect(readFileSync(p, 'utf8')).toBe(text)
    }
  })
  it('leaves an exported, indented or spaced SOLENOID_KEY untouched', () => {
    for (const text of ['export SOLENOID_KEY=old\n', 'A=1\n  SOLENOID_KEY=old\n', '\texport\tSOLENOID_KEY=old\n', 'SOLENOID_KEY =old\n', 'A=1\r\nexport  SOLENOID_KEY = old\r\n']) {
      const p = withText(text)
      expect(appendEnvKey(p, 'sk.spend.x')).toBe('present')
      expect(readFileSync(p, 'utf8')).toBe(text)
    }
  })
  it('only counts SOLENOID_KEY at the start of a line', () => {
    for (const text of ['MY_SOLENOID_KEY=old\n', '# SOLENOID_KEY=old\n', 'SOLENOID_KEYS=old\n', 'exportSOLENOID_KEY=old\n', '# export SOLENOID_KEY=old\n', 'SOLENOID_KEY\n=old\n']) {
      const p = withText(text)
      expect(appendEnvKey(p, 'sk.spend.x')).toBe('added')
      expect(readFileSync(p, 'utf8')).toBe(`${text}SOLENOID_KEY=sk.spend.x\n`)
    }
  })
})

describe('readEnvKey', () => {
  it.each([
    ['SOLENOID_KEY=sk.x\n', 'sk.x'],
    ['export SOLENOID_KEY="sk.y"\n', 'sk.y'],
    ["  SOLENOID_KEY='sk.z'\n", 'sk.z'],
    ['MY_SOLENOID_KEY=sk.a\n', undefined],
    ['A=1\nexport  SOLENOID_KEY = sk.b\n', 'sk.b'],
    ['\tSOLENOID_KEY=\t"sk.c"\n', 'sk.c'],
    ['SOLENOID_KEY=notakey\n', undefined],
  ])('reads %j as %j', (text, key) => {
    expect(readEnvKey(withText(text))).toBe(key)
  })
  it('reads nothing from a missing file', () => {
    expect(readEnvKey(tmp())).toBeUndefined()
  })
})
