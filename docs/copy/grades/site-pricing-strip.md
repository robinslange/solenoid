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
