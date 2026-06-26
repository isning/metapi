import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      '.worktrees/**',
      'src/**/*.architecture.test.ts',
      'src/**/*.architecture.test.tsx',
      'src/server/routes/**/*.test.ts',
      'src/server/db/**/*.live.test.ts',
      'src/server/runtimeDatabaseBootstrap.test.ts',
      'src/server/runtimeSettingsHydration.test.ts',
      'src/server/services/**/*workflow*.test.ts',
      'src/server/services/**/*Runtime*.test.ts',
      'src/server/services/**/*Store*.test.ts',
      'src/server/services/**/*Service.test.ts',
      'src/server/services/dummyUpstreamSeedService.test.ts',
      'src/testing/e2e/**',
      'scripts/**/*.workflow.test.ts',
      'scripts/dev/repo-drift-check.test.ts',
    ],
    env: {
      NODE_ENV: process.env.NODE_ENV && process.env.NODE_ENV !== 'production' ? process.env.NODE_ENV : 'test',
    },
    setupFiles: ['./src/testing/vitest.setup.ts'],
  },
});
