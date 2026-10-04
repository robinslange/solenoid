# Grade: CLI output — `upgrade`

Medium: CLI output. Non-closing.

## Round 1 (2026-09-30): PASS-WITH-FINDINGS (Gate 0 CLEAR 0/3)

Three cold `copy-grader` runs, dispatched as plain subagents in one message, each with the draft pasted inline and only the medium, the jurisdiction (New Zealand) and "non-closing" given. `tally.py run1.md run2.md run3.md`: Gate 0 CLEAR in all three (0/3). Findings at 2-of-3 or more: C2, H4, O2. Unstable (1/3, below the reporting bar): H1, H3.

Draft graded, the `upgrade` command's five strings as committed in c86716f:
1. the `explain('billing_unavailable')` entry
2. the `HELP` line
3. the `already_pro` line
4. the `Outage` line
5. the final line of a successful `upgrade` (the three-line array's last entry)

### Controller's rulings

- **H4 (scroll-stop physics), dismissed as a draft artifact.** The finding read the draft's own layout, where the URL sat above its label line. In the shipped code the array order is label, then URL, then the final explanation (`cli/src/commands.ts`'s `return [ ... ].join('\n')`), so the label is always what the reader meets first. The grader graded the paste order, not the render order; nothing in the actual command output has this defect.
- **O2 (value equation legible), accepted, no fix.** The reader reaches `upgrade` after `solenoid help` or `solenoid.systems/pricing` already state the price and what it buys; a CLI command's own output is not a sales surface, and restating the offer here would repeat rather than inform. The command's job is to state what happens next, which C2 already covers.
- **H1 and H3, unstable at 1/3, not actioned.** Below the 2-of-3 reporting bar; a single run flagged the `HELP` line as not carrying enough of a promise on its own (H1) and one run tied that to a claim the rest of the output does not pay off (H3). Both readings depend on treating the `HELP` line as a headline, which a one-line help-column entry is not.

### Findings fixed (C2, 3/3 each)

All three are "instructions unambiguous" (Kennedy): a next step, or the state that decides which next step applies, was missing or implicit. Fixed directly in `cli/src/commands.ts`; no finding was accepted without a fix.

**1. The final `upgrade` line didn't say what happens after the command exits, or how to recover if the automatic email never arrives.**

Before:
> `once you pay, account ${tenant} moves to Pro. a 6-digit code then goes to the email you paid with: run \`solenoid email <that address> <code>\` to make it your recovery email.`

After:
> `this command exits now, so pay in your own time. once the payment goes through, account ${tenant} moves to Pro, and a 6-digit code goes to the email used at checkout. if no code arrives, run \`solenoid email <address>\` with that address to send a new one, then \`solenoid email <address> <code>\` with that address and the code to make it your recovery email.`

Checked against `worker/src/billing-routes.ts`'s webhook (`checkout.session.completed` → `billingStart`, then `attachStart` + `codeMail` to `o.customer_details?.email`, when `started` is true): the account moves to Pro and a code is mailed to the checkout email automatically, with no further command needed. The resend step is checked against `dispatch`'s `email` case (`cli/src/commands.ts`): `solenoid email <address>` with no second argument always calls `sendEmailCode(email)`, the same attach-code path, so it genuinely sends a fresh code; `solenoid email <address> <code>` then confirms it. The placeholders read as values to type, per the fix direction given.

**2. `billing_unavailable` gave no next step, only the fallback.**

Before:
> `'billing is not open yet, so Pro cannot be bought today. the free plan keeps working: 100,000 spends each UTC calendar month.'`

After:
> `'billing is not open yet, so Pro cannot be bought today. run \`solenoid upgrade\` again later; solenoid.systems/pricing says when Pro opens. the free plan keeps working: 100,000 spends each UTC calendar month.'`

The free-plan sentence is kept verbatim, as directed.

**3. The `HELP` line stated only one outcome, not that the account's own state decides which one happens.**

Before:
> `'  upgrade                                                             move this account to Pro in Stripe Checkout, or get the billing portal link'`

After:
> `'  upgrade                                                             opens Stripe Checkout to move this account to Pro, or prints the billing portal link when already on Pro'`

Checked against `dispatch`'s `upgrade` case: `checkout()` throws `already_pro` exactly when the account is already Pro, and only then does the command print the portal link instead of opening Checkout; every other outcome opens Checkout. The line now names the branch that decides the outcome, kept to one line, per the fix direction given.

### V4 (voice)

Clean in all three runs against the graded draft: no em or en dashes, no "X, not Y" constructions, no tricolons built for rhythm. The three C2 fixes above keep the same constraints: no dashes, no "X, not Y", lowercase throughout except the proper nouns already used elsewhere in the CLI (`Pro`, `Stripe Checkout`).

### Test evidence

`pnpm --filter ./cli test`: 189/189 pass. `cd cli && pnpm run mutate --force`: 96.09 (664 killed, 0 timeout, 12 survived, 15 no-coverage) — at the 96.09 floor, same survivors as the pre-copy-fix run (see `docs/testing/MUTATION-SUMMARY.md`'s CLI section); the wording changes touch no branch or mutant. `cli/test/cli.test.ts`'s `HELP` array (exact match) was updated to the new `upgrade` line. No other test pins the changed wording (`cli/test/upgrade.test.ts` matches only `toContain('solenoid email')`, `.not.toBe('')` and error-code prefixes, per the frozen-copy rule), so no other test needed a change.
