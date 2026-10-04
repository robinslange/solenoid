# Grade: sdk/llms.txt

Medium: llms.txt for coding agents. Jurisdiction: global; seller in New Zealand. Not the closing unit (O1, O3, O4, C3 n/a).

## Round 1 (2026-09-24): BLOCKED at Gate 0

### Gate 0 fixes
1. Node floor and `--env-file`: `--env-file` is stated as needing Node 20.6.0 or later, with a link to the Node CLI docs. The SDK floor, Node 20, is first-party (package.json `engines`).
2. The openai-node type and method: now links the openai-node source file that defines `ChatCompletionCreateParamsNonStreaming`, and names the version checked (7.23.0).
3. `max_tokens` / `max_completion_tokens`: now links OpenAI's Chat Completions create reference and Anthropic's Messages reference.
4. Usage fields: every field is spelled out, including `usage.cache_read_input_tokens` and `usage.cache_creation_input_tokens`, with links to OpenAI's chat completion object and Anthropic's Messages reference.
5. Bundled prices: now links the OpenAI model pages for gpt-4.1 and gpt-4.1-mini and Anthropic's pricing page, with the date taken (24 Sep 2026).

### Findings fixed
- 1 H3/X2 (absolutes): "used up" is replaced with "a spend that would take a unit past its limit is refused". The concurrency line is qualified to "while Solenoid is reachable", with open outage mode and llm settles named as the exceptions.
- 2 M3/V2: a human runs `init`, and the agent only ever receives the spend key. An agent that sees an admin key is told not to use or store it.
- 3 P2/H3 (silent unlimited fallback): kept, and the prose now states it as a deliberate choice, tells the reader to choose it knowingly, and shows how to fail instead. Controller ruling.
- 4 P1/C2: the example checks `e.unit === 'fetches'` and rethrows any other LimitExceeded, such as the monthly `spends` allowance.
- 5 C2: verifyChain tells the reader to reverse `get("")` entries, and says only root-scope pages are consecutive.
- 6 C2: says where `verifyReceipt`'s jwk comes from, what "chars" is measured over, and that the SDK rewrites the request's cap field.
- 7 P1: statuses are listed per code, and `unknown_price` is status 0, thrown client-side before any request.
- 8 P1: says which way each cache count errs. Writes undercount, so a usd limit can be exceeded. Reads overcount, which errs toward the limit.
- 9 P1: "used up" is corrected (see 1).
- 10 V3/V4: the llm algorithm is now a numbered list.
- 11 V1: "x" is gone. Multiplication reads "times", and placeholders are `<child>`.
- 12 C2: the CLI line says it reads the admin key from `~/.config/solenoid/credentials`.
- 13 C1: says why the example uses the vendored path (tools with no install step), and gives the npm import paths.
- 15 V4: "only limits tools that call it" now appears once.
- Also added: the fileStore last-writer-wins caveat, and billing (one llm call counts as one spend).

### Accepted
- 14 H1 (package-name H1): accepted as llms.txt convention. The one-line promise sits directly under it, in the summary. Controller ruling.

## Round 2 (2026-09-24): BLOCKED at Gate 0 (1 item)

### Gate 0 fix
1. openai version: the type link is now pinned to the `v7.23.0` tag (returns 200 and contains `ChatCompletionCreateParamsNonStreaming`), and the npm version page for openai 7.23.0 is linked.

### Findings fixed
- 1 HIGH X2/H3: the summary sentence now says "While Solenoid is reachable", and the next sentence states the open-outage case.
- 2 HIGH H3/P2: the example's outage line now states the real condition. A fetch goes ahead unrecorded only if an earlier spend on this machine cached "research" as open. With nothing cached, spend throws SolenoidUnavailable. The Outage cache section says the same.
- 3 MED C2: vendoring now says where dist/ comes from (`npm pack @solenoid.systems/sdk`, then `package/dist/`) and where it goes (`vendor/solenoid/`).
- 4 MED C2: the init scope must be at or above every scope the code spends at, and the example names "research" or a parent.
- 5 MED M3/V2: "you" is now the coding agent throughout, and the human is "the developer", in the third person.
- 6 MED V1: first mention of the settle now points to Model calls, which defines hold and settle before the step list.
- 8 LOW H3: "on the free plan" removed.
- 9 LOW P2/P3: both reasons given. OpenAI's reference marks `max_tokens` deprecated and not compatible with reasoning models. Cache reads cost a fraction of the base rate on Anthropic's caching page.
- 10 LOW C2: verifyChain says `get("")` needs the admin key, so it runs in the developer's tooling.
- 11 LOW H3: the summary now says "every spend Solenoid records returns a signed receipt", and the null case is lined up with it, both in the summary and in Errors.

### Accepted
- 7 LOW H1 (package-name H1): accepted as llms.txt convention, with the promise line under it. Controller ruling.

## Round 3 (2026-09-24): BLOCKED at Gate 0 (1 item)

### Gate 0 fix
1. npm pack: cited https://docs.npmjs.com/cli/commands/npm-pack next to the command. It returns 200 and meta-refreshes to /cli/v12/commands/npm-pack/, which also returns 200 ("Create a tarball from a package"). The `package/` prefix was confirmed by packing a real package and listing it (`package/LICENSE`, ...).

### Findings fixed
- 1 HIGH C2: the cache wording now says the default cache lasts one process, and fileStore shares it across processes on the machine.
- 2 MED H3: the free term is a hard cap per UTC calendar month today, and refused spends, replays and unreachable attempts don't count. Verified in `worker/src/tenant.ts` (`#rollMonth`, `#checkPlan`).
- 3 MED H3: the summary now names the model-call gap (low input estimate, undercounted cache writes), along with the open-outage gap.
- 4 MED C2: verifyChain paging: pass each `next` as `before`, concatenate, reverse.
- 5 MED C2: after rotate, `cli key <scope>` or `deriveKey(scope)` gives the new key.
- 6 MED V1: "open limit" is defined inline in the summary ("a limit whose outage mode is open"), and the cache clause is simplified.
- 7 LOW P1: the bundled per-token figures and max_output are listed, and the cache-read multiplier is 0.1 times, sourced from Anthropic's caching page.
- 8 LOW P2: the provider-cap advice now gives its reason and points to Known bounds.
- 10 LOW C2: vendor imports are relative to the importing file, and `.env` is written in the directory init runs in.
- 11 LOW C2: SolenoidUnavailable extends Error directly, and `instanceof SolenoidError` is false (checked in `sdk/src/errors.ts`).
- Also, matching the README: the lost-credentials path and the same-OS-user warning.

### Accepted (by ruling)
- 9 LOW H1: package-name H1 with the promise in the summary line.

## Round 4 (2026-09-24): final Gate 0 check. V4 clean; Gate 0 had two items, now fixed

- Gate 0: the same-OS-user claim is narrowed to a first-party instruction, with no claim about the mechanism: "The agent should run as a different OS user from the one that holds the credentials file, or on a machine without the admin key."
- Gate 0: "Its files unpack under package/" is gone. The npm-pack page doesn't say it. It is replaced with steps the reader can check: "List the tarball with tar tzf <file>.tgz and extract it with tar xzf <file>.tgz. Then copy the dist/ folder the listing shows into the tool as vendor/solenoid/."

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

Draft graded: The changed lines of this task: Pro and `upgrade`, billing, the free-plan cap, the recovery `Outage` rule, and the `@solenoid.systems/testing` package.

Tally: Gate 0 BLOCKED 1/3, cleared by ruling. Findings: C2, V2, V4, H3.

### Controller's rulings

- **Gate 0 ("Anthropic cache writes are undercounted", 1/3): cleared.** Known bounds sources it, with the link to Anthropic's prompt caching docs. The grader saw only an excerpt.
- **H1 (the package-name heading): accepted.** This is the llms.txt convention, and the summary line under it carries the promise.

### Findings fixed

Each new sentence was checked against the code before it was written: `cli/src/commands.ts` (`upgrade`, `init`, `limit`, `HELP`), `cli/src/browser.ts`, `worker/src/billing-routes.ts`, `worker/src/core.ts` (the free-plan cap, `recoverFinish`), `sdk/src/http.ts` and `sdk/src/index.ts` (retry rules, `checkout`), `worker/src/router.ts` (`/.well-known/solenoid.json`), and the Node 22.12 CLI docs (`--experimental-sqlite` is allowed in `NODE_OPTIONS`).

- **Fix 1 (C2, upgrade)**, Summary blockquote.
  - Before: and Pro ($29 USD a month with 2M spends, then $10 USD per extra million, bought with npx @solenoid.systems/cli upgrade, which the developer runs) keeps them going.
  - After: and Pro ($29 USD a month with 2M spends included, then $10 USD per extra million; see Billing) keeps them going.
- **Fix 1 and 4 (C2, upgrade; 2M included, no stacking)**, Model, Billing bullet, plus a new Pro bullet.
  - Before: - Billing: one spend is one of the free 100,000, or of Pro's 2M. One llm call is one spend (see Model calls).
  - After: - Billing: on the free plan, one spend is one of the 100,000 a month. On Pro, it is one of the 2M a month included in the $29, and Pro's 2M do not add to the free 100,000. One llm call is one spend (see Model calls).
    - Pro: tell the developer to run npx @solenoid.systems/cli upgrade (solenoid upgrade if the CLI is installed) on the machine that holds the admin key. It opens Stripe Checkout in the browser and prints the link, in case no browser opens. Once the payment goes through, the account moves to Pro, and the 100,000 cap no longer applies. Never run it yourself.
- **Fix 1 (C2, checkout near the other admin calls)**, Client methods, new bullet.
  - Before: (none)
  - After: - checkout(): admin key only; solenoid upgrade calls it. Returns { url }, the Stripe Checkout page for Pro. On Pro it throws SolenoidError 409 already_pro, with detail.portal_url, the Stripe billing portal. While billing is not open yet, it throws SolenoidError 503 billing_unavailable. Not retried: a network failure, or any other 5xx, throws Outage.
- **Fix 1 (codes only in Errors)**, Errors, SolenoidError bullet.
  - Before: 409 idempotency_conflict. 400 invalid_limit
  - After: 409 idempotency_conflict, already_pro. 503 billing_unavailable. 400 invalid_limit
- **Fix 2 (C2, .env)**, Setup, Account bullet.
  - Before: and appends SOLENOID_KEY=<spend key> to .env in the directory init runs in, unless that .env already has a SOLENOID_KEY.
  - After: and appends SOLENOID_KEY=<spend key> to .env in the directory init runs in. If that .env already has a SOLENOID_KEY, init leaves the file as it is and prints the new spend key for the developer to place.
- **Fix 4 (H3, same admin key)**, Setup, Account bullet.
  - Before: a verified recovery email gets the admin key back (see Recovery)
  - After: a verified recovery email gets the same admin key back (see Recovery)
- **Fix 4 (V2, address the agent)**, Setup, Account bullet.
  - Before: The agent should run as a different OS user from the one that holds the credentials file, or on a machine without the admin key, so it can never read the admin key.
  - After: Tell the developer to run you as a different OS user from the one that holds the credentials file, or on a machine without the admin key, so you can never read the admin key.
- **Fix 3 (C2, retry scope)**, Recovery, Errors bullet.
  - Before: A network failure, or a 5xx other than email_failed and billing_unavailable, throws Outage, and neither is retried.
  - After: The SDK never retries a recovery or email call: a network failure, or any other 5xx, throws Outage.
- **Fix 4 (V4, doubled phrase)**, Testing, first bullet.
  - Before: runs Solenoid inside the test process: the hosted API's own request handler and ledger code, over in-memory node:sqlite.
  - After: runs Solenoid inside the test process, over in-memory node:sqlite.
- **Fix 4 (V4, repeated Node floor)**, Testing, first bullet.
  - Before: Older Node gets an error that says so. The SDK needs Node 20 or later.
  - After: Older Node gets an error that says so.
