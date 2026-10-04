# Grade: MCP server copy (tool descriptions, schema descriptions, startup errors)

Medium: MCP tool and schema descriptions, read by a model choosing a tool and filling its arguments, plus startup errors on stderr. Jurisdiction: global; seller in New Zealand. Not the closing unit (O1, O3, O4, C3 n/a).
Draft: `.superpowers/sdd/2026-09-28-solenoid-recovery-mcp/mcp-copy-draft.md`, the "Copy for the gate" block. The trailing note about tests was left out of the grader prompt.

## Round 1 (2026-09-28): PASS-WITH-FINDINGS

Three cold `copy-grader` runs, each a plain subagent with the draft inline. The guard was live-tested first: a plain grader asked to read `fixtures/planted-key.md` got the guard's "blocked" message.

Tally: `FINDINGS: V1,C1,C2` / `UNSTABLE: H1 (1/3), H3 (1/3), P1 (1/3)` / `GATE0: CLEAR (0/3 runs)`.

- **Gate 0:** CLEAR in all three runs. Every claim is first-party ("50 at a time", `sk.spend.`, the commands). No citations, so the source checker was not dispatched.
- **V4:** clean in all three runs. No em or en dashes, no lexical or structural tells, and the four-item lists are real lists.

### Truth check against the code (controller, not the grader)

Checked against `mcp/src/tools.ts`, `mcp/src/main.ts`, `sdk/src/index.ts`, and the Worker they call (`worker/src/core.ts`, `http.ts`, `windows.ts`, `amounts.ts`).

True as written:
- `log`: 50 per page (`PAGE = 50`), newest first (`ORDER BY seq DESC`), "at a scope and below" (`UNDER`). The entry kinds are exactly spend, settle, limit and rotate, and "key rotations" also covers admin rotation, which is sealed as `rotate`.
- `log.before`: `seq < before`, and `next` is the last seq on the page.
- `set_limit` "replaced whole": the Worker upserts the whole row (`amount, per, on_outage, warn_at` all come from this call). The claim is true but incomplete; see finding 1.
- `rotate` returns a new key: `deriveKey(scope, v.epoch)` runs on the view after the epoch bump.
- Startup errors: the credentials path matches the CLI's, `solenoid init` and `solenoid login <admin-key>` exist (the bin is named `solenoid`), and `bin.ts` adds the `solenoid-mcp: ` prefix.

### Findings

Majority checks are C2, C1 and V1. The wording follows the lowest-numbered run that fired each one, and the direction is checked against the code. Frozen strings (the tool names, argument names, `"before" must be a positive integer`, `solenoid login` and `--admin`) stay as they are in every direction below.

1. **C2, high.** `set_limit`: "Each unit named here is replaced whole, including its window and outage mode." and `set_limit.limits`: "For example {"emails": 3, "usd": null}."
   - What fails (run 1): a model that sends `{"emails": 3}` cannot tell from the copy what the window and outage mode become, and it sees no way to set them.
   - Code: the schema already takes `per`, `on_outage` and `warn_at`, but the draft gives them no descriptions. When one is omitted it resets: `per` to null (no window, so a running total that never resets), `on_outage` to `closed`, and `warn_at` to none. One call's values apply to every unit in that call. The sentence also leaves out `warn_at`, which is replaced too.
   - Direction: describe `per`, `on_outage` and `warn_at` in the schema. In the tool description, say that anything left out resets to its default, and name the defaults (no window, closed, no warning), so a model changing one number knows to pass the existing settings back. `get` shows the current ones.
   - Principle: Kennedy. After following the instruction, the reader can say what happens.

2. **C2, medium.** "Map each unit to a number" / `{"emails": 3, "usd": null}`.
   - What fails (run 1): what the number means, and which units exist.
   - Code: a unit is any name matching `^[a-z][a-z0-9_]{0,31}$`. `spends` is reserved and refused (403 `plan_owned`). The number is the cap per window, in the unit's own terms (`usd` in dollars, resolved to millionths). It may be 0.
   - Direction: add to `limits`: "Units are lowercase names you choose, such as emails or usd (dollars). The number is the cap per window; 0 blocks the action. spends is reserved." Optionally point the model to `get` first, to see the existing limits.
   - Principle: Kennedy, unambiguous instructions.

3. **C2, medium.** `rotate`: "Revoke every spend key derived for a scope, and return a new one. Every deployed copy of the old key fails from now on."
   - What fails (run 1): "every spend key" and then "the old key" leaves unclear how many keys are affected, and whether child scopes are included. This is the one irreversible tool.
   - Code: epochs are per exact scope (`epochs` table; `#authorize` compares against `epochOf(auth.keyScope)`). So rotating `acme` revokes keys derived for `acme` itself, which could act on `acme/bot` too. Keys derived for `acme/bot` keep working. The result is `{scope, key}`.
   - Direction: say it revokes the spend key for exactly this scope, that keys derived for its child scopes keep working (rotate each one separately), and that the returned key must be deployed in the old key's place.
   - Principle: Kennedy; Hopkins, specific over general (run 2's P1 made the same point).

4. **C2, medium.** "set SOLENOID_KEY to a spend key (sk.spend.…)."
   - What fails (run 1): the developer isn't told where to get a spend key.
   - Code: `solenoid key <scope>` prints one, and `solenoid init <scope>` writes one to `.env`. This error also fires when SOLENOID_KEY holds an admin key (`sk.admin.`), because only the `sk.spend.` prefix is accepted.
   - Direction: add "get one with `solenoid key <scope>`". Say that an admin key in SOLENOID_KEY is refused, and keep the existing `--admin` clause.
   - Principle: Kennedy.

5. **C1, low to medium.** "…which is missing or unreadable. run `solenoid init` or `solenoid login <admin-key>` first."
   - What fails (run 1): two commands with no condition for choosing between them. "Unreadable" also covers a permissions problem and malformed JSON (`JSON.parse` failing lands in the same catch), and neither command obviously fixes those.
   - Direction: key each command to its situation, for example "run `solenoid init` to create an account, or `solenoid login <admin-key>` if you already have one". For the unreadable case, say to check that the file is readable and is valid JSON.
   - Principle: one call to action; when there are two, the reader is told which one applies.

6. **V1, low.** "outage mode" and "window" (in `get` and `set_limit`).
   - What fails (run 1): neither term is defined anywhere in the copy.
   - Direction: define each once where it is set. The window is `per` (hour, day, week, month, child, child-day, or none for a running total). The outage mode is `on_outage`: open lets actions through while Solenoid is unreachable, and closed refuses them. The descriptions from finding 1 can carry both definitions.
   - Principle: concrete over abstract.

7. **C2, low.** "invalid request" and "unsupported protocol version" (run 1).
   - Code: the version error already sends `data: { supported, requested }`, and both strings are standard JSON-RPC wording.
   - Direction: accept, or append the supported list to the message text. Nothing else needed.

Controller-only notes. The grader couldn't see these, because the facts behind them live in the code:

8. **`get`: "with its amount, window, usage and what is left".** A per-child limit (`per: child` or `child-day`) set on the scope itself comes back with `used`, `left` and `resets` as null, because its usage lives on each child. Direction: add "a per-child limit shows its usage on each child".
9. **`scope` schema.** With a spend key, `get` and `log` outside the key's scope fail with 403 `out_of_scope`. Direction: "With a spend key, use the key's own scope or one below it."
10. **`log.before`.** `next` is null on the last page. Direction: "When next is null, there are no older entries."

Not a finding: run 3 said no description says which tools need the admin key. `set_limit` and `rotate` are only registered with `--admin` (`if (!admin) return read`), so a model on a spend key never sees them.

### Unstable (1/3, not findings)
H1 (1/3, `get` and `log` as bare category names), H3 (1/3, the same unpaid "replaced whole" consequence as finding 1), P1 (1/3, the same rotate scope vagueness as finding 3).
