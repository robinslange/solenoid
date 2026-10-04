export const PERS = ['hour', 'day', 'week', 'month', 'child', 'child-day'] as const
export type Per = (typeof PERS)[number] | null

const HOUR = 3_600_000
const DAY = 86_400_000

export function windowStart(per: Per, now: number): number {
  const d = new Date(now)
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate()
  switch (per) {
    case 'hour': return Date.UTC(y, m, day, d.getUTCHours())
    case 'day':
    case 'child-day': return Date.UTC(y, m, day)
    case 'week': return Date.UTC(y, m, day - ((d.getUTCDay() + 6) % 7))
    case 'month': return Date.UTC(y, m, 1)
    default: return 0
  }
}

export function nextReset(per: Per, now: number): number | null {
  const start = windowStart(per, now)
  switch (per) {
    case 'hour': return start + HOUR
    case 'day':
    case 'child-day': return start + DAY
    case 'week': return start + 7 * DAY
    case 'month': { const d = new Date(start); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) }
    default: return null
  }
}

export const perChild = (per: Per): boolean => per === 'child' || per === 'child-day'
