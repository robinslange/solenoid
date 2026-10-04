# Litmus: learning-loop's research fetch budget, integrated from the docs alone

Spec success criterion 2: a fresh coding agent, given only the SDK README and `llms.txt`, integrates learning-loop's research fetch budget correctly on the first attempt. Two runs were made on 2026-09-24. Run 1 failed; the failures were fixed in the docs, and run 2 passed.

## Setup

- The SDK bundle (`dist/solenoid.mjs`, `dist/node.mjs`) was vendored into learning-loop at `plugin/vendor/solenoid/` (learning-loop commit `008a53d9`).
- Live limit on Robin's tenant: `solenoid limit learning-loop/research fetches=10 --per child --on-outage open`.
- `SOLENOID_KEY` is a spend key for `learning-loop`, and `SOLENOID_API` points at the workers.dev Worker. Both are set in Claude Code's `env` block.
- Each agent ran in its own learning-loop worktree, branched from `solenoid-fetch-budget` after Task 14.

## Prompt

Run 1 used the plan's prompt verbatim, plus operational lines (the worktree path, commit signing, no subagents):

> Integrate Solenoid into learning-loop's research fetch budget. The only documentation you may read about Solenoid is `plugin/vendor/solenoid/` plus `~/dev/solenoid/sdk/README.md` and `~/dev/solenoid/sdk/llms.txt`. Do not read Solenoid's source code. The budget seam is `budgetStore.tryBump(budget)` in `plugin/bin/source-gateway.mjs`, and the helpers are in `plugin/scripts/lib/fetch-budget.mjs`. When `SOLENOID_KEY` is set, fetches must be limited by Solenoid instead of the local file. When it is not set, behaviour must not change. Add tests in `tests/gateway/` that stub only `fetch`. Run `npm test`. Commit on the worktree branch. Report what you did and anything in the docs that confused you.

Run 2 added one line, because a developer integrating their own tool knows where their limit lives:

> The developer has already set this limit: `solenoid limit learning-loop/research fetches=10 --per child --on-outage open`, and `SOLENOID_KEY` is a spend key for the scope `learning-loop`.

## Run 1: failed

| # | Check | Result |
|---|---|---|
| 1 | `npm test` passes | pass |
| 2 | Spends `{ fetches: 1 }` at `learning-loop/research/{segment}` | **fail**: it spent at `learning-loop/{segment}`, under no limit, so nothing was capped |
| 3 | `LimitExceeded` gives false, a `null` receipt gives true, `SolenoidUnavailable` gives false | **fail**: `SolenoidUnavailable` propagated as an exception |
| 4 | Outage cache is `fileStore()` | pass (a custom directory under the plugin's data dir) |
| 5 | Falls back to the file store when the key is unset or the segment is null | pass |
| 6 | Did not read Solenoid's source | pass (its tool calls read only the README and `llms.txt`) |

What the agent said confused it:
- No convention for which scope to spend at.
- Whether errors other than `LimitExceeded` should propagate. It followed the `llms.txt` example, which rethrew everything else.
- Whether `fileStore()` could take a directory.

Documentation fixes (solenoid commits `7ce02d4` and `83e0f79`, each passed through a cold copy-chief Gate 0 check):
- A spend is capped only by limits at its scope or an ancestor. Integrate under the developer's limit, find it with `ls` or `get`, and never ship an uncapped integration.
- For a yes/no gate, `SolenoidUnavailable` is a refusal. Refuse only on `LimitExceeded` for the gated unit, and rethrow anything else (for example the monthly `spends` allowance).
- `SolenoidUnavailable` is defined once, including the case where a new machine with nothing cached treats an `open` limit as closed.
- `fileStore(dir)` writes `<dir>/outage.json`.

## Run 2: passed

Commit `702da98b` on branch `solenoid-litmus-2`, fast-forwarded into `solenoid-fetch-budget`.

| # | Check | Result |
|---|---|---|
| 1 | `npm test` passes | pass: 2344 passed, 1 pre-existing skip |
| 2 | Scope, unit and amount | pass: `learning-loop/research/{budgetScopeSegment(sid)}`, `{ fetches: 1 }` |
| 3 | Error mapping | pass: `LimitExceeded` for `fetches` gives false, `null` gives true, `SolenoidUnavailable` gives false, and any other error is rethrown |
| 4 | Outage cache | pass: `fileStore()` |
| 5 | Fallback | pass: with no key, the file store is used unchanged. With a key and a null segment, the store is null (no enforcement). This matches the file store, which also enforces nothing for an empty or `unknown` session ID |
| 6 | No source reads | pass (tool calls grepped) |

The tests stub only `globalThis.fetch`. There are six cases: allow, the 402 refusal, a persistent 503 with no cache (refused after one retry), a rethrown `spends` `LimitExceeded`, an unusable session ID, and no key.

What remained unclear to the agent: it did not notice that `fileStore(dir)` is allowed, so the outage cache writes to `~/.cache/solenoid/outage.json`.

### Live run

One session (`CLAUDE_CODE_SESSION_ID=litmus-live-1790250058`), against the workers.dev Worker:

```
for i in $(seq 12); do node plugin/bin/source-gateway.mjs fetch --url https://example.com --json | jq -r '.doc.reason // "ok"'; done
```

```
1-10  ok
11    fetch_budget_exceeded
12    fetch_budget_exceeded
```

`solenoid ls learning-loop/research/litmus-live-1790250058` then shows `fetches 10 child used 10 left 0 (learning-loop/research, open)`.
