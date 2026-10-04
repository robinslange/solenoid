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
