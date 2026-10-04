# Solenoid Core (Plan 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy the Solenoid core: the TenantDO ledger behind `POST|PUT|GET /v1/{scope}` (including hold-and-settle and `warn_at`), derived keys and signup, the zero-dependency SDK, the CLI, and learning-loop's fetch budget and Verify spend running on it.

**Architecture:** One Cloudflare Worker with no runtime dependencies. It parses and authenticates each request, then makes one RPC call to a SQLite-backed Durable Object per tenant (`TenantDO`), which does each spend, settle or PUT in one serialized critical section. The SDK is the only HTTP client, the CLI wraps the SDK, and learning-loop vendors the SDK's single-file bundle.

**Tech Stack:** TypeScript 5, Cloudflare Workers + Durable Objects (SQLite storage), wrangler 4, vitest 4 with `@cloudflare/vitest-pool-workers` 0.21, `@cloudflare/workers-types` 5.x, WebCrypto (HMAC-SHA256, SHA-256, Ed25519), esbuild (the SDK and CLI bundles only), Node 20+ `node:util.parseArgs`, pnpm 12 workspaces.

**Spec:** `docs/superpowers/specs/2026-09-24-solenoid-governance-design.md`. **Copy brief:** `docs/copy/brief.md`. **Review this plan answers:** `docs/superpowers/plans/2026-09-24-solenoid-core.review.md`. All three are copied into the new repository in Task 1.

This plan covers build steps 1–5 of the spec, a test-hardening phase (Tasks 17–21) and the domain move. Email recovery and MCP are Plan 2. The site, Stripe, retention pruning, the canary and teardown are Plan 3.

## Global Constraints

- New repository at `~/dev/solenoid` (GitHub `robinslange/solenoid`, private until Plan 3). It is a pnpm workspace with packages `worker/`, `sdk/` and `cli/`, and `allowBuilds` for esbuild, workerd and sharp.
- **Zero runtime dependencies** in the Worker, SDK and CLI.
- `wrangler.jsonc` `compatibility_date` is `2026-08-01`; the pool's workerd supports up to 2026-08-11. `@cloudflare/workers-types` is `^5.20260801.0`.
- Worker TypeScript uses `"lib": ["ES2022"]` (no DOM). Values that cross RPC use `Record<string, any>`, not `unknown`, and are declared with `type`, not `interface`.
- Scope grammar: `seg(/seg){0,7}`, where `seg` matches `[a-z0-9._-]{1,64}` and is not all dots. The root scope is `''`. **The SDK and CLI validate scopes before building a URL**, because URL parsers collapse `..` and `%2e%2e` before the Worker sees the path.
- Unit grammar: `[a-z][a-z0-9_]{0,31}`. `spends` is reserved: `400 invalid_unit` in bodies, `403 plan_owned` in PUTs.
- Amounts are integer micro-units (×1,000,000) in storage, and unit numbers on the wire.
- An idempotency key is printable ASCII without `#`, 1–255 characters. A settle is stored under `<key>#settle`.
- Admin key: `sk.admin.{tenant}.{gen}.{hex secret}`. Spend key: `sk.spend.{tenant}.{gen}.{epoch}.{b64url(scope)}.{hex mac}`. `secret = hex(HMAC-SHA256(MASTER, "admin:{tenant}:{gen}"))`; `mac = hex(HMAC-SHA256(utf8(secret), "spend:{scope}:{epoch}"))`.
- Tenant IDs match `^[a-z2-7]{12}$`. The ops tenant is `solenoidops2`.
- Entry hash: `hex(sha256(utf8(prev + JCS({seq, kind, scope, body, at, kid}))))`. Signature: `b64url(Ed25519(utf8(hash)))`. The signing JWK is imported with only `kty, crv, x, d`, because workerd rejects Node's `alg: "Ed25519"`.
- A limit that has run out is `402`, never `429`.
- DO RPC methods return `Result` objects and never throw across RPC. Private DO members use `#private`, so RPC cannot reach them.
- Free plan: 100,000 billable spends per UTC calendar month. Settles and PUTs are not billable.
- SDK: 2,000 ms timeout; one retry, only for `GET` and idempotency-keyed `POST`.
- All reader-facing text (README, `llms.txt`, CLI output) follows `docs/copy/brief.md` and passes a cold `/copy-chief` diagnostic before its commit.
- Commit messages: no attribution lines, no co-author tags.

## Review Focus

1. **Very small `usd` amounts** from cheap models must round *up* to one micro-unit, never to zero (which would be `400 invalid_amount`), and exact decimals must not grow through float error. Pinned in Task 9.
2. **A timed-out PUT that rotates keys must not rotate twice.** The SDK retries only `GET` and idempotency-keyed `POST`. Pinned in Task 9.
3. **`acme/..` or `acme/%2e%2e` passed to the SDK or CLI** must throw before any request is made. The Worker cannot catch these, because the URL parser has already collapsed them. Pinned in Tasks 9 and 12.
4. **learning-loop session IDs outside the scope grammar** (uppercase, `unknown`, empty) must not turn fetches into `400`s. They are mapped onto the grammar, or fall back to the file store. Pinned in Task 14.
5. **`solenoid init` appending to a `.env` with no trailing newline** must not glue the key onto the last line, and must not add a second `SOLENOID_KEY`. Pinned in Task 12.

---

### Task 1: Repository and Worker scaffold

**Files:**
- Create: `~/dev/solenoid/{package.json,pnpm-workspace.yaml,.gitignore,tsconfig.base.json,README.md}`
- Create: `worker/{package.json,tsconfig.json,wrangler.jsonc,vitest.config.mts}`, `worker/src/{index.ts,tenant.ts,env.d.ts}`, `worker/test/smoke.test.ts`
- Copy: the spec, this plan, the review, and `docs/copy/brief.md`

**Interfaces:**
- Produces: `Cloudflare.Env` with `TENANT: DurableObjectNamespace<TenantDO>`, `MASTER: string`, `SIGNING_KEY: string` (a private Ed25519 JWK as JSON), `SIGNING_KID: string`.

- [ ] **Step 1: Create the repo and workspace**

```bash
mkdir -p ~/dev/solenoid/{worker/src,worker/test,sdk,cli,docs/superpowers/specs,docs/superpowers/plans,docs/copy}
cd ~/dev/solenoid && git init -b main
cp ~/dev/solenoid.systems/docs/superpowers/specs/2026-09-24-solenoid-governance-design.md docs/superpowers/specs/
cp ~/dev/solenoid.systems/docs/superpowers/plans/2026-09-24-solenoid-core{,.review}.md docs/superpowers/plans/
cp ~/dev/solenoid.systems/docs/copy/brief.md docs/copy/
```

`package.json`:
```json
{
  "name": "solenoid",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": { "test": "pnpm -r run test", "typecheck": "pnpm -r run typecheck" }
}
```

`pnpm-workspace.yaml`:
```yaml
packages: [worker, sdk, cli]
allowBuilds:
  esbuild: true
  workerd: true
  sharp: true
```

`.gitignore`:
```
node_modules/
dist/
.wrangler/
.dev.vars
.dev.vars.bak
reports/
.stryker-tmp/
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "skipLibCheck": true, "resolveJsonModule": true, "isolatedModules": true
  }
}
```

- [ ] **Step 2: Worker package files**

`worker/package.json`:
```json
{
  "name": "@solenoid/worker",
  "private": true,
  "type": "module",
  "scripts": { "dev": "wrangler dev", "deploy": "wrangler deploy", "test": "vitest run", "typecheck": "tsc --noEmit", "mutate": "stryker run" },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.21.1",
    "@cloudflare/workers-types": "^5.20260801.0",
    "typescript": "^5.6.0",
    "vitest": "^4.1.10",
    "wrangler": "^4.61.1"
  }
}
```

`worker/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022"], "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers/types"] },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`worker/wrangler.jsonc`:
```jsonc
{
  "name": "solenoid",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-01",
  "workers_dev": true,
  "observability": { "enabled": true },
  "durable_objects": { "bindings": [{ "name": "TENANT", "class_name": "TenantDO" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["TenantDO"] }],
  "vars": { "SIGNING_KID": "k1" }
}
```

`worker/vitest.config.mts` generates a fresh signing key per run. Node exports it with `alg`, and the plan's `importSigningKey` must cope with that, exactly as it will with `gen-secrets.mjs` in production.
```ts
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
const SIGNING_KEY = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' }, miniflare: { bindings: { MASTER: 'test-master-secret', SIGNING_KEY } } })],
})
```

`worker/src/env.d.ts`:
```ts
import type { TenantDO } from './tenant'

declare global {
  namespace Cloudflare {
    interface Env { TENANT: DurableObjectNamespace<TenantDO>; MASTER: string; SIGNING_KEY: string; SIGNING_KID: string }
  }
}
export {}
```

`worker/src/tenant.ts` (temporary; replaced in Task 4):
```ts
import { DurableObject } from 'cloudflare:workers'
export class TenantDO extends DurableObject<Cloudflare.Env> {}
```

`worker/src/index.ts` (temporary; replaced in Task 7):
```ts
export { TenantDO } from './tenant'
export default { async fetch(): Promise<Response> { return new Response('solenoid') } } satisfies ExportedHandler<Cloudflare.Env>
```

- [ ] **Step 3: Smoke test**

`worker/test/smoke.test.ts`:
```ts
import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'
it('serves', async () => { expect((await SELF.fetch('https://api.test/')).status).toBe(200) })
```

- [ ] **Step 4: Install, test and typecheck**

Run: `cd ~/dev/solenoid && pnpm install && pnpm --filter @solenoid/worker test && pnpm --filter @solenoid/worker typecheck`
Expected: install exits 0 with no ignored-builds error; 1 test passes; no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Scaffold the solenoid workspace and an empty Worker

Carries the governance spec, the core plan, its review and the copy
brief over as the first commit."
```

---

### Task 2: Scopes, amounts, windows and errors

**Files:**
- Create: `worker/src/{errors.ts,scope.ts,amounts.ts,windows.ts}`
- Test: `worker/test/{scope,amounts,windows}.test.ts`

**Interfaces:**
- Produces:
  - `class ApiError extends Error { status: number; code: string; detail: Record<string, any> }`
  - `type Fail = { ok: false; status: number; error: string; detail?: Record<string, any> }`, `type Result<T> = { ok: true; value: T } | Fail`, `ok(value)`, `fail(status, error, detail?)`, `json(status, body, headers?)`, `failResponse(f: Fail): Response`
  - `parseScope(raw: string): string` (throws `ApiError 400 invalid_scope`), `ancestors(scope)`, `within(scope, parent)`, `childOn(parent, scope)`, `parentOf(scope)`, `lastSegment(scope)`
  - `MICRO`, `UNIT`, `parseSpend(body): Record<string, number>` (positive micro), `parseSettle(body): Record<string, number>` (non-negative micro), `parseLimitValue(v): number | null`, `fromMicro(m)`, `toMicroUnits(v: number): number`
  - `type Per`, `PERS`, `windowStart(per, now)`, `nextReset(per, now)`, `perChild(per)`

- [ ] **Step 1: Write the failing tests**

`worker/test/scope.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { ancestors, childOn, parseScope, within } from '../src/scope'
import { ApiError } from '../src/errors'

describe('parseScope', () => {
  it('accepts the root and nested scopes, stripping trailing slashes', () => {
    expect(parseScope('')).toBe('')
    expect(parseScope('acme/bot/run-1/')).toBe('acme/bot/run-1')
    expect(parseScope('a_b/c.d')).toBe('a_b/c.d')
  })
  it.each(['Acme', 'a b', 'a//b', '..', 'a/./b', 'a/%2e', 'x'.repeat(65), 'a/b/c/d/e/f/g/h/i'])('rejects %s', (raw) => {
    expect(() => parseScope(raw)).toThrow(ApiError)
  })
})

describe('tree helpers', () => {
  it('lists ancestors from the root down to the scope', () => {
    expect(ancestors('a/b/c')).toEqual(['', 'a', 'a/b', 'a/b/c'])
    expect(ancestors('')).toEqual([''])
  })
  it('treats a sibling with a shared prefix as outside', () => {
    expect(within('acme2/x', 'acme')).toBe(false)
    expect(within('acme/x', 'acme')).toBe(true)
    expect(within('anything', '')).toBe(true)
  })
  it('finds the child of a parent on the path to a scope', () => {
    expect(childOn('acme/refunds', 'acme/refunds/o-1/x')).toBe('acme/refunds/o-1')
    expect(childOn('', 'acme/x')).toBe('acme')
    expect(childOn('acme', 'acme')).toBeNull()
    expect(childOn('acme', 'other/x')).toBeNull()
  })
})
```

`worker/test/amounts.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseLimitValue, parseSettle, parseSpend } from '../src/amounts'
import { ApiError } from '../src/errors'

const code = (fn: () => unknown) => { try { fn(); return 'none' } catch (e) { return (e as ApiError).code } }

describe('parseSpend', () => {
  it('converts units to micro-units', () => {
    expect(parseSpend({ usd: 0.0123, emails: 1 })).toEqual({ usd: 12300, emails: 1_000_000 })
  })
  it.each([
    [{}, 'invalid_amount'], [[], 'invalid_amount'], [null, 'invalid_amount'],
    [{ usd: 0 }, 'invalid_amount'], [{ usd: -1 }, 'invalid_amount'], [{ usd: '1' }, 'invalid_amount'],
    [{ usd: 0.0000001 }, 'invalid_amount'], [{ USD: 1 }, 'invalid_unit'], [{ spends: 1 }, 'invalid_unit'],
    [{ usd: 1e12 }, 'invalid_amount'],
  ])('rejects %j with %s', (body, c) => { expect(code(() => parseSpend(body))).toBe(c) })
})

describe('parseSettle', () => {
  it('accepts zero, which releases a hold', () => {
    expect(parseSettle({ usd: 0, tokens: 12 })).toEqual({ usd: 0, tokens: 12_000_000 })
  })
  it('still rejects negatives and empty bodies', () => {
    expect(code(() => parseSettle({ usd: -1 }))).toBe('invalid_amount')
    expect(code(() => parseSettle({}))).toBe('invalid_amount')
  })
})

describe('parseLimitValue', () => {
  it('accepts zero as a kill switch and null as removal', () => {
    expect(parseLimitValue(0)).toBe(0)
    expect(parseLimitValue(null)).toBeNull()
    expect(parseLimitValue(2.5)).toBe(2_500_000)
  })
  it('rejects negatives', () => { expect(() => parseLimitValue(-1)).toThrow(ApiError) })
})
```

`worker/test/windows.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { nextReset, windowStart } from '../src/windows'

const T = Date.UTC(2026, 8, 24, 13, 45, 12) // Thursday 2026-09-24 13:45:12Z

describe('windows', () => {
  it('aligns to UTC calendar boundaries', () => {
    expect(windowStart('hour', T)).toBe(Date.UTC(2026, 8, 24, 13))
    expect(windowStart('day', T)).toBe(Date.UTC(2026, 8, 24))
    expect(windowStart('child-day', T)).toBe(Date.UTC(2026, 8, 24))
    expect(windowStart('week', T)).toBe(Date.UTC(2026, 8, 21))
    expect(windowStart('month', T)).toBe(Date.UTC(2026, 8, 1))
    expect(windowStart(null, T)).toBe(0)
    expect(windowStart('child', T)).toBe(0)
  })
  it('reports the next reset, or null for lifetime limits', () => {
    expect(nextReset('month', T)).toBe(Date.UTC(2026, 9, 1))
    expect(nextReset('month', Date.UTC(2026, 11, 31, 23))).toBe(Date.UTC(2027, 0, 1))
    expect(nextReset('week', T)).toBe(Date.UTC(2026, 8, 28))
    expect(nextReset(null, T)).toBeNull()
    expect(nextReset('child', T)).toBeNull()
  })
  it('puts Sunday in the week that started the Monday before', () => {
    expect(windowStart('week', Date.UTC(2026, 8, 27, 23))).toBe(Date.UTC(2026, 8, 21))
  })
})
```

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm --filter @solenoid/worker test`
Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

`worker/src/errors.ts`:
```ts
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
```

`worker/src/scope.ts`:
```ts
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
```

`worker/src/amounts.ts`:
```ts
import { ApiError } from './errors'

export const MICRO = 1_000_000
export const UNIT = /^[a-z][a-z0-9_]{0,31}$/
const MAX_UNITS = 16

export const toMicroUnits = (v: number): number => Math.round(v * MICRO)

function toMicro(v: unknown, allowZero: boolean): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ApiError(400, 'invalid_amount')
  const m = toMicroUnits(v)
  if (m < 0 || (!allowZero && m === 0) || !Number.isSafeInteger(m) || m > 1e15) throw new ApiError(400, 'invalid_amount')
  return m
}

function parseAmounts(body: unknown, allowZero: boolean): Record<string, number> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'invalid_amount')
  const entries = Object.entries(body)
  if (entries.length === 0 || entries.length > MAX_UNITS) throw new ApiError(400, 'invalid_amount')
  const out: Record<string, number> = {}
  for (const [unit, v] of entries) {
    if (!UNIT.test(unit) || unit === 'spends') throw new ApiError(400, 'invalid_unit', { unit })
    out[unit] = toMicro(v, allowZero)
  }
  return out
}

export const parseSpend = (body: unknown) => parseAmounts(body, false)
export const parseSettle = (body: unknown) => parseAmounts(body, true)
export const parseLimitValue = (v: unknown): number | null => (v === null ? null : toMicro(v, true))
export const fromMicro = (m: number): number => m / MICRO
```

`worker/src/windows.ts`:
```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @solenoid/worker test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Parse scopes, amounts and calendar windows"
```

---

### Task 3: The hash chain

**Files:**
- Create: `worker/src/chain.ts`
- Test: `worker/test/chain.test.ts`

**Interfaces:**
- Produces:
  - `type Kind = 'spend' | 'settle' | 'limit' | 'rotate'`
  - `type Sealed = { seq: number; kind: Kind; scope: string; body: Record<string, any>; at: string; kid: string; prev: string; hash: string; sig: string }`
  - `GENESIS`, `jcs(v)`, `entryHash(prev, e)`, `importSigningKey(jwkJson)`, `signHash(key, hash)`, `publicJwk(jwkJson)`, `verifyChain(ascending, jwk)`, `hex`, `b64url`, `b64urlDecode`, `sha256hex`

- [ ] **Step 1: Write the failing test**

`worker/test/chain.test.ts`:
```ts
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { GENESIS, entryHash, importSigningKey, jcs, publicJwk, signHash, verifyChain, type Sealed } from '../src/chain'

describe('jcs', () => {
  it('sorts keys recursively and drops undefined', () => {
    expect(jcs({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[1,{"y":2,"z":1}]},"b":1}')
  })
})

async function build(n: number): Promise<Sealed[]> {
  const key = await importSigningKey(env.SIGNING_KEY)
  const out: Sealed[] = []
  let prev = GENESIS
  for (let seq = 1; seq <= n; seq++) {
    const e = { seq, kind: 'spend' as const, scope: 'a/b', body: { usd: seq / 10 }, at: new Date(seq * 1000).toISOString(), kid: 'k1' }
    const hash = await entryHash(prev, e)
    out.push({ ...e, prev, hash, sig: await signHash(key, hash) })
    prev = hash
  }
  return out
}

const TAMPER: Record<string, (c: Sealed[]) => unknown> = {
  body: () => ({ usd: 99 }), scope: () => 'x', at: () => new Date(0).toISOString(), seq: () => 42,
  prev: () => 'f'.repeat(64), sig: (c) => c[1].sig, kind: () => 'limit', kid: () => 'k2', hash: () => 'e'.repeat(64),
}

describe('chain', () => {
  it('imports a signing key that Node exported with alg set', async () => {
    expect(JSON.parse(env.SIGNING_KEY).alg).toBe('Ed25519')
    await expect(importSigningKey(env.SIGNING_KEY)).resolves.toBeDefined()
  })
  it('verifies an untouched chain', async () => {
    expect(await verifyChain(await build(5), publicJwk(env.SIGNING_KEY))).toBe(true)
  })
  it.each(Object.keys(TAMPER))('fails when %s of one entry is altered', async (field) => {
    const chain = await build(5)
    ;(chain[2] as unknown as Record<string, unknown>)[field] = TAMPER[field](chain)
    expect(await verifyChain(chain, publicJwk(env.SIGNING_KEY))).toBe(false)
  })
  it('fails when an entry is removed', async () => {
    const chain = await build(5)
    chain.splice(2, 1)
    expect(await verifyChain(chain, publicJwk(env.SIGNING_KEY))).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @solenoid/worker test -- chain`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement**

`worker/src/chain.ts`:
```ts
export type Kind = 'spend' | 'settle' | 'limit' | 'rotate'
export type Sealed = { seq: number; kind: Kind; scope: string; body: Record<string, any>; at: string; kid: string; prev: string; hash: string; sig: string }

export const GENESIS = '0'.repeat(64)
const enc = new TextEncoder()

export const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
export const b64url = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(b, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
}
export const sha256hex = async (s: string): Promise<string> => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))

export function jcs(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${jcs(o[k])}`).join(',')}}`
}

export const entryHash = (prev: string, e: Pick<Sealed, 'seq' | 'kind' | 'scope' | 'body' | 'at' | 'kid'>): Promise<string> =>
  sha256hex(prev + jcs({ seq: e.seq, kind: e.kind, scope: e.scope, body: e.body, at: e.at, kid: e.kid }))

export function importSigningKey(jwkJson: string): Promise<CryptoKey> {
  const { kty, crv, x, d } = JSON.parse(jwkJson) as JsonWebKey
  return crypto.subtle.importKey('jwk', { kty, crv, x, d }, { name: 'Ed25519' }, false, ['sign'])
}

export const signHash = async (key: CryptoKey, hash: string): Promise<string> => b64url(await crypto.subtle.sign('Ed25519', key, enc.encode(hash)))

export function publicJwk(jwkJson: string): JsonWebKey {
  const { kty, crv, x } = JSON.parse(jwkJson) as JsonWebKey
  return { kty, crv, x }
}

export async function verifyChain(entries: Sealed[], jwk: JsonWebKey): Promise<boolean> {
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify'])
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (i > 0 && (e.prev !== entries[i - 1].hash || e.seq !== entries[i - 1].seq + 1)) return false
    if ((await entryHash(e.prev, e)) !== e.hash) return false
    try {
      if (!(await crypto.subtle.verify('Ed25519', key, b64urlDecode(e.sig), enc.encode(e.hash)))) return false
    } catch {
      return false
    }
  }
  return true
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @solenoid/worker test -- chain`
Expected: PASS. If importing still fails, check that `importSigningKey` passes only `kty, crv, x, d`. workerd rejects the `alg: "Ed25519"` that Node writes.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Hash-chain and sign ledger entries with Ed25519

The signing key is imported from its curve fields alone: workerd rejects
the alg member Node writes into exported Ed25519 JWKs."
```

---

### Task 4: TenantDO spend and warn_at

**Files:**
- Create: `worker/src/tenant.ts` (replacing the temporary class), `worker/src/auth.ts`
- Test: `worker/test/helpers.ts`, `worker/test/tenant-spend.test.ts`

**Interfaces:**
- Produces:
  - `auth.ts`: `type Auth = { kind: 'admin' | 'spend' | 'internal'; gen: number; epoch: number; keyScope: string }`, `INTERNAL: Auth`
  - `TenantDO.init(tenant: string, plan: 'free' | 'pro' | 'internal'): Promise<boolean>`
  - `TenantDO.spend(auth: Auth, scope: string, amounts: Record<string, number>, idem: string, bodyHash: string): Promise<Result<SpendOk>>`
  - public field `TenantDO.now: () => number`
  - `type Receipt = Sealed & { id: string; replay: boolean }`, `type Remaining = Record<string, { scope: string; left: number; resets: string | null }>`, `type Warning = { scope: string; unit: string; used: number; limit: number }`, `type SpendOk = { receipt: Receipt; remaining: Remaining; on_outage: 'open' | 'closed'; warnings: Warning[] }`, `FREE_SPENDS`

Until Task 6 adds `put`, the tests in this task insert limit rows through `runInDurableObject`'s storage handle. Task 6 replaces them with real PUTs.

- [ ] **Step 1: Test helpers**

`worker/test/helpers.ts`:
```ts
import { env, runInDurableObject } from 'cloudflare:test'
import type { Auth } from '../src/auth'
import type { TenantDO } from '../src/tenant'
import type { Per } from '../src/windows'

export type Stub = DurableObjectStub<TenantDO>
export const ADMIN: Auth = { kind: 'admin', gen: 1, epoch: 0, keyScope: '' }
export const u = (n: number) => Math.round(n * 1_000_000)

export async function tenant(plan: 'free' | 'pro' | 'internal' = 'free'): Promise<Stub> {
  const stub = env.TENANT.get(env.TENANT.idFromName(crypto.randomUUID()))
  await stub.init('abcdefghijkl', plan)
  return stub
}

export const sql = (stub: Stub, query: string, ...args: SqlStorageValue[]) =>
  runInDurableObject(stub, (_i: TenantDO, state: DurableObjectState) => { state.storage.sql.exec(query, ...args) })

export const rawLimit = (stub: Stub, scope: string, unit: string, amount: number, per: Per = null, onOutage = 'closed', warnAt: number | null = null) =>
  sql(stub, 'INSERT INTO limits (scope, unit, amount, per, on_outage, warn_at) VALUES (?, ?, ?, ?, ?, ?)', scope, unit, amount, per, onOutage, warnAt)

export const setNow = (stub: Stub, t: number) => runInDurableObject(stub, (i: TenantDO) => { i.now = () => t })

export async function setBillable(stub: Stub, n: number) {
  await sql(stub, "UPDATE meta SET v = CAST((SELECT coalesce(max(seq), 0) FROM entries) - ? AS TEXT) WHERE k = 'seq_month_start'", n)
  await sql(stub, "UPDATE meta SET v = '0' WHERE k = 'nonspend_month'")
}

let k = 0
export const spend = (stub: Stub, scope: string, amounts: Record<string, number>, auth: Auth = ADMIN) =>
  stub.spend(auth, scope, amounts, `idem-${++k}`, `hash-${k}`)
```

- [ ] **Step 2: Write the failing tests**

`worker/test/tenant-spend.test.ts`:
```ts
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { rawLimit, setBillable, setNow, spend, tenant, u } from './helpers'

describe('spend', () => {
  it('records a spend with no limits and returns a signed receipt', async () => {
    const s = await tenant()
    const r = await spend(s, 'acme/bot', { emails: u(1) })
    expect(r.ok && r.value).toMatchObject({
      receipt: { id: 'rcp_1', seq: 1, kind: 'spend', scope: 'acme/bot', body: { emails: 1 }, replay: false },
      remaining: {}, on_outage: 'closed', warnings: [],
    })
  })

  it('blocks when an ancestor limit would be exceeded, and changes nothing', async () => {
    const s = await tenant()
    await rawLimit(s, 'acme', 'usd', u(1))
    expect((await spend(s, 'acme/bot/run-1', { usd: u(0.6) })).ok).toBe(true)
    expect(await spend(s, 'acme/bot/run-2', { usd: u(0.6), tokens: u(10) })).toMatchObject({
      ok: false, status: 402, error: 'limit_exceeded', detail: { scope: 'acme', unit: 'usd', limit: 1, used: 0.6, requested: 0.6, resets: null },
    })
    const after = await spend(s, 'acme/bot/run-3', { usd: u(0.4) })
    expect(after.ok && after.value.remaining.usd).toEqual({ scope: 'acme', left: 0, resets: null })
  })

  it('reports the tightest limit per unit and the strictest outage mode', async () => {
    const s = await tenant()
    await rawLimit(s, 'acme', 'usd', u(10), null, 'open')
    await rawLimit(s, 'acme/bot', 'usd', u(2), null, 'open')
    const r = await spend(s, 'acme/bot', { usd: u(1) })
    expect(r.ok && r.value.remaining.usd).toEqual({ scope: 'acme/bot', left: 1, resets: null })
    expect(r.ok && r.value.on_outage).toBe('open')
    await rawLimit(s, '', 'usd', u(100), null, 'closed')
    const r2 = await spend(s, 'acme/bot', { usd: u(0.1) })
    expect(r2.ok && r2.value.on_outage).toBe('closed')
  })

  it('gives each child its own copy of a per-child limit, and ignores it at the parent itself', async () => {
    const s = await tenant()
    await rawLimit(s, 'acme/refunds', 'refunds', u(1), 'child')
    expect((await spend(s, 'acme/refunds/o-1', { refunds: u(1) })).ok).toBe(true)
    expect(await spend(s, 'acme/refunds/o-1/retry', { refunds: u(1) })).toMatchObject({ status: 402 })
    expect((await spend(s, 'acme/refunds/o-2', { refunds: u(1) })).ok).toBe(true)
    expect((await spend(s, 'acme/refunds', { refunds: u(5) })).ok).toBe(true)
  })

  it('resets windowed usage at the boundary', async () => {
    const s = await tenant()
    await rawLimit(s, 'a', 'calls', u(1), 'day')
    await setNow(s, Date.UTC(2026, 8, 24, 23, 59))
    expect((await spend(s, 'a', { calls: u(1) })).ok).toBe(true)
    expect(await spend(s, 'a', { calls: u(1) })).toMatchObject({ status: 402, detail: { resets: '2026-09-25T00:00:00.000Z' } })
    await setNow(s, Date.UTC(2026, 8, 25, 0, 0))
    expect((await spend(s, 'a', { calls: u(1) })).ok).toBe(true)
  })

  it('warns once usage crosses warn_at, and not before', async () => {
    const s = await tenant()
    await rawLimit(s, 'a', 'usd', u(10), null, 'closed', 0.8)
    const r1 = await spend(s, 'a', { usd: u(7) })
    expect(r1.ok && r1.value.warnings).toEqual([])
    const r2 = await spend(s, 'a/x', { usd: u(1) })
    expect(r2.ok && r2.value.warnings).toEqual([{ scope: 'a', unit: 'usd', used: 8, limit: 10 }])
  })

  it('lets exactly L of N concurrent spends through', async () => {
    const s = await tenant()
    await rawLimit(s, 'a', 'calls', u(10))
    const rs = await Promise.all(Array.from({ length: 40 }, () => spend(s, 'a/b', { calls: u(1) })))
    expect(rs.filter((r) => r.ok)).toHaveLength(10)
    expect(rs.filter((r) => !r.ok && r.status === 402)).toHaveLength(30)
  })

  it('stops a free tenant at the monthly plan allowance, and never a pro one', async () => {
    const s = await tenant('free')
    await spend(s, 'a', { calls: u(1) })
    await setBillable(s, 100_000)
    expect(await spend(s, 'a', { calls: u(1) })).toMatchObject({ status: 402, detail: { scope: '', unit: 'spends', limit: 100_000 } })
    const pro = await tenant('pro')
    await spend(pro, 'a', { calls: u(1) })
    await setBillable(pro, 100_000)
    expect((await spend(pro, 'a', { calls: u(1) })).ok).toBe(true)
  })

  it('refuses every call to an uninitialised tenant', async () => {
    const stub = env.TENANT.get(env.TENANT.idFromName(crypto.randomUUID()))
    expect(await spend(stub, 'a', { calls: u(1) })).toMatchObject({ status: 401, error: 'invalid_key' })
  })
})
```

- [ ] **Step 3: Run to confirm they fail**

Run: `pnpm --filter @solenoid/worker test -- tenant-spend`
Expected: FAIL, because `spend` does not exist.

- [ ] **Step 4: Implement**

`worker/src/auth.ts`:
```ts
export type Auth = { kind: 'admin' | 'spend' | 'internal'; gen: number; epoch: number; keyScope: string }
export const INTERNAL: Auth = { kind: 'internal', gen: 0, epoch: 0, keyScope: '' }
```

`worker/src/tenant.ts`:
```ts
import { DurableObject } from 'cloudflare:workers'
import type { Auth } from './auth'
import { GENESIS, entryHash, importSigningKey, signHash, type Kind, type Sealed } from './chain'
import { fail, ok, type Fail, type Result } from './errors'
import { fromMicro } from './amounts'
import { ancestors, childOn, lastSegment, parentOf, within } from './scope'
import { nextReset, perChild, windowStart, type Per } from './windows'

export const FREE_SPENDS = 100_000

export type Receipt = Sealed & { id: string; replay: boolean }
export type Remaining = Record<string, { scope: string; left: number; resets: string | null }>
export type Warning = { scope: string; unit: string; used: number; limit: number }
export type SpendOk = { receipt: Receipt; remaining: Remaining; on_outage: 'open' | 'closed'; warnings: Warning[] }

type LimitRow = { scope: string; unit: string; amount: number; per: Per; on_outage: 'open' | 'closed'; warn_at: number | null }
type EntryRow = { seq: number; kind: Kind; scope: string; body: string; at: string; kid: string; idem: string | null; body_hash: string | null; prev: string; hash: string; sig: string }
type Check = { limitScope: string; unit: string; counterScope: string; per: Per; amount: number; onOutage: 'open' | 'closed'; warnAt: number | null; windowStart: number; used: number }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS limits (scope TEXT NOT NULL, unit TEXT NOT NULL, amount INTEGER NOT NULL, per TEXT, on_outage TEXT NOT NULL, warn_at REAL, PRIMARY KEY (scope, unit)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS counters (limit_scope TEXT NOT NULL, unit TEXT NOT NULL, scope TEXT NOT NULL, window_start INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY (limit_scope, unit, scope)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS entries (seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, scope TEXT NOT NULL, body TEXT NOT NULL, at TEXT NOT NULL, kid TEXT NOT NULL, idem TEXT, body_hash TEXT, prev TEXT NOT NULL, hash TEXT NOT NULL, sig TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS entries_idem ON entries (idem) WHERE idem IS NOT NULL;
CREATE TABLE IF NOT EXISTS scopes (parent TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (parent, name)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS epochs (scope TEXT PRIMARY KEY, epoch INTEGER NOT NULL) WITHOUT ROWID;
`

const iso = (t: number | null): string | null => (t === null ? null : new Date(t).toISOString())

const toReceipt = (r: EntryRow, replay: boolean): Receipt => ({
  id: `rcp_${r.seq}`, seq: r.seq, kind: r.kind, scope: r.scope, body: JSON.parse(r.body), at: r.at, kid: r.kid, prev: r.prev, hash: r.hash, sig: r.sig, replay,
})

export class TenantDO extends DurableObject<Cloudflare.Env> {
  now: () => number = () => Date.now()
  #sql: SqlStorage
  #head: { seq: number; hash: string }
  #lock: Promise<unknown> = Promise.resolve()
  #signingKey: Promise<CryptoKey> | undefined

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    this.#sql = ctx.storage.sql
    this.#sql.exec(SCHEMA)
    this.#head = this.#sql.exec<{ seq: number; hash: string }>('SELECT seq, hash FROM entries ORDER BY seq DESC LIMIT 1').toArray()[0] ?? { seq: 0, hash: GENESIS }
  }

  async init(tenant: string, plan: 'free' | 'pro' | 'internal'): Promise<boolean> {
    if (this.#meta('tenant')) return false
    this.#setMeta('tenant', tenant)
    this.#setMeta('gen', '1')
    this.#setMeta('plan', plan)
    return true
  }

  spend(auth: Auth, scope: string, amounts: Record<string, number>, idem: string, bodyHash: string): Promise<Result<SpendOk>> {
    return this.#serial(async () => {
      const denied = this.#authorize(auth, scope, 'spend')
      if (denied) return denied
      const now = this.now()
      const prior = this.#sql.exec<EntryRow>('SELECT * FROM entries WHERE idem = ?', idem).toArray()[0]
      if (prior) {
        if (prior.scope !== scope || prior.body_hash !== bodyHash) return fail(409, 'idempotency_conflict')
        return ok(this.#reply(prior, Object.keys(amounts), now, true))
      }
      this.#rollMonth(now)
      const planDenied = this.#checkPlan(now)
      if (planDenied) return planDenied
      const checks = this.#applicable(scope, Object.keys(amounts), now)
      for (const c of checks) {
        if (c.used + amounts[c.unit] > c.amount) {
          return fail(402, 'limit_exceeded', { scope: c.limitScope, unit: c.unit, limit: fromMicro(c.amount), used: fromMicro(c.used), requested: fromMicro(amounts[c.unit]), resets: iso(nextReset(c.per, now)) })
        }
      }
      const body = Object.fromEntries(Object.entries(amounts).map(([u, v]) => [u, fromMicro(v)]))
      const row = await this.#seal('spend', scope, body, now, idem, bodyHash)
      this.ctx.storage.transactionSync(() => {
        for (const c of checks) this.#setCounter(c, c.used + amounts[c.unit])
        this.#touchScopes(scope)
        this.#writeEntry(row)
      })
      this.#head = { seq: row.seq, hash: row.hash }
      return ok(this.#reply(row, Object.keys(amounts), now, false))
    })
  }

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#lock.then(fn, fn)
    this.#lock = run.catch(() => undefined)
    return run
  }

  #meta(k: string): string | undefined {
    return this.#sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0]?.v
  }

  #setMeta(k: string, v: string): void {
    this.#sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', k, v)
  }

  #epochOf(scope: string): number {
    return this.#sql.exec<{ epoch: number }>('SELECT epoch FROM epochs WHERE scope = ?', scope).toArray()[0]?.epoch ?? 0
  }

  #authorize(auth: Auth, scope: string, need: 'spend' | 'read' | 'admin'): Fail | null {
    if (!this.#meta('tenant')) return fail(401, 'invalid_key')
    if (auth.kind === 'internal') return null
    if (String(auth.gen) !== this.#meta('gen')) return fail(401, 'invalid_key')
    if (auth.kind === 'admin') return null
    if (need === 'admin') return fail(403, 'admin_required')
    if (auth.epoch !== this.#epochOf(auth.keyScope)) return fail(401, 'invalid_key')
    if (!within(scope, auth.keyScope)) return fail(403, 'out_of_scope', { scope, key_scope: auth.keyScope })
    return null
  }

  #rollMonth(now: number): void {
    const month = new Date(now).toISOString().slice(0, 7)
    if (this.#meta('month') === month) return
    this.#setMeta('month', month)
    this.#setMeta('seq_month_start', String(this.#head.seq))
    this.#setMeta('nonspend_month', '0')
  }

  #bumpNonspend(): void {
    this.#setMeta('nonspend_month', String(Number(this.#meta('nonspend_month')) + 1))
  }

  #checkPlan(now: number): Fail | null {
    if (this.#meta('plan') !== 'free') return null
    const used = this.#head.seq - Number(this.#meta('seq_month_start')) - Number(this.#meta('nonspend_month'))
    if (used < FREE_SPENDS) return null
    return fail(402, 'limit_exceeded', { scope: '', unit: 'spends', limit: FREE_SPENDS, used, requested: 1, resets: iso(nextReset('month', now)) })
  }

  #applicable(scope: string, units: string[] | null, now: number): Check[] {
    const anc = ancestors(scope)
    const rows = this.#sql.exec<LimitRow>(`SELECT * FROM limits WHERE scope IN (${anc.map(() => '?').join(',')})`, ...anc).toArray()
    const out: Check[] = []
    for (const lim of rows) {
      if (units && !units.includes(lim.unit)) continue
      const counterScope = perChild(lim.per) ? childOn(lim.scope, scope) : lim.scope
      if (counterScope === null) continue
      const ws = windowStart(lim.per, now)
      const c = this.#sql.exec<{ window_start: number; used: number }>(
        'SELECT window_start, used FROM counters WHERE limit_scope = ? AND unit = ? AND scope = ?', lim.scope, lim.unit, counterScope,
      ).toArray()[0]
      out.push({ limitScope: lim.scope, unit: lim.unit, counterScope, per: lim.per, amount: lim.amount, onOutage: lim.on_outage, warnAt: lim.warn_at, windowStart: ws, used: c && c.window_start === ws ? c.used : 0 })
    }
    return out
  }

  #setCounter(c: Check, used: number): void {
    this.#sql.exec(
      'INSERT INTO counters (limit_scope, unit, scope, window_start, used) VALUES (?, ?, ?, ?, ?) ON CONFLICT (limit_scope, unit, scope) DO UPDATE SET window_start = excluded.window_start, used = excluded.used',
      c.limitScope, c.unit, c.counterScope, c.windowStart, used,
    )
  }

  #reply(row: EntryRow, units: string[], now: number, replay: boolean): SpendOk {
    const checks = this.#applicable(row.scope, units, now)
    const best: Record<string, Check & { left: number }> = {}
    for (const c of checks) {
      const left = c.amount - c.used
      if (!best[c.unit] || left < best[c.unit].left) best[c.unit] = { ...c, left }
    }
    return {
      receipt: toReceipt(row, replay),
      remaining: Object.fromEntries(Object.values(best).map((b) => [b.unit, { scope: b.limitScope, left: fromMicro(b.left), resets: iso(nextReset(b.per, now)) }])),
      on_outage: checks.length > 0 && checks.every((c) => c.onOutage === 'open') ? 'open' : 'closed',
      warnings: checks.filter((c) => c.warnAt !== null && c.used >= c.warnAt * c.amount).map((c) => ({ scope: c.limitScope, unit: c.unit, used: fromMicro(c.used), limit: fromMicro(c.amount) })),
    }
  }

  async #seal(kind: Kind, scope: string, body: Record<string, any>, now: number, idem: string | null, bodyHash: string | null): Promise<EntryRow> {
    const e = { seq: this.#head.seq + 1, kind, scope, body, at: new Date(now).toISOString(), kid: this.env.SIGNING_KID }
    const hash = await entryHash(this.#head.hash, e)
    this.#signingKey ??= importSigningKey(this.env.SIGNING_KEY)
    const sig = await signHash(await this.#signingKey, hash)
    return { ...e, body: JSON.stringify(body), idem, body_hash: bodyHash, prev: this.#head.hash, hash, sig }
  }

  #writeEntry(r: EntryRow): void {
    this.#sql.exec(
      'INSERT INTO entries (seq, kind, scope, body, at, kid, idem, body_hash, prev, hash, sig) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      r.seq, r.kind, r.scope, r.body, r.at, r.kid, r.idem, r.body_hash, r.prev, r.hash, r.sig,
    )
  }

  #touchScopes(scope: string): void {
    for (const s of ancestors(scope)) if (s !== '') this.#sql.exec('INSERT OR IGNORE INTO scopes (parent, name) VALUES (?, ?)', parentOf(s), lastSegment(s))
  }
}
```

`#reply` reads state *after* the write, so `remaining` and `warnings` reflect the spend just made. A replay reports current state, as the spec says.

- [ ] **Step 5: Run, then prove the lock guards an I/O yield**

Run: `pnpm --filter @solenoid/worker test && pnpm --filter @solenoid/worker typecheck`
Expected: PASS, and no type errors.

Then temporarily add `await scheduler.wait(1)` as the first line of `#seal` **and** change `#serial` to `return fn()`. Re-run `tenant-spend`. The concurrency test must FAIL with more than 10 successes. Next, restore `#serial` but keep the `scheduler.wait`: it must PASS. Remove the `scheduler.wait`. (WebCrypto alone does not yield in workerd, so without the injected wait both versions pass; the lock exists for the first real I/O await.)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Spend against ancestor limits in one serialized transaction

The lock is not load-bearing while the critical section only awaits
WebCrypto, which does not open the input gate. It is there for the first
I/O await, and the check injects one to prove the lock holds."
```

---

### Task 5: Idempotency and settle

**Files:**
- Modify: `worker/src/tenant.ts` (add `settle`)
- Test: `worker/test/tenant-idempotency.test.ts`, `worker/test/tenant-settle.test.ts`

**Interfaces:**
- Produces: `TenantDO.settle(auth: Auth, scope: string, idem: string, actual: Record<string, number>, bodyHash: string): Promise<Result<SpendOk>>`. `actual` is in non-negative micro-units, and `idem` is the original spend's key.

- [ ] **Step 1: Write the failing tests**

`worker/test/tenant-idempotency.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { ADMIN, rawLimit, tenant, u } from './helpers'
import type { Auth } from '../src/auth'

describe('idempotency', () => {
  it('replays the original receipt without spending again', async () => {
    const s = await tenant()
    await rawLimit(s, 'a', 'calls', u(1))
    const first = await s.spend(ADMIN, 'a', { calls: u(1) }, 'key-1', 'h1')
    const again = await s.spend(ADMIN, 'a', { calls: u(1) }, 'key-1', 'h1')
    if (!first.ok || !again.ok) throw new Error('expected ok')
    expect(again.value.receipt).toEqual({ ...first.value.receipt, replay: true })
    expect(again.value.remaining.calls.left).toBe(0)
  })
  it('refuses the same key with a different body', async () => {
    const s = await tenant()
    await s.spend(ADMIN, 'a', { calls: u(1) }, 'key-1', 'h1')
    expect(await s.spend(ADMIN, 'a', { calls: u(2) }, 'key-1', 'h2')).toMatchObject({ ok: false, status: 409, error: 'idempotency_conflict' })
  })
  it('refuses the same key at another scope, so no limit is bypassed and no receipt leaks', async () => {
    const s = await tenant()
    await rawLimit(s, 'b', 'emails', 0)
    await s.spend(ADMIN, 'a/x', { emails: u(1) }, 'order-7', 'H')
    expect(await s.spend(ADMIN, 'b/y', { emails: u(1) }, 'order-7', 'H')).toMatchObject({ status: 409 })
    const confined: Auth = { kind: 'spend', gen: 1, epoch: 0, keyScope: 'b' }
    const r = await s.spend(confined, 'b/y', { emails: u(1) }, 'order-7', 'H')
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain('a/x')
  })
  it('replays even when the limit has since run out', async () => {
    const s = await tenant()
    await rawLimit(s, 'a', 'calls', u(1))
    await s.spend(ADMIN, 'a', { calls: u(1) }, 'key-1', 'h1')
    expect((await s.spend(ADMIN, 'a', { calls: u(1) }, 'key-1', 'h1')).ok).toBe(true)
  })
})
```

`worker/test/tenant-settle.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { ADMIN, rawLimit, setBillable, setNow, spend, tenant, u } from './helpers'

describe('settle', () => {
  it('moves usage from the held amount to the actual amount', async () => {
    const s = await tenant()
    await rawLimit(s, 'a', 'usd', u(10))
    await s.spend(ADMIN, 'a/r', { usd: u(6) }, 'k1', 'h1')
    const r = await s.settle(ADMIN, 'a/r', 'k1', { usd: u(2) }, 's1')
    if (!r.ok) throw new Error(r.error)
    expect(r.value.remaining.usd.left).toBe(8)
    expect(r.value.receipt).toMatchObject({ kind: 'settle', scope: 'a/r', body: { ref: 1, held: { usd: 6 }, actual: { usd: 2 } } })
  })

  it('releases a hold when settled to zero, and records usage past the limit', async () => {
    const s = await tenant()
    await rawLimit(s, 'a', 'usd', u(10))
    await s.spend(ADMIN, 'a', { usd: u(9) }, 'k1', 'h1')
    await s.settle(ADMIN, 'a', 'k1', { usd: 0 }, 's1')
    await s.spend(ADMIN, 'a', { usd: u(5) }, 'k2', 'h2')
    const over = await s.settle(ADMIN, 'a', 'k2', { usd: u(12) }, 's2')
    expect(over.ok && over.value.remaining.usd.left).toBe(-2)
    expect(await spend(s, 'a', { usd: u(0.01) })).toMatchObject({ status: 402 })
  })

  it('replays a repeated settle and refuses a different one', async () => {
    const s = await tenant()
    await s.spend(ADMIN, 'a', { usd: u(3) }, 'k1', 'h1')
    const first = await s.settle(ADMIN, 'a', 'k1', { usd: u(1) }, 's1')
    const again = await s.settle(ADMIN, 'a', 'k1', { usd: u(1) }, 's1')
    if (!first.ok || !again.ok) throw new Error('expected ok')
    expect(again.value.receipt).toEqual({ ...first.value.receipt, replay: true })
    expect(await s.settle(ADMIN, 'a', 'k1', { usd: u(2) }, 's2')).toMatchObject({ status: 409 })
  })

  it('404s an unknown key, and 409s a key held at another scope', async () => {
    const s = await tenant()
    expect(await s.settle(ADMIN, 'a', 'nope', { usd: 0 }, 's')).toMatchObject({ status: 404, error: 'unknown_spend' })
    await s.spend(ADMIN, 'a', { usd: u(1) }, 'k1', 'h1')
    expect(await s.settle(ADMIN, 'b', 'k1', { usd: 0 }, 's')).toMatchObject({ status: 409 })
  })

  it('leaves a counter alone once its window has rolled over', async () => {
    const s = await tenant()
    await rawLimit(s, 'a', 'usd', u(10), 'day')
    await setNow(s, Date.UTC(2026, 8, 24, 23, 59))
    await s.spend(ADMIN, 'a', { usd: u(5) }, 'k1', 'h1')
    await setNow(s, Date.UTC(2026, 8, 25, 0, 1))
    const r = await s.settle(ADMIN, 'a', 'k1', { usd: u(1) }, 's1')
    expect(r.ok && r.value.remaining.usd.left).toBe(10)
  })

  it('is not billed', async () => {
    const s = await tenant('free')
    await s.spend(ADMIN, 'a', { usd: u(1) }, 'k1', 'h1')
    await setBillable(s, 99_999)
    await s.settle(ADMIN, 'a', 'k1', { usd: u(1) }, 's1')
    expect((await spend(s, 'a', { usd: u(1) })).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm --filter @solenoid/worker test -- idempotency settle`
Expected: FAIL. The cross-scope test fails if the scope check is missing, and `settle` does not exist yet.

- [ ] **Step 3: Implement `settle`**

Add to `TenantDO`:
```ts
  settle(auth: Auth, scope: string, idem: string, actual: Record<string, number>, bodyHash: string): Promise<Result<SpendOk>> {
    return this.#serial(async () => {
      const denied = this.#authorize(auth, scope, 'spend')
      if (denied) return denied
      const now = this.now()
      const settleKey = `${idem}#settle`
      const done = this.#sql.exec<EntryRow>('SELECT * FROM entries WHERE idem = ?', settleKey).toArray()[0]
      if (done) {
        if (done.scope !== scope || done.body_hash !== bodyHash) return fail(409, 'idempotency_conflict')
        return ok(this.#reply(done, Object.keys(actual), now, true))
      }
      const held = this.#sql.exec<EntryRow>('SELECT * FROM entries WHERE idem = ?', idem).toArray()[0]
      if (!held || held.kind !== 'spend') return fail(404, 'unknown_spend')
      if (held.scope !== scope) return fail(409, 'idempotency_conflict')
      const heldUnits = JSON.parse(held.body) as Record<string, number>
      const units = [...new Set([...Object.keys(heldUnits), ...Object.keys(actual)])]
      const delta = Object.fromEntries(units.map((unit) => [unit, (actual[unit] ?? 0) - Math.round((heldUnits[unit] ?? 0) * 1_000_000)]))
      this.#rollMonth(now)
      const heldAt = Date.parse(held.at)
      const checks = this.#applicable(scope, units, now).filter((c) => c.windowStart === windowStart(c.per, heldAt))
      const body = { ref: held.seq, held: heldUnits, actual: Object.fromEntries(Object.entries(actual).map(([u, v]) => [u, fromMicro(v)])) }
      const row = await this.#seal('settle', scope, body, now, settleKey, bodyHash)
      this.ctx.storage.transactionSync(() => {
        for (const c of checks) this.#setCounter(c, c.used + delta[c.unit])
        this.#bumpNonspend()
        this.#writeEntry(row)
      })
      this.#head = { seq: row.seq, hash: row.hash }
      return ok(this.#reply(row, units, now, false))
    })
  }
```
A counter may go negative only if a limit was created after the hold without backfill. Backfill (Task 6) includes holds and settles, so that can't happen. Usage past a limit is kept, and `left` goes negative, as the second test pins.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @solenoid/worker test && pnpm --filter @solenoid/worker typecheck`
Expected: PASS. Then delete the `prior.scope !== scope ||` condition temporarily: the cross-scope test must fail. Restore it.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Bind idempotency keys to their scope, and settle holds

Reusing a key at another scope used to replay the first scope's receipt,
skipping the second scope's limits and leaking the receipt to a confined
key. A settle moves a hold's counters to the actual cost and is not
billed."
```

---

### Task 6: PUT limits, rotation, and GET

**Files:**
- Modify: `worker/src/tenant.ts` (add `put`, `get`, `#backfill`, `#view`)
- Modify: `worker/test/helpers.ts` (add `limit()`, delete `rawLimit`), plus the three earlier tenant test files (`rawLimit(` → `limit(`)
- Test: `worker/test/tenant-put-get.test.ts`

**Interfaces:**
- Produces:
  - `type PutReq = { limits: Record<string, number | null>; per: Per; onOutage: 'open' | 'closed'; warnAt: number | null; rotateKeys: boolean; rotateAdmin: boolean }`
  - `type LimitView = { scope: string; unit: string; limit: number; per: Per; on_outage: 'open' | 'closed'; warn_at: number | null; used: number | null; left: number | null; resets: string | null }` (`used` and `left` are `null` for a per-child limit viewed at the scope that owns it)
  - `type View = { scope: string; epoch: number; limits: LimitView[]; children: string[]; entries: Receipt[]; next: number | null }`
  - `TenantDO.put(auth, scope, req: PutReq): Promise<Result<View & { gen: number }>>`, `TenantDO.get(auth, scope, before?: number): Promise<Result<View>>`

- [ ] **Step 1: Replace the helper**

In `worker/test/helpers.ts`, delete `rawLimit` and add:
```ts
export async function limit(stub: Stub, scope: string, unit: string, amount: number | null, per: Per = null, onOutage: 'open' | 'closed' = 'closed', warnAt: number | null = null) {
  const r = await stub.put(ADMIN, scope, { limits: { [unit]: amount }, per, onOutage, warnAt, rotateKeys: false, rotateAdmin: false })
  if (!r.ok) throw new Error(`put failed: ${r.error}`)
  return r.value
}
```
Replace every `rawLimit(` with `limit(` in `tenant-spend.test.ts`, `tenant-idempotency.test.ts` and `tenant-settle.test.ts`. The argument order is unchanged.

- [ ] **Step 2: Write the failing tests**

`worker/test/tenant-put-get.test.ts`:
```ts
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { ADMIN, limit, setBillable, setNow, spend, sql, tenant, u, type Stub } from './helpers'
import { publicJwk, verifyChain, type Sealed } from '../src/chain'
import type { Auth } from '../src/auth'
import type { PutReq } from '../src/tenant'

const SPEND_KEY = (keyScope: string, epoch = 0): Auth => ({ kind: 'spend', gen: 1, epoch, keyScope })
const put = (o: Partial<PutReq>): PutReq => ({ limits: {}, per: null, onOutage: 'closed', warnAt: null, rotateKeys: false, rotateAdmin: false, ...o })

async function allEntries(s: Stub): Promise<Sealed[]> {
  const out: Sealed[] = []
  let before: number | undefined
  for (;;) {
    const g = await s.get(ADMIN, '', before)
    if (!g.ok) throw new Error(g.error)
    out.push(...g.value.entries)
    if (g.value.next === null) return out.reverse()
    before = g.value.next
  }
}

describe('put', () => {
  it('starts a new limit from the true usage of its window, holds and settles included', async () => {
    const s = await tenant()
    await setNow(s, Date.UTC(2026, 8, 24, 10))
    await spend(s, 'acme/a', { usd: u(3) })
    await s.spend(ADMIN, 'acme/b', { usd: u(6) }, 'hold', 'h')
    await s.settle(ADMIN, 'acme/b', 'hold', { usd: u(4) }, 's')
    await spend(s, 'other', { usd: u(50) })
    const v = await limit(s, 'acme', 'usd', u(10), 'day')
    expect(v.limits).toContainEqual(expect.objectContaining({ scope: 'acme', unit: 'usd', used: 7, left: 3 }))
    expect(await spend(s, 'acme/c', { usd: u(3.5) })).toMatchObject({ status: 402 })
  })

  it('backfills per-child usage for each child separately, and shows the limit at its own scope', async () => {
    const s = await tenant()
    await spend(s, 'r/o-1', { refunds: u(1) })
    const v = await limit(s, 'r', 'refunds', u(1), 'child')
    expect(v.limits).toEqual([expect.objectContaining({ scope: 'r', unit: 'refunds', limit: 1, per: 'child', used: null, left: null })])
    expect(await spend(s, 'r/o-1', { refunds: u(1) })).toMatchObject({ status: 402 })
    expect((await spend(s, 'r/o-2', { refunds: u(1) })).ok).toBe(true)
  })

  it('treats 0 as a kill switch and null as removal', async () => {
    const s = await tenant()
    await limit(s, 'bot', 'usd', 0)
    expect(await spend(s, 'bot/run', { usd: u(0.01) })).toMatchObject({ status: 402 })
    await limit(s, 'bot', 'usd', null)
    expect((await spend(s, 'bot/run', { usd: u(0.01) })).ok).toBe(true)
  })

  it('stores warn_at and reports it in views', async () => {
    const s = await tenant()
    const v = await limit(s, 'a', 'usd', u(10), null, 'closed', 0.8)
    expect(v.limits[0]).toMatchObject({ warn_at: 0.8 })
  })

  it('keeps a chain that verifies through a seeded random mix of operations, and fails on any tampered field', async () => {
    const s = await tenant()
    let seed = 42
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n)
    for (let i = 0; i < 60; i++) {
      const op = rnd(4)
      const scope = ['a', 'a/x', 'b', 'b/y/z'][rnd(4)]
      if (op === 0) await limit(s, scope, 'usd', u(rnd(100) + 50), (['day', null, 'child'] as const)[rnd(3)])
      else if (op === 1) await s.spend(ADMIN, scope, { usd: u(1) }, `k${i}`, `h${i}`).then(() => s.settle(ADMIN, scope, `k${i}`, { usd: u(0.5) }, `s${i}`))
      else if (op === 2) await s.put(ADMIN, scope, put({ rotateKeys: true }))
      else await spend(s, scope, { usd: u(0.25), calls: u(1) })
    }
    const jwk = publicJwk(env.SIGNING_KEY)
    expect(await verifyChain(await allEntries(s), jwk)).toBe(true)
    for (const col of ['body', 'scope', 'at', 'kind', 'kid', 'prev', 'hash', 'sig']) {
      const t = await tenant()
      await spend(t, 'a', { n: u(1) })
      await spend(t, 'a', { n: u(2) })
      await sql(t, `UPDATE entries SET ${col} = ? WHERE seq = 1`, col === 'body' ? '{"n":9}' : col === 'kind' ? 'limit' : 'x')
      expect(await verifyChain(await allEntries(t), jwk)).toBe(false)
    }
  })

  it('bumps the scope epoch on rotate_keys, and the generation on rotate_admin', async () => {
    const s = await tenant()
    const r = await s.put(ADMIN, 'a', put({ rotateKeys: true }))
    expect(r.ok && r.value.epoch).toBe(1)
    expect(await spend(s, 'a/x', { usd: u(1) }, SPEND_KEY('a', 0))).toMatchObject({ status: 401 })
    expect((await spend(s, 'a/x', { usd: u(1) }, SPEND_KEY('a', 1))).ok).toBe(true)
    const r2 = await s.put(ADMIN, '', put({ rotateAdmin: true }))
    expect(r2.ok && r2.value.gen).toBe(2)
    expect(await spend(s, 'a/x', { usd: u(1) })).toMatchObject({ status: 401 })
  })

  it('refuses rotate_admin below the root, the reserved unit, and spend keys', async () => {
    const s = await tenant()
    expect(await s.put(ADMIN, 'a', put({ rotateAdmin: true }))).toMatchObject({ status: 400 })
    expect(await s.put(ADMIN, '', put({ limits: { spends: u(1) } }))).toMatchObject({ status: 403, error: 'plan_owned' })
    expect(await s.put(SPEND_KEY(''), 'a', put({ limits: { usd: u(1) } }))).toMatchObject({ status: 403, error: 'admin_required' })
  })

  it('does not count limit changes as billable spends', async () => {
    const s = await tenant('free')
    await spend(s, 'a', { x: u(1) })
    await setBillable(s, 99_999)
    await limit(s, 'a', 'y', u(5))
    expect((await spend(s, 'a', { x: u(1) })).ok).toBe(true)
  })
})

describe('get', () => {
  it('shows every limit that applies at a scope, from its point of view', async () => {
    const s = await tenant()
    await limit(s, '', 'usd', u(100))
    await limit(s, 'acme', 'usd', u(10))
    await spend(s, 'acme/bot', { usd: u(2) })
    const g = await s.get(ADMIN, 'acme/bot')
    expect(g.ok && g.value.limits.map((l) => [l.scope, l.left])).toEqual(expect.arrayContaining([['', 98], ['acme', 8]]))
  })

  it('lists direct children and pages entries newest first', async () => {
    const s = await tenant()
    for (let i = 0; i < 55; i++) await spend(s, `acme/run-${i % 3}/x`, { n: u(1) })
    await spend(s, 'acme2', { n: u(1) })
    const g = await s.get(ADMIN, 'acme')
    if (!g.ok) throw new Error(g.error)
    expect(g.value.children).toEqual(['run-0', 'run-1', 'run-2'])
    expect(g.value.entries).toHaveLength(50)
    expect(g.value.entries.every((e) => e.scope.startsWith('acme/'))).toBe(true)
    const g2 = await s.get(ADMIN, 'acme', g.value.next!)
    expect(g2.ok && g2.value.entries).toHaveLength(5)
    expect(g2.ok && g2.value.next).toBeNull()
  })

  it('confines a spend key to its subtree', async () => {
    const s = await tenant()
    expect((await s.get(SPEND_KEY('acme'), 'acme/bot')).ok).toBe(true)
    expect(await s.get(SPEND_KEY('acme'), 'other')).toMatchObject({ status: 403, error: 'out_of_scope' })
    expect(await spend(s, 'acme2', { n: u(1) }, SPEND_KEY('acme'))).toMatchObject({ status: 403 })
  })
})
```

- [ ] **Step 3: Run to confirm they fail**

Run: `pnpm --filter @solenoid/worker test`
Expected: FAIL, because `put` and `get` do not exist.

- [ ] **Step 4: Implement**

Add at module level in `worker/src/tenant.ts`:
```ts
export type PutReq = { limits: Record<string, number | null>; per: Per; onOutage: 'open' | 'closed'; warnAt: number | null; rotateKeys: boolean; rotateAdmin: boolean }
export type LimitView = { scope: string; unit: string; limit: number; per: Per; on_outage: 'open' | 'closed'; warn_at: number | null; used: number | null; left: number | null; resets: string | null }
export type View = { scope: string; epoch: number; limits: LimitView[]; children: string[]; entries: Receipt[]; next: number | null }

const PAGE = 50
const UNDER = `(? = '' OR scope = ? OR substr(scope, 1, ?) = ?)`
const under = (scope: string) => [scope, scope, scope.length + 1, `${scope}/`]
```

Add to `TenantDO`:
```ts
  put(auth: Auth, scope: string, req: PutReq): Promise<Result<View & { gen: number }>> {
    return this.#serial(async () => {
      const denied = this.#authorize(auth, scope, 'admin')
      if (denied) return denied
      if (req.rotateAdmin && scope !== '') return fail(400, 'invalid_limit', { reason: 'rotate_admin is only allowed on the root scope' })
      if ('spends' in req.limits) return fail(403, 'plan_owned')
      const now = this.now()
      this.#rollMonth(now)
      const fills = Object.entries(req.limits).filter(([, v]) => v !== null).map(([unit]) => ({ unit, ...this.#backfill(scope, unit, req.per, now) }))
      const body = {
        limits: Object.fromEntries(Object.entries(req.limits).map(([k, v]) => [k, v === null ? null : fromMicro(v)])),
        per: req.per, on_outage: req.onOutage, warn_at: req.warnAt ?? undefined,
        rotate_keys: req.rotateKeys || undefined, rotate_admin: req.rotateAdmin || undefined,
      }
      const row = await this.#seal(req.rotateKeys || req.rotateAdmin ? 'rotate' : 'limit', scope, body, now, null, null)
      this.ctx.storage.transactionSync(() => {
        for (const [unit, v] of Object.entries(req.limits)) {
          this.#sql.exec('DELETE FROM counters WHERE limit_scope = ? AND unit = ?', scope, unit)
          if (v === null) this.#sql.exec('DELETE FROM limits WHERE scope = ? AND unit = ?', scope, unit)
          else this.#sql.exec(
            'INSERT INTO limits (scope, unit, amount, per, on_outage, warn_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (scope, unit) DO UPDATE SET amount = excluded.amount, per = excluded.per, on_outage = excluded.on_outage, warn_at = excluded.warn_at',
            scope, unit, v, req.per, req.onOutage, req.warnAt,
          )
        }
        for (const f of fills) for (const [counterScope, used] of f.sums) {
          this.#sql.exec('INSERT INTO counters (limit_scope, unit, scope, window_start, used) VALUES (?, ?, ?, ?, ?)', scope, f.unit, counterScope, f.windowStart, used)
        }
        if (req.rotateKeys) this.#sql.exec('INSERT INTO epochs (scope, epoch) VALUES (?, 1) ON CONFLICT (scope) DO UPDATE SET epoch = epoch + 1', scope)
        if (req.rotateAdmin) this.#setMeta('gen', String(Number(this.#meta('gen')) + 1))
        this.#bumpNonspend()
        this.#touchScopes(scope)
        this.#writeEntry(row)
      })
      this.#head = { seq: row.seq, hash: row.hash }
      return ok({ ...this.#view(scope, now, undefined), gen: Number(this.#meta('gen')) })
    })
  }

  async get(auth: Auth, scope: string, before?: number): Promise<Result<View>> {
    const denied = this.#authorize(auth, scope, 'read')
    if (denied) return denied
    return ok(this.#view(scope, this.now(), before))
  }

  #backfill(scope: string, unit: string, per: Per, now: number): { windowStart: number; sums: Map<string, number> } {
    const ws = windowStart(per, now)
    const rows = this.#sql.exec<{ kind: Kind; scope: string; body: string }>(
      `SELECT kind, scope, body FROM entries WHERE kind IN ('spend', 'settle') AND at >= ? AND ${UNDER}`, new Date(ws).toISOString(), ...under(scope),
    ).toArray()
    const sums = new Map<string, number>()
    for (const r of rows) {
      const b = JSON.parse(r.body)
      const v = r.kind === 'spend' ? (b[unit] ?? 0) : (b.actual[unit] ?? 0) - (b.held[unit] ?? 0)
      const counterScope = perChild(per) ? childOn(scope, r.scope) : scope
      if (v === 0 || counterScope === null) continue
      sums.set(counterScope, (sums.get(counterScope) ?? 0) + Math.round(v * 1_000_000))
    }
    return { windowStart: ws, sums }
  }

  #view(scope: string, now: number, before: number | undefined): View {
    const applied: LimitView[] = this.#applicable(scope, null, now).map((c) => ({
      scope: c.limitScope, unit: c.unit, limit: fromMicro(c.amount), per: c.per, on_outage: c.onOutage, warn_at: c.warnAt,
      used: fromMicro(c.used), left: fromMicro(c.amount - c.used), resets: iso(nextReset(c.per, now)),
    }))
    const own: LimitView[] = this.#sql.exec<LimitRow>("SELECT * FROM limits WHERE scope = ? AND per IN ('child', 'child-day')", scope).toArray().map((l) => ({
      scope: l.scope, unit: l.unit, limit: fromMicro(l.amount), per: l.per, on_outage: l.on_outage, warn_at: l.warn_at, used: null, left: null, resets: null,
    }))
    const children = this.#sql.exec<{ name: string }>('SELECT name FROM scopes WHERE parent = ? ORDER BY name', scope).toArray().map((r) => r.name)
    const rows = this.#sql.exec<EntryRow>(
      `SELECT * FROM entries WHERE seq < ? AND ${UNDER} ORDER BY seq DESC LIMIT ?`, before ?? Number.MAX_SAFE_INTEGER, ...under(scope), PAGE + 1,
    ).toArray()
    const page = rows.slice(0, PAGE)
    return { scope, epoch: this.#epochOf(scope), limits: [...applied, ...own], children, entries: page.map((r) => toReceipt(r, false)), next: rows.length > PAGE ? page[PAGE - 1].seq : null }
  }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @solenoid/worker test && pnpm --filter @solenoid/worker typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Set limits, rotate keys, and read a scope

A new limit starts from the usage the chain already records for its
window, holds and settles included. Summing entries is rows read, a
thousandth the price of keeping counters for limits that do not exist."
```

---

### Task 23: Pre-commit hooks with lefthook (runs after Task 6)

Added 2026-09-24 at Robin's request, like the old repository's `lefthook.yml`. It is numbered 23 because it was added mid-execution, but it runs right after Task 6, so every later commit goes through the hooks.

**Files:**
- Create: `lefthook.yml`
- Modify: `package.json` (devDependency `lefthook`, `"prepare": "lefthook install"`), `pnpm-workspace.yaml` (`allowBuilds: lefthook: true`), and `worker/package.json` (a `test:changed` script). Packages created later (`sdk`, `cli`, `e2e`) add the same script when they are created.

- [ ] **Step 1: Configure**

`lefthook.yml`:
```yaml
pre-commit:
  parallel: true
  commands:
    typecheck:
      run: pnpm -r --if-present run typecheck
    test-affected:
      run: pnpm -r --if-present run test:changed
```
`worker/package.json` gets `"test:changed": "vitest run --changed --passWithNoTests"`.

- [ ] **Step 2: Prove it bites.** Run `pnpm install`, then confirm that `.git/hooks/pre-commit` exists. Stage a deliberate type error in `worker/src/scope.ts`: `git commit` must fail. Then stage a deliberately failing assertion in `worker/test/scope.test.ts`: `git commit` must fail. Revert both. Commit signing stays on; a hook failure is not a signing failure.

- [ ] **Step 3: Commit** `Run typecheck and affected tests before every commit`.

---

### Task 7: Keys and the HTTP layer

**Files:**
- Create: `worker/src/keys.ts`, `worker/src/http.ts`
- Modify: `worker/src/index.ts`
- Delete: `worker/test/smoke.test.ts`
- Test: `worker/test/keys.test.ts`, `worker/test/http.test.ts`

**Interfaces:**
- Produces:
  - `keys.ts`: `hmacHex(key, msg)`, `adminKey(master, tenant, gen)`, `spendKey(adminKeyStr, scope, epoch)`, `verifyKey(header, master): Promise<{ tenant: string; auth: Auth }>`, `TENANT_RE`
  - `http.ts`: `parseJson(text: string, code: string): unknown`, `parsePut(body: unknown): PutReq`
  - Routes: `GET /.well-known/solenoid.json`; `POST /v1/{scope}` (spend, or settle when the body is `{ "settle": {...} }`); `PUT` and `GET /v1/{scope}`

- [ ] **Step 1: Write the failing tests**

`worker/test/keys.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { adminKey, spendKey, verifyKey } from '../src/keys'

const M = 'test-master-secret'
const T = 'abcdefghijkl'

describe('keys', () => {
  it('verifies an admin key it minted', async () => {
    const k = await adminKey(M, T, 1)
    expect(k).toMatch(/^sk\.admin\.abcdefghijkl\.1\.[0-9a-f]{64}$/)
    expect(await verifyKey(`Bearer ${k}`, M)).toEqual({ tenant: T, auth: { kind: 'admin', gen: 1, epoch: 0, keyScope: '' } })
  })
  it('verifies spend keys derived offline, including the root scope', async () => {
    const a = await adminKey(M, T, 1)
    expect((await verifyKey(`Bearer ${await spendKey(a, 'acme/bot', 2)}`, M)).auth).toEqual({ kind: 'spend', gen: 1, epoch: 2, keyScope: 'acme/bot' })
    expect((await verifyKey(`Bearer ${await spendKey(a, '', 0)}`, M)).auth.keyScope).toBe('')
  })
  it('rejects forged, mangled and cross-tenant keys', async () => {
    const a = await adminKey(M, T, 1)
    const s = await spendKey(a, 'acme', 0)
    const bad = [
      null, 'Basic x', `Bearer ${a}x`, `Bearer ${a.replace('.1.', '.2.')}`,
      `Bearer ${s.replace(/[0-9a-f]$/, (c) => (c === '0' ? '1' : '0'))}`,
      `Bearer ${s.replace(btoa('acme').replace(/=+$/, ''), btoa('other').replace(/=+$/, ''))}`,
      `Bearer ${await adminKey('other-master', T, 1)}`,
      `Bearer ${(await adminKey(M, 'mnopqrstuvwx', 1)).replace('mnopqrstuvwx', T)}`,
      `Bearer ${a.replace('.1.', '.01.')}`,
    ]
    for (const h of bad) await expect(verifyKey(h, M)).rejects.toMatchObject({ status: 401, code: 'invalid_key' })
  })
})
```

`worker/test/http.test.ts`:
```ts
import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { adminKey, spendKey } from '../src/keys'

type Json = Record<string, any>
async function newTenant(): Promise<string> {
  const tenant = Array.from({ length: 12 }, () => 'abcdefghijklmnopqrstuvwxyz234567'[Math.floor(Math.random() * 32)]).join('')
  await env.TENANT.get(env.TENANT.idFromName(tenant)).init(tenant, 'free')
  return adminKey(env.MASTER, tenant, 1)
}
const call = (method: string, path: string, key: string | null, body?: unknown, idem?: string) =>
  SELF.fetch(`https://api.test${path}`, {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(idem ? { 'idempotency-key': idem } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
const body = async (r: Response) => (await r.json()) as Json

describe('http', () => {
  it('spends, limits and reads through the API', async () => {
    const admin = await newTenant()
    expect((await call('PUT', '/v1/acme', admin, { usd: 1, per: 'day', on_outage: 'open', warn_at: 0.5 })).status).toBe(200)
    const agent = await spendKey(admin, 'acme/bot', 0)
    const ok = await call('POST', '/v1/acme/bot/run-1', agent, { usd: 0.75 }, 'i1')
    expect(ok.status).toBe(200)
    expect(await body(ok)).toMatchObject({ remaining: { usd: { scope: 'acme', left: 0.25 } }, on_outage: 'open', warnings: [{ scope: 'acme', unit: 'usd' }] })
    const blocked = await call('POST', '/v1/acme/bot/run-2', agent, { usd: 0.5 }, 'i2')
    expect(blocked.status).toBe(402)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await body(blocked)).toMatchObject({ error: 'limit_exceeded', scope: 'acme', unit: 'usd' })
    expect((await call('GET', '/v1/acme', agent)).status).toBe(403)
    expect((await call('GET', '/v1/acme/bot', agent)).status).toBe(200)
  })

  it('holds and settles over HTTP with one idempotency key', async () => {
    const admin = await newTenant()
    await call('PUT', '/v1/a', admin, { tokens: 1000 })
    await call('POST', '/v1/a', admin, { tokens: 900 }, 'llm-1')
    const settled = await call('POST', '/v1/a', admin, { settle: { tokens: 120 } }, 'llm-1')
    expect(await body(settled)).toMatchObject({ receipt: { kind: 'settle' }, remaining: { tokens: { left: 880 } } })
  })

  it('treats key order and whitespace as the same body, but another scope as a conflict', async () => {
    const admin = await newTenant()
    await call('POST', '/v1/a', admin, '{"x":1,"y":2}', 'same')
    expect((await body(await call('POST', '/v1/a', admin, '{ "y": 2, "x": 1 }', 'same'))).receipt.replay).toBe(true)
    expect((await call('POST', '/v1/b', admin, '{"x":1,"y":2}', 'same')).status).toBe(409)
  })

  it.each([
    ['POST', '/v1/a', { x: 1 }, undefined, 400, 'missing_idempotency_key'],
    ['POST', '/v1/a', { x: 1 }, 'has#hash', 400, 'invalid_idempotency_key'],
    ['POST', '/v1/A', { x: 1 }, 'k', 400, 'invalid_scope'],
    ['POST', '/v1/a', 'not json', 'k', 400, 'invalid_amount'],
    ['POST', '/v1/a', { settle: { x: 1 } }, 'never-held', 404, 'unknown_spend'],
    ['PUT', '/v1/a', 'not json', undefined, 400, 'invalid_limit'],
    ['PUT', '/v1/a', {}, undefined, 400, 'invalid_limit'],
    ['PUT', '/v1/a', { x: 1, per: 'fortnight' }, undefined, 400, 'invalid_limit'],
    ['PUT', '/v1/a', { x: 1, on_outage: 'maybe' }, undefined, 400, 'invalid_limit'],
    ['PUT', '/v1/a', { x: 1, warn_at: 1.5 }, undefined, 400, 'invalid_limit'],
    ['PUT', '/v1/a', { rotate_keys: 'yes' }, undefined, 400, 'invalid_limit'],
    ['GET', '/v1/a?before=abc', undefined, undefined, 400, 'invalid_before'],
    ['DELETE', '/v1/a', undefined, undefined, 405, 'method_not_allowed'],
  ])('%s %s %j → %i %s', async (method, path, b, idem, status, error) => {
    const res = await call(method, path, await newTenant(), b, idem)
    expect(res.status).toBe(status)
    expect((await body(res)).error).toBe(error)
  })

  it('refuses a missing key, and serves unknown paths as 404', async () => {
    expect((await call('GET', '/v1/', null)).status).toBe(401)
    expect((await call('GET', '/nope', null)).status).toBe(404)
  })

  it('returns a new admin key from rotate_admin, and the old one stops working', async () => {
    const admin = await newTenant()
    const { admin_key } = await body(await call('PUT', '/v1/', admin, { rotate_admin: true }))
    expect(admin_key).toMatch(/\.2\.[0-9a-f]{64}$/)
    expect((await call('GET', '/v1/', admin)).status).toBe(401)
    expect((await call('GET', '/v1/', admin_key)).status).toBe(200)
  })

  it('publishes the receipt-signing public key and nothing private', async () => {
    const { keys } = await body(await SELF.fetch('https://api.test/.well-known/solenoid.json'))
    expect(keys.k1).toEqual({ kty: 'OKP', crv: 'Ed25519', x: expect.any(String) })
  })
})
```

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm --filter @solenoid/worker test -- keys http`
Expected: FAIL.

- [ ] **Step 3: Implement keys**

`worker/src/keys.ts`:
```ts
import type { Auth } from './auth'
import { b64url, b64urlDecode, hex } from './chain'
import { ApiError } from './errors'
import { parseScope } from './scope'

export const TENANT_RE = /^[a-z2-7]{12}$/
const NUM = /^(0|[1-9][0-9]{0,8})$/
const enc = new TextEncoder()

export async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}

const adminSecret = (master: string, tenant: string, gen: number) => hmacHex(master, `admin:${tenant}:${gen}`)

export const adminKey = async (master: string, tenant: string, gen: number): Promise<string> =>
  `sk.admin.${tenant}.${gen}.${await adminSecret(master, tenant, gen)}`

export async function spendKey(adminKeyStr: string, scope: string, epoch: number): Promise<string> {
  const [, , tenant, gen, secret] = adminKeyStr.split('.')
  return `sk.spend.${tenant}.${gen}.${epoch}.${b64url(enc.encode(scope).buffer as ArrayBuffer)}.${await hmacHex(secret, `spend:${scope}:${epoch}`)}`
}

const same = (a: string, b: string): boolean => a.length === b.length && crypto.subtle.timingSafeEqual(enc.encode(a), enc.encode(b))

export async function verifyKey(header: string | null, master: string): Promise<{ tenant: string; auth: Auth }> {
  const bad = new ApiError(401, 'invalid_key')
  const m = header?.match(/^Bearer (sk\.\S+)$/)
  if (!m) throw bad
  const p = m[1].split('.')
  const [, kind, tenant, genS] = p
  if (!TENANT_RE.test(tenant ?? '') || !NUM.test(genS ?? '') || genS === '0') throw bad
  const gen = Number(genS)
  const secret = await adminSecret(master, tenant, gen)
  if (kind === 'admin' && p.length === 5) {
    if (!same(p[4], secret)) throw bad
    return { tenant, auth: { kind: 'admin', gen, epoch: 0, keyScope: '' } }
  }
  if (kind === 'spend' && p.length === 7) {
    const [, , , , epochS, scopeField, mac] = p
    if (!NUM.test(epochS)) throw bad
    let scope: string
    try { scope = parseScope(new TextDecoder().decode(b64urlDecode(scopeField))) } catch { throw bad }
    const epoch = Number(epochS)
    if (!same(mac, await hmacHex(secret, `spend:${scope}:${epoch}`))) throw bad
    return { tenant, auth: { kind: 'spend', gen, epoch, keyScope: scope } }
  }
  throw bad
}
```

- [ ] **Step 4: Implement parsing and routing**

`worker/src/http.ts`:
```ts
import { parseLimitValue, UNIT } from './amounts'
import { ApiError } from './errors'
import type { PutReq } from './tenant'
import { PERS, type Per } from './windows'

const CONTROL = new Set(['per', 'on_outage', 'warn_at', 'rotate_keys', 'rotate_admin'])

export function parseJson(text: string, code: string): unknown {
  try { return JSON.parse(text) } catch { throw new ApiError(400, code) }
}

export function parsePut(body: unknown): PutReq {
  const bad = (field?: string) => new ApiError(400, 'invalid_limit', field ? { field } : {})
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad()
  const b = body as Record<string, unknown>
  const per = (b.per ?? null) as Per
  if (per !== null && !PERS.includes(per)) throw bad('per')
  const onOutage = b.on_outage ?? 'closed'
  if (onOutage !== 'open' && onOutage !== 'closed') throw bad('on_outage')
  const warnAt = b.warn_at ?? null
  if (warnAt !== null && (typeof warnAt !== 'number' || !(warnAt > 0 && warnAt <= 1))) throw bad('warn_at')
  for (const f of ['rotate_keys', 'rotate_admin']) if (b[f] !== undefined && typeof b[f] !== 'boolean') throw bad(f)
  const limits: Record<string, number | null> = {}
  for (const [unit, v] of Object.entries(b)) {
    if (CONTROL.has(unit)) continue
    if (!UNIT.test(unit)) throw new ApiError(400, 'invalid_unit', { unit })
    try { limits[unit] = parseLimitValue(v) } catch { throw bad(unit) }
  }
  const rotateKeys = b.rotate_keys === true, rotateAdmin = b.rotate_admin === true
  if (Object.keys(limits).length === 0 && !rotateKeys && !rotateAdmin) throw bad()
  return { limits, per, onOutage, warnAt: warnAt as number | null, rotateKeys, rotateAdmin }
}
```

`worker/src/index.ts`:
```ts
import { parseSettle, parseSpend } from './amounts'
import { jcs, publicJwk, sha256hex } from './chain'
import { ApiError, failResponse, json, type Result } from './errors'
import { parseJson, parsePut } from './http'
import { adminKey, verifyKey } from './keys'
import { parseScope } from './scope'

export { TenantDO } from './tenant'

const IDEM = /^[\x21\x22\x24-\x7e]{1,255}$/
const SEQ = /^(0|[1-9][0-9]{0,15})$/

const respond = <T>(r: Result<T>, extra: Record<string, unknown> = {}): Response =>
  r.ok ? json(200, { ...(r.value as object), ...extra }) : failResponse(r)

async function route(req: Request, env: Cloudflare.Env): Promise<Response> {
  const url = new URL(req.url)
  if (req.method === 'GET' && url.pathname === '/.well-known/solenoid.json') {
    return json(200, { keys: { [env.SIGNING_KID]: publicJwk(env.SIGNING_KEY) } }, { 'cache-control': 'public, max-age=3600' })
  }
  if (url.pathname !== '/v1' && !url.pathname.startsWith('/v1/')) throw new ApiError(404, 'not_found')
  if (!['GET', 'POST', 'PUT'].includes(req.method)) throw new ApiError(405, 'method_not_allowed')
  const scope = parseScope(url.pathname.slice(4))
  const { tenant, auth } = await verifyKey(req.headers.get('authorization'), env.MASTER)
  const stub = env.TENANT.get(env.TENANT.idFromName(tenant))
  if (req.method === 'GET') {
    const before = url.searchParams.get('before')
    if (before !== null && !SEQ.test(before)) throw new ApiError(400, 'invalid_before')
    return respond(await stub.get(auth, scope, before === null ? undefined : Number(before)))
  }
  if (req.method === 'POST') {
    const idem = req.headers.get('idempotency-key')
    if (!idem) throw new ApiError(400, 'missing_idempotency_key')
    if (!IDEM.test(idem)) throw new ApiError(400, 'invalid_idempotency_key')
    const b = parseJson(await req.text(), 'invalid_amount')
    if (b && typeof b === 'object' && !Array.isArray(b) && 'settle' in b) {
      const actual = parseSettle((b as { settle: unknown }).settle)
      return respond(await stub.settle(auth, scope, idem, actual, await sha256hex(jcs({ scope, settle: actual }))))
    }
    const amounts = parseSpend(b)
    return respond(await stub.spend(auth, scope, amounts, idem, await sha256hex(jcs({ scope, amounts }))))
  }
  const put = parsePut(parseJson(await req.text(), 'invalid_limit'))
  const r = await stub.put(auth, scope, put)
  return respond(r, r.ok && put.rotateAdmin ? { admin_key: await adminKey(env.MASTER, tenant, r.value.gen) } : {})
}

export default {
  async fetch(req, env): Promise<Response> {
    try {
      return await route(req, env)
    } catch (e) {
      if (e instanceof ApiError) return json(e.status, { error: e.code, ...e.detail })
      console.error(e)
      return json(500, { error: 'internal' })
    }
  },
} satisfies ExportedHandler<Cloudflare.Env>
```

Delete `worker/test/smoke.test.ts`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @solenoid/worker test && pnpm --filter @solenoid/worker typecheck`
Expected: PASS, and no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Authenticate derived keys and serve the /v1 contract over HTTP

Spend keys are an HMAC of the admin secret over the scope and epoch, so
the Worker checks them with no lookup. The idempotency hash covers the
scope, so one key cannot replay across scopes."
```

---

### Task 8: Signup, rate-limited by Solenoid itself

**Files:**
- Modify: `worker/src/index.ts`
- Create: `worker/scripts/ops-key.mjs`
- Test: `worker/test/signup.test.ts`

**Interfaces:**
- Produces: `POST /auth/signup` → `201 { tenant, admin_key }` or `429 { error: 'rate_limited' }`. `ipKey(ip: string): string` (IPv4 unchanged; IPv6 reduced to its /64). `OPS_TENANT = 'solenoidops2'`.

- [ ] **Step 1: Write the failing test**

`worker/test/signup.test.ts`:
```ts
import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { adminKey } from '../src/keys'
import { ipKey } from '../src/index'

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
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @solenoid/worker test -- signup`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `worker/src/index.ts`, import `INTERNAL` from `./auth`, and add:
```ts
const OPS_TENANT = 'solenoidops2'
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
const randomTenant = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => B32[b & 31]).join('')

export function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const [head, tail = ''] = ip.split('::')
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : []
  return [...h, ...Array(8 - h.length - t.length).fill('0'), ...t].slice(0, 4).map((x) => x.padStart(4, '0')).join(':')
}

async function signup(req: Request, env: Cloudflare.Env): Promise<Response> {
  const ops = env.TENANT.get(env.TENANT.idFromName(OPS_TENANT))
  await ops.init(OPS_TENANT, 'internal')
  const who = (await sha256hex(ipKey(req.headers.get('cf-connecting-ip') ?? 'unknown'))).slice(0, 16)
  const r = await ops.spend(INTERNAL, `signups/${who}`, { signups: 1_000_000 }, crypto.randomUUID(), '')
  if (!r.ok) return r.status === 402 ? json(429, { error: 'rate_limited' }) : failResponse(r)
  for (let i = 0; i < 3; i++) {
    const tenant = randomTenant()
    if (await env.TENANT.get(env.TENANT.idFromName(tenant)).init(tenant, 'free')) return json(201, { tenant, admin_key: await adminKey(env.MASTER, tenant, 1) })
  }
  throw new Error('three tenant id collisions in a row')
}
```
In `route`, before the `/v1` check:
```ts
  if (req.method === 'POST' && url.pathname === '/auth/signup') return signup(req, env)
```

`worker/scripts/ops-key.mjs`:
```js
const master = process.env.MASTER
if (!master) { console.error('MASTER=<secret> node scripts/ops-key.mjs'); process.exit(1) }
const enc = new TextEncoder()
const k = await crypto.subtle.importKey('raw', enc.encode(master), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode('admin:solenoidops2:1')))
console.log(`sk.admin.solenoidops2.1.${[...sig].map((b) => b.toString(16).padStart(2, '0')).join('')}`)
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @solenoid/worker test && pnpm --filter @solenoid/worker typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Mint tenants at /auth/signup, rate-limited by Solenoid's own ledger

A per-client child-day limit in the ops tenant does five a day with no
new mechanism. IPv6 clients are keyed on their /64, which they can
otherwise rotate within freely."
```

---

### Task 9: SDK core

**Files:**
- Create: `sdk/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}`
- Create: `sdk/src/{index.ts,http.ts,errors.ts,keys.ts,verify.ts,types.ts,amounts.ts,scope.ts}`
- Test: `sdk/test/{amounts,http}.test.ts`, `sdk/test/live.test.ts`, `sdk/test/global-setup.ts`

**Interfaces:**
- Consumes: the HTTP contract from Tasks 7 and 8.
- Produces (from `@solenoid.systems/sdk`):
  - `solenoid(opts?: Options): Client`, where `Options = { key?; api?; timeoutMs?; store?: OutageStore; fetch?; prices?: Prices; onWarn?: (w: Warning[]) => void }`
  - `Client`: `spend(scope, amounts, o?: { idempotencyKey?: string }): Promise<Receipt | null>`, `limit(scope, limits, o?: { per?; onOutage?; warnAt? }): Promise<View>`, `rotate(scope): Promise<View>`, `rotateAdmin(): Promise<string>`, `get(scope, o?: { before? }): Promise<View>`, `verify(receipt): Promise<boolean>`, `deriveKey(scope, epoch?): Promise<string>`. Task 10 adds `at` and `run`.
  - `signup(api?): Promise<{ tenant; admin_key }>`, `checkScope(scope): string` (throws `TypeError`)
  - Errors: `SolenoidError`, `LimitExceeded` (with `scope`, `unit`, `resets`), `SolenoidUnavailable`
  - Internal: `ceilMicro`, `cleanAmounts(a, allowZero?)`, `Outage`, `call`, and the client-internal `post` and `settle` (not exported)

`spend` returns `null` only when Solenoid is unreachable and the nearest cached outage mode (from the scope itself up to the root) is `open`.

- [ ] **Step 1: Package files**

`sdk/package.json`:
```json
{
  "name": "@solenoid.systems/sdk",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/solenoid.mjs" },
    "./node": { "types": "./dist/node.d.ts", "default": "./dist/node.mjs" }
  },
  "files": ["dist", "README.md", "llms.txt"],
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --platform=neutral --outfile=dist/solenoid.mjs && esbuild src/node.ts --bundle --format=esm --platform=node --outfile=dist/node.mjs && tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": { "@types/node": "^22.0.0", "esbuild": "^0.24.0", "typescript": "^5.6.0", "vitest": "^4.1.10", "wrangler": "^4.61.1" }
}
```

`sdk/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "lib": ["ES2022", "DOM"], "types": ["node"] }, "include": ["src", "test"] }
```

`sdk/tsconfig.build.json`:
```json
{ "extends": "./tsconfig.json", "compilerOptions": { "declaration": true, "emitDeclarationOnly": true, "outDir": "dist" }, "include": ["src"] }
```

`sdk/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { globalSetup: ['./test/global-setup.ts'], testTimeout: 20_000 } })
```

`sdk/test/global-setup.ts` starts the real Worker on port 8799. It backs up any developer `.dev.vars`, and kills wrangler's whole process group on teardown:
```ts
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const worker = resolve(__dirname, '../../worker')
let proc: ChildProcess

export async function setup() {
  if (existsSync(`${worker}/.dev.vars`)) renameSync(`${worker}/.dev.vars`, `${worker}/.dev.vars.bak`)
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  writeFileSync(`${worker}/.dev.vars`, `MASTER=sdk-test-master\nSIGNING_KEY='${JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))}'\n`)
  proc = spawn(`${worker}/node_modules/.bin/wrangler`, ['dev', '--port', '8799', '--ip', '127.0.0.1'], { cwd: worker, stdio: 'ignore', detached: true })
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch('http://127.0.0.1:8799/.well-known/solenoid.json')).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('wrangler dev did not start on :8799')
}

export async function teardown() {
  if (proc?.pid) process.kill(-proc.pid, 'SIGTERM')
  if (existsSync(`${worker}/.dev.vars.bak`)) renameSync(`${worker}/.dev.vars.bak`, `${worker}/.dev.vars`)
}
```

- [ ] **Step 2: Write the failing unit tests**

`sdk/test/amounts.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { ceilMicro, cleanAmounts } from '../src/amounts'

describe('cleanAmounts', () => {
  it('rounds tiny amounts up to one micro-unit instead of to zero', () => {
    expect(cleanAmounts({ usd: 0.0000001 })).toEqual({ usd: 0.000001 })
  })
  it('does not inflate exact decimals through float error, at any magnitude', () => {
    expect(cleanAmounts({ usd: 0.1, tokens: 1840 })).toEqual({ usd: 0.1, tokens: 1840 })
    expect(cleanAmounts({ usd: 0.3 - 0.2 })).toEqual({ usd: 0.1 })
    expect(ceilMicro(17561305.854471)).toBe(17561305.854471)
  })
  it('drops zero units and refuses an empty spend, unless zeros are allowed', () => {
    expect(cleanAmounts({ usd: 0, tokens: 3 })).toEqual({ tokens: 3 })
    expect(() => cleanAmounts({ usd: 0 })).toThrow(TypeError)
    expect(() => cleanAmounts({ usd: -1 })).toThrow(TypeError)
    expect(cleanAmounts({ usd: 0 }, true)).toEqual({ usd: 0 })
  })
})
```

`sdk/test/http.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { LimitExceeded, SolenoidUnavailable, solenoid } from '../src/index'

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const OK = (remaining = {}, on_outage = 'open', warnings: unknown[] = []) => ({ receipt: { id: 'rcp_1' }, remaining, on_outage, warnings })
const mapStore = (m: Map<string, 'open' | 'closed'>) => ({ get: (s: string) => m.get(s), set: (s: string, v: 'open' | 'closed') => void m.set(s, v) })
const down = () => vi.fn().mockRejectedValue(new TypeError('network'))

describe('transport', () => {
  it('retries a keyed spend once with the same idempotency key', async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(res(200, OK()))
    await solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).spend('a', { n: 1 })
    const keys = f.mock.calls.map((c) => (c[1].headers as Record<string, string>)['idempotency-key'])
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })
  it('never retries a PUT, so a rotation cannot happen twice', async () => {
    const f = down()
    await expect(solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).rotate('a')).rejects.toThrow()
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('fails closed during an outage when nothing is cached, and open when the scope said so', async () => {
    const m = new Map<string, 'open' | 'closed'>()
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: down(), store: mapStore(m) })
    await expect(sol.spend('a', { n: 1 })).rejects.toBeInstanceOf(SolenoidUnavailable)
    m.set('a', 'open')
    expect(await sol.spend('a', { n: 1 })).toBeNull()
  })
  it("inherits the nearest ancestor's cached mode for a scope it has never seen", async () => {
    const m = new Map<string, 'open' | 'closed'>([['learning-loop/research', 'open']])
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: down(), store: mapStore(m) })
    expect(await sol.spend('learning-loop/research/new-session', { n: 1 })).toBeNull()
  })
  it("caches the mode at the limit's scope, so sibling scopes inherit it", async () => {
    const m = new Map<string, 'open' | 'closed'>()
    const f = vi.fn().mockResolvedValueOnce(res(200, OK({ n: { scope: 'a', left: 5, resets: null } }))).mockRejectedValue(new TypeError('network'))
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f, store: mapStore(m) })
    await sol.spend('a/one', { n: 1 })
    expect(await sol.spend('a/two', { n: 1 })).toBeNull()
  })
  it('turns 402 into LimitExceeded and never treats a 4xx as an outage', async () => {
    const f = vi.fn().mockResolvedValue(res(402, { error: 'limit_exceeded', scope: 'a', unit: 'n', resets: null }))
    const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f, store: { get: () => 'open', set: () => {} } })
    const e = await sol.spend('a', { n: 1 }).catch((x) => x)
    expect(e).toBeInstanceOf(LimitExceeded)
    expect(e.scope).toBe('a')
    expect(f).toHaveBeenCalledTimes(1)
  })
  it.each(['acme/..', 'acme/%2e%2e', 'Acme', 'a//b'])('refuses the scope %s before making any request', async (scope) => {
    const f = vi.fn()
    await expect(solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).spend(scope, { n: 1 })).rejects.toBeInstanceOf(TypeError)
    expect(f).not.toHaveBeenCalled()
  })
  it('passes warnings to onWarn', async () => {
    const onWarn = vi.fn()
    const w = [{ scope: 'a', unit: 'usd', used: 8, limit: 10 }]
    await solenoid({ key: 'sk.x', api: 'http://x', fetch: vi.fn().mockResolvedValue(res(200, OK({}, 'closed', w))), onWarn }).spend('a', { usd: 1 })
    expect(onWarn).toHaveBeenCalledWith(w)
  })
})
```

`sdk/test/live.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { LimitExceeded, signup, solenoid } from '../src/index'

const API = 'http://127.0.0.1:8799'

describe('against the real Worker', () => {
  it('signs up, derives a spend key, enforces a limit and verifies receipts', async () => {
    const { admin_key } = await signup(API)
    const admin = solenoid({ key: admin_key, api: API })
    await admin.limit('acme', { emails: 2 }, { per: 'day' })
    const agent = solenoid({ key: await admin.deriveKey('acme/bot'), api: API })
    const r1 = await agent.spend('acme/bot/run-1', { emails: 1 })
    await agent.spend('acme/bot/run-1', { emails: 1 })
    await expect(agent.spend('acme/bot/run-1', { emails: 1 })).rejects.toBeInstanceOf(LimitExceeded)
    expect(await agent.verify(r1!)).toBe(true)
    expect(await agent.verify({ ...r1!, body: { emails: 5 } })).toBe(false)
  })
  it('derives keys against the current epoch after a rotation', async () => {
    const { admin_key } = await signup(API)
    const admin = solenoid({ key: admin_key, api: API })
    const old = solenoid({ key: await admin.deriveKey('a'), api: API })
    await admin.rotate('a')
    await expect(old.spend('a', { n: 1 })).rejects.toMatchObject({ status: 401 })
    expect(await solenoid({ key: await admin.deriveKey('a'), api: API }).spend('a', { n: 1 })).not.toBeNull()
  })
})
```

- [ ] **Step 3: Run to confirm they fail**

Run: `pnpm --filter @solenoid.systems/sdk test`
Expected: FAIL, because the modules are missing.

- [ ] **Step 4: Implement**

`sdk/src/types.ts`:
```ts
export type Per = 'hour' | 'day' | 'week' | 'month' | 'child' | 'child-day' | null
export type Amounts = Record<string, number>
export type Mode = 'open' | 'closed'
export type Receipt = {
  id: string; seq: number; kind: 'spend' | 'settle' | 'limit' | 'rotate'; scope: string; body: Record<string, unknown>
  at: string; kid: string; prev: string; hash: string; sig: string; replay: boolean
}
export type Left = { scope: string; left: number; resets: string | null }
export type Warning = { scope: string; unit: string; used: number; limit: number }
export type LimitView = { scope: string; unit: string; limit: number; per: Per; on_outage: Mode; warn_at: number | null; used: number | null; left: number | null; resets: string | null }
export type View = { scope: string; epoch: number; limits: LimitView[]; children: string[]; entries: Receipt[]; next: number | null }
export type SpendResponse = { receipt: Receipt; remaining: Record<string, Left>; on_outage: Mode; warnings: Warning[] }
export interface OutageStore { get(scope: string): Mode | undefined | Promise<Mode | undefined>; set(scope: string, v: Mode): void | Promise<void> }
export type Price = { input: number; output: number }
export type Prices = Record<string, Price>
```

`sdk/src/errors.ts`:
```ts
export class SolenoidError extends Error {
  constructor(readonly status: number, readonly code: string, readonly detail: Record<string, unknown> = {}) { super(`solenoid: ${code} (${status})`) }
}
export class LimitExceeded extends SolenoidError {
  get scope(): string { return this.detail.scope as string }
  get unit(): string { return this.detail.unit as string }
  get resets(): string | null { return (this.detail.resets as string | null) ?? null }
}
export class SolenoidUnavailable extends Error {
  constructor(readonly scope: string, cause: unknown) { super(`solenoid is unreachable and the limits on "${scope}" fail closed`, { cause }) }
}
export class Outage extends Error {}
export function toError(status: number, data: Record<string, unknown>): SolenoidError {
  const { error, ...detail } = data
  const code = typeof error === 'string' ? error : 'unknown'
  return status === 402 ? new LimitExceeded(status, code, detail) : new SolenoidError(status, code, detail)
}
```

`sdk/src/amounts.ts`:
```ts
import type { Amounts } from './types'

export const ceilMicro = (v: number): number => Math.ceil(Math.round(v * 1e9) / 1e3) / 1e6

export function cleanAmounts(a: Amounts, allowZero = false): Amounts {
  const out: Amounts = {}
  for (const [unit, v] of Object.entries(a)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new TypeError(`solenoid: invalid amount for ${unit}`)
    const c = ceilMicro(v)
    if (c > 0 || allowZero) out[unit] = c
  }
  if (Object.keys(out).length === 0) throw new TypeError('solenoid: nothing to spend')
  return out
}
```

`sdk/src/scope.ts`:
```ts
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
```

`sdk/src/http.ts`:
```ts
import { Outage, toError } from './errors'

export type Transport = { api: string; key: string; timeoutMs: number; fetch: typeof fetch }

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
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok) return data as T
    if (res.status >= 500) throw new Outage(`HTTP ${res.status}`)
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
```

`sdk/src/keys.ts`:
```ts
const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function deriveSpendKey(adminKey: string, scope: string, epoch: number): Promise<string> {
  const [sk, kind, tenant, gen, secret] = adminKey.split('.')
  if (sk !== 'sk' || kind !== 'admin' || !secret) throw new TypeError('solenoid: deriving a key needs the admin key')
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return `sk.spend.${tenant}.${gen}.${epoch}.${b64url(scope)}.${hex(await crypto.subtle.sign('HMAC', k, enc.encode(`spend:${scope}:${epoch}`)))}`
}
```

`sdk/src/verify.ts`:
```ts
import type { Receipt } from './types'

const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(b, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
}
export function jcs(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${jcs(o[k])}`).join(',')}}`
}

export async function verifyReceipt(r: Receipt, jwk: JsonWebKey): Promise<boolean> {
  const material = r.prev + jcs({ seq: r.seq, kind: r.kind, scope: r.scope, body: r.body, at: r.at, kid: r.kid })
  if (hex(await crypto.subtle.digest('SHA-256', enc.encode(material))) !== r.hash) return false
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify'])
  try {
    return await crypto.subtle.verify('Ed25519', key, b64urlDecode(r.sig), enc.encode(r.hash))
  } catch {
    return false
  }
}

export async function verifyChain(ascending: Receipt[], keys: Record<string, JsonWebKey>): Promise<boolean> {
  for (let i = 0; i < ascending.length; i++) {
    const r = ascending[i]
    if (i > 0 && (r.prev !== ascending[i - 1].hash || r.seq !== ascending[i - 1].seq + 1)) return false
    const jwk = keys[r.kid]
    if (!jwk || !(await verifyReceipt(r, jwk))) return false
  }
  return true
}
```

`sdk/src/index.ts`:
```ts
import { cleanAmounts } from './amounts'
import { Outage, SolenoidUnavailable, toError } from './errors'
import { call, type Transport } from './http'
import { deriveSpendKey } from './keys'
import { checkScope, nearestFirst } from './scope'
import type { Amounts, Mode, OutageStore, Per, Prices, Receipt, SpendResponse, View, Warning } from './types'
import { verifyReceipt } from './verify'

export * from './errors'
export * from './types'
export { checkScope } from './scope'
export { verifyChain, verifyReceipt } from './verify'

export type Options = { key?: string; api?: string; timeoutMs?: number; store?: OutageStore; fetch?: typeof fetch; prices?: Prices; onWarn?: (w: Warning[]) => void }

const DEFAULT_API = 'https://api.solenoid.systems'
const envVar = (name: string): string | undefined => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[name]

function memoryStore(): OutageStore {
  const m = new Map<string, Mode>()
  return { get: (s) => m.get(s), set: (s, v) => void m.set(s, v) }
}

export async function signup(api = envVar('SOLENOID_API') ?? DEFAULT_API): Promise<{ tenant: string; admin_key: string }> {
  const res = await fetch(`${api.replace(/\/$/, '')}/auth/signup`, { method: 'POST' })
  const data = (await res.json()) as Record<string, unknown>
  if (res.status !== 201) throw toError(res.status, data)
  return data as { tenant: string; admin_key: string }
}

export function solenoid(opts: Options = {}) {
  const key = opts.key ?? envVar('SOLENOID_KEY')
  if (!key) throw new TypeError('solenoid: set SOLENOID_KEY or pass { key }')
  const t: Transport = { api: (opts.api ?? envVar('SOLENOID_API') ?? DEFAULT_API).replace(/\/$/, ''), key, timeoutMs: opts.timeoutMs ?? 2000, fetch: opts.fetch ?? globalThis.fetch.bind(globalThis) }
  const store = opts.store ?? memoryStore()
  const remaining = new Map<string, SpendResponse['remaining']>()
  let wellKnown: Promise<Record<string, JsonWebKey>> | undefined
  const path = (scope: string) => `/v1/${checkScope(scope)}`

  async function modeFor(scope: string): Promise<Mode> {
    for (const s of nearestFirst(scope)) {
      const m = await store.get(s)
      if (m) return m
    }
    return 'closed'
  }

  async function post(scope: string, body: unknown, idem: string): Promise<SpendResponse | null> {
    const p = path(scope)
    try {
      const r = await call<SpendResponse>(t, 'POST', p, body, idem)
      remaining.set(scope, r.remaining)
      for (const s of new Set([scope, ...Object.values(r.remaining).map((x) => x.scope)])) await store.set(s, r.on_outage)
      if (r.warnings?.length) opts.onWarn?.(r.warnings)
      return r
    } catch (e) {
      if (!(e instanceof Outage)) throw e
      if ((await modeFor(scope)) === 'open') return null
      throw new SolenoidUnavailable(scope, e)
    }
  }

  const spend = async (scope: string, amounts: Amounts, o: { idempotencyKey?: string } = {}): Promise<Receipt | null> =>
    (await post(scope, cleanAmounts(amounts), o.idempotencyKey ?? crypto.randomUUID()))?.receipt ?? null
  const settle = async (scope: string, idem: string, actual: Amounts): Promise<Receipt | null> =>
    (await post(scope, { settle: cleanAmounts(actual, true) }, idem))?.receipt ?? null

  const limit = (scope: string, limits: Record<string, number | null>, o: { per?: Per; onOutage?: Mode; warnAt?: number } = {}) =>
    call<View>(t, 'PUT', path(scope), { ...limits, per: o.per ?? null, on_outage: o.onOutage ?? 'closed', ...(o.warnAt ? { warn_at: o.warnAt } : {}) })
  const rotate = (scope: string) => call<View>(t, 'PUT', path(scope), { rotate_keys: true })
  const rotateAdmin = async () => (await call<{ admin_key: string }>(t, 'PUT', path(''), { rotate_admin: true })).admin_key
  const get = (scope: string, o: { before?: number } = {}) => call<View>(t, 'GET', path(scope) + (o.before === undefined ? '' : `?before=${o.before}`))

  async function verify(receipt: Receipt): Promise<boolean> {
    wellKnown ??= t.fetch(`${t.api}/.well-known/solenoid.json`).then(async (r) => ((await r.json()) as { keys: Record<string, JsonWebKey> }).keys)
    const jwk = (await wellKnown)[receipt.kid]
    return jwk ? verifyReceipt(receipt, jwk) : false
  }

  const deriveKey = async (scope: string, epoch?: number): Promise<string> => deriveSpendKey(key!, checkScope(scope), epoch ?? (await get(scope)).epoch)

  return { spend, limit, rotate, rotateAdmin, get, verify, deriveKey, _internal: { t, remaining, modeFor, settle, path, prices: opts.prices } }
}

export type Client = ReturnType<typeof solenoid>
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @solenoid.systems/sdk test && pnpm --filter @solenoid.systems/sdk typecheck`
Expected: PASS, and no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Add the zero-dependency SDK: spend, limits, keys, receipts

Only GETs and idempotency-keyed spends are retried, so a timed-out
rotation cannot run twice. During an outage a spend follows the mode
cached on its nearest ancestor, which is how a brand-new run or session
scope inherits its parent's open limit. Scopes are checked before a URL
exists, because URL parsers collapse dot segments."
```

---

### Task 10: `at`, `run` and `llm` with hold-and-settle

**Files:**
- Create: `sdk/src/llm.ts`, `sdk/src/prices.json`
- Modify: `sdk/src/index.ts` (add `at` and `run`, and remove `_internal.prices`)
- Test: `sdk/test/llm.test.ts`

**Interfaces:**
- Produces:
  - `Client.at(scope: string): Run`, which is a handle on an explicit scope.
  - `Client.run<T>(scope: string, fn: (run: Run) => Promise<T>): Promise<T>`, which calls `fn(at(child))`, where `child` is `${scope}/run-<id>`, or `run-<id>` at the root.
  - `type Run = { scope: string; spend(amounts: Amounts): Promise<Receipt | null>; llm<Req extends object, Res>(call: (req: Req) => Promise<Res>, req: Req, o?: { price?: Price }): Promise<Res> }`
  - From `llm.ts`: `readUsage(res)`, `capOutput(left, inputTokens, price)`, `estimateInput(req)`, `leftFrom(limits)`, `costOf(usage, price)`, `planCall(scope, req, left, price): { req: Record<string, unknown>; hold: Amounts | null }`

`llm` flow:
1. Read what's left: from the cache, or with a GET. An outage on the GET follows the nearest cached mode: `open` calls the provider unguarded; `closed` throws `SolenoidUnavailable`.
2. Plan the call.
3. **If a token or usd limit applies:** hold the worst case under a fresh key, call the provider, then settle the actual usage on the same key. If the provider throws, settle to zero. If the response carries no usage, settle to the hold. Failures during settle leave the hold standing.
4. **If no limit applies:** call the provider, then spend the actual usage. A `LimitExceeded` there marks the unit exhausted in the cache, and the response is still returned, because the action already happened.

- [ ] **Step 1: Fill `prices.json` from official pages**

Fetch `https://openai.com/api/pricing` and `https://www.anthropic.com/pricing`. Write USD **per token** for the models below. Record the date checked in `"_checked"`. Leave out any model whose price you cannot confirm on its official page.
```json
{
  "_checked": "2026-09-24",
  "gpt-4.1": { "input": 0, "output": 0 },
  "gpt-4.1-mini": { "input": 0, "output": 0 },
  "claude-sonnet-5": { "input": 0, "output": 0 },
  "claude-haiku-4-5": { "input": 0, "output": 0 }
}
```
Replace every `0` with the fetched price before committing.

- [ ] **Step 2: Write the failing tests**

`sdk/test/llm.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { capOutput, planCall, readUsage } from '../src/llm'
import { LimitExceeded, SolenoidUnavailable, solenoid } from '../src/index'

const P = { input: 1e-6, output: 4e-6 }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

describe('capOutput and readUsage', () => {
  it('is unconstrained with no token or usd limit', () => { expect(capOutput({}, 100, P)).toBe(Infinity) })
  it('caps by tokens left after the input', () => { expect(capOutput({ tokens: 1000 }, 300, P)).toBe(700) })
  it('takes the tighter of the token and usd caps', () => { expect(capOutput({ usd: 0.001, tokens: 10_000 }, 200, P)).toBe(200) })
  it('reads OpenAI-compatible and Anthropic usage shapes', () => {
    expect(readUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } })).toEqual({ input: 10, output: 5 })
    expect(readUsage({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } })).toEqual({ input: 15, output: 5 })
    expect(readUsage({})).toBeNull()
  })
})

describe('planCall (property)', () => {
  it('never plans a hold larger than what is left', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    for (let i = 0; i < 5000; i++) {
      const price = { input: rnd() * 1e-5, output: rnd() * 4e-5 + 1e-7 }
      const left = { tokens: { scope: 's', left: Math.floor(rnd() * 1e5), resets: null }, usd: { scope: 's', left: rnd() * 2, resets: null } }
      const req = { model: 'm', system: 'x'.repeat(Math.floor(rnd() * 500)), max_tokens: Math.floor(rnd() * 8000) + 1, messages: [{ role: 'user', content: 'x'.repeat(Math.floor(rnd() * 2000)) }] }
      try {
        const { hold } = planCall('s', req, left, price)
        expect(hold!.tokens).toBeLessThanOrEqual(left.tokens.left)
        expect(hold!.usd!).toBeLessThanOrEqual(left.usd.left + 1e-9)
      } catch (e) {
        expect(e).toBeInstanceOf(LimitExceeded)
      }
    }
  })
})

type Post = { body: Record<string, any>; idem: string }
function client(limits: object[], opts: { holdStatus?: number; getDown?: boolean; store?: Map<string, 'open' | 'closed'> } = {}) {
  const posts: Post[] = []
  const f = vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === 'GET') {
      if (opts.getDown) throw new TypeError('network')
      return json(200, { scope: 's', epoch: 0, limits, children: [], entries: [], next: null })
    }
    const body = JSON.parse(init.body as string)
    posts.push({ body, idem: (init.headers as Record<string, string>)['idempotency-key'] })
    if (!body.settle && opts.holdStatus === 402) return json(402, { error: 'limit_exceeded', scope: 's', unit: 'tokens', resets: null })
    return json(200, { receipt: { id: 'r' }, remaining: {}, on_outage: 'closed', warnings: [] })
  })
  const m = opts.store ?? new Map()
  const sol = solenoid({ key: 'sk.x', api: 'http://x', fetch: f as unknown as typeof fetch, prices: { m: P }, store: { get: (s) => m.get(s), set: (s, v) => void m.set(s, v) } })
  return { posts, sol }
}
const usage = (i: number, o: number) => ({ usage: { prompt_tokens: i, completion_tokens: o } })

describe('at(scope).llm', () => {
  it('holds the worst case, calls with a capped max_tokens, then settles actual usage on the same key', async () => {
    const { posts, sol } = client([{ unit: 'tokens', left: 500, scope: 's' }])
    const provider = vi.fn(async (req: { max_tokens: number }) => usage(20, Math.min(30, req.max_tokens)))
    await sol.at('s').llm(provider, { model: 'm', max_tokens: 4096, messages: [{ role: 'user', content: 'hi' }] })
    const sent = provider.mock.calls[0][0].max_tokens
    expect(sent).toBeLessThan(500)
    expect(posts).toHaveLength(2)
    expect(posts[0].body.tokens).toBeLessThanOrEqual(500)
    expect(posts[1].body.settle.tokens).toBe(50)
    expect(posts[1].body.settle.usd).toBeCloseTo(20 * P.input + 30 * P.output, 6)
    expect(posts[1].idem).toBe(posts[0].idem)
  })

  it('never calls the provider when the hold is refused', async () => {
    const { sol } = client([{ unit: 'tokens', left: 500, scope: 's' }], { holdStatus: 402 })
    const provider = vi.fn()
    await expect(sol.at('s').llm(provider, { model: 'm', messages: [] })).rejects.toBeInstanceOf(LimitExceeded)
    expect(provider).not.toHaveBeenCalled()
  })

  it('releases the hold when the provider throws', async () => {
    const { posts, sol } = client([{ unit: 'tokens', left: 500, scope: 's' }])
    await expect(sol.at('s').llm(async () => { throw new Error('provider down') }, { model: 'm', messages: [] })).rejects.toThrow('provider down')
    expect(posts[1].body.settle).toEqual({ tokens: 0, usd: 0 })
  })

  it('keeps the hold when the response carries no usage', async () => {
    const { posts, sol } = client([{ unit: 'tokens', left: 500, scope: 's' }])
    await sol.at('s').llm(async () => ({}), { model: 'm', messages: [] })
    expect(posts[1].body.settle).toEqual({ tokens: posts[0].body.tokens, usd: posts[0].body.usd })
  })

  it('counts system prompts and tools in the input estimate', async () => {
    const { sol } = client([{ unit: 'tokens', left: 200, scope: 's' }])
    await expect(sol.at('s').llm(vi.fn(), { model: 'm', system: 'x'.repeat(2000), messages: [] })).rejects.toBeInstanceOf(LimitExceeded)
  })

  it('with no applicable limit, calls first and spends the actual usage once', async () => {
    const { posts, sol } = client([])
    await sol.at('s').llm(async () => usage(3, 4), { model: 'm', messages: [] })
    expect(posts).toHaveLength(1)
    expect(posts[0].body).toMatchObject({ tokens: 7 })
  })

  it('follows the cached outage mode when the budget read fails', async () => {
    const open = client([], { getDown: true, store: new Map([['s', 'open']]) })
    const provider = vi.fn(async () => usage(1, 1))
    await open.sol.at('s/child').llm(provider, { model: 'm', messages: [] })
    expect(provider).toHaveBeenCalled()
    const closed = client([], { getDown: true })
    await expect(closed.sol.at('s').llm(vi.fn(), { model: 'm', messages: [] })).rejects.toBeInstanceOf(SolenoidUnavailable)
  })

  it('refuses a usd limit on a model with no known price', async () => {
    const { sol } = client([{ unit: 'usd', left: 1, scope: 's' }])
    await expect(sol.at('s').llm(vi.fn(), { model: 'unknown-model', messages: [] })).rejects.toMatchObject({ code: 'unknown_price' })
  })

  it('writes max_completion_tokens when the request uses it', async () => {
    const { sol } = client([{ unit: 'tokens', left: 300, scope: 's' }])
    const provider = vi.fn(async (_req: Record<string, unknown>) => usage(1, 1))
    await sol.at('s').llm(provider, { model: 'm', max_completion_tokens: 9999, messages: [] })
    expect(provider.mock.calls[0][0]).not.toHaveProperty('max_tokens')
    expect(provider.mock.calls[0][0].max_completion_tokens as number).toBeLessThanOrEqual(300)
  })

  it('runs under a fresh child scope, including at the root', async () => {
    const { sol } = client([])
    expect(await sol.run('acme/bot', async (r) => r.scope)).toMatch(/^acme\/bot\/run-[a-z0-9]{12,}$/)
    expect(await sol.run('', async (r) => r.scope)).toMatch(/^run-[a-z0-9]{12,}$/)
  })
})
```

- [ ] **Step 3: Run to confirm they fail**

Run: `pnpm --filter @solenoid.systems/sdk test -- llm`
Expected: FAIL.

- [ ] **Step 4: Implement**

`sdk/src/llm.ts`:
```ts
import { LimitExceeded, SolenoidError } from './errors'
import type { Amounts, Left, Price } from './types'

export function readUsage(res: unknown): { input: number; output: number } | null {
  const u = (res as { usage?: Record<string, number> })?.usage
  if (!u) return null
  if (typeof u.prompt_tokens === 'number') return { input: u.prompt_tokens, output: u.completion_tokens ?? 0 }
  if (typeof u.input_tokens === 'number') return { input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0 }
  return null
}

export function capOutput(left: { tokens?: number; usd?: number }, inputTokens: number, price: Price | undefined): number {
  const byTokens = left.tokens === undefined ? Infinity : left.tokens - inputTokens
  const byUsd = left.usd === undefined || !price ? Infinity : (left.usd - inputTokens * price.input) / price.output
  return Math.floor(Math.min(byTokens, byUsd))
}

export function estimateInput(req: Record<string, unknown>): number {
  const { model: _m, max_tokens: _a, max_completion_tokens: _b, ...rest } = req
  return Math.ceil((JSON.stringify(rest).length / 4) * 1.2)
}

export function leftFrom(limits: { unit: string; left: number | null; scope: string }[]): Record<string, Left> {
  const out: Record<string, Left> = {}
  for (const l of limits) if (l.left !== null && (!out[l.unit] || l.left < out[l.unit].left)) out[l.unit] = { scope: l.scope, left: l.left, resets: null }
  return out
}

export const costOf = (u: { input: number; output: number }, price: Price | undefined): Amounts =>
  ({ tokens: u.input + u.output, ...(price ? { usd: u.input * price.input + u.output * price.output } : {}) })

export function planCall(scope: string, req: Record<string, unknown>, left: Record<string, Left>, price: Price | undefined): { req: Record<string, unknown>; hold: Amounts | null } {
  if (left.usd && !price) throw new SolenoidError(0, 'unknown_price', { model: req.model })
  const input = estimateInput(req)
  const cap = capOutput({ tokens: left.tokens?.left, usd: left.usd?.left }, input, price)
  if (cap === Infinity) return { req, hold: null }
  if (cap < 1) {
    const unit = left.tokens && capOutput({ tokens: left.tokens.left }, input, price) < 1 ? 'tokens' : 'usd'
    throw new LimitExceeded(402, 'limit_exceeded', { scope: left[unit]?.scope ?? scope, unit, local: true })
  }
  const field = 'max_completion_tokens' in req ? 'max_completion_tokens' : 'max_tokens'
  const out = Math.min(typeof req[field] === 'number' ? (req[field] as number) : Infinity, cap)
  return { req: { ...req, [field]: out }, hold: costOf({ input, output: out }, price) }
}
```

In `sdk/src/index.ts`, import `pricesJson from './prices.json'`, `{ costOf, leftFrom, planCall, readUsage }` from `./llm`, and `LimitExceeded` and `Price` from their modules. Add at module level:
```ts
const { _checked, ...BUNDLED_PRICES } = pricesJson as Record<string, unknown>

export type Run = {
  scope: string
  spend(amounts: Amounts): Promise<Receipt | null>
  llm<Req extends object, Res>(call: (req: Req) => Promise<Res>, req: Req, o?: { price?: Price }): Promise<Res>
}
```
Inside `solenoid()`, before the `return`:
```ts
  const priceTable: Prices = { ...(BUNDLED_PRICES as Prices), ...(opts.prices ?? {}) }
  const runId = () => `run-${Date.now().toString(36)}${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join('')}`
  const quietly = <T>(p: Promise<T>) => p.catch((e) => { if (e instanceof SolenoidUnavailable) return null; throw e })

  function at(scope: string): Run {
    checkScope(scope)
    return {
      scope,
      spend: (amounts) => spend(scope, amounts),
      async llm(callFn, req, o = {}) {
        const r = req as Record<string, unknown>
        const price = o.price ?? priceTable[String(r.model ?? '')]
        let left
        try {
          left = remaining.get(scope) ?? leftFrom((await call<View>(t, 'GET', path(scope))).limits)
        } catch (e) {
          if (!(e instanceof Outage)) throw e
          if ((await modeFor(scope)) !== 'open') throw new SolenoidUnavailable(scope, e)
          return callFn(req)
        }
        const plan = planCall(scope, r, left, price)
        if (!plan.hold) {
          const res = await callFn(req)
          const usage = readUsage(res)
          if (usage) {
            await spend(scope, costOf(usage, price)).catch((e) => {
              if (!(e instanceof LimitExceeded)) throw e
              remaining.set(scope, { ...(remaining.get(scope) ?? {}), [e.unit]: { scope: e.scope, left: 0, resets: e.resets } })
              return null
            })
          }
          return res
        }
        const idem = crypto.randomUUID()
        const held = await spend(scope, plan.hold, { idempotencyKey: idem })
        let res
        try {
          res = await callFn(plan.req as typeof req)
        } catch (e) {
          if (held) await quietly(settle(scope, idem, Object.fromEntries(Object.keys(plan.hold).map((u) => [u, 0]))))
          throw e
        }
        const usage = readUsage(res)
        if (held) await quietly(settle(scope, idem, usage ? costOf(usage, price) : plan.hold))
        return res
      },
    }
  }

  const run = <T>(scope: string, fn: (r: Run) => Promise<T>): Promise<T> => fn(at(scope ? `${checkScope(scope)}/${runId()}` : runId()))
```
Return `at` and `run` alongside the other methods, and remove `prices` from `_internal`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @solenoid.systems/sdk test && pnpm --filter @solenoid.systems/sdk typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Hold the worst case before a model call, then settle the actual cost

Parallel sub-agents now meet the limit before their provider call, not
after it. A call that throws releases its hold, and a response without
usage keeps it."
```

---

### Task 11: The Node file store, the bundle, and the docs

**Files:**
- Create: `sdk/src/node.ts`, `sdk/README.md`, `sdk/llms.txt`
- Test: `sdk/test/node.test.ts`, `sdk/test/bundle.test.ts`

**Interfaces:**
- Produces: `fileStore(dir?: string): OutageStore` from `@solenoid.systems/sdk/node` (default `~/.cache/solenoid`). Build artifacts `dist/solenoid.mjs` and `dist/node.mjs`.

- [ ] **Step 1: Write the failing tests**

`sdk/test/node.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { fileStore } from '../src/node'

it('persists outage modes across store instances, as separate processes would', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sol-'))
  fileStore(dir).set('a/b', 'open')
  expect(fileStore(dir).get('a/b')).toBe('open')
  expect(fileStore(dir).get('other')).toBeUndefined()
})

it('reads a corrupt cache file as empty rather than throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sol-'))
  writeFileSync(join(dir, 'outage.json'), '{not json')
  expect(fileStore(dir).get('a')).toBeUndefined()
})
```

`sdk/test/bundle.test.ts`:
```ts
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('builds a single-file bundle with no imports', () => {
  execSync('pnpm run build', { cwd: `${__dirname}/..`, stdio: 'ignore' })
  const src = readFileSync(`${__dirname}/../dist/solenoid.mjs`, 'utf8')
  expect(src).not.toMatch(/^\s*import\s/m)
  expect(src).toMatch(/export\s*\{/)
})
```

- [ ] **Step 2: Run to confirm they fail**

Run: `pnpm --filter @solenoid.systems/sdk test -- node bundle`
Expected: FAIL.

- [ ] **Step 3: Implement the store**

`sdk/src/node.ts`:
```ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Mode, OutageStore } from './types'

export function fileStore(dir = join(homedir(), '.cache', 'solenoid')): OutageStore {
  const file = join(dir, 'outage.json')
  const read = (): Record<string, Mode> => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return {} } }
  return {
    get: (scope) => read()[scope],
    set(scope, v) {
      const all = read()
      if (all[scope] === v) return
      all[scope] = v
      mkdirSync(dir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(all))
      renameSync(tmp, file)
    },
  }
}
```

- [ ] **Step 4: Write the README and llms.txt against the copy brief**

Read `docs/copy/brief.md` first. `sdk/README.md` is written for its one reader, and for a coding agent with no other context. In order, it covers:
1. **The failure moment** that opens the page (brief §1), then the offer sentence (brief §4).
2. **Install:** `npm i @solenoid.systems/sdk`, or vendor `dist/solenoid.mjs` and `dist/node.mjs`.
3. **Quickstart:** `npx @solenoid.systems/cli init <scope>`, then a guarded `send(email)`. It states **`SOLENOID_KEY`** and **`SOLENOID_API`** (default `https://api.solenoid.systems`) plainly.
4. **The model:** scope, spend, limit, receipt, outage mode.
5. **Countable units:** spend first, then act; a failed action is not refunded.
6. **`at(scope).llm` and `run`:** hold, then settle, with OpenAI and Anthropic examples. Say to keep a provider or gateway cap for model spend.
7. **Setting limits:** a table of `per` values, plus `on_outage` and `warn_at`/`onWarn`.
8. **At-most-once:** `per: "child"` with a limit of 1.
9. **Errors:** `LimitExceeded`, `SolenoidUnavailable`, `SolenoidError`, and `null` from `spend` when an open limit meets an outage.
10. **Short-lived processes:** use `fileStore()`.
11. **Receipts:** `verify`.
12. **Known bounds:** the input estimate can be low, and settle corrects it afterwards. Streaming is not capped.

Every claim in it must be in the brief's proof inventory: no latency figures, no "edge". `sdk/llms.txt` covers the same material in plain text, under 120 lines, including one complete example that guards an existing function which fetches URLs.

- [ ] **Step 5: Cold copy-chief diagnostic**

Dispatch a `general-purpose` subagent whose prompt contains **only**: the README text verbatim, the paths `~/.claude/skills/copy-chief/references/checks.md` and `ai-tells.md` to read, and "Medium: developer SDK README. Jurisdiction: global; seller in New Zealand." Nothing else: not the brief, not this plan. Fix every Gate 0 item and every finding, or record why a finding is accepted in `docs/copy/grades/sdk-readme.md`. Repeat for `llms.txt`.

- [ ] **Step 6: Run the tests and build**

Run: `pnpm --filter @solenoid.systems/sdk test && pnpm --filter @solenoid.systems/sdk build`
Expected: PASS, and `dist/solenoid.mjs` and `dist/node.mjs` exist.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Ship a vendorable bundle, a file-backed outage cache, and graded docs"
```

---

### Task 12: CLI

**Files:**
- Create: `cli/{package.json,tsconfig.json,vitest.config.ts}`, `cli/src/{main.ts,config.ts,commands.ts,envfile.ts}`
- Test: `cli/test/{envfile,commands}.test.ts`

**Interfaces:**
- Consumes: `solenoid`, `signup`, `checkScope`, `View` from `@solenoid.systems/sdk`.
- Produces: bin `solenoid` with `init [scope] [--force]`, `login <admin-key>`, `key <scope>`, `limit <scope> <unit>=<n|off>… [--per p] [--on-outage m] [--warn-at f]`, `ls [scope]`, `log [scope] [--before n]`, `spend <scope> <unit>=<n>…`, `rotate <scope> --yes`, `rotate --admin --yes`. Credentials live at `$SOLENOID_CONFIG_DIR/credentials`, or `~/.config/solenoid/credentials`, as `{ api, admin_key }` with mode 0600. Also `appendEnvKey(path, key): 'added' | 'present'`.

- [ ] **Step 1: Package files**

`cli/package.json`:
```json
{
  "name": "@solenoid.systems/cli",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "bin": { "solenoid": "dist/solenoid.mjs" },
  "files": ["dist"],
  "scripts": {
    "build": "pnpm --filter @solenoid.systems/sdk build && esbuild src/main.ts --bundle --format=esm --platform=node --banner:js='#!/usr/bin/env node' --outfile=dist/solenoid.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": { "@solenoid.systems/sdk": "workspace:*", "@types/node": "^22.0.0", "esbuild": "^0.24.0", "typescript": "^5.6.0", "vitest": "^4.1.10" }
}
```

`cli/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "lib": ["ES2022", "DOM"], "types": ["node"] }, "include": ["src", "test"] }
```

`cli/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { globalSetup: ['../sdk/test/global-setup.ts'], testTimeout: 30_000 } })
```

- [ ] **Step 2: Write the failing tests**

`cli/test/envfile.test.ts`:
```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendEnvKey } from '../src/envfile'

const tmp = () => join(mkdtempSync(join(tmpdir(), 'env-')), '.env')

describe('appendEnvKey', () => {
  it('creates the file when it is missing', () => {
    const p = tmp()
    expect(appendEnvKey(p, 'sk.spend.x')).toBe('added')
    expect(readFileSync(p, 'utf8')).toBe('SOLENOID_KEY=sk.spend.x\n')
  })
  it('adds a newline first when the file does not end with one', () => {
    const p = tmp()
    writeFileSync(p, 'A=1')
    appendEnvKey(p, 'sk.spend.x')
    expect(readFileSync(p, 'utf8')).toBe('A=1\nSOLENOID_KEY=sk.spend.x\n')
  })
  it('leaves an existing SOLENOID_KEY untouched', () => {
    const p = tmp()
    writeFileSync(p, 'SOLENOID_KEY=old\n')
    expect(appendEnvKey(p, 'sk.spend.x')).toBe('present')
    expect(readFileSync(p, 'utf8')).toBe('SOLENOID_KEY=old\n')
  })
})
```

`cli/test/commands.test.ts`:
```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const BIN = join(__dirname, '../dist/solenoid.mjs')
let home: string, cwd: string
const run = (...args: string[]) =>
  execFileSync('node', [BIN, ...args], { cwd, env: { ...process.env, SOLENOID_API: 'http://127.0.0.1:8799', SOLENOID_CONFIG_DIR: home }, encoding: 'utf8' })

beforeAll(() => {
  execFileSync('pnpm', ['run', 'build'], { cwd: join(__dirname, '..') })
  home = mkdtempSync(join(tmpdir(), 'cfg-'))
  cwd = mkdtempSync(join(tmpdir(), 'proj-'))
})

describe('cli', () => {
  it('init mints an account, stores it privately, and writes a spend key to .env', () => {
    expect(run('init', 'acme')).toMatch(/sk\.admin\./)
    expect(statSync(join(home, 'credentials')).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(cwd, '.env'), 'utf8')).toMatch(/^SOLENOID_KEY=sk\.spend\./m)
    expect(() => run('init')).toThrow()
  })
  it('sets a limit, spends against it, and shows it', () => {
    run('limit', 'acme', 'emails=2', '--per', 'day')
    run('spend', 'acme/bot', 'emails=2')
    expect(() => run('spend', 'acme/bot', 'emails=1')).toThrow(/limit_exceeded/)
    expect(run('ls', 'acme')).toMatch(/emails\s+2\s+day\s+used 2\s+left 0/)
    expect(run('log', 'acme')).toMatch(/spend\s+acme\/bot/)
  })
  it('shows a per-child limit at the scope that owns it', () => {
    run('limit', 'acme/refunds', 'refunds=1', '--per', 'child')
    expect(run('ls', 'acme/refunds')).toMatch(/refunds\s+1\s+child\s+per child/)
  })
  it('refuses bad scopes and rotations without --yes', () => {
    expect(() => run('spend', 'acme/..', 'n=1')).toThrow(/invalid scope/)
    expect(() => run('rotate', 'acme')).toThrow(/--yes/)
  })
})
```

- [ ] **Step 3: Run to confirm they fail**

Run: `pnpm --filter @solenoid.systems/cli test`
Expected: FAIL.

- [ ] **Step 4: Implement**

`cli/src/envfile.ts`:
```ts
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

export function appendEnvKey(path: string, key: string): 'added' | 'present' {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (/^SOLENOID_KEY=/m.test(text)) return 'present'
  appendFileSync(path, `${text === '' || text.endsWith('\n') ? '' : '\n'}SOLENOID_KEY=${key}\n`)
  return 'added'
}
```

`cli/src/config.ts`:
```ts
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type Creds = { api: string; admin_key: string }
const dir = () => process.env.SOLENOID_CONFIG_DIR ?? join(homedir(), '.config', 'solenoid')
const file = () => join(dir(), 'credentials')

export const hasCreds = () => existsSync(file())
export function readCreds(): Creds {
  if (!hasCreds()) throw new Error('not logged in: run `solenoid init` or `solenoid login <admin-key>`')
  return JSON.parse(readFileSync(file(), 'utf8')) as Creds
}
export function writeCreds(c: Creds): void {
  mkdirSync(dir(), { recursive: true, mode: 0o700 })
  writeFileSync(file(), JSON.stringify(c, null, 2), { mode: 0o600 })
  chmodSync(file(), 0o600)
}
export const apiBase = () => process.env.SOLENOID_API ?? 'https://api.solenoid.systems'
```

`cli/src/commands.ts`:
```ts
import { checkScope, signup, solenoid, type View } from '@solenoid.systems/sdk'
import { appendEnvKey } from './envfile'
import { apiBase, hasCreds, readCreds, writeCreds } from './config'

const scopeArg = (s: string | undefined) => checkScope(s === undefined || s === '/' ? '' : s.replace(/^\/+|\/+$/g, ''))
const client = () => { const c = readCreds(); return solenoid({ key: c.admin_key, api: c.api }) }

function pairs(args: string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const a of args) {
    const [unit, v] = a.split('=')
    if (!unit || v === undefined) throw new Error(`expected unit=value, got "${a}"`)
    out[unit] = v === 'off' ? null : Number(v)
    if (out[unit] !== null && !Number.isFinite(out[unit])) throw new Error(`not a number: "${a}"`)
  }
  return out
}

function show(v: View): string {
  const lines = v.limits.map((l) => {
    const usage = l.used === null ? 'per child' : `used ${l.used}  left ${l.left}`
    return `${l.unit.padEnd(12)} ${String(l.limit).padEnd(8)} ${(l.per ?? 'lifetime').padEnd(9)} ${usage}  (${l.scope || '/'}, ${l.on_outage}${l.warn_at ? `, warn at ${l.warn_at}` : ''})`
  })
  return [v.scope || '/', ...(lines.length ? lines : ['(no limits)']), ...(v.children.length ? [`children: ${v.children.join(' ')}`] : [])].join('\n')
}

export async function dispatch(cmd: string, pos: string[], flags: Record<string, string | boolean | undefined>): Promise<string> {
  switch (cmd) {
    case 'init': {
      if (hasCreds() && !flags.force) throw new Error('already initialised; use --force to create another account')
      const api = apiBase()
      const { tenant, admin_key } = await signup(api)
      writeCreds({ api, admin_key })
      const out = [`tenant ${tenant}`, `admin key: ${admin_key}`, 'It is saved in your config. Keep a copy somewhere safe: it can mint and revoke every other key.']
      if (pos[0] !== undefined) {
        const scope = scopeArg(pos[0])
        const key = await solenoid({ key: admin_key, api }).deriveKey(scope, 0)
        out.push(appendEnvKey('.env', key) === 'added' ? `SOLENOID_KEY for "${scope}" written to .env` : `.env already sets SOLENOID_KEY, so it is unchanged. The key for "${scope}" is ${key}`)
      }
      return out.join('\n')
    }
    case 'login': {
      if (!pos[0]?.startsWith('sk.admin.')) throw new Error('login needs an admin key (sk.admin.…)')
      writeCreds({ api: apiBase(), admin_key: pos[0] })
      await client().get('')
      return 'logged in'
    }
    case 'key': return client().deriveKey(scopeArg(pos[0]))
    case 'limit': {
      const warnAt = flags['warn-at'] ? Number(flags['warn-at']) : undefined
      return show(await client().limit(scopeArg(pos[0]), pairs(pos.slice(1)), { per: (flags.per as never) ?? null, onOutage: (flags['on-outage'] as never) ?? 'closed', warnAt }))
    }
    case 'spend': {
      const r = await client().spend(scopeArg(pos[0]), pairs(pos.slice(1)) as Record<string, number>)
      return r ? `${r.id} seq ${r.seq}` : 'Solenoid was unreachable and this scope fails open, so the spend was allowed without a record.'
    }
    case 'ls': return show(await client().get(scopeArg(pos[0])))
    case 'log': {
      const v = await client().get(scopeArg(pos[0]), { before: flags.before ? Number(flags.before) : undefined })
      const rows = v.entries.map((e) => `${String(e.seq).padStart(6)}  ${e.at}  ${e.kind.padEnd(6)} ${(e.scope || '/').padEnd(30)} ${JSON.stringify(e.body)}`)
      return [...rows, ...(v.next ? [`more: solenoid log ${pos[0] ?? ''} --before ${v.next}`] : [])].join('\n')
    }
    case 'rotate': {
      if (!flags.yes) throw new Error(flags.admin ? 'rotating the admin key revokes every key; re-run with --yes' : `this revokes every key for "${scopeArg(pos[0])}"; re-run with --yes`)
      if (flags.admin) {
        writeCreds({ ...readCreds(), admin_key: await client().rotateAdmin() })
        return 'New admin key saved. Every spend key now fails; re-derive each with `solenoid key <scope>`.'
      }
      const v = await client().rotate(scopeArg(pos[0]))
      return `epoch now ${v.epoch}; new key: ${await client().deriveKey(scopeArg(pos[0]), v.epoch)}`
    }
    default: throw new Error(`unknown command "${cmd}". Commands: init login key limit spend ls log rotate`)
  }
}
```

`cli/src/main.ts`:
```ts
import { parseArgs } from 'node:util'
import { dispatch } from './commands'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { per: { type: 'string' }, 'on-outage': { type: 'string' }, 'warn-at': { type: 'string' }, before: { type: 'string' }, yes: { type: 'boolean' }, admin: { type: 'boolean' }, force: { type: 'boolean' } },
})
const [cmd = 'help', ...pos] = positionals
dispatch(cmd, pos, values).then(
  (out) => { process.stdout.write(`${out}\n`) },
  (e: Error & { code?: string }) => { process.stderr.write(`solenoid: ${e.code ?? ''} ${e.message}\n`); process.exit(1) },
)
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @solenoid.systems/cli test && pnpm --filter @solenoid.systems/cli typecheck`
Expected: PASS.

- [ ] **Step 6: Cold copy-chief diagnostic of the CLI's words**

Collect every user-facing string in `commands.ts` and `main.ts` (the `init` output, the errors, the help list) into one draft. Grade it exactly as in Task 11 Step 5, with "Medium: CLI output". Apply the fixes, re-run the tests, and record the grade in `docs/copy/grades/cli.md`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Add the solenoid CLI

init mints an account with no form or email, keeps the admin key in a
0600 file, and writes a scoped spend key to .env."
```

---

### Task 13: Deploy, install the CLI, and create Robin's tenant

**Files:**
- Create: `worker/scripts/gen-secrets.mjs`
- Modify: `README.md` (a "Deploy" section recording these steps)

**Interfaces:**
- Produces: a live Worker at `https://solenoid.<account>.workers.dev` with the ops tenant's signup limits set; a `solenoid` binary on Robin's `PATH`; Robin's own tenant in `~/.config/solenoid/credentials`.

Keep the secrets file until Step 6. An agentic executor runs each step as a fresh shell, so the steps use a fixed path, not a variable.

- [ ] **Step 1: Generate the secrets**

`worker/scripts/gen-secrets.mjs`:
```js
const master = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const { kty, crv, x, d } = await crypto.subtle.exportKey('jwk', pair.privateKey)
console.log(JSON.stringify({ MASTER: master, SIGNING_KEY: JSON.stringify({ kty, crv, x, d }) }))
```
```bash
cd ~/dev/solenoid/worker && umask 077 && node scripts/gen-secrets.mjs > ~/.solenoid-secrets.json
```

- [ ] **Step 2: Deploy, then store the secrets**

```bash
cd ~/dev/solenoid/worker && pnpm exec wrangler deploy
jq -r .MASTER ~/.solenoid-secrets.json | pnpm exec wrangler secret put MASTER
jq -r .SIGNING_KEY ~/.solenoid-secrets.json | pnpm exec wrangler secret put SIGNING_KEY
curl -s https://solenoid.<account>.workers.dev/.well-known/solenoid.json | jq .
```
Expected: `{"keys":{"k1":{"kty":"OKP","crv":"Ed25519","x":"…"}}}`.

- [ ] **Step 3: Initialise the ops tenant and set its limits**

The ops tenant exists only after the first signup, so make one first:
```bash
curl -s -X POST https://solenoid.<account>.workers.dev/auth/signup | jq -r .tenant
cd ~/dev/solenoid && pnpm --filter @solenoid.systems/cli build
OPS=$(MASTER=$(jq -r .MASTER ~/.solenoid-secrets.json) node worker/scripts/ops-key.mjs)
export SOLENOID_API=https://solenoid.<account>.workers.dev SOLENOID_CONFIG_DIR=$(mktemp -d)
node cli/dist/solenoid.mjs login "$OPS" && node cli/dist/solenoid.mjs limit signups signups=5 --per child-day && node cli/dist/solenoid.mjs limit / signups=1000 --per day && node cli/dist/solenoid.mjs ls signups
```
Expected: the `ls` shows `signups 5 child-day per child` and the root's `signups 1000 day`. Then run `for i in $(seq 6); do curl -s -o /dev/null -w '%{http_code}\n' -X POST https://solenoid.<account>.workers.dev/auth/signup; done`. Expected: `201` until this IP's fifth signup today (the first signup in this step counts), then `429`.

- [ ] **Step 4: Put `solenoid` on the PATH**

```bash
mkdir -p ~/.local/bin && ln -sf ~/dev/solenoid/cli/dist/solenoid.mjs ~/.local/bin/solenoid && chmod +x ~/dev/solenoid/cli/dist/solenoid.mjs
which solenoid
```

- [ ] **Step 5: Create Robin's tenant**

Add `export SOLENOID_API=https://solenoid.<account>.workers.dev` to Robin's shell profile, then run `solenoid init`. Expected: a tenant and an admin key, saved to `~/.config/solenoid/credentials`.

- [ ] **Step 6: Hand the secrets to Robin, then delete the file**

Robin stores `~/.solenoid-secrets.json` and his admin key in his password manager. **Losing `MASTER` invalidates every key ever issued.** Then: `rm ~/.solenoid-secrets.json`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Deploy to workers.dev and record the setup runbook"
```

---

### Task 14: learning-loop's fetch budget, made atomic

Work in `<vault>/learning-loop` on a branch named `solenoid-fetch-budget`.

**Files:**
- Modify: `plugin/scripts/lib/fetch-budget.mjs`
- Modify: `plugin/bin/source-gateway.mjs:74-103` (the budget block and `buildFileStore`)
- Modify: `tests/gateway/fetch-budget.test.mjs`, `tests/gateway/source-gateway.test.mjs`, `tests/url-guard.test.mjs:178-185`

**Interfaces:**
- Produces:
  - `tryBump(sessionId, pluginData, budget): boolean`, which reserves one fetch atomically across processes. It returns `false` when the budget is spent, and `true` (no enforcement) when `pluginData` or `sessionId` is unusable or the data directory can't be written.
  - The `budgetStore` seam becomes `{ tryBump(budget: number): boolean | Promise<boolean> }`.
  - `budgetScopeSegment(sessionId): string | null`, which maps an ID onto the scope grammar (`[a-z0-9._-]`). Tasks 15 and 16 use it.

- [ ] **Step 1: Write the failing tests**

In `tests/gateway/fetch-budget.test.mjs`, change the import to `import { readCount, tryBump, budgetScopeSegment } from '../../plugin/scripts/lib/fetch-budget.mjs';`. Delete the "bump increments" and "gracefully no-ops bump" cases, and rewrite "isolates counters per sessionId":
```js
  it('isolates counters per sessionId', () => {
    const a = `iso-a-${Date.now()}`, b = `iso-b-${Date.now()}`;
    tryBump(a, tmpPd, 10); tryBump(a, tmpPd, 10); tryBump(b, tmpPd, 10);
    assert.equal(readCount(a, tmpPd), 2);
    assert.equal(readCount(b, tmpPd), 1);
  });
```
Append:
```js
import { spawn } from 'node:child_process';

describe('tryBump', () => {
  it('lets exactly budget of N concurrent processes through', async () => {
    const sid = `race-${Date.now()}`;
    const mod = new URL('../../plugin/scripts/lib/fetch-budget.mjs', import.meta.url).href;
    const script = `import { tryBump } from ${JSON.stringify(mod)}; process.stdout.write(tryBump(${JSON.stringify(sid)}, ${JSON.stringify(tmpPd)}, 10) ? '1' : '0');`;
    const outs = await Promise.all(Array.from({ length: 30 }, () => new Promise((resolve) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', script]);
      let s = ''; p.stdout.on('data', (d) => (s += d)); p.on('close', () => resolve(s));
    })));
    assert.equal(outs.filter((o) => o === '1').length, 10);
  });
  it('degrades to allowing when pluginData or sessionId is unusable', () => {
    assert.equal(tryBump('s', null, 0), true);
    assert.equal(tryBump('unknown', tmpPd, 0), true);
    assert.equal(tryBump('s', '/proc/definitely/not/writable', 0), true);
  });
});

describe('budgetScopeSegment', () => {
  it('maps session ids onto the scope grammar', () => {
    assert.equal(budgetScopeSegment('3F2A-99bc_X'), '3f2a-99bc_x');
    assert.equal(budgetScopeSegment('a b/c'), 'a-b-c');
    assert.equal(budgetScopeSegment('unknown'), null);
    assert.equal(budgetScopeSegment(''), null);
    assert.equal(budgetScopeSegment('...'), null);
  });
});
```

In `tests/gateway/source-gateway.test.mjs`, replace `makeBudgetStore()` with:
```js
function makeBudgetStore() {
  let n = 0;
  return { tryBump(budget) { if (n >= budget) return false; n += 1; return true; } };
}
```

In `tests/url-guard.test.mjs:178-185`, change the store to `{ tryBump: () => { bumped++; return true; } }`, so that the "blocked URL does not consume budget" assertion can fail again.

- [ ] **Step 2: Run to confirm they fail**

Run: `node --test tests/gateway/fetch-budget.test.mjs tests/gateway/source-gateway.test.mjs tests/url-guard.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `plugin/scripts/lib/fetch-budget.mjs`, and delete `bumpCount`:
```js
import { openSync, closeSync, unlinkSync, statSync } from 'node:fs';

const LOCK_WAIT_MS = 2000;
const LOCK_STALE_MS = 5000;

// Two waiters can both see a stale lock and one can unlink the other's fresh
// lock. That needs a holder dead for over 5s, and costs at most one extra fetch.
function withLock(file, fn) {
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { closeSync(openSync(lock, 'wx')); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) unlinkSync(lock); } catch {}
      if (Date.now() > deadline) throw new Error('fetch-budget lock timeout');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  try { return fn(); } finally { try { unlinkSync(lock); } catch {} }
}

// Reserve one fetch atomically across processes. Reading the count and writing
// count + 1 separately let parallel research subagents fetch past the budget.
export function tryBump(sessionId, pluginData, budget) {
  if (!pluginData || !sessionId || sessionId === 'unknown') return true;
  const file = budgetFile(sessionId, pluginData);
  try {
    mkdirSync(join(pluginData, 'fetch-budget'), { recursive: true });
    return withLock(file, () => {
      const n = readCount(sessionId, pluginData);
      if (n >= budget) return false;
      writeFileSync(file, String(n + 1), 'utf8');
      return true;
    });
  } catch {
    return true;
  }
}

export function budgetScopeSegment(sessionId) {
  if (!sessionId || sessionId === 'unknown') return null;
  const seg = sessionId.toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 64);
  return seg === '' || /^[.]+$/.test(seg) ? null : seg;
}
```

In `plugin/bin/source-gateway.mjs`, change the import to `import { tryBump } from '../scripts/lib/fetch-budget.mjs';` and replace lines 74–103 (the budget block through the end of `buildFileStore`) with:
```js
  const budget = fetchBudget ?? DEFAULT_FETCH_BUDGET;
  const source = resolveSlot('fetch');
  const store = budgetStore ?? buildFileStore(sessionId, pluginData);
  if (store && !(await store.tryBump(budget))) {
    return { doc: { ok: false, reason: 'fetch_budget_exceeded' }, source_used: source.id };
  }
  const doc = await source.fetch(args.url);
  return { doc, source_used: source.id };
}

function buildFileStore(sid, pd) {
  const resolvedSid = sid !== undefined ? sid : getSessionId();
  const resolvedPd = pd !== undefined ? pd : getPluginData();
  if (!resolvedPd || !resolvedSid || resolvedSid === 'unknown') return null;
  return { tryBump: (budget) => tryBump(resolvedSid, resolvedPd, budget) };
}
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS. Then temporarily revert `tryBump`'s body to an unlocked read-then-write. The concurrency test must FAIL with more than 10 successes. Restore it.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Reserve fetch budget atomically across processes

Parallel research subagents could each read the count, each see room,
and each fetch past the cap. A lock file around read-and-increment makes
exactly the budget's worth of fetches succeed."
```

---

### Task 15: The litmus test — a fresh agent integrates Solenoid from the docs alone

**Files:**
- Create in learning-loop: `plugin/vendor/solenoid/{solenoid.mjs,node.mjs}` (copied from `~/dev/solenoid/sdk/dist/`)
- Create in the solenoid repo: `docs/litmus/2026-09-24-learning-loop-fetch-budget.md`
- The integration code itself is written by the fresh agent.

**Interfaces:**
- Consumes: `budgetStore.tryBump` and `budgetScopeSegment` (Task 14), the bundle, README and `llms.txt` (Task 11), and Robin's tenant (Task 13).
- Expected result: when `SOLENOID_KEY` is set and the session ID maps onto the grammar, `buildFileStore` returns a Solenoid-backed store. That store spends `{ fetches: 1 }` at `learning-loop/research/{segment}`, maps `LimitExceeded` to `false`, and maps a `null` receipt to `true`. It uses `fileStore()` for the outage cache. Otherwise it returns the file store.

- [ ] **Step 1: Vendor the bundle and set up the live limit**

```bash
mkdir -p <vault>/learning-loop/plugin/vendor/solenoid
cp ~/dev/solenoid/sdk/dist/solenoid.mjs ~/dev/solenoid/sdk/dist/node.mjs <vault>/learning-loop/plugin/vendor/solenoid/
solenoid limit learning-loop/research fetches=10 --per child --on-outage open
solenoid key learning-loop     # one key covering research and verify
```
Put `SOLENOID_KEY=<that key>` and `SOLENOID_API` into the environment that Claude Code passes to plugin scripts (the `env` block in `~/.claude/settings.json`).

- [ ] **Step 2: Dispatch the fresh agent**

Dispatch a `general-purpose` subagent **in a worktree of learning-loop**, with only this prompt:
> Integrate Solenoid into learning-loop's research fetch budget. The only documentation you may read about Solenoid is `plugin/vendor/solenoid/` plus `~/dev/solenoid/sdk/README.md` and `~/dev/solenoid/sdk/llms.txt`. Do not read Solenoid's source code. The budget seam is `budgetStore.tryBump(budget)` in `plugin/bin/source-gateway.mjs`, and the helpers are in `plugin/scripts/lib/fetch-budget.mjs`. When `SOLENOID_KEY` is set, fetches must be limited by Solenoid instead of the local file. When it is not set, behaviour must not change. Add tests in `tests/gateway/` that stub only `fetch`. Run `npm test`. Commit on the worktree branch. Report what you did and anything in the docs that confused you.

- [ ] **Step 3: Judge the result**

It passes only if **all** of these hold. Check each against the diff:
1. `npm test` passes in the worktree.
2. It spends at scope `learning-loop/research/{budgetScopeSegment(sid)}`, unit `fetches`, amount `1`.
3. `LimitExceeded` gives `false`, a `null` receipt gives `true`, and `SolenoidUnavailable` gives `false`.
4. The outage cache is `fileStore()`. Because the limit's scope is cached as `open`, a new session's first fetch during an outage is allowed.
5. It falls back to the file store when the key is unset or the segment is `null`.
6. It did not read `~/dev/solenoid/{worker,sdk/src}` (check the agent's tool calls).

Live run, in one session:
```bash
for i in $(seq 12); do node plugin/bin/source-gateway.mjs fetch --url https://example.com | jq -r .doc.reason; done
```
Expected: 10 successes, then `fetch_budget_exceeded`.

Record the prompt, the agent's report, the six checks and the live run in `docs/litmus/2026-09-24-learning-loop-fetch-budget.md`. **Any failed check is a documentation bug.** Fix the README or `llms.txt`, re-grade the changed text with copy-chief, and re-dispatch a *new* agent. Repeat until every check passes, then merge the passing worktree branch into `solenoid-fetch-budget`.

- [ ] **Step 4: Commit**

In the solenoid repo: `git add docs/litmus && git commit -m "Record the learning-loop litmus run"`.

---

### Task 16: Verify-phase spend through `at(...).llm`

Work in `<vault>/learning-loop` on `solenoid-fetch-budget`.

**Files:**
- Modify: `plugin/scripts/lib/model-client.mjs` (an optional `budget` parameter on `chatJSON`)
- Modify: `plugin/scripts/librarian/config.mjs` (pass `provider.price` through)
- Modify: `plugin/scripts/librarian/verify.mjs` (build the budget handle when `SOLENOID_KEY` is set)
- Test: `tests/model-client-budget.test.mjs`

**Interfaces:**
- Consumes: `solenoid().at` from `plugin/vendor/solenoid/solenoid.mjs`, and `budgetScopeSegment`.
- Produces: `chatJSON({ ..., budget })`, where `budget` is `{ llm(call, req, o) }`. The OpenAI branch posts through `budget.llm`. With no `budget`, behaviour is unchanged.

- [ ] **Step 1: Write the failing test**

`tests/model-client-budget.test.mjs`:
```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chatJSON } from '../plugin/scripts/lib/model-client.mjs';

const provider = { kind: 'openai', baseUrl: 'http://m', apiKey: 'k', price: { input: 1e-6, output: 2e-6 } };
const reply = { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } };

describe('chatJSON budget', () => {
  it('routes the OpenAI request through budget.llm, with the capped request and the provider price', async () => {
    let seenReq, seenPrice;
    const budget = { llm: async (call, req, o) => { seenPrice = o.price; return call({ ...req, max_tokens: 7 }); } };
    const fetchOverride = async (_url, init) => { seenReq = JSON.parse(init.body); return new Response(JSON.stringify(reply)); };
    assert.deepEqual(await chatJSON({ provider, model: 'x', system: 's', user: 'u', schema: {}, fetchOverride, budget }), { ok: true });
    assert.equal(seenReq.max_tokens, 7);
    assert.deepEqual(seenPrice, provider.price);
  });
  it('is unchanged without a budget', async () => {
    const fetchOverride = async () => new Response(JSON.stringify(reply));
    assert.deepEqual(await chatJSON({ provider, model: 'x', system: 's', user: 'u', schema: {}, fetchOverride }), { ok: true });
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node --test tests/model-client-budget.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `chatJSON`, add `budget` to the destructured parameters. Then replace the request-and-response block (from `const res = await fetchFn(` through `const data = await res.json();`) with:
```js
  const post = async (reqBody) => {
    const res = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(reqBody), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      const err = new Error(`${provider.kind} HTTP ${res.status}`);
      err.code = 'MODEL_HTTP_ERROR';
      err.status = res.status;
      throw err;
    }
    return res.json();
  };
  const data = budget && provider.kind === 'openai' ? await budget.llm(post, body, { price: provider.price }) : await post(body);
```

In `resolveProvider`, after building `provider`, add `if (p.price) provider.price = p.price;`.

In `verify.mjs`'s `isMainModule` block, before `verifyClaimGlm`:
```js
      const seg = budgetScopeSegment(getSessionId());
      const budget = process.env.SOLENOID_KEY && seg
        ? await import('../../vendor/solenoid/solenoid.mjs').then(async ({ solenoid }) => {
            const { fileStore } = await import('../../vendor/solenoid/node.mjs');
            return solenoid({ store: fileStore() }).at(`learning-loop/verify/${seg}`);
          })
        : undefined;
```
Import `budgetScopeSegment` from `../lib/fetch-budget.mjs` and `getSessionId` from `../lib/session.mjs`. Pass `budget` through `verifyClaimGlm`'s options into each `chatJSON` call.

- [ ] **Step 4: Run the suite, then wire the live limit**

Run: `npm test`
Expected: PASS.

Then:
```bash
solenoid limit learning-loop/verify usd=2 --per day --on-outage open --warn-at 0.8
```
Fetch the configured model's current per-token price from `https://fireworks.ai/pricing`, and add `"price": { "input": <usd/token>, "output": <usd/token> }` to the `librarian.provider` block in `~/.claude/plugins/data/learning-loop-learning-loop-marketplace/config.json`. Run one `/learning-loop:research`. Then check with `solenoid ls learning-loop/verify` that `used` is above 0, and with `solenoid log learning-loop/verify` that each hold was followed by a settle.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Spend Verify's model calls against a Solenoid budget when configured

With SOLENOID_KEY set, each Fireworks call holds its worst case against
the day's remaining dollars, and settles to its actual usage."
```

---

## Phase: Test hardening (Tasks 17, 24, 18–21)

Added 2026-09-24 at Robin's request: every surface as well covered as it can be, mutation-tested with Stryker, following the old repository (one Stryker config per package, over all of `src/`) and learning-loop (one `stryker.<module>.json` per module, command runner). It runs after the learning-loop integration and before the hostname move.

**Phase gates, applied to every task below:**
- **Line and branch coverage:** 100% of lines and at least 95% of branches in every mutated file. Report anything below that, file by file, with the reason each line is unreachable.
- **Mutation score:** `thresholds: { high: 95, low: 90, break: 90 }`, so a run below 90% fails.
- **Survivors:** zero surviving mutants on any path that rejects or limits something: every `4xx` return, every limit comparison, every key, MAC, epoch or generation check, every scope or unit grammar check, and every `on_outage` decision. Elsewhere, each survivor is either killed by a new test or recorded as an equivalent mutant, with the reason, in `docs/testing/MUTATION-SUMMARY.md`.
- **Test rules:** mock only at the boundary. That means the LLM provider, `fetch` inside SDK unit tests, and the filesystem only where a test says so. No test may mock a Solenoid module. A test must assert behaviour; a test that passes against a stubbed-out implementation is a defect.
- Each task records its before and after coverage, its mutation score and its survivor counts in `docs/testing/MUTATION-SUMMARY.md`, under a heading for its package.

---

### Task 17: Worker coverage and mutation testing

**Files:**
- Create: `worker/stryker.config.mjs`, `docs/testing/MUTATION-SUMMARY.md`
- Modify: `worker/package.json` (devDependencies `@stryker-mutator/core`, `@stryker-mutator/vitest-runner` and `@vitest/coverage-istanbul`; add a `coverage` script), `worker/vitest.config.mts` (an istanbul coverage block)
- Possibly create: `worker/src/ledger.ts` (see Step 3)
- Test: new and extended files under `worker/test/`

- [ ] **Step 1: Coverage.** Turn on istanbul coverage. The v8 provider cannot run inside workerd, and `@cloudflare/vitest-pool-workers` supports istanbul. Include `src/**/*.ts`, run it, and write the per-file table into `MUTATION-SUMMARY.md`.
- [ ] **Step 2: Route and error-table tests.** Every route in the spec's Surface table, and every row in its Errors table, gets at least one test through `SELF.fetch`, with the exact status, `error` code and detail fields. That includes `Retry-After` on a `402` with `resets`, the plan-exhausted `402` (scope `""`, unit `spends`), `403 plan_owned` on PUT `spends`, `400 invalid_before`, the replay semantics (`remaining` and `on_outage` from current state), `warnings` from `warn_at`, and `GET` pagination with `next`. Where Tasks 4–8 already test a row, don't duplicate it; list the existing test in the table in `MUTATION-SUMMARY.md`.
- [ ] **Step 3: Stryker.** Configure it over every file in `worker/src` except `env.d.ts`. Use `coverageAnalysis: 'off'`, because per-test coverage can't report back from workerd; `concurrency: 4`, `timeoutMS: 60000`, `ignoreStatic: true`, the clear-text and html reporters (`reports/mutation/index.html`), and `incremental: true`. If `tenant.ts` mutants come back as NoCoverage even with coverage off, move the ledger arithmetic (`#applicable`, the limit comparison, `#reply`'s tightest-limit and `warn_at` logic, and `#backfill`'s summing) into pure functions in `worker/src/ledger.ts` that take rows rather than `SqlStorage`. `TenantDO` then calls them, they are unit-tested directly, and they are mutated.
- [ ] **Step 4: Kill survivors to the phase gate.** For every surviving mutant, add the test that kills it or record it as equivalent. Re-run until the gates hold.
- [ ] **Step 5: Commit** `Cover the Worker to the mutation gate`.

### Task 24: `testServer()`, the real ledger in memory (runs after Task 17)

Added 2026-09-24 at Robin's request, so users can test against Solenoid reliably and so this repo's own SDK and CLI suites stop starting `wrangler dev`. It is numbered 24 because it was added mid-execution, but it runs directly after Task 17 and before Task 18.

**Why not MSW handlers:** handlers would be a second implementation of the ledger's windows, per-child limits, ancestor checks, idempotency and hold-and-settle, and would drift from the Worker without anyone noticing. The Durable Object stores everything in SQLite, and Node 22.5+ ships `node:sqlite`, so the same code runs in memory with no second implementation and no dependency.

**Files:**
- Create: `worker/src/core.ts` (the tenant logic behind a small storage interface), `worker/src/router.ts` (the HTTP handler taking a tenant lookup), `sdk/src/testing.ts`, `sdk/test/testing.test.ts`, `contract/scenarios.ts` (shared scenarios)
- Modify: `worker/src/tenant.ts` (a thin `DurableObject` wrapper over `core.ts`), `worker/src/index.ts` (delegates to `router.ts`), `sdk/package.json` (an exports entry `./testing` and a build step for `dist/testing.mjs`), `sdk/README.md` and `sdk/llms.txt` (a Testing section)

- [ ] **Step 1: Split storage from logic.** Define `type Sql = { exec(query: string, ...params: unknown[]): { toArray(): Record<string, any>[]; one(): Record<string, any> }; transactionSync<T>(fn: () => T): T }`. Move everything in `TenantDO` except the `DurableObject` plumbing into `class Tenant` in `core.ts`, which takes `(sql: Sql, env, now)`. `TenantDO` constructs one over `ctx.storage.sql` and forwards each RPC method. `core.ts` must not import `cloudflare:workers`. The whole worker suite must pass unchanged. That is the proof the split changed nothing.
- [ ] **Step 2: Split the router.** Move the fetch handler into `router.ts` as `handle(request, env, tenantFor: (id) => TenantApi)`. `index.ts` passes the Durable Object stub lookup. The worker suite must pass unchanged.
- [ ] **Step 3: `testServer()`.** In `sdk/src/testing.ts`, build a `node:sqlite` `DatabaseSync(':memory:')` per tenant, wrapped in the `Sql` interface, with `Tenant` from `worker/src/core.ts` and `handle` from `router.ts`. esbuild bundles all of it into `sdk/dist/testing.mjs`. It exports `testServer(opts?)`, which returns:
  - `fetch(input, init)`: a `fetch`-compatible function to pass as `solenoid({ fetch })`
  - `api`: the base URL the fetch answers, e.g. `http://solenoid.test`
  - `signup()`: `{ tenant, admin_key }`, with no rate limit
  - `setNow(ms)`: moves the ledger clock, for window tests
  - `outage(on: boolean)`: while on, `fetch` rejects like a network failure, so `on_outage` behaviour can be tested
  
  It generates the signing key and MASTER at construction. `verify` and `verifyChain` work against its `/.well-known/solenoid.json`. It needs Node 22.5 or later (the SDK itself stays Node 20+): state this in the entry and throw a clear error on older Node.
- [ ] **Step 4: Contract tests.** Put the scenarios in `contract/scenarios.ts`, written once against a `{ fetch, api, signup }` target:
  - exactly L of N concurrent spends succeed
  - an ancestor limit blocks
  - `per: child`
  - window rollover (skipped for targets without `setNow`)
  - an idempotent replay, and a 409 on conflict
  - a hold and settle via `at().llm`
  - `verifyChain`
  - a 401 after rotation
  - an open outage returns `null`, and a closed one throws `SolenoidUnavailable`
  
  Run them against `testServer()` in `sdk/test/testing.test.ts`, and against the real Worker in Task 20's e2e suite. The two must agree.
- [ ] **Step 5: Move our own suites onto it.** Point the SDK's `live.test.ts` scenarios and the CLI's command tests at `testServer()` via `SOLENOID_API` or an injected fetch, and drop their `wrangler dev` global setup. Task 20 keeps one real-Worker suite. Pre-commit hook latency should drop. Record before and after timings.
- [ ] **Step 6: Docs.** Add a short Testing section to `sdk/README.md` and `sdk/llms.txt`. Show `testServer()` with vitest or `node:test`, and the one-line MSW adapter `http.all(`${server.api}/*`, ({ request }) => server.fetch(request))`. Include `setNow` and `outage`. The new text goes through the cold copy-chief gate (Gate 0 and V4, plus a C2 pass).
- [ ] **Step 7: Commit** `Ship testServer(): the real ledger in memory for tests`.

Tasks 18–20 then build on it: Task 18 mutates `sdk/src/testing.ts` too, Task 19's CLI tests use `testServer()`, and Task 20 runs `contract/scenarios.ts` against the real Worker.

---

### Task 18: SDK coverage, property tests and mutation testing

**Files:**
- Create: `sdk/stryker.config.mjs`
- Modify: `sdk/package.json` (devDependencies `@stryker-mutator/core`, `@stryker-mutator/vitest-runner`, `@vitest/coverage-v8` and `fast-check`; a `coverage` script; `mutate` script), `sdk/vitest.config.ts`
- Test: new and extended files under `sdk/test/`

- [ ] **Step 1: Coverage** with v8 over `sdk/src/**`. Add the table to `MUTATION-SUMMARY.md`.
- [ ] **Step 2: Property tests (fast-check).**
  - `ceilMicro`: the result is ≥ the input, less than the input plus one micro-unit, a whole number of micro-units, and exact for inputs that already have six decimals.
  - The `max_tokens` cap arithmetic: `cap ≤ requested`, and `input + cap ≤ remaining` whenever the call is allowed.
  - Scope validation: the SDK accepts exactly what the Worker's `parseScope` accepts. Generate segment strings, including `.`, `..`, `%2e` and uppercase, and compare the SDK's check against the grammar.
  - `verify` and `verifyChain`: any single-field tamper of any entry fails.
  - The outage decision: for any cache state, a closed or missing mode throws `SolenoidUnavailable`, and an open mode on the scope or its nearest cached ancestor allows the action.
- [ ] **Step 3: Unit tests at the transport boundary** for every branch in `http.ts`: timeout, a retry only for `GET` and idempotency-keyed `POST`, a 5xx, a network error, a 4xx that is never treated as an outage, and error-code-to-class mapping. For `llm.ts`: the hold, the settle, settle-to-zero when the provider throws, both adapters (OpenAI and Anthropic shapes), `max_completion_tokens`, `unknown_price`, and the cache merge rule.
- [ ] **Step 4: Stryker** over every file in `sdk/src` except the type-only `types.ts`: vitest runner, `coverageAnalysis: 'perTest'` (the SDK runs in Node), and the same reporters and thresholds as Task 17. The live tests need a local Worker, so exclude them from the mutation run with a `STRYKER` env guard or a separate vitest project, and say which in `MUTATION-SUMMARY.md`. Kill survivors to the phase gate.
- [ ] **Step 5: Commit** `Cover the SDK to the mutation gate`.

### Task 19: CLI coverage and mutation testing

**Files:**
- Create: `cli/stryker.config.mjs`
- Modify: `cli/package.json`, `cli/vitest.config.ts`
- Test: new and extended files under `cli/test/`

- [ ] **Step 1: Coverage** with v8 over `cli/src/**`.
- [ ] **Step 2: Tests for every command** in the Task 12 command list: `init` with and without a scope, and `--force`; `login`; `key`; `limit`, including `off`, `--per`, `--on-outage` and `--warn-at`; `ls`; `log --before`; `spend`; `rotate`, including the warning; and `upgrade`. Cover every argument error, and exit codes and stderr on API errors. Test the credentials file mode (0600) and `.env` handling: no trailing newline, an existing `SOLENOID_KEY`, a missing file and CRLF. Run commands against a temporary `HOME` and working directory; stub `fetch` only.
- [ ] **Step 3: Stryker** over every file in `cli/src`, with the same settings as Task 18. Kill survivors to the phase gate.
- [ ] **Step 4: Commit** `Cover the CLI to the mutation gate`.

### Task 20: End-to-end contract tests

**Files:**
- Create: `e2e/{package.json,vitest.config.ts,global-setup.ts}`, `e2e/test/*.test.ts`
- Modify: `pnpm-workspace.yaml` (add `e2e`)

- [ ] **Step 1:** In the global setup, start the Worker locally with wrangler's `unstable_dev` (or `wrangler dev` on a free port), with test `MASTER` and `SIGNING_KEY` values, and point `SOLENOID_API` at it.
- [ ] **Step 2: Scenarios through the real binaries** (the built CLI via `node cli/dist/…`, and the SDK bundle `sdk/dist/solenoid.mjs`), with no stubs except the LLM provider:
  - `init` → `limit` → `spend`, until `402`.
  - Derive a spend key → spend at scope → spend out of scope gets `403`.
  - Rotate a scope → the old spend key gets `401`.
  - Rotate the admin key → every old key gets `401`.
  - N concurrent SDK spends against limit L → exactly L succeed.
  - `run.llm` hold and settle against a `tokens` limit, with concurrent calls unable to overshoot.
  - A `per: "child"` at-most-once pattern.
  - `verifyChain` over `GET` entries after a mixed sequence.
  - A signup rate limit, if it can be driven locally.
- [ ] **Step 3:** Add `e2e` to the root `test` script, but leave it out of any mutation run.
- [ ] **Step 4: Commit** `Test the CLI, SDK and Worker end to end`.

### Task 21: learning-loop mutation coverage (branch `solenoid-fetch-budget`)

**Files (in `<vault>/learning-loop`):**
- Create: `stryker.fetch-budget.json`, `stryker.model-client.json`
- Modify: `package.json` (append both to `test:mutation`), tests under `tests/` as needed

- [ ] **Step 1:** Follow the existing `stryker.file-lock.json` shape: the `command` runner over the covering `node --test` files, a json reporter to `reports/mutation/<name>.json`, `coverageAnalysis: 'off'` and `tempDirName: '.stryker-tmp'`. Mutate `plugin/scripts/lib/fetch-budget.mjs` and the budget branch of `plugin/scripts/lib/model-client.mjs`. If only part of `model-client.mjs` is new, mutate the whole file, but gate only on the lines Task 16 added.
- [ ] **Step 2:** Kill survivors to the phase gate. The `tryBump` allow and deny decision and the scope-segment mapping are reject paths.
- [ ] **Step 3: Commit** on `solenoid-fetch-budget`: `Mutation-test the Solenoid fetch budget and verify spend`.

---

### Task 22: Move `api.solenoid.systems` to the new Worker

**This task needs Robin's explicit go-ahead before Step 2.** It takes the hostname away from the old gateway.

**Files:**
- Modify: `worker/wrangler.jsonc` (add `routes`)

- [ ] **Step 1: Prepare the route**

Add to `worker/wrangler.jsonc`:
```jsonc
  "routes": [{ "pattern": "api.solenoid.systems", "custom_domain": true }]
```

- [ ] **Step 2: With Robin's confirmation, move the hostname**

In `~/dev/solenoid.systems/api/gateway/wrangler.jsonc`, delete the `api.solenoid.systems` route and run `pnpm exec wrangler deploy` there. Then run `pnpm exec wrangler deploy` in `~/dev/solenoid/worker`. If wrangler offers to take over the custom domain, accept. Confirm in the dashboard that the domain now points at the `solenoid` Worker.

- [ ] **Step 3: Verify, then drop the override**

```bash
curl -s https://api.solenoid.systems/.well-known/solenoid.json | jq -e '.keys.k1.crv == "Ed25519"'
```
Expected: `true`. Both hostnames serve the same Worker, so existing keys stay valid. Remove `SOLENOID_API` from Robin's shell profile and from Claude Code's `env` block, then run `solenoid ls learning-loop` to confirm the default hostname works.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Serve api.solenoid.systems from the new Worker"
```
