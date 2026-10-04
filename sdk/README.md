# @solenoid.systems/sdk

For tools that call `spend` before they act, an action that would take a count past its limit is refused before it runs, and every spend Solenoid records returns a signed receipt. Two gaps, detailed under [Known bounds](#known-bounds): during an outage, a limit set to `open` lets actions through with no record, and model calls can end above a `tokens` or `usd` limit, because the input estimate can be low and Anthropic cache writes are undercounted.

Your support agent retries a failed step and sends one customer the same email forty times. You type stop into the chat. The sends keep coming, because the loop that sends them never reads the chat.

Solenoid keeps the count outside the agent. Your code calls `spend` before it sends. A spend that would take the count past its limit is refused: `spend` throws, and the send never runs. Solenoid only limits the tools that call it before they act.

`init` gives your agent a key and `limit` sets its cap. After that, one `spend` call before each action checks the cap and hands back signed proof. The first 100,000 spends each UTC calendar month are free. Past that, the free plan refuses every spend until the month turns. Pro is $29 USD a month with 2M spends included, then $10 USD per extra million. To buy it, run `npx @solenoid.systems/cli upgrade` (`solenoid upgrade` if the CLI is installed) on the machine that holds the admin key. It opens Stripe Checkout in your browser and prints the link, in case no browser opens. Once the payment goes through, the account moves to Pro, and the 100,000 cap no longer applies. Only spends Solenoid records count. Refused spends, replays of an earlier spend, and attempts that never reach Solenoid don't.

## Quickstart

```sh
npm i @solenoid.systems/sdk
npx @solenoid.systems/cli init support-bot
```

You run `init`, in your own terminal. `support-bot` is a scope name you choose. `init` creates your account with no signup form. The account is a tenant, and its ID is part of every key `init` mints, which is how Solenoid knows the key is yours.

- **Admin key.** `init` prints it once and saves it to `~/.config/solenoid/credentials` with mode 0600. It can change every limit and revoke every key. Keep it out of the agent's environment and out of its context. Run the agent as a different OS user from the one that holds the credentials file, or keep the admin key off the agent's machine.
- **Spend key.** `init` appends `SOLENOID_KEY=<spend key>` to `./.env`. If `.env` already has a `SOLENOID_KEY`, `init` leaves the file as it is and prints the new spend key, so you can put it where you want. This is the only key the agent gets. It can spend at `support-bot` and at any scope under it, and it cannot change limits.
- **Losing the credentials file.** Attach a recovery email now, and it can get the admin key back later. `npx @solenoid.systems/cli email <address>` mails a code, and `npx @solenoid.systems/cli email <address> <code>` attaches the address. `init --email <address>` sends the first code for you. See [Recovery](#recovery). Without a recovery email, running `init` again creates a new account.

Set a limit of three emails per conversation. The CLI reads the admin key from the credentials file:

```sh
npx @solenoid.systems/cli limit support-bot emails=3 --per child
```

The SDK does not read `.env` files. Start your app with `node --env-file=.env app.js`, which needs Node 20.6.0 or later ([Node CLI docs](https://nodejs.org/api/cli.html#--env-filefile)), or load `.env` with whatever loader your app already uses. `solenoid()` reads two variables:

| Variable | Meaning |
|---|---|
| `SOLENOID_KEY` | Required. The spend key from `init`. |
| `SOLENOID_API` | Optional. Defaults to `https://api.solenoid.systems`. It must be an `http` or `https` URL with no user, password, query or fragment, on a port that fetch allows. Anything else throws `TypeError` when the client is built. Fetch refuses about 80 ports, such as 6000, 5060 and 10080 ([Fetch standard](https://fetch.spec.whatwg.org/#bad-port)). |

Guard the send:

```ts
import { solenoid } from '@solenoid.systems/sdk'

const sol = solenoid()

const scopeId = (id: string) => id.toLowerCase().replace(/[^a-z0-9._-]/g, '-')

export async function sendGuarded(conversation: string, email: Email) {
  await sol.spend(`support-bot/${scopeId(conversation)}`, { emails: 1 })
  await send(email)
}
```

`send` and `Email` stand for your own mail function and its type. The fourth `sendGuarded` call for one conversation throws `LimitExceeded`, and `send` never runs.

A scope segment allows only lowercase letters, digits and `. _ -`, and anything else throws `TypeError`. `scopeId` lowercases the ID and replaces every other character with `-`. It also replaces `/`, which would otherwise nest a new scope level inside the ID. Two IDs that map to the same string share one budget. An ID longer than 64 characters, or made only of dots, still throws.

**Spend under the limit.** A spend is capped only by limits at its own scope or at an ancestor of it. A spend under no limit is recorded and never refused. So spend at a scope under the limit the developer set: here the limit is on `support-bot`, and every spend is at `support-bot/<id>`. To see what caps a scope, pass the exact scope you spend at, such as `support-bot/c-8f2a`. Your code can call `sol.get('support-bot/c-8f2a')` with the spend key. The developer can run `npx @solenoid.systems/cli ls support-bot/c-8f2a`, which uses the admin key from the credentials file. `sol.get` returns `limits`, which lists every limit that caps a spend at that scope, including the ones set on its ancestors, each with a number in `used`. An entry whose `used` is `null` is a per-child limit that the scope sets for its own children, and it doesn't cap a spend at the scope itself. `ls` prints the same list, one limit per line, showing such an entry as `tracked separately per child`, and prints `(no limits)` when the list is empty. If no entry has a number in `used`, nothing caps that scope. Don't ship the integration like that. Ask the developer to set a limit above it, for example `npx @solenoid.systems/cli limit support-bot emails=3 --per child`.

You can also pass everything in code:

```ts
solenoid({ key, api, timeoutMs, store, fetch, prices, onWarn })
```

`timeoutMs` defaults to 2000. The other options are covered below.

## Stopping an agent mid-incident

A limit of `0` refuses every spend of that unit at that scope and below, from the next call on. You set it from your terminal, outside the agent's process:

```sh
npx @solenoid.systems/cli limit support-bot emails=0
```

To cut the agent off entirely, revoke the spend keys for its scope:

```sh
npx @solenoid.systems/cli rotate support-bot --yes
```

Every spend with the old key then fails with `invalid_key`. `npx @solenoid.systems/cli key support-bot` prints a new one when you're ready.

`emails=off` is a different thing. It deletes the limit, so spends of that unit are no longer capped.

## Recovery

A recovery email gets the admin key back if you lose it. Attach one with the admin key. The code arrives by email:

```ts
const admin = solenoid({ key: process.env.SOLENOID_ADMIN_KEY })
await admin.sendEmailCode('you@example.com')
await admin.verifyEmail('you@example.com', code)
```

`code` is the 6-digit code from that email. `verifyEmail` returns `{ tenant, email }`, and Solenoid mails a confirmation that names the account ID. Addresses are trimmed and lowercased. An account holds one recovery email, and verifying a new one replaces it.

`verifyEmail(email, code, { rotate: true })` also replaces the admin key, in the same step, and returns the new one as `admin_key`. Store it before anything else: if it is lost, only recovery by email gets it back. Every earlier admin and spend key stops working, including the key of the client that made the call, so make a new client with `admin_key`. The section on changed recovery emails below says when to use it.

If that call throws `Outage`, it may have gone through. Wait a minute, then call `get('')` on the same client. It still holds the old key.

- If `get('')` works, nothing changed, but the code may be used up. Call `sendEmailCode` for a new code, then `verifyEmail` with it and `{ rotate: true }` again.
- If it fails with `invalid_key`, the admin key was replaced, by this call or by someone else first. Call `requestRecovery(tenant, email)`.
- If a code arrives, `email` is the recovery email. `recover(tenant, email, code)` returns the current admin key. Derive each spend key again with `deriveKey` and redeploy it.
- If no code arrives within a few minutes, and the address has had fewer than 5 codes this hour, `email` isn't the recovery email. Someone else replaced the key, and the account can't be recovered. `npx @solenoid.systems/cli init --force` starts a new account and overwrites the saved admin key.
- If `get('')` throws `Outage` again, wait, then call it again.

To recover, you need the account ID and the address. The ID is the third field of any key (`sk.spend.<id>.…`), so a deployed spend key still has it, and the confirmation email names it:

```ts
import { recover, requestRecovery } from '@solenoid.systems/sdk'

await requestRecovery(tenant, 'you@example.com')
const { admin_key } = await recover(tenant, 'you@example.com', code)
```

Here `tenant` is the account ID and `code` comes from the recovery email. `recover` returns the current admin key, and every deployed spend key keeps working. If the old admin key may have leaked, call `recover(tenant, 'you@example.com', code, { rotate: true })` instead: you get a new admin key, and every earlier admin and spend key stops working. `requestRecovery` and `recover` take no key. They send to `api` in their options, then `SOLENOID_API`, then `https://api.solenoid.systems`, and take `fetch` in their options too.

`requestRecovery` resolves the same way whether or not the address is the account's recovery email, so it can't be used to find out which addresses have accounts. A code arrives only if it is. It also resolves when the address has had too many codes. It rejects with `rate_limited` (status 429) in one case: more than 20 recovery requests in a UTC day from one IPv4 address or IPv6 /64, on the hosted API. `recover` counts toward the same 20.

The codes. Attach codes and recovery codes are kept apart, so each rule below applies to one kind (attach or recovery) for one address, except where it says otherwise:

- A code is 6 digits. It works once, within 15 minutes.
- An address gets at most 5 codes an hour, attach and recovery together. That count includes `requestRecovery` calls for an address that isn't the recovery email. An account sends at most 10 attach codes a day. Past either, `sendEmailCode` rejects with `rate_limited`.
- Up to 3 codes work at once, so asking again doesn't cancel the code already in your inbox.
- A guess is checked against every code that is still live, so a wrong one counts once for each of them, and once when none is live. That keeps the odds of guessing a code the same however many are live. A check that could take the count past 5 in an hour or 10 in a day fails with `invalid_code`, even for the right code, until the older failures are an hour or a day old. With three codes live, one typo can be enough to block the next check.

From the terminal, the CLI does the same. `email` reads the admin key from the credentials file:

```sh
npx @solenoid.systems/cli email you@example.com
npx @solenoid.systems/cli email you@example.com <code>
npx @solenoid.systems/cli recover you@example.com
npx @solenoid.systems/cli recover you@example.com <code>
```

`recover` takes the account ID from `--tenant`, then `SOLENOID_KEY` in the environment, then `SOLENOID_KEY` in `./.env`, then the saved credentials. Add `--rotate` to the second `recover` if the old admin key may have leaked. `recover` sends to `SOLENOID_API` if it is set, and to `https://api.solenoid.systems` otherwise. It doesn't use the API saved in the credentials file, so to recover an account on another host, set `SOLENOID_API`. The second `recover` prints the admin key and saves it, with that API, to the credentials file. If the file holds another account's admin key, it refuses and leaves the file as it is, and `--force` replaces it.

**When the recovery email changes, Solenoid mails the old address.** If you didn't make the change, the admin key may have leaked. Whoever holds the recovery email can recover even a rotated admin key. While the admin key still works, run:

```sh
npx @solenoid.systems/cli email <your address>
npx @solenoid.systems/cli email <your address> <code> --rotate
```

The first command mails you a code. The second sets your address and replaces the admin key in one step, so whoever changed the address can't change it back. It prints the new admin key and saves it to the credentials file, and every old admin and spend key stops working. Derive each spend key again with `npx @solenoid.systems/cli key <scope>` and redeploy it.

From code, the same step is `sendEmailCode(address)`, then `verifyEmail(address, code, { rotate: true })`, which returns the new key as `admin_key`. Store that key before anything else: if it is lost, only recovery by email gets it back. If the call throws `Outage`, follow the steps for an `Outage` from `verifyEmail`, under Recovery above.

If the admin key has already stopped working, the first command fails with `invalid_key`, and your address can no longer recover the account. Whoever changed the address controls it. What is left is a new account with `npx @solenoid.systems/cli init --force`, which overwrites the saved admin key.

No notice goes out when an account attaches its first address, so attach your own address as soon as the account exists. Until then, whoever holds the admin key can attach theirs and nobody is mailed.

Someone who knows both the account ID and the recovery email can keep you from recovering for a while. Entering wrong codes on purpose locks code checks for up to an hour, or up to a day. Asking for codes over and over uses up the address's 5 codes an hour and pushes your code out of the 3 that work at once. Neither gives them a key or changes the account.

Anyone who shares your network can do the same without knowing either. That is anyone on your IPv4 address, including everyone behind the same shared NAT, or in your IPv6 /64. Twenty junk recovery requests from there use up the network's 20 for the UTC day, and `requestRecovery` and `recover` then reject with `rate_limited` (429) until the day rolls over. This doesn't give them a key or change the account either. Recovering from another network works.

| Error | When |
|---|---|
| `invalid_request` (400) | The account ID given to `requestRecovery` or `recover` isn't 12 characters of `a-z` and `2-7`. |
| `invalid_email` (400) | The address isn't one Solenoid can send to. |
| `invalid_code` (400) | The code is wrong, expired or used, or checks for that address are locked. |
| `invalid_key` (401) | `sendEmailCode` or `verifyEmail` was called with an admin key that was rotated. |
| `admin_required` (403) | `sendEmailCode` or `verifyEmail` was called with a spend key. |
| `rate_limited` (429) | Too many codes for the address or account, or too many recovery requests from your network. |
| `email_failed` (502) | The email couldn't be sent. Nothing was attached, so call `sendEmailCode` again. |

Every error in this table throws `SolenoidError`, `email_failed` included. The SDK never retries a recovery or email call: a network failure, or any other 5xx, throws `Outage`.

## Vendoring without an install step

A tool with no install step can copy `dist/solenoid.mjs` from the package into its own tree and import it by path. The file has no imports. For the Node file store, copy `dist/node.mjs` too; it imports only Node built-ins. The SDK needs Node 20 or later.

```js
import { solenoid, LimitExceeded } from './vendor/solenoid/solenoid.mjs'
import { fileStore } from './vendor/solenoid/node.mjs'
```

## The model

- **Scope.** A path such as `support-bot/c-8f2a`. Up to 8 segments, each 1 to 64 characters from `a-z 0-9 . _ -`. Anything else throws `TypeError`.
- **Spend.** `spend(scope, { unit: amount })` counts an amount of a unit you name, such as `emails` or `refunds`. Unit names match `^[a-z][a-z0-9_]{0,31}$`, and `spends` is reserved. Amounts are positive and kept to six decimal places. A spend with no limit over it is still recorded.
- **Limit.** Caps one unit at one scope. It applies to every spend at that scope or below it. A spend is checked against every limit on its scope and each ancestor in one transaction. If any of them would go over, nothing is counted and `spend` throws.
- **Receipt.** Every spend Solenoid records returns a signed receipt, appended to a hash chain. A spend let through by an `open` limit during an outage returns `null` and has no receipt.
- **Outage mode.** Each limit is `closed` (the default) or `open`. When Solenoid can't be reached, a closed limit throws `SolenoidUnavailable` and an open one lets the action go ahead without a record.

## Countable units: spend first, then act

```ts
await sol.spend('support-bot/c-8f2a', { refunds: 1 })
await issueRefund(order)
```

Solenoid refuses any spend that would take a unit past its limit, in the same transaction that counts it. So a unit you spend before acting stays at or under its limit while Solenoid is reachable. Two cases can go past a limit: an `open` limit during an outage, and the model-call settles described below.

If the action then fails, the spend stays counted. Nothing is refunded.

The SDK sends an idempotency key with every spend and retries once, with the same key, after a network error or a 5xx. A retried spend is counted once. To make your own retries safe, pass a key: `spend(scope, amounts, { idempotencyKey })`. A repeat with the same key and body returns the original receipt with `replay: true`. A repeat with the same key and a different body or scope throws `SolenoidError` with code `idempotency_conflict`.

## Model calls: `at(scope).llm` and `run`

Keep your provider or gateway spend cap for model spend. `llm` adds a per-scope `tokens` or `usd` limit on top of it. One `llm` call counts as one spend against your monthly allowance, because the settle that follows the hold is free.

```ts
import OpenAI from 'openai'

const openai = new OpenAI()
const res = await sol.at('support-bot/c-8f2a').llm(
  (req: OpenAI.ChatCompletionCreateParamsNonStreaming) => openai.chat.completions.create(req),
  { model: 'gpt-4.1-mini', max_completion_tokens: 1024, messages: [{ role: 'user', content: 'Summarise this ticket.' }] },
)
```

```ts
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()
const res = await sol.at('support-bot/c-8f2a').llm(
  (req: Anthropic.MessageCreateParamsNonStreaming) => anthropic.messages.create(req),
  { model: 'claude-haiku-4-5', max_tokens: 1024, messages: [{ role: 'user', content: 'Summarise this ticket.' }] },
)
```

With the [Workers AI binding](https://developers.cloudflare.com/workers-ai/configuration/bindings/), `env.AI.run(model, input)` takes the model apart from the request, so name it with `model`, which picks the price:

```ts
const model = '@cf/google/gemma-4-26b-a4b-it'
const res = await sol.at('pinky/extract').llm(
  (input: object) => env.AI.run(model, input),
  { messages: [{ role: 'user', content: 'Extract the claims.' }], max_tokens: 1200 },
  { model },
)
```

The callback's parameter is annotated so TypeScript keeps the provider's request type. Both type names come from the providers' own SDKs: [`ChatCompletionCreateParamsNonStreaming`](https://github.com/openai/openai-node/blob/v7.23.0/src/resources/chat/completions/completions.ts) in `openai`, and [`MessageCreateParamsNonStreaming`](https://github.com/anthropics/anthropic-sdk-typescript/blob/sdk-v0.128.0/src/resources/messages/messages.ts) in `@anthropic-ai/sdk`. These samples were typechecked against [`openai` 7.23.0](https://www.npmjs.com/package/openai/v/7.23.0) and [`@anthropic-ai/sdk` 0.128.0](https://www.npmjs.com/package/@anthropic-ai/sdk/v/0.128.0), and both type links point at those release tags.

When a `tokens` or `usd` limit applies to the scope, `llm` does this:

1. Reads what is left, from the last response cached for this scope or with one GET. It sends the GET when nothing is cached for this scope, when a cached figure is past its reset time, when the model has no price, and when the cached figures would refuse the call. A limit added or lowered since that response still applies, because Solenoid checks every limit when it takes the hold in step 4.
2. Estimates the input as the length in characters of your request serialised as JSON, leaving out `model` and the output-cap fields, divided by 4 and multiplied by 1.2. If the input alone doesn't fit, it throws `LimitExceeded` without calling the provider.
3. Caps the output at what is left after the input, and rewrites your request to carry that cap. A model whose price has no output (`output: 0`: an embedding, a reranker or a decision model) has nothing to cap: its request goes unchanged, and the hold is its input. With `{ shrink: false }`, a call that cannot have all the output it asks for throws `LimitExceeded` instead of going with a smaller cap; use it when output cut short is no use, as with JSON. It writes the cap into `max_completion_tokens` if your request has that field, and into `max_tokens` otherwise. It never sets both. If your request sets neither, the cap is the model's `max_output` from the bundled price table, or 4096 for a model it doesn't know.
4. **Holds** the worst case with a spend. A concurrent call that would go over the limit gets `LimitExceeded` here, before its provider call.
5. Calls the provider.
6. **Settles** the actual usage against the hold. If the provider call threw, it settles to zero, which releases the hold.

The request fields are the providers' own: `max_completion_tokens` and `max_tokens` in [OpenAI's Chat Completions reference](https://platform.openai.com/docs/api-reference/chat/create), and `max_tokens` in [Anthropic's Messages reference](https://platform.claude.com/docs/en/api/messages). For OpenAI, set `max_completion_tokens` yourself, so the SDK writes its cap there and leaves `max_tokens` alone. OpenAI's reference marks `max_tokens` as deprecated and not compatible with its reasoning models.

A settle that fails never discards a response you paid for. You get the response, and the hold stands as the recorded cost.

With no `tokens` or `usd` limit on the scope, `llm` sends your request unchanged and records the actual usage afterwards.

The SDK reads usage from these response fields:

| Response shape | Input tokens | Output tokens |
|---|---|---|
| OpenAI-compatible ([chat completion object](https://platform.openai.com/docs/api-reference/chat/object)) | `usage.prompt_tokens` | `usage.completion_tokens` |
| Anthropic ([Messages reference](https://platform.claude.com/docs/en/api/messages)) | `usage.input_tokens` + `usage.cache_read_input_tokens` + `usage.cache_creation_input_tokens` | `usage.output_tokens` |

Workers AI's text and embedding models answer in the OpenAI-compatible shape, and its decision models (Clef) in the Anthropic one. An embedding call's `usage.prompt_tokens` is what Workers AI bills: every text at the length of the call's longest (measured 4 October 2026: texts of about 3 and 400 tokens reported 804).

**Prices.** The SDK bundles a price table, in USD per token, taken from the providers' pricing pages on 24 September 2026:

| Model | Input per million | Output per million | `max_output` | Source |
|---|---|---|---|---|
| `gpt-4.1` | $2.00 | $8.00 | 32,768 | [OpenAI model page](https://platform.openai.com/docs/models/gpt-4.1) |
| `gpt-4.1-mini` | $0.40 | $1.60 | 32,768 | [OpenAI model page](https://platform.openai.com/docs/models/gpt-4.1-mini) |
| `claude-sonnet-5` | $2 | $10 | 128,000 | [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [models](https://platform.claude.com/docs/en/about-claude/models/overview) |
| `claude-haiku-4-5` | $1 | $5 | 64,000 | [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [models](https://platform.claude.com/docs/en/about-claude/models/overview) |

Workers AI models, from each model's page on 4 October 2026:

| Model | Input per million | Output per million | Source |
|---|---|---|---|
| `@cf/google/gemma-4-26b-a4b-it` | $0.10 | $0.30 | [model page](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/) |
| `@cf/baai/bge-large-en-v1.5` | $0.204 | none | [model page](https://developers.cloudflare.com/workers-ai/models/bge-large-en-v1.5/) |
| `@cf/baai/bge-reranker-base` | $0.00311 | none | [model page](https://developers.cloudflare.com/workers-ai/models/bge-reranker-base/) |
| `@cf/cloudflare/clef` | $0.24 | free | [model page](https://developers.cloudflare.com/workers-ai/models/clef/) |
| `@cf/cloudflare/clef-flash` | $0.09 | free | [model page](https://developers.cloudflare.com/workers-ai/models/clef-flash/) |

A `usd` limit on any other model throws `SolenoidError` with code `unknown_price`, before any request, unless you give a price per call or per client:

```ts
await sol.at('support-bot/c-8f2a').llm(callModel, request, { price: { input: 0.000002, output: 0.000008, max_output: 32768 } })
const priced = solenoid({ prices: { 'my-model': { input: 0.000001, output: 0.000004 } } })
```

Here `callModel` and `request` stand for the function and request from the examples above.

**`run`** gives each run its own child scope, `scope/run-<random id>`, and returns what your function returns:

```ts
const summary = await sol.run('support-bot', async (run) => {
  await run.spend({ emails: 1 })
  return run.llm(callModel, request)
})
```

Pair it with a `per: "child"` limit on `support-bot` to give every run its own budget.

## Setting limits

Limits need the admin key. From the CLI, which reads it from `~/.config/solenoid/credentials`:

```sh
npx @solenoid.systems/cli limit support-bot usd=20 --per day --warn-at 0.8 --on-outage open
```

From code, `limit(scope, body)` sends the body as it is. Every key other than `per`, `on_outage` and `warn_at` is a unit. This runs in your own admin tooling, never in the agent:

```ts
const admin = solenoid({ key: process.env.SOLENOID_ADMIN_KEY })
await admin.limit('support-bot', { usd: 20, per: 'day', on_outage: 'open', warn_at: 0.8 })
await admin.limit('support-bot', { deletes: 0 })
await admin.limit('support-bot', { emails: null })
```

A number sets the cap. `0` refuses every spend of that unit. `null` removes the limit, and is what `off` sends from the CLI. `per`, `on_outage` and `warn_at` apply to every unit in the same call. A new limit starts from the real usage already in its current window.

| `per` | Window (UTC, calendar-aligned) |
|---|---|
| omitted | lifetime |
| `"hour"` | the current hour |
| `"day"` | the current day |
| `"week"` | the current week, starting Monday |
| `"month"` | the current month |
| `"child"` | each direct child scope gets its own lifetime copy |
| `"child-day"` | each direct child scope gets its own copy, reset daily |

A `child` or `child-day` limit on `support-bot` counts `support-bot/c-8f2a` and everything under it against the copy for `c-8f2a`. A spend at `support-bot` itself doesn't count against it.

- **`on_outage`**: `"closed"` (default) or `"open"`. When several limits apply to one spend, `closed` wins.
- **`warn_at`**: a fraction above 0 and up to 1. Once a spend leaves a limit's usage at or above `warn_at` times the limit, the SDK calls your `onWarn` with `[{ scope, unit, used, limit }]`:

```ts
const sol = solenoid({ onWarn: (warnings) => console.warn(warnings) })
```

`admin.get(scope)` returns the limits over a scope with `used`, `left` and `resets`, its children, and its recent entries.

## Pro

`admin.checkout()`, on an admin-key client, returns `{ url }`, the Stripe Checkout page for Pro. `solenoid upgrade` calls it and opens that page. On an account already on Pro it throws `SolenoidError` with status 409 and code `already_pro`, and `e.detail.portal_url` is the Stripe billing portal, where the plan is managed or cancelled. While billing is not open yet, it throws `SolenoidError` with status 503 and code `billing_unavailable`. The SDK does not retry `checkout()`: a network failure, or any other 5xx, throws `Outage`.

## At-most-once

A `per: "child"` limit of 1 lets each child happen once:

```ts
await admin.limit('support-bot/refunds', { refunds: 1, per: 'child' })

await sol.spend(`support-bot/refunds/${orderId}`, { refunds: 1 })
await issueRefund(orderId)
```

The second spend for the same `orderId` throws `LimitExceeded`. If the process dies between the spend and the refund, the refund doesn't happen and a retry is refused. That is at most once, so reconcile from the receipts.

If you pass your own `idempotencyKey` here, a repeat with that key returns the first receipt with `replay: true` instead of throwing. Check `receipt.replay` before you act.

## Errors

```ts
import { LimitExceeded, SolenoidError, SolenoidUnavailable } from '@solenoid.systems/sdk'

try {
  const receipt = await sol.spend('support-bot/c-8f2a', { emails: 1 })
  if (receipt === null) log('Solenoid unreachable; an open limit let this through unrecorded')
  await send(email)
} catch (e) {
  if (e instanceof LimitExceeded) log(e.scope, e.unit, e.resets)
  else if (e instanceof SolenoidUnavailable) log(e.scope, e.cause)
  else if (e instanceof SolenoidError) log(e.status, e.code, e.detail)
  else throw e
}
```

`log` stands for your own logger.

A yes/no gate that decides whether an action may run:

```ts
export async function mayAct(scope: string, unit: string): Promise<boolean> {
  try {
    await sol.spend(scope, { [unit]: 1 })
    return true
  } catch (e) {
    if (e instanceof LimitExceeded && e.unit === unit) return false
    if (e instanceof SolenoidUnavailable) return false
    throw e
  }
}
```

The gate refuses in two cases: `LimitExceeded` for the unit it governs, and `SolenoidUnavailable`. `SolenoidUnavailable` means Solenoid couldn't be reached after one retry, and the outage mode in the local cache was `closed`. The SDK reads that mode from the nearest scope with a cached entry, and with nothing cached the mode is `closed`. So on a new machine, or in a new process with the default in-memory cache, even a limit set to `open` behaves as `closed` until one successful spend has cached its mode. `null` from `spend` means the cached mode was `open`, so the gate allows the action. Anything else is rethrown, including `LimitExceeded` for another unit, such as the monthly `spends` allowance.

| Result | When |
|---|---|
| `LimitExceeded` | A limit would go over. `scope` is the scope that holds the limit, `unit` the unit, and `resets` an ISO time or `null` for lifetime and child limits. `detail` carries `limit`, `used` and `requested`. It extends `SolenoidError`, with status 402. |
| `SolenoidUnavailable` | Solenoid couldn't be reached after one retry, and the outage mode in the local cache was `closed` (see the gate above). `cause` holds the network error. It extends `Error` directly, so `instanceof SolenoidError` is false for it. |
| `null` from `spend` | Solenoid couldn't be reached, and an `open` limit let the action through. Nothing was recorded. |
| `SolenoidError` | Any other refusal, with `status` and `code`. Status 401: `invalid_key`, which includes a rotated key. Status 403: `out_of_scope`, `admin_required`. Status 409: `idempotency_conflict`, `already_pro`. Status 400: `invalid_limit`, `invalid_unit`, `invalid_amount`. Status 503: `billing_unavailable`. Status 0: `unknown_price`, thrown by the SDK before any request. The two billing codes are described under [Pro](#pro). The recovery calls have codes of their own, listed under [Recovery](#recovery). |
| `TypeError` | A bad scope or amount, no key, or an API that is not an `http` or `https` URL with no user, password, query or fragment and on a port that fetch allows. Thrown before any request. |

On the free plan, after 100,000 recorded spends in a UTC calendar month, `spend` throws `LimitExceeded` with unit `spends` at scope `""`. Check `e.unit` if you map `LimitExceeded` to your own budget error. Pro has no such cap.

## Short-lived processes

The outage mode comes from Solenoid. Each successful spend tells the SDK the mode of the limits it met, and the SDK caches it at the spend's scope and at each scope that holds one of those limits. During an outage the SDK uses the cached mode of the nearest scope. That is how a new `run-*` or per-session scope inherits `open` from its parent. With nothing cached, the mode is `closed`.

The default cache lives in memory and lasts one process, so a CLI or a one-process-per-request tool starts every run with nothing cached. `fileStore`, imported from `@solenoid.systems/sdk/node`, keeps the cache in a file that every process on the machine using it shares:

```ts
import { solenoid } from '@solenoid.systems/sdk'
import { fileStore } from '@solenoid.systems/sdk/node'

const sol = solenoid({ store: fileStore() })
```

`fileStore()` writes `~/.cache/solenoid/outage.json`. `fileStore(dir)` writes `<dir>/outage.json` instead, for example `fileStore('/var/cache/myapp')` writes `/var/cache/myapp/outage.json`. A tool may pass its own data directory, so the outage cache lives with the rest of its state. A process only finds a mode that an earlier spend on that machine cached. The `solenoid` CLI uses `fileStore()` too, so its spends and SDK clients on the default directory share one cache when they run as the same OS user. If the file can't be written, the spend still returns its receipt, and `fileStore` emits a Node warning that names the file. When two processes write at once, the last write wins, and a scope whose entry was lost falls back to its nearest cached ancestor, or to `closed`. Any object with `get(scope)` and `set(scope, mode)` works as a store, sync or async. A custom store's `set` must not throw or reject: the SDK awaits it after Solenoid has recorded the spend, so an error there turns a recorded spend into a thrown error, and a retry spends again.

## Receipts

```ts
const receipt = await sol.spend('support-bot/c-8f2a', { emails: 1 })
await sol.verify(receipt!)
```

`verify` fetches Solenoid's public keys once from `/.well-known/solenoid.json` on the API, then checks the receipt's hash and Ed25519 signature locally. When a receipt's `kid` is missing from the keys it has, it fetches them again before it decides, from a URL with a fresh query string that no HTTP cache holds, so a receipt signed with a key Solenoid adopted after the client started still verifies. It fetches again at most once every 5 seconds, shared across every unknown `kid`, and gets `false` for an unknown `kid` it meets inside that interval. If that fetch fails, it keeps the keys it has, so the unknown `kid` gets `false`. It returns `false` for any altered field. To verify with no network at all, save that file's `keys` and call `verifyChain([receipt], keys)`, imported from `@solenoid.systems/sdk`. It reads only the saved object's own keys, so a `kid` the file lacks gets `false`.

`verifyChain(entries)` checks that consecutive entries link by hash and that each one is signed. Entries must be consecutive and in ascending order. Only the root scope's pages hold consecutive entries, because every scope shares one chain, and reading the root needs the admin key. `get` returns entries newest first, 50 per page. To check more than one page, pass each page's `next` as `before` to get the page below it, concatenate the pages, and reverse the result. One page:

```ts
const view = await admin.get('')
await admin.verifyChain([...view.entries].reverse())
```

## Testing

`testServer()`, from `@solenoid.systems/testing`, runs Solenoid inside your test process. It is the hosted API's own request handler and ledger code, so the package is licensed FSL-1.1-ALv2, unlike the MIT SDK. Install it with `npm i -D @solenoid.systems/testing`. Your tests hit the same limit checks your agent does, and no request leaves the process. It needs Node 22.5 or later, and Node 22.5 to 22.12 and 23.0 to 23.3 also need the `--experimental-sqlite` flag ([Node SQLite docs](https://nodejs.org/api/sqlite.html)). On older Node it throws an error that says so. The SDK runs on Node 20 or later.

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LimitExceeded, solenoid } from '@solenoid.systems/sdk'
import { testServer } from '@solenoid.systems/testing'

test('refuses the fourth email in one conversation', async () => {
  const server = await testServer()
  const { admin_key } = await server.signup()
  const admin = solenoid({ key: admin_key, api: server.api, fetch: server.fetch })
  await admin.limit('support-bot', { emails: 3, per: 'child' })
  const sol = solenoid({ key: await admin.deriveKey('support-bot'), api: server.api, fetch: server.fetch })

  for (let i = 0; i < 3; i++) await sol.spend('support-bot/c-1', { emails: 1 })
  await assert.rejects(sol.spend('support-bot/c-1', { emails: 1 }), LimitExceeded)
})
```

This runs under `node --test`. For vitest, import `test` from `vitest` instead; the rest stays the same.

`await testServer()` returns:

| Field | What it does |
|---|---|
| `fetch` | Answers Solenoid requests inside the process. Pass it to `solenoid({ fetch })` along with `api: server.api`. |
| `api` | The base URL that `fetch` answers: `http://solenoid.test`. |
| `signup()` | Creates a tenant and returns `{ tenant, admin_key }`. It has no rate limit. |
| `setNow(ms)` | Sets the ledger's clock to `ms`, in milliseconds since the Unix epoch. The clock stays at that time until the next `setNow`. Before the first `setNow`, the clock reads the wall time. |
| `outage(on)` | While `on` is `true`, every call to `fetch` rejects with `TypeError`, as a network failure does. |
| `outbox()` | Resolves to every email the server has sent, oldest first, as `{ to, subject, text }`. It first waits for sends still in flight, such as the recovery code, which goes out after `requestRecovery` resolves. |
| `mailDown(on)` | While `on` is `true`, every email fails to send. `sendEmailCode` then rejects with `email_failed`, and a recovery code is dropped while `requestRecovery` still resolves. |

Each server makes its own signing key, and `verify` and `verifyChain` check receipts against that server's `/.well-known/solenoid.json`. Two servers share no tenants and no keys.

`setNow` moves a test into the next window without waiting for it. These lines can go at the end of the test above, using its `server`, `admin` and `sol`. The new `limit()` on `support-bot` for `emails` replaces the `per: 'child'` one, because a scope holds one limit per unit.

```ts
server.setNow(Date.UTC(2030, 0, 1, 10, 30))
await admin.limit('support-bot', { emails: 1, per: 'hour' })
await sol.spend('support-bot', { emails: 1 })
await assert.rejects(sol.spend('support-bot', { emails: 1 }), LimitExceeded)
server.setNow(Date.UTC(2030, 0, 1, 11))
await sol.spend('support-bot', { emails: 1 })
```

`outage` tests what your code does when Solenoid can't be reached. This one is a test of its own, on a fresh server:

```ts
test('lets an email through unrecorded when Solenoid is down and the limit is open', async () => {
  const server = await testServer()
  const { admin_key } = await server.signup()
  const admin = solenoid({ key: admin_key, api: server.api, fetch: server.fetch })
  await admin.limit('support-bot', { emails: 3, on_outage: 'open' })
  const sol = solenoid({ key: await admin.deriveKey('support-bot'), api: server.api, fetch: server.fetch })

  await sol.spend('support-bot/c-1', { emails: 1 })
  server.outage(true)
  assert.equal(await sol.spend('support-bot/c-1', { emails: 1 }), null)
})
```

The first spend caches the limit's `open` mode in `sol`. During the outage, `sol` uses the mode cached for the nearest scope, the spend's own or a parent's (see [Short-lived processes](#short-lived-processes)). A client with nothing cached throws `SolenoidUnavailable` instead.

Recovery runs against `testServer()` too, and `outbox()` holds the emails it would have sent. Another test of its own:

```ts
import { recover, requestRecovery } from '@solenoid.systems/sdk'

const codeIn = (text: string) => /\b\d{6}\b/.exec(text)![0]

test('gets the admin key back by email', async () => {
  const server = await testServer()
  const { tenant, admin_key } = await server.signup()
  const admin = solenoid({ key: admin_key, api: server.api, fetch: server.fetch })
  const o = { api: server.api, fetch: server.fetch }

  await admin.sendEmailCode('you@example.com')
  await admin.verifyEmail('you@example.com', codeIn((await server.outbox())[0].text))

  await requestRecovery(tenant, 'someone-else@example.com', o)
  assert.equal((await server.outbox()).length, 2)

  await requestRecovery(tenant, 'you@example.com', o)
  const code = codeIn((await server.outbox()).at(-1)!.text)
  assert.equal((await recover(tenant, 'you@example.com', code, o)).admin_key, admin_key)
})
```

After `verifyEmail` the outbox holds two emails: the attach code and the confirmation. The request for an address that isn't the recovery email resolves and sends nothing.

If the code under test makes its own client with `solenoid()`, route its requests to the server with [MSW 2](https://mswjs.io/). `solenoid()` reads `SOLENOID_API` and `SOLENOID_KEY`, and takes the global `fetch`, when it is called. So call `listen()` and set both variables before the code under test builds its client. A module that builds its client when it loads must be imported after that:

```ts
import { http } from 'msw'
import { setupServer } from 'msw/node'
import { solenoid } from '@solenoid.systems/sdk'
import { testServer } from '@solenoid.systems/testing'

const server = await testServer()
const mocks = setupServer(http.all(`${server.api}/*`, ({ request }) => server.fetch(request)))
mocks.listen()

const { admin_key } = await server.signup()
const admin = solenoid({ key: admin_key, api: server.api, fetch: server.fetch })
await admin.limit('support-bot', { emails: 3, per: 'child' })
process.env.SOLENOID_API = server.api
process.env.SOLENOID_KEY = await admin.deriveKey('support-bot')

const { sendGuarded } = await import('./app.js')
```

Here `./app.js` stands for your module that calls `solenoid()` at load, such as the one with `sendGuarded` in the [Quickstart](#quickstart).

## Known bounds

- **The input estimate can be low.** A request whose real input is larger than the estimate can end above a `tokens` or `usd` limit. Settle records the real usage afterwards.
- **The SDK does not read usage from streamed responses.** A held call with a streamed response is recorded at its full hold, and a call with no `tokens` or `usd` limit records nothing.
- **Anthropic cache writes are counted at the base input rate.** [Anthropic's prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) price 5-minute cache writes at 1.25 times the base input rate and 1-hour writes at 2 times. A `usd` limit undercounts them, so heavy cache writing can take real cost past the limit. Cache reads cost 0.1 times the base rate on the same page, and the SDK counts them at the full base rate, which overcounts them and errs toward the limit.
- **A very cheap call counts as a millionth of a dollar.** Amounts are rounded up to six decimal places, so a call that costs less, such as a short reranker call at about $0.00000006, is recorded as $0.000001. It errs toward the limit.
- **Omitting the output cap gives the default.** Under a `tokens` or `usd` limit, a request with no `max_tokens` or `max_completion_tokens` is capped at the model's `max_output`, or 4096. Set it yourself if you need longer output.
