# Grade: testing/README.md

Medium: npm README for `@solenoid.systems/testing`. Non-closing.

## Plan 3a round 1 (2026-09-30): PASS-WITH-FINDINGS

Three cold `copy-grader` runs, dispatched as plain subagents in one message, each with the draft pasted inline and only the medium, the jurisdiction (New Zealand) and "non-closing" given, then `tally.py run1.md run2.md run3.md`. The same round graded all four Plan 3a doc units, and one `copy-source-checker` run covered the cited sources (Node SQLite docs: SUPPORTS; FSL-1.1-ALv2 text: SUPPORTS).

Draft graded: The whole file, new in this task.

Tally: Gate 0 CLEAR (0/3). Findings: C2, M1, H1. Source check: the Node SQLite docs and the FSL-1.1-ALv2 text both SUPPORT the draft.

### Controller's rulings

- **H1 (the package-name heading): accepted.** npm convention; the first paragraph carries the promise.

### Findings fixed

Each new sentence was checked against the code before it was written: `cli/src/commands.ts` (`upgrade`, `init`, `limit`, `HELP`), `cli/src/browser.ts`, `worker/src/billing-routes.ts`, `worker/src/core.ts` (the free-plan cap, `recoverFinish`), `sdk/src/http.ts` and `sdk/src/index.ts` (retry rules, `checkout`), `worker/src/router.ts` (`/.well-known/solenoid.json`), and the Node 22.12 CLI docs (`--experimental-sqlite` is allowed in `NODE_OPTIONS`).

- **Fix 8 (M1, what Solenoid is)**, Opening paragraph.
  - Before: (none)
  - After: Solenoid puts limits on the actions your AI agent takes and checks them before each action.
- **Fix 5 (C2, the flag under a runner)**, Node paragraph.
  - Before: (none)
  - After: Under a test runner, pass the flag through the environment, for example `NODE_OPTIONS=--experimental-sqlite npx vitest`.
- **Fix 6 (C2, link label)**, After the sample.
  - Before: The SDK README's Testing section describes each one: https://solenoid.systems/docs#testing
  - After: [The Testing section of the SDK docs](https://solenoid.systems/docs#testing) describes each one.
- **Fix 9 (follow the FSL text)**, License.
  - Before: You may use it for any purpose except a Competing Use, which is making it available to others in a commercial product or service that substitutes for Solenoid or offers substantially similar functionality.
  - After: You may use it for any purpose except a Competing Use: making it available to others in a commercial product or service that substitutes for this package, or that offers the same or substantially similar functionality.
- **Fix 7 (C2, name the repository)**, License.
  - Before: See `LICENSING.md` in the repository.
  - After: The source is at https://github.com/robinslange/solenoid, and `LICENSING.md` there maps every directory to its license.
