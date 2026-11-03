import { defineConfig } from 'vitest/config'

// The route-quality evaluation is slow (minutes), so it is not part of `npm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['eval/**/*.eval.ts'],
    testTimeout: 60 * 60_000,
  },
})
