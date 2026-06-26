# Local Test Environment

This repository uses npm as the package manager. CI runs `npm ci` from
`package-lock.json`; do not add a second package-manager lockfile.

## Install

```bash
npm ci
```

The repository requires Node.js `>=25.0.0`. Use the same major version locally
when validating CI-equivalent flows.

## Test Layers

Run the focused layers:

```bash
npm run test:unit
npm run test:integration
npm run test:architecture
```

Run browser E2E after installing Chromium:

```bash
npm run test:e2e:install
npm run test:e2e
```

Run the complete local suite:

```bash
npm run test:all
```

## Local E2E Server

Playwright builds the app and starts the server from `playwright.config.ts`.
The default E2E runtime uses:

- `DATA_DIR=./tmp/e2e-data-<port>`
- `AUTH_TOKEN=test-admin-token`
- `http://127.0.0.1:<free port>`, preferring `4174` when available

Override these with `E2E_PORT`, `E2E_HOST`, `E2E_BASE_URL`, or
`E2E_AUTH_TOKEN` when needed. When `E2E_BASE_URL` is set, Playwright uses the
already-running server and does not start a local built server.

`npm run test:e2e` creates a temporary E2E data directory and removes it after
the run. Set `E2E_DATA_DIR` explicitly when you need to inspect or preserve the
runtime database. The runner cleans temporary data after normal completion and
after Playwright spawn failures.

Playwright writes local failure artifacts to `test-results/` and the HTML
report to `playwright-report/`; both directories are ignored by git. CI uploads
them when the E2E job fails. Failure artifacts include screenshots, retained
videos, and first-retry traces.

## Shared Harnesses

Use shared helpers instead of copying setup code:

- `src/testing/dbHarness.ts` for isolated runtime DB and Fastify cleanup
- `src/testing/e2eHarness.ts` for Playwright `test`/`expect`, `checkedPage`, `adminPage`, and authenticated `adminApi` / `adminApi.*Json()`
- `src/testing/httpMock.ts` for focused fetch mocks
- `src/testing/webHarness.ts` for browser storage/auth test state
- `src/server/test/**` for server-side feature fixtures

Full test policy lives in
[docs/engineering/testing-framework.md](./docs/engineering/testing-framework.md).
