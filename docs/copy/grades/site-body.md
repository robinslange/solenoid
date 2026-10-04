# Grade: site body (`/#race`, `#one-call`, `#receipt`, `#limits`, `#outage`, `#why`, graded as one unit)

Medium: developer product landing page. Non-closing. Jurisdiction: New Zealand.

## Plan 3a round 1 (2026-09-30): PASS-WITH-FINDINGS

Three cold `copy-grader` runs, then `tally.py`. One `copy-source-checker` run covered `e2e/test/concurrency.test.ts` (the first test and the `per: child` test), `e2e/record-race.ts` and `https://api.solenoid.systems/.well-known/solenoid.json`: 4/4 SUPPORTS. The checker noted that the per-child guard also covers nested scopes.

Tally: Gate 0 CLEAR (0/3). Findings: M1, H3, P2, P3, V1, C1, C2, X2.

### Controller's rulings

- **P2 ("20 more lines", and the truncated hash and sig): not a page defect.** Both came from the controller's paste. The page renders all 30 lines and the full receipt.

### Fixes

- **Race P3 (why the limit holds) and plainer words for "Worker".**
  Before: "This is a recording of a real run against a local copy of the Worker, with each spend sent from its own client."
  After: "This is a recording of a real run of Solenoid's API code on a local machine, the same code production runs, with each spend sent from its own client. ... The limit holds because each account's spends go through one Durable Object, a single Cloudflare instance that handles them one at a time."
  Source: `e2e/wrangler-dev.ts:39` runs `wrangler dev` in `worker/`. `worker/src/index.ts:10` routes each account to a Durable Object with `idFromName(tenant)`. `worker/src/core.ts:383` `#serial` chains every spend on one lock.
- **Race: the rcp_2 gap.**
  After: "Receipt ids count every entry on the account. This run's first entry, rcp_1, was the limit being set, so the spends start at rcp_2."
  Source: `worker/src/core.ts` `put` seals a `limit` entry, and `toReceipt` builds ids as `rcp_${seq}`. `e2e/record-race.ts` runs `init`, which writes no entry, then `limit acme calls=7`, which becomes seq 1, before the spends. The demo account's saved receipt is rcp_1 because nothing came before its spend.
- **One call X2 and C2.**
  Before: "Call spend before the send. At the limit, spend throws, and the email never goes out. The limit command below gives each conversation three emails."
  After: "Call `spend` before the send. At the limit, `spend` throws and the email never goes out. It throws by default when Solenoid can't be reached too, as the outage section below explains. The limit command in the CLI tab gives each customer three emails." The TS sample's parameter became `customer`.
- **Receipt H3 (the sample never defined `receipt`).**
  After: the sample imports `saved from './receipt.json' with { type: 'json' } // the receipt above`, then sets `const receipt = saved as Receipt`, and imports the saved `.well-known` file the same way.
  Source: `site/test/receipt.test.ts` runs the same `verifyChain([receipt], keys)` on the saved receipt and keys offline.
- **Limits C1 and V1 (what a child scope is).**
  After: "A child scope is one level under the limit's scope, so support-bot/order-1 is a child of support-bot, and spends deeper down, such as support-bot/order-1/partial, count toward order-1."
  Source: `worker/src/scope.ts:22` `childOn`, and the `per: child` test in `e2e/test/concurrency.test.ts` (`acme/refunds/order-1/partial` is refused after `order-1`).
- **Outage V1 (make it concrete).**
  Before: "A spend that can't reach Solenoid fails closed by default ... Once your client has seen that setting on an earlier spend, its spends there go ahead unrecorded while Solenoid can't be reached."
  After: "Say your email tool spends at support-bot/c-1042 and Solenoid can't be reached. By default every limit fails closed, so `spend` throws and the next email doesn't go out. You can add `--on-outage open` to every limit over support-bot. A client that has seen that setting on an earlier spend then gets no receipt back from `spend`, and the email goes out unrecorded. A client that hasn't seen it yet still fails closed."
  Source: `sdk/src/index.ts` `post` returns null in `open` mode and throws `SolenoidUnavailable` otherwise. `modeFor` defaults to `closed`. `worker/src/core.ts` `#reply` reports `open` only when every applicable limit is open.
- **Why C2 (the link label).** Before: "Read the note". After: "Why I built it", linking to /why.

## Task 25 (2026-10-04): landing cut

Each section is now one claim heading, one or two lines and the proof, with the detail behind a labelled docs link. Words are heading plus body, with code, terminal output and link labels left out (before to after): race 96 to 45, one call 51 to 32, receipt 27 to 25, limits 86 to 42, outage 72 to 43, why 34 to 29. Raw `wc -w` across the six: 680 to 534, most of what remains being code and terminal lines.

Three cold `copy-grader` runs, then `tally.py`.

Tally: Gate 0 CLEAR (0/3). Findings: C1, C2, on the doc links "Why the limit holds", "How per child works", "How outage mode works" and "Why I built it", which named a topic and not where the click goes. Unstable: H3 (1/3), P2 (1/3).

### Controller's rulings

- **C1: accepted after fix 4.** Labelled doc links are the "detail one layer down" the brief asks for, and they don't compete with the call to action.
- **C3: accepted**, as before.

### Truth review (`task-25-truth.md`)

1. The race's "Why the limit holds" link went to `/docs#countable-units-spend-first-then-act`, which covers atomicity, not concurrency. The Durable Object mechanism was on neither the page nor /docs.
2. The outage sentence held only when every limit on the spend is open (closed wins), and its link (`#short-lived-processes`) didn't state that rule.

Every other body claim was verified true: the race counts, rcp ids, per child, the receipt and the offline check.

### Fixes, round 1

- **Race (truth 1).** After: "A recorded local run of Solenoid's API code, one client per spend. 7 were recorded and 23 refused. Each account's spends go through one Cloudflare Durable Object, which handles them one at a time." The "Why the limit holds" link is gone. The rcp_1/rcp_2 sentence was cut to stay inside 45 words.
  Source: `worker/src/index.ts:10` (`idFromName` per account), `worker/src/tenant.ts:7`, `site/src/data/race.json`.
- **Outage (truth 2).** The link now goes to `/docs#setting-limits`, which states "When several limits apply to one spend, `closed` wins".
- **Doc links (C2).** "At-most-once limits, in the docs" (`/docs#at-most-once`), "Setting limits, in the docs" (`/docs#setting-limits`), "My note on the /why page" (`/why`). The anchors exist in `dist/docs.html`, and the build's link check passes.

### Fix, round 2 (truth re-review readability note, `task-25-truth-r1.md`)

- **Outage.** Round 1: "With `--on-outage open` on every limit that spend meets, a client that has spent since you set them lets the email through, unrecorded." After: "If every limit on a spend is set to `--on-outage open`, a client that saw that setting on an earlier spend lets the email through, unrecorded."
  Source: `worker/src/core.ts:542` reports `open` only when every applicable limit is open. `sdk/src/index.ts:114` caches that mode on each successful spend. `sdk/src/index.ts:118-120` returns `null` (nothing recorded) for a cached `open` and otherwise throws `SolenoidUnavailable`. The controller line-checked this.

### Body after the cut

- Race: heading "30 spends at the same moment, against a limit of 7", then the round 1 text above. Links: `e2e/test/concurrency.test.ts`, `e2e/record-race.ts`.
- One call: "One call, in front of the action". "Call `spend` before the send. At the limit, `spend` throws and the email never goes out. The CLI tab's limit gives each customer three emails."
- Receipt: "A signed receipt for every recorded spend". "This one came from the production API. Save the public keys once, and anyone can check it offline."
- Limits: "It limits any action your code can count". "Emails, refunds, deletes or fetches. With `--per child`, each customer or order gets its own count, so a limit of 1 allows one refund per order. If you cap model spend, keep your gateway for that."
- Outage: "When Solenoid is down, sends stop by default". "Every limit fails closed: `spend` throws and the email doesn't go out." followed by the round 2 sentence.
- Why: "A limit the agent can't talk past has to live outside it". "An agent can keep acting after its owner says stop. I built Solenoid to be that limit."

The truth re-review after round 1: PASS, 5/5 fixes ADDRESSED, no new breakage.
