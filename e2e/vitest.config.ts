import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: { alias: [{ find: /^\.\.\/sdk\/src\/index$/, replacement: fileURLToPath(new URL('../sdk/dist/solenoid.mjs', import.meta.url)) }] },
  test: {
    globalSetup: ['./global-setup.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 30_000,
  },
})
