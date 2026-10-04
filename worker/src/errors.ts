export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly detail: Record<string, any> = {}) { super(code) }
}

export type Fail = { ok: false; status: number; error: string; detail?: Record<string, any> }
export type Result<T> = { ok: true; value: T } | Fail

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })
export const fail = (status: number, error: string, detail?: Record<string, any>): Fail => ({ ok: false, status, error, detail })

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

export function failResponse(f: Fail): Response {
  const headers: Record<string, string> = {}
  const resets = f.detail?.resets
  if (f.status === 402 && typeof resets === 'string') {
    headers['retry-after'] = String(Math.max(1, Math.ceil((Date.parse(resets) - Date.now()) / 1000)))
  }
  return json(f.status, { error: f.error, ...f.detail }, headers)
}
