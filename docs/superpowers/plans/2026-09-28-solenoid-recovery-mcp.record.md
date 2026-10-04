# Plan 2 execution record: rulings, deploy and deferred items

Plan 2 (`2026-09-28-solenoid-recovery-mcp.md`) was executed subagent-driven from 2026-09-28 to 2026-09-29 and is complete: Tasks 1–7, the final whole-branch review, its fix wave and one residual copy fix (code-complete at 0419d5b), then the Task 7 production deploy. The working ledger has been deleted, so this file keeps the decisions made on Robin's behalf, the deploy facts and the minor findings deferred along the way, copied verbatim from that ledger. Some deferred minors were fixed in the final fix wave (9c733af..4b668b9, 0419d5b). Check the code before acting on one.

## Rulings (2026-09-28-solenoid-recovery-mcp ledger, in order)

- Ruling: decision 9 tightens the spec's abuse limits (per-tenant attach cap, 3 live codes, per-email fail caps, HMAC-hashed codes, previous-address notice, no global recovery cap) — plan review showed the spec's per-code limits allow spam relay, lockout-by-replacement and ~20%/yr brute force — if wrong, legitimate users hit a stricter limit sooner.
- Ruling: plan's `pnpm run mutate -- --force` → `pnpm run mutate --force` (pnpm forwards the literal `--` and Stryker reads `--force` as a config file) — none.
- Ruling: keep the 0.4% bound — a failed redemption inserts one fail event per live code checked (min 1) — the plan promises the bound in docs/spec; lowering caps instead would lock owners out sooner — if wrong, owners hit the fail cap after fewer tries when several codes are live.
- Ruling: /auth/recover maps the DO's per-email 429 from recoverStart to the same 202 with no mail (spec "always 202"; a 429 would reveal that the tenant exists and the email is being targeted) — the per-IP ops limit still answers 429 — if wrong, an owner hitting the hourly cap gets no signal and must wait.
- Ruling: ops.ts branch 92.30% (<95% gate) accepted — the one miss is the unreachable non-402 failResponse moved from router.ts, a redundant guard under Robin's keep-guards ruling — if wrong, the gate reads breached for one dead branch.
- Ruling: rate_limited explanation branches on the command in the CLI (init: signups per network per day; email: codes per address per hour / attach codes per account per day; recover: recoveries per network per day) instead of adding a `limit` detail to the Worker's 429 — keeps the wire contract and Tasks 1–2 unchanged — if wrong, a future caller of the same code path gets the command's generic text.
- Ruling: fold minor id-type check (spec MUST: string or integer, never null) into the fix round; drop 2025-03-26 and 2024-11-05 from LEGACY (those revisions MUST support batches, which the server rejects; such clients are offered 2025-11-25) — if wrong, a very old client can't connect. serverInfo on every result (SHOULD) deferred.
- Ruling: fix now as round 2 (load-bearing: violates decision 7, admin rotation CLI-only) — refuse control keys and non-number/null values before any request; plus minors: --admin requires sk.admin. prefix; copy truth (control names, null copy-back, on_outage per spend); ids via Number.isSafeInteger — none.
- Ruling: one fix wave = M1 (refuse when fails + max(1, live) > cap, hour and day), M2 docs (sdk/README, llms.txt, spec), M3, M4, M5; the race stays a follow-up for Robin (behaviour + email copy change) — if wrong, the race window stays open at launch (bounded: attacker already holds the admin key).
- Ruling: fix the residual copy gap now (one string + one word; reader-facing false advice) despite the no-second-wave rule — cost is one tiny commit; if wrong, none.
- Ruling: put RESEND_API_KEY before `wrangler deploy` and skip re-putting MASTER/SIGNING_KEY (unchanged; the upgrade adds only this secret) — no window where the new code runs without a mail key — if wrong, none (secrets persist across deploys; order only changes which version carries the secret first).
- Ruling: count Step 5.4 as passed on the key, not the file — the plan's intent is "no rotation", and gen 1 + deterministic derivation proves it; the file-level checksum was the wrong instrument — if wrong, Robin's saved key differs and `solenoid ls` would have failed (it didn't). Runbook correction for next time: checksum the admin_key field (`jq -r .admin_key … | shasum`), not the file.

## Deploy (Task 7, 2026-09-29)

- `RESEND_API_KEY` copied from the 1Password note "solenoid.systems resend api key" into "Solenoid Worker secrets" (checksums match; never printed), then put as a Worker secret before the deploy.
- Ops limit: `recoveries recoveries=20 --per child-day` (closed), set with the ops admin key from a temporary `SOLENOID_CONFIG_DIR`, removed afterwards.
- Deployed version `75f3736f-d3ff-44dd-8d60-3b27a8f7d7ce` (2026-09-28T19:56:21Z) to `api.solenoid.systems` and `solenoid.<account>.workers.dev`.
- Rollback target: `0817096a-b5b4-45cf-a00e-167dd338a032` (previous code plus the Resend secret). The release before that was `58226bbe-f443-40a7-af11-4618876a9d39`. Roll back with `cd worker && pnpm exec wrangler rollback 0817096a-b5b4-45cf-a00e-167dd338a032`.
- Smoke without email: `/auth/recover` for a made-up tenant answered 202 `{"status":"accepted"}`; `/auth/email` with `{}` answered 401 `{"error":"invalid_key"}`.
- Live smoke to <you>@example.com: `solenoid email` sent a code; the first expired before use (one `invalid_code`), the second confirmed the address for `<tenant>`, and the confirmation email named `<tenant>`. `solenoid recover … --tenant <tenant>` sent a code; redeeming it without `--rotate` returned the gen-1 admin key and `solenoid ls` authenticated with it.
- Credentials check: the whole-file checksum changed because the CLI rewrites the file, while the admin key string is unchanged by construction (one valid key per tenant and generation; still gen 1). Next time, checksum the field: `jq -r .admin_key ~/.config/solenoid/credentials | shasum`.

## Deferred minor findings (in order)

- Task 1: minor (deferred): test helper code() typed Promise<unknown> for TS2589; one transient workerd ERR_RUNTIME_FAILURE in a full run.
- Task 3: minor (deferred): 5xx classification duplicated in http.ts and authPost (plan-mandated one-liner).
- Task 5: minor (deferred): serverInfo _meta only on server/discover; non-string _meta version echoed as requested; modern-era leniency (ping/initialize served, clientCapabilities unchecked); mcp README comes in Task 6.
- Task 5: fix round 2 re-review: 4/4 addressed; no rotation/control flag gets through set_limit (incl. __proto__/constructor nesting). Minor (deferred): CONTROL check is case-sensitive (ROTATE_ADMIN reaches the network; server refuses identically, not exploitable); unit-name grammar not enforced client-side (pre-existing).
- FINAL RE-REVIEW: M1–M5 ADDRESSED; M1 fuzz 300×400 steps: worst 24h window 12 (base) → 10 (head). Minor: invalid_code advice "get a new one" can cause refusal under weighting; "up to an hour" overstates (15 min expiry); SDK README "one typo is enough" → "can be".

## Follow-ups for Robin

- The reclaim-then-rotate race: an attacker holding a leaked admin key can re-set the recovery email between the owner's reclaim and rotate. Smallest fix: an admin `rotate_admin` clears `recovery_email`, and the advice flips to rotate first. Needs a decision and a copy change.
- A stray empty free tenant on production from the Task 3 mutant run (~14:12 NZT 2026-09-28).
- The production canary for the new stack (Plan 3).
- `set_limit`'s CONTROL check is case-sensitive (the server refuses identically; not exploitable).
- `mailDown` logs `Error: mail is down` to stderr in tests.
- MCP `serverInfo` `_meta` appears only on `server/discover`, not on every result.
- Plan 3: site, Stripe, cutover, npm publish of sdk/cli/mcp, old-stack teardown.

## Small follow-ups (2026-09-29)

Robin chose to do the small follow-ups straight after the deploy and to leave the larger pieces for later. Each went through an implementer, a cold review and a scoped re-review. The copy went through the cold three-run copy gate.

- F1 `93c6dce`: MCP `set_limit` refuses reserved unit names whatever their case.
- F2 `5e3d5fa`, `5a664e6`: MCP puts `serverInfo` in every modern result's `_meta`. A connection that did the legacy `initialize` handshake gets none on its requests that carry no version.
- F3 `7a82dd7`: tests that switch mail off spy on the `console.error` line and assert it.
- F4, solenoid.systems `aba7bcc` (local `main`, not pushed): the old site's live-status UI (header link, tile dots, `/status`) was removed, and `/status` now answers a 301 to `/`. Site deployed `ff4e4458-27f2-4b25-b342-ced607dfc078` (rollback `10bf9a04-8e59-490b-9655-acfdb9730bbe`).
- F5 `2956df2`..`b6a3607`: this closes the reclaim-then-rotate race. `POST /auth/email` with `rotate: true` (`solenoid email <addr> <code> --rotate`, `verifyEmail(email, code, { rotate: true })`) redeems the code, sets the recovery email and bumps the admin generation in one serialized Durable Object call. It writes a `rotate` entry with body `{ "rotate_admin": true, "attach": true }`. `rotate --admin` keeps the recovery email. The changed-mail email, the SDK README, llms.txt and the spec now give the one-step procedure. Worker deployed `766f2a7c-75a0-482b-8285-001b20d3cac6` (rollback `75f3736f-d3ff-44dd-8d60-3b27a8f7d7ce`). Live check: a bad `rotate` gets 400 `invalid_request {field: rotate}`, a request without a key gets 401, and `/auth/recover` answers 202.

Rulings from that batch, in order:

- Ruling: F4 commit stays on site main (the brief wrongly said the checked-out branch was main; it was spec/governance-pivot = main + 12 spec/plan/api commits, none touching site files), so deploying the site from main ships the same site plus this change — if wrong, a site-file difference on the spec branch would be lost from the deploy (checked: none). Not pushed.
- Ruling: F2 fix = connection state in server(): `initialize` marks the session legacy; a request without _meta.protocolVersion is legacy after initialize and modern before it (server/discover, bare ping); explicit versions decide as today — the handler is per stdio connection, so the state is exact, where the reviewer's per-method default would guess — if wrong, a client that pings before initializing gets serverInfo on that ping (harmless extra _meta).
- Ruling: dismiss P1 "placeholder address" and V4 "dashes in labels" as artifacts of the controller's draft (code interpolates the real address; labels don't ship); dismiss email `solenoid` vs README npx as the established convention of every Solenoid email (passed earlier gates) — if wrong, a reader without the global binary is stuck at step one.
- Ruling: a scoped re-review that checks K1–K6 for truth and clarity closes the copy loop instead of a third 3-run grade — Gate 0 has been clear in 6/6 runs and each round's findings were clarity refinements of the round before — if wrong, a clarity issue ships in error text a stressed reader sees rarely.

Deferred from that batch:

- F5: minor (deferred): cli onlyCopy save-failure text says "only copy" (recovery by email can restore the key); pre-existing.
- F5: minor (deferred): sdk/README.md:148 "your address can no longer recover the account" (true in the changed-email context: the reader's address was replaced).

Still open: the production canary for the new stack, the stray tenant from the Task 3 mutant run, and Plan 3 (site, Stripe, cutover, npm publish of sdk/cli/mcp, old-stack teardown).
