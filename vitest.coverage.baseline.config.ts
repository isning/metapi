import base from './vitest.unit.config.js';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(base, defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json-summary'],
      include: [
        'src/shared/**/*.{ts,tsx,js,jsx}',
        'src/server/**/*.{ts,tsx,js,jsx}',
        'src/web/**/*.{ts,tsx,js,jsx}',
        'src/desktop/**/*.{ts,tsx,js,jsx}',
      ],
      exclude: [
        'src/**/*.test.{ts,tsx,js,jsx}',
        'src/**/*.architecture.test.{ts,tsx,js,jsx}',
        'src/**/*.live.test.{ts,tsx,js,jsx}',
        'src/**/__tests__/**',
        'src/**/*.d.ts',
      ],
      thresholds: {
        lines: 63,
        functions: 64,
        branches: 69,
        statements: 63,
      },
    },
  },
}));
