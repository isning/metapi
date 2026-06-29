# Testing Framework

This repository uses five test layers:

## Unit

Fast, isolated tests for pure modules, helpers, reducers, formatters, and local UI behavior.

Use:
- `vitest.unit.config.ts`
- `src/testing/httpMock.ts`
- `src/testing/webHarness.ts`
- `src/testing/fixtures.ts`

Guidelines:
- mock external I/O
- avoid filesystem and database state unless the unit specifically owns it
- keep assertions close to one interface

## Integration

Tests that need real module collaboration, database state, Fastify routes, or service workflows.

Use:
- `vitest.integration.config.ts`
- `src/testing/dbHarness.ts`
- `src/server/test/**`

Guidelines:
- use isolated `DATA_DIR`
- boot a real DB and migrate it
- prefer app `inject()` over direct handler calls
- keep one feature per test file when the setup is heavy

Typical helpers:
- `bootIsolatedRuntimeDb()` for a fresh runtime DB and schema
- `createIsolatedDataDir()` when only the data directory needs isolation
- `closeFastifyApp()` for app cleanup in route-level tests
- `createTestApp()` for injectable Fastify apps with stable auth hooks
- `createUpstreamMock()` for protocol-level upstream fixture routing
- `createRouteGraphBuilder()` for graph-native route fixtures

## E2E

Browser-level checks for the full app, running against built artifacts.

Use:
- `playwright.config.ts`
- `src/testing/e2e/**`
- `src/testing/e2eHarness.ts`
- `src/testing/e2e/adminPages.ts`
- `scripts/dev/run-e2e.ts`
- `scripts/dev/e2ePreflight.ts`
- `scripts/dev/e2eRunnerConfig.ts`

Guidelines:
- verify routing, layout, and critical workflows
- avoid duplicating integration assertions
- keep smoke tests stable and small
- import `test` and `expect` from `src/testing/e2eHarness.ts`, not directly from `@playwright/test`
- do not use the raw Playwright `page` fixture in specs; use `checkedPage` or `adminPage`
- do not use the raw Playwright `request` fixture in specs; use `adminApi`
- use the `checkedPage` fixture for unauthenticated or special browser workflows that still need runtime error checks
- use the `adminPage` fixture for authenticated admin UI workflows
- use the `adminApi` fixture for authenticated setup and assertions through admin HTTP APIs
- use `adminApi.getJson()` / `postJson()` / `putJson()` / `patchJson()` / `deleteJson()` for authenticated JSON APIs that must return HTTP OK
- keep E2E admin API authorization header merging in `src/testing/e2eApiHeaders.ts`
- `checkedPage` and `adminPage` fail the test on browser `console.error` and uncaught `pageerror`
- keep shared admin page locators and smoke assertions in `src/testing/e2e/adminPages.ts`
- keep pure E2E page matching helpers in `src/testing/e2ePageMatchers.ts` with unit coverage
- use `E2E_BASE_URL` to target an already-running Metapi server; otherwise `npm run test:e2e` starts an isolated built server on a random free port. External targets must serve the built app static assets and the authenticated `/api/settings/auth/info` endpoint. The runner performs this preflight before starting Playwright so misdirected base URLs fail early.
- default E2E runs use an auto-cleaned temporary `E2E_DATA_DIR`; set `E2E_DATA_DIR` to preserve state for debugging
- CI uploads `playwright-report/` and `test-results/` when E2E fails; Playwright keeps failure screenshots, failure videos, and first-retry traces there
- `scripts/dev/run-e2e.ts` cleans temporary E2E data on normal exit and on spawn error
- `scripts/dev/e2eRunnerConfig.ts` owns local/external run environment decisions and has unit coverage

## Architecture

Architecture tests pin seams and prevent regressions in code ownership.

Examples:
- route files must stay thin
- proxy-core must not import route adapters
- transformers must stay protocol-pure

Use:
- `vitest.architecture.config.ts`
- `src/**/*.architecture.test.ts`
- `scripts/**/*.workflow.test.ts`

## Performance

Budgeted tests protect routes that must stay predictable under large local data
sets.

Use:
- `npm run test:performance`
- `scripts/dev/route-runtime-performance-gate.ts`
- `npm run bench:performance:throughput` for auto-concurrency route QPS sweeps
- `npm run bench:performance:http` for autocannon-based HTTP RPS sweeps
- `npm run bench:performance:matrix` for exploratory vCPU/worker scaling runs

Guidelines:
- treat the script as a merge gate, not an exploratory benchmark
- keep route-runtime budgets measured before upstream network I/O
- publish CPU milliseconds, elapsed QPS, CPU QPS, cache size, and memory data
- keep `test:performance` deterministic; use benchmark scripts for capacity
  planning, not larger fixed-width guesses
- keep heap pressure bounded with `--max-old-space-size=384` and explicit GC
- write the human report to `test-results/performance/route-runtime-performance-report.md`
- write the machine-readable report to `test-results/performance/route-runtime-performance-report.json`
- upload the performance report artifact from CI and append the Markdown report
  plus bounded throughput and matrix snapshot reports to the GitHub step summary
- tune budget values only with measured evidence
- use `bench:performance:throughput` to find meaningful route-decision QPS:
  it warms up, runs duration-based measurement windows, sweeps concurrency up
  to 10,000 by default, reports latency percentiles, CPU utilization,
  event-loop utilization, event-loop delay, peak concurrency, and the lowest
  concurrency that reaches 95% of peak median elapsed QPS
- use `bench:performance:http` for real HTTP RPS at the route-decision seam:
  it starts a local Fastify server, drives it with autocannon as an external
  load-generator process, sweeps connections, reports autocannon RPS and
  latency percentiles, and separately reports server-process CPU RPS. This
  covers TCP/HTTP/Fastify/JSON/auth/token-router overhead, but intentionally
  excludes upstream provider network I/O and streaming relay.
- keep vCPU and worker-count scaling checks out of `test:all`; use
  `bench:performance:matrix` when validating capacity planning or runtime
  scaling changes. The matrix runner writes
  `test-results/performance/matrix/route-runtime-performance-matrix-report.md`
  and `.json`, uses `taskset` when available for CPU affinity, and treats worker
  count as independent Node route-runtime gate processes. Matrix workers keep
  failed route-runtime gate budgets in the report instead of aborting the whole
  matrix; use `test:performance` for enforced merge budgets. CI runs bounded
  throughput, HTTP RPS, and 1/2-vCPU by 1/2-worker matrix snapshots, while full
  local capacity runs use the benchmark defaults.

## Mock Strategy

Prefer local test fixtures over global mocks.

Order of preference:
1. real module + isolated state
2. fixture-backed integration test
3. focused `vi.mock`
4. global stub only for browser/runtime seams

### Fixture Layout

Keep scenario fixtures under `src/testing/fixtures/`:

- `protocol/openai/**`
- `protocol/claude/**`
- `protocol/gemini/**`
- `route-graph/**`
- `macro/**`

Name fixtures by behavior, not by test number.

## Coverage Flow

1. Add or update a unit test for pure logic.
2. Add an integration test when the behavior crosses module seams.
3. Add an architecture test if the seam matters for future maintenance.
4. Add a performance gate when the behavior is on a high-cardinality runtime
   path.
5. Add an E2E smoke when the user-visible flow changes.

## Adding A Test

1. Decide the shallowest layer that can observe the behavior.
2. Use the nearest harness instead of hand-rolling globals.
3. Keep one scenario per test file when setup is heavy.
4. Add an architecture test if the change introduces a new seam.
5. If the behavior depends on upstream protocol text, encode it as a fixture.

## Commands

- `npm run test:unit`
- `npm run test:integration`
- `npm run test:architecture`
- `npm run test:performance`
- `npm run bench:performance:throughput`
- `npm run bench:performance:http`
- `npm run bench:performance:matrix`
- `npm run test:e2e:install`
- `npm run test:e2e`
- `npm run test:all`
