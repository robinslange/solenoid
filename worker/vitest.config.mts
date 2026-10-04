import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
const SIGNING_KEY = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))
const retired = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
const RETIRED_SIGNING_KEYS = JSON.stringify({ k0: await crypto.subtle.exportKey('jwk', retired.privateKey), k1: { kty: 'OKP', crv: 'Ed25519', x: 'not-the-current-key' } })

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: {
      bindings: {
        MASTER: 'test-master-secret', SIGNING_KEY, SIGNING_KID: 'k1', RETIRED_SIGNING_KEYS, RESEND_API_KEY: '',
        STRIPE_SECRET_KEY: 'rk_test_vitest', STRIPE_WEBHOOK_SECRET: 'whsec_vitest', STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_SPENDS: 'price_spends', STRIPE_PORTAL_CONFIG: 'bpc_vitest',
      },
      outboundService: () => new Response('outbound fetch is refused in the Worker tests', { status: 599 }),
    },
  })],
  test: {
    coverage: { provider: 'istanbul', include: ['src/**/*.ts'], exclude: ['src/env.d.ts'], reporter: ['text', 'json-summary'], reportsDirectory: 'reports/coverage' },
  },
})
