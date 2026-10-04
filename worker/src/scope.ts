import { ApiError } from './errors'

const SEG = /^[a-z0-9._-]{1,64}$/
const DOTS = /^\.+$/

export function parseScope(raw: string): string {
  const s = raw.replace(/\/+$/, '')
  if (s === '') return ''
  const segs = s.split('/')
  if (segs.length > 8 || !segs.every((x) => SEG.test(x) && !DOTS.test(x))) throw new ApiError(400, 'invalid_scope', { scope: raw })
  return s
}

export function ancestors(scope: string): string[] {
  if (scope === '') return ['']
  const segs = scope.split('/')
  return ['', ...segs.map((_, i) => segs.slice(0, i + 1).join('/'))]
}

export const within = (scope: string, parent: string): boolean => parent === '' || scope === parent || scope.startsWith(parent + '/')

export function childOn(parent: string, scope: string): string | null {
  if (scope === parent || !within(scope, parent)) return null
  const first = (parent === '' ? scope : scope.slice(parent.length + 1)).split('/')[0]
  return parent === '' ? first : `${parent}/${first}`
}

export const parentOf = (scope: string): string => scope.split('/').slice(0, -1).join('/')
export const lastSegment = (scope: string): string => scope.split('/').at(-1) ?? ''
