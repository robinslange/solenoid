const SEG = /^[a-z0-9._-]{1,64}$/

export function checkScope(scope: string): string {
  if (scope === '') return ''
  const segs = scope.split('/')
  if (segs.length > 8 || !segs.every((x) => SEG.test(x) && !/^\.+$/.test(x))) throw new TypeError(`solenoid: invalid scope "${scope}"`)
  return scope
}

export function nearestFirst(scope: string): string[] {
  const segs = scope === '' ? [] : scope.split('/')
  return [...segs.map((_, i) => segs.slice(0, segs.length - i).join('/')), '']
}
