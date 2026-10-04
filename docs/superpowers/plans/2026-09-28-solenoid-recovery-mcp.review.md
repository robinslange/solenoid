# Cold review: Plan 2, email recovery and the MCP server

Reviewed against HEAD 924bbed. Reviewer did not write the plan.

## Verdict

**Ready after fixes.** The design holds up, and so do most of the code-level claims (`handle()`, `testServer()`, the helpers, `#authorize`, `#serial`, `TENANT_RE`, `sha256hex`, the CLI harness, `checkApi`). But five of the tests the plan specifies fail against the plan's own code or against unlisted existing tests. The worst is that the SDK's `call()` turns every 5xx, including `502 email_failed`, into an `Outage`. So Task 3's `email_failed` tests, the e2e email test, and the CLI's `email_failed` explanation can't pass or be reached as written. Separately, the recovery abuse limits (spec-level) leave a lockout DoS and a spam relay open.

## Findings

### Blockers

**B1. `sendEmailCode` can never surface `email_failed`. The SDK's `call()` maps every 5xx to `Outage`.** CONFIRMED
- Plan: Task 3 Step 3 says "`502 email_failed` stays a `SolenoidError`" and routes `sendEmailCode` through `call(t, 'POST', '/auth/email', …)`.
- Code: `sdk/src/http.ts:18` has `if (res.status >= 500) throw new Outage(...)`. With no idempotency key, the catch at `http.ts:26` rethrows `Outage('request failed and is not safe to retry')`. Only the plan's new `authPost` has the 502 split, and `sendEmailCode` doesn't use it.
- Probe (scratch esbuild bundle of `sdk/src/http.ts`, fetch stubbed to return a 502 `{"error":"email_failed"}`) printed: `call 502 -> Outage request failed and is not safe to retry false`.
- What breaks:
  - Task 3 `account.test.ts` › "surfaces a failed send as email_failed" (`rejects.toMatchObject({ status: 502, code: 'email_failed' })`) fails.
  - `e2e/test/email.test.ts` fails.
  - Task 4's `explain('email_failed')` is unreachable. `solenoid email` and `init --email` print "request failed and is not safe to retry" when a send fails.
- Fix: in `sdk/src/http.ts` `attempt()`, replace line 18 with `if (res.status >= 500 && data.error !== 'email_failed') throw new Outage(\`HTTP ${res.status}\`)`. Add an `http.test.ts` case for it. Key `authPost`'s split on the body the same way: `res.status >= 500 && data.error !== 'email_failed'`, not `res.status !== 502`. Otherwise a Cloudflare edge 502 HTML page becomes `SolenoidError('unknown')` instead of an `Outage`.

**B2. `codes.test.ts` fails against the plan's own `normalizeEmail`: the 254-character boundary is off by one.** CONFIRMED
- Plan: Task 1 Step 1 expects `` `${'a'.repeat(64)}@${'b'.repeat(186)}.de` `` to be `null`.
- That string is 64 + 1 + 186 + 3 = 254 characters, and Step 3's code accepts `email.length <= 254`.
- `node -e` with the plan's regex and length check printed `186 254 accepted`.
- Step 4 ("PASS") fails.
- Fix: the RFC limit is 254, so keep the code and test one past it. Use `'b'.repeat(187)` (255 characters) for the `null` case, and `'b'.repeat(186)` (254) for the accepted case.

**B3. The MCP bundle test's "unreachable" API is on a port that fetch blocks, so the binary exits 1 before it answers `ping`.** CONFIRMED
- Plan: Task 5 Step 6, second spawn, uses API `http://127.0.0.1:9` and expects stdout `{"jsonrpc":"2.0","id":1,"result":{}}\n`.
- Code: `sdk/src/index.ts:34` lists port 9 in `FETCH_BLOCKED_PORTS`, and `checkApi` throws inside `solenoid()`, which runs in `clientFor`. The probe printed `port 9 -> solenoid: the API must be an http or https URL…`.
- Fix: use a port fetch allows that is also not listening. Bind a `net` server on port 0, read its port, close it, and use `http://127.0.0.1:<that port>`.

**B4. The new required `io` parameter on `handle()` breaks the SDK typecheck, through a file the plan doesn't list.** CONFIRMED
- Plan: Task 2 makes `io` required and lists only `sdk/src/testing.ts` on the SDK side. Step 8 runs `cd sdk && pnpm typecheck`.
- Code:
  - `sdk/test/client.test.ts:279, 302, 355, 369` call `handle(new Request(...), env, tenantFor)` with three arguments.
  - `sdk/tsconfig.json` includes `test`, so tsc reports "Expected 4 arguments, but got 3" four times.
  - The lefthook pre-commit typecheck blocks the commit.
- Fix: add `sdk/test/client.test.ts` to Task 2's files. Pass `{ mail: async () => {}, waitUntil: () => {} }` as the fourth argument at those four sites.

**B5. `authPost` changes what `signup` sends, and an existing SDK test pins the old request exactly.** CONFIRMED
- Plan: Task 3 Step 3 has `signup` send `{ method: 'POST', headers: { 'content-type': … }, body: '{}' }`.
- Code: `sdk/test/client.test.ts:62` asserts `expect(f.mock.calls[0]).toEqual(['https://api.solenoid.systems/auth/signup', { method: 'POST' }])`.
- Task 3 Step 5 ("PASS in worker, sdk, cli and e2e") fails.
- Fix: list `client.test.ts` in Task 3's files and update that assertion to the new init. Also add `signal: AbortSignal.timeout(2000)` to `authPost`, which the global constraint requires (see m1), and pin that too.

### Major

**M1. Task 4 breaks five pinned CLI strings the plan doesn't mention, and the new `rate_limited` explanation is wrong for signup.** CONFIRMED
- `cli/test/cli.test.ts:117-121` pins `init`'s full output. The new "attach a recovery email…" line breaks it.
- `cli/test/cli.test.ts:62-83` pins `HELP` verbatim. The three new lines break it.
- `cli/test/cli.test.ts:28`, used at `:255` and `:261`, pins the `invalid_key` explanation. Extending it breaks both uses.
- `cli/test/cli.test.ts:219-220` pins `init` on a signup 429 as `fails('solenoid: rate_limited (429)')`. The new `explain('rate_limited')` appends "at most 5 codes per email address per hour…" to a **signup** refusal, which is wrong: signup is limited per IP per day. The CLI can't tell which call produced it from the code alone.
- The plan names only `:706` and `format-error.test.ts`.
- Fix:
  - List those four pins in Task 4 Step 1.
  - Make the `rate_limited` text generic ("too many requests from this address or for this email; wait an hour, then try again"). Or explain it per command, not in `explain()`.

**M2. The CLI, e2e and MCP typechecks read SDK types from the git-ignored `sdk/dist`.** CONFIRMED
- `tsc --traceResolution` in `cli/` printed: `Module name '@solenoid.systems/sdk' was successfully resolved to 'sdk/dist/index.d.ts'`.
- After Task 3 adds `recover`, `requestRecovery`, `sendEmailCode` and `verifyEmail`, these steps fail with "has no exported member" until someone runs `pnpm --filter @solenoid.systems/sdk build`:
  - Task 4 Step 4 (`cli pnpm typecheck`).
  - Task 5 Step 8.
  - The lefthook typecheck on every later commit.
- In a fresh worktree, `dist` doesn't exist at all.
- Fix: add "run `pnpm --filter @solenoid.systems/sdk build`" at the end of Task 3 Step 3, and before Task 4 Step 4 and Task 5 Step 8.

**M3. The Stryker commands bypass each package's `mutate` script, which is where the sandbox lives.** CONFIRMED
- Plan: Tasks 3, 4 and 5 run `pnpm exec stryker run --force`.
- Code:
  - `sdk/package.json` `mutate` is `STRYKER=1 stryker run`, and `cli/package.json` `mutate` is `STRYKER=1 HOME="$(mktemp -d)" stryker run`.
  - `docs/testing/MUTATION-SUMMARY.md:158, 284, 294` explain why: `STRYKER=1` drops `bundle.test.ts`, which builds `dist` from the mutated in-place source, and the CLI needs the fresh `HOME`.
  - Task 5's `mcp/package.json` `mutate` is plain `stryker run`, so the "bundle.test exclusion under STRYKER" copied into its vitest config never takes effect.
- Fix:
  - Use `pnpm run mutate --force` in every package.
  - Set the mcp script to `STRYKER=1 HOME="$(mktemp -d)" stryker run`.
  - In the global constraints, state that Stryker always runs through the package's `mutate` script.

**M4. `/auth/email` has no per-tenant or per-IP send cap, so it can mail any number of third-party addresses.** CONFIRMED (from the plan's code)
- Plan: `authEmail` (Task 2 Step 6) checks only `#countSend`, which is per email (Task 1 Step 7). `perIp` wraps only `/auth/recover`.
- One free tenant (5 signups per IP per day) can send 5 code emails an hour to every address it names, from `auth@solenoid.systems` through Resend. That puts the sending domain's reputation on the line.
- Fix: add a per-tenant cap in the DO. For example, count `attach` sends per tenant, at most 10 an hour, in `code_sends` with the email set to `'*'`, or in a second counter. Or call `perIp(req, tenantFor, 'emails')` in `authEmail` and add the ops limit to Task 7 Step 3. Add it to the spec's abuse limits.

**M5. The abuse limits allow a lockout DoS, and a slow brute force that succeeds about 20% of the time in a year.** Arithmetic CONFIRMED; the policy is spec-level.
- Lockout:
  - The tenant ID is public by design, and the address is often guessable.
  - Anyone can send 5 `recoverStart` requests an hour for the owner's address. That exhausts the owner's per-email budget (`#countSend` runs before the match check), so the owner's own request gets 429.
  - Each request also replaces the owner's pending code (`ON CONFLICT … DO UPDATE`), and 5 wrong guesses burn it.
- Brute force:
  - 5 codes an hour × 5 tries is 25 guesses an hour, or 600 a day, which fits under the plan's ops limits (20 per IP per day across cheap IPv6 /64s, and 2000 a day globally).
  - 1 − (1 − 10⁻⁶)^219,000 ≈ 19.7% a year against one tenant. It is noisy, because the owner gets about 120 emails a day, but it is not bounded.
- Global DoS: the global `recoveries` cap of 2000 a day, which `/auth/recover` finish calls also consume, lets one actor turn recovery off for every tenant.
- Fix (amend the spec too):
  - Cap failed `recoverFinish` attempts per email per day, for example 10, and deny for 24 hours after that.
  - Keep up to N unexpired codes per purpose and email, so a new request doesn't invalidate an outstanding one.
  - Consider not charging a request that has no matching address against the owner's budget.
  - Consider a per-tenant global cap instead of a service-wide one.

**M6. The SDK's 2,000 ms timeout is shorter than the Worker's 5,000 ms Resend timeout on the same request.** CONFIRMED
- `solenoid()` sets `timeoutMs: opts.timeoutMs ?? 2000` (`sdk/src/index.ts:63`). `/auth/email` awaits `resendMailer`, whose `AbortSignal.timeout(5_000)` is at plan line 706.
- A slow Resend call aborts the client at 2 seconds with an `Outage`, while the Worker stores the code, still sends the email, and spends one of the 5 hourly sends.
- Fix: cut the Resend timeout to about 1,500 ms. Or give `sendEmailCode` and `verifyEmail` a longer timeout through `call`, and have the CLI build its client with `client(10_000)` for `email`, as `rotate --admin` already does.

**M7. The "does not count a recovery as a billable spend" test can't fail, and the helper the plan names for the sharper check returns nothing.** CONFIRMED
- The spend after rotation succeeds under the free allowance (100,000) whether or not `#bumpNonspend()` runs.
- The plan's fallback, "read `nonspend_month` with `sql()` from the helpers", doesn't work: `worker/test/helpers.ts:16-17` `sql()` wraps `exec` in a void callback.
- Fix: add a reading helper, then assert the value:
  ```ts
  export const meta = (stub: Stub, k: string) => runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => s.storage.sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray()[0]?.v)
  ```
  Then `expect(await meta(stub, 'nonspend_month')).toBe('1')`. Or use `setBillable(stub, FREE_SPENDS - 1)` before the rotation and expect the next spend to succeed.

**M8. Task 6 Step 3 says to run every docs code block "exactly as written", and some of those blocks touch production.** CONFIRMED
- The new Deploy lines include `op read … | wrangler secret put RESEND_API_KEY` and the ops-tenant `solenoid limit recoveries …` commands.
- `mcp/README.md` has `claude mcp add solenoid … -- npx -y @solenoid.systems/mcp`. `npm view @solenoid.systems/mcp` returns E404 today. Once anything is published, the command runs whatever is on npm, not the tree under review, and it edits Claude's config.
- Fix: limit Step 3 to the SDK and MCP-README blocks. Run the MCP one as `node mcp/dist/solenoid-mcp.mjs` with the same arguments, and mark the Deploy blocks as runbook-only.

### Minor

- **m1. `authPost` has no timeout.** CONFIRMED. The global constraint (line 34) requires 2,000 ms, but plan lines 1041-1053 pass no `signal`. `signup` had none before either.
- **m2. The failure the lock test predicts is wrong.** SUSPECTED. Without `#serial`, the second rotation's `#writeEntry` hits `entries.seq`'s PRIMARY KEY (both seals read the same `#head`), rolls back, and throws to `handle`, which answers 500. The statuses are `[200, 500]`, not `[200, 200]` or generation 3. The test still fails without the lock, but the Step 7 wording will confuse the implementer. Also, Decision 1 says "Task 1 pins this", when Task 2 Step 7 is what pins it.
- **m3. `init --email` placement is ambiguous.** CONFIRMED. "After `writeCreds`" puts the code before `const out` (`cli/src/commands.ts:147-148`), which won't compile. Placed after the scope block, it breaks `cli.test.ts:152` and `e2e/test/keys.test.ts:13`, which both require `.env`'s line to come last. Say "after `const out = …`, before `if (scope !== undefined)`".
- **m4. `mcp/test/setup.ts` needs more than the import dropped.** CONFIRMED. `cli/test/setup.ts` also calls `credsPath()` twice in `beforeEach`, and those calls must go too.
- **m5. `router.ts` needs a type import for `Io`.** CONFIRMED. `export type { Io } from './auth-routes'` doesn't bring `Io` into scope for `handle`'s signature, so the router also needs `import type { Io } from './auth-routes'`.
- **m6. Some mutants are predictably equivalent.** SUSPECTED.
  - The `!this.#meta('tenant')` guards in `recoverStart` and `recoverFinish` give the same result without them: `recovery_email` is undefined, so the answer is still `null` or `invalid_code`. The "zero survivors on reject paths" gate will flag them. Record them under the redundant-guard ruling, or pin them with 6 `recoverStart` calls on an empty tenant that all return `null` and none return 429.
  - `testServer`'s `p.catch(() => undefined)` is dead, because `later()` already catches.
  - `index.ts`'s `waitUntil` arrow isn't reached by any `SELF` test. Add a `SELF` `/auth/recover` 202.
- **m7. Code hashes add almost nothing.** CONFIRMED. `hashCode` is an unkeyed SHA-256 over 10⁶ codes, with the email in the same row, so a hash reverses in milliseconds. It meets the spec's "stored hashed" literally. HMAC under `MASTER` would make it meaningful, though `TenantEnv` would have to carry it.
- **m8. Replacing the recovery email doesn't notify the old address.** SUSPECTED. With a stolen admin key, an attacker can swap in their own address silently. Send `confirmMail`, or a "your recovery address changed" message, to the previous address as well.
- **m9. The email regex is loose.** CONFIRMED. It accepts `a@b..cd`, `a@b.cd.` and control characters other than whitespace (`a@b.c\u0000d` passed). None is a security hole, since only an admin sets the address.
- **m10. The worker test pool loads `worker/.dev.vars`.** CONFIRMED: the test run printed "Using secrets defined in .dev.vars". If `RESEND_API_KEY` ever lands there, the "deployed entry" test sends real mail. Pin it with `miniflare.bindings: { RESEND_API_KEY: '' }` in `vitest.config.mts`; `resendMailer` treats `''` as unset.
- **m11. Task 7 deploys before the ops `recoveries` limits exist.** CONFIRMED. The limit is data on the ops tenant, so it can be set against the running Worker. Swap Steps 2 and 3.
- **m12. The copy gates run after the test and mutation gates in Tasks 2, 4 and 5.** CONFIRMED. The tests pin copy: the code in the subject, the text `solenoid email <address>`, and the text `solenoid email robin@example.com`. Run the copy gate before the tests, or re-run tests and Stryker after any copy fix.
- **m13. `recover` ignores the saved account's API.** SUSPECTED. It uses `apiBase()` (`SOLENOID_API` or production), so recovering an account on another host needs `SOLENOID_API` set, and nothing says so.
- **m14. There may be no public 1.x MCP package to deprecate.** SUSPECTED. `npm view @solenoid.systems/mcp` (and `/sdk` and `/cli`) returns 404 from this machine. The old 1.1.0 exists only in `~/dev/solenoid.systems/mcp`, so Decision 8's "deprecating 1.x" may be moot, or the scope may be private. Check it before Plan 3.
- **m15. Task 1 Step 6's expected error text is wrong.** Over RPC, a missing method fails as "The RPC receiver does not implement the method…", not "`stub.attachStart is not a function`".

## Security walk (asked for explicitly)

| Threat | Result |
|---|---|
| Finding emails by trying them on `/auth/recover` | Holds. The same 202 and body come back for any address; the send happens after the response; `countSend` runs before the match, so the 429 behaves the same either way. Leaks: an uninitialised tenant never 429s, which reveals that a tenant exists, but tenant IDs are public anyway. The timing gap between the two paths (one SHA-256 and one INSERT) is negligible. |
| Brute force | Bounded per code, not per email over time. About 20% a year (M5). |
| Replaying a code | Holds. `#redeem` deletes the row on success, and on expiry. |
| Rotating twice | Holds. One code per `(purpose, email)`, `#serial`, and single use. Pinned under Node by Task 2 Step 7 (see m2 for the predicted failure). |
| Admin key reaching a governed agent | Holds. `clientFor` refuses anything but `sk.spend.` without `--admin`, and no tool returns the admin key. |
| Lockout | Open (M5). |
| Spam relay | Open (M4). |

## Claims checked

| Plan claim | Result |
|---|---|
| `handle(req, env, tenantFor)` has 3 parameters; `route` mirrors it | Holds (`router.ts:49, 82`). Callers the plan doesn't list: `sdk/test/client.test.ts:279, 302, 355, 369` (B4). |
| `OPS_TENANT`, `ipKey` and the signup per-IP spend are in `router.ts` | Holds (`router.ts:15-31`). |
| `INTERNAL`, `sha256hex`, `TENANT_RE`, `adminKey`, `spendKey`, `verifyKey`, `ApiError`, `failResponse`, `json`, `fail`, `ok` exist with the shapes used | Holds. |
| `Tenant` has `#serial`, `#authorize`, `#meta`, `#setMeta`, `#rollMonth`, `#bumpNonspend`, `#seal`, `#writeEntry`, `#head`, `#rows` | Holds (`core.ts`). |
| `#authorize(auth, '', 'admin')` gives 403 `admin_required` for a spend key, and 401 for a stale generation | Holds (`core.ts:240-249`). |
| `TenantApi` is a `Pick`, and `TenantDO` forwards methods | Holds (`core.ts:20`, `tenant.ts:16-20`). |
| helpers `ADMIN`, `setNow`, `tenant`, `Stub`, `sql` | They exist. `sql` can't read (M7). |
| 234 existing Worker tests | Holds (the run printed 234 passed). |
| `testServer()` shape; `signup`, `setNow` and `outage` | Holds (`testing.ts:5-72`). |
| The CLI harness: `freshServer`, `useConfigDir`, `tempDir`, `solenoid(cwd, …)` | Holds (`cli/test/run.ts`). |
| `readCreds`, `writeCreds`, `hasCreds`, `credsPath`, `apiBase` | Hold (`cli/src/config.ts`). |
| `call()` retries only `GET` and idempotency-keyed `POST` | Holds (`http.ts:21`). But it maps 502 to `Outage` (B1). |
| `checkApi` refuses blocked ports | Holds, which is what breaks B3. |
| `signup(api?: string)` today, used with a string by the CLI and e2e | Holds. The exact-init pin (B5). |
| `View` and `Client` are exported from the SDK | Hold (`types.ts`, `index.ts:193`). |
| `client.get(scope, { before })`, `limit`, `rotate` (returns `View.epoch`), `deriveKey(scope, epoch)` | Hold. |
| `checkScope('acme/..')` throws "invalid scope" | Holds (`scope.ts:6`). |
| `contract/scenarios.ts` has `Target`, `Scenario.needsClock` and `code()`; e2e skips on `needsClock` | Holds (`scenarios.ts:4-20`, `contract.test.ts:9`). |
| Per-test storage isolation in the worker pool | Holds (pool-workers 0.21.3 README: "isolated per-test storage"). |
| `MAIL_FROM` reaches tests through `configPath: wrangler.jsonc` | Holds. |
| CLI and MCP tsc resolve the SDK from source | Doesn't hold. They resolve from `sdk/dist` (M2). |
| `pnpm exec stryker run --force` is equivalent to the package gate | Doesn't hold (M3). |
| Decisions 1-8 against the spec | They refine it; none contradicts it. Decision 2 settles a real conflict in the spec, between "fragile step, 502" and "always 202", in the right direction. Decision 8's "deprecate 1.x" is doubtful (m14). |
| Test timing: 15-minute expiry at `expires <= now`, hourly window at `at <= now - HOUR` | Consistent between tests and code, and the boundary mutants are killed. |
| Outbox order | Deterministic. Both mailers push synchronously when called, so `[attach, confirm, recover]` holds. |

## Commands run

- `git log --oneline -3` printed HEAD 924bbed.
- `pnpm vitest run` in `worker/` printed 13 files and 234 tests passed, along with "Using secrets defined in .dev.vars".
- A scratch esbuild probe of `sdk/src/http.ts` and `index.ts` printed `call 502 -> Outage …` and `port 9 -> solenoid: the API must be…`.
- `node -e` with the plan's `normalizeEmail` printed `185 253 accepted` and `186 254 accepted`.
- `tsc --noEmit --traceResolution` in `cli/` showed the SDK resolving to `sdk/dist/index.d.ts`.
- `npm view @solenoid.systems/{mcp,sdk,cli}` returned E404.
- `cut -d= -f1 worker/.dev.vars` printed one line, `stale`. Only names were read, no values.

## Deferred contradictions

- **Copy-gate edits against structural tests (Tasks 2, 4, 5).** The gate may rewrite strings that tests match: the code in the subject, `solenoid email <address>`, `solenoid email robin@example.com`, `--tenant`, `--force`. Settle which substrings are frozen before the copy passes run.
- **`init --email` placement (m3).** Task 4's code and the existing `init` and e2e pins read the phrase "after writeCreds" differently.
- **The `rate_limited` wording (M1).** It is shared by `init` (signup) and `email`/`recover`, and Task 4 writes it for one of them only.

## Not checked

- Whether `vi.spyOn(crypto, 'getRandomValues')` works inside workerd, since that `crypto` may not be patchable. Run `codes.test.ts` once to settle it.
- Whether Task 1's test helper `code(r: Promise<{ ok; value? }>)` typechecks against the RPC-wrapped stub return types. Run `pnpm typecheck` after Step 5.
- The live MCP protocol versions (`2025-11-25`), and Resend's current API shape. The latter was not fetched.
- That `<tenant>` is Robin's tenant. `~/.config/solenoid` was deliberately not read.
- The implementations were not built or run. Every test verdict above comes from reading the code, except B1, B2 and B3, which were probed.
