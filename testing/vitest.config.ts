import { configDefaults, defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    testTimeout: 20_000,
    setupFiles: ['test/setup.ts'],
    exclude: [...configDefaults.exclude, '.stryker-tmp/**', ...(process.env.STRYKER ? ['test/bundle.test.ts'] : [])],
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text', 'json-summary'], reportsDirectory: 'reports/coverage' },
  },
})
