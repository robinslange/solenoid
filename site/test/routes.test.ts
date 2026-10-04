import { describe, expect, it } from 'vitest'
import { checkRoutes, follow } from '../scripts/lib/routes.mjs'

const O = 'http://127.0.0.1:1'
const site = (table: Record<string, [number, string?, Record<string, string>?]>) => (async (input: RequestInfo | URL) => {
  const u = new URL(String(input))
  const [status, location, headers = {}] = table[u.pathname + u.search] ?? table[u.pathname] ?? [404]
  return new Response(status === 200 ? 'ok' : null, { status, headers: { ...(location ? { location } : {}), ...headers } })
}) as typeof fetch

describe('follow', () => {
  it('follows at most two redirects', async () => {
    const f = site({ '/a': [301, '/b'], '/b': [307, '/c'], '/c': [301, '/d'], '/d': [200] })
    expect((await follow(O, '/a', f)).status).toBe(301)
    expect((await follow(O, '/b', f)).status).toBe(200)
  })
})

describe('checkRoutes', () => {
  it('reports every old path that does not end at 200', async () => {
    const problems = await checkRoutes(O, ['/gone', '/loop'], site({ '/loop': [301, '/loop'] }))
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining('/gone: 404'), expect.stringContaining('/loop: 301')]))
  })
})
