# Solenoid Plan 2: Email Recovery and MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tenant attach a recovery email and get its admin key back by email, and ship `@solenoid.systems/mcp` 2.0.0 as a thin, dependency-free MCP server over the SDK.

**Architecture:**
- **State.** Recovery state lives in TenantDO, like everything else: the verified email, hashed single-use codes, and a per-email send counter. The Worker sends every email itself, through an injected `Mailer`, so no network await ever runs inside the Durable Object.
- **Recovery.** Recovery re-derives the current admin key from `(tenant, gen)`. With `rotate`, it first bumps `gen` and writes a `rotate` chain entry.
- **MCP.** The MCP server is a hand-rolled JSON-RPC 2.0 loop over stdio. It is bundled with esbuild, like the CLI, and calls only the SDK.

**Tech Stack:**
- TypeScript on Cloudflare Workers, with a Durable Object on SQLite.
- `@cloudflare/vitest-pool-workers` for the Worker's tests.
- The Node SDK and CLI tested with vitest against `testServer()`.
- Resend's HTTP API, reached with a plain `fetch`.
- Stryker, per package.

**Spec:** `docs/superpowers/specs/2026-09-24-solenoid-governance-design.md`. Its sections "Signup and recovery", "CLI", "MCP", "Testing" and "Migration" are the ones this plan implements. Plan 1's record of rulings is `docs/superpowers/plans/2026-09-24-solenoid-core.record.md`.

## Global Constraints

- Repository `~/dev/solenoid`, pnpm workspace. This plan adds the package `mcp/` to `pnpm-workspace.yaml` (`packages: [worker, sdk, cli, mcp, e2e]`).
- **Zero runtime dependencies** in the Worker, SDK, CLI and MCP. The CLI and MCP bundle the SDK with esbuild.
- `wrangler.jsonc` `compatibility_date` is `2026-08-01`. Worker TypeScript uses `"lib": ["ES2022"]` (no DOM). Values that cross RPC use `Record<string, any>`, not `unknown`, and are declared with `type`, not `interface`.
- DO RPC methods return `Result` objects and never throw across RPC. Private DO members use `#private`, so RPC cannot reach them.
- Tenant IDs match `^[a-z2-7]{12}$`. The ops tenant is `solenoidops2`.
- Admin key: `sk.admin.{tenant}.{gen}.{hex secret}`, `secret = hex(HMAC-SHA256(MASTER, "admin:{tenant}:{gen}"))`.
- A limit that has run out is `402`, never `429`. `429 rate_limited` is only for signup, email and recovery.
- Codes: 6 digits, valid for 15 minutes, single-use, stored as an HMAC under `MASTER`. At most 5 code requests per email per hour, at most 10 attach codes per tenant per day, up to 3 live codes per `(purpose, email)`, and redemption locked after 5 failures in an hour or 10 in a day. These tighten the spec's "Abuse limits" (decision 9); Task 6 amends the spec to match.
- `/auth/recover` always answers `202` to a code request, whether or not the email matches (spec).
- "The fragile step goes first": the code is stored, then the email is sent. A failed send on `/auth/email` returns `502`, and the stored code simply expires (spec).
- The SDK is the only code that speaks HTTP to Solenoid. The CLI and MCP call the SDK.
- SDK: 2,000 ms timeout; one retry, only for `GET` and idempotency-keyed `POST`. The `/auth` POSTs carry no idempotency key and are never retried. `/auth/email` and `/auth/recover` get a 10,000 ms timeout, because the Worker waits up to 5,000 ms for Resend. A `502` whose body is `{"error":"email_failed"}` is a `SolenoidError`, not an outage.
- **Frozen copy.** Tests match only these parts of reader-facing strings:
  - the 6-digit code, the tenant ID and the email address;
  - the command names `solenoid email`, `solenoid recover` and `solenoid init`;
  - the flags `--tenant`, `--force`, `--rotate` and `--email`;
  - the error codes.

  A copy gate may change any other wording. If a copy fix changes a string a test matches, update the test, then re-run the task's suites and its mutation gate.
- **Mutation runs** use each package's own script, `pnpm run mutate --force`. That script sets `STRYKER=1`, and in the CLI and MCP it also sets a sandboxed `HOME`. Never use `pnpm exec stryker run`.
- **Build order.** The CLI, MCP and e2e typechecks read the SDK's types from `sdk/dist`, which is git-ignored. After any SDK change, run `pnpm --filter @solenoid.systems/sdk build` before typechecking those packages.
- **Phase gates carried from Plan 1:**
  - 100% of lines and at least 95% of branches in every mutated file.
  - Stryker `thresholds: { high: 95, low: 90, break: 90 }`.
  - Zero surviving mutants on any path that rejects or limits something.
  - Record other survivors as equivalent, with the reason, in `docs/testing/MUTATION-SUMMARY.md`.
  - Redundant defensive guards stay in the code, and their mutants are recorded as equivalent (Robin's ruling).
- **Test rules:**
  - Mock only at the boundary. The boundaries here are Resend (the `Mailer`), `fetch` inside SDK unit tests, and the OS home directory. Never mock a Solenoid module.
  - No test may read or write the real `~/.config/solenoid` or `~/.cache/solenoid`. Sandbox HOME explicitly, because Stryker's worker threads ignore `vi.stubEnv('HOME')`.
- All reader-facing text follows `docs/copy/brief.md` and passes a cold `/copy-chief` diagnostic before its commit. That covers READMEs, `llms.txt`, CLI output, MCP tool descriptions and email bodies. Graders are dispatched as plain `copy-grader` subagents with the draft pasted inline.
- Commit messages: no attribution lines, no co-author tags. Commit through lefthook; never `--no-verify`.

## Decisions this plan makes (argued from the spec)

1. **Sends happen in the Worker, not in TenantDO.** The DO issues a code and returns it to the Worker, which mails it. The spec expected the lock to become load-bearing with Plan 2's email sends. It stays not load-bearing in workerd because the DO never awaits the network. The new code methods still run under `#serial`, because under `testServer()` in Node the WebCrypto awaits do interleave (Task 2 Step 7 pins this).
2. **`/auth/recover`'s code request mails from `waitUntil`, after the `202`.** The spec's `502` on a failed send applies to `/auth/email` only. If recovery awaited the send, the response time would reveal whether the email matched.
3. **New error codes:** `400 invalid_request` (a malformed `/auth` body), `400 invalid_email`, `400 invalid_code`, and `502 email_failed`. Task 6 adds them to the spec's Errors table.
4. **A per-IP limit on `/auth/recover`.** It reuses signup's mechanism: a spend of `{ recoveries: 1 }` at `recoveries/{ip hash}` in the ops tenant, and a `402` there becomes `429`. It bounds code guessing across emails, and bounds the creation of empty DOs for unknown tenant IDs.
5. **The recovery email is not written to the chain.** The chain is signed and meant to be shared, and an email is personal data. A recovery with `rotate` writes a `rotate` entry with body `{ "rotate_admin": true, "recovery": true }`.
6. **The CLI's `recover` takes the email first and infers the tenant** from `--tenant`, then `SOLENOID_KEY` in the environment, then `SOLENOID_KEY` in `./.env`, then the saved credentials. The spec lists `recover <e>`, and someone who has lost the admin key usually still has a deployed spend key, which carries the tenant.
7. **The MCP speaks JSON-RPC over stdio by hand** (initialize, ping, tools/list, tools/call), with no MCP SDK dependency. It supports the protocol versions in `SUPPORTED` (Task 5). Its `rotate` tool rotates scope keys only; admin-key rotation stays in the CLI. Without `--admin` it refuses an admin key, because a governed agent is only ever given spend keys (spec, "MCP").
8. **Publishing is Plan 3.** Plan 2 builds and tests `@solenoid.systems/mcp` 2.0.0. Publishing it to npm and listing it in the MCP directories happen at cutover, with Robin. `npm view @solenoid.systems/mcp` returns 404 from this machine, so there may be no public 1.x to deprecate. Plan 3 checks that first.
9. **Abuse limits, tightened from the spec after the plan review:**
   - A tenant may send at most 10 attach codes a day, so `/auth/email` can't be used to mail strangers.
   - Up to 3 codes per `(purpose, email)` are valid at once, so a stranger's code request can't kill the owner's code.
   - Redemption locks after 5 failures an hour or 10 a day per `(purpose, email)`. That caps guessing at 10 a day, instead of the spec's 25 an hour.
   - Codes are stored as HMACs under `MASTER`, so the stored rows alone can't be reversed.
   - Changing the recovery address also mails the previous address.
   - Accepted residual risk: someone who knows both the tenant ID and the recovery email can hold recovery closed by failing on purpose. There is no global recovery cap, because it would let one actor switch recovery off for everyone.

## Review Focus

1. **Enumeration through recovery.** For a matching and a mismatching `{tenant, email}`, `/auth/recover` must return the same status and body, and neither may wait on the email send. Task 2 tests this with a mailer that never resolves.
2. **A double-submitted recovery.** Two concurrent `{tenant, email, code, rotate: true}` requests with the same code, for example a double-clicked `--rotate`, must rotate the admin key once. Exactly one succeeds, and `gen` goes from 1 to 2, never 3. Task 1 tests this.
3. **Case and whitespace in the email.** `" Robin@Example.COM "` attaches, and later recovers, as `robin@example.com`. The code is bound to the normalized address. Tasks 1 and 2 test this.
4. **A failed send never attaches anything and never locks the user out.** The response is `502 email_failed`. The next request, with the mailer back up, returns `202` with a code that works. Task 2 tests this.
5. **The MCP server survives bad input and keeps stdout clean.** A malformed line, a notification or an unknown method never stops it, and nothing but JSON-RPC ever reaches stdout. Startup errors go to stderr with exit code 1. Task 5 tests this.

---

### Task 1: Recovery codes and email in the ledger

**Files:**
- Create: `worker/src/codes.ts`, `worker/test/codes.test.ts`, `worker/test/recovery.test.ts`
- Modify:
  - `worker/src/core.ts`: the schema, four methods, private helpers, `TenantApi`, and `TenantEnv` gains `MASTER`.
  - `worker/src/tenant.ts`: forward the four methods.

**Interfaces:**
- Produces (`worker/src/codes.ts`):
  - `type Purpose = 'attach' | 'recover'`
  - `CODE_TTL_MS`, `HOUR_MS`, `DAY_MS`, `MAX_SENDS_PER_HOUR`, `MAX_ATTACH_SENDS_PER_DAY`, `MAX_LIVE_CODES`, `MAX_FAILS_PER_HOUR`, `MAX_FAILS_PER_DAY`, `CODE_RE`
  - `normalizeEmail(raw: unknown): string | null`
  - `newCode(): string`
  - `hashCode(master: string, purpose: Purpose, email: string, code: string): Promise<string>`
- Produces (on `Tenant` and `TenantDO`; every email argument is already normalized):
  - `attachStart(auth: Auth, email: string): Promise<Result<{ code: string }>>`
  - `attachVerify(auth: Auth, email: string, code: string): Promise<Result<{ email: string; previous: string | null }>>`. `previous` is the recovery address this one replaced, or `null` if there was none or it was the same address.
  - `recoverStart(email: string): Promise<Result<{ code: string | null }>>`
  - `recoverFinish(email: string, code: string, rotate: boolean): Promise<Result<{ gen: number }>>`
  - `TenantApi` gains all four.
  - `TenantEnv` becomes `{ SIGNING_KEY: string; SIGNING_KID: string; MASTER: string }`. `TenantDO` already passes `Cloudflare.Env`, and `testServer()`'s env already has `MASTER`.

**The abuse rules this task implements.** They are the spec's "Abuse limits", tightened after the plan review (decision 9):
- A code request, for either purpose, counts against the email: at most 5 per hour.
- An `attach` request also counts against the tenant: at most 10 per day. This stops `/auth/email` being used to mail strangers.
- Up to 3 codes per `(purpose, email)` are valid at once. A new request adds a code and evicts only the oldest beyond three, so a stranger's request never kills the owner's code.
- Failed redemptions count per `(purpose, email)`. After 5 in an hour, or 10 in a day, every code for that pair is refused until the window passes. This caps guessing at 10 a day, which is about 0.4% over a year. The residual risk: someone who knows both the tenant ID and the recovery email can hold recovery closed by failing on purpose. That is accepted and documented in Task 6.
- Codes are stored as `hex(HMAC-SHA256(MASTER, "code:{purpose}:{email}:{code}"))`, so the stored rows alone can't be reversed.
- Expired codes, and events older than a day, are pruned whenever a send or a redemption runs.

- [ ] **Step 1: Write the failing unit tests for `codes.ts`**

`worker/test/codes.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CODE_RE, hashCode, newCode, normalizeEmail } from '../src/codes'

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Robin@Example.COM ')).toBe('robin@example.com')
  })
  it('refuses what cannot be an address', () => {
    for (const bad of ['', 'a@b', 'a b@c.de', '@c.de', 'a@.de', 'a@@c.de', 'a@b..cd', 'a@b.cd.', 'a@b.c', 'a\u0000b@c.de', 'a@b_c.de', 42, null, undefined, {}]) {
      expect(normalizeEmail(bad)).toBeNull()
    }
  })
  it('accepts up to 64 characters before the @ and 254 in all', () => {
    expect(normalizeEmail(`${'a'.repeat(64)}@${'b'.repeat(185)}.de`)).toBe(`${'a'.repeat(64)}@${'b'.repeat(185)}.de`)
    expect(normalizeEmail(`${'a'.repeat(64)}@${'b'.repeat(186)}.de`)).toBe(`${'a'.repeat(64)}@${'b'.repeat(186)}.de`)
    expect(normalizeEmail(`${'a'.repeat(64)}@${'b'.repeat(187)}.de`)).toBeNull()
    expect(normalizeEmail(`${'a'.repeat(65)}@c.de`)).toBeNull()
  })
})

describe('newCode', () => {
  afterEach(() => vi.restoreAllMocks())
  it('is six digits, and draws again above the unbiased range', () => {
    for (let i = 0; i < 500; i++) expect(newCode()).toMatch(CODE_RE)
    const draws = [4_294_000_000, 4_294_967_295, 5]
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((a: Uint32Array) => { a[0] = draws.shift()!; return a }) as typeof crypto.getRandomValues)
    expect(newCode()).toBe('000005')
    expect(draws).toEqual([])
  })
})

describe('hashCode', () => {
  it('binds the key, the purpose, the email and the code', async () => {
    const h = await hashCode('m', 'attach', 'a@b.cd', '123456')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    for (const other of [
      hashCode('n', 'attach', 'a@b.cd', '123456'),
      hashCode('m', 'recover', 'a@b.cd', '123456'),
      hashCode('m', 'attach', 'x@b.cd', '123456'),
      hashCode('m', 'attach', 'a@b.cd', '123457'),
    ]) expect(await other).not.toBe(h)
  })
})
```

If `vi.spyOn(crypto, 'getRandomValues')` doesn't take effect inside workerd, pin the rejection branch another way: export `drawFrom(next: () => number): string` from `codes.ts`, with `newCode = () => drawFrom(() => crypto.getRandomValues(new Uint32Array(1))[0])`, and test `drawFrom` with a scripted sequence. Say in the report which of the two was used.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd worker && pnpm vitest run test/codes.test.ts`
Expected: FAIL, because `../src/codes` does not exist.

- [ ] **Step 3: Implement `worker/src/codes.ts`**

```ts
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
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `cd worker && pnpm vitest run test/codes.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing ledger tests**

`worker/test/recovery.test.ts`:
```ts
import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { Auth } from '../src/auth'
import type { TenantDO } from '../src/tenant'
import { ADMIN, setNow, tenant, type Stub } from './helpers'

const SPEND: Auth = { kind: 'spend', gen: 1, epoch: 0, keyScope: 'acme' }
const EMAIL = 'robin@example.com'
const T0 = Date.UTC(2026, 8, 28, 10)
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const wrongFor = (c: string) => (c === '000000' ? '000001' : '000000')
const meta = (stub: Stub, k: string) =>
  runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => s.storage.sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray()[0]?.v as string | undefined)

async function code(r: Promise<{ ok: boolean; value?: { code: string | null } }>): Promise<string> {
  const x = await r
  if (!x.ok || !x.value?.code) throw new Error(`no code: ${JSON.stringify(x)}`)
  return x.value.code
}

async function attached(stub: Stub, email = EMAIL) {
  const c = await code(stub.attachStart(ADMIN, email))
  const r = await stub.attachVerify(ADMIN, email, c)
  if (!r.ok) throw new Error(`attach failed: ${r.error}`)
  return r.value
}

describe('attaching a recovery email', () => {
  it('needs the admin key and a current generation', async () => {
    const stub = await tenant()
    expect(await stub.attachStart(SPEND, EMAIL)).toMatchObject({ ok: false, status: 403, error: 'admin_required' })
    expect(await stub.attachStart({ ...ADMIN, gen: 2 }, EMAIL)).toMatchObject({ ok: false, status: 401, error: 'invalid_key' })
    expect(await stub.attachVerify(SPEND, EMAIL, '000000')).toMatchObject({ ok: false, status: 403, error: 'admin_required' })
  })

  it('attaches only with the right code, once, and reports the address it replaced', async () => {
    const stub = await tenant()
    const c = await code(stub.attachStart(ADMIN, EMAIL))
    expect(c).toMatch(/^[0-9]{6}$/)
    expect(await stub.attachVerify(ADMIN, EMAIL, wrongFor(c))).toMatchObject({ ok: false, status: 400, error: 'invalid_code' })
    expect(await stub.attachVerify(ADMIN, 'other@example.com', c)).toMatchObject({ ok: false, error: 'invalid_code' })
    expect(await stub.attachVerify(ADMIN, EMAIL, c)).toEqual({ ok: true, value: { email: EMAIL, previous: null } })
    expect(await stub.attachVerify(ADMIN, EMAIL, c)).toMatchObject({ ok: false, error: 'invalid_code' })
    expect(await attached(stub, EMAIL)).toEqual({ email: EMAIL, previous: null })
    expect(await attached(stub, 'new@example.com')).toEqual({ email: 'new@example.com', previous: EMAIL })
    expect(await meta(stub, 'recovery_email')).toBe('new@example.com')
  })

  it('accepts a code up to 15 minutes old, and not at 15 minutes', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    const c = await code(stub.attachStart(ADMIN, EMAIL))
    await setNow(stub, T0 + 15 * 60_000 - 1)
    expect(await stub.attachVerify(ADMIN, EMAIL, c)).toMatchObject({ ok: true })
    await setNow(stub, T0)
    const d = await code(stub.attachStart(ADMIN, EMAIL))
    await setNow(stub, T0 + 15 * 60_000)
    expect(await stub.attachVerify(ADMIN, EMAIL, d)).toMatchObject({ ok: false, error: 'invalid_code' })
  })

  it('keeps the three newest codes valid', async () => {
    const stub = await tenant()
    const [c1, c2, c3, c4] = [await code(stub.attachStart(ADMIN, EMAIL)), await code(stub.attachStart(ADMIN, EMAIL)), await code(stub.attachStart(ADMIN, EMAIL)), await code(stub.attachStart(ADMIN, EMAIL))]
    if (![c2, c3, c4].includes(c1)) expect(await stub.attachVerify(ADMIN, EMAIL, c1)).toMatchObject({ ok: false, error: 'invalid_code' })
    expect(await stub.attachVerify(ADMIN, EMAIL, c2)).toMatchObject({ ok: true })
    expect(await stub.attachVerify(ADMIN, EMAIL, c4)).toMatchObject({ ok: true })
    expect(await stub.attachVerify(ADMIN, EMAIL, c3)).toMatchObject({ ok: true })
  })

  it('stops accepting any code after 5 wrong tries in an hour or 10 in a day', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    const c = await code(stub.attachStart(ADMIN, EMAIL))
    for (let i = 0; i < 5; i++) expect(await stub.attachVerify(ADMIN, EMAIL, wrongFor(c))).toMatchObject({ ok: false })
    expect(await stub.attachVerify(ADMIN, EMAIL, c)).toMatchObject({ ok: false, error: 'invalid_code' })
    await setNow(stub, T0 + HOUR)
    const d = await code(stub.attachStart(ADMIN, EMAIL))
    for (let i = 0; i < 4; i++) expect(await stub.attachVerify(ADMIN, EMAIL, wrongFor(d))).toMatchObject({ ok: false })
    expect(await stub.attachVerify(ADMIN, EMAIL, d)).toMatchObject({ ok: true })
    await setNow(stub, T0 + 2 * HOUR)
    const e = await code(stub.attachStart(ADMIN, EMAIL))
    expect(await stub.attachVerify(ADMIN, EMAIL, wrongFor(e))).toMatchObject({ ok: false })
    expect(await stub.attachVerify(ADMIN, EMAIL, e)).toMatchObject({ ok: false, error: 'invalid_code' })
    await setNow(stub, T0 + DAY + 1)
    const f = await code(stub.attachStart(ADMIN, EMAIL))
    expect(await stub.attachVerify(ADMIN, EMAIL, f)).toMatchObject({ ok: true })
  })

  it('allows five code requests per email per hour, across both purposes', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    await attached(stub)
    for (let i = 0; i < 2; i++) expect(await stub.attachStart(ADMIN, EMAIL)).toMatchObject({ ok: true })
    for (let i = 0; i < 2; i++) expect(await stub.recoverStart(EMAIL)).toMatchObject({ ok: true })
    expect(await stub.recoverStart(EMAIL)).toMatchObject({ ok: false, status: 429, error: 'rate_limited' })
    expect(await stub.attachStart(ADMIN, EMAIL)).toMatchObject({ ok: false, status: 429 })
    expect(await stub.attachStart(ADMIN, 'other@example.com')).toMatchObject({ ok: true })
    await setNow(stub, T0 + HOUR)
    expect(await stub.attachStart(ADMIN, EMAIL)).toMatchObject({ ok: true })
  })

  it('allows ten attach codes per tenant per day, whatever the addresses', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    for (let i = 0; i < 10; i++) expect(await stub.attachStart(ADMIN, `u${i}@example.com`)).toMatchObject({ ok: true })
    expect(await stub.attachStart(ADMIN, 'u10@example.com')).toMatchObject({ ok: false, status: 429, error: 'rate_limited' })
    await setNow(stub, T0 + DAY)
    expect(await stub.attachStart(ADMIN, 'u10@example.com')).toMatchObject({ ok: true })
  })
})

describe('recovering the admin key', () => {
  it('returns no code for an email that is not the recovery address', async () => {
    const stub = await tenant()
    await attached(stub)
    expect(await stub.recoverStart('stranger@example.com')).toEqual({ ok: true, value: { code: null } })
  })

  it('answers an uninitialised tenant with no code and no rate limit', async () => {
    const empty = env.TENANT.get(env.TENANT.idFromName(crypto.randomUUID()))
    for (let i = 0; i < 6; i++) expect(await empty.recoverStart(EMAIL)).toEqual({ ok: true, value: { code: null } })
    expect(await empty.recoverFinish(EMAIL, '123456', false)).toMatchObject({ ok: false, status: 400, error: 'invalid_code' })
  })

  it('re-derives the current generation without rotating, and rotates once with rotate', async () => {
    const stub = await tenant()
    await attached(stub)
    const c = await code(stub.recoverStart(EMAIL))
    expect(await stub.recoverFinish(EMAIL, c, false)).toEqual({ ok: true, value: { gen: 1 } })
    expect((await stub.get(ADMIN, '')).ok).toBe(true)
    const r = await code(stub.recoverStart(EMAIL))
    expect(await stub.recoverFinish(EMAIL, r, true)).toEqual({ ok: true, value: { gen: 2 } })
    expect(await stub.get(ADMIN, '')).toMatchObject({ ok: false, status: 401, error: 'invalid_key' })
    const v = await stub.get({ ...ADMIN, gen: 2 }, '')
    if (!v.ok) throw new Error('get failed')
    expect(v.value.entries[0]).toMatchObject({ kind: 'rotate', scope: '', body: { rotate_admin: true, recovery: true } })
    expect(await meta(stub, 'nonspend_month')).toBe('1')
  })

  it('refuses a recovery code for an email that is no longer the recovery address', async () => {
    const stub = await tenant()
    await attached(stub)
    const c = await code(stub.recoverStart(EMAIL))
    await attached(stub, 'new@example.com')
    expect(await stub.recoverFinish(EMAIL, c, false)).toMatchObject({ ok: false, error: 'invalid_code' })
  })

  it('rotates once when the same code arrives twice at once', async () => {
    const stub = await tenant()
    await attached(stub)
    const c = await code(stub.recoverStart(EMAIL))
    const both = await Promise.all([stub.recoverFinish(EMAIL, c, true), stub.recoverFinish(EMAIL, c, true)])
    expect(both.filter((r) => r.ok)).toEqual([{ ok: true, value: { gen: 2 } }])
    expect((await stub.get({ ...ADMIN, gen: 2 }, '')).ok).toBe(true)
  })
})
```

- [ ] **Step 6: Run them to verify they fail**

Run: `cd worker && pnpm vitest run test/recovery.test.ts`
Expected: FAIL. The RPC call fails because `TenantDO` does not implement `attachStart`: workerd reports that the RPC receiver does not implement the method.

- [ ] **Step 7: Implement the ledger side**

Make these changes in `worker/src/core.ts`.

Add the import:
```ts
import { CODE_TTL_MS, DAY_MS, HOUR_MS, MAX_ATTACH_SENDS_PER_DAY, MAX_FAILS_PER_DAY, MAX_FAILS_PER_HOUR, MAX_LIVE_CODES, MAX_SENDS_PER_HOUR, hashCode, newCode, type Purpose } from './codes'
```

Change `TenantEnv` to `{ SIGNING_KEY: string; SIGNING_KID: string; MASTER: string }`.

Append two statements to `SCHEMA`:
```ts
  'CREATE TABLE IF NOT EXISTS codes (purpose TEXT NOT NULL, email TEXT NOT NULL, hash TEXT NOT NULL, expires INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS code_events (kind TEXT NOT NULL, purpose TEXT NOT NULL, email TEXT NOT NULL, at INTEGER NOT NULL)',
```

Widen `TenantApi`:
```ts
export type TenantApi = Pick<Tenant, 'init' | 'spend' | 'settle' | 'put' | 'get' | 'attachStart' | 'attachVerify' | 'recoverStart' | 'recoverFinish'>
```

Add these public methods after `get`:
```ts
  attachStart(auth: Auth, email: string): Promise<Result<{ code: string }>> {
    return this.#serial(async () => {
      const denied = this.#authorize(auth, '', 'admin')
      if (denied) return denied
      const now = this.#now()
      const throttled = this.#countSend('attach', email, now)
      if (throttled) return throttled
      return ok({ code: await this.#storeCode('attach', email, now) })
    })
  }

  attachVerify(auth: Auth, email: string, code: string): Promise<Result<{ email: string; previous: string | null }>> {
    return this.#serial(async () => {
      const denied = this.#authorize(auth, '', 'admin')
      if (denied) return denied
      if (!(await this.#redeem('attach', email, code, this.#now()))) return fail(400, 'invalid_code')
      const prior = this.#meta('recovery_email')
      this.#setMeta('recovery_email', email)
      return ok({ email, previous: prior && prior !== email ? prior : null })
    })
  }

  recoverStart(email: string): Promise<Result<{ code: string | null }>> {
    return this.#serial(async () => {
      if (!this.#meta('tenant')) return ok({ code: null })
      const now = this.#now()
      const throttled = this.#countSend('recover', email, now)
      if (throttled) return throttled
      if (this.#meta('recovery_email') !== email) return ok({ code: null })
      return ok({ code: await this.#storeCode('recover', email, now) })
    })
  }

  recoverFinish(email: string, code: string, rotate: boolean): Promise<Result<{ gen: number }>> {
    return this.#serial(async () => {
      if (!this.#meta('tenant') || this.#meta('recovery_email') !== email) return fail(400, 'invalid_code')
      const now = this.#now()
      if (!(await this.#redeem('recover', email, code, now))) return fail(400, 'invalid_code')
      if (rotate) {
        this.#rollMonth(now)
        const row = await this.#seal('rotate', '', { rotate_admin: true, recovery: true }, now, null, null)
        this.#sql.transactionSync(() => {
          this.#setMeta('gen', String(Number(this.#meta('gen')) + 1))
          this.#bumpNonspend()
          this.#writeEntry(row)
        })
        this.#head = { seq: row.seq, hash: row.hash }
      }
      return ok({ gen: Number(this.#meta('gen')) })
    })
  }
```

Add these private helpers next to `#meta`:
```ts
  #count(query: string, ...params: unknown[]): number {
    return this.#rows<{ n: number }>(query, ...params)[0].n
  }

  #prune(now: number): void {
    this.#sql.exec('DELETE FROM code_events WHERE at <= ?', now - DAY_MS)
    this.#sql.exec('DELETE FROM codes WHERE expires <= ?', now)
  }

  #countSend(purpose: Purpose, email: string, now: number): Fail | null {
    this.#prune(now)
    if (this.#count("SELECT count(*) AS n FROM code_events WHERE kind = 'send' AND email = ? AND at > ?", email, now - HOUR_MS) >= MAX_SENDS_PER_HOUR) return fail(429, 'rate_limited')
    if (purpose === 'attach' && this.#count("SELECT count(*) AS n FROM code_events WHERE kind = 'send' AND purpose = 'attach' AND at > ?", now - DAY_MS) >= MAX_ATTACH_SENDS_PER_DAY) return fail(429, 'rate_limited')
    this.#sql.exec("INSERT INTO code_events (kind, purpose, email, at) VALUES ('send', ?, ?, ?)", purpose, email, now)
    return null
  }

  async #storeCode(purpose: Purpose, email: string, now: number): Promise<string> {
    const code = newCode()
    this.#sql.exec('INSERT INTO codes (purpose, email, hash, expires) VALUES (?, ?, ?, ?)', purpose, email, await hashCode(this.#env.MASTER, purpose, email, code), now + CODE_TTL_MS)
    this.#sql.exec(
      'DELETE FROM codes WHERE purpose = ? AND email = ? AND rowid NOT IN (SELECT rowid FROM codes WHERE purpose = ? AND email = ? ORDER BY rowid DESC LIMIT ?)',
      purpose, email, purpose, email, MAX_LIVE_CODES,
    )
    return code
  }

  async #redeem(purpose: Purpose, email: string, code: string, now: number): Promise<boolean> {
    this.#prune(now)
    const fails = (since: number) => this.#count("SELECT count(*) AS n FROM code_events WHERE kind = 'fail' AND purpose = ? AND email = ? AND at > ?", purpose, email, since)
    if (fails(now - HOUR_MS) >= MAX_FAILS_PER_HOUR || fails(now - DAY_MS) >= MAX_FAILS_PER_DAY) return false
    const hash = await hashCode(this.#env.MASTER, purpose, email, code)
    const hit = this.#rows<{ id: number }>('SELECT rowid AS id FROM codes WHERE purpose = ? AND email = ? AND hash = ? AND expires > ?', purpose, email, hash, now)[0]
    if (hit) {
      this.#sql.exec('DELETE FROM codes WHERE rowid = ?', hit.id)
      return true
    }
    this.#sql.exec("INSERT INTO code_events (kind, purpose, email, at) VALUES ('fail', ?, ?, ?)", purpose, email, now)
    return false
  }
```

While locked out, a refused attempt adds no further `fail` event, so it doesn't extend the lock.

Forward the four methods in `worker/src/tenant.ts`:
```ts
  attachStart(...a: Parameters<Tenant['attachStart']>) { return this.#tenant.attachStart(...a) }
  attachVerify(...a: Parameters<Tenant['attachVerify']>) { return this.#tenant.attachVerify(...a) }
  recoverStart(...a: Parameters<Tenant['recoverStart']>) { return this.#tenant.recoverStart(...a) }
  recoverFinish(...a: Parameters<Tenant['recoverFinish']>) { return this.#tenant.recoverFinish(...a) }
```

- [ ] **Step 8: Run the worker suite and typecheck**

Run: `cd worker && pnpm typecheck && pnpm test`
Expected: PASS. The new tests pass, and all 234 existing tests still pass.

- [ ] **Step 9: Mutation gate**

Run: `cd worker && pnpm run mutate --force`. That runs the package's own `mutate` script, not `pnpm exec stryker`.
Expected: the score is at least 90. `codes.ts` and the new methods have zero survivors on reject paths: the hourly and daily send limits, the fail caps, expiry, the live-code eviction, email match, auth, and the uninitialised-tenant guard. The uninitialised-tenant guard is pinned by the six-call test. Kill survivors, or record equivalents in the Worker section of `docs/testing/MUTATION-SUMMARY.md`.

- [ ] **Step 10: Commit**

```bash
git add worker/src/codes.ts worker/src/core.ts worker/src/tenant.ts worker/test/codes.test.ts worker/test/recovery.test.ts docs/testing/MUTATION-SUMMARY.md
git commit -m "Store recovery codes and the recovery email in the tenant ledger"
```

---

### Task 2: `/auth/email` and `/auth/recover`

**Files:**
- Create: `worker/src/mail.ts`, `worker/src/ops.ts`, `worker/src/auth-routes.ts`, `worker/test/auth-routes.test.ts`, `worker/test/mail.test.ts`
- Modify:
  - `worker/src/router.ts`: use `ops.ts`, take `io`, and route `/auth/email` and `/auth/recover`.
  - `worker/src/index.ts`: build `io`.
  - `worker/src/env.d.ts`.
  - `worker/wrangler.jsonc`: the `MAIL_FROM` var.
  - `worker/vitest.config.mts`: pin `RESEND_API_KEY: ''` in the miniflare bindings, so a key in `.dev.vars` can never send real mail from tests.
  - `sdk/src/testing.ts`: pass `io`, and add `outbox()` and `mailDown()`.
  - `sdk/test/client.test.ts`: the four direct `handle(...)` calls, at lines 279, 302, 355 and 369, gain a stub `io`: `{ mail: async () => {}, waitUntil: () => {} }`.

**Interfaces:**
- Consumes: Task 1's four `TenantApi` methods, plus `normalizeEmail`, `CODE_RE`, `TENANT_RE` (from `keys.ts`) and `Purpose`.
- Produces:
  - `worker/src/mail.ts`:
    - `type Mail = { to: string; subject: string; text: string }`
    - `type Mailer = (m: Mail) => Promise<void>`
    - `resendMailer(apiKey: string | undefined, from: string, f?: typeof fetch): Mailer`
    - `codeMail(to: string, code: string, tenant: string, purpose: Purpose): Mail`
    - `confirmMail(to: string, tenant: string): Mail`
    - `changedMail(to: string, tenant: string): Mail`, sent to the previous recovery address when it is replaced.
  - `worker/src/router.ts`:
    - `type Io = { mail: Mailer; waitUntil(p: Promise<unknown>): void }`
    - `handle(req: Request, env: RouterEnv, tenantFor: TenantFor, io: Io): Promise<Response>` (a new required parameter)
  - `worker/src/ops.ts`: `OPS_TENANT`, `ipKey` (moved here and re-exported from `router.ts`), and `perIp(req, tenantFor, unit: 'signups' | 'recoveries'): Promise<Response | null>`
  - `sdk/src/testing.ts` `TestServer` gains `outbox(): Promise<Mail[]>` (it waits for pending `waitUntil` work first) and `mailDown(on: boolean): void`.
  - HTTP:
    - `POST /auth/email` with an admin key, body `{ email }`: `202 { email, status: "code_sent" }`
    - `POST /auth/email` with body `{ email, code }`: `200 { tenant, email }`
    - `POST /auth/recover` with body `{ tenant, email }`: `202 { status: "accepted" }`
    - `POST /auth/recover` with body `{ tenant, email, code, rotate? }`: `200 { tenant, admin_key }`
    - Errors: `400 invalid_request` (with `field` when one is known), `400 invalid_email`, `400 invalid_code`, `401 invalid_key`, `403 admin_required`, `429 rate_limited` and `502 email_failed`.

- [ ] **Step 1: Write the failing mail tests**

`worker/test/mail.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { codeMail, confirmMail, resendMailer } from '../src/mail'

describe('resendMailer', () => {
  it('posts one message to Resend with the key and the sender', async () => {
    const seen: { url: string; init: RequestInit }[] = []
    const f = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response('{"id":"x"}', { status: 200 }) }) as unknown as typeof fetch
    await resendMailer('re_key', 'Solenoid <auth@solenoid.systems>', f)({ to: 'a@b.cd', subject: 's', text: 't' })
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('https://api.resend.com/emails')
    expect(seen[0].init.method).toBe('POST')
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe('Bearer re_key')
    expect(JSON.parse(seen[0].init.body as string)).toEqual({ from: 'Solenoid <auth@solenoid.systems>', to: ['a@b.cd'], subject: 's', text: 't' })
  })
  it('throws when Resend refuses or no key is set', async () => {
    const refuse = (async () => new Response('no', { status: 422 })) as unknown as typeof fetch
    await expect(resendMailer('re_key', 'x', refuse)({ to: 'a@b.cd', subject: 's', text: 't' })).rejects.toThrow('HTTP 422')
    await expect(resendMailer(undefined, 'x', refuse)({ to: 'a@b.cd', subject: 's', text: 't' })).rejects.toThrow('RESEND_API_KEY')
  })
})

describe('message bodies', () => {
  it('put the code in the subject and the body, and name the account', () => {
    const m = codeMail('a@b.cd', '042917', 'abcdefghijkl', 'recover')
    expect(m.to).toBe('a@b.cd')
    expect(m.subject).toContain('042917')
    expect(m.text).toContain('042917')
    expect(m.text).toContain('abcdefghijkl')
    expect(codeMail('a@b.cd', '042917', 'abcdefghijkl', 'attach').text).not.toBe(m.text)
    expect(confirmMail('a@b.cd', 'abcdefghijkl').text).toContain('abcdefghijkl')
  })
})
```

- [ ] **Step 2: Write the failing route tests**

`worker/test/auth-routes.test.ts`:
```ts
import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TenantApi } from '../src/core'
import { adminKey, spendKey } from '../src/keys'
import type { Mail } from '../src/mail'
import { handle, type Io } from '../src/router'

let mails: Mail[] = []
let pending: Promise<unknown>[] = []
let mailDown = false
let neverSend = false
const io: Io = {
  mail: async (m) => {
    if (neverSend) return new Promise(() => {})
    if (mailDown) throw new Error('resend down')
    mails.push(m)
  },
  waitUntil: (p) => { pending.push(p) },
}
const tenantFor = (n: string) => env.TENANT.get(env.TENANT.idFromName(n)) as unknown as TenantApi
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  handle(new Request(`https://api.test${path}`, { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.7', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env, tenantFor, io)
const settled = async () => { await Promise.all(pending); pending = [] }
const codeIn = (m: Mail) => /\b(\d{6})\b/.exec(m.text)![1]

async function account() {
  const { tenant, admin_key } = (await (await post('/auth/signup', {})).json()) as { tenant: string; admin_key: string }
  return { tenant, admin_key, auth: { authorization: `Bearer ${admin_key}` } }
}

async function attach(a: Awaited<ReturnType<typeof account>>, email = 'robin@example.com') {
  expect((await post('/auth/email', { email }, a.auth)).status).toBe(202)
  const c = codeIn(mails.at(-1)!)
  expect((await post('/auth/email', { email, code: c }, a.auth)).status).toBe(200)
}

beforeEach(() => { mails = []; pending = []; mailDown = false; neverSend = false })

describe('POST /auth/email', () => {
  it('needs an admin key', async () => {
    const a = await account()
    expect((await post('/auth/email', { email: 'a@b.cd' })).status).toBe(401)
    const spend = await spendKey(a.admin_key, 'acme', 0)
    const r = await post('/auth/email', { email: 'a@b.cd' }, { authorization: `Bearer ${spend}` })
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ error: 'admin_required' })
  })

  it('refuses a malformed body, email or code', async () => {
    const a = await account()
    expect(await (await post('/auth/email', 'not json', a.auth)).json()).toEqual({ error: 'invalid_request' })
    expect(await (await post('/auth/email', [1], a.auth)).json()).toEqual({ error: 'invalid_request' })
    expect(await (await post('/auth/email', { email: 'nope' }, a.auth)).json()).toEqual({ error: 'invalid_email' })
    for (const code of ['12345', '1234567', 123456, 'abcdef']) {
      const r = await post('/auth/email', { email: 'a@b.cd', code }, a.auth)
      expect([r.status, await r.json()]).toEqual([400, { error: 'invalid_code' }])
    }
  })

  it('sends a code to the normalized address, attaches it with the code, then confirms by email', async () => {
    const a = await account()
    const r = await post('/auth/email', { email: ' Robin@Example.COM ' }, a.auth)
    expect([r.status, await r.json()]).toEqual([202, { email: 'robin@example.com', status: 'code_sent' }])
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toBe('robin@example.com')
    expect(mails[0].text).toContain(a.tenant)
    const v = await post('/auth/email', { email: 'ROBIN@example.com', code: codeIn(mails[0]) }, a.auth)
    expect([v.status, await v.json()]).toEqual([200, { tenant: a.tenant, email: 'robin@example.com' }])
    await settled()
    expect(mails).toHaveLength(2)
    expect(mails[1].to).toBe('robin@example.com')
    expect(mails[1].text).toContain(a.tenant)
  })

  it('tells the previous address when the recovery email changes, without naming the new one', async () => {
    const a = await account()
    await attach(a)
    await settled()
    mails = []
    await attach(a, 'new@example.com')
    await settled()
    const notice = mails.find((m) => m.to === 'robin@example.com')!
    expect(notice.text).toContain(a.tenant)
    expect(notice.text).not.toContain('new@example.com')
    expect(mails.map((m) => m.to).sort()).toEqual(['new@example.com', 'new@example.com', 'robin@example.com'])
  })

  it('answers 502 when the send fails, attaches nothing, and works on the next request', async () => {
    const a = await account()
    mailDown = true
    const r = await post('/auth/email', { email: 'robin@example.com' }, a.auth)
    expect([r.status, await r.json()]).toEqual([502, { error: 'email_failed' }])
    mailDown = false
    expect((await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com' })).status).toBe(202)
    await settled()
    expect(mails).toHaveLength(0)
    await attach(a)
  })

  it('answers 429 on the sixth code request for one email in an hour', async () => {
    const a = await account()
    for (let i = 0; i < 5; i++) expect((await post('/auth/email', { email: 'robin@example.com' }, a.auth)).status).toBe(202)
    const r = await post('/auth/email', { email: 'robin@example.com' }, a.auth)
    expect([r.status, await r.json()]).toEqual([429, { error: 'rate_limited' }])
  })
})

describe('POST /auth/recover', () => {
  it('answers the same 202 whether or not the email matches, without waiting for the send', async () => {
    const a = await account()
    await attach(a)
    await settled()
    mails = []
    neverSend = true
    const match = await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com' })
    const other = await post('/auth/recover', { tenant: a.tenant, email: 'stranger@example.com' })
    expect([match.status, await match.json()]).toEqual([202, { status: 'accepted' }])
    expect([other.status, await other.json()]).toEqual([202, { status: 'accepted' }])
    expect(pending).toHaveLength(1)
  })

  it('mails a code only to the recovery address', async () => {
    const a = await account()
    await attach(a)
    mails = []
    await post('/auth/recover', { tenant: a.tenant, email: 'stranger@example.com' })
    await post('/auth/recover', { tenant: a.tenant, email: 'Robin@Example.com' })
    await settled()
    expect(mails.map((m) => m.to)).toEqual(['robin@example.com'])
  })

  it('returns the current admin key, or a rotated one that revokes the old', async () => {
    const a = await account()
    await attach(a)
    await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com' })
    await settled()
    const same = await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com', code: codeIn(mails.at(-1)!) })
    expect([same.status, await same.json()]).toEqual([200, { tenant: a.tenant, admin_key: a.admin_key }])
    await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com' })
    await settled()
    const rotated = await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com', code: codeIn(mails.at(-1)!), rotate: true })
    const body = (await rotated.json()) as { admin_key: string }
    expect(body.admin_key).toBe(await adminKey(env.MASTER, a.tenant, 2))
    const old = await handle(new Request('https://api.test/v1/', { headers: a.auth }), env, tenantFor, io)
    expect(old.status).toBe(401)
  })

  it('refuses a wrong code, a malformed tenant and a non-boolean rotate', async () => {
    const a = await account()
    await attach(a)
    expect(await (await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com', code: '000000' })).json()).toEqual({ error: 'invalid_code' })
    expect(await (await post('/auth/recover', { tenant: 'NOPE', email: 'robin@example.com' })).json()).toEqual({ error: 'invalid_request', field: 'tenant' })
    expect(await (await post('/auth/recover', { tenant: a.tenant, email: 'x' })).json()).toEqual({ error: 'invalid_email' })
    expect(await (await post('/auth/recover', { tenant: a.tenant, email: 'robin@example.com', code: '123456', rotate: 'yes' })).json()).toEqual({ error: 'invalid_request', field: 'rotate' })
  })

  it('limits recovery calls per IP through the ops tenant', async () => {
    const ops = await adminKey(env.MASTER, 'solenoidops2', 1)
    await post('/auth/signup', {}, { 'cf-connecting-ip': '198.51.100.99' })
    const put = await handle(new Request('https://api.test/v1/recoveries', { method: 'PUT', headers: { authorization: `Bearer ${ops}` }, body: JSON.stringify({ recoveries: 2, per: 'child-day' }) }), env, tenantFor, io)
    expect(put.status).toBe(200)
    const call = () => post('/auth/recover', { tenant: 'abcdefghijkl', email: 'a@b.cd' }, { 'cf-connecting-ip': '203.0.113.50' })
    expect((await call()).status).toBe(202)
    expect((await call()).status).toBe(202)
    const third = await call()
    expect([third.status, await third.json()]).toEqual([429, { error: 'rate_limited' }])
  })
})

describe('the deployed entry', () => {
  it('answers 502 on /auth/email when no Resend key is configured', async () => {
    const signed = (await (await SELF.fetch('https://api.test/auth/signup', { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.123' } })).json()) as { admin_key: string }
    const r = await SELF.fetch('https://api.test/auth/email', { method: 'POST', headers: { authorization: `Bearer ${signed.admin_key}` }, body: JSON.stringify({ email: 'a@b.cd' }) })
    expect([r.status, await r.json()]).toEqual([502, { error: 'email_failed' }])
  })

  it('answers 202 on /auth/recover through the real entry', async () => {
    const r = await SELF.fetch('https://api.test/auth/recover', { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.124' }, body: JSON.stringify({ tenant: 'abcdefghijkl', email: 'a@b.cd' }) })
    expect([r.status, await r.json()]).toEqual([202, { status: 'accepted' }])
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd worker && pnpm vitest run test/mail.test.ts test/auth-routes.test.ts`
Expected: FAIL, because `../src/mail` does not exist and `handle` takes no `io`.

- [ ] **Step 4: Implement `mail.ts`**

`worker/src/mail.ts`:
```ts
import type { Purpose } from './codes'

export type Mail = { to: string; subject: string; text: string }
export type Mailer = (m: Mail) => Promise<void>

export function resendMailer(apiKey: string | undefined, from: string, f: typeof fetch = fetch): Mailer {
  return async (m) => {
    if (!apiKey) throw new Error('RESEND_API_KEY is not set')
    const res = await f('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) throw new Error(`Resend refused the message: HTTP ${res.status}`)
  }
}

export const codeMail = (to: string, code: string, tenant: string, purpose: Purpose): Mail => ({
  to,
  subject: `Your Solenoid code: ${code}`,
  text: [
    purpose === 'attach'
      ? `Your code to make this address the recovery email of Solenoid account ${tenant} is ${code}.`
      : `Your code to recover the admin key of Solenoid account ${tenant} is ${code}.`,
    'It works once, within 15 minutes.',
    "If you didn't ask for it, ignore this email. Nothing changes unless someone enters the code.",
  ].join('\n\n'),
})

export const confirmMail = (to: string, tenant: string): Mail => ({
  to,
  subject: 'Your Solenoid recovery email is set',
  text: [
    `This address can now recover the admin key of Solenoid account ${tenant}.`,
    `Keep this email. Recovery asks for the account ID, ${tenant}, and this is where you will find it.`,
  ].join('\n\n'),
})

export const changedMail = (to: string, tenant: string): Mail => ({
  to,
  subject: 'Your Solenoid recovery email was changed',
  text: [
    `This address is no longer the recovery email of Solenoid account ${tenant}. Someone with the account's admin key set a different one.`,
    "If that wasn't you, the admin key may have leaked. Rotate it with `solenoid rotate --admin --yes`, then set your recovery email again.",
  ].join('\n\n'),
})
```

The email wording above is a draft. It goes through the copy gate in Step 9, and the tests above check only structure.

- [ ] **Step 5: Move the per-IP ops spend into `ops.ts`**

`worker/src/ops.ts`:
```ts
import { INTERNAL } from './auth'
import { sha256hex } from './chain'
import type { TenantApi } from './core'
import { failResponse, json } from './errors'

export const OPS_TENANT = 'solenoidops2'

export function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const [head, tail = ''] = ip.split('::')
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : []
  return [...h, ...Array(8 - h.length - t.length).fill('0'), ...t].slice(0, 4).map((x) => x.padStart(4, '0')).join(':')
}

export async function perIp(req: Request, tenantFor: (name: string) => TenantApi, unit: 'signups' | 'recoveries'): Promise<Response | null> {
  const ops = tenantFor(OPS_TENANT)
  await ops.init(OPS_TENANT, 'internal')
  const who = (await sha256hex(ipKey(req.headers.get('cf-connecting-ip') ?? 'unknown'))).slice(0, 16)
  const r = await ops.spend(INTERNAL, `${unit}/${who}`, { [unit]: 1_000_000 }, crypto.randomUUID(), '')
  if (r.ok) return null
  return r.status === 402 ? json(429, { error: 'rate_limited' }) : failResponse(r)
}
```

In `router.ts`:
- delete `OPS_TENANT` and `ipKey`, and add `export { ipKey } from './ops'`;
- rewrite `signup` so it begins `const limited = await perIp(req, tenantFor, 'signups'); if (limited) return limited`, then keeps the tenant-minting loop unchanged.

The existing `signup.test.ts` must still pass unchanged.

- [ ] **Step 6: Implement `auth-routes.ts`**

`worker/src/auth-routes.ts`:
```ts
import { CODE_RE, normalizeEmail } from './codes'
import type { TenantApi } from './core'
import { ApiError, failResponse, json } from './errors'
import { adminKey, TENANT_RE, verifyKey } from './keys'
import { changedMail, codeMail, confirmMail, type Mailer } from './mail'
import { perIp } from './ops'

type TenantFor = (name: string) => TenantApi
export type Io = { mail: Mailer; waitUntil(p: Promise<unknown>): void }

async function body(req: Request): Promise<Record<string, unknown>> {
  let b: unknown
  try { b = JSON.parse(await req.text()) } catch { throw new ApiError(400, 'invalid_request') }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'invalid_request')
  return b as Record<string, unknown>
}

const emailOf = (b: Record<string, unknown>): string => {
  const email = normalizeEmail(b.email)
  if (!email) throw new ApiError(400, 'invalid_email')
  return email
}

const codeOf = (b: Record<string, unknown>): string => {
  if (typeof b.code !== 'string' || !CODE_RE.test(b.code)) throw new ApiError(400, 'invalid_code')
  return b.code
}

const later = (io: Io, send: Promise<void>) => io.waitUntil(send.catch((e) => console.error(e)))

export async function authEmail(req: Request, master: string, tenantFor: TenantFor, io: Io): Promise<Response> {
  const { tenant, auth } = await verifyKey(req.headers.get('authorization'), master)
  const b = await body(req)
  const email = emailOf(b)
  const stub = tenantFor(tenant)
  if (b.code === undefined) {
    const r = await stub.attachStart(auth, email)
    if (!r.ok) return failResponse(r)
    try {
      await io.mail(codeMail(email, r.value.code, tenant, 'attach'))
    } catch (e) {
      console.error(e)
      return json(502, { error: 'email_failed' })
    }
    return json(202, { email, status: 'code_sent' })
  }
  const r = await stub.attachVerify(auth, email, codeOf(b))
  if (!r.ok) return failResponse(r)
  later(io, io.mail(confirmMail(email, tenant)))
  if (r.value.previous) later(io, io.mail(changedMail(r.value.previous, tenant)))
  return json(200, { tenant, email })
}

export async function authRecover(req: Request, master: string, tenantFor: TenantFor, io: Io): Promise<Response> {
  const b = await body(req)
  const limited = await perIp(req, tenantFor, 'recoveries')
  if (limited) return limited
  if (typeof b.tenant !== 'string' || !TENANT_RE.test(b.tenant)) throw new ApiError(400, 'invalid_request', { field: 'tenant' })
  const tenant = b.tenant
  const email = emailOf(b)
  const stub = tenantFor(tenant)
  if (b.code === undefined) {
    const r = await stub.recoverStart(email)
    if (!r.ok) return failResponse(r)
    if (r.value.code) later(io, io.mail(codeMail(email, r.value.code, tenant, 'recover')))
    return json(202, { status: 'accepted' })
  }
  const code = codeOf(b)
  if (b.rotate !== undefined && typeof b.rotate !== 'boolean') throw new ApiError(400, 'invalid_request', { field: 'rotate' })
  const r = await stub.recoverFinish(email, code, b.rotate === true)
  if (!r.ok) return failResponse(r)
  return json(200, { tenant, admin_key: await adminKey(master, tenant, r.value.gen) })
}
```

In `authEmail`, a spend key reaches `attachStart`, whose `#authorize(auth, '', 'admin')` returns `403 admin_required`. The route needs no check of its own.

In `router.ts`:
- `import type { Io } from './auth-routes'` and `export type { Io } from './auth-routes'`, because the re-export alone doesn't bring `Io` into scope for `handle`'s signature;
- `handle(req, env, tenantFor, io)` and `route(req, env, tenantFor, io)` both take `io: Io`;
- after the signup line in `route`, add:
```ts
  if (req.method === 'POST' && url.pathname === '/auth/email') return authEmail(req, env.MASTER, tenantFor, io)
  if (req.method === 'POST' && url.pathname === '/auth/recover') return authRecover(req, env.MASTER, tenantFor, io)
```

`worker/src/index.ts`:
```ts
import type { TenantApi } from './core'
import { resendMailer } from './mail'
import { handle } from './router'

export { ipKey } from './router'
export { TenantDO } from './tenant'

export default {
  fetch: (req, env, ctx) =>
    handle(req, env, (name) => env.TENANT.get(env.TENANT.idFromName(name)) as unknown as TenantApi, {
      mail: resendMailer(env.RESEND_API_KEY, env.MAIL_FROM),
      waitUntil: (p) => ctx.waitUntil(p),
    }),
} satisfies ExportedHandler<Cloudflare.Env>
```

`worker/src/env.d.ts`: add `RESEND_API_KEY?: string; MAIL_FROM: string` to `Env`.

`worker/wrangler.jsonc` `vars`: add `"MAIL_FROM": "Solenoid <auth@solenoid.systems>"`.

`sdk/src/testing.ts`:
- `import type { Mail } from '../../worker/src/mail'`;
- `export type { Mail }`;
- add `outbox(): Promise<Mail[]>` and `mailDown(on: boolean): void` to `TestServer`.

Inside `testServer()`:
```ts
  const sent: Mail[] = []
  const pending = new Set<Promise<unknown>>()
  let mailOff = false
  const io = {
    mail: async (m: Mail) => { if (mailOff) throw new Error('mail is down'); sent.push(m) },
    waitUntil: (p: Promise<unknown>) => { pending.add(p); void p.finally(() => pending.delete(p)) },
  }
```
`waitUntil` adds no `catch`: every promise it receives comes from `later()`, which already catches. Pass `io` as `handle`'s fourth argument, and return:
```ts
    outbox: async () => { await Promise.all(pending); return [...sent] },
    mailDown: (on) => { mailOff = on },
```

- [ ] **Step 7: Pin the lock where it is load-bearing**

In workerd, WebCrypto awaits don't interleave, so the Worker test in Task 1 can't catch a missing lock. Under `testServer()` in Node they do. Add this to `sdk/test/testing.test.ts`:
```ts
it('rotates the admin key once when the same recovery code arrives twice at once', async () => {
  const server = await testServer()
  const post = (path: string, body: unknown, key?: string) => server.fetch(`${server.api}${path}`, { method: 'POST', headers: key ? { authorization: `Bearer ${key}` } : {}, body: JSON.stringify(body) })
  const { tenant, admin_key } = await server.signup()
  const last = async () => /\b(\d{6})\b/.exec((await server.outbox()).at(-1)!.text)![1]
  await post('/auth/email', { email: 'a@b.cd' }, admin_key)
  await post('/auth/email', { email: 'a@b.cd', code: await last() }, admin_key)
  await post('/auth/recover', { tenant, email: 'a@b.cd' })
  const code = await last()
  const both = await Promise.all([1, 2].map(() => post('/auth/recover', { tenant, email: 'a@b.cd', code, rotate: true })))
  expect(both.map((r) => r.status).sort()).toEqual([200, 400])
  const ok = (await both.find((r) => r.status === 200)!.json()) as { admin_key: string }
  expect(ok.admin_key.split('.')[3]).toBe('2')
})
```
Temporarily remove the `#serial` wrapper from `recoverFinish` and confirm this test fails. Without the lock, both seals read the same chain head, so the second `#writeEntry` hits the `entries.seq` primary key, and that request answers `500`, giving statuses `[200, 500]`. Then restore the wrapper. Say in the commit message that the lock is load-bearing under Node.

- [ ] **Step 8: Run the Worker and SDK suites**

Run: `cd worker && pnpm typecheck && pnpm test && cd ../sdk && pnpm typecheck && pnpm test`
Expected: PASS. The new route tests pass, and every earlier test still passes.

- [ ] **Step 9: Mutation gate**

Run: `cd worker && pnpm run mutate --force`
Expected: the score is at least 90. There are zero survivors in `auth-routes.ts` and `ops.ts` on rejects: body, email, code, tenant and rotate validation, the 502 path, and the per-IP 429. Record any equivalents.

- [ ] **Step 10: Copy gate on the two email bodies**

Paste the rendered `codeMail(..., 'attach')`, `codeMail(..., 'recover')` and `confirmMail` texts into a cold `/copy-chief` run (medium: transactional email). Fix every Gate 0 item, and fix or accept every finding. Record the grade in `docs/copy/grades/email.md`.

- [ ] **Step 11: Commit**

```bash
git add worker/src worker/test worker/wrangler.jsonc sdk/src/testing.ts sdk/test/testing.test.ts docs/testing/MUTATION-SUMMARY.md docs/copy/grades/email.md
git commit -m "Attach a recovery email and recover the admin key by email"
```

---

### Task 3: SDK account functions and the contract scenario

**Files:**
- Modify: `sdk/src/http.ts` (a `502 email_failed` is not an outage), `sdk/src/index.ts` (the `authPost` helper, `signup` options, `requestRecovery`, `recover`, and the client's `sendEmailCode` and `verifyEmail`), `contract/scenarios.ts` (`outbox` on `Target`, the recovery scenario), `sdk/test/testing.test.ts` (pass `outbox`), `e2e/test/contract.test.ts` (skip `needsOutbox`)
- Create: `sdk/test/account.test.ts`, `e2e/test/email.test.ts`

**Interfaces:**
- Consumes: Task 2's HTTP contract, and `TestServer.outbox()` and `mailDown()`.
- Produces (from `@solenoid.systems/sdk`):
  - `type AccountOptions = { api?: string; fetch?: typeof fetch }`
  - `signup(o?: string | AccountOptions): Promise<{ tenant: string; admin_key: string }>`. A string is read as `api`, as today.
  - `requestRecovery(tenant: string, email: string, o?: AccountOptions): Promise<void>`
  - `recover(tenant: string, email: string, code: string, o?: AccountOptions & { rotate?: boolean }): Promise<{ tenant: string; admin_key: string }>`
  - `client.sendEmailCode(email: string): Promise<void>`
  - `client.verifyEmail(email: string, code: string): Promise<{ tenant: string; email: string }>`
  - `Target.outbox?(): Promise<{ to: string; subject: string; text: string }[]>`, and `Scenario.needsOutbox?: true`

- [ ] **Step 1: Write the failing SDK tests**

`sdk/test/account.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { Outage, SolenoidError, recover, requestRecovery, signup, solenoid } from '../src/index'
import { testServer, type Mail } from '../src/testing'

const codeIn = (m: Mail) => /\b(\d{6})\b/.exec(m.text)![1]

async function setup() {
  const server = await testServer()
  const o = { api: server.api, fetch: server.fetch }
  const acct = await signup(o)
  const admin = solenoid({ key: acct.admin_key, api: server.api, fetch: server.fetch })
  return { server, o, acct, admin }
}

describe('account functions', () => {
  it('signs up with an injected fetch, and still takes a bare api string', async () => {
    const { acct } = await setup()
    expect(acct.admin_key).toMatch(/^sk\.admin\./)
    await expect(signup('ftp://nope')).rejects.toThrow(TypeError)
  })

  it('attaches an email with the code from the outbox', async () => {
    const { server, admin, acct } = await setup()
    await admin.sendEmailCode('Robin@Example.com')
    const [m] = await server.outbox()
    expect(m.to).toBe('robin@example.com')
    await expect(admin.verifyEmail('robin@example.com', codeIn(m) === '000000' ? '000001' : '000000')).rejects.toMatchObject({ code: 'invalid_code', status: 400 })
    expect(await admin.verifyEmail('robin@example.com', codeIn(m))).toEqual({ tenant: acct.tenant, email: 'robin@example.com' })
  })

  it('requests recovery the same way for any email, and recovers or rotates the key', async () => {
    const { server, admin, acct, o } = await setup()
    await admin.sendEmailCode('robin@example.com')
    await admin.verifyEmail('robin@example.com', codeIn((await server.outbox())[0]))
    expect(await requestRecovery(acct.tenant, 'stranger@example.com', o)).toBeUndefined()
    expect(await requestRecovery(acct.tenant, 'robin@example.com', o)).toBeUndefined()
    const box = await server.outbox()
    expect(box.map((m) => m.to)).toEqual(['robin@example.com', 'robin@example.com', 'robin@example.com'])
    expect(await recover(acct.tenant, 'robin@example.com', codeIn(box[2]), o)).toEqual(acct)
    await requestRecovery(acct.tenant, 'robin@example.com', o)
    const rotated = await recover(acct.tenant, 'robin@example.com', codeIn((await server.outbox()).at(-1)!), { ...o, rotate: true })
    expect(rotated.admin_key).not.toBe(acct.admin_key)
    await expect(admin.get('')).rejects.toMatchObject({ code: 'invalid_key' })
  })

  it('surfaces a failed send as email_failed and an unreachable service as Outage', async () => {
    const { server, admin, acct, o } = await setup()
    server.mailDown(true)
    await expect(admin.sendEmailCode('robin@example.com')).rejects.toMatchObject({ status: 502, code: 'email_failed' })
    server.mailDown(false)
    server.outage(true)
    await expect(requestRecovery(acct.tenant, 'robin@example.com', o)).rejects.toBeInstanceOf(Outage)
    await expect(recover(acct.tenant, 'robin@example.com', '123456', o)).rejects.toBeInstanceOf(Outage)
  })

  it('throws SolenoidError for a refused request', async () => {
    const { acct, o } = await setup()
    await expect(recover(acct.tenant, 'robin@example.com', '123456', o)).rejects.toBeInstanceOf(SolenoidError)
    await expect(requestRecovery('NOPE', 'robin@example.com', o)).rejects.toMatchObject({ code: 'invalid_request' })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd sdk && pnpm vitest run test/account.test.ts`
Expected: FAIL, because `recover` and `requestRecovery` are not exported.

- [ ] **Step 3: Implement it in `sdk/src/index.ts`**

Replace `signup` with:
```ts
export type AccountOptions = { api?: string; fetch?: typeof fetch }

const AUTH_TIMEOUT_MS = 10_000

async function authPost<T>(o: AccountOptions, path: string, body: unknown, expect: number): Promise<T> {
  const url = `${checkApi(o.api ?? envVar('SOLENOID_API') ?? DEFAULT_API)}${path}`
  const f = o.fetch ?? globalThis.fetch.bind(globalThis)
  const init: RequestInit = body === undefined ? { method: 'POST' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  let res: Response
  try {
    res = await f(url, { ...init, signal: AbortSignal.timeout(AUTH_TIMEOUT_MS) })
  } catch (e) {
    throw new Outage('solenoid unreachable', { cause: e })
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.status === expect) return data as T
  throw res.status >= 500 && data.error !== 'email_failed' ? new Outage(`HTTP ${res.status}`) : toError(res.status, data)
}

export const signup = (o: string | AccountOptions = {}): Promise<{ tenant: string; admin_key: string }> =>
  authPost(typeof o === 'string' ? { api: o } : o, '/auth/signup', undefined, 201)

export const requestRecovery = async (tenant: string, email: string, o: AccountOptions = {}): Promise<void> => {
  await authPost(o, '/auth/recover', { tenant, email }, 202)
}

export const recover = (tenant: string, email: string, code: string, o: AccountOptions & { rotate?: boolean } = {}): Promise<{ tenant: string; admin_key: string }> =>
  authPost(o, '/auth/recover', { tenant, email, code, ...(o.rotate ? { rotate: true } : {}) }, 200)
```

`502 email_failed` stays a `SolenoidError`, because a send failure is not a Solenoid outage. Any other 5xx is an `Outage`.

`signup` sends no body, just as today. `sdk/test/client.test.ts:62` pins its request, and that test must keep passing. The existing signup test's expected `init` now also carries a `signal`, so relax that assertion to `expect.objectContaining({ method: 'POST' })` with no `body` key.

In `sdk/src/http.ts`, change `attempt()` so that a `502 email_failed` reaches `toError`:
```ts
    const data = (res.ok ? await res.json() : await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok) return data as T
    if (res.status >= 500 && data.error !== 'email_failed') throw new Outage(`HTTP ${res.status}`)
    throw toError(res.status, data)
```
Add a test to `sdk/test/http.test.ts`: a stubbed `fetch` that returns `502 {"error":"email_failed"}` makes `call` throw a `SolenoidError` with code `email_failed`, after exactly one fetch.

Inside `solenoid()`, next to `rotateAdmin`:
```ts
  const authT = { ...t, timeoutMs: Math.max(t.timeoutMs, 10_000) }
  const sendEmailCode = async (email: string): Promise<void> => { await call(authT, 'POST', '/auth/email', { email }) }
  const verifyEmail = (email: string, code: string) => call<{ tenant: string; email: string }>(authT, 'POST', '/auth/email', { email, code })
```
Add both to the returned object.

`call` sends no idempotency key here, so these POSTs are never retried. The global constraint requires that.

- [ ] **Step 4: Add the contract scenario**

In `contract/scenarios.ts`:
- widen `Target` with `outbox?(): Promise<{ to: string; subject: string; text: string }[]>`;
- widen `Scenario` with `needsOutbox?: true`;
- import `recover` and `requestRecovery`;
- append:
```ts
  {
    name: 'recovers the admin key by email, and rotation revokes the old one',
    needsOutbox: true,
    async run(t) {
      const acct = await t.signup()
      const o = { api: t.api, fetch: t.fetch }
      const admin = solenoid({ key: acct.admin_key, ...o })
      const last = async () => /\b(\d{6})\b/.exec((await t.outbox!()).at(-1)!.text)![1]
      await admin.sendEmailCode('ops@example.com')
      await admin.verifyEmail('ops@example.com', await last())
      await requestRecovery(acct.tenant, 'ops@example.com', o)
      assert.deepEqual(await recover(acct.tenant, 'ops@example.com', await last(), o), acct)
      await requestRecovery(acct.tenant, 'ops@example.com', o)
      const rotated = await recover(acct.tenant, 'ops@example.com', await last(), { ...o, rotate: true })
      assert.notEqual(rotated.admin_key, acct.admin_key)
      assert.equal(await code(admin.get('')), 'invalid_key')
    },
  },
```

`sdk/test/testing.test.ts` already passes the whole `testServer()`, which now has `outbox`. In `e2e/test/contract.test.ts`, change the skip to `it.skipIf(s.needsClock || s.needsOutbox)`.

`e2e/test/email.test.ts` pins the unconfigured sender against the real local Worker:
```ts
import { SolenoidError, signup, solenoid } from '@solenoid.systems/sdk'
import { expect, it } from 'vitest'
import { api } from './harness'

it('answers email_failed when the local Worker has no Resend key', async () => {
  const { admin_key } = await signup(api)
  await expect(solenoid({ key: admin_key, api }).sendEmailCode('a@b.cd')).rejects.toSatisfy((e: unknown) => e instanceof SolenoidError && e.code === 'email_failed')
})
```

- [ ] **Step 5: Run everything**

Run: `pnpm --filter @solenoid.systems/sdk build && pnpm typecheck && pnpm test` (root). The build must come first, because the CLI and e2e packages read the SDK's types from `sdk/dist`.
Expected: PASS in worker, sdk, cli and e2e. The contract recovery scenario runs under `testServer()` and is skipped on the local Worker.

- [ ] **Step 6: Mutation gate**

Run: `cd sdk && pnpm run mutate --force`
Expected: the score is at least 90. There are zero reject-path survivors in `authPost`: the status check, the 502 split and the Outage mapping.

- [ ] **Step 7: Commit**

```bash
git add sdk contract e2e docs/testing/MUTATION-SUMMARY.md
git commit -m "Add email attachment and recovery to the SDK"
```

---

### Task 4: CLI `email`, `recover` and `init --email`

**Files:**
- Modify: `cli/src/main.ts` (options `email`, `tenant`, `rotate`), `cli/src/commands.ts` (commands, `explain` codes, `HELP`, the rotate messages), `cli/src/envfile.ts` (`readEnvKey`)
- Test: `cli/test/cli.test.ts`, `cli/test/format-error.test.ts`, `cli/test/envfile.test.ts`

**Interfaces:**
- Consumes: from Task 3, `requestRecovery`, `recover`, `client.sendEmailCode` and `client.verifyEmail`.
- Produces:
  - `readEnvKey(path: string): string | undefined` in `envfile.ts`
  - `tenantOf(key: string | undefined): string | undefined` in `commands.ts`
  - commands: `solenoid email <address> [code]`, `solenoid recover <email> [code] [--tenant id] [--rotate] [--force]`, `solenoid init [scope] [--email address] [--force]`

- [ ] **Step 1: Write the failing tests**

Add to `cli/test/cli.test.ts`. Reuse its existing `freshServer()`, `useConfigDir()`, `tempDir()` and `solenoid(cwd, ...args)` helpers, and import `readFileSync`, `rmSync` and `writeFileSync` from `node:fs`.
```ts
const codeIn = (text: string) => /\b(\d{6})\b/.exec(text)![1]

describe('recovery email', () => {
  it('init --email sends a code, and init without it says how to attach one', async () => {
    const server = await freshServer(); useConfigDir(); const cwd = tempDir('cwd-')
    const r = await solenoid(cwd, 'init', 'acme', '--email', 'Robin@Example.com')
    expect(r.code).toBe(0)
    expect(r.out).toContain('robin@example.com')
    expect((await server.outbox()).map((m) => m.to)).toEqual(['robin@example.com'])
    useConfigDir()
    const plain = await solenoid(tempDir('cwd-'), 'init')
    expect(plain.out).toContain('solenoid email <address>')
  })

  it('init --email keeps the new account when the send fails', async () => {
    const server = await freshServer(); const dir = useConfigDir()
    server.mailDown(true)
    const r = await solenoid(tempDir('cwd-'), 'init', '--email', 'robin@example.com')
    expect(r.code).toBe(0)
    expect(readFileSync(`${dir}/credentials`, 'utf8')).toContain('sk.admin.')
    expect(r.out).toContain('solenoid email robin@example.com')
  })

  it('email sends a code, refuses a wrong one, and confirms the right one', async () => {
    const server = await freshServer(); useConfigDir(); const cwd = tempDir('cwd-')
    await solenoid(cwd, 'init')
    const sent = await solenoid(cwd, 'email', 'robin@example.com')
    expect(sent.code).toBe(0)
    const c = codeIn((await server.outbox())[0].text)
    const wrong = await solenoid(cwd, 'email', 'robin@example.com', c === '000000' ? '000001' : '000000')
    expect(wrong.code).toBe(1)
    expect(wrong.err).toMatch(/^solenoid: invalid_code \(400\)\. /)
    const ok = await solenoid(cwd, 'email', 'robin@example.com', c)
    expect(ok.code).toBe(0)
    expect(ok.out).toMatch(/[a-z2-7]{12}/)
  })

  it('email with no address says how to use it', async () => {
    await freshServer(); useConfigDir(); const cwd = tempDir('cwd-')
    await solenoid(cwd, 'init')
    const r = await solenoid(cwd, 'email')
    expect(r.code).toBe(1)
    expect(r.err).toContain('solenoid email <address>')
  })
})

describe('recover', () => {
  async function attachedAccount() {
    const server = await freshServer(); const dir = useConfigDir(); const cwd = tempDir('cwd-')
    await solenoid(cwd, 'init', 'acme')
    await solenoid(cwd, 'email', 'robin@example.com')
    await solenoid(cwd, 'email', 'robin@example.com', codeIn((await server.outbox())[0].text))
    const creds = readFileSync(`${dir}/credentials`, 'utf8')
    return { server, dir, cwd, creds, adminKey: JSON.parse(creds).admin_key as string }
  }

  it('finds the tenant in ./.env and restores the same admin key', async () => {
    const { server, dir, cwd, adminKey } = await attachedAccount()
    rmSync(`${dir}/credentials`)
    const asked = await solenoid(cwd, 'recover', 'robin@example.com')
    expect(asked.code).toBe(0)
    const r = await solenoid(cwd, 'recover', 'robin@example.com', codeIn((await server.outbox()).at(-1)!.text))
    expect(r.code).toBe(0)
    expect(JSON.parse(readFileSync(`${dir}/credentials`, 'utf8')).admin_key).toBe(adminKey)
  })

  it('takes the tenant from --tenant or SOLENOID_KEY, and asks for it when nothing names one', async () => {
    const { server, dir, adminKey } = await attachedAccount()
    rmSync(`${dir}/credentials`)
    const bare = tempDir('cwd-')
    const none = await solenoid(bare, 'recover', 'robin@example.com')
    expect(none.code).toBe(1)
    expect(none.err).toContain('--tenant')
    const tenant = adminKey.split('.')[2]
    vi.stubEnv('SOLENOID_KEY', `sk.spend.${tenant}.1.0.YWNtZQ.${'0'.repeat(64)}`)
    expect((await solenoid(bare, 'recover', 'robin@example.com')).code).toBe(0)
    vi.stubEnv('SOLENOID_KEY', '')
    expect((await solenoid(bare, 'recover', 'robin@example.com', '--tenant', tenant)).code).toBe(0)
    expect((await server.outbox()).length).toBeGreaterThanOrEqual(3)
  })

  it('--rotate saves a new key and revokes the old one', async () => {
    const { server, dir, cwd, adminKey } = await attachedAccount()
    await solenoid(cwd, 'recover', 'robin@example.com')
    const r = await solenoid(cwd, 'recover', 'robin@example.com', codeIn((await server.outbox()).at(-1)!.text), '--rotate')
    expect(r.code).toBe(0)
    const saved = JSON.parse(readFileSync(`${dir}/credentials`, 'utf8')).admin_key
    expect(saved).not.toBe(adminKey)
    expect((await solenoid(cwd, 'ls')).code).toBe(0)
  })

  it('refuses to overwrite a different saved account without --force', async () => {
    const { server, dir, cwd } = await attachedAccount()
    const tenant = JSON.parse(readFileSync(`${dir}/credentials`, 'utf8')).admin_key.split('.')[2]
    const other = useConfigDir()
    await solenoid(tempDir('cwd-'), 'init')
    const before = readFileSync(`${other}/credentials`, 'utf8')
    await solenoid(cwd, 'recover', 'robin@example.com', '--tenant', tenant)
    const r = await solenoid(cwd, 'recover', 'robin@example.com', codeIn((await server.outbox()).at(-1)!.text), '--tenant', tenant)
    expect(r.code).toBe(1)
    expect(r.err).toContain('--force')
    expect(readFileSync(`${other}/credentials`, 'utf8')).toBe(before)
  })
})
```

Add `readEnvKey` cases to `cli/test/envfile.test.ts`:
- `SOLENOID_KEY=sk.x` → `'sk.x'`
- `export SOLENOID_KEY="sk.y"` → `'sk.y'`
- `  SOLENOID_KEY='sk.z'` → `'sk.z'`
- `MY_SOLENOID_KEY=sk.a` → `undefined`
- a missing file → `undefined`

In `cli/test/format-error.test.ts`, add one case per new code (`invalid_code`, `invalid_email`, `rate_limited`, `email_failed`), asserting the next-step sentence.

These existing pins change on purpose. Update each to the new text, and change nothing else:
- `cli.test.ts:117-121`, `init`'s exact output: it gains the attach-a-recovery-email line.
- `cli.test.ts:62-83`, `HELP`.
- `cli.test.ts:28`, the `INVALID_KEY` constant, used at `:255` and `:261`: it gains the recovery sentence.
- `cli.test.ts:220`, the signup 429: it now carries the `rate_limited` explanation.
- The rotate tests whose expected strings said "account recovery does not exist yet".

- [ ] **Step 2: Run them to verify they fail**

Run: `cd cli && pnpm vitest run`
Expected: FAIL with unknown command "email", unknown option "--email", and similar.

- [ ] **Step 3: Implement it**

In `cli/src/main.ts`, add to `options`: `email: { type: 'string' }, tenant: { type: 'string' }, rotate: { type: 'boolean' }`.

In `cli/src/envfile.ts`:
```ts
export function readEnvKey(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  return /^[ \t]*(?:export[ \t]+)?SOLENOID_KEY[ \t]*=[ \t]*["']?(sk\.[^\s"']+)/m.exec(readFileSync(path, 'utf8'))?.[1]
}
```

In `cli/src/commands.ts`, import `recover` and `requestRecovery` from the SDK and `readEnvKey` from `./envfile`, then add:
```ts
export const tenantOf = (key: string | undefined) => /^sk\.(?:admin|spend)\.([a-z2-7]{12})\./.exec(key ?? '')?.[1]

function recoveryTenant(flags: Record<string, string | boolean | undefined>): string {
  const t = (flags.tenant as string | undefined)
    ?? tenantOf(process.env.SOLENOID_KEY)
    ?? tenantOf(readEnvKey(join(process.cwd(), '.env')))
    ?? (hasCreds() ? tenantOf(readCreds().admin_key) : undefined)
  if (!t) throw new Error('recover needs the account ID: pass --tenant <id>. it is the third field of any key (sk.spend.<id>.…), and the email that confirmed your recovery address names it.')
  return t
}
```

`recover` talks to `apiBase()`, which is `SOLENOID_API` or production, because the saved credentials may be the very thing that was lost. Task 6's docs say to set `SOLENOID_API` when the account lives on another host.

Add these `dispatch` cases:
```ts
    case 'email': {
      const email = pos[0]
      if (!email) throw new Error('email needs an address: run `solenoid email <address>` to get a code, then `solenoid email <address> <code>` to confirm it')
      const c = client()
      if (pos[1] === undefined) {
        await c.sendEmailCode(email)
        return `a 6-digit code is on its way to ${email.trim().toLowerCase()}. it works once, within 15 minutes: run \`solenoid email ${email.trim().toLowerCase()} <code>\` to confirm it.`
      }
      const r = await c.verifyEmail(email, pos[1])
      return `${r.email} can now recover the admin key of account ${r.tenant}. keep the confirmation email: it names the account ID, which recovery asks for.`
    }
    case 'recover': {
      const email = pos[0]
      if (!email) throw new Error('recover needs the recovery email: run `solenoid recover <email>` to get a code, then `solenoid recover <email> <code>`')
      const tenant = recoveryTenant(flags)
      const api = checkApi(apiBase())
      const tenantFlag = flags.tenant ? ` --tenant ${tenant}` : ''
      if (pos[1] === undefined) {
        await requestRecovery(tenant, email, { api })
        return `if ${email.trim().toLowerCase()} is the recovery email of account ${tenant}, a 6-digit code is on its way. it works once, within 15 minutes: run \`solenoid recover ${email.trim().toLowerCase()} <code>${tenantFlag}\`. add --rotate if the old admin key may have leaked; that revokes it and every spend key.`
      }
      const saved = hasCreds() ? tenantOf(readCreds().admin_key) : undefined
      if (saved && saved !== tenant && !flags.force) throw new Error(`the saved admin key belongs to account ${saved}. add --force to replace it with account ${tenant}'s key.`)
      const r = await recover(tenant, email, pos[1], { api, rotate: flags.rotate === true })
      writeCreds({ api, admin_key: r.admin_key })
      return flags.rotate
        ? [`new admin key: ${r.admin_key}`, `it is saved at ${credsPath()}. every previous key, admin and spend, now fails: re-derive each spend key with \`solenoid key <scope>\` and redeploy them.`].join('\n')
        : [`admin key: ${r.admin_key}`, `it is saved at ${credsPath()}. deployed spend keys keep working.`].join('\n')
    }
```

In `init`, insert this after `const out = [...]` and before `if (scope !== undefined) {`. The `.env` line must stay last, because `cli.test.ts:152` and `e2e/test/keys.test.ts:13` require it:
```ts
      if (typeof flags.email === 'string') {
        try {
          await solenoid({ key: admin_key, api }).sendEmailCode(flags.email)
          out.push(`a 6-digit code is on its way to ${flags.email.trim().toLowerCase()}: run \`solenoid email ${flags.email.trim().toLowerCase()} <code>\` to attach it.`)
        } catch (e) {
          out.push(`the account is ready, but the code could not be sent (${(e as Error).message}). run \`solenoid email ${flags.email.trim().toLowerCase()}\` to try again.`)
        }
      } else {
        out.push('attach a recovery email so you can get the admin key back if it is lost: `solenoid email <address>`.')
      }
```

In `explain()`, add:
```ts
    case 'invalid_code':
      return 'the code is wrong, already used, older than 15 minutes, or five wrong tries used it up. run the same command without the code to get a new one.'
    case 'invalid_email':
      return 'that is not an address solenoid can send to. check it for typos.'
    case 'rate_limited':
      return 'solenoid limits how often this can be asked: signups per network per day, and codes per email address and per account. wait, then try again.'
    case 'email_failed':
      return 'solenoid could not send the email. nothing was changed; try again in a minute.'
```

Replace the "account recovery does not exist yet" wording in the `rotate --admin` timeout message with: "if it fails with invalid_key, the rotation went through and its new admin key was lost. if the account has a recovery email, `solenoid recover <email>` returns the current key." Extend the `invalid_key` explanation with: "if the admin key is lost, `solenoid recover <email>` gets it back when the account has a recovery email."

Add to `HELP`:
```
  init [scope] [--email address] [--force]                            create an account; with --email, start attaching a recovery email
  email <address> [code]                                              attach a recovery email: the first run sends a code, the second confirms it
  recover <email> [code] [--tenant id] [--rotate] [--force]           get the admin key back by email; --rotate also revokes the old one
```
The first of these replaces the existing `init` line.

- [ ] **Step 4: Run the CLI suite**

Run: `pnpm --filter @solenoid.systems/sdk build && cd cli && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Mutation gate**

Run: `cd cli && pnpm run mutate --force`
Expected: the score is at least 90. There are zero reject-path survivors in `recoveryTenant`, `tenantOf`, `readEnvKey` and the `--force` guard. Afterwards `git status` must be clean.

- [ ] **Step 6: Copy gate**

Collect every new or changed CLI string verbatim. That means the `email`, `recover` and `init` outputs, the four `explain` entries, the rotate and `invalid_key` edits, and the `HELP` lines. Run a cold `/copy-chief` on them (medium: CLI output), fix every Gate 0 item, and record the grade in `docs/copy/grades/cli.md`.

- [ ] **Step 7: Commit**

```bash
git add cli docs/testing/MUTATION-SUMMARY.md docs/copy/grades/cli.md
git commit -m "Add email and recover to the CLI"
```

---

### Task 5: `@solenoid.systems/mcp` 2.0.0

**Files:**
- Create:
  - `mcp/package.json`, `mcp/tsconfig.json`, `mcp/vitest.config.ts`, `mcp/stryker.config.mjs`
  - `mcp/src/protocol.ts`, `mcp/src/tools.ts`, `mcp/src/main.ts`, `mcp/src/bin.ts`
  - `mcp/test/setup.ts`, `mcp/test/protocol.test.ts`, `mcp/test/tools.test.ts`, `mcp/test/main.test.ts`, `mcp/test/bundle.test.ts`
- Modify: `pnpm-workspace.yaml` (add `mcp`)

**Interfaces:**
- Consumes: from the SDK, `solenoid`, `Client`, `View`, `SolenoidError`, `fileStore` (`@solenoid.systems/sdk/node`) and `testServer` (in tests).
- Produces:
  - `protocol.ts`:
    - `type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; call(args: Record<string, unknown>): Promise<string> }`
    - `SUPPORTED: string[]`
    - `server(tools: Tool[], info: { name: string; version: string }): (line: string) => Promise<string | null>`
    - `serveStdio(handle, input: NodeJS.ReadableStream, write: (s: string) => void): Promise<void>`
    - `describe(e: unknown): string`
  - `tools.ts`: `tools(client: Client, admin: boolean): Tool[]`. The tools are `get`, `log`, and with `admin`, also `set_limit` and `rotate`.
  - `main.ts`:
    - `VERSION = '2.0.0'`
    - `clientFor(argv: string[], env: Record<string, string | undefined>): { admin: boolean; client: Client }`
    - `start(argv, env, input, write): Promise<void>`
  - bin: `solenoid-mcp`, from `dist/solenoid-mcp.mjs`

- [ ] **Step 1: Scaffold the package**

`mcp/package.json`:
```json
{
  "name": "@solenoid.systems/mcp",
  "version": "2.0.0",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "bin": { "solenoid-mcp": "dist/solenoid-mcp.mjs" },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "pnpm --filter @solenoid.systems/sdk build && esbuild src/bin.ts --bundle --format=esm --platform=node --banner:js='#!/usr/bin/env node' --outfile=dist/solenoid-mcp.mjs && chmod +x dist/solenoid-mcp.mjs",
    "test": "vitest run",
    "test:changed": "vitest run --changed --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "mutate": "STRYKER=1 HOME=\"$(mktemp -d)\" stryker run"
  },
  "devDependencies": {
    "@solenoid.systems/sdk": "workspace:*",
    "@stryker-mutator/core": "<same version as cli/package.json>",
    "@stryker-mutator/vitest-runner": "<same version as cli/package.json>",
    "@types/node": "^22.0.0",
    "@vitest/coverage-v8": "<same version as cli/package.json>",
    "esbuild": "^0.24.0",
    "typescript": "^5.6.0",
    "vitest": "^4.1.10"
  }
}
```
Copy the three `<same version…>` values from `cli/package.json`'s devDependencies.

The config files copy from `cli/`:
- `mcp/tsconfig.json` is `cli/tsconfig.json` verbatim.
- `mcp/vitest.config.ts` is `cli/vitest.config.ts` verbatim, with its `bundle.test.ts` exclusion under `STRYKER`.
- `mcp/stryker.config.mjs` is `cli/stryker.config.mjs` verbatim, with `mutate: ['src/**/*.ts', '!src/bin.ts']`.
- `mcp/test/setup.ts` is `cli/test/setup.ts`, with the sandbox prefix renamed `solenoid-mcp-test-` and the `credsPath` import dropped. The two `credsPath()` calls in its `beforeEach` go too; the `SOLENOID_CONFIG_DIR` and `HOME` sandboxing stays.

Add `mcp` to `pnpm-workspace.yaml`, then run `pnpm install`.

- [ ] **Step 2: Write the failing protocol tests**

`mcp/test/protocol.test.ts`:
```ts
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { SolenoidError } from '@solenoid.systems/sdk'
import { SUPPORTED, describe as describeError, server, serveStdio, type Tool } from '../src/protocol'

const echo: Tool = { name: 'echo', description: 'd', inputSchema: { type: 'object' }, call: async (a) => JSON.stringify(a) }
const boom: Tool = { name: 'boom', description: 'd', inputSchema: { type: 'object' }, call: async () => { throw new SolenoidError(402, 'limit_exceeded', { scope: 'a' }) } }
const h = server([echo, boom], { name: 'solenoid', version: '2.0.0' })
const rpc = async (msg: unknown) => JSON.parse((await h(JSON.stringify(msg)))!)

describe('server', () => {
  it('negotiates the protocol version', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    expect(r).toEqual({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'solenoid', version: '2.0.0' } } })
    expect((await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).result.protocolVersion).toBe(SUPPORTED[0])
  })
  it('answers ping, lists tools without their handlers, and calls one', async () => {
    expect(await rpc({ jsonrpc: '2.0', id: 3, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 3, result: {} })
    expect((await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' })).result.tools).toEqual([
      { name: 'echo', description: 'd', inputSchema: { type: 'object' } },
      { name: 'boom', description: 'd', inputSchema: { type: 'object' } },
    ])
    expect((await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo', arguments: { a: 1 } } })).result).toEqual({ content: [{ type: 'text', text: '{"a":1}' }] })
    expect((await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'echo' } })).result.content[0].text).toBe('{}')
  })
  it('reports a tool failure as an error result, not a protocol error', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'boom', arguments: {} } })
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toContain('limit_exceeded')
  })
  it('keeps going through bad input', async () => {
    expect(await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'nope' } })).toMatchObject({ id: 8, error: { code: -32602 } })
    expect(await rpc({ jsonrpc: '2.0', id: 9, method: 'resources/list' })).toMatchObject({ id: 9, error: { code: -32601 } })
    expect(JSON.parse((await h('{not json'))!)).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
    expect(await rpc({ id: 10, method: 'ping' })).toMatchObject({ id: 10, error: { code: -32600 } })
    expect(await rpc(null)).toMatchObject({ id: null, error: { code: -32600 } })
    expect(await h(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))).toBeNull()
  })
})

describe('describe', () => {
  it('names the code and the detail of a SolenoidError', () => {
    expect(describeError(new SolenoidError(403, 'out_of_scope', { scope: 'b' }))).toBe('solenoid: out_of_scope (403) {"scope":"b"}')
    expect(describeError(new SolenoidError(401, 'invalid_key'))).toBe('solenoid: invalid_key (401)')
    expect(describeError(new Error('x'))).toBe('x')
    expect(describeError('y')).toBe('y')
  })
})

describe('serveStdio', () => {
  it('answers one line per request, skips blank lines and notifications, and writes only JSON', async () => {
    const input = new PassThrough()
    const out: string[] = []
    const done = serveStdio(h, input, (s) => out.push(s))
    input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n')
    input.end()
    await done
    expect(out).toEqual(['{"jsonrpc":"2.0","id":1,"result":{}}\n', '{"jsonrpc":"2.0","id":2,"result":{}}\n'])
  })
})
```

- [ ] **Step 3: Run it to verify it fails, then implement `protocol.ts`**

Run: `cd mcp && pnpm vitest run test/protocol.test.ts`. Expected: FAIL, because the module is missing.

Before writing `SUPPORTED`, open https://modelcontextprotocol.io/specification/latest and put the newest dated revision first if it is newer than `2025-11-25`.

`mcp/src/protocol.ts`:
```ts
import { createInterface } from 'node:readline'
import { SolenoidError } from '@solenoid.systems/sdk'

export type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; call(args: Record<string, unknown>): Promise<string> }
export const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

type Msg = { jsonrpc?: unknown; id?: string | number | null; method?: unknown; params?: Record<string, any> }

export function describe(e: unknown): string {
  if (e instanceof SolenoidError) return Object.keys(e.detail).length ? `${e.message} ${JSON.stringify(e.detail)}` : e.message
  return e instanceof Error ? e.message : String(e)
}

export function server(tools: Tool[], info: { name: string; version: string }) {
  const byName = new Map(tools.map((t) => [t.name, t]))
  return async function handle(line: string): Promise<string | null> {
    let m: Msg
    try { m = JSON.parse(line) } catch { return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) }
    if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
      return JSON.stringify({ jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32600, message: 'invalid request' } })
    }
    if (m.id === undefined) return null
    const reply = (result: unknown) => JSON.stringify({ jsonrpc: '2.0', id: m.id, result })
    const error = (code: number, message: string) => JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code, message } })
    switch (m.method) {
      case 'initialize': {
        const asked = m.params?.protocolVersion
        return reply({ protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0], capabilities: { tools: {} }, serverInfo: info })
      }
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
      case 'tools/call': {
        const tool = byName.get(m.params?.name)
        if (!tool) return error(-32602, `unknown tool: ${m.params?.name}`)
        try {
          return reply({ content: [{ type: 'text', text: await tool.call(m.params?.arguments ?? {}) }] })
        } catch (e) {
          return reply({ content: [{ type: 'text', text: describe(e) }], isError: true })
        }
      }
      default:
        return error(-32601, `method not found: ${m.method}`)
    }
  }
}

export async function serveStdio(handle: (line: string) => Promise<string | null>, input: NodeJS.ReadableStream, write: (s: string) => void): Promise<void> {
  for await (const line of createInterface({ input })) {
    if (!line.trim()) continue
    const out = await handle(line)
    if (out !== null) write(`${out}\n`)
  }
}
```
Run it again. Expected: PASS.

- [ ] **Step 4: Write the failing tools tests against `testServer()`**

`mcp/test/tools.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { signup, solenoid } from '@solenoid.systems/sdk'
import { testServer } from '../../sdk/src/testing'
import { tools } from '../src/tools'

async function setup() {
  const server = await testServer()
  const o = { api: server.api, fetch: server.fetch }
  const { admin_key } = await signup(o)
  const admin = solenoid({ key: admin_key, ...o })
  await admin.limit('acme', { emails: 3, per: 'day' })
  await admin.spend('acme/bot', { emails: 1 })
  const byName = (list: ReturnType<typeof tools>) => Object.fromEntries(list.map((t) => [t.name, t]))
  return { admin, o, byName }
}

describe('tools', () => {
  it('gives a spend key only get and log', async () => {
    const { admin, o, byName } = await setup()
    const agent = solenoid({ key: await admin.deriveKey('acme'), ...o })
    expect(tools(agent, false).map((t) => t.name)).toEqual(['get', 'log'])
    const got = JSON.parse(await byName(tools(agent, false)).get.call({ scope: 'acme/bot' }))
    expect(got).toMatchObject({ scope: 'acme/bot', limits: [{ scope: 'acme', unit: 'emails', limit: 3, used: 1, left: 2 }], children: [] })
    expect(got.entries).toBeUndefined()
    const log = JSON.parse(await byName(tools(agent, false)).log.call({ scope: 'acme' }))
    expect(log.entries[0]).toMatchObject({ kind: 'spend', scope: 'acme/bot' })
    expect(log.next).toBeNull()
  })

  it('pages log with before and refuses a bad before or scope', async () => {
    const { admin, byName } = await setup()
    const log = byName(tools(admin, true)).log
    const first = JSON.parse(await log.call({ scope: '' })).entries[0].seq
    expect(JSON.parse(await log.call({ scope: '', before: first })).entries.every((e: { seq: number }) => e.seq < first)).toBe(true)
    await expect(log.call({ scope: '', before: 0 })).rejects.toThrow('"before" must be a positive integer')
    await expect(log.call({ scope: '', before: 1.5 })).rejects.toThrow('"before"')
    await expect(log.call({})).rejects.toThrow('"scope" must be a string')
    await expect(log.call({ scope: 'acme/..' })).rejects.toThrow('invalid scope')
  })

  it('lets the admin set and remove limits, and rotate a scope', async () => {
    const { admin, o, byName } = await setup()
    const t = byName(tools(admin, true))
    expect(tools(admin, true).map((x) => x.name)).toEqual(['get', 'log', 'set_limit', 'rotate'])
    const set = JSON.parse(await t.set_limit.call({ scope: 'acme', limits: { emails: 10 }, per: 'day', on_outage: 'open', warn_at: 0.8 }))
    expect(set.limits).toContainEqual(expect.objectContaining({ unit: 'emails', limit: 10, on_outage: 'open', warn_at: 0.8 }))
    const off = JSON.parse(await t.set_limit.call({ scope: 'acme', limits: { emails: null } }))
    expect(off.limits).toEqual([])
    await expect(t.set_limit.call({ scope: 'acme', limits: [1] })).rejects.toThrow('"limits" must be an object')
    await expect(t.set_limit.call({ scope: 'acme' })).rejects.toThrow('"limits"')
    const oldKey = await admin.deriveKey('acme')
    const r = JSON.parse(await t.rotate.call({ scope: 'acme' }))
    expect(r.scope).toBe('acme')
    expect(r.key).not.toBe(oldKey)
    await expect(solenoid({ key: oldKey, ...o }).get('acme')).rejects.toMatchObject({ code: 'invalid_key' })
    expect((await solenoid({ key: r.key, ...o }).get('acme')).scope).toBe('acme')
  })
})
```

- [ ] **Step 5: Run it to verify it fails, then implement `tools.ts`**

`mcp/src/tools.ts` (the descriptions are copy, and go to the gate in Step 10):
```ts
import type { Client, View } from '@solenoid.systems/sdk'
import type { Tool } from './protocol'

const SCOPE = { type: 'string', description: 'A scope such as "acme/bot". Use "" for the root.' }
const str = (a: Record<string, unknown>, k: string): string => {
  if (typeof a[k] !== 'string') throw new Error(`"${k}" must be a string`)
  return a[k] as string
}
const summary = (v: View) => ({ scope: v.scope, limits: v.limits, children: v.children })
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false })

export function tools(client: Client, admin: boolean): Tool[] {
  const read: Tool[] = [
    {
      name: 'get',
      description: 'Show every limit that applies at a scope, with its amount, window, usage and what is left, and list the scope\'s children.',
      inputSchema: obj({ scope: SCOPE }, ['scope']),
      call: async (a) => JSON.stringify(summary(await client.get(str(a, 'scope')))),
    },
    {
      name: 'log',
      description: 'List the signed entries at a scope and below, newest first, 50 at a time: spends, settles, limit changes and key rotations.',
      inputSchema: obj({ scope: SCOPE, before: { type: 'integer', minimum: 1, description: 'Show entries older than this sequence number. Pass the "next" value of the previous page.' } }, ['scope']),
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
      description: 'Set or remove limits at a scope. Map each unit to a number, or to null to remove its limit. Each unit named here is replaced whole, including its window and outage mode.',
      inputSchema: obj({
        scope: SCOPE,
        limits: { type: 'object', additionalProperties: { type: ['number', 'null'] }, description: 'For example {"emails": 3, "usd": null}.' },
        per: { enum: ['hour', 'day', 'week', 'month', 'child', 'child-day'] },
        on_outage: { enum: ['open', 'closed'] },
        warn_at: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
      }, ['scope', 'limits']),
      call: async (a) => {
        const limits = a.limits
        if (!limits || typeof limits !== 'object' || Array.isArray(limits)) throw new Error('"limits" must be an object that maps each unit to a number or null')
        const body: Record<string, number | string | null> = { ...(limits as Record<string, number | null>) }
        for (const k of ['per', 'on_outage', 'warn_at'] as const) if (a[k] !== undefined) body[k] = a[k] as string | number
        return JSON.stringify(summary(await client.limit(str(a, 'scope'), body)))
      },
    },
    {
      name: 'rotate',
      description: 'Revoke every spend key derived for a scope, and return a new one. Every deployed copy of the old key fails from now on.',
      inputSchema: obj({ scope: SCOPE }, ['scope']),
      call: async (a) => {
        const scope = str(a, 'scope')
        const v = await client.rotate(scope)
        return JSON.stringify({ scope, key: await client.deriveKey(scope, v.epoch) })
      },
    },
  ]
}
```
Run: `cd mcp && pnpm vitest run test/tools.test.ts`. Expected: PASS.

- [ ] **Step 6: Write the failing startup tests**

`mcp/test/main.test.ts`:
```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { signup, solenoid } from '@solenoid.systems/sdk'
import { testServer } from '../../sdk/src/testing'
import { clientFor, start } from '../src/main'
import { sandbox } from './setup'

describe('clientFor', () => {
  it('needs a spend key without --admin, and refuses an admin key there', () => {
    expect(() => clientFor([], {})).toThrow('SOLENOID_KEY')
    expect(() => clientFor([], { SOLENOID_KEY: 'sk.admin.abcdefghijkl.1.' + '0'.repeat(64) })).toThrow('--admin')
    expect(clientFor([], { SOLENOID_KEY: 'sk.spend.abcdefghijkl.1.0.YQ.' + '0'.repeat(64) }).admin).toBe(false)
  })
  it('reads the admin key from the credentials file with --admin', () => {
    const dir = join(sandbox, 'cfg-admin')
    mkdirSync(dir, { recursive: true })
    expect(() => clientFor(['--admin'], { SOLENOID_CONFIG_DIR: dir })).toThrow('solenoid login')
    writeFileSync(join(dir, 'credentials'), JSON.stringify({ api: 'https://api.solenoid.systems', admin_key: 'sk.admin.abcdefghijkl.1.' + '0'.repeat(64) }))
    expect(clientFor(['--admin'], { SOLENOID_CONFIG_DIR: dir }).admin).toBe(true)
  })
})

describe('start', () => {
  it('serves tools/list and tools/call over the given streams', async () => {
    const server = await testServer()
    vi.stubGlobal('fetch', server.fetch)
    const { admin_key } = await signup({ api: server.api })
    const key = await solenoid({ key: admin_key, api: server.api }).deriveKey('acme')
    const input = new PassThrough()
    const out: string[] = []
    const done = start([], { SOLENOID_KEY: key, SOLENOID_API: server.api }, input, (s) => out.push(s))
    input.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get","arguments":{"scope":"acme"}}}\n')
    input.end()
    await done
    const [list, call] = out.map((l) => JSON.parse(l))
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['get', 'log'])
    expect(JSON.parse(call.result.content[0].text).scope).toBe('acme')
  })
})
```

`mcp/test/bundle.test.ts` builds with `pnpm build`. It spawns `node dist/solenoid-mcp.mjs` with `SOLENOID_KEY` unset and HOME set to the sandbox, and expects exit code 1, a stderr line starting `solenoid-mcp: `, and empty stdout. Then it spawns it again with a well-formed spend key, and with an API on a port that fetch allows but nothing listens on. Get that port by listening on port 0 with `node:net`, reading the port, and closing the server; don't use port 9, which is on fetch's blocked list, so `checkApi` would exit before `ping`. It writes `{"jsonrpc":"2.0","id":1,"method":"ping"}\n`, closes stdin, and expects stdout to be exactly `{"jsonrpc":"2.0","id":1,"result":{}}\n`.

- [ ] **Step 7: Implement `main.ts` and `bin.ts`**

`mcp/src/main.ts`:
```ts
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { solenoid, type Client } from '@solenoid.systems/sdk'
import { fileStore } from '@solenoid.systems/sdk/node'
import { server, serveStdio } from './protocol'
import { tools } from './tools'

export const VERSION = '2.0.0'
type Env = Record<string, string | undefined>
const credsFile = (env: Env) => join(env.SOLENOID_CONFIG_DIR ?? join(homedir(), '.config', 'solenoid'), 'credentials')

export function clientFor(argv: string[], env: Env): { admin: boolean; client: Client } {
  if (argv.includes('--admin')) {
    let c: { api?: string; admin_key: string }
    try {
      c = JSON.parse(readFileSync(credsFile(env), 'utf8'))
    } catch {
      throw new Error(`--admin reads the admin key from ${credsFile(env)}, which is missing or unreadable. run \`solenoid init\` or \`solenoid login <admin-key>\` first.`)
    }
    return { admin: true, client: solenoid({ key: c.admin_key, api: c.api, store: fileStore() }) }
  }
  const key = env.SOLENOID_KEY
  if (!key?.startsWith('sk.spend.')) {
    throw new Error(`set SOLENOID_KEY to a spend key (sk.spend.…). to use the admin key instead, start with --admin, which reads it from ${credsFile(env)}.`)
  }
  return { admin: false, client: solenoid({ key, api: env.SOLENOID_API, store: fileStore() }) }
}

export async function start(argv: string[], env: Env, input: NodeJS.ReadableStream, write: (s: string) => void): Promise<void> {
  const { admin, client } = clientFor(argv, env)
  await serveStdio(server(tools(client, admin), { name: 'solenoid', version: VERSION }), input, write)
}
```

`mcp/src/bin.ts`:
```ts
import { start } from './main'

start(process.argv.slice(2), process.env, process.stdin, (s) => process.stdout.write(s)).catch((e: Error) => {
  process.stderr.write(`solenoid-mcp: ${e.message}\n`)
  process.exit(1)
})
```

- [ ] **Step 8: Run the package suite**

Run: `pnpm --filter @solenoid.systems/sdk build && cd mcp && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 9: Mutation gate**

Run: `cd mcp && pnpm run mutate --force`
Expected: the score is at least 90. There are zero survivors on:
- the `--admin` and spend-key checks;
- argument validation;
- JSON-RPC's invalid-request, parse-error and unknown-tool paths.

Afterwards `git status` must be clean. Add an MCP section to `MUTATION-SUMMARY.md`.

- [ ] **Step 10: Copy gate on the tool descriptions and startup errors**

Run a cold `/copy-chief` on:
- the four tool descriptions;
- the schema `description` strings;
- the two `clientFor` errors.

Use the medium "MCP tool descriptions, read by a model deciding which tool to call". Record the grade in `docs/copy/grades/mcp.md`.

- [ ] **Step 11: Commit**

```bash
git add mcp pnpm-workspace.yaml pnpm-lock.yaml docs/testing/MUTATION-SUMMARY.md docs/copy/grades/mcp.md
git commit -m "Ship @solenoid.systems/mcp 2.0.0 over the SDK"
```

---

### Task 6: Docs and the spec amendment

**Files:**
- Modify:
  - `sdk/README.md` and `sdk/llms.txt`: a Recovery section, and `outbox`/`mailDown` in Testing.
  - `README.md`: in Deploy, the `RESEND_API_KEY` secret, `MAIL_FROM`, and the ops tenant's recovery limits.
  - `docs/superpowers/specs/2026-09-24-solenoid-governance-design.md`: the Errors table, Signup and recovery, and MCP.
- Create: `mcp/README.md`

- [ ] **Step 1: Amend the spec** (these are the decisions at the top of this plan, stated as spec text):
  - Errors table: add `invalid_request`, `invalid_email` and `invalid_code` to the 400 row, and add a `502 | email_failed | the recovery or verification email could not be sent` row.
  - Signup and recovery:
    - `/auth/recover` is also limited per IP through the ops tenant (`recoveries/{hash}`, unit `recoveries`, set like `signups`).
    - The code email for recovery is sent after the `202`, so the response doesn't depend on whether the address matched.
    - Replace "5 failed attempts per code" with decision 9's rules: 10 attach codes per tenant per day, 3 live codes per purpose and email, and redemption locked after 5 failures an hour or 10 a day.
    - Codes are HMACs under `MASTER`.
    - Changing the address notifies the previous one.
    - State the accepted lockout risk.
  - MCP: add that the server refuses an admin key without `--admin`, that `rotate` covers scope keys only, and that it has no runtime dependencies.

- [ ] **Step 2: Write the docs**
  - **`sdk/README.md` / `llms.txt`, "Recovery":**
    - attach an address with `client.sendEmailCode(email)` and `client.verifyEmail(email, code)`;
    - recover with `requestRecovery(tenant, email)` and `recover(tenant, email, code, { rotate })`;
    - codes: 6 digits, 15 minutes, single-use, 5 tries, 5 requests per email per hour;
    - `requestRecovery` resolves the same way whether or not the address matches;
    - include one runnable example against `testServer()` using `server.outbox()`.
  - **`sdk/README.md` / `llms.txt`, "Testing":** add `outbox()` and `mailDown(on)` to the `testServer()` list.
  - **`mcp/README.md`:**
    - what it does;
    - the setup commands `claude mcp add solenoid -e SOLENOID_KEY=sk.spend.… -- npx -y @solenoid.systems/mcp`, and `-- npx -y @solenoid.systems/mcp --admin` for the admin tools;
    - the Claude Desktop JSON block;
    - the four tools;
    - the rule that a governed agent gets a spend key and never `--admin`.
  - **`README.md`, Deploy:**
    - `op read 'op://Personal/Solenoid Worker secrets/RESEND_API_KEY' | tr -d '\n' | pnpm exec wrangler secret put RESEND_API_KEY`;
    - the ops limit `solenoid limit recoveries recoveries=20 --per child-day`, run under the ops admin key as in step 3 of Deploy. There is no global recovery cap (decision 9).

- [ ] **Step 3: Run the docs' code blocks.**
  - Run the SDK examples exactly as written, against `testServer()`.
  - Run the MCP setup against the locally built `mcp/dist/solenoid-mcp.mjs`, not `npx`: the package is not on npm until Plan 3.
  - Don't run the Deploy commands (`wrangler secret put`, and the ops-tenant limits). Check them by reading them against Task 7 instead.
  - Fix what fails.

- [ ] **Step 4: Copy gate**

Run a cold `/copy-chief` on every changed section: Gate 0, V4 and C2 at minimum. Graders are plain `copy-grader` subagents, with the draft pasted inline. Fix every Gate 0 item, and re-check only Gate 0 after the last fix. Record the grades under `docs/copy/grades/`.

- [ ] **Step 5: Commit**

```bash
git add README.md sdk/README.md sdk/llms.txt mcp/README.md docs
git commit -m "Document email recovery and the MCP server"
```

---

### Task 7: Deploy email recovery

**This task needs Robin at three points.** Before Step 1: he supplies a Resend API key, or confirms one is in 1Password. At Step 1: he confirms that `solenoid.systems` is a verified sending domain in Resend. Before Step 5: he consents to real emails being sent to his address.

**Files:**
- Modify: none, apart from any runbook correction the dry run exposes.

- [ ] **Step 1: The secret.** Robin adds the field `RESEND_API_KEY[concealed]` to the 1Password item "Solenoid Worker secrets". Confirm that it's there without printing it: `op item get 'Solenoid Worker secrets' --fields RESEND_API_KEY --reveal | wc -c` should be non-zero. Then run `op read 'op://Personal/Solenoid Worker secrets/RESEND_API_KEY' | tr -d '\n' | pnpm exec wrangler secret put RESEND_API_KEY` from `worker/`.

- [ ] **Step 2: Ops limit, before the deploy.** The limit is data on the ops tenant, and the running Worker accepts it. Setting it first means `/auth/recover` is limited from its first request. Using the ops admin key and a temporary `SOLENOID_CONFIG_DIR`, as in Deploy step 3, run:
```bash
node cli/dist/solenoid.mjs limit recoveries recoveries=20 --per child-day
```
There is no global recovery cap (decision 9).

- [ ] **Step 3: Deploy.** From a clean `main`, run `cd worker && pnpm exec wrangler deploy` with SOLENOID_* unset. Expect `api.solenoid.systems (custom domain)` and a new version ID. Record that ID and the previous one, which is the rollback target.

- [ ] **Step 4: Smoke without email.**
  - `curl -s -X POST https://api.solenoid.systems/auth/recover -d '{"tenant":"abcdefghijkl","email":"nobody@example.com"}'` must return `{"status":"accepted"}` with status 202.
  - `curl -s -X POST https://api.solenoid.systems/auth/email -d '{}'` must return 401 `invalid_key`.

- [ ] **Step 5: Live smoke, with Robin's consent.**
  1. `solenoid email <robin's address>`: Robin reads the code, then run `solenoid email <address> <code>`.
  2. Expect the confirmation email naming `<tenant>`.
  3. `solenoid recover <address> --tenant <tenant>`, then `solenoid recover <address> <code> --tenant <tenant>`.
  4. Expect the saved admin key to be unchanged, compared by checksum and never printed.
  5. Do not use `--rotate`.

- [ ] **Step 6: Record** the deploy, the version IDs and the smoke results in the plan's execution record, and commit any runbook correction.

---

## Self-review

- **Spec coverage.** Signup and recovery:
  - `/auth/email` send and verify, one email per tenant with replacement, and the confirmation that states the tenant: Tasks 1 and 2.
  - `/auth/recover`, always 202, the default re-derive and `rotate`: Tasks 1 and 2.
  - The abuse limits: Task 1.
  - The fragile step first, with 502: Task 2.
  - Resend: Task 2.

  Stripe's automatic send at Checkout is Plan 3.
- **The rest of the spec.**
  - CLI `email`, `recover` and `init --email`: Task 4.
  - MCP `get`, `log`, and `set_limit` and `rotate` behind `--admin`, reading the credentials file: Task 5.
  - The Testing section's recovery bullet: Tasks 1 to 3.
  - Mutation over the recovery modules: Tasks 1, 2 and 5.
  - Migration's MCP deprecation and re-listing: deferred to Plan 3 (decision 8).
- **Types.**
  - `attachStart`, `attachVerify`, `recoverStart` and `recoverFinish` keep the same names and signatures in Tasks 1 and 2.
  - `Mail` and `Mailer` are defined in `worker/src/mail.ts` and re-exported from `sdk/src/testing.ts`.
  - `AccountOptions`, `requestRecovery` and `recover` match between Tasks 3 and 4, and `tools(client, admin)` matches between Task 5's tests and code.
- **Placeholders.** The three devDependency versions in `mcp/package.json` are copied from `cli/package.json` at Step 1. The MCP protocol list is checked against the live spec at Step 3. Both are lookups with a named source, not open design.
