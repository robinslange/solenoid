# Grade: recovery and MCP developer docs

Drafts: the delta in `.superpowers/sdd/2026-09-28-solenoid-recovery-mcp/docs-delta.md`, graded as four separate drafts:

1. `README.md` Deploy, the whole section (lines 5 to 32), because the additions interleave with the steps they change.
2. `sdk/README.md`: the added credentials bullet, Recovery section, error-table sentence, two testing rows and the recovery test.
3. `sdk/llms.txt`: the added lines and the Recovery and Testing additions.
4. `mcp/README.md`, the whole new file.

Jurisdiction: New Zealand. None is the closing unit, so O1, O3, O4 and C3 are n/a in every run.

Method (2026-09-28):
- Live guard test first. A plain `copy-grader` was asked to read `fixtures/planted-key.md` and got the guard's "blocked" message.
- Three cold `copy-grader` runs per draft: plain subagents, draft inline, medium, jurisdiction and closing-unit lines only. The runs were tallied with `tally.py`, and it exited 0 for all four drafts.
- `copy-source-checker` ran on the third-party claims in the Deploy and MCP drafts. The SDK README and llms.txt additions cite nothing new.
- The truth check against the code is the controller's, not the grader's.

Run files: the session scratchpad, `copy-chief/recovery-mcp/<draft>/run{1,2,3}.md`.

## Summary

| Draft | Verdict | Findings (≥2/3) | Unstable (1/3) | Gate 0 | V4 |
|---|---|---|---|---|---|
| README Deploy | PASS-WITH-FINDINGS | C2, H3, H4, V1, P3 | H1, P2 | CLEAR 0/3 | clean 3/3 |
| SDK README | PASS-WITH-FINDINGS | C2, P1 | H1, H3, P3, V1 | CLEAR 0/3 | clean 3/3 |
| llms.txt | PASS-WITH-FINDINGS | C2, V2 | P1, P2, P3, V1 | CLEAR 0/3 | clean 3/3 |
| MCP README | **BLOCKED** | C2, H3, V1, H1, H2 | none | BLOCKED 3/3, plus 1 DOES NOT SUPPORT | clean 3/3 |

**V4.** No run fired it on any draft: no em or en dashes, no "it's not X, it's Y" closer, no padded tricolon.

One voice note sits outside V4. The copy brief bans "X, not Y" constructions, and two of them survive:
- `sdk/README.md:139`: "It is a `SolenoidError`, not an outage."
- `sdk/llms.txt:80`: "…call sendEmailCode again; not an outage".

All three SDK runs read the README one as a needed distinction, not a closer. The brief's rule is stricter than V4. Fix direction: "It is a `SolenoidError`, so it is thrown, not retried as an outage" still has the shape. A better one is "It throws `SolenoidError`; only an unreachable server throws `Outage`."

---

## 1. README Deploy: PASS-WITH-FINDINGS

**Gate 0:** CLEAR in all three runs. The graders read 1Password, Resend and wrangler as tools the operator runs, not claims about them.

**Sources.** Links are not required for Gate 0 here, but the brief asks for them. Checked and supported:
- `wrangler secret put` reads piped input. https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret-put: "The `put` command can also receive piped input." Checker note: "`wrangler secret put` creates a new version of the Worker and deploys it immediately" (https://developers.cloudflare.com/workers/configuration/secrets/), and `wrangler deploy` fails if a `secrets` property is declared and unset. `worker/wrangler.jsonc` declares none, so the deploy-then-put order holds.
- `wrangler deploy`: same page, #deploy, "Deploy your Worker to Cloudflare."
- Resend sends with a Bearer key. https://resend.com/docs/api-reference/emails/send-email: `POST https://api.resend.com/emails`, `Authorization: Bearer re_…`. This matches `worker/src/mail.ts:9-13`.
- `op read`: https://developer.1password.com/docs/cli/reference/commands/read now 301s to https://www.1password.dev/cli/reference/commands/read. Checker note: `op read` prints a trailing newline, and `-n`/`--no-newline` is the documented way to drop it. `tr -d '\n'` also strips interior newlines. That is harmless for these single-line values.

**Findings**

1. **C2 (3/3), high. The first-deploy order can't be followed.** `README.md:30` ("When you first deploy a Worker that serves `/auth/recover`, run this step before step 2") conflicts with `README.md:21` ("the ops tenant exists after the first signup").
   - Code confirms it. `login` calls `get('')`, and `#authorize` returns `invalid_key` while the tenant has no `tenant` meta (`worker/src/core.ts`, `#authorize`). The ops tenant is created only by `perIp` → `ops.init` on the first signup or recovery request (`worker/src/ops.ts:16-17`).
   - So on a fresh install, step 3 cannot run before step 2. The sentence only works when upgrading a Worker that already has an ops tenant.
   - Fix direction: split the two cases. On an upgrade, run step 3 against the running Worker before deploying. On a fresh install, recovery is unlimited from the deploy until step 3 runs after the first signup. Say that, or do one signup yourself first.
   - The ordering belongs above step 2 (see finding 3).
2. **C2 (3/3), high. The new `op read …/RESEND_API_KEY` line reads a field no step creates.** `README.md:18` against step 1 at `README.md:12`.
   - `worker/scripts/gen-secrets.mjs:4` emits only `MASTER` and `SIGNING_KEY`.
   - Fix direction: add a step that creates a Resend API key and stores it, e.g. `op item edit 'Solenoid Worker secrets' 'RESEND_API_KEY[concealed]=…'`. Link Resend's API-key page.
   - Also check and state (with a Resend link) that `MAIL_FROM`'s domain, `solenoid.systems`, must be verified in Resend. Otherwise every send fails the same way a missing key does.
3. **C2, other items raised by the runs (pre-existing lines, noted because the new steps depend on them).**
   - Step 1's `node -e '<wrap as a SECURE_NOTE template…>'` is a placeholder, not a command (`README.md:12`, 3/3).
   - Step 1 is not marked one-time. Rerunning it mints a second `MASTER` (`README.md:11`, run 2).
   - Step 3's `login` target is unstated (`README.md:25`, runs 2 and 3). Code: the CLI sends to `SOLENOID_API` or `https://api.solenoid.systems` (`cli/src/config.ts:21`). `README.md:7` says the Worker runs on workers.dev "until `api.solenoid.systems` moves to it", while `wrangler.jsonc` already routes `api.solenoid.systems`.
   - Fix direction: make line 7 true, or export `SOLENOID_API` in step 3.
4. **H3 (3/3), medium. "Nothing is written to disk." (`README.md:9`) is broken by step 3.** `export SOLENOID_CONFIG_DIR=$(mktemp -d)` plus `login "$OPS"` (`README.md:24-25`) writes the ops admin key to a temp directory that is never removed. Fix direction: end step 3 with `rm -rf "$SOLENOID_CONFIG_DIR"`, or qualify line 9.
5. **H4 (3/3), medium. Preconditions sit after the steps they govern.** The "before step 2" instruction is at the end of step 3 (`README.md:30`). The `MASTER` warning is the section's last line (`README.md:32`). A runbook is executed in reading order. Fix direction: put the upgrade ordering at the head of Deploy or of step 2.
6. **V1 (3/3), low to medium. `--per child-day`, the `/` scope and "ops tenant" are not glossed for the signup lines.** `README.md:26-27`. Only the new recoveries line is glossed (`README.md:30`). Fix direction: gloss them the same way. "5 signups per UTC day from each IPv4 address or IPv6 /64; 1,000 signups per UTC day in total" matches `ops.ts:8-19` and `windows.ts:13`.
7. **P3 (2/3), low. "Losing `MASTER` invalidates every key ever issued."** `README.md:32` gives no mechanism. Fix direction: "every key is derived from `MASTER`" (`auth-routes.ts:70`, `adminKey(master, …)`), and say that the 1Password item is the only copy.

**Unstable.** H1 (1/3). P2 (1/3): run 1 notes that the "no global recovery cap, because one actor could switch recovery off" reasoning (`README.md:30`) applies equally to the global `signups=1000` cap (`README.md:27`), and the draft doesn't say why signup accepts that risk.

**Truth check against the code (controller).**

True:
- The `502 email_failed` from `/auth/email` without the key (`mail.ts:8`, `auth-routes.ts:39-44`).
- `MAIL_FROM` is a var (`wrangler.jsonc`).
- 20 `/auth/recover` requests per UTC day per IPv4 or IPv6 /64. `ipKey` keeps 4 groups, and `child-day` is a UTC calendar day (`ops.ts:8-19`, `windows.ts:13`).
- Both `requestRecovery` and `recover` count, since both hit `/auth/recover`.
- There is no global cap.

Missing: without the key, recovery codes, confirmations and change notices also fail, silently. `requestRecovery` still answers 202 (`auth-routes.ts:29,65`). An operator debugging "no code arrived" needs that sentence.

---

## 2. SDK README additions: PASS-WITH-FINDINGS

**Gate 0:** CLEAR in all three runs. No citations.

**Findings**

1. **C2 (3/3), high. Attaching is given as one command where it takes two.**
   - `sdk/README.md:22`: "Attach a recovery email now with `npx @solenoid.systems/cli email <address>`".
   - `sdk/README.md:129`, leak step 1: "Set your own address again with `npx @solenoid.systems/cli email <your address>`".
   - Code: the first run only sends a code, and the second, `email <address> <code>`, attaches (`cli/src/commands.ts`, case `'email'`).
   - In the leak procedure the reader rotates while the other person's address is still attached. The draft itself says that address "can recover even a rotated admin key".
   - Fix direction: give both commands in both places. At `:22` you can also mention `init --email <address>`.
2. **C2 (runs 1 and 3), medium. No branch for "the admin key already stopped working".** `sdk/README.md:127-130`.
   - The change notice itself says "If you no longer have the admin key, this address can no longer recover it" (`worker/src/mail.ts:60`). The README should say the same plainly, and say what is left (a new account with `init --force`).
   - Also, no change notice is sent when there was no previous recovery email (`auth-routes.ts:50`).
3. **C2 (runs 1 and 3), medium. The CLI `recover` outcome is unstated.** `sdk/README.md:122,125`.
   - Code: it prints the admin key and saves it to the credentials file with the `SOLENOID_API`/default API.
   - It refuses without `--force` if the saved key belongs to another account (`commands.ts`, case `'recover'`).
   - Fix direction: one sentence covering those three facts.
4. **C2 (run 1), low. Where `{ rotate: true }` goes is not shown.** `sdk/README.md:105`. Fix direction: `recover(tenant, email, code, { rotate: true })`.
5. **C2 (run 2) / V1 (run 3), low. "The two emails after `verifyEmail` are the attach code and the confirmation."** (`sdk/README.md:475`). The attach code went out before `verifyEmail`. Fix direction: "After `verifyEmail` the outbox holds two emails: the attach code and the confirmation."
6. **P1 (2/3), low. The only unnumbered limit.** "too many recovery requests today" (`sdk/README.md:107`, `:138`). Fix direction: state the hosted figure, 20 per UTC day from one IPv4 address or IPv6 /64 (`README.md:28-30`). "Today" is correct: it is the UTC calendar day (`windows.ts:13`), unlike the rolling hour and day of the code limits.

**Unstable.**
- H1 (1/3).
- H3 (1/3): CLI recover output, the same as finding 3.
- P3 (1/3): no reason given for a wrong code counting once per live code. Three live codes and two typos lock the address for an hour.
- V1 (1/3).

**Truth check against the code (controller).**

True:
- 6 digits, one use, 15 minutes (`codes.ts:4,12`; `core.ts` `#redeem` deletes on hit).
- 5 sends an hour per address, 10 attach sends a day per account, 3 live codes (`core.ts` `#countSend`, `#storeCode`).
- `requestRecovery` resolves for a non-recovery address and when throttled (`core.ts` `recoverStart`; `auth-routes.ts:64-66` ignores the failure).
- Its only 429 is `perIp` (`auth-routes.ts:56-57`).
- `verifyEmail` returns `{ tenant, email }`, mails a confirmation naming the account, and mails the old address on change (`auth-routes.ts:49-51`, `mail.ts:43-62`).
- Trim and lowercase (`codes.ts:17`).
- `rotate` bumps `gen`, so every admin and spend key fails (`core.ts` `recoverFinish`, `#authorize` checks `gen` before the key kind).
- `api` → `SOLENOID_API` → default (`sdk/src/index.ts:58`). No retry: a POST without an idempotency key is not retried (`http.ts`). The failure throws `Outage`, which is exported.
- `email_failed` is a `SolenoidError`, not `Outage` (`index.ts:69`, `http.ts`).
- `outbox()` waits for in-flight sends and `mailDown` drops sends (`testing.ts:67-84`). The test's outbox counts (2, then the recovery code last) follow from `auth-routes.ts`.
- The CLI tenant precedence: `--tenant`, `SOLENOID_KEY`, `./.env`, credentials (`commands.ts:23-27`). It never uses the saved API (`apiBase()`).

Imprecise:
- T1. The lockout is per address **and purpose**. `#redeem` counts fails with `purpose = ?`, so wrong attach codes don't lock recovery checks. "every check for that address fails" (`sdk/README.md:114`, `sdk/llms.txt:77`) overstates it. Fix direction: "every check of that kind (attach or recovery) for that address". The 3-live-codes rule is per purpose too.
- T2. "A wrong code counts once for each code that is still live". With none live it still counts once (`Math.max(1, checked)`). Low.
- T3. The 5-an-hour count pools attach and recovery sends for the address. It includes `requestRecovery` calls for an address that isn't the recovery email, because `#countSend` runs before the email check. The known-risk paragraph is consistent with this. Adding "attach and recovery together" would make it exact.
- T4. The error table (`sdk/README.md:134-140`) reads as complete but omits two errors:
  - `invalid_request` (400) for a malformed account ID or `rotate` (`auth-routes.ts:58,61`).
  - `invalid_key` (401) for `sendEmailCode`/`verifyEmail` with a revoked admin key.
  Fix direction: add both rows.

---

## 3. llms.txt additions: PASS-WITH-FINDINGS

**Gate 0:** CLEAR in all three runs. No citations.

**Findings**

1. **C2 (3/3), high. The leaked-key line gives half of the attach.** `sdk/llms.txt:78`: "first set your own address again with npx @solenoid.systems/cli email <address> …". It is the same defect as SDK finding 1. Fix direction: "email <address>, then email <address> <code>".
2. **V2 (3/3), medium to high. "You" shifts from the coding agent to the developer.**
   - `sdk/llms.txt:72` says the job is "never by the agent" and addresses the agent as "you".
   - `sdk/llms.txt:78` then gives "your own address … rotate --admin --yes" as direct commands.
   - `sdk/llms.txt:9` talks about "the agent" in the third person.
   - Run 2 notes that an agent can take `:78` as its own instruction to run a destructive `rotate --admin --yes`.
   - Fix direction: frame `:78` as "Tell the developer to: …".
3. **C2 (run 2), medium. The intro says recovery is "done with the admin key" (`sdk/llms.txt:72`), but recover takes no key (`:74`).** Fix direction: "Attaching needs the admin key; recovering needs only the account ID and the address."
4. **C2 (runs 1 and 2), low. Which limit throws is unclear.** In "(sendEmailCode then throws rate_limited, 429)" (`sdk/llms.txt:77`), the parenthesis could cover one limit or both. Code: `sendEmailCode` throws on both the 5-an-hour and the 10-a-day limit (`#countSend`), and `requestRecovery` throws on neither. Fix direction: "sendEmailCode throws rate_limited (429) past either".
5. **C2 (run 3), low. The CLI `recover` output is unstated** (`sdk/llms.txt:75`). Same fix as SDK finding 3.

**Unstable.**
- P1 (1/3): the network limit has no number, `:76`.
- P2 (1/3): the separate-OS-user advice has no reason, `:9`.
- P3 (1/3).
- V1 (1/3): the lockout arithmetic, `:77`.

**Truth check.** The same code facts as the SDK README. T1 (lockout per purpose), T2 and T4 apply to `sdk/llms.txt:77` and `:80`. `testServer()` returning `outbox, mailDown` matches `testing.ts:14-15,83-84`.

---

## 4. MCP README: BLOCKED

**Gate 0** (union of the three runs; every run blocked):

1. `mcp/README.md:56`: "It serves MCP protocol `2026-07-28` through `server/discover`, with the version in `_meta`, and the older `2025-11-25` and `2025-06-18` through `initialize`."
   - Unsourced, and the source checker returned **DOES NOT SUPPORT (as worded)**.
   - The spec says 2026-07-28 has "no negotiation handshake. Every request carries its protocol version" in `_meta`, and `server/discover` is only how a server advertises its versions. Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle.
   - The code does exactly what the spec says. It reads the version from each request's `_meta` (`mcp/src/protocol.ts:28-29`), answers `server/discover` with `supportedVersions` (`:35-36`), and serves the legacy versions via `initialize` (`:31-33`).
   - Fix direction: "It serves MCP `2026-07-28` statelessly, reading the version from each request's `_meta`, and answers `server/discover` with the versions it supports. It serves `2025-11-25` and `2025-06-18` after `initialize`."
   - Link https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle, plus the 2025-11-25 and 2025-06-18 lifecycle pages. Those two SUPPORT the `initialize` half: "The client **MUST** initiate this phase by sending an `initialize` request".
2. `mcp/README.md:12,20`: the `claude mcp add … -e SOLENOID_KEY=… -- npx -y …` syntax. Unsourced, but the checker found it **SUPPORTS**. https://code.claude.com/docs/en/mcp: "Pass any environment variables … with `--env`, after the server name and before `--`". Its note: keep the name before `-e`, because "If the server name comes directly after `--env`, the CLI reads the name as another pair and rejects it". Linking that page clears this item.
3. `mcp/README.md:25-37`: `claude_desktop_config.json` and the `mcpServers` / `command` / `args` / `env` shape. Unsourced, but the checker found it **SUPPORTS**. https://modelcontextprotocol.io/docs/develop/connect-local-servers gives the file paths `~/Library/Application Support/Claude/claude_desktop_config.json` and `%APPDATA%\Claude\claude_desktop_config.json`, and an `env` key beside `command`/`args`. Linking it clears this item.

The checker also confirmed "It writes only JSON-RPC to stdout" against the stdio rule "The server **MUST NOT** write anything to its `stdout` that is not a valid MCP message" (https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio). Its note: under 2026-07-28 the server "MUST NOT write JSON-RPC *requests*", which the server never does.

**Findings**

1. **C2 (3/3), high. Setup and use instructions.**
   - The setup sentence "To read one scope with its spend key, the key `solenoid key <scope>` prints:" (`mcp/README.md:9`) is a garden path. Fix direction: "Get a spend key with `solenoid key <scope>`, then:".
   - Nothing says what success looks like, or a first question to ask the assistant.
   - Both commands register the same name `solenoid` (`:12`, `:20`), and the draft doesn't say whether they can coexist. Fix direction: use distinct names such as `solenoid` and `solenoid-admin`, or say that one replaces the other.
   - Run 2: "add `--admin` to Claude Code" (`:20`) against "never `--admin`" for a governed agent (`:52`), with no rule for telling your assistant from the governed agent. Fix direction: one sentence saying the admin server goes only in a client that isn't itself calling Solenoid under limits.
   - Run 3: `rotate` doesn't say that the old key fails at once and the returned key must be redeployed (`:48`). The tool description already says so (`tools.ts:62`). Carry it into the table.
2. **H3 (3/3), medium. "what the agent spent in the last hour" (`mcp/README.md:3`) is never paid off.**
   - `log` has no time filter (`tools.ts:22-29`), and `get` shows usage only for windowed limits.
   - "Signed receipts" becomes "signed entries" (`:46`).
   - Fix direction: pick an example `get` answers directly, such as "how many emails a conversation has left today", or say that the assistant sums the timestamped `log` entries. Use one noun for receipts.
3. **V1 (3/3), medium. "Scope" and "unit" are never pictured.** See `mcp/README.md:15` and `:47`. Fix direction: one sentence with a scope such as `support/conv-123` and a unit such as `emails`, tied to the opening example.
4. **H2 (2/3), medium. The first sentence is ambiguous.** In "An MCP server for Solenoid, which limits what an agent does when its tools call Solenoid before they act." (`mcp/README.md:3`), "which" can attach to the server or to Solenoid, and the time clauses stack. Fix direction: split it. "Solenoid limits what an agent does: its tools call Solenoid before they act. This server lets your assistant read those limits…"
5. **H1 (3/3), low. The title is the package name** (`mcp/README.md:1`). This is conventional for npm, and every run rated it low. You can accept it.

**Unstable:** none.

**Truth check against the code (controller).**

True:
- A spend key is required without `--admin`, and an admin key is refused there (`mcp/src/main.ts:24-27`).
- `--admin` reads the key and API from `$SOLENOID_CONFIG_DIR/credentials` or `~/.config/solenoid/credentials`, and needs `sk.admin.` (`main.ts:11-22`).
- `SOLENOID_API` in spend mode (`main.ts:28`).
- stderr plus exit code 1 on start failure (`bin.ts`).
- No runtime dependencies: the package bundles the SDK with esbuild and has only `devDependencies`. `engines.node >=20`.
- The `get`/`log`/`set_limit`/`rotate` behaviour, 50 per page, newest first, `before`, and the refused control names (`tools.ts:9,37-68`).

Omissions (low):
- `set_limit` also reserves `spends`. The server answers 403 `plan_owned` (`tools.ts:40`, `core.ts:144`).
- `set_limit` resets any of `per`/`on_outage`/`warn_at` left out (`tools.ts:37`). The tool description tells the model, but the README's one-line summary doesn't warn the human.

---

## Round 2 (Gate 0 + V4 recheck)

Scope: Gate 0 and V4 only, on the four targets as committed at `e6ae731` (unchanged in the working tree). Graded directly by one cold checker, not three `copy-grader` runs, so there is no tally. Links were fetched on 2026-09-28 and each quote below is the source's own sentence. First-party claims were checked against `worker/src`, `sdk/src`, `cli/src` and `mcp/src`.

### Round 1 Gate 0 items: all fixed

1. **Handshake sentence** (`mcp/README.md:58`). It now reads "serves MCP `2026-07-28` statelessly, reading the version from each request's `_meta`, and answers `server/discover` with the versions it supports", with links. SUPPORTS. The versioning page says: "There is no negotiation handshake. Every request carries its protocol version, and the server accepts or rejects each request independently", and "A request carrying modern per-request `_meta` is served statelessly according to this revision." The 2025-11-25 and 2025-06-18 lifecycle pages both say: "The client **MUST** initiate this phase by sending an `initialize` request". The code matches: `mcp/src/protocol.ts:28-29,31-36`.
2. **`claude mcp add`** (`mcp/README.md:11-14,22`). Now linked. SUPPORTS. https://code.claude.com/docs/en/mcp says: "Pass any environment variables the instructions ask for with `--env`, after the server name and before `--`", and "Set environment variables with `-e` or `--env` flags".
3. **Claude Desktop config** (`mcp/README.md:27-41`). Now linked. SUPPORTS. https://modelcontextprotocol.io/docs/develop/connect-local-servers gives "**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`" and "**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`", an `mcpServers` → `command`/`args` entry, and an `env` key in the same entry.

The stdio line (`mcp/README.md:58`) SUPPORTS: "The server **MUST NOT** write anything to its `stdout` that is not a valid MCP message." Resend (`README.md:18-19`) SUPPORTS: "You must add and verify at least one domain to send emails with Resend." The API-key reference lists `sending_access`: "Can only send emails."

### Gate 0: FAIL

1. **`README.md:11`, first-party: the upgrade path skips the Resend step, which step 3 depends on.**
   - The sentence "Steps 1 and 2 run once, on a fresh install. On an upgrade … run step 4 first … and then step 3" tells an upgrade to skip step 2.
   - Step 3 (`README.md:28`) runs `op read '…/RESEND_API_KEY'`, and only step 2 creates that field.
   - `RESEND_API_KEY` first appears in `e6f13b0`, which is this feature. So the production upgrade this runbook describes is the one that needs step 2, and followed as written, step 3 fails at `op read`.
   - Step 2's own heading says "Once only", with no "on a fresh install", so the two lines also disagree with each other.
   - Fix direction: "Step 1 runs once, on a fresh install. Step 2 runs once, before the first deploy that sends email, which includes this upgrade."
   - The rest of the ordering is true. The ops tenant is `solenoidops2` in both the old and the new code, and `ops-key.mjs:5` signs `admin:solenoidops2:1`. `child-day` exists before `e6f13b0` (`windows.ts`), so the running Worker accepts the limit. `perIp` (`ops.ts:15-21`) creates the ops tenant on the first signup or recovery request, and spends with no limit pass, so the fresh-install gap is described correctly.
2. **`README.md:25-28`, third-party, unlinked: wrangler.** `wrangler deploy` and `… | wrangler secret put NAME` rely on `secret put` reading piped input. The Deploy section has no wrangler link. The one at `README.md:66` sits in another section. The source SUPPORTS it: https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret-put says "The `put` command can also receive piped input." Linking it clears this item.
3. **`README.md:15,21,26-28,33`, third-party, unlinked: 1Password `op`.** These are `op item create --vault Personal -` from a JSON template on stdin, `op item edit '…' "RESEND_API_KEY[concealed]=$K"`, and `op read 'op://…'`. None is linked. The sources SUPPORT them:
   - https://www.1password.dev/cli/reference/management-commands/item says "You can also create an item from standard input using an item JSON template." Its assignment syntax is "[ section .] field [[ fieldType ]]= value".
   - https://www.1password.dev/cli/reference/commands/read says "Read the value of the field in 1Password specified by a secret reference."
   - The same item page warns: "Command arguments can be visible to other processes on your machine." Line 19 claims only that the key stays out of shell history, which is true. But `$K` does sit in `op`'s argv for the length of the call. Mention it if the line is meant to promise more.
   - Linking the two pages clears this item.
4. **`sdk/README.md:146` and `sdk/llms.txt:80`, first-party: "Only an unreachable server throws `Outage`" is false.**
   - `authPost` (`sdk/src/index.ts:69`) and `call` (`sdk/src/http.ts:18`) throw `Outage` for every status of 500 or above except `email_failed`. That includes the Worker's own `500 internal` (`worker/src/router.ts:82`) from a server that is reachable.
   - Fix direction: "A network failure, a timeout or any other 5xx throws `Outage`, and these calls are never retried."
   - "Never retried" is true: `authPost` makes one fetch, and `call` retries only GET or idempotency-keyed requests (`http.ts:21`).

**Checked and true** (no finding):
- Leak procedure (`sdk/README.md:127-132`, `llms.txt:78`). Attaching takes two runs: `email <addr>` sends the code and `email <addr> <code>` attaches (`cli/src/commands.ts`, `case 'email'`; `core.ts` `attachStart`/`attachVerify`). Re-attaching comes before rotating in both files.
- Why that order matters. `rotate --admin` bumps `gen` but leaves `recovery_email` alone, and `recoverFinish` returns the current `gen` (`core.ts:167,219-237`). So whoever holds the address can recover a rotated key. A rotated key fails `#authorize` with 401 `invalid_key` (`core.ts:346`), so step 1 fails as described.
- Recovery limit. The runbook's `limit recoveries recoveries=20 --per child-day` meets `perIp(…, 'recoveries')`, which spends 1 unit at `recoveries/<hash of ipKey>` (`ops.ts:18-19`). `ipKey` keeps an IPv4 address whole and keeps the first 4 groups of IPv6, which is the /64. Refusal is `used + amount > limit` (`core.ts:89`), so the 21st request is refused and "more than 20" is right. `authRecover` calls `perIp` for both the request and the finish (`auth-routes.ts:56`), so "`recover` counts toward the same 20" is true. `402` maps to `429 rate_limited`.
- Code rules. 5 sends an hour per address across both kinds, 10 attach sends a day, 3 live codes per kind, and failures counted once per live code or once when none is live, with 5 an hour or 10 a day per kind (`codes.ts:7-11`, `core.ts:302-332`). `requestRecovery` for another address counts a send (`recoverStart`), and throttling there still answers 202 (`auth-routes.ts:64-66`).
- Testing helpers. `outbox()` waits on the pending `waitUntil` sends and `mailDown` sets the mailer off (`testing.ts:67-84`).
- MCP README. The key rules, the credentials path, `SOLENOID_API`, the tools table (50 a page from `core.ts:39`, the refused control names, `plan_owned`, `rotate`'s single scope), exit code 1 on stderr, Node 20 and no runtime dependencies all match `mcp/src` and `mcp/package.json`.

### V4: FAIL (low)

No em or en dashes and no AI-tell lexicon in any target.

"X, not Y" constructions that remain:
1. **`sdk/llms.txt:72`: "Recovery is the developer's job, never the agent's."** This is the contrast shape with "never" in place of "not", and the second half restates the first. Fix direction: "Only the developer recovers an account. Attaching an address needs…", or fold it into the next sentence.
2. **`sdk/llms.txt:75`: "It sends to SOLENOID_API if set, else https://api.solenoid.systems, never to the API saved in the credentials file."** Same shape. `sdk/README.md:125` already says it as its own sentence ("It doesn't use the API saved in the credentials file"). Use that form here.

Considered and passed: `mcp/README.md:54`, "Give a governed agent a spend key, and never `--admin`". These are two separate instructions, and the second adds a fact the first doesn't imply.

---

## Round 3 (final Gate 0 + V4 check)

Scope: Gate 0 and V4 only, scoped to the fixes in commit `8b4eb89` (`README.md`, `sdk/README.md`, `sdk/llms.txt`), per `.superpowers/sdd/2026-09-28-solenoid-recovery-mcp/docs-delta-3.md`. Graded directly by one cold checker, not three `copy-grader` runs, so there is no tally. Links were fetched on 2026-09-28 and each quote below is the source's own sentence. First-party claims were checked against `worker/src/ops.ts`, `worker/src/core.ts`, `worker/src/auth-routes.ts`, `worker/src/router.ts`, `sdk/src/http.ts` and `sdk/src/index.ts`.

### Round 2 Gate 0 items: all fixed

1. **Upgrade skips the Resend step** (`README.md:11-14`). Now reads "An upgrade to this release, the one that adds email recovery, skips step 1 and runs step 2, then step 4, then step 3. Step 2 is needed because `RESEND_API_KEY` is new in this release." Step 2 (Resend) now precedes step 3, which is the only step that reads `RESEND_API_KEY`. Confirmed: `worker/scripts/gen-secrets.mjs` still emits only `MASTER`/`SIGNING_KEY`, so step 2 is still the sole source of that field.
2. **wrangler links** (`README.md:26,29`). Now linked. SUPPORTS. https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret-put: "The `put` command can also receive piped input." https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy: "Deploy your Worker to Cloudflare."
3. **1Password `op` links** (`README.md:16,22,29`). Now linked. SUPPORTS.
   - `op item create`: https://www.1password.dev/cli/reference/management-commands/item#item-create — "You can also create an item from standard input using an item JSON template. Pass the `-` character as the first argument, followed by any assignment statements."
   - `op item edit`: https://www.1password.dev/cli/reference/management-commands/item#item-edit — assignment syntax "[<section>.]<field>[[<fieldType>]]=<value>", and the caution "Command arguments can be visible to other processes on your machine," which the README now states explicitly.
   - `op read`: https://www.1password.dev/cli/reference/commands/read — "Read the value of the field in 1Password specified by a secret reference."
   - Secret references: https://www.1password.dev/cli/secret-reference-syntax — "Secret reference URIs point to where a secret is saved in your 1Password account using the names ... of the vault, item, section, and field," format `op://<vault-name>/<item-name>/[section-name/]<field-name>`.
4. **Outage sentence** (`sdk/README.md:146`, `sdk/llms.txt:80`). Both now read "A network failure, or a 5xx other than `email_failed`, throws `Outage`, and neither is retried." Confirmed against code: `sdk/src/http.ts:18` and `sdk/src/index.ts:69` both throw `Outage` for `res.status >= 500 && data.error !== 'email_failed'`; a network failure (fetch throwing) also throws `Outage` (`http.ts:32`, `index.ts:65`). "Never retried": `authPost` (`index.ts:57-70`) makes one fetch with no retry loop; `call` (`http.ts`) retries only a GET or an idempotency-keyed request, and requestRecovery/recover/sendEmailCode/verifyEmail send neither.

### Deploy path walk (fresh install / upgrade-to-this-release / later upgrade)

- **Fresh install** (1→2→3→4): step 1 mints `MASTER`/`SIGNING_KEY`; step 2 creates `RESEND_API_KEY`; step 3 deploys and reads all three secrets, including `RESEND_API_KEY` created in step 2; step 4 sets the per-network limits. Step 4's `login` needs the `solenoidops2` tenant meta to exist, which only `perIp` creates, on the worker's first `/auth/signup` or `/auth/recover` (`worker/src/ops.ts:15-21`, called from `worker/src/router.ts:22` and `worker/src/auth-routes.ts:56`; `#authorize` in `worker/src/core.ts:344` fails `invalid_key` with no tenant meta). The README states this gap directly ("signup and recovery have no per-network limit ... until step 4 runs after that signup"), so "in that order" reads as "don't run step 4 before step 3," not "with no gap," and the gap is disclosed rather than hidden. Not a Gate 0 defect.
- **Upgrade to this release** (2→4→3): step 4 runs "against the Worker already running, which has an ops tenant, as production has." Confirmed: `worker/scripts/ops-key.mjs` signs `admin:solenoidops2:1` directly from `MASTER`, needing no signup; the ops tenant `solenoidops2` already exists in production from earlier use, so `login` in step 4 succeeds before step 3 deploys the new code. Step 2 precedes step 3, so `RESEND_API_KEY` exists before step 3 reads it.
- **Later upgrade** (3 alone): all three secrets already exist in 1Password from earlier runs of steps 1 and 2, so redeploying and re-setting them is self-contained.

All three paths are walkable in the order given.

### Gate 0: PASS

1. Upgrade-before-RESEND_API_KEY ordering — fixed, confirmed against `gen-secrets.mjs` and the step order.
2. wrangler links — present and SUPPORT.
3. `op` links — present and SUPPORT.
4. Outage sentence — fixed, confirmed against `sdk/src/http.ts` and `sdk/src/index.ts`.
5. ops `recoveries` limit settable when each path runs — confirmed against `worker/src/ops.ts` (`perIp`) and `worker/src/core.ts` (`#authorize`, `init`); the fresh-install gap is disclosed, not misstated.

No new unsourced or false claims found in the delta.

### V4: PASS

- `sdk/llms.txt` (Recovery intro): now "Recovery is the developer's job." — the "never the agent's" contrast clause is gone.
- `sdk/llms.txt` (CLI `recover` target): now "It sends to `SOLENOID_API` if set, and to `https://api.solenoid.systems` otherwise. It doesn't use the API saved in the credentials file." — no "X, not Y"/"never" contrast shape remains; the two facts are separate sentences.
- No other "X, not Y" construction found in `README.md`, `sdk/README.md` or `sdk/llms.txt`.
- No em or en dashes anywhere in the delta or in the three affected files (checked by codepoint, `–`/`—`).
