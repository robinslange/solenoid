# Grade: `/pricing`

Medium: pricing page. Closing unit, graded against `npx @solenoid.systems/cli init support-bot`. Jurisdiction: New Zealand.

## Plan 3a round 1 (2026-09-30): PASS-WITH-FINDINGS

Three cold `copy-grader` runs, then `tally.py`. The page cites no sources, so there was no source check.

Tally: Gate 0 CLEAR. Findings: M1, O4, H1, P3, V1, V4, C2, C3, X1.

### Robin's answers (binding)

- Add "Solenoid is sold for business use, so the Consumer Guarantees Act does not apply" and "No GST is charged". Both are on the lawyer-glance list.

### Controller's rulings

- **C3: accepted**, as for the hero. The only attribution is Umami's record of `?ref=` visits, and no copy claims a visit is tied to a signup.

### Fixes

- **H1.** Before: "Pricing". After: "Free for your first 100,000 spends each month".
- **M1 + P3.** Added an opening line: "Solenoid puts limits on what your AI agent does. Before each action, such as sending an email or issuing a refund, your tool calls spend, and that call is one spend. Past a limit you set, Solenoid refuses the spend and your tool gets an error before it acts." Source: `worker/src/core.ts` `spend()` returns `402 limit_exceeded` before anything is written.
- **O4.**
  - The Free card now ends "…refused until the month turns, or until you move to Pro."
  - The upgrade step says: "Your account moves to Pro once Stripe confirms the payment to Solenoid, and from then on the 100,000 cap no longer applies."
  - Source: `worker/src/billing-routes.ts:37` sets Pro on `checkout.session.completed` with `payment_status === 'paid'`. `core.ts` `#checkPlan` returns null when `plan !== 'free'`.
- **V1.** "What counts as a spend" now names each free call plainly: a refused spend, a retry with the same idempotency key (which gets back the first receipt), reading limits and usage, setting or changing a limit, the settle (defined inline), and recovery emails. Source: `core.ts` `spend()` returns the prior entry on an `idem` match and writes nothing on a refusal. `#checkPlan` subtracts `nonspend_month`. The meter counts only `kind = 'spend'`.
- **C2.**
  - `init` is now described: "It creates your account, prints your admin key and writes a spend key to .env, unless .env already has one. support-bot is an example name, so use one that fits your agent."
  - Source: `cli/src/commands.ts:195-208`.
- **V4.**
  - "billed as used" was removed from the Pro card, and "Prices are in US dollars and shown as they are" was removed.
  - The closing paragraph now ends on the two new facts: "No GST is charged. Solenoid is sold for business use, so the Consumer Guarantees Act does not apply."
- **X1.** Both sentences from Robin's answer are added. "no partial refunds" is kept.
