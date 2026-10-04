/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.config.ts', related: false },
  mutate: ['src/**/*.ts', '!src/bin.ts'],
  coverageAnalysis: 'perTest',
  inPlace: true,
  concurrency: 4,
  timeoutMS: 60000,
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  reporters: ['clear-text', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 95, low: 90, break: 90 },
}
