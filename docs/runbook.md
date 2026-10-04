# Solenoid runbook

Limits and signed receipts for the actions AI agents take. Design: docs/superpowers/specs/2026-09-24-solenoid-governance-design.md.

## Deploy

The Worker serves `https://api.solenoid.systems`, a custom domain set in `worker/wrangler.jsonc`, and `https://solenoid.<account>.workers.dev`.

Secrets live in 1Password (vault Personal, item "Solenoid Worker secrets"). Every key Solenoid issues is derived from `MASTER`, and that item holds the only copy, so losing it invalidates every key ever issued. Nothing is written to disk except the ops admin key in step 4, which that step deletes.

**Fresh install or upgrade.**
- A fresh install runs steps 1, 2, 3 and 4, in that order. The ops tenant only exists after the first signup, so signup and recovery have no per-network limit from the deploy in step 3 until step 4 runs after that signup.
- An upgrade to this release, the one that adds email recovery, skips step 1 and runs step 2, then step 4, then step 3. Step 2 is needed because `RESEND_API_KEY` is new in this release. Step 4 runs against the Worker already running, which has an ops tenant, as production has. The Worker accepts the limits because they are data on the ops tenant, so `/auth/recover` is limited from its first request.
- A later upgrade runs step 3 alone.

1. Once only, on a fresh install: generate `MASTER` and `SIGNING_KEY` straight into 1Password. Running it again would mint a second `MASTER`. `op item create` takes the item as a JSON template on standard input when its argument is `-` ([op item create](https://www.1password.dev/cli/reference/management-commands/item#item-create)).
   ```bash
   node worker/scripts/gen-secrets.mjs | node -e 'const s = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(JSON.stringify({ title: "Solenoid Worker secrets", category: "SECURE_NOTE", fields: Object.entries(s).map(([label, value]) => ({ id: label, label, type: "CONCEALED", value })) }))' | op item create --vault Personal -
   ```
2. On a fresh install, or on the upgrade to this release: set up Resend, which sends the code, confirmation and change-notice emails.
   - Verify the domain of `MAIL_FROM` (`solenoid.systems`, from the var in `worker/wrangler.jsonc`) in Resend, as its [domains guide](https://resend.com/docs/dashboard/domains/introduction) describes. Until it is verified, every send fails.
   - Create a sending key, as its [API keys guide](https://resend.com/docs/dashboard/api-keys/introduction) describes, and store it in the item without it reaching your shell history. Paste the key at the silent prompt. `op item edit` sets a concealed field with `<field>[concealed]=<value>` ([op item edit](https://www.1password.dev/cli/reference/management-commands/item#item-edit)). The `op` docs warn that a value passed as a command argument can be visible to other processes on your machine while `op` runs:
     ```bash
     read -rs K && op item edit 'Solenoid Worker secrets' "RESEND_API_KEY[concealed]=$K"; unset K
     ```
3. Deploy, then set the secrets from 1Password. `op read` prints the field that an `op://vault/item/field` reference names ([op read](https://www.1password.dev/cli/reference/commands/read), [secret references](https://www.1password.dev/cli/secret-reference-syntax)). [`wrangler deploy`](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy) uploads the Worker, and [`wrangler secret put`](https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret-put) reads the secret from piped input:
   ```bash
   cd worker && pnpm exec wrangler deploy
   op read 'op://Personal/Solenoid Worker secrets/MASTER' | tr -d '\n' | pnpm exec wrangler secret put MASTER
   op read 'op://Personal/Solenoid Worker secrets/SIGNING_KEY' | tr -d '\n' | pnpm exec wrangler secret put SIGNING_KEY
   op read 'op://Personal/Solenoid Worker secrets/RESEND_API_KEY' | tr -d '\n' | pnpm exec wrangler secret put RESEND_API_KEY
   ```
   `MAIL_FROM` is a var, already set in `worker/wrangler.jsonc`, so it needs no secret. Without `RESEND_API_KEY`, every send fails. `/auth/email` then answers `502 email_failed`, but the recovery code, the confirmation and the change notice fail silently: `/auth/recover` still answers `202`, and no email arrives.
4. Set the per-network limits. They live on the ops tenant, `solenoidops2`, which is Solenoid's own account, and you set them with its admin key:
   ```bash
   OPS=$(MASTER=$(op read 'op://Personal/Solenoid Worker secrets/MASTER' | tr -d '\n') node worker/scripts/ops-key.mjs)
   export SOLENOID_API=https://api.solenoid.systems SOLENOID_CONFIG_DIR=$(mktemp -d)
   node cli/dist/solenoid.mjs login "$OPS"
   node cli/dist/solenoid.mjs limit signups signups=5 --per child-day
   node cli/dist/solenoid.mjs limit / signups=1000 --per day
   node cli/dist/solenoid.mjs limit recoveries recoveries=20 --per child-day
   rm -rf "$SOLENOID_CONFIG_DIR"; unset OPS SOLENOID_API SOLENOID_CONFIG_DIR
   ```
   The lines allow, in order: 5 signups per UTC day from each IPv4 address or IPv6 /64; 1,000 signups per UTC day in total; and 20 `/auth/recover` requests per UTC day from each IPv4 address or IPv6 /64. Without them, signup and recovery requests are unlimited. There is no global recovery cap, because one actor could use it to switch recovery off for everyone.

## Rotating the signing key

Every receipt names the Ed25519 key that signed it by `kid`. `/.well-known/solenoid.json` publishes the current key under `SIGNING_KID`, plus each key in `RETIRED_SIGNING_KEYS`, an object of kid to public JWK in `worker/wrangler.jsonc`. If a kid is in both, the current key is published. Move the old public key into `RETIRED_SIGNING_KEYS` before you swap the key, or every receipt issued so far stops verifying.

The current private key always lives in one place: the `SIGNING_KEY` field of "Solenoid Worker secrets", which step 3 of Deploy reads. Start by naming the kid in use and the new one in your shell. On the first rotation that is `CURRENT=k1 NEXT=k2`; after it, `CURRENT=k2 NEXT=k3`, and so on.

1. Print the current Ed25519 key's public half as an entry for `RETIRED_SIGNING_KEYS`:
   ```bash
   op read 'op://Personal/Solenoid Worker secrets/SIGNING_KEY' | node -e 'const { kty, crv, x } = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(JSON.stringify({ [process.argv[1]]: { kty, crv, x } }).slice(1, -1))' "$CURRENT"
   ```
2. Add that entry to the `RETIRED_SIGNING_KEYS` object in `worker/wrangler.jsonc`'s `vars`, next to the entries already there. The first time, create the object: `"RETIRED_SIGNING_KEYS": { <entry> }`. Deploy. Clients see no change yet, because `$CURRENT` is still the current key.
3. Generate a new Ed25519 key into the same 1Password item, as a second field, `SIGNING_KEY_NEXT`. The script also mints a `MASTER`; this command drops it, so no second `MASTER` is ever saved:
   ```bash
   op item edit 'Solenoid Worker secrets' "SIGNING_KEY_NEXT[concealed]=$(node worker/scripts/gen-secrets.mjs | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).SIGNING_KEY)')"
   ```
4. Set `SIGNING_KID` to the value of `$NEXT` in `worker/wrangler.jsonc`, and deploy it together with the new key, so both change in one version:
   ```bash
   cd worker
   P=$(mktemp -d)/secrets.json && mkfifo -m 600 "$P"
   ( op read 'op://Personal/Solenoid Worker secrets/SIGNING_KEY_NEXT' | tr -d '\n' | node -e 'process.stdout.write(JSON.stringify({ SIGNING_KEY: require("fs").readFileSync(0, "utf8") }))' > "$P" ) &
   pnpm exec wrangler deploy --secrets-file "$P"
   rm -rf "$(dirname "$P")"
   ```
   It uses a named pipe rather than `<(…)` because wrangler runs as a child process that can't read an inherited descriptor, while a named pipe is opened by path and holds nothing on disk. `--secrets-file` uploads the secrets in the same version as the code and vars, and keeps the secrets it doesn't name, such as `MASTER`. See the [wrangler deploy docs](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy); this was checked against wrangler 4.136.3.

   The SDK fetches the keys once per client. When it checks a receipt whose `kid` its copy lacks, it fetches them again from a URL with a fresh query string, so no HTTP cache can answer with the old set. It does that at most once every 5 seconds per client, and the interval is shared across kids: if any unknown `kid` caused a fetch in the previous 5 seconds, a receipt signed under `$NEXT` gets `false` without a fetch, and verifies when it is checked again after the interval. Otherwise the first receipt signed under `$NEXT` verifies when it is checked. The endpoint sends `cache-control: public, max-age=3600`, so a verifier that reads the keys some other way, through a cache and without a fresh query string, can return `false` for receipts signed under `$NEXT` for up to an hour after this step.
5. Make the new key the current one in 1Password, so step 3 of Deploy and the next rotation read it:
   ```bash
   op item edit 'Solenoid Worker secrets' "SIGNING_KEY[concealed]=$(op read 'op://Personal/Solenoid Worker secrets/SIGNING_KEY_NEXT')"
   op item edit 'Solenoid Worker secrets' 'SIGNING_KEY_NEXT[delete]'
   ```
6. Check past any cache. The query string makes the URL new to every cache, and the Worker ignores it:
   ```bash
   curl -s "https://solenoid.<account>.workers.dev/.well-known/solenoid.json?fresh=$(date +%s)"
   ```
   It must list both `$CURRENT` and `$NEXT`. Then, in a new process with the admin key, pass `(await sol.get('')).entries`, reversed to oldest first, to `sol.verifyChain`. It must return `true` for a page with entries from before and after the swap.

## Billing (Stripe)

The API Worker bills through Stripe with five secrets, set like the others in step 3 of Deploy, from the "Solenoid Worker secrets" item:

| Secret | What it is |
|---|---|
| `STRIPE_SECRET_KEY` | A restricted key with write access to Checkout Sessions, billing portal sessions, meter events and subscriptions. The last lets the webhook cancel a second subscription opened by a race; it mails security@solenoid.systems, and the payment is refunded by hand. |
| `STRIPE_WEBHOOK_SECRET` | The signing secret of the endpoint `https://api.solenoid.systems/billing/stripe`, which listens for `checkout.session.completed` and `customer.subscription.deleted` |
| `STRIPE_PRICE_PRO` | The $29 USD monthly licensed price |
| `STRIPE_PRICE_SPENDS` | The metered monthly price on the `spends` meter: 0 to 2,000,000 at $0, then 0.001 cents each |
| `STRIPE_PORTAL_CONFIG` | A billing portal configuration that cancels at the end of the period |

```bash
cd worker
for s in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_PRICE_PRO STRIPE_PRICE_SPENDS STRIPE_PORTAL_CONFIG; do
  op read "op://Personal/Solenoid Worker secrets/$s" | tr -d '\n' | pnpm exec wrangler secret put "$s"
done
```

Until all five are set, `POST /billing/checkout` and `POST /billing/stripe` answer `503 billing_unavailable`, and `solenoid upgrade` says billing is not open yet.
