import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const host = process.env.E2E_HOST || '127.0.0.1';
const externalBaseURL = process.env.E2E_BASE_URL;
const port = externalBaseURL ? 0 : Number(process.env.E2E_PORT || 4174);
const baseURL = externalBaseURL || `http://${host}:${port}`;
const readyURL = new URL('logo.png', baseURL.endsWith('/') ? baseURL : `${baseURL}/`).toString();
const e2eDataDir = process.env.E2E_DATA_DIR || `./tmp/e2e-data-${port}`;

function findExecutableOnPath(names: string[]): string | undefined {
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const executable = join(directory, name);
      try {
        accessSync(executable, constants.X_OK);
        return executable;
      } catch {
        // Continue probing PATH.
      }
    }
  }
  return undefined;
}

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || (!process.env.CI
    ? findExecutableOnPath(['google-chrome', 'chromium', 'chromium-browser'])
    : undefined);

export default defineConfig({
  testDir: './src/testing/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  outputDir: 'test-results/e2e',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: [
          'npm run build',
          '&&',
          `HOST=${host}`,
          `PORT=${port}`,
          `DATA_DIR=${e2eDataDir}`,
          `AUTH_TOKEN=${process.env.E2E_AUTH_TOKEN || 'test-admin-token'}`,
          'node dist/server/index.js',
        ].join(' '),
        url: readyURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumExecutablePath
          ? { launchOptions: { executablePath: chromiumExecutablePath } }
          : {}),
      },
    },
  ],
});
