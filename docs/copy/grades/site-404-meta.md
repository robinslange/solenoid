# Grade: `/404` and every page's title and meta description

Medium: error page, and search result snippets (`node site/scripts/unit-text.mjs --meta site/dist`). Non-closing units. Jurisdiction: New Zealand.

## Plan 3a round 1 (2026-09-30): PASS-WITH-FINDINGS

Three cold `copy-grader` runs, then `tally.py`. These units cite no sources.

Tally: Gate 0 CLEAR. Findings: M1, V1, C1.

### Controller's rulings

- **C1: accepted.** The 404 offers two exits, /docs and /, which a not-found page legitimately does.

### Fixes

- **M1 / V1 (each description says what Solenoid is).**
  - `/404`: "There is no page at this address on solenoid.systems, the site for Solenoid, which puts limits on the actions AI agents take."
  - `/docs`: "The docs for Solenoid, which puts limits on the actions AI agents take: how to give an agent a spend key, …"
  - `/pricing`: "Solenoid checks each action your AI agent takes against your limits, and each check is a spend. Free for 100,000 spends each UTC calendar month. Pro is $29 USD a month with 2M, then $10 USD per extra million." The first sentence glosses "spends".
  - `/privacy`: "Solenoid puts limits on the actions AI agents take. This is everything its API and website store or log about you, where, for how long and why, and how to ask for access, correction or deletion."
  - `/why`:
    - Title: "Why Solenoid exists: agents that act where their owners don't want them to".
    - Description: "A note from Robin Lange, who built Solenoid to put limits on AI agents' actions: public incidents where agents acted where their owners didn't want them to, and why the limit lives outside the agent."
    - Both match the rewritten hook.
  - `/` is unchanged. It was graded with the hero.
