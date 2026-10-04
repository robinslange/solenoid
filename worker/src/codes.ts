import { hmacHex } from './keys'

export type Purpose = 'attach' | 'recover'
export const CODE_TTL_MS = 15 * 60_000
export const HOUR_MS = 60 * 60_000
export const DAY_MS = 24 * HOUR_MS
export const MAX_SENDS_PER_HOUR = 5
export const MAX_ATTACH_SENDS_PER_DAY = 10
export const MAX_LIVE_CODES = 3
export const MAX_FAILS_PER_HOUR = 5
export const MAX_FAILS_PER_DAY = 10
export const CODE_RE = /^[0-9]{6}$/
const EMAIL_RE = /^[^\s@\x00-\x1f\x7f]{1,64}@(?:[a-z0-9-]+\.)+[a-z0-9-]{2,}$/

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null
}

export function newCode(): string {
  const draw = new Uint32Array(1)
  do crypto.getRandomValues(draw)
  while (draw[0] >= 4_294_000_000)
  return String(draw[0] % 1_000_000).padStart(6, '0')
}

export const hashCode = (master: string, purpose: Purpose, email: string, code: string): Promise<string> =>
  hmacHex(master, `code:${purpose}:${email}:${code}`)
