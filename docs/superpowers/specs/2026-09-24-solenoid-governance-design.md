# Solenoid: limits for agent actions, behind one endpoint

**Status:** design, awaiting review
**Date:** 2026-09-24
**Replaces:** the twelve-product API suite in this repository, which will be archived
**Amended:** 2026-09-29 by the site spec (`2026-09-29-solenoid-site-design.md`); where they differ, the site spec wins for billing, the site and launch.

## Intent

Solenoid becomes one product: limits and kill switches on the actions AI agents take (emails, refunds, deletes, fetches, model calls), checked before the action happens, with a signed receipt for every one. It stops being a suite of developer APIs.

**Positioning (from the competitor analysis, 2026-09-24).** Hard dollar caps on model spend are now free from OpenAI, Anthropic, Cloudflare AI Gateway, Vercel and LiteLLM, so Solenoid does not lead with them. It leads with limits on *actions* and with provable receipts, and tells buyers to keep their gateway or provider cap for model spend. Model-spend limiting stays in the product, but as a supporting feature, not the headline. The closest competitor is Cycles (open source, self-hosted, reserve-then-commit). Solenoid's differences are: hosted with no signup form, signed hash-chained receipts, at-most-once from the same primitive, and price. The full analysis is in the vault at `4-projects/solenoid-competitor-analysis-2026-09-24.md`.

Developers and companies that ship agents need to say "this agent may spend $5 per run", "this customer may cost $50 a day", "this bot may send 3 emails", and "this refund happens at most once". They need those rules to hold across processes, machines and parallel sub-agents, and they need a record of what happened that they can prove.

Success means:

1. A developer goes from nothing to a first enforced spend with one CLI command and one line of code. There is no signup form and no browser.
2. A fresh Claude Code session, given only the SDK README and `llms.txt`, correctly integrates learning-loop's research fetch budget on its first attempt.
3. Robin runs learning-loop on it daily as the first customer.
4. It takes payment through Stripe.

Constraints: Robin builds this solo, alongside a full-time job. It runs on Cloudflare. Every moving part has to earn its place. "Enforced, not alerted" is the promise the product makes.

## The model

Everything is **a ledger of spends against limits, addressed by a scope**.

- A **scope** is a path such as `acme/support-bot/run-8812`. The tenant is implied by the API key, so scopes start at the customer's own level. The segments are opaque: the developer decides what the levels mean.
- A **spend** debits one or more units at a scope, for example `{ "usd": 0.0123, "tokens": 1840 }`. A unit is any lowercase name: `usd`, `tokens`, `emails`, `fetches`, `executions`.
- A **limit** caps one unit at one scope. It applies to every spend at that scope or below it.
- Every spend and every limit change is appended to a hash-chained, signed ledger.

The old products all fold into this model:

| Old product | Becomes |
|---|---|
| Meter | the spend |
| Gate (kill switch) | a limit of `0` |
| Witness | the receipt on every spend |
| Nexus (hierarchy) | the scope path |
| Key | authentication, not a product |
| Latch (at-most-once use) | `per: "child"` with a limit of 1 |
| Relay, Pulse, Catch, the proxy | cut |

## Architecture

```
solenoid/                new repository
  worker/                one Worker: router, key check, TenantDO, Stripe webhook
  sdk/                   @solenoid.systems/sdk, no dependencies, ESM, global fetch
  cli/                   @solenoid.systems/cli, bin `solenoid`, a thin layer over the sdk
  mcp/                   @solenoid.systems/mcp (new major version), a thin layer over the sdk
  site/                  static Astro site: landing, docs, llms.txt, pricing
```

- **One Worker.** It checks the key statelessly and routes the request to `TenantDO(tenant)`. There is no D1, no KV, no Queues and no service bindings.
- **TenantDO** (SQLite-backed) is the only Durable Object class. It holds all of a tenant's state: limits, usage, the chain, idempotency records, key epochs, plan, recovery email and codes. One spend is one transaction inside one object. No state spans tenants.
- **The SDK is the only code that speaks HTTP.** The CLI and MCP call the SDK.

Accepted trade-off: each TenantDO lives in one region. A caller on another continent pays about 100–250 ms per spend. That is small next to an LLM call. If it ever matters, edge balance leases can be added inside the Worker without changing the API.

## API

### Surface

| Route | Purpose |
|---|---|
| `POST /v1/{scope}` | spend |
| `PUT /v1/{scope}` | set limits, rotate keys (admin key only) |
| `GET /v1/{scope}` | read limits, children and entries |
| `POST /auth/signup` | create a tenant, return an admin key |
| `POST /auth/email` | attach and verify a recovery email |
| `POST /auth/recover` | recover an admin key by email |
| `POST /billing/checkout` | create a Stripe Checkout Session for the upgrade (admin key only) |
| `POST /billing/stripe` | the Stripe webhook: plan changes |
| `GET /.well-known/solenoid.json` | receipt-signing public keys |

### Scope grammar

`seg(/seg){0,7}`, where `seg` matches `[a-z0-9._-]{1,64}`. `/v1/` alone is the tenant root. A scope comes into existence the first time something is spent or limited under it.

### Amounts

Amounts are maps from unit to a positive number, in both directions. Units match `[a-z][a-z0-9_]{0,31}`. Values are stored as integer micro-units (×10⁶), so there is no floating-point drift. Zero and negative spends are rejected.

### `POST /v1/{scope}`: spend

Headers: `Authorization: Bearer <key>` and a required `Idempotency-Key`, which the SDK generates.
Body: an amount map.

Inside one transaction:

1. If `Idempotency-Key` was seen before with the same body hash, return the original receipt with `replay: true`. The body hash covers the scope as well as the amounts. With a different body hash or a different scope, return `409 idempotency_conflict`. A replay reports `remaining` and `on_outage` from the current state, not the state at the original spend. A key stays bound to its spend for as long as the entry is retained.
2. For each unit in the body, and each scope from the target up to the root, check every limit on that scope and unit:
   - A limit with a window (`hour`, `day`, `week`, `month`, or none for lifetime) checks the scope's usage in the current window.
   - A `per: "child"` limit on scope S checks the lifetime usage of the child of S that lies on the target path.
   - If `used + amount > limit`, return 402 and change nothing.
3. Add the amount to the usage counter of each limit that applied, and to nothing else. There is one counter row per limit, and for `per: "child"` one row per child. A counter stores its window start and resets in place when the window rolls over. Counting usage only where a limit exists keeps a spend down to a few written rows, and written rows are what the spend costs (see Cost model).
4. Append the entry to the chain. The idempotency key is a uniquely indexed column on the entry row, not a separate table.
5. Check the plan allowance without writing anything. The number of billable spends this month is `seq − seq_at_month_start − non_spend_entries_this_month`, where `seq_at_month_start` is written once a month by an alarm, and the counter of limit and rotate entries is written only when those entries happen.

Response `200`:

```json
{
  "receipt": {
    "id": "rcp_1042", "seq": 1042, "kid": "k1", "kind": "spend",
    "scope": "acme/bot/run-1", "body": { "emails": 1 },
    "at": "2026-09-24T09:12:03.114Z",
    "prev": "<hex>", "hash": "<hex>", "sig": "<base64url>",
    "replay": false
  },
  "remaining": { "emails": { "scope": "acme/bot", "left": 2, "resets": null } },
  "on_outage": "closed"
}
```

- `remaining` reports the tightest applicable limit for each unit in the spend, and the scope that sets it. A unit with no applicable limit is left out.
- `on_outage` is the strictest setting among the customer's limits that applied, with `closed` beating `open`. When none applied, it is `closed`. The plan's root `spends` limit is excluded: Solenoid's own billing must never decide whether a customer's agent runs during an outage.

### `PUT /v1/{scope}`: limits and keys (admin key only)

```json
{ "usd": 50, "emails": 3, "per": "day", "on_outage": "open" }
```

- Each unit key sets that limit. `0` is a kill switch. `null` removes the limit.
- `per` is one of `hour | day | week | month | child | child-day`, or absent for a lifetime limit. Windows are calendar-aligned in UTC; weeks start on Monday. `child` gives each direct child its own lifetime copy of the limit, and `child-day` gives each child its own copy that resets daily.
- `on_outage` is `closed` (the default) or `open`.
- `warn_at` is a fraction in (0, 1], for example `0.8`, and is optional. When a spend leaves any applicable limit's usage at or above `warn_at × limit`, the 200 response carries `warnings: [{ scope, unit, used, limit }]`. The SDK passes these to an `onWarn` callback. This answers "alerts" without webhooks. It adds one column to `limits` and no row writes.
- `per` and `on_outage` apply to every unit named in the same request.
- `rotate_keys: true` increments the scope's key epoch, which invalidates every spend key for exactly that scope.
- `rotate_admin: true`, only allowed on the root `/v1/`, increments the admin generation and returns the new admin key. This invalidates every existing key.
- Every accepted PUT is appended to the chain as a `limit` or `rotate` entry.
- A new limit starts from the true usage of its current window. The PUT computes it by summing the chain entries in that window at or below the scope. That summing is rows read, which cost a thousandth of rows written, and it runs only when a limit is set. The chain is the source of truth, and the counters are a cache of it for the limits that exist.
- The root `spends` limit belongs to the plan. Setting it returns `403 plan_owned`.

Response `200`: the scope's limits, in the same shape as `GET`.

### `GET /v1/{scope}`

```json
{
  "scope": "acme",
  "limits": [{ "unit": "usd", "limit": 50, "per": "day", "on_outage": "closed",
               "used": 12.4, "left": 37.6, "resets": "2026-09-25T00:00:00Z" }],
  "children": ["bot", "research"],        // from a scopes table, written only when a scope is first touched
  "entries": [ /* up to 50 receipts at or below this scope, newest first */ ],
  "next": 991
}
```

Entries are newest first. Pages continue with `?before=<seq>`, which must be a non-negative integer, else 400.

### Errors

Every error body is `{ "error": "<code>", ...detail }`.

| Status | Code | When |
|---|---|---|
| 400 | `invalid_scope`, `invalid_amount`, `invalid_unit`, `missing_idempotency_key`, `invalid_idempotency_key` (printable ASCII without `#`, 1–255 chars), `invalid_limit`, `invalid_before`, `invalid_request` (a malformed `/auth` body), `invalid_email`, `invalid_code` (a wrong, expired or used code, or code checks locked for that address) | malformed request |
| 404 | `unknown_spend` | a settle whose idempotency key matches no spend |
| 401 | `invalid_key` | a key that is unparseable, fails its MAC check, or has a stale generation or epoch |
| 402 | `limit_exceeded` | detail: `scope, unit, limit, used, requested, resets`. Adds `Retry-After` when `resets` is set. An exhausted plan appears as scope `""`, unit `spends`. |
| 403 | `out_of_scope`, `admin_required`, `plan_owned` | the key is not allowed to do this |
| 409 | `idempotency_conflict` | the key was reused with a different body |
| 429 | `rate_limited` | only for signup, email and recovery. A limit that has run out is never 429, because generic retry middleware retries 429. |
| 502 | `email_failed` | the recovery or verification email could not be sent. Only `/auth/email` returns it; `/auth/recover` sends after its `202`. The SDK raises it as a `SolenoidError`, not an outage. |

### Receipts and the chain

- Each tenant has one chain. Its first `prev` is 32 zero bytes.
- `hash = sha256(prev ‖ JCS({ seq, kind, scope, body, at, kid }))`, where JCS is RFC 8785 canonical JSON and `kind` is `spend`, `settle`, `limit` or `rotate`.
- Spends, settles and PUTs run one at a time behind an explicit lock inside TenantDO. GETs do not take it. The recovery code methods (`attachStart`, `attachVerify`, `recoverStart`, `recoverFinish`) take it too. In workerd, WebCrypto awaits do not open the input gate, and email is sent from the Worker after the Durable Object returns (Plan 2, decision 1), so no network await runs inside the critical section and the lock is not load-bearing there. Under `testServer()` in Node, WebCrypto awaits do interleave, and the lock is pinned there by the test that runs two concurrent `rotate` recoveries with two different codes: each is sealed in turn, and `gen` goes to 2 and then 3. The original concurrency test proves the spend path by adding a yield: with the yield and without the lock, it fails.
- `sig = Ed25519(hash)`, computed with WebCrypto. The private key is a Worker secret. `kid` names the key.
- `/.well-known/solenoid.json` publishes the public keys by `kid`, so a new signing key can be introduced without breaking old receipts.
- `sol.verify(receipt)` fetches the public keys from `/.well-known/solenoid.json` and checks the signature locally. To verify offline, save those keys once and call `verifyChain([receipt], keys)`, exported from the SDK. Given consecutive entries, `verifyChain(entries, keys)` also checks continuity.

## Keys

Nothing about keys is stored except two counters, and every key check is an HMAC computation.

- **Admin key:** `sk.admin.{tenant}.{gen}.{secret}`, where `secret = hex(HMAC-SHA256(MASTER, "admin:" + tenant + ":" + gen))`. Fields are separated by `.`, which cannot appear in any field; base64url uses `_` and `-`, so `_` could not serve. `MASTER` is a Worker secret. The DO rejects any `gen` other than its current one. An admin key can do everything.
- **Spend key:** `sk.spend.{tenant}.{gen}.{epoch}.{b64url(scope)}.{mac}`, where `mac = hex(HMAC-SHA256(key = UTF-8 bytes of the admin secret's hex string, "spend:" + scope + ":" + epoch))`. The root scope encodes as an empty field. Anyone holding the admin key derives spend keys locally, with no API call. A spend key can POST and GET at its scope and below it. Anything else returns `403 out_of_scope` or `403 admin_required`. The DO rejects any `epoch` other than that scope's current one.
- **What the design costs:**
  - Rotating a scope's keys revokes all of that scope's keys at once.
  - Rotating the admin key revokes every key.
  - Scope names appear in plain text inside keys.

  The CLI warns before either rotation.

## Signup and recovery

- **`POST /auth/signup`** takes an empty body and no auth. It creates a tenant with a random 12-character base32 ID and `gen = 1`, and returns the admin key. A new tenant starts on the free plan.
- **Signup limits run on Solenoid itself.** Workers rate-limit bindings only allow 10- and 60-second periods, so the signup handler spends `{ signups: 1 }` at `signups/{first 16 hex of HMAC-SHA256(MASTER, "ip:" + k)}`, where `k` is the IPv4 address, or the /64 prefix of an IPv6 address (an IPv6 client can rotate freely within its /64), in Solenoid's own ops tenant. The ops tenant's limits are `PUT signups { signups: 5, per: "child-day" }` (5 per IP per day) and `PUT / { signups: 1000, per: "day" }` (a global circuit breaker). The only new mechanism is the `child-day` value of `per`.
- **`POST /auth/email`** needs an admin key.
  - `{ email }` sends a 6-digit code, valid for 15 minutes.
  - `{ email, code }` verifies the code and stores the email on the tenant. The confirmation email states the tenant ID.
  - `{ email, code, rotate: true }` also increments the generation, in the same serialized Durable Object call that stores the email, and returns `{ tenant, email, admin_key }` with the new admin key. Nothing can run between the two. `rotate` must be a boolean when present, on both steps, or the answer is `400 invalid_request` with `field: "rotate"`. The send step ignores a boolean `rotate`.
  - A tenant holds one recovery email, and attaching a new one replaces the old.
- **`POST /auth/recover`** needs no auth. It is addressed by tenant, so no lookup from email to tenant exists.
  - `{ tenant, email }` sends a code if that email is the tenant's verified recovery address. The response is always `202`, so the endpoint cannot be used to find out which emails have accounts. It is `202` even when the per-email limit below refuses the request. The code email is sent after the `202` (from `waitUntil`), so the response time does not depend on whether the address matched.
  - `{ tenant, email, code, rotate? }` returns the admin key.
  - The tenant ID is not secret. It appears in every spend key (in `.env` files and deployed config), in the email-confirmation message, and in the `client_reference_id` of the Pro tenant's Stripe Checkout Session. Someone who has lost everything else searches their inbox.
  - By default, recovery re-derives the **current** admin key, which is possible because the key is a function of `(tenant, gen)`. A lost key is recovered without breaking any deployed spend key. With `rotate: true`, the generation is incremented first. Use this when the key may have been stolen.
  - `/auth/recover` is also limited per IP through the ops tenant, the same way as signup: each request spends `{ recoveries: 1 }` at `recoveries/{first 16 hex of HMAC-SHA256(MASTER, "ip:" + k)}`, and a `402` there becomes `429 rate_limited`. The ops tenant's limit is `PUT recoveries { recoveries: 20, per: "child-day" }` (20 per IP per day). This is the only `429` `/auth/recover` returns. It bounds code guessing across emails, and the creation of empty Durable Objects for unknown tenant IDs. There is no global recovery cap, because one actor could use it to switch recovery off for everyone.
  - The recovery email is not written to the chain, which is signed and meant to be shared. A recovery with `rotate` writes a `rotate` entry with body `{ "rotate_admin": true, "recovery": true }`, and an attach with `rotate` writes one with body `{ "rotate_admin": true, "attach": true }`.
- **Abuse limits.** Each tenant keeps these per `(purpose, email)`, where the purpose is attach or recover:
  - Codes are 6 digits, valid for 15 minutes and single-use. They are stored as `HMAC-SHA256(MASTER, "code:{purpose}:{email}:{code}")`, so the stored rows alone cannot be reversed.
  - At most 5 code requests per email per hour, across both purposes.
  - At most 10 attach codes per tenant per day, so `/auth/email` cannot be used to mail strangers.
  - Up to 3 codes are live at once per `(purpose, email)`. A fourth request drops the oldest, so a stranger's single request cannot kill the owner's code.
  - A failed redemption counts once for each live code it was checked against, and once when none is live. A check that could take the count past 5 in an hour or 10 in a day is refused as `invalid_code` without being made. So the caps count code guesses: at most 10 a day, a chance of about 10 × 365 / 10⁶ ≈ 0.4% a year of guessing a code.
  - Changing the recovery email also mails the previous address. After a leaked admin key, that email gives one step, run while the admin key still works: `solenoid email <address>`, then `solenoid email <address> <code> --rotate`, which sets the owner's address again and rotates the admin key in one Durable Object call. Two separate steps would leave a window: between re-attaching and rotating, whoever holds the leaked key could attach their own address again, and whoever holds the recovery email can recover even a rotated key. Rotating the admin key (`rotate_admin`, or a recovery with `rotate`) leaves the recovery email as it is, so the email keeps protecting an owner whose leaked key was only rotated.
  - **Accepted risk: someone who knows both the tenant ID and the recovery email can hold recovery closed.** There are two ways. Failing code checks on purpose locks them for up to an hour, or up to a day. Requesting codes repeatedly uses up the address's 5 requests an hour and pushes the owner's code out of the 3 kept live. Neither leaks a key or changes the account, and both need the attacker to know the recovery email.
  - **Accepted risk: anyone who shares the owner's network can hold recovery closed until the UTC day rolls over.** The per-IP limit on `/auth/recover` counts code requests and redemptions together, and it runs before any tenant or email check. So anyone on the owner's IPv4 address, a shared NAT included, or in the same IPv6 /64 can spend that network's 20 requests, and the owner then gets `429 rate_limited` for the rest of the day. This needs neither the tenant ID nor the recovery email. It leaks no key and changes no account, and recovering from another network works.
- **The fragile step goes first.** The code is stored, then the email is sent. If sending fails, `/auth/email` returns `502 email_failed`, and the stored code simply expires. There is nothing to roll back.
- **Stripe:** the email collected at Checkout starts an `/auth/email` verification send automatically. The email is attached only after the code is verified, so a typo can never become the recovery address.
- **Email transport:** Resend, which the current stack already uses from `solenoid.systems` (`api/oauth/src/lib/email.ts`). This is one `fetch` call. Moving to Cloudflare Email Sending waits until it is generally available, as the vault already decided.

## Plans and billing

- **One billable spend** is one successful `POST /v1/{scope}` that is not a replay. The number of units in the body and the depth of the scope do not change the price. `402` rejections, replays, `GET`, `PUT` and every `/auth` call are free.
- **Free:** 100,000 spends a month.
- **Pro:** $29 a month, including 2M spends, then $10 per additional million.
- **Upgrading is `solenoid upgrade`.** It calls `POST /billing/checkout` with the admin key. The Worker creates a Checkout Session in `subscription` mode with the $29 price and the metered overage price, and `client_reference_id` set to the tenant, and the CLI opens its URL. A Payment Link can't do this: Payment Links require a quantity on every line item, and a metered price takes none.
- **`checkout.session.completed`:** the webhook verifies its signature, sets the tenant's `plan` meta to `pro`, which lifts the free cap in `#checkPlan`, and stores the Stripe customer and subscription IDs. `customer.subscription.deleted` sends a final meter report and then sets `plan` back to `free`.
- **Overage:** a TenantDO alarm reports recorded spends to a Stripe Billing Meter once a day. It is off the hot path. `meta` keeps the ledger `seq` reported up to, and each report covers only the spends after it. The event `identifier` is the tenant plus the covered `seq` range, so a retry of the same report is a no-op, and a later report never repeats earlier spends. Usage is billed in the period in which it is reported.
- **Managing billing:** the Stripe customer portal. When a Pro tenant runs `solenoid upgrade`, `POST /billing/checkout` answers `409 already_pro` with a portal URL the Worker creates as a billing portal session for the stored customer.
- **Setup:** Claude creates the product, prices, meter and webhook through Stripe tooling, in test mode first. The Worker holds a restricted key for Checkout Sessions, billing portal sessions and meter events. Live mode follows once Robin confirms.

## Cost model

Workers Paid ($5 a month, already paid) rates, checked against Cloudflare's pricing docs on 2026-09-24:

| Item per spend | Rate | Cost per million spends |
|---|---|---|
| Worker request | $0.30/M after 10M included | $0.30 |
| Worker CPU, ~2 ms for the HMAC check and routing | $0.02/M CPU-ms after 30M included | $0.04 |
| Durable Object request | $0.15/M after 1M included | $0.15 |
| Durable Object duration, ~10 ms × 128 MB, billed only while active | $12.50/M GB-s after 400k included | $0.02 |
| Rows written: entry, idempotency index, and one counter per applied limit (L) | $1.00/M rows after 50M included | $2.00 + L |
| Rows read | $0.001/M rows | ≈ 0 |

- A typical spend with one or two applied limits costs **$3.50–$4.50 per million**.
- An LLM call through `run.llm` writes a hold and a settle, which is roughly twice the rows, but it bills as one spend. That's about $7–9 per million LLM calls against $10 per million overage. So an LLM-heavy Pro tenant is thin-margin by design, and the pitch doesn't lead with model spend.
- Usage that creates a new scope for every spend (`run` children, per-session scopes, per-IP signup scopes) writes one extra `scopes` row per new segment, so it costs $4.50–$5.50 per million.
- Storage is about 450–500 bytes per entry, which is **$0.08 per million spends per month kept** ($0.20/GB-month).
- Rows written are most of the cost, which is why usage is counted only where a limit exists. Counting every window for every ancestor would have been about 30 rows, or $30 per million, six times the overage price.
- **What the $5 plan already covers:** about 12–16M spends a month of written rows and 10M Worker requests. The first real cost is DO requests past 1M.
- **A maxed-out free tenant** costs about $0.40 a month. A **Pro tenant using all 2M** costs about $9, plus about $1.15 in Stripe fees, so it contributes about $19 (about 65%). **Overage** at $10 per million leaves about $5.50 per million.
- **Retention:** each DO is capped at 10 GB, about 25M entries. The design: an alarm deletes entries older than 12 months, and a checkpoint row keeps `(seq, hash)` so the retained chain still verifies from that point. This pruning is deferred past launch (site spec, Privacy); until it ships, entries are kept for the life of the account. Deleting costs a row write per row, while keeping 400 MB costs $0.08 a month. Deletion only pays for itself after about a year, which is why retention is 12 months and not shorter. Receipts the customer already holds stay verifiable by their signature. A lifetime limit set after pruning counts only the retained entries.

## SDK

```ts
import { solenoid } from "@solenoid.systems/sdk"
const sol = solenoid()                                   // key from SOLENOID_KEY

await sol.spend("acme/bot", { emails: 1 })               // receipt, or throws LimitExceeded
await sol.limit("acme", { usd: 50, per: "day" })         // admin key only
await sol.get("acme")
await sol.verify(receipt)

await sol.run("acme/bot", async (run) => {               // child scope run-{ulid}
  await run.spend({ emails: 1 }); await send(email)
  const res = await run.llm(req => openai.chat.completions.create(req), req)
})
```

- **Countable units:** spend first, then act. Nothing can overshoot. A spend is not refunded if the action then fails.
- **`run.llm` holds the worst case, then settles the actual cost:**
  1. Read the remaining `tokens` and `usd` from the last receipt cached for this scope, or with one GET if nothing is cached.
  2. Estimate input tokens as characters ÷ 4 × 1.2. If the input alone doesn't fit, throw `LimitExceeded` without calling the provider.
  3. Set `max_tokens`, or `max_completion_tokens` instead where the request uses it (OpenAI rejects a request that sets both), to `cap = min(requested, what remains after the input)`.
  4. **Hold:** spend the worst case, `{ tokens: input + cap, usd: input × price.in + cap × price.out }`, with a fresh idempotency key. A concurrent call that would push past the limit gets 402 here, *before* its provider call. This closes the overshoot from parallel sub-agents.
  5. Make the provider call.
  6. **Settle:** POST `{ "settle": { tokens, usd } }` to the same scope with the **same** idempotency key and the actual `usage`. If the provider call threw, settle to zero, which releases the hold.
- **Settle, server side.** A POST whose body is `{ "settle": <amount map> }` looks up the spend entry by its `Idempotency-Key`. It then moves every counter that spend touched by `actual − held` (per unit; values may be `0`), and appends a `settle` entry `{ ref: <seq>, held, actual }`.
  - The settle is stored under idempotency key `<key>#settle`, so repeating it replays.
  - A settle may raise usage past a limit. That usage already happened, and the chain records it.
  - Settles are free: they count as non-spend entries, like PUTs.
  - A counter whose window has rolled over since the hold is left alone. The hold counted in the old window, and so does its correction.
  - If the settle never arrives (the process died), the hold stands. That errs toward the limit.
  - An unknown key gets `404 unknown_spend`. A settle of a settle cannot be reached, because an idempotency key may not contain `#`; the ledger answers `<key>#settle` with the same 404. Settling twice with a different body gets `409`.
- **Adapters:** OpenAI-compatible responses (`usage.prompt_tokens` and `usage.completion_tokens`; this covers Fireworks) and Anthropic responses (`usage.input_tokens` and `usage.output_tokens`), told apart by response shape.
- **Prices:** `prices.json` ships with the SDK and can be overridden per call. A `usd` limit on a model with no known price throws `unknown_price`.
- **Documented bound:** with holds, concurrent LLM calls cannot overshoot through each other. The remaining bound is how wrong the input estimate is, which settle corrects after the fact. Countable units never overshoot.
- **Timeouts and outages:** each request has a 2-second timeout. After a network error or 5xx, the SDK retries once with the same idempotency key. After that it applies the cached `on_outage` of the scope or its nearest cached ancestor, which is `closed` when nothing is cached. The SDK caches the mode at the spend's scope and at each scope that holds one of the applied limits, so a brand-new `run-*` or per-session scope still inherits its parent's `open`: a closed limit throws `SolenoidUnavailable`, an open one allows the action. A 4xx is never treated as an outage.
- **Outage cache:** `solenoid({ store })`, where `store` has `get(scope)` and `set(scope, value)`. The default is in-memory. `@solenoid.systems/sdk/node` exports a file store under `~/.cache/solenoid/`.
- **Size:** no dependencies, targeting under 400 lines. It runs on Node 20+, Bun, Deno and Workers. A single-file ESM bundle (`dist/solenoid.mjs`) is published alongside the package so that tools with no install step, such as learning-loop, can vendor it.

## CLI

`solenoid init [scope] [--email <e>]`, `login <admin-key>`, `key <scope>`, `limit <scope> <unit>=<n>… [--per] [--on-outage]`, `ls [scope]`, `log [scope]`, `spend <scope> <unit>=<n>`, `email <e>`, `recover <e>`, `rotate <scope> | --admin`, `upgrade`.

- `init`:
  1. Calls signup.
  2. Writes the admin key to `~/.config/solenoid/credentials` with mode 0600.
  3. If a scope was given, derives its spend key and appends `SOLENOID_KEY=` to `./.env`.
  4. If `--email` was given, starts email verification.
- The CLI prints the admin key once at init and tells the user to attach an email so the account can be recovered.

## MCP

The tools are `get` and `log`. `set_limit` and `rotate` are exposed only when the server starts with `--admin`. It reads `~/.config/solenoid/credentials`. A governed agent is only ever given spend keys. The admin tools are for the human's assistant, and only when the human opts in.

- Without `--admin`, the server takes `SOLENOID_KEY` and refuses to start unless it is a spend key (`sk.spend.`), so an admin key is refused. `--admin` requires an `sk.admin.` key in the credentials file.
- `rotate` covers scope keys only. Admin-key rotation stays in the CLI.
- `set_limit` refuses the control keys (`per`, `on_outage`, `warn_at`, `rotate_keys`, `rotate_admin`) as units, and any value that is not a number or `null`.
- It speaks JSON-RPC over stdio by hand: `server/discover` for protocol `2026-07-28`, and `initialize` for `2025-11-25` and `2025-06-18`. It has no runtime dependencies; the SDK is bundled in.

## Site

Keep the live site's "Living Schematic" look: the design tokens (`#101012`, `#E4E4E7`, `#FF3F00`), the layouts and the Pixi magnetic-field background. Rewrite all of the copy. The pages are the landing page, docs generated from this contract, `llms.txt`, `llms-full.txt` and pricing. All copy is written against `docs/copy/brief.md` and must pass a cold `/copy-chief` diagnostic before it ships. The earlier hero line ("enforced, not alerted") was graded BLOCKED: it had an unsourced "at the edge", a promise the mechanism can't keep, dashes, and the banned "X, not Y" construction. It is retired. Old product pages redirect to `/`, old docs paths to `/docs`, and the old root `.md` mirrors to `/llms.txt`. The blog is dropped. The site spec has the full redirect table.

## First integration: learning-loop

**Dropped** on 2026-09-28 (learning-loop PR #131, closed). This section records the design as it stood.

- **Research fetch budget.** `plugin/bin/source-gateway.mjs` injects a `budgetStore` whose shape, `{ n, bump() }`, checks and then bumps. Under parallel research sub-agents, that races past the cap.
  - The seam becomes `tryBump(): Promise<boolean>`, with two implementations.
  - **Solenoid**, when `SOLENOID_KEY` is set: `spend("learning-loop/research/{sessionId}", { fetches: 1 })`, where a 402 maps to `fetch_budget_exceeded`. The limit is `PUT learning-loop/research { fetches: 10, per: "child", on_outage: "open" }`. The gateway starts one process per URL, so it uses the SDK's file store.
  - **The file store**, when no key is set: made atomic with an `O_EXCL` lock file in `plugin/scripts/lib/fetch-budget.mjs`. This fixes the race for learning-loop users who don't use Solenoid.
- **Verify-phase spend.** Fireworks calls made through the OpenAI-compatible provider (`scripts/librarian/config.mjs`) run through `at("learning-loop/verify/{session}").llm`, using an explicit scope rather than a random `run-*` child, with `PUT learning-loop/verify { usd: 2, per: "day" }`.

## Testing

Mock only at the boundary.

- **Worker and DOs:** `@cloudflare/vitest-pool-workers` with real SQLite in the Durable Objects. The ledger core takes an injected clock.
- **Required tests:**
  - N concurrent spends against a limit L: exactly L succeed.
  - An ancestor limit blocks a spend. A multi-unit spend that fails leaves nothing debited.
  - A `per: "child"` limit caps each child separately.
  - Window boundaries reset usage. A limit added mid-window sees the true usage.
  - Idempotency: a replay returns the same receipt without a second debit, and a conflicting body gets 409.
  - The chain verifies after a random sequence of operations. Tampering with any single field of any single entry makes verification fail.
  - Keys: a derived spend key is accepted. An out-of-scope key, an old epoch, an old generation and a bad MAC are each rejected.
  - Recovery re-derives the same admin key. `rotate` invalidates the old one. Codes expire, are single-use and are attempt-limited. A mismatched `{tenant, email}` still returns 202.
  - A limit set mid-window starts from the usage summed out of the chain.
  - After pruning, the chain verifies from its checkpoint. Deferred with pruning.
  - The Stripe webhook rejects a bad signature, and it moves the tenant between plans.
- **Mutation testing:** Stryker over the ledger, key and recovery modules. Every check that rejects something must have a surviving-mutant count of zero, or an explained exclusion.
- **SDK:** unit tests stub the transport (Solenoid's own HTTP) to pin retry, outage and hold-and-settle behaviour. Live tests run against the Worker locally, with only the LLM provider stubbed. A property test covers the `max_tokens` cap arithmetic.
- **Acceptance:** the litmus test from Intent (2), with its transcript recorded in the repository.
- **Production:** a scheduled canary spends against a canary tenant from two regions and alerts on failure.

## Migration

- The new repository is `solenoid`. This spec was its first commit. The public repository starts from one squashed snapshot of the scrubbed tree, and the full history stays in the private archive `robinslange/solenoid-history`.
- `api.solenoid.systems` and `solenoid.systems` point at the new Worker and site. Old keys stop working. There is no compatibility layer and no user notice; the existing users are Robin and testers.
- After the cutover, the old Workers, D1 databases, KV namespaces, Durable Objects and Stripe products are removed, and the old repository is archived on GitHub (read-only).
- No old `@solenoid.systems/mcp` was ever published to npm, so there is nothing to deprecate. The MCP is re-listed in the MCP directories.

## Deployment during the build

Plan 1 deploys the new Worker to its `workers.dev` hostname, and the SDK and CLI read `SOLENOID_API`. The last task of Plan 1 moves `api.solenoid.systems` to the new Worker, after Robin confirms. Nothing needs to keep the old gateway on that hostname.

## Build order

1. TenantDO ledger: spend, limits, windows, per-child, idempotency, chain.
2. Keys and signup.
3. SDK.
4. CLI.
5. The litmus test. The learning-loop integration was dropped (learning-loop PR #131, closed 2026-09-28).
6. Email attachment and recovery.
7. MCP.
8. Stripe in test mode, with `solenoid upgrade`, before the npm publish.
9. Stripe live mode, then the site cutover (site spec, Launch order).
10. Teardown.

## Out of scope for v1

- An OpenAI-compatible proxy.
- Streaming inside `run.llm`.
- A web dashboard.
- Human approval of overages.
- Edge balance leases.
- Limits that don't follow the tree.
- Webhooks.
- Write caps for federation peers.
- Cell (sandboxed execution).
- Reserve-then-settle as a public concept. It exists only as the SDK's `run.llm` hold and settle.
- A Python SDK and a LangGraph/LangChain tool wrapper. These come first after v1.
- Rolling windows.
- Multiple admins or teams.

## Risks to verify during planning

- Resolved 2026-09-29: a Stripe Payment Link can't sell a metered price, so `solenoid upgrade` uses one endpoint that creates a Checkout Session (site spec, Billing).
- The throughput of a single DO on this spend transaction, and the rows it actually writes. Check the rows-written counter in DO analytics against the cost model before pricing goes live.
- Whether the Workers rate-limit binding counts accurately enough for 5 signups per IP per day. It counts per location, so a global cap may need a DO counter instead.
