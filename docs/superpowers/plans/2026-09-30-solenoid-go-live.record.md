# Plan 3a execution record

Demo account for the landing receipt: lzbh3vnaxtjr (production, scope support-bot, one spend; its admin key is in 1Password as DEMO_ADMIN_KEY). The ID is public with the receipt, and the account holds nothing else.

## Task 0 (2026-10-01)
- Stripe activation: activated. Live `GET /v1/account` shows charges_enabled, payouts_enabled and details_submitted all true, no requirements currently due or past due, business URL omit.nz, country NZ. Order A.
- Restricted key (test): "solenoid-worker (test)", created in the dashboard with Checkout Sessions, Customer portal, Billing meter events and Subscriptions set to Write and every other resource at None. A read-only probe shows the editor bundled extra access: the key can also list Products, PaymentIntents and billing portal configurations. It is refused for Customers, Prices, Invoices, Charges, Payment Links, Plans, Coupons, Promotion Codes, Tax Rates, Events, Webhook Endpoints and Billing Meters. Stored as STRIPE_TEST_SECRET_KEY.

## Task 11: Serving

`compatibility_date` "2026-09-01" is accepted by wrangler 4.136.3 under `wrangler dev` with no warning and no fallback.

Trailing-slash check under `wrangler dev` 4.136.3 with `compatibility_date` 2026-09-01: an exact rule `/probe` answers `/probe` with 301 and `/probe/` with 404. Exact rules do not match a trailing slash, so the `/*` companions are what serve `/philosophy/` and the rest, and `serving.test.ts` requires one for every exact path rule. Under the same run, `/docs/` answered 301 to `/docs` (the splat); `/pricing/`, `/pricing.html` and `/pricing/index.html` answered 307 to `/pricing`; and `/?ref=hn` answered 200. The route test re-proves these on every `pnpm test`.

The old-path fixture (`site/test/fixtures/old-paths.txt`) holds 303 paths: 94 from the live `solenoid.systems/sitemap-0.xml`, 76 from the old repo's `public/`, 187 from its built `dist/` (excluding `/_astro/*`), 22 from its page routes, plus 4 extra paths. No fixture path needed a `_redirects` line beyond the spec's table; `test/dist/routes.test.ts` passed against the built `dist/` under `wrangler dev` with zero problems on the first run.

## Task 16: Stripe in test mode (2026-10-01)

Objects created in test mode (IDs in 1Password: STRIPE_TEST_METER, STRIPE_TEST_PRICE_PRO, STRIPE_TEST_PRICE_SPENDS, STRIPE_TEST_PORTAL_CONFIG): the `spends` meter, the "Solenoid Pro" product, the $29 USD monthly licensed price, the graduated metered price, and the portal configuration. The first tier took `tiers[0][unit_amount]=0` as written.

Local Worker on `127.0.0.1:8790`, since 8787 and 8788 were held by other local dev servers; `stripe listen` forwarded to `:8790/billing/stripe`.

- First subscription: two `upgrade` runs printed the same Checkout URL (Decision 17). After payment, `checkout.session.completed` answered 200; the attach-code send was attempted and failed on the missing local `RESEND_API_KEY`, and the webhook still answered 200. `upgrade` then printed the billing portal URL and exited 0; the portal offers cancellation at the end of the period. Three spends succeeded.
- Tiers: one hand-sent meter event of 3,000,000; the invoice preview showed $29.00, 2,000,000 at $0.00 and 1,000,000 at $0.00001 = $10.00, total $39.00.
- Duplicate: a hand-made Checkout Session for the same tenant, paid while Pro. The webhook answered 200; the new subscription is `canceled`, the original stayed `active`; the Durable Object's `meta` held `duplicate:<new sub>` = `cancelled` with `stripe_subscription` unchanged; the log named the tenant, the subscription and the session, and the notice to security@ failed on the missing local `RESEND_API_KEY`. The hand-made session carries no `customer`, so Stripe created a second test customer for it.
- First cancellation: `customer.subscription.deleted` answered 200, `plan` became `free`, `meter_seq` 3; the meter's event summaries for the customer summed to 3,000,003.
- Second subscription: `upgrade`, payment, two spends, cancellation; the same customer was reused, `meter_seq` moved from 3 to 5, and the summaries summed to 3,000,005.
- Differences from the plan: `stripe delete` asks for confirmation, so a non-interactive run needs `--confirm`; the Worker's `success_url` lands on the old site's `/pricing` until the cutover (Task 24). The runbook holds no Stripe commands, so it needed no correction.

## Task 17: API deploy (2026-10-01 NZT)

- Deployed from a clean `main` at 3c63ae6 with `SOLENOID_*` unset: version c87322ec-9859-4df3-9d08-4357fe58d32f, created 2026-09-30T22:59:56Z, on `api.solenoid.systems (custom domain)`. Rollback target: 766f2a7c-75a0-482b-8285-001b20d3cac6 (2026-09-28). `wrangler secret list` shows no `STRIPE_*` name.
- Smoke: `/.well-known/solenoid.json` answered 200; `POST /billing/stripe` and `POST /billing/checkout` (demo admin key) both answered `{"error":"billing_unavailable"}`.
- The privacy row's salted-hash cutover now reads "before 11 pm UTC on 30 September 2026", the deploy time, since the deploy fell on 30 September in UTC and 1 October in New Zealand.


## Task 18: the public tree (2026-10-01)

- Scrub: `.scrub-patterns` (git-ignored) holds the spec's five patterns, the four test-mode Stripe IDs and the author's employer names. The first run found 20 hits in 9 files under `docs/`; each became a placeholder that keeps its sentence true (`<you>@example.com`, `solenoid.<account>.workers.dev`, `<tenant>`, a repository-relative path, `<vault>`), and the lines that listed the raw patterns now describe them in words. A hand read of `docs/` found three more: a review line naming employers, the canary host's name (now "a second host in Auckland"), and the ops tenant ID, which stays because the Worker's source names it and the ID alone grants nothing. `node scripts/scrub-check.mjs --from .scrub-patterns`: no tracked file contains any of the 12 patterns.
- gitleaks 8.30.1, `gitleaks dir . --redact`: 6 generic-api-key findings. Four are one synthetic test key (`sk.spend.abcdefghijkl.1.0.YQ.` followed by zeros) in `mcp/test/` and the recovery plan; two are in the git-ignored `.superpowers/` scratch. No real secret.
- Root `pnpm test`: every package passed.
- The lawyer glance: pending.

## Task 23: the old deploy path (2026-10-02)

- `robinslange/solenoid-systems`: the CI/CD workflow is `disabled_manually`; the `CLOUDFLARE_API_TOKEN` secret is deleted (`gh secret list` shows only `CLOUDFLARE_ACCOUNT_ID` and `SOLENOID_BENCH_KEY`).
- The Cloudflare user API token `solenoid-github-deploy` is revoked.
- The lawyer glance (Task 18, Step 4) is deferred by Robin until there are paying customers.

## Task 20: npm (2026-10-02)

- Published from `main` at b703870, whose tree the `launch` snapshot will repeat (the repository opens after the cutover, by Robin's call). Robin ran the publish loop in his terminal for the one-time password, after joining the `solenoid.systems` organisation.
- `@solenoid.systems/sdk` 0.1.0, `@solenoid.systems/cli` 0.1.0, `@solenoid.systems/mcp` 2.0.0, `@solenoid.systems/testing` 0.1.0 (license `FSL-1.1-ALv2`), all public. The registry's CDN answered 404 for about four minutes after publishing. From outside the workspace, `npx -y @solenoid.systems/cli@0.1.0 help` lists `upgrade`.
- Until the repository opens, each package's `repository` and `homepage` links point at a private repository.

## Task 21: Stripe live mode (2026-10-04)

- Robin said yes to live mode on 2026-10-02.
- Live restricted key: same scope as the test key (read probe: subscriptions, Checkout Sessions, products, PaymentIntents and portal configurations reachable; customers, prices, invoices, meters, events and webhook endpoints refused). Stored as `STRIPE_SECRET_KEY`.
- Live objects created with a temporary setup key: the `spends` meter, the "Solenoid Pro" product, the $29 USD monthly licensed price, the graduated metered price (2,000,000 at $0, then 0.001 cents; linked to the meter), the billing portal configuration (cancel at period end), and the webhook endpoint `https://api.solenoid.systems/billing/stripe` for `checkout.session.completed` and `customer.subscription.deleted`. Their IDs are in the 1Password item and in `.scrub-patterns`; none is written here.
- No old Solenoid webhook endpoint existed in live mode (neither `/hooks/stripe` URL is listed), so none was disabled. The account's two other endpoints serve other products and were left alone.
- The five secrets are set on the API Worker with the runbook loop.
- No live payment was made, by Robin's call: a refund does not return Stripe's fees, and the test-mode run (Task 16) proved the flow. Instead: `POST /billing/checkout` with the demo account's admin key returned a live `checkout.stripe.com` URL (never opened; it expires unused), and `POST /billing/stripe` without a valid signature answered `400 invalid_signature`. The first real payment's webhook delivery is to be checked in the dashboard.
- The temporary setup key is deleted from the 1Password item.

## Task 24: site cutover (2026-10-04)

- Built from `main` at de8c253; `check-dist` in development mode: 0 problems (the `--launch` check runs after the repository opens, by Robin's order: cutover first, then Task 19).
- Robin deployed `solenoid-systems`: version b985bfe9-4248-4989-b729-23894096b230 on `solenoid.systems` and `www.solenoid.systems`. Rollback target: ff4e4458-27f2-4b25-b342-ced607dfc078, valid until Plan 3b deletes `solenoid-api-gateway`.
- Production: both hosts serve `id="start-hero"`; `check-routes` over the 303 old paths: 0 problems; `/llms.txt` and `/llms-full.txt` match the SDK byte for byte; `/pricing` answers 200.
