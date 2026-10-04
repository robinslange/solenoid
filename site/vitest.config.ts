import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: { alias: [{ find: /^@solenoid\.systems\/sdk$/, replacement: fileURLToPath(new URL('../sdk/src/index.ts', import.meta.url)) }] },
  test: { setupFiles: ['test/setup.ts'], testTimeout: 60_000, hookTimeout: 180_000 },
})
