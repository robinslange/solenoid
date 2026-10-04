# Grade: README.md

Medium: GitHub repository README. Non-closing.

## Plan 3a round 1 (2026-09-30): PASS-WITH-FINDINGS

Three cold `copy-grader` runs, dispatched as plain subagents in one message, each with the draft pasted inline and only the medium, the jurisdiction (New Zealand) and "non-closing" given, then `tally.py run1.md run2.md run3.md`. The same round graded all four Plan 3a doc units, and one `copy-source-checker` run covered the cited sources (Node SQLite docs: SUPPORTS; FSL-1.1-ALv2 text: SUPPORTS).

Draft graded: The whole file, new in this task: the product README that replaced the runbook, which moved to `docs/runbook.md`.

Tally: Gate 0 CLEAR (0/3). Findings: C2, H3, V1, M1, C1, H1.

### Controller's rulings

- **H1 (the product-name heading): accepted.** A repository README opens with the project name, and the line under it carries the promise.
- **Non-closing.** The README shows the `init` command but no price and no buying action.
- **Files named before they exist (`site/`, the race recorder, the canary, `LICENSING.md`, `SECURITY.md`): ruled acceptable.** The README goes public only at Task 19, and the final review checks it against the tree then.

### Findings fixed

Each new sentence was checked against the code before it was written: `cli/src/commands.ts` (`upgrade`, `init`, `limit`, `HELP`), `cli/src/browser.ts`, `worker/src/billing-routes.ts`, `worker/src/core.ts` (the free-plan cap, `recoverFinish`), `sdk/src/http.ts` and `sdk/src/index.ts` (retry rules, `checkout`), `worker/src/router.ts` (`/.well-known/solenoid.json`), and the Node 22.12 CLI docs (`--experimental-sqlite` is allowed in `NODE_OPTIONS`).

- **Fix 13 (M1, problem first)**, Second paragraph, first sentence.
  - Before: (none)
  - After: An agent with tools can send one customer the same email forty times.
- **Fix 12 (V1, a concrete limit)**, Second paragraph.
  - Before: (none)
  - After: For example, after `npx @solenoid.systems/cli limit support-bot emails=3 --per day`, a tool that spends `emails: 1` at `support-bot` before each send is refused on its fourth send in a UTC day.
- **Fix 10 (H3, pay off the receipt)**, New paragraph before Start.
  - Before: (none)
  - After: Every spend Solenoid records returns a receipt that Solenoid signs. You can verify it offline with the public keys from https://api.solenoid.systems/.well-known/solenoid.json.
- **Fix 2 and ruling 2 (C2, .env)**, Start.
  - Before: It creates your account with no signup form, prints the admin key once, and writes a spend key for `support-bot` to `.env` as `SOLENOID_KEY`, unless `.env` already has one.
  - After: It creates your account with no signup form, prints the admin key once, and writes a spend key for `support-bot` to `.env` as `SOLENOID_KEY`. If `.env` already has a `SOLENOID_KEY`, `init` leaves it as it is and prints the new key for you to place.
- **Fix 11 (C2, save the admin key)**, Start.
  - Before: (none)
  - After: Keep a copy of the admin key somewhere safe: it sets your limits, and `init` shows it only once.
- **Fix 11 (C2, what the agent does)**, Start.
  - Before: Then point your coding agent at https://solenoid.systems/llms.txt.
  - After: Then point your coding agent at https://solenoid.systems/llms.txt. It tells the agent how to add a spend call before each action a tool takes, using the key in `.env`.
- **Fix 14 (C1, one action ends Start)**, Moved.
  - Before: Docs: https://solenoid.systems/docs. Pricing: https://solenoid.systems/pricing. (at the end of Start)
  - After: The same line, moved below the "What is here" table and its license paragraph.
