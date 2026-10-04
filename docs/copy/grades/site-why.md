# Grade: `/why` (founder note)

Medium: founder note. Non-closing unit. Jurisdiction: New Zealand.

## Plan 3a round 1 (2026-09-30): PASS-WITH-FINDINGS

Three cold `copy-grader` runs, then `tally.py`, and one `copy-source-checker` run. It returned 7/7 SUPPORTS, with notes.

Tally: Gate 0 CLEAR. Findings: M3, H1, H2, H3, P2, V1, X2. H3 and P2 were raised in 3 of 3 runs.

### Fixes

- **H1 + H2 (hook matches the evidence).**
  - Headline before: "Why Solenoid exists". After: "AI agents act where their owners don't want them to".
  - Opening before: "I'm Robin Lange. …" After: "In each of the public incidents below, an agent did something its owners did not want. In the first, its owner told it to stop, and it kept going."
  - The byline is kept as a line under the headline: "A note from Robin Lange, who builds software in Auckland and trades as omit."
- **Source-check notes, OpenClaw.**
  - Her role is attributed to TechCrunch ("a woman TechCrunch describes as a Meta AI security researcher"). The task comes from TechCrunch ("check her overstuffed email inbox and suggest what to delete or archive"), and "confirm before acting" from her post.
  - Added: "TechCrunch notes it could not independently verify what happened to her inbox." TechCrunch: "TechCrunch could not independently verify what happened to Yue's inbox."
  - No literal stop command is quoted.
- **Source-check notes, Replit.**
  - Now: "SaaStr's founder said Replit's agent deleted his production database despite his instructions not to change any code without permission, then told him a rollback was impossible. The rollback worked."
  - The Register: "Replit deleted a database despite his instructions not to change any code without permission", and "It turns out Replit was wrong, and the rollback did work."
- **Source-check notes, Zendesk.**
  - Added: "Zendesk traced it to a database fault in its own platform that stopped conversation state from updating."
  - Zendesk's Root Cause Analysis: "lock contention resulted in database 'lock wait timeout' errors … preventing conversation state from being updated and leading to repeated/looping bot behavior."
  - "In some cases" is kept.
- **P2 (scope the diagnosis).**
  - Before: "In each of these, the agent acted where its owners did not want it to. An instruction given in the chat lives inside the agent, and the agent decides what to do with it."
  - After: "In the first of these, the owner's instruction to stop went through the agent itself, and the agent kept going."
- **V1.** Added one concrete limit: "Set emails=3 per customer, and each customer gets three emails; the fourth is refused, whatever the agent remembers." This matches the landing's `limit support-bot emails=3 --per child`.
- **X2.** "…so afterwards you can show what the agent did through the tools that ask Solenoid."
- **M3.** The rewrite above covers it. The landing's line "A limit the agent can't talk its way past has to live outside the agent, so I built one." is kept verbatim.
