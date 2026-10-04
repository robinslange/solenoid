# Grade: `/privacy`

Medium: privacy notice, NZ Privacy Act 2020. Non-closing unit. Jurisdiction: New Zealand.

## Plan 3a round 1 (2026-09-30): BLOCKED, then fixed

Three cold `copy-grader` runs, then `tally.py`. The code review confirmed every row against the code, including the security-mail row.

Tally: Gate 0 BLOCKED (3/3): third-party behaviour stated without sources. Findings: H1, H3, P1, V1, C2, X1.

### Robin's answers (binding)

- **Umami:** described as in Solwen's privacy policy: "a privacy-first analytics tool omit hosts itself", with no cookies and honouring Do Not Track. No host or country is named. Retention: "Until omit deletes them". The UNCONFIRMED comment and "a Hetzner server in Germany" are removed.
- **Address:** email only (privacy@solenoid.systems). It is on the lawyer-glance list.
- **Workers Paid:** confirmed, so "7 days" stands.

### Fixes

**Gate 0.** Each third-party claim now links its source. Each URL returned 200 on 2026-09-30.

| Claim | Source | What it says |
|---|---|---|
| Privacy Act 2020 | https://www.legislation.govt.nz/act/public/2020/0031/latest/LMS23223.html | The Act's cover page ("Privacy Act 2020 Public Act 2020 No 31") |
| "We answer within 20 working days" (access) | https://www.legislation.govt.nz/act/public/2020/0031/latest/LMS153150.html | s 44 "Responding to IPP 6 request": "not later than 20 working days after the day on which the request is received" |
| "We answer within 20 working days" (correction) | https://www.legislation.govt.nz/act/public/2020/0031/latest/LMS134243.html | s 63 "Decision on request to correct personal information": "not later than 20 working days after receiving the request" |
| The Durable Object stays where it is created | https://developers.cloudflare.com/durable-objects/reference/data-location/ | "Durable Objects do not currently change locations after they are created" |
| Workers Logs, 7 days on Paid | https://developers.cloudflare.com/workers/observability/logs/workers-logs/ | "Workers Paid … 7 Days" |
| Umami uses no cookies | https://umami.is/docs/faq | "Umami does not use any cookies in the tracking code." |
| Honours Do Not Track | https://umami.is/docs/tracker-configuration | "data-do-not-track … Respect user's Do Not Track browser setting". `site/src/layouts/Layout.astro` sets `data-do-not-track="true"`. |
| Stripe's retention | https://stripe.com/privacy | "We retain your Personal Data for as long as we continue to provide the Services…" |
| Resend's retention and US processing | https://resend.com/legal/privacy-policy | "6. Retention of Data" and "we transfer the data … to the United States and process it there" |
| Cloudflare processes outside NZ | https://www.cloudflare.com/privacypolicy/ | Cloudflare's privacy policy |

The other fixes:

- **X1 (IPPs 3, 9 and 12).**
  - A "Why" column gives each row's purpose.
  - Added: "Cloudflare, Stripe and Resend process data outside New Zealand under their own terms", with each company's privacy policy linked.
  - The contact line now reads "To see, correct or ask us to delete…", followed by "We answer within 20 working days". No deletion mechanism is promised.
- **H3.**
  - The opening is scoped: "everything the Solenoid API and this website store or log about you, taken from the code."
  - Added a row: "Email you send to privacy@solenoid.systems or security@solenoid.systems / Solenoid's mailbox / Until deleted by hand / To answer you".
- **V1.**
  - The code row now reads "The 6-digit code emailed when you attach or recover a recovery email…". Source: `worker/src/codes.ts` `CODE_RE = /^[0-9]{6}$/`.
  - Where the ops ledger lives: "Solenoid's own ledger, in the ops account's Durable Object". Source: `worker/src/ops.ts` `OPS_TENANT`.
- **P1.**
  - Before: "About one day, removed by a scheduled job". After: "A code stops working 15 minutes after it is sent. A scheduled job deletes each code and each record within a day of writing it."
  - Source for the 15 minutes: `codes.ts` `CODE_TTL_MS = 15 * 60_000`.
  - Source for the job: `core.ts` `#prune` deletes `codes` past `expires` and `code_events` older than `DAY_MS`. `#codeRowWritten` sets `next_prune` to at most one day after a write. `#reschedulePrune` moves it to the earliest row's due time. `tenant.ts` arms the alarm after every code call.
- **H1.** Before: "Privacy". After: "What Solenoid stores about you".
- **C2.** One action: the email to privacy@, with the response time.

## Plan 3a round 2 (2026-09-30): the Privacy Act anchors

The source check on `0088fed` found that the "20 working days" link pointed to LMS23342, which is s 22 (the IPPs). It now cites s 44 (LMS153150) for access and s 63 (LMS134243) for correction.
- Before: "We answer within [20 working days]."
- After: "We answer within 20 working days ([section 44], [section 63])."

The table row for LMS23223 is corrected too. It is the Act's cover page, not s 22.
