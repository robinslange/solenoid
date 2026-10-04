# Grade: sdk/README.md

Medium: developer SDK README. Jurisdiction: global; seller in New Zealand.

## Round 1 (2026-09-24): BLOCKED at Gate 0

### Gate 0 fixes
1. Stream usage claim: narrowed to a first-party statement, "The SDK does not read usage from streamed responses."
2. Usage field names: now a table naming `usage.prompt_tokens`, `usage.completion_tokens`, `usage.input_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens` and `usage.output_tokens`, linked to OpenAI's chat completion object reference and Anthropic's Messages reference.
3. `max_tokens` / `max_completion_tokens`: linked to OpenAI's Chat Completions create reference and Anthropic's Messages reference.
4. `--env-file` and the Node floor: `--env-file` is stated as needing Node 20.6.0 or later, linked to the Node CLI docs ("Added in: v20.6.0"). The SDK's own floor, Node 20, is a first-party statement from package.json `engines`.
5. Also sourced, which the grader didn't raise: the openai-node and anthropic-sdk-typescript source files that define the two request types, the versions the samples were typechecked against (openai 7.23.0, @anthropic-ai/sdk 0.128.0), and a price table with the date taken (24 September 2026) and a link to each model's price and max output (OpenAI model pages, Anthropic pricing and models overview). Each figure was checked against those pages that day.

### Findings fixed
- 1 C2 (quickstart order): the `.env` loading step now comes before the first code sample.
- 2 C2/H3 (`emails=off`): now explained as deleting the limit, with `emails=0` shown as the stop lever.
- 3 H3 (opening not paid off): added "Stopping an agent mid-incident", with `limit support emails=0` and `rotate support --yes`, and how to mint a new key.
- 4 X2/P2 ("never overshot"): qualified where it's made. It holds while Solenoid is reachable, and the two exceptions are named: open outage mode and llm settles.
- 5 O1 (unit drift): the offer now says "spends" throughout, and states that one llm call counts as one spend because the settle is free.
- 8 C2 (raw ID in scope): the quickstart now lowercases the conversation ID and says why.
- 10 C1 (competing install path): vendoring moved below the quickstart into its own section.
- 11 V4 (repetition and restating close): "only limits tools that call it" now appears once. Known bounds now ends on the output-cap bound.
- 7 H1: a one-line promise now sits directly under the H1.
- Also, from the llms round: the fileStore last-writer-wins caveat; a line saying a human runs `init` and the agent only gets a spend key; `e.unit` guidance for the `spends` allowance; how `verifyReceipt` gets its key; status codes for each error, including `unknown_price` (status 0, client-side); and that only root-scope pages verify as a chain.

### Accepted
- O1 (paid price absent): accepted. Pricing ships with the pricing page in Plan 3, and the proof inventory blocks paid-price claims until then. Controller ruling.
- C3 (no attribution path): accepted. Attribution needs the site and a `?ref=` landing URL in Plan 3. Controller ruling.
- H1 (package-name headline): accepted as the npm README convention, now with a one-line promise directly under it. Controller ruling.
- 9 P2 (test path not linked): accepted for now. The repository has no public URL yet. The test is named by title and path, and it gets a link when the repo is published.

## Round 2 (2026-09-24): BLOCKED at Gate 0 (2 items)

### Gate 0 fixes
1. Repo test citation: dropped. The same-transaction reasoning carries the claim on its own. Re-add the link to `worker/test/tenant-spend.test.ts` ("lets exactly L of N concurrent spends through") in Plan 3, when the repo is public. Controller ruling.
2. Version claim: now links the npm version pages for openai 7.23.0 and @anthropic-ai/sdk 0.128.0. Both type links are pinned to the release tags (`openai-node` at `v7.23.0`, `anthropic-sdk-typescript` at `sdk-v0.128.0`), and both tag URLs return 200 and contain the named types. The npm www pages return 403 to curl (bot protection), and the registry entries for both versions return 200.

### Findings fixed
- 1 HIGH H3/X2 (receipt promise): the tagline is now "every spend Solenoid records comes back as a signed receipt", and the next sentence states the open-outage gap. The Receipt bullet in The model section now says the same and notes the `null` return.
- 4 LOW H1: the tagline now leads with the result ("Your agent's next action is refused before it runs once its limit is reached").
- 5 LOW C2: the init line says `support` is a scope name the reader chooses, and that the account is a tenant whose ID is part of every key. No terms of service are claimed, because none exist yet. Controller ruling.
- 6 LOW P2: resolved with Gate 0 item 1.
- Also: "free plan" removed (it implied an unnamed paid plan); the reason to set `max_completion_tokens` is given (OpenAI marks `max_tokens` deprecated and not compatible with reasoning models); and cache reads are explained as costing a fraction of the base rate.

### Accepted (carried from round 1)
- 2 MED O1 (paid price and upgrade path): accepted until the Plan 3 pricing page. Controller ruling.
- 3 MED C3 (attribution): accepted until the Plan 3 site. Controller ruling.

## Round 3 (2026-09-24): PASS-WITH-FINDINGS (Gate 0 passes)

### Findings fixed
- 1 HIGH H3/V4 ("the one gap"): the tagline now lists both gaps and links Known bounds. The gaps are an `open` limit during an outage, and model calls that can end above a `tokens`/`usd` limit because of the low input estimate and undercounted Anthropic cache writes.
- 2 HIGH X2 (absolutes): the tagline is scoped to "tools that call `spend` before they act" and uses the would-go-over wording. The offer paragraph no longer says "caps it".
- 3 HIGH O1/H3 (free term): the offer now says 100,000 spends each UTC calendar month is a hard cap today, and that only recorded spends count, so refused spends, replays and unreachable attempts don't. Checked against `worker/src/tenant.ts`: `#rollMonth` keys on the ISO `YYYY-MM` of the UTC time, and `#checkPlan` counts sealed entries minus settle, limit and rotate entries. A 402, a replay or an unreachable attempt never seals an entry.
- 4 MED H3/C2: the offer names the `limit` step (`init` gives the key, `limit` sets the cap, then one `spend` per action).
- 6 MED H2/M1/V1: the "refused before it runs once" misparse is gone, and the would-go-over rule is used throughout. The tagline stays above the problem paragraph, because the H1 ruling requires a promise line directly under the H1.
- 7 MED C2 (scope IDs): the quickstart maps IDs with `scopeId` (lowercase, and anything outside `[a-z0-9._-]` becomes `-`). It warns that a raw `/` nests, that colliding IDs share one budget, and that IDs over 64 characters or made only of dots still throw.
- 8 LOW C2: split the overpacked init paragraph into admin key, spend key, and lost credentials. A lost credentials file means running init again, which creates a new account, and email recovery comes later with no date promised. Added the same-OS-user warning with its remedy, and said what `send`, `Email` and `log` stand for.
- Also: SolenoidUnavailable is documented as extending `Error` directly. verifyChain paging is explained (`next` as `before`, concatenate, reverse). The cache-read multiplier is given as 0.1 times, from Anthropic's caching page.

### Accepted (by ruling)
- 5 MED H1: package-name headline with a promise line directly under it.
- 9 LOW C3: attribution waits for the Plan 3 site.
- 10 LOW O3: noted only; accepted by ruling.
- O1, paid price: waits for the Plan 3 pricing page.

## Round 4 (2026-09-24): final Gate 0 check. V4 clean; Gate 0 had one item in this file, now fixed

- Gate 0: the claim that "mode 0600 doesn't stop a process running as the same OS user" had no source. It is narrowed to a first-party instruction with no claim about the mechanism: "Run the agent as a different OS user from the one that holds the credentials file, or keep the admin key off the agent's machine."

## Litmus fixes (2026-09-24): documentation bugs from the Task 15 run, pending a cold Gate 0 check

- The gate example now treats SolenoidUnavailable as a refusal. A closed limit that couldn't be checked means the action must not run. Genuinely unexpected errors are still rethrown, and a sentence next to the example says so.
- New integration rule: a spend is capped only by limits at its scope or an ancestor, and a spend under no limit is recorded but never refused. So integrate at a scope under the developer's limit. To find it: `cli ls <scope>`, `get(scope)` with the spend key, or ask the developer.
- New line: a tool may pass its own data directory to `fileStore(dir)`.

## Litmus clarity fixes, round 2 (2026-09-24)

The cold check on the first litmus delta passed Gate 0 with no V4 tells. Then six clarity fixes, each checked against the code:
- `get(scope).limits` includes ancestors' limits (Worker `#view` uses `#applicable`, which walks `ancestors(scope)`). An entry with `used: null` is the scope's own per-child limit for its children, so the check is "no entry with a number in `used`", which replaces "empty list".
- No limit caps the scope: don't ship; ask the developer, with the exact `limit` command.
- `ls` is run by the developer with the admin key from the credentials file (verified in `cli/src/commands.ts`), on the exact spend scope. Its output strings are quoted exactly.
- The gate refuses only on `LimitExceeded` for its own unit and on `SolenoidUnavailable`, and rethrows the rest. The README and llms examples now match.
- `SolenoidUnavailable` is defined once per doc: unreachable, and the cached outage mode was closed, with closed as the default when nothing is cached. So `open` behaves as closed until one spend caches it.
- fileStore has its subject and import path, plus `<dir>/outage.json` (verified in `sdk/src/node.ts`), and in-memory versus shared across processes.

## Plan 3a round 1 (2026-09-30): PASS-WITH-FINDINGS

Three cold `copy-grader` runs, dispatched as plain subagents in one message, each with the draft pasted inline and only the medium, the jurisdiction (New Zealand) and "non-closing" given, then `tally.py run1.md run2.md run3.md`. The same round graded all four Plan 3a doc units, and one `copy-source-checker` run covered the cited sources (Node SQLite docs: SUPPORTS; FSL-1.1-ALv2 text: SUPPORTS).

Draft graded: The changed passages of this task: Pro and `upgrade`, the free-plan cap, the billing error codes, the recovery `Outage` rule, the `@solenoid.systems/testing` package, and the example scope renamed to `support-bot` to match the hero command.

Tally: Gate 0 CLEAR (0/3). Findings: C2, H3, H1.

### Controller's rulings

- **H3 ("signed proof" not paid off): dismissed as an excerpt artifact.** The Receipt bullet under "The model" and the Receipts section pay it off. The graders saw only the changed passages.
- **H1 (the package-name heading): accepted.** A package README opens with the package name by npm convention, and the paragraph under it carries the promise.

### Findings fixed

Each new sentence was checked against the code before it was written: `cli/src/commands.ts` (`upgrade`, `init`, `limit`, `HELP`), `cli/src/browser.ts`, `worker/src/billing-routes.ts`, `worker/src/core.ts` (the free-plan cap, `recoverFinish`), `sdk/src/http.ts` and `sdk/src/index.ts` (retry rules, `checkout`), `worker/src/router.ts` (`/.well-known/solenoid.json`), and the Node 22.12 CLI docs (`--experimental-sqlite` is allowed in `NODE_OPTIONS`).

- **Fix 1 (C2, upgrade)**, Intro paragraph.
  - Before: Past that, the free plan refuses every spend until the month turns, and Pro, $29 USD a month with 2M spends and then $10 USD per extra million, keeps them going: run `npx @solenoid.systems/cli upgrade`.
  - After: Past that, the free plan refuses every spend until the month turns. Pro is $29 USD a month with 2M spends included, then $10 USD per extra million. To buy it, run `npx @solenoid.systems/cli upgrade` (`solenoid upgrade` if the CLI is installed) on the machine that holds the admin key. It opens Stripe Checkout in your browser and prints the link, in case no browser opens. Once the payment goes through, the account moves to Pro, and the 100,000 cap no longer applies.
- **Fix 1 (C2, checkout out of the Errors cell)**, Errors table, `SolenoidError` row.
  - Before: Status 409: `idempotency_conflict`, and `already_pro` from `checkout()`. Status 400: `invalid_limit`, `invalid_unit`, `invalid_amount`. Status 0: `unknown_price`, thrown by the SDK before any request. Status 503: `billing_unavailable`, from `checkout()`. `solenoid upgrade` calls `checkout()`. `checkout()`, on an admin-key client, returns `{ url }`, the Stripe Checkout page for Pro; on Pro it throws `already_pro`, whose `detail.portal_url` is the billing portal.
  - After: Status 409: `idempotency_conflict`, `already_pro`. Status 400: `invalid_limit`, `invalid_unit`, `invalid_amount`. Status 503: `billing_unavailable`. Status 0: `unknown_price`, thrown by the SDK before any request. The two billing codes are described under [Pro](#pro).
- **Fix 1 (C2, new section after Setting limits)**, ## Pro (new).
  - Before: (none)
  - After: `admin.checkout()`, on an admin-key client, returns `{ url }`, the Stripe Checkout page for Pro. `solenoid upgrade` calls it and opens that page. On an account already on Pro it throws `SolenoidError` with status 409 and code `already_pro`, and `e.detail.portal_url` is the Stripe billing portal, where the plan is managed or cancelled. While billing is not open yet, it throws `SolenoidError` with status 503 and code `billing_unavailable`. The SDK does not retry `checkout()`: a network failure, or any other 5xx, throws `Outage`.
- **Fix 2 (C2, .env)**, Quickstart, Spend key bullet.
  - Before: `init` appends `SOLENOID_KEY=<spend key>` to `./.env`, unless `.env` already has a `SOLENOID_KEY`.
  - After: `init` appends `SOLENOID_KEY=<spend key>` to `./.env`. If `.env` already has a `SOLENOID_KEY`, `init` leaves the file as it is and prints the new spend key, so you can put it where you want.
- **Fix 3 (C2, retry scope)**, Recovery, errors paragraph.
  - Before: A network failure, or a 5xx other than `email_failed` and `billing_unavailable`, throws `Outage`, and neither is retried.
  - After: The SDK never retries a recovery or email call: a network failure, or any other 5xx, throws `Outage`.
