import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@solenoid\.systems\/sdk$/, replacement: fileURLToPath(new URL('../sdk/src/index.ts', import.meta.url)) },
      { find: /^@solenoid\.systems\/sdk\/node$/, replacement: fileURLToPath(new URL('../sdk/src/node.ts', import.meta.url)) },
    ],
  },
  test: {
    testTimeout: 30_000,
    setupFiles: ['test/setup.ts'],
    unstubEnvs: true,
    unstubGlobals: true,
    restoreMocks: true,
    exclude: [...configDefaults.exclude, ...(process.env.STRYKER ? ['test/bundle.test.ts'] : [])],
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text', 'json-summary'], reportsDirectory: 'reports/coverage' },
  },
})
