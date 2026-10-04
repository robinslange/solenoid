import { describe, expect, it, vi } from 'vitest'
import { alert, canary, main } from '../canary.ts'
import { api, ok, user } from './harness'

async function canaryKey() {
  const u = user()
  await ok(u.cli('init'))
  return ok(u.cli('key', 'canary'))
}

describe('canary', () => {
  it('records one spend under canary/<region> and verifies its receipt', async () => {
    const key = await canaryKey()
    const first = await canary({ key, api, region: 'test' })
    const second = await canary({ key, api, region: 'test' })
    expect(second.seq).toBe(first.seq + 1)
    expect(first.ms).toBeGreaterThanOrEqual(0)
  })
  it('fails on a key the API refuses', async () => {
    const key = await canaryKey()
    await expect(canary({ key: `${key.slice(0, -1)}${key.endsWith('0') ? '1' : '0'}`, api, region: 'test' })).rejects.toMatchObject({ status: 401, code: 'invalid_key' })
  })
  it('fails when the receipt does not verify', async () => {
    const key = await canaryKey()
    const f = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/.well-known/solenoid.json') ? Promise.resolve(Response.json({ keys: {} })) : fetch(input, init)) as typeof fetch
    await expect(canary({ key, api, region: 'test', fetch: f })).rejects.toThrow('does not verify')
  })
})

describe('alert', () => {
  it('emails the failure through Resend, and throws when Resend refuses', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    await alert({ resendKey: 're_x', to: 'ops@example.com', region: 'omit-nz', error: 'HTTP 503', fetch: f })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers).toMatchObject({ authorization: 'Bearer re_x' })
    expect(JSON.parse(init.body)).toMatchObject({ to: ['ops@example.com'], subject: 'Solenoid canary failed in omit-nz', text: 'HTTP 503' })
    await expect(alert({ resendKey: 're_x', to: 'a@b.cd', region: 'r', error: 'e', fetch: vi.fn().mockResolvedValue(new Response('', { status: 401 })) })).rejects.toThrow('HTTP 401')
  })
})

describe('main', () => {
  it('exits 1 and logs both failures when the canary fails and the alert fails too', async () => {
    const key = await canaryKey()
    const badKey = `${key.slice(0, -1)}${key.endsWith('0') ? '1' : '0'}`
    vi.stubEnv('SOLENOID_CANARY_KEY', badKey)
    vi.stubEnv('SOLENOID_API', api)
    vi.stubEnv('CANARY_REGION', 'test')
    vi.stubEnv('CANARY_ALERT_RESEND_KEY', 're_x')
    vi.stubEnv('CANARY_ALERT_TO', 'ops@example.com')
    const errors: string[] = []
    const errSpy = vi.spyOn(console, 'error').mockImplementation((msg: unknown) => void errors.push(String(msg)))
    const f = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('api.resend.com') ? Promise.resolve(new Response('', { status: 401 })) : fetch(input, init)) as typeof fetch
    process.exitCode = undefined
    try {
      await main({ fetch: f })
      expect(process.exitCode).toBe(1)
      expect(errors.some((m) => m.includes('canary failed in test'))).toBe(true)
      expect(errors.some((m) => m.includes('canary alert failed in test'))).toBe(true)
    } finally {
      errSpy.mockRestore()
      vi.unstubAllEnvs()
      process.exitCode = 0
    }
  })
})
