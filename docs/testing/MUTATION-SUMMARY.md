# Mutation summary

Each package in the test-hardening phase records its coverage before and after, its mutation score, and every surviving mutant here. The gates are the same for every package: 100% of lines and at least 95% of branches in every mutated file, a Stryker score of at least 90 (`thresholds: { high: 95, low: 90, break: 90 }`), and no surviving mutant on a path that rejects or limits something unless it is recorded below as equivalent.

## Worker (`worker/`)

Commands: `pnpm --filter @solenoid/worker coverage` (istanbul inside workerd) and `pnpm --filter @solenoid/worker mutate` (Stryker, `worker/stryker.config.mjs`). Reports go to `worker/reports/`, which git ignores.

### Stryker configuration, and where it departs from the brief

- **Mutated:** every file in `worker/src` except `env.d.ts`: `amounts, auth, auth-routes, billing-routes, chain, codes, core, errors, http, index, keys, mail, ops, router, scope, stripe, tenant, windows`. That is 2,046 mutants after Plan 3a Task 3 and its fix round added `billing-routes.ts`, `stripe.ts` and the billing methods (1,547 after the Plan 2 final-review fixes, 1,537 after Plan 2 Task 2 added `auth-routes.ts`, `mail.ts` and `ops.ts`, 1,363 after Plan 2 Task 1 added `codes.ts` and the recovery methods in `core.ts`, 1,172 at the end of Plan 1, 1,168 before the Plan 1 follow-ups, 1,164 before the final-review fix wave). Task 24 split the ledger out of `tenant.ts` into `core.ts` (class `Tenant` over a small `Sql` interface) and the fetch handler out of `index.ts` into `router.ts` (`handle(request, env, tenantFor)`), so that `testServer()` can run the same code on `node:sqlite`. `tenant.ts` is now a thin `DurableObject` wrapper and `index.ts` passes the stub lookup. The DO tests still reach `core.ts` through `env.TENANT` RPC, and its mutants are killed inside workerd (98.28%).
- **`vitest: { related: false }`**, which the brief did not name, is the setting that matters. By default Stryker runs only the test files that import the mutated file. The TenantDO tests reach `tenant.ts`, `windows.ts` and `scope.ts` through `env.TENANT` RPC, and import only types from `src/tenant`, so Stryker never ran them. With the default setting, `tenant.ts` scored 27.6% and the whole run 53.0%, and mutants that break dozens of tests (`perChild → true`) survived. With `related: false`, every mutant runs the whole suite.
- **`coverageAnalysis: 'off'` without `ignoreStatic`.** Stryker 10 refuses the combination: "ignoreStatic is not supported with coverage analysis off". `ignoreStatic` only has meaning with `perTest`. The brief's reason for `off` was that per-test coverage cannot report back from workerd, but that turned out to be wrong. The real failure was `related`. With `related: false`, a `perTest` run on `windows.ts` gave the same result as `off` (36 against 37 killed, the same 2 survivors). `off` was kept, as the brief says. A full run takes about two and a half minutes on four runners.
- **`plugins: ['@stryker-mutator/vitest-runner']`** is set explicitly, because pnpm's isolated `node_modules` hides the plugin from Stryker's discovery.
- `incrementalFile` is `reports/stryker-incremental.json`, so it stays inside the ignored directory. After a change that moves code between files or changes what a guard depends on, run `pnpm --filter @solenoid/worker mutate --force`: the incremental run reuses a mutant's old result when its line and the tests look unchanged, and after the Task 24 split it reported the `HEX64` anchors as surviving when a direct run killed one of them.

### Coverage (istanbul, `src/**/*.ts` minus `env.d.ts`)

"Before" is the start of Task 17. "After" is from the coverage run after Plan 3a Task 3's fix round, for every row. Task 24 split `core.ts` out of `tenant.ts` and `router.ts` out of `index.ts`, so their before columns are the old files' numbers.

| File | Lines before | Branches before | Lines after | Branches after | Statements after | Functions after |
|---|---|---|---|---|---|---|
| amounts.ts | 100 | 100 | 100 | 100 (26/26) | 100 | 100 |
| auth.ts | 100 | n/a | 100 | n/a (0/0) | 100 | 100 |
| auth-routes.ts (Plan 2 Task 2) | n/a | n/a | 100 | 100 (41/41) | 100 | 100 |
| billing-routes.ts (Plan 3a Task 3) | n/a | n/a | 100 | 100 (45/45) | 100 | 100 |
| chain.ts | 100 | 100 | 100 | 100 (23/23) | 100 | 100 |
| codes.ts (Plan 2 Task 1) | n/a | n/a | 100 | 100 (6/6) | 100 | 100 |
| core.ts (was tenant.ts) | 100 | 95.52 | 100 | 99.06 (212/214) | 99.74 | 98.50 |
| errors.ts | 100 | 100 | 100 | 100 (6/6) | 100 | 100 |
| http.ts | 100 | 95.12 | 100 | 100 (41/41) | 100 | 100 |
| index.ts | 94.33 | 89.65 | 100 | n/a (0/0) | 100 | 100 |
| keys.ts | 96.77 | 85.71 | 100 | **93.93 (31/33)** | 100 | 100 |
| mail.ts (Plan 2 Task 2) | n/a | n/a | 100 | 100 (9/9) | 100 | 100 |
| ops.ts (Plan 2 Task 2, from router.ts) | n/a | n/a | 100 | **92.30 (12/13)** | 100 | 100 |
| router.ts (was index.ts) | 94.33 | 89.65 | 100 | 100 (65/65) | 100 | 100 |
| scope.ts | 100 | 95.65 | 100 | 95.65 (22/23) | 100 | 100 |
| stripe.ts (Plan 3a Task 3) | n/a | n/a | 100 | 100 (39/39) | 100 | 100 |
| tenant.ts (DO wrapper) | n/a | n/a | 100 | 100 (10/10) | 100 | 100 |
| windows.ts | 94.73 | 92.85 | 100 | 100 (14/14) | 100 | 100 |
| **All** | 98.65 | 94.13 | **100** | **99.01 (602/608)** | 99.89 | 99.48 |

Every line is covered. `ops.ts` is below the 95% branch gate by one branch out of 13: Plan 2 Task 2 moved the per-IP ops spend out of `router.ts` into `ops.ts` (`perIp`, now shared by signup and recovery), and with it the dead non-402 branch below, which `router.ts` used to absorb among 60. `keys.ts` is below the 95% branch gate by two branches out of 33. It lost one covered branch when Task 24 replaced `same()` and its length check with `crypto.subtle.verify('HMAC')`, which Node's WebCrypto also has. The six uncovered branches are all fallbacks that can never run:

| File:line | Branch | Why it cannot run |
|---|---|---|
| keys.ts:40 | `p[4] ?? ''` | Only reached when `p.length === 5`, so `p[4]` is always a string. |
| keys.ts:45 | `mac ?? ''` | Only reached when `p.length === 7`, so `mac` is always a string. |
| scope.ts:29 | `split('/').at(-1) ?? ''` | `split` always returns at least one element. |
| ops.ts:21 (was router.ts:31) | `failResponse(r)` on a non-402 ops spend | The ops spend runs with `INTERNAL` auth, right after `init`, under a fresh UUID. It can only fail with 402. |
| core.ts:127, was 123 (×2) | `actual[unit] ?? 0`, `heldUnits[unit] ?? 0` | Lines 121–122 have already refused any settle whose units differ from the hold's, reading both maps with `Object.hasOwn`. See the correction below. |

**Correction (final review).** This table used to say the `core.ts` `?? 0` was dead "because lines 117–118 have already refused any settle whose units differ". That was false. Those lines tested `unit in actual` and `unit in heldUnits`, and `in` reads the prototype. `constructor` passes the unit grammar, and `'constructor' in {}` is true, so a settle that left out a held `constructor` passed the guard, and `actual.constructor ?? 0` was the function `Object`, not 0. The same prototype read broke the backfill (`b[unit] ?? 0`) and `remaining` (`!best[c.unit]`). A PUT or settle then wrote `NaN` into `counters.used`. workerd binds `NaN` as SQL `NULL` (checked with a scratch test inside workerd: a direct `INSERT` of `NaN` into a `NOT NULL` column fails the same way), so the `NOT NULL` constraint failed, the transaction rolled back and the request returned 500: no counter was reset, but the unit could never be limited. The guards now use `Object.hasOwn`, the backfill reads through the same own-property helper, and `remaining` is built in a `Map`. With own-property guards in front of it, the `?? 0` is now genuinely unreachable, and it stays as a redundant guard. `api.test.ts` › units named after Object.prototype members and the contract scenario › limits, holds and settles a unit named constructor like any other pin it through `SELF.fetch` and `testServer()`.

The one uncovered function in `core.ts` is the `run.catch(() => undefined)` arrow in `#serial` (core.ts:285). It never runs because the ledger methods return `Result` values and never reject.

Deleting the two dead `??` fallbacks in `keys.ts` would lift it to 100% and remove two equivalent mutants (see below). That was not done: the change touches key verification, so it is left for Robin to decide.

### Mutation score

| Run | Score | Killed | Timeout | Survived | No coverage |
|---|---|---|---|---|---|
| Before, default `related` (misconfigured) | 53.01 | 563 | 1 | 461 | 39 |
| Before, `related: false`, existing tests | 83.07 | 951 | 1 | 176 | 18 |
| After Task 17 | 97.38 | 1,114 | 2 | 27 | 3 |
| After the Task 24 split (`--force`) | 97.68 | 1,135 | 2 | 24 | 3 |
| After the final-review fix wave (`--force`) | 97.69 | 1,138 | 2 | 24 | 3 |
| After fix wave round 2 (`--force`) | 97.69 | 1,139 | 2 | 24 | 3 |
| After the Plan 1 follow-ups (`--force`) | 97.70 | 1,143 | 2 | 24 | 3 |
| Plan 2 Task 1, the brief's tests only (`--force`) | 97.12 | 1,311 | 3 | 36 | 3 |
| Plan 2 Task 1, before its review fixes (`--force`) | 97.78 | 1,320 | 3 | 27 | 3 |
| After Plan 2 Task 1's review fixes (`--force`) | 97.65 | 1,327 | 4 | 29 | 3 |
| Plan 2 Task 2, the brief's tests and the recover 429 test (`--force`) | 96.14 | 1,466 | 4 | 56 | 3 |
| After Plan 2 Task 2's added tests (`--force`) | 97.77 | 1,490 | 4 | 31 | 3 |
| After Plan 2 Task 2's fix round (`--force`) | 97.79 | 1,499 | 4 | 31 | 3 |
| After the Plan 2 final-review fixes (`--force`) | 97.74 | 1,508 | 4 | 32 | 3 |
| F5 (small-followups), before the added test (`--force`) | 97.71 | 1,530 | 4 | 33 | 3 |
| After F5's added test (`--force`) | 97.77 | 1,531 | 4 | 32 | 3 |
| Plan 3a Task 2, the brief's tests only (`--force`) | 97.54 | 1,584 | 4 | 36 | 4 |
| After Plan 3a Task 2's added test (`--force`) | 97.73 | 1,587 | 4 | 34 | 3 |
| Plan 3a Task 3, the brief's tests only (`--force`) | 95.56 | 1,953 | 4 | 84 | 7 |
| After Plan 3a Task 3's added tests (`--force`) | 97.65 | 1,987 | 4 | 45 | 3 |
| **After Plan 3a Task 3's fix round** (`--force`) | **97.65** | **1,994** | **4** | **45** | **3** |

Per file, after the fix wave: amounts 97.40, auth 66.67 (one of three), chain 95.49, core 98.28, errors 96.15, http 100, index 100, keys 95.24, router 97.66, scope 98.86, tenant 100, windows 100. The fix wave's new code in `core.ts` (the own-property reads) and `router.ts` (the retired signing keys) left no survivor. A first version of the router change also swapped the settle-body check `'settle' in b` for `Object.hasOwn(b, 'settle')`, which made the `typeof b === 'object'` before it redundant and added one equivalent survivor. `settle` is a reserved body key, not a unit, and no `Object.prototype` member has that name, so the `in` check was put back. Round 2 guarded the parse of `RETIRED_SIGNING_KEYS`: a value that is not JSON is ignored, entries without a string `x` are skipped, and an object-valued var is read as is. It left no survivor either.

The Plan 1 follow-ups (F-5) made `b64urlDecode` in `chain.ts` canonical: it re-encodes the bytes it decoded and throws a `SyntaxError` unless that gives back its input. A spend key's scope field, or a signature, that decodes to the right bytes but is spelled differently (set unused bits in the last character, `=` padding, `+` or `/`, whitespace) is now refused. The four new mutants (the check's condition three ways, and its block) are killed by `chain.test.ts` › decodes only canonical base64url… and › refuses a signature whose last character differs only in unused bits, and by `keys.test.ts` › the spend key scope field. The survivors are the same 27. chain 95.62, keys 95.24, router 97.67.

Task 24 changed three things the score sees. `keys.ts` now checks a MAC with `crypto.subtle.verify('HMAC')` instead of `same()`, which drops the length-check equivalent (old #3). With that length check gone, dropping `HEX64`'s `^` let a MAC like `zz<64 hex>` reach `fromHex` and fail as a 500 instead of a 401, so it was no longer equivalent. `keys.test.ts` › refuses a MAC with anything before or after its 64 hex characters now kills both anchor mutants (old #1–2). And the schema in `core.ts` is now one statement per `exec`, so each `CREATE` is its own mutant. `tenant-idempotency.test.ts` › keeps idempotency keys unique in storage too kills the one that removes the unique index.

Plan 2 Task 1 added `codes.ts` (100) and the four recovery methods in `core.ts` (98.17 for the file). The brief's tests left 12 new survivors. Nine were killed with added tests: `CODE_RE`'s two anchors (`codes.test.ts` › CODE_RE matches six digits and nothing around them), `EMAIL_RE`'s repeated domain label (› accepts a domain with several labels), `purpose === 'attach' → true` in `#countSend`, which let the tenant's daily attach cap refuse a recovery request (`recovery.test.ts` › allows ten attach codes per tenant per day now ends with a `recoverStart`), the three `#prune` mutants, whose rule no test observed (› prunes expired codes and day-old events on every send and every redemption), `recoverFinish`'s `'invalid_code'` for a wrong code (› re-derives the current generation… and › rotates once when the same code arrives twice at once now check the refusal), and `this.#head = {}` after a recovery rotation (› re-derives… now spends after the rotation and checks the next receipt's `seq` and `prev`). The other three are equivalent (#28–30 below).

The review fixes made a failed redemption record one `fail` event for every live code it was checked against (at least one), so the hourly and daily caps count guesses, not attempts: with three live codes each wrong try is three guesses. (As first written, the caps were compared before the check and the check then added up to three, so a rolling day allowed 12 code checks and the bound was about 0.44% a year. The Plan 2 final-review fixes correct this; see below.) `recovery.test.ts` › counts a wrong try once for every live code it was checked against, › counts a wrong try at least once when no code is live, and › locks each purpose on its own failures kill every mutant on that path. The fixes also made `recoverStart` and `recoverFinish` compute one `hashCode` on an email mismatch, so both answers cost the same HMAC work. Those two calls have no observable output, and their `'recover'` purpose mutants are #31–32. core.ts is now 97.84. Both uninitialised-tenant guards, the send limits, the fail caps, expiry, the live-code eviction, the email match and auth have no survivors.

The Plan 2 final-review fixes (M1) weigh a check before making it: with `weight = max(1, live codes)`, `#redeem` refuses without checking the code, and adds no event, when `fails + weight` would pass 5 in an hour or 10 in a day. At most 10 code checks fit in a rolling day, so the spec's bound of about 10 × 365 / 10⁶ ≈ 0.4% a year now holds. No mutant on the fail caps survives. The `>` boundaries are killed by `recovery.test.ts` › checks each of 5 wrong tries in an hour against one live code… (4 + 1 is still checked) and › never lets the code checks in a day pass 10… (9 + 1 is checked, 9 + 3 and 10 + 1 are refused); the weight by › counts a wrong try once for every live code it was checked against (3 + 3 is refused within the hour) and › counts a wrong try at least once when no code is live. M5 made `authRecover` answer the ops tenant from a stand-in that never reaches its Durable Object; its one new survivor is equivalent (#35). core.ts 97.85, auth-routes.ts 98.11.

Plan 2 Task 2 added `auth-routes.ts` (98.98), `mail.ts` (100) and `ops.ts` (89.19, the four moved equivalents). The brief's tests left 27 new survivors in those files and `router.ts` (the four `ops.ts` equivalents moved from `router.ts` are not counted). Added tests killed 24 of them:
- `invalid_request` for bodies `null`, `1`, a JSON string and `true`, and not only for `[1]` (the `!b` and `typeof b !== 'object'` mutants);
- the right code sent as a one-element array on both routes, which `CODE_RE` alone accepts because `test` stringifies its argument (the `typeof b.code` mutants; a number would lose a leading zero and kill only nine runs in ten);
- a tenant sent as an array or left out (`typeof b.tenant`);
- a GET on `/auth/email` and `/auth/recover` answering 404 (the two `req.method === 'POST'` mutants in `router.ts`);
- `console.error` spied on the 502 path and on a failed background send (the logging mutants);
- the Resend `content-type` header;
- every message rendered as non-empty paragraphs with no two sentences run together, and every subject non-empty (the ten wording, subject and `join` mutants in `mail.ts`, checked without matching any frozen-copy wording).

The fix round reworded the four emails after the copy gate and moved the `rotate` check ahead of the code branch in `authRecover`. It added no survivor: the nine new `mail.ts` mutants are killed by the structural checks and by › name the recovery command next to the account ID, and reattach before rotating after a change, and › tell the two code emails apart in the subject. `codeMail` now picks its subject and lines from a `Record<Purpose, …>` instead of a `purpose === 'attach'` ternary. The ternary's `!==` mutant swapped the attach and recover wording, and no test can see that without matching wording, which the frozen-copy rule forbids. With the map, a wrong purpose string throws, and the route tests catch it, so that survivor is gone rather than killed. The other two new survivors are equivalent (#33–34 below).

F5 (small-followups) made `attachVerify` take `rotate`: with it, the code's redemption, the new recovery email, the generation bump and a sealed `rotate` entry with body `{ "rotate_admin": true, "attach": true }` happen in one serialized call, and `authEmail` validates `rotate` (through a `rotateOf` helper it now shares with `authRecover`) before the send/verify branch and answers the new admin key when rotating. The first run's one new survivor removed `this.#rollMonth(now)` from the rotating branch: `recovery.test.ts` › sets the email, bumps the generation… spent before rotating, so the month was already rolled. The test now makes the rotation the tenant's first entry, as the `recoverFinish` test does, and `nonspend_month` reads `'1'` only if the branch rolled the month; that kills it. The `'admin'` scope equivalents #28–29 are at the same lines. core.ts 97.92, auth-routes.ts 98.20. No new survivor.

Plan 3a Task 2 salted the per-network bucket (`perIp` now hashes `HMAC-SHA256(MASTER, "ip:" + ipKey(ip))`) and made the tenant's alarm prune code rows on time, with the due time in `meta.next_prune`. The brief's tests left five new mutants, all in `schedulePrune` and its callers. Three were killed by an added test, `prune-alarm.test.ts` › leaves an existing due time and its alarm alone when the object wakes: `if (false) return false` and `#meta('')` both recompute the due time on wake and move it from the first row's day to the code's 15-minute expiry, and `return true` re-arms a parked alarm at the unparked due time. The brief's eviction test only woke an object with no due time. The other two are equivalent (#36–37 below; Plan 3a Task 3 later killed #36). `ops.ts` has no new survivor: the `ip:` prefix and the 16-hex slice are killed by `signup.test.ts` › buckets by the first 16 hex of HMAC-SHA256…. `pruneIfDue`'s `<=` boundary, the `DAY_MS` offset and the delete when no row is left, `#codeRowWritten`, and `#arm`'s guard and default `alarmAt` have no survivors. core.ts 97.75, tenant.ts 100, ops.ts 89.47 (the four recorded equivalents).

Plan 3a Task 3 added billing: `stripe.ts` (the Stripe client, the webhook signature check and `reportUsage`), `billing-routes.ts` (`POST /billing/checkout` and `POST /billing/stripe`), the billing and meter methods in `core.ts`, and the meter job in the tenant's alarm. Stripe's HTTP API is the only mock (see Boundary mocks). The brief's tests left 54 new survivors and no-coverage mutants. One source change removed two of them: `call()` in `stripe.ts` built a query string for a GET or DELETE with parameters, and no caller passes any, so the branch and its two mutants went. Added tests killed 40:
- `stripe.test.ts`: the recorder now builds a real `Request` from what the client passes, so a GET that carried a body throws as it would against `fetch`, and it records `content-type`. › reads t wherever it sits in the header kills `k === 't' → true`. The malformed-header list gains `v1` with no value, `v1=zz<64 hex>` and `v1=<64 hex>zz`, which kill both anchors of the `v1` pattern: without them the MAC reaches `fromHex`, which throws.
- `billing.test.ts` › answers 404 to anything but POST on either billing route (the two `req.method === 'POST'` mutants in `router.ts`); › keeps the open session when another session completes (`checkout_session === session → true`); › sends no code when the checkout has no usable email now includes `customer_details: null` (the `?.`); › still makes the tenant Pro when the address has used up its codes, and sends none (`if (code.ok) → true`); › still answers 200 when the code cannot be sent, and logs the failure; › acknowledges and ignores… now includes a deletion with no `metadata` (the `?.`); › acts only on the two event types it handles, whatever the object carries (both `type ===` checks).
- `billing.test.ts` › the ledger billing calls: `billingStart` on an object with no tenant, a redelivery and a second subscription, and `billingEnd` for another subscription, its own, and again. These are direct RPC calls. They kill `billingEnd`'s plan and subscription check, which the brief expected to record as equivalent because the route checks both first, as well as its return values and its drop of `meter_to`.
- The daily meter report: › leaves the meter report alone when the alarm fires for a prune that falls due first (`meterIsDue → true`, in `core.ts` and in `tenant.ts`); › reports nothing and tries again in an hour while Stripe is unconfigured (`if (cfg) → true`, which would pin a report and log a `TypeError`); › stops the meter job… now asserts that nothing is logged (`reportUsage`'s `!due.ok || !due.value`); › retries a failed report in an hour… asserts the logged Stripe error (the `catch` block); › sends the report of a woken tenant through the global fetch, which the Worker tests refuse (the default `stripeFetch`).
- `mail.test.ts` › address the duplicate notice to security@ in the same shape… (the subject, the second paragraph and the `join`).
- `prune-alarm.test.ts` › keeps an alarm another job armed when the object wakes, and moves it earlier for code rows it finds. The constructor now also arms a due time left with no alarm, for example when the isolate died between the SQL commit and `setAlarm` (› arms a due time that was left without an alarm when the object wakes). That makes `schedulePrune`'s return value matter only when an alarm for the meter job is already set, and this test covers that case. It also kills Task 2's equivalent #36, which is now gone from the table.

The other 12 are equivalent (#38–49 below). The brief also expected no survivor on the webhook's plan check before the final report. That mutant (#43) is equivalent: `meterDue` refuses a tenant that is not Pro, and so does `billingEnd`. `billingConfig` (all five values), `verifySignature`'s `t` pattern, both anchors and both 300-second bounds, the `v1` key and pattern, the 409 plan check, the open-session reuse and its five-minute margin, the mode and payment-status filter, `billingStart`'s tenant, subscription, duplicate-marker and Pro checks, `cancelDuplicate`'s status check, the duplicate notice's addressee and IDs, the subscription match and the `ended_at` stamp before the final report, `meterDue`'s plan check, `meterCommit`'s two guards, `value > 0`, `meterIsDue`'s `<=`, and `scheduleMeter`'s plan check and day-or-hour choice have no survivors. core.ts 97.92, billing-routes.ts 93.81 (the six equivalents), stripe.ts 97.44, tenant.ts 100, mail.ts 100, router.ts 100.

The Task 3 fix round sends the meter event's identifier as its `Idempotency-Key`, so a retry within Stripe's 24-hour window replays the cached answer instead of meeting a refusal for a repeated identifier. It stamps a final report now when a deletion carries no `ended_at`, and it makes `cancelDuplicate` say whether it cancelled, so the duplicate notice tells a cancelled newcomer from one that had already ended. The seven new mutants are killed by `stripe.test.ts` (the key on the meter event and none on the portal call, and both return values of `cancelDuplicate`), by `billing.test.ts` (the same key on each retry of a pinned range, from the alarm and from the final report; › stamps the final report now when the deletion carries no ended_at; › says the duplicate had already ended, and cancels nothing, when Stripe reports it canceled; the exact notice in both branches) and by `mail.test.ts` › tell a cancelled duplicate from one that had already ended…. There is no new survivor. The `stripe.ts` equivalents #47–49 moved two lines. stripe.ts 97.50.

### Surviving mutants (all 48 are equivalent)

Every remaining survivor and no-coverage mutant is listed here. None can be killed by a test, because none changes behaviour. Those marked **reject path** sit on a guard the gate names, and each exists only because another guard already makes it redundant. The only way to clear them is to delete the redundant code. That is a change to key and amount validation, so it has not been made. Line numbers are as of Plan 3a Task 3. #36 was killed in that task, so the numbering skips it.

| # | Location | Mutant | Reject path | Why it is equivalent |
|---|---|---|---|---|
| 1–2 | keys.ts:37 `tenant ?? ''`, `genS ?? ''` | `'' → "Stryker was here!"` | **yes** (key grammar) | `TENANT_RE` and `NUM` refuse the replacement string just as they refuse `''`. |
| 3–4 | keys.ts:40 `p[4] ?? ''`, keys.ts:45 `mac ?? ''` | no coverage | **yes** (MAC) | Dead fallback. The length check before it guarantees the element exists. |
| 5 | keys.ts:11 `importKey(…, false, …)` | extractable `→ true` | no | The HMAC key is never exported. |
| 6 | amounts.ts:10 `typeof v !== 'number'` | `→ false` | **yes** (amount grammar) | `Number.isFinite` does not coerce, so a string, boolean or null still fails it. |
| 7 | amounts.ts:10 `\|\|` | `→ &&` | **yes** (amount grammar) | A non-number fails both operands. `Infinity` and `NaN` get through, but `Number.isSafeInteger(m)` refuses them two lines later. |
| 8 | chain.ts:13 `i < out.length` | `→ <=` | no | A write one past the end of a `Uint8Array` is silently ignored. |
| 9 | chain.ts:17 `/=+$/` | `→ /=+/` | no | Base64 only ever has `=` at the end. |
| 10–11 | chain.ts:19 padding | `'=' → ''`; `% 4 → * 4` | no | workerd's `atob` is forgiving-base64 and accepts unpadded input. `(4 − 4n) % 4` is 0, so the second mutant also adds no padding. The canonical check on line 21 compares the re-encoded bytes with the caller's string, not with the padded one, so the padding never reaches it. |
| 12–13 | chain.ts:43, 54 `importKey(…, false, …)` | extractable `→ true` | no | These keys are never exported either. |
| 14 | errors.ts:18 `f.status === 402` | `→ true` | no | Only 402 failures carry `resets`, so the other half of the `&&` decides alone. |
| 15 | ops.ts:12 (was router.ts:23) `.fill('0')` | `→ fill('')` | no | Every group then goes through `padStart(4, '0')`, which fills an empty group as well. |
| 16 | ops.ts:17 (was router.ts:28) `init(OPS_TENANT, 'internal')` | `→ ''` | no | In Plan 1, every plan other than `'free'` is treated the same (`#checkPlan`). |
| 17 | ops.ts:19 (was router.ts:30) body hash `''` | `→ "Stryker was here!"` | no | Every ops spend has a fresh UUID idempotency key, so its body hash is never compared. |
| 18 | ops.ts:21 (was router.ts:31) `r.status === 402` | `→ true` | no | The ops spend can only fail with 402 (see the ops.ts:21 coverage row). The same holds for the `recoveries` unit Plan 2 Task 2 added. |
| 19–21 | core.ts:80, 111, 182 `'spend'`, `'spend'`, `'read'` | `→ ''` | no | `#authorize` only compares `need` with `'admin'`. |
| 22 | core.ts:122 `done.scope !== scope` | `→ false` | **yes** (409) | A settle row is written under its hold's scope, and line 116 has already refused `held.scope !== scope`. |
| 23–24 | core.ts:128, 150 `this.#rollMonth(now)` in settle and PUT | removed | no (billing) | `spend` rolls the month before `#checkPlan`, and it is the only reader. If a settle or PUT comes first in a new month, the mutant charges its entry to the old month's counter. The spend's roll then takes it into `seq_month_start` instead, so the billable count is the same (`seq − start − nonspend`). |
| 25 | core.ts:494 `'0'` | `→ ''` | no | `Number('') === Number('0') === 0`. |
| 26 | scope.ts:29 `?? ''` | no coverage | no | Dead fallback (see the coverage table). |
| 27 | auth.ts:2 `INTERNAL.keyScope: ''` | `→ "Stryker was here!"` | no | `#authorize` returns for internal auth before it reads `keyScope`. |
| 28–29 | core.ts:189, 200 `#authorize(auth, '', 'admin')` in `attachStart` and `attachVerify` | scope `'' → "Stryker was here!"` | no | For `need === 'admin'`, `#authorize` returns (null for admin, 403 otherwise) before it reads `scope`. |
| 30 | core.ts:226 `#countSend('recover', …)` | `→ ''` | no | A send event's `purpose` is only read by the daily attach count (`purpose = 'attach'`), and neither `'recover'` nor `''` matches it. The hourly count reads every send for the email, whatever its purpose. |
| 31–32 | core.ts:229, 239 `hashCode(MASTER, 'recover', …)` on an email mismatch in `recoverStart` and `recoverFinish` | `→ ''` | no (timing only) | The hash is computed and discarded, only so a mismatch does the same HMAC work as a match. No output depends on it. |
| 33 | auth-routes.ts:13 `catch { throw new ApiError(400, 'invalid_request') }` | block emptied | **yes** (body grammar) | A body that is not JSON leaves `b` undefined, and the next line refuses it with the same `400 invalid_request`. A redundant guard, kept under Robin's ruling. |
| 34 | index.ts:12 `waitUntil: (p) => ctx.waitUntil(p)` | `→ () => undefined` | no (lifetime only) | `ctx.waitUntil` only keeps the isolate alive until a background send settles. In tests the send runs and settles either way, and with `RESEND_API_KEY: ''` it throws before any fetch, so no test can observe the lifetime. It is not a no-op in production: without it, workerd may cancel a recovery or confirmation send after the response. |
| 35 | auth-routes.ts:30 `recoverStart: async () => ok({ code: null })` in the ops-tenant stand-in | `→ ok({})` | no (the refusal is the same) | `authRecover` reads only `r.value.code`, and `undefined` is as falsy as `null`, so neither mails anything and both answer 202. |
| 37 | core.ts:446 `this.#codeRowWritten(now)` in `#storeCode` | removed | no | Both callers, `attachStart` and `recoverStart`, run `#countSend` first in the same serialized call, and it has already written a `send` row and called `#codeRowWritten(now)` with the same `now`. The code's expiry (`now` + 15 minutes) is earlier than that due time, so the due time stays at most a day after the earliest live row. The call is kept so that every code-row write sets the due time. |
| 38–40 | billing-routes.ts:12 `tenantIn`: `typeof v === 'string' && TENANT_RE.test(v)` | `→ true` (twice), `&& → \|\|` | **yes** (tenant ID) | A redundant guard, kept under Robin's ruling. An ID that is not a tenant's reaches `tenantFor` either way: `billingStart` returns `{ started: false, duplicate: false }` on an object with no `tenant` row, and `billing(INTERNAL)` answers `401` there, so nothing is written, mailed or reported (› acknowledges and ignores an event for no tenant…). |
| 41–42 | billing-routes.ts:39, 57 `if (tenant)` | `→ true` | **yes** (tenant ID) | The same guard: `tenantFor(null)` names an object with no `tenant` row, which does nothing, as in #38–40. |
| 43 | billing-routes.ts:60 `b.value.plan === 'pro'` before the final report | `→ true` | **yes** (billing) | `meterDue` returns `null` for a tenant that is not Pro, so `reportUsage` sends nothing and commits nothing, and `billingEnd` checks the plan again. The subscription match beside it is killed. |
| 44 | core.ts:259 `#authorize(auth, '', 'admin')` in `billing` | scope `'' → "Stryker was here!"` | no | As #28–29: for `need === 'admin'`, `#authorize` never reads `scope`. |
| 45 | core.ts:287 `this.#deleteMeta('meter_to')` in `billingStart` | `→ ''` | no | `billingEnd` is the only way from Pro back to free, and it deletes `meter_to` in the same transaction (killed by › end only the current subscription…), so no `meter_to` exists when a subscription starts. Even if one did, `from` would be past it, the report would count 0, and `meterCommit` would clear it. |
| 46 | core.ts:326 `to > meter_seq` in `meterCommit` | `→ >=` | no | When they are equal, the mutant writes the value that is already there. |
| 47 | stripe.ts:66 `header ?? ''` | `→ "Stryker was here!"` | **yes** (signature) | The replacement has no `t=` field either, so the empty-`t` check refuses it. |
| 48 | stripe.ts:67 `?.[1] ?? ''` | `→ "Stryker was here!"` | **yes** (signature) | The replacement fails the all-digits `t` pattern, as `''` does. |
| 49 | stripe.ts:69 `v ?? ''` | `→ "Stryker was here!"` | **yes** (signature) | A `v1` with no `=` has no value; the replacement fails the 64-hex pattern, as `''` does. |

Reject-path equivalents: 17 (keys.ts 4, amounts.ts 2, core.ts 1, auth-routes.ts 1, billing-routes.ts 6, stripe.ts 3). A limit comparison, epoch or generation check, scope grammar check or `on_outage` decision has no survivors at all, and neither has a code send limit, fail cap, expiry, live-code eviction or recovery email match. #28–29 sit on the admin check's call but change only an argument it never reads, so like #19–21 they are not counted as reject paths.

### Spec coverage: Surface table

Every route is exercised through `SELF.fetch`.

| Route | Test |
|---|---|
| `POST /v1/{scope}` | `http.test.ts` › spends, limits and reads through the API; `api.test.ts` › replays with remaining and on_outage from the current state; › settles over HTTP as a fresh receipt… |
| `PUT /v1/{scope}` | `api.test.ts` › answers a PUT with the scope view, and no admin key unless the admin key rotated; `http.test.ts` › returns a new admin key from rotate_admin… |
| `GET /v1/{scope}` | `api.test.ts` › lists children at any depth and pages entries with next; › treats /v1 without a trailing slash as the tenant root |
| `POST /auth/signup` | `signup.test.ts` (all); `api.test.ts` › serves signup only to POST… |
| `POST /auth/email`, `POST /auth/recover` | `auth-routes.test.ts` (all). The routes are called through `handle` with a boundary `Io` whose mailer records, fails or never resolves; the `deployed entry` block goes through `SELF.fetch`, where `RESEND_API_KEY` is pinned to `''`, so a code send answers `502 email_failed`. |
| `POST /billing/checkout`, `POST /billing/stripe` | `billing.test.ts` (all), through `handle` with a boundary `Io` whose `stripeFetch` answers as Stripe's HTTP API. The routes answer `503 billing_unavailable` while any of the five Stripe values is unset, `409 already_pro` with a portal URL for a Pro tenant, `400 invalid_signature`, and `500 internal` when Stripe fails. |
| `GET /.well-known/solenoid.json` | `http.test.ts` › publishes the receipt-signing public key and nothing private; › signing key rotation (retired keys by kid, public parts only, the current kid winning a clash, an old receipt still verifying, and, through `SELF.fetch` with `env.RETIRED_SIGNING_KEYS` set per test, the current key still published when the var is unset, empty, not JSON, cut short, `null`, a number, a string, an array or a number value, bad entries skipped beside a good one, and an object-valued var read as is); `api.test.ts` › serves the public keys as cacheable JSON, and only to GET |

### Spec coverage: Errors table

Every row is exercised through `SELF.fetch` with its exact status, `error` code and detail.

| Status | Code | Existing test (Tasks 4–8) | Added in Task 17 |
|---|---|---|---|
| 400 | `invalid_scope` | `http.test.ts` row `POST /v1/A` (status and code) | `api.test.ts` errors table, detail `{ scope: 'A' }` |
| 400 | `invalid_amount` | `http.test.ts` row `not json` | bodies `null`, `5`, `"settle"`, `[]`, `{ usd: 0 }` |
| 400 | `invalid_unit` | (Durable Object level only, in `tenant-settle.test.ts`) | `POST {USD:1}`, `POST {spends:1}`, `PUT {USD:1}`, each with `{ unit }`. Final review: a settle leaving out or adding `constructor`; `toString`, `__proto__` and `hasOwnProperty` in a PUT, a spend and a settle |
| 400 | `missing_idempotency_key` | `http.test.ts` row | none |
| 400 | `invalid_idempotency_key` | `http.test.ts` row `has#hash` | 256 characters refused, 255 accepted |
| 400 | `invalid_limit` | `http.test.ts` rows (bad JSON, `{}`, `per`, `on_outage`, `warn_at`, `rotate_keys`) | `{ field: 'per' }` detail; `rotate_admin` below the root with `{ reason }` |
| 400 | `invalid_before` | `http.test.ts` row `?before=abc` | `a1`, `1a`, `-1`, `1.5`, empty; `0` and `10` accepted |
| 404 | `unknown_spend` | `http.test.ts` row `never-held` | none |
| 401 | `invalid_key` | `http.test.ts` missing key, non-ASCII byte, stale generation (status only) | MAC failure, stale epoch, stale generation, each with the exact body |
| 402 | `limit_exceeded` | `http.test.ts` (scope, unit and a positive `Retry-After`) | windowed 402 with every detail field and `Retry-After` = seconds to `resets` (±1); lifetime 402 with `resets: null` and no `Retry-After`; exhausted plan `{ scope: '', unit: 'spends', limit: 100000, used: 100000, requested: 1, resets: <next month> }` with `Retry-After` |
| 403 | `out_of_scope` | `http.test.ts` (status only) | detail `{ scope, key_scope }` |
| 403 | `admin_required` | (Durable Object level only) | spend key PUT |
| 403 | `plan_owned` | (Durable Object level only) | `PUT /v1/ { spends: 5 }` |
| 409 | `idempotency_conflict` | `http.test.ts` other scope (status only) | same scope with a different body; a settle with a different actual |
| 429 | `rate_limited` | `signup.test.ts` › stops an IP at the ops tenant limit… (exact body) | none. Plan 2 Task 1 adds the Durable Object side for codes (`recovery.test.ts`). Plan 2 Task 2: `auth-routes.test.ts` › answers 429 on the sixth code request for one email in an hour; › limits recovery calls per IP through the ops tenant. The DO's per-email 429 on `/auth/recover` is answered as `202 accepted` (› answers the same 202 after the per-email send limit is spent, and stops mailing), because a 429 there would say the tenant exists and its recovery email is being targeted. |

Other behaviour the brief names:

- **Replay** reports `remaining` and `on_outage` from the current state: `api.test.ts` › replays with remaining and on_outage from the current state.
- **`warnings` from `warn_at`:** `http.test.ts` › spends, limits and reads; `tenant-spend.test.ts` › warns once usage crosses warn_at, and not before; › warns exactly at the warn_at boundary despite float error; › warns at exactly warn_at on a limit large enough to swallow the float tolerance; › never warns on a limit without warn_at.
- **`GET` pagination with `next`:** `api.test.ts` › lists children at any depth and pages entries with next; `tenant-put-get.test.ts` › ends paging with next null at exactly one full page.

Extra codes that are not in the spec table: `404 not_found` (unknown path) and `405 method_not_allowed` (`http.test.ts`, `api.test.ts`), and `500 internal` after three tenant-ID collisions (`signup.test.ts`). Plan 2 Task 2 adds `400 invalid_request` (with `field` for `tenant` and `rotate`), `400 invalid_email`, `400 invalid_code` and `502 email_failed`, all with exact bodies in `auth-routes.test.ts`; Task 6 adds them to the spec's Errors table. Plan 3a Task 3 adds `409 already_pro` (with `portal_url`), `503 billing_unavailable` and `400 invalid_signature`, with exact bodies in `billing.test.ts`.

### Boundary mocks

- `crypto.getRandomValues` and `console.error` are stubbed in one test: `signup.test.ts` › gives up after three tenant id collisions. That is the platform randomness and logging boundary. `crypto.getRandomValues` is also stubbed in `codes.test.ts` › newCode… to script the draws above the unbiased range; `vi.spyOn` takes effect inside workerd.
- `console.error` is also spied in `auth-routes.test.ts` on the 502 path and on a failed background send. The mailer is the Resend boundary: `auth-routes.test.ts` passes its own `Io`, and `mail.test.ts` passes a scripted `fetch` to `resendMailer`.
- Stripe's HTTP API is the only Stripe mock. `billing.test.ts` passes a scripted `stripeFetch` in its `Io` and sets the same function on each `TenantDO` for the alarm, and `stripe.test.ts` passes a recorder to `stripeClient`. `vitest.config.mts` binds five test-only Stripe values and refuses every outbound fetch through `outboundService` (status 599). Two tests go through the default path, the global `fetch`, and see that refusal: one from a route and one from an alarm. One test replaces the `TenantDO`'s `env` with a copy that has no `STRIPE_SECRET_KEY`. That changes configuration, and no module is replaced.
- No Solenoid module is mocked. The Durable Object tests set the clock through the existing `setNow` helper and seed the billing meta rows through `setBillable`.
- `vitest.config.mts` binds `RETIRED_SIGNING_KEYS` to a retired key under `k0`, deliberately with its private `d` so the tests can sign an old receipt and check that `d` is never published, plus a decoy under `k1` that the current key must override. Round 2's tests set `env.RETIRED_SIGNING_KEYS` for one request and restore it in `finally`; `SELF` reads the same `env` object. The bindings also pin `SIGNING_KID: 'k1'`, so the suite does not depend on the kid in `wrangler.jsonc`: with `k2` there and no pin, 13 tests failed.

## SDK (`sdk/`)

Commands: `pnpm --filter @solenoid.systems/sdk coverage` (v8) and `pnpm --filter @solenoid.systems/sdk mutate` (Stryker, `sdk/stryker.config.mjs`). Reports go to `sdk/reports/`, which git ignores. Unset `SOLENOID_KEY` and `SOLENOID_API` before either command. `test/setup.ts` also deletes both at the start of every test file, so no test can read the live values.

### Stryker configuration, and where it departs from the brief

- **Mutated:** every file in `sdk/src` except the type-only `types.ts`: `amounts, bytes, errors, http, index, keys, llm, node, scope, verify`. That is 739 mutants after Go Live Task 4 added `checkout` and the `billing_unavailable` refusal (735 after Go Live Task 1 moved `testing.ts` out to its own package, 792 after Plan 2 Task 3 added the account functions, 724 before Plan 2, 722 before the follow-ups' last items, 703 before the follow-ups' fix round, 683 before the Plan 1 follow-ups, 641 before the final-review fix wave). `prices.json` is not matched by the glob.
- **`inPlace: true`**, which the brief did not name, matters most here. `test/account.test.ts`, `test/client.test.ts`, `test/node.test.ts` and `test/properties.test.ts` import the test server as `../../testing/src/index`, which imports the ledger as `../../worker/src/core`, and `contract/scenarios.ts` (run through `testing/test/testing.test.ts` and, via those four files, through the SDK's own suite) imports the client as `../sdk/src/index`. In Stryker's default sandbox (`sdk/.stryker-tmp/sandbox-*`), none of these paths point at a real file, and the client path points at the original, unmutated SDK. The first run (before Task 24 introduced this shape) scored 46.65%, with the file that held the ledger adapter and `keys.ts` at 0%. In place, every path resolves, and the scenarios run against the mutated client. Stryker backs `src/` up to `.stryker-tmp/backup-*` and restores it when the run ends. A crashed run is restored at the start of the next one. Do not edit or commit `sdk/src` while a run is going.
- **No live tests to exclude.** The brief's Step 4 assumed a live suite that starts `wrangler dev`. Task 24 replaced it with the contract scenarios against `testServer()`, which is the real Worker router and ledger over in-memory `node:sqlite`, so nothing in the mutation run needs a Worker. The one exclusion is `test/bundle.test.ts`, which runs `pnpm run build` and tests `dist/`, not `src/`. The `mutate` script sets `STRYKER=1`, and `vitest.config.ts` leaves that file out when it is set.
- **`vitest.config.ts`'s `exclude` needs one more entry than the brief's, `'.stryker-tmp/**'`.** Without it, `pnpm run mutate --force` fails the dry run: `ENOENT: no such file or directory, open 'sdk/.stryker-tmp/backup-<hash>/test/../dist/solenoid.mjs'`, from `test/bundle.test.ts`'s `builds a single-file bundle with no imports`. Stryker's `inPlace` sandbox backs up every project file (not only the ones it mutates) into `.stryker-tmp/backup-<hash>/` before a run, including `test/bundle.test.ts` itself; comparing `npx vitest list` with and without a leftover `.stryker-tmp/backup-*/test/bundle.test.ts` on disk confirms vitest's default test-file glob picks up that backup copy as a second, independent test file, since the existing `exclude` entry `'test/bundle.test.ts'` matches only that exact relative path and not the backup copy's different one. The backup copy's `beforeAll` then deletes and rebuilds a `dist/` next to itself, inside `.stryker-tmp/`, which the real test then can't find. Adding `'.stryker-tmp/**'` to `exclude` removes the duplicate from discovery; `npx vitest list` then shows one `test/bundle.test.ts`, not two, and the dry run passes. `test/bundle.test.ts` is unchanged from the brief.
- **`vitest: { related: false }`**, as in the Worker. The scenarios reach `index.ts`, `keys.ts` and `verify.ts` only through `contract/scenarios.ts`.
- **`coverageAnalysis: 'perTest'`**, as the brief says. The SDK runs in Node, so per-test coverage reports back. A full run takes about a minute on four runners.
- **`plugins: ['@stryker-mutator/vitest-runner']`** is set explicitly, for the same pnpm reason as the Worker.
- Record a run with `--force`. The incremental file is `reports/stryker-incremental.json`.

### Coverage (v8, `src/**` minus `types.ts` and `prices.json`)

"Before" is the start of Task 18. "After" is after Plan 2 Task 3.

| File | Lines before | Branches before | Lines after | Branches after | Statements after | Functions after |
|---|---|---|---|---|---|---|
| amounts.ts | 100 | 100 (14/14) | 100 | 100 (14/14) | 100 | 100 |
| bytes.ts | 100 | 50 (1/2) | 100 | 100 (2/2) | 100 | 100 |
| errors.ts | 87.5 | 71.42 (5/7) | 100 | 100 (7/7) | 100 | 100 |
| http.ts | 100 | 78.26 (18/23) | 100 | 96 (24/25) | 100 | 100 |
| index.ts | 90.47 | 71.08 (59/83) | 100 | 98.34 (119/121) | 100 | 100 |
| keys.ts | 100 | 80 (4/5) | 100 | 100 (5/5) | 100 | 100 |
| llm.ts | 96.15 | 82.97 (39/47) | 100 | 97.87 (46/47) | 100 | 100 |
| node.ts | 100 | 66.66 (2/3) | 100 | 100 (3/3) | 100 | 100 |
| scope.ts | 100 | 90 (9/10) | 100 | 100 (10/10) | 100 | 100 |
| verify.ts | 95.83 | 85.71 (18/21) | 100 | 100 (25/25) | 100 | 100 |
| **All (Plan 2 Task 3)** | 93.13 | 78.28 (173/221) | 98.55 | 97.75 (261/267) | 98.69 | 99.07 |
| **All (Go Live Task 1, `testing.ts` moved out)** | | | 100 | **98.47 (258/262)** | 100 | 100 |

Go Live Task 4 added `checkout` to `index.ts` and the `billing_unavailable` member of `http.ts`'s `REFUSED_5XX` set. Neither adds a branch: `checkout` is one unconditional call, and `REFUSED_5XX.has(...)` replaces one boolean subexpression of the existing `&&` in `http.ts` with another. The coverage table is unchanged, `98.47 (258/262)`.

`testing.ts` used to sit in this table, below both gates on four lines that could not run through `testServer()`: `one()` in `sqlOver` (dead, since nothing in `core.ts` calls it) and the rollback branch in `transactionSync`. Go Live Task 1 moved the file to `testing/src/index.ts` and `testing/src/sql.ts`, deleted `one()` from `Sql` and from `sqlOver`, and added `testing/test/sql.test.ts` to kill the rollback. See the new Testing (`testing/`) section below for the historical row and its explanation, and for where those numbers went.

The remaining four uncovered branches, unchanged by Task 1:

| File:line | Branch | Why |
|---|---|---|
| http.ts:17 | `if (res.ok)` false side | This is a v8 counting artefact. The branch runs in every 4xx and 5xx test, but v8-to-istanbul reports a negative count (`-114`) for it after the `await` on the line before. |
| index.ts:140 | `if (Date.now() - refetchedAt >= KEY_REFETCH_MS)` false side | The same v8 artefact after an `await` on the line before (a count of `-348`). The false side runs: `client.test.ts` › refetches for a kid it lacks at most once every 5 seconds… checks a kid 4,999 ms after the last refetch. |
| index.ts:202 | `cost[u] ?? 0` | `hold` and `cost` both come from `costOf(…, price)` with the same `price`, so they always have the same units. |
| llm.ts:39 | `left[unit]?.scope ?? scope` fallback | A local refusal names `usd` only when `usd` is limited and `tokens` is not the cause (see mutant #4 below). |

### Mutation score

| Run | Score | Killed | Timeout | Survived | No coverage |
|---|---|---|---|---|---|
| Before, default sandbox (misconfigured) | 46.65 | 295 | 4 | 161 | 181 |
| Before, `inPlace`, existing tests | 70.36 | 447 | 4 | 128 | 62 |
| After Task 18 (`--force`) | 96.72 | 619 | 1 | 14 | 7 |
| After the final-review fix wave (`--force`) | 96.58 | 648 | 1 | 16 | 7 |
| After fix wave round 2 (`--force`) | 96.63 | 659 | 1 | 16 | 7 |
| After the Plan 1 follow-ups (`--force`) | 96.59 | 678 | 1 | 17 | 7 |
| After the follow-ups' fix round (`--force`) | 96.68 | 697 | 1 | 17 | 7 |
| After the follow-ups' last items (`--force`) | 96.69 | 699 | 1 | 17 | 7 |
| Plan 2 Task 3, the brief's tests (`--force`) | 94.95 | 751 | 1 | 29 | 11 |
| After Plan 2 Task 3's added tests (`--force`) | 96.46 | 763 | 1 | 21 | 7 |
| After F5 (small-followups) (`--force`) | 96.60 | 766 | 1 | 20 | 7 |
| After Go Live Task 1 (`testing.ts` moved out) (`--force`) | 97.82 | 718 | 1 | 16 | 0 |
| **After Go Live Task 4 (`checkout`)** (`--force`) | **97.83** | **722** | **1** | **16** | **0** |

Per file, before (in place) → after Task 18 → after the fix wave: amounts 75.68 → 97.30 → 97.30, bytes 75.00 → 95.83 → 95.83, errors 56.25 → 100 → 100, http 62.71 → 98.31 → 98.31, index 66.47 → 99.42 → 98.53, keys 61.29 → 87.10 → 87.10, llm 73.33 → 99.05 → 99.05, node 78.95 → 100 → 100, scope 75.61 → 100 → 100, testing 73.33 → 82.22 → 82.22, verify 75.82 → 95.60 → 95.60.

Go Live Task 1 removed `testing.ts` from this file set entirely (735 mutants total, down from 766). Its four survivors (#25–28 below, all from the stub mailer) went with it. The remaining 16 survivors are exactly the old #9–24, renumbered #1–16 below: nothing about `amounts.ts` through `verify.ts` changed. Per file: amounts 97.30, bytes 95.83, errors 100, http 98.44, index 98.98, keys 87.10, llm 99.05, node 100, scope 100, verify 95.05.

Go Live Task 4 added `checkout` to `index.ts`, the `billing_unavailable` member of `http.ts`'s `REFUSED_5XX` set, and its own tests (`sdk/test/http.test.ts` › treats a 503 billing_unavailable as a refusal…, `sdk/test/account.test.ts` › checkout). Four new mutants, all killed: `REFUSED_5XX.has('email_failed' | 'billing_unavailable')` and its `!`, the request shape (`checkout` posts with no idempotency key, checked by the fetch-boundary test), and the `already_pro`/`billing_unavailable` split (checked against `testServer()`, whose default env has no Stripe secret set). Per file: http 98.46, index 98.99. The same 16 survivors carry over unrenumbered.

F5 (small-followups) gave `verifyEmail` a third argument, `{ rotate? }`, which adds `rotate: true` to the body only when set. `account.test.ts` › sends rotate on verifyEmail only when asked pins the three bodies (no option, `rotate: false`, `rotate: true`) at the fetch boundary, and › attaches an email and rotates the admin key in one call… runs it against `testServer()`. Its new mutants are all killed. The run has 20 survivors, not 21. #25 below (`'mail is down'` → `''`) is now killed: 7a82dd7 spied on `console.error` in › surfaces a failed send as email_failed… and checks it was called with `new Error('mail is down')`. The other 20 are in the table below; index.ts:161 moved to 162. index 98.98.

The fix wave's first run left seven survivors in `index.ts`'s new code. Three were killed by tightening the expiry test (a lifetime unit cached beside a windowed one, a call inside the window that must not read, and a call at exactly the reset time that must). One, the placeholder `protocol = ''` in the first form of the API check, went away when the check moved to `URL.canParse`. Two are equivalent and recorded below as #22 and #23 (renumbered #14 and #15 after Go Live Task 1 removed `testing.ts`'s eight lower-numbered survivors). Round 2 replaced `URL.canParse` with a guarded `new URL`, refused a user, password, query or fragment, and returned the parsed origin and path instead of the raw string. Its new code left no survivor.

The Plan 1 follow-ups changed three things in the SDK. `verify` and `verifyChain` fetch the published keys once more when a receipt names a kid the cached copy lacks, and read the key set by own property (F-1). `checkApi` refuses the ports the Fetch standard blocks (F-2). `b64urlDecode` in `verify.ts` refuses a signature that is not canonical base64url (F-5). Until then a `sig` whose last character differed only in its four unused bits still verified, which this section used to list as a pinned behaviour. `properties.test.ts` › refuses a signature that is not canonical base64url… now checks it returns `false`, and › still verifies every receipt the server signs checks 64 real receipts. Their new code left one survivor, #24 below (renumbered #16 after Go Live Task 1), in the small encoder the canonical check needs. Per file: index 98.67, verify 95.05.

The follow-ups' fix round changed three things. The key refetch for an unknown kid is now shared by concurrent callers, runs at most once every 5 seconds, fetches from a URL with a fresh `?t=` query string, so no HTTP cache can answer it (the first version used `cache: 'no-store'`, which Workers before compatibility date 2024-11-11 reject; the Worker's well-known route matches on the path only, and `testing.test.ts` › serves the published keys with a query string… checks that through `testServer()`), calls `fetch` inside a promise so that one that throws synchronously cannot escape `verify`, and on failure keeps the key set the client already has (`keys`, which only a successful fetch replaces). `checkApi` also refuses port 0, guarded by `u.port !== ''` so that a default-port URL still passes. And `fileStore().set` wraps only its write calls in a `try`, and reports a failure with `process.emitWarning` instead of throwing, so a recorded spend is never reported as a failure. Their new code left no survivor. The query-string change made `kids.every` → `kids.some` survive, because the throttle hid the one test that told them apart; `client.test.ts` › refetches for a chain when any one of its kids is missing… kills it. Per file: index 98.76, node 100.

Plan 2 Task 3 added `signup` options, `requestRecovery`, `recover` and a shared `authPost` in `index.ts`, the client's `sendEmailCode` and `verifyEmail`, and the `502 email_failed` split in `http.ts`. The brief's tests left 12 survivors and no-coverage mutants in `authPost` and the client's email timeout: the 5xx split (never reached, since `testServer()` answers an outage by throwing), `>= 500 → > 500`, the network Outage's message and cause, the JSON content type, `Math.max → Math.min` on the 10-second timeout, and `envVar('SOLENOID_API') → envVar("")`. `account.test.ts` › account functions at the fetch boundary kills all of them with a stubbed `fetch`: a 500, a 502 that is not `email_failed` and a non-JSON 503 are each one `Outage` named `HTTP <status>`; a 502 `email_failed` is a `SolenoidError`; a network failure keeps its cause; the request shape is pinned exactly; and a client built with `timeoutMs: 20` still waits for a 60 ms answer to `sendEmailCode`. Per file: http 98.44, index 98.97. There is no survivor in `authPost`'s status check, 502 split or Outage mapping.

The `envVar("")` survivor was a real hazard, not an equivalent. It falls back to the production API, and `client.test.ts` › reads SOLENOID_API when no API is given calls `signup()` with the global `fetch`, so the first Task 3 run most likely sent one real signup to `api.solenoid.systems` and got a 201. The same mutant existed in the old `signup`. `test/setup.ts` now replaces the global `fetch` for every SDK test file with one that refuses any host but `127.0.0.1`, which is where the local shim listens. Under that guard the mutant fails the test with the refusal.

Go Live Task 1 moved `testing.ts` (and its four survivors from Plan 2 Task 2's stub mailer) to the new `testing/` package below, and deleted its dead `one()` entirely. The table here now holds only the 16 survivors in `amounts.ts` through `verify.ts`, renumbered #1–16 (the old #9–24).

### Surviving mutants (all 16 are equivalent or unreachable)

| # | Location | Mutant | Reject path | Why it is equivalent |
|---|---|---|---|---|
| 1 | amounts.ts:11 `typeof v !== 'number'` | `→ false` | **yes** (amount grammar) | `Number.isFinite` does not coerce, so a string still fails it. This is the same guard as Worker #6. |
| 2 | bytes.ts:8 `i < out.length` | `→ <=` | no | A write one past the end of a `Uint8Array` is ignored. This is the same as Worker #8. |
| 3 | http.ts:13 `body === undefined ? undefined : …` | `→ false` | no | `JSON.stringify(undefined)` is `undefined`. |
| 4 | llm.ts:39 `left[unit]?.scope` | `→ left[unit].scope` | **yes** (limit refusal) | The code only reaches this line when `cap < 1`, so some unit is limited. `unit` is `tokens` when `tokens` is the cause. Otherwise `usd` is the cause, which needs `left.usd`. So `left[unit]` always exists. |
| 5 | index.ts:162 `String(r.model ?? '')` | `'' → "Stryker was here!"` | no | This is only a lookup key for a request with no model. Neither string is a model name in the price table, unless a caller registers a price under one of them. |
| 6–7 | keys.ts:3 `.replace(/\+/g, '-')`, `.replace(/\//g, '_')` | `'-' → ''`, `'_' → ''` | no | Base64 of a valid scope never contains `+` or `/`. Scope bytes are at most `0x7a`, and each 6-bit group would need bits a scope byte cannot have. This is checked over every 1–3 character scope. |
| 8 | keys.ts:3 `/=+$/` | `→ /=+/` | no | Base64 has `=` only at the end. |
| 9 | keys.ts:8 `importKey(…, false, …)` | extractable `→ true` | no | The HMAC key is never exported. |
| 10–12 | verify.ts:8 padding | `'=' → ''`; `4 - len % 4 → 4 + len % 4`; `len % 4 → len * 4` | **yes** (signature) | Node's `atob` is forgiving-base64 and accepts unpadded input. An Ed25519 signature is always 86 characters, and `(4 + 2) % 4 === (4 - 2) % 4`. Every other length decodes to bytes of the wrong length and fails either way. The canonical check compares the re-encoded bytes with the caller's string, not the padded one. This is the same as Worker #10–11. |
| 13 | verify.ts:32 `importKey(…, false, …)` | extractable `→ true` | no | The public key is never exported. |
| 14 | index.ts:29 `l.resets !== null` in `expired` | `→ true` | no (it decides whether to read the budget again, not whether to refuse) | `Date.parse(null)` is `NaN`, and `NaN <= Date.now()` is false, so a lifetime figure never counts as expired either way. The guard is redundant and stays. |
| 15 | index.ts:30 `catch { return null }` in `tryPlan` | block emptied | **yes** (local refusal) | The emptied block returns `undefined`, which `if (!plan)` treats the same as `null`: a refusal on cached figures still becomes a fresh read. |
| 16 | verify.ts:6 `/=+$/` in `b64url` | `→ /=+/` | **yes** (signature) | `btoa` puts `=` only at the end of its output. This is the same as Worker #9 and Testing #2 (below). |

Reject-path equivalents: 7 (amounts.ts 1, index.ts 1, llm.ts 1, verify.ts 4). A scope grammar check, a limit comparison, a key or MAC check, and an `on_outage` decision have no survivors at all.

### Property tests (`test/properties.test.ts`, fast-check)

- **`ceilMicro`**: the result is a whole number of micro-units and less than one micro-unit above the input. It is below the input only where float error in `v × 1e6` within the 8-ulp tolerance is all that separates them. An input with six decimals comes back unchanged. That is 2,000 runs each. The inclusive edge of the tolerance is pinned in `amounts.test.ts`.
- **The `max_tokens` cap**: over random prices, limits, caps and prompt sizes, the cap is a whole number, at least 1 and at most what was requested (4096 when unset). The estimated input plus the cap fits in the `tokens` left, and the priced input plus the cap fits in the `usd` left. A refusal happens only when not even one output token fits. That is 3,000 runs.
- **Scope grammar**: `checkScope` accepts a scope exactly when the Worker's `parseScope` accepts it and returns it unchanged. The segments include `.`, `..`, `...`, `%2e`, uppercase, empty, 64 and 65 characters, and random ASCII, with up to 10 segments. That is 5,000 runs. The one difference is a trailing slash, which the Worker strips and the SDK refuses. It is pinned in its own test.
- **`jcs`** matches the Worker's byte for byte on any JSON value, and parses back to the same value.
- **Tampering**: any single-field change to any of the five entries in a real `testServer()` chain (limit, spend, settle, rotate, spend) fails both `verify` and `verifyChain`. The fields are `seq`, `kind`, `scope`, `body`, `at`, `kid`, `prev`, `hash` and `sig`. That is 300 runs. A separate test signs its own entries with the Worker's `entryHash` and `signHash` and shows that `verifyChain` refuses a skipped or repeated `seq` and a broken `prev` link, even when each entry is validly signed.
- **The outage decision**: for any cached modes over a scope, its ancestors and unrelated scopes, both `spend` and `at(scope).llm` fail open exactly when the nearest cached scope is `open`. Nearest is worked out from the Worker's `ancestors()`. They throw `SolenoidUnavailable` naming the scope when that mode is `closed` or nothing is cached. That is 500 runs.

### Boundary mocks

- `fetch` is stubbed only for transport branches the server cannot produce: timeouts, aborts, other `DOMException`s, network errors, 5xx, non-JSON bodies and a missing `warnings` field. Everything that needs a real ledger answer runs against `testServer()`: holds, settles, limits, replays, rotation, paging, verify and verifyChain. `signup()` goes over real HTTP through a local `node:http` shim in front of `testServer().fetch`.
- `Date` alone is faked with `vi.useFakeTimers({ toFake: ['Date'] })` in one test, so the SDK's clock and `testServer()`'s `setNow` can both stand exactly on a window's reset time: `client.test.ts` › reads the budget again once any cached figure reaches its reset time, and not before.
- The signing-key rotation test serves `/.well-known/solenoid.json` from the Worker's real `handle()` with a rotated `SIGNING_KEY` and `SIGNING_KID`, through the client's `fetch` option. No Solenoid module is replaced.
- `SOLENOID_KEY`, `SOLENOID_API` and the `process` global are stubbed with `vi.stubEnv` and `vi.stubGlobal`. So is the global `fetch`, in the two tests of what the client does without a `fetch` option.
- `test/setup.ts` replaces the global `fetch` for every test file with one that rejects, like a network failure, any host but `127.0.0.1`. No test and no mutant can reach `api.solenoid.systems`. `vi.unstubAllGlobals` restores this guard, not the real `fetch`.
- `account.test.ts` › account functions at the fetch boundary stubs the `fetch` option for what `testServer()` cannot answer: a 5xx response, a `502 email_failed` from `/auth/recover`, a slow answer and a network failure. Everything else in that file runs against `testServer()`, with codes read from `outbox()` and send failures from `mailDown(true)`.
- `node:sqlite` is mocked to throw in one test, for `testServer()`'s error on an old Node. `node:os` `homedir` is mocked in one test, for `fileStore()`'s default directory. That test only reads, and it checks that the mock is in effect before it calls `fileStore()`. Under Stryker's worker threads, `vi.stubEnv('HOME')` does not reach `os.homedir()`, which reads the process environment.
- No Solenoid module is mocked. The tests import `worker/src/scope`, `worker/src/keys` and `worker/src/chain` as oracles for the grammar, key derivation and hashing.

### Behaviours pinned, not changed

- A 2xx with a body that is not JSON throws the raw `SyntaxError` from `res.json()`, without retrying: `http.test.ts` › throws the raw SyntaxError…
- `llm` writes `max_tokens` when the request sets neither cap field: `llm.test.ts` › caps an unset max_tokens to 4096…; `properties.test.ts` › the max_tokens cap.
- Anthropic cache writes and reads are priced at the full input rate: `units.test.ts` › prices Anthropic cache writes and reads at the full input rate.

## Testing (`testing/`)

Go Live Task 1 moved the test server out of the MIT SDK into its own FSL package, `@solenoid.systems/testing`, because the SDK's bundle held no Worker code but `sdk/src/testing.ts` (and its `dist/testing.mjs`) did. `testing/src/index.ts` is unchanged from the old `testing.ts` except for the split below; `testing/src/sql.ts` holds the SQLite adapter. Commands: `pnpm --filter @solenoid.systems/testing coverage` (v8) and `pnpm --filter @solenoid.systems/testing mutate` (Stryker, `testing/stryker.config.mjs`). Reports go to `testing/reports/`, which git ignores.

### Stryker configuration

- **Mutated:** `src/index.ts` and `src/sql.ts`. That is 54 mutants (50 after the two disabled lines below are excluded).
- **`inPlace: true`**, for the same reason as the SDK: `src/index.ts` and `src/sql.ts` import the ledger as `../../worker/src/core`, `src/index.ts` also imports `../../worker/src/mail` and `../../worker/src/router`, and `test/testing.test.ts` runs `contract/scenarios.ts`, which imports the client as `../../sdk/src/index`. None of these paths resolve from Stryker's default sandbox.
- **`vitest.config.ts`'s `exclude` needs `'.stryker-tmp/**'`, for the same reason as the SDK.** `pnpm run mutate --force` failed the dry run with `Cannot find module '../../worker/src/core' imported from testing/.stryker-tmp/backup-<hash>/src/index.ts`, and separately with `ENOENT: no such file or directory, open '.../testing/.stryker-tmp/backup-<hash>/test/../dist/testing.mjs'` from `test/bundle.test.ts`. Both traced to the same cause as the SDK's: Stryker's `inPlace` sandbox backs up every project file, test files included, into `.stryker-tmp/backup-<hash>/` before a run, and vitest's default test-file glob discovers those backup copies (of `test/units.test.ts`, `test/testing.test.ts`, `test/bundle.test.ts`, all of them) as independent, second test files, since nothing excluded `.stryker-tmp/`. A backup copy of a test file that imports `src/index.ts` resolves that import against its own (backed-up) location, so `../../worker/src/core` climbs out of `.stryker-tmp/` instead of `testing/`. Adding `'.stryker-tmp/**'` to `exclude` (confirmed with `npx vitest list`, before and after, showing the duplicate `test/bundle.test.ts` entry disappear) removes every such duplicate from discovery, and both failures go with it. `test/bundle.test.ts` and `src/index.ts` are unchanged from the brief.
- **`vitest: { related: false }`** and **`coverageAnalysis: 'perTest'`**, as in the SDK.
- Record a run with `--force`. The incremental file is `reports/stryker-incremental.json`.

### Coverage (v8, `src/**`)

This is the `testing.ts` row Go Live Task 1 moved out of the SDK's coverage table, for history, followed by the current split:

| File | Lines | Branches | Statements | Functions |
|---|---|---|---|---|
| testing.ts (historical, inside `sdk/src`, before the split) | 90.47 | 75 (6/8) | 90.38 | 95 |
| index.ts (after the split) | 100 | 100 | 100 | 100 |
| sql.ts (after the split) | 100 | 100 | 100 | 100 |

`testing.ts` used to sit below both gates on four lines that could not run through `testServer()`: `one()` in `sqlOver` (the `Sql` interface in `worker/src/core.ts` declared it, but nothing in `core.ts` called it) and the `ROLLBACK`-and-rethrow branch in `transactionSync` (every ledger check ran before the transaction opened, and the writes inside it could not fail on valid input). Task 1 deleted `one()` from `Sql` and from `sqlOver` as dead code, and `test/sql.test.ts` opens a real transaction that inserts a row then throws, to kill the rollback: `sql.exec('SELECT count(*) AS n FROM t').toArray()` shows the insert never committed. Both files are now 100% on every measure.

### Mutation score

| Run | Score | Killed | Timeout | Survived | No coverage |
|---|---|---|---|---|---|
| **Task 1 (`--force`)** | **100.00** | **50** | **0** | **0** | **0** |

Nothing survives. The two mutants Plan 2 left equivalent in `testing.ts` are disabled at the source rather than left to survive, so they never get instrumented at all (50 mutants counted, not 54):

| # | Location | Disabled with | Why |
|---|---|---|---|
| 1 | index.ts, `new DatabaseSync(':memory:')` in `tenantFor` | `Stryker disable next-line StringLiteral` | SQLite gives an empty filename a private temporary database too, so tenants stay apart (checked on Node 26; this is the same equivalence the old SDK survivor #8 recorded). |
| 2 | index.ts, `waitUntil` in the stub mailer's `io` | `Stryker disable next-line all` | The stub mailer is an `async` function whose `sent.push(m)` runs before its first `await`, so a background send is in the outbox as soon as the router calls `io.mail`, before the response returns. `outbox()` waiting on `pending` cannot change what it returns. Robin's ruling: a redundant guard for a mailer that awaits before it records, and it stays in the code (this is the old SDK survivors #26–28, now one disabled line instead of three counted-and-equivalent mutants). |

The other two survivors Plan 2 left in `testing.ts` are gone outright, not just disabled: `one()` no longer exists (old SDK survivors #1–5), and the rollback branch is now covered and killed by `test/sql.test.ts` (old SDK survivors #6–7). The mailer's `'mail is down'` message (old SDK survivor #25) was already killed before the split (F5, small-followups) and stays killed here.

### Boundary mocks

- `crypto.subtle` is real (Node's WebCrypto), not mocked; `testServer()` generates a fresh Ed25519 key pair per call.
- `test/units.test.ts` mocks `node:sqlite` to throw in one test, for `testServer()`'s error message on a Node that lacks it.
- No Solenoid module is mocked. `test/testing.test.ts` runs `contract/scenarios.ts` against a real `testServer()`, and `test/sql.test.ts` runs `sqlOver` against a real, on-disk-free `node:sqlite` `DatabaseSync(':memory:')`.

## CLI (`cli/`)

Commands: `pnpm --filter @solenoid.systems/cli coverage` (v8) and `pnpm --filter @solenoid.systems/cli mutate` (Stryker, `cli/stryker.config.mjs`). Reports go to `cli/reports/`, which git ignores. Unset `SOLENOID_KEY` and `SOLENOID_API` before either command. `test/setup.ts` also deletes both before any test runs.

### Keeping the tests away from the real home directory

`~/.config/solenoid/credentials` holds a real admin key and `~/.cache/solenoid/` a real outage cache, so no test may reach either one. `test/setup.ts` does five things for every test file:

- It makes a sandbox with `mkdtemp` under the system temp directory, and points `HOME` and `SOLENOID_CONFIG_DIR` into it. Every test that writes gets its own directory inside the sandbox from `tempDir()`, and `tempDir()` refuses any path outside it.
- It mocks `node:os` `homedir()` to return `process.env.HOME`, and to throw unless that path is a sandbox. Under Stryker's worker threads, setting `process.env.HOME` does not reach the real `os.homedir()`, because that reads the process environment (the SDK task found this the hard way). With the mock, a mutant that drops `SOLENOID_CONFIG_DIR` still resolves inside the sandbox.
- Before every test, it checks that `homedir()` and `credsPath()` both resolve inside the sandbox. It checks `credsPath()` with and without `SOLENOID_CONFIG_DIR`, so it would also catch a mock that did not reach `src/config.ts`. These checks run in `beforeEach`, not at load time, for a reason given under the Stryker configuration.
- Before every test, it points `HOME` at a fresh `mkdtemp` inside the sandbox, and checks that `join(homedir(), '.cache', 'solenoid')` resolves inside the sandbox. Since the Plan 1 follow-ups (F-3), the CLI keeps its outage cache in the SDK's `fileStore()` with its default directory, `~/.cache/solenoid` from `os.homedir()`, so this is the path the CLI would write. The fresh `HOME` per test also keeps one test's cached `open` for a scope from leaking into another, because the cache is keyed by scope, not by tenant. `cli.test.ts` › keeps the outage cache in the sandboxed home… checks that `outage.json` lands under that `HOME`, and › reaches the outage cache only through the guarded homedir… checks that `fileStore()` throws for a `HOME` outside the sandbox, so the SDK's `node:os` import gets the mock too. `vitest.config.ts` aliases `@solenoid.systems/sdk/node` to `../sdk/src/node.ts` for this.
- It stubs the global `fetch` to reject, so a test that forgets to point the CLI at `testServer()` fails instead of reaching the network. Under the stub, the real `fetch` is also wrapped to refuse any host but `127.0.0.1` (Plan 2 Task 4), for a test that replaces or unstubs the stub.

The `mutate` script also runs Stryker with `HOME` set to a fresh `mktemp -d`. The one subprocess test passes its child an explicit environment (`PATH`, the sandbox `HOME`, `SOLENOID_API` and `SOLENOID_CONFIG_DIR`) and inherits nothing else.

### How mutants reach the CLI

Stryker's vitest runner activates a mutant by setting a global inside the test worker. It does not set `__STRYKER_ACTIVE_MUTANT__` in the environment, so a CLI started as a subprocess never sees a mutant. Before this task, every command test ran the built `dist/solenoid.mjs` as a subprocess, and the run showed it: 187 of 340 mutants had no coverage, including all 24 in `main.ts`.

`test/cli.test.ts` now runs the real `src/main.ts` in process. `test/run.ts` sets `process.argv`, spies on `process.stdout.write`, `process.stderr.write`, `process.exit` and `process.cwd`, clears the module cache and imports `src/main.ts`. It then awaits the `done` promise that `src/main.ts` exports, and returns `{ code, out, err }`, with `code` from the last `process.exit` call or 0. Until the final-review fix wave it returned at the first stdout write, which stopped working once `rotate --admin` began printing the new key before saving it. Argument parsing, dispatch, output and exit codes all run under the active mutant. The backend is `testServer()`, the real Worker router and ledger over in-memory `node:sqlite`, which the global `fetch` is stubbed to. The clock is pinned with `setNow`, so log lines and reset times are exact.

The only source change is in `src/commands.ts`: `init` writes `join(process.cwd(), '.env')` instead of the relative `'.env'`. The file is the same, but the tests can now aim it at a sandbox directory, since worker threads cannot `process.chdir()`. No user-visible string changed.

`test/bundle.test.ts` keeps two smoke tests of the built binary, run as a subprocess through a local `node:http` shim in front of `testServer()`: `help`, and `init` with a scope followed by an over-limit spend (exit code 1, the exact stderr). The `mutate` script sets `STRYKER=1`, and `vitest.config.ts` leaves this file out when it is set, because it builds and tests `dist/`, not `src/`.

### Stryker configuration

- **Mutated:** every file in `cli/src`: `browser, commands, config, envfile, main`. That is 691 mutants after Go Live Task 4 added `browser.ts` and `upgrade` (629 after F5 fix round 2, 590 after Plan 2 Task 4's fix round, 563 before it, 431 before Task 4, 434 before the follow-ups' last items, 401 before the follow-ups' fix round, 387 before the Plan 1 follow-ups, 359 before the final-review fix wave, 340 before the fix round below).
- **`browser.ts` is platform-dependent, and this machine is darwin.** `openUrl`'s `win32` branch and its Linux (`xdg-open`) branch are dead code on the machine the suite runs on: the `darwin` check short-circuits before either is ever reached, so their mutants are all `NoCoverage`, not equivalent, and are recorded rather than chased. The `darwin` check itself has one unkillable survivor, `ConditionalExpression 'true'`: forcing an already-true condition to the literal `true` is byte-identical on this machine, so nothing can tell them apart without lying about `process.platform`. The `try`/`catch` around `spawn` is Robin's redundant-guard ruling (brief, Step 8): `spawn` throws synchronously only on an invalid argument, which no environment variable can produce, so the `catch` block is `NoCoverage` too. Together these are why `browser.ts` sits below the 100%-lines, 95%-branches file gate that every other mutated file meets; the brief names this file as the one exception.
- **`inPlace: true`**, as in the SDK. `vitest.config.ts` aliases `@solenoid.systems/sdk` to `../sdk/src/index.ts`, and the tests import `testServer()` from `../../testing/src/index`, which imports `../../worker/src/core`. None of these paths resolve from Stryker's sandbox directory. Do not edit or commit `cli/src` while a run is going.
- **`vitest: { related: false }`**, because the commands are reached through `src/main.ts`, which the tests import dynamically.
- **`coverageAnalysis: 'perTest'`** and **`plugins: ['@stryker-mutator/vitest-runner']`**, as in the SDK. A full run takes about 20 seconds on four runners.
- **A failing setup file counts as Survived.** The first run put the sandbox checks at the top level of `test/setup.ts`. A mutant such as `dir = () => undefined` in `config.ts` then made the setup file throw while it loaded. Vitest reported every test file as failed to collect, so no test had a result, and Stryker counted the mutant as Survived. The checks now run in `beforeEach`, where a throw fails the tests and kills the mutant. That moved `config.ts` from 77.27% to 95.45%.
- Record a run with `--force`. The incremental file is `reports/stryker-incremental.json`.

### Coverage (v8, `src/**`)

"Before" is the start of Task 19, when the command tests ran only as subprocesses and so added nothing to in-process coverage.

| File | Lines before | Branches before | Lines after | Branches after | Statements after | Functions after |
|---|---|---|---|---|---|---|
| commands.ts | 42.69 (38/89) | 45.13 (51/113) | 100 (112/112) | 100 (139/139) | 100 | 100 |
| config.ts | 81.81 (9/11) | 16.66 (1/6) | 100 (11/11) | 100 (6/6) | 100 | 100 |
| envfile.ts | 100 (4/4) | 100 (8/8) | 100 (4/4) | 100 (8/8) | 100 | 100 |
| main.ts | 0 (0/5) | 0 (0/1) | 100 (8/8) | 100 (1/1) | 100 | 100 |
| **All (Task 19)** | 46.78 (51/109) | 46.87 (60/128) | **100** (135/135) | **100** (154/154) | 100 | 100 |
| browser.ts (Go Live Task 4) | | | 85.71 (6/7) | **50 (3/6)** | 90 | 100 |
| **All (Go Live Task 4, `upgrade`)** | | | 99.52 (211/212) | 98.67 (223/226) | 99.61 | 100 |

Every branch was covered through F5. Until the Plan 1 follow-ups, the fail-open side of `spend` could not run: each CLI run built its client with the default in-memory outage store, so `spend` during an outage always failed closed, even under a limit set with `--on-outage open`. The CLI now uses `fileStore()`, and `cli.test.ts` › fails open under an on-outage open limit once a spend has cached its mode… covers that side.

Go Live Task 4 added `commands.ts`'s `upgrade` case (fully covered: 100% on every measure) and the new `browser.ts`, which drops the file total below the other files' 100%. `commands.ts`, `config.ts`, `envfile.ts` and `main.ts` stay at 100% on every measure; only `browser.ts` is below the file gate, on this machine, for the reasons given under its Stryker configuration above. `openUrl`'s platform choice is three nested ternaries (`BROWSER ? … : (darwin ? … : (win32 ? … : xdg-open))`), six branches in all: both sides of the `BROWSER` check run (the unset-`BROWSER` test takes the `false` side), but past that this machine is always `darwin`, so the `darwin` check's `false` side and both sides of the `win32` check never run: three missed branches. The one missed line is `catch { done(false) }`'s body, which never runs because `spawn` cannot throw synchronously on the arguments `openUrl` builds (Robin's redundant-guard ruling).

### Mutation score

| Run | Score | Killed | Timeout | Survived | No coverage |
|---|---|---|---|---|---|
| Before, existing tests (subprocess) | 34.41 | 117 | 0 | 36 | 187 |
| First in-process run, sandbox checks at load time | 95.88 | 326 | 0 | 12 | 2 |
| After Task 19 (`--force`) | 98.53 | 335 | 0 | 4 | 1 |
| After the fix round (`--force`) | 98.33 | 353 | 0 | 5 | 1 |
| After the final-review fix wave (`--force`) | 98.40 | 369 | 0 | 5 | 1 |
| After fix wave round 2 (`--force`) | 98.45 | 381 | 0 | 5 | 1 |
| After the Plan 1 follow-ups (`--force`) | 98.75 | 396 | 0 | 5 | 0 |
| After the follow-ups' fix round (`--force`) | 98.85 | 429 | 0 | 5 | 0 |
| After the follow-ups' last items (`--force`) | 98.84 | 426 | 0 | 5 | 0 |
| First run after Plan 2 Task 4, the brief's tests (`--force`) | 92.76 | 525 | 0 | 40 | 1 |
| After Plan 2 Task 4 (`--force`) | 98.76 | 556 | 0 | 7 | 0 |
| After Task 4's copy fix round (`--force`) | 98.81 | 583 | 0 | 7 | 0 |
| After the Plan 2 final-review fixes (`--force`) | 98.83 | 591 | 0 | 7 | 0 |
| F5 (small-followups), before the added test (`--force`) | 98.71 | 614 | 0 | 8 | 0 |
| After F5's added test (`--force`) | 98.87 | 615 | 0 | 7 | 0 |
| After F5 fix round 1 (`--force`) | 98.87 | 615 | 0 | 7 | 0 |
| After F5 fix round 2 (`--force`) | 98.89 | 622 | 0 | 7 | 0 |
| **After Go Live Task 4 (`upgrade`, `browser.ts`)** (`--force`) | **96.09** | **664** | **0** | **12** | **15** |

Per file, before → after the fix round → after the fix wave: commands 33.09 → 98.28 → 98.34, config 40.91 → 95.45 → 95.45, envfile 89.47 → 100 → 100, main 0 → 100 → 100. Round 2: commands 98.40. Neither wave added a survivor: the survivors below are the same six. Round 2's first run had one more, the `^` anchor of a regex that recognised the SDK's API error, which was equivalent. The check became `startsWith`, whose mutants are all killed.

The Plan 1 follow-ups (F-2 to F-4) added the port wording to the API messages, the file outage store and the true outage messages, and stricter parsing: a pair needs exactly one `=` and a value, and `--warn-at` must be a number (its range is still the service's to refuse). Their new code left no survivor, and the no-coverage fail-open message is now covered. Per file: commands 98.78, config 95.45.

The fix round accepted only plain decimals in pairs and `--warn-at`, and the last items made that strict (`/^-?\d+(\.\d+)?$/`: no `+`, no leading or trailing point), rewrote the outage next step in one helper that `spend` and `formatError` share, printed `/` for the root scope, and mapped node's "ambiguous" argument error to the `--flag=value` form. The strict regex's mutants are killed by `cli.test.ts` › refuses a leading plus, a leading point and a trailing point… and › accepts multi-digit integers and decimals with several fraction digits. Per file: commands 98.88.

Plan 2 Task 4 added `solenoid email`, `solenoid recover`, `init --email`, `tenantOf` and `recoveryTenant` in `commands.ts`, and `readEnvKey` in `envfile.ts`. The brief's tests left 40 survivors and one no-coverage mutant. Most were in the printed addresses: the tests matched the address with `toContain`, and each output prints it twice, so dropping `.trim().toLowerCase()` from one copy passed. The tests now pass ` Robin@Example.COM ` and require every case-insensitive match in the output to be exactly `robin@example.com`, never padded by a second space. The others: the `^` anchor of `tenantOf` (`cli.test.ts` › tenantOf, which also covers a wrong kind, an 11- and a 13-character ID and uppercase); `recover` with no email, which no test ran (› recover with no email says how to use it); the `--tenant` suffix of the suggested command (the tests now read the command out of its backticks and require exactly `solenoid recover robin@example.com <code>`, with ` --tenant <id>` only when the flag was given); the printed key and credentials path of both `recover` outputs; the send-or-verify branch of `email`, which printed `undefined` when forced to verify; and three `readEnvKey` regex mutants (`export` followed by two spaces, a space before `=`, a tab after it). `readEnvKey` and `appendEnvKey` now share one `read`, so the missing-file case is no branch of its own and the `'utf8'` mutant is killed by `appendEnvKey`'s tests. v8 then showed the saved-credentials source of `recoveryTenant` untaken, and › takes the tenant from --tenant, SOLENOID_KEY or the saved admin key… now runs it. Per file: commands 98.71, config 95.45, envfile 100, main 100; lines, branches, statements and functions are all 100%. No survivor is in `recoveryTenant`'s refusal, `tenantOf`'s pattern, `readEnvKey` or the `--force` guard, which › refuses to overwrite a different saved account without --force checks in both directions.

`test/setup.ts` now also wraps the global `fetch` in the SDK's guard: any host but `127.0.0.1` is refused with a `TypeError`. The per-test stub replaces it, and `unstubGlobals` puts the guard back, so it catches only a stray real fetch, such as a mutant that falls back to `https://api.solenoid.systems`. A throwaway test that called `vi.unstubAllGlobals()` and ran `init` with `SOLENOID_API` unset got exit code 1, `solenoid unreachable`, and the cause `TypeError: test setup refuses a real fetch to https://api.solenoid.systems; only the local shim on 127.0.0.1 is reachable`.

Task 4's copy fix round made the recovery messages true of the Worker's limits. `formatError` takes the command from `main.ts`, and `rate_limited` names the limit that command can hit (a `Map` from `init`, `email` and `recover`; any other command gets no next step). `init --email` prints the error code, and offers the retry only for `email_failed` or an outage. `recover` refuses a `--tenant` that is not `^[a-z2-7]{12}$` before any request. The first run left six new survivors, all killed. `if (!t)` → false printed the format error for `"undefined"`, so › takes the tenant from… now refuses `undefined` in stderr. The `invalid_email` branch of `init --email` was indistinguishable from the generic one, so › init --email offers the retry only when a retry can work now requires the rejected address in the line. The outage fallback literal became `e.message`. The `recover` code-request line is one literal, which the address checks cover. New tests also pin the tenant sources' order when they disagree, and a same-account restore without `--force`. Coverage stays 100% on all four measures.

The Plan 2 final-review fixes (M3, M4) made `recover` print the admin key before saving it, with a wrapped error when the save fails, and share `rotate --admin`'s only-copy wording through `onlyCopy`. A credentials file that can't be read no longer stops `recover`: `--force` skips reading it, and without `--force` it gets a one-line refusal. `savedTenant()` reads the saved tenant for both `recoveryTenant` and that check. Its catch was first written as `catch { return undefined }`, which left an emptied-block survivor; it is now `catch {}`, the same behaviour with nothing to mutate. The run adds no survivor. Coverage stays 100% on all four measures.

F5 (small-followups) added `email <address> <code> --rotate` and the send step's refusal of `--rotate`. The first run's one new survivor was `if (!flags.rotate)` → `false` at commands.ts:217, which sent a plain confirm down the rotating path: the plain-confirm test only checked that the output contained the address and account ID. `cli.test.ts` › email sends a code, refuses a wrong one, and confirms the right one now pins the whole output and checks that the credentials file is unchanged, which kills it. commands.ts 98.85. The seven survivors below are unchanged; #3, #5 and #7 moved down a few lines. F5 fix round 1 dropped the redundant `client(10_000)` from `email --rotate` (the SDK already gives email calls at least 10 seconds) and reworded its outage message; it left the same seven survivors. Fix round 2 split that message into one line per branch; still the same seven, with #7 now at commands.ts:249.

Go Live Task 4 added `commands.ts`'s `upgrade` case, the `billing_unavailable` `explain` entry, the `HELP` line, and the new `cli/src/browser.ts`. The tests are `upgrade.test.ts` (opens Stripe Checkout and prints the URL; passes the URL to a custom `BROWSER` command; still prints the URL and says so when the opener is missing; uses the platform opener when `BROWSER` is unset, checked against a logged `open`/`xdg-open` invocation; prints the billing portal link for `already_pro`; explains `billing_unavailable`; reports `Outage` as "checkout could not start"; and refuses with no request when there are no saved credentials) plus `cli.test.ts`'s updated `HELP` array and `bundle.test.ts`'s updated help-screen regex. The first run left eight new survivors: six in `browser.ts` (a new file) and two in `commands.ts`, the ternary that picks `upgrade`'s first line. Both `commands.ts:344` survivors (the ternary's two branch strings, each turned to `""`) are killed by adding one `.not.toBe('')` check on the first output line to each of the "opens Stripe Checkout" and "opener is missing" tests: this pins that the line is non-empty without pinning its wording, which the frozen-copy rule reserves for the controller's copy gate. `browser.ts:4`'s `[url] → []` in the `BROWSER` branch's argument array is killed by a new test, › passes the url as an argument to a custom BROWSER command, which points `BROWSER` at a script that logs its own arguments (unlike the `true` stub the other tests use, which ignores whatever it is given). commands.ts stays at 98.92; the same seven pre-existing survivors below are unchanged in content, alongside five new ones in `browser.ts` (below).

### Surviving mutants (7 in `commands.ts`/`config.ts`, equivalent; 5 in `browser.ts`, recorded per the brief)

| # | Location | Mutant | Reject path | Why it is equivalent |
|---|---|---|---|---|
| 1 | commands.ts:7 `s === '/'` | `→ false` | no (normalisation, before the scope grammar check) | `'/'` then goes through `replace(/^\/+\|\/+$/g, '')`, which also gives `''`. The check is a redundant guard and stays. |
| 2 | commands.ts:7 `'/'` | `→ ""` | no | Then `''` takes the first branch and gives `''`, and `'/'` takes the second and also gives `''`. |
| 3 | commands.ts:134 `default: return undefined` in `explain` | clause emptied | no | Control falls out of the `switch`, and the function returns `undefined` anyway. |
| 4 | config.ts:18 `writeFileSync(…, { mode: 0o600 })` | `→ {}` | no | `chmodSync(file(), 0o600)` on the next line sets the same mode. The mode on `writeFileSync` closes the moment between the two calls in which a new file would be readable, which no test can observe without mocking `fs`. It stays. |
| 5 | commands.ts:160 `exec(e.message)?.[1]` in `argError` | `?.` → `.` | no | Every `parseArgs` error message quotes the option (`Unknown option '--bogus'`, `Option '--per <value>' argument missing`), so `exec` never returns `null`. The guard stays, so that a future Node wording prints `"undefined"` rather than a `TypeError`. |
| 6 | commands.ts:21 `exec(key ?? '')` in `tenantOf` | `'' → "Stryker was here!"` | yes (an unreadable key names no account) | `exec(undefined)` tests the string `"undefined"`, and neither that nor `"Stryker was here!"` matches `^sk\.(?:admin\|spend)\.`, so both return `undefined`. The `?? ''` is there for the type (`exec` takes a string) and stays as a redundant guard. |
| 7 | commands.ts:249 `requestRecovery(tenant, email, { api })` | `{ api } → {}` | no | `api` is `checkApi(apiBase())`, and `authPost` falls back to `checkApi(SOLENOID_API ?? https://api.solenoid.systems)`, the same value. The explicit option stays so that the request and the `recover` call below it name one API. |
| 8 | browser.ts:5 `process.platform === 'darwin'` | `→ true` | no | This machine's `process.platform` really is `'darwin'`, so forcing the condition to the literal `true` is byte-identical: both take the `open` branch. The `false` side of the same condition is killed (`cli.test.ts` › uses the platform's opener when BROWSER is unset, which reads the real `process.platform` to choose which stub script it expects logged). Nothing on this machine can distinguish an already-true condition from the literal `true`. |
| 9 | browser.ts:10 `spawn(cmd, args, { stdio: 'ignore', detached: true })` | `→ spawn(cmd, args, {})` | no | `stdio` and `detached` only change how the child process is owned after `openUrl` has already resolved: with the default `stdio` the child inherits the CLI's file descriptors instead of running with none, and without `detached` the child stays in the CLI's process group instead of its own. Neither changes whether `spawn` succeeds, whether the `'spawn'` or `'error'` event fires, or anything `openUrl` returns or a stub script logs, so no black-box test of the CLI's output can tell the two apart. This is the same class of gap as Worker and SDK equivalents that need `fs`- or process-table-level inspection to observe. |
| 10 | browser.ts:10 `stdio: 'ignore'` | `→ stdio: ''` | no | Same reasoning as #9: confirmed empirically, since `spawn` does not throw or otherwise change observable behaviour for this value, and no test asserts on the child's own file descriptors. |
| 11 | browser.ts:10 `detached: true` | `→ detached: false` | no | Same reasoning as #9. |
| 12 | browser.ts:11 `child.unref()` | call removed | no | `unref()` only tells Node not to count the child toward keeping the event loop alive; it runs before `done(true)`, so removing it changes neither the resolved value nor anything printed. The stub scripts used in tests exit immediately regardless, so there is nothing for a black-box test to observe. |

No reject-path mutant survives. `openUrl` returns `false` (never throws) when the opener cannot start, and `upgrade` prints accordingly either way: there is no refusal path in `browser.ts` for a mutant to weaken. Every argument error, every `invalid_limit` field, every unit, amount and scope grammar refusal, every key check the CLI reports (`invalid_key`, `admin_required`, `out_of_scope`), the `limit_exceeded` refusal and the fail-closed outage decision are killed.

### Commands and argument errors covered

Every command in the Task 12 list runs in process against `testServer()`, with exact stdout, stderr and exit code: `help` and no command; `init` with and without a scope, with `/`, with extra slashes, with a bad scope, twice without `--force`, with `--force`, against the default API URL, and with a failed signup; `login` with no key, a spend key, a malformed key and a key the service rejects; `key` with and without a scope, at a rotated epoch; `limit` with `off`, `--per`, `--on-outage` and `--warn-at`, with each `invalid_limit` field, an invalid unit and each malformed pair (no `=`, no unit, no value, more than one `=`, a blank value, a non-number, and hex, binary, octal and exponent forms, a leading `+`, and a leading or trailing point), a `--warn-at` that is not a strict decimal or is out of range, and a flag whose value starts with `-`; `ls` at the root and below it, with inherited limits, children and per-child limits; `spend`, over the limit (windowed and lifetime), with `off`, a non-number, a negative amount, no pairs, and during an outage with nothing cached, with a closed limit cached and with an open limit cached (the spend goes ahead unrecorded), at the root scope, and with an outage cache that cannot be written; `log` with `--before`, paging past 50 entries; `rotate` without `--yes`, with it, and with `--admin`, including with a credentials file it cannot write, a rotation request that fails with no answer, a refused rotation and a rotation that takes longer than two seconds; a bad `SOLENOID_API` at `init` and `login`, including one on a port fetch blocks, and a bad saved api at `ls`, `key` and `rotate --admin`; and every command without credentials; and `upgrade`, opening Stripe Checkout, printing the billing portal link for `already_pro`, explaining `billing_unavailable`, reporting a transit failure as `Outage`, and refusing with no request when there are no saved credentials (Go Live Task 4). `.env` handling covers a missing file, an empty file, no final newline, CRLF endings with and without a final newline, and an existing `SOLENOID_KEY` on any line, including `export SOLENOID_KEY=`, leading spaces or tabs and a space before the `=`. The credentials file is checked at 0600 and its directory at 0700 after `init`, `login` and `rotate --admin`, and when the file already existed with a looser mode.

### Behaviours pinned, not changed

Each of these is pinned by a test whose name starts with "pins:" and is left for review.

- `log` at the root prints `more: solenoid log  --before <n>`, with two spaces where the scope would go.
- `explain()` repeats the Worker's error-code meanings, and a code it does not map gets no next step. `log --before abc` sends `before=NaN` and prints only `solenoid: invalid_before (400)`.
- The `invalid_limit` catch-all says the value "must be a number" when the value is a number out of range (`n=-1`).
- A unit named `per`, `on_outage` or `warn_at` is read as the control field (`per=5` fails as a bad `--per`, `warn_at=0.5` sets a warning), and with `--per` given, `per=5` is dropped.
- `ls` during an outage prints only `solenoid unreachable`, and `limit` prints `solenoid: request failed and is not safe to retry`. Neither gets the outage next step, which `formatError` only adds to `SolenoidUnavailable`'s message.

### Fix round 1: three pinned behaviours fixed

The review ruled that three behaviours pinned above get fixed now, because one of them can lose an account:

- **`login` checks the key with the service before it saves it.** A rejected, malformed or spend key leaves an existing credentials file byte for byte the same, and so does an outage. Tests: `cli.test.ts` › refuses anything that is not an admin key, and leaves saved credentials byte for byte; › checks a well-formed key with the service before saving it…; › saves nothing when there was no file…; › saves nothing when solenoid is unreachable.
- **`init <scope>` checks the scope before it signs up.** A bad scope makes no request and writes no credentials. It is also checked before the already-initialised check. Tests: › rejects a bad scope before signing up… (a `fetch` spy in front of `testServer()` records no request); › rejects a bad scope before the already-initialised check….
- **A `parseArgs` error goes through `formatError`.** `main.ts` catches it and `argError` in `commands.ts` rewords it, so the user sees one `solenoid:` line and exit code 1: ``unknown option "--bogus"; run `solenoid help` to see the options``, `"--before" needs a value; …` or `"--yes" takes no value; …`. Tests: › refuses an unknown flag with one solenoid: line…; › refuses a flag missing its value…; `bundle.test.ts` › refuses an unknown flag with one solenoid: line and no stack trace, which runs the built binary.

### Boundary mocks

- The global `fetch` is stubbed to `testServer().fetch` for everything that needs a ledger. It is stubbed with a plain function only to record the default API URL, and to return a 429 from signup, which `testServer()` never returns: its internal ops tenant starts with no signup limit. Outages use `testServer().outage(true)`.
- `process.argv`, `process.stdout.write`, `process.stderr.write`, `process.exit` and `process.cwd` are replaced around each in-process run. `HOME`, `SOLENOID_CONFIG_DIR` and `SOLENOID_API` are set with `vi.stubEnv`. `node:os` `homedir` is mocked in `test/setup.ts`, as described above.
- No Solenoid module is mocked. The tests use the SDK client over `testServer().fetch` as an oracle, to check that a printed or saved key works for its scope and fails outside it.

## MCP (`mcp/`)

Commands: `pnpm --filter @solenoid.systems/mcp exec vitest run --coverage` (v8) and `pnpm --filter @solenoid.systems/mcp run mutate --force` (Stryker, `mcp/stryker.config.mjs`). Reports go to `mcp/reports/`, which git ignores. Unset `SOLENOID_KEY` and `SOLENOID_API` before either command. `test/setup.ts` also deletes both before any test runs.

### Keeping the tests away from the real home directory and the network

`test/setup.ts` is the CLI's, with the sandbox prefix `solenoid-mcp-test-` and without the `credsPath()` checks (the MCP has no `src/config.ts`; `main.ts` builds the credentials path itself). It makes a `mkdtemp` sandbox, points `HOME` and `SOLENOID_CONFIG_DIR` into it, mocks `node:os` `homedir()` to throw unless `HOME` is a sandbox, gives each test a fresh `HOME` inside the sandbox, and checks that `homedir()` and `~/.cache/solenoid` resolve inside it. It stubs the global `fetch` to reject, and wraps the real `fetch` to refuse any host but `127.0.0.1`, as the SDK and CLI setups do since Plan 2 Task 3. A throwaway test that unstubbed the globals and fetched `https://example.com/` got `test setup refuses a real fetch to https://example.com; only the local shim on 127.0.0.1 is reachable`. `main.test.ts` › reads the credentials under the home directory… writes `~/.config/solenoid/credentials` under that sandboxed `HOME`. The `mutate` script runs Stryker with `HOME` set to a fresh `mktemp -d`.

`test/bundle.test.ts` builds `dist/solenoid-mcp.mjs` and runs it as a subprocess with only `PATH`, the sandbox `HOME` and the variables the test names: with `SOLENOID_KEY` unset (exit 1, one `solenoid-mcp: ` line on stderr, empty stdout), and with a spend key and an API on a closed `127.0.0.1` port that fetch allows, where a `ping` must give exactly `{"jsonrpc":"2.0","id":1,"result":{"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"solenoid","version":"2.0.0"}}}}\n` on stdout (F2, small-followups: every modern result's `_meta` now carries `serverInfo`, not just `server/discover`'s). `vitest.config.ts` leaves it out under `STRYKER`.

### Stryker configuration

The CLI's configuration verbatim, with `mutate: ['src/**/*.ts', '!src/bin.ts']`: `main, protocol, tools`, 331 mutants after the F2 review fix (325 after the small-followups F1+F2 changes, 320 after fix round 2, 298 after fix round 1, 270 before it). `bin.ts` is the four-line process wrapper, reached only by the bundle test. A full run takes about 15 seconds on four runners.

### Coverage (v8, `src/**`)

| File | Lines | Branches | Statements | Functions |
|---|---|---|---|---|
| main.ts | 100 | 100 | 100 | 100 |
| protocol.ts | 100 | 100 | 100 | 100 |
| tools.ts | 100 | 100 | 100 | 100 |
| bin.ts (not mutated; run only as a subprocess) | 0 (0/3) | 100 | 0 | 0 |

### Mutation score

| Run | Score | Killed | Timeout | Survived | No coverage |
|---|---|---|---|---|---|
| The brief's tests, with the protocol tests adapted to 2026-07-28 (`--force`) | 77.78 | 210 | 0 | 60 | 0 |
| After the added tests (`--force`) | 98.52 | 266 | 0 | 4 | 0 |
| After fix round 1 (`--force`) | 97.65 | 291 | 0 | 7 | 0 |
| After fix round 2 (`--force`) | 97.81 | 313 | 0 | 7 | 0 |
| After the small-followups F1 (case-insensitive reserved units) + F2 (`serverInfo` on every modern result) (`--force`) | 97.85 | 318 | 0 | 7 | 0 |
| **After the F2 review fix (legacy-session tracking)** (`--force`) | **97.89** | **324** | **0** | **7** | **0** |

Per file after the F2 review fix: main 97.62, protocol 96.88, tools 99.22. The review found that a legacy session's follow-up calls after `initialize` carry no `_meta.protocolVersion`, so they were falling through to `!LEGACY.includes(undefined)` (`true`) and getting treated as modern, wrongly picking up `serverInfo` on every result of a legacy client's own protocol. Fix: `server()` now keeps one `legacySession` boolean per connection (matching the ruling that each stdio connection gets its own `handle` closure), set once handling `initialize` starts; `modern` is `!LEGACY.includes(version)` when the request names an explicit version (unchanged), and `!legacySession` when it doesn't. `protocol.test.ts` covers: a version-less `tools/list`/`tools/call` after `initialize` carries no `serverInfo` (was the bug); a version-less `server/discover`/`ping` before any `initialize` still does; and a request naming an explicit modern version still carries it even after `initialize`. This needed restructuring the test file's shared server instance: `initialize` mutates session state, so the file's originally-shared `h`/`rpc` (used by most tests, none of which call `initialize`) would have been permanently marked legacy by any test that did call it on the same instance. A `freshServer()` helper gives each session-sensitive test (the `initialize` negotiation test itself, plus the three new era tests) its own instance; every other test keeps using the shared `h`. Six new mutants in `protocol.ts` (the `legacySession` variable, its assignment and the ternary) are all killed. The 7 pre-existing survivors are unchanged and still equivalent, only shifted by the two new lines (`let legacySession = false` and `legacySession = true`). The renamed test "carries serverInfo on an explicitly modern or legacy request, but not on the legacy initialize handshake" (previously titled "...merged with any `_meta` the result already has...") no longer claims to exercise a `_meta` merge: no production call site ever passes a result with pre-existing `_meta`, so that half of `reply`'s merge (`{ ...(result._meta as ...) }`) is defensive/future-proofing, not reachable from any current input; the title now says only what the test checks.

Per file after F1+F2 (superseded by the row above): main 97.62, protocol 96.75, tools 99.22. F1 lower-cased the reserved-unit check in `set_limit` so `ROTATE_ADMIN`/`Rotate_Admin` are refused before any request, same as the lowercase names; `tools.test.ts` › refuses a control key or a value that is not a finite number or null… now also sends a mixed-case control name. F2 added `_meta['io.modelcontextprotocol/serverInfo']` to every modern-era result (`ping`, `tools/list`, `tools/call`, `server/discover`), leaving `initialize` and the two `LEGACY` protocol versions untouched; five new mutants in `protocol.ts` (the `reply`/`modern` machinery) are all killed, and the five pre-existing survivors in `protocol.ts` and `tools.ts` shifted a few lines but are unchanged and still equivalent. Fix round 2 refused `set_limit` `limits` that name a control key (`per`, `on_outage`, `warn_at`, `rotate_keys`, `rotate_admin`) or map a unit to anything but a finite number or `null`, before any request; before it, `{"rotate_admin": true}` in `limits` rotated the admin key through the MCP. It also required the `--admin` key to start `sk.admin.`, and request ids to be safe integers. `tools.test.ts` › refuses a control key or a value that is not a finite number or null… counts requests and kills every new mutant, including each control name, because it sends each with a number or `null`, which the value check alone would let through. The survivors are the same seven. Fix round 1 (main 97.30, protocol 96.67, tools 99.10) Fix round 1 replaced `readline` with newline-only framing in `serveStdio`, refused request ids that are not a string or an integer, dropped the batching revisions `2025-03-26` and `2024-11-05`, and refused an `--admin` credentials file with no string `admin_key`. Its new mutants are killed by `protocol.test.ts` › frames on \n only…, › strips one trailing \r, joins a line split across chunks…, the id cases in › keeps going through bad input, and `main.test.ts` › --admin with a credentials file that holds no admin key (now also an empty `admin_key`, a spend key and an array). Three new survivors are equivalent (5 to 7 below). Of the first run's 60 survivors, 52 were in `tools.ts`: nothing checked the input schemas, so every schema key, type and `required` list could change unseen. `tools.test.ts` › describes every tool and argument, and pins each schema pins the schemas exactly, with every `description` taken out and checked only to be non-empty, so the copy stays free to change. The others were `before: 1` (`>= 1` → `> 1`), `limits` as a string or `null`, the default credentials path under `~/.config/solenoid`, and the server's name and version, which `main.test.ts` › start now reads back from `initialize`.

### Surviving mutants (all 7 are equivalent)

| # | Location | Mutant | Reject path | Why it is equivalent |
|---|---|---|---|---|
| 1 | protocol.ts:24 `typeof m !== 'object'` | `→ false` | yes (invalid request) | A redundant guard. A parsed line that is not an object is `null` (caught by `!m`) or a primitive (a string, number or boolean), whose `jsonrpc` is `undefined`, so `m.jsonrpc !== '2.0'` refuses it with the same `-32600`. `protocol.test.ts` › keeps going through bad input sends `"ping"` and `null` to pin that. It stays, by Robin's ruling. |
| 2 | protocol.ts:50 `m.params?.arguments` | `?.` → `.` | no | Reached only after `byName.get(m.params?.name)` found a tool, which needs `params` to be an object with a string `name`. A redundant guard; it stays. |
| 3 | tools.ts:56 `a[k] !== undefined` in `set_limit` | `→ true` | no | Copies `per`, `on_outage` and `warn_at` as `undefined` when absent, and the SDK's `JSON.stringify` drops `undefined` values, so the request body is the same. |
| 4 | main.ts:17 `readFileSync(…, 'utf8')` | `'utf8' → ""` | no | Node reads an empty encoding as the default, and even a `Buffer` reaches `JSON.parse` as the same UTF-8 string. |
| 5 | protocol.ts:64 `line.endsWith('\r') ? line.slice(0, -1) : line` | `endsWith` → `startsWith` | no | A redundant guard kept on the controller's ruling. `\r` is JSON whitespace, so `JSON.parse` reads a line the same with or without it, and a line that is only `\r` is blank to `trim()`. |
| 6 | protocol.ts:64, same expression | `line.slice(0, -1)` → `line` | no | The same: an unstripped trailing `\r` parses the same. |
| 7 | protocol.ts:68 `input.setEncoding('utf8')` | `'utf8' → ""` | no | Node normalises an empty encoding to UTF-8. Removing the call is not equivalent: › strips one trailing \r, joins a line split across chunks, even inside a character… splits a U+2028 across two writes and kills that mutant. |

The `--admin` and spend-key checks (including a credentials file of `{}` or `null`), argument validation (`scope`, `before`, `limits`), the request-id check, the unknown-tool and parse-error paths, and the unsupported-protocol-version refusal have no survivors. Survivor 1 is on the invalid-request path but is equivalent, as above.

### Boundary mocks

- `tools.test.ts` passes `testServer().fetch` to the SDK client as its `fetch` option; `main.test.ts` › start stubs the global `fetch` to it, because `start` builds its own client from the environment.
- No Solenoid module is mocked.

## End to end (`e2e/`)

Command: `pnpm --filter @solenoid/e2e test`, which builds the SDK and CLI first. The root `pnpm test` runs it after the worker, SDK and CLI packages, because `e2e` lists all three as workspace dependencies. It is not mutation-tested and has no Stryker config: it starts `wrangler dev`, and it checks the built bundles rather than `src/`, so no coverage or mutation figure applies to it. It is also left out of the lefthook pre-commit hook, which has no `test:changed` script to find in it.

`global-setup.ts` starts the real Worker with `wrangler dev` on a free `127.0.0.1` port, with a fresh `MASTER` and signing key in a temporary `worker/.dev.vars` and Durable Object state in a temporary `--persist-to` directory. It refuses to start if `worker/.dev.vars.bak` exists. The generated `.dev.vars` pins `SIGNING_KID=e2e`, so the run does not depend on the kid in `wrangler.jsonc`. The setup also refuses to run unless the server that answers on the port publishes the signing key this run generated under that kid, so a stale or foreign server there is never tested against. Until the final-review fix wave it probed the port instead, but it probed the port `freePort()` had just closed, so that check could never fire. On teardown it kills wrangler's process group, removes its own `.dev.vars` and puts back the developer's one if there was one.

The tests run the built CLI (`cli/dist/solenoid.mjs`) as a subprocess and the SDK bundle (`sdk/dist/solenoid.mjs`) in process. `vitest.config.ts` aliases the contract scenarios' `../sdk/src/index` import to the same bundle, so `contract/scenarios.ts` runs against the real Worker through the published SDK, with the one clock scenario skipped.

### Keeping the tests away from the live service and the real home directory

- `test/setup.ts` deletes `SOLENOID_KEY` and `SOLENOID_API` and refuses to run unless the API from the global setup is `http://127.0.0.1:<port>/`.
- Every CLI run gets an explicit environment and nothing else: `PATH`, a `HOME` and `SOLENOID_CONFIG_DIR` inside a per-file `mkdtemp` sandbox, and `SOLENOID_API` set to the local Worker. Its working directory, where `init` writes `.env`, is in the same sandbox. `user()` refuses any path outside the sandbox.
- Every SDK client is built with the local API passed explicitly, and uses its in-memory outage store.
- The ops key comes from `worker/scripts/ops-key.mjs`, run with only `MASTER` set to the test value.

### Boundary mocks

- The LLM provider in the `run.llm` scenarios is a plain async function that records the `max_tokens` it was given and returns a fixed `usage`. Nothing else is stubbed: no Solenoid module, no `fetch`.

## learning-loop (`<vault>/learning-loop`, branch `solenoid-fetch-budget`)

Task 21 of this phase. Full detail, including the race-test flake investigation and the `verify.mjs` outage-cache fix, is in learning-loop's own `CHANGELOG.md` under Unreleased ("Mutation-test the Solenoid fetch budget and verify spend") and in this plan's `task-21-report.md`. Summary only, here:

Commands: `stryker run stryker.fetch-budget.json` and `stryker run stryker.model-client.json`, both added to `npm run test:mutation`, matching `stryker.file-lock.json`'s shape (command runner over `node --test`, `coverageAnalysis: 'off'`, `thresholds: {high:95,low:90,break:90}`).

| File | Score before → after | Mutants | Survivors | Coverage (lines / branches) |
|---|---|---|---|---|
| `plugin/scripts/lib/fetch-budget.mjs` (entirely new on this branch) | 86.32 → 94.74 | 95 | 5, all equivalent | 100 / 94.74 |
| `plugin/scripts/lib/model-client.mjs` (gated on Task 16's `budget` param only; the rest predates this branch) | 77.22 → 96.20 | 79 | 3, all equivalent | 100 / 96.30 |

Both clear the break threshold. `fetch-budget.mjs`'s branch coverage sits 0.26 points under the 95% gate: the one uncovered branch is `budgetScopeSegment`'s `seg === ''` check, which is provably dead (the function's `replace`/`slice` chain is character-preserving and the empty-`sessionId` case is already refused earlier in the same function), so no input can ever reach it.

Reject paths named by the task brief — `tryBump`'s allow/deny decision, the session-id-to-scope-segment mapping, and the `SolenoidUnavailable`-as-refusal decision — have zero survivors.
