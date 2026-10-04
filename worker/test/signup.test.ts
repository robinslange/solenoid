import { SELF, env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256hex } from '../src/chain'
import { adminKey, hmacHex } from '../src/keys'
import { ipKey } from '../src/index'
import { setBillable } from './helpers'

const bucket = async (k: string) => (await hmacHex(env.MASTER, `ip:${k}`)).slice(0, 16)

const signup = (ip: string) => SELF.fetch('https://api.test/auth/signup', { method: 'POST', headers: { 'cf-connecting-ip': ip } })

describe('signup', () => {
  it('mints a working tenant and admin key', async () => {
    const res = await signup('198.51.100.1')
    expect(res.status).toBe(201)
    const { tenant, admin_key } = (await res.json()) as { tenant: string; admin_key: string }
    expect(tenant).toMatch(/^[a-z2-7]{12}$/)
    expect((await SELF.fetch('https://api.test/v1/', { headers: { authorization: `Bearer ${admin_key}` } })).status).toBe(200)
  })

  it('stops an IP at the ops tenant limit, counting an IPv6 /64 as one client', async () => {
    const ops = await adminKey(env.MASTER, 'solenoidops2', 1)
    await signup('198.51.100.9')
    const put = await SELF.fetch('https://api.test/v1/signups', { method: 'PUT', headers: { authorization: `Bearer ${ops}` }, body: JSON.stringify({ signups: 2, per: 'child-day' }) })
    expect(put.status).toBe(200)
    expect((await signup('2001:db8:1:2::5')).status).toBe(201)
    expect((await signup('2001:db8:1:2:ffff::9')).status).toBe(201)
    const third = await signup('2001:0db8:0001:0002::1')
    expect(third.status).toBe(429)
    expect(await third.json()).toEqual({ error: 'rate_limited' })
    expect((await signup('2001:db8:1:3::1')).status).toBe(201)
  })

  it('reduces IPv6 addresses to their /64 and leaves IPv4 alone', () => {
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7')
    expect(ipKey('2001:db8::1')).toBe('2001:0db8:0000:0000')
    expect(ipKey('2001:db8:1:2:3:4:5:6')).toBe('2001:0db8:0001:0002')
    expect(ipKey('::1')).toBe('0000:0000:0000:0000')
    expect(ipKey('2001::1:2:3:4:5')).toBe('2001:0000:0000:0001')
  })
})

describe('signup edges', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('buckets by the first 16 hex of HMAC-SHA256(MASTER, "ip:" + client key), and a missing IP as "unknown"', async () => {
    const ops = await adminKey(env.MASTER, 'solenoidops2', 1)
    await signup('198.51.100.77')
    await signup('2001:db8:1:2::77')
    expect((await SELF.fetch('https://api.test/auth/signup', { method: 'POST' })).status).toBe(201)
    const res = await SELF.fetch('https://api.test/v1/signups', { headers: { authorization: `Bearer ${ops}` } })
    const { children } = (await res.json()) as { children: string[] }
    expect(children).toEqual(expect.arrayContaining([await bucket('198.51.100.77'), await bucket('2001:0db8:0001:0002'), await bucket('unknown')]))
    expect(children).not.toContain((await sha256hex('198.51.100.77')).slice(0, 16))
  })

  it('buckets recoveries by the same salted hash', async () => {
    const ops = await adminKey(env.MASTER, 'solenoidops2', 1)
    await SELF.fetch('https://api.test/auth/recover', { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.81' }, body: JSON.stringify({ tenant: 'abcdefghijkl', email: 'a@b.cd' }) })
    const res = await SELF.fetch('https://api.test/v1/recoveries', { headers: { authorization: `Bearer ${ops}` } })
    expect(((await res.json()) as { children: string[] }).children).toContain(await bucket('198.51.100.81'))
  })

  it('starts a new tenant on the free plan', async () => {
    const { tenant, admin_key } = (await (await signup('198.51.100.78')).json()) as { tenant: string; admin_key: string }
    const spend = (idem: string) => SELF.fetch('https://api.test/v1/a', { method: 'POST', headers: { authorization: `Bearer ${admin_key}`, 'idempotency-key': idem }, body: '{"x":1}' })
    await spend('f1')
    await setBillable(env.TENANT.get(env.TENANT.idFromName(tenant)), 100_000)
    expect((await spend('f2')).status).toBe(402)
  })

  it('gives up after three tenant id collisions with a 500 that leaks nothing', async () => {
    await env.TENANT.get(env.TENANT.idFromName('aaaaaaaaaaaa')).init('aaaaaaaaaaaa', 'free')
    const draws = vi.spyOn(crypto, 'getRandomValues').mockImplementation((a) => a)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await signup('198.51.100.79')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
    expect(draws).toHaveBeenCalledTimes(3)
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'three tenant id collisions in a row' }))
  })
})
