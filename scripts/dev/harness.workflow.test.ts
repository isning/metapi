import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

function collectFiles(root: string, predicate: (path: string) => boolean): string[] {
  const entries = readdirSync(root).sort();
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(root, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      files.push(...collectFiles(absolutePath, predicate));
      continue;
    }
    if (predicate(absolutePath)) files.push(absolutePath);
  }

  return files;
}

describe('harness workflows', () => {
  it('keeps repo drift checks wired into ci and scheduled reporting', () => {
    const ciWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const driftWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/harness-drift-report.yml'), 'utf8');
    const gitignore = readFileSync(resolve(process.cwd(), '.gitignore'), 'utf8');
    const playwrightConfig = readFileSync(resolve(process.cwd(), 'playwright.config.ts'), 'utf8');

    expect(ciWorkflow).toContain('name: Repo Drift Check');
    expect(ciWorkflow).toContain('npm run repo:drift-check');
    expect(ciWorkflow).toContain('name: Test Core');
    expect(ciWorkflow).toContain('name: Test Integration');
    expect(ciWorkflow).toContain('name: Test Architecture');
    expect(ciWorkflow).toContain('name: Test Performance');
    expect(ciWorkflow).toContain('name: Test E2E');
    expect(ciWorkflow).toContain('npm run test:unit');
    expect(ciWorkflow).toContain('npm run test:integration');
    expect(ciWorkflow).toContain('npm run test:architecture');
    expect(ciWorkflow).toContain('npm run test:performance');
    expect(ciWorkflow).toContain('name: Run route runtime throughput benchmark report');
    expect(ciWorkflow).toContain('npm run bench:performance:throughput');
    expect(ciWorkflow).toContain('ROUTE_THROUGHPUT_CONCURRENCY_SWEEP: 1,16,128,512');
    expect(ciWorkflow).toContain('ROUTE_THROUGHPUT_DURATION_MS: 750');
    expect(ciWorkflow).toContain('name: Run route HTTP RPS benchmark report');
    expect(ciWorkflow).toContain('npm run bench:performance:http');
    expect(ciWorkflow).toContain('ROUTE_HTTP_RPS_CONNECTION_SWEEP: 1,16,64');
    expect(ciWorkflow).toContain('ROUTE_HTTP_RPS_DURATION_SECONDS: 2');
    expect(ciWorkflow).toContain('name: Run route runtime performance matrix report');
    expect(ciWorkflow).toContain('npm run bench:performance:matrix');
    expect(ciWorkflow).toContain('ROUTE_PERF_MATRIX_VCPUS: 1,2');
    expect(ciWorkflow).toContain('ROUTE_PERF_MATRIX_WORKERS: 1,2');
    expect(ciWorkflow).toContain('ROUTE_PERF_DISTINCT_CONCURRENT_SAMPLES: 10000');
    expect(ciWorkflow).toContain('ROUTE_PERF_DISTINCT_CONCURRENT_WIDTH: 10000');
    expect(ciWorkflow).toContain('name: Publish performance step summary');
    expect(ciWorkflow).toContain('GITHUB_STEP_SUMMARY');
    expect(ciWorkflow).toContain('route-runtime-throughput-benchmark-report.md');
    expect(ciWorkflow).toContain('route-http-rps-benchmark-report.md');
    expect(ciWorkflow).toContain('route-runtime-performance-matrix-report.md');
    expect(ciWorkflow).toContain('name: Upload performance report');
    expect(ciWorkflow).toContain('route-runtime-performance-report');
    expect(ciWorkflow).toContain('test-results/performance/');
    expect(ciWorkflow).toContain('npm run test:e2e:install');
    expect(ciWorkflow).toContain('npm run test:e2e');
    expect(ciWorkflow).toContain('name: Upload E2E artifacts');
    expect(ciWorkflow).toContain('playwright-report/');
    expect(ciWorkflow).toContain('test-results/e2e/');
    expect(ciWorkflow).toContain('name: Build Web');
    expect(ciWorkflow).toContain('name: Typecheck');

    expect(playwrightConfig).toContain("outputDir: 'test-results/e2e'");
    expect(playwrightConfig).toContain("outputFolder: 'playwright-report'");
    expect(playwrightConfig).toContain("screenshot: 'only-on-failure'");
    expect(playwrightConfig).toContain("trace: 'on-first-retry'");
    expect(playwrightConfig).toContain("video: 'retain-on-failure'");
    expect(playwrightConfig).toContain('const readyURL');
    expect(playwrightConfig).toContain("new URL('logo.png'");
    expect(playwrightConfig).toContain('url: readyURL');
    expect(gitignore).toContain('test-results/');
    expect(gitignore).toContain('playwright-report/');

    expect(driftWorkflow).toContain('schedule:');
    expect(driftWorkflow).toContain('workflow_dispatch:');
    expect(driftWorkflow).toContain('npm run repo:drift-check -- --format markdown --output tmp/repo-drift-report.md --report-only');
    expect(driftWorkflow).toMatch(/actions\/upload-artifact@v\d+/);
    expect(driftWorkflow).toContain('repo-drift-report');
  });

  it('keeps the test layer entrypoints wired in package scripts and docs', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const testingFrameworkDoc = readFileSync(resolve(process.cwd(), 'docs/engineering/testing-framework.md'), 'utf8');
    const performanceGate = readFileSync(resolve(process.cwd(), 'scripts/dev/route-runtime-performance-gate.ts'), 'utf8');
    const throughputBenchmark = readFileSync(resolve(process.cwd(), 'scripts/dev/route-runtime-throughput-benchmark.ts'), 'utf8');
    const httpBenchmark = readFileSync(resolve(process.cwd(), 'scripts/dev/route-http-rps-benchmark.ts'), 'utf8');
    const e2eRunner = readFileSync(resolve(process.cwd(), 'scripts/dev/run-e2e.ts'), 'utf8');
    const e2ePreflight = readFileSync(resolve(process.cwd(), 'scripts/dev/e2ePreflight.ts'), 'utf8');
    const e2eRunnerConfig = readFileSync(resolve(process.cwd(), 'scripts/dev/e2eRunnerConfig.ts'), 'utf8');

    expect(packageJson.scripts?.['test:unit']).toContain('vitest.unit.config.ts');
    expect(packageJson.scripts?.['test:integration']).toContain('vitest.integration.config.ts');
    expect(packageJson.scripts?.['test:architecture']).toContain('vitest.architecture.config.ts');
    expect(packageJson.scripts?.['test:performance']).toContain('route-runtime-performance-gate.ts');
    expect(packageJson.scripts?.['test:performance']).toContain('--expose-gc');
    expect(packageJson.scripts?.['test:performance']).toContain('--max-old-space-size=384');
    expect(packageJson.scripts?.['bench:performance:throughput']).toContain('route-runtime-throughput-benchmark.ts');
    expect(packageJson.scripts?.['bench:performance:throughput']).toContain('--expose-gc');
    expect(packageJson.scripts?.['bench:performance:http']).toContain('route-http-rps-benchmark.ts');
    expect(packageJson.scripts?.['bench:performance:http']).toContain('--expose-gc');
    expect(packageJson.scripts?.['bench:performance:matrix']).toContain('route-runtime-performance-matrix.ts');
    expect(packageJson.scripts?.['test:e2e']).toContain('scripts/dev/run-e2e.ts');
    expect(packageJson.scripts?.['test:all']).toContain('test:unit');
    expect(packageJson.scripts?.['test:all']).toContain('test:integration');
    expect(packageJson.scripts?.['test:all']).toContain('test:architecture');
    expect(packageJson.scripts?.['test:all']).toContain('test:performance');
    expect(packageJson.scripts?.['test:all']).toContain('test:e2e');
    expect(packageJson.scripts?.['test:all']).not.toContain('bench:performance:throughput');
    expect(packageJson.scripts?.['test:all']).not.toContain('bench:performance:http');
    expect(packageJson.scripts?.['test:all']).not.toContain('bench:performance:matrix');
    expect(packageJson.devDependencies?.['@playwright/test']).toBeTruthy();
    expect(existsSync(resolve(process.cwd(), 'package-lock.json'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'pnpm-lock.yaml'))).toBe(false);
    expect(performanceGate).toContain("readPositiveInteger('ROUTE_PERF_DISTINCT_CONCURRENT_SAMPLES', 12_800)");
    expect(performanceGate).toContain("readPositiveInteger('ROUTE_PERF_DISTINCT_CONCURRENT_WIDTH', 2_048)");
    expect(throughputBenchmark).toContain("readPositiveInteger('ROUTE_THROUGHPUT_GROUPS', 100_000)");
    expect(throughputBenchmark).toContain("readPositiveInteger('ROUTE_THROUGHPUT_MODEL_CARDINALITY', 100_000)");
    expect(throughputBenchmark).toContain("readPositiveInteger('ROUTE_THROUGHPUT_MAX_CONCURRENCY', 10_000)");
    expect(httpBenchmark).toContain("readPositiveInteger('ROUTE_HTTP_RPS_GROUPS', 10_000)");
    expect(httpBenchmark).toContain("readPositiveInteger('ROUTE_HTTP_RPS_MODEL_CARDINALITY', 10_000)");
    expect(httpBenchmark).toContain("readPositiveInteger('ROUTE_HTTP_RPS_MAX_CONNECTIONS', 1_024)");
    expect(httpBenchmark).toContain("autocannon.js");

    expect(testingFrameworkDoc).toContain('## Unit');
    expect(testingFrameworkDoc).toContain('## Integration');
    expect(testingFrameworkDoc).toContain('## E2E');
    expect(testingFrameworkDoc).toContain('## Architecture');
    expect(testingFrameworkDoc).toContain('## Performance');
    expect(testingFrameworkDoc).toContain('## Mock Strategy');
    expect(testingFrameworkDoc).toContain('createTestApp()');
    expect(testingFrameworkDoc).toContain('createUpstreamMock()');
    expect(testingFrameworkDoc).toContain('createRouteGraphBuilder()');
    expect(testingFrameworkDoc).toContain('src/testing/fixtures/');
    expect(testingFrameworkDoc).toContain('npm run test:architecture');
    expect(testingFrameworkDoc).toContain('npm run test:performance');
    expect(testingFrameworkDoc).toContain('scripts/dev/route-runtime-performance-gate.ts');
    expect(testingFrameworkDoc).toContain('npm run bench:performance:throughput');
    expect(testingFrameworkDoc).toContain('npm run bench:performance:http');
    expect(testingFrameworkDoc).toContain('npm run bench:performance:matrix');
    expect(testingFrameworkDoc).toContain('auto-concurrency route QPS sweeps');
    expect(testingFrameworkDoc).toContain('95% of peak median elapsed QPS');
    expect(testingFrameworkDoc).toContain('autocannon-based HTTP RPS sweeps');
    expect(testingFrameworkDoc).toContain('server-process CPU RPS');
    expect(testingFrameworkDoc).toContain('route-runtime-performance-matrix-report.md');
    expect(testingFrameworkDoc).toContain('test-results/performance/route-runtime-performance-report.md');
    expect(testingFrameworkDoc).toContain('test-results/performance/route-runtime-performance-report.json');
    expect(testingFrameworkDoc).toContain('CPU QPS');
    expect(testingFrameworkDoc).toContain('src/testing/e2eHarness.ts');
    expect(testingFrameworkDoc).toContain('src/testing/e2e/adminPages.ts');
    expect(testingFrameworkDoc).toContain('src/testing/e2ePageMatchers.ts');
    expect(testingFrameworkDoc).toContain('do not use the raw Playwright `page` fixture');
    expect(testingFrameworkDoc).toContain('do not use the raw Playwright `request` fixture');
    expect(testingFrameworkDoc).toContain('checkedPage');
    expect(testingFrameworkDoc).toContain('adminPage');
    expect(testingFrameworkDoc).toContain('adminApi');
    expect(testingFrameworkDoc).toContain('adminApi.getJson()');
    expect(testingFrameworkDoc).toContain('src/testing/e2eApiHeaders.ts');
    expect(testingFrameworkDoc).toContain('scripts/dev/e2ePreflight.ts');
    expect(testingFrameworkDoc).toContain('scripts/dev/e2eRunnerConfig.ts');
    expect(testingFrameworkDoc).toContain('External targets must serve the built app static assets');
    expect(testingFrameworkDoc).toContain('/api/settings/auth/info');
    expect(testingFrameworkDoc).toContain('preflight');
    expect(testingFrameworkDoc).toContain('console.error');
    expect(testingFrameworkDoc).toContain('auto-cleaned temporary `E2E_DATA_DIR`');
    expect(testingFrameworkDoc).toContain('failure screenshots');
    expect(testingFrameworkDoc).toContain('failure videos');
    expect(testingFrameworkDoc).toContain('first-retry traces');
    expect(testingFrameworkDoc).toContain('on spawn error');
    expect(e2eRunner).toContain('shouldCleanDataDir');
    expect(e2eRunner).toContain('cleanupDataDir');
    expect(e2eRunner).toContain('E2E_DATA_DIR');
    expect(e2eRunner).toContain('findFreePort(0, host)');
    expect(e2eRunner).toContain('buildE2ERunnerConfig');
    expect(e2eRunnerConfig).toContain('shouldAllocateE2EPort');
    expect(e2eRunnerConfig).toContain('shouldCleanE2EDataDir');
    expect(e2eRunner).toContain('preflightExternalBaseUrl');
    expect(e2ePreflight).toContain('preflightExternalBaseUrl');
    expect(e2ePreflight).toContain('/logo.png');
    expect(e2ePreflight).toContain('/api/settings/auth/info');
    expect(e2ePreflight).toContain('E2E_BASE_URL preflight failed for');
    expect(e2ePreflight).toContain('E2E_BASE_URL does not look like a built Metapi app');
    expect(e2eRunner).toContain('recursive: true');
    expect(e2eRunner).toContain("child.once('error'");
    expect(e2eRunner).toContain('if (signal) process.exit(1)');
  });

  it('keeps shared test harness modules and fixture roots available', () => {
    const requiredPaths = [
      'src/testing/appHarness.ts',
      'src/testing/dbHarness.ts',
      'src/testing/e2eHarness.ts',
      'src/testing/e2e/adminPages.ts',
      'src/testing/e2ePageMatchers.ts',
      'src/testing/e2ePageMatchers.test.ts',
      'src/testing/e2eApiHeaders.ts',
      'src/testing/e2eApiHeaders.test.ts',
      'scripts/dev/run-e2e.ts',
      'scripts/dev/e2ePreflight.ts',
      'scripts/dev/e2ePreflight.test.ts',
      'scripts/dev/e2eRunnerConfig.ts',
      'scripts/dev/e2eRunnerConfig.test.ts',
      'src/testing/fixtures.ts',
      'src/testing/httpMock.ts',
      'src/testing/routeGraphHarness.ts',
      'src/testing/upstreamMock.ts',
      'src/testing/webHarness.ts',
      'src/testing/fixtures/protocol/openai/.gitkeep',
      'src/testing/fixtures/protocol/claude/.gitkeep',
      'src/testing/fixtures/protocol/gemini/.gitkeep',
      'src/testing/fixtures/route-graph/.gitkeep',
      'src/testing/fixtures/macro/.gitkeep',
    ];

    for (const path of requiredPaths) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
    }
  });

  it('keeps e2e specs on the project Playwright fixture', () => {
    const e2eRoot = resolve(process.cwd(), 'src/testing/e2e');
    const harness = readFileSync(resolve(process.cwd(), 'src/testing/e2eHarness.ts'), 'utf8');
    const specFiles = collectFiles(e2eRoot, (path) => path.endsWith('.spec.ts'));
    const directPlaywrightImports = specFiles
      .filter((path) => readFileSync(path, 'utf8').includes("from '@playwright/test'"))
      .map((path) => relative(process.cwd(), path));

    expect(harness).toContain('adminPage');
    expect(harness).toContain('checkedPage');
    expect(harness).toContain('adminApi');
    expect(harness).toContain('withAdminAuthorization');
    expect(harness).toContain('getJson');
    expect(harness).toContain('expectOkJson');
    expect(harness).toContain('E2E admin API did not respond from the configured base URL');
    expect(harness).toContain('installRuntimeIssueCollector');
    const rawPageFixtures = specFiles
      .filter((path) => /\(\s*async\s*\(\s*\{\s*page(?:\s*[,}])/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(process.cwd(), path));
    const rawRequestFixtures = specFiles
      .filter((path) => /\(\s*async\s*\(\s*\{[^}]*\brequest\b/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(process.cwd(), path));
    expect(specFiles.length).toBeGreaterThan(0);
    expect(directPlaywrightImports).toEqual([]);
    expect(rawPageFixtures).toEqual([]);
    expect(rawRequestFixtures).toEqual([]);
  });

  it('keeps the tracked test coverage workflow publishable in docs and ci', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const ciWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const testingFrameworkDoc = readFileSync(resolve(process.cwd(), 'docs/engineering/testing-framework.md'), 'utf8');
    const gitignore = readFileSync(resolve(process.cwd(), '.gitignore'), 'utf8');

    expect(gitignore).toContain('docs/plans/');
    expect(testingFrameworkDoc).toContain('## Coverage Flow');
    expect(testingFrameworkDoc).toContain('Add or update a unit test for pure logic.');
    expect(testingFrameworkDoc).toContain('Add an integration test when the behavior crosses module seams.');
    expect(testingFrameworkDoc).toContain('Add an architecture test if the seam matters for future maintenance.');
    expect(testingFrameworkDoc).toContain('Add an E2E smoke when the user-visible flow changes.');
    expect(testingFrameworkDoc).toContain('## Adding A Test');
    expect(testingFrameworkDoc).toContain('Decide the shallowest layer that can observe the behavior.');
    expect(testingFrameworkDoc).toContain('Use the nearest harness instead of hand-rolling globals.');

    const requiredScripts = ['test:unit', 'test:integration', 'test:architecture', 'test:performance', 'test:e2e', 'test:all'];
    for (const script of requiredScripts) {
      expect(packageJson.scripts?.[script], script).toBeTruthy();
      expect(testingFrameworkDoc).toContain(`npm run ${script}`);
    }

    expect(ciWorkflow).toContain('name: Test Core');
    expect(ciWorkflow).toContain('name: Test Integration');
    expect(ciWorkflow).toContain('name: Test Architecture');
    expect(ciWorkflow).toContain('name: Test Performance');
    expect(ciWorkflow).toContain('name: Test E2E');
    expect(ciWorkflow).toContain('npm run test:unit');
    expect(ciWorkflow).toContain('npm run test:integration');
    expect(ciWorkflow).toContain('npm run test:architecture');
    expect(ciWorkflow).toContain('npm run test:performance');
    expect(ciWorkflow).toContain('GITHUB_STEP_SUMMARY');
    expect(ciWorkflow).toContain('actions/upload-artifact@v6');
    expect(ciWorkflow).toContain('route-runtime-performance-report');
    expect(ciWorkflow).toContain('npm run test:e2e');
  });
});
