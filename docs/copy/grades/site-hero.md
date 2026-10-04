# Grade: site hero (`/#hero`, with the agent prompt and the start steps)

Medium: developer product landing page. Closing unit, graded against `npx @solenoid.systems/cli init support-bot`. Jurisdiction: New Zealand.

## Plan 3a round 1 (2026-09-30): PASS-WITH-FINDINGS

Three cold `copy-grader` runs dispatched as plain subagents in one message, then `tally.py run1.md run2.md run3.md`. One `copy-source-checker` run covered the landing page's cited sources: 4/4 SUPPORTS.

Tally: Gate 0 CLEAR (0/3). Findings: M1, O1, H3 (3/3), P3, V1, C2, C3.

### Controller's rulings

- **C3: accepted.** Umami records the `?ref=` visit. Tying an on-page command to a signup is deferred in the spec, and copy must not claim it.
- Everything else is fixed below.

### Fixes

- **H3 (the hook promised "one customer, forty times" and "you type stop" and never paid either off).**
  Before: the prompt said "Call spend before every email the support bot sends and before every refund it issues", with no scope per customer and no stop.
  After: the prompt spends at `support-bot/<customer id>` and asks for limit commands "each with --per child so every customer gets their own count". Step 3 shows `npx @solenoid.systems/cli limit support-bot emails=3 --per child`, "which gives each customer three emails". The hero shows the stop: "To stop every send at once, run `npx @solenoid.systems/cli limit support-bot emails=0`. From the next call on, every email spend under support-bot is refused, whatever the agent decides. Run the per child limit command again to let sends resume."
  Source: `worker/src/amounts.ts` `parseLimitValue` accepts 0. `worker/src/core.ts:93` refuses when `used + amount > limit`. `(scope, unit)` is the limits table's primary key, so the 0 limit replaces the per-child one until that is set again. `childOn` in `worker/src/scope.ts` gives each customer its own counter.
- **P3 (what happens on refusal).**
  Before: "a spend past its limit is refused before the send runs".
  After: "once that customer's limit is used up, `spend` throws and the send line after it never runs", and "`spend` also throws when it can't reach Solenoid, so by default an outage stops the send too."
  Source: `sdk/src/errors.ts` (402 becomes `LimitExceeded`). `sdk/src/index.ts` `post` and `modeFor` default to `closed` and throw `SolenoidUnavailable`.
- **V1 (spend used before it was defined).**
  After: "A spend is one call your tool makes before each action it takes." The verb is set as code: `spend`.
- **C2 (example names, the admin key, and the promised limit step).**
  After, step 1: "It prints your admin key and saves it on this machine. Keep a copy somewhere safe, because that key sets every limit." and "The name `support-bot` and the emails and refunds below are an example, so use your agent's name and actions." A new step 3: "Run the limit commands your agent suggests ... Until a limit exists, every spend is recorded and none is refused, apart from the Free plan's monthly cap."
  Source: the `init` case in `cli/src/commands.ts` prints `admin key:` and saves it at `credsPath()`. `worker/src/core.ts` `#checkPlan` and `#applicable` mean that with no limit rows, only the Free cap refuses.
- **O1 (what happens past 100,000).**
  Before: "Free for the first 100,000 spends each month."
  After: "Free for the first 100,000 spends each UTC calendar month. Past that, spends are refused until the month turns, unless you move to Pro. The pricing page has the details." The last sentence links to /pricing.
  Source: `worker/src/core.ts` `#checkPlan` returns 402 with `resets` at the next month when `used >= FREE_SPENDS` on the free plan only.
- **M1:** the fixes above give the reader the whole mechanism in the hero. The next round confirms it.

## Plan 3a round 2 (2026-09-30): hero recheck on e0bee62

Three cold `copy-grader` runs on the enlarged hero. Gate 0 CLEAR (0/3), and the hook payoff is resolved. The truth review found all 18 round 1 items addressed, with no false copy. The findings were about order: C2, X2, V1, C1 and H3 (low). C3 stays accepted.

### Fixes

The start steps (`site/src/components/StartSteps.astro`) now carry the stop and the price after step 3, so the hero and #start share one order.

- **C2, the stop's position.**
  Before, above the steps: "To stop every send at once, run `npx @solenoid.systems/cli limit support-bot emails=0`. From the next call on, every email spend under support-bot is refused, whatever the agent decides. Run the per child limit command again to let sends resume."
  After, below step 3: "Once your tools call `spend`, `npx @solenoid.systems/cli limit support-bot emails=0` stops every email that goes through Solenoid. From the next call on, it refuses every email spend under `support-bot`, whatever the agent decides, and it replaces the per customer limit. To resume, run step 3's command again: `npx @solenoid.systems/cli limit support-bot emails=3 --per child`."
  Source: `worker/src/amounts.ts` `parseLimitValue` accepts 0. `worker/src/core.ts:93` refuses when `used + amount > limit`. Limits are keyed by `(scope, unit)` (`worker/src/core.ts:33`), so the 0 limit replaces the per-child one.
- **C2, the example note moved before the copy button.**
  Before, after the command: "The name `support-bot` and the emails and refunds below are an example, so use your agent's name and actions."
  After, in step 1's lead-in: "That name, the emails and the refunds are an example, so use your agent's name and actions. In your project's root, run this in your terminal:"
- **X2 (code the agent writes could swallow the refusal).** The agent prompt gains: "Let spend's error stop the action: don't catch it around the send or the refund." The stop is now scoped to "every email that goes through Solenoid".
- **V1 (child and scope defined once).** Step 1 now opens: "A scope is the name your spends and limits hang on. Here it is `support-bot`, and each customer gets a child scope under it, such as `support-bot/c-1042`." Step 3: "With `--per child`, each customer gets their own count of three emails."
  Source: `worker/src/scope.ts:22` `childOn`.
- **C1 (the price competed with step 1).** "Free for the first 100,000 spends each UTC calendar month. Past that, spends are refused until the month turns, unless you move to Pro. The pricing page has the details." It moved from above the steps to after the stop paragraph.
- **H3 (low), the receipt sentence.**
  Before: "Every recorded spend comes back with a signed receipt."
  After: "Every recorded spend comes back with a signed receipt that anyone can check offline, as the receipt section below shows."
  Source: `site/test/receipt.test.ts` verifies the saved production receipt offline with the saved keys.

## Task 25 (2026-10-04): landing cut

Robin asked for far less prose. The hero became a short H1 plus a two-paragraph lede, and the start steps lost their explanations. Words are visible prose, with code, terminal output and link labels left out: H1 + lede 107 to 59; start steps outside the agent prompt 206 to 78 (94 counting the inline commands); agent prompt 89 to 82. Raw `wc -w` of `#hero`: 445 to 248.

Three cold `copy-grader` runs, then `tally.py`.

Tally: Gate 0 CLEAR (0/3). Findings: C1, C2, both on the "See pricing" link inside the hero. Unstable: none.

### Controller's rulings

- **C3: accepted**, as before (Umami `?ref=` attribution).

### Fixes

- **C1, C2 ("See pricing" competed with the one call to action).** The free-allowance line and its /pricing link left `StartSteps.astro`, so the hero has no pricing link. Round 2 also dropped the same line from the bottom call to action (see `site-pricing-strip.md`), so the pricing strip alone carries pricing. `site/test/dist/landing.test.ts` no longer expects /pricing in `#hero` or `#start`.

### The cut, before and after

- H1. Before: "Your support agent has sent one customer the same email forty times. You type stop. The sends keep coming." After: "You type stop. The emails keep coming."
- Lede. After: "Solenoid limits your AI agent's actions from outside the agent. Your email tool calls `spend` before each send. Past the limit, `spend` throws and the send never runs. Every recorded spend comes back with a signed receipt." and "By default `spend` also throws when Solenoid can't be reached. It only limits tools that call it first."
  Source: `worker/src/core.ts:91-95` returns 402 `limit_exceeded` before writing an entry, and the SDK throws `LimitExceeded`. `worker/src/http.ts:15` defaults `on_outage` to `closed`, and `sdk/src/index.ts` `modeFor` defaults to `closed` and throws `SolenoidUnavailable`.
- Step 1. After: "In your project's root, run this. `support-bot` names your agent, so use your own." and "It creates your account with no signup form and writes a spend key to `.env` as `SOLENOID_KEY`. Keep the admin key it prints safe: it sets every limit."
  Source: `cli/src/commands.ts:193-210`, `cli/src/envfile.ts:5-8`. `worker/src/core.ts:144-145` requires the admin key for `put`.
- Step 3 and the stop. After: "Run the limits it suggests, such as `npx @solenoid.systems/cli limit support-bot emails=3 --per child`, which gives each customer three emails." and "Once your tools call `spend`, `npx @solenoid.systems/cli limit support-bot emails=0` stops every email from the next call on. Step 3's command resumes them."
  Source: limits are keyed by `(scope, unit)` (`worker/src/core.ts:33`) and upserted (`core.ts:163`), so each command replaces the other.
- Agent prompt: the refund sentence merged into the email one, and the catch instruction now leads ("Don't catch spend's error around the send or the refund: let it stop the action."). Every instruction is kept.
- Cut: the scope and child-scope definitions, the "until a limit exists" note, and the Free plan's past-100,000 behaviour (on /pricing and /docs).

### Truth review

`task-25-truth.md` checked every hero claim against `worker/src`, `sdk/src` and `cli/src` and found all of them true. The re-review after round 1 (`task-25-truth-r1.md`) found fix 1 ADDRESSED and the test change sound.
