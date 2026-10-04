# Solenoid

Limits on the actions your AI agents take, checked before each action, with a signed receipt for every one.

An agent with tools can send one customer the same email forty times. Your agent's tools call Solenoid before they send an email, issue a refund or delete a record. A call that would go past its limit is refused, and the action never runs. For example, after `npx @solenoid.systems/cli limit support-bot emails=3 --per day`, a tool that spends `emails: 1` at `support-bot` before each send is refused on its fourth send in a UTC day. Solenoid only limits the tools that call it first.

Every spend Solenoid records returns a receipt that Solenoid signs. You can verify it offline with the public keys from https://api.solenoid.systems/.well-known/solenoid.json.

## Start

In your project's root:

```sh
npx @solenoid.systems/cli init support-bot
```

It creates your account with no signup form, prints the admin key once, and writes a spend key for `support-bot` to `.env` as `SOLENOID_KEY`. If `.env` already has a `SOLENOID_KEY`, `init` leaves it as it is and prints the new key for you to place. Keep a copy of the admin key somewhere safe: it sets your limits, and `init` shows it only once.

Then point your coding agent at https://solenoid.systems/llms.txt. It tells the agent how to add a spend call before each action a tool takes, using the key in `.env`.

## What is here

| Directory | What | License |
|---|---|---|
| `worker/` | The API: one Cloudflare Worker and one Durable Object per account | FSL-1.1-ALv2 |
| `testing/` | `@solenoid.systems/testing`, the API in your test process | FSL-1.1-ALv2 |
| `e2e/` | End-to-end tests against a local Worker, the race recorder and the canary | FSL-1.1-ALv2 |
| `sdk/` | `@solenoid.systems/sdk` | MIT |
| `cli/` | `@solenoid.systems/cli` | MIT |
| `mcp/` | `@solenoid.systems/mcp` | MIT |
| `site/` | solenoid.systems | MIT |

`LICENSING.md` maps every directory to its license. The server is source-available under FSL-1.1-ALv2; each version becomes Apache 2.0 two years after its release.

Docs: https://solenoid.systems/docs. Pricing: https://solenoid.systems/pricing.

Report a security issue to security@solenoid.systems (see `SECURITY.md`). The runbook is `docs/runbook.md`.
