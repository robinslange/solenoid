import { Outage, toError } from './errors.js'

export type Transport = { api: string; key: string; timeoutMs: number; fetch: typeof fetch }

const REFUSED_5XX = new Set(['email_failed', 'billing_unavailable'])

const transient = (e: unknown): boolean =>
  e instanceof Outage || e instanceof TypeError || (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError'))

export async function call<T>(t: Transport, method: string, path: string, body?: unknown, idem?: string): Promise<T> {
  const attempt = async (): Promise<T> => {
    const res = await t.fetch(t.api + path, {
      method,
      headers: { authorization: `Bearer ${t.key}`, 'content-type': 'application/json', ...(idem ? { 'idempotency-key': idem } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(t.timeoutMs),
    })
    const data = (res.ok ? await res.json() : await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok) return data as T
    if (res.status >= 500 && !REFUSED_5XX.has(data.error as string)) throw new Outage(`HTTP ${res.status}`)
    throw toError(res.status, data)
  }
  const retryable = method === 'GET' || idem !== undefined
  try {
    return await attempt()
  } catch (e) {
    if (!transient(e)) throw e
    if (!retryable) throw new Outage('request failed and is not safe to retry', { cause: e })
  }
  try {
    return await attempt()
  } catch (e) {
    if (!transient(e)) throw e
    throw new Outage('solenoid unreachable', { cause: e })
  }
}
