# Cold review: Plan 3a, go live

Reviewed against HEAD 9dcf329. The reviewer did not write the plan.

## Verdict

**EXECUTE AFTER FIXES.** The architecture holds, and so do most of the plan's code-level claims. The testing split, the salted hash, the one-alarm design, `meter_to` pinning, the webhook signature check in WebCrypto, the Astro scaffold, the redirect table and the launch runbook all stand up. I probed all three of the named fallback risks, and each one works without its fallback.

Four things stop execution as written:
- Task 3's billing test does not typecheck.
- Task 4 breaks a pinned help regex in a file the plan doesn't list.
- The site package can't pass `astro check` under pnpm without `@types/node`.
- `site/wrangler.jsonc` names a compatibility date that the lockfile's workerd refuses to start.

On billing, three problems need fixing before live mode:
- Two open Checkouts can leave a customer paying for two subscriptions, one of which they can't see.
- The final meter report at cancellation is timestamped after the subscription ends, so it is likely never billed.
- Task 16's "$0 tier works" check passes whatever the tiers are.

## Findings

### Blockers

**B1. `worker/test/billing.test.ts` fails typecheck: `Env` is not assignable to `Record<string, unknown>`.** CONFIRMED
- Plan: Task 3 Step 1, lines 960-962: `const post = (path, body, headers = {}, e: Record<string, unknown> = env) => …`, and `checkout(headers, e?: Record<string, unknown>)`.
- Code: `cloudflare:test` declares `export const env: Cloudflare.Env`, which is an interface (`vitest-pool-workers/types/cloudflare-test.d.ts:5`). An interface has no implicit index signature.
- Probe: a scratch tsc run over the same types printed `error TS2322: Type 'Env' is not assignable to type 'Record<string, unknown>'. Index signature for type 'string' is missing in type 'Env'.`
- What breaks: `worker/tsconfig.json` includes `test/**`. Task 3 Step 7 (`pnpm typecheck`) fails, and the lefthook typecheck blocks the Step 9 commit.
- Fix: type the override as `object`, which an interface does satisfy. The existing cast then compiles:
  ```ts
  const post = (path: string, body: BodyInit, headers: Record<string, string> = {}, e: object = env) =>
    handle(new Request(`https://api.test${path}`, { method: 'POST', headers, body }), e as typeof env, tenantFor, io)
  const checkout = (headers: Record<string, string>, e?: object) => post('/billing/checkout', '', headers, e)
  ```
  I also checked that `{ ...env, [k]: undefined }` spreads the real bindings, including `MASTER` and `TENANT`: a pool probe passed.

**B2. Adding `upgrade` to `HELP` breaks `cli/test/bundle.test.ts:43`, which the plan doesn't list.** CONFIRMED
- Plan: Task 4 Steps 4 and 6 (lines 1597-1600 and 1725) add the `upgrade` line after `rotate --admin --yes`. The files list (line 1532) names only `cli.test.ts`.
- Code: `cli/test/bundle.test.ts:43` asserts that the built binary's help output ends on that line: `/^solenoid keeps an agent …[^]*rotate --admin --yes {48}revoke the admin key and every spend key\n$/`.
- What breaks: Task 4 Step 7 (`cd cli && pnpm test`, "PASS") fails on the bundle test. It is excluded only under `STRYKER`.
- Fix: add `cli/test/bundle.test.ts` to Task 4, and end its regex on the new last line, for example `…revoke the admin key and every spend key\n  upgrade +\S[^\n]*\n$/`. Don't pin the wording, which is copy.

**B3. `site/` has no `@types/node`, so `astro check` fails on every `node:*` import.** CONFIRMED
- Plan: Task 6 Step 1, lines 1962-1992: the `site/package.json` devDependencies include no `@types/node`. The site imports `node:fs` (`src/lib/sources.ts`, lines 2275-2282), `node:crypto` (`src/pages/docs.astro`, line 2558) and `node:*` in every test. `typecheck` is `astro check`.
- Code: pnpm doesn't hoist `@types/node` to where TypeScript looks. The repository root has no `node_modules/@types`, and `astro/tsconfigs/base.json` adds no Node types.
- Probe: I ran a scratch pnpm workspace with `astro`, `@astrojs/check` and `typescript`, plus one `.ts` file importing `node:fs` and one `.astro` file importing `node:crypto`. `astro check` printed `ts(2307): Cannot find module 'node:fs'` and `ts(2307): Cannot find module 'node:crypto'`, for 2 errors.
- What breaks: Task 6 Step 7 fails. Because lefthook runs `pnpm -r --if-present run typecheck` on every commit, every commit from Task 6 on is blocked.
- Fix: add `"@types/node": "^22.0.0"` to `site/package.json` devDependencies. It also needs ≥22.5 for the `node:sqlite` types that `testing/src/sql.ts` pulls in through `capture-receipt.test.ts`.

**B4. `site/wrangler.jsonc` sets `compatibility_date: "2026-09-30"`, and the lockfile's workerd refuses to start with it.** CONFIRMED for the installed wrangler (4.136.3). SUSPECTED that `site/` resolves the same one.
- Plan:
  - Task 11 Step 2 (line 3760) sets `"compatibility_date": "2026-09-30"`, and the Step 5 probe (line 4002) uses the same date.
  - `startSite()` spawns wrangler with `stdio: 'ignore'` (line 3876).
- Probe: `worker/node_modules/.bin/wrangler dev` over a scratch assets-only config with that date printed `This Worker requires compatibility date "2026-09-30", but the newest date supported by this server binary is "2026-09-28"`, then `The Workers runtime failed to start`. The lockfile holds wrangler 4.123.0 and 4.136.3. pnpm prefers versions already in the lockfile, so `site/`'s `^4.61.1` is expected to resolve to one of them.
- What breaks:
  - `site/test/dist/routes.test.ts` waits 60 s, then throws "wrangler dev did not serve site/dist". The real reason is hidden, because stdio is ignored.
  - The Step 5 trailing-slash probe prints `000`.
  - Task 13's screenshot pass fails the same way.
- Fix:
  - Use a date the pinned workerd supports, such as `"2026-09-01"` (the API Worker uses `2026-08-01`), in both places, and in the serving test's expectation if one is added.
  - Have `startSite()` write wrangler's stderr to a temp log and include the log's tail in its error.
  - The spec's `"<the build date>"` has the same trap. Amend it to "a date the pinned wrangler supports, no later than the build date".

### Major

**M1. Two open Checkouts become two live subscriptions, and the first is orphaned: the customer is double billed with no way to cancel it.** CONFIRMED by reading the plan's code.
- Plan:
  - `billingStart` (lines 1342-1355) returns early only when the stored subscription equals the event's. Otherwise it overwrites `stripe_customer` and `stripe_subscription` and resets `meter_seq` to the head.
  - `billingCheckout` (line 1462) answers 409 only once the tenant is already Pro.
- The path:
  1. A new tenant runs `solenoid upgrade` twice before paying. That is easy to do, for example after closing the first tab.
  2. Each run creates its own Checkout Session with no `customer`, so Stripe makes two customers.
  3. Both sessions get paid. The second `checkout.session.completed` repoints the tenant to `cus_2`/`sub_2`.
- What breaks:
  - `sub_1` keeps charging $29 a month.
  - The billing portal the CLI links to is for `cus_2`, so it doesn't show `sub_1`.
  - `sub_1`'s eventual deletion is ignored, because the subscription doesn't match.
  - The `meter_seq` reset also drops every unreported spend, but that part is in the customer's favour.
  - The restricted key can't cancel subscriptions, so the Worker can't clean up either.
- Fix:
  - Refuse a second subscription while Pro. In `billingStart`, after the no-op check, add `if (this.#meta('plan') === 'pro') return ok({ started: false, duplicate: true })`. The webhook should then `console.error` the tenant and both subscription IDs so Robin can refund. Add a test for it.
  - Stop the second session from being created at all. Pass `expires_at` (now + 30 min, Stripe's minimum) and store `checkout_url` and `checkout_expires` in `meta`. `billingCheckout` then returns the stored URL while it is live, instead of creating a second session.

**M2. The final meter report is timestamped after the subscription ends, so it is likely never billed. The spec understates this, and it is a spec-level fix.** SUSPECTED; Stripe's docs support it strongly.
- Plan: the `customer.subscription.deleted` branch calls `reportUsage(stub, …, Date.now())` (line 1488), and `reportUsage` uses `nowMs` as the event `timestamp` (line 1321). The spec says: "The event `timestamp` is the time of the report … If Stripe has already closed the subscription's last invoice, those spends go unbilled" (site spec, lines 193 and 195).
- Stripe's docs:
  - *Manage billing setup*: "For subscriptions that cancel at the end of the period, the final invoice at the end of the period includes metered usage from the last billing period."
  - *Recording usage*: meter events carry the time they happened, and a timestamp is valid up to 35 days back.
  - The subscription is already over when `deleted` fires, so an event stamped "now" falls after its last period. It isn't billed in any period, whatever the invoice's state. Stripe's one-hour late-usage grace only helps an event whose timestamp is *inside* the period.
- What breaks: every cancellation loses up to a day of overage, not just the late ones. The spec's accepted-risk sentence describes a rarer case than the real one.
- Fix, in the spec and in Task 3:
  - For the final report, stamp the event at `min(now, ended_at − 1 s)`. `ended_at` is on the deleted subscription object. Pass it through `reportUsage(stub, stripe, Math.min(Date.now(), o.ended_at * 1000 - 1000))`.
  - Keep "now" for the daily reports.
  - Pin it in `billing.test.ts` with `deleted()` carrying `ended_at`.
  - Amend the spec's cancellation bullet to match.

**M3. Task 16 can't show that a meter report bills anything, and its "$0 tier works" check passes whatever the tiers are.** CONFIRMED by reading the code; the API facts are from Stripe's docs.
- Plan:
  - Task 16 Step 3 (line 4725) reads `invoices/create_preview` "shows the metered line at $0.00: the $0 graduated tier works".
  - Steps 4 and 5 check `event_summaries` sums.
  - Cancellations use `stripe delete /v1/subscriptions/<id>`.
- Reasons:
  - At Step 3 no meter event has been sent yet: reports happen only from the daily alarm or at cancellation. The preview shows $0.00 at zero usage for any tier table.
  - `event_summaries` sums every event for the customer on the meter. It doesn't tie usage to a subscription or an invoice.
  - `DELETE /v1/subscriptions` defaults to `invoice_now=false` (Stripe's *Cancel a subscription*: "Will generate a final invoice that invoices for any un-invoiced metered usage … Defaults to false"). So the test cancellations never produce a metered invoice line.
  - `event_summaries` requires `start_time` and `end_time` "aligned with minute boundaries". "An hour ago" and "now" will be refused unless they are rounded.
- What breaks: the step records the $0 tier and the price-to-meter link as proven when neither was tested.
- Fix: in Task 16 Step 3, after the three spends, send one event by hand:
  ```
  stripe post /v1/billing/meter_events -d event_name=spends -d "payload[stripe_customer_id]=<cus>" -d "payload[value]=3000000" -d identifier=tier-probe-1
  ```
  Then run `create_preview` and expect the metered line at **$10.00**: 1M past the 2M $0 tier, at $0.00001 each. Round the summary window to whole minutes, and allow a minute for aggregation.

**M4. `openUrl`'s failure branch can't happen in real Node, the test fakes it, and the zero-survivor claim fails.** CONFIRMED
- Plan: `openUrl` (lines 1705-1715) returns `false` only when `spawn` throws. The test at lines 1651-1657 makes the mocked `spawn` throw synchronously. `upgrade` picks between two lines with `openUrl(url) ? … : …` (line 1741). Step 8 (line 1757) expects "zero survivors in … `openUrl`'s `catch`".
- Probe: `node -e` with `spawn('definitely-not-a-binary-xyz')` printed `spawn returned without throwing`, then `async error event: ENOENT`. With no `xdg-open`, `openUrl` returns `true`, and the CLI says "opening Stripe Checkout in your browser".
- Mutants: both lines print the URL, and the tests assert only the URL, the exit code and stderr. So `catch { return false }` → `true` survives, and so does either constant replacing the ternary.
- Fix: drop the boolean so there is no branch left. `openUrl(url): void` tries the spawn, ignores the error event and swallows a synchronous throw. `upgrade` always prints one line: "opening Stripe Checkout in your browser. if it does not open, go to:", then the URL. The "no browser" test then checks the case that matters: a throwing `spawn` still prints the URL and exits 0. That also kills the try/catch-removal mutant.

**M5. Decision 7's wall-clock arming makes alarms fire in a loop whenever a test's frozen ledger clock sits just before a due time.** CONFIRMED by tracing the code. SUSPECTED that it causes flaky tests.
- Plan: `#arm` sets `Date.now() + due - this.now()` (lines 768-772), and `alarm()` re-arms after running (lines 757-760). Tests freeze `this.now()` with `setNow`.
- Trace:
  - In Task 2's "does nothing when it fires before the prune is due" (lines 629-636), `setNow(T0 + DAY - 1)` is followed by `runDurableObjectAlarm`. `pruneIfDue` does nothing, and `#arm` sets the alarm to wall clock + 1 ms.
  - That alarm fires by itself, again does nothing, and re-arms at +1 ms. It keeps going until the test ends or the clock moves.
  - `worker/test/recovery.test.ts:65-74` gets the same loop. There, `setNow(T0 + DAY)` makes the next due `T0 + DAY + 1`.
  - These background runs prune concurrently with the test's steps. They also keep running in a DO whose test has finished, in the suite Stryker runs thousands of times.
- Fix: put a floor under the re-arm from `alarm()`.
  ```ts
  async alarm() { …; await this.#arm(60_000) }
  async #arm(floor = 0) { const due = this.#tenant.nextDue(); if (due !== null) await this.ctx.storage.setAlarm(Date.now() + Math.max(due - this.now(), floor)) }
  ```
  In production this only matters when an alarm fires early, and a minute is harmless there. No planned assertion changes: the floor applies only after an alarm run, and every `near()` check that follows one expects an hour or more.

**M6. After the rename, the `history` remote still fetches from `robinslange/solenoid`, which becomes the public repository.** CONFIRMED
- Plan: Task 19 Step 4 (lines 4811-4812) runs `git remote rename origin history` and `git remote set-url --push history DISABLED`. The spec's step 5 has the same wording (line 314).
- Code: `git remote -v` prints `origin git@github.com:robinslange/solenoid.git`. `gh repo rename` moves the repository, but the local URL keeps the old name, and the new public repository takes that name.
- What breaks: a later `git fetch --all` or `git fetch history` force-updates `history/main` from the public repository, so the local ref to the full history is overwritten. The plan's claim that "The old history is then reachable only as `history/main`" stops being true.
- Fix: in Step 4, before disabling push, add `git remote set-url history git@github.com:robinslange/solenoid-history.git`. Then check that `git ls-remote history main` returns the archived head.

**M7. Everything committed after launch goes to the public repository with no scrub, and Task 21 records Robin's live billing IDs.** CONFIRMED by reading the plan.
- Plan:
  - Task 19 (line 4821) says: "From here every commit goes to the public repository."
  - Tasks 20, 21, 22 and 24 commit and push `…go-live.record.md` (lines 4880-4882, 4904, 4951).
  - Task 21 Step 7 records "the live IDs". Step 6 has Robin upgrade "a real account of his" and pay.
- What breaks:
  - Robin's live `cus_…`/`sub_…`, and possibly his tenant ID (a scrubbed pattern), go public.
  - Task 18's scrub check never runs again.
- Fix:
  - Before every commit after Task 19, run `node scripts/scrub-check.mjs` with the five spec patterns plus `cus_` and `sub_`.
  - Keep live IDs in the 1Password item, not in the record. Record only that each one exists.

### Minor

- **m1. Task 3 Step 8 names mutants that must reach zero survivors, and several of them will survive.** CONFIRMED by reading the code (plan line 1517).
  - **`tenantIn`**: equivalent. With it mutated to pass anything, `completed('nope')` reaches `billingStart` on an empty DO, which no-ops on `!meta('tenant')`.
  - **`billingStart`'s `!this.#meta('tenant')` guard**: survives. No test sends a well-formed tenant ID that doesn't exist.
  - **`billingEnd`'s plan check**: equivalent. Ending a tenant that is already free changes nothing.
  - **`meterDue`'s plan check**: survives. "stops the meter job…" (lines 1233-1243) has no spend, so the value is 0 either way.
  - **`verifySignature`'s `^` and `$` anchors**: survive. `t=12x` only fails because the MAC is signed over `T`. With the `$` anchor removed, `Number('12x')` is NaN, and `NaN > 300` is false.
  - Fixes:
    - Add `completed('zzzzzzzzzzzz')` and expect no `plan` meta and no mail.
    - Spend once before flipping the plan to free in "stops the meter job", and expect `meterCalls()` to be `[]`.
    - Sign one header over `12x.{}` with `t=12x`, and expect `false`.
    - Record `tenantIn` and `billingEnd`'s plan check under Robin's redundant-guard ruling.
- **m2. `meterCommit` can move `meter_seq` backwards.** CONFIRMED by reading the code; the three-way race is SUSPECTED to be rare.
  - Plan: lines 1380-1386 set `meter_seq = to` unconditionally and delete `meter_to`.
  - The race needs three reports to interleave. Report A's slow commit `X` lands after C has already committed `Y > X`. The next range then starts at `X` under a new identifier, and `X..Y` is billed twice.
  - Fix: `if (to > Number(this.#meta('meter_seq'))) this.#setMeta('meter_seq', String(to))`, and delete `meter_to` only when it equals `to`.
- **m3. Code rows written before the deploy never get a `next_prune`.** CONFIRMED by reading the code.
  - `#codeRowWritten` (lines 718-720) runs only on new writes. Existing tenants that never do another code operation keep their rows.
  - Yet the privacy page says "About one day, removed by a scheduled job" (line 3564).
  - Fix: in the `TenantDO` constructor, `blockConcurrencyWhile` the check. If code rows exist and `next_prune` doesn't, set it and arm the alarm. Alternatively, qualify the privacy row.
- **m4. `sdk/README.md:166` is left wrong after Task 4.** CONFIRMED
  - It says "a 5xx other than `email_failed`, throws `Outage`". Task 5 fixes the same sentence in `llms.txt:80` (plan line 1847), but not this one.
  - `checkout()` also ships as a public SDK method that no doc mentions.
  - Fix: change line 166 to say "other than `email_failed` and `billing_unavailable`", and add `checkout()` to the Errors row or to a short Billing note.
- **m5. The canary workflow goes live in Task 19, but its secret only arrives in Task 22.** CONFIRMED by reading the plan (line 4654).
  - The scheduled run fails every 30 minutes, and GitHub emails Robin each time, through three STOPs.
  - Fix: commit `.github/workflows/canary.yml` in Task 22, or skip the run when `SOLENOID_CANARY_KEY` is empty.
- **m6. `e2e/test/setup.ts` has no fetch guard, although the Global Constraints (line 26) say every package's setup refuses non-local fetches.** CONFIRMED
  - The file only checks that the API is local.
  - Task 14's `alert()` test is safe only because it injects `fetch`.
  - Fix: copy the SDK's guard into it.
- **m7. Task 1 Step 5 runs its `git grep … "src/testing'"` check before the `units.test.ts` edit.** CONFIRMED
  - The check expects no output, but `sdk/test/units.test.ts:165` (`import('../src/testing')`) still matches.
  - Fix: move the grep after that edit.
- **m8. `.superpowers/` is already in `.gitignore`, at line 9.** CONFIRMED
  - Task 12's "keeps brainstorm … out" test (lines 4088-4090) can't fail.
  - Step 3 (line 4206) would add the line a second time.
  - Fix: drop both.
- **m9. Task 20 Step 5 pipes help through `head -3`, which can't show the command list it expects to include `upgrade`.** CONFIRMED (lines 4853-4856)
  - `upgrade` is about line 17 of the help output.
  - Fix: use `| grep -c '^  upgrade'` and expect `1`.
- **m10. The screenshot pass loads production Umami.** CONFIRMED by reading the code.
  - The layout's `analytics.omit.nz` script (line 2438) runs in Playwright, which records the review visits.
  - Fix: `await page.route('https://analytics.omit.nz/**', (r) => r.abort())`.
- **m11. The Pi canary's pnpm version is not pinned.** SUSPECTED
  - Line 4897 runs `corepack enable && pnpm install --frozen-lockfile` with no `packageManager` field, so corepack picks its default pnpm, not 12.4.2.
  - An older pnpm ignores `allowBuilds`, and the esbuild step may not run.
  - Fix: run `corepack prepare pnpm@12.4.2 --activate` first, or add `"packageManager": "pnpm@12.4.2"` at the root.
- **m12. The webhook trusts any completed session on the Stripe account.** CONFIRMED by reading the code.
  - Lines 1472-1476 don't check `o.mode === 'subscription'` or `o.payment_status === 'paid'`.
  - A completed payment-mode session on the same "omit" account, with a `client_reference_id` that happens to be a valid tenant, stores a null `stripe_subscription`. That breaks the `v TEXT NOT NULL` constraint, and the webhook answers 500, which Stripe retries for 3 days.
  - The old live endpoint (`~/dev/solenoid.systems/api/billing/src/routes/hooks.ts:57-70`) will receive the new events too. It acks them, because `customer_email` is null.
  - Fix: filter on mode and payment status. In Task 21, list the live `webhook_endpoints` and disable the old one.
- **m13. The Global Constraints' build-order rule (line 38) leaves out `site`.**
  - `astro check` reads `@solenoid.systems/sdk` types from `sdk/dist`, just as `cli`, `mcp` and `e2e` do.
- **m14. Some secrets pass through process arguments.**
  - `op item edit … "DEMO_ADMIN_KEY[concealed]=$(…)"` (line 3089), `"STRIPE_TEST_SECRET_KEY[concealed]=$K"` (line 145), and `--api-key "$(op read …)"` (lines 4870-4872) all put a secret in argv, where `ps` can see it.
  - It is low risk on a single-user Mac. `stripe login --live` avoids the setup-key dance entirely.
- **m15. Two billing settings are left to defaults.**
  - `stripeClient` sends no `Stripe-Version`, so the account default decides payload shapes. Pin one.
  - A failed renewal leads to `deleted` only if the dashboard's "if all retries fail" setting is "cancel subscription". Confirm that setting in Task 21. Otherwise an unpaid subscription stays Pro.
- **m16. Task 10 Step 6's Order B test returns early (lines 3628-3631), so it passes vacuously in every normal run.**
  - Fix: make `PUBLIC_PRO_OPEN=false pnpm test` a required step of Order B (the test does fail there when the upgrade command still appears), and say plainly that a plain `pnpm test` proves nothing about this path.
- **m17. Task 19 adds the new `origin` as `https://github.com/…` (line 4816), while this machine uses SSH (`git@github.com:`).**
  - The push may prompt for credentials.
  - Fix: use `git@github.com:robinslange/solenoid.git`.

## The three named fallback risks, settled

| Risk | Result |
|---|---|
| Astro importing `sdk/README.md` from outside `site/` | **Works.** I built a scratch Astro 5.18.2 project with `site/src/pages/docs.astro` importing `../../../sdk/README.md`, so `Content` and `getHeadings()` came from the real README. Its heading IDs were `solenoidsystemssdk quickstart … model-calls-atscopellm-and-run … known-bounds`, which match github-slugger and the plan's `readmeSlugs`. `sitemap-0.xml` lists `/docs`, and 404 is left out. The `createMarkdownProcessor` fallback isn't needed. |
| `outboundService` as a function in the Workers pool | **Works** on `@cloudflare/vitest-pool-workers` 0.21.3. A scratch config with `outboundService: () => new Response('refused', { status: 599 })` passed a test asserting 599 for `fetch` from the test itself and from inside `runInDurableObject`. `{ ...env }` also keeps every binding. |
| `public/.well-known` in `dist` | **Copied.** The same build produced `dist/.well-known/security.txt`, `dist/_redirects` and `dist/_headers`. Under `wrangler dev`, `/_redirects` and `/_headers` answer 404, so they aren't served as assets. No `astro:build:done` hook is needed. |
| (Spec step 1) exact rules and trailing slashes | Settled under wrangler 4.136.3 with the date lowered to 2026-09-01. `/probe` → 301, but `/probe/` → **404**, so exact rules don't match a trailing slash and the `/*` companions are needed. `/docs/` → 301 `/docs` (the splat). `/pricing/`, `/pricing.html` and `/pricing/index.html` → 307 `/pricing`. `/?ref=hn` and `/pricing?ref=x` → 200. `/no-such` → 404 page. `/llms.txt` → `text/plain; charset=utf-8`. |

## Billing, privacy and security walk

| Threat | Result |
|---|---|
| Webhook forgery | Holds. The code verifies the HMAC-SHA256 of `t.body` with WebCrypto `verify`, which compares in constant time. It accepts any matching `v1` and allows ±300 s. The `whsec_` string is used as the key, as Stripe's own libraries do. |
| Webhook replay or redelivery | Holds for a redelivered `checkout.session.completed` (Decision 5), including one that arrives after cancellation. A replayed `deleted` event is a no-op once the tenant is free. |
| Double billing through meter reports | Holds for retries: `meter_to` pinning keeps the identifier the same, inside Stripe's window of at least 24 hours. The one opening is m2, where a stale commit moves `meter_seq` back. |
| Double billing through subscriptions | **Open** (M1). |
| A missed meter report | The daily report and its hourly retry hold. At cancellation, the report is likely lost every time (M2). |
| Cancellation | Holds: the portal configuration cancels at period end, and `deleted` returns the tenant to free. An unpaid renewal depends on a dashboard setting (m15). |
| Test and live key confusion | Holds. Test values only ever go into the local `.dev.vars`. Live values reach production only in Task 21, and the webhook secret is set per mode. A one-line prefix check (`rk_live_`) before `secret put` would make it explicit. |
| Tests reaching production | The Worker suite is covered by the `outboundService` refusal, which I verified. `sdk`, `cli`, `mcp`, `testing` and `site` have setup guards. `e2e` has none (m6). Screenshots load Umami (m10). |
| The salted hash | Correct: the first 16 hex of `HMAC(MASTER, "ip:" + ipKey)` in the Worker, the unit test and the e2e test. Old rows stay unsalted, as the spec accepts. |
| Pruning | Holds for new rows. Pre-existing rows are never scheduled (m3). There is a test-only alarm loop (M5). |
| Secrets in logs | The Worker logs Stripe status and path, never bodies or keys. The canary logs no key. Some secrets pass through argv (m14). |
| Scrub completeness | Before launch, the five patterns, gitleaks and a read by hand cover the tree I searched: no other hits for private IPs, employers or `op://` beyond the vault name. After launch nothing is scrubbed (M7). |
| The squashed snapshot | The orphan commit takes the index only, which is right. The `history` fetch URL is wrong (M6). Commit authors use `users.noreply.github.com`, which I checked. |

## Claims checked

| Plan claim | Result |
|---|---|
| `worker/src/core.ts:19` holds the `Sql` type with `one()`, and only `sdk/src/testing.ts` implements it | Holds. `git grep` finds no caller of `one()` on `Sql`. The DO cursor still satisfies the narrower type. |
| `router.ts:22` and `auth-routes.ts:68` call `perIp`, and `keys.ts:17` holds the private `hmacMatches` | Holds, all three. |
| `hmacHex(key, msg)` exists in `keys.ts` | Holds. |
| Helpers `ADMIN`, `setNow`, `tenant`, `Stub`, `limit`, `setBillable`, `spend`, `u` | Hold (`worker/test/helpers.ts`). |
| `runDurableObjectAlarm` deletes the alarm, then calls `instance.alarm()` inside the DO | Holds (`test-internal.mjs:128-136`). |
| Worker suite baseline | 17 files and 292 tests passed. |
| `vitest.config.mts` already pins `RESEND_API_KEY: ''` | Holds. |
| The prune and billing test traces (codes, events, `next_prune`, `armedFor`, identifiers `from-to`) | Hold against the plan's code, including the Checkout attach code that also sets `next_prune` at T0. Traced by hand. |
| The `sdk/test` and `cli`/`mcp` testing imports named in Task 1 Step 5 | Hold, all 11. `units.test.ts:162-170` is the `node:sqlite` block. |
| `testing.test.ts` exercises `setNow`, `outage`, `mailDown` and `outbox`, so the testing package's own Stryker run can kill those mutants | Holds (lines 27-102). |
| MUTATION-SUMMARY survivors #1-8 and #25-28 are the `testing.ts` rows | Holds. |
| Worker and SDK sources compile under Astro's `verbatimModuleSyntax` | Holds: a scratch tsc run was clean. |
| `sdk/src/http.ts:18` is the 5xx line; `authT` and `sendEmailCode` are at `index.ts:132-133` | Hold. |
| `formatError` produces `solenoid: <code> (<status>). <explain>` | Holds (`commands.ts:151-164`), so the 503 regex matches. |
| `readCreds` without credentials names `solenoid init <scope>` | Holds (`config.ts`). |
| The `HELP` pin in `cli.test.ts` and the "no upgrade yet" test at `:91` | Hold. There is a third pin at `bundle.test.ts:43` (B2). |
| `sdk/README.md:9`, `:374`, and `llms.txt:3, 21, 48, 80, 83` hold the quoted text | Hold. `README.md:166` is left over (m4). |
| README headings slug as the single-source check expects | Holds: 15 headings, none inside fences, all match. |
| The README's prose passes the house-style lint | Holds. The only `--` sits in an `href` and in table rules. |
| The old site files named in Task 6 Step 4 exist: five woff2 files, the `@fontsource` LICENSE files with "SIL OPEN FONT LICENSE Version 1.1", `design-tokens.ts` exporting `colors`, the pixi files | Hold. The `[DIAG]` lines are single-line, so the `sed` delete is safe. The Umami website ID matches the old layout. |
| `initFieldIfNeeded(canvas)` and `initTitleIfNeeded(canvas, text)` | Hold. |
| The old-path fixture: 94 sitemap URLs and more than 200 paths | 94 from the sitemap, 76 public files, 187 dist files without `/_astro`, 22 page routes and 4 extras, 303 in all after dedup. Every one ends at a new page or a redirect rule (simulated against the plan's `_redirects`). |
| The old site Worker is named `solenoid-systems` and declares both custom domains | Holds, so the rollback target applies. |
| The FSL template has `${year}` and `${licensor name}`, and starts with the heading the test expects | Holds (fetched). |
| Astro keeps the race lines' spaces | Holds (scratch build). |
| `.superpowers/` still needs adding to `.gitignore` | Doesn't hold (m8). |
| `site/package.json` has what `astro check` needs | Doesn't hold (B3). |
| `compatibility_date: "2026-09-30"` runs under `wrangler dev` | Doesn't hold with the lockfile's wrangler (B4). |
| Stripe: Checkout subscription mode with a metered price and no quantity, `subscription_data[metadata]`, `client_reference_id`, the portal `configuration`, the meter (`by_id`, `sum`, `value_settings`), a graduated price with `unit_amount_decimal`, and meter events (`event_name`, `payload[...]`, `identifier` of at most 100 characters that stays unique for at least 24 hours, `timestamp` up to 35 days back and 5 minutes ahead) | Hold against the API reference. |
| Stripe: the final report and `invoice_now` | Doesn't hold as the spec assumes (M2, M3). `event_summaries` needs minute-aligned times (M3). |
| Cloudflare: one alarm per DO, which `setAlarm` replaces; `_redirects` applies before assets; `html_handling` redirects with 307 | Hold, the last two by probe. |
| Every Robin stop the spec requires: steps 4, 5, 6, 7 and 9 | All present, in Tasks 18, 19, 20, 21 and 23, and kept in order under Order B. |
| Decisions 1-16 against the spec | They refine it. Decision 4 extends the privacy row consistently. Decision 7's formula is right for production but loops in tests (M5). Decision 14 is sound; it has the pre-secret noise (m5) and the unpinned Pi pnpm (m11). Decision 16 proves delivery, not billing (M3). |

## Commands run

- `git log --oneline -3` printed HEAD `9dcf329 plan: Plan 3a, go live`. `git status --short` was empty before and after the review.
- `vitest run` in `worker/` printed 17 files and 292 tests passed.
- The `outboundService` probe, a scratch config on the worker root: 2 files and 2 tests passed. Outbound fetch got 599 from the test and from the DO, and `{...env}` kept `MASTER` and `TENANT`.
- A scratch `tsc` run of `e: Record<string, unknown> = env` printed TS2322 (B1).
- `node -e` with `spawn` on a missing binary printed "spawn returned without throwing", then "async error event: ENOENT" (M4).
- `npx astro build` of a scratch Astro 5.18.2 project built `docs.html` from `../../../sdk/README.md` with the slugs listed above. Its `dist` held `.well-known/security.txt`, `_redirects` and `_headers`. `cmp` of `llms.txt` against the source printed "llms-bytes-equal".
- `wrangler dev` 4.136.3 with the date 2026-09-30 printed "newest date supported by this server binary is 2026-09-28" (B4). With 2026-09-01 it gave the status table above.
- A scratch pnpm workspace without `@types/node` ran `astro check` and printed 2× TS2307 (B3).
- A scratch `tsc` run with `verbatimModuleSyntax` over `sdk/src/index.ts` and `sdk/src/testing.ts` was clean.
- A GET of `https://solenoid.systems/sitemap-0.xml` returned 94 URLs, and the fixture simulation left no path unmatched.
- A GET of `https://fsl.software/FSL-1.1-ALv2.template.md` showed its placeholders.
- GETs of Stripe docs: meter-event create, manage-billing-setup, recording-usage-api, meter-event-summary list and subscriptions cancel.
- `git remote -v` printed `origin git@github.com:robinslange/solenoid.git`. The domain of `git config user.email` is `users.noreply.github.com`.
- Versions: `pnpm --version` 12.4.2, `lockfileVersion: '9.0'`, `node` v26.8.2.
- `cut -d= -f1 worker/.dev.vars` printed `stale`. I read the names only.

## Deferred contradictions

- **The hero scope `support-bot` (Decision 12).** If the Task 9 gate renames it, Decision 12 changes Global Constraints and Task 9's test. Two more places still read `support-bot`:
  - Task 10's `pages-content.test.ts` (line 3452).
  - Task 5's product `README.md` (line 1891), which is graded *before* the hero.

  The tasks that collide are 5, 9 and 10. Settle it before Task 5: either grade the scope with the hero first, or have Task 9's rename list include all four places.
- **The race line format.** It is Task 7's code and Task 9's copy. The plan does handle it: re-record and re-hash. It is noted here only because Task 7's committed `race.json` goes stale the moment Task 9's gate edits `lineFor`.
- **The three fallbacks are no longer open:** Astro Markdown outside `site/`, `outboundService`, and the `.well-known` copy (see above). Remove the "say which one you used" branches, so an implementer isn't asked to decide something already settled.

## Not checked

- **Stryker scores.** I didn't run `mutate` in any package. m1 comes from reading the code.
- **The plan's new code, end to end.** I didn't apply or run it. Each verdict comes from reading the code, except the probes listed above.
- **Which wrangler `site/` actually resolves.** `pnpm install` in the real workspace would settle B4's scope.
- **Stripe's meter attribution at cancellation.** I didn't run it live. A Stripe test clock would settle M2: subscribe, report with timestamp=now after `deleted`, and inspect the final invoice.
- **The restricted-key editor's granularity**, the account's activation state and the failed-payment setting. They need the dashboard (Task 0 and m15).
- **The vitest-pool-workers behaviour when a looping alarm outlives its test.** M5's flakiness is inferred.
- **`pnpm/action-setup@v4` with pnpm 12.4.2**, the Pi environment, the Umami host, and the npm org.
- **The FSL and MIT texts' legal adequacy.** That is the lawyer glance.

## Re-review (round 2)

Scoped re-review of fix wave 5128266 against the plan at that commit. The reviewer did not write the plan or the fix wave. Read-only: nothing was run that writes; Stripe and GitHub docs were read with GETs.

### Verdict

**EXECUTE AFTER FIXES.** 25 ADDRESSED, 2 PARTLY (M1, m5), 0 NOT ADDRESSED, m14 deferred for a sound reason. No blocker. The changed interfaces agree across every task: no name, arity, type or ordering mismatch that breaks a build. Five new Important findings, four of them on the M1 duplicate-refund path or its surroundings. Settle them before Task 3 (N2, N3), Task 14 (N5), Task 16 (N1) and Task 21 (N4).

### Verdicts on round 1

| # | Verdict | Where the plan shows it |
|---|---|---|
| B1 | ADDRESSED | `e: object = env` and `checkout(headers, e?: object)`, plan 1052-1054 |
| B2 | ADDRESSED | Task 4 files (1770) and the new regex (1840-1843). Nit: the regex sits at `cli/test/bundle.test.ts:42`, not `:43` |
| B3 | ADDRESSED | `"@types/node": "^22.5.0"` in `site/package.json`, 2215 |
| B4 | ADDRESSED | `wrangler` pinned `4.136.3` (2221), `compatibility_date` `2026-09-01` (3921, 4001), `startSite` logs wrangler's tail (4104-4135), Decision 20. The self-review contradicts it (N6) |
| M1 | PARTLY | Open-session reuse (1537-1553, 1688), Pro refusal (1560), cancel and refund (1499-1503, 1707-1711), tests (1120-1136, 1223-1252). The path is never exercised against real Stripe (N1). One of its six permissions does not exist under that name (N2), and the marker says `refunded` when nothing was refunded (N3) |
| M2 | ADDRESSED | `Math.min(Date.now(), o.ended_at * 1000 - 1000)` (1725), two tests (1284-1308), Decision 18, spec bullet amended |
| M3 | ADDRESSED | The hand-sent 3,000,000 event and the $10.00 preview (4987), minute-aligned window (4989). Sequencing nits in N13 |
| M4 | ADDRESSED | `openUrl` waits for `spawn` or `error` (1934-1944), with a real `true` opener and a real missing binary (1880-1888). Its mutation claims are off (N9), and a synchronous throw loses the URL (N10) |
| M5 | ADDRESSED | `alarmAt` (787, 822), the parking `setNow` and `armedFor` (556-568), Decision 7. No production path reaches it (see "Asked questions") |
| M6 | ADDRESSED | `git remote set-url history …solenoid-history.git`, then `ls-remote` and `rev-parse` (5074-5078, 5086) |
| M7 | ADDRESSED | Global Constraints 32, Decision 21, lefthook `scrub` (4457-4461), Task 18 Step 1 (5034), Task 21 Steps 3 and 7 (5140, 5146). Hook gaps in N12, test-mode IDs in N14 |
| m1 | ADDRESSED | `completed('zzzzzzzzzzzz')` (1275, 1279), spend before the flip (1420), `${T}x` and `x${T}` signed (934-937), equivalents recorded (1755) |
| m2 | ADDRESSED | `meterCommit` guards (1605-1606) and the test (1390-1401) |
| m3 | ADDRESSED | `schedulePrune` (754-758), constructor `blockConcurrencyWhile` (794-796), the eviction test (644-654). `evictDurableObject` exists in vitest-pool-workers 0.21.3 |
| m4 | ADDRESSED | `sdk/README.md:166` and the `checkout()` note (2071-2072) |
| m5 | PARTLY | `if: env.SOLENOID_CANARY_KEY != ''` reads an `env` that is set on the same step (4909-4913). See N5 |
| m6 | ADDRESSED | The guard is added to `e2e/test/setup.ts` in Task 7 (2961-2970). Every e2e host is `127.0.0.1` (`e2e/global-setup.ts:22,47`) |
| m7 | ADDRESSED | The `git grep` now follows the `units.test.ts` edit (430-449) |
| m8 | ADDRESSED | The test and the second `.gitignore` line are dropped. The finding's premise was wrong, though (N8) |
| m9 | ADDRESSED | `grep -c '^  upgrade'`, expect `1` (5119-5122) |
| m10 | ADDRESSED | `page.route('https://analytics.omit.nz/**', …abort())` (4741) |
| m11 | ADDRESSED | `corepack prepare pnpm@12.4.2 --activate` (5165) |
| m12 | ADDRESSED | The mode and payment-status filter (1702), a test (1264-1272), and the old endpoint disabled (5141). That disable step is too broad (N4) |
| m13 | ADDRESSED | Global Constraints 39 names `site` |
| m14 | DEFERRED, reason sound | 5256. A single-user Mac and a one-command window, so the risk is small. A cheaper fix than the plan implies exists: `STRIPE_API_KEY="$(op read …)" stripe …` moves the key out of argv with no new tooling |
| m15 | ADDRESSED | `STRIPE_VERSION = '2026-08-26.dahlia'` (1447, 1472) exists (the Dahlia changelog's 26 August 2026 release), and the dunning setting is checked (5142) |
| m16 | ADDRESSED | `PUBLIC_PRO_OPEN=false pnpm test` is a required step (3869-3873) |
| m17 | ADDRESSED | `git@github.com:robinslange/solenoid.git` (5082) |

The round-1 deferred contradictions: the `support-bot` rename now lists all four places (3649). No "say which one you used" fallback branch is left.

### Interface trace

Every use of each changed name was traced through the Interfaces blocks, the code, the tests and the commands.

| Name | Uses traced | Result |
|---|---|---|
| `alarmAt` | 551, 562, 787, 822, Decision 7 | Consistent: `(due: number) => number`, identity by default, set only by the test helper |
| `schedulePrune(): boolean` | 549, 754, 795 | Consistent |
| `ALARM_PARK_MS`, `armedFor(stub)` | 552, 558-567, 600, 612, and eight uses in `billing.test.ts` | Consistent. Every `armedFor` stub went through `setNow` first, and each is re-armed after its last `setNow`, so the ledger-clock read-back holds |
| `setNow` (worker helper) | 556-563, prune-alarm and billing tests, and the existing `recovery.test.ts` and `tenant-settle.test.ts` | Same signature. The existing callers only gain parking |
| `CheckoutSession`, `Stripe.checkout(tenant, customer, nowMs)` | 867-868, 1454-1456, 1480-1493, 971, 1689 | Consistent: ms `expires` from `expires_at * 1000` |
| `cancelDuplicate(subscription, invoice)` | 868, 1459, 1499, 982-994, 1709 | Consistent |
| `Billing`, `billing(auth)` | 874-875, 1531, 1537-1542, 1684-1688, 1723-1724 | Consistent |
| `checkoutSaved(session, url, expires)` | 876, 1529, 1544, 1632, 1690 | Consistent |
| `billingStart(customer, subscription, session)` → `{ started, duplicate }` | 877, 1529, 1555-1570, 1633, 1706-1713 | Consistent: the argument order matches `o.customer, o.subscription, o.id` |
| `duplicateSettled(subscription)` | 878, 1529, 1573, 1634, 1710 | Consistent |
| Meta keys `checkout_*`, `duplicate:<sub>` | 883, 1117, 1126, 1135, 1246, 1251, 1533, 1540-1549, 1558-1559, 1575 | Consistent |
| `openUrl(url): Promise<boolean>` | 1777, 1934, 1970, Decision 19, self-review 5241 | Consistent: awaited |
| `scrub-check.mjs --from` | 4279, 4333, 4347-4366, 4460, 4468-4475, 5036, Decision 21 | Consistent. The licensing test's string matches the lefthook `run` line byte for byte |

There is no mismatch, only two wording nits:
- Task 2's Interfaces (551) says Task 3 "extends `alarm()` and `#armed`". Task 3 extends `alarm()` and only *uses* `#armed`.
- B2's line reference is `:42`, not `:43`.

### New findings

#### Important

**N1. The duplicate cancel-and-refund path is never run against real Stripe.** CONFIRMED by reading Task 16.
- Plan: Task 16 Steps 3-5 (4975-4991) cover one checkout, the reuse, the portal, two cancellations and the tiers, but not the duplicate. `stripe.test.ts` and `billing.test.ts` mock every Stripe answer.
- Three things are unverified and all meet at the first real double payment:
  - N2's permissions.
  - Whether a subscription-mode `checkout.session.completed` carries `invoice`. The API reference says only "ID of the invoice created by the Checkout Session, if it exists".
  - The `invoice_payments` shape under the pinned version.
- What breaks: a production failure answers 500, and Stripe retries it for three days while the customer stays charged twice. In the worst case the refund is silently skipped (N3).
- Fix: add a Task 16 step while the tenant is Pro.
  1. Open a second session by hand with the Worker's parameters: `stripe post /v1/checkout/sessions -d mode=subscription -d "line_items[0][price]=<pro>" -d "line_items[0][quantity]=1" -d "line_items[1][price]=<spends>" -d client_reference_id=<tenant> -d "subscription_data[metadata][tenant]=<tenant>" -d success_url=https://solenoid.systems/pricing`.
  2. Robin pays it.
  3. Expect the webhook to answer 200, the new subscription to be `canceled`, a refund on its PaymentIntent, and `duplicate:<sub>` = `refunded` in the local DO's `meta`.

**N2. "Refunds: Write" is not a Stripe permission.** CONFIRMED against Stripe's permissions reference (`docs.stripe.com/stripe-apps/reference/permissions`). SUSPECTED that the dashboard's restricted-key editor uses the same resource names.
- Plan: Decision 17 (89), Task 0 Step 2 (150), runbook text (2043).
- Stripe's names:
  - Refunds sit under **"Charges and Refunds"** (`charge_read`/`charge_write`). Write there also allows creating, capturing and updating charges.
  - The other five exist: Checkout Sessions, Customer Portal, Billing Meter Events, Subscriptions and Invoices.
  - `GET /v1/invoice_payments` has no permission row of its own. Whether Invoices: Read covers it is unverified.
- What breaks: Task 0's first branch ("allows exactly these six") can't be taken as written. The runbook understates the key's power.
- Fix:
  - Name the resource "Charges and Refunds: Write" in all three places.
  - Say in the runbook that it also permits creating charges.
  - Let N1's step confirm that Invoices: Read admits `/v1/invoice_payments`. A restricted key's 403 names the missing permission.

**N3. `duplicate:<sub>` is set to `refunded` even when no refund was issued.** SUSPECTED; it depends on N1's `invoice` question.
- Plan: `cancelDuplicate` (1499-1503) skips the refund when `invoice` is null, when `data[0]` has no `payment.payment_intent` (for example `payment.type: 'charge'`), or when `data` is empty. The webhook then calls `duplicateSettled` (1710) regardless. The stripe test pins the skip as intended (991-996).
- Code: the webhook only reaches this path for `payment_status === 'paid'` (1702). A missing payment therefore means the lookup failed, not that nothing was paid.
- What breaks: a double-charged customer is marked settled, with no refund and no log beyond the "cancelling and refunding" line.
- Fix:
  - Take the invoice from the subscription you already GET (`latest_invoice`) when `o.invoice` is null.
  - Pass `status: 'paid'` to `invoice_payments`.
  - Throw when no PaymentIntent is found, so the webhook answers 500 and retries loudly.
  - Change the "skips … the refund when nothing was paid" test to expect a rejection.

**N4. Task 21 Step 3 disables every live webhook endpoint whose URL is not Solenoid's new one.** SUSPECTED; it depends on what else the account serves.
- Plan: 5141, "The old stack's endpoint (whatever URL is not `https://api.solenoid.systems/billing/stripe`) … disable it".
- Code: the account is the business account "omit" (Task 0, 147), not a Solenoid-only account.
- What breaks: any other product's webhook on the same account is disabled during launch.
- Fix: identify the old endpoint by its known URL (the old API's billing hook in the read-only `~/dev/solenoid.systems` tree), list all endpoints, and disable only that one.

**N5. m5's skip condition probably never sees the secret.** SUSPECTED.
- Plan: 4909-4913 sets `SOLENOID_CANARY_KEY` in the step's own `env:` and tests `env.SOLENOID_CANARY_KEY` in that step's `if:`.
- GitHub's workflow-syntax docs ("Example: Using secrets") put the secret in **job-level** `env:` for exactly this pattern, and step-level `env` is widely reported as not visible in the same step's `if`.
- What breaks: the step is skipped forever and every run is green. Task 22 Step 2 would catch it, because the log won't end `ok github-us`, but the fix is then a workflow commit to the public repository mid-launch.
- Fix: move `SOLENOID_CANARY_KEY: ${{ secrets.SOLENOID_CANARY_KEY }}` to `jobs.canary.env`, and keep only `CANARY_REGION` on the step.

#### Minor

**N6. The self-review contradicts the fix wave.** CONFIRMED.
- Plan line 5247 says "the spec keeps that wording [`<the build date>`] and Decision 20 records the deviation" and "the ruling allowed one spec line".
- The spec diff in 5128266 changes that line to `"2026-09-01"`, and Decision 20 (92) says "The spec now says `2026-09-01` too". Two spec lines changed.
- Fix: rewrite 5247 to say the spec was amended.

**N7. The spec and the privacy row fall behind Decision 17.** CONFIRMED.
- The spec's "The key's scope" still names three permissions. Its webhook bullet doesn't mention the duplicate refusal. Its privacy row (spec 222; plan 3809) says the Worker stores "the two IDs".
- The tenant DO now also keeps `checkout_session`/`checkout_url`/`checkout_expires`, which are never cleared when a session expires unused, and a `duplicate:<sub>` row for life.
- Fix: amend the spec as was done for M2, or record it as a deviation the way Decision 20 does. Update the privacy row's wording.

**N8. m8's premise was wrong.** CONFIRMED.
- The root `.gitignore` has seven lines and no `.superpowers/`.
- `git check-ignore -v` shows the directory is ignored by nested `.superpowers/brainstorm/.gitignore:1:*` (and the same in `sdd/`).
- The spec's step 1 (spec 297) lists "`.superpowers/` added to `.gitignore`", and plan 4269 cites "line 9". A future `.superpowers/<new>/` without its own `.gitignore` would be committable.
- Fix: put the one `.gitignore` line back into Task 12 Step 3 (without the vacuous test), and correct 4269.

**N9. Task 4's mutation claims don't hold for `openUrl`.** CONFIRMED by reading the code.
- Every test sets `BROWSER`, so the `process.env.BROWSER ?` → `true` mutant survives. Line 1986's "zero survivors in … the `BROWSER` choice" is unattainable.
- The `→ false` mutant runs `open https://checkout.stripe.test/c/1` on macOS during Stryker. It is killed, but only after opening real browser tabs, so 1921's "no test opens a real browser" is false under mutation.
- Fix: `// Stryker disable next-line ConditionalExpression`, with the reason recorded as not reachable by design.

**N10. A synchronous `spawn` throw inside `openUrl`'s Promise executor rejects the promise.** SUSPECTED; it is rare.
- `upgrade` then exits 1 without printing the Checkout URL, which is what Review Focus 5 guards against.
- Fix: `try { … } catch { done(false) }` around the spawn.

**N11. The five-minute reuse boundary mutant (`>` → `>=`) is killed only when the test's `Date.now()` equals the DO's.** SUSPECTED.
- workerd's clock advances on I/O, so the kill is timing-dependent, while 1755 claims zero survivors.
- Fix: `setNow(stub, T)` and write `checkout_expires = T + 5 * 60_000` exactly.

**N12. The scrub hook greps the working tree, not the commit.** SUSPECTED; low likelihood.
- `git grep` without `--cached`:
  - A pattern in an *unstaged* tracked file blocks unrelated commits.
  - A staged pattern that is reverted in the working tree passes.
- A `.scrub-patterns` holding only comments exits 2 and blocks every commit.
- Fix: add `--cached` to the `git grep` in `scrub-check.mjs`.

**N13. Task 16's sequencing.**
- Step 3 checks "Before paying, `upgrade` run a second time printed the same Checkout URL", but its command block runs `upgrade` once and the check list follows payment. Put the second `upgrade` in the block before Robin pays.
- Step 5 recomputes `S = now − 3600`. If more than an hour passed since Step 3's hand-sent event, the sum isn't 3,000,005. Fix `S` once at Step 3.

**N14. Test-mode Stripe IDs are never scrub patterns.** CONFIRMED by reading.
- Task 16 creates them before `.scrub-patterns` exists. Task 18 writes only the spec's five patterns.
- Global Constraints 32 covers test IDs, but nothing enforces it for the Task 16 and 17 commits or the public snapshot.
- Fix: in Task 18 Step 1, append the `STRIPE_TEST_*` IDs from 1Password to `.scrub-patterns`.

**N15. The refund's idempotency key lives about 24 hours; Stripe retries a webhook for up to three days.** SUSPECTED; money-safe.
- If the refund lands but `duplicateSettled` fails, a redelivery after the key expires gets Stripe's already-refunded error and answers 500 on every retry.
- Fix: treat `charge_already_refunded` as done.

### Asked questions

- **M1's Stripe calls, against the current docs.**
  - `DELETE /v1/subscriptions/{id}` cancels immediately, and the GET before it avoids an error on a subscription that is already cancelled.
  - `GET /v1/invoice_payments?invoice=` exists (`invoice` is optional), and its `payment: { type: 'payment_intent', payment_intent }` matches the mocks.
  - `POST /v1/refunds` with `payment_intent` and an `Idempotency-Key` header is valid.
  - `2026-08-26.dahlia` is a real version. None of Dahlia's breaking changes touch these endpoints; the Checkout one changes the `ui_mode` enum, which the Worker doesn't send.
  - Open: whether a subscription-mode session populates `invoice` (N1, N3).
- **Can production call `setNow` or reach the parked behaviour?** No. CONFIRMED.
  - `setNow` exists only in `worker/test/helpers.ts:25`, and nothing in `worker/src` assigns `now` or `alarmAt`.
  - RPC can't assign a DO field, and the default is the identity function.
  - Production can't tight-loop instead. `#prune` deletes with `<=` (`worker/src/core.ts:311-312`), so `#reschedulePrune` always lands after `now`.
- **The lefthook scrub.**
  - With `.scrub-patterns` missing, `test ! -f` succeeds and the scrub doesn't run.
  - It can block a legitimate commit in the N12 cases: an unstaged pattern, or a pattern file with only comments. Otherwise a hit is a real hit, since any tracked file carrying a pattern is meant to block.
- **The six permissions.** Five exist under those names. "Refunds" is "Charges and Refunds" (N2).

### Checked, and holds

Beyond the trace above:
- Every new billing test traced by hand against the plan's code: reuse, forget-on-complete, duplicate once, retry after failure, the `ended_at` stamp both ways, `meterCommit` ordering, the paid-subscription filter, `zzzzzzzzzzzz`.
- The parking arithmetic in `armedFor` across every `setNow` sequence in the prune and billing tests.
- `evictDurableObject` exists (vitest-pool-workers 0.21.3 types).
- `Io` is re-exported from `router.ts:13`.
- `spendKey`, `adminKey`, `TENANT_RE`, `verifyKey`, `normalizeEmail`, `codeMail`, `INTERNAL`, `DAY_MS` and `HOUR_MS` exist.
- `worker/node_modules/.bin/wrangler --version` prints `4.136.3`, and the lockfile holds it.
- The CLI test harness runs in process, so `vi.stubEnv('BROWSER', …)` reaches `openUrl`.
- The e2e hosts are all `127.0.0.1`.

### Not checked

- The dashboard restricted-key editor's labels, and which permission admits `/v1/invoice_payments`. N1's step settles both.
- Whether subscription-mode sessions carry `invoice`. N1's step settles it.
- GitHub's step-level `env` in its own `if`. One `workflow_dispatch` run settles it.
- No suite or Stryker run. Every verdict comes from reading, plus the doc fetches.
