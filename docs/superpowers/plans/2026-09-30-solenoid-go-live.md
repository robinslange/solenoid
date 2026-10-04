# Solenoid Plan 3a: Go Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the last code the product needs (the testing-package split, the privacy fixes, Stripe billing and `solenoid upgrade`), build the new solenoid.systems site, then open the repository, publish to npm, go live on Stripe and cut the site over.

**Architecture:**
- **Billing.** One Worker endpoint, `POST /billing/checkout`, creates a Stripe Checkout Session with the $29 price and the metered overage price. `POST /billing/stripe` is the webhook. The plan lives in `meta.plan`, which `#checkPlan` already reads. A daily TenantDO alarm reports billable spends to a Stripe Billing Meter by ledger `seq` range.
- **One alarm, two jobs.** `core.ts` writes due times (`meta.next_prune`, `meta.next_meter`) and runs the jobs. `TenantDO` owns `setAlarm` and arms it for the earliest due time. `testServer()` has no alarm, so pruning stays lazy there.
- **The site** is `site/`, an Astro 5 and Tailwind 3 package, served by an assets-only Worker named `solenoid-systems`, with `_redirects` and `_headers`. `/llms.txt`, `/llms-full.txt` and `/docs` are built from `sdk/llms.txt` and `sdk/README.md`. The race demo replays `site/src/data/race.json`, written by `e2e/record-race.ts`. The receipt section shows a production receipt saved in `site/src/data/receipt.json`.
- **Launch** is controller-run, in the spec's order, with a stop for Robin at each step the spec names.

**Tech Stack:**
- TypeScript on Cloudflare Workers, a SQLite-backed Durable Object, `@cloudflare/vitest-pool-workers`.
- The SDK, CLI, MCP and `@solenoid.systems/testing` on Node, tested with vitest against `testServer()`; esbuild bundles; Stryker per package.
- Stripe's REST API over plain `fetch` (form-encoded), webhook signatures checked with WebCrypto.
- Astro 5, Tailwind 3, `@astrojs/sitemap`, `@tailwindcss/typography`, pixi.js, Shiki (built into Astro), parse5, github-slugger, Playwright (on demand only), wrangler.

**Spec:** `docs/superpowers/specs/2026-09-29-solenoid-site-design.md` is binding. It amends `docs/superpowers/specs/2026-09-24-solenoid-governance-design.md` (where they differ, the site spec wins for billing, the site and launch). The copy brief is `docs/copy/brief.md`, updated in Task 5. The spec's two cold reviews are `docs/superpowers/specs/2026-09-29-solenoid-site-design.review.md`. The execution record is `docs/superpowers/plans/2026-09-30-solenoid-go-live.record.md`, started in Task 0.

## Global Constraints

**Standing rules for every implementer and the controller**
- Work only in `~/dev/solenoid`. `~/dev/solenoid.systems` (branch `main`) is read-only: copy files out of it and list its tree, never edit, build or commit there.
- Never edit `~/.claude`, `~/.cache` or `~/.config/solenoid`.
- Tests never call `api.solenoid.systems`, `solenoid.systems` or any host but `127.0.0.1`. Every package's `test/setup.ts` refuses any other fetch; `testing/`, `site/` and `e2e/` copy that guard (Tasks 1, 6 and 7). The Worker suite refuses outbound fetch through `outboundService` (Task 3).
- Run `unset SOLENOID_KEY SOLENOID_API` in every shell before any command.
- Commit through lefthook. Never `--no-verify`. No attribution lines, co-author tags or session links in commits or anywhere else.
- `pnpm -r build` drops the exec bit on `cli/dist/solenoid.mjs`. After any `pnpm -r build`, run `chmod +x cli/dist/solenoid.mjs`.
- No em dash (U+2014) or en dash (U+2013) in any user-facing string, and no `--` in prose (flags inside code are fine). No "X, not Y" constructions, and no tricolons built for rhythm. One action per call to action (brief, Guardrails).
- Stripe is test mode only until Robin says yes in Task 21. Until then the production API Worker holds no Stripe value, and no live Stripe object is created.
- Stripe object IDs, test or live (customers, subscriptions, prices, meters, portal configurations, webhook endpoints), never enter the repository. They live as Worker secrets and in the 1Password item "Solenoid Worker secrets"; the execution record says only that each one exists. From Task 18 on, lefthook's scrub check (Task 12) refuses a commit that contains any pattern in the git-ignored `.scrub-patterns`.

**Repository and packages**
- `pnpm-workspace.yaml` becomes `packages: [worker, testing, sdk, cli, mcp, e2e, site]`. `contract/` stays a plain directory with no `package.json`, imported by relative path.
- Zero runtime dependencies in `worker`, `testing`, `sdk`, `cli` and `mcp`. The CLI and MCP bundle the SDK with esbuild.
- Worker TypeScript keeps Plan 2's rules: `"lib": ["ES2022"]`, values that cross RPC are `type`s with `Record<string, any>`, DO RPC methods return `Result` objects and never throw across RPC, private members use `#private`.
- The tests in `sdk/`, `cli/`, `mcp/` and `testing/` import the test server as `../../testing/src/index`, by relative path, because in-place Stryker relies on relative imports (`docs/testing/MUTATION-SUMMARY.md`).
- Build order: after any SDK change, run `pnpm --filter @solenoid.systems/sdk build` before typechecking `cli`, `mcp`, `e2e` or `site`, which read the SDK's types from `sdk/dist`.
- `node file.ts` (the race recorder, the canary) needs Node 23.6 or later for type stripping. This machine runs Node 26.

**Licensing (spec, Licensing)**
- `FSL-1.1-ALv2`: `worker/`, `testing/`, `e2e/`, `docs/superpowers/`. MIT: `sdk/`, `cli/`, `mcp/`, `contract/`, `site/`, the rest of `docs/`, root files. SIL OFL 1.1: `site/public/fonts/`.
- The SPDX identifier is `FSL-1.1-ALv2` everywhere. The licensor is "Robin Lange, trading as omit". The Worker is "source-available" and never "open source".

**Product facts the copy and tests use (spec and brief, verbatim)**
- Free: 100,000 spends each UTC calendar month. Pro: $29 USD a month including 2M spends, then $10 USD per extra million. Prices are USD, shown as they are: no GST, Stripe Tax off.
- The metered price has graduated tiers on the `spends` Billing Meter: 0 to 2,000,000 at $0, then 0.001 cents per spend (`unit_amount_decimal` `0.001`).
- Refund terms: cancel anytime. Pro runs to the end of the paid month, with no partial refunds, and overage is billed as used.
- The hero command is `npx @solenoid.systems/cli init <scope>`, run in the project's root, with the literal scope `support-bot` (Decision 12). The agent prompt sends the agent to `solenoid.systems/llms.txt` and says the spend key is in `.env` as `SOLENOID_KEY`.
- Tokens: `#101012`, `#E4E4E7`, `#FF3F00`. `LAUNCH_TAG = "launch"`. The GitHub repository is `https://github.com/robinslange/solenoid`.
- Banned in copy: any latency figure, "at the edge", "would have prevented", "open source", customer or usage numbers, named competitor comparisons, a claim that a visit is tied to a signup. The race copy says "spends". Model spend appears only as "keep your gateway for that".

**Tests and mutation**
- Mock only at the boundary: Stripe's HTTP API, Resend (the `Mailer`), the OS browser opener, the OS home directory, and `fetch` in SDK unit tests. Never mock a Solenoid module.
- Frozen copy: tests match only URLs, command names (`solenoid upgrade`, `solenoid email`, `init`), flags, error codes, numbers and file paths inside reader-facing strings. A copy gate may change any other wording. If a copy fix changes a string a test matches, update the test and re-run the task's suite and its mutation gate.
- Mutation runs use the package's own script: `cd <pkg> && pnpm run mutate --force`. Never `pnpm exec stryker run`. Gates carried from Plans 1 and 2: Stryker `thresholds: { high: 95, low: 90, break: 90 }`; zero surviving mutants on any path that rejects or limits something; every other survivor recorded as equivalent, with its reason, in `docs/testing/MUTATION-SUMMARY.md`; redundant defensive guards stay in the code (Robin's ruling). `site/` and `e2e/` have no Stryker run.

**The copy gate, split between implementer and controller**
- The implementer cannot dispatch subagents. For every copy unit the implementer drafts the text against `docs/copy/brief.md`, commits the code around it only if the task says so, and leaves the copy files uncommitted with a list of the units and where each renders.
- The controller runs the gate for each unit: three cold `copy-grader` runs dispatched in one message as plain subagents (`subagent_type: copy-grader`, never a `name`), each with the draft pasted inline between `<<<` and `>>>`, plus one line each for the medium, the jurisdiction (New Zealand) and whether the unit is a closing unit. Save the reports as `run1.md`, `run2.md`, `run3.md` in a fresh scratchpad directory and run `python3 ~/.claude/skills/copy-chief/scripts/tally.py run1.md run2.md run3.md`. If the draft cites any source (an incident URL, a test file, a Stripe or license page), dispatch `copy-source-checker` once; any DOES NOT SUPPORT or UNRESOLVABLE joins Gate 0.
- The controller hands Gate 0 and the findings to the implementer, who fixes every Gate 0 item and fixes every finding or accepts it with a written reason. The controller re-gates until Gate 0 is clear. The implementer then commits the copy together with its grade file.
- Grade files: `docs/copy/grades/site-<unit>.md` for site units; the task names the file for the others.
- Closing units are the hero, the pricing strip, the bottom call to action and `/pricing` (spec, Copy process). Every other unit is graded as a non-closing unit. The hero, the bottom call to action and the agent prompt are graded against the exact command `npx @solenoid.systems/cli init support-bot`.
- To paste a built page's text into a grader, use `node site/scripts/unit-text.mjs site/dist/<page>.html [#section-id]` (Task 6).

**Controller-run tasks**
- Tasks marked **CONTROLLER-RUN** are never dispatched to an implementer. They touch production, secrets or Robin's accounts. Secrets come from 1Password (vault Personal, item "Solenoid Worker secrets") and go straight into the command that needs them: `op read '…' | tr -d '\n' | pnpm exec wrangler secret put NAME`. Never print a secret.
- A line **STOP FOR ROBIN** ends the work until Robin replies. The spec names five: after the scrub (step 4), after opening the repository (step 5), after npm publish (step 6), after Stripe live mode (step 7) and after closing the old deploy path (step 9).

## Decisions this plan makes (argued from the spec)

1. **Task 0 runs first and is read-only.** Launch step 0 reads Stripe's activation state "before any other step", and the spec says "the first task of Plan 3a" checks the restricted key's scope. Both are dashboard reads with no code, so they come before the code tasks.
2. **Both billing routes need all five Stripe values.** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_SPENDS` and `STRIPE_PORTAL_CONFIG` are Worker secrets. Missing any one, `/billing/checkout` answers `503 billing_unavailable`, and `/billing/stripe` answers the same before it reads the body. One rule covers both routes (spec, Billing and N7).
3. **A fifth secret, the portal configuration.** The Worker passes `configuration=<bpc_…>` to every billing portal session. The configuration is created through the API in each mode with cancellation at period end, which is what the refund terms promise ("Pro runs to the end of the paid month"). The account's default portal settings would otherwise decide that.
4. **The subscription carries the tenant.** Checkout sets `client_reference_id` and `subscription_data[metadata][tenant]` to the tenant ID. `customer.subscription.deleted` carries only the subscription, and the Worker has no index from customer to tenant (no D1, no KV). The privacy page's Stripe row says the tenant ID is stored as the Checkout's `client_reference_id` and on the subscription (Task 10).
5. **A redelivered completion changes nothing.** `billingStart` is a no-op when the stored `stripe_subscription` already equals the event's. It sends no second code email and does not reset `meter_seq`, which would drop unbilled spends.
6. **A report in flight is pinned.** `meterDue()` stores `meta.meter_to` before the report is sent and reuses it until `meterCommit(to)` succeeds. A report that failed, or timed out after Stripe recorded it, is retried with the same range and the same identifier, `<tenant>:<from seq>-<to seq>`, covering `seq` in (from, to]. The alarm retries a failed report after an hour, inside Stripe's uniqueness window of at least 24 hours. A successful report schedules the next one a day later.
7. **The alarm is armed at the due time, and a test parks it.** `TenantDO` arms `setAlarm(this.alarmAt(due))`, where `alarmAt` is `(due) => due` in production. There the ledger clock is `Date.now()`, so the alarm fires exactly when the job falls due, with no floor and no offset. The Worker tests freeze the ledger clock with `setNow`, and a frozen clock just short of a due time would re-arm the alarm a moment ahead on the wall clock forever (review M5). So `setNow` also sets `alarmAt` to park the alarm a year ahead on the wall clock, keeping its offset from the ledger clock so `armedFor` can read it back. A parked alarm never fires on its own; the tests run it with `runDurableObjectAlarm`. The review's other fix, a 60-second floor on every re-arm, was not taken: it would change when production reports and prunes after an early firing. `alarmAt` is a public field, like the existing `now`, and nothing but the test helper sets it.
8. **Checkout and the portal return to `https://solenoid.systems/pricing`.** The CLI's `upgrade` output says what happens next, so the landing page needs no success state.
9. **`upgrade` exit codes.** `409 already_pro` prints the portal URL on stdout and exits 0. `503 billing_unavailable` is explained on stderr and exits 1, like every other refusal.
10. **The testing package drops dead code.** `one()` in `sqlOver` and in the `Sql` type is never called (`MUTATION-SUMMARY.md`, testing.ts:34 to 36), so it goes. The rollback path gets a direct test. The two recorded equivalents keep `// Stryker disable next-line` comments with their reasons, so the package's own run can meet `break: 90`.
11. **Docs are graded once.** The testing split (Task 1) and Pro (Tasks 3 and 4) both change `sdk/README.md` and `sdk/llms.txt`. Task 5 makes every docs change and runs one gate. Nothing is published before Task 20, so the interim wording costs nothing.
12. **The hero's scope is `support-bot`.** The brief's reader has "just given a support agent tools that send email and issue refunds". The name is graded with the hero and may change in the gate; if it does, every place in Global Constraints and Task 9's test that names it changes with it.
13. **Site task order.** The suggested order put redirects and the route test before the pages. The route test asserts a final 200 for every fixture path, and the fixture holds `/pricing/` and `/privacy/`, so it can only pass once the pages exist. The pages therefore come first (Tasks 9 and 10), then serving and the route test (Task 11), then the licenses (Task 12, because the footer links `LICENSING.md`), then the link check and the house-style lint (Task 13). `/llms.txt`, `/llms-full.txt` and `/docs` land with the scaffold (Task 6), with their single-source check.
14. **The canary** is `e2e/canary.ts`: one spend at `canary/<region>` with a spend key for the canary tenant, then `verify()` of its receipt. It runs from GitHub Actions (US runners) every 30 minutes and from a second host in Auckland every 30 minutes. A failed GitHub run emails Robin through GitHub; the Auckland run emails through Resend. It lives in `e2e/` (FSL) because it drives the production Worker end to end.
15. **The scrub check holds no personal data.** `scripts/scrub-check.mjs` takes its patterns as arguments; the patterns live in the spec's step 4, which the scrub itself then rewrites.
16. **Step 2 proves two reports without waiting a day.** It subscribes, spends, cancels (final report 1), subscribes again, spends, cancels (final report 2). The daily alarm path is proven in the Worker suite with `runDurableObjectAlarm`. This avoids a test-only interval knob in production code. The tiers themselves are proven by one hand-sent event of 3,000,000 spends, which must price at $10.00 on the invoice preview (review M3).
17. **One subscription per account.** Before Pro, the Worker hands back the tenant's open Checkout Session (`checkout_session`, `checkout_url`, `checkout_expires` in `meta`) while it has more than five minutes left, and opens a new one, valid for an hour, only once that one has expired or completed. A race can still open two, so the webhook refuses a second subscription while the tenant is Pro: it cancels the newcomer at once, marks it `duplicate:<id>` so a redelivery does nothing, logs it, and mails a notice to security@solenoid.systems naming the tenant, the subscription and the session. Email Routing forwards that address to Robin (Task 15), who refunds the payment by hand in the dashboard. The Worker issues no refund (Robin's ruling, round 2), so the restricted key needs only one permission beyond the spec's three: Subscriptions: Write, to read and cancel the newcomer. A failed notice is logged and never fails the webhook.
18. **The final report lands inside the last period.** At cancellation the meter event is stamped `min(now, ended_at - 1 s)`: an event stamped after the subscription ended falls in no billing period (review M2). The daily reports keep "now". The spec's cancellation bullet is amended to match.
19. **The browser opener is honest.** `openUrl` waits for the child's `spawn` or `error` event and says which happened, so `upgrade` says "opening" only when an opener started. It runs `$BROWSER` when that is set, the usual convention on Linux, which is also what lets the tests use a real opener (`true`) and a real missing binary without mocking `child_process`.
20. **The site's wrangler is pinned.** `site/` pins `wrangler` to `4.136.3`, the version `worker/` already resolves from the lockfile, and `site/wrangler.jsonc` uses `compatibility_date` `2026-09-01`, a date its workerd supports. The spec now says `2026-09-01` too. A build date would be later than the newest date that workerd accepts (2026-09-28), and would stop `wrangler dev` and `wrangler deploy` from starting.
21. **The scrub keeps running after launch.** `scripts/scrub-check.mjs --from .scrub-patterns` runs in lefthook's pre-commit whenever that git-ignored file exists. Task 18 writes it with the spec's five patterns, and Task 21 appends each live Stripe ID, so the patterns themselves never enter the repository.

## Review Focus

1. **Stripe redelivers or reorders webhooks, or a customer pays twice.** A second `checkout.session.completed` for the same subscription, including one that arrives after cancellation, must change nothing: no second code email, no reset of `meter_seq`, no return to Pro. A completion for a second subscription while the account is Pro cancels it and mails security@ once, and a failed notice still answers 200. Task 3, Step 1 ("treats a redelivered completion…", "ignores a completion redelivered after cancellation…", "refuses a second subscription while Pro…", "still answers 200 when the duplicate notice cannot be sent"); against real Stripe, Task 16, Step 4.
2. **A meter report fails or times out after Stripe recorded it.** The retry must reuse the same range and identifier, so the spends are billed once. A failed final report on cancellation answers 500 and leaves the tenant on Pro, so Stripe retries the webhook. Task 3, Step 1.
3. **A reader copies the hero exactly.** The hero, the bottom call to action and `/pricing` show the same `npx @solenoid.systems/cli init support-bot`, and the agent prompt names `https://solenoid.systems/llms.txt`, `.env` and `SOLENOID_KEY`, and never tells the agent to run `init`. Task 9, Step 1.
4. **Old URLs in the forms people hold.** A trailing slash (`/philosophy/`), an `index.html` form (`/pricing/index.html`), a query string (`/?ref=hn`, `/pricing?ref=launch`) and a `.md` mirror each end at 200 within two redirects, and a `?ref=` page answers 200 directly. Task 11, Step 1.
5. **`solenoid upgrade` on a machine with no browser.** Over SSH or in a container the opener fails; the Checkout URL still prints and the command exits 0. Task 4, Step 4.

## Tasks

| # | Task | Kind |
|---|---|---|
| 0 | Stripe read-only checks | CONTROLLER-RUN |
| 1 | Split `@solenoid.systems/testing` out of the SDK | code |
| 2 | Worker privacy: salted network hash, code rows pruned by alarm | code |
| 3 | Worker billing: checkout, webhook, meter reports | code |
| 4 | SDK `checkout()` and CLI `upgrade` | code + copy |
| 5 | Docs: the brief, the SDK README and llms.txt, the testing README, the product README, the runbook | copy |
| 6 | Site scaffold, `/docs`, `/llms.txt`, `/llms-full.txt` | code |
| 7 | The race recorder and `RaceTerminal` | code |
| 8 | Receipt capture and the `verifyChain` test | code + CONTROLLER-RUN step |
| 9 | The landing page | code + copy |
| 10 | `/pricing`, `/why`, `/privacy`, `/404` | code + copy |
| 11 | Serving: `wrangler.jsonc`, `_headers`, `_redirects`, the old-path fixture, the route test | code |
| 12 | Licenses, `LICENSING.md`, package metadata, `SECURITY.md`, the scrub check | code |
| 13 | Site checks: links, house style, screenshots | code |
| 14 | The production canary | code |
| 15 | Launch step 1, remainder: Email Routing and the step-1 checklist | CONTROLLER-RUN |
| 16 | Launch step 2: Stripe in test mode | CONTROLLER-RUN |
| 17 | Launch step 3: deploy the API Worker | CONTROLLER-RUN |
| 18 | Launch step 4: prepare the public tree | CONTROLLER-RUN, STOP |
| 19 | Launch step 5: open the repository | CONTROLLER-RUN, STOP |
| 20 | Launch step 6: publish to npm | CONTROLLER-RUN, STOP |
| 21 | Launch step 7: Stripe in live mode | CONTROLLER-RUN, STOP |
| 22 | Launch step 8: the canary from two regions | CONTROLLER-RUN |
| 23 | Launch step 9: close the old deploy path | CONTROLLER-RUN, STOP |
| 24 | Launch step 10: site cutover | CONTROLLER-RUN |

Tasks 0 to 14 are launch step 1 ("All Plan 3a code lands"). Order B (Task 0) moves Tasks 23 and 24 ahead of Task 21; Task 21 says how.

---

### Task 0: Stripe read-only checks (CONTROLLER-RUN)

Spec: Launch order step 0; Billing, "The key's scope". Nothing here writes to Stripe except the test-mode restricted key, which step 2 needs. Robin's hands are needed at the dashboard; this is not a stop.

**Files:**
- Create: `docs/superpowers/plans/2026-09-30-solenoid-go-live.record.md`

- [ ] **Step 1: Read the activation state.** Ask Robin to open the Stripe dashboard in live mode. If the home page offers "Activate payments" or Settings → Business shows unfinished details, the account is not activated. Record exactly what it shows.
  - **Activated:** Order A. Steps run 1 to 10 as written.
  - **Not activated:** Robin starts activation under the business name "omit" with the website `omit.nz`.
    - If Stripe accepts `omit.nz`: Order A. Activation must be complete before Task 21.
    - If Stripe insists on the product's own site: Order B. The site cutover (Task 24) runs before live mode (Task 21), and `/pricing` ships a "Pro opens soon" version first (Task 10, Step 6).

- [ ] **Step 2: Check the restricted key's scope.** Robin opens Developers → API keys → Create restricted key, in test mode, and sets Checkout Sessions: Write; Customer portal (billing portal sessions): Write; Billing meter events: Write; and, for Decision 17's duplicate cancellation, Subscriptions: Write; every other resource: None.
  - **The editor allows exactly these four:** Robin creates it as "solenoid-worker (test)" and stores it without printing it: `read -rs K && op item edit 'Solenoid Worker secrets' "STRIPE_TEST_SECRET_KEY[concealed]=$K"; unset K`. Record "scoped to the four permissions".
  - **The editor forces more:** Robin creates the narrowest key the editor allows that still covers the four, stores it the same way, and tells the controller the extra permissions. Record them in the record file now; Task 5 writes them into `docs/runbook.md`.

- [ ] **Step 3: Start the record.** Write `docs/superpowers/plans/2026-09-30-solenoid-go-live.record.md`:
```markdown
# Plan 3a execution record

## Task 0 (2026-09-30)
- Stripe activation: <what the dashboard showed>. Order <A|B>.
- Restricted key (test): <scoped to the four permissions | extra permissions: …>. Stored as STRIPE_TEST_SECRET_KEY.
```

- [ ] **Step 4: Commit**
```bash
git add docs/superpowers/plans/2026-09-30-solenoid-go-live.record.md
git commit -m "Record Stripe's activation state and the restricted key's scope"
```

---

### Task 1: Split `@solenoid.systems/testing` out of the SDK

Spec: Licensing, "The test server moves" and "Where its tests go". The SDK's bundle must hold no Worker code.

**Files:**
- Create: `testing/package.json`, `testing/tsconfig.json`, `testing/tsconfig.build.json`, `testing/vitest.config.ts`, `testing/stryker.config.mjs`, `testing/src/sql.ts`, `testing/test/setup.ts`, `testing/test/sql.test.ts`, `testing/test/bundle.test.ts`, `testing/test/units.test.ts`
- Move: `sdk/src/testing.ts` → `testing/src/index.ts`; `sdk/test/testing.test.ts` → `testing/test/testing.test.ts`
- Delete: `sdk/tsconfig.testing.json`
- Modify:
  - `sdk/package.json` (exports, build script), `sdk/tsconfig.build.json` (drop the exclude)
  - `sdk/test/bundle.test.ts`, `sdk/test/units.test.ts` (remove the `node:sqlite` test), and the imports in `sdk/test/{account,client,node,properties}.test.ts`
  - the imports in `cli/test/{bundle.test.ts,cli.test.ts,run.ts}` and `mcp/test/{main,tools}.test.ts`
  - `worker/src/core.ts`: the `Sql` type loses `one()`
  - `pnpm-workspace.yaml`, `docs/testing/MUTATION-SUMMARY.md`

**Interfaces:**
- Produces `@solenoid.systems/testing` (`testing/src/index.ts`), unchanged from today's `sdk/src/testing.ts`: `testServer(): Promise<TestServer>`, `type TestServer = { fetch; api; signup(); setNow(ms); outage(on); outbox(); mailDown(on) }`, `type Mail`.
- Produces `testing/src/sql.ts`: `sqlOver(db: DatabaseSync): Sql`. Not re-exported from the package.
- `worker/src/core.ts`: `export type Sql = { exec(query: string, ...params: unknown[]): { toArray(): Record<string, any>[] }; transactionSync<T>(fn: () => T): T }`.
- Every later task imports the test server as `../../testing/src/index`.

- [ ] **Step 1: Write the failing SDK bundle test.** Replace `sdk/test/bundle.test.ts` with:
```ts
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { beforeAll, expect, it } from 'vitest'
import pkg from '../package.json'

const dist = `${__dirname}/../dist`
beforeAll(() => {
  rmSync(dist, { recursive: true, force: true })
  execSync('pnpm run build', { cwd: `${__dirname}/..`, stdio: 'ignore' })
})

it('builds a single-file bundle with no imports', () => {
  const src = readFileSync(`${dist}/solenoid.mjs`, 'utf8')
  expect(src).not.toMatch(/^\s*import\s/m)
  expect(src).toMatch(/export\s*\{/)
})

it('ships no Worker code: no testing export, no testing bundle, no ledger SQL', () => {
  expect(Object.keys(pkg.exports)).toEqual(['.', './node'])
  expect(existsSync(`${dist}/testing.mjs`)).toBe(false)
  for (const f of ['solenoid.mjs', 'node.mjs']) expect(readFileSync(`${dist}/${f}`, 'utf8')).not.toMatch(/CREATE TABLE|code_events|transactionSync/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sdk && pnpm vitest run test/bundle.test.ts`
Expected: FAIL. `pkg.exports` still has `./testing`, and the build writes `dist/testing.mjs`.

- [ ] **Step 3: Create the package and move the files**
```bash
mkdir -p testing/src testing/test
git mv sdk/src/testing.ts testing/src/index.ts
git mv sdk/test/testing.test.ts testing/test/testing.test.ts
git rm sdk/tsconfig.testing.json
```

`pnpm-workspace.yaml`, first line:
```yaml
packages: [worker, testing, sdk, cli, mcp, e2e]
```

`testing/package.json` (devDependency versions copied from `sdk/package.json`):
```json
{
  "name": "@solenoid.systems/testing",
  "version": "0.1.0",
  "type": "module",
  "license": "FSL-1.1-ALv2",
  "engines": { "node": ">=22.5" },
  "exports": {
    ".": { "types": "./dist/types/testing/src/index.d.ts", "default": "./dist/testing.mjs" }
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --platform=node --outfile=dist/testing.mjs && tsc -p tsconfig.build.json",
    "test": "vitest run",
    "test:changed": "vitest run --changed --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "coverage": "vitest run --coverage",
    "mutate": "STRYKER=1 stryker run"
  },
  "devDependencies": {
    "@stryker-mutator/core": "^10.0.0",
    "@stryker-mutator/vitest-runner": "^10.0.0",
    "@types/node": "^22.0.0",
    "@vitest/coverage-v8": "^4.1.11",
    "esbuild": "^0.24.0",
    "typescript": "^5.6.0",
    "vitest": "^4.1.10"
  }
}
```

`testing/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "lib": ["ES2022", "DOM"], "types": ["node"] }, "include": ["src", "test"] }
```

`testing/tsconfig.build.json`:
```json
{ "extends": "./tsconfig.json", "compilerOptions": { "declaration": true, "emitDeclarationOnly": true, "rootDir": "..", "outDir": "dist/types" }, "include": [], "files": ["src/index.ts"] }
```

`testing/vitest.config.ts`:
```ts
import { configDefaults, defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    testTimeout: 20_000,
    setupFiles: ['test/setup.ts'],
    exclude: [...configDefaults.exclude, ...(process.env.STRYKER ? ['test/bundle.test.ts'] : [])],
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text', 'json-summary'], reportsDirectory: 'reports/coverage' },
  },
})
```

`testing/stryker.config.mjs`:
```js
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.config.ts', related: false },
  mutate: ['src/**/*.ts'],
  coverageAnalysis: 'perTest',
  inPlace: true,
  concurrency: 4,
  timeoutMS: 60000,
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  reporters: ['clear-text', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  thresholds: { high: 95, low: 90, break: 90 },
}
```

`testing/test/setup.ts`, the SDK's guard verbatim:
```ts
delete process.env.SOLENOID_KEY
delete process.env.SOLENOID_API

const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.hostname !== '127.0.0.1') return Promise.reject(new TypeError(`test setup refuses a real fetch to ${url.origin}; only the local shim on 127.0.0.1 is reachable`))
  return realFetch(input, init)
}
```

- [ ] **Step 4: Split the SQL adapter out, and drop the dead `one()`**

`worker/src/core.ts` line 19 becomes:
```ts
export type Sql = { exec(query: string, ...params: unknown[]): { toArray(): Record<string, any>[] }; transactionSync<T>(fn: () => T): T }
```

`testing/src/sql.ts`:
```ts
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { Sql } from '../../worker/src/core'

export function sqlOver(db: DatabaseSync): Sql {
  return {
    exec(query, ...params) {
      const rows = db.prepare(query).all(...(params as SQLInputValue[]))
      return { toArray: () => rows }
    },
    transactionSync(fn) {
      db.exec('BEGIN')
      try {
        const out = fn()
        db.exec('COMMIT')
        return out
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
}
```

`testing/src/index.ts`: delete the `sqlOver` function and the `DatabaseSync, SQLInputValue` type import, import `sqlOver` from `./sql`, and mark the two recorded equivalents. The file becomes:
```ts
import { Tenant, type TenantApi } from '../../worker/src/core'
import type { Mail } from '../../worker/src/mail'
import { handle } from '../../worker/src/router'
import { sqlOver } from './sql'

export type { Mail }

export type TestServer = {
  fetch: typeof fetch
  api: string
  signup(): Promise<{ tenant: string; admin_key: string }>
  setNow(ms: number): void
  outage(on: boolean): void
  outbox(): Promise<Mail[]>
  mailDown(on: boolean): void
}

const API = 'http://solenoid.test'

async function sqlite(): Promise<typeof import('node:sqlite')> {
  try {
    return await import('node:sqlite')
  } catch (cause) {
    throw new Error(`testServer() needs node:sqlite, which Node ships from 22.5 (behind --experimental-sqlite on 22.5 to 22.12 and 23.0 to 23.3). This is Node ${process.version}.`, { cause })
  }
}

export async function testServer(): Promise<TestServer> {
  const { DatabaseSync } = await sqlite()
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const env = { MASTER: crypto.randomUUID(), SIGNING_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)), SIGNING_KID: 'k1' }
  let clock = () => Date.now()
  let down = false
  const tenants = new Map<string, TenantApi>()
  const tenantFor = (name: string): TenantApi => {
    // Stryker disable next-line StringLiteral: SQLite gives an empty filename a private temporary database too, so tenants stay apart (MUTATION-SUMMARY, testing)
    const t = tenants.get(name) ?? new Tenant(sqlOver(new DatabaseSync(':memory:')), env, () => clock())
    tenants.set(name, t)
    return t
  }
  const sent: Mail[] = []
  const pending = new Set<Promise<unknown>>()
  let mailOff = false
  const io = {
    mail: async (m: Mail) => { if (mailOff) throw new Error('mail is down'); sent.push(m) },
    // Stryker disable next-line all: a redundant guard for a mailer that awaits before it records; this one records synchronously (MUTATION-SUMMARY, testing)
    waitUntil: (p: Promise<unknown>) => { pending.add(p); void p.finally(() => pending.delete(p)) },
  }
  const serve = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (down) throw new TypeError('fetch failed')
    return handle(new Request(input, init), env, tenantFor, io)
  }
  return {
    fetch: serve,
    api: API,
    signup: async () => (await serve(`${API}/auth/signup`, { method: 'POST' })).json(),
    setNow: (ms) => { clock = () => ms },
    outage: (on) => { down = on },
    outbox: async () => { await Promise.all(pending); return [...sent] },
    mailDown: (on) => { mailOff = on },
  }
}
```

- [ ] **Step 5: Move the tests and repoint every import**
```bash
sed -i '' "s#'../src/index'#'../../sdk/src/index'#; s#'../src/testing'#'../src/index'#" testing/test/testing.test.ts
sed -i '' "s#'../src/testing'#'../../testing/src/index'#" sdk/test/account.test.ts sdk/test/client.test.ts sdk/test/node.test.ts sdk/test/properties.test.ts
sed -i '' "s#'../../sdk/src/testing'#'../../testing/src/index'#" cli/test/bundle.test.ts cli/test/cli.test.ts cli/test/run.ts mcp/test/main.test.ts mcp/test/tools.test.ts
```

In `sdk/test/units.test.ts`, delete the `describe('testServer() on a Node without node:sqlite', …)` block (lines 162 to 170 today) and any import it alone used. It moves to `testing/test/units.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'

describe('testServer() on a Node without node:sqlite', () => {
  it('says which Node versions ship it, and keeps the import error as the cause', async () => {
    vi.doMock('node:sqlite', () => { throw new Error('No such built-in module: node:sqlite') })
    const { testServer } = await import('../src/index')
    const e = (await testServer().catch((x: unknown) => x)) as Error
    expect(e.message).toBe(`testServer() needs node:sqlite, which Node ships from 22.5 (behind --experimental-sqlite on 22.5 to 22.12 and 23.0 to 23.3). This is Node ${process.version}.`)
    expect(e.cause).toBeInstanceOf(Error)
  })
})
```

Now check that nothing still imports the old path:
```bash
git grep -n "src/testing'" -- sdk cli mcp testing
```
Expected: no output.

`testing/test/sql.test.ts`, which pins the rollback that no ledger path can reach:
```ts
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { sqlOver } from '../src/sql'

it('commits a transaction that returns, and rolls back and rethrows one that throws', () => {
  const sql = sqlOver(new DatabaseSync(':memory:'))
  sql.exec('CREATE TABLE t (v INTEGER)')
  const boom = new Error('boom')
  expect(() => sql.transactionSync(() => { sql.exec('INSERT INTO t VALUES (1)'); throw boom })).toThrow(boom)
  expect(sql.exec('SELECT count(*) AS n FROM t').toArray()).toEqual([{ n: 0 }])
  expect(sql.transactionSync(() => { sql.exec('INSERT INTO t VALUES (?)', 2); return 'done' })).toBe('done')
  expect(sql.exec('SELECT v FROM t').toArray()).toEqual([{ v: 2 }])
})
```

`testing/test/bundle.test.ts`:
```ts
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { beforeAll, expect, it } from 'vitest'
import pkg from '../package.json'

const dist = `${__dirname}/../dist`
beforeAll(() => {
  rmSync(dist, { recursive: true, force: true })
  execSync('pnpm run build', { cwd: `${__dirname}/..`, stdio: 'ignore' })
})

it('builds testing.mjs with the ledger inside it, importing only node:sqlite, at call time', async () => {
  const src = readFileSync(`${dist}/testing.mjs`, 'utf8')
  expect(src).not.toMatch(/^\s*import\s/m)
  expect([...src.matchAll(/import\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1])).toEqual(['node:sqlite'])
  const { testServer } = await import(`${dist}/testing.mjs`)
  const server = await testServer()
  expect((await server.signup()).admin_key).toMatch(/^sk\.admin\./)
})

it('is licensed FSL-1.1-ALv2 and ships its types', () => {
  expect(pkg.license).toBe('FSL-1.1-ALv2')
  expect(existsSync(`${dist}/types/testing/src/index.d.ts`)).toBe(true)
})
```

- [ ] **Step 6: Drop the SDK's third build step**

`sdk/package.json`: remove the `"./testing"` line from `exports`, and the build script becomes:
```json
"build": "esbuild src/index.ts --bundle --format=esm --platform=neutral --outfile=dist/solenoid.mjs && esbuild src/node.ts --bundle --format=esm --platform=node --outfile=dist/node.mjs && tsc -p tsconfig.build.json",
```
`sdk/tsconfig.build.json`:
```json
{ "extends": "./tsconfig.json", "compilerOptions": { "declaration": true, "emitDeclarationOnly": true, "outDir": "dist" }, "include": ["src"] }
```

- [ ] **Step 7: Install and run every affected suite**
```bash
pnpm install
cd sdk && pnpm typecheck && pnpm test && cd ..
cd testing && pnpm typecheck && pnpm test && cd ..
pnpm --filter @solenoid.systems/sdk build
cd cli && pnpm typecheck && pnpm test && cd ..
cd mcp && pnpm typecheck && pnpm test && cd ..
cd worker && pnpm typecheck && pnpm test && cd ..
```
Expected: all PASS. `sdk/test/bundle.test.ts` now passes both tests.

- [ ] **Step 8: Mutation gates**

Run, one at a time: `cd testing && pnpm run mutate --force`, then the same in `sdk`, `cli` and `mcp`.
Expected: each scores at least 90. In `testing` nothing survives: the `':memory:'` and `waitUntil` mutants are disabled with their reasons, `one()` is gone, and `test/sql.test.ts` kills the rollback mutants. If `testing` still scores under 90, stop and report the survivors; do not lower the threshold. `sdk` no longer mutates `testing.ts`. `git status` is clean after each run.

- [ ] **Step 9: Update `docs/testing/MUTATION-SUMMARY.md`**
  - SDK section: the mutated list drops `testing`; state the new mutant count and score from Step 8; move the testing.ts rows of the coverage table and survivors #1 to 8 and #25 to 28 into the new section.
  - Add `## Testing (\`testing/\`)`: `inPlace: true` for the same reason as the SDK (the package imports `../../worker/src/*`, and its tests import `../../sdk/src/index` and `../../contract/scenarios`); `one()` deleted as dead code; the rollback killed by `test/sql.test.ts`; the two disabled lines, each with its reason (the `':memory:'` → `''` equivalence, checked on Node 26, and the redundant `waitUntil` guard, Robin's ruling); the score from Step 8.
  - CLI section: the `inPlace` note now reads `../../testing/src/index`, which imports `../../worker/src/core`.

- [ ] **Step 10: Commit**
```bash
git add pnpm-workspace.yaml pnpm-lock.yaml testing sdk cli/test mcp/test worker/src/core.ts docs/testing/MUTATION-SUMMARY.md
git commit -m "Move the test server into @solenoid.systems/testing so the MIT SDK holds no Worker code"
```

---

### Task 2: Worker privacy: the salted network hash, and code rows pruned by alarm

Spec: Privacy; Billing, "One alarm, two jobs".

**Files:**
- Modify: `worker/src/ops.ts`, `worker/src/router.ts:22`, `worker/src/auth-routes.ts:68`, `worker/src/core.ts`, `worker/src/tenant.ts`, `worker/test/helpers.ts`, `worker/test/signup.test.ts`, `e2e/test/signup-rate-limit.test.ts`, `docs/testing/MUTATION-SUMMARY.md`
- Create: `worker/test/prune-alarm.test.ts`

**Interfaces:**
- Consumes: `hmacHex(key: string, msg: string): Promise<string>` from `worker/src/keys.ts`.
- Produces:
  - `perIp(req: Request, master: string, tenantFor: (name: string) => TenantApi, unit: 'signups' | 'recoveries'): Promise<Response | null>`. The bucket is `(await hmacHex(master, 'ip:' + ipKey(ip))).slice(0, 16)`.
  - On `Tenant`, not RPC: `nextDue(): number | null`, `pruneIfDue(): void` and `schedulePrune(): boolean` (true when it wrote a due time). Private: `#codeRowWritten(now: number)`, `#reschedulePrune()`, `#deleteMeta(k: string)`.
  - Meta key `next_prune`: milliseconds since the epoch, as a string, present while code rows exist.
  - `TenantDO.alarm(): Promise<void>`; the public field `alarmAt: (due: number) => number`, `(due) => due` by default (Decision 7); private `#armed<T>(p: Promise<T>): Promise<T>` and `#arm(): Promise<void>`. Task 3 extends `alarm()` and uses `#armed`.
  - `worker/test/helpers.ts`: `setNow(stub, t)` now also parks the stub's alarms (sets `alarmAt`); new `ALARM_PARK_MS` and `armedFor(stub): Promise<number | null>`, the armed time on the stub's ledger clock. Task 3's tests use both.

- [ ] **Step 1: Write the failing tests**

In `worker/test/helpers.ts`, replace `setNow` and add two exports (Decision 7):
```ts
export const ALARM_PARK_MS = 365 * 24 * 60 * 60_000

export const setNow = (stub: Stub, t: number) => runInDurableObject(stub, (i: TenantDO) => {
  i.now = () => t
  i.alarmAt = (due) => Date.now() + ALARM_PARK_MS + due - t
})

export const armedFor = (stub: Stub) => runInDurableObject(stub, async (i: TenantDO, s: DurableObjectState) => {
  const a = await s.storage.getAlarm()
  return a === null ? null : a - Date.now() - ALARM_PARK_MS + i.now()
})
```
A stub whose clock a test has set never fires an alarm on its own: the alarm sits a year out on the wall clock, and the test runs it with `runDurableObjectAlarm`. `armedFor` reads it back on the ledger clock, so it is valid only for a stub that went through `setNow`.

In `worker/test/signup.test.ts`, add `import { hmacHex } from '../src/keys'` (keep `adminKey` in the same import), add a helper under the imports, and replace the bucketing test:
```ts
const bucket = async (k: string) => (await hmacHex(env.MASTER, `ip:${k}`)).slice(0, 16)

  it('buckets by the first 16 hex of HMAC-SHA256(MASTER, "ip:" + client key), and a missing IP as "unknown"', async () => {
    const ops = await adminKey(env.MASTER, 'solenoidops2', 1)
    await signup('198.51.100.77')
    await signup('2001:db8:1:2::77')
    expect((await SELF.fetch('https://api.test/auth/signup', { method: 'POST' })).status).toBe(201)
    const res = await SELF.fetch('https://api.test/v1/signups', { headers: { authorization: `Bearer ${ops}` } })
    const { children } = (await res.json()) as { children: string[] }
    expect(children).toEqual(expect.arrayContaining([await bucket('198.51.100.77'), await bucket('2001:0db8:0001:0002'), await bucket('unknown')]))
    expect(children).not.toContain((await sha256hex('198.51.100.77')).slice(0, 16))
  })

  it('buckets recoveries by the same salted hash', async () => {
    const ops = await adminKey(env.MASTER, 'solenoidops2', 1)
    await SELF.fetch('https://api.test/auth/recover', { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.81' }, body: JSON.stringify({ tenant: 'abcdefghijkl', email: 'a@b.cd' }) })
    const res = await SELF.fetch('https://api.test/v1/recoveries', { headers: { authorization: `Bearer ${ops}` } })
    expect(((await res.json()) as { children: string[] }).children).toContain(await bucket('198.51.100.81'))
  })
```

`worker/test/prune-alarm.test.ts`:
```ts
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { TenantDO } from '../src/tenant'
import { ADMIN, armedFor, setNow, tenant, type Stub } from './helpers'

const T0 = Date.UTC(2026, 9, 1, 10)
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const EMAIL = 'robin@example.com'

const rows = (stub: Stub) => runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => ({
  nextPrune: (s.storage.sql.exec("SELECT v FROM meta WHERE k = 'next_prune'").toArray()[0]?.v as string | undefined) ?? null,
  codes: s.storage.sql.exec('SELECT count(*) AS n FROM codes').one().n as number,
  events: s.storage.sql.exec('SELECT count(*) AS n FROM code_events').one().n as number,
}))
const state = async (stub: Stub) => ({ ...(await rows(stub)), armedFor: await armedFor(stub) })
const wallAlarm = (stub: Stub) => runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => s.storage.getAlarm())
const near = (actual: number | null, expected: number) => {
  expect(actual).not.toBeNull()
  expect(Math.abs(actual! - expected)).toBeLessThan(5_000)
}

describe('code rows are pruned on time by the alarm', () => {
  it('schedules a prune one day after the first code row, and a later row does not push it back', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    expect(await state(stub)).toEqual({ nextPrune: null, armedFor: null, codes: 0, events: 0 })
    expect((await stub.attachStart(ADMIN, EMAIL)).ok).toBe(true)
    const first = await state(stub)
    expect(first).toMatchObject({ nextPrune: String(T0 + DAY), codes: 1, events: 1 })
    near(first.armedFor, T0 + DAY)
    await setNow(stub, T0 + HOUR)
    await stub.attachStart(ADMIN, EMAIL)
    const second = await state(stub)
    expect(second).toMatchObject({ nextPrune: String(T0 + DAY), codes: 1, events: 2 })
    near(second.armedFor, T0 + DAY)
  })

  it('arms the alarm at the due time itself when the clock is the real one', async () => {
    const stub = await tenant()
    const before = Date.now()
    await stub.attachStart(ADMIN, EMAIL)
    const { nextPrune } = await rows(stub)
    expect(Number(nextPrune)).toBeGreaterThanOrEqual(before + DAY)
    expect(await wallAlarm(stub)).toBe(Number(nextPrune))
  })

  it('schedules a prune for code rows written before the alarm existed, when the object next wakes', async () => {
    const stub = await tenant()
    const at = Date.now()
    await runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => {
      s.storage.sql.exec("INSERT INTO code_events (kind, purpose, email, at) VALUES ('send', 'attach', ?, ?)", EMAIL, at)
    })
    expect((await rows(stub)).nextPrune).toBeNull()
    await evictDurableObject(stub)
    expect((await rows(stub)).nextPrune).toBe(String(at + DAY))
    expect(await wallAlarm(stub)).toBe(at + DAY)
  })

  it('schedules on every kind of code row: a failed redemption and an unmatched recovery request', async () => {
    const failed = await tenant()
    await setNow(failed, T0)
    expect(await failed.attachVerify(ADMIN, EMAIL, '000000', false)).toMatchObject({ ok: false, error: 'invalid_code' })
    expect(await state(failed)).toMatchObject({ nextPrune: String(T0 + DAY), events: 1 })
    const asked = await tenant()
    await setNow(asked, T0)
    expect(await asked.recoverStart(EMAIL)).toEqual({ ok: true, value: { code: null } })
    expect(await state(asked)).toMatchObject({ nextPrune: String(T0 + DAY), events: 1 })
  })

  it('does nothing when it fires before the prune is due', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    await stub.attachStart(ADMIN, EMAIL)
    await setNow(stub, T0 + DAY - 1)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await state(stub)).toMatchObject({ nextPrune: String(T0 + DAY), codes: 1, events: 1 })
  })

  it('prunes what has expired, re-arms for the next row, then stops', async () => {
    const stub = await tenant()
    await setNow(stub, T0)
    await stub.attachStart(ADMIN, EMAIL)
    await setNow(stub, T0 + HOUR)
    await stub.attachStart(ADMIN, EMAIL)
    await setNow(stub, T0 + DAY)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    const mid = await state(stub)
    expect(mid).toMatchObject({ codes: 0, events: 1, nextPrune: String(T0 + HOUR + DAY) })
    near(mid.armedFor, T0 + HOUR + DAY)
    await setNow(stub, T0 + HOUR + DAY)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await state(stub)).toEqual({ nextPrune: null, armedFor: null, codes: 0, events: 0 })
  })
})
```

In `e2e/test/signup-rate-limit.test.ts`, change the import to `import { createHmac } from 'node:crypto'` and the bucket line to:
```ts
  const who = createHmac('sha256', inject('master')).update(`ip:${ip}`).digest('hex').slice(0, 16)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd worker && pnpm vitest run test/signup.test.ts test/prune-alarm.test.ts`
Expected: FAIL. The buckets are the unsalted hashes, `next_prune` is never written, and `runDurableObjectAlarm` returns false because nothing arms an alarm.

- [ ] **Step 3: Salt the hash**

`worker/src/ops.ts`:
```ts
import { INTERNAL } from './auth'
import type { TenantApi } from './core'
import { failResponse, json } from './errors'
import { hmacHex } from './keys'

export const OPS_TENANT = 'solenoidops2'

export function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const [head, tail = ''] = ip.split('::')
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : []
  return [...h, ...Array(8 - h.length - t.length).fill('0'), ...t].slice(0, 4).map((x) => x.padStart(4, '0')).join(':')
}

export async function perIp(req: Request, master: string, tenantFor: (name: string) => TenantApi, unit: 'signups' | 'recoveries'): Promise<Response | null> {
  const ops = tenantFor(OPS_TENANT)
  await ops.init(OPS_TENANT, 'internal')
  const who = (await hmacHex(master, `ip:${ipKey(req.headers.get('cf-connecting-ip') ?? 'unknown')}`)).slice(0, 16)
  const r = await ops.spend(INTERNAL, `${unit}/${who}`, { [unit]: 1_000_000 }, crypto.randomUUID(), '')
  if (r.ok) return null
  return r.status === 402 ? json(429, { error: 'rate_limited' }) : failResponse(r)
}
```
`worker/src/router.ts:22`: `const limited = await perIp(req, env.MASTER, tenantFor, 'signups')`.
`worker/src/auth-routes.ts:68`: `const limited = await perIp(req, master, tenantFor, 'recoveries')`.

- [ ] **Step 4: Due times in the core**

In `worker/src/core.ts`:
- After the `INSERT INTO code_events … 'send'` in `#countSend`, add `this.#codeRowWritten(now)`.
- After the `INSERT INTO codes` in `#storeCode`, add `this.#codeRowWritten(now)`.
- After the `for (let i = 0; i < weight; i++) … 'fail'` loop in `#redeem`, add `this.#codeRowWritten(now)`.
- Add these members to `Tenant`, after `#prune`:
```ts
  nextDue(): number | null {
    const due = this.#meta('next_prune')
    return due === undefined ? null : Number(due)
  }

  pruneIfDue(): void {
    const now = this.#now()
    if (!(Number(this.#meta('next_prune')) <= now)) return
    this.#prune(now)
    this.#reschedulePrune()
  }

  schedulePrune(): boolean {
    if (this.#meta('next_prune') !== undefined) return false
    this.#reschedulePrune()
    return this.#meta('next_prune') !== undefined
  }

  #reschedulePrune(): void {
    const next = this.#rows<{ t: number | null }>('SELECT min(t) AS t FROM (SELECT min(expires) AS t FROM codes UNION ALL SELECT min(at) + ? AS t FROM code_events)', DAY_MS)[0].t
    if (next === null) this.#deleteMeta('next_prune')
    else this.#setMeta('next_prune', String(next))
  }

  #codeRowWritten(now: number): void {
    if (this.#meta('next_prune') === undefined) this.#setMeta('next_prune', String(now + DAY_MS))
  }

  #deleteMeta(k: string): void {
    this.#sql.exec('DELETE FROM meta WHERE k = ?', k)
  }
```
A later write never moves `next_prune` later: once set, it is at most one day after the earliest live row, and the alarm moves it to the next row's expiry. `schedulePrune` covers the code rows that production already holds from before this task: they get a due time the next time their object wakes.

- [ ] **Step 5: TenantDO owns the alarm**

`worker/src/tenant.ts`:
```ts
import { DurableObject } from 'cloudflare:workers'
import { Tenant } from './core'

export type { PutReq, SpendOk, View } from './core'

export class TenantDO extends DurableObject<Cloudflare.Env> {
  now: () => number = () => Date.now()
  alarmAt: (due: number) => number = (due) => due
  #tenant: Tenant

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    const sql = { exec: (q: string, ...p: unknown[]) => ctx.storage.sql.exec(q, ...(p as SqlStorageValue[])), transactionSync: <T>(fn: () => T) => ctx.storage.transactionSync(fn) }
    this.#tenant = new Tenant(sql, env, () => this.now())
    void ctx.blockConcurrencyWhile(async () => {
      if (this.#tenant.schedulePrune()) await this.#arm()
    })
  }

  init(...a: Parameters<Tenant['init']>) { return this.#tenant.init(...a) }
  spend(...a: Parameters<Tenant['spend']>) { return this.#tenant.spend(...a) }
  settle(...a: Parameters<Tenant['settle']>) { return this.#tenant.settle(...a) }
  put(...a: Parameters<Tenant['put']>) { return this.#tenant.put(...a) }
  get(...a: Parameters<Tenant['get']>) { return this.#tenant.get(...a) }
  attachStart(...a: Parameters<Tenant['attachStart']>) { return this.#armed(this.#tenant.attachStart(...a)) }
  attachVerify(...a: Parameters<Tenant['attachVerify']>) { return this.#armed(this.#tenant.attachVerify(...a)) }
  recoverStart(...a: Parameters<Tenant['recoverStart']>) { return this.#armed(this.#tenant.recoverStart(...a)) }
  recoverFinish(...a: Parameters<Tenant['recoverFinish']>) { return this.#armed(this.#tenant.recoverFinish(...a)) }

  async alarm(): Promise<void> {
    this.#tenant.pruneIfDue()
    await this.#arm()
  }

  async #armed<T>(p: Promise<T>): Promise<T> {
    const out = await p
    await this.#arm()
    return out
  }

  async #arm(): Promise<void> {
    const due = this.#tenant.nextDue()
    if (due !== null) await this.ctx.storage.setAlarm(this.alarmAt(due))
  }
}
```
Spend, settle, put and get never touch a due time, so the hot path pays for no alarm write. The constructor's check reads one meta row on each wake and writes nothing unless code rows lack a due time.

- [ ] **Step 6: Run the suites**

Run: `cd worker && pnpm typecheck && pnpm test`
Expected: PASS, the existing recovery tests included. Then `pnpm --filter @solenoid/e2e test`, which starts `wrangler dev`: PASS, the signup rate-limit test included.

- [ ] **Step 7: Mutation gate**

Run: `cd worker && pnpm run mutate --force`
Expected: at least 90. Zero survivors in `ops.ts` (the `ip:` prefix, the 16-hex slice), in `#codeRowWritten` (set only when absent), in `pruneIfDue` (the `<=` boundary, killed by the `T0 + DAY - 1` test and the at-`T0 + DAY` test; the `DAY_MS` offset; the delete when no row is left) in `schedulePrune` (killed by the eviction test), and in `#arm` (the `due !== null` guard, killed by the final `armedFor: null`; the default `alarmAt`, killed by the real-clock test's exact match). Record equivalents in the Worker section.

- [ ] **Step 8: Commit**
```bash
git add worker/src worker/test e2e/test/signup-rate-limit.test.ts docs/testing/MUTATION-SUMMARY.md
git commit -m "Salt the per-network hash with MASTER and prune code rows on time with a Durable Object alarm"
```

---

### Task 3: Worker billing: checkout, webhook and meter reports

Spec: Billing (all of it); governance, Plans and billing. Decisions 2 to 8, 17 and 18.

**Files:**
- Create: `worker/src/stripe.ts`, `worker/src/billing-routes.ts`, `worker/test/stripe.test.ts`, `worker/test/billing.test.ts`
- Modify:
  - `worker/src/keys.ts`: export `hmacMatches`.
  - `worker/src/mail.ts`: `SECURITY_ADDRESS` and `duplicateMail`.
  - `worker/src/core.ts`: billing methods, the open Checkout Session, the meter job, `nextDue()` over both due times, `TenantApi`.
  - `worker/src/tenant.ts`: forward and arm the billing methods; the meter job in `alarm()`; `stripeFetch`.
  - `worker/src/router.ts`: two routes; `RouterEnv` gains the billing values.
  - `worker/src/auth-routes.ts`: `Io` gains `stripeFetch?`.
  - `worker/src/env.d.ts`, `worker/vitest.config.mts`, `docs/testing/MUTATION-SUMMARY.md`

**Interfaces:**
- Consumes: `hmacMatches` from `worker/src/keys.ts`, exported by this task (today it is a private `const`); `TENANT_RE`, `verifyKey`; `INTERNAL`; `normalizeEmail`; `codeMail`; `DAY_MS`, `HOUR_MS`; Task 2's `nextDue`, `#deleteMeta`, `#armed`, `#arm`, and the test helpers `setNow`, `armedFor`.
- Produces (`worker/src/stripe.ts`):
  - `METER_EVENT = 'spends'`, `RETURN_URL = 'https://solenoid.systems/pricing'`, `STRIPE_VERSION = '2026-08-26.dahlia'`, `CHECKOUT_TTL_S = 3600`
  - `type BillingEnv = { STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string; STRIPE_PRICE_PRO?: string; STRIPE_PRICE_SPENDS?: string; STRIPE_PORTAL_CONFIG?: string }`
  - `type BillingConfig = { secretKey: string; webhookSecret: string; pricePro: string; priceSpends: string; portalConfig: string }`
  - `billingConfig(env: BillingEnv): BillingConfig | null`
  - `type CheckoutSession = { id: string; url: string; expires: number }` (`expires` in ms)
  - `type Stripe = { checkout(tenant: string, customer: string | null, nowMs: number): Promise<CheckoutSession>; portal(customer: string): Promise<string>; meterEvent(e: { customer: string; value: number; identifier: string; timestamp: number }): Promise<void>; cancelDuplicate(subscription: string): Promise<void> }`
  - `stripeClient(cfg: BillingConfig, f?: typeof fetch): Stripe`
  - `verifySignature(secret: string, header: string | null, body: string, nowMs: number): Promise<boolean>`
  - `reportUsage(stub: Pick<TenantApi, 'meterDue' | 'meterCommit'>, stripe: Stripe, nowMs: number): Promise<void>`; `nowMs` becomes the event timestamp.
- Produces (`worker/src/mail.ts`): `SECURITY_ADDRESS = 'security@solenoid.systems'`, `duplicateMail(tenant: string, subscription: string, session: string): Mail`.
- Produces (`worker/src/billing-routes.ts`): `billingCheckout(req, env, tenantFor, io)` and `billingWebhook(req, env, tenantFor, io)`, both `Promise<Response>`.
- Produces (on `Tenant`, RPC, all in `TenantApi`):
  - `type Billing = { plan: string; customer: string | null; subscription: string | null; checkout: string | null }`, where `checkout` is the URL of an open session with more than five minutes left
  - `billing(auth: Auth): Promise<Result<Billing>>`
  - `checkoutSaved(session: string, url: string, expires: number): Promise<Result<null>>`
  - `billingStart(customer: string, subscription: string, session: string): Promise<Result<{ started: boolean; duplicate: boolean }>>`
  - `duplicateSettled(subscription: string): Promise<Result<null>>`
  - `billingEnd(subscription: string): Promise<Result<{ ended: boolean }>>`
  - `type MeterDue = { customer: string; identifier: string; value: number; to: number }`; `meterDue(): Promise<Result<MeterDue | null>>`
  - `meterCommit(to: number): Promise<Result<null>>`
- Produces (on `Tenant`, not RPC): `meterIsDue(): boolean`, `scheduleMeter(sent: boolean): void`. `nextDue()` becomes the earlier of `next_prune` and `next_meter`.
- Meta keys: `plan`, `stripe_customer`, `stripe_subscription`, `meter_seq` (the `seq` reported up to), `meter_to` (the end of a report in flight), `next_meter`, `checkout_session`, `checkout_url`, `checkout_expires` (ms), and `duplicate:<subscription>` = `cancelled` for each duplicate the webhook cancelled.
- Wire: `POST /billing/checkout` → `200 { url }` | `409 { error: 'already_pro', portal_url }` | `503 { error: 'billing_unavailable' }`. `POST /billing/stripe` → `200 { received: true }` | `400 { error: 'invalid_signature' }` | `503 { error: 'billing_unavailable' }` | `500 { error: 'internal' }`.
- `Io` becomes `{ mail: Mailer; waitUntil(p: Promise<unknown>): void; stripeFetch?: typeof fetch }`.

- [ ] **Step 1: Write the failing tests**

`worker/vitest.config.mts`: add the five billing values to `miniflare.bindings`, and refuse outbound fetch. The review ran `outboundService` as a function on `@cloudflare/vitest-pool-workers` 0.21.3: fetch from a test and from inside a Durable Object both got the 599.
```ts
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: {
      bindings: {
        MASTER: 'test-master-secret', SIGNING_KEY, SIGNING_KID: 'k1', RETIRED_SIGNING_KEYS, RESEND_API_KEY: '',
        STRIPE_SECRET_KEY: 'rk_test_vitest', STRIPE_WEBHOOK_SECRET: 'whsec_vitest', STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_SPENDS: 'price_spends', STRIPE_PORTAL_CONFIG: 'bpc_vitest',
      },
      outboundService: () => new Response('outbound fetch is refused in the Worker tests', { status: 599 }),
    },
  })],
```

`worker/test/stripe.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { hmacHex } from '../src/keys'
import { billingConfig, stripeClient, verifySignature } from '../src/stripe'

const NOW = Date.UTC(2026, 9, 1, 12)
const T = Math.floor(NOW / 1000)
const header = async (body: string, secret = 'whsec_x', t: number | string = T) => `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`
const CFG = { secretKey: 'rk_x', webhookSecret: 'whsec_x', pricePro: 'price_pro', priceSpends: 'price_spends', portalConfig: 'bpc_x' }

describe('verifySignature', () => {
  it('accepts a v1 signature of "<t>.<body>" under the secret, within five minutes either way', async () => {
    expect(await verifySignature('whsec_x', await header('{"a":1}'), '{"a":1}', NOW)).toBe(true)
    expect(await verifySignature('whsec_x', await header('{"a":1}', 'whsec_x', T - 300), '{"a":1}', NOW)).toBe(true)
    expect(await verifySignature('whsec_x', await header('{"a":1}', 'whsec_x', T + 300), '{"a":1}', NOW)).toBe(true)
  })
  it('accepts one good v1 among several', async () => {
    const good = (await header('{}')).split(',')[1]
    expect(await verifySignature('whsec_x', `t=${T},v1=${'0'.repeat(64)},${good}`, '{}', NOW)).toBe(true)
  })
  it('refuses a wrong secret, another body, a stale or future time, and a missing or malformed header', async () => {
    expect(await verifySignature('whsec_y', await header('{}'), '{}', NOW)).toBe(false)
    expect(await verifySignature('whsec_x', await header('{}'), '{ }', NOW)).toBe(false)
    expect(await verifySignature('whsec_x', await header('{}', 'whsec_x', T - 301), '{}', NOW)).toBe(false)
    expect(await verifySignature('whsec_x', await header('{}', 'whsec_x', T + 301), '{}', NOW)).toBe(false)
    const v1 = (await header('{}')).split(',')[1]
    for (const h of [null, '', v1, `t=,${v1}`, `t=12x,${v1}`, `t=${T}`, `t=${T},v1=${'z'.repeat(64)}`, `t=${T},v0=${v1.slice(3)}`]) {
      expect(await verifySignature('whsec_x', h, '{}', NOW)).toBe(false)
    }
  })
  it('refuses a time that is not all digits even when the MAC is signed over it', async () => {
    expect(await verifySignature('whsec_x', await header('{}', 'whsec_x', `${T}x`), '{}', NOW)).toBe(false)
    expect(await verifySignature('whsec_x', await header('{}', 'whsec_x', `x${T}`), '{}', NOW)).toBe(false)
  })
})

describe('billingConfig', () => {
  const ALL = { STRIPE_SECRET_KEY: 'rk_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_SPENDS: 'price_spends', STRIPE_PORTAL_CONFIG: 'bpc_x' }
  it('needs all five values', () => {
    expect(billingConfig(ALL)).toEqual(CFG)
    for (const k of Object.keys(ALL)) {
      expect(billingConfig({ ...ALL, [k]: undefined })).toBeNull()
      expect(billingConfig({ ...ALL, [k]: '' })).toBeNull()
    }
  })
})

describe('stripeClient', () => {
  type Seen = { method: string; url: string; auth: string | null; version: string | null; form: Record<string, string> }
  const recorder = (answer: (method: string, url: string) => [number, unknown] = () => [200, { url: 'https://stripe.test/x' }]) => {
    const calls: Seen[] = []
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers)
      const method = String(init?.method)
      calls.push({ method, url: String(input), auth: h.get('authorization'), version: h.get('stripe-version'), form: Object.fromEntries(new URLSearchParams(init?.body ? String(init.body) : '')) })
      const [status, body] = answer(method, String(input))
      return Response.json(body, { status })
    }) as typeof fetch
    return { calls, f }
  }
  it('posts a form with the restricted key and a pinned API version, and returns the portal URL', async () => {
    const { calls, f } = recorder()
    expect(await stripeClient(CFG, f).portal('cus_1')).toBe('https://stripe.test/x')
    expect(calls).toEqual([{ method: 'POST', url: 'https://api.stripe.com/v1/billing_portal/sessions', auth: 'Bearer rk_x', version: '2026-08-26.dahlia', form: { customer: 'cus_1', configuration: 'bpc_x', return_url: 'https://solenoid.systems/pricing' } }])
  })
  it('opens a Checkout Session that expires in an hour, and returns its id, URL and expiry', async () => {
    const { calls, f } = recorder(() => [200, { id: 'cs_1', url: 'https://checkout.stripe.test/c/1', expires_at: T + 3600 }])
    expect(await stripeClient(CFG, f).checkout('abcdefghijkl', null, NOW)).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.test/c/1', expires: NOW + 3_600_000 })
    expect(calls[0].form.expires_at).toBe(String(T + 3600))
  })
  it('sends one meter event on the spends meter', async () => {
    const { calls, f } = recorder(() => [200, {}])
    await stripeClient(CFG, f).meterEvent({ customer: 'cus_1', value: 3, identifier: 'abcdefghijkl:4-9', timestamp: 1_790_000_000 })
    expect(calls[0].url).toBe('https://api.stripe.com/v1/billing/meter_events')
    expect(calls[0].form).toEqual({ event_name: 'spends', 'payload[stripe_customer_id]': 'cus_1', 'payload[value]': '3', identifier: 'abcdefghijkl:4-9', timestamp: '1790000000' })
  })
  it('cancels a duplicate subscription that is still live', async () => {
    const { calls, f } = recorder(() => [200, { status: 'active' }])
    await stripeClient(CFG, f).cancelDuplicate('sub_2')
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET https://api.stripe.com/v1/subscriptions/sub_2', 'DELETE https://api.stripe.com/v1/subscriptions/sub_2'])
  })
  it('leaves a duplicate that is already cancelled alone', async () => {
    const { calls, f } = recorder(() => [200, { status: 'canceled' }])
    await stripeClient(CFG, f).cancelDuplicate('sub_2')
    expect(calls.map((c) => c.method)).toEqual(['GET'])
  })
  it('throws on any answer but 2xx, naming the method, the status and the path', async () => {
    await expect(stripeClient(CFG, recorder(() => [402, {}]).f).meterEvent({ customer: 'c', value: 1, identifier: 'i', timestamp: 1 })).rejects.toThrow('Stripe answered 402 to POST /billing/meter_events')
  })
})
```

`worker/test/billing.test.ts`:
```ts
import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantApi } from '../src/core'
import { adminKey, hmacHex, spendKey } from '../src/keys'
import type { Mail } from '../src/mail'
import { handle, type Io } from '../src/router'
import type { TenantDO } from '../src/tenant'
import { ADMIN, armedFor, limit, setBillable, setNow, spend, u, type Stub } from './helpers'

type Call = { method: string; url: string; form: Record<string, string> }
const T0 = Date.UTC(2026, 9, 1, 10)
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'

let calls: Call[] = []
let stripeDown = false
let sessions = 0
const stripeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const method = String(init?.method)
  const form = Object.fromEntries(new URLSearchParams(init?.body ? String(init.body) : ''))
  calls.push({ method, url, form })
  if (stripeDown) return Response.json({ error: { type: 'api_error' } }, { status: 500 })
  if (url.endsWith('/checkout/sessions')) {
    sessions++
    return Response.json({ id: `cs_${sessions}`, url: `https://checkout.stripe.test/c/${sessions}`, expires_at: Number(form.expires_at) })
  }
  if (url.endsWith('/billing_portal/sessions')) return Response.json({ url: 'https://billing.stripe.test/p/1' })
  if (url.includes('/subscriptions/')) return Response.json({ status: method === 'DELETE' ? 'canceled' : 'active' })
  return Response.json({ object: 'billing.meter_event' })
}) as typeof fetch
let mails: Mail[] = []
let pending: Promise<unknown>[] = []
let noticeDown = false
const io: Io = {
  mail: async (m) => {
    if (noticeDown && m.to === 'security@solenoid.systems') throw new Error('resend down')
    mails.push(m)
  },
  waitUntil: (p) => { pending.push(p) },
  stripeFetch,
}
const settled = async () => { await Promise.all(pending); pending = [] }
const tenantFor = (n: string) => env.TENANT.get(env.TENANT.idFromName(n)) as unknown as TenantApi

async function account() {
  const tenant = Array.from({ length: 12 }, () => B32[Math.floor(Math.random() * 32)]).join('')
  const stub = env.TENANT.get(env.TENANT.idFromName(tenant))
  await stub.init(tenant, 'free')
  await runInDurableObject(stub, (i: TenantDO) => { i.stripeFetch = stripeFetch })
  return { tenant, stub, admin: { authorization: `Bearer ${await adminKey(env.MASTER, tenant, 1)}` } }
}
const post = (path: string, body: BodyInit, headers: Record<string, string> = {}, e: object = env) =>
  handle(new Request(`https://api.test${path}`, { method: 'POST', headers, body }), e as typeof env, tenantFor, io)
const checkout = (headers: Record<string, string>, e?: object) => post('/billing/checkout', '', headers, e)
async function webhook(event: unknown, secret = 'whsec_vitest') {
  const body = JSON.stringify(event)
  const t = Math.floor(Date.now() / 1000)
  return post('/billing/stripe', body, { 'stripe-signature': `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}` })
}
const completed = (tenant: string, sub = 'sub_1', email: unknown = ' Buyer@Example.COM ', extra: Record<string, unknown> = {}) => ({
  type: 'checkout.session.completed',
  data: { object: { id: `cs_for_${sub}`, mode: 'subscription', payment_status: 'paid', client_reference_id: tenant, customer: 'cus_1', subscription: sub, customer_details: { email }, ...extra } },
})
const deleted = (tenant: string, sub = 'sub_1', endedAt = Math.floor(Date.now() / 1000)) =>
  ({ type: 'customer.subscription.deleted', data: { object: { id: sub, ended_at: endedAt, metadata: { tenant } } } })
const meta = (stub: Stub, k: string) =>
  runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => s.storage.sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray()[0]?.v as string | undefined)
const head = (stub: Stub) =>
  runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => s.storage.sql.exec('SELECT coalesce(max(seq), 0) AS n FROM entries').one().n as number)
const near = (actual: number | null, expected: number) => {
  expect(actual).not.toBeNull()
  expect(Math.abs(actual! - expected)).toBeLessThan(5_000)
}
const meterCalls = () => calls.filter((c) => c.url.endsWith('/billing/meter_events'))
const sessionCalls = () => calls.filter((c) => c.url.endsWith('/checkout/sessions'))
const route = (c: Call) => `${c.method} ${c.url.replace('https://api.stripe.com/v1', '')}`

beforeEach(() => { calls = []; stripeDown = false; noticeDown = false; sessions = 0; mails = []; pending = [] })
afterEach(() => { vi.restoreAllMocks() })

describe('POST /billing/checkout', () => {
  it('answers 503 billing_unavailable while any Stripe value is unset, and calls Stripe for nothing', async () => {
    const { admin } = await account()
    for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_SPENDS', 'STRIPE_PORTAL_CONFIG']) {
      const r = await checkout(admin, { ...env, [k]: undefined })
      expect([r.status, await r.json()]).toEqual([503, { error: 'billing_unavailable' }])
    }
    expect(calls).toEqual([])
  })

  it('needs the current admin key', async () => {
    const { tenant } = await account()
    expect((await checkout({})).status).toBe(401)
    const spendOnly = await checkout({ authorization: `Bearer ${await spendKey(await adminKey(env.MASTER, tenant, 1), 'acme', 0)}` })
    expect([spendOnly.status, await spendOnly.json()]).toEqual([403, { error: 'admin_required' }])
    expect((await checkout({ authorization: `Bearer ${await adminKey(env.MASTER, tenant, 2)}` })).status).toBe(401)
    expect(calls).toEqual([])
  })

  it('creates a subscription Checkout Session carrying the tenant, with the metered price and no quantity for it, open for an hour', async () => {
    const { tenant, stub, admin } = await account()
    const r = await checkout(admin)
    expect([r.status, await r.json()]).toEqual([200, { url: 'https://checkout.stripe.test/c/1' }])
    expect(calls).toEqual([{
      method: 'POST',
      url: 'https://api.stripe.com/v1/checkout/sessions',
      form: {
        mode: 'subscription',
        'line_items[0][price]': 'price_pro', 'line_items[0][quantity]': '1',
        'line_items[1][price]': 'price_spends',
        client_reference_id: tenant, 'subscription_data[metadata][tenant]': tenant,
        success_url: 'https://solenoid.systems/pricing', cancel_url: 'https://solenoid.systems/pricing',
        expires_at: expect.stringMatching(/^\d{10}$/),
      },
    }])
    near(Number(calls[0].form.expires_at) * 1000, Date.now() + HOUR)
    expect(await meta(stub, 'checkout_session')).toBe('cs_1')
  })

  it('hands back the open session while more than five minutes are left, and only then opens another', async () => {
    const { stub, admin } = await account()
    await setNow(stub, T0)
    const expiresAt = (ms: number) => runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => {
      s.storage.sql.exec("UPDATE meta SET v = ? WHERE k = 'checkout_expires'", String(ms))
    })
    expect(await (await checkout(admin)).json()).toEqual({ url: 'https://checkout.stripe.test/c/1' })
    await expiresAt(T0 + 5 * 60_000 + 1)
    expect(await (await checkout(admin)).json()).toEqual({ url: 'https://checkout.stripe.test/c/1' })
    expect(sessionCalls()).toHaveLength(1)
    await expiresAt(T0 + 5 * 60_000)
    expect(await (await checkout(admin)).json()).toEqual({ url: 'https://checkout.stripe.test/c/2' })
  })

  it('forgets the open session once it completes', async () => {
    const { tenant, stub, admin } = await account()
    await checkout(admin)
    await webhook(completed(tenant, 'sub_1', null, { id: 'cs_1' }))
    for (const k of ['checkout_session', 'checkout_url', 'checkout_expires']) expect(await meta(stub, k)).toBeUndefined()
  })

  it('sends a Pro tenant to the billing portal with 409 already_pro', async () => {
    const { tenant, admin } = await account()
    await webhook(completed(tenant))
    calls = []
    const r = await checkout(admin)
    expect([r.status, await r.json()]).toEqual([409, { error: 'already_pro', portal_url: 'https://billing.stripe.test/p/1' }])
    expect(calls).toEqual([{ method: 'POST', url: 'https://api.stripe.com/v1/billing_portal/sessions', form: { customer: 'cus_1', configuration: 'bpc_vitest', return_url: 'https://solenoid.systems/pricing' } }])
  })

  it('reuses the Stripe customer when a former Pro tenant upgrades again', async () => {
    const { tenant, admin } = await account()
    await webhook(completed(tenant))
    await webhook(deleted(tenant))
    calls = []
    expect((await checkout(admin)).status).toBe(200)
    expect(calls[0].form.customer).toBe('cus_1')
  })

  it('answers 500 and logs it when Stripe fails', async () => {
    const { admin } = await account()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    stripeDown = true
    const r = await checkout(admin)
    expect([r.status, await r.json()]).toEqual([500, { error: 'internal' }])
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'Stripe answered 500 to POST /checkout/sessions' }))
  })
})

describe('POST /billing/stripe', () => {
  it('answers 503 before reading the body while billing is unconfigured', async () => {
    const req = new Request('https://api.test/billing/stripe', { method: 'POST', body: '{"type":"checkout.session.completed"}' })
    const r = await handle(req, { ...env, STRIPE_WEBHOOK_SECRET: undefined } as typeof env, tenantFor, io)
    expect([r.status, await r.json()]).toEqual([503, { error: 'billing_unavailable' }])
    expect(req.bodyUsed).toBe(false)
  })

  it('refuses a bad signature with 400 and changes nothing', async () => {
    const { tenant, stub } = await account()
    const r = await webhook(completed(tenant), 'whsec_wrong')
    expect([r.status, await r.json()]).toEqual([400, { error: 'invalid_signature' }])
    const unsigned = await post('/billing/stripe', JSON.stringify(completed(tenant)))
    expect(unsigned.status).toBe(400)
    expect(await meta(stub, 'plan')).toBe('free')
  })

  it('makes the tenant Pro on checkout.session.completed, lifts the free cap, and mails a code to the checkout email', async () => {
    const { tenant, stub } = await account()
    await setNow(stub, T0)
    await spend(stub, 'a', { x: u(1) })
    await setBillable(stub, 100_000)
    expect(await spend(stub, 'a', { x: u(1) })).toMatchObject({ ok: false, status: 402 })
    const r = await webhook(completed(tenant))
    expect([r.status, await r.json()]).toEqual([200, { received: true }])
    expect(await meta(stub, 'plan')).toBe('pro')
    expect(await meta(stub, 'stripe_customer')).toBe('cus_1')
    expect(await meta(stub, 'stripe_subscription')).toBe('sub_1')
    expect(await meta(stub, 'meter_seq')).toBe(String(await head(stub)))
    expect(await meta(stub, 'next_meter')).toBe(String(T0 + DAY))
    near(await armedFor(stub), T0 + DAY)
    expect((await spend(stub, 'a', { x: u(1) })).ok).toBe(true)
    await settled()
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toBe('buyer@example.com')
    expect(mails[0].text).toContain(tenant)
  })

  it('treats a redelivered completion as done: no second code, and meter_seq stays put', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant))
    const from = await meta(stub, 'meter_seq')
    await spend(stub, 'a', { x: u(1) })
    expect((await webhook(completed(tenant))).status).toBe(200)
    await settled()
    expect(mails).toHaveLength(1)
    expect(await meta(stub, 'meter_seq')).toBe(from)
  })

  it('ignores a completion redelivered after cancellation, so the tenant stays free', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant))
    await webhook(deleted(tenant))
    expect((await webhook(completed(tenant))).status).toBe(200)
    expect(await meta(stub, 'plan')).toBe('free')
  })

  it('refuses a second subscription while Pro: it cancels the newcomer, logs it, mails security@ the IDs, and does so once', async () => {
    const { tenant, stub } = await account()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await webhook(completed(tenant, 'sub_1'))
    calls = []
    expect((await webhook(completed(tenant, 'sub_2'))).status).toBe(200)
    expect(await meta(stub, 'stripe_subscription')).toBe('sub_1')
    expect(await meta(stub, 'duplicate:sub_2')).toBe('cancelled')
    expect(calls.map(route)).toEqual(['GET /subscriptions/sub_2', 'DELETE /subscriptions/sub_2'])
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('sub_2'))
    await settled()
    expect(mails.map((m) => m.to)).toEqual(['buyer@example.com', 'security@solenoid.systems'])
    for (const id of [tenant, 'sub_2', 'cs_for_sub_2']) expect(mails[1].text).toContain(id)
    calls = []
    expect((await webhook(completed(tenant, 'sub_2'))).status).toBe(200)
    await settled()
    expect([calls, mails.length]).toEqual([[], 2])
  })

  it('still answers 200 when the duplicate notice cannot be sent, and logs the failure', async () => {
    const { tenant, stub } = await account()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await webhook(completed(tenant, 'sub_1'))
    noticeDown = true
    expect((await webhook(completed(tenant, 'sub_2'))).status).toBe(200)
    await settled()
    expect(await meta(stub, 'duplicate:sub_2')).toBe('cancelled')
    expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'resend down' }))
  })

  it('retries a duplicate cancel that failed, because Stripe redelivers the event', async () => {
    const { tenant, stub } = await account()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await webhook(completed(tenant, 'sub_1'))
    stripeDown = true
    expect((await webhook(completed(tenant, 'sub_2'))).status).toBe(500)
    expect(await meta(stub, 'duplicate:sub_2')).toBeUndefined()
    stripeDown = false
    calls = []
    expect((await webhook(completed(tenant, 'sub_2'))).status).toBe(200)
    expect(calls.map(route)).toEqual(['GET /subscriptions/sub_2', 'DELETE /subscriptions/sub_2'])
    expect(await meta(stub, 'duplicate:sub_2')).toBe('cancelled')
  })

  it('sends no code when the checkout has no usable email', async () => {
    for (const email of [null, 'not an address']) {
      const { tenant, stub } = await account()
      await webhook(completed(tenant, 'sub_1', email))
      expect(await meta(stub, 'plan')).toBe('pro')
    }
    await settled()
    expect(mails).toEqual([])
  })

  it('ignores a completed session that is not a paid subscription', async () => {
    for (const extra of [{ mode: 'payment', subscription: null }, { payment_status: 'unpaid' }]) {
      const { tenant, stub } = await account()
      expect((await webhook(completed(tenant, 'sub_1', ' Buyer@Example.COM ', extra))).status).toBe(200)
      expect(await meta(stub, 'plan')).toBe('free')
    }
    await settled()
    expect(mails).toEqual([])
  })

  it('acknowledges and ignores an event for no tenant, or of another type', async () => {
    for (const event of [completed('nope'), completed('zzzzzzzzzzzz'), { type: 'checkout.session.completed', data: { object: {} } }, deleted('NOPE'), deleted('zzzzzzzzzzzz'), { type: 'invoice.paid', data: { object: {} } }]) {
      const r = await webhook(event)
      expect([r.status, await r.json()]).toEqual([200, { received: true }])
    }
    expect(await meta(env.TENANT.get(env.TENANT.idFromName('zzzzzzzzzzzz')), 'plan')).toBeUndefined()
    await settled()
    expect([calls, mails]).toEqual([[], []])
  })

  it('reports the spends since the last report on customer.subscription.deleted, stamped inside the last period, then returns the tenant to free', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant))
    const from = Number(await meta(stub, 'meter_seq'))
    for (let i = 0; i < 3; i++) await spend(stub, 'a', { x: u(1) })
    await limit(stub, 'a', 'x', u(10))
    const endedAt = Math.floor(Date.now() / 1000) - 60
    expect((await webhook(deleted(tenant, 'sub_1', endedAt))).status).toBe(200)
    const [event] = meterCalls()
    expect(event.form).toEqual({ event_name: 'spends', 'payload[stripe_customer_id]': 'cus_1', 'payload[value]': '3', identifier: `${tenant}:${from}-${from + 4}`, timestamp: String(endedAt - 1) })
    expect(await meta(stub, 'plan')).toBe('free')
    expect(await meta(stub, 'next_meter')).toBeUndefined()
    expect(await meta(stub, 'meter_seq')).toBe(String(from + 4))
  })

  it('stamps the final report now when the subscription ends later than now', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant))
    await spend(stub, 'a', { x: u(1) })
    const before = Math.floor(Date.now() / 1000)
    await webhook(deleted(tenant, 'sub_1', before + 3600))
    const stamp = Number(meterCalls()[0].form.timestamp)
    expect(stamp).toBeGreaterThanOrEqual(before)
    expect(stamp).toBeLessThan(before + 60)
  })

  it('answers 500 and keeps the tenant Pro when the final report fails, then reports the same range on the retry', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant))
    await spend(stub, 'a', { x: u(1) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stripeDown = true
    expect((await webhook(deleted(tenant))).status).toBe(500)
    expect(await meta(stub, 'plan')).toBe('pro')
    await spend(stub, 'a', { x: u(1) })
    stripeDown = false
    expect((await webhook(deleted(tenant))).status).toBe(200)
    const [failed, retried] = meterCalls()
    expect(retried.form.identifier).toBe(failed.form.identifier)
    expect([failed.form['payload[value]'], retried.form['payload[value]']]).toEqual(['1', '1'])
    expect(await meta(stub, 'plan')).toBe('free')
  })

  it('ignores a deletion of another subscription, and reports nothing for it', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant, 'sub_2'))
    await spend(stub, 'a', { x: u(1) })
    await webhook(deleted(tenant, 'sub_1'))
    expect(await meta(stub, 'plan')).toBe('pro')
    expect(meterCalls()).toEqual([])
  })
})

describe('the daily meter report', () => {
  it('reports new spends once, then the next day only the newer ones', async () => {
    const { tenant, stub } = await account()
    await setNow(stub, T0)
    await webhook(completed(tenant))
    const s0 = Number(await meta(stub, 'meter_seq'))
    for (let i = 0; i < 3; i++) await spend(stub, 'a', { x: u(1) })
    await setNow(stub, T0 + DAY)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(meterCalls().map((c) => c.form)).toEqual([{ event_name: 'spends', 'payload[stripe_customer_id]': 'cus_1', 'payload[value]': '3', identifier: `${tenant}:${s0}-${s0 + 3}`, timestamp: String((T0 + DAY) / 1000) }])
    expect(await meta(stub, 'meter_seq')).toBe(String(s0 + 3))
    near(await armedFor(stub), T0 + 2 * DAY)
    for (let i = 0; i < 2; i++) await spend(stub, 'a', { x: u(1) })
    await setNow(stub, T0 + 2 * DAY)
    await runDurableObjectAlarm(stub)
    expect(meterCalls()[1].form).toMatchObject({ 'payload[value]': '2', identifier: `${tenant}:${s0 + 3}-${s0 + 5}` })
  })

  it('sends nothing for a day of limit changes and replays, and moves on', async () => {
    const { tenant, stub } = await account()
    await setNow(stub, T0)
    await stub.spend(ADMIN, 'a', { x: u(1) }, 'once', 'h')
    await webhook(completed(tenant))
    await limit(stub, 'a', 'x', u(10))
    expect((await stub.spend(ADMIN, 'a', { x: u(1) }, 'once', 'h')).ok).toBe(true)
    await setNow(stub, T0 + DAY)
    await runDurableObjectAlarm(stub)
    expect(meterCalls()).toEqual([])
    expect(await meta(stub, 'meter_seq')).toBe(String(await head(stub)))
  })

  it('retries a failed report in an hour with the same range and identifier', async () => {
    const { tenant, stub } = await account()
    await setNow(stub, T0)
    await webhook(completed(tenant))
    await spend(stub, 'a', { x: u(1) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stripeDown = true
    await setNow(stub, T0 + DAY)
    await runDurableObjectAlarm(stub)
    const from = await meta(stub, 'meter_seq')
    near(await armedFor(stub), T0 + DAY + HOUR)
    await spend(stub, 'a', { x: u(1) })
    stripeDown = false
    await setNow(stub, T0 + DAY + HOUR)
    await runDurableObjectAlarm(stub)
    const [failed, retried] = meterCalls()
    expect(retried.form.identifier).toBe(failed.form.identifier)
    expect(retried.form['payload[value]']).toBe('1')
    expect(await meta(stub, 'meter_seq')).not.toBe(from)
    near(await armedFor(stub), T0 + 2 * DAY + HOUR)
  })

  it('never moves meter_seq backwards, and clears only its own report in flight', async () => {
    const { tenant, stub } = await account()
    await webhook(completed(tenant))
    const from = Number(await meta(stub, 'meter_seq'))
    for (let i = 0; i < 3; i++) await spend(stub, 'a', { x: u(1) })
    expect(await stub.meterDue()).toMatchObject({ ok: true, value: { to: from + 3 } })
    await stub.meterCommit(from + 1)
    expect([await meta(stub, 'meter_seq'), await meta(stub, 'meter_to')]).toEqual([String(from + 1), String(from + 3)])
    await stub.meterCommit(from + 3)
    await stub.meterCommit(from + 1)
    expect([await meta(stub, 'meter_seq'), await meta(stub, 'meter_to')]).toEqual([String(from + 3), undefined])
  })

  it('arms one alarm for the earlier of the two jobs', async () => {
    const { tenant, stub } = await account()
    await setNow(stub, T0)
    await webhook(completed(tenant))
    await setNow(stub, T0 + 2 * HOUR)
    await stub.attachStart(ADMIN, 'robin@example.com')
    near(await armedFor(stub), T0 + DAY)
    await setNow(stub, T0 + DAY)
    await runDurableObjectAlarm(stub)
    expect(await meta(stub, 'next_prune')).toBe(String(T0 + 2 * HOUR + DAY))
    near(await armedFor(stub), T0 + 2 * HOUR + DAY)
  })

  it('stops the meter job, and reports nothing, when the tenant is no longer Pro', async () => {
    const { tenant, stub } = await account()
    await setNow(stub, T0)
    await webhook(completed(tenant))
    await spend(stub, 'a', { x: u(1) })
    await runInDurableObject(stub, (_i: TenantDO, s: DurableObjectState) => { s.storage.sql.exec("UPDATE meta SET v = 'free' WHERE k = 'plan'") })
    await setNow(stub, T0 + DAY)
    await runDurableObjectAlarm(stub)
    expect(await meta(stub, 'next_meter')).toBeUndefined()
    expect(await armedFor(stub)).toBeNull()
    expect(meterCalls()).toEqual([])
  })
})
```
The spend made between the failed and the retried final report is not billed: the retry covers the pinned range (Decision 6), and the tenant then leaves Pro. That is at most one report's worth, in the customer's favour, as the spec accepts for cancellation. The `override` parameter of `post` is typed `object`, which the `Cloudflare.Env` interface satisfies; `Record<string, unknown>` would not compile (review B1).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd worker && pnpm vitest run test/stripe.test.ts test/billing.test.ts`
Expected: FAIL, because `../src/stripe` does not exist and `/billing/*` answers 404.

- [ ] **Step 3: Implement `worker/src/stripe.ts`**

First export the HMAC check from `worker/src/keys.ts` (line 17): `export const hmacMatches = async (…) …`, body unchanged.

```ts
import type { TenantApi } from './core'
import { hmacMatches } from './keys'

export const METER_EVENT = 'spends'
export const RETURN_URL = 'https://solenoid.systems/pricing'
export const STRIPE_VERSION = '2026-08-26.dahlia'
export const CHECKOUT_TTL_S = 60 * 60
const API = 'https://api.stripe.com/v1'
const TOLERANCE_S = 300

export type BillingEnv = { STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string; STRIPE_PRICE_PRO?: string; STRIPE_PRICE_SPENDS?: string; STRIPE_PORTAL_CONFIG?: string }
export type BillingConfig = { secretKey: string; webhookSecret: string; pricePro: string; priceSpends: string; portalConfig: string }
export type CheckoutSession = { id: string; url: string; expires: number }
export type Stripe = {
  checkout(tenant: string, customer: string | null, nowMs: number): Promise<CheckoutSession>
  portal(customer: string): Promise<string>
  meterEvent(e: { customer: string; value: number; identifier: string; timestamp: number }): Promise<void>
  cancelDuplicate(subscription: string): Promise<void>
}

export function billingConfig(env: BillingEnv): BillingConfig | null {
  const { STRIPE_SECRET_KEY: secretKey, STRIPE_WEBHOOK_SECRET: webhookSecret, STRIPE_PRICE_PRO: pricePro, STRIPE_PRICE_SPENDS: priceSpends, STRIPE_PORTAL_CONFIG: portalConfig } = env
  return secretKey && webhookSecret && pricePro && priceSpends && portalConfig ? { secretKey, webhookSecret, pricePro, priceSpends, portalConfig } : null
}

export function stripeClient(cfg: BillingConfig, f: typeof fetch = fetch): Stripe {
  async function call(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string> = {}): Promise<Record<string, any>> {
    const form = new URLSearchParams(params).toString()
    const res = await f(`${API}${path}${method === 'POST' || !form ? '' : `?${form}`}`, {
      method,
      headers: { authorization: `Bearer ${cfg.secretKey}`, 'stripe-version': STRIPE_VERSION, 'content-type': 'application/x-www-form-urlencoded' },
      body: method === 'POST' ? form : undefined,
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Stripe answered ${res.status} to ${method} ${path}`)
    return res.json()
  }
  return {
    async checkout(tenant, customer, nowMs) {
      const s = await call('POST', '/checkout/sessions', {
        mode: 'subscription',
        'line_items[0][price]': cfg.pricePro,
        'line_items[0][quantity]': '1',
        'line_items[1][price]': cfg.priceSpends,
        client_reference_id: tenant,
        'subscription_data[metadata][tenant]': tenant,
        success_url: RETURN_URL,
        cancel_url: RETURN_URL,
        expires_at: String(Math.floor(nowMs / 1000) + CHECKOUT_TTL_S),
        ...(customer ? { customer } : {}),
      })
      return { id: s.id, url: s.url, expires: s.expires_at * 1000 }
    },
    portal: async (customer) => (await call('POST', '/billing_portal/sessions', { customer, configuration: cfg.portalConfig, return_url: RETURN_URL })).url,
    async meterEvent(e) {
      await call('POST', '/billing/meter_events', { event_name: METER_EVENT, 'payload[stripe_customer_id]': e.customer, 'payload[value]': String(e.value), identifier: e.identifier, timestamp: String(e.timestamp) })
    },
    async cancelDuplicate(subscription) {
      if ((await call('GET', `/subscriptions/${subscription}`)).status !== 'canceled') await call('DELETE', `/subscriptions/${subscription}`)
    },
  }
}

export async function verifySignature(secret: string, header: string | null, body: string, nowMs: number): Promise<boolean> {
  const fields = (header ?? '').split(',').map((kv) => kv.split('='))
  const t = fields.find(([k]) => k === 't')?.[1] ?? ''
  if (!/^[0-9]{1,12}$/.test(t) || Math.abs(nowMs / 1000 - Number(t)) > TOLERANCE_S) return false
  for (const [k, v] of fields) if (k === 'v1' && /^[0-9a-f]{64}$/.test(v ?? '') && (await hmacMatches(secret, `${t}.${body}`, v))) return true
  return false
}

export async function reportUsage(stub: Pick<TenantApi, 'meterDue' | 'meterCommit'>, stripe: Stripe, nowMs: number): Promise<void> {
  const due = await stub.meterDue()
  if (!due.ok || !due.value) return
  const { customer, identifier, value, to } = due.value
  if (value > 0) await stripe.meterEvent({ customer, value, identifier, timestamp: Math.floor(nowMs / 1000) })
  await stub.meterCommit(to)
}
```
The metered line item carries no `quantity`: Checkout rejects one on a `usage_type=metered` price (spec, Billing). The API version is pinned so the account's default version never changes a payload shape under the Worker. A duplicate is read before it is deleted, so a redelivery after a lost response finds it `canceled` and does nothing.

- [ ] **Step 4: The ledger side, in `worker/src/core.ts`**

Change the `TenantApi` line, and add the types and a constant under it:
```ts
export type TenantApi = Pick<Tenant, 'init' | 'spend' | 'settle' | 'put' | 'get' | 'attachStart' | 'attachVerify' | 'recoverStart' | 'recoverFinish' | 'billing' | 'checkoutSaved' | 'billingStart' | 'duplicateSettled' | 'billingEnd' | 'meterDue' | 'meterCommit'>
export type MeterDue = { customer: string; identifier: string; value: number; to: number }
export type Billing = { plan: string; customer: string | null; subscription: string | null; checkout: string | null }
const CHECKOUT_REUSE_MS = 5 * 60_000
const CHECKOUT_KEYS = ['checkout_session', 'checkout_url', 'checkout_expires']
```
Replace Task 2's `nextDue()` and add the billing members after `recoverFinish`:
```ts
  async billing(auth: Auth): Promise<Result<Billing>> {
    const denied = this.#authorize(auth, '', 'admin')
    if (denied) return denied
    const open = Number(this.#meta('checkout_expires')) - this.#now() > CHECKOUT_REUSE_MS
    return ok({ plan: this.#meta('plan')!, customer: this.#meta('stripe_customer') ?? null, subscription: this.#meta('stripe_subscription') ?? null, checkout: open ? this.#meta('checkout_url')! : null })
  }

  checkoutSaved(session: string, url: string, expires: number): Promise<Result<null>> {
    return this.#serial(async () => {
      this.#sql.transactionSync(() => {
        this.#setMeta('checkout_session', session)
        this.#setMeta('checkout_url', url)
        this.#setMeta('checkout_expires', String(expires))
      })
      return ok(null)
    })
  }

  billingStart(customer: string, subscription: string, session: string): Promise<Result<{ started: boolean; duplicate: boolean }>> {
    return this.#serial(async () => {
      if (!this.#meta('tenant')) return ok({ started: false, duplicate: false })
      if (this.#meta('checkout_session') === session) for (const k of CHECKOUT_KEYS) this.#deleteMeta(k)
      if (this.#meta('stripe_subscription') === subscription || this.#meta(`duplicate:${subscription}`)) return ok({ started: false, duplicate: false })
      if (this.#meta('plan') === 'pro') return ok({ started: false, duplicate: true })
      this.#sql.transactionSync(() => {
        this.#setMeta('plan', 'pro')
        this.#setMeta('stripe_customer', customer)
        this.#setMeta('stripe_subscription', subscription)
        this.#setMeta('meter_seq', String(this.#head.seq))
        this.#deleteMeta('meter_to')
        this.#setMeta('next_meter', String(this.#now() + DAY_MS))
      })
      return ok({ started: true, duplicate: false })
    })
  }

  duplicateSettled(subscription: string): Promise<Result<null>> {
    return this.#serial(async () => {
      this.#setMeta(`duplicate:${subscription}`, 'cancelled')
      return ok(null)
    })
  }

  billingEnd(subscription: string): Promise<Result<{ ended: boolean }>> {
    return this.#serial(async () => {
      if (this.#meta('plan') !== 'pro' || this.#meta('stripe_subscription') !== subscription) return ok({ ended: false })
      this.#sql.transactionSync(() => {
        this.#setMeta('plan', 'free')
        this.#deleteMeta('next_meter')
        this.#deleteMeta('meter_to')
      })
      return ok({ ended: true })
    })
  }

  meterDue(): Promise<Result<MeterDue | null>> {
    return this.#serial(async () => {
      if (this.#meta('plan') !== 'pro') return ok(null)
      const from = Number(this.#meta('meter_seq'))
      const to = Number(this.#meta('meter_to') ?? this.#head.seq)
      this.#setMeta('meter_to', String(to))
      const value = this.#count("SELECT count(*) AS n FROM entries WHERE kind = 'spend' AND seq > ? AND seq <= ?", from, to)
      return ok({ customer: this.#meta('stripe_customer')!, identifier: `${this.#meta('tenant')}:${from}-${to}`, value, to })
    })
  }

  meterCommit(to: number): Promise<Result<null>> {
    return this.#serial(async () => {
      if (to > Number(this.#meta('meter_seq'))) this.#setMeta('meter_seq', String(to))
      if (this.#meta('meter_to') === String(to)) this.#deleteMeta('meter_to')
      return ok(null)
    })
  }

  meterIsDue(): boolean {
    return Number(this.#meta('next_meter')) <= this.#now()
  }

  scheduleMeter(sent: boolean): void {
    if (this.#meta('plan') !== 'pro') return this.#deleteMeta('next_meter')
    this.#setMeta('next_meter', String(this.#now() + (sent ? DAY_MS : HOUR_MS)))
  }

  nextDue(): number | null {
    const due = ['next_prune', 'next_meter'].map((k) => this.#meta(k)).filter((v) => v !== undefined).map(Number)
    return due.length ? Math.min(...due) : null
  }
```
A replay writes no entry and a settle is kind `settle`, so the count is exactly the billable spends (governance, Plans and billing). `billingStart`'s subscription check is Decision 5; its Pro check is the refusal of a second subscription (Decision 17).

- [ ] **Step 5: `TenantDO`**

In `worker/src/tenant.ts`, add the imports `import { billingConfig, reportUsage, stripeClient } from './stripe'`, the field `stripeFetch: typeof fetch = (input, init) => fetch(input, init)` under `alarmAt`, and these forwarders:
```ts
  billing(...a: Parameters<Tenant['billing']>) { return this.#tenant.billing(...a) }
  checkoutSaved(...a: Parameters<Tenant['checkoutSaved']>) { return this.#tenant.checkoutSaved(...a) }
  billingStart(...a: Parameters<Tenant['billingStart']>) { return this.#armed(this.#tenant.billingStart(...a)) }
  duplicateSettled(...a: Parameters<Tenant['duplicateSettled']>) { return this.#tenant.duplicateSettled(...a) }
  billingEnd(...a: Parameters<Tenant['billingEnd']>) { return this.#armed(this.#tenant.billingEnd(...a)) }
  meterDue(...a: Parameters<Tenant['meterDue']>) { return this.#tenant.meterDue(...a) }
  meterCommit(...a: Parameters<Tenant['meterCommit']>) { return this.#tenant.meterCommit(...a) }
```
`alarm()` becomes:
```ts
  async alarm(): Promise<void> {
    this.#tenant.pruneIfDue()
    if (this.#tenant.meterIsDue()) {
      const cfg = billingConfig(this.env)
      let sent = false
      try {
        if (cfg) {
          await reportUsage(this.#tenant, stripeClient(cfg, this.stripeFetch), this.now())
          sent = true
        }
      } catch (e) {
        console.error(e)
      }
      this.#tenant.scheduleMeter(sent)
    }
    await this.#arm()
  }
```

- [ ] **Step 6: The routes**

`worker/src/auth-routes.ts`: `export type Io = { mail: Mailer; waitUntil(p: Promise<unknown>): void; stripeFetch?: typeof fetch }`.

`worker/src/mail.ts`, at the end:
```ts
export const SECURITY_ADDRESS = 'security@solenoid.systems'

export const duplicateMail = (tenant: string, subscription: string, session: string): Mail => ({
  to: SECURITY_ADDRESS,
  subject: `Solenoid cancelled a duplicate subscription for account ${tenant}`,
  text: [
    `Account ${tenant} was already on Pro when Checkout session ${session} completed, so the Worker cancelled the new subscription ${subscription}.`,
    `If that session was paid, refund it by hand in the Stripe dashboard: open subscription ${subscription}, then its first invoice's payment.`,
  ].join('\n\n'),
})
```
This is an operations notice to Robin, never sent to a customer, so it is not a copy unit.

`worker/src/billing-routes.ts`:
```ts
import type { Io } from './auth-routes'
import { INTERNAL } from './auth'
import { normalizeEmail } from './codes'
import type { TenantApi } from './core'
import { ApiError, failResponse, json } from './errors'
import { TENANT_RE, verifyKey } from './keys'
import { codeMail, duplicateMail } from './mail'
import { billingConfig, reportUsage, stripeClient, verifySignature, type BillingEnv } from './stripe'

type TenantFor = (name: string) => TenantApi
const unavailable = () => json(503, { error: 'billing_unavailable' })
const tenantIn = (v: unknown): string | null => (typeof v === 'string' && TENANT_RE.test(v) ? v : null)

export async function billingCheckout(req: Request, env: BillingEnv & { MASTER: string }, tenantFor: TenantFor, io: Io): Promise<Response> {
  const { tenant, auth } = await verifyKey(req.headers.get('authorization'), env.MASTER)
  const cfg = billingConfig(env)
  if (!cfg) return unavailable()
  const stub = tenantFor(tenant)
  const r = await stub.billing(auth)
  if (!r.ok) return failResponse(r)
  const stripe = stripeClient(cfg, io.stripeFetch)
  if (r.value.plan === 'pro') return json(409, { error: 'already_pro', portal_url: await stripe.portal(r.value.customer!) })
  if (r.value.checkout) return json(200, { url: r.value.checkout })
  const session = await stripe.checkout(tenant, r.value.customer, Date.now())
  await stub.checkoutSaved(session.id, session.url, session.expires)
  return json(200, { url: session.url })
}

export async function billingWebhook(req: Request, env: BillingEnv, tenantFor: TenantFor, io: Io): Promise<Response> {
  const cfg = billingConfig(env)
  if (!cfg) return unavailable()
  const body = await req.text()
  if (!(await verifySignature(cfg.webhookSecret, req.headers.get('stripe-signature'), body, Date.now()))) throw new ApiError(400, 'invalid_signature')
  const { type, data } = JSON.parse(body) as { type: string; data: { object: Record<string, any> } }
  const o = data.object
  const stripe = stripeClient(cfg, io.stripeFetch)
  if (type === 'checkout.session.completed' && o.mode === 'subscription' && o.payment_status === 'paid') {
    const tenant = tenantIn(o.client_reference_id)
    if (tenant) {
      const stub = tenantFor(tenant)
      const r = await stub.billingStart(o.customer, o.subscription, o.id)
      if (r.ok && r.value.duplicate) {
        await stripe.cancelDuplicate(o.subscription)
        await stub.duplicateSettled(o.subscription)
        console.error(`tenant ${tenant} is already on Pro; cancelled the second subscription ${o.subscription} from session ${o.id}. refund it by hand if it was paid`)
        io.waitUntil(io.mail(duplicateMail(tenant, o.subscription, o.id)).catch((e) => console.error(e)))
      }
      const email = normalizeEmail(o.customer_details?.email)
      if (r.ok && r.value.started && email) {
        const code = await stub.attachStart(INTERNAL, email)
        if (code.ok) io.waitUntil(io.mail(codeMail(email, code.value.code, tenant, 'attach')).catch((e) => console.error(e)))
      }
    }
  }
  if (type === 'customer.subscription.deleted') {
    const tenant = tenantIn(o.metadata?.tenant)
    if (tenant) {
      const stub = tenantFor(tenant)
      const b = await stub.billing(INTERNAL)
      if (b.ok && b.value.plan === 'pro' && b.value.subscription === o.id) {
        await reportUsage(stub, stripe, Math.min(Date.now(), o.ended_at * 1000 - 1000))
        await stub.billingEnd(o.id)
      }
    }
  }
  return json(200, { received: true })
}
```
The final report is stamped at the earlier of now and one second before `ended_at`, so its spends fall inside the subscription's last period (Decision 18; spec, Billing, as amended). A code request that the per-address limits refuse (`429`) is dropped: the customer can still run `solenoid email <address>`.

`worker/src/router.ts`:
- `export type RouterEnv = BillingEnv & { MASTER: string; SIGNING_KEY: string; SIGNING_KID: string; RETIRED_SIGNING_KEYS?: string | Record<string, JsonWebKey> }`, with `import { billingCheckout, billingWebhook } from './billing-routes'` and `import type { BillingEnv } from './stripe'`.
- In `route`, after the `/auth/recover` line:
```ts
  if (req.method === 'POST' && url.pathname === '/billing/checkout') return billingCheckout(req, env, tenantFor, io)
  if (req.method === 'POST' && url.pathname === '/billing/stripe') return billingWebhook(req, env, tenantFor, io)
```

`worker/src/env.d.ts`, inside `Env`: add `STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string; STRIPE_PRICE_PRO?: string; STRIPE_PRICE_SPENDS?: string; STRIPE_PORTAL_CONFIG?: string`.

`worker/src/index.ts` needs no change: `stripeFetch` defaults to the global `fetch`.

- [ ] **Step 7: Run the suites**

Run: `cd worker && pnpm typecheck && pnpm test`, then `cd testing && pnpm typecheck && pnpm test` (the test server now serves `/billing/*` and answers 503: it sets no Stripe values).
Expected: PASS.

- [ ] **Step 8: Mutation gate**

Run: `cd worker && pnpm run mutate --force`
Expected: at least 90. Zero survivors on these reject and limit paths: `billingConfig` (each of the five); `verifySignature` (the `t` pattern and both anchors, killed by the `12x` tests; the 300-second bound on both sides; the `v1` key and pattern); the 409 plan check; the open-session reuse and its five-minute margin; the mode and payment-status filter; `billingStart`'s tenant check (killed by `zzzzzzzzzzzz`), its subscription and duplicate-marker checks and its Pro refusal; `cancelDuplicate`'s status check; the duplicate notice's addressee and its three IDs; the webhook's plan and subscription match before the final report; the `ended_at` stamp; `meterDue`'s plan check (killed by the spend in "stops the meter job"); `meterCommit`'s two guards; the `value > 0` guard; `meterIsDue`'s `<=`; `scheduleMeter`'s plan check and its day-or-hour choice. Record as equivalent under Robin's redundant-guard ruling: `tenantIn` (a well-formed but unknown ID reaches `billingStart`, which no-ops on an empty object) and `billingEnd`'s plan and subscription check (the route checks both first). Record the Stripe boundary: Stripe's HTTP API is the only mock.

- [ ] **Step 9: Commit**
```bash
git add worker docs/testing/MUTATION-SUMMARY.md
git commit -m "Sell Pro through a Stripe Checkout Session, mark it by webhook, refuse a second subscription, and report metered spends daily"
```

---

### Task 4: SDK `checkout()` and CLI `upgrade`

Spec: Billing, "`solenoid upgrade`". Decisions 9 and 19.

**Files:**
- Modify: `sdk/src/http.ts`, `sdk/src/index.ts`, `sdk/test/http.test.ts`, `sdk/test/account.test.ts`, `cli/src/commands.ts`, `cli/test/cli.test.ts`, `cli/test/bundle.test.ts`, `cli/package.json` (the `mutate` script), `docs/testing/MUTATION-SUMMARY.md` (`upgrade` takes no flags, so `cli/src/main.ts` is unchanged)
- Create: `cli/src/browser.ts`, `cli/test/upgrade.test.ts`

**Interfaces:**
- Consumes: Task 3's wire contract for `POST /billing/checkout`.
- Produces:
  - SDK client method `checkout(): Promise<{ url: string }>`. `409` rejects as `SolenoidError` with `code: 'already_pro'` and `detail.portal_url`; `503 billing_unavailable` rejects as `SolenoidError`, never `Outage`.
  - `cli/src/browser.ts`: `openUrl(url: string): Promise<boolean>`, true once the opener has started, false when it could not (Decision 19). It runs `$BROWSER` when that is set, else the platform's opener.
  - CLI command `upgrade`; `explain('billing_unavailable')`.

- [ ] **Step 1: Write the failing SDK tests**

`sdk/test/http.test.ts`, next to the `email_failed` test:
```ts
  it('treats a 503 billing_unavailable as a refusal, not an outage, and never retries it', async () => {
    const f = vi.fn().mockResolvedValue(res(503, { error: 'billing_unavailable' }))
    const e = await failure(solenoid({ key: 'sk.x', api: 'http://x', fetch: f }).get('a'))
    expect(e).toBeInstanceOf(SolenoidError)
    expect(e).toMatchObject({ status: 503, code: 'billing_unavailable' })
    expect(f).toHaveBeenCalledTimes(1)
  })
```
`sdk/test/account.test.ts`:
```ts
describe('checkout', () => {
  it('posts to /billing/checkout with the admin key and no idempotency key, and returns the url', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"url":"https://checkout.stripe.test/c/1"}', { status: 200 }))
    expect(await solenoid({ key: 'sk.admin.x', api: 'http://x', fetch: f }).checkout()).toEqual({ url: 'https://checkout.stripe.test/c/1' })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('http://x/billing/checkout')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk.admin.x' })
    expect(init.headers).not.toHaveProperty('idempotency-key')
  })
  it('surfaces 409 already_pro with the portal url, and the test server as 503 billing_unavailable', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"error":"already_pro","portal_url":"https://billing.stripe.test/p/1"}', { status: 409 }))
    await expect(solenoid({ key: 'sk.admin.x', api: 'http://x', fetch: f }).checkout()).rejects.toMatchObject({ status: 409, code: 'already_pro', detail: { portal_url: 'https://billing.stripe.test/p/1' } })
    const { admin } = await setup()
    await expect(admin.checkout()).rejects.toMatchObject({ status: 503, code: 'billing_unavailable' })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd sdk && pnpm vitest run test/http.test.ts test/account.test.ts`
Expected: FAIL: `checkout` is not a function, and the 503 becomes an `Outage`.

- [ ] **Step 3: Implement the SDK side**

`sdk/src/http.ts`: add `const REFUSED_5XX = new Set(['email_failed', 'billing_unavailable'])` under the imports, and change line 18 to:
```ts
    if (res.status >= 500 && !REFUSED_5XX.has(data.error as string)) throw new Outage(`HTTP ${res.status}`)
```
`sdk/src/index.ts`, next to `sendEmailCode`:
```ts
  const checkout = () => call<{ url: string }>(authT, 'POST', '/billing/checkout', {})
```
and add `checkout` to the returned object after `verifyEmail`.

Run: `cd sdk && pnpm test && pnpm build`
Expected: PASS.

- [ ] **Step 4: Write the failing CLI tests**

In `cli/test/cli.test.ts`, delete the test "has no upgrade command yet (it is Stripe work for Plan 3)", and add this line to the `HELP` array after the `rotate --admin --yes` line:
```ts
  '  upgrade                                                             move this account to Pro in Stripe Checkout, or get the billing portal link',
```

In `cli/test/bundle.test.ts:42`, the built binary's help must now end on the `upgrade` line. Pin its shape, not its wording, which is copy:
```ts
    expect((await run('help')).stdout).toMatch(/^solenoid keeps an agent inside a spend limit[^]*rotate --admin --yes {48}revoke the admin key and every spend key\n {2}upgrade +\S[^\n]*\n$/)
```

`cli/test/upgrade.test.ts`:
```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestServer } from '../../testing/src/index'
import { freshServer, solenoid, tempDir, useConfigDir } from './run'

let server: TestServer
let cwd: string
let tenant: string
let openerLog: string
const run = (...args: string[]) => solenoid(cwd, ...args)
const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
  new URL(String(input)).pathname === '/billing/checkout' ? Promise.resolve(Response.json(body, { status })) : server.fetch(input, init))

beforeEach(async () => {
  const bin = tempDir('bin-')
  openerLog = join(bin, 'opened')
  for (const name of ['open', 'xdg-open']) writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${openerLog}"\n`, { mode: 0o755 })
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
  vi.stubEnv('BROWSER', 'true')
  server = await freshServer()
  const config = useConfigDir()
  cwd = tempDir('proj-')
  const acct = await server.signup()
  tenant = acct.tenant
  mkdirSync(config, { recursive: true })
  writeFileSync(join(config, 'credentials'), JSON.stringify({ api: server.api, admin_key: acct.admin_key }))
})

describe('upgrade', () => {
  it('opens Stripe Checkout with the browser command, prints the url, and exits 0', async () => {
    answer(200, { url: 'https://checkout.stripe.test/c/1' })
    const r = await run('upgrade')
    expect([r.code, r.err]).toEqual([0, ''])
    expect(r.out.split('\n')[1]).toBe('https://checkout.stripe.test/c/1')
    expect(r.out).toContain('solenoid email')
  })

  it('still prints the url, says the browser did not open, and exits 0 when the opener is missing', async () => {
    answer(200, { url: 'https://checkout.stripe.test/c/1' })
    const opened = await run('upgrade')
    vi.stubEnv('BROWSER', 'solenoid-test-no-such-opener')
    const missing = await run('upgrade')
    expect([missing.code, missing.err]).toEqual([0, ''])
    expect(missing.out.split('\n')[1]).toBe('https://checkout.stripe.test/c/1')
    expect(missing.out.split('\n')[0]).not.toBe(opened.out.split('\n')[0])
  })

  it("uses the platform's opener when BROWSER is unset", async () => {
    vi.stubEnv('BROWSER', undefined)
    answer(200, { url: 'https://checkout.stripe.test/c/1' })
    const r = await run('upgrade')
    expect([r.code, r.err]).toEqual([0, ''])
    await vi.waitFor(() => expect(readFileSync(openerLog, 'utf8')).toBe(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} https://checkout.stripe.test/c/1\n`))
  })

  it('prints the billing portal link for an account already on Pro, and exits 0', async () => {
    answer(409, { error: 'already_pro', portal_url: 'https://billing.stripe.test/p/1' })
    const r = await run('upgrade')
    expect([r.code, r.err]).toEqual([0, ''])
    expect(r.out).toContain(tenant)
    expect(r.out).toContain('https://billing.stripe.test/p/1')
  })

  it('explains a 503 billing_unavailable on stderr, and exits 1', async () => {
    const r = await run('upgrade')
    expect(r.code).toBe(1)
    expect(r.out).toBe('')
    expect(r.err).toMatch(/^solenoid: billing_unavailable \(503\)\. \S/)
  })

  it('says checkout could not start when the call fails in transit', async () => {
    answer(500, { error: 'internal' })
    const r = await run('upgrade')
    expect(r.code).toBe(1)
    expect(r.err).toContain('solenoid upgrade')
  })

  it('needs saved credentials, and calls nothing without them', async () => {
    useConfigDir()
    answer(200, { url: 'https://checkout.stripe.test/c/1' })
    const r = await run('upgrade')
    expect(r.code).toBe(1)
    expect(r.err).toContain('solenoid init <scope>')
  })
})
```
No test, and no mutant, opens a real browser. Every test puts stub `open` and `xdg-open` scripts first on `PATH`, which only append their arguments to a log, and sets `BROWSER=true` (`true` starts, ignores its argument and exits), so even a mutant that ignores `BROWSER` runs a stub. The one test that unsets `BROWSER` reads the log to prove the platform's opener got the URL. The missing opener is a real spawn of a binary that does not exist, which Node reports through the child's `error` event.

- [ ] **Step 5: Run them to verify they fail**

Run: `cd cli && pnpm vitest run test/upgrade.test.ts test/cli.test.ts`
Expected: FAIL: `unknown command "upgrade"`, and the help screen lacks the line.

- [ ] **Step 6: Implement the CLI side**

`cli/src/browser.ts`:
```ts
import { spawn } from 'node:child_process'

export function openUrl(url: string): Promise<boolean> {
  const [cmd, args] = process.env.BROWSER ? [process.env.BROWSER, [url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : ['xdg-open', [url]]
  return new Promise((done) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
      child.once('spawn', () => { child.unref(); done(true) })
      child.once('error', () => done(false))
    } catch {
      done(false)
    }
  })
}
```

`cli/src/commands.ts`:
- Import `SolenoidError` from `@solenoid.systems/sdk` (add to the existing import) and `import { openUrl } from './browser'`.
- In `explain`, before `default`:
```ts
    case 'billing_unavailable':
      return 'billing is not open yet, so Pro cannot be bought today. the free plan keeps working: 100,000 spends each UTC calendar month.'
```
- Add the `HELP` line from Step 4 after the `rotate --admin --yes` line.
- In `dispatch`, before `default`:
```ts
    case 'upgrade': {
      const tenant = tenantOf(readCreds().admin_key)
      let url: string
      try {
        ({ url } = await client(10_000).checkout())
      } catch (e) {
        if (e instanceof SolenoidError && e.code === 'already_pro') {
          return `account ${tenant} is already on Pro. manage or cancel the plan in the Stripe billing portal: ${e.detail.portal_url}`
        }
        if (e instanceof Outage) throw new Error('checkout could not start because solenoid or Stripe did not answer. nothing was charged. run `solenoid upgrade` again in a minute.')
        throw e
      }
      return [
        (await openUrl(url)) ? 'opening Stripe Checkout in your browser. if it does not open, go to:' : 'open this page in a browser to pay:',
        url,
        `once you pay, account ${tenant} moves to Pro. a 6-digit code then goes to the email you paid with: run \`solenoid email <that address> <code>\` to make it your recovery email.`,
      ].join('\n')
    }
```
These strings are drafts; the copy gate in Step 9 may change any wording outside the frozen parts.

- [ ] **Step 7: Run the CLI suite**

Run: `pnpm --filter @solenoid.systems/sdk build && cd cli && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 8: Mutation gates**

Run: `cd sdk && pnpm run mutate --force`, then `cd cli && pnpm run mutate --force`.
Expected: at least 90 each. Zero survivors in `REFUSED_5XX` and its check, the `already_pro` and `Outage` branches of `upgrade`, `openUrl`'s `BROWSER` choice (killed by the unset-`BROWSER` test and by the missing-opener test), its two events, the darwin choice on this machine, and the ternary between the two first lines. Record as not reachable here: the `win32` branch, and the choice on the other of darwin and Linux. Record the `catch` around `spawn` under Robin's redundant-guard ruling: `spawn` throws synchronously only on an invalid argument, which no environment variable can produce. Also add `BROWSER=true` to `cli/package.json`'s `mutate` script, `"mutate": "STRYKER=1 BROWSER=true HOME=\"$(mktemp -d)\" stryker run"`, as a second guard for any test that forgets the stubs. `git status` clean afterwards.

- [ ] **Step 9: Copy gate on the `upgrade` strings (controller)**

The implementer commits the code with the draft strings, then collects every new string verbatim: the three `upgrade` outputs, the `explain` entry, the `Outage` message and the `HELP` line. The controller gates them as one unit (medium: CLI output; non-closing). Fixes land in `cli/src/commands.ts` and, where a matched string moved, in the tests. Record the grade in `docs/copy/grades/cli-upgrade.md`.

- [ ] **Step 10: Commit**
```bash
git add sdk/src sdk/test cli/src cli/test docs/testing/MUTATION-SUMMARY.md
git commit -m "Add solenoid upgrade, which opens Stripe Checkout or prints the billing portal link"
git add cli/src cli/test docs/copy/grades/cli-upgrade.md
git commit -m "Grade the upgrade command's output"
```

---

### Task 5: Docs: the brief, the SDK README and llms.txt, the testing README, the product README and the runbook

Spec: The copy brief update; Licensing, "The docs follow"; Billing, "Docs"; Copy process (the root README, the changed SDK sections, `testing/README.md`). Decision 11. This task changes words only.

**Files:**
- Modify: `docs/copy/brief.md`, `sdk/README.md`, `sdk/llms.txt`, `README.md`
- Create: `testing/README.md`, `docs/runbook.md` (moved from `README.md`)

- [ ] **Step 1: Update the brief (not graded; it is the brief).** In `docs/copy/brief.md`:
  - Replace the Guardrails bullet on line 64 with:
```markdown
- **Every call to action says what happens next**, for example: "`npx @solenoid.systems/cli init <scope>` writes a spend key to `.env` in your terminal". Key it for attribution (a `?ref=` tag on links, or a distinct init source).
```
  - Replace the table under "## 5. Proof inventory" with the spec's table, verbatim:
```markdown
| Claim | Source | Status |
|---|---|---|
| Exactly N of M concurrent spends are recorded | The first test in `e2e/test/concurrency.test.ts` at the launch tag (30 spends, limit 7); its recorded replay is the landing demo, from `e2e/record-race.ts` | at repo launch |
| Parallel model calls are held before the provider call | The hold-and-settle test in the same file, at the launch tag | at repo launch |
| At-most-once from the same primitive | The `per: "child"` test in the same file, at the launch tag | at repo launch |
| Signed receipts verify offline | `verifyChain([receipt], keys)` exported from `@solenoid.systems/sdk`, with `keys` saved from `/.well-known/solenoid.json` | live |
| No signup form | `npx @solenoid.systems/cli init <scope>`, recorded | at npm publish |
| Fails closed; `on_outage` per limit | The docs | live |
| The admin key can be recovered by email | The README's Recovery section | live |
| You can read and run the code | The `LICENSE` files and `LICENSING.md`. The Worker is "source-available" under FSL-1.1-ALv2 and is **never** called "open source", because FSL is not an OSI license. The SDK, CLI and MCP are MIT. | at repo launch |
| Pricing | `/pricing` | at site launch |
| Dogfooded by learning-loop | **Struck.** The integration was dropped (learning-loop PR #131, closed 2026-09-28). | struck |
| Any latency figure | Not claimable: the numbers are from the old stack | blocked |
| "At the edge" | Never | banned |
| Named competitor comparisons | Leave them out. If one is ever needed, cite and date it from the competitor analysis. | avoid |
```
  The reader, awareness stages, sophistication stage, offer and incident table stay as they are.

- [ ] **Step 2: Move the runbook.** `git mv README.md docs/runbook.md`. In `docs/runbook.md`, change the H1 to `# Solenoid runbook`, and append:
````markdown
## Billing (Stripe)

The API Worker bills through Stripe with five secrets, set like the others in step 3 of Deploy, from the "Solenoid Worker secrets" item:

| Secret | What it is |
|---|---|
| `STRIPE_SECRET_KEY` | A restricted key with write access to Checkout Sessions, billing portal sessions, meter events and subscriptions. The last lets the webhook cancel a second subscription opened by a race; it mails security@solenoid.systems, and the payment is refunded by hand. |
| `STRIPE_WEBHOOK_SECRET` | The signing secret of the endpoint `https://api.solenoid.systems/billing/stripe`, which listens for `checkout.session.completed` and `customer.subscription.deleted` |
| `STRIPE_PRICE_PRO` | The $29 USD monthly licensed price |
| `STRIPE_PRICE_SPENDS` | The metered monthly price on the `spends` meter: 0 to 2,000,000 at $0, then 0.001 cents each |
| `STRIPE_PORTAL_CONFIG` | A billing portal configuration that cancels at the end of the period |

```bash
cd worker
for s in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_PRICE_PRO STRIPE_PRICE_SPENDS STRIPE_PORTAL_CONFIG; do
  op read "op://Personal/Solenoid Worker secrets/$s" | tr -d '\n' | pnpm exec wrangler secret put "$s"
done
```

Until all five are set, `POST /billing/checkout` and `POST /billing/stripe` answer `503 billing_unavailable`, and `solenoid upgrade` says billing is not open yet.
````
  If Task 0 recorded extra permissions on the restricted key, add a sentence under the table naming each one.
  Then check the runbook's own claims still hold after the move: its paths (`worker/scripts/gen-secrets.mjs`, `cli/dist/solenoid.mjs`) are relative to the repository root, so they do.

- [ ] **Step 3: Commit the brief and the runbook** (neither is a copy unit)
```bash
git add docs/copy/brief.md docs/runbook.md
git commit -m "Update the brief's proof inventory for launch and move the runbook to docs/"
```
From here until Step 9, `README.md` does not exist in the index; Step 6 writes the new one.

- [ ] **Step 4: Draft the changed SDK sections (copy)**
  - `sdk/README.md:9`, the last two sentences of the paragraph, become: "The first 100,000 spends each UTC calendar month are free. Past that, the free plan refuses every spend until the month turns, and Pro, $29 USD a month with 2M spends and then $10 USD per extra million, keeps them going: run `npx @solenoid.systems/cli upgrade`. Only spends Solenoid records count. Refused spends, replays of an earlier spend, and attempts that never reach Solenoid don't."
  - `sdk/README.md:374` becomes: "On the free plan, after 100,000 recorded spends in a UTC calendar month, `spend` throws `LimitExceeded` with unit `spends` at scope `""`. Check `e.unit` if you map `LimitExceeded` to your own budget error. Pro has no such cap."
  - `sdk/README.md`, the Errors table's `SolenoidError` row: add "Status 409: `already_pro`, and status 503: `billing_unavailable`, both from `checkout()`, which `solenoid upgrade` calls. `checkout()`, on an admin-key client, returns `{ url }`, the Stripe Checkout page for Pro; on Pro it throws `already_pro`, whose `detail.portal_url` is the billing portal."
  - `sdk/README.md:166`, the Recovery errors paragraph: "A network failure, or a 5xx other than `email_failed` and `billing_unavailable`, throws `Outage`, and neither is retried."
  - `sdk/README.md`, "## Testing": the paragraph's first two sentences become "`testServer()`, from `@solenoid.systems/testing`, runs Solenoid inside your test process. It is the hosted API's own request handler and ledger code, so the package is licensed FSL-1.1-ALv2, unlike the MIT SDK. Install it with `npm i -D @solenoid.systems/testing`." Both code samples import `testServer` from `'@solenoid.systems/testing'`.
  - `sdk/llms.txt:3`: the free-plan sentence becomes "The first 100,000 spends each UTC calendar month are free; past that, the free plan refuses every spend until the month turns, and Pro ($29 USD a month with 2M spends, then $10 USD per extra million, bought with npx @solenoid.systems/cli upgrade, which the developer runs) keeps them going."
  - `sdk/llms.txt:21`: "Billing: one spend is one of the free 100,000, or of Pro's 2M. One llm call is one spend (see Model calls)."
  - `sdk/llms.txt:48`: "On the free plan, past 100,000 spends in a month: LimitExceeded with unit "spends" at scope "". Check e.unit before mapping LimitExceeded to a budget error of your own."
  - `sdk/llms.txt:80`, the Errors line: "A network failure, or a 5xx other than email_failed and billing_unavailable, throws Outage".
  - `sdk/llms.txt:83`: "testServer() from @solenoid.systems/testing (npm i -D @solenoid.systems/testing; FSL-1.1-ALv2, since it bundles the hosted API's own request handler and ledger code) runs Solenoid inside the test process…", the rest unchanged. Every `import { testServer } from '@solenoid.systems/sdk/testing'` becomes `from '@solenoid.systems/testing'`.

- [ ] **Step 5: Draft `testing/README.md` (copy)**
````markdown
# @solenoid.systems/testing

`testServer()` runs Solenoid inside your test process, so your tests hit the same limit checks your agent does and no request leaves the process. It is the hosted API's own request handler and ledger code, over in-memory `node:sqlite`.

It needs Node 22.5 or later, and Node 22.5 to 22.12 and 23.0 to 23.3 also need the `--experimental-sqlite` flag ([Node SQLite docs](https://nodejs.org/api/sqlite.html)).

```sh
npm i -D @solenoid.systems/testing @solenoid.systems/sdk
```

```ts
import { solenoid } from '@solenoid.systems/sdk'
import { testServer } from '@solenoid.systems/testing'

const server = await testServer()
const { admin_key } = await server.signup()
const admin = solenoid({ key: admin_key, api: server.api, fetch: server.fetch })
```

`await testServer()` returns `fetch`, `api`, `signup()`, `setNow(ms)`, `outage(on)`, `outbox()` and `mailDown(on)`. The SDK README's Testing section describes each one: https://solenoid.systems/docs#testing

## License

FSL-1.1-ALv2, because it contains the Solenoid server's code. You may use it for any purpose except a Competing Use, which is making it available to others in a commercial product or service that substitutes for Solenoid or offers substantially similar functionality. Each version becomes Apache 2.0 on the second anniversary of its release. The SDK, CLI and MCP are MIT. See `LICENSING.md` in the repository.
````

- [ ] **Step 6: Draft the product `README.md` (copy)**
````markdown
# Solenoid

Limits on the actions your AI agents take, checked before each action, with a signed receipt for every one.

Your agent's tools call Solenoid before they send an email, issue a refund or delete a record. A call that would go past its limit is refused, and the action never runs. Solenoid only limits the tools that call it first.

## Start

In your project's root:

```sh
npx @solenoid.systems/cli init support-bot
```

It creates your account with no signup form, prints the admin key once, and writes a spend key for `support-bot` to `.env` as `SOLENOID_KEY`. Then point your coding agent at https://solenoid.systems/llms.txt.

Docs: https://solenoid.systems/docs. Pricing: https://solenoid.systems/pricing.

## What is here

| Directory | What | License |
|---|---|---|
| `worker/` | The API: one Cloudflare Worker and one Durable Object per account | FSL-1.1-ALv2 |
| `testing/` | `@solenoid.systems/testing`, the API in your test process | FSL-1.1-ALv2 |
| `e2e/` | End-to-end tests against a local Worker, the race recorder and the canary | FSL-1.1-ALv2 |
| `sdk/` | `@solenoid.systems/sdk` | MIT |
| `cli/` | `@solenoid.systems/cli` | MIT |
| `mcp/` | `@solenoid.systems/mcp` | MIT |
| `site/` | solenoid.systems | MIT |

`LICENSING.md` maps every directory to its license. The server is source-available under FSL-1.1-ALv2; each version becomes Apache 2.0 two years after its release.

Report a security issue to security@solenoid.systems (see `SECURITY.md`). The runbook is `docs/runbook.md`.
````
  `LICENSING.md` and `SECURITY.md` land in Task 12; the README names them now, and Task 13's link check covers the site, not this file.

- [ ] **Step 7: Check every claim and code block against the code**
  - Run both SDK README Testing samples and the llms.txt samples exactly as written, importing `testServer` from `../../testing/src/index` in a scratch file inside the sandboxed test layout (for example a temporary `testing/test/docs-sample.test.ts`, deleted before commit).
  - `grep -n "sdk/testing" sdk/README.md sdk/llms.txt` prints nothing.
  - `perl -CSD -ne 'print "$ARGV:$.: $_" if /[\x{2013}\x{2014}]/; close ARGV if eof' README.md testing/README.md sdk/README.md sdk/llms.txt` prints nothing.

- [ ] **Step 8: Copy gate (controller).** Four units, non-closing, medium in brackets: the changed `sdk/README.md` sections (developer SDK README), the changed `sdk/llms.txt` lines (llms.txt for coding agents), `testing/README.md` (npm README), the product `README.md` (GitHub repository README; it shows the `init` command but no price or buying action, so it is non-closing unless a grader argues otherwise), and nothing else. `testing/README.md` cites the Node docs: run `copy-source-checker`. Grade files: `docs/copy/grades/sdk-readme.md` and `docs/copy/grades/sdk-llms.md` gain a "Plan 3a" round; `docs/copy/grades/testing-readme.md` and `docs/copy/grades/root-readme.md` are new.

- [ ] **Step 9: Commit**
```bash
git add README.md sdk/README.md sdk/llms.txt testing/README.md docs/copy/grades
git commit -m "Document Pro, solenoid upgrade and @solenoid.systems/testing, and give the repository a product README"
```

---

### Task 6: Site scaffold, `/docs`, `/llms.txt` and `/llms-full.txt`

Spec: Architecture; "What comes over from the old site"; Pages (`/docs`, `/llms.txt`, `/llms-full.txt`); Testing, "Single source". Success criterion 4.

**Files:**
- Create:
  - `site/package.json`, `site/astro.config.ts`, `site/tailwind.config.ts`, `site/tsconfig.json`, `site/vitest.config.ts`, `site/test/setup.ts`
  - `site/src/styles/global.css`, `site/src/lib/design-tokens.ts` (copied), `site/src/lib/pixi/{magnetic-field-singleton,field-renderer,title-renderer,field-config,utils}.ts` (copied), `site/src/lib/shiki-theme.ts`, `site/src/lib/links.ts`, `site/src/lib/sources.ts`
  - `site/src/layouts/Layout.astro`, `site/src/components/{MagneticField,MagneticFieldTitle,Header,Footer}.astro`
  - `site/src/pages/index.astro` (a shell Task 9 fills), `site/src/pages/docs.astro`, `site/src/pages/llms.txt.ts`, `site/src/pages/llms-full.txt.ts`
  - `site/public/favicon.svg`, `site/public/fonts/` (five woff2 files, two OFL texts)
  - `site/scripts/lib/html.mjs`, `site/scripts/lib/files.mjs`, `site/scripts/lib/single-source.mjs`, `site/scripts/unit-text.mjs`
  - `site/test/carried.test.ts`, `site/test/html.test.ts`, `site/test/single-source.test.ts`, `site/test/dist/dist.ts`, `site/test/dist/pages.test.ts`
- Modify: `pnpm-workspace.yaml` (add `site`), `.gitignore` (add `.astro/`)

**Interfaces:**
- Produces:
  - `Layout.astro` props `{ title: string; description: string; hasField?: boolean }` (default `true`). Every page passes a graded `description`.
  - `Header.astro` props `{ pathname: string }`; `Footer.astro` no props.
  - `site/src/lib/links.ts`: `SITE = 'https://solenoid.systems'`, `REPO = 'https://github.com/robinslange/solenoid'`, `LAUNCH_TAG = 'launch'`, `atTag(path: string): string` → `${REPO}/blob/launch/${path}`.
  - `site/src/lib/sources.ts`: `repoFile(path: string): string`, read relative to the repository root (the site builds with `site/` as its working directory, which `pnpm --filter` guarantees).
  - `site/scripts/lib/html.mjs`: `walk(node)`, `attr(node, name)`, `root(html)`, `elementById(html, id)`, `headingIds(node)`, `textOf(node)` (block-aware, skips `script`, `style`, `template`, `noscript`), `textNodes(html, skip)` (a list of text-node values).
  - `site/scripts/lib/files.mjs`: `listFiles(dir): string[]` (paths relative to `dir`, `/`-separated, sorted).
  - `site/scripts/lib/single-source.mjs`: `checkSingleSource(dist: string, repoRoot: string): string[]`, one problem per string, empty when clean.
  - `site/test/dist/dist.ts`: `DIST`, `REPO_ROOT`, `readDist(path)`, `htmlPages()`; throws "site/dist is missing…" when there is no build.
  - `site/package.json` scripts: `build`, `test` (build, then every test), `test:changed` (fast tests only, `test/dist/**` excluded), `typecheck` (`astro check`).

- [ ] **Step 1: The package skeleton**

`pnpm-workspace.yaml`: `packages: [worker, testing, sdk, cli, mcp, e2e, site]`. `.gitignore`: add a line `.astro/`.

`site/package.json`:
```json
{
  "name": "@solenoid/site",
  "private": true,
  "type": "module",
  "license": "MIT",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "test": "astro build && vitest run",
    "test:changed": "vitest run --changed --passWithNoTests --exclude \"test/dist/**\"",
    "typecheck": "astro check",
    "screenshots": "node scripts/screenshots.mjs",
    "old-paths": "node scripts/old-paths.mjs",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.6",
    "@astrojs/sitemap": "^3.7.0",
    "@astrojs/tailwind": "^6.0.2",
    "@solenoid.systems/sdk": "workspace:*",
    "@tailwindcss/typography": "^0.5.19",
    "@types/node": "^22.5.0",
    "astro": "^5.17.1",
    "pixi.js": "^8.15.0",
    "tailwindcss": "^3.4.19",
    "typescript": "^5.6.0",
    "vitest": "^4.1.10",
    "wrangler": "4.136.3"
  }
}
```
`@types/node` is what lets `astro check` resolve `node:fs`, `node:crypto` and the `node:sqlite` types that the receipt test pulls in through `testing/src/sql.ts`; pnpm does not hoist it from the other packages. `wrangler` is pinned to the version `worker/` resolves (Decision 20). Check after `pnpm install`: `site/node_modules/.bin/wrangler --version` prints `4.136.3`. Then `pnpm --filter @solenoid/site add -D parse5 github-slugger playwright`; the lockfile pins their versions. The `screenshots` and `old-paths` scripts land in Tasks 13 and 11.

`site/tsconfig.json`:
```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } },
  "include": [".astro/types.d.ts", "src", "test", "scripts", "astro.config.ts", "tailwind.config.ts", "vitest.config.ts"]
}
```

`site/vitest.config.ts`:
```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: { alias: [{ find: /^@solenoid\.systems\/sdk$/, replacement: fileURLToPath(new URL('../sdk/src/index.ts', import.meta.url)) }] },
  test: { setupFiles: ['test/setup.ts'], testTimeout: 60_000, hookTimeout: 180_000 },
})
```

`site/test/setup.ts`: the SDK's `test/setup.ts`, verbatim (Task 1, Step 3).

Run `pnpm install`.

- [ ] **Step 2: Write the failing tests**

`site/test/carried.test.ts`:
```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listFiles } from '../scripts/lib/files.mjs'

const site = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))
const FONTS = ['archivo-latin-400-normal.woff2', 'archivo-latin-500-normal.woff2', 'archivo-latin-700-normal.woff2', 'archivo-latin-900-normal.woff2', 'jetbrains-mono-latin-400-normal.woff2']

describe('what came over from the old site', () => {
  it('ships the five font files, each named by exactly one local @font-face rule, with the OFL beside them', () => {
    expect(readdirSync(site('public/fonts')).filter((f) => f.endsWith('.woff2')).sort()).toEqual(FONTS)
    const layout = readFileSync(site('src/layouts/Layout.astro'), 'utf8')
    expect([...layout.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((m) => m[1]).sort()).toEqual(FONTS)
    expect(layout).not.toMatch(/@fontsource/)
    for (const f of ['OFL-Archivo.txt', 'OFL-JetBrainsMono.txt']) expect(readFileSync(site(`public/fonts/${f}`), 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })

  it('asks for no JetBrains Mono weight that has no file', () => {
    for (const f of listFiles(site('src')).filter((p) => /\.(astro|ts)$/.test(p))) {
      for (const [, cls] of readFileSync(site(`src/${f}`), 'utf8').matchAll(/class(?::list)?=\{?["'`[]([^"'`\]]*)/g)) {
        if (/\bfont-mono\b/.test(cls)) expect(cls, `${f}: ${cls}`).not.toMatch(/\bfont-(medium|semibold|bold|extrabold|black)\b/)
      }
    }
  })

  it('has no view transitions, page-load events or [DIAG] logging', () => {
    for (const f of listFiles(site('src'))) {
      const text = readFileSync(site(`src/${f}`), 'utf8')
      expect(text, f).not.toMatch(/ClientRouter|astro:page-load|astro:after-swap|transition:persist|\[DIAG\]|console\.log/)
    }
  })

  it('keeps the favicon', () => {
    expect(existsSync(site('public/favicon.svg'))).toBe(true)
  })
})
```

`site/test/html.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { elementById, headingIds, textNodes, textOf } from '../scripts/lib/html.mjs'

const PAGE = '<html><head><style>.a{}</style></head><body><section id="hero"><h1 id="x">One <code>init</code></h1><p>Two</p><script>var s = "no"</script><!-- note --></section></body></html>'

describe('html helpers', () => {
  it('finds an element by id, its heading ids, and its text by block', () => {
    const hero = elementById(PAGE, 'hero')!
    expect(headingIds(hero)).toEqual(['x'])
    expect(textOf(hero)).toBe('One init\nTwo')
    expect(elementById(PAGE, 'nope')).toBeNull()
  })
  it('lists text nodes without script, style, comments or the skipped tags', () => {
    expect(textNodes(PAGE, new Set(['script', 'style', 'code']))).toEqual(['One ', 'Two'])
  })
})
```

`site/test/single-source.test.ts`:
```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { checkSingleSource } from '../scripts/lib/single-source.mjs'

const LLMS = '# Solenoid\n\nThe first line…\n'
const README = '# @solenoid.systems/sdk\n\n## Quickstart\n\n```sh\n# not a heading\n```\n\n## Model calls: `at(scope).llm` and `run`\n'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const DOCS = (hash = sha(README), ids = ['solenoidsystemssdk', 'quickstart', 'model-calls-atscopellm-and-run']) =>
  `<html><body><article id="readme" data-source-sha256="${hash}">${ids.map((id) => `<h2 id="${id}">x</h2>`).join('')}</article></body></html>`

function fixture(o: { llms?: string; full?: string; docs?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'site-single-'))
  mkdirSync(join(root, 'sdk'))
  mkdirSync(join(root, 'dist'))
  writeFileSync(join(root, 'sdk/llms.txt'), LLMS)
  writeFileSync(join(root, 'sdk/README.md'), README)
  writeFileSync(join(root, 'dist/llms.txt'), o.llms ?? LLMS)
  writeFileSync(join(root, 'dist/llms-full.txt'), o.full ?? `${LLMS}\n${README}`)
  writeFileSync(join(root, 'dist/docs.html'), o.docs ?? DOCS())
  return { dist: join(root, 'dist'), root }
}

describe('checkSingleSource', () => {
  it('passes a build made from the current files', () => {
    const f = fixture()
    expect(checkSingleSource(f.dist, f.root)).toEqual([])
  })
  it('fails on one changed byte in either text file, or a missing separator', () => {
    for (const o of [{ llms: LLMS.replace('…', '...') }, { full: `${LLMS}${README}` }, { full: `${LLMS}\n${README}\n` }]) {
      const f = fixture(o)
      expect(checkSingleSource(f.dist, f.root)).toHaveLength(1)
    }
  })
  it('fails when /docs was built from another README or renders other headings', () => {
    for (const docs of [DOCS(sha('old')), DOCS(undefined, ['solenoidsystemssdk', 'quickstart']), '<html><body></body></html>']) {
      const f = fixture({ docs })
      expect(checkSingleSource(f.dist, f.root)).toHaveLength(1)
    }
  })
})
```

`site/test/dist/dist.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFiles } from '../../scripts/lib/files.mjs'

export const DIST = fileURLToPath(new URL('../../dist', import.meta.url))
export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const built = () => { if (!existsSync(join(DIST, 'index.html'))) throw new Error('site/dist is missing: run pnpm --filter @solenoid/site build first (pnpm test does)') }
export const readDist = (p: string) => { built(); return readFileSync(join(DIST, p), 'utf8') }
export const htmlPages = () => { built(); return listFiles(DIST).filter((p) => p.endsWith('.html')) }
```

`site/test/dist/pages.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { checkSingleSource } from '../../scripts/lib/single-source.mjs'
import { attr, root, walk } from '../../scripts/lib/html.mjs'
import { DIST, REPO_ROOT, htmlPages, readDist } from './dist'

const metas = (html: string) => {
  const out: Record<string, string> = {}
  for (const n of walk(root(html))) {
    if (n.nodeName === 'meta') out[attr(n, 'name') ?? attr(n, 'property') ?? ''] = attr(n, 'content') ?? ''
    if (n.nodeName === 'link' && attr(n, 'rel') === 'canonical') out.canonical = attr(n, 'href') ?? ''
  }
  return out
}

describe('the built site', () => {
  it('serves llms.txt, llms-full.txt and /docs from the SDK files and nothing else', () => {
    expect(checkSingleSource(DIST, REPO_ROOT)).toEqual([])
  })
  it('gives every page a description, an apex canonical link, and Open Graph and Twitter text tags', () => {
    for (const page of htmlPages()) {
      const m = metas(readDist(page))
      expect(m.description, page).toMatch(/\S/)
      expect(m.canonical, page).toMatch(/^https:\/\/solenoid\.systems(\/|$)/)
      for (const k of ['og:title', 'og:description', 'twitter:card', 'twitter:title', 'twitter:description']) expect(m[k], `${page} ${k}`).toMatch(/\S/)
    }
  })
  it('draws the magnetic field on the landing page and not on /docs', () => {
    expect(readDist('index.html')).toContain('id="magnetic-field"')
    expect(readDist('docs.html')).not.toContain('id="magnetic-field"')
  })
  it('builds /pricing-style flat files and a sitemap under the old names', () => {
    expect(htmlPages()).toEqual(expect.arrayContaining(['index.html', 'docs.html']))
    expect(readDist('sitemap-index.xml')).toContain('https://solenoid.systems/sitemap-0.xml')
    expect(readDist('sitemap-0.xml')).toContain('<loc>https://solenoid.systems/docs</loc>')
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd site && pnpm vitest run`
Expected: FAIL: `../scripts/lib/*.mjs` do not exist, and `dist/` is missing.

- [ ] **Step 4: Copy what comes over**
```bash
OLD=~/dev/solenoid.systems
mkdir -p site/src/lib/pixi site/public/fonts site/src/styles site/src/layouts site/src/components site/src/pages site/src/data site/scripts/lib site/test/dist
cp $OLD/src/lib/design-tokens.ts site/src/lib/
cp $OLD/src/lib/pixi/{magnetic-field-singleton,field-renderer,title-renderer,field-config,utils}.ts site/src/lib/pixi/
sed -i '' '/\[DIAG\]/d' site/src/lib/pixi/field-renderer.ts
cp $OLD/public/fonts/*.woff2 site/public/fonts/
cp $OLD/node_modules/@fontsource/archivo/LICENSE site/public/fonts/OFL-Archivo.txt
cp $OLD/node_modules/@fontsource/jetbrains-mono/LICENSE site/public/fonts/OFL-JetBrainsMono.txt
cp $OLD/public/favicon.svg site/public/
grep -rn "console\.\|astro:" site/src/lib/pixi
```
Expected: the last command prints nothing. If it prints a line, remove that statement by hand and keep the code around it valid.

- [ ] **Step 5: Config, styles and the small libs**

`site/astro.config.ts`:
```ts
import sitemap from '@astrojs/sitemap'
import tailwind from '@astrojs/tailwind'
import { defineConfig } from 'astro/config'
import { fileURLToPath } from 'node:url'
import { solenoidTheme } from './src/lib/shiki-theme'

export default defineConfig({
  site: 'https://solenoid.systems',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [tailwind({ applyBaseStyles: false }), sitemap()],
  markdown: { shikiConfig: { theme: solenoidTheme } },
  vite: { resolve: { alias: { '@': fileURLToPath(new URL('./src/', import.meta.url)) } } },
})
```

`site/tailwind.config.ts`: the old `tailwind.config.ts` with two changes: `content: ['./src/**/*.{astro,html,js,ts,md}']`, and the plugin as an import:
```ts
import typography from '@tailwindcss/typography'
import type { Config } from 'tailwindcss'
import { colors } from './src/lib/design-tokens'

export default {
  content: ['./src/**/*.{astro,html,js,ts,md}'],
  theme: {
    extend: {
      colors: { background: colors.background, text: colors.text, accent: colors.accent },
      fontFamily: { sans: ['Archivo', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
      typography: { invert: { css: { '--tw-prose-body': colors.text, '--tw-prose-headings': colors.accent, fontFamily: 'Archivo, sans-serif' } } },
      keyframes: { 'cursor-blink': { '0%, 49%': { opacity: '1' }, '50%, 100%': { opacity: '0' } } },
      animation: { 'cursor-blink': 'cursor-blink 1s step-end infinite' },
    },
  },
  plugins: [typography],
} satisfies Config
```

`site/src/styles/global.css` (the old file without the page-transition rule):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`site/src/lib/shiki-theme.ts`:
```ts
import { colors } from './design-tokens'

export const solenoidTheme = {
  name: 'solenoid',
  type: 'dark' as const,
  colors: { 'editor.background': '#0a0a0b', 'editor.foreground': colors.text },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#71717a' } },
    { scope: ['string', 'string.quoted', 'string.template'], settings: { foreground: colors.accent } },
    { scope: ['keyword', 'storage', 'keyword.control', 'keyword.operator'], settings: { foreground: '#a1a1aa' } },
    { scope: ['constant.numeric', 'constant.language', 'variable', 'entity.name.function', 'support.function'], settings: { foreground: colors.text } },
  ],
}
```

`site/src/lib/links.ts`:
```ts
export const SITE = 'https://solenoid.systems'
export const REPO = 'https://github.com/robinslange/solenoid'
export const LAUNCH_TAG = 'launch'
export const atTag = (path: string): string => `${REPO}/blob/${LAUNCH_TAG}/${path}`
```

`site/src/lib/sources.ts`:
```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')
export const repoFile = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8')
```

`site/scripts/lib/files.mjs`:
```js
import { readdirSync } from 'node:fs'

export const listFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => `${d.parentPath}/${d.name}`.slice(dir.length + 1).split('\\').join('/'))
    .sort()
```

`site/scripts/lib/html.mjs`:
```js
import { parse } from 'parse5'

const HIDDEN = new Set(['script', 'style', 'template', 'noscript'])
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'nav', 'main', 'ol', 'ul', 'li', 'pre', 'table', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'figure', 'figcaption', 'blockquote'])

export const root = (html) => parse(html)
export const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value

export function* walk(node) {
  yield node
  for (const c of node.childNodes ?? []) yield* walk(c)
}

export function elementById(html, id) {
  for (const n of walk(root(html))) if (attr(n, 'id') === id) return n
  return null
}

export const headingIds = (node) => [...walk(node)].filter((n) => /^h[1-6]$/.test(n.nodeName)).map((n) => attr(n, 'id'))

export function textOf(node) {
  let out = ''
  const visit = (n) => {
    if (HIDDEN.has(n.nodeName)) return
    if (n.nodeName === '#text') out += n.value
    if (BLOCK.has(n.nodeName)) out += '\n'
    for (const c of n.childNodes ?? []) visit(c)
    if (BLOCK.has(n.nodeName)) out += '\n'
  }
  visit(node)
  return out.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}

export function textNodes(html, skip) {
  const out = []
  const visit = (n) => {
    if (skip.has(n.nodeName)) return
    if (n.nodeName === '#text' && n.value.trim()) out.push(n.value)
    for (const c of n.childNodes ?? []) visit(c)
  }
  visit(root(html))
  return out
}
```
parse5 puts comments in `#comment` nodes, so neither walker ever reads them.

`site/scripts/lib/single-source.mjs`:
```js
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import GithubSlugger from 'github-slugger'
import { attr, elementById, headingIds } from './html.mjs'

const plain = (s) => s.replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

function readmeSlugs(md) {
  const slugger = new GithubSlugger()
  const out = []
  let fence = false
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) fence = !fence
    const m = !fence && /^#{1,6}\s+(.*?)\s*$/.exec(line)
    if (m) out.push(slugger.slug(plain(m[1])))
  }
  return out
}

export function checkSingleSource(dist, repoRoot) {
  const problems = []
  const llms = readFileSync(join(repoRoot, 'sdk/llms.txt'))
  const readme = readFileSync(join(repoRoot, 'sdk/README.md'))
  if (!readFileSync(join(dist, 'llms.txt')).equals(llms)) problems.push('dist/llms.txt differs from sdk/llms.txt')
  if (!readFileSync(join(dist, 'llms-full.txt')).equals(Buffer.concat([llms, Buffer.from('\n'), readme]))) problems.push('dist/llms-full.txt differs from sdk/llms.txt, then one newline, then sdk/README.md')
  const article = existsSync(join(dist, 'docs.html')) ? elementById(readFileSync(join(dist, 'docs.html'), 'utf8'), 'readme') : null
  if (!article) problems.push('dist/docs.html has no <article id="readme">')
  else if (attr(article, 'data-source-sha256') !== createHash('sha256').update(readme).digest('hex')) problems.push('/docs was built from another sdk/README.md; rebuild the site')
  else if (JSON.stringify(headingIds(article)) !== JSON.stringify(readmeSlugs(readme.toString()))) problems.push(`/docs renders headings ${JSON.stringify(headingIds(article))}, and sdk/README.md has ${JSON.stringify(readmeSlugs(readme.toString()))}`)
  return problems
}
```

`site/scripts/unit-text.mjs`:
```js
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { attr, elementById, root, textOf, walk } from './lib/html.mjs'
import { listFiles } from './lib/files.mjs'

const [a, b] = process.argv.slice(2)
if (a === '--meta' && b) {
  for (const page of listFiles(b).filter((p) => p.endsWith('.html'))) {
    const nodes = [...walk(root(readFileSync(join(b, page), 'utf8')))]
    const title = nodes.find((n) => n.nodeName === 'title')?.childNodes?.[0]?.value ?? ''
    const description = attr(nodes.find((n) => n.nodeName === 'meta' && attr(n, 'name') === 'description') ?? {}, 'content') ?? ''
    process.stdout.write(`${page}\n  title: ${title}\n  description: ${description}\n`)
  }
} else if (a) {
  const html = readFileSync(a, 'utf8')
  const node = b ? elementById(html, b.replace(/^#/, '')) : [...walk(root(html))].find((n) => n.nodeName === 'body')
  if (!node) { console.error(`no element ${b} in ${a}`); process.exit(1) }
  process.stdout.write(`${textOf(node)}\n`)
} else {
  console.error('usage: node site/scripts/unit-text.mjs <page.html> [#id] | --meta <dist dir>')
  process.exit(2)
}
```

- [ ] **Step 6: The layout, the components and the pages**

`site/src/layouts/Layout.astro`:
```astro
---
import MagneticField from '@/components/MagneticField.astro'
import { SITE } from '@/lib/links'
import '@/styles/global.css'

interface Props { title: string; description: string; hasField?: boolean }
const { title, description, hasField = true } = Astro.props
const canonical = new URL(Astro.url.pathname, SITE).href
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#101012" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={canonical} />
    <meta property="og:type" content="website" />
    <meta property="og:url" content={canonical} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content={title} />
    <meta name="twitter:description" content={description} />
    <link rel="preload" href="/fonts/archivo-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
    <link rel="preload" href="/fonts/archivo-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
    <link rel="preload" href="/fonts/jetbrains-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <script is:inline defer src="https://analytics.omit.nz/script.js" data-website-id="78242504-0952-4b2b-a131-a728db6aca5d" data-do-not-track="true"></script>
  </head>
  <body class="min-h-screen bg-background text-text font-sans">
    {hasField && <MagneticField />}
    <slot />
  </body>
</html>

<style is:global>
  @font-face { font-family: 'Archivo'; src: url('/fonts/archivo-latin-400-normal.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }
  @font-face { font-family: 'Archivo'; src: url('/fonts/archivo-latin-500-normal.woff2') format('woff2'); font-weight: 500; font-style: normal; font-display: swap; }
  @font-face { font-family: 'Archivo'; src: url('/fonts/archivo-latin-700-normal.woff2') format('woff2'); font-weight: 700; font-style: normal; font-display: swap; }
  @font-face { font-family: 'Archivo'; src: url('/fonts/archivo-latin-900-normal.woff2') format('woff2'); font-weight: 900; font-style: normal; font-display: swap; }
  @font-face { font-family: 'JetBrains Mono'; src: url('/fonts/jetbrains-mono-latin-400-normal.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }
</style>
```

`site/src/components/MagneticField.astro`:
```astro
<canvas id="magnetic-field" class="fixed inset-0 -z-10" aria-hidden="true"></canvas>

<style>
  #magnetic-field {
    -webkit-mask-image: linear-gradient(to bottom, black 0%, black 60vh, transparent 100vh);
    mask-image: linear-gradient(to bottom, black 0%, black 60vh, transparent 100vh);
  }
</style>

<script>
  import { initFieldIfNeeded } from '@/lib/pixi/magnetic-field-singleton'

  const canvas = document.getElementById('magnetic-field') as HTMLCanvasElement | null
  if (canvas) initFieldIfNeeded(canvas).catch(() => canvas.remove())
</script>
```

`site/src/components/MagneticFieldTitle.astro`:
```astro
---
interface Props { text: string }
const { text } = Astro.props
---
<div class="hidden md:flex items-center justify-center h-[30vh] min-h-[220px]" aria-hidden="true">
  <canvas id="magnetic-title" class="max-w-full" data-text={text}></canvas>
</div>

<script>
  import { initTitleIfNeeded } from '@/lib/pixi/magnetic-field-singleton'

  const canvas = document.getElementById('magnetic-title') as HTMLCanvasElement | null
  if (canvas?.dataset.text) initTitleIfNeeded(canvas, canvas.dataset.text)
</script>
```

`site/src/components/Header.astro` (a rewrite in the old styling; the labels are the spec's):
```astro
---
import { REPO } from '@/lib/links'

interface Props { pathname: string }
const { pathname } = Astro.props
const NAV = [
  { label: 'Docs', href: '/docs' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Why', href: '/why' },
  { label: 'GitHub', href: REPO },
]
---
<header class="fixed top-0 left-0 right-0 z-20 px-6 py-5 bg-background/80 backdrop-blur-sm">
  <div class="flex items-center justify-between gap-4">
    <a href="/" class="font-mono text-[11px] tracking-wider text-zinc-400 hover:text-zinc-200 transition-colors">SOLENOID.SYSTEMS</a>
    <nav class="flex gap-1" aria-label="Main">
      {NAV.map((item) => (
        <a href={item.href} class:list={['font-mono text-[11px] uppercase tracking-wider px-2 py-1 transition-colors', pathname === item.href ? 'text-accent' : 'text-zinc-500 hover:text-zinc-300']}>{item.label}</a>
      ))}
    </nav>
  </div>
</header>
```

`site/src/components/Footer.astro` (draft copy; graded in Task 9 with the nav):
```astro
---
import { REPO, atTag } from '@/lib/links'

const LINKS = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Security', href: '/.well-known/security.txt' },
  { label: 'llms.txt', href: '/llms.txt' },
  { label: 'Licensing', href: atTag('LICENSING.md') },
  { label: 'GitHub', href: REPO },
]
---
<footer class="relative z-10 border-t border-[#222] bg-[#050505] px-6 py-10">
  <div class="max-w-3xl mx-auto flex flex-col gap-4 font-mono text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
    <p>Built in Auckland by Robin Lange, trading as omit.</p>
    <nav class="flex flex-wrap gap-4" aria-label="Footer">
      {LINKS.map((l) => <a href={l.href} class="hover:text-zinc-400 transition-colors">{l.label}</a>)}
    </nav>
  </div>
</footer>
```

`site/src/pages/index.astro`, a shell that Tasks 7 and 9 fill:
```astro
---
import Footer from '@/components/Footer.astro'
import Header from '@/components/Header.astro'
import Layout from '@/layouts/Layout.astro'
---
<Layout title="Solenoid: limits on what your AI agents do" description="Your agent's tools call Solenoid before they act. An action past its limit is refused before it runs, and every recorded one returns a signed receipt.">
  <Header pathname="/" />
  <main class="relative z-10"></main>
  <Footer />
</Layout>
```

`site/src/pages/docs.astro`:
```astro
---
import { createHash } from 'node:crypto'
import Footer from '@/components/Footer.astro'
import Header from '@/components/Header.astro'
import Layout from '@/layouts/Layout.astro'
import { repoFile } from '@/lib/sources'
import { Content, getHeadings } from '../../../sdk/README.md'

const sections = getHeadings().filter((h) => h.depth === 2)
const sha = createHash('sha256').update(repoFile('sdk/README.md')).digest('hex')
---
<Layout title="Solenoid docs: the SDK README" description="How to give an agent a spend key, set limits, call spend before each action, hold and settle model calls, and verify receipts offline." hasField={false}>
  <Header pathname="/docs" />
  <div class="relative z-10 max-w-6xl mx-auto px-6 pt-28 pb-16 flex gap-12">
    <nav aria-label="Contents" class="hidden lg:block w-56 shrink-0 sticky top-28 self-start font-mono text-xs">
      <ul class="space-y-2">
        {sections.map((h) => <li><a href={`#${h.slug}`} class="text-zinc-500 hover:text-accent transition-colors">{h.text}</a></li>)}
      </ul>
    </nav>
    <article id="readme" data-source-sha256={sha} class="prose prose-invert max-w-none min-w-0">
      <Content />
    </article>
  </div>
  <Footer />
</Layout>
```
Astro imports `../../../sdk/README.md` from outside `site/`, and `getHeadings()` returns github-slugger IDs that match the README's own `#` links; the review built this with Astro 5.18.2.

`site/src/pages/llms.txt.ts`:
```ts
import type { APIRoute } from 'astro'
import { repoFile } from '@/lib/sources'

export const GET: APIRoute = () => new Response(repoFile('sdk/llms.txt'))
```
`site/src/pages/llms-full.txt.ts`:
```ts
import type { APIRoute } from 'astro'
import { repoFile } from '@/lib/sources'

export const GET: APIRoute = () => new Response(`${repoFile('sdk/llms.txt')}\n${repoFile('sdk/README.md')}`)
```
Both files are UTF-8 with LF line endings and end in one `\n`, so these strings encode back to the same bytes (review round 2).

- [ ] **Step 7: Build and run everything**

Run: `cd site && pnpm typecheck && pnpm test`
Expected: PASS. `dist/` holds `index.html`, `docs.html`, `llms.txt`, `llms-full.txt`, `sitemap-index.xml`, `sitemap-0.xml`, `favicon.svg` and `fonts/`. Then `pnpm test:changed` runs without building and passes.

- [ ] **Step 8: Commit**
```bash
git add pnpm-workspace.yaml pnpm-lock.yaml .gitignore site
git commit -m "Scaffold the site with the Living Schematic look, and serve /docs and the llms files from the SDK"
```
The footer and the shell's title and description are drafts. Their copy gate runs in Task 9.

---

### Task 7: The race recorder and `RaceTerminal`

Spec: The race; Testing, "Race demo"; landing section 2. Decision: none new.

**Files:**
- Create: `e2e/wrangler-dev.ts`, `e2e/record-race.ts`, `e2e/test/record-race.test.ts`, `site/src/data/race.json` (written by the recorder), `site/src/components/RaceTerminal.astro`, `site/test/race.test.ts`, `site/test/dist/race.test.ts`
- Modify: `e2e/global-setup.ts`, `e2e/test/setup.ts`, `e2e/tsconfig.json`, `e2e/package.json`, `site/src/pages/index.astro`

**Interfaces:**
- Produces:
  - `e2e/wrangler-dev.ts`: `type Dev = { api: string; master: string; stop(): Promise<void> }`, `startWranglerDev(): Promise<Dev>`.
  - `e2e/record-race.ts`: `type Call = { n: number; start_ms: number; at_ms: number; outcome: { recorded: string } | { refused: string } }`, `type Race = { limit: number; calls: number; recorded: number; refused: number; lines: { at_ms: number; text: string }[]; sources: Record<string, string> }`, `lineFor(c: Call): string`, `raceFrom(calls: Call[], lsOut: string, sources: Record<string, string>): Race` (throws when a count is off).
  - `RaceTerminal.astro` props `{ race: { limit: number; calls: number; lines: { at_ms: number; text: string }[] } }`, rendering `<ol class="race-lines">` with one `<li data-at="…">` per line.
  - `site/src/data/race.json` in the spec's shape.
  - The e2e script `record-race`.

- [ ] **Step 1: Move the wrangler code into a shared module**

`e2e/wrangler-dev.ts`, the body of today's `global-setup.ts` with the state held per run:
```ts
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Dev = { api: string; master: string; stop(): Promise<void> }

const worker = fileURLToPath(new URL('../worker', import.meta.url))
const devVars = `${worker}/.dev.vars`
const backup = `${worker}/.dev.vars.bak`

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer().once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      server.close(() => done(port))
    })
  })
}

export async function startWranglerDev(): Promise<Dev> {
  if (existsSync(backup)) {
    throw new Error(`refusing to start: ${backup} already exists, which means an earlier run crashed before restoring it. Resolve that by hand before running the e2e tests, so this run can't clobber a real .dev.vars.`)
  }
  const port = await freePort()
  const master = `e2e-master-${crypto.randomUUID()}`
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const signingKey = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const kid = 'e2e'
  if (existsSync(devVars)) renameSync(devVars, backup)
  writeFileSync(devVars, `MASTER=${master}\nSIGNING_KEY='${JSON.stringify(signingKey)}'\nSIGNING_KID=${kid}\n`)
  const state = mkdtempSync(join(tmpdir(), 'solenoid-e2e-state-'))
  const env = { ...process.env }
  delete env.SOLENOID_KEY
  delete env.SOLENOID_API
  let proc: ChildProcess | undefined = spawn(`${worker}/node_modules/.bin/wrangler`, ['dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', state, '--show-interactive-dev-session=false'], { cwd: worker, env, stdio: 'ignore', detached: true })
  let restored = false
  const stop = async () => {
    if (proc?.pid) process.kill(-proc.pid, 'SIGTERM')
    proc = undefined
    if (!restored) {
      restored = true
      unlinkSync(devVars)
      if (existsSync(backup)) renameSync(backup, devVars)
    }
    rmSync(state, { recursive: true, force: true })
  }
  const api = `http://127.0.0.1:${port}`
  for (let i = 0; i < 120; i++) {
    const keys = await fetch(`${api}/.well-known/solenoid.json`).then((r) => (r.ok ? (r.json() as Promise<{ keys: Record<string, JsonWebKey> }>) : null)).then((b) => b?.keys, () => undefined)
    if (keys) {
      if (keys[kid]?.x !== signingKey.x) {
        await stop()
        throw new Error(`refusing to run: the server on 127.0.0.1:${port} does not publish this run's signing key under this run's kid, so it is not the wrangler dev instance this run started. The e2e tests must only ever talk to their own instance, not a stale or foreign one.`)
      }
      return { api, master, stop }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  await stop()
  throw new Error(`wrangler dev did not start on :${port}`)
}
```

`e2e/global-setup.ts`:
```ts
import type { TestProject } from 'vitest/node'
import { startWranglerDev, type Dev } from './wrangler-dev.ts'

declare module 'vitest' {
  interface ProvidedContext { api: string; master: string }
}

let dev: Dev | undefined

export async function setup(project: TestProject) {
  dev = await startWranglerDev()
  project.provide('api', dev.api)
  project.provide('master', dev.master)
}

export async function teardown() {
  await dev?.stop()
  dev = undefined
}
```

`e2e/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "lib": ["ES2022", "DOM"], "types": ["node"], "noEmit": true, "allowImportingTsExtensions": true }, "include": ["test", "global-setup.ts", "vitest.config.ts", "wrangler-dev.ts", "record-race.ts"] }
```

`e2e/test/setup.ts`: after its two `delete process.env…` lines, add the SDK's fetch guard, so no e2e test can reach any host but the local `wrangler dev`:
```ts
const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.hostname !== '127.0.0.1') return Promise.reject(new TypeError(`test setup refuses a real fetch to ${url.origin}; only the local shim on 127.0.0.1 is reachable`))
  return realFetch(input, init)
}
```

Run: `pnpm --filter @solenoid/e2e test && cd e2e && pnpm typecheck`
Expected: PASS, exactly as before the move.

- [ ] **Step 2: Write the failing recorder test**

`e2e/test/record-race.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { lineFor, raceFrom, type Call } from '../record-race.ts'

const LS = 'acme\ncalls        7        lifetime  used 7  left 0  (acme, closed)'
const call = (n: number, at_ms: number, ok: boolean): Call => ({ n, start_ms: n % 3, at_ms, outcome: ok ? { recorded: `rcp_${n}` } : { refused: '402 limit_exceeded' } })
const race = (recorded = 7, total = 30, refusal = '402 limit_exceeded') =>
  Array.from({ length: total }, (_, i) => (i < recorded ? call(i + 1, 90 - i, true) : { ...call(i + 1, 90 - i, false), outcome: { refused: refusal } }))

describe('raceFrom', () => {
  it('keeps the counts, and one line per call ordered by settle time', () => {
    const r = raceFrom(race(), LS, { 'e2e/test/concurrency.test.ts': 'a', 'e2e/record-race.ts': 'b' })
    expect(r).toMatchObject({ limit: 7, calls: 30, recorded: 7, refused: 23, sources: { 'e2e/test/concurrency.test.ts': 'a', 'e2e/record-race.ts': 'b' } })
    expect(r.lines.map((l) => l.at_ms)).toEqual(Array.from({ length: 30 }, (_, i) => 61 + i))
    expect(r.lines[29].text).toBe(lineFor(call(1, 90, true)))
  })
  it('refuses a run whose counts differ from the test, so nothing is written', () => {
    for (const [calls, ls] of [[race(8), LS], [race(6), LS], [race(7, 29), LS], [race(7, 30, '401 invalid_key'), LS], [race(), LS.replace('used 7', 'used 8')]] as const) {
      expect(() => raceFrom([...calls], ls, {})).toThrow('the race did not hold')
    }
  })
})

describe('lineFor', () => {
  it('shows when the spend started and settled, which spend, and its outcome', () => {
    expect(lineFor({ n: 12, start_ms: 1, at_ms: 38, outcome: { recorded: 'rcp_5' } })).toBe('   1 ms →   38 ms  spend 12  recorded as rcp_5')
    expect(lineFor({ n: 3, start_ms: 0, at_ms: 41, outcome: { refused: '402 limit_exceeded' } })).toBe('   0 ms →   41 ms  spend  3  refused: 402 limit_exceeded')
  })
})
```
The `lineFor` text is copy (the race unit, Task 9). If the gate changes it, the test's two strings change with it and the recorder is run again.

- [ ] **Step 3: Run it to verify it fails**

Run: `cd e2e && pnpm vitest run test/record-race.test.ts`
Expected: FAIL, because `../record-race.ts` does not exist.

- [ ] **Step 4: Write the recorder**

`e2e/record-race.ts`:
```ts
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { SolenoidError, solenoid } from '@solenoid.systems/sdk'
import { startWranglerDev } from './wrangler-dev.ts'

export type Call = { n: number; start_ms: number; at_ms: number; outcome: { recorded: string } | { refused: string } }
export type Race = { limit: number; calls: number; recorded: number; refused: number; lines: { at_ms: number; text: string }[]; sources: Record<string, string> }

const LIMIT = 7
const CALLS = 30
const REFUSAL = '402 limit_exceeded'
const root = fileURLToPath(new URL('..', import.meta.url))
const SOURCES = ['e2e/test/concurrency.test.ts', 'e2e/record-race.ts']

const ms = (n: number) => `${String(n).padStart(4)} ms`
export const lineFor = (c: Call): string =>
  `${ms(c.start_ms)} → ${ms(c.at_ms)}  spend ${String(c.n).padStart(2)}  ${'recorded' in c.outcome ? `recorded as ${c.outcome.recorded}` : `refused: ${c.outcome.refused}`}`

export function raceFrom(calls: Call[], lsOut: string, sources: Record<string, string>): Race {
  const recorded = calls.filter((c) => 'recorded' in c.outcome).length
  const refused = calls.filter((c) => 'refused' in c.outcome && c.outcome.refused === REFUSAL).length
  if (calls.length !== CALLS || recorded !== LIMIT || refused !== CALLS - LIMIT || !/^calls +7 +lifetime +used 7 +left 0 /m.test(lsOut)) {
    throw new Error(`the race did not hold: ${recorded} recorded and ${refused} refused with ${REFUSAL}, of ${calls.length}; ls acme printed:\n${lsOut}`)
  }
  const lines = [...calls].sort((a, b) => a.at_ms - b.at_ms).map((c) => ({ at_ms: c.at_ms, text: lineFor(c) }))
  return { limit: LIMIT, calls: CALLS, recorded, refused, lines, sources }
}

async function main(): Promise<void> {
  const dev = await startWranglerDev()
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'solenoid-race-')))
  try {
    const home = join(box, 'home')
    const cwd = join(box, 'project')
    mkdirSync(home)
    mkdirSync(cwd)
    const env = { PATH: process.env.PATH, HOME: home, SOLENOID_CONFIG_DIR: join(home, '.config', 'solenoid'), SOLENOID_API: dev.api }
    const cli = async (...args: string[]) => (await promisify(execFile)(process.execPath, [join(root, 'cli/dist/solenoid.mjs'), ...args], { cwd, env, encoding: 'utf8' })).stdout.trimEnd()
    await cli('init')
    await cli('limit', 'acme', `calls=${LIMIT}`)
    const key = await cli('key', 'acme/bot')
    const t0 = performance.now()
    const now = () => Math.round(performance.now() - t0)
    const calls = await Promise.all(Array.from({ length: CALLS }, async (_, i): Promise<Call> => {
      const start_ms = now()
      const outcome = await solenoid({ key, api: dev.api }).spend('acme/bot', { calls: 1 }).then(
        (r) => ({ recorded: r!.id }),
        (e: unknown) => ({ refused: e instanceof SolenoidError ? `${e.status} ${e.code}` : String(e) }),
      )
      return { n: i + 1, start_ms, at_ms: now(), outcome }
    }))
    const sources = Object.fromEntries(SOURCES.map((p) => [p, createHash('sha256').update(readFileSync(join(root, p))).digest('hex')]))
    const race = raceFrom(calls, await cli('ls', 'acme'), sources)
    writeFileSync(join(root, 'site/src/data/race.json'), `${JSON.stringify(race, null, 2)}\n`)
    console.log(`wrote site/src/data/race.json: ${race.recorded} recorded, ${race.refused} refused`)
  } finally {
    await dev.stop()
    rmSync(box, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
}
```
It runs the scenario of the first test in `e2e/test/concurrency.test.ts` line for line: a fresh account, `limit acme calls=7`, a key for `acme/bot`, 30 concurrent spends each from its own client, and the same three assertions.

`e2e/package.json` scripts gain:
```json
"record-race": "pnpm --filter @solenoid.systems/cli run build && node record-race.ts"
```

- [ ] **Step 5: Record the race**

Run: `pnpm --filter @solenoid/e2e test && pnpm --filter @solenoid/e2e run record-race`
Expected: the suite passes, and the recorder prints `wrote site/src/data/race.json: 7 recorded, 23 refused`. `worker/.dev.vars` is back as it was (or absent, if it was absent).

- [ ] **Step 6: Write the failing site tests**

`site/test/race.test.ts`:
```ts
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import race from '../src/data/race.json'

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url))

it('was recorded from the current test and recorder', () => {
  expect(Object.keys(race.sources).sort()).toEqual(['e2e/record-race.ts', 'e2e/test/concurrency.test.ts'])
  for (const [path, hash] of Object.entries(race.sources)) {
    expect(createHash('sha256').update(readFileSync(repo(path))).digest('hex'), `${path} changed after race.json was recorded. Re-run: pnpm --filter @solenoid/e2e run record-race`).toBe(hash)
  }
})

it('holds the counts the test asserts, one line per spend, in settle order', () => {
  expect(race).toMatchObject({ limit: 7, calls: 30, recorded: 7, refused: 23 })
  expect(race.lines).toHaveLength(30)
  const at = race.lines.map((l) => l.at_ms)
  expect(at).toEqual([...at].sort((a, b) => a - b))
})
```

`site/test/dist/race.test.ts`:
```ts
import { expect, it } from 'vitest'
import race from '../../src/data/race.json'
import { attr, elementById, walk } from '../../scripts/lib/html.mjs'
import { readDist } from './dist'

it('renders every line of the race into the page, so it reads with no JavaScript', () => {
  const section = elementById(readDist('index.html'), 'race')
  expect(section).not.toBeNull()
  const items = [...walk(section)].filter((n) => n.nodeName === 'li' && attr(n, 'data-at') !== undefined)
  expect(items.map((n) => Number(attr(n, 'data-at')))).toEqual(race.lines.map((l) => l.at_ms))
  expect(items.map((n) => n.childNodes.map((c: { value?: string }) => c.value ?? '').join(''))).toEqual(race.lines.map((l) => l.text))
})
```

Run: `cd site && pnpm vitest run test/race.test.ts` (PASS: the file exists) and `pnpm build && pnpm vitest run test/dist/race.test.ts`.
Expected: the dist test FAILS: the page has no `#race`.

- [ ] **Step 7: `RaceTerminal` and its place on the page**

`site/src/components/RaceTerminal.astro` (the old terminal's window chrome, a new body):
```astro
---
interface Props { race: { limit: number; calls: number; lines: { at_ms: number; text: string }[] } }
const { race } = Astro.props
---
<div class="w-full max-w-3xl mx-auto border border-[#333]" style="background: rgba(16, 16, 18, 0.95);">
  <div class="flex items-center gap-2 px-4 py-3 border-b border-[#333]">
    <div class="flex gap-1.5" aria-hidden="true">
      <div class="w-3 h-3 rounded-full bg-[#333]"></div>
      <div class="w-3 h-3 rounded-full bg-[#333]"></div>
      <div class="w-3 h-3 rounded-full bg-[#333]"></div>
    </div>
    <span class="font-mono text-[11px] text-zinc-600 ml-2">{race.calls} spends at once, limit {race.limit}</span>
  </div>
  <ol class="race-lines px-5 py-3 font-mono text-xs leading-5 whitespace-pre text-zinc-300 overflow-x-auto">
    {race.lines.map((l) => <li data-at={l.at_ms}>{l.text}</li>)}
  </ol>
</div>

<script>
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const list of document.querySelectorAll<HTMLOListElement>('.race-lines')) {
      const lines = [...list.children] as HTMLElement[]
      for (const li of lines) li.style.visibility = 'hidden'
      for (const li of lines) setTimeout(() => { li.style.visibility = 'visible' }, Number(li.dataset.at))
    }
  }
</script>
```
Hidden lines keep their height, so the box always fits all 30 lines and the page never jumps. With reduced motion the script changes nothing, and the final state stays on screen.

In `site/src/pages/index.astro`, import `RaceTerminal` and `race from '@/data/race.json'`, and put this inside `<main>`:
```astro
    <section id="race" class="px-6 py-20">
      <RaceTerminal race={race} />
    </section>
```
Task 9 adds the section's copy around it.

- [ ] **Step 8: Run the site suite**

Run: `cd site && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 9: Commit**
```bash
git add e2e site/src/data/race.json site/src/components/RaceTerminal.astro site/src/pages/index.astro site/test
git commit -m "Record the concurrency race from a local Worker and replay it on the site"
```

---

### Task 8: Receipt capture and the `verifyChain` test

Spec: The receipt; landing section 4; Testing, "Receipt"; Launch order step 1 (the demo tenant). Step 5 of this task is controller-run: it makes a production account.

**Files:**
- Create: `site/scripts/capture-receipt.mjs`, `site/test/capture-receipt.test.ts`, `site/test/receipt.test.ts`, `site/src/data/receipt.json`, `site/src/data/keys.json`

**Interfaces:**
- Consumes: `solenoid`, `verifyChain` and `type Receipt` from `@solenoid.systems/sdk`; `testServer` from `../../testing/src/index` (tests only).
- Produces:
  - `capture({ adminKey, spendKey, api, scope, unit, fetch? }): Promise<{ receipt: { receipt: Receipt; chain: Receipt[] }; keys: Record<string, JsonWebKey> }>`
  - `site/src/data/receipt.json`: `{ "receipt": <Receipt>, "chain": [<Receipt>…] }`, the chain ascending. `site/src/data/keys.json`: the `keys` object of `/.well-known/solenoid.json`.

- [ ] **Step 1: Write the failing capture test**

`site/test/capture-receipt.test.ts`:
```ts
import { solenoid } from '@solenoid.systems/sdk'
import { describe, expect, it } from 'vitest'
import { testServer } from '../../testing/src/index'
import { capture } from '../scripts/capture-receipt.mjs'

async function demo() {
  const server = await testServer()
  const { admin_key } = await server.signup()
  const spendKey = await solenoid({ key: admin_key, api: server.api, fetch: server.fetch }).deriveKey('support')
  return { server, o: { adminKey: admin_key, spendKey, api: server.api, scope: 'support/c-1', unit: 'emails', fetch: server.fetch } }
}

describe('capture', () => {
  it("makes one spend and returns its receipt, the account's chain ascending, and the published keys", async () => {
    const { o } = await demo()
    const out = await capture(o)
    expect(out.receipt.receipt).toMatchObject({ seq: 1, kind: 'spend', scope: 'support/c-1', body: { emails: 1 }, kid: 'k1' })
    expect(out.receipt.chain).toEqual([out.receipt.receipt])
    expect(Object.keys(out.keys)).toEqual(['k1'])
  })
  it('refuses to save a receipt that does not verify against the keys it fetched', async () => {
    const { o } = await demo()
    const other = await testServer()
    const f = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/.well-known/solenoid.json') ? other.fetch(input, init) : o.fetch(input, init)) as typeof fetch
    await expect(capture({ ...o, fetch: f })).rejects.toThrow('does not verify')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd site && pnpm vitest run test/capture-receipt.test.ts`
Expected: FAIL: `../scripts/capture-receipt.mjs` does not exist.

- [ ] **Step 3: Write the capture script**

`site/scripts/capture-receipt.mjs`:
```js
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { solenoid, verifyChain } from '@solenoid.systems/sdk'

export async function capture({ adminKey, spendKey, api, scope, unit, fetch: f = globalThis.fetch }) {
  const receipt = await solenoid({ key: spendKey, api, fetch: f }).spend(scope, { [unit]: 1 })
  if (!receipt) throw new Error('the spend returned null, so nothing was recorded')
  const chain = (await solenoid({ key: adminKey, api, fetch: f }).get('')).entries.slice().reverse()
  const { keys } = await (await f(`${api}/.well-known/solenoid.json`)).json()
  if (!(await verifyChain([receipt], keys)) || !(await verifyChain(chain, keys))) throw new Error('the receipt or the chain does not verify against the published keys')
  return { receipt: { receipt, chain }, keys }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [scope, unit] = process.argv.slice(2)
  const dir = process.env.SOLENOID_CONFIG_DIR
  const spendKey = process.env.SOLENOID_KEY
  if (!scope || !unit || !dir || !spendKey) {
    console.error('usage: SOLENOID_CONFIG_DIR=<throwaway dir> SOLENOID_KEY=<spend key> node site/scripts/capture-receipt.mjs <scope> <unit>')
    process.exit(2)
  }
  const { api, admin_key } = JSON.parse(readFileSync(join(dir, 'credentials'), 'utf8'))
  const out = await capture({ adminKey: admin_key, spendKey, api, scope, unit })
  const data = fileURLToPath(new URL('../src/data/', import.meta.url))
  writeFileSync(join(data, 'receipt.json'), `${JSON.stringify(out.receipt, null, 2)}\n`)
  writeFileSync(join(data, 'keys.json'), `${JSON.stringify(out.keys, null, 2)}\n`)
  console.log(`saved receipt ${out.receipt.receipt.id} of account ${spendKey.split('.')[2]}`)
}
```

Run: `cd site && pnpm vitest run test/capture-receipt.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the receipt test** (it fails until Step 5 saves the files)

`site/test/receipt.test.ts`:
```ts
import { verifyChain, type Receipt } from '@solenoid.systems/sdk'
import { expect, it } from 'vitest'
import keys from '../src/data/keys.json'
import saved from '../src/data/receipt.json'

const receipt = saved.receipt as Receipt
const chain = saved.chain as Receipt[]

it('verifies offline with the saved keys, alone and as its account chain', async () => {
  expect(await verifyChain([receipt], keys)).toBe(true)
  expect(await verifyChain(chain, keys)).toBe(true)
  expect(chain).toContainEqual(receipt)
})

it('is a production receipt signed with k1, and fails once any field changes', async () => {
  expect(receipt.kid).toBe('k1')
  expect(Object.keys(keys)).toContain('k1')
  expect(await verifyChain([{ ...receipt, body: { ...receipt.body, emails: 2 } }], keys)).toBe(false)
  expect(await verifyChain([{ ...receipt, at: '2020-01-01T00:00:00.000Z' }], keys)).toBe(false)
})
```

- [ ] **Step 5: Capture the production receipt (CONTROLLER-RUN)**

This makes the dedicated demo account in production and one spend on it. It is never Robin's account or any real one.
```bash
cd ~/dev/solenoid && unset SOLENOID_KEY SOLENOID_API
pnpm --filter @solenoid.systems/cli build && chmod +x cli/dist/solenoid.mjs
export SOLENOID_CONFIG_DIR=$(mktemp -d)
D=$(mktemp -d)
(cd "$D" && node ~/dev/solenoid/cli/dist/solenoid.mjs init support > /dev/null)
SOLENOID_KEY=$(sed -n 's/^SOLENOID_KEY=//p' "$D/.env") node site/scripts/capture-receipt.mjs support/c-1 emails
op item edit 'Solenoid Worker secrets' "DEMO_ADMIN_KEY[concealed]=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).admin_key)' "$SOLENOID_CONFIG_DIR/credentials")"
rm -rf "$D" "$SOLENOID_CONFIG_DIR"; unset SOLENOID_CONFIG_DIR
```
Expected: `saved receipt rcp_1 of account <id>`. Record the demo account's ID in the execution record; it becomes public with the receipt and holds nothing else. `init` prints the admin key, so its output goes to `/dev/null`.

- [ ] **Step 6: Run the site suite**

Run: `cd site && pnpm test`
Expected: PASS, the receipt test included.

- [ ] **Step 7: Commit**
```bash
git add site/scripts/capture-receipt.mjs site/test/capture-receipt.test.ts site/test/receipt.test.ts site/src/data/receipt.json site/src/data/keys.json docs/superpowers/plans/2026-09-30-solenoid-go-live.record.md
git commit -m "Save a production demo receipt and the public keys, and verify them offline in a test"
```

---

### Task 9: The landing page

Spec: "The landing page, top to bottom"; Decisions (hero call to action, failure moment first); Copy process; the brief. Review Focus 3.

**Files:**
- Create: `site/src/lib/start.ts`, `site/src/components/StartSteps.astro`, `site/src/components/BottomCTA.astro`, `site/src/components/CodeTabs.astro`, `site/test/dist/landing.test.ts`
- Modify: `site/src/pages/index.astro`, `site/src/components/Footer.astro` (copy fixes only)

**Interfaces:**
- Consumes: `RaceTerminal` and `race.json` (Task 7), `receipt.json` (Task 8), `atTag` (Task 6), `solenoidTheme` (Task 6).
- Produces:
  - `site/src/lib/start.ts`: `SCOPE = 'support-bot'`, `INIT = 'npx @solenoid.systems/cli init support-bot'`, `UPGRADE = 'npx @solenoid.systems/cli upgrade'`, `AGENT_PROMPT: string`. Task 10's `/pricing` imports `INIT` and `UPGRADE`.
  - `StartSteps.astro` props `{ id: string }`: the two steps, with `.start-command` and `.agent-prompt` blocks and copy buttons.
  - `CodeTabs.astro` props `{ name: string; tabs: { label: string; lang: 'ts' | 'sh'; code: string }[] }`.
  - Section ids on `/`: `hero`, `race`, `one-call`, `receipt`, `limits`, `outage`, `pricing-strip`, `why`, `start`, and `start-hero`, `start-bottom` for the two step lists.

- [ ] **Step 1: Write the failing landing test**

`site/test/dist/landing.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import saved from '../../src/data/receipt.json'
import { attr, elementById, root, textOf, walk } from '../../scripts/lib/html.mjs'
import { readDist } from './dist'

const html = () => readDist('index.html')
const section = (id: string) => {
  const n = elementById(html(), id)
  expect(n, `#${id}`).not.toBeNull()
  return n!
}
const byClass = (node: unknown, cls: string) => [...walk(node)].filter((n) => (attr(n, 'class') ?? '').split(/\s+/).includes(cls))
const hrefs = (node: unknown) => [...walk(node)].filter((n) => n.nodeName === 'a').map((n) => attr(n, 'href'))

describe('the landing page', () => {
  it('orders its sections as the spec does', () => {
    const ids = [...walk(root(html()))].map((n) => attr(n, 'id')).filter((id) => ['hero', 'race', 'one-call', 'receipt', 'limits', 'outage', 'pricing-strip', 'why', 'start'].includes(id))
    expect(ids).toEqual(['hero', 'race', 'one-call', 'receipt', 'limits', 'outage', 'pricing-strip', 'why', 'start'])
  })

  it('shows the same init command, run in the project root, in the hero and the bottom call to action', () => {
    for (const id of ['start-hero', 'start-bottom']) {
      const [command] = byClass(section(id), 'start-command')
      expect(textOf(command)).toBe('npx @solenoid.systems/cli init support-bot')
    }
  })

  it('gives the agent a prompt that names llms.txt, .env and SOLENOID_KEY, and never asks it to run init', () => {
    for (const id of ['start-hero', 'start-bottom']) {
      const prompt = textOf(byClass(section(id), 'agent-prompt')[0])
      for (const s of ['https://solenoid.systems/llms.txt', '.env', 'SOLENOID_KEY']) expect(prompt).toContain(s)
      expect(prompt).not.toContain('npx @solenoid.systems/cli init')
    }
  })

  it('links the proof test and the recorder at the launch tag', () => {
    expect(hrefs(section('race'))).toEqual(expect.arrayContaining([
      'https://github.com/robinslange/solenoid/blob/launch/e2e/test/concurrency.test.ts',
      'https://github.com/robinslange/solenoid/blob/launch/e2e/record-race.ts',
    ]))
  })

  it('shows the saved production receipt and the offline check', () => {
    const text = textOf(section('receipt'))
    for (const s of [saved.receipt.hash, saved.receipt.sig, 'verifyChain([receipt], keys)', '/.well-known/solenoid.json']) expect(text).toContain(s)
  })

  it('offers a TypeScript tab and a CLI tab, and nothing else', () => {
    expect(byClass(section('one-call'), 'tab-label').map(textOf)).toEqual(['TypeScript', 'CLI'])
  })

  it('names model spend only to send it to the gateway, links the at-most-once test, pricing and the founder note', () => {
    expect(textOf(section('limits'))).toContain('keep your gateway for that')
    expect(hrefs(section('limits'))).toContain('https://github.com/robinslange/solenoid/blob/launch/e2e/test/concurrency.test.ts')
    expect(hrefs(section('pricing-strip'))).toContain('/pricing')
    expect(hrefs(section('why'))).toContain('/why')
  })
})
```

Run: `cd site && pnpm build && pnpm vitest run test/dist/landing.test.ts`
Expected: FAIL: the sections do not exist.

- [ ] **Step 2: The call-to-action pieces**

`site/src/lib/start.ts` (the prompt is draft copy):
```ts
export const SCOPE = 'support-bot'
export const INIT = `npx @solenoid.systems/cli init ${SCOPE}`
export const UPGRADE = 'npx @solenoid.systems/cli upgrade'
export const AGENT_PROMPT = `Read https://solenoid.systems/llms.txt and add Solenoid to this project. I already ran init: the spend key is in .env as SOLENOID_KEY, for the scope ${SCOPE}. Call spend before every email and refund the support bot sends, and tell me which solenoid limit commands to run.`
```

`site/src/components/StartSteps.astro`:
```astro
---
import { AGENT_PROMPT, INIT, SCOPE } from '@/lib/start'

interface Props { id: string }
const { id } = Astro.props
---
<ol id={id} class="w-full max-w-2xl space-y-8 text-left">
  <li>
    <p class="text-sm text-zinc-300">1. In your project's root, run this in your terminal:</p>
    <div class="mt-2 flex items-stretch border border-[#333] bg-[#0a0a0b]">
      <pre class="start-command flex-1 px-4 py-3 font-mono text-sm overflow-x-auto"><code>{INIT}</code></pre>
      <button type="button" data-copy={INIT} class="px-3 font-mono text-[11px] uppercase tracking-wider text-zinc-500 hover:text-accent border-l border-[#333]">Copy</button>
    </div>
    <p class="mt-2 text-sm text-zinc-500">It creates your account with no signup form, prints your admin key once, and writes a spend key for <code>{SCOPE}</code> to <code>.env</code> as <code>SOLENOID_KEY</code>.</p>
  </li>
  <li>
    <p class="text-sm text-zinc-300">2. Then give your coding agent this prompt:</p>
    <div class="mt-2 flex items-stretch border border-[#333] bg-[#0a0a0b]">
      <pre class="agent-prompt flex-1 px-4 py-3 font-mono text-sm whitespace-pre-wrap"><code>{AGENT_PROMPT}</code></pre>
      <button type="button" data-copy={AGENT_PROMPT} class="px-3 font-mono text-[11px] uppercase tracking-wider text-zinc-500 hover:text-accent border-l border-[#333]">Copy</button>
    </div>
  </li>
</ol>

<script>
  for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
    b.addEventListener('click', async () => {
      await navigator.clipboard.writeText(b.dataset.copy ?? '')
      b.textContent = 'Copied'
      setTimeout(() => { b.textContent = 'Copy' }, 1500)
    })
  }
</script>
```

`site/src/components/BottomCTA.astro` (a rewrite in the old styling):
```astro
---
import StartSteps from '@/components/StartSteps.astro'
---
<section id="start" class="w-full bg-[#050505] border-t border-[#222] py-20 px-6">
  <div class="max-w-3xl mx-auto flex flex-col items-center">
    <h2 class="font-sans font-bold text-2xl text-center">Give your agent its first limit</h2>
    <p class="mt-3 text-sm text-zinc-500 text-center">Free for the first 100,000 spends each month.</p>
    <div class="mt-10 w-full flex justify-center"><StartSteps id="start-bottom" /></div>
  </div>
</section>
```

`site/src/components/CodeTabs.astro` (a rewrite: the tabs come in as props):
```astro
---
import { Code } from 'astro:components'
import { solenoidTheme } from '@/lib/shiki-theme'

interface Props { name: string; tabs: { label: string; lang: 'ts' | 'sh'; code: string }[] }
const { name, tabs } = Astro.props
const css = tabs
  .map((_, i) => `#${name}-${i}:checked~.tabs-header label[for="${name}-${i}"]{color:#FF3F00;border-bottom-color:#FF3F00}#${name}-${i}:checked~.tabs-panels .${name}-panel-${i}{display:block}`)
  .join('')
---
<div class="code-tabs">
  {tabs.map((_, i) => <input type="radio" name={name} id={`${name}-${i}`} checked={i === 0} />)}
  <div class="tabs-header">
    {tabs.map((t, i) => <label for={`${name}-${i}`} class="tab-label">{t.label}</label>)}
  </div>
  <div class="tabs-panels">
    {tabs.map((t, i) => <div class={`tab-panel ${name}-panel-${i}`}><Code code={t.code} lang={t.lang} theme={solenoidTheme} /></div>)}
  </div>
</div>
<style is:inline set:html={css}></style>

<style>
  .code-tabs { margin: 1.5rem 0; }
  .code-tabs input[type='radio'] { position: absolute; opacity: 0; pointer-events: none; }
  .tabs-header { display: flex; gap: 0.25rem; border-bottom: 1px solid #27272a; background: #0a0a0b; }
  .tab-label { padding: 0.75rem 1.25rem; font-family: 'JetBrains Mono', monospace; font-size: 0.8125rem; color: #71717a; cursor: pointer; transition: all 0.15s ease; border-bottom: 2px solid transparent; user-select: none; }
  .tab-label:hover { color: #a1a1aa; background: #18181b; }
  .tab-panel { display: none; }
  .tab-panel :global(pre) { margin: 0; border-radius: 0; border-top: none; padding: 1rem 1.25rem; overflow-x: auto; }
  .tab-panel :global(code) { font-size: 0.8125rem; }
</style>
```

- [ ] **Step 3: The page, with draft copy**

`site/src/pages/index.astro`:
```astro
---
import { Code } from 'astro:components'
import BottomCTA from '@/components/BottomCTA.astro'
import CodeTabs from '@/components/CodeTabs.astro'
import Footer from '@/components/Footer.astro'
import Header from '@/components/Header.astro'
import MagneticFieldTitle from '@/components/MagneticFieldTitle.astro'
import RaceTerminal from '@/components/RaceTerminal.astro'
import StartSteps from '@/components/StartSteps.astro'
import race from '@/data/race.json'
import saved from '@/data/receipt.json'
import Layout from '@/layouts/Layout.astro'
import { atTag } from '@/lib/links'
import { solenoidTheme } from '@/lib/shiki-theme'

const TS = `import { solenoid } from '@solenoid.systems/sdk'

const sol = solenoid() // reads SOLENOID_KEY from the environment

export async function reply(conversation: string, email: Email) {
  await sol.spend(\`support-bot/\${conversation}\`, { emails: 1 }) // throws LimitExceeded at the limit
  await mailer.send(email)
}`
const CLI = `npx @solenoid.systems/cli limit support-bot emails=3 --per child
npx @solenoid.systems/cli spend support-bot/c-1042 emails=1`
const VERIFY = `import { verifyChain } from '@solenoid.systems/sdk'
import keys from './solenoid-keys.json' // saved once from /.well-known/solenoid.json

await verifyChain([receipt], keys) // true, with no network call`
const h2 = 'font-sans font-bold text-2xl md:text-3xl'
const body = 'mt-4 text-zinc-400 max-w-2xl'
---
<Layout title="Solenoid: limits on what your AI agents do" description="Your agent's tools call Solenoid before they act. An action past its limit is refused before it runs, and every recorded one returns a signed receipt.">
  <Header pathname="/" />
  <main class="relative z-10">
    <section id="hero" class="min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16">
      <MagneticFieldTitle text="SOLENOID.SYSTEMS" />
      <h1 class="font-sans font-black text-3xl md:text-5xl text-center max-w-3xl leading-tight">Your support agent has sent one customer the same email forty times. You type stop. The sends keep coming.</h1>
      <p class="mt-6 text-lg text-zinc-400 text-center max-w-2xl">Solenoid keeps the count outside the agent. Your tool calls spend before it sends, a spend past its limit is refused before the send runs, and every recorded spend comes back as a signed receipt. It only limits tools that call it first.</p>
      <p class="mt-3 text-sm text-zinc-500">Free for the first 100,000 spends each month.</p>
      <div class="mt-10 w-full flex justify-center"><StartSteps id="start-hero" /></div>
    </section>

    <div class="bg-[#050505]">
      <section id="race" class="px-6 py-20 max-w-4xl mx-auto">
        <h2 class={h2}>{race.calls} spends at the same moment, against a limit of {race.limit}</h2>
        <p class={body}>This is a recording of a real run against a local copy of the Worker. Each spend comes from its own client. {race.recorded} are recorded, and the other {race.refused} are refused before they run.</p>
        <div class="mt-8"><RaceTerminal race={race} /></div>
        <p class="mt-4 font-mono text-xs text-zinc-500">The test that proves it: <a class="underline hover:text-accent" href={atTag('e2e/test/concurrency.test.ts')}>e2e/test/concurrency.test.ts</a>. The script that recorded this: <a class="underline hover:text-accent" href={atTag('e2e/record-race.ts')}>e2e/record-race.ts</a>.</p>
      </section>

      <section id="one-call" class="px-6 py-20 max-w-4xl mx-auto">
        <h2 class={h2}>One call, in front of the action</h2>
        <p class={body}>Call spend before the send. At the limit, spend throws, and the email never goes out. Here each conversation gets three.</p>
        <CodeTabs name="one-call" tabs={[{ label: 'TypeScript', lang: 'ts', code: TS }, { label: 'CLI', lang: 'sh', code: CLI }]} />
      </section>

      <section id="receipt" class="px-6 py-20 max-w-4xl mx-auto">
        <h2 class={h2}>A signed receipt for every recorded spend</h2>
        <p class={body}>This receipt came from the production API. Save the public keys once from https://api.solenoid.systems/.well-known/solenoid.json, and anyone can check it offline.</p>
        <div class="mt-8 text-sm"><Code code={JSON.stringify(saved.receipt, null, 2)} lang="json" theme={solenoidTheme} /></div>
        <div class="mt-4 text-sm"><Code code={VERIFY} lang="ts" theme={solenoidTheme} /></div>
      </section>

      <section id="limits" class="px-6 py-20 max-w-4xl mx-auto">
        <h2 class={h2}>What it limits</h2>
        <p class={body}>Any action your code can count: emails, refunds, deletes, fetches. A limit of 1 on each child scope makes an action happen at most once, such as one refund per order. The test for that is the per-child one in <a class="underline hover:text-accent" href={atTag('e2e/test/concurrency.test.ts')}>e2e/test/concurrency.test.ts</a>.</p>
        <p class={body}>For model spend, keep your gateway for that.</p>
      </section>

      <section id="outage" class="px-6 py-20 max-w-4xl mx-auto">
        <h2 class={h2}>When Solenoid is down</h2>
        <p class={body}>A spend that can't reach Solenoid fails closed, so the action doesn't run. You can set a limit's on_outage to open, and its actions then go ahead unrecorded until Solenoid is back.</p>
      </section>

      <section id="pricing-strip" class="px-6 py-12 max-w-4xl mx-auto border-y border-[#222]">
        <p class="text-zinc-300">Free: 100,000 spends each UTC calendar month. Pro: $29 USD a month with 2M spends, then $10 USD per extra million.</p>
        <a href="/pricing" class="mt-3 inline-block font-mono text-xs uppercase tracking-wider text-accent hover:underline">See pricing</a>
      </section>

      <section id="why" class="px-6 py-20 max-w-4xl mx-auto">
        <h2 class={h2}>Why this exists</h2>
        <p class={body}>Agents keep acting after their owners tell them to stop. A limit the agent can't talk its way past has to live outside the agent, so I built one.</p>
        <a href="/why" class="mt-3 inline-block font-mono text-xs uppercase tracking-wider text-accent hover:underline">Read the note</a>
      </section>
    </div>

    <BottomCTA />
  </main>
  <Footer />
</Layout>
```

- [ ] **Step 4: Run the site suite**

Run: `cd site && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit the page code**

The drafts stay as they are for the gate; the code around them is final.
```bash
git add site/src site/test/dist/landing.test.ts
git commit -m "Build the landing page: the failure moment, the race, one call, the receipt, and the two-step start"
```

- [ ] **Step 6: Copy gate (controller)**

Build first (`cd site && pnpm build`), then paste each unit's text from `node site/scripts/unit-text.mjs site/dist/index.html <id>`. Medium: a developer product landing page, for every unit but the last two. Units:
  - the hero (`#hero`, closing), graded against `npx @solenoid.systems/cli init support-bot`;
  - the agent prompt (`AGENT_PROMPT`, non-closing), with the same command;
  - the race section (`#race`), which includes the terminal's label and the line format (`lineFor` in `e2e/record-race.ts`; paste three sample lines from `race.json`). Source check: the two linked files resolve only once the repository is public (Task 19), so give `copy-source-checker` the local paths `e2e/test/concurrency.test.ts` and `e2e/record-race.ts` to read;
  - `#one-call`, `#receipt` (source check: `https://api.solenoid.systems/.well-known/solenoid.json`), `#limits` (source check: the local `e2e/test/concurrency.test.ts`, its `per: "child"` test), `#outage`;
  - the pricing strip (`#pricing-strip`, closing);
  - the founder excerpt (`#why`);
  - the bottom call to action (`#start`, closing), graded against the same command;
  - the nav and footer (medium: site navigation), from `Header.astro` and `Footer.astro`.

  Fixes land in `index.astro`, `start.ts`, `StartSteps.astro`, `BottomCTA.astro` and `Footer.astro`. If the gate changes the race line format, change `lineFor` and its test in `e2e/test/record-race.test.ts`, re-run `pnpm --filter @solenoid/e2e run record-race`, and include the new `race.json`. If it changes the scope `support-bot`, change every place that names it in the same commit: `SCOPE` in `site/src/lib/start.ts`, `landing.test.ts`, Global Constraints and Decision 12 of this plan, the product `README.md` from Task 5 (a controller line-check of that one changed word, since the rest of its grade stands), and, once Task 10 exists, `pages-content.test.ts`. Run `git grep -n support-bot` to find them all. The C3 (attribution) check is judged per draft: the only attribution in place is Umami's record of `?ref=` visits, and no copy may claim a visit is tied to a signup. Grade files: `docs/copy/grades/site-hero.md`, `site-agent-prompt.md`, `site-race.md`, `site-one-call.md`, `site-receipt.md`, `site-limits.md`, `site-outage.md`, `site-pricing-strip.md`, `site-why-excerpt.md`, `site-bottom-cta.md`, `site-nav-footer.md`.

- [ ] **Step 7: Commit the graded copy**
```bash
git add site e2e/record-race.ts e2e/test/record-race.test.ts docs/copy/grades
git commit -m "Grade the landing page copy"
```

---

### Task 10: `/pricing`, `/why`, `/privacy` and `/404`

Spec: Pages; Privacy (the inventory); Billing; "Settled with Robin after round 2"; Launch order step 0 (Order B) and step 1 (the Umami check); Copy process (meta descriptions).

**Files:**
- Create: `site/src/pages/pricing.astro`, `site/src/pages/why.astro`, `site/src/pages/privacy.astro`, `site/src/pages/404.astro`, `site/test/dist/pages-content.test.ts`
- Modify (Order B only): `site/src/lib/start.ts`

**Interfaces:**
- Consumes: `INIT`, `UPGRADE` from `site/src/lib/start.ts`; `Layout`, `Header`, `Footer`.
- Produces (Order B only): `PRO_OPEN: boolean` in `site/src/lib/start.ts`, `false` when the build runs with `PUBLIC_PRO_OPEN=false`.

- [ ] **Step 1: Confirm the Umami host (CONTROLLER-RUN, before the privacy copy is drafted)**

Find where `analytics.omit.nz` really runs, from the server itself: resolve it over DoH (`curl -s 'https://cloudflare-dns.com/dns-query?name=analytics.omit.nz&type=A' -H 'accept: application/dns-json'`); if the address is a Cloudflare proxy address, read the origin from the server instead, over SSH to the host Robin names, with `curl -s https://ipinfo.io` run on that host (it reports the provider and country).
  - **It is a Hetzner server in Germany, as Robin recalls:** the privacy draft in Step 3 stands.
  - **Anything else:** replace "a Hetzner server in Germany" in the Step 3 draft with the provider and country found, and say so in the execution record.

  Also read Umami's configured data retention from its settings (or ask Robin). If none is set, the row says "until deleted by hand".

- [ ] **Step 2: Write the failing test**

`site/test/dist/pages-content.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { attr, root, textOf, walk } from '../../scripts/lib/html.mjs'
import { readDist } from './dist'

const text = (page: string) => textOf([...walk(root(readDist(page)))].find((n) => n.nodeName === 'main'))
const hrefs = (page: string) => [...walk(root(readDist(page)))].filter((n) => n.nodeName === 'a').map((n) => attr(n, 'href'))

describe('the other pages', () => {
  it('prices Free and Pro in USD, and shows init before upgrade', () => {
    const t = text('pricing.html')
    for (const s of ['100,000', '$29 USD', '2M', '$10 USD', 'npx @solenoid.systems/cli init support-bot']) expect(t).toContain(s)
    expect(t.indexOf('npx @solenoid.systems/cli init support-bot')).toBeLessThan(t.indexOf('npx @solenoid.systems/cli upgrade'))
    expect(t).toContain('no partial refunds')
  })
  it('names the agency, the contact and every processor on /privacy', () => {
    const t = text('privacy.html')
    for (const s of ['Robin Lange, trading as omit', 'privacy@solenoid.systems', 'Privacy Act 2020', 'analytics.omit.nz', 'Resend', 'Stripe', 'Cloudflare', 'client_reference_id']) expect(t).toContain(s)
  })
  it('cites each incident on /why', () => {
    expect(hrefs('why.html')).toEqual(expect.arrayContaining([
      'https://x.com/summeryue0/status/2025774069124399363',
      'https://techcrunch.com/2026/02/23/a-meta-ai-security-researcher-said-an-openclaw-agent-ran-amok-on-her-inbox/',
      'https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/',
      'https://www.saastr.com/a-great-year-with-our-20-ai-agents-but-a-rough-week',
      'https://support.zendesk.com/hc/en-us/articles/11046894936218-Service-Incident-July-14-2026-AI-Agents-Multiple-Pods-AI-Agents-Repeating-Messages',
    ]))
  })
  it('links / and /docs from the 404 page', () => {
    expect(hrefs('404.html')).toEqual(expect.arrayContaining(['/', '/docs']))
  })
})
```

Run: `cd site && pnpm build && pnpm vitest run test/dist/pages-content.test.ts`
Expected: FAIL: the pages do not exist.

- [ ] **Step 3: The pages, with draft copy**

`site/src/pages/pricing.astro`:
```astro
---
import Footer from '@/components/Footer.astro'
import Header from '@/components/Header.astro'
import Layout from '@/layouts/Layout.astro'
import { INIT, UPGRADE } from '@/lib/start'

const card = 'border border-[#333] bg-[#0a0a0b] p-6'
const cmd = 'mt-2 border border-[#333] bg-[#050505] px-4 py-3 font-mono text-sm overflow-x-auto'
---
<Layout title="Solenoid pricing: free for 100,000 spends a month" description="Free for 100,000 spends each UTC calendar month. Pro is $29 USD a month with 2M spends, then $10 USD per extra million.">
  <Header pathname="/pricing" />
  <main class="relative z-10 max-w-3xl mx-auto px-6 pt-32 pb-20">
    <h1 class="font-sans font-black text-4xl">Pricing</h1>
    <div class="mt-10 grid gap-6 md:grid-cols-2">
      <section class={card}>
        <h2 class="font-sans font-bold text-xl">Free</h2>
        <p class="mt-3 text-zinc-400">100,000 spends each UTC calendar month. Once they are used, every spend is refused until the month turns.</p>
      </section>
      <section class={card}>
        <h2 class="font-sans font-bold text-xl">Pro</h2>
        <p class="mt-3 text-zinc-400">$29 USD a month, with 2M spends each billing month included, then $10 USD per extra million, billed as used.</p>
      </section>
    </div>
    <section class="mt-12">
      <h2 class="font-sans font-bold text-xl">What counts as a spend</h2>
      <p class="mt-3 text-zinc-400">One spend is one call to spend that Solenoid records. Refused spends, replays of an earlier spend, reads, limit changes, the settle after a model call, and recovery emails are free.</p>
    </section>
    <section id="upgrade" class="mt-12">
      <h2 class="font-sans font-bold text-xl">Move to Pro</h2>
      <p class="mt-3 text-zinc-400">No account yet? In your project's root, run:</p>
      <pre class={cmd}><code>{INIT}</code></pre>
      <p class="mt-4 text-zinc-400">Then run this. It opens Stripe Checkout in your browser, and your account moves to Pro once you pay:</p>
      <pre class={cmd}><code>{UPGRADE}</code></pre>
    </section>
    <section class="mt-12">
      <h2 class="font-sans font-bold text-xl">Cancelling and refunds</h2>
      <p class="mt-3 text-zinc-400">Cancel anytime: run <code>{UPGRADE}</code> again, and on Pro it prints a link to the Stripe billing portal, where you cancel. Pro runs to the end of the paid month, with no partial refunds, and overage is billed as used. Prices are in US dollars and shown as they are.</p>
    </section>
  </main>
  <Footer />
</Layout>
```

`site/src/pages/why.astro`:
```astro
---
import Footer from '@/components/Footer.astro'
import Header from '@/components/Header.astro'
import Layout from '@/layouts/Layout.astro'

const p = 'mt-5 text-zinc-300 leading-relaxed'
const a = 'underline hover:text-accent'
---
<Layout title="Why Solenoid exists" description="A note from Robin Lange on agents that kept acting after they were told to stop, and why the limit has to live outside the agent.">
  <Header pathname="/why" />
  <main class="relative z-10 max-w-2xl mx-auto px-6 pt-32 pb-20">
    <h1 class="font-sans font-black text-4xl">Why Solenoid exists</h1>
    <p class={p}>I'm Robin Lange. I build software in Auckland and trade as omit. These are the incidents that made me build Solenoid.</p>
    <p class={p}>On 23 February 2026, a Meta AI security researcher told her OpenClaw agent to confirm before acting. It started deleting her inbox. She sent it commands to stop from her phone, it didn't, and she ran to the machine to end it. (<a class={a} href="https://x.com/summeryue0/status/2025774069124399363">her post</a>, <a class={a} href="https://techcrunch.com/2026/02/23/a-meta-ai-security-researcher-said-an-openclaw-agent-ran-amok-on-her-inbox/">TechCrunch</a>, <a class={a} href="https://www.pcgamer.com/software/ai/i-had-to-run-to-my-mac-mini-like-i-was-defusing-a-bomb-openclaw-ai-chose-to-speedrun-deleting-meta-ai-safety-directors-inbox-due-to-a-rookie-error/">PC Gamer</a>)</p>
    <p class={p}>In July 2025, Replit's agent deleted a production database during a code freeze, then claimed the rollback was impossible. (<a class={a} href="https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/">The Register</a>, <a class={a} href="https://incidentdatabase.ai/cite/1152/">AI Incident Database</a>)</p>
    <p class={p}>In December 2025, SaaStr wrote that its outbound agent made up an A/B variant offering free tickets to SaaStr Annual, with no human approval, and that it cost them more than $2,000. (<a class={a} href="https://www.saastr.com/a-great-year-with-our-20-ai-agents-but-a-rough-week">SaaStr</a>)</p>
    <p class={p}>On 14 July 2026, Zendesk reported AI agents stuck in loops, sending repeated messages. In some cases this went on after the customer stopped responding, or after a human agent replied. (<a class={a} href="https://support.zendesk.com/hc/en-us/articles/11046894936218-Service-Incident-July-14-2026-AI-Agents-Multiple-Pods-AI-Agents-Repeating-Messages">Zendesk</a>)</p>
    <p class={p}>In each one, the agent kept acting after the moment a person wanted it to stop. An instruction in the chat is something the agent reads, weighs and can lose.</p>
    <p class={p}>Solenoid keeps the limit outside the agent. Your tools ask it before they act, and once a limit is reached the answer is no, whatever the agent remembers. It only covers the tools that ask first. Every action it allows comes back with a signed receipt, so afterwards you can show what the agent did.</p>
    <p class={p}>Robin</p>
  </main>
  <Footer />
</Layout>
```

`site/src/pages/privacy.astro` (rows follow the spec's inventory; the Umami host comes from Step 1; the Stripe row follows Decision 4):
```astro
---
import Footer from '@/components/Footer.astro'
import Header from '@/components/Header.astro'
import Layout from '@/layouts/Layout.astro'

const ROWS: [string, string, string][] = [
  ['Your account ID and plan', "Your account's Durable Object", 'For the life of the account. Keys are never stored: they are derived when needed.'],
  ['Ledger entries: scopes, units, amounts, timestamps and signatures', "Your account's Durable Object", 'For the life of the account. Nothing deletes them automatically yet.'],
  ['A salted hash of your network address for each signup and account recovery', "Solenoid's own ledger", 'Indefinitely. Rows written before 30 September 2026 hold an unsalted hash.'],
  ['Your recovery email', "Your account's Durable Object", 'Until you replace it. Replacing it also emails the previous address.'],
  ['Code rows: the email, the time and a keyed hash of the code', "Your account's Durable Object", 'About one day, removed by a scheduled job'],
  ['Code, confirmation and change-notice emails', 'Resend, which sends them', "Resend's own retention"],
  ['Request logs, which can include your IP address and request headers, and logged error text', 'Cloudflare Workers Logs on the API', '7 days'],
  ['Page visits: the URL with its query string (so a ?ref= tag), the referrer, your browser, device and country', 'Umami at analytics.omit.nz, on a Hetzner server in Germany. It sets no cookies and honours Do Not Track.', "Umami's configured retention"],
  ['Billing name, email, card and address; your account ID, as the Checkout client_reference_id and on the subscription', 'Stripe', "Stripe's retention"],
  ['Your Stripe customer and subscription IDs; the ID, link and expiry of your latest Checkout page; and the ID of any second subscription Solenoid cancelled', "Your account's Durable Object", 'For the life of the account. The Checkout page entry is replaced by the next one.'],
]
---
<Layout title="Solenoid privacy: what is stored, where, and for how long" description="Everything Solenoid stores or logs about you, where it is kept, for how long, and how to ask for access or a correction.">
  <Header pathname="/privacy" />
  <main class="relative z-10 max-w-4xl mx-auto px-6 pt-32 pb-20">
    <h1 class="font-sans font-black text-4xl">Privacy</h1>
    <p class="mt-5 text-zinc-300">This is everything Solenoid stores or logs, taken from its code. The agency responsible is Robin Lange, trading as omit, in New Zealand.</p>
    <div class="mt-8 overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead><tr class="border-b border-[#333] text-zinc-500"><th class="py-2 pr-4">What</th><th class="py-2 pr-4">Where</th><th class="py-2">How long</th></tr></thead>
        <tbody>{ROWS.map(([what, where, kept]) => <tr class="border-b border-[#222] align-top"><td class="py-3 pr-4">{what}</td><td class="py-3 pr-4 text-zinc-400">{where}</td><td class="py-3 text-zinc-400">{kept}</td></tr>)}</tbody>
      </table>
    </div>
    <p class="mt-8 text-zinc-300">Solenoid runs on Cloudflare. Your account's Durable Object is placed in one region when it is created, and that region can be outside New Zealand.</p>
    <p class="mt-4 text-zinc-300">To see or correct what Solenoid holds about you under the NZ Privacy Act 2020, email privacy@solenoid.systems.</p>
  </main>
  <Footer />
</Layout>
```
The date in the salted-hash row is the day Task 17 deploys the salted hash; change it to that date if it differs.

`site/src/pages/404.astro`:
```astro
---
import Footer from '@/components/Footer.astro'
import Header from '@/components/Header.astro'
import Layout from '@/layouts/Layout.astro'
---
<Layout title="Solenoid: page not found" description="There is no page at this address." hasField={false}>
  <Header pathname="/404" />
  <main class="relative z-10 max-w-2xl mx-auto px-6 pt-32 pb-20">
    <h1 class="font-sans font-black text-4xl">Nothing is at this address</h1>
    <p class="mt-5 text-zinc-300">The docs are at <a class="underline hover:text-accent" href="/docs">/docs</a>, and the home page is at <a class="underline hover:text-accent" href="/">/</a>.</p>
  </main>
  <Footer />
</Layout>
```

- [ ] **Step 4: Run the site suite**

Run: `cd site && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit the page code**
```bash
git add site/src/pages site/test/dist/pages-content.test.ts
git commit -m "Add the pricing, founder note, privacy and 404 pages"
```

- [ ] **Step 6: Order B only: a "Pro opens soon" build**

Skip this step under Order A. Under Order B:

`site/src/lib/start.ts` gains:
```ts
export const PRO_OPEN = import.meta.env.PUBLIC_PRO_OPEN !== 'false'
```
In `pricing.astro`, import `PRO_OPEN` and wrap the `#upgrade` section's second paragraph and `UPGRADE` block, and the cancelling section, in `{PRO_OPEN ? (…) : (…)}`; the closed branch reads, as a draft: "Pro opens soon. Until then, the free plan works as described above." Add to `pages-content.test.ts`:
```ts
  it('shows the upgrade command exactly when Pro is open', () => {
    expect(text('pricing.html').includes('npx @solenoid.systems/cli upgrade')).toBe(process.env.PUBLIC_PRO_OPEN !== 'false')
  })
```
In the first test of that file, "prices Free and Pro in USD…", wrap the line comparing the positions of `init` and `upgrade`, and the `no partial refunds` line, in `if (process.env.PUBLIC_PRO_OPEN !== 'false') { … }`. Then run both, as two required steps: `pnpm test` proves the open build, and `PUBLIC_PRO_OPEN=false pnpm test` proves the closed one. A plain `pnpm test` says nothing about the closed build, so neither run stands in for the other. Commit with the message "Add a Pro opens soon build of /pricing for order B".

- [ ] **Step 7: Copy gate (controller)**

Build, then grade from `unit-text.mjs` output:
  - `/pricing` (closing; medium: pricing page). Under Order B, grade both builds as two units. Source check: none cited.
  - `/why` (non-closing; medium: founder note). It cites all seven incident URLs: run `copy-source-checker`. Check it against the brief's incident table, word for word where the brief quotes, keeping "in some cases" and never quoting a literal stop command.
  - `/privacy` (non-closing; medium: privacy notice, NZ Privacy Act 2020). Truth-check every row against the code and the spec's inventory.
  - `/404` (non-closing; medium: error page).
  - Every page's title and meta description (`node site/scripts/unit-text.mjs --meta site/dist`), as one unit (medium: search result snippets).

  Grade files: `docs/copy/grades/site-pricing.md` (and `site-pricing-closed.md` under Order B), `site-why.md`, `site-privacy.md`, `site-404.md`, `site-meta.md`.

- [ ] **Step 8: Commit the graded copy**
```bash
git add site/src docs/copy/grades
git commit -m "Grade the pricing, founder note, privacy, 404 and meta description copy"
```

---

### Task 11: Serving: `wrangler.jsonc`, `_headers`, `_redirects`, the old-path fixture and the route test

Spec: Serving; Redirects; Testing, "Routes"; success criterion 3; Launch order step 1 (the trailing-slash check). Review Focus 4.

**Files:**
- Create: `site/wrangler.jsonc`, `site/public/_headers`, `site/public/_redirects`, `site/public/robots.txt`, `site/public/.well-known/security.txt`, `site/scripts/old-paths.mjs`, `site/test/fixtures/old-paths.txt` (generated), `site/scripts/lib/serve.mjs`, `site/scripts/lib/routes.mjs`, `site/scripts/check-routes.mjs`, `site/test/serving.test.ts`, `site/test/routes.test.ts`, `site/test/dist/routes.test.ts`

**Interfaces:**
- Produces:
  - `site/scripts/lib/serve.mjs`: `startSite(): Promise<{ origin: string; stop(): void }>`, `wrangler dev` over `dist` on `127.0.0.1` and a free port.
  - `site/scripts/lib/routes.mjs`: `SAMPLES: [path, status, to][]`, `follow(origin, path, f?)`, `checkRoutes(origin: string, paths: string[], f?: typeof fetch): Promise<string[]>` (one problem per string).
  - `site/scripts/check-routes.mjs <origin>`: runs `checkRoutes` over the fixture against any origin, with GETs only; exits 1 on any problem. Task 24 runs it against production.

- [ ] **Step 1: Write the failing tests**

`site/test/serving.test.ts` (fast):
```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')

describe('serving config', () => {
  it('is an assets-only Worker that declares both custom domains', () => {
    const w = JSON.parse(read('wrangler.jsonc'))
    expect(w.name).toBe('solenoid-systems')
    expect(w.compatibility_date).toBe('2026-09-01')
    expect(w.main).toBeUndefined()
    expect(w.services).toBeUndefined()
    expect(w.assets).toEqual({ directory: './dist', not_found_handling: '404-page', html_handling: 'drop-trailing-slash' })
    expect(w.routes).toEqual([{ pattern: 'solenoid.systems', custom_domain: true }, { pattern: 'www.solenoid.systems', custom_domain: true }])
  })
  it('keeps _redirects inside Cloudflare limits, never redirects /_astro, and gives every exact rule a /* companion', () => {
    const rules = read('public/_redirects').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim().split(/\s+/))
    expect(rules.length).toBeLessThanOrEqual(2000)
    expect(rules.filter(([from]) => from.includes('*')).length).toBeLessThanOrEqual(100)
    expect(rules.some(([from]) => from.startsWith('/_astro'))).toBe(false)
    const froms = new Set(rules.map(([from]) => from))
    for (const [from] of rules) if (!from.includes('*') && !/\.(md|html|xml)$/.test(from)) expect(froms, from).toContain(`${from}/*`)
  })
  it('publishes a security.txt that has not expired', () => {
    const t = read('public/.well-known/security.txt')
    expect(t).toContain('Contact: mailto:security@solenoid.systems')
    expect(Date.parse(/^Expires: (.+)$/m.exec(t)![1])).toBeGreaterThan(Date.now())
  })
})
```

`site/test/routes.test.ts` (fast; proves the check can fail):
```ts
import { describe, expect, it } from 'vitest'
import { checkRoutes, follow } from '../scripts/lib/routes.mjs'

const O = 'http://127.0.0.1:1'
const site = (table: Record<string, [number, string?, Record<string, string>?]>) => (async (input: RequestInfo | URL) => {
  const u = new URL(String(input))
  const [status, location, headers = {}] = table[u.pathname + u.search] ?? table[u.pathname] ?? [404]
  return new Response(status === 200 ? 'ok' : null, { status, headers: { ...(location ? { location } : {}), ...headers } })
}) as typeof fetch

describe('follow', () => {
  it('follows at most two redirects', async () => {
    const f = site({ '/a': [301, '/b'], '/b': [307, '/c'], '/c': [301, '/d'], '/d': [200] })
    expect((await follow(O, '/a', f)).status).toBe(301)
    expect((await follow(O, '/b', f)).status).toBe(200)
  })
})

describe('checkRoutes', () => {
  it('reports every old path that does not end at 200', async () => {
    const problems = await checkRoutes(O, ['/gone', '/loop'], site({ '/loop': [301, '/loop'] }))
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining('/gone: 404'), expect.stringContaining('/loop: 301')]))
  })
})
```

`site/test/dist/routes.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { checkRoutes } from '../../scripts/lib/routes.mjs'
import { startSite } from '../../scripts/lib/serve.mjs'
import { readDist } from './dist'

let site: { origin: string; stop(): void }
beforeAll(async () => { readDist('index.html'); site = await startSite() })
afterAll(() => site?.stop())

it('answers every old path, rule, header and page as the spec says, under wrangler dev over dist', async () => {
  const paths = readFileSync(fileURLToPath(new URL('../fixtures/old-paths.txt', import.meta.url)), 'utf8').split('\n').filter(Boolean)
  expect(paths.length).toBeGreaterThan(200)
  expect(paths.some((p) => p.startsWith('/_astro/'))).toBe(false)
  expect(await checkRoutes(site.origin, paths)).toEqual([])
})
```

Run: `cd site && pnpm vitest run test/serving.test.ts test/routes.test.ts`
Expected: FAIL: none of the files exist.

- [ ] **Step 2: The config files**

`site/wrangler.jsonc` (the routes block is the old site's, verbatim):
```jsonc
{
  "name": "solenoid-systems",
  "compatibility_date": "2026-09-01",
  "assets": { "directory": "./dist", "not_found_handling": "404-page", "html_handling": "drop-trailing-slash" },
  "routes": [
    { "pattern": "solenoid.systems", "custom_domain": true },
    { "pattern": "www.solenoid.systems", "custom_domain": true }
  ]
}
```

`site/public/_headers`:
```
/*
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: frame-ancestors 'none'

/llms.txt
  Content-Type: text/plain; charset=utf-8

/llms-full.txt
  Content-Type: text/plain; charset=utf-8
```

`site/public/_redirects` (the spec's table, top-most first; every exact path rule has its `/*` companion):
```
/catch.md /llms.txt 301
/gate.md /llms.txt 301
/key.md /llms.txt 301
/latch.md /llms.txt 301
/meter.md /llms.txt 301
/pulse.md /llms.txt 301
/relay.md /llms.txt 301
/witness.md /llms.txt 301
/api / 301
/api/* / 301
/docs/* /docs 301
/blog / 302
/blog/* / 302
/rss.xml / 302
/catch / 301
/catch/* / 301
/gate / 301
/gate/* / 301
/key / 301
/key/* / 301
/latch / 301
/latch/* / 301
/meter / 301
/meter/* / 301
/pulse / 301
/pulse/* / 301
/relay / 301
/relay/* / 301
/witness / 301
/witness/* / 301
/nexus / 301
/nexus/* / 301
/solenoid-mcp / 301
/solenoid-mcp/* / 301
/billing / 301
/billing/* / 301
/checkout / 301
/checkout/* / 301
/oauth / 301
/oauth/* / 301
/downloads / 301
/downloads/* / 301
/philosophy / 301
/philosophy/* / 301
/status / 301
/status/* / 301
/demos / 301
/demos/* / 301
/witness-verifier / 301
/witness-verifier/* / 301
/witness-verifier.html / 301
```

`site/public/robots.txt` (the old file):
```
User-agent: *
Allow: /

Sitemap: https://solenoid.systems/sitemap-index.xml
```

`site/public/.well-known/security.txt`:
```
Contact: mailto:security@solenoid.systems
Expires: 2027-09-30T00:00:00.000Z
Preferred-Languages: en
Canonical: https://solenoid.systems/.well-known/security.txt
```
`astro build` copies `public/.well-known/`, `_redirects` and `_headers` into `dist/`, and `wrangler dev` does not serve `_redirects` or `_headers` as assets (checked in the review).

- [ ] **Step 3: The route library, the server helper and the check script**

`site/scripts/lib/serve.mjs`:
```js
import { spawn } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = fileURLToPath(new URL('../..', import.meta.url))

const freePort = () => new Promise((done, fail) => {
  const s = createServer().once('error', fail)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)) })
})

export async function startSite() {
  const port = await freePort()
  const env = { ...process.env }
  delete env.SOLENOID_KEY
  delete env.SOLENOID_API
  const logDir = mkdtempSync(join(tmpdir(), 'solenoid-site-dev-'))
  const log = openSync(join(logDir, 'wrangler.log'), 'w')
  const proc = spawn(`${site}/node_modules/.bin/wrangler`, ['dev', '--port', String(port), '--ip', '127.0.0.1', '--show-interactive-dev-session=false'], { cwd: site, env, stdio: ['ignore', log, log], detached: true })
  const stop = () => {
    if (proc.pid) try { process.kill(-proc.pid, 'SIGTERM') } catch {}
    closeSync(log)
    rmSync(logDir, { recursive: true, force: true })
  }
  const origin = `http://127.0.0.1:${port}`
  for (let i = 0; i < 120 && proc.exitCode === null; i++) {
    if (await fetch(`${origin}/favicon.svg`).then((r) => r.ok, () => false)) return { origin, stop }
    await new Promise((r) => setTimeout(r, 500))
  }
  const tail = readFileSync(join(logDir, 'wrangler.log'), 'utf8').split('\n').slice(-20).join('\n')
  stop()
  throw new Error(`wrangler dev did not serve site/dist on :${port}. Its last output:\n${tail}`)
}
```

`site/scripts/lib/routes.mjs`:
```js
const MAX_HOPS = 2

export const SAMPLES = [
  ['/catch.md', 301, '/llms.txt'],
  ['/api/health', 301, '/'],
  ['/docs/catch/overview', 301, '/docs'],
  ['/blog/edge-native-apis', 302, '/'],
  ['/rss.xml', 302, '/'],
  ['/gate', 301, '/'],
  ['/witness/verify', 301, '/'],
  ['/philosophy/', 301, '/'],
  ['/checkout/success', 301, '/'],
  ['/witness-verifier.html', 301, '/'],
]
const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "frame-ancestors 'none'",
}
const get = (f, origin, path) => f(new URL(path, origin), { redirect: 'manual' })

export async function follow(origin, path, f = fetch) {
  let url = new URL(path, origin)
  for (let hops = 0; ; hops++) {
    const res = await f(url, { redirect: 'manual' })
    if (res.status < 300 || res.status > 399 || hops === MAX_HOPS) return { status: res.status, hops, url }
    url = new URL(res.headers.get('location') ?? '', url)
  }
}

export async function checkRoutes(origin, paths, f = fetch) {
  const problems = []
  for (const p of paths) {
    const r = await follow(origin, p, f)
    if (r.status !== 200) problems.push(`${p}: ${r.status} after ${r.hops} redirects, at ${r.url.pathname}`)
  }
  for (const [p, status, to] of SAMPLES) {
    const res = await get(f, origin, p)
    const at = new URL(res.headers.get('location') ?? '', origin).pathname
    if (res.status !== status || at !== to) problems.push(`${p}: ${res.status} to ${at}, expected ${status} to ${to}`)
  }
  for (const p of ['/pricing', '/?ref=hn', '/pricing?ref=launch']) {
    const res = await get(f, origin, p)
    if (res.status !== 200) problems.push(`${p}: ${res.status}, expected 200 with no redirect`)
  }
  const slash = await get(f, origin, '/pricing/')
  if (slash.status < 300 || slash.status > 399 || new URL(slash.headers.get('location') ?? '', origin).pathname !== '/pricing') problems.push(`/pricing/: ${slash.status}, expected a redirect to /pricing`)
  for (const p of ['/llms.txt', '/llms-full.txt']) {
    const type = (await get(f, origin, p)).headers.get('content-type')
    if (type !== 'text/plain; charset=utf-8') problems.push(`${p}: content-type ${type}`)
  }
  const home = await get(f, origin, '/')
  for (const [h, v] of Object.entries(SECURITY_HEADERS)) if (home.headers.get(h) !== v) problems.push(`/: ${h} is ${home.headers.get(h)}`)
  const missing = await get(f, origin, '/no-such-page')
  if (missing.status !== 404 || !(await missing.text()).includes('href="/docs"')) problems.push(`/no-such-page: ${missing.status}, expected the 404 page`)
  const security = await get(f, origin, '/.well-known/security.txt')
  if (security.status !== 200 || !(await security.text()).includes('Contact: mailto:security@solenoid.systems')) problems.push('/.well-known/security.txt is missing or has no contact')
  return problems
}
```
The fast test's fake site answers 404 for the extra checks too, so its problem list has more lines than the two it asserts; `arrayContaining` allows that.

`site/scripts/check-routes.mjs`:
```js
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkRoutes } from './lib/routes.mjs'

const origin = process.argv[2]
if (!origin) { console.error('usage: node site/scripts/check-routes.mjs <origin>'); process.exit(2) }
const paths = readFileSync(fileURLToPath(new URL('../test/fixtures/old-paths.txt', import.meta.url)), 'utf8').split('\n').filter(Boolean)
const problems = await checkRoutes(origin, paths)
for (const p of problems) console.error(p)
console.log(`${paths.length} old paths checked against ${origin}: ${problems.length} problems`)
process.exitCode = problems.length ? 1 : 0
```

- [ ] **Step 4: Generate the old-path fixture**

`site/scripts/old-paths.mjs`:
```js
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFiles } from './lib/files.mjs'

const OLD = process.argv[2] ?? join(homedir(), 'dev', 'solenoid.systems')
const git = (...args) => execFileSync('git', ['-C', OLD, ...args], { encoding: 'utf8' }).split('\n').filter(Boolean)

const sitemap = await (await fetch('https://solenoid.systems/sitemap-0.xml')).text()
const fromSitemap = [...sitemap.matchAll(/<loc>https:\/\/solenoid\.systems([^<]*)<\/loc>/g)].map((m) => m[1] || '/')
if (fromSitemap.length === 0) throw new Error('the live sitemap listed no URLs; is solenoid.systems still the old site?')
const fromPublic = git('ls-files', 'public').map((p) => p.slice('public'.length))
const fromDist = listFiles(join(OLD, 'dist')).map((p) => `/${p}`).filter((p) => !p.startsWith('/_astro/'))
const fromPages = git('ls-files', 'src/pages').filter((p) => !p.includes('[')).map((p) => p.replace(/^src\/pages/, '').replace(/\.(astro|ts)$/, '').replace(/\/index$/, '') || '/')
const extra = ['/api/health', '/status', '/sitemap-index.xml', '/rss.xml']

const paths = [...new Set([...fromSitemap, ...fromPublic, ...fromDist, ...fromPages, ...extra])].sort()
writeFileSync(fileURLToPath(new URL('../test/fixtures/old-paths.txt', import.meta.url)), `${paths.join('\n')}\n`)
console.log(`${paths.length} paths: ${fromSitemap.length} from the sitemap, ${fromPublic.length} public files, ${fromDist.length} dist files, ${fromPages.length} page routes`)
```
The `/_astro/*` files are hashed build output that nothing links to by URL, and a `/_astro/*` redirect would also catch the new site's own scripts and styles (spec, Redirects).

Run: `mkdir -p site/test/fixtures && node site/scripts/old-paths.mjs`
Expected: 94 from the sitemap, and more than 200 paths in all. This is the one run before cutover; the output is committed.

- [ ] **Step 5: Record the trailing-slash result (spec, step 1)**

The review settled the spec's step-1 check under `wrangler dev` 4.136.3 with `compatibility_date` 2026-09-01: an exact rule `/probe` answers `/probe` with 301 and `/probe/` with 404. Exact rules do not match a trailing slash, so the `/*` companions are what serve `/philosophy/` and the rest, and `serving.test.ts` requires one for every exact path rule. Under the same run, `/docs/` answered 301 to `/docs` (the splat); `/pricing/`, `/pricing.html` and `/pricing/index.html` answered 307 to `/pricing`; and `/?ref=hn` answered 200. Copy these results into the execution record; the route test re-proves them on every `pnpm test`.

- [ ] **Step 6: Run the site suite**

Run: `cd site && pnpm typecheck && pnpm test`
Expected: PASS, the route test included. If a fixture path has no rule and no page, add the narrowest `_redirects` line that sends it where the spec's table sends its neighbours, and name it in the report.

- [ ] **Step 7: Commit**
```bash
git add site/wrangler.jsonc site/public site/scripts site/test docs/superpowers/plans/2026-09-30-solenoid-go-live.record.md
git commit -m "Serve the site as an assets-only Worker, and redirect every old path to a page that answers"
```

---

### Task 12: Licenses, `LICENSING.md`, package metadata, `SECURITY.md` and the scrub check

Spec: Licensing (all of it); Launch order step 1 (`SECURITY.md`, `.superpowers/` in `.gitignore`, `repository`, `homepage` and `bugs`) and step 4 (the scrub). Decisions 15 and 21.

**Files:**
- Create:
  - FSL-1.1-ALv2: `worker/LICENSE`, `testing/LICENSE`, `e2e/LICENSE`, `docs/superpowers/LICENSE`
  - MIT: `sdk/LICENSE`, `cli/LICENSE`, `mcp/LICENSE`, `contract/LICENSE`, `site/LICENSE`, `docs/LICENSE`
  - `LICENSING.md`, `SECURITY.md`, `scripts/scrub-check.mjs`, `e2e/test/licensing.test.ts`, `e2e/test/scrub-check.test.ts`
- Modify: `worker/package.json` and `e2e/package.json` (`"license"`), `sdk/package.json`, `cli/package.json`, `mcp/package.json`, `testing/package.json` (`repository`, `homepage`, `bugs`), `.gitignore` (`.superpowers/` and `.scrub-patterns`), `lefthook.yml` (the scrub command)

**Interfaces:**
- Produces: `node scripts/scrub-check.mjs [--from <file>] [<pattern>...]`: prints every staged line (`git grep --cached`) that contains any pattern (fixed strings, from the arguments and from the file's non-blank lines that don't start with `#`) and exits 1; exits 0 when there are none, or when `--from` names a file with no patterns; exits 2 with no patterns and no `--from`. Lefthook runs it with `--from .scrub-patterns` on every commit once that git-ignored file exists; Task 18 creates it and Task 21 extends it.

- [ ] **Step 1: Write the failing tests**

`e2e/test/licensing.test.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = (p: string) => resolve(__dirname, '../..', p)
const read = (p: string) => readFileSync(repo(p), 'utf8')
const pkg = (d: string) => JSON.parse(read(`${d}/package.json`)) as Record<string, any>
const FSL = ['worker', 'testing', 'e2e', 'docs/superpowers']
const MIT = ['sdk', 'cli', 'mcp', 'contract', 'site', 'docs']

describe('the license split', () => {
  it('gives every directory its LICENSE, naming the licensor, and the repository root none', () => {
    for (const d of FSL) {
      expect(read(`${d}/LICENSE`), d).toMatch(/^# Functional Source License, Version 1\.1, ALv2 Future License\n/)
      expect(read(`${d}/LICENSE`), d).toContain('Copyright 2026 Robin Lange, trading as omit')
      expect(read(`${d}/LICENSE`), d).not.toContain('${')
    }
    for (const d of MIT) {
      expect(read(`${d}/LICENSE`), d).toMatch(/^MIT License\n\nCopyright \(c\) 2026 Robin Lange, trading as omit\n/)
    }
    expect(existsSync(repo('LICENSE'))).toBe(false)
    expect(read('site/public/fonts/OFL-Archivo.txt')).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })

  it('declares the same license in every package.json', () => {
    for (const d of ['worker', 'testing', 'e2e']) expect(pkg(d).license, d).toBe('FSL-1.1-ALv2')
    for (const d of ['sdk', 'cli', 'mcp', 'site']) expect(pkg(d).license, d).toBe('MIT')
  })

  it('points each published package at the repository, the site and the issue tracker', () => {
    for (const d of ['sdk', 'cli', 'mcp', 'testing']) {
      expect(pkg(d), d).toMatchObject({
        repository: { type: 'git', url: 'git+https://github.com/robinslange/solenoid.git', directory: d },
        homepage: 'https://solenoid.systems',
        bugs: { url: 'https://github.com/robinslange/solenoid/issues' },
      })
    }
  })

  it('maps every directory in LICENSING.md, and never calls the server open source', () => {
    const map = read('LICENSING.md')
    for (const d of [...FSL, ...MIT, 'site/public/fonts', 'scripts', '.github']) expect(map, d).toContain(`\`${d}/\``)
    expect(map).toContain('Robin Lange, trading as omit')
    expect(map).not.toMatch(/open[\s-]source/i)
  })

  it('runs the scrub check on every commit once the local pattern file exists, and never commits that file', () => {
    expect(read('.gitignore').split('\n')).toContain('.scrub-patterns')
    expect(read('lefthook.yml')).toContain('test ! -f .scrub-patterns || node scripts/scrub-check.mjs --from .scrub-patterns')
  })
})
```

`e2e/test/scrub-check.test.ts`:
```ts
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { sandbox } from './setup'

const SCRIPT = resolve(__dirname, '../../scripts/scrub-check.mjs')
const run = (cwd: string, ...patterns: string[]) => spawnSync(process.execPath, [SCRIPT, ...patterns], { cwd, encoding: 'utf8' })

it('lists staged lines holding any pattern, ignores untracked and unstaged text, and exits 1 only on a hit', () => {
  const dir = mkdtempSync(join(sandbox, 'scrub-'))
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: dir })
  git('init', '-q')
  writeFileSync(join(dir, 'a.md'), 'clean\nreach me at someone@example.org\n')
  git('add', 'a.md')
  writeFileSync(join(dir, 'b.md'), 'untracked: someone@example.org\n')
  const hit = run(dir, 'someone@example.org', '/home/nobody/')
  expect(hit.status).toBe(1)
  expect(hit.stdout).toBe('a.md:2:reach me at someone@example.org\n')
  const clean = run(dir, 'nobody@example.org')
  expect([clean.status, clean.stdout]).toEqual([0, 'no tracked file contains any of the 1 patterns\n'])
  expect(run(dir).status).toBe(2)
  writeFileSync(join(dir, 'pats'), '# one per line\n\nsomeone@example.org\n')
  const fromFile = run(dir, '--from', 'pats')
  expect([fromFile.status, fromFile.stdout]).toEqual([1, 'a.md:2:reach me at someone@example.org\n'])
  writeFileSync(join(dir, 'empty'), '# nothing yet\n')
  expect([run(dir, '--from', 'empty').status, run(dir, '--from', 'empty').stdout]).toEqual([0, 'no patterns to check\n'])
  writeFileSync(join(dir, 'a.md'), 'clean\n')
  expect(run(dir, 'someone@example.org').status).toBe(1)
  git('add', 'a.md')
  writeFileSync(join(dir, 'a.md'), 'clean\nsomeone@example.org, unstaged\n')
  expect(run(dir, 'someone@example.org').status).toBe(0)
})
```

Run: `pnpm --filter @solenoid/e2e test -- test/licensing.test.ts test/scrub-check.test.ts`
Expected: FAIL: no LICENSE files, no metadata, no script.

- [ ] **Step 2: The license texts**

FSL (the fsl.software template, filled in):
```bash
curl -s https://fsl.software/FSL-1.1-ALv2.template.md | sed 's/\${year}/2026/; s/\${licensor name}/Robin Lange, trading as omit/' > /tmp/solenoid-FSL
head -9 /tmp/solenoid-FSL
for d in worker testing e2e docs/superpowers; do cp /tmp/solenoid-FSL "$d/LICENSE"; done
rm /tmp/solenoid-FSL
```
Expected from `head`: the heading, `FSL-1.1-ALv2`, and `Copyright 2026 Robin Lange, trading as omit`.

MIT, written to each of `sdk/LICENSE`, `cli/LICENSE`, `mcp/LICENSE`, `contract/LICENSE`, `site/LICENSE`, `docs/LICENSE`:
```
MIT License

Copyright (c) 2026 Robin Lange, trading as omit

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`LICENSING.md`:
```markdown
# Licensing

This repository is split by license. Code that runs the Solenoid server is source-available under FSL-1.1-ALv2. Client code is MIT. There is no single license at the root; each directory carries its own `LICENSE`, and this file maps them. The licensor is Robin Lange, trading as omit.

| Path | License | Why |
|---|---|---|
| `worker/` | FSL-1.1-ALv2 | The server |
| `testing/` | FSL-1.1-ALv2 | `@solenoid.systems/testing` bundles the server's request handler and ledger |
| `e2e/` | FSL-1.1-ALv2 | It drives the server, and holds the proof tests, the race recorder and the canary |
| `docs/superpowers/` | FSL-1.1-ALv2 | The design specs and plans contain the server's source |
| `sdk/` | MIT | Client |
| `cli/` | MIT | Client |
| `mcp/` | MIT | Client |
| `contract/` | MIT | Client-side scenarios written against the SDK |
| `site/` | MIT | solenoid.systems |
| `docs/` | MIT | Documentation, except `docs/superpowers/` |
| `site/public/fonts/` | SIL Open Font License 1.1 | Archivo and JetBrains Mono; the license texts ship beside the fonts |
| `scripts/`, `.github/` and the files at the root | MIT | Repository tooling and documentation |

## FSL-1.1-ALv2, in its own terms

You may use, copy, change and redistribute the server for any purpose except a Competing Use: making it available to others in a commercial product or service that substitutes for it, or that offers the same or substantially similar functionality. Internal use, non-commercial education and non-commercial research are permitted. Each version becomes available under the Apache License 2.0 on the second anniversary of its release. The full text is in each FSL directory's `LICENSE`, from the [FSL-1.1-ALv2 template](https://fsl.software/FSL-1.1-ALv2.template.md).
```

`SECURITY.md`:
```markdown
# Security

Report a vulnerability to security@solenoid.systems, not in a public issue. Say what you found, how to reproduce it, and what it affects.

In scope: the API at `api.solenoid.systems` (`worker/`), the packages `@solenoid.systems/sdk`, `@solenoid.systems/cli`, `@solenoid.systems/mcp` and `@solenoid.systems/testing`, and the site at `solenoid.systems`.
```

- [ ] **Step 3: Metadata, `.gitignore` and the scrub check**

`worker/package.json` and `e2e/package.json`: add `"license": "FSL-1.1-ALv2",` after `"private": true,`.

`sdk/package.json`, `cli/package.json`, `mcp/package.json`, `testing/package.json`: add after `"license"`, with `directory` set to the package's own directory:
```json
  "repository": { "type": "git", "url": "git+https://github.com/robinslange/solenoid.git", "directory": "sdk" },
  "homepage": "https://solenoid.systems",
  "bugs": { "url": "https://github.com/robinslange/solenoid/issues" },
```

`.gitignore`: add two lines, `.superpowers/` and `.scrub-patterns`. The root file has no `.superpowers/` line today: the directory's contents are ignored only by `.gitignore` files inside its `brainstorm/` and `sdd/` subdirectories, so a new subdirectory without one would be committable.

`lefthook.yml`, a third pre-commit command under `commands:`:
```yaml
    scrub:
      run: test ! -f .scrub-patterns || node scripts/scrub-check.mjs --from .scrub-patterns
```

`scripts/scrub-check.mjs`:
```js
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const at = args.indexOf('--from')
const fromFile = at === -1 ? [] : readFileSync(args[at + 1], 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
const patterns = [...args.filter((_, i) => at === -1 || (i !== at && i !== at + 1)), ...fromFile]
if (patterns.length === 0 && at !== -1) {
  console.log('no patterns to check')
  process.exit(0)
}
if (patterns.length === 0) {
  console.error('usage: node scripts/scrub-check.mjs [--from <file>] [<pattern>...]  (fixed strings, matched in staged files)')
  process.exit(2)
}
let hits = ''
try {
  hits = execFileSync('git', ['grep', '--cached', '-n', '-I', '-F', ...patterns.flatMap((p) => ['-e', p]), '--', '.'], { encoding: 'utf8' })
} catch (e) {
  if (e.status !== 1) throw e
}
if (hits) {
  process.stdout.write(hits)
  process.exit(1)
}
console.log(`no tracked file contains any of the ${patterns.length} patterns`)
```
It carries no pattern itself, so the scrub has nothing to scrub from it (Decision 15). It greps the index (`--cached`), which is exactly what the commit will contain: a pattern anywhere in the staged tree fails the commit, whichever file it came from, and unstaged edits neither block nor pass it. A pattern file holding only comments means nothing to check yet.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @solenoid/e2e test`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add worker/LICENSE testing/LICENSE e2e/LICENSE docs/superpowers/LICENSE sdk/LICENSE cli/LICENSE mcp/LICENSE contract/LICENSE site/LICENSE docs/LICENSE LICENSING.md SECURITY.md scripts .gitignore lefthook.yml worker/package.json e2e/package.json sdk/package.json cli/package.json mcp/package.json testing/package.json e2e/test/licensing.test.ts e2e/test/scrub-check.test.ts
git commit -m "License the server FSL-1.1-ALv2 and the clients MIT, map the split in LICENSING.md, and add SECURITY.md"
```

---

### Task 13: Site checks: links, house style and screenshots

Spec: Testing (Links, House style, Look); Launch order step 10 (launch mode).

**Files:**
- Create: `site/scripts/lib/links.mjs`, `site/scripts/lib/lint.mjs`, `site/scripts/check-dist.mjs`, `site/scripts/screenshots.mjs`, `site/test/links.test.ts`, `site/test/lint.test.ts`, `site/test/dist/checks.test.ts`
- Modify: `site/package.json` (`build` runs the checks)

**Interfaces:**
- Produces:
  - `checkLinks(dist: string, o: { repoRoot: string; launch?: boolean; git?: (args: string[]) => string }): string[]`
  - `lintHtml(html: string): string[]`, `RULES`
  - `node site/scripts/check-dist.mjs [--launch]`: the single-source check, the link check and the lint over `site/dist`; exits 1 on any problem.
  - `pnpm --filter @solenoid/site screenshots`: PNGs in `site/reports/screenshots/` (git-ignored).

- [ ] **Step 1: Write the failing tests**

`site/test/lint.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { lintHtml } from '../scripts/lib/lint.mjs'

const page = (body: string) => `<html><head><title>T</title></head><body>${body}</body></html>`

describe('lintHtml', () => {
  it('flags dashes, double hyphens and the banned phrases in text', () => {
    for (const bad of ['a \u2014 b', 'a \u2013 b', 'run it -- now', 'served at the edge', 'This would have prevented it', 'fully open source', 'Open-source server']) {
      expect(lintHtml(page(`<p>${bad}</p>`)), bad).toHaveLength(1)
    }
  })
  it('reads text nodes only: code, pre, scripts, styles, comments and attributes pass', () => {
    const html = page('<p>Clean prose.</p><code>--rotate</code><pre>a -- b</pre><script>x--</script><style>a{}</style><!-- a -- b --><a href="#--env-filefile" title="open source">link</a>')
    expect(lintHtml(html)).toEqual([])
  })
  it('lints the title too', () => {
    expect(lintHtml('<html><head><title>A \u2014 B</title></head><body></body></html>')).toHaveLength(1)
  })
})
```

`site/test/links.test.ts`:
```ts
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkLinks } from '../scripts/lib/links.mjs'

const AT = 'https://github.com/robinslange/solenoid/blob/launch/'
function fixture(pages: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'site-links-'))
  const dist = join(root, 'site/dist')
  mkdirSync(dist, { recursive: true })
  for (const [p, html] of Object.entries(pages)) writeFileSync(join(dist, p), html)
  mkdirSync(join(root, 'e2e/test'), { recursive: true })
  writeFileSync(join(root, 'e2e/test/concurrency.test.ts'), 'x')
  return { root, dist }
}
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd, encoding: 'utf8' })

describe('checkLinks, development mode', () => {
  it('passes internal links to files and ids, and GitHub links to files in the working tree', () => {
    const f = fixture({ 'index.html': `<a href="/docs#testing">d</a><a href="/llms.txt">l</a><a href="${AT}e2e/test/concurrency.test.ts">t</a><a href="https://example.com/x">x</a>`, 'docs.html': '<h2 id="testing">T</h2>', 'llms.txt': 'x' })
    expect(checkLinks(f.dist, { repoRoot: f.root })).toEqual([])
  })
  it('fails a missing page, a trailing-slash link, a missing id, a missing file and another ref', () => {
    const f = fixture({ 'index.html': `<a href="/nope">a</a><a href="/docs/">b</a><a href="/docs#gone">c</a><a href="${AT}e2e/nope.ts">d</a><a href="https://github.com/robinslange/solenoid/blob/main/e2e/test/concurrency.test.ts">e</a>`, 'docs.html': '<h2 id="testing">T</h2>' })
    expect(checkLinks(f.dist, { repoRoot: f.root })).toHaveLength(5)
  })
})

describe('checkLinks, launch mode', () => {
  function tagged() {
    const f = fixture({ 'index.html': `<a href="${AT}e2e/test/concurrency.test.ts">t</a>` })
    const origin = mkdtempSync(join(tmpdir(), 'site-origin-'))
    git(origin, 'init', '-q', '--bare')
    git(f.root, 'init', '-q')
    git(f.root, 'add', 'e2e')
    git(f.root, 'commit', '-q', '-m', 'snapshot')
    git(f.root, 'tag', 'launch')
    git(f.root, 'remote', 'add', 'origin', origin)
    return f
  }
  it('passes when the pushed tag is the local tag and holds every linked file', () => {
    const f = tagged()
    git(f.root, 'push', '-q', 'origin', 'launch')
    expect(checkLinks(f.dist, { repoRoot: f.root, launch: true })).toEqual([])
  })
  it('fails when the tag was never pushed', () => {
    const f = tagged()
    expect(checkLinks(f.dist, { repoRoot: f.root, launch: true })).toEqual([expect.stringContaining('the launch tag on origin')])
  })
  it('fails when a linked file is not at the tag', () => {
    const f = tagged()
    git(f.root, 'push', '-q', 'origin', 'launch')
    writeFileSync(join(f.dist, 'index.html'), `<a href="${AT}e2e/later.ts">t</a>`)
    writeFileSync(join(f.root, 'e2e/later.ts'), 'x')
    expect(checkLinks(f.dist, { repoRoot: f.root, launch: true })).toHaveLength(1)
  })
})
```

`site/test/dist/checks.test.ts`:
```ts
import { expect, it } from 'vitest'
import { checkLinks } from '../../scripts/lib/links.mjs'
import { lintHtml } from '../../scripts/lib/lint.mjs'
import { DIST, REPO_ROOT, htmlPages, readDist } from './dist'

it('has no broken internal link, and every GitHub link names a file in the working tree', () => {
  expect(checkLinks(DIST, { repoRoot: REPO_ROOT })).toEqual([])
})

it('keeps the house style in every text node of every page', () => {
  expect(htmlPages().flatMap((p) => lintHtml(readDist(p)).map((x) => `${p}: ${x}`))).toEqual([])
})
```

Run: `cd site && pnpm vitest run test/lint.test.ts test/links.test.ts`
Expected: FAIL: the modules do not exist.

- [ ] **Step 2: The checks**

`site/scripts/lib/lint.mjs`:
```js
import { textNodes } from './html.mjs'

const SKIP = new Set(['code', 'pre', 'script', 'style', 'template', 'noscript'])
export const RULES = [
  [/[\u2013\u2014]/, 'an en or em dash'],
  [/--/, '"--" in prose'],
  [/at the edge/i, '"at the edge"'],
  [/would have prevented/i, '"would have prevented"'],
  [/open[\s-]source/i, '"open source"'],
]

export const lintHtml = (html) =>
  textNodes(html, SKIP).flatMap((t) => RULES.filter(([re]) => re.test(t)).map(([, what]) => `${what}: "${t.trim().slice(0, 80)}"`))
```

`site/scripts/lib/links.mjs`:
```js
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFiles } from './files.mjs'
import { attr, root, walk } from './html.mjs'

const SITE = 'https://solenoid.systems'
const REPO = 'https://github.com/robinslange/solenoid'
const TAG = 'launch'

function fileFor(dist, pathname) {
  const p = decodeURIComponent(pathname)
  if (p === '/') return 'index.html'
  if (p.endsWith('/')) return undefined
  return [p.slice(1), `${p.slice(1)}.html`].find((f) => existsSync(join(dist, f)))
}

export function checkLinks(dist, { repoRoot, launch = false, git = (args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }) }) {
  const problems = []
  let atTag = null
  if (launch) {
    const remote = git(['ls-remote', '--tags', 'origin', `refs/tags/${TAG}`]).split('\t')[0].trim()
    const local = git(['rev-parse', `refs/tags/${TAG}`]).trim()
    if (remote !== local) problems.push(`the ${TAG} tag on origin (${remote || 'missing'}) is not the local ${TAG} tag (${local})`)
    atTag = new Set(git(['ls-tree', '-r', '--name-only', TAG]).split('\n').filter(Boolean))
  }
  const idCache = new Map()
  const idsIn = (file) => {
    if (!idCache.has(file)) idCache.set(file, new Set([...walk(root(readFileSync(join(dist, file), 'utf8')))].map((n) => attr(n, 'id')).filter(Boolean)))
    return idCache.get(file)
  }
  for (const page of listFiles(dist).filter((p) => p.endsWith('.html'))) {
    for (const n of walk(root(readFileSync(join(dist, page), 'utf8')))) {
      const href = n.nodeName === 'a' ? attr(n, 'href') : undefined
      if (!href || href.startsWith('mailto:')) continue
      const url = new URL(href, `${SITE}/${page}`)
      if (url.origin === SITE) {
        const file = fileFor(dist, url.pathname)
        if (!file) problems.push(`${page}: ${href} has no file in dist`)
        else if (url.hash && file.endsWith('.html') && !idsIn(file).has(decodeURIComponent(url.hash.slice(1)))) problems.push(`${page}: ${href} names no id in ${file}`)
      } else if (href.startsWith(`${REPO}/blob/`) || href.startsWith(`${REPO}/tree/`)) {
        const [kind, ref, ...rest] = url.pathname.split('/').slice(3)
        const path = rest.join('/')
        if (ref !== TAG) problems.push(`${page}: ${href} links ${ref}, not the ${TAG} tag`)
        else if (!atTag && !existsSync(join(repoRoot, path))) problems.push(`${page}: ${href} names ${path}, which is not in the working tree`)
        else if (atTag && !(kind === 'blob' ? atTag.has(path) : [...atTag].some((f) => f.startsWith(`${path}/`)))) problems.push(`${page}: ${href} names ${path}, which is not at the ${TAG} tag`)
      }
    }
  }
  return problems
}
```
In launch mode with no tag at all, `git rev-parse` throws, and the command fails loudly; that is the wanted outcome at step 10.

`site/scripts/check-dist.mjs`:
```js
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFiles } from './lib/files.mjs'
import { checkLinks } from './lib/links.mjs'
import { lintHtml } from './lib/lint.mjs'
import { checkSingleSource } from './lib/single-source.mjs'

const dist = fileURLToPath(new URL('../dist', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const launch = process.argv.includes('--launch')
const problems = [
  ...checkSingleSource(dist, repoRoot),
  ...checkLinks(dist, { repoRoot, launch }),
  ...listFiles(dist).filter((p) => p.endsWith('.html')).flatMap((p) => lintHtml(readFileSync(join(dist, p), 'utf8')).map((x) => `${p}: ${x}`)),
]
for (const p of problems) console.error(p)
console.log(`${launch ? 'launch' : 'development'} checks over site/dist: ${problems.length} problems`)
process.exitCode = problems.length ? 1 : 0
```

`site/package.json`: `"build": "astro build && node scripts/check-dist.mjs"`, and `"test": "pnpm build && vitest run"`.

`site/scripts/screenshots.mjs`:
```js
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startSite } from './lib/serve.mjs'

const PAGES = ['/', '/pricing', '/why', '/privacy', '/docs', '/no-such-page']
const WIDTHS = [375, 1280]
const out = fileURLToPath(new URL('../reports/screenshots/', import.meta.url))
mkdirSync(out, { recursive: true })
const site = await startSite()
const browser = await chromium.launch()
try {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.route('https://analytics.omit.nz/**', (r) => r.abort())
    for (const p of PAGES) {
      await page.goto(site.origin + p, { waitUntil: 'load' })
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${out}${(p.slice(1) || 'index').replace(/\W+/g, '-')}-${width}.png`, fullPage: true })
    }
    await page.close()
  }
} finally {
  await browser.close()
  site.stop()
}
console.log(`screenshots in ${out}`)
```
It asserts nothing, so it is not part of `pnpm test` (spec, Testing).

- [ ] **Step 3: Run the site suite**

Run: `cd site && pnpm typecheck && pnpm test`
Expected: PASS. If the lint or the link check fails on real copy, the fix is a copy change: send it back through the gate for that unit (Task 9 or 10) before committing.

- [ ] **Step 4: The screenshot pass (on demand)**

Run once: `cd site && pnpm exec playwright install chromium && pnpm build && pnpm screenshots`. Read every PNG at 375 px and 1280 px: nothing overflows sideways at 375 px, the race box holds all 30 lines, the code tabs switch, and the docs sidebar is hidden at 375 px. Fix layout problems in the components (no copy changes), re-run, and list what changed in the report.

- [ ] **Step 5: Commit**
```bash
git add site/scripts site/test site/package.json site/src
git commit -m "Check the built site's links, single sources and house style on every build, and add an on-demand screenshot pass"
```

---

### Task 14: The production canary

Spec: Launch order steps 1 and 8; governance, Testing ("a scheduled canary spends against a canary tenant from two regions and alerts on failure"). Decision 14.

**Files:**
- Create: `e2e/canary.ts`, `e2e/test/canary.test.ts`, `.github/workflows/canary.yml`
- Modify: `e2e/tsconfig.json` (include `canary.ts`), `e2e/package.json` (`canary` script)

**Interfaces:**
- Produces:
  - `canary(o: { key: string; api?: string; region: string; fetch?: typeof fetch }): Promise<{ seq: number; ms: number }>`: one spend of `{ checks: 1 }` at `canary/<region>`, then `verify()` of its receipt.
  - `alert(o: { resendKey: string; to: string; region: string; error: string; fetch?: typeof fetch }): Promise<void>`
  - `node e2e/canary.ts`, reading `SOLENOID_CANARY_KEY`, `SOLENOID_API` (optional), `CANARY_REGION`, and for alerts `CANARY_ALERT_RESEND_KEY` and `CANARY_ALERT_TO`. Exit 0 and one `ok` line, or exit 1.

- [ ] **Step 1: Write the failing test**

`e2e/test/canary.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { alert, canary } from '../canary.ts'
import { api, ok, user } from './harness'

async function canaryKey() {
  const u = user()
  await ok(u.cli('init'))
  return ok(u.cli('key', 'canary'))
}

describe('canary', () => {
  it('records one spend under canary/<region> and verifies its receipt', async () => {
    const key = await canaryKey()
    const first = await canary({ key, api, region: 'test' })
    const second = await canary({ key, api, region: 'test' })
    expect(second.seq).toBe(first.seq + 1)
    expect(first.ms).toBeGreaterThanOrEqual(0)
  })
  it('fails on a key the API refuses', async () => {
    const key = await canaryKey()
    await expect(canary({ key: `${key.slice(0, -1)}${key.endsWith('0') ? '1' : '0'}`, api, region: 'test' })).rejects.toMatchObject({ status: 401, code: 'invalid_key' })
  })
  it('fails when the receipt does not verify', async () => {
    const key = await canaryKey()
    const f = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/.well-known/solenoid.json') ? Promise.resolve(Response.json({ keys: {} })) : fetch(input, init)) as typeof fetch
    await expect(canary({ key, api, region: 'test', fetch: f })).rejects.toThrow('does not verify')
  })
})

describe('alert', () => {
  it('emails the failure through Resend, and throws when Resend refuses', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    await alert({ resendKey: 're_x', to: 'ops@example.com', region: 'omit-nz', error: 'HTTP 503', fetch: f })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers).toMatchObject({ authorization: 'Bearer re_x' })
    expect(JSON.parse(init.body)).toMatchObject({ to: ['ops@example.com'], subject: 'Solenoid canary failed in omit-nz', text: 'HTTP 503' })
    await expect(alert({ resendKey: 're_x', to: 'a@b.cd', region: 'r', error: 'e', fetch: vi.fn().mockResolvedValue(new Response('', { status: 401 })) })).rejects.toThrow('HTTP 401')
  })
})
```

Run: `pnpm --filter @solenoid/e2e test -- test/canary.test.ts`
Expected: FAIL: `../canary.ts` does not exist.

- [ ] **Step 2: The canary**

`e2e/canary.ts`:
```ts
import { fileURLToPath } from 'node:url'
import { solenoid } from '@solenoid.systems/sdk'

export async function canary(o: { key: string; api?: string; region: string; fetch?: typeof fetch }): Promise<{ seq: number; ms: number }> {
  const sol = solenoid({ key: o.key, api: o.api, fetch: o.fetch, timeoutMs: 10_000 })
  const t0 = performance.now()
  const r = await sol.spend(`canary/${o.region}`, { checks: 1 })
  if (!r) throw new Error('the spend returned null, so it went unrecorded')
  const ms = Math.round(performance.now() - t0)
  if (!(await sol.verify(r))) throw new Error(`receipt ${r.id} does not verify against the published keys`)
  return { seq: r.seq, ms }
}

export async function alert(o: { resendKey: string; to: string; region: string; error: string; fetch?: typeof fetch }): Promise<void> {
  const res = await (o.fetch ?? fetch)('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${o.resendKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: 'Solenoid canary <auth@solenoid.systems>', to: [o.to], subject: `Solenoid canary failed in ${o.region}`, text: o.error }),
  })
  if (!res.ok) throw new Error(`Resend refused the alert: HTTP ${res.status}`)
}

async function main(): Promise<void> {
  const region = process.env.CANARY_REGION ?? 'unknown'
  try {
    const key = process.env.SOLENOID_CANARY_KEY
    if (!key) throw new Error('SOLENOID_CANARY_KEY is not set')
    const r = await canary({ key, api: process.env.SOLENOID_API, region })
    console.log(`ok ${region} seq ${r.seq} ${r.ms}ms`)
  } catch (e) {
    const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    console.error(`canary failed in ${region}: ${error}`)
    const { CANARY_ALERT_RESEND_KEY: resendKey, CANARY_ALERT_TO: to } = process.env
    if (resendKey && to) await alert({ resendKey, to, region, error })
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
```
The timing is printed for the log only; no copy uses it (latency figures are not claimable).

`e2e/tsconfig.json` `include` gains `"canary.ts"`. `e2e/package.json` scripts gain `"canary": "node canary.ts"`.

`.github/workflows/canary.yml`:
```yaml
name: canary
on:
  schedule:
    - cron: '*/30 * * * *'
  workflow_dispatch: {}
permissions:
  contents: read
jobs:
  canary:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      SOLENOID_CANARY_KEY: ${{ secrets.SOLENOID_CANARY_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 12.4.2
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: pnpm install --frozen-lockfile --filter "@solenoid/e2e..."
      - run: pnpm --filter @solenoid.systems/sdk build
      - run: node e2e/canary.ts
        if: env.SOLENOID_CANARY_KEY != ''
        env:
          CANARY_REGION: github-us
```
A scheduled run that fails emails the repository owner through GitHub. The workflow reaches GitHub with the public repository in Task 19, and its secret arrives only in Task 22; until then the canary step is skipped and every run passes quietly, so nothing mails Robin during the stops between. The secret sits in the job's `env`, as GitHub's "Using secrets" example does, because a step's `if` cannot see that step's own `env`.

- [ ] **Step 3: Run the e2e suite**

Run: `pnpm --filter @solenoid/e2e test && cd e2e && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add e2e/canary.ts e2e/test/canary.test.ts e2e/tsconfig.json e2e/package.json .github/workflows/canary.yml
git commit -m "Add a production canary that spends and verifies a receipt, for two regions"
```

---

### Task 15: Launch step 1, remainder: Email Routing and the step-1 checklist (CONTROLLER-RUN)

Spec: Decisions, "Contacts"; Launch order step 1. The forwarding target is never written in the repository, the record or a commit message.

- [ ] **Step 1: Email Routing.** In the Cloudflare dashboard for the `solenoid.systems` zone, open Email → Email Routing (or use the Cloudflare API tools).
  - **Routing is already enabled on the zone** (the apex MX already points at Cloudflare, per the spec's review): add two custom addresses, `privacy@solenoid.systems` and `security@solenoid.systems`, each with the action "Send to an email" and Robin's inbox as the destination.
  - **Routing is not enabled:** enable it, accept the MX and SPF records it proposes, then add the two addresses.
  - If the destination is not yet verified, Cloudflare mails it a verification link; Robin clicks it.
- [ ] **Step 2: Test both addresses.** Robin sends one mail to each from another account and confirms both arrive. Record "privacy@ and security@ forward; tested" with the date.
- [ ] **Step 3: The step-1 checklist.** Confirm each item and record it:
  - Tasks 1 to 14 are committed on `main`, and `pnpm test` passes at the root (`unset SOLENOID_KEY SOLENOID_API; pnpm test`; it starts `wrangler dev` for `e2e/` and builds the site). After it, `chmod +x cli/dist/solenoid.mjs`.
  - `site/src/data/race.json`, `receipt.json` and `keys.json` are committed (Tasks 7 and 8).
  - The restricted key's scope is recorded (Task 0), the review's trailing-slash result is copied into the record (Task 11), the Umami host is recorded (Task 10).
  - `.superpowers/` is ignored: `git status --porcelain --ignored | grep superpowers` shows `!! .superpowers/`.
  - Every grade file named in Tasks 4, 5, 9 and 10 exists under `docs/copy/grades/`.
- [ ] **Step 4: Commit the record**
```bash
git add docs/superpowers/plans/2026-09-30-solenoid-go-live.record.md
git commit -m "Record the step-1 checks for Plan 3a"
```

---

### Task 16: Launch step 2: Stripe in test mode (CONTROLLER-RUN)

Spec: Launch order step 2; Billing. Test mode only. Decisions 16 and 17. Robin's hands are needed to complete three test Checkouts; this is not a stop.

**Files:** none committed, except the record and any runbook correction.

- [ ] **Step 1: Create the test-mode objects** with the Stripe CLI in test mode (`stripe config --list` shows a test key; if not, Robin runs `stripe login`). Store each ID as a field of the 1Password item (`STRIPE_TEST_METER`, `STRIPE_TEST_PRICE_PRO`, `STRIPE_TEST_PRICE_SPENDS`, `STRIPE_TEST_PORTAL_CONFIG`), never in the repository (Global Constraints); the record says only that each exists.
```bash
stripe post /v1/billing/meters -d display_name="Spends" -d event_name=spends -d "default_aggregation[formula]=sum" -d "customer_mapping[type]=by_id" -d "customer_mapping[event_payload_key]=stripe_customer_id" -d "value_settings[event_payload_key]=value"
stripe post /v1/products -d name="Solenoid Pro"
stripe post /v1/prices -d product=<prod_id> -d currency=usd -d unit_amount=2900 -d "recurring[interval]=month" -d "recurring[usage_type]=licensed"
stripe post /v1/prices -d product=<prod_id> -d currency=usd -d "recurring[interval]=month" -d "recurring[usage_type]=metered" -d "recurring[meter]=<mtr_id>" -d billing_scheme=tiered -d tiers_mode=graduated -d "tiers[0][up_to]=2000000" -d "tiers[0][unit_amount]=0" -d "tiers[1][up_to]=inf" -d "tiers[1][unit_amount_decimal]=0.001"
stripe post /v1/billing_portal/configurations -d "business_profile[headline]=Solenoid Pro" -d "features[subscription_cancel][enabled]=true" -d "features[subscription_cancel][mode]=at_period_end" -d "features[payment_method_update][enabled]=true" -d "features[invoice_history][enabled]=true"
```
  If Stripe refuses the `0` `unit_amount` on the first tier, use `-d "tiers[0][unit_amount_decimal]=0"` instead and record which one worked.

- [ ] **Step 2: A local Worker with the test values.** In `worker/`, write `.dev.vars` (git-ignored) without printing secrets: a fresh `MASTER` and `SIGNING_KEY` from `node scripts/gen-secrets.mjs`, `SIGNING_KID=local`, `STRIPE_SECRET_KEY` from `op read 'op://Personal/Solenoid Worker secrets/STRIPE_TEST_SECRET_KEY'`, the two price IDs, the portal configuration ID, and `STRIPE_WEBHOOK_SECRET` from `stripe listen --print-secret`. If a `.dev.vars` already exists, move it to `.dev.vars.plan3a` first and restore it in Step 9. Then, in two background shells:
```bash
cd worker && pnpm exec wrangler dev --port 8787 --ip 127.0.0.1
stripe listen --events checkout.session.completed,customer.subscription.deleted --forward-to http://127.0.0.1:8787/billing/stripe
```

- [ ] **Step 3: First subscription.** In a throwaway directory, fix the start of the summary window once, then ask for Checkout twice before paying:
```bash
export SOLENOID_API=http://127.0.0.1:8787 SOLENOID_CONFIG_DIR=$(mktemp -d)
S=$(( $(date +%s) / 60 * 60 - 60 ))
node ~/dev/solenoid/cli/dist/solenoid.mjs init stripe-e2e > /dev/null
node ~/dev/solenoid/cli/dist/solenoid.mjs upgrade
node ~/dev/solenoid/cli/dist/solenoid.mjs upgrade
```
  Both `upgrade` runs print the same Checkout URL: the open session is handed back (Decision 17). Robin then completes that Checkout with card `4242 4242 4242 4242`, any future expiry and any CVC, and a real address of his for the email. Then check:
  - `stripe listen` shows `checkout.session.completed` answered `200`.
  - `wrangler dev`'s log shows the attach-code send was attempted for that email. It fails locally, because the local `.dev.vars` holds no `RESEND_API_KEY`, and the webhook still answered `200`.
  - `node …/solenoid.mjs upgrade` now prints the billing portal URL and exits 0. Open it: it offers cancellation at the end of the period.
  - Spend three times: `node …/solenoid.mjs spend stripe-e2e emails=1`, three times.
  - Prove the tiers and the price-to-meter link with one hand-sent event of 3,000,000 spends, 1M past the $0 tier: `stripe post /v1/billing/meter_events -d event_name=spends -d "payload[stripe_customer_id]=<cus_id>" -d "payload[value]=3000000" -d identifier=tier-probe-1`. Wait a minute for aggregation, then `stripe post /v1/invoices/create_preview -d customer=<cus_id> -d subscription=<sub_id>` must show the metered line at **$10.00** (1,000,000 at $0.00001) beside the $29.00 line. $0.00 there means the event or the meter link failed; $30.00 means the first tier is not free.

- [ ] **Step 4: A duplicate subscription, while the account is Pro.** Open a second Checkout Session by hand with the Worker's own parameters. The CLI can't: the account is Pro, so `upgrade` answers with the portal.
```bash
stripe post /v1/checkout/sessions -d mode=subscription -d "line_items[0][price]=<pro price>" -d "line_items[0][quantity]=1" -d "line_items[1][price]=<spends price>" -d client_reference_id=<tenant> -d "subscription_data[metadata][tenant]=<tenant>" -d success_url=https://solenoid.systems/pricing
```
  Robin pays its `url` with the test card. Then check:
  - `stripe listen` shows the second `checkout.session.completed` answered `200`.
  - `stripe get /v1/subscriptions/<new sub>` shows `status: canceled`, and `stripe get /v1/subscriptions/<original sub>` still shows `active`. This also proves the test key's Subscriptions: Write permission covers the read and the cancel.
  - The local Durable Object's `meta` (read with `sqlite3`, as in Step 6) holds `duplicate:<new sub>` = `cancelled`, and `stripe_subscription` is still the original.
  - The notice was sent: `wrangler dev`'s log shows the logged line naming the tenant, the new subscription and the session, and then the notice's send to `security@solenoid.systems` failing because the local Worker has no `RESEND_API_KEY`. The webhook still answered `200`. (With a Resend key configured, the Resend dashboard's log shows the mail instead.)
  - In test mode nothing needs refunding. In live mode, this notice is Robin's cue to refund the payment by hand.

- [ ] **Step 5: First cancellation and its final report.** `stripe delete /v1/subscriptions/<original sub>`. Check that `stripe listen` shows `customer.subscription.deleted` answered `200`, and that `stripe get /v1/billing/meters/<mtr_id>/event_summaries -d customer=<cus_id> -d start_time=$S -d end_time=$E` sums to 3,000,003: the hand-sent event plus the final report of 3. The summary API takes only whole minutes: `S` was fixed in Step 3, and `E=$(( $(date +%s) / 60 * 60 + 60 ))` is taken now, a minute after the webhook. In `stripe listen`'s output, the forwarded `customer.subscription.deleted` carries `ended_at`; the meter event list shows the final event stamped one second before it (Decision 18). The duplicate's own `customer.subscription.deleted`, forwarded in Step 4, changed nothing: it names another subscription.

- [ ] **Step 6: Second subscription and report.** Run `upgrade` again (Robin pays again with the test card), spend twice, cancel as in Step 5. With the same `S` and a fresh `E`, the summaries now sum to 3,000,005: the hand-sent event and two reports. Read the local Durable Object's `meta` rows with `sqlite3` on the file under `worker/.wrangler/state/v3/do/` to confirm `meter_seq` moved twice and `plan` is `free`: two reports, two different `seq` ranges.

- [ ] **Step 7: Record** every result and anything that differed from this plan. Stripe IDs stay in 1Password.

- [ ] **Step 8: Correct the runbook** if any command or value differed, and commit it with the record:
```bash
git add docs/runbook.md docs/superpowers/plans/2026-09-30-solenoid-go-live.record.md
git commit -m "Record Stripe test mode end to end"
```

- [ ] **Step 9: Clean up.** Stop `wrangler dev` and `stripe listen`, delete `worker/.dev.vars` (restore `.dev.vars.plan3a` if Step 2 moved one), `rm -rf "$SOLENOID_CONFIG_DIR"`, `unset SOLENOID_API SOLENOID_CONFIG_DIR S E`.

---

### Task 17: Launch step 3: deploy the API Worker (CONTROLLER-RUN)

Spec: Launch order step 3. The Worker goes out with the billing routes, the salted hash and the alarm, and with no Stripe value, so both billing routes answer 503.

- [ ] **Step 1: Deploy** from a clean `main`, with `SOLENOID_*` unset:
```bash
git status --porcelain
cd worker && pnpm exec wrangler deploy
```
  Expect `api.solenoid.systems (custom domain)` and a new version ID. Record it, and the previous version ID as the rollback target. `wrangler secret list` shows no `STRIPE_*` name.
- [ ] **Step 2: Smoke, reads and 503s only**
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.solenoid.systems/.well-known/solenoid.json
curl -s -X POST https://api.solenoid.systems/billing/stripe -d '{}'
curl -s -X POST https://api.solenoid.systems/billing/checkout -H "authorization: Bearer $(op read 'op://Personal/Solenoid Worker secrets/DEMO_ADMIN_KEY')"
```
  Expect `200`, then `{"error":"billing_unavailable"}` twice.
- [ ] **Step 3: Fix the date in the privacy row.** If the deploy date is not 30 September 2026, change the salted-hash row's date in `site/src/pages/privacy.astro` to the deploy date (a truth fix inside a graded unit: a controller line-check against the record, as in Plan 1's record), and commit it with the record:
```bash
git add site/src/pages/privacy.astro docs/superpowers/plans/2026-09-30-solenoid-go-live.record.md
git commit -m "Record the API deploy with billing routes, the salted hash and the alarm"
```

---

### Task 18: Launch step 4: prepare the public tree (CONTROLLER-RUN), then STOP FOR ROBIN

Spec: Launch order step 4; Licensing, "The lawyer glance". Every file in the tree is scrubbed, `docs/superpowers/**` included, because the plans, records and reviews go public as part of the trust story.

- [ ] **Step 1: Find the personal data.** Write the five patterns listed in the spec's step 4 (the mail user name, which also names the `workers.dev` subdomain; the mail provider's domain; Robin's tenant ID; the macOS home-directory prefix; the vault path) one per line into `.scrub-patterns` at the repository root. It is git-ignored (Task 12), so the patterns never enter the repository, and from now on lefthook refuses any commit that brings one back (Decision 21). Check it stays out: `git check-ignore .scrub-patterns` prints the name. Append the test-mode Stripe IDs from Task 16 too, each 1Password field whose name starts `STRIPE_TEST_` except the key itself, so none can reach the public snapshot. Then:
```bash
node scripts/scrub-check.mjs --from .scrub-patterns
```
- [ ] **Step 2: Replace each hit** with a placeholder that keeps the sentence true: the tenant ID becomes `<tenant>`, the address becomes `<you>@example.com`, the subdomain becomes `<account>.workers.dev`, a home-directory path becomes `~/…` or a repository-relative path, and the vault path becomes `<vault>`. The check reads the index, so stage the replacements (`git add -u`) and re-run it until it prints `no tracked file contains any of the <n> patterns`.
- [ ] **Step 3: Scan for secrets and read by hand.** Install gitleaks if it is missing (`brew install gitleaks`). Run `gitleaks dir . --redact` on gitleaks 8.19 or later, or `gitleaks detect --no-git --source . --redact` on older versions. Resolve every finding. Then read `docs/` by hand for other personal data: employers, private addresses, other people's names or emails, private IP addresses, and account or tenant IDs other than the public demo account's. The site's own name and the licensor name stay.
- [ ] **Step 4: The lawyer glance.** Robin takes to his lawyer: the FSL-1.1-ALv2 notice with the licensor "Robin Lange, trading as omit", `LICENSING.md`, the split (server and `@solenoid.systems/testing` FSL, clients MIT, `docs/superpowers/` FSL, fonts OFL), and the MIT texts. Record the outcome; apply any change the lawyer asks for, and re-run the tests it touches.
- [ ] **Step 5: Run everything and commit the scrub to the private repository**
```bash
unset SOLENOID_KEY SOLENOID_API && pnpm test && chmod +x cli/dist/solenoid.mjs
git add -u
git commit -m "Scrub personal data from the tree before it goes public"
git push origin main
```
  The commit runs the scrub hook, so it only lands once the tree is clean.
- [ ] **STOP FOR ROBIN.** Report the scrub's hits and replacements, the gitleaks result, the lawyer's outcome, and wait for Robin's go-ahead to open the repository.

---

### Task 19: Launch step 5: open the repository (CONTROLLER-RUN), then STOP FOR ROBIN

Spec: Launch order step 5. The public repository starts from one squashed snapshot of the index. No untracked file can enter it, and no push can send the old history to it.

- [ ] **Step 1: Preconditions.** `git status --porcelain` prints nothing; `git log -1 --format='%an <%ae>'` shows the GitHub no-reply address; `git ls-files | grep -c superpowers/` counts only `docs/superpowers/` files; `git ls-files .scrub-patterns` prints nothing.
- [ ] **Step 2: Freeze the private repository**
```bash
gh repo rename solenoid-history -R robinslange/solenoid --yes
gh repo archive robinslange/solenoid-history --yes
```
- [ ] **Step 3: The snapshot commit and the tag**
```bash
git checkout --orphan public
git commit -m "Solenoid"
git tag launch
git ls-tree -r --name-only launch | wc -l
git ls-files | wc -l
```
  The two counts match: the index held exactly the tracked files, and nothing was added.
- [ ] **Step 4: Point the remotes**
```bash
git remote rename origin history
git remote set-url history git@github.com:robinslange/solenoid-history.git
git remote set-url --push history DISABLED
git ls-remote history refs/heads/main
git rev-parse history/main
git branch -D main
git branch -m public main
gh repo create robinslange/solenoid --public --description "Limits on the actions your AI agents take, checked before each action, with a signed receipt for every one."
git remote add origin git@github.com:robinslange/solenoid.git
git push -u origin main
git push origin launch
```
  `gh repo rename` moves the repository on GitHub but not the local remote's URL, and the new public repository takes the old name, so the `history` remote is pointed at the archive by name before anything else (review M6). The two hashes after `ls-remote` match: `history` fetches the archive. Check at the end: `git remote get-url history` is the archive, `git remote get-url --push history` is `DISABLED`, `git log --oneline origin/main` shows one commit, `git ls-remote --tags origin launch` matches `git rev-parse launch`, and `git push history main` fails.
- [ ] **Step 5: Record** the snapshot commit, the tag, and both repository URLs. From here every commit goes to the public repository; the archive receives nothing more.
- [ ] **STOP FOR ROBIN.** Report the public URL and wait for his go-ahead to publish to npm.

---

### Task 20: Launch step 6: publish to npm (CONTROLLER-RUN), then STOP FOR ROBIN

Spec: Launch order step 6. `@solenoid.systems/sdk`, `@solenoid.systems/cli`, `@solenoid.systems/mcp` and `@solenoid.systems/testing`, from the tagged commit. They carry the Pro wording (spec, Billing, "Docs").

- [ ] **Step 1: The scope.** `npm whoami`, then `npm org ls solenoid.systems`.
  - **It lists Robin's account:** continue.
  - **It fails or does not list him:** publish nothing. Robin creates or joins the `solenoid.systems` npm organisation; resume from this step after he says so.
- [ ] **Step 2: Build from the tag**
```bash
git checkout launch
pnpm install --frozen-lockfile
pnpm -r build && chmod +x cli/dist/solenoid.mjs
```
- [ ] **Step 3: Look inside each tarball before it goes**
```bash
for p in sdk testing cli mcp; do (cd $p && npm pack --dry-run 2>&1 | tail -n 25); done
```
  `sdk` holds no `testing.mjs`; `testing` holds `dist/testing.mjs`, its types and `LICENSE` (FSL); each of `sdk`, `cli` and `mcp` holds its MIT `LICENSE`; none holds a test file or `.dev.vars`.
- [ ] **Step 4: Publish**, `sdk` first, since nothing else depends on the others at install time:
```bash
for p in sdk testing cli mcp; do pnpm --filter "@solenoid.systems/$p" publish --access public --no-git-checks; done
```
  Robin supplies the one-time password when npm asks.
- [ ] **Step 5: Check from outside the workspace**
```bash
T=$(mktemp -d) && cd "$T"
npm view @solenoid.systems/sdk version; npm view @solenoid.systems/cli version; npm view @solenoid.systems/mcp version; npm view @solenoid.systems/testing license
npx -y @solenoid.systems/cli@0.1.0 help | grep -c '^  upgrade'
cd - && rm -rf "$T" && git checkout main
```
  Expect `0.1.0`, `0.1.0`, `2.0.0`, `FSL-1.1-ALv2`, and `1`: the published help lists `upgrade`.
- [ ] **Step 6: Record** the versions.
- [ ] **STOP FOR ROBIN.** Report the four packages and wait. The next step is live mode, which needs his yes.

---

### Task 21: Launch step 7: Stripe in live mode, on Robin's yes (CONTROLLER-RUN), then STOP FOR ROBIN

Spec: Launch order step 7. Nothing in this task starts before Robin says yes to live mode.

**Order B:** run Tasks 23 and 24 before this task (the site goes live with the "Pro opens soon" build from Task 10, Step 6: `PUBLIC_PRO_OPEN=false`). After Step 6 of this task, rebuild the site with the upgrade call to action (`cd site && pnpm build`, no flag), check it as in Task 24, Step 3, and deploy it again with `pnpm exec wrangler deploy` from `site/`.

- [ ] **Step 1: Robin's yes.** Ask: "Stripe live mode: create the live product, prices, meter, portal configuration and webhook, and set the five secrets on the production API?" Wait for yes.
- [ ] **Step 2: The live key.** Robin creates the live restricted key with the same scope as Task 0 found and stores it as `STRIPE_SECRET_KEY` in the 1Password item (`read -rs K && op item edit 'Solenoid Worker secrets' "STRIPE_SECRET_KEY[concealed]=$K"; unset K`). For creating objects he supplies, for this task only, a live secret key as `STRIPE_LIVE_SETUP_KEY` in the same item; Step 7 removes it.
- [ ] **Step 3: The live objects.** Run Task 16, Step 1's five commands with `--live --api-key "$(op read 'op://Personal/Solenoid Worker secrets/STRIPE_LIVE_SETUP_KEY')"`, then the webhook endpoint:
```bash
stripe post /v1/webhook_endpoints --live --api-key "$(op read 'op://Personal/Solenoid Worker secrets/STRIPE_LIVE_SETUP_KEY')" -d url=https://api.solenoid.systems/billing/stripe -d "enabled_events[]=checkout.session.completed" -d "enabled_events[]=customer.subscription.deleted"
```
  Store its `secret` as `STRIPE_WEBHOOK_SECRET`, and the two price IDs and the portal configuration ID as `STRIPE_PRICE_PRO`, `STRIPE_PRICE_SPENDS` and `STRIPE_PORTAL_CONFIG`, in the 1Password item, without printing the secret (pipe the command's JSON through `node -e` into `op item edit`). Append the product, meter, price, portal configuration and webhook endpoint IDs, one per line, to the local `.scrub-patterns`, so no later commit can carry one (Decision 21).
  Then list the live webhook endpoints: `stripe get /v1/webhook_endpoints --live --api-key …`. The Stripe account is omit's and serves other products, so disable only the old Solenoid endpoint, matched by its exact URL: `https://api.solenoid.systems/hooks/stripe` (the old gateway forwarded `/hooks/*` to the old billing Worker, `~/dev/solenoid.systems/api/gateway/src/index.ts:330` and `api/billing/src/index.ts:74`), or the same path through the old site's proxy, `https://solenoid.systems/api/hooks/stripe`. Disable a match with `stripe post /v1/webhook_endpoints/<id> --live --api-key … -d disabled=true`. Touch no other endpoint. If neither URL is listed, disable nothing and record that. Record which URL was disabled.
  Finally, in the dashboard's Billing → Revenue recovery settings, confirm that "if all retries for a payment fail" is set to cancel the subscription. Otherwise an unpaid subscription never sends `customer.subscription.deleted`, and the account stays Pro. Record the setting.
- [ ] **Step 4: Terms.** If Stripe's activation asked for terms, refund or cancellation text, write it as a site page (for example `site/src/pages/terms.astro`), linked from the footer and `/pricing`, run it through the copy gate (medium: terms page; grade file `docs/copy/grades/site-terms.md`), and commit it before this task completes. If Stripe asked for none, record that.
- [ ] **Step 5: Set the secrets** on the API Worker with the loop in `docs/runbook.md`, Billing. Check: `curl -s -X POST https://api.solenoid.systems/billing/checkout -H "authorization: Bearer $(op read 'op://Personal/Solenoid Worker secrets/DEMO_ADMIN_KEY')"` returns `{"url":"https://checkout.stripe.com/…"}` (open nothing; the session expires unused).
- [ ] **Step 6: One live upgrade and cancellation.** Robin runs `npx @solenoid.systems/cli upgrade` on a real account of his, pays $29 USD, then runs `upgrade` again and cancels in the billing portal. Check that the webhook delivery shows `200` in the Stripe dashboard, that `solenoid upgrade` on his account now prints the portal link (so `meta.plan` is `pro`), that the attach-code email reached the address he paid with, and that the subscription shows "cancels at period end". If Robin wants the charge back, he refunds it in the dashboard and the controller ends the subscription now (`stripe delete /v1/subscriptions/<sub_id> --live --api-key …`); then check the deleted event answered `200` and his account is free again.
- [ ] **Step 7: Clean up and record.** Delete `STRIPE_LIVE_SETUP_KEY` from the item (`op item edit 'Solenoid Worker secrets' 'STRIPE_LIVE_SETUP_KEY[delete]'`) and ask Robin to roll that key in the dashboard. Robin's live customer and subscription IDs go into `.scrub-patterns` too. The record says that each live object exists and where its ID is kept; no ID is written in it.
```bash
git add docs/superpowers/plans/2026-09-30-solenoid-go-live.record.md site docs/copy/grades
git commit -m "Record Stripe live mode"
git push origin main
```
- [ ] **STOP FOR ROBIN.** Report the live upgrade's result and wait for his go-ahead.

---

### Task 22: Launch step 8: the canary from two regions (CONTROLLER-RUN)

Spec: Launch order step 8. Decision 14.

- [ ] **Step 1: The canary account.** As in Task 8, Step 5, with a throwaway `SOLENOID_CONFIG_DIR` and directory: `init canary > /dev/null`, store the admin key as `CANARY_ADMIN_KEY` in the 1Password item, and derive the spend key with `node cli/dist/solenoid.mjs key canary`.
- [ ] **Step 2: Region 1, GitHub's US runners.** Pipe the spend key into `gh secret set SOLENOID_CANARY_KEY -R robinslange/solenoid`, then `gh workflow run canary.yml -R robinslange/solenoid` and `gh run watch -R robinslange/solenoid`. Expect a green run whose log ends `ok github-us seq <n> <ms>ms`.
- [ ] **Step 3: Region 2, a second host in Auckland.** Over SSH (the command is in Robin's global instructions), clone the public repository, and run the canary in a `node:24` container, since that host's own Node may be older:
```bash
git clone https://github.com/robinslange/solenoid ~/solenoid-canary
docker run --rm -v ~/solenoid-canary:/app -w /app node:24 sh -c 'corepack enable && corepack prepare pnpm@12.4.2 --activate && pnpm install --frozen-lockfile --filter "@solenoid/e2e..." && pnpm --filter @solenoid.systems/sdk build'
```
  Write `~/solenoid-canary.env` (mode 600) with `SOLENOID_CANARY_KEY`, `CANARY_REGION=omit-nz`, `CANARY_ALERT_RESEND_KEY` (a Resend key restricted to sending, which Robin creates) and `CANARY_ALERT_TO` (Robin's inbox; never in the repository). Add a crontab line:
```
*/30 * * * * docker run --rm --env-file ~/solenoid-canary.env -v ~/solenoid-canary:/app -w /app node:24 node e2e/canary.ts >> ~/solenoid-canary.log 2>&1
```
- [ ] **Step 4: Prove the alert path.** Run the container once by hand with `SOLENOID_CANARY_KEY` set to a broken key; Robin confirms the "Solenoid canary failed in omit-nz" email arrives. Then run it with the real key and see `ok omit-nz …`.
- [ ] **Step 5: Record** both regions' first green runs and the alert test, and commit the record.

---

### Task 23: Launch step 9: close the old deploy path (CONTROLLER-RUN), then STOP FOR ROBIN

Spec: Launch order step 9. The old repository's CI deploys both the old site and the old API.

- [ ] **Step 1**
```bash
gh workflow disable ci-cd.yml -R robinslange/solenoid-systems
gh workflow list -R robinslange/solenoid-systems
gh secret delete CLOUDFLARE_API_TOKEN -R robinslange/solenoid-systems
gh secret list -R robinslange/solenoid-systems
```
  Expect the workflow `disabled_manually` and no `CLOUDFLARE_API_TOKEN`.
- [ ] **Step 2: Revoke the token.** In the Cloudflare dashboard (My Profile → API Tokens), Robin identifies the token that repository used and the controller or Robin revokes it. Record which token, by name, was revoked.
- [ ] **STOP FOR ROBIN.** Report and wait for his go-ahead to cut the site over.

---

### Task 24: Launch step 10: site cutover (CONTROLLER-RUN)

Spec: Launch order step 10; Rollback.

- [ ] **Step 1: Build from `main` with the link check in launch mode**
```bash
git checkout main && git pull
cd site && pnpm exec astro build && node scripts/check-dist.mjs --launch
```
  Expect `launch checks over site/dist: 0 problems`: the pushed `launch` tag matches the local one, and every linked file is in `git ls-tree -r launch`. Under Order B before live mode, build with `PUBLIC_PRO_OPEN=false`.
- [ ] **Step 2: Deploy**
```bash
pnpm exec wrangler deploy
pnpm exec wrangler deployments list --name solenoid-systems | head -20
```
  The newest deployment is this one. The rollback target is `ff4e4458-27f2-4b25-b342-ced607dfc078`, valid only until Plan 3b deletes `solenoid-api-gateway`.
- [ ] **Step 3: Check production**
```bash
for h in solenoid.systems www.solenoid.systems; do curl -s "https://$h/" | grep -c 'id="start-hero"'; done
node scripts/check-routes.mjs https://solenoid.systems
curl -s https://solenoid.systems/llms.txt | cmp - ../sdk/llms.txt && echo llms ok
(cat ../sdk/llms.txt; printf '\n'; cat ../sdk/README.md) | cmp - <(curl -s https://solenoid.systems/llms-full.txt) && echo llms-full ok
curl -s -o /dev/null -w '%{http_code}\n' https://solenoid.systems/pricing
```
  Expect `1` for both hosts, `0 problems`, `llms ok`, `llms-full ok`, and `200`.
- [ ] **Step 4: If anything fails,** roll back with `pnpm exec wrangler rollback ff4e4458-27f2-4b25-b342-ced607dfc078 --name solenoid-systems`, confirm both custom domains still serve (routes are not part of a version, which is why `site/wrangler.jsonc` declares both), and report.
- [ ] **Step 5: Record** the deployment, the checks and the rollback target, commit the record, and push.

---

## Self-review

**1. Spec coverage** (site spec, section by section):
- Success criteria: 1, the proof links (Task 9) and license files (Task 12); 2, every unit's gate (Tasks 4, 5, 9, 10, 21); 3, the fixture and route test (Task 11); 4, the single-source check (Tasks 6, 13, 24).
- Decisions: the public squashed snapshot (Task 19) and scrub (Task 18); the license split (Tasks 1, 12); the race recorder (Task 7); the founder note (Task 10); the two-step call to action (Task 9); failure moment first (Task 9); the copy chief runs the copy (every copy step); Umami, disclosed (Tasks 6, 10); the licensor (Task 12); no GST (Global Constraints, Tasks 9, 10); contacts (Task 15); `site/` in the monorepo and the old CI (Tasks 6, 23); DMARC is done and needs nothing.
- Licensing: the test server moves, its tests and Stryker move, consumers import by relative path (Task 1); the docs follow (Task 5); identifiers and terms (Tasks 5, 12); files (Task 12); the lawyer glance (Task 18).
- Architecture and the carried-over table: every row (Task 6; `CodeTabs`, `BottomCTA` in Task 9; `RaceTerminal` in Task 7). `prismjs`, the docs collection, Preact, MDX, RSS, the blog and `products.ts` stay behind: nothing copies them.
- Pages and the landing page's nine sections: Tasks 6, 9, 10.
- The race and the receipt: Tasks 7, 8.
- Serving and Redirects: Task 11 (`security.txt` and robots there; `SECURITY.md` in Task 12).
- Billing: Tasks 3, 4 (code), 16, 17, 21 (ops), the key's scope (Task 0), docs (Task 5).
- Privacy: the salted hash and on-time pruning (Task 2), the inventory page (Task 10), ledger retention stated as it is (Task 10).
- The copy brief update: Task 5. Copy process: Global Constraints and each copy step. Testing table: routes (11), single source (6), links (13), race (7), receipt (8), house style (13), look (13).
- Launch order: step 0 (Task 0), step 1 (Tasks 1 to 15), steps 2 to 10 (Tasks 16 to 24), Order B (Tasks 0, 10, 21, 24).
- Deferred and Out of scope items are not built. Plan 3b is not this plan.

**2. Placeholder scan.** No TBD or "similar to". The values that can only be known at run time are named with where they come from: Stripe object IDs (Task 16, Step 1 output), the Umami host (Task 10, Step 1), the deploy date (Task 17), the scrub patterns (the spec's step 4, not repeated here on purpose: Decision 15), and the versions of three new devDependencies (`pnpm add` pins them).

**3. Type consistency.** `perIp(req, master, tenantFor, unit)` (Task 2) and the test helper `setNow` (Task 2, which now also parks alarms) are the only changes to existing functions, and every caller changes in the same task. `nextDue`, `pruneIfDue`, `schedulePrune`, `alarmAt`, `armedFor` (Task 2) and `meterIsDue`, `scheduleMeter`, `billing` (returning `Billing`), `checkoutSaved`, `billingStart(customer, subscription, session)`, `duplicateSettled`, `billingEnd`, `meterDue`, `meterCommit` (Task 3) match between core, `TenantDO`, the routes and the tests. `MeterDue` is `{ customer, identifier, value, to }` in `core.ts`, `reportUsage` and the tests. `Io.stripeFetch` and `TenantDO.stripeFetch` share the name. `Stripe.checkout` returns `CheckoutSession` in `stripe.ts`, the route and the tests. `checkout()` (Task 4) matches the wire contract of Task 3. `openUrl` returns `Promise<boolean>` and `upgrade` awaits it. `atTag`, `INIT`, `UPGRADE`, `startSite`, `checkRoutes`, `checkLinks`, `checkSingleSource`, `lintHtml`, `textOf`, `elementById`, `listFiles` are each defined once and used with the same names.

**4. Review Focus.** Each line has its test in the owning task: 1 and 2 in Task 3, Step 1; 3 in Task 9, Step 1; 4 in Task 11 (`checkRoutes`' `?ref=` and `/pricing/` checks, and the fixture's trailing-slash and `index.html` paths); 5 in Task 4, Step 4.

**5. The cold review (`2026-09-30-solenoid-go-live.review.md`), and what changed.** Every finding is applied, except where noted.
- B1 to B3: the override typed `object` (Task 3); `cli/test/bundle.test.ts` in Task 4; `@types/node` in `site/` (Task 6).
- B4: `wrangler` pinned to `4.136.3` in `site/`, `compatibility_date` `2026-09-01`, and `startSite` reports wrangler's last output when it fails (Tasks 6 and 11, Decision 20). The spec's `"<the build date>"` was amended to `"2026-09-01"` in the same fix wave.
- M1: open-session reuse and the duplicate cancel (Task 3, Decision 17), with one more key permission (Task 0). Round 2 dropped the automatic refund (N2, N3, N15): the webhook cancels and mails security@, and Robin refunds by hand. Task 16, Step 4 runs the path against real test-mode Stripe (N1).
- M2: the final report's stamp (Task 3, Decision 18), and the spec's cancellation bullet amended.
- M3: the hand-sent 3,000,000 event and the $10.00 preview, minute-aligned summaries (Task 16).
- M4: `openUrl` waits for `spawn` or `error`, tested with a real opener and a real missing binary (Task 4, Decision 19).
- M5: alarms armed at the due time, parked by the test helper (Task 2, Decision 7).
- M6: the `history` remote re-pointed at the archive, fetch checked, push disabled (Task 19).
- M7: Stripe IDs only in 1Password and Worker secrets; the lefthook scrub over a git-ignored pattern file (Tasks 12, 16, 18 and 21, Decision 21).
- Minors m1 to m13, m15 to m17: applied in Tasks 3, 3, 2, 5, 14, 7, 1, 12, 20, 13, 22, 3 and 21, Global Constraints, Task 21, Task 10 and Task 19 respectively.
- m14 deferred: some commands pass a secret through process arguments (`op item edit "…[concealed]=$K"`, `--api-key "$(op read …)"`, a `curl` header). The runbook already uses the first pattern; this is a single-user Mac, the window is one command long, and removing it means replacing the 1Password and Stripe CLI steps with ones nobody has run yet. Revisit if these steps ever run on a shared host.
- Settled by the review and written as fact: Astro imports the README from outside `site/` (Task 6), `outboundService` accepts a function (Task 3), `public/.well-known` reaches `dist` (Task 11), and exact redirect rules do not match a trailing slash, so the `/*` companions are required (Task 11, Step 5).
- The `support-bot` rename, if the gate makes one, now lists all four places (Task 9, Step 6).

**6. The round-2 re-review, and what changed.**
- N1: Task 16, Step 4 pays a hand-opened second session while Pro and checks the cancel, the untouched original, the marker and the notice.
- N2, N3, N15: no refund code, no `invoice_payments`, no idempotency key; the key is four permissions (Task 0, Decision 17, the runbook).
- N4: Task 21 disables only the old endpoint, by its exact URL. N5: the canary secret is in job-level `env`.
- N6: B4's line above corrected. N7: the spec's key-scope sentence, webhook bullet and Stripe privacy row are amended, and the privacy page gains a row for the Checkout and duplicate entries.
- N8: `.superpowers/` goes into the root `.gitignore` in Task 12. N9, N10: stub openers on `PATH` for every test, a test with `BROWSER` unset, `BROWSER=true` in the mutate script, and a `try` around `spawn`. N11: the reuse test pins the clock and writes the boundary exactly.
- N12: the scrub check greps the index, and a comment-only pattern file checks nothing. N13: Task 16's two `upgrade` runs come before payment, and `S` is fixed once. N14: Task 18 adds the test-mode IDs to `.scrub-patterns`.
- M1 and m5, PARTLY in round 2, are closed by N1 to N3 and N5.

