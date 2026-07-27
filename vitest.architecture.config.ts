import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.architecture.test.ts',
      'src/**/*.architecture.test.tsx',
      'scripts/**/*.workflow.test.ts',
      'scripts/dev/repo-drift-check.test.ts',
    ],
    exclude: [
      '.worktrees/**',
      'src/testing/e2e/**',
    ],
    env: {
      NODE_ENV: process.env.NODE_ENV && process.env.NODE_ENV !== 'production' ? process.env.NODE_ENV : 'test',
    },
    setupFiles: ['./src/testing/vitest.setup.ts'],
  },
});
