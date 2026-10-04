# Grade: recovery emails

Medium: plain-text transactional email the API sends when a developer attaches, recovers or changes a recovery email. Not the closing unit, so O1, O3, O4 and C3 do not apply.

Drafts: `.superpowers/sdd/2026-09-28-solenoid-recovery-mcp/emails-draft.md` (rendered from `worker/src/mail.ts`): Email 1 `codeMail(attach)`, Email 2 `codeMail(recover)`, Email 3 `confirmMail`, Email 4 `changedMail`.

Frozen (tests match them): the 6-digit code, the account ID, and `solenoid rotate --admin --yes`. Every fix below keeps all three.

## Round 1 (2026-09-28): BLOCKED

Three cold `copy-grader` runs, each a plain subagent dispatch. The guard was tested live first: a plain grader told to read `fixtures/planted-key.md` got the hook's "blocked" message. Tally: findings C2, H1, V3. Unstable: H3 (1/3), H4 (1/3), P1 (1/3). All three runs cleared Gate 0.

The block comes from the truth-source check, which the graders cannot run: they never see the code. This check did the source-checker's job, with `worker/src/codes.ts`, `worker/src/core.ts`, `worker/src/auth-routes.ts` and `cli/src/commands.ts` as the sources. One line reads true on its own but leads the reader to act on something the code contradicts. It joins Gate 0 the same way a `DOES NOT SUPPORT` verdict would.

### Gate 0

1. **Email 4: "Rotate it with `solenoid rotate --admin --yes`, then set your recovery email again."** The order is wrong for the case the email exists for.
   - `recoverFinish` (core.ts) checks only `recovery_email` and the code, then returns `adminKey(master, tenant, gen)` for the *current* gen (auth-routes.ts). Rotating bumps `gen` but leaves `recovery_email` untouched.
   - So after the reader rotates, whoever set the new recovery email can recover the new admin key. With `rotate: true` they can also revoke the reader's key and lock the reader out, all before the reader gets to step two.
   - **Fix direction:** reverse the steps. First set the recovery email back to this address, which needs the admin key the reader still holds. Then run `solenoid rotate --admin --yes` straight away. Say why the order matters in a few words.
2. **Email 4: "then set your recovery email again."** Nothing in the shipped clients does this. The CLI has no email command (`HELP` in commands.ts), and the only path is a raw `POST /auth/email`.
   - **Fix direction:** name the exact command or MCP tool this plan ships for attaching an email. If the plan ships none, name the endpoint.

Everything else checked out against the code:
- "It works once, within 15 minutes": `CODE_TTL_MS` is 15 minutes, and `#redeem` deletes a code when it is used.
- "Recovery asks for the account ID": `authRecover` requires `tenant`.
- "This address can now recover the admin key": `recoverStart` and `recoverFinish` check `recovery_email`.
- "Someone with the account's admin key set a different one": `attachVerify` needs admin auth, and `changedMail` goes only to a different previous address.
- `solenoid rotate --admin --yes` exists and revokes the admin key and every spend key.

Two true-but-partial points feed findings 3 and 6:
- The code can also stop working early. It is refused after 5 failed attempts in an hour or 10 in a day, and it drops out once 3 newer codes are live.
- Entering a recover code without `rotate` changes nothing on the account, but it does hand over the admin key.

### V4 (AI tells)

Clean in all three runs. There are no em or en dashes, no "not X, it's Y" lines, no rhythm tricolons and no banned words.

### Findings, most severe first

1. **HIGH C2 (3/3), Email 4.** "Rotate it with `solenoid rotate --admin --yes`, then set your recovery email again."
   - The email never says what rotating does: a new admin key is printed and saved, every old admin and spend key fails at once, and every spend key has to be re-derived and redeployed.
   - `--yes` skips the CLI's own warning that says all of this.
   - There is no route for a reader whose key the other party has already rotated.
   - **Principle:** Kennedy. The reader must be able to say what happens next from the page alone.
   - **Fix direction:** add one sentence on the consequence (all spend keys stop working; re-derive them with `solenoid key <scope>`). Add one line for the locked-out case. Both come on top of the Gate 0 reorder.
2. **MED C2 (run 1), Email 4.** Step two has no command or location. This is the same defect as Gate 0 item 2, and the same fix closes both.
3. **MED H1 (2/3; run 2 filed it as H4), Emails 1 and 2.** Both subjects read "Your Solenoid code: 042917".
   - The two codes unlock different actions, and the inbox shows them identically. An admin-key recovery code the reader never asked for is the one that matters most, and the subject doesn't show it.
   - **Principle:** Caples and Ogilvy. The headline carries the specific result, not the category.
   - **Fix direction:** keep the code in the subject and name the action, e.g. "042917 is your Solenoid admin key recovery code". For Email 2, consider a line saying an unrequested recovery code means someone knows this address and the account ID.
4. **LOW C2 (3/3), Emails 1 and 2.** "It works once, within 15 minutes."
   - Neither email says where the code goes or what follows it. Email 1 doesn't mention the confirmation email. Email 2 doesn't say the reader gets the admin key back and can choose to rotate it.
   - **Principle:** Kennedy.
   - **Fix direction:** add a short clause on where to enter the code and what comes back. Keep it short, because the reader is usually at the prompt already.
5. **LOW C2 (run 3), Email 3.** "Keep this email. Recovery asks for the account ID, abcdefghijkl, and this is where you will find it."
   - The email is written for the day the key is lost, but it doesn't say how to start recovery.
   - **Fix direction:** name the recovery command, tool or endpoint next to the account ID.
6. **LOW V3 (2/3), Email 4.** The sentences run 12, 10, 10 and 13 words, so there is no short line to land the warning.
   - **Principle:** Sugarman on rhythm.
   - **Fix direction:** give "the admin key may have leaked" a short sentence of its own. The reorder rewrite will probably handle this anyway.

### Unstable (not findings)

H3 (1/3), H4 (1/3), P1 (1/3).
- H3 is Email 2 not saying what "recover the admin key" changes (key shown again, or a new key issued). The truth check backs this up, so fold it into finding 4.
- P1 is Email 4 giving no timestamp for the change.

### Out of scope, noticed

`cli/src/commands.ts` (the rotate outage error) still says "account recovery does not exist yet". Once recovery ships, that contradicts Email 3.

## Round 2 (Gate 0 + V4 recheck), 2026-09-28

Cold recheck against `.superpowers/sdd/2026-09-28-solenoid-recovery-mcp/emails-draft-2.md` (rendered from the current `worker/src/mail.ts`), Gate 0 and V4 only, graded directly (no grader dispatch, fixtures untouched). Truth sources: `worker/src/core.ts`, `worker/src/codes.ts`, cross-checked against `worker/src/auth-routes.ts` for the endpoints and `cli/src/commands.ts` for the shipped `rotate`/`key` syntax. The plan's Task 4 CLI surface (`solenoid email <address> [code]`, `solenoid recover <email> [code] [--tenant id] [--rotate]`, `solenoid key <scope>`) is taken as shipping in this release, per the plan.

**Gate 0: PASS**

1. **Order, fixed.** Email 4 now reads: "First, set this address again while your admin key still works: run `solenoid email robin@example.com`, then `solenoid email robin@example.com <code>` with the code it sends. This comes first because whoever holds the recovery email can recover even a rotated admin key." Then: "Then run `solenoid rotate --admin --yes`." Verified against `core.ts`: `put()` (the rotate path) bumps `gen` and never touches `recovery_email`; `recoverFinish` returns `adminKey(master, tenant, gen)` for whatever `gen` is current at the time recovery runs. So a rotation alone doesn't cut off the recovery-email holder, and re-securing the recovery email before rotating is the only order that closes the hole. The stated reason matches the mechanism.
2. **Missing command, fixed.** Email 4 now names `solenoid email <address> [code]`, matching the shipped syntax exactly (bare address to request a code, address plus code to redeem it). `attachVerify`/`attachStart` both require admin auth (`#authorize(auth, '', 'admin')`), consistent with "while your admin key still works."

Every other checkable claim across all four drafts also holds against `core.ts`/`codes.ts`:
- 15-minute, one-time code (`CODE_TTL_MS`, `#redeem` deletes on hit).
- Confirmation email always follows a successful attach verify (`later(io, io.mail(confirmMail(...)))` unconditional on success).
- Recover code email 2 is sent only when the recipient already is `recovery_email` (`recoverStart` returns `code: null`, no mail, otherwise) — supports "someone knows this address and the account ID."
- `--rotate` on recover bumps `gen`; the gen check in `#authorize` runs before the admin/spend branch, so it invalidates old admin and spend keys alike — supports "every old admin and spend key stops working" in both Email 2 and Email 4.
- Email 3's `solenoid recover <email> --tenant <id>` and Email 4's `solenoid key <scope>` both match the shipped CLI syntax (`<scope>` is the same placeholder convention `commands.ts`'s own `HELP` text uses).
- Email 4's closing line ("this address can no longer recover it" without the admin key) holds: the old address is no longer `recovery_email` (already changed) and can't call `attachVerify` without admin auth, so no path back exists.

**V4: PASS**

- No em or en dashes in any of the four rendered emails (checked by codepoint scan of the draft's email blocks; the one en dash in the file sits in the unrelated "Results" section, not in a rendered email).
- No "X, not Y" construction in any email (regex scan of the four blocks, no match).
- No AI-tell phrasing (no "unlock", "leverage", "seamless", "dive into", "in today's", "it's important to note", "game-changing", etc.) in any of the four emails.
