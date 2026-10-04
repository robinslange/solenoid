# Grade: site bottom call to action (`/#start`)

Medium: developer product landing page. Closing unit, graded against `npx @solenoid.systems/cli init support-bot`. Jurisdiction: New Zealand.

## Plan 3a round 1 (2026-09-30): PASS-WITH-FINDINGS

Three cold `copy-grader` runs, then `tally.py`. The source check is shared with the hero: 4/4 SUPPORTS.

Tally: Gate 0 CLEAR (0/3). Findings: C2, O1, C3, P3, H3.

### Controller's rulings

- **C3: accepted**, as for the hero.

### Fixes

The start steps are shared with the hero (`site/src/components/StartSteps.astro`), so the hero's C2, P3 and H3 fixes apply here word for word: example names, the admin key, per-customer spends in the prompt, and a third limit step.

- **H3 (the headline "Give your agent its first limit" was never paid).** Step 3 now sets the first limit: "Run the limit commands your agent suggests, such as `npx @solenoid.systems/cli limit support-bot emails=3 --per child`, which gives each customer three emails."
- **O1.**
  Before: "Free for the first 100,000 spends each month."
  After: "Free for the first 100,000 spends each UTC calendar month. Past that, spends are refused until the month turns, unless you move to Pro. The pricing page has the details." The last sentence links to /pricing.

## Plan 3a round 2 (2026-09-30): order fixes shared with the hero

This round applies the hero recheck's order fixes to #start through the shared `StartSteps`. The details and the before and after text are in `site-hero.md`, round 2. They cover five changes: the example note and the scope and child definitions in step 1's lead-in, the no-catch instruction in the agent prompt, the stop paragraph after step 3, and the Free line after it.

- **C1 (the price above the steps).**
  Before: under the headline, "Free for the first 100,000 spends each UTC calendar month. Past that, spends are refused until the month turns, unless you move to Pro. The pricing page has the details."
  After: that paragraph was removed from `BottomCTA.astro`. The same sentence now renders once, inside `StartSteps` after the stop paragraph, so the headline leads straight into step 1.
