import { execFile } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, inject, it } from 'vitest'
import { api, ok, user } from './harness'

const opsKey = async () =>
  (await promisify(execFile)(process.execPath, [resolve(__dirname, '../../worker/scripts/ops-key.mjs')], { env: { MASTER: inject('master') }, encoding: 'utf8' })).stdout.trim()

const signupFrom = async (ip: string) => {
  const res = await fetch(`${api}/auth/signup`, { method: 'POST', headers: { 'cf-connecting-ip': ip } })
  return [res.status, ((await res.json()) as { error?: string }).error ?? 'created']
}

it('refuses signups from one address past the ops limit with 429, and keeps admitting other addresses', async () => {
  const ip = '203.0.113.7'
  const who = createHmac('sha256', inject('master')).update(`ip:${ip}`).digest('hex').slice(0, 16)
  const ops = user()
  expect(await signupFrom('203.0.113.8')).toEqual([201, 'created'])
  expect(await ok(ops.cli('login', await opsKey()))).toBe('logged in')
  expect(await ok(ops.cli('limit', `signups/${who}`, 'signups=2', '--per', 'day'))).toMatch(/^signups\/[0-9a-f]{16}\nsignups +2 +day +used 0 +left 2/)

  expect(await signupFrom(ip)).toEqual([201, 'created'])
  expect(await signupFrom(ip)).toEqual([201, 'created'])
  expect(await signupFrom(ip)).toEqual([429, 'rate_limited'])
  expect(await signupFrom('203.0.113.8')).toEqual([201, 'created'])
  expect(await ok(ops.cli('ls', `signups/${who}`))).toMatch(/used 2 +left 0/)
})
