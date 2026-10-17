import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every workspace that has tests. scripts/lib/vitest-projects.test.mjs
    // fails if one is missing, because a package can be added with a full
    // suite and simply never be run: packages/kit-templates had three test
    // files and its own vitest.config.ts, and was absent from this list, so
    // `npm test` and CI had never executed any of them. That included the
    // guard asserting the free preview never fabricates a candidate or
    // implies a payment has happened.
    projects: [
      'apps/web/vitest.config.ts',
      'packages/contracts/vitest.config.ts',
      'packages/config/vitest.config.ts',
      'packages/kit-templates/vitest.config.ts',
      'packages/local-adapters/vitest.config.ts',
      'services/api/vitest.config.ts',
      'scripts/vitest.config.ts',
    ],
  },
});
