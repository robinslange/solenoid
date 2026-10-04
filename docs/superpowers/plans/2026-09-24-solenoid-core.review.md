# Cold review: Solenoid Core (Plan 1)

Reviewed 2026-09-24 against the plan `2026-09-24-solenoid-core.md` (commit 440325fe), the spec `2026-09-24-solenoid-governance-design.md`, `~/dev/solenoid.systems/api` (toolchain), and `<vault>/learning-loop` (HEAD 5315ad0).

Method: I extracted the plan's Worker, SDK and fetch-budget code verbatim into a scratch tree (`/private/tmp/claude-501/solenoid-review/`) and ran the plan's own tests in the real runtimes: vitest-pool-workers 0.21.1 / workerd 1.20260804.1, and wrangler 4.137.0 / workerd 1.20260921.1. I also ran the fetch-budget tests on Node 22 and Node 26. Where the plan's code needed a fix before a later step could run, I say so and apply the smallest possible change.

## Verdict

**NOT READY.** Four blockers stop Task 1, and a fifth stops every spend, PUT and signup in tests, `wrangler dev` and production. None of them is a design problem, and all five have small fixes. After the fixes the ledger logic is sound: all 75 Worker tests and all 21 SDK tests pass for the right reasons. The remaining major findings are in idempotency scoping, the SDK's `run.llm` and outage semantics, and the deploy and litmus runbooks.

---

## Blockers

### B1. `@cloudflare/workers-types@^4.20260901.0` does not exist, so `pnpm install` fails. CONFIRMED
- **Plan:** Task 1 Step 2, `worker/package.json` (line 113).
- **Evidence:** `npm view @cloudflare/workers-types versions`: the last 4.x release is `4.20260702.1`, and everything after it is 5.x (the latest is `5.20260924.1`). pnpm reports `ERR_PNPM_NO_MATCHING_VERSION`.
- **Fix:** use `"@cloudflare/workers-types": "^5.20260801.0"`, or pin `4.20260702.1`. I typechecked against 5.20260924.1 (see B5), and it behaves the same as 4.x for this code.

### B2. `compatibility_date: "2026-09-01"` is newer than the workerd in vitest-pool-workers 0.21.x. Every test fails to start. CONFIRMED
- **Plan:** Task 1 Step 2, `wrangler.jsonc` (line 135). Task 1 Step 4 expects PASS.
- **Evidence (ran):** `vitest run` fails with `This Worker requires compatibility date "2026-09-01", but the newest date supported by this server binary is "2026-08-11"`. On a fresh install, `^0.21.1` resolves to 0.21.3 (miniflare `5.20260811.1-alpha`). Even 0.22.0 (miniflare `5.20260815.0-alpha`), which `^0.21.1` would not pick up anyway, is before 09-01.
- **Fix:** `"compatibility_date": "2026-08-01"`. With that date, every Worker test in Tasks 2–8 passes once B3 is fixed.

### B3. Node exports Ed25519 JWKs with `"alg":"Ed25519"`, and workerd rejects that on import. Every spend, PUT and signup throws and returns 500. CONFIRMED
- **Plan:** `importSigningKey` (line 599–600) passes the parsed JWK through unchanged. The key comes from `crypto.subtle.exportKey('jwk', …)` in Node: `vitest.config.mts` (149–150), `sdk/test/global-setup.ts` (1802–1804) and `worker/scripts/gen-secrets.mjs` (2767–2772).
- **Evidence (ran):**
  - Node 22.22, 24.10, 25.9 and 26.8 all export `{"key_ops":["sign"],"ext":true,"alg":"Ed25519",…}`.
  - Under the pool's workerd, 18 of 48 tests in Tasks 2–5 fail with `DataError: JSON Web Key Algorithm parameter "alg" ("Ed25519") does not match requested Ed25519 curve.`
  - On the newest workerd (1.20260921.1, via wrangler 4.137.0 `wrangler dev`), the same key fails the same way. The same JWK with `alg` stripped, or with `alg: 'EdDSA'`, imports and signs.
  - End to end: the SDK live tests against `wrangler dev` with the plan's `chain.ts` fail with `solenoid: internal (500)`. The server log shows `POST /auth/signup 500`, because signup spends in the ops tenant, which seals an entry.
  - Task 13's `gen-secrets.mjs` would put the same key into production.
- **Fix:** replace `importSigningKey` in `worker/src/chain.ts`:
  ```ts
  export const importSigningKey = (jwkJson: string): Promise<CryptoKey> => {
    const { kty, crv, x, d } = JSON.parse(jwkJson) as JsonWebKey
    return crypto.subtle.importKey('jwk', { kty, crv, x, d }, { name: 'Ed25519' }, false, ['sign'])
  }
  ```
  With this one change, all 75 Worker tests and both SDK live tests pass. Task 3 Step 4's "stop and report" line only anticipates `{ name: 'Ed25519' }` itself being rejected, so it would misdirect whoever hits this.

### B4. On pnpm 12 (installed: 12.4.2), `pnpm install` exits 1 because esbuild and workerd build scripts are not approved. CONFIRMED
- **Plan:** Task 1 `pnpm-workspace.yaml` (lines 71–73) has only `packages`.
- **Evidence (ran):** a scratch workspace with an esbuild dev dependency fails with `Error: ERR_PNPM_IGNORED_BUILDS … Ignored build scripts: esbuild@0.24.2`, exit 1. `onlyBuiltDependencies` (what the old repo uses) is no longer honoured: pnpm 12 wrote an `allowBuilds:` stub into the file and still exited 1. `allowBuilds: { esbuild: true }` exits 0.
- **Fix:**
  ```yaml
  packages: [worker, sdk, cli]
  allowBuilds:
    esbuild: true
    workerd: true
    sharp: true
  ```
  `sharp` arrives through miniflare. Alternatively, run `pnpm approve-builds` once and commit the result.

### B5. `tsc --noEmit` fails (Task 7 Step 5 expects "no type errors"), and the SDK build fails, which breaks Tasks 11 and 12. CONFIRMED
- **Worker, 73 errors with the plan's tsconfig:**
  1. `tsconfig.base.json` (87–94) sets no `lib`, so the DOM lib is loaded. Its `SubtleCrypto` hides workers-types' `crypto.subtle.timingSafeEqual` (`keys.ts`: `Property 'timingSafeEqual' does not exist on type 'SubtleCrypto'`), and `Uint8Array<ArrayBufferLike>` is not a `BufferSource` (chain.ts). Fix: `"lib": ["ES2022"]` in `worker/tsconfig.json`.
  2. Every `stub.spend/put/get` result is typed `never`, so there are about 60 errors in `index.ts` and the tests. RPC's `Serializable` mapping rejects `Record<string, unknown>` (`Fail.detail`, line 357; `Sealed.body`, line 572). I confirmed this by changing those to `Record<string, any>`: the `never` errors disappeared, under both workers-types 4.20260131 and 5.20260924.1.
  3. `sql.exec<LimitRow>` / `sql.exec<EntryRow>` fail the `Record<string, SqlStorageValue>` constraint because `LimitRow` and `EntryRow` are `interface`s (lines 808–809). Fix: declare them as `type X = {…}`.
  4. Test-only errors remain after the above: `(await res.json()).receipt` on `unknown` (http.test.ts 38, 52), and the `Sealed → Record<string, unknown>` cast in chain.test.ts:30. Fix: cast through `unknown`, or type `json<T>()`.
- **SDK:**
  - `sdk/tsconfig.json` (1779) sets `"types": []`, and devDependencies (1773) have no `@types/node`. `node.ts`, `global-setup.ts`, `bundle.test.ts` and `node.test.ts` then fail with `Cannot find module 'node:fs'` and `Cannot find name 'process'/'__dirname'`. `verify.ts:20` also hits the same BufferSource error.
  - The `build` script ends in `tsc -p tsconfig.build.json`, which exits 1. So `bundle.test.ts` fails in Task 11, and so does the CLI's `build` (2519), which calls the SDK build first. Every test in `cli/test/commands.test.ts` then fails.
  - Fix: add `@types/node` to the SDK's devDependencies, set `"types": ["node"]`, and cast `b64urlDecode(...)` results `as Uint8Array<ArrayBuffer>`, or return `new Uint8Array(buf)` from an `ArrayBuffer`.

---

## Major

### M1. The idempotency key is tenant-global, not bound to the scope. A second spend at another scope silently becomes a replay, and a confined spend key can read another subtree's receipts. CONFIRMED
- **Plan:** `spend`, lines 859–864, looks up `prior` by `idem` alone and checks only `body_hash`. The Worker's body hash (1586) covers only the amounts.
- **Evidence (ran in workerd):**
  - `spend(ADMIN,'a/x',{emails:1},'order-7','H')`, then `spend(ADMIN,'b/y',{emails:1},'order-7','H')` returns `{scope:"a/x", replay:true}`. Nothing is recorded or debited at `b/y`, and `b`'s limit is never checked.
  - A spend key confined to `b`, sending the same key, receives the receipt for scope `a/x`. `authorize` checked the request's scope, not `prior.scope`.
  - The SDK accepts caller-chosen `idempotencyKey`s, and something like `order-7` is the obvious choice across scopes.
- **What breaks:** a limit can be bypassed with no error, and data leaks across scopes.
- **Fix:** hash the scope into the body hash in `index.ts`: `sha256hex(jcs({ scope, amounts }))`. In the replay branch, also return `fail(409, 'idempotency_conflict')` when `prior.scope !== scope`. Add both cases above to `tenant-idempotency.test.ts`.

### M2. A 402 on `run.llm`'s spend after the call discards the paid-for response, records nothing, and leaves the cache stale. Every later call still reaches the provider. CONFIRMED
- **Plan:** `run.llm`, lines 2347–2355. The cache is only updated on a successful spend (2121–2122).
- **Evidence (ran, SDK with a stubbed transport):**
  - The GET reports `tokens.left = 500`. The provider reports 200 prompt tokens against an estimated ~5, so the post-call spend of about 690 gets a 402.
  - Three consecutive `run.llm` calls give `{providerCalls: 3, gets: 3, results: [LimitExceeded ×3]}`. The provider is billed three times, the ledger records nothing, and the caller never sees a response.
  - The input estimate (2309–2310) counts only `messages/input/prompt`. It misses Anthropic `system`, `tools` and OpenAI `response_format` (learning-loop's verify sends a JSON schema), so real underestimates are routine.
- **What breaks:** "enforced, not alerted". Once a budget is nearly spent, spending at the provider becomes unbounded while every spend is rejected.
- **Fix:**
  - The spec needs a rule for this. It currently says only "make the call, then spend the actual usage" (spec line 257).
  - Minimum for the SDK: on a post-call `LimitExceeded`, set `remaining.set(child, {…, [unit]: {left: 0}})` so the next call refuses locally, and return `res` instead of throwing, because the action already happened.
  - Better: have the Worker accept a post-hoc "settle" spend that records past the limit. The spec lists reserve-then-settle as out of scope, so the spec has to decide.
  - Either way, pin it with a test.

### M3. The outage mode is cached per exact scope, so `open` never applies to `run()` children or per-session scopes. `run.llm` ignores outage mode entirely. CONFIRMED
- **Plan:** `spend` catch (2124–2128) looks up `store.get(scope)` for the exact scope. `run()` always creates a fresh `…/run-<id>` child (2343). The first `run.llm` makes an unguarded `get(child)` (2350).
- **Evidence (ran):**
  - With `store.get` returning `'open'` for everything and the network down, `run.llm` throws the internal `Outage` class, not `null` or `SolenoidUnavailable`.
  - By trace: each new learning-loop session's first fetch spends at `learning-loop/research/<new-sid>`, which has never been cached, so an outage there throws `SolenoidUnavailable` even though the limit says `open`. Litmus check 3 (line 3000) concedes this "only happens with an empty cache", but with per-session scopes the cache is always empty for a session's first fetch.
- **Fix:** on an outage, walk the scope's ancestors in the store (`a/b/c` → `a/b` → `a` → `''`), and have `spend` also `store.set` the mode on the tightest limit's scope (`r.remaining[*].scope`). Wrap the GET in `run.llm` with the same outage handling. The spec text (line 261) should say "the scope or its nearest cached ancestor".

### M4. The lock gate in Task 4 Step 5 can never fail: without the lock, the concurrency test still passes. The spec's premise does not reproduce in workerd. CONFIRMED
- **Plan:** line 992 ("Temporarily change `serial` to `return fn()` … must FAIL with more than 10 successes") and the commit message at 999–1002 ("Without it, forty concurrent spends against a limit of ten all pass"). Spec line 168.
- **Evidence (ran):**
  - With `serial` replaced by `return fn()`, `tenant-spend.test.ts` gives 8 of 8 passing, and exactly 10 of 40 spends succeed. WebCrypto awaits do not open the input gate in workerd.
  - Adding `await new Promise(r => setTimeout(r, 1))` inside `seal` without the lock makes the concurrency test fail, so the test can detect interleaving. It just never sees any from crypto.
- **What breaks:** the executor is told to observe a failure that will not happen, and the commit records a false claim.
- **Fix:** keep the lock. Plan 2 adds Resend `fetch` calls, which do open the gate, so the lock will matter then. Change the check to: "temporarily add `await scheduler.wait(1)` at the top of `seal` **and** remove the lock; the test must fail; restore both." Reword the commit message. Correct spec line 168: crypto does not yield today, and the lock guards future I/O awaits.

### M5. The URL parser collapses dot segments before `parseScope` sees them. Review Focus 3 says this is pinned, but it isn't. CONFIRMED
- **Plan:** Review Focus 3 (line 33); the `parseScope` test cases `'..'` and `'a/%2e'` (256); the Worker's `parseScope(url.pathname.slice(4))` (1575); the SDK's unvalidated `path(scope)` (2115).
- **Evidence (ran in workerd):** `POST /v1/acme/%2e%2e/other` with an admin key returns 200, and the receipt's `scope` is `"other"`. In Node, `new URL` turns `/v1/acme/..` into `/v1/`. The raw-string unit tests pass, but the Worker never receives those strings.
- **What breaks:** `sol.spend('acme/..', …)`, or a scope built from untrusted input, debits the parent or a sibling with no error. A spend key is still confined by `within`, but an admin key is not.
- **Fix:** validate scopes in the SDK with the same grammar (and the not-all-dots rule) before building the URL, throwing `TypeError`, and do the same in the CLI's `scopeArg`. Add an SDK test with `'acme/..'` and `'acme/%2e'`.

### M6. The Task 13 runbook fails: the ops tenant is not initialised until the first signup, and `$SECRETS` has been deleted by Step 4. CONFIRMED (trace, plus a workerd probe)
- **Plan:** Step 2 says Robin "deletes the file" (2782). Step 4 then runs `jq -r .MASTER "$SECRETS"` (2795) and `login` before any signup (2797).
- **Evidence (ran):** GET `/v1/` with the ops admin key before any signup returns `401 {"error":"invalid_key"}`. `authorize` (910) fails when meta `tenant` is unset, and only `signup()` calls `ops.init` (1686–1687). `login` runs `get('')` (2690), so the `&&` chain stops at the first command.
- **Further problems:**
  - Once a signup has run first, Step 4's expected "five 201s, then 429" becomes four: the new `child-day` limit backfills today's earlier signup from the same IP.
  - Step 4's "both limits are listed" is also false; see m1.
  - An agentic executor does not keep shell variables between steps, so `$SECRETS` is empty anyway.
- **Fix:**
  - Run `curl -s -X POST …/auth/signup` before Step 4, or make `init` of `OPS_TENANT` idempotent at Worker start-up.
  - Reorder: Step 4 before the password-manager deletion, or read MASTER from the password manager.
  - State the expected count as "201 until the fifth signup from this IP today, then 429".

### M7. Tasks 15, 16 and 18 use a `solenoid` binary and an account that no step creates, and they talk to the old gateway. CONFIRMED
- **Plan:** Task 15 Step 2 (2986–2987) and Task 16 Step 4 (3104) run bare `solenoid limit …`. `which solenoid` finds nothing, and `@solenoid.systems/cli` and `sdk` return 404 on npm. No step runs `solenoid init` for Robin's own tenant; Task 13 only logs into the ops tenant, in a throwaway config dir.
- **The API default:** the SDK defaults to `https://api.solenoid.systems` (2089), which is still the **old gateway** until Task 18. The live check at 3005 and the verify-phase run set no `SOLENOID_API`, and the README outline (2469–2478) never mentions `SOLENOID_API`. So the fresh litmus agent cannot know about it.
- **Fix:**
  - Add a step after Task 13: `pnpm --filter @solenoid.systems/cli build && ln -s ~/dev/solenoid/cli/dist/solenoid.mjs ~/.local/bin/solenoid` (or `pnpm link --global`), then `SOLENOID_API=https://solenoid.<account>.workers.dev solenoid init`.
  - Export `SOLENOID_API` wherever `SOLENOID_KEY` is exported for learning-loop, and document the variable in README and llms.txt.
  - In Task 18, the same Worker serves both hostnames, so existing keys stay valid. "Switch learning-loop's SOLENOID_KEY" (3180) should be "unset SOLENOID_API".

### M8. Task 14 breaks an existing test it doesn't mention, and leaves a security test vacuous. CONFIRMED (read)
- **Deleting `bumpCount`:** the plan deletes it (2925) along with "the 'bump increments' and 'no-ops bump' cases". But `tests/gateway/fetch-budget.test.mjs:32-38` ("isolates counters per sessionId") also calls `bumpCount` and asserts `readCount(sessionId)` is `2`, a value set by the deleted test. The import at line 6 (`import { readCount, bumpCount }`) becomes a link-time `SyntaxError` for the whole file.
- **`tests/url-guard.test.mjs:178-185`** ("does not consume fetch budget on a blocked url") builds `{ n: 0, bump: () => bumped++ }`. After the seam change nothing calls `bump`, so the assertion passes forever, whether or not the budget seam is ever reached.
- **Fix:**
  - Rewrite "isolates counters" in terms of `tryBump`: `tryBump(other, tmpPd, 10)`, then `readCount`.
  - Drop `bumpCount` from the import.
  - Change url-guard's store to `{ tryBump: () => { bumped++; return true; } }`.
  - List both files in Task 14's **Files**.

### M9. The Stryker gate in Task 17 is likely unreachable with this toolchain, and the repo's own history says so. SUSPECTED
- **Plan:** Task 17 (3127–3146) sets `break: 80` and says "Do not add an exclusion".
- **Evidence:** `~/dev/solenoid.systems/api/MUTATION-SUMMARY.md:118-131` records Stryker plus vitest-pool-workers marking 62–91% of mutants NoCoverage, "DO logic unmapped". Every `TenantDO` line executes inside workerd, reached through RPC. The plan doesn't set `coverageAnalysis`, so it defaults to `perTest`, which relies on instrumentation that has to report back from the workerd isolate.
- **Fix:** set `coverageAnalysis: 'off'`. Run once before fixing the threshold, and judge by survivors inside the named functions, not by the overall score. If the runner cannot see DO mutants at all, pull the ledger core out of the DO into plain functions over a `SqlStorage`-like interface and mutate those.

---

## Minor

- **m1. A PUT or GET at the scope that owns a `per: child` or `child-day` limit doesn't show that limit.** `applicable` skips a limit when `childOn` returns null (941–942), and `view` reuses it (1291). Ran: `limit(s,'learning-loop/research','fetches',10,'child')` returns `limits: []`, and the limit only appears from `learning-loop/research/sess-1`. `solenoid ls learning-loop/research` will print "(no limits)". Fix: `view` should also list limits set *at* the scope with `used/left: null`.
- **m2. An empty PUT (`{}`) appends a `limit` entry and increments `nonspend_month`.** Ran: after `PUT /v1/a {}`, the entries are `["limit"]`. Fix: `parsePut` throws `invalid_limit` when there are no units and no rotation.
- **m3. `GET ?before=abc` returns 200 with no entries.** Ran. Validate the parameter with `NUM`, else 400.
- **m4. The spec paginates with `?after=<seq>` (spec line 149); the plan uses `?before=` (1579, 2136).** `before` is the correct word for a newest-first list. Update the spec, or it will be wrong in generated docs and llms.txt.
- **m5. Non-JSON PUT bodies get `invalid_amount`** (`parseJson`, 1531). They should get `invalid_limit`.
- **m6. `ceilMicro` inflates exact decimals of 1e6 units and above by one micro-unit.** Ran: 2M random fuzz values gave 9,521 inflations, e.g. `17561305.854471 → …472`, and no under-charges. This is harmless for `usd`. Document it, or use `Math.ceil(Math.round(v * 1e9) / 1e3) / 1e6`.
- **m7. `run()` at the root scope builds `/run-…`** (2343), which fails with `invalid_scope`. Use `scope ? \`${scope}/${id}\` : id`.
- **m8. `budgetScopeSegment` replaces `_`,** which is legal in the grammar (2921). This causes needless collisions (`a_b` and `a-b`). Use `/[^a-z0-9._-]/g`.
- **m9. `tryBump` calls `mkdirSync` outside its `try`** (2905). An unwritable plugin-data directory then throws out of the gateway, where the old `bumpCount` never threw. Move it inside the `try`.
- **m10. Stale-lock race** (2892). Two waiters can each `stat` an old lock, then one `unlink`s the other's fresh lock. This is rare because it needs a holder dead for more than 5 s. Acceptable, but say so.
- **m11. The chain tamper test covers 6 of 9 hashed or signed fields** (547: no `kind`, `kid` or `hash`). The spec (303) asks for "any single field" and "a random sequence of operations", but the plan uses a fixed three-step sequence. Add the missing fields and a seeded random operation sequence.
- **m12. Spec line 310 says "only the LLM provider's `fetch` is stubbed", and asks for property tests of the `max_tokens` cap.** The plan's `http.test.ts` and `llm.test.ts` stub Solenoid's own API, and there are no property tests.
- **m13. Spec line 290 puts verify under `learning-loop/verify/{sessionId}`.** The plan uses `sol.run('learning-loop/verify')`, which creates a random `run-*` child per process (3090). Every process adds a `scopes` row, and the GET `children` list for `learning-loop/verify` grows without bound or paging. Either record the deviation, or use the session segment.
- **m14. The line reference for Task 14 is `source-gateway.mjs:74-97`.** The budget block and `buildFileStore` actually span 74–103.
- **m15. Task 10 omits any model whose price can't be confirmed from its official page (2198).** Task 16 (3106) takes the Fireworks price "from prices.json in Task 10". If Task 10 left it out, Task 16 has no source. Have Task 16 read the price from Fireworks directly.
- **m16. `cli/vitest.config.ts` is referenced (2566) but never listed or written.**
- **m17. TypeScript `protected` is not runtime-private.** RPC exposes `setMeta`, `seal`, `writeEntry`, `forceHeadForTest` and the rest to any holder of a stub. Only the Worker holds stubs today. Use `#private` for anything that mutates.
- **m18. Test title "without writing a counter" (755) asserts nothing about counters.**
- **m19. `sdk/test/global-setup.ts` `proc.kill()` signals `pnpm`, not wrangler or workerd.** Port 8799 may stay bound between runs (SUSPECTED). It also overwrites any developer `worker/.dev.vars`.
- **m20. Signup per-IP limiting uses the full address** (1688–1689, spec 189). An IPv6 client rotates freely within a /64, so the only real limit is the global 1000/day breaker, which one client can use up for everyone. Key IPv6 on the /64. This is a spec-level item.
- **m21. `spend` returns remaining and on_outage from *current* state on replay (862–863), not the original.** That's reasonable, but the spec doesn't say which. Pin it in the spec.

---

## Claims checked

| Claim (plan location) | Result |
|---|---|
| workers-types `^4.20260901.0` installs (113) | **False**: 4.x ends at 4.20260702.1 (B1) |
| compat date 2026-09-01 runs under the pool (135) | **False**: max 2026-08-11 (B2); latest wrangler dev accepts it |
| `importKey('jwk', …, {name:'Ed25519'})` works in workerd (599) | Works only if `alg` is removed; Node-exported keys fail (B3) |
| `crypto.subtle.timingSafeEqual` exists in workerd (1490) | True at runtime (ran); missing from types when DOM lib loads (B5) |
| multi-statement `sql.exec(SCHEMA)` (838) | True (ran) |
| `transactionSync` (876, 1243) | True (ran) |
| `new_sqlite_classes` migration + `ctx.storage.sql` | True (ran) |
| `DurableObject<Cloudflare.Env>` + env.d.ts pattern | True, typechecks |
| `cloudflareTest({ wrangler, miniflare: { bindings } })` API | Matches `api/meter/vitest.config.mts`; works (ran) |
| RPC passes `Auth` objects and returns `Result` unions | Runtime true (ran); **types become `never`** (B5.2) |
| `runInDurableObject(stub, (i: TenantDO) => { i.now = … })` | Works and typechecks |
| `UNDER` prefix clause with positional binding | Correct: excludes `acme2`, root matches all (ran, pagination test) |
| month roll + `forceHeadForTest` arithmetic | Correct; tests fail if `checkPlan` or `nonspend` is removed (traced) |
| `per: child` / `child-day` counters and backfill | Correct for spends; PUT/GET view omits own-scope per-child limits (m1) |
| GET without lock cannot see torn state | True: `get`/`view` have no await; writes are in one `transactionSync` followed synchronously by the `head` update |
| lock is load-bearing (992) | **False** in workerd (M4) |
| idempotent replay (Task 5) | Passes; the negative check (delete `if (prior)`) does fail 2 tests. Cross-scope hole (M1) |
| "Dot segments pinned in Task 2" (33) | **False** end to end (M5) |
| All Worker tests Tasks 2–8 pass | True **after B2 + B3**: 75/75 (ran) |
| `pnpm typecheck` passes (1610) | **False** (B5) |
| SDK unit tests pass | True: 19/19 (ran); live 2/2 after B3 |
| SDK bundle dependency-free with `platform=neutral` + JSON import | True: esbuild 0.24.2 builds `dist/solenoid.mjs` (9.9 kB) with no imports (ran). `node.mjs` is a separate `platform=node` bundle with `node:` imports, which is correct |
| SDK "under 400 lines" | 297 lines in `src/` (ran `wc`) |
| `npm run build` for the SDK succeeds | **False**: tsc step exits 1 (B5) |
| `ceilMicro` never rounds tiny amounts to zero | True; slight inflation ≥1e6 (m6) |
| `run.llm` handles a response with no usage | Returns the response and **spends nothing** (ran: 0 POSTs). This is silent unmetered usage; treat it like M2 (spend the estimate, or throw) |
| retry only GET and idempotency-keyed POST | True (ran `http.test.ts`) |
| fetch-budget lock works on Node 22 / 26, `Atomics.wait` on main thread, `openSync(…,'wx')` | True: 12/12 on both. Without the lock: 11, 21, 28 successes of 30 (ran), so the test is meaningful |
| Budget seam change breaks only the files listed | **False**: `fetch-budget.test.mjs` "isolates" and `url-guard.test.mjs` (M8) |
| `model-client.mjs` variable names (`fetchFn`, `url`, `headers`, `body`, `timeoutMs`) | All exist (model-client.mjs:40–83) |
| `resolveProvider` in `librarian/config.mjs` | Exists at config.mjs:32; adding optional `price` breaks no existing test |
| `verify.mjs` `isMainModule` block and `verifyClaimGlm(…, opts)` | Exist at verify.mjs:74–125; vendor path `../../vendor/solenoid/` resolves to `plugin/vendor/solenoid` |
| old gateway owns `api.solenoid.systems` as a custom domain | True (`api/gateway/wrangler.jsonc:23-28`) |
| ops tenant unreachable by customers | True: `solenoidops2` needs a MASTER-derived key; `INTERNAL` is only constructed in `signup()`; `verifyKey` only returns admin/spend |
| spend key cannot PUT, or POST/GET outside its subtree | True (put-get tests + ran), except via idempotency replay (M1) |
| receipt forgery | Not possible without the signing key; `verifyReceipt` checks hash and signature |
| key parsing (split on `.`, canonical ints, gen≠0, b64url scope, MAC) | Sound; all nine forged/mangled cases in `keys.test.ts` rejected (ran) |

### Cost model recount (spec 225–228)

Rows written per non-replay spend in the plan's SQL:

| Write | Rows |
|---|---|
| `entries` insert (`seq INTEGER PRIMARY KEY` is the rowid, so no extra index) | 1 |
| `entries_idem` partial unique index (idem is always present, because the Worker requires it) | 1 |
| `counters` upsert, one per applied limit (`WITHOUT ROWID`, so no secondary index) | L |
| `scopes` `INSERT OR IGNORE` per ancestor | 0 when the scope exists; 1 per newly created segment (SUSPECTED that ignored inserts bill 0) |
| `meta` (`month`, `seq_month_start`, `nonspend_month`) | 3, once per month |

At steady state that is `2 + L` rows, matching the spec's "$2.00 + L". With the other items the total is $2.51 + L per million, which gives **$3.51 for L = 1 and $4.51 for L = 2**, so the spec's range holds. It does not hold for usage that creates a new scope per spend: `sol.run` children, per-session research scopes, and signup's per-IP scopes. Those add $1/M for each new segment, so a one-spend-per-run pattern costs $4.51–$5.51. The spec should state this. Storage per entry is closer to 450–500 bytes than 400 (two 64-hex hashes, an 86-character sig, a 64-hex body_hash and a 36-character idem, plus the index row).

---

## Commands run

- `pnpm/npm view` for pool, workers-types and Stryker versions. Results: pool 0.21.0–0.21.3 → miniflare `5.20260804.0`…`5.20260811.1`; latest 0.22.0 → `5.20260815.0`; workers-types 4.x ends `4.20260702.1`; `@solenoid.systems/{cli,sdk}` return 404.
- Scratch Worker (plan code verbatim, `node_modules` linked to `api/meter`): `vitest run`.
  - As written: runtime fails to start (B2).
  - With date 2026-08-01: 18 failures, `DataError … alg` (B3).
  - With the JWK fix: **75/75 pass**.
- Lock mutation: `serial → return fn()` gives 8/8 pass. Adding a `setTimeout(1)` yield makes the concurrency test fail.
- Probe tests in workerd: R1 per-child view `[]`; R2 cross-scope replay `{scope:"a/x", replay:true}` and a confined key receiving `a/x`; R3 ops GET before signup `401 invalid_key`; R4 `/v1/acme/%2e%2e/other` → receipt scope `"other"`; R5 `before=abc` → 200 empty, empty PUT → a `limit` entry.
- `tsc --noEmit`: 73 errors as written. The remaining categories were isolated by fixing `lib` and then the RPC types, under workers-types 4.20260131 and 5.20260924.1.
- Latest `wrangler dev` (4.137.0, workerd 1.20260921.1): Ed25519 JWK import `withAlg: DataError`, `stripped: ok`, `alg:'EdDSA': ok`, `timingSafeEqual: function`.
- SDK: esbuild neutral and node bundles build; `tsc -p tsconfig.build.json` exits 1; unit tests 19/19; live tests against `wrangler dev` 2/2 with the JWK fix and 2/2 failing (`internal (500)`) without it.
- SDK probes: post-call 402 gives `{providerCalls:3, gets:3, results:[LimitExceeded×3]}`; no-usage response gives 0 POSTs; outage on the first `run.llm` with store `'open'` throws `Outage`.
- `ceilMicro` fuzz over 2M values: 9,521 one-micro inflations, all ≥1e6 units; 0 under-charges.
- learning-loop scratch copy: plan's `tryBump` and tests 12/12 on Node 22.22.2 and 26.8.2. Unlocked variant: 11, 21 and 28 of 30 succeed (test fails as intended).
- pnpm 12.4.2: `ERR_PNPM_IGNORED_BUILDS`, exit 1, without `allowBuilds`; `onlyBuiltDependencies` ignored; `allowBuilds` exit 0.

All scratch work is under `/private/tmp/claude-501/`. Nothing in either repo was modified except this file.

## Deferred contradictions

- **Post-call overshoot in `run.llm` (M2)** spans Task 10 (SDK), Task 16 (verify through `run.llm`) and the spec. Nobody decides whether usage over the limit is recorded, dropped or thrown. Settle it before Task 10.
- **Outage-mode lookup (M3)** spans Task 9 (`spend`), Task 10 (`run`) and Task 15 (the litmus judge's check 3 assumes the current behaviour). Settle it before Task 9.
- **`SOLENOID_API` during the build (M7)** spans Task 11's docs, Task 15's litmus agent and live run, Task 16, and Task 18. None of them sets or documents it.
- **Fireworks price source (m15)** spans Tasks 10 and 16.
- There are no explicit "implementer's call" items in the plan.

## Not checked

- Whether Cloudflare bills 0 rows for `INSERT OR IGNORE` no-ops and counts the partial index write as 1 row. Settle this from DO analytics after Task 13 (spec risk 2).
- Stripe, email, MCP and site (Plans 2 and 3).
- Whether Ed25519 WebCrypto works in Bun and Deno for `sdk.verify` (spec claims Node 20+, Bun, Deno and Workers). Settle with a one-line import and verify on each.
- Whether `wrangler secret put` on a not-yet-deployed Worker prompts interactively when stdin is piped (Task 13 Step 2). Deploying first avoids the question.
- Whether removing the route from the old gateway's config and redeploying actually detaches the custom domain, or whether the new deploy must take it over (Task 18). Check in the dashboard, or use `wrangler deploy`'s takeover prompt.
- The CLI and the Task 16 learning-loop edits were traced by reading, not run.
- The README and llms.txt content: the plan specifies only an outline.
