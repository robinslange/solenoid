const MAX_HOPS = 2

export const SAMPLES = [
  ['/catch.md', 301, '/llms.txt'],
  ['/api/health', 301, '/'],
  ['/docs/catch/overview', 301, '/docs'],
  ['/blog/edge-native-apis', 302, '/'],
  ['/rss.xml', 302, '/'],
  ['/gate', 301, '/'],
  ['/witness/verify', 301, '/'],
  ['/philosophy/', 301, '/'],
  ['/checkout/success', 301, '/'],
  ['/witness-verifier.html', 301, '/'],
]
const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "frame-ancestors 'none'",
}
const get = (f, origin, path) => f(new URL(path, origin), { redirect: 'manual' })

export async function follow(origin, path, f = fetch) {
  let url = new URL(path, origin)
  for (let hops = 0; ; hops++) {
    const res = await f(url, { redirect: 'manual' })
    if (res.status < 300 || res.status > 399 || hops === MAX_HOPS) return { status: res.status, hops, url }
    url = new URL(res.headers.get('location') ?? '', url)
  }
}

export async function checkRoutes(origin, paths, f = fetch) {
  const problems = []
  for (const p of paths) {
    const r = await follow(origin, p, f)
    if (r.status !== 200) problems.push(`${p}: ${r.status} after ${r.hops} redirects, at ${r.url.pathname}`)
  }
  for (const [p, status, to] of SAMPLES) {
    const res = await get(f, origin, p)
    const at = new URL(res.headers.get('location') ?? '', origin).pathname
    if (res.status !== status || at !== to) problems.push(`${p}: ${res.status} to ${at}, expected ${status} to ${to}`)
  }
  for (const p of ['/pricing', '/?ref=hn', '/pricing?ref=launch']) {
    const res = await get(f, origin, p)
    if (res.status !== 200) problems.push(`${p}: ${res.status}, expected 200 with no redirect`)
  }
  const slash = await get(f, origin, '/pricing/')
  if (slash.status < 300 || slash.status > 399 || new URL(slash.headers.get('location') ?? '', origin).pathname !== '/pricing') problems.push(`/pricing/: ${slash.status}, expected a redirect to /pricing`)
  for (const p of ['/llms.txt', '/llms-full.txt']) {
    const type = (await get(f, origin, p)).headers.get('content-type')
    if (type !== 'text/plain; charset=utf-8') problems.push(`${p}: content-type ${type}`)
  }
  const home = await get(f, origin, '/')
  for (const [h, v] of Object.entries(SECURITY_HEADERS)) if (home.headers.get(h) !== v) problems.push(`/: ${h} is ${home.headers.get(h)}`)
  const missing = await get(f, origin, '/no-such-page')
  if (missing.status !== 404 || !(await missing.text()).includes('href="/docs"')) problems.push(`/no-such-page: ${missing.status}, expected the 404 page`)
  const security = await get(f, origin, '/.well-known/security.txt')
  if (security.status !== 200 || !(await security.text()).includes('Contact: mailto:security@solenoid.systems')) problems.push('/.well-known/security.txt is missing or has no contact')
  return problems
}
