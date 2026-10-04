# Grade: site pricing strip (`/#pricing-strip`)

Medium: developer product landing page. Closing unit. Jurisdiction: New Zealand.

## Plan 3a round 1 (2026-09-30): PASS-WITH-FINDINGS

Three cold `copy-grader` runs, then `tally.py`.

Tally: Gate 0 CLEAR (0/3). Findings: M1, M3, O1, O2, V1, C3.

### Controller's rulings

- **M3 and O2: accepted.** It is a price strip under a page that already carries the reader and the value.
- **C3: accepted**, as for the hero.

### Fixes (O1, V1, M1)

Before: "Free: 100,000 spends each UTC calendar month. Pro: $29 USD a month including 2M spends, then $10 USD per extra million."
After: "A spend is one call your tool makes before an action. Free: 100,000 spends each UTC calendar month. Pro: $29 USD a month, including 2M spends each billing month. Past that, spends are charged as used, at $10 USD per million."

Source: spec `docs/superpowers/specs/2026-09-29-solenoid-site-design.md`, lines 90, 189 and 352. The included 2M count per Stripe billing period. The graduated tier is 0.001 cents per spend, which is $10 per million, and overage is billed as used.

## Task 25 (2026-10-04): landing cut

Words: 41 to 37.

### Round 1: three cold `copy-grader` runs, then `tally.py`

Tally: Gate 0 CLEAR (0/3). Findings: O2, O3 (no risk reversal), H1 (opened on a definition), C3. Unstable: H2 (1/3), H4 (1/3), C2 (1/3).

Rulings: **O2 accepted** (the page above carries the outcome, and a strip states terms). **C3 accepted**, as before.
Truth review (`task-25-truth.md`, finding 3): a bare "2M spends" could read as a one-time quota.

- Before: "A spend is one call your tool makes before an action. Free: 100,000 spends each UTC calendar month. Pro: $29 USD a month, including 2M spends each billing month. Past that, spends are charged as used, at $10 USD per million."
- After round 1: "Free for 100,000 spends each UTC calendar month. Pro is $29 USD a month with 2M spends each billing month, then $10 USD per extra million. Cancel anytime: Pro runs to the end of the paid month."

### Round 2: closing bands (the strip and the bottom call to action), three cold runs

Tally: Gate 0 CLEAR (0/3). Findings: O3, H2, C1, C3. Unstable: V4 (1/3).

Rulings: **C3 accepted.** No money-back guarantee is added: that is a business decision for Robin, not a copy fix.

- **O3, H2.** After: "Start free: 100,000 spends each UTC calendar month. Pro is $29 USD a month with 2M spends each billing month, then $10 USD per extra million. Cancel anytime: Pro runs to the end of the paid month."
- **C1, V4 (bottom call to action).** Its trailing "Free for 100,000 spends each UTC calendar month. See pricing." line is removed, so the bottom call to action ends on its last new thing and the strip alone links /pricing. `site/test/dist/landing.test.ts` changed to match.

Source: global constraints product facts. `site/src/pages/pricing.astro:18`, `:22` and `:38` ("Cancel anytime ... Pro runs to the end of the paid month, with no partial refunds"). The truth re-review after round 1 found the strip's facts match /pricing.
