# Solenoid site: solenoid.systems for the new product

**Status:** design, revised after two cold reviews (2026-09-29)
**Date:** 2026-09-29
**Builds on:** `2026-09-24-solenoid-governance-design.md` (its Site, Plans and billing, and Migration sections) and `docs/copy/brief.md`
**Part of:** Plan 3a, "go live"
**Supersedes, in the governance spec:** "Upgrading is `solenoid upgrade`. It opens a Stripe Payment Link … The upgrade needs no server endpoint." Payment Links cannot sell the metered overage price, so the upgrade goes through one Worker endpoint that creates a Checkout Session (see Billing). This also closes that spec's first risk.

## Intent

`solenoid.systems` still serves the old twelve-product site. This spec replaces it with a site for the one product Solenoid now is: limits on the actions AI agents take, checked before the action, with a signed receipt for each one.

The site is written for one reader: the lead engineer from the copy brief. Its job is to get that reader to run `npx @solenoid.systems/cli init <scope>` in their project and then hand the integration to their coding agent.

Success means:

1. Every claim on the site is sourced. Four of the sources are files a reader can open at the launch tag: the concurrency, hold-and-settle and at-most-once tests (three `it` blocks in `e2e/test/concurrency.test.ts`), and the license files.
2. Every reader-facing unit has passed a three-run cold copy-chief grade with Gate 0 clear.
3. Every old page and published file in the old-site fixture (see Redirects) either answers 200 on the new site or redirects to a page that answers 200. None answers 404. The old hashed build assets under `/_astro/` are outside this: nothing links to them by URL.
4. `/llms.txt` is `sdk/llms.txt` byte for byte, `/llms-full.txt` is exactly the bytes defined under Pages, and `/docs` renders `sdk/README.md`.

## Decisions (Robin, 2026-09-29)

- **The repository goes public at launch, from one squashed snapshot commit.** The private repository keeps the full history as a frozen archive. Personal data is scrubbed from every file before the snapshot (see Launch order, step 4).
- **The code is split by license.** Code that runs the Solenoid server is licensed FSL-1.1-ALv2. Client code is MIT. The test server moves out of the SDK into its own FSL package so the MIT SDK contains no Worker code. See Licensing.
- **The race demo replays a recording made by a dedicated recorder script** that runs the same race as the e2e test against a local Worker. The page links both files: the test is the proof, and the recorder is the transcript's source. There is no live demo backend.
- **Social proof at launch is a short founder note**, at `/why`. There are no customer or usage numbers until real ones exist.
- **The hero call to action has two steps.** Step 1 is `npx @solenoid.systems/cli init <scope>`, run in the project's root, with a literal scope named for the agent. It is the human's step because it creates the account and prints the admin key, and `llms.txt` tells the agent that the developer runs it in their own terminal (`sdk/llms.txt`, Setup). Step 2 is a copyable prompt that sends the reader's coding agent to `solenoid.systems/llms.txt` and tells it the spend key is in `.env` as `SOLENOID_KEY`.
- **The page opens on the failure moment and brings in the mechanism second.** The copy brief settles this in §1: the reader is problem-aware about actions.
- **The copy chief runs the copy.** Wording questions don't go to Robin. Each unit is drafted against the brief, graded by three cold runs, and fixed until Gate 0 is clear and every finding is fixed or explicitly accepted. Robin reads graded results.
- **Analytics is Umami**, self-hosted at `analytics.omit.nz` and cookieless. It records page visits, including the `?ref=` tag on inbound links, and nothing more: it does not tie a visit to an `init`, and the copy never claims it does. The privacy page names it.
- **The licensor is "Robin Lange, trading as omit".** omit is a New Zealand sole-trader trading name, so it cannot hold copyright on its own. The name appears in the `LICENSE` files, `LICENSING.md` and the privacy page. Stripe's public business name may be "omit".
- **No GST.** Robin is not GST-registered, so Stripe Tax is off and prices are shown as they are, in USD.
- **Contacts.** Cloudflare Email Routing forwards `privacy@solenoid.systems` and `security@solenoid.systems` to Robin's inbox. The forwarding target is never written in the repository.
- **The site lives in the `solenoid` monorepo as `site/`.** The old `solenoid.systems` repository is archived in Plan 3b. Its CI workflow deploys both the old site and the old API, so the workflow is disabled and its token removed before cutover (Launch order, step 9).
- **DMARC is in place** as of 2026-09-29: `_dmarc.solenoid.systems TXT "v=DMARC1; p=none"`. It has no `rua`, on purpose: a report address would publish a personal email in DNS. Follow-up: tighten to `p=quarantine` once Resend deliverability is confirmed.

## Licensing

| Directory | License | Why |
|---|---|---|
| `worker/` | FSL-1.1-ALv2 | The server |
| `testing/` (new, `@solenoid.systems/testing`) | FSL-1.1-ALv2 | It bundles the Worker's request handler and ledger |
| `e2e/` | FSL-1.1-ALv2 | It drives the Worker, and it holds the proof tests and the race recorder |
| `sdk/`, `cli/`, `mcp/` | MIT | Clients |
| `contract/` | MIT | Client-side scenarios written against the SDK |
| `docs/superpowers/` (specs, plans, records, reviews) | FSL-1.1-ALv2 | The plans contain the Worker's source, for example the full text of `worker/src/chain.ts` and `keys.ts` in the core plan |
| `site/`, the rest of `docs/`, root files | MIT | Site and documentation |
| `site/public/fonts/` | SIL Open Font License 1.1 | Archivo and JetBrains Mono, carried over; the OFL text ships beside them |

- **The test server moves.** `sdk/src/testing.ts` imports `Tenant`, `Mail` and `handle` from `worker/src`, and the SDK publishes the bundle as `./testing` under MIT. It moves to a new workspace package, `testing/`, published as `@solenoid.systems/testing` with `"license": "FSL-1.1-ALv2"`. The SDK drops its `./testing` export, its third esbuild step and `tsconfig.testing.json`, so its bundle holds no Worker code. The tests in `sdk/`, `cli/` and `mcp/` import the test server from `testing/`. Nothing is published yet, so the import path change costs nothing.
- **Where its tests go.** `sdk/test/testing.test.ts`, which runs the contract scenarios against `testServer()`, moves to `testing/test/`. The SDK's Stryker run stops mutating `testing.ts`, and `testing/` gets its own Stryker config over `testing/src`, with `inPlace: true` as the SDK uses today. Every consumer (the tests in `sdk/`, `cli/` and `mcp/`) imports `../../testing/src/index` by relative path, because in-place Stryker relies on relative imports (`docs/testing/MUTATION-SUMMARY.md`).
- **The docs follow.** The Testing section of `sdk/README.md` and the matching lines of `sdk/llms.txt` change to `npm i -D @solenoid.systems/testing` and `import { testServer } from '@solenoid.systems/testing'`, and say that package is FSL. `testing/README.md` is new. All three are regraded (see Copy process).
- **Identifier and terms.** The SPDX identifier is `FSL-1.1-ALv2` everywhere, including `"license"` in `worker/package.json` (which has none today) and `e2e/package.json`. Copy describes the license by its own terms, from the [fsl.software template](https://fsl.software/FSL-1.1-ALv2.template.md): anyone may use, change and redistribute the Worker for any purpose except a Competing Use, which is making it available to others in a commercial product or service that substitutes for it or offers substantially similar functionality. Internal use, non-commercial education and non-commercial research are permitted. Each version becomes Apache 2.0 on the second anniversary of its release. The Worker is called "source-available" and never "open source", because FSL is not an OSI license.
- **Files.** Each directory in the table carries a `LICENSE`. The root gets `LICENSING.md`, which maps each directory to its license. There is no root `LICENSE`, so GitHub's sidebar shows no single license; that is accurate for a split repository.
- **The lawyer glance** covers the licenses, the licensor name ("Robin Lange, trading as omit") in the FSL notice, `LICENSING.md`, this split and the FSL on `docs/superpowers/`. It happens inside step 4 of the launch order, before the repository becomes public.

## Architecture

`site/` is an Astro 5 and Tailwind 3 package in the pnpm workspace, beside `worker/`, `testing/`, `sdk/`, `cli/`, `mcp/` and `e2e/`. `pnpm-workspace.yaml` adds `site` and `testing`. `contract/` stays a plain directory with no `package.json`, imported by relative path. The site has `test`, `test:changed` and `typecheck` scripts, so lefthook's `test:changed` and `typecheck` hooks cover it like the other packages.

Astro builds with `build: { format: 'file' }` and `trailingSlash: 'never'`, so `/pricing` is `dist/pricing.html`, served at `/pricing` with a 200, and `/pricing/` redirects to `/pricing`. `@astrojs/sitemap` generates `/sitemap-index.xml` and `/sitemap-0.xml`, and `/robots.txt` points at the index, so the old sitemap files keep answering.

### What comes over from the old site

The "Living Schematic" look comes over. Each piece of the old site is decided here:

| Piece | Decision |
|---|---|
| `Layout` | Comes over, stripped. `ClientRouter` and its field collapse and expand script are dropped. `description` becomes a required prop, so the old default ("Serverless APIs for modern developers") is gone and each page's description is graded copy. The Umami script stays, disclosed on `/privacy`. The layout adds `<link rel="canonical">` to the apex URL, and Open Graph and Twitter title and description tags. |
| `styles/global.css` | Moves to `site/src/styles/`, without the page-transition rule. |
| `MagneticField`, `MagneticFieldTitle` | Come over with `src/lib/pixi/{magnetic-field-singleton,field-renderer,title-renderer,field-config,utils}.ts` and `pixi.js`. Every `[DIAG]` `console.log` is removed. Each page sets `hasField`; `/docs` sets it to false. |
| Tokens | `src/lib/design-tokens.ts` (`#101012`, `#E4E4E7`, `#FF3F00`), `tailwind.config.ts` and `@tailwindcss/typography`, which styles the docs prose. |
| `@/` alias | Comes over from `astro.config.mjs`. |
| Fonts | The five files that exist in `public/fonts/` are copied to `site/public/fonts/`: Archivo 400, 500, 700 and 900, and JetBrains Mono 400. The `@font-face` rules are rewritten to those local URLs. The old `styles/fonts.css` also declares JetBrains Mono 500 and 700 through `@fontsource` URLs with no file behind them; those two rules are dropped, along with any class that asks for those weights in the mono face. The `@fontsource` packages stay behind. The OFL text ships beside the fonts. |
| `favicon.svg` | Comes over. |
| `Header` | Rewritten with the old styling. Its nav is Docs, Pricing, Why, GitHub. It drops `getCollection('docs')` and `listedProducts`. |
| `AutoTypingTerminal` | Stays behind. A new, small `RaceTerminal` keeps its window chrome and replays the race (see The race). |
| `CodeTabs` | Rewritten to take its tabs as props. The landing page passes two: the TypeScript SDK and the CLI. There is no Python tab, because there is no Python SDK in v1, and no curl tab, because the HTTP API is not documented for direct use. |
| `BottomCTA` | Rewritten with the old styling. All of its copy ("Get API Key", `sm_...`, the `/blog` and `/solenoid-mcp` links) is replaced by the two-step call to action. |
| `prismjs` | Stays behind. Code is highlighted at build time by Astro's built-in Shiki, themed to the tokens. |
| The `docs` content collection | Stays behind. `/docs` imports `sdk/README.md` directly. |
| Preact, MDX, RSS, the blog, `products.ts` and every other component | Stay behind. |

### Pages

| Path | Content |
|---|---|
| `/` | The landing page (below). |
| `/pricing` | Free: 100,000 spends each UTC calendar month. Pro: $29 USD a month including 2M spends, then $10 USD per extra million. The call to action is `npx @solenoid.systems/cli upgrade`, preceded by `init <scope>` for a reader with no account yet; it opens Stripe Checkout. The page also says how to cancel (the Stripe customer portal) and states the refund terms Robin sets. Prices are shown as they are, since no GST applies. The site itself has no checkout. |
| `/docs` | `sdk/README.md`, imported as Markdown at build time. Its `getHeadings()` builds the contents sidebar, and heading IDs follow GitHub's slugs, so the README's own `#` links work on both. |
| `/llms.txt` | `sdk/llms.txt`, byte for byte. |
| `/llms-full.txt` | The bytes of `sdk/llms.txt`, then one `\n`, then the bytes of `sdk/README.md`. `llms.txt` already ends in `\n`, so the two files are separated by one blank line. |
| `/why` | The founder note: who built Solenoid and why. It makes first-party claims, plus incidents from the brief's sourced table, each cited and "told with care". |
| `/privacy` | The data inventory under Privacy. |
| `/404` | `dist/404.html`, served for any path with no file and no redirect. It links to `/` and `/docs`. |

### The landing page, top to bottom

1. **Hero.** The failure moment, then the mechanism line, then the two-step call to action. The magnetic field sits behind it.
2. **The race.** `RaceTerminal` replays the recording: 30 concurrent spends against a limit of 7, where exactly 7 are recorded and 23 are refused. The copy says "spends", since the race sends nothing. It links the e2e test and the recorder, both at the launch tag.
3. **One call.** `CodeTabs` shows the spend call placed before the action, in TypeScript and in the CLI.
4. **The receipt.** A real production receipt, and how to verify it offline: `verifyChain([receipt], keys)` imported from `@solenoid.systems/sdk`, with `keys` fetched once from `https://api.solenoid.systems/.well-known/solenoid.json` and saved.
5. **What it limits.** Actions and at-most-once. For model spend, the page says "keep your gateway for that", as the brief requires.
6. **When Solenoid is down.** It fails closed by default, and `on_outage` can be set per limit. This is the brief's risk reversal, stated outright.
7. **Pricing strip.** It links to `/pricing`.
8. **Why this exists.** A short excerpt of the founder note, linking to `/why`.
9. **Bottom call to action.** The same two steps as the hero.

The section titles above describe structure. They are not copy.

### The race

`e2e/record-race.ts` performs the race itself against a local `wrangler dev`. It starts and stops wrangler with the same code as `e2e/global-setup.ts`, which moves into a shared module so both use it. It runs the same scenario as the first test in `e2e/test/concurrency.test.ts`: a fresh account, `limit acme calls=7`, a spend key for `acme/bot`, and 30 concurrent `spend('acme/bot', { calls: 1 })` calls, each from its own client.

For each call it records when the call started and settled, in milliseconds from the first send, and its outcome. It then asserts the same counts the test asserts: 7 recorded, 23 refused with `402 limit_exceeded`, and `ls acme` showing `used 7`. If any count is off, it exits non-zero and writes nothing. Otherwise it writes `site/src/data/race.json`:

```json
{
  "limit": 7, "calls": 30, "recorded": 7, "refused": 23,
  "lines": [{ "at_ms": 38, "text": "…" }],
  "sources": { "e2e/test/concurrency.test.ts": "<sha256>", "e2e/record-race.ts": "<sha256>" }
}
```

`lines` are ordered by settle time. Their text format is part of the race section's copy unit and is graded with it. The file is committed. The recorder runs on demand only, because it starts wrangler. No transcript is typed by hand.

`RaceTerminal` takes `race.json` as a prop. It renders every line into the HTML at build time, so the page reads correctly with no JavaScript. Its script then clears the lines and replays them at their recorded timing. Its height fits all 30 lines. Under `prefers-reduced-motion` the script does not run, and the final state stays on screen. The script starts on page load; there is no `astro:page-load`, since `ClientRouter` is gone.

### The receipt

The receipt comes from production, which has been live with its signing keys since Plan 1. A dedicated demo tenant is made for it in step 1 of the launch order, with `solenoid init` under a throwaway `SOLENOID_CONFIG_DIR`. It is never Robin's tenant or any real account. It makes one spend, and `site/src/data/receipt.json` saves that receipt plus the tenant's chain entries, ascending, read with its admin key. `site/src/data/keys.json` is the `keys` object from `/.well-known/solenoid.json`. Both are committed in step 1, so the site test that runs `verifyChain` on them passes from then on. This is also what the section tells the reader to do. The demo tenant's ID becomes public with the receipt. It holds nothing else, and its admin key is stored with the Worker secrets in 1Password.

### Serving

The site is an assets-only Worker. `site/wrangler.jsonc` has no `main`, no service binding and no `fetch` handler:

```jsonc
{
  "name": "solenoid-systems",
  "compatibility_date": "2026-09-01",
  "assets": { "directory": "./dist", "not_found_handling": "404-page", "html_handling": "drop-trailing-slash" },
  "routes": [
    { "pattern": "solenoid.systems", "custom_domain": true },
    { "pattern": "www.solenoid.systems", "custom_domain": true }
  ]
}
```

- **Both custom domains are declared.** The routes block is the old site's, verbatim. Whether a deploy with no routes detaches existing custom domains is unverified, so the config never relies on it.
- **Redirects are a `_redirects` file** in `site/public/`. Cloudflare applies it before assets and follows a redirect "regardless of whether or not an asset matches" ([Workers redirects](https://developers.cloudflare.com/workers/static-assets/redirects/)). The limit is 2,000 static and 100 dynamic rules.
- **Headers are a `_headers` file** in `site/public/`:
  - on every path: `Strict-Transport-Security: max-age=31536000`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Content-Security-Policy: frame-ancestors 'none'`;
  - on `/llms.txt` and `/llms-full.txt`: `Content-Type: text/plain; charset=utf-8`, because both files contain U+2026, and a client that assumes ISO-8859-1 for `text/*` mis-decodes it.
- `/.well-known/security.txt` (with `Contact: mailto:security@solenoid.systems` and an `Expires` a year out) and a root `SECURITY.md` ship with the site and the repository.
- `www` serves the same pages, and each page's canonical link names the apex.

### Redirects

The old site's paths are a committed fixture, `site/test/fixtures/old-paths.txt`, one path per line. `site/scripts/old-paths.mjs` generates it from four sources:

- the live sitemap: `/sitemap-0.xml` (94 URLs), fetched with a GET;
- `git -C ~/dev/solenoid.systems ls-files public`, which includes the 56 Markdown mirrors under `public/docs/`, the eight root product mirrors, `/witness-verifier.html`, `/api/benchmarks/results.json`, `/downloads/solenoid.mcpb`, the fonts, `robots.txt` and `favicon.svg`;
- the file list of the old `dist/`, minus `/_astro/*`. Those 31 files are hashed build output that nothing links to by URL. A `/_astro/*` redirect would also catch the new site's own scripts and styles, because Cloudflare follows a redirect whether or not an asset matches;
- the routes under the old `src/pages` (including `/witness/verify`, `/checkout/success` and `/oauth/{authorize,verify,error}`), plus `/api/health`, `/status`, `/sitemap-index.xml` and `/rss.xml`.

The generator runs once before cutover, and its output is committed. `_redirects` is written by hand as prefix rules, top-most first:

| Old path | Status | To |
|---|---|---|
| `/catch.md`, `/gate.md`, `/key.md`, `/latch.md`, `/meter.md`, `/pulse.md`, `/relay.md`, `/witness.md` | 301 | `/llms.txt` |
| `/api`, `/api/*` | 301 | `/` |
| `/docs/*` (every old docs page and docs mirror) | 301 | `/docs` |
| `/blog`, `/blog/*`, `/rss.xml` | 302 | `/` |
| `/catch`, `/gate`, `/key`, `/latch`, `/meter`, `/pulse`, `/relay`, `/witness`, `/nexus`, `/solenoid-mcp`, each with `/*` | 301 | `/` |
| `/billing`, `/checkout`, `/oauth`, `/downloads`, `/philosophy`, `/status`, `/demos`, `/witness-verifier`, each with `/*`; `/witness-verifier.html` | 301 | `/` |

- `/api/*` is the only path that still reaches the old gateway today, through the old site's service binding. The governance spec settled that old keys stop working with no compatibility layer, so `/api/*` answers 301 to `/` like any other old path. A client that follows the redirect with a POST gets the home page's HTML. No old client is supported.
- Every exact rule has a `/*` companion, and a `/*` splat also matches the trailing-slash form (`/philosophy/`, as the live sitemap lists it). So the table is right whether or not Cloudflare's exact rules match a trailing slash. Step 1 checks that once with `wrangler dev`; if exact rules do match, the companions are harmless.
- The blog paths use 302, so browsers don't cache a redirect a future blog would have to undo.
- The pages the new site has (`/`, `/pricing`, `/privacy`, `/docs`, `/llms.txt`, `/llms-full.txt`, `/robots.txt`, `/favicon.svg`, `/fonts/*`, the sitemaps) answer 200 from the new build. Old URLs with a trailing slash redirect to the same path without one.

## Billing

Plan 3a builds Stripe per the governance spec's Plans and billing section: the webhook, pro marking, meter reporting and the `solenoid upgrade` command. One thing changes, because of what Stripe supports.

**Payment Links cannot sell the metered overage price.** Stripe lists the pricing models Payment Links support as flat rate and tiered for recurring products, and flat rate and package pricing for one-off products ([Payment Links API](https://docs.stripe.com/payment-links/api)). Usage-based pricing is not among them. The Payment Link API requires `quantity` on every line item, while Checkout Sessions say "Quantity should not be defined when `recurring.usage_type=metered`" ([Create a Checkout Session](https://docs.stripe.com/api/checkout/sessions/create)). So a Checkout Session can carry the metered price, and a Payment Link cannot.

- **Prices, in USD.** A licensed monthly price of $29, and a metered monthly price on the `spends` Billing Meter with graduated tiers: 0 to 2,000,000 at $0, then 0.001 cents per spend, which is $10 per million. The included 2M count per Stripe billing period.
- **`POST /billing/checkout`**, admin key only. The Worker creates a Checkout Session in `subscription` mode with the two prices (the metered one with no quantity) and `client_reference_id` set to the tenant, and returns `{ url }`. A tenant already on Pro gets `409 already_pro` with `{ portal_url }`: the Worker creates a Stripe billing portal session for the stored customer. With no Stripe key set, it answers `503 billing_unavailable`.
- **`solenoid upgrade`** calls that endpoint, opens the URL in the browser and prints it. For `409` it prints `portal_url`, where the customer manages or cancels the plan. For `503` it explains that billing is not open yet and that the free plan keeps working. Its output strings are graded copy.
- **`POST /billing/stripe`** is the webhook. It verifies the `Stripe-Signature` header with WebCrypto. With no webhook secret configured it answers 503 before reading the body, and processes nothing; a test pins this. `checkout.session.completed` sets the tenant's `plan` meta to `pro`, stores the customer and subscription IDs, and starts an `/auth/email` verification send to the Checkout email, as the governance spec says. The free cap is `#checkPlan` reading `meta.plan` (`worker/src/core.ts`), so there is no `spends` limit row to remove. `customer.subscription.deleted` sends a final meter report, then sets `plan` back to `free`. Before Pro, `/billing/checkout` hands back the tenant's open Checkout Session while it has more than five minutes left, so repeated `upgrade` runs lead to one session. If a race still completes a second subscription while the tenant is Pro, the webhook cancels the newcomer, records it, and mails security@solenoid.systems with the tenant, subscription and session IDs; Robin refunds the payment by hand. A failed notice is logged and the webhook still answers 200.
- **Meter reporting.** Once a day, a Pro tenant's alarm reports the billable spends recorded since the last report. `meta.meter_seq` holds the ledger `seq` reported up to. A report counts the `spend` entries with `seq` after it, up to the current head, sends one meter event, and on success moves `meta.meter_seq` to that head. The event `identifier` is `<tenant>:<from seq>-<to seq>`, so a retry of the same report is a no-op inside Stripe's uniqueness window of at least 24 hours, and a later report never repeats earlier spends because it starts after `meta.meter_seq`. The event `timestamp` is the time of the report.
  - **At a billing period boundary**, usage is billed in the period in which it is reported, so up to a day of spends made just before a period ends appears on the next invoice.
  - **At cancellation**, the webhook sends a final report before setting `plan` to `free`, stamped at the earlier of now and one second before the subscription's `ended_at`, because an event stamped after the subscription ended falls in no billing period. If Stripe has already finalized the last period's invoice when the report arrives, those spends go unbilled. That is at most about a day of usage, in the customer's favour, and accepted.
- **One alarm, two jobs.** A Durable Object has a single alarm, and `setAlarm` replaces any alarm already set. So `meta` keeps two due times, `next_prune` and `next_meter`. Whenever either is written, TenantDO sets the alarm to the earliest one due. `alarm()` runs every job that is due, updates its due time (the meter job to a day later while the tenant is Pro; the prune job to the next code row's expiry, or none), and sets the alarm to the earliest time still due. The core in `core.ts` only writes the due times; TenantDO owns `setAlarm`. Under `testServer()`, which has no alarm API, pruning keeps running lazily on the code read and write path as it does today. The alarm path is tested in the Worker's `@cloudflare/vitest-pool-workers` suite, which can run a Durable Object's alarm on demand.
- **Test and live mode are Worker configuration.** The secret key, the webhook secret and the two price IDs are Worker secrets and vars. The CLI holds no Stripe values, so switching to live mode needs no CLI republish. Test mode runs against local `wrangler dev` with `stripe listen` forwarding the webhook. Production receives only live values, and only at step 7 of the launch order, so no published CLI can reach a test-mode checkout.
- **The key's scope.** The Worker uses a restricted key with write access to Checkout Sessions, billing portal sessions, meter events and subscriptions; the last lets the webhook cancel a duplicate subscription. The first task of Plan 3a checks in the Stripe dashboard's restricted-key editor that it can be scoped that narrowly. If it can, that key is used. If it can't, the Worker uses the narrowest restricted key the editor allows that still covers those four, and `docs/runbook.md` records which extra permissions it carries.
- **Docs.** `sdk/README.md` and `sdk/llms.txt` say the free allowance "is a hard cap" today. Once Pro exists, those lines describe the plans and point to `solenoid upgrade`, and they are regraded. The npm tarballs published at step 6 carry this Pro wording, because the CLI in the same publish has `upgrade`. If live mode is late, `upgrade` answers with the `503` explanation, and the docs stay accurate about how to upgrade.

## Privacy

`/privacy` lists what the code actually stores and logs. Plan 3a adds one small Worker task first:

- **Salt the per-network hash.** `worker/src/ops.ts` keys signup and recovery limits by the first 16 hex of an unsalted SHA-256 of the IPv4 address or IPv6 /64. An unsalted IPv4 hash can be reversed by trying all 2^32 addresses. It becomes the first 16 hex of `HMAC-SHA256(MASTER, "ip:" + ipKey)`, which cannot be reversed without `MASTER`. Rows written before the change keep the unsalted hash, because the ledger is a signed chain and is never rewritten. There are few of them: the signups and recoveries of Robin and the testers.
- **Prune code rows on time.** `code_events` (email and timestamp) and `codes` (a keyed hash of the code, email and expiry) are pruned today only when the next code operation runs for that tenant, so rows can outlive their one-day window indefinitely. When a code row is written, the core sets `meta.next_prune` to one day after that write, unless an earlier prune is already due, and the shared alarm (see Billing, "One alarm, two jobs") runs the prune.

Ledger pruning stays out of Plan 3a. The governance spec's 12-month retention needs a checkpoint row and verification from that checkpoint in both the Worker and `verifyChain`, which is more than a small task. The privacy page therefore states ledger retention as it is: kept for the life of the account.

The inventory the page covers:

| Data | Where | Kept |
|---|---|---|
| Tenant ID and plan | The tenant's Durable Object | Life of the account. Keys are never stored; they are derived. |
| Ledger entries: scopes, units, amounts, timestamps, signatures | The tenant's Durable Object | Life of the account. No automatic deletion yet. |
| A salted hash of the network address for each signup and recovery | Solenoid's own ops ledger | Indefinitely. Older rows hold an unsalted hash. |
| The recovery email | The tenant's Durable Object | Until replaced. Replacing it also emails the previous address. |
| Code rows (email, timestamp, keyed code hash) | The tenant's Durable Object | About one day, pruned by alarm |
| Code, confirmation and change-notice emails | Resend (sending processor) | Resend's own retention |
| Request logs, which can include the IP address and request headers, and logged error text | Cloudflare Workers Logs on the API Worker | 7 days (Workers Paid) |
| Page visits: URL including query string (so `?ref=`), referrer, browser, device, country | Umami, self-hosted at `analytics.omit.nz`, cookieless, honours Do Not Track | Umami's configured retention |
| Billing name, email, card and address; the tenant ID as `client_reference_id` and in the subscription's metadata; the Stripe customer and subscription IDs, the latest Checkout Session's ID, URL and expiry, and the IDs of any cancelled duplicate subscriptions, stored on the tenant | Stripe, and the tenant's Durable Object | Stripe's retention; on the tenant, for the life of the account, with the Checkout Session entry replaced by the next one |
| Hosting | Cloudflare. A tenant's Durable Object is placed in one region when it is created, which can be outside New Zealand. | |

The page names the agency responsible as Robin Lange, trading as omit, and gives a contact for access and correction requests under the NZ Privacy Act 2020: `privacy@solenoid.systems`.

## The copy brief update

`docs/copy/brief.md` is updated in place before any site copy is drafted. Its reader, awareness stages, sophistication stage, offer and incident table stay as they are. The last guardrail's example (`brief.md:64`) changes from a bare `init` to "`npx @solenoid.systems/cli init <scope>` writes a spend key to `.env` in your terminal", because a bare `init` writes no spend key. The proof inventory becomes:

| Claim | Source | Status |
|---|---|---|
| Exactly N of M concurrent spends are recorded | The first test in `e2e/test/concurrency.test.ts` at the launch tag (30 spends, limit 7); its recorded replay is the landing demo, from `e2e/record-race.ts` | at repo launch |
| Parallel model calls are held before the provider call | The hold-and-settle test in the same file, at the launch tag | at repo launch |
| At-most-once from the same primitive | The `per: "child"` test in the same file, at the launch tag | at repo launch |
| Signed receipts verify offline | `verifyChain([receipt], keys)` exported from `@solenoid.systems/sdk`, with `keys` saved from `/.well-known/solenoid.json` | live |
| No signup form | `npx @solenoid.systems/cli init <scope>`, recorded | at npm publish |
| Fails closed; `on_outage` per limit | The docs | live |
| The admin key can be recovered by email | The README's Recovery section | live |
| You can read and run the code | The `LICENSE` files and `LICENSING.md`. The Worker is "source-available" under FSL-1.1-ALv2 and is **never** called "open source", because FSL is not an OSI license. The SDK, CLI and MCP are MIT. | at repo launch |
| Pricing | `/pricing` | at site launch |
| Dogfooded by learning-loop | **Struck.** The integration was dropped (learning-loop PR #131, closed 2026-09-28). | struck |
| Any latency figure | Not claimable: the numbers are from the old stack | blocked |
| "At the edge" | Never | banned |
| Named competitor comparisons | Leave them out. If one is ever needed, cite and date it from the competitor analysis. | avoid |

## Copy process

The copy units are:

- the hero
- each landing section, including the race transcript's line format
- the pricing page
- the founder note
- the privacy page
- the 404 page
- the nav and footer
- each page's meta description
- the agent prompt in the call to action
- the root `README.md`, which becomes a short product README; the ops runbook moves to `docs/runbook.md`
- the changed sections of `sdk/README.md` and `sdk/llms.txt`, and the new `testing/README.md`
- the output strings of `solenoid upgrade`

For each unit:

1. Draft it against the brief.
2. Dispatch three cold `copy-grader` runs as plain subagents. Each gets the draft inline, plus the medium, the jurisdiction (New Zealand) and whether the unit is a closing unit. Tally the runs with `tally.py`.
3. If the unit cites any source (an incident URL, a test file, a Stripe or license page), dispatch `copy-source-checker` once. Any DOES NOT SUPPORT or UNRESOLVABLE verdict joins Gate 0.
4. Fix every Gate 0 item. Fix every finding, or accept it with a written reason in the grade file.
5. Commit the grades to `docs/copy/grades/site-<unit>.md`.

**Closing units** follow copy-chief's own definition (`checks.md`, "Closing unit"): a unit is a closing unit when the reader can take the sign-up or buying action from it directly. Here that means any unit that shows the `init` or `upgrade` command or a price: the hero, the pricing strip, the bottom call to action and `/pricing`. The copy gate judges attribution (C3) on each draft; the spec does not declare it met in advance. The only attribution in place is Umami's record of `?ref=` visits, and no copy may claim a visit is tied to a signup.

The hero, the bottom call to action and the agent prompt are graded against the exact command `npx @solenoid.systems/cli init <scope>`, with the scope literal the hero uses.

## Testing

| What | How |
|---|---|
| Routes | A test builds the site and runs `wrangler dev` over `dist`. For every path in the fixture, it follows at most two redirects and asserts a final 200. It asserts each prefix rule's status and `Location` on one sample path, and that `/pricing` answers 200 and `/pricing/` redirects to `/pricing`. |
| Single source | A build check fails when `dist/llms.txt` differs from `sdk/llms.txt` by a byte, when `dist/llms-full.txt` differs from `llms.txt + "\n" + README.md`, or when `/docs` renders anything but `sdk/README.md`. The route test asserts the `charset=utf-8` header on both text files. |
| Links | A check over `dist` fails on any broken internal link. GitHub links name the launch tag through one constant, `LAUNCH_TAG = "launch"`. During development, the check confirms each linked path exists in the working tree. In launch mode (step 10), it confirms `git ls-remote --tags origin launch` matches the local tag and that each path exists in `git ls-tree -r launch`. |
| Race demo | The recorder asserts its own counts. A site test fails when either sha256 in `race.json` differs from the current file's hash; its message says to re-run the recorder. |
| Receipt | A site test runs `verifyChain` on `receipt.json` with `keys.json`. |
| House style | A lint over the built HTML reads text nodes only, and skips `code`, `pre`, `script`, `style`, comments and attributes. It fails on em or en dashes, `--` in prose, "at the edge", "would have prevented", and "open source" anywhere on the site. |
| Look | A Playwright screenshot pass at 375 px and 1280 px wide, run on demand for review before cutover. It asserts nothing, so it stays out of `pnpm test`. |

Every row except the recording and the screenshot pass runs in `pnpm test`, and the fast ones run in `test:changed`.

## Launch order within Plan 3a

The site's proofs link to the public repository and to npm, and `/pricing` sells a live plan, so the site normally goes live last.

0. **Read the Stripe account's activation state**, read-only, before any other step. This decides which of two orders runs:
   - **Order A**, when the account is already activated for live mode, or when Stripe accepts `omit.nz` as the business website for activation. The steps run 1 to 10 as written. Activation, if needed, happens under the business name "omit" with `omit.nz`, so it never waits for the new site.
   - **Order B**, only if Stripe insists on the product's own site. The site cutover (step 10) moves ahead of live mode (step 7). Until live mode, `/pricing` shows the plans with "Pro opens soon" in place of the `upgrade` call to action; both versions of `/pricing` are graded. After live mode, the site is rebuilt with the call to action and deployed again.
1. **All Plan 3a code lands**, the site included: the `testing/` split, billing and `solenoid upgrade`, the privacy task, the recorder and `race.json`, the canary, the license files, the product README, `SECURITY.md`, `.superpowers/` added to `.gitignore`, and `repository`, `homepage` and `bugs` in each published `package.json`. Step 1 also:
   - makes the production demo tenant and commits `receipt.json` and `keys.json` (see The receipt);
   - sets up Cloudflare Email Routing for `privacy@` and `security@solenoid.systems`;
   - confirms the restricted Stripe key's scope (see Billing, "The key's scope");
   - runs the draft `_redirects` under `wrangler dev` to see whether exact rules match a trailing slash (see Redirects).
2. **Stripe in test mode.** Create the product, prices, meter and webhook in test mode, and run `solenoid upgrade` end to end against local `wrangler dev` with `stripe listen`: a real test Checkout, the webhook, pro marking, two meter reports that cover different `seq` ranges, the `409` portal URL, and cancellation with its final report. This also exercises the $0 graduated tier on the metered price.
3. **Deploy the API Worker** with the billing routes, the salted hash and the alarm, and with no Stripe key or webhook secret, so `/billing/checkout` and `/billing/stripe` both answer 503.
4. **Prepare the public tree.** Scrub personal data from every file in the tree, `docs/superpowers/**` included (the plans, their `.record.md` files and the reviews, which stay public as part of the trust story):
   - `git grep` for five patterns kept in the git-ignored `.scrub-patterns`: the mail user name (which also names the `workers.dev` subdomain), the mail provider's domain, Robin's tenant ID, the macOS home-directory prefix and the vault path, replacing each with a placeholder such as `<tenant>` or `<account>.workers.dev`;
   - run gitleaks over the tree, and read `docs/` by hand for any other personal data;
   - get the lawyer glance on the licenses.

   Commit the scrub to the private repository. **Stop for Robin.**
5. **Open the repository.**
   - The private repository `robinslange/solenoid` is renamed `robinslange/solenoid-history` and archived read-only. It keeps the full history.
   - A new public repository takes the name `robinslange/solenoid`.
   - Locally, `git checkout --orphan public`. The index still holds exactly the tracked files, so commit it as it is, with no `git add -A`, and nothing untracked can enter the snapshot. Tag the commit `launch`.
   - Rename the old remote `origin` to `history` and disable pushing to it (`git remote set-url --push history DISABLED`). Delete the local `main`, rename `public` to `main`, add the public repository as `origin`, and push `main` and the tag. The old history is then reachable only as `history/main`, and no push can send it to the public repository.
   - From here on the public repository is the working repository, and every later commit goes there. The archive receives nothing more. **Stop for Robin.**
6. **Publish to npm:** `@solenoid.systems/sdk`, `@solenoid.systems/cli`, `@solenoid.systems/mcp` and `@solenoid.systems/testing`, from the tagged commit. First confirm `npm org ls solenoid.systems` lists Robin's account. There is no old MCP package to deprecate, since none was ever published. **Stop for Robin.**
7. **Stripe in live mode, on Robin's yes.** Create the live objects, set the live key and webhook secret on the API Worker, and have Robin complete one live upgrade and cancel it. If Stripe asks for terms, refund or cancellation text, that text lands on the site and is graded before this step completes. **Stop for Robin.**
8. **Canary:** the new stack's production canary runs from two regions.
9. **Close the old deploy path.** Run `gh workflow disable ci-cd.yml -R robinslange/solenoid-systems`, delete that repository's `CLOUDFLARE_API_TOKEN` secret, and revoke the token in Cloudflare. **Stop for Robin.**
10. **Site cutover.** Build the site from `main` with the link check in launch mode, then `wrangler deploy` from `site/`. Then check:
    - `wrangler deployments list --name solenoid-systems` shows the new version;
    - both `solenoid.systems` and `www.solenoid.systems` serve it;
    - the route test's assertions pass against production with GETs;
    - the llms files match byte for byte;
    - `/pricing` renders.

**Rollback.** The version live before cutover, `ff4e4458-27f2-4b25-b342-ced607dfc078`, is the rollback target. It binds `solenoid-api-gateway`, so it is valid only until Plan 3b deletes the old gateway. Routes and custom domains are not part of a version, which is why `site/wrangler.jsonc` declares both domains and step 10 checks them.

## Plan 3b

Plan 3b, later, first records the first known-good site version as the new rollback target. Then it tears down the old Workers, D1 databases, KV namespaces and Stripe products, along with the stray tenant from Plan 2's Task 3. It archives the `solenoid.systems` repository read-only and re-lists the MCP in the directories.

## Out of scope

- a blog
- a live in-browser demo
- a checkout on the site
- latency claims
- a terms-of-service page, unless Stripe's live activation requires one (step 7); it goes with Robin's lawyer glance
- ledger pruning (see Privacy)

## Deferred

- **An Open Graph image.** The pages carry OG and Twitter title and description tags. An image needs a design pass, and text cards work in the meantime.
- **A script `Content-Security-Policy`.** The site takes no user input and runs only its own scripts and Umami. A script policy would need hashes for Astro's inline scripts and a check that Pixi runs under it. `frame-ancestors 'none'` ships now.
- **Tying a visit to an `init`.** Umami records `?ref=` visits only. Linking a visit to a signup would need an init source sent to the Worker and stored, which is a Worker change nobody needs before launch. Until then, the copy makes no claim about it.
- **Narrowing the race hash (m-N11).** `race.json` hashes the whole test file, so an edit to the other two tests in it forces a re-record. The re-record is one on-demand command, and hashing the whole file is what the ruling asked for.
- **Redirecting `www` to the apex.** Assets are served before any Worker code, so this would need a zone Redirect Rule outside the repository. The canonical link covers search engines.

## Settled with Robin after round 2

- **Refund terms:** cancel anytime. Pro runs to the end of the paid month, with no partial refunds, and overage is billed as used. `/pricing` states this. A terms page is written only if Stripe's live activation asks for one.
- **Umami hosting:** a Hetzner server in Germany, as Robin recalls it. The privacy page states it. Step 1 confirms the host and region from the server itself before the privacy copy is drafted.

## Review response

- B1 fixed: the test server moves to `@solenoid.systems/testing` (FSL); the SDK is pure MIT (Licensing).
- B2 fixed: Stripe, the webhook and `upgrade` land before the npm publish; live mode is step 7, before cutover; Payment Links can't sell a metered price, so the upgrade uses a Checkout Session from one Worker endpoint (Billing).
- B3 fixed: `e2e/record-race.ts` runs the race and asserts its counts; `RaceTerminal` replays `race.json`; the page links both files.
- B4 fixed: the hero command is `init <scope>`, run in the project root; the agent prompt names `.env` and `SOLENOID_KEY`.
- M1 fixed: redirects are prefix rules checked against a fixture generated from the old site; `/api/*` answers 301 to `/`.
- M2 fixed: offline verification is `verifyChain([receipt], keys)` with saved keys, in the proof row and the receipt section.
- M3 fixed: identifier `FSL-1.1-ALv2`, the license described by its own terms, every directory licensed, lawyer glance in step 4.
- M4 fixed: full inventory; salting and on-time code pruning added to Plan 3a; ledger retention stated as indefinite.
- M5 fixed: Umami records visits and `?ref=`; the privacy page names it.
- M6 fixed: closing units follow `checks.md`; `copy-source-checker` added as step 3.
- M7 fixed: the tag is cut in step 5 after all code lands; the site builds from it in step 10; the link check runs against the pushed tag.
- M8 fixed: scrub, then one squashed public commit; the private repository is a frozen archive.
- M9 fixed: the old CI is disabled and its token removed in step 9, before cutover.
- M10 fixed: both custom domains declared; the rollback target's expiry stated; domains checked after deploy.
- M11 fixed: `race.json` stores sha256 hashes of the test and the recorder.
- M12 fixed: `CodeTabs` takes props; TypeScript and CLI only.
- M13 fixed: every old piece is decided in the carried-over table.
- M14 fixed: `build.format: 'file'`, `trailingSlash: 'never'`, `html_handling: 'drop-trailing-slash'`; the route test runs against `wrangler dev` over `dist`.
- M15 fixed: DMARC `p=none` recorded as done; tightening to quarantine is a follow-up.
- m1 fixed: the reasoning now cites what `llms.txt` actually says.
- m2 fixed: the deprecation step is dropped; package metadata added in step 1.
- m3 fixed: the "avoid" row is kept.
- m4 fixed: the lint reads text nodes only and bans "open source" site-wide.
- m5 fixed: the screenshot pass runs on demand only.
- m6 fixed: `/why` wording covers the cited incidents.
- m7 fixed: moot under the Checkout Session design; `/pricing` shows `init` first for new readers.
- m8 fixed: the `llms-full.txt` bytes are defined and checked.
- m9 fixed: docs paths go to `/docs`, root mirrors to `/llms.txt`, blog paths use 302.
- m10 fixed: the receipt comes from production, signed with `k1`, and is verified in a test (round 2 moves it to a demo tenant).
- m11 fixed: the proofs are named as three tests in one file; the copy says "spends".
- m12 fixed: prices are USD, shown as they are; Robin is not GST-registered, so Stripe Tax is off.
- m13 fixed: product README at the root; the runbook moves to `docs/runbook.md`.
- m14 fixed except where deferred: 404 page, robots and sitemap, security headers, charset, canonical link, OG text tags, `security.txt` and `SECURITY.md`, the Stripe activation check (step 0 since round 2). Deferred: the OG image, a script CSP and a `www` redirect (see Deferred).

### Round 2

- M1 fixed: the fixture leaves out `/_astro/*`, criterion 3 says why, and every exact rule has a `/*` companion.
- M5 fixed: C3 is left to the copy gate; Umami records `?ref=` visits only; tying a visit to an `init` is deferred, and copy may not claim it.
- M13 fixed: the five existing font files are copied and their `@font-face` rules point at local URLs; the two JetBrains Mono weights with no file are dropped.
- m12 fixed: not GST-registered; Stripe Tax off; USD as shown.
- N1 fixed: `/_astro/*` excluded from the fixture, with the reason.
- N2 fixed: the receipt comes from a production demo tenant made in step 1 and is committed then, so its test passes from step 1.
- N3 fixed: one alarm, due times in `meta`, the alarm set to the earliest; `testServer()` keeps lazy pruning; the alarm is tested under vitest-pool-workers.
- N4 fixed: reports cover `seq` ranges after `meta.meter_seq`, the identifier names the range, and the period boundary and cancellation behaviour are stated.
- N5 fixed: `409 already_pro` carries a portal URL the Worker creates, and the CLI prints it.
- N6 fixed: `docs/superpowers/` is FSL; the rest of `docs/` stays MIT.
- N7 fixed: `/billing/stripe` answers 503 with no webhook secret before reading the body, and `/billing/checkout` answers `503 billing_unavailable` with a CLI explanation.
- N8 fixed: step 0 reads the activation state and picks order A (activate with `omit.nz`) or order B (cutover before live, "Pro opens soon").
- m-N1 fixed: `/*` companions on every exact rule, plus a step-1 check.
- m-N2 fixed: see M13.
- m-N3 fixed: `contract/` is described as a plain directory outside the workspace.
- m-N4 fixed: the old repository is "archived in Plan 3b", and its CI is disabled at step 9.
- m-N5 fixed: the orphan commit takes the index only, `.superpowers/` is ignored, the old `main` is deleted, and the history remote cannot be pushed to.
- m-N6 fixed: the webhook sets `meta.plan`; there is no `spends` row.
- m-N7 fixed: the privacy row lists the subscription ID.
- m-N8 fixed: the npm tarballs carry the Pro wording, and `upgrade` explains a 503 until live mode.
- m-N9 fixed: the test and the Stryker run move to `testing/`, and consumers import by relative path.
- m-N10 fixed: the brief update changes line 64 to `init <scope>`.
- m-N11 deferred: whole-file hashing was the ruling, and a re-record is one command.
