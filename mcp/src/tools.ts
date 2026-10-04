import type { Client, View } from '@solenoid.systems/sdk'
import type { Tool } from './protocol'

const SCOPE = { type: 'string', description: 'A scope such as "acme/bot". Use "" for the root. With a spend key, use the key\'s own scope or one below it; any other scope fails with out_of_scope.' }
const str = (a: Record<string, unknown>, k: string): string => {
  if (typeof a[k] !== 'string') throw new Error(`"${k}" must be a string`)
  return a[k] as string
}
const CONTROL = ['per', 'on_outage', 'warn_at', 'rotate_keys', 'rotate_admin']
const summary = (v: View) => ({ scope: v.scope, limits: v.limits, children: v.children })
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false })

export function tools(client: Client, admin: boolean): Tool[] {
  const read: Tool[] = [
    {
      name: 'get',
      description: 'Show every limit that applies at a scope, with its amount, window, usage and what is left, and list the scope\'s children. A per-child limit set on this scope shows no usage here; its usage shows on each child.',
      inputSchema: obj({ scope: SCOPE }, ['scope']),
      call: async (a) => JSON.stringify(summary(await client.get(str(a, 'scope')))),
    },
    {
      name: 'log',
      description: 'List the signed entries at a scope and below, newest first, 50 at a time: spends, settles, limit changes and key rotations.',
      inputSchema: obj({ scope: SCOPE, before: { type: 'integer', minimum: 1, description: 'Show entries older than this sequence number. Pass the "next" value of the previous page. When "next" is null, there are no older entries.' } }, ['scope']),
      call: async (a) => {
        if (a.before !== undefined && !(Number.isInteger(a.before) && (a.before as number) >= 1)) throw new Error('"before" must be a positive integer')
        const v = await client.get(str(a, 'scope'), { before: a.before as number | undefined })
        return JSON.stringify({ entries: v.entries, next: v.next })
      },
    },
  ]
  if (!admin) return read
  return [
    ...read,
    {
      name: 'set_limit',
      description: 'Set or remove limits at a scope. Each unit named in limits is replaced whole, and per, on_outage and warn_at apply to every unit in the call. Any of the three left out resets to its default: no window, closed, no warning. So to change one setting, call get first and pass the current settings back with it, leaving out per or warn_at where get shows null.',
      inputSchema: obj({
        scope: SCOPE,
        limits: { type: 'object', additionalProperties: { type: ['number', 'null'] }, description: 'Maps each unit to its cap, for example {"emails": 3, "usd": null}. Units are lowercase names you choose, matching ^[a-z][a-z0-9_]{0,31}$; spends is reserved, and so are per, on_outage, warn_at, rotate_keys and rotate_admin. The number is the cap per window in the unit\'s own terms, so usd is in dollars. 0 refuses every spend of the unit, and null removes its limit.' },
        per: {
          enum: ['hour', 'day', 'week', 'month', 'child', 'child-day'],
          description: 'The window: hour, day, week or month (UTC, calendar-aligned). child gives each direct child scope its own copy of the limit that never resets, and child-day resets each child\'s copy daily. Leave it out for no window: a running total that never resets.',
        },
        on_outage: { enum: ['open', 'closed'], description: 'What the limit does while Solenoid is unreachable: open lets actions through, and closed refuses them. An action goes through during an outage only if every limit that applies to it is open. Leave it out for closed.' },
        warn_at: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: 'A fraction of the limit, above 0 and up to 1. Once usage reaches it, each spend comes back with a warning. Leave it out for no warning.' },
      }, ['scope', 'limits']),
      call: async (a) => {
        const limits = a.limits
        if (!limits || typeof limits !== 'object' || Array.isArray(limits)) throw new Error('"limits" must be an object that maps each unit to a number or null')
        for (const [unit, v] of Object.entries(limits)) {
          if (CONTROL.includes(unit.toLowerCase())) throw new Error(`"limits" cannot use ${unit} as a unit, because per, on_outage, warn_at, rotate_keys and rotate_admin are reserved. set per, on_outage and warn_at as arguments of their own.`)
          if (v !== null && !Number.isFinite(v)) throw new Error(`"limits" must map each unit to a finite number or null, and ${unit} is not one.`)
        }
        const body: Record<string, number | string | null> = { ...(limits as Record<string, number | null>) }
        for (const k of ['per', 'on_outage', 'warn_at'] as const) if (a[k] !== undefined) body[k] = a[k] as string | number
        return JSON.stringify(summary(await client.limit(str(a, 'scope'), body)))
      },
    },
    {
      name: 'rotate',
      description: 'Revoke the spend key for exactly this scope, and return a new one. Keys derived for its child scopes keep working; rotate each of those separately. The old key fails from now on, so deploy the returned key wherever the old one was.',
      inputSchema: obj({ scope: SCOPE }, ['scope']),
      call: async (a) => {
        const scope = str(a, 'scope')
        const v = await client.rotate(scope)
        return JSON.stringify({ scope, key: await client.deriveKey(scope, v.epoch) })
      },
    },
  ]
}
