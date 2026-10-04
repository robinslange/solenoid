# Grade: site chrome (header nav, footer, and the titles and descriptions of / and /docs)

Medium: site navigation. Non-closing. Jurisdiction: New Zealand.

## Plan 3a round 1 (2026-09-30): PASS-WITH-FINDINGS

Three cold `copy-grader` runs, then `tally.py`.

Tally: Gate 0 CLEAR (0/3). Findings: M1, H1, H3, H4, P1, V1, C1, C2, X2.

### Controller's rulings

- **"trading as omit.": kept.** It is the legal trading name, lowercase by styling.

### Fixes

- **Home title and description (X2, H1, H3, V1).**
  Before: title "Solenoid: limits on what your AI agents do". Description: "Your agent's tools call Solenoid before they act. An action past its limit is refused before it runs, and every recorded one returns a signed receipt."
  After: title "Solenoid: limits on your AI agent's emails, refunds and deletes". Description: "An agent stuck in a retry loop can email one customer forty times or refund an order twice. Tools that call Solenoid before they act are refused past their limit, and every recorded action gets a signed receipt."
- **Docs title (H4, P1).** Before: "Solenoid docs: the SDK README". After: "Solenoid SDK: keys, limits and receipts".
- **Header (C2, C1).** A primary "Start" link to /#start, set off with an accent border. "Why" became "Why I built it".
- **Footer:** unchanged.
