import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  configureRouteRuntimeDataDir,
  cpuUsageMs,
  createRouteRuntimeDataDir,
  gc,
  heapLimitMiB,
  memory,
  memoryDelta,
  readPositiveInteger,
  readPositiveNumber,
  resolveReportDir,
  round,
  seedRouteRuntimeFixture,
  type DbModule,
  type MemorySnapshot,
} from './routeRuntimePerformanceFixture.js';

type TokenRouterModule = typeof import('../../src/server/services/tokenRouter.js');

type RuntimeCounterSnapshot = {
  routeCacheLoadCount: number;
  routeMatchLoadCount: number;
  routeMatchBatchLoadCount: number;
  routeModelCandidateLoadCount: number;
  routeModelCandidateBatchLoadCount: number;
};

type RuntimeCounterDelta = RuntimeCounterSnapshot & {
  label: string;
};

type Measurement = {
  label: string;
  operations: number;
  elapsedMs: number;
  cpuMs: number;
  elapsedQps: number;
  cpuQps: number;
  avgElapsedMs: number;
  avgCpuMs: number;
  before: MemorySnapshot;
  after: MemorySnapshot;
  delta: MemorySnapshot;
};

type Budget = {
  label: string;
  metric: string;
  actual: number;
  limit: number;
  comparison: 'lte' | 'gte';
};

type BudgetResult = Budget & {
  passed: boolean;
};

type PerformanceReport = {
  generatedAt: string;
  status: 'passed' | 'failed';
  config: {
    groupCount: number;
    concurrency: number;
    hotIterations: number;
    distinctSequentialSamples: number;
    distinctConcurrentSamples: number;
    distinctConcurrentWidth: number;
    insertChunkSize: number;
    dataDir: string;
    node: string;
    platform: NodeJS.Platform;
    arch: string;
    heapLimitMiB: number | null;
    reportDir: string;
  };
  budgets: typeof budgets;
  measurements: Measurement[];
  budgetResults: BudgetResult[];
  memory: {
    setupStart: MemorySnapshot;
    routingStart: MemorySnapshot;
    routingEnd: MemorySnapshot;
    final: MemorySnapshot;
    routingDelta: MemorySnapshot;
    totalDelta: MemorySnapshot;
  };
  cacheStats: ReturnType<TokenRouterModule['__tokenRouterTestUtils']['getRouteCacheStats']>;
  runtimeCounterDeltas: RuntimeCounterDelta[];
};

const concurrency = readPositiveInteger('ROUTE_PERF_CONCURRENCY', 128);
const hotIterations = readPositiveInteger('ROUTE_PERF_HOT_ITERATIONS', 1_000);
const distinctSequentialSamples = readPositiveInteger('ROUTE_PERF_DISTINCT_SAMPLES', 1_000);
const distinctConcurrentSamples = readPositiveInteger('ROUTE_PERF_DISTINCT_CONCURRENT_SAMPLES', 12_800);
const distinctConcurrentWidth = readPositiveInteger('ROUTE_PERF_DISTINCT_CONCURRENT_WIDTH', 2_048);
const groupCount = Math.max(
  readPositiveInteger('ROUTE_PERF_GROUPS', 10_000),
  distinctConcurrentSamples,
);
const insertChunkSize = readPositiveInteger('ROUTE_PERF_INSERT_CHUNK_SIZE', 250);
const reportDir = resolveReportDir(process.env.ROUTE_PERF_REPORT_DIR || 'test-results/performance');
const dataDir = createRouteRuntimeDataDir();
const distinctConcurrentAvgCpuMs = readPositiveNumber('ROUTE_PERF_DISTINCT_CONCURRENT_AVG_CPU_MS', 2);
const distinctConcurrentCpuQps = readPositiveNumber('ROUTE_PERF_DISTINCT_CONCURRENT_CPU_QPS', 1_500);
const distinctBarrierDir = (process.env.ROUTE_PERF_DISTINCT_BARRIER_DIR || '').trim();
const distinctBarrierId = (process.env.ROUTE_PERF_DISTINCT_BARRIER_ID || `${process.pid}`).trim();
const distinctBarrierTimeoutMs = readPositiveInteger('ROUTE_PERF_DISTINCT_BARRIER_TIMEOUT_MS', 120_000);

configureRouteRuntimeDataDir(dataDir);

const budgets = {
  singleColdCpuMs: readPositiveNumber('ROUTE_PERF_SINGLE_COLD_CPU_MS', 50),
  singleColdElapsedMs: readPositiveNumber('ROUTE_PERF_SINGLE_COLD_ELAPSED_MS', 100),
  sameModelConcurrentCpuMs: readPositiveNumber('ROUTE_PERF_SAME_MODEL_CONCURRENT_CPU_MS', 75),
  sameModelConcurrentCpuQps: readPositiveNumber('ROUTE_PERF_SAME_MODEL_CONCURRENT_CPU_QPS', 1_500),
  distinctConcurrentAvgCpuMs,
  distinctConcurrentCpuMs: readPositiveNumber(
    'ROUTE_PERF_DISTINCT_CONCURRENT_CPU_MS',
    distinctConcurrentSamples * (1_000 / distinctConcurrentCpuQps),
  ),
  distinctConcurrentCpuQps,
  hotAverageCpuMs: readPositiveNumber('ROUTE_PERF_HOT_AVG_CPU_MS', 1),
  hotCpuQps: readPositiveNumber('ROUTE_PERF_HOT_CPU_QPS', 1_000),
  distinctSequentialAvgCpuMs: readPositiveNumber('ROUTE_PERF_DISTINCT_SEQUENTIAL_AVG_CPU_MS', 2),
  routingHeapDeltaMiB: readPositiveNumber('ROUTE_PERF_ROUTING_HEAP_DELTA_MIB', 64),
  routingRssDeltaMiB: readPositiveNumber('ROUTE_PERF_ROUTING_RSS_DELTA_MIB', 128),
  finalRssMiB: readPositiveNumber('ROUTE_PERF_FINAL_RSS_MIB', 650),
  finalHeapUsedMiB: readPositiveNumber('ROUTE_PERF_FINAL_HEAP_USED_MIB', 256),
  cacheEntryLimit: readPositiveInteger('ROUTE_PERF_CACHE_ENTRY_LIMIT', 4096),
};

function readRuntimeCounters(routerModule: TokenRouterModule): RuntimeCounterSnapshot {
  const utils = routerModule.__tokenRouterTestUtils;
  return {
    routeCacheLoadCount: utils.getRouteCacheLoadCount(),
    routeMatchLoadCount: utils.getRouteMatchLoadCount(),
    routeMatchBatchLoadCount: utils.getRouteMatchBatchLoadCount(),
    routeModelCandidateLoadCount: utils.getRouteModelCandidateLoadCount(),
    routeModelCandidateBatchLoadCount: utils.getRouteModelCandidateBatchLoadCount(),
  };
}

function runtimeCounterDelta(
  label: string,
  after: RuntimeCounterSnapshot,
  before: RuntimeCounterSnapshot,
): RuntimeCounterDelta {
  return {
    label,
    routeCacheLoadCount: after.routeCacheLoadCount - before.routeCacheLoadCount,
    routeMatchLoadCount: after.routeMatchLoadCount - before.routeMatchLoadCount,
    routeMatchBatchLoadCount: after.routeMatchBatchLoadCount - before.routeMatchBatchLoadCount,
    routeModelCandidateLoadCount: after.routeModelCandidateLoadCount - before.routeModelCandidateLoadCount,
    routeModelCandidateBatchLoadCount: after.routeModelCandidateBatchLoadCount - before.routeModelCandidateBatchLoadCount,
  };
}

function assertCounterEquals(label: string, actual: number, expected: number): void {
  if (actual === expected) return;
  throw new Error(`route runtime performance gate integrity failed: ${label} expected ${expected}, got ${actual}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

async function waitForDistinctBarrier(): Promise<void> {
  if (!distinctBarrierDir) return;
  mkdirSync(distinctBarrierDir, { recursive: true });
  writeFileSync(join(distinctBarrierDir, `ready-${distinctBarrierId}`), `${process.pid}\n`, 'utf8');
  const startFile = join(distinctBarrierDir, 'start');
  const deadline = Date.now() + distinctBarrierTimeoutMs;
  while (!existsSync(startFile)) {
    if (Date.now() > deadline) {
      throw new Error(`route runtime performance distinct barrier timed out: ${distinctBarrierDir}`);
    }
    await sleep(25);
  }
}

async function measure<T>(
  label: string,
  operations: number,
  run: () => Promise<T> | T,
): Promise<{ result: T; measurement: Measurement }> {
  gc();
  const before = memory();
  const cpuBefore = process.cpuUsage();
  const started = performance.now();
  const result = await run();
  const elapsedMs = performance.now() - started;
  const cpuMs = cpuUsageMs(process.cpuUsage(cpuBefore));
  const after = memory();
  const normalizedOperations = Math.max(1, operations);
  const measurement: Measurement = {
    label,
    operations: normalizedOperations,
    elapsedMs: round(elapsedMs),
    cpuMs: round(cpuMs),
    elapsedQps: round(normalizedOperations / Math.max(elapsedMs / 1000, 0.001)),
    cpuQps: round(normalizedOperations / Math.max(cpuMs / 1000, 0.001)),
    avgElapsedMs: round(elapsedMs / normalizedOperations, 4),
    avgCpuMs: round(cpuMs / normalizedOperations, 4),
    before,
    after,
    delta: memoryDelta(after, before),
  };
  console.log(JSON.stringify({ type: 'measurement', ...measurement }));
  return { result, measurement };
}

function failIfNull<T>(label: string, value: T | null | undefined): T {
  if (!value) throw new Error(`${label} returned null`);
  return value;
}

function addLte(checks: Budget[], label: string, metric: string, actual: number, limit: number): void {
  checks.push({ label, metric, actual: round(actual, 4), limit, comparison: 'lte' });
}

function addGte(checks: Budget[], label: string, metric: string, actual: number, limit: number): void {
  checks.push({ label, metric, actual: round(actual, 4), limit, comparison: 'gte' });
}

function evaluateBudgets(checks: Budget[]): BudgetResult[] {
  return checks.map((check) => {
    const passed = check.comparison === 'lte'
      ? check.actual <= check.limit
      : check.actual >= check.limit;
    return { ...check, passed };
  });
}

function logBudgetResults(results: BudgetResult[]): void {
  for (const check of results) {
    console.log(JSON.stringify({
      type: 'budget',
      passed: check.passed,
      label: check.label,
      metric: check.metric,
      actual: check.actual,
      comparison: check.comparison,
      limit: check.limit,
    }));
  }
}

function assertBudgets(results: BudgetResult[]): void {
  const failures = results.filter((check) => !check.passed);
  if (failures.length === 0) return;
  const details = failures
    .map((failure) => `${failure.label}.${failure.metric} ${failure.actual} ${failure.comparison} ${failure.limit}`)
    .join('; ');
  throw new Error(`route runtime performance gate failed: ${details}`);
}

function addMeasurementBudgets(checks: Budget[], measurement: Measurement): void {
  if (measurement.label.includes('after cache invalidation')) {
    addLte(checks, measurement.label, 'cpuMs', measurement.cpuMs, budgets.singleColdCpuMs);
    addLte(checks, measurement.label, 'elapsedMs', measurement.elapsedMs, budgets.singleColdElapsedMs);
    return;
  }
  if (measurement.label.includes('single cold')) {
    addLte(checks, measurement.label, 'cpuMs', measurement.cpuMs, budgets.singleColdCpuMs);
    addLte(checks, measurement.label, 'elapsedMs', measurement.elapsedMs, budgets.singleColdElapsedMs);
  }
  if (measurement.label.includes('same cold model')) {
    addLte(checks, measurement.label, 'cpuMs', measurement.cpuMs, budgets.sameModelConcurrentCpuMs);
    addGte(checks, measurement.label, 'cpuQps', measurement.cpuQps, budgets.sameModelConcurrentCpuQps);
  }
  if (measurement.label.includes('distinct cold models')) {
    addLte(checks, measurement.label, 'cpuMs', measurement.cpuMs, budgets.distinctConcurrentCpuMs);
    addLte(checks, measurement.label, 'avgCpuMs', measurement.avgCpuMs, budgets.distinctConcurrentAvgCpuMs);
    addGte(checks, measurement.label, 'cpuQps', measurement.cpuQps, budgets.distinctConcurrentCpuQps);
  }
  if (measurement.label.includes('hot same model')) {
    addLte(checks, measurement.label, 'avgCpuMs', measurement.avgCpuMs, budgets.hotAverageCpuMs);
    addGte(checks, measurement.label, 'cpuQps', measurement.cpuQps, budgets.hotCpuQps);
  }
  if (measurement.label.includes('distinct models sequential')) {
    addLte(checks, measurement.label, 'avgCpuMs', measurement.avgCpuMs, budgets.distinctSequentialAvgCpuMs);
  }
}

function formatNumber(value: number, fractionDigits = 2): string {
  return Number.isFinite(value) ? value.toFixed(fractionDigits) : String(value);
}

function statusIcon(passed: boolean): string {
  return passed ? 'PASS' : 'FAIL';
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function buildMarkdownReport(report: PerformanceReport): string {
  const failedBudgets = report.budgetResults.filter((result) => !result.passed);
  const measurementRows = report.measurements.map((measurement) => [
    measurement.label,
    String(measurement.operations),
    formatNumber(measurement.elapsedMs),
    formatNumber(measurement.cpuMs),
    formatNumber(measurement.elapsedQps),
    formatNumber(measurement.cpuQps),
    formatNumber(measurement.avgElapsedMs, 4),
    formatNumber(measurement.avgCpuMs, 4),
    formatNumber(measurement.delta.rssMiB, 1),
    formatNumber(measurement.delta.heapUsedMiB, 1),
  ]);
  const budgetRows = report.budgetResults.map((result) => [
    statusIcon(result.passed),
    result.label,
    result.metric,
    formatNumber(result.actual, 4),
    result.comparison,
    formatNumber(result.limit, 4),
  ]);
  const runtimeCounterRows = report.runtimeCounterDeltas.map((delta) => [
    delta.label,
    String(delta.routeCacheLoadCount),
    String(delta.routeModelCandidateLoadCount),
    String(delta.routeModelCandidateBatchLoadCount),
    String(delta.routeMatchLoadCount),
    String(delta.routeMatchBatchLoadCount),
  ]);

  return [
    '# Route Runtime Performance Report',
    '',
    `Status: ${report.status === 'passed' ? 'PASS' : 'FAIL'}`,
    `Generated: ${report.generatedAt}`,
    '',
    '## Scenario',
    '',
    markdownTable(
      ['Setting', 'Value'],
      [
        ['Route groups', String(report.config.groupCount)],
        ['Concurrency', String(report.config.concurrency)],
        ['Hot iterations', String(report.config.hotIterations)],
        ['Distinct sequential samples', String(report.config.distinctSequentialSamples)],
        ['Distinct concurrent samples', String(report.config.distinctConcurrentSamples)],
        ['Distinct concurrent width', String(report.config.distinctConcurrentWidth)],
        ['Insert chunk size', String(report.config.insertChunkSize)],
        ['Node', report.config.node],
        ['Platform', `${report.config.platform}/${report.config.arch}`],
        ['Heap cap MiB', report.config.heapLimitMiB == null ? 'unbounded' : String(report.config.heapLimitMiB)],
      ],
    ),
    '',
    '## Measurements',
    '',
    markdownTable(
      ['Label', 'Ops', 'Elapsed ms', 'CPU ms', 'Elapsed QPS', 'CPU QPS', 'Avg elapsed ms', 'Avg CPU ms', 'RSS delta MiB', 'Heap delta MiB'],
      measurementRows,
    ),
    '',
    '## Budgets',
    '',
    markdownTable(
      ['Result', 'Label', 'Metric', 'Actual', 'Cmp', 'Limit'],
      budgetRows,
    ),
    '',
    '## Runtime Counter Deltas',
    '',
    runtimeCounterRows.length > 0
      ? markdownTable(
        ['Label', 'Route cache loads', 'Candidate logical loads', 'Candidate batch loads', 'Match logical loads', 'Match batch loads'],
        runtimeCounterRows,
      )
      : 'No runtime counter deltas recorded.',
    '',
    '## Memory',
    '',
    markdownTable(
      ['Snapshot', 'RSS MiB', 'Heap used MiB', 'Heap total MiB', 'External MiB'],
      [
        ['Setup start', formatNumber(report.memory.setupStart.rssMiB), formatNumber(report.memory.setupStart.heapUsedMiB), formatNumber(report.memory.setupStart.heapTotalMiB), formatNumber(report.memory.setupStart.externalMiB)],
        ['Routing start', formatNumber(report.memory.routingStart.rssMiB), formatNumber(report.memory.routingStart.heapUsedMiB), formatNumber(report.memory.routingStart.heapTotalMiB), formatNumber(report.memory.routingStart.externalMiB)],
        ['Routing end', formatNumber(report.memory.routingEnd.rssMiB), formatNumber(report.memory.routingEnd.heapUsedMiB), formatNumber(report.memory.routingEnd.heapTotalMiB), formatNumber(report.memory.routingEnd.externalMiB)],
        ['Final', formatNumber(report.memory.final.rssMiB), formatNumber(report.memory.final.heapUsedMiB), formatNumber(report.memory.final.heapTotalMiB), formatNumber(report.memory.final.externalMiB)],
        ['Routing delta', formatNumber(report.memory.routingDelta.rssMiB), formatNumber(report.memory.routingDelta.heapUsedMiB), formatNumber(report.memory.routingDelta.heapTotalMiB), formatNumber(report.memory.routingDelta.externalMiB)],
        ['Total delta', formatNumber(report.memory.totalDelta.rssMiB), formatNumber(report.memory.totalDelta.heapUsedMiB), formatNumber(report.memory.totalDelta.heapTotalMiB), formatNumber(report.memory.totalDelta.externalMiB)],
      ],
    ),
    '',
    '## Runtime Caches',
    '',
    markdownTable(
      ['Cache', 'Value'],
      [
        ['routeCount', String(report.cacheStats.routeCount)],
        ['modelCandidateCacheSize', String(report.cacheStats.modelCandidateCacheSize)],
        ['matchCacheSize', String(report.cacheStats.matchCacheSize)],
        ['routeCacheLoadInFlight', String(report.cacheStats.routeCacheLoadInFlight)],
        ['routeModelCandidateBatchInFlight', String(report.cacheStats.routeModelCandidateBatchInFlight)],
        ['routeMatchBatchInFlight', String(report.cacheStats.routeMatchBatchInFlight)],
        ['routeModelCandidateLoadsInFlight', String(report.cacheStats.routeModelCandidateLoadsInFlight)],
        ['routeMatchLoadsInFlight', String(report.cacheStats.routeMatchLoadsInFlight)],
      ],
    ),
    '',
    failedBudgets.length > 0
      ? `Failed budgets: ${failedBudgets.map((budget) => `${budget.label}.${budget.metric}`).join(', ')}`
      : 'Failed budgets: none',
    '',
  ].join('\n');
}

function writePerformanceReport(report: PerformanceReport): { jsonPath: string; markdownPath: string } {
  mkdirSync(reportDir, { recursive: true });
  const jsonPath = join(reportDir, 'route-runtime-performance-report.json');
  const markdownPath = join(reportDir, 'route-runtime-performance-report.md');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, buildMarkdownReport(report), 'utf8');
  console.log(JSON.stringify({ type: 'report', format: 'json', path: jsonPath }));
  console.log(JSON.stringify({ type: 'report', format: 'markdown', path: markdownPath }));
  return { jsonPath, markdownPath };
}

async function main(): Promise<void> {
  console.log(JSON.stringify({
    type: 'config',
    groupCount,
    concurrency,
    hotIterations,
    distinctSequentialSamples,
    distinctConcurrentSamples,
    distinctConcurrentWidth,
    dataDir,
    reportDir,
    budgets,
  }));

  const setupStartMemory = memory();
  const measurements: Measurement[] = [];
  const checks: Budget[] = [];
  const runtimeCounterDeltas: RuntimeCounterDelta[] = [];
  let dbModule: DbModule | null = null;

  try {
    await measure('import database runtime', 1, async () => {
      await import('../../src/server/db/migrate.js');
      dbModule = await import('../../src/server/db/index.js');
    });
    if (!dbModule) throw new Error('database module did not load');

    await measure(`seed ${groupCount} route groups`, groupCount, () => seedRouteRuntimeFixture({
      dbModule: dbModule!,
      groupCount,
      insertChunkSize,
    }));
    const projection = await import('../../src/server/services/routeTableProjectionService.js');
    await measure('sync route binding projections', groupCount, () => projection.syncRouteBindingProjectionsFromRouteTable());

    const routerModule: TokenRouterModule = await import('../../src/server/services/tokenRouter.js');
    const router = routerModule.tokenRouter;
    const firstModel = 'perf-group-0';
    const lastModel = `perf-group-${groupCount - 1}`;

    routerModule.invalidateTokenRouterCache();
    const routingStartMemory = memory();

    measurements.push((await measure('single cold exact/group route decision first model', 1, async () => {
      failIfNull('single cold first model', await router.selectTarget(firstModel));
    })).measurement);

    measurements.push((await measure('single cold exact/group route decision last model', 1, async () => {
      failIfNull('single cold last model', await router.selectTarget(lastModel));
    })).measurement);

    routerModule.invalidateTokenRouterCache();
    measurements.push((await measure(`concurrent same cold model x${concurrency}`, concurrency, async () => {
      const results = await Promise.all(Array.from({ length: concurrency }, () => router.selectTarget(lastModel)));
      if (results.some((result) => !result)) throw new Error('concurrent same cold model returned null');
    })).measurement);

    measurements.push((await measure(`hot same model x${hotIterations}`, hotIterations, async () => {
      for (let index = 0; index < hotIterations; index += 1) {
        failIfNull(`hot same model ${index}`, await router.selectTarget(lastModel));
      }
    })).measurement);

    const sequentialSamples = Math.min(distinctSequentialSamples, groupCount);
    routerModule.invalidateTokenRouterCache();
    measurements.push((await measure(`distinct models sequential x${sequentialSamples}`, sequentialSamples, async () => {
      for (let index = 0; index < sequentialSamples; index += 1) {
        const model = `perf-group-${Math.floor((index * groupCount) / sequentialSamples)}`;
        failIfNull(`distinct sequential ${model}`, await router.selectTarget(model));
      }
    })).measurement);

    const distinctConcurrentTotal = Math.min(distinctConcurrentSamples, groupCount);
    const distinctConcurrency = Math.min(distinctConcurrentWidth, distinctConcurrentTotal);
    const distinctCounterLabel = `concurrent distinct cold models x${distinctConcurrentTotal} (${distinctConcurrency}-wide)`;
    routerModule.invalidateTokenRouterCache();
    const distinctCountersBefore = readRuntimeCounters(routerModule);
    await waitForDistinctBarrier();
    const distinctConcurrentMeasurement = await measure(
      distinctCounterLabel,
      distinctConcurrentTotal,
      async () => {
        for (let offset = 0; offset < distinctConcurrentTotal; offset += distinctConcurrency) {
          const batchSize = Math.min(distinctConcurrency, distinctConcurrentTotal - offset);
          const results = await Promise.all(Array.from({ length: batchSize }, (_, index) => {
            const modelIndex = offset + index;
            const model = `perf-group-${Math.floor((modelIndex * groupCount) / distinctConcurrentTotal)}`;
            return router.selectTarget(model);
          }));
          if (results.some((result) => !result)) throw new Error('concurrent distinct cold models returned null');
        }
      },
    );
    const distinctCountersAfter = readRuntimeCounters(routerModule);
    const distinctCounterDelta = runtimeCounterDelta(
      distinctCounterLabel,
      distinctCountersAfter,
      distinctCountersBefore,
    );
    const expectedDistinctBatchLoads = Math.ceil(distinctConcurrentTotal / distinctConcurrency);
    assertCounterEquals(
      `${distinctCounterLabel}.routeModelCandidateLoadCount`,
      distinctCounterDelta.routeModelCandidateLoadCount,
      distinctConcurrentTotal,
    );
    assertCounterEquals(
      `${distinctCounterLabel}.routeMatchLoadCount`,
      distinctCounterDelta.routeMatchLoadCount,
      distinctConcurrentTotal,
    );
    assertCounterEquals(
      `${distinctCounterLabel}.routeModelCandidateBatchLoadCount`,
      distinctCounterDelta.routeModelCandidateBatchLoadCount,
      expectedDistinctBatchLoads,
    );
    assertCounterEquals(
      `${distinctCounterLabel}.routeMatchBatchLoadCount`,
      distinctCounterDelta.routeMatchBatchLoadCount,
      expectedDistinctBatchLoads,
    );
    runtimeCounterDeltas.push(distinctCounterDelta);
    measurements.push(distinctConcurrentMeasurement.measurement);

    routerModule.invalidateTokenRouterCache();
    measurements.push((await measure('single cold route decision after cache invalidation', 1, async () => {
      failIfNull('cache invalidated last model', await router.selectTarget(lastModel));
    })).measurement);

    for (const measurement of measurements) {
      addMeasurementBudgets(checks, measurement);
    }

    const routingEndMemory = memory();
    const finalMemory = memory();
    const routingMemoryDelta = memoryDelta(routingEndMemory, routingStartMemory);
    const totalMemoryDelta = memoryDelta(finalMemory, setupStartMemory);
    const cacheStats = routerModule.__tokenRouterTestUtils.getRouteCacheStats();
    addLte(checks, 'routing retained memory', 'heapUsedDeltaMiB', routingMemoryDelta.heapUsedMiB, budgets.routingHeapDeltaMiB);
    addLte(checks, 'routing retained memory', 'rssDeltaMiB', routingMemoryDelta.rssMiB, budgets.routingRssDeltaMiB);
    addLte(checks, 'final memory', 'rssMiB', finalMemory.rssMiB, budgets.finalRssMiB);
    addLte(checks, 'final memory', 'heapUsedMiB', finalMemory.heapUsedMiB, budgets.finalHeapUsedMiB);
    addLte(checks, 'runtime caches', 'modelCandidateCacheSize', cacheStats.modelCandidateCacheSize, budgets.cacheEntryLimit);
    addLte(checks, 'runtime caches', 'matchCacheSize', cacheStats.matchCacheSize, budgets.cacheEntryLimit);

    const budgetResults = evaluateBudgets(checks);
    const report: PerformanceReport = {
      generatedAt: new Date().toISOString(),
      status: budgetResults.every((check) => check.passed) ? 'passed' : 'failed',
      config: {
        groupCount,
        concurrency,
        hotIterations,
        distinctSequentialSamples,
        distinctConcurrentSamples,
        distinctConcurrentWidth,
        insertChunkSize,
        dataDir,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        heapLimitMiB: heapLimitMiB(),
        reportDir,
      },
      budgets,
      measurements,
      budgetResults,
      memory: {
        setupStart: setupStartMemory,
        routingStart: routingStartMemory,
        routingEnd: routingEndMemory,
        final: finalMemory,
        routingDelta: routingMemoryDelta,
        totalDelta: totalMemoryDelta,
      },
      cacheStats,
      runtimeCounterDeltas,
    };

    console.log(JSON.stringify({
      type: 'summary',
      routeGroups: groupCount,
      concurrency,
      distinctConcurrentSamples,
      distinctConcurrentWidth,
      measurements,
      memory: report.memory,
      cacheStats,
      runtimeCounterDeltas,
    }));

    logBudgetResults(budgetResults);
    writePerformanceReport(report);
    assertBudgets(budgetResults);
    await dbModule.closeDbConnections();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
