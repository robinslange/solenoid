# Cold review: 2026-09-29-solenoid-site-design.md

**Reviewed:** 2026-09-29, against `solenoid` at `f190751` and `solenoid.systems` at `aba7bcc4` (local `main`, one commit ahead of `origin/main`).
**Scope:** the site spec, with the governance spec (Site, Plans and billing, Migration) and `docs/copy/brief.md`, re-derived against both codebases, the live site, the live API, npm, DNS and fsl.software. Nothing was edited, committed, pushed or deployed. The only production calls were read-only GETs and `wrangler deployments list` / `versions view`.

## Verdict

**NOT READY.** 4 Blockers, 15 Major, 14 Minor.

The spec's structure holds up: the site Worker, the single-source docs, and a site that goes live last. What fails are its factual claims about the code. Four of them are wrong in a way that breaks execution:

1. The MIT SDK already ships the Worker's code.
2. The pricing CTA names a CLI command that doesn't exist, and the publish order ships the CLI before that command can exist.
3. The race replay can't be recorded from the test as described.
4. The hero command gives the agent no key.

---

## Blockers

### B1. The MIT SDK package bundles the Worker's ledger and router, so the FSL/MIT split doesn't hold. CONFIRMED

- **Spec claim:** line 23 ("The Worker is licensed under FSL-1.1-Apache-2.0 … The SDK, CLI and MCP are MIT") and line 151 (FSL for `worker/`, MIT for `sdk/`).
- **Evidence:**
  - `sdk/src/testing.ts:2-4` imports `Tenant` from `../../worker/src/core`, `Mail` from `../../worker/src/mail`, and `handle` from `../../worker/src/router`.
  - `sdk/package.json` exports `./testing` → `./dist/testing.mjs`, has `"files": ["dist", …]` and `"license": "MIT"`.
  - The built `sdk/dist/testing.mjs` is 42.3 KB.
  - `sdk/README.md:409` says it outright: "It is the hosted API's own request handler and ledger code, bundled into the package".
- **What breaks:** step 2 publishes the Worker's core to npm under MIT. Anyone can take `dist/testing.mjs` and host a competitor under MIT terms, which makes the FSL on `worker/` mostly decorative. Or, read the other way, the SDK package is mislicensed. Either reading is a contradiction for the lawyer to resolve, and the spec doesn't mention it.
- **Fix:** decide before step 1, and put the decision in the spec. Options:
  - (a) Move `testServer` to a separate package (e.g. `@solenoid.systems/testing`) licensed FSL-1.1-ALv2, and drop the `./testing` export from the SDK.
  - (b) Give the SDK package a dual `LICENSE` that carves `dist/testing.mjs` out as FSL. `package.json` would then need `"license": "SEE LICENSE IN LICENSE"`.
  - (c) Accept that the ledger core is MIT, and say so in the Decisions.
  - Whichever you pick, name it in the brief for the lawyer.

### B2. `solenoid upgrade` doesn't exist, no Stripe code exists, and the launch order publishes the CLI before it can. CONFIRMED

- **Spec claims:**
  - line 54: the `/pricing` CTA is `solenoid upgrade`.
  - line 152: step 2 publishes the CLI.
  - line 153: step 3 is Stripe test mode, "with `solenoid upgrade` tested end to end".
  - line 155: step 5 is cutover.
- **Evidence:**
  - The command switch has no `upgrade` case (`cli/src/commands.ts:186-300`).
  - `HELP` (`cli/src/commands.ts:166-184`) doesn't list it.
  - `grep -ri "stripe|upgrade|client_reference" cli/src worker/src sdk/src` finds nothing: no webhook route, no plan transition.
  - `worker/src/core.ts:66` sets `plan` only at `init`, and `core.ts:379-383` is the only plan logic.
  - The governance risk at `governance-design.md:388` ("Whether a Stripe Payment Link can sell a subscription that includes a metered overage price. If it can't, `solenoid upgrade` needs one endpoint") is still open.
- **What breaks:**
  - The npm CLI published in step 2 has no `upgrade`. Step 3 has to add it and republish, but the order has no republish step.
  - The Payment Link URL differs between test and live mode, so the spec has to say where the URL lives. It can be a CLI constant, which means a republish for live mode, or it can be served by the API, which contradicts "needs no server endpoint".
  - Live mode "waits for Robin" (line 153) with no place in the order. Step 5 can therefore ship a `/pricing` page selling Pro while the only purchase path is a test-mode link. That is an FTA s12A exposure, the very thing the brief guards against.
- **Fix:**
  - Reorder: build Stripe, the webhook and `upgrade` first (governance build step 9), then publish sdk/cli/mcp, then cut over.
  - Make "Stripe live mode confirmed by Robin" a hard gate before step 5. The other option is to launch `/pricing` without the paid CTA ("Pro: coming"), and grade that wording.
  - Settle the Payment-Link-versus-Checkout-Session risk in this spec, because the CTA depends on it.

### B3. The race replay can't be "a recorded run of the e2e concurrency test", and `AutoTypingTerminal` can't replay it. CONFIRMED

- **Spec claims:** lines 64 and 77. `record-race.mjs` "runs the e2e concurrency test … and writes `race.json`: the lines, their timing, and the pass and refuse counts", and `AutoTypingTerminal` replays it.
- **Evidence:**
  - The test prints nothing. It builds `results` with `Promise.all` over 30 `code(client(key).spend(...))` calls and asserts counts (`e2e/test/concurrency.test.ts:15-17`).
  - `code()` returns only `'ok'` or `'<status> <code>'` (`e2e/test/harness.ts:40`), so there are no per-call lines and no timings to capture from a vitest run.
  - `AutoTypingTerminal` is a command-then-response typer:
    - its data is a hard-coded `EXAMPLES` array (`AutoTypingTerminal.astro:42-78`);
    - it is locked to 10rem height with `overflow: hidden` (`:21-24`), which clips a 30-line transcript;
    - it highlights with prism `bash`/`json` (`:85-91`);
    - it starts on `astro:page-load` (`:156`), which only fires with `ClientRouter`.
- **What breaks:** the implementer either rewrites the scenario inside `record-race.mjs`, so the replay isn't the test and the proof link is a paraphrase, or edits the test to emit a transcript, which changes the proof file. Either way the terminal component gets rewritten, not lifted.
- **Fix:**
  - Extract the scenario into one exported function in `e2e/test/`, e.g. `raceScenario({ n, m, onEvent })`. The test asserts on its result, and `record-race.mjs` calls the same function with an `onEvent` that timestamps each settle. Name that function in the spec.
  - Replace `AutoTypingTerminal`'s `EXAMPLES` with a prop that takes `race.json`, and set a height that fits M lines. Honour `prefers-reduced-motion` by showing the final state.

### B4. The hero command `npx @solenoid.systems/cli init` writes no spend key, so step 2 of the CTA hands the agent nothing. CONFIRMED

- **Spec claims:**
  - lines 12 and 26: step 1 is `npx @solenoid.systems/cli init`.
  - line 26: "Step 2 … sends the reader's coding agent to `solenoid.systems/llms.txt`".
- **Evidence:**
  - `cli/src/commands.ts:202-205` derives a spend key and appends it to `.env` only when a scope is given.
  - `sdk/llms.txt:9` tells the agent "the developer runs npx @solenoid.systems/cli init <scope> … appends SOLENOID_KEY=<spend key> to .env in the directory init runs in".
  - `sdk/llms.txt:10`: "You only ever receive the spend key."
- **What breaks:** a reader who follows the hero exactly has an admin key in `~/.config` and no `SOLENOID_KEY`. The agent can't integrate, and the one conversion path the site exists for fails at the handoff.
- **Fix:** make the hero command `npx @solenoid.systems/cli init <scope>`, run in the project root, and have the copy say what the scope is. Make the agent prompt match `llms.txt`'s scope rule. Grade the hero, the bottom CTA and the agent prompt against this exact command.

---

## Major

### M1. The redirect list is incomplete against what the old site actually serves, and the planned test only checks the list against itself. CONFIRMED

- **Spec claims:** lines 81-88 and success criterion 3 ("No old URL returns a 404").
- **Evidence:** the live sitemap (`/sitemap-0.xml`, 94 URLs), `git ls-files public src/pages` in `solenoid.systems`, and live probes turn up these paths the spec doesn't list:
  - **`/api/*`.** The old Worker proxies it to `solenoid-api-gateway` through a service binding (`worker/index.ts:35-46`). It is live: `GET https://solenoid.systems/api/health` returns 200 `application/json`. It is also the only path that still reaches the old gateway.
  - **Non-product docs:**
    - `/docs/anti-patterns/{index,client-side-security,daisy-chain,partial-failures}`
    - `/docs/architecture/durable-objects`
    - `/docs/{authentication,api-reference,mcp,multi-tenant,quick-start,troubleshooting}`
    - `/docs/solenoid-mcp/remote`
    - `/docs/nexus/*`: nexus is missing from the spec's product list, which a per-product enumeration would miss.
  - **Markdown mirrors under `/docs`:** `/docs/<product>.md` and `/docs/<product>/<page>.md` (56 files in `public/docs/`).
  - **Others:**
    - `/api/benchmarks/results.json` (static, 200)
    - `/sitemap-index.xml`, `/sitemap-0.xml` (generated by `@astrojs/sitemap`, `astro.config.mjs:21-23`)
    - `/robots.txt`
    - `/witness-verifier`: the live canonical URL; `/witness-verifier.html` answers 307 to it
    - `/witness/verify`, `/checkout/success`, `/oauth/{authorize,verify,error}`
    - `/blog/<slug>` (19 posts)
    - `/fonts/*` and `/favicon.svg`, if they aren't carried over.
- **What breaks:** `/api/*` 404s after cutover, which violates criterion 3. The test the spec describes ("every old path in the list answers a 301") only proves the list agrees with itself.
- **Fix:**
  - Generate a fixture from the old site. The generator is:
    - `curl -s https://solenoid.systems/sitemap-0.xml | grep -o '<loc>[^<]*'`
    - plus `git -C ~/dev/solenoid.systems ls-files public`
    - plus the `src/pages` routes.
  - Commit the fixture, and have the Worker test iterate it.
  - Implement the redirects as prefix rules, not an enumeration: `/docs/*` except `/docs` → `/docs`, and every product prefix, `/blog*`, `/oauth*`, `/checkout*` and `/billing*` → `/`.
  - Give `/api/*` a 410 JSON response, not a 301 to HTML: a POST that follows a 301 becomes a GET for `/` and returns HTML. Amend criterion 3 to allow it.

### M2. `verify()` is not offline verification. CONFIRMED

- **Spec claims:** line 66 ("how to verify it offline, using `verify()` and `/.well-known/solenoid.json`") and line 103 (the proof row).
- **Evidence:**
  - `sdk/src/index.ts:147`: `verify` calls `keysFor`, which fetches `/.well-known/solenoid.json` over the network (`:92-99`, `:138-146`).
  - `solenoid()` throws with no key (`:84`), so a third party who holds a receipt but no account can't call `sol.verify` at all.
  - The offline path is the top-level `verifyChain([receipt], keys)` export, with saved keys (`sdk/README.md:398`, `sdk/llms.txt:31`).
  - Live, `GET https://api.solenoid.systems/.well-known/solenoid.json` returns 200 `{"keys":{"k1":{kty:OKP,crv:Ed25519,x:…}}}` with `cache-control: public, max-age=3600`. That endpoint works as claimed.
- **Fix:** change the proof row to: "Signed receipts verify offline | `verifyChain([receipt], keys)` exported from `@solenoid.systems/sdk`, with `keys` saved from `/.well-known/solenoid.json` | live". Show the receipt section with that import, not `sol.verify`.

### M3. The license wording and identifier don't match the license, and the proof files themselves would be unlicensed. CONFIRMED

- **Spec claim:** line 23: "nobody may offer it as a competing hosted service for two years".
- **Evidence:**
  - fsl.software's template, "Permitted Purpose": a Competing Use is "making the Software available to others in a **commercial product or service** that: 1. substitutes for the Software; 2. substitutes for any other product or service we offer using the Software …; or 3. offers the same or substantially similar functionality". Permitted purposes explicitly include "non-commercial education" and "non-commercial research".
  - So the restriction isn't limited to *hosted* use: a commercial self-hosted product or a redistributed binary also counts. And it doesn't cover *nobody*: non-commercial use is allowed.
  - The Apache grant applies per version, "on the second anniversary of the date we make the Software available", so "each release becomes Apache 2.0" is right.
  - The identifier is **`FSL-1.1-ALv2`**. `https://spdx.org/licenses/FSL-1.1-ALv2.json` exists, `FSL-1.1-Apache-2.0.json` returns 404, and fsl.software redirects the long name to `FSL-1.1-ALv2.template.md`.
  - Lines 16 and 151 license only `worker/`, `sdk/`, `cli/` and `mcp/`. The race, hold-and-settle and at-most-once proofs live in `e2e/test/concurrency.test.ts`, which would be unlicensed. So would `contract/`, `site/` and `docs/`, and there is no root `LICENSE`, so GitHub shows "No license".
- **Fix:**
  - Use `FSL-1.1-ALv2` everywhere, including `worker/package.json` `"license"`.
  - Replace the sentence with the license's own terms: "no one may use it in a commercial product or service that competes with Solenoid until two years after each release, when that release becomes Apache 2.0".
  - Add a root `LICENSE` or `LICENSING.md` that maps each directory to its license, and license `e2e/`, `contract/` and `site/` explicitly (MIT is the natural choice).
  - Put the lawyer glance inside step 1, before the visibility flip.

### M4. The privacy page's data inventory misses what the Worker stores and logs. CONFIRMED except where marked

- **Spec claim:** line 59.
- **What it misses:**
  - **Network identifiers, kept forever.** `worker/src/ops.ts:18-19` writes every signup and recovery as a spend at scope `signups|recoveries/<first 16 hex of sha256(IPv4 or IPv6 /64)>` into the ops tenant's signed ledger. An unsalted SHA-256 of an IPv4 address can be reversed by enumerating 2^32 inputs, so this is personal information under the NZ Privacy Act 2020.
  - **No ledger retention.** No `DELETE FROM entries` exists anywhere in `worker/src`, although the governance spec promises 12-month pruning. Entries are kept indefinitely, both the ops tenant's and every customer's (scopes, units, amounts, timestamps).
  - **Email addresses in `code_events`, pruned lazily.** The table holds email plus timestamp (`core.ts:36`). `#prune` (`core.ts:310-313`) runs only on the next code operation for that tenant, so rows can outlive the "one day" window indefinitely.
  - **Change notices.** A change of recovery email also mails the previous address.
  - **Worker logs.** `observability.enabled: true` (`worker/wrangler.jsonc`) keeps Workers Logs, and `console.error(e)` on mail failure (`auth-routes.ts:39,53`) can log Resend's error text. SUSPECTED: whether request IPs and headers land in Workers Logs wasn't verified.
  - **Analytics in the carried-over Layout.** The old `Layout.astro:49-55` loads Umami from `https://analytics.omit.nz/script.js` on every page. Lifting `Layout` as the spec says ships third-party-hosted analytics while the privacy page says "no tracking".
- **Fix:**
  - Strip the Umami script from the lifted Layout, or disclose it.
  - Add the IP-hash rows, the retention actually in force (indefinite until pruning ships), processors (Cloudflare, Resend, Stripe) with their regions (a Durable Object's region is picked at creation, which is an IPP 12 cross-border note), the access and correction contact, and change-of-address mail.
  - Alternatively, salt the IP hash with `MASTER` and ship pruning before launch, and then say that.

### M5. The `?ref=` attribution tag records nothing, so C3 will fire and the privacy line describes a mechanism that doesn't exist. CONFIRMED

- **Spec claims:** line 59 ("no tracking beyond the `?ref=` attribution tag") and line 162.
- **Evidence:**
  - Static assets are matched before the Worker runs (the old `worker/index.ts:11-12` comment; the live responses carry `cf-cache-status: HIT`), so the site Worker never sees `?ref=` on a page view.
  - `/auth/signup` takes an empty body (governance line 193), and `init` sends nothing about its source (`cli/src/commands.ts:193`).
  - Analytics is out of scope (spec line 162).
  - `docs/copy/grades/sdk-readme.md:28` already deferred C3 to "a `?ref=` landing URL in Plan 3".
  - The brief (line 64) needs "a `?ref=` tag on links, **or a distinct init source**".
- **Fix:** either add `init --ref <tag>` → signup body `{ source }` → stored in tenant meta (a Worker change, so put it in this spec), or accept C3 now in writing for every closing unit and delete the privacy sentence about `?ref=`.

### M6. The closing-unit designation contradicts the grader's own definition, and the copy process skips the source checker. CONFIRMED

- **Spec claims:** line 132 ("`/pricing` and the bottom call to action are the closing units") and lines 125-130.
- **Evidence:**
  - `~/.claude/skills/copy-chief/references/checks.md:17-21`: "The closing unit is the piece where the reader can take the buying or sign-up action directly: a landing page…". The hero carries the sign-up action (`init`) directly.
  - `checks.md:27-29`: non-closing units get O1, O3, O4 and C3 reported as not applicable. Labelling the hero non-closing switches those checks off where the primary conversion happens.
  - The skill's "Sources" section (`SKILL.md`) requires a `copy-source-checker` dispatch whenever a draft cites anything. `/why` cites the brief's incident URLs, and the landing sections link to test files. The spec's steps 1-4 omit it.
- **Fix:** mark the hero as a closing unit, and add "4a. If the unit cites any source, dispatch `copy-source-checker` once; any DOES NOT SUPPORT or UNRESOLVABLE joins Gate 0".

### M7. The launch tag is cut before the code it's meant to prove, and the link check can't pass until the tag exists. CONFIRMED (ordering)

- **Spec claims:** line 151 (the tag is pushed in step 1) and line 140 ("the check confirms that each linked path exists at that tag").
- **Evidence:** steps 3 and 4 add the Stripe webhook, `upgrade` and the canary (none of which exist yet; `grep -rl canary` finds only docs), after the tag. The site itself is built after, or alongside, step 1.
- **What breaks:**
  - The "code a reader can audit" (line 23) at the linked tag isn't the code production runs at launch.
  - The link check, which runs in `pnpm test` and lefthook (line 145), fails on every commit until the tag exists locally.
- **Fix:**
  - Make the repo public and cut the tag as the last step before cutover, after Stripe and the canary.
  - During development, check links against `HEAD` by path, with the tag name as a constant, and then re-run the check against the real tag in the cutover smoke test.

### M8. Making the repo public publishes the owner's recovery email next to the production tenant ID. CONFIRMED

- **Evidence:** `git log --all -p` shows `docs/superpowers/plans/2026-09-28-solenoid-recovery-mcp.record.md`: "Live smoke to <you>@example.com … confirmed the address for `<tenant>`", plus `recover … --tenant <tenant>`.
- **Why it matters:** the governance spec (lines 212-213) accepts the risk that "someone who knows both the tenant ID and the recovery email can hold recovery closed". Publishing the history hands both to anyone.
- **Fix:**
  - Add a pre-publication step to launch step 1: run gitleaks over all history and review it by hand for PII and tenant IDs.
  - Then either rewrite that file out of history or retire that tenant and email pairing (new tenant, or a different recovery address) before the flip.
  - Consider whether `docs/superpowers/**` belongs in the public repo at all.

### M9. The old repo's CI deploys the site as well as the API, and the guard is "never push". CONFIRMED

- **Spec claim:** line 29 ("Its CI redeploys the old API on every push to `main`").
- **Evidence:**
  - `.github/workflows/ci-cd.yml:224-255` has a `deploy-site` job that runs `pnpm run deploy` (= `astro build && wrangler deploy` of `solenoid-systems`). `:257-281` has `deploy-api`.
  - `api/gateway/wrangler.jsonc:23-26` still claims the `api.solenoid.systems` custom domain.
  - Local `main` is one commit ahead of `origin` (`git status -sb`), so a push is one habit away. A "Re-run jobs" on any past run also redeploys.
- **What breaks:** one push or re-run overwrites the new site Worker, and may try to take `api.solenoid.systems` back.
- **Fix:** before cutover, not in Plan 3b, run `gh workflow disable ci-cd.yml -R robinslange/solenoid-systems` and delete that repo's Cloudflare API token secret. Add both to the launch order.

### M10. The rollback target expires when Plan 3b runs, and routes aren't versioned. CONFIRMED / SUSPECTED

- **Spec claim:** line 92.
- **Evidence:**
  - CONFIRMED: `wrangler deployments list --name solenoid-systems` shows `ff4e4458-27f2-4b25-b342-ced607dfc078` as the current 100% version (2026-09-28T21:36Z).
  - CONFIRMED: `wrangler versions view` shows its only binding is `env.API (solenoid-api-gateway)`. Rollback works on the Worker by name, so deploying from a different project doesn't matter, but the target needs `solenoid-api-gateway` to exist. Plan 3b tears the old Workers down (line 157).
  - SUSPECTED: custom domains and routes are script-level settings, not part of a version, so `wrangler rollback` won't restore them if the new config drops them.
- **Fix:**
  - Copy the `routes` block from the old `wrangler.jsonc:16-19` into `site/wrangler.jsonc` verbatim.
  - State that `ff4e4458` is a valid rollback only until the gateway is deleted.
  - Make Plan 3b re-point the rollback target to the first known-good site version before it deletes anything.

### M11. The `race.json` staleness check compares mtimes, which git doesn't keep. CONFIRMED (by construction)

- **Spec claim:** line 141 ("A check fails when `race.json` is older than the test file it records").
- **What breaks:** on a fresh clone or checkout, mtimes reflect checkout order, so the check passes or fails at random and can't catch a stale transcript.
- **Fix:** store `sha256(e2e/test/concurrency.test.ts)` in `race.json`, or the scenario function's file from B3, and fail when it differs.

### M12. `CodeTabs` hard-codes curl, JavaScript and Python tabs, and two of them are unsourced claims. CONFIRMED

- **Evidence:** `src/components/CodeTabs.astro:6-22` has fixed radio tabs `tab-curl`, `tab-js` and `tab-python`. A Python SDK is out of scope for v1 (governance lines 380-381), and raw-HTTP use with curl isn't in the proof inventory.
- **Fix:** parametrize the tabs, or show one JS panel. Either way, list it as a modified component rather than a lifted one.

### M13. "Nothing else comes over" is false: the listed components pull in a dependency tree the spec doesn't name. CONFIRMED

- **Spec claim:** lines 37-47.
- **What each component needs:**
  - **`Header`** imports `getCollection('docs')` and `listedProducts` (`Header.astro:4-5,26`), so it needs the content collection and `src/lib/products.ts`. With the new nav it's a rewrite.
  - **`Layout`** pulls in:
    - `ClientRouter` (`:2,57`), which `AutoTypingTerminal`'s `astro:page-load` depends on;
    - `../../styles/global.css`, at the repo root, not `src/`;
    - the `/fonts/*.woff2` preloads and `@font-face`, from `public/fonts`;
    - `/favicon.svg`;
    - the Umami script (see M4);
    - the default description `'Serverless APIs for modern developers'` (`:12`), which becomes every page's search snippet unless each page overrides it.
  - **`MagneticField` / `MagneticFieldTitle`** need `src/lib/pixi/{magnetic-field-singleton,field-renderer,title-renderer,field-config,utils}.ts`, `src/lib/design-tokens.ts` and `pixi.js`. `MagneticField.astro` still carries `[DIAG]` `console.log`s.
  - **The tokens** live in `src/lib/design-tokens.ts`, which `tailwind.config.ts` consumes along with `@tailwindcss/typography` (needed for the docs prose).
  - **`AutoTypingTerminal`** needs `prismjs`.
  - **The `@/` alias** comes from `astro.config.mjs`.
- **Fix:** replace "Nothing else comes over" with that list, and mark `Header`, `AutoTypingTerminal`, `CodeTabs` and `BottomCTA` as rewrites that keep the styling. `BottomCTA` is all old copy: "Get API Key", `"sm_..."`, and links to `/blog` and `/solenoid-mcp`.

### M14. "`/pricing` … answer 200" fails with Astro's default build format, and a Worker unit test can't see asset serving. CONFIRMED

- **Spec claim:** line 138.
- **Evidence:** live, `/pricing` returns 307 → `/pricing/`, and so do `/docs` and `/docs/catch/overview`. Workers assets' `auto-trailing-slash` applies to Astro's `directory` output. Assets are matched before the `fetch` handler runs, so a unit test of the handler never exercises them.
- **Fix:** set `build: { format: 'file' }`, or assert 307 → 200. Run the route test against `wrangler dev` over the built `dist`, or `@cloudflare/vitest-pool-workers` with the assets config.

### M15. No DMARC on `solenoid.systems`, which sends the recovery codes. CONFIRMED

- **Evidence (DoH, `cloudflare-dns.com`):**
  - `_dmarc.solenoid.systems` TXT returns NXDOMAIN.
  - DKIM `resend._domainkey` is present.
  - `send.solenoid.systems` SPF (`include:amazonses.com`) and MX are present.
  - The apex SPF is Cloudflare Email Routing only. The system `dig` returned nothing here; the sandbox resolver is broken, so use DoH to check.
- **Why it matters:** recovery by email is a proof-inventory claim, and a public security product invites spoofed "your recovery code" mail.
- **Fix:** add `_dmarc TXT "v=DMARC1; p=quarantine; rua=mailto:…"` (start at `p=none` for a week if you'd rather), and list it in the launch order.

---

## Minor

- **m1. The reasoning about `llms.txt` is overstated.** CONFIRMED. Spec line 26 says `llms.txt` "tells agents never to run" init, but `sdk/llms.txt:9` says "the developer runs … in their own terminal". Only line 78 has "never run them yourself", and that is about `email --rotate`. The design still works, but fix the claim, or add the sentence to `llms.txt`, which means re-grading it.
- **m2. There is no old MCP package to deprecate.** CONFIRMED. `registry.npmjs.org/@solenoid.systems%2Fmcp` returns 404, and so do `/sdk` and `/cli`. `npm deprecate` in step 2 will fail. Replace it with a note in the old `/downloads/solenoid.mcpb` listing, or drop it. Also add `repository`, `homepage` and `bugs` to the three `package.json` files so the npm pages link to the repo and the site.
- **m3. The proof-table update drops rows.** CONFIRMED. Spec lines 98-111 omit the brief's "Named competitor comparisons | avoid" row (`brief.md:45`), and replacing the table deletes that guardrail. Keep the row.
- **m4. The house-style lint will false-positive.** CONFIRMED. The lifted components contain HTML comments (`<!-- Font Preloads -->` at `Layout.astro:24`, `<!-- CTA Buttons -->` in `BottomCTA`). The README link `…#--env-filefile` (`sdk/README.md:24`) becomes an `href`, and CLI flags appear inside `<code>`. Lint text nodes only, excluding `code`, `pre`, `script`, `style`, comments and attributes. "open source used of the Worker" can't be linted: ban the phrase outright, or only on pages that name the Worker.
- **m5. The Playwright screenshot pass can't fail.** CONFIRMED. It is "not a pixel-diff test" (line 143), so it can't fail, yet line 145 runs it in `pnpm test` and pre-commit. A gate that measures nothing reads as coverage. Run it on demand only, like the race recording.
- **m6. `/why` says "first-party claims only" (line 58) and then retells third-party incidents.** Say "first-party claims, plus the brief's sourced incidents, cited".
- **m7. "only the CLI knows it" is wrong (line 54).** CONFIRMED. The account ID is the third field of every key (`sdk/README.md:106`). The pricing CTA also needs a first step for readers with no account yet.
- **m8. `/llms-full.txt`'s concatenation is unspecified.** The separator between the two files is undefined, and the single-source check (line 139) doesn't cover `llms-full.txt`. Define the bytes (e.g. `llms.txt + "\n" + README.md`) and check them.
- **m9. Some redirect targets are poor choices.**
  - Old doc deep links would serve readers better redirected to `/docs` than to `/`.
  - Agents fetching old `*.md` mirrors would be better redirected to `/llms.txt`.
  - A permanent 301 on `/blog` is cached by browsers and poisons a future blog. Use 302 or 308 for paths you might reuse.
- **m10. "A real signed entry" (line 66) must be signed with production `kid` `k1`.** An entry from `record-race`'s local `wrangler dev` has `kid: 'e2e'` (`e2e/global-setup.ts:37`) and won't verify against the live keys. Name the source, e.g. the canary tenant.
- **m11. The proof files are three tests in one file.** CONFIRMED. They are `it` blocks at `e2e/test/concurrency.test.ts:10, 21, 58`, not separate files, and they run against local `wrangler dev`, not production. The race counts `calls` spends and never sends anything, so the replay's "sends … refused before sending" is a gloss. The copy should say "spends".
- **m12. The pricing currency is unstated.** "$29" from a New Zealand business reads as NZD or USD. Say USD, and settle GST treatment with Stripe Tax.
- **m13. The root `README.md` is an ops runbook** (deploy steps, secrets). It is the first thing the public GitHub page shows. Write a product README for it, or move the runbook to `docs/`.
- **m14. Launch pieces the spec never mentions:**
  - **A 404 page.** Unlisted paths currently return a bare `Not Found` text; the handler needs an `ASSETS` binding to serve `404.html`.
  - **`robots.txt` and a sitemap.** The old `robots.txt` points at `/sitemap-index.xml`.
  - **Security headers.** Live pages send none: no HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors`, or CSP. Use a `_headers` file, and allow WebGL for Pixi.
  - **A `charset` on the text files.** `/llms.txt` is served as `text/plain` with no charset, while `sdk/llms.txt` and `README.md` contain U+2026 `…`. Browsers, and Python `requests`, which defaults `text/*` to ISO-8859-1, will mis-decode it. The bytes stay identical, so the byte check passes and misses this. Add `_headers`: `/llms*.txt  Content-Type: text/plain; charset=utf-8`.
  - **`www` canonicalization.** `www.solenoid.systems/` serves a duplicate 200. Redirect it to the apex, or add `<link rel=canonical>`.
  - **OG and Twitter meta and an OG image.** The old site had none.
  - **`/.well-known/security.txt` and `SECURITY.md`.** A security-relevant repo is about to go public.
  - **Terms, refund and cancellation text.** SUSPECTED: Stripe's live-mode activation reviews the website for these. The spec's out-of-scope "terms-of-service page" may block B2's live gate.

---

## Claims checked

| # | Spec claim (line) | Result |
|---|---|---|
| 1 | Old components `Layout`, `Header`, `MagneticField`, `MagneticFieldTitle`, `AutoTypingTerminal`, `CodeTabs`, `BottomCTA` exist (39-44) | All exist. Liftable: MagneticField, MagneticFieldTitle, Layout (with its dependencies, stripped). Rewrites: Header, AutoTypingTerminal, CodeTabs, BottomCTA (M13, M12, B3) |
| 2 | Tokens `#101012` / `#E4E4E7` / `#FF3F00` (45) | Hold (`src/lib/design-tokens.ts`); the components also hard-code `#00FF00`, `#333` and `#71717a` |
| 3 | "Nothing else comes over" (47) | False (M13) |
| 4 | Redirect list covers every old path (81-88, criterion 3) | Incomplete (M1) |
| 5 | Old binding to `solenoid-api-gateway` (88) | Exists (`wrangler.jsonc:10-15`; live version binding) |
| 6 | Deploying as `solenoid-systems` keeps the domains; rollback to `ff4e4458` (92) | The ID is current. Domains stay only if `routes` is copied; rollback expires at Plan 3b (M10) |
| 7 | e2e concurrency test: M parallel, exactly N pass (64, 100) | `e2e/test/concurrency.test.ts:10-19`: 30 spends, limit `calls=7`, asserts 7 `ok` and 23 `402 limit_exceeded`, and `ls` shows used 7. Holds, but it emits no transcript (B3) |
| 8 | Hold-and-settle test exists (101) | `:21-56`: 10 `run.llm` calls with a stubbed provider. Asserts refused calls never reach the provider, worst-case holds ≤ 500 at every point in the chain, and every hold is settled. Holds |
| 9 | `per: "child"` at-most-once test exists (102) | `:58-74`: 8 concurrent refunds on `order-1` → exactly 1 ok; a grandchild is refused; a sibling is allowed; an idempotent replay returns `replay: true`. Holds |
| 10 | `verify()` + `/.well-known/solenoid.json` verify offline (66, 103) | The endpoint is live and correct; `verify()` is online (M2) |
| 11 | `solenoid upgrade`; Payment Link needs the account ID only the CLI knows (54) | The command is absent; "only the CLI" is false (B2, m7) |
| 12 | Free 100,000 spends a month (54) | Enforced: `FREE_SPENDS = 100_000`, month window (`core.ts:9,379-383`) |
| 13 | `/docs` = `sdk/README.md`; llms served byte for byte (55-57, 139) | Achievable (no CR, trailing `\n`, only non-ASCII is U+2026); charset issue (m14); `llms-full` bytes unspecified (m8) |
| 14 | `llms.txt` tells agents never to run init (26) | False (m1) |
| 15 | `init` is step 1 of a working two-step CTA (26) | Without a scope, no spend key (B4) |
| 16 | FSL "competing hosted service"; identifier (23, 107, 151) | Wording and SPDX id wrong (M3); the SDK bundles Worker code (B1) |
| 17 | Privacy inventory (59) | Incomplete (M4) |
| 18 | `?ref=` attribution (59, 162) | Records nothing (M5) |
| 19 | Dogfooding struck: learning-loop PR #131 closed 2026-09-28 (109) | `gh pr view`: CLOSED `2026-09-27T23:16:01Z` = 2026-09-28 NZDT. Holds |
| 20 | Old repo CI redeploys the API (29) | It also deploys the site (M9) |
| 21 | Old `@solenoid.systems/mcp` major to deprecate (152) | Not on npm (m2) |
| 22 | Copy process: three cold `copy-grader` runs, `tally.py` (128) | Both exist (`~/.claude/skills/copy-chief/scripts/tally.py`, agent `copy-grader`); source checker omitted, closing units mislabelled (M6) |
| 23 | Brief proof table update (96-111) | Drops the "avoid" row (m3) |
| 24 | The launch order has no cycle (147-157) | Cycles: CLI publish before `upgrade` (B2); tag before audited code, and the link check before the tag (M7) |
| 25 | Canary exists (154) | Not built (no code references) |
| 26 | Recovery by email is live via README's Recovery section (106) | `sdk/README.md:84` section exists; DMARC missing (M15) |
| 27 | Tests run in `pnpm test` and lefthook "like the other packages" (145) | Lefthook runs `test:changed` and `typecheck` (`lefthook.yml`), so the site needs a `test:changed` script; `pnpm-workspace.yaml` needs `site` added |

## Commands run

- `git log --oneline -3` in both repos: `f190751` (solenoid) and `aba7bcc4` (solenoid.systems, `main...origin/main [ahead 1]`).
- `curl -si https://api.solenoid.systems/.well-known/solenoid.json` → 200, `{"keys":{"k1":{"kty":"OKP","crv":"Ed25519","x":"Ab-OcMOWkQRiOXyakaWHRVX_RVhJjNmHMzyaaxx08iA"}}}`.
- `curl -sI https://solenoid.systems/llms.txt` → `content-type: text/plain` (no charset).
- Live path probes:

  | Path | Status |
  |---|---|
  | `/pricing` | 307 → `/pricing/` |
  | `/docs` | 307 |
  | `/catch.md` | 200 `text/markdown` |
  | `/witness-verifier.html` | 307 → `/witness-verifier` |
  | `/status` | 301 → `/` |
  | `/api/health` | 200 JSON |
  | `/api/benchmarks/results.json` | 200 |
  | `/rss.xml` | 200 |
  | `/sitemap-index.xml` | 200 |
  | `/downloads/solenoid.mcpb` | 200 |
  | `/nonexistent` | 404 `text/plain` |
  | `/.well-known/security.txt` | 404 |
  | `www.solenoid.systems/` | 200 |
  | `/demos`, `/oauth`, `/checkout` | 404 |

- `curl …/sitemap-0.xml` → 94 URLs, prefix summary in M1.
- `wrangler deployments list --name solenoid-systems` → latest is `ff4e4458-…` (2026-09-28T21:36:55Z, 100%).
- `wrangler versions view ff4e4458-… --name solenoid-systems` → binding `env.API (solenoid-api-gateway)`, compat 2026-01-31, `nodejs_compat`.
- npm registry for `@solenoid.systems/{sdk,cli,mcp}` → 404 ×3. `-/org/solenoid.systems/package` → `{}`.
- `curl https://fsl.software/FSL-1.1-ALv2.template.md` → text quoted in M3. SPDX `FSL-1.1-ALv2.json` → exists; `FSL-1.1-Apache-2.0.json` → 404.
- DoH lookups:

  | Record | Result |
  |---|---|
  | `_dmarc` TXT | NXDOMAIN |
  | `resend._domainkey` TXT | DKIM key present |
  | `send.` TXT | `v=spf1 include:amazonses.com ~all` |
  | `send.` MX | SES |
  | apex TXT | `v=spf1 include:_spf.mx.cloudflare.net ~all` + google-site-verification |
  | apex MX | Cloudflare routing |

- `gh pr view 131 -R robinslange/learning-loop` → CLOSED 2026-09-27T23:16:01Z.
- `gh repo view robinslange/solenoid` → PRIVATE; `gh api …/tags` → `[]`.
- `git log --all -p` scans: no real `sk.admin` or `sk.spend` keys, `re_` or `sk_live` tokens, and no private JWK `d`. Found the personal email and tenant pairing (M8).
- A Python scan of `sdk/llms.txt` and `README.md`: only non-ASCII is U+2026; no em or en dashes, "at the edge", "open source" or "would have prevented". `--` outside code appears only in a URL fragment.
- Not run: `pnpm test` in `e2e/`. It starts `wrangler dev` and renames `worker/.dev.vars` (`e2e/global-setup.ts:39-40`); the assertions were read, not executed.

## Deferred contradictions

1. **When the tag is cut.** Step 1 against the site link check, the Stripe and canary code, and the race link (M7). Every link-emitting unit and the link check collide.
2. **Where the Payment Link URL lives, and test versus live mode.** The CLI publish (step 2), Stripe (step 3), the `/pricing` copy, and the governance risk at line 388 (B2).
3. **The redirect source of truth.** A hand list, or a fixture derived from the old site. The Worker handler and the Worker test both read it (M1).
4. **The `race.json` format, and how the test emits events.** `record-race.mjs`, the test file, the rewritten terminal, and the staleness check (B3, M11).
5. **The hero command's exact form (with scope, and where it runs).** The hero, the bottom CTA, the agent prompt, `llms.txt` and the privacy/attribution work (B4, M5).
6. **The `llms-full.txt` bytes.** The build and the single-source check (m8).
7. **The closing-unit set.** Every copy unit's grade (M6).
8. **The licensing of `sdk/testing`.** The `LICENSE` files, the npm publish and the lawyer brief (B1).

## Not checked

- Whether `wrangler deploy` with no `routes` detaches existing custom domains. Settle it with a dry run against a scratch Worker, or by reading the wrangler source for the version in use.
- Whether Workers Logs keeps client IPs and request headers for the API Worker. Check one log entry in the dashboard.
- Whether Stripe Payment Links support a metered overage price (governance line 388), and whether Stripe's live activation requires terms and a refund policy on the site.
- Whether the npm scope `@solenoid.systems` is owned by Robin's account. `-/org/…/package` returned `{}`; `npm org ls solenoid.systems` while logged in settles it.
- Cloudflare's current rollback caveats for Workers with static assets. The reading here comes from version metadata, not the docs.
- The e2e suite was not executed (see Commands run).
- The copy content itself: no copy exists yet to grade.
- Out of reviewer scope, noted once: a public repo exposes commit timestamps and authorship, which touches any employment IP carve-out. Robin's call, alongside the lawyer glance.

---

## Re-review (round 2)

**Reviewed:** 2026-09-29, the revised spec (working-tree copy over `f190751`) against `solenoid` at `f190751`, `solenoid.systems` at `aba7bcc4`, the rulings file, Stripe's docs (fetched as `.md`), Cloudflare's docs, npm and DoH. Nothing was edited except this file. Production calls were GETs only.

### Verdict

**EXECUTE AFTER FIXES.** Of the 33 first-round findings, 29 are RESOLVED, 4 are PARTLY resolved and 0 are NOT RESOLVED. The revision adds 0 Blockers, 8 Important findings and 11 Minor ones. Every Important fix is a line or two of spec text. None of them needs a redesign.

### Round-1 verdicts

| ID | Verdict | Checked on disk / in docs |
|---|---|---|
| B1 | RESOLVED | `sdk/src/testing.ts:2-4` imports `Tenant`, `Mail` and `handle` from `worker/src`, as spec :47 says. The SDK build's third esbuild step and `tsconfig.testing.json` exist (`sdk/package.json:14`). `@solenoid.systems/testing` is unclaimed on npm (404). The package split is sound. See N6 for the same leak coming back through `docs/`, and m-N9 for the test and mutation files the split leaves unplaced. |
| B2 | RESOLVED | The order is now upgrade, then publish (step 6), then live (step 7), then cutover (step 10). The Payment Link claim holds: the Payment Links guide lists recurring pricing as "Flat rate, Tiered" only, the Payment Link API has `line_items.quantity (integer, required)`, and the Checkout API has "Quantity should not be defined when `recurring.usage_type=metered`". New design issues are N3, N4, N5 and N7. |
| B3 | RESOLVED | The recorder reproduces `e2e/test/concurrency.test.ts:10-19` (init, `limit acme calls=7`, `key acme/bot`, 30 clients, 7 ok and 23 `402 limit_exceeded`, `ls` used 7). `RaceTerminal` is new, and the sha256 covers the drift risk. |
| B4 | RESOLVED | `sdk/llms.txt:9` is quoted accurately. `cli/src/commands.ts:202-205` writes `SOLENOID_KEY` to `.env` only when a scope is given, and only if `.env` doesn't already have one. |
| M1 | PARTLY | The prefix rules cover every live sitemap path and every `public/` file. They don't cover the 31 `/_astro/*` files in the old `dist/`, which the fixture generator includes (see N1). `/philosophy/` from the sitemap may not match the exact rule `/philosophy` (m-N1). |
| M2 | RESOLVED | `verifyChain(ascending, keys)` exists (`sdk/src/verify.ts`) and is exported from the root (`sdk/src/index.ts:14`). One receipt verifies with no continuity check. |
| M3 | RESOLVED | The identifier and license terms are right. `e2e/`, `contract/`, `site/`, `docs/` and the fonts are all licensed, and `worker/package.json` and `e2e/package.json` have no `license` field today. See N6. |
| M4 | RESOLVED | The inventory matches the code: `ops.ts` (unsalted sha256), `core.ts:35-36` (`codes`, `code_events`), `core.ts:310-313` (lazy prune) and Workers Logs (the CF docs say 7 days on Paid). The alarm design has a collision (N3). |
| M5 | PARTLY | Umami records `?ref=` on page visits. But spec :262 decides that C3 "is met" before any grader runs. `checks.md` C3 says to "quote the path from the draft", and a visit tag on inbound links neither appears in a landing unit's draft nor ties a visit to an `init`. The brief's other option (`brief.md:64`, "a distinct init source") is not taken. Expect C3 findings on all four closing units, and either accept them in writing or add an init source. |
| M6 | RESOLVED | The closing-unit rule matches `checks.md:17-25`. `copy-source-checker` exists, and `SKILL.md:69-85` requires it. |
| M7 | RESOLVED | The tag is cut in step 5 after the code lands, and the link check runs in dev mode and in launch mode. See N2 for the receipt, which lands after the tag. |
| M8 | RESOLVED | The grep list finds every hit in the tracked tree: the mail user name (README, record, this spec), the tenant ID (4 files), the home-directory prefix and the vault path. The commit identity is `robinslange@users.noreply.github.com`, so the snapshot's metadata is clean. For the orphan-commit hygiene, see m-N5. |
| M9 | RESOLVED | The repo `robinslange/solenoid-systems`, the workflow `ci-cd.yml` and the secret `CLOUDFLARE_API_TOKEN` all exist as named. |
| M10 | RESOLVED | The routes block matches the old `wrangler.jsonc` verbatim, and the rollback expiry is stated. |
| M11 | RESOLVED | The check now compares sha256 hashes. |
| M12 | RESOLVED | CodeTabs is TypeScript and CLI only. `sdk/README.md` has no `curl` usage, which fits "HTTP API not documented for direct use". |
| M13 | PARTLY | Every piece is decided. The fonts row is wrong, though: the old `styles/fonts.css` has 7 `@font-face` rules whose `src` is `url(@fontsource/...)`, and only 5 woff2 files exist in `public/fonts` (JetBrains Mono 500 and 700 have none). Carrying "the `@font-face` rules" while leaving `@fontsource` behind breaks every font URL (m-N2). |
| M14 | RESOLVED | The Cloudflare html-handling table under `drop-trailing-slash` gives `/file` 200 from `file.html`, and `/file/` and `/file/index.html` both 307 to `/file`. The old `x/index.html` dist paths therefore resolve. |
| M15 | RESOLVED | DoH returns `_dmarc.solenoid.systems TXT "v=DMARC1; p=none"`. |
| m1 | RESOLVED | Spec :28 matches `sdk/llms.txt:9`. |
| m2 | RESOLVED | `@solenoid.systems/{sdk,cli,mcp,testing}` all return 404, and `repository`, `homepage` and `bugs` are in step 1. |
| m3 | RESOLVED | Spec :235. |
| m4 | RESOLVED | |
| m5 | RESOLVED | |
| m6 | RESOLVED | |
| m7 | RESOLVED | |
| m8 | RESOLVED | `sdk/llms.txt` and `sdk/README.md` both end in exactly one `\n`, so the defined bytes are unambiguous. |
| m9 | RESOLVED | |
| m10 | RESOLVED | See N2 for timing. |
| m11 | RESOLVED | |
| m12 | PARTLY | Prices are in USD, and GST is open for Robin, as the spec itself says. |
| m13 | RESOLVED | |
| m14 | RESOLVED | The deferrals have reasons. The CF docs confirm `_headers` overrides default headers, including `Content-Type`. |

The eight deferred contradictions from round 1 are all settled in the spec.

### New findings

#### Important

**N1. The old-path fixture includes `/_astro/*`, and those paths can neither answer 200 nor be redirected. CONFIRMED.**
- Spec :159 feeds "the file list of the old `dist/`" into the fixture. Spec :270 asserts a final 200 for every fixture path, and success criterion 3 (:19) forbids a 404.
- `~/dev/solenoid.systems/dist` holds 31 `/_astro/*` files with content hashes, and the new build's hashes differ.
- A `/_astro/*` redirect is not a fix. The CF docs say "Redirects are always followed, regardless of whether or not an asset matches", so the rule would also redirect the new site's own JS and CSS.
- **What breaks:** the route test fails in `pnpm test` from the day the fixture lands, and criterion 3 can't be met as written.
- **Fix:** have the generator exclude `/_astro/` (hashed build output that nothing links to by URL), and say so in :159 and criterion 3.

**N2. `receipt.json` doesn't exist until step 8, but the site, and a test that reads it, land in step 1. CONFIRMED (sequencing).**
- Spec :127 captures the receipt "after the canary runs (Launch order, step 8)". Spec :274 runs `verifyChain` on `receipt.json` in `pnpm test`. Step 1 (:284) lands the site.
- **What breaks:** from step 1 to step 8, the site test fails, or can't run, on every commit that `test:changed` touches. That includes step 7's graded terms and refund text. The `launch` tag (step 5) also carries a site with no receipt.
- **Fix:** state what ships until step 8. For example, the receipt section and its test are skipped while `receipt.json` is absent, and the launch-mode build (step 10) fails if it is still absent.

**N3. One Durable Object alarm is asked to do two schedules, and the spec gives no rule for combining them. CONFIRMED.**
- Spec :196 has a code-row write set "its alarm to run the prune a day later". Spec :187 and :196 have the same handler send the daily Pro meter report.
- The CF DO alarms docs say "Each Durable Object is able to schedule a single alarm at a time", and "If you call `setAlarm` when there is already one scheduled, it will override the existing alarm."
- **What breaks:**
  - A code request on a Pro tenant pushes the meter report back by up to a day, or a meter reschedule drops the prune.
  - `TenantDO` has no `alarm()` today (`worker/src/tenant.ts`), and code rows are written in `core.ts`, which `testServer()` also runs on `node:sqlite` with no alarm API. The spec doesn't say how `core.ts` asks for an alarm.
  - The privacy task and the billing task, both in step 1, will each assume they own the alarm.
- **Fix:**
  - Keep a small due-schedule in `meta` (next prune, next meter report). `alarm()` runs whatever is due, then sets the alarm to the earliest remaining time.
  - Code writes call `setAlarm(min(existing, now + DAY))` through a hook that `TenantDO` supplies and `testServer()` stubs.

**N4. The meter event `identifier` doesn't make a retried report count once. CONFIRMED.**
- Spec :187 relies on `identifier` `<tenant>:<date>` "so a retried report counts once".
- Stripe's meter-event API: "Stripe enforces uniqueness within a rolling period of at least 24 hours. The enforcement of uniqueness primarily addresses issues arising from accidental retries … within extremely brief time intervals."
- **What breaks:** any re-send more than about 24 hours after the first is billed again. That covers a failed alarm retried the next day, and the shared alarm handler (N3) re-running the report.
- **Fix:**
  - Store the last reported day, or better the ledger `seq` reported up to, in `meta`, and report only the delta since it.
  - Keep `identifier` as a short-window guard only.
  - Also state the event `timestamp`. Stripe accepts the past 35 days and at most 5 minutes ahead. A report for the last day of a billing period that arrives after the invoice is drafted is either lost or shifted into the next period, and the final day before a cancellation is never reported. Pick one behaviour and write it down.

**N5. `upgrade` prints "the customer portal link" on 409, yet "the CLI holds no Stripe values". CONFIRMED (internal contradiction).**
- Spec :185 against :188.
- The portal login link differs between test and live mode, and the spec gives it no source. The restricted key (:188, "limited to Checkout Sessions and meter events") can't create portal sessions either.
- **Fix:** put the portal URL in the `409 already_pro` body, taken from a Worker var. Or name a single stable place, such as `/pricing`, and print that instead.

**N6. `docs/` is MIT, and `docs/superpowers/plans/2026-09-24-solenoid-core.md` contains the Worker's source. CONFIRMED.**
- Spec :44 licenses `docs/` MIT.
- That plan is 176 KB with 60 `ts` blocks, including the full text of `worker/src/chain.ts` (:554), `worker/src/keys.ts` (:1643) and `worker/src/tenant.ts` (:786, :823). The recovery-MCP plan has 38 more.
- **What breaks:** this is B1's leak again, through `docs/`. Anyone can lift an earlier Worker from the plans under MIT.
- **Fix:** license `docs/superpowers/` FSL-1.1-ALv2 in the table and in `LICENSING.md`, or leave the plans out of the public snapshot. Put it on the lawyer-glance list either way.

**N7. The webhook's behaviour with no secret set is unspecified between steps 3 and 7. SUSPECTED.**
- Spec :184 gives `/billing/checkout` a 503 with no secrets. `/billing/stripe` (:186) gets nothing. Step 3 deploys the route to production with no webhook secret, and it stays that way until step 7.
- An implementation that feeds an unset secret into HMAC as `"undefined"`, for example through a template string, accepts forged `checkout.session.completed` events, and anyone can mark any tenant `pro` for free.
- **Fix:** add "`/billing/stripe` answers 503 when the webhook secret is unset, before it reads the body", and a test for it.

**N8. The launch order has a possible cycle through Stripe activation. SUSPECTED.**
- Step 7 (:295) needs Stripe to have activated the account, and says any terms or refund text Stripe asks for "lands … before this step completes".
- Stripe's activation review reads the business website. Until step 10, that is the old twelve-product site, and the new pages that carry the terms only go live at step 10, which comes after step 7.
- The cycle is real only if the account isn't activated yet. Whether the old stack's Stripe account is already live wasn't checked.
- **Fix:** check activation status now (a step 0). If it isn't active, either let the new `/pricing` and terms go live before step 7 with the paid call to action withheld, or activate against the old site.

#### Minor

- **m-N1. Trailing-slash variants of exact rules.** SUSPECTED. The live sitemap lists `/philosophy/`, and `_redirects` has `/philosophy` exact (:171). The CF examples treat `/trailing` and `/notrailing/` as distinct sources. With no asset at that path, `drop-trailing-slash` doesn't apply, so the result is a 404. The route test would catch it. Use `/philosophy/*` alongside `/philosophy`, and do the same for `/status`, `/demos` and `/witness-verifier`.
- **m-N2. The fonts row (:70).** CONFIRMED (M13 PARTLY). Rewrite the `@font-face` rules to `/fonts/*.woff2`, and drop the 500 and 700 JetBrains Mono rules, or ship those files.
- **m-N3. `contract/` isn't a workspace package.** CONFIRMED. It has no `package.json` and isn't in `pnpm-workspace.yaml`. Spec :55 lists it "in the pnpm workspace". Fix the wording.
- **m-N4. "Archived untouched" contradicts step 9.** CONFIRMED. Spec :32 says the old repo is archived untouched in Plan 3b, but step 9 disables its workflow and deletes a secret. Say "archived in Plan 3b; its CI is disabled at step 9".
- **m-N5. The orphan snapshot's hygiene is unstated.** CONFIRMED.
  - `.superpowers/` (brainstorm and sdd output) is untracked and not in `.gitignore`, so a `git add -A` on the orphan branch publishes it.
  - Local `main` keeps the full history after `origin` points at the public repo, so one `git push origin main` or `--all` sends it.
  - Say: commit the index only; then `git branch -M public main` after deleting the old `main`, or keep the old `main` only under `history/`.
- **m-N6. "Removes the root `spends` limit" (:186, from governance :226).** CONFIRMED. No such row exists. The free cap is `#checkPlan` on `meta.plan` (`core.ts:379-383`), so the webhook sets `plan`. Say so.
- **m-N7. The privacy row omits the subscription ID.** CONFIRMED. Spec :186 stores it, and the Stripe row in the privacy table (:212) lists only the customer ID.
- **m-N8. The published npm README advertises Pro before it can be bought.** SUSPECTED. From step 6, the SDK tarball's `README.md` and `llms.txt` are frozen with the Pro wording (:189), while Pro can't be bought until step 7. If Stripe activation stalls, the published docs advertise a plan that answers 503. Decide which wording ships in the tarball.
- **m-N9. The `testing/` split leaves work unplaced.** CONFIRMED.
  - `sdk/test/testing.test.ts` runs the contract scenarios against `testServer()`.
  - `sdk/stryker.config.mjs` mutates `src/**`, which includes `testing.ts` today.
  - `MUTATION-SUMMARY.md:196,353` relies on relative imports for `inPlace` Stryker.
  - Say where the test and the mutation run move, and whether consumers import `../../testing/src` or the package name.
- **m-N10. The brief still has bare `init` in its example.** CONFIRMED. `brief.md:64` reads "`npx @solenoid.systems/cli init` gives you a key in your terminal", and a bare `init` writes no spend key. The brief update (:219) replaces only the proof table. Fix line 64 too.
- **m-N11. The race hash covers the whole test file.** CONFIRMED. Any edit to the hold-and-settle or `per: "child"` test changes the sha256 in `race.json` and forces a wrangler re-record. Hashing a shared scenario module would narrow it. This is friction, not a defect.

### Checks on the new design (no finding)

- The Checkout Session in `subscription` mode with a licensed $29 price plus a metered graduated price (0 to 2M at $0, then `unit_amount_decimal` 0.001 cents) is supported. The metered line takes no quantity. Graduated tiers apply to usage ("Tiered: The unit cost changes with … usage (graduated pricing)"). A tier needs `unit_amount` or `flat_amount`, and 0 is a valid `unit_amount`. That last point is SUSPECTED; it wasn't exercised in the API.
- `_redirects` and `_headers` apply on an assets-only Worker (CF docs). The limits are 2,000 static and 100 dynamic redirects, and 100 header rules. The table needs about 40 redirect lines. The fixture is a test file and is never deployed, so its size doesn't matter.
- The salted hash is sound. `perIp` needs `MASTER` threaded in (`router.ts:24`, `auth-routes.ts:66` both have it), and `crypto.subtle` HMAC runs in workerd and Node alike. Note that `MASTER`'s holder can still brute-force the IPv4 space, so the privacy page should say "salted", as it does, and never "anonymous".
- The public/private repo flow: renaming and then reusing the old name breaks GitHub's redirect to the archive, which is what you want here.

### Contradictions with the governance spec and the brief

Internal ones are N2, N5, m-N3, m-N4 and m-N7. With the brief, m-N10. With governance, see the list below.

### Governance-spec lines that now need a follow-up edit

`docs/superpowers/specs/2026-09-24-solenoid-governance-design.md`:

- **:74.** `POST /stripe/webhook` becomes `POST /billing/stripe`. Add `POST /billing/checkout`.
- **:176.** "`sdk.verify(receipt)` checks the signature offline" becomes `verifyChain([receipt], keys)` with saved keys.
- **:194, :205.** `sha256(k)` becomes the first 16 hex of `HMAC-SHA256(MASTER, "ip:" + k)`.
- **:203.** "the tenant ID … in the Stripe customer's metadata" becomes the Checkout `client_reference_id`, unless the webhook also writes customer metadata. Either way the privacy row must match.
- **:225.** The Payment Link and "needs no server endpoint" are superseded. The site spec says so, but the source line is unchanged.
- **:226.** Store the subscription ID too. The "root `spends` limit" is `meta.plan`.
- **:227.** Add the reporting-state and identifier rule (N4).
- **:228.** The portal link's source (N5).
- **:229.** "Payment Link" in Setup becomes a Checkout Session and a restricted key.
- **:251.** The 12-month pruning is deferred. Retention is the life of the account.
- **:314.** Old docs paths redirect to `/docs` and `.md` mirrors to `/llms.txt`. Only product pages go to `/`.
- **:339.** The test "After pruning, the chain verifies from its checkpoint" is deferred along with pruning.
- **:348.** The public repository's first commit is the squashed snapshot, and the history lives in `solenoid-history`.
- **:351.** Drop the old `@solenoid.systems/mcp` deprecation, since it was never published.
- **:366-367.** Build order "8. Site, 9. Stripe" becomes Stripe (test, then live) before the site cutover.
- **:388.** Close the first risk, since it is now resolved.
- **Optional, stale since the dogfood strike:** :318-322 and :364, the learning-loop integration and "Robin is using it from this point on".

### Commands run (round 2)

- `git log --oneline -3` and `git status`, `git branch -a`, `git worktree list` and `git tag`: one branch `main`, no tags, no worktrees. `.superpowers/` is untracked and not ignored.
- `git grep -l` for the scrub patterns (hits listed under M8). The same for the author's employer names, `192.168` and `.workers.dev`: 0 hits.
- Old site:
  - `git ls-files public` and `src/pages`;
  - `find dist -type f` (218 files, 31 of them `/_astro`);
  - `styles/fonts.css`: 7 `@fontsource` URLs;
  - the live `sitemap-0.xml`: 94 URLs, and the non-docs ones end in `/`.
- `gh repo view` for both repos, and `gh secret list -R robinslange/solenoid-systems` (`CLOUDFLARE_API_TOKEN` is present).
- Stripe docs, fetched as `.md`:
  - `payment-links/api` (the pricing-model list);
  - `api/payment-link/create` (`quantity` required);
  - `api/checkout/sessions/create` (the metered quantity note);
  - `api/billing/meter-event/create` (identifier uniqueness of at least 24 hours);
  - `recording-usage-api` (timestamps within 35 days, one concurrent call per customer per meter);
  - `subscriptions/pricing-models/tiered-pricing`.
- Cloudflare docs:
  - static-assets `redirects`, `headers` and `html-handling` (quoted above);
  - DO `alarms` (one alarm, and `setAlarm` overrides);
  - Workers Logs retention (7 days on Paid).
- npm registry: `@solenoid.systems/{sdk,cli,mcp,testing}` return 404. DoH `_dmarc` returns `p=none`.
- `tail -c` on `sdk/llms.txt` and `sdk/README.md`: each ends in one `\n`.

### Not checked (round 2)

- Whether the Stripe account is already activated for live mode. The Stripe dashboard, or `GET /v1/account` with the live key, settles it (N8).
- Whether a restricted key can be scoped to "Meter events: write" and "Checkout Sessions: write" alone. The restricted-key editor in the dashboard shows it.
- Whether `_redirects` exact rules match a trailing-slash variant. One `wrangler dev` run with the draft `_redirects` settles it (m-N1).
- Whether Vite fails or warns on the unresolved `url(@fontsource/…)` rules. Either way, the fonts don't load.
- A $0 `unit_amount` graduated tier on a meter-backed price, exercised in test mode. Step 2 covers it.
