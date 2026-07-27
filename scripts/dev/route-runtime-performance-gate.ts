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
  migrateRouteRuntimeDatabase,
  publishComplexActiveRouteGraphFixture,
  publishSeededRouteRuntimeFixture,
  readPositiveInteger,
  readPositiveNumber,
  resolveReportDir,
  round,
  seedRouteRuntimeFixture,
  type ComplexActiveRouteGraphFixture,
  type DbModule,
  type MemorySnapshot,
  type SeededRouteRuntimeFixture,
} from './routeRuntimePerformanceFixture.js';

type RouteRuntimeExecutionModule = typeof import('../../src/server/services/routeRuntimeExecutionService.js');
type RouteRuntimeSelector = {
  selectExecutionAttempt(
    model: string,
    options?: {
      disabledExecutionTargetIds?: number[];
    },
  ): ReturnType<RouteRuntimeExecutionModule['selectRouteRuntimeExecutionAttempt']>;
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
    complexGraphGroupCount: number;
    complexGraphFallbackStageCount: number;
    complexGraphEndpointsPerFallbackStage: number;
    complexGraphHotIterations: number;
    complexGraphDistinctSamples: number;
    complexGraphDistinctWidth: number;
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
  complexGraph: ComplexActiveRouteGraphFixture | null;
  cacheStats: {
    runtime: 'compiled-runtime';
  };
};

const concurrency = readPositiveInteger('ROUTE_PERF_CONCURRENCY', 128);
const hotIterations = readPositiveInteger('ROUTE_PERF_HOT_ITERATIONS', 1_000);
const distinctSequentialSamples = readPositiveInteger('ROUTE_PERF_DISTINCT_SAMPLES', 1_000);
const distinctConcurrentSamples = readPositiveInteger('ROUTE_PERF_DISTINCT_CONCURRENT_SAMPLES', 12_800);
const distinctConcurrentWidth = readPositiveInteger('ROUTE_PERF_DISTINCT_CONCURRENT_WIDTH', 2_048);
const requestedComplexGraphGroupCount = readPositiveInteger('ROUTE_PERF_COMPLEX_GRAPH_GROUPS', 1_024);
const complexGraphFallbackStageCount = readPositiveInteger('ROUTE_PERF_COMPLEX_GRAPH_FALLBACK_STAGES', 3);
const complexGraphEndpointsPerFallbackStage = readPositiveInteger('ROUTE_PERF_COMPLEX_GRAPH_ENDPOINTS_PER_STAGE', 2);
const complexGraphHotIterations = readPositiveInteger('ROUTE_PERF_COMPLEX_GRAPH_HOT_ITERATIONS', 1_000);
const complexGraphDistinctSamples = readPositiveInteger('ROUTE_PERF_COMPLEX_GRAPH_DISTINCT_SAMPLES', requestedComplexGraphGroupCount);
const complexGraphDistinctWidth = readPositiveInteger('ROUTE_PERF_COMPLEX_GRAPH_DISTINCT_WIDTH', 512);
const groupCount = Math.max(
  readPositiveInteger('ROUTE_PERF_GROUPS', 10_000),
  distinctConcurrentSamples,
  requestedComplexGraphGroupCount,
);
const complexGraphGroupCount = Math.min(requestedComplexGraphGroupCount, groupCount);
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
  hotAverageCpuMs: readPositiveNumber('ROUTE_PERF_HOT_AVG_CPU_MS', 1.5),
  hotCpuQps: readPositiveNumber('ROUTE_PERF_HOT_CPU_QPS', 667),
  distinctSequentialAvgCpuMs: readPositiveNumber('ROUTE_PERF_DISTINCT_SEQUENTIAL_AVG_CPU_MS', 2),
  complexGraphPublishHeapDeltaMiB: readPositiveNumber('ROUTE_PERF_COMPLEX_GRAPH_PUBLISH_HEAP_DELTA_MIB', 128),
  complexGraphPublishRssDeltaMiB: readPositiveNumber('ROUTE_PERF_COMPLEX_GRAPH_PUBLISH_RSS_DELTA_MIB', 320),
  complexGraphColdCpuMs: readPositiveNumber('ROUTE_PERF_COMPLEX_GRAPH_COLD_CPU_MS', 750),
  complexGraphColdElapsedMs: readPositiveNumber('ROUTE_PERF_COMPLEX_GRAPH_COLD_ELAPSED_MS', 1_500),
  complexGraphColdHeapDeltaMiB: readPositiveNumber('ROUTE_PERF_COMPLEX_GRAPH_COLD_HEAP_DELTA_MIB', 96),
  complexGraphColdRssDeltaMiB: readPositiveNumber('ROUTE_PERF_COMPLEX_GRAPH_COLD_RSS_DELTA_MIB', 192),
  complexGraphOverlayCpuMs: readPositiveNumber('ROUTE_PERF_COMPLEX_GRAPH_OVERLAY_CPU_MS', 50),
  complexGraphHotAverageCpuMs: readPositiveNumber('ROUTE_PERF_COMPLEX_GRAPH_HOT_AVG_CPU_MS', 2),
  complexGraphHotCpuQps: readPositiveNumber('ROUTE_PERF_COMPLEX_GRAPH_HOT_CPU_QPS', 500),
  complexGraphDistinctAvgCpuMs: readPositiveNumber('ROUTE_PERF_COMPLEX_GRAPH_DISTINCT_AVG_CPU_MS', 3),
  complexGraphDistinctCpuQps: readPositiveNumber('ROUTE_PERF_COMPLEX_GRAPH_DISTINCT_CPU_QPS', 500),
  complexGraphDistinctHeapDeltaMiB: readPositiveNumber('ROUTE_PERF_COMPLEX_GRAPH_DISTINCT_HEAP_DELTA_MIB', 96),
  complexGraphDistinctRssDeltaMiB: readPositiveNumber('ROUTE_PERF_COMPLEX_GRAPH_DISTINCT_RSS_DELTA_MIB', 192),
  routingHeapDeltaMiB: readPositiveNumber('ROUTE_PERF_ROUTING_HEAP_DELTA_MIB', 64),
  routingRssDeltaMiB: readPositiveNumber('ROUTE_PERF_ROUTING_RSS_DELTA_MIB', 240),
  finalRssMiB: readPositiveNumber('ROUTE_PERF_FINAL_RSS_MIB', 650),
  finalHeapUsedMiB: readPositiveNumber('ROUTE_PERF_FINAL_HEAP_USED_MIB', 256),
};

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
  if (measurement.label.startsWith('publish complex active route graph')) {
    addLte(checks, measurement.label, 'heapUsedDeltaMiB', measurement.delta.heapUsedMiB, budgets.complexGraphPublishHeapDeltaMiB);
    addLte(checks, measurement.label, 'rssDeltaMiB', measurement.delta.rssMiB, budgets.complexGraphPublishRssDeltaMiB);
    return;
  }
  if (measurement.label.startsWith('complex active graph cold-cache route decision')) {
    addLte(checks, measurement.label, 'cpuMs', measurement.cpuMs, budgets.complexGraphColdCpuMs);
    addLte(checks, measurement.label, 'elapsedMs', measurement.elapsedMs, budgets.complexGraphColdElapsedMs);
    addLte(checks, measurement.label, 'heapUsedDeltaMiB', measurement.delta.heapUsedMiB, budgets.complexGraphColdHeapDeltaMiB);
    addLte(checks, measurement.label, 'rssDeltaMiB', measurement.delta.rssMiB, budgets.complexGraphColdRssDeltaMiB);
    return;
  }
  if (measurement.label.startsWith('complex active graph failure-overlay decision')) {
    addLte(checks, measurement.label, 'cpuMs', measurement.cpuMs, budgets.complexGraphOverlayCpuMs);
    return;
  }
  if (measurement.label.startsWith('complex active graph hot same model')) {
    addLte(checks, measurement.label, 'avgCpuMs', measurement.avgCpuMs, budgets.complexGraphHotAverageCpuMs);
    addGte(checks, measurement.label, 'cpuQps', measurement.cpuQps, budgets.complexGraphHotCpuQps);
    return;
  }
  if (measurement.label.startsWith('complex active graph distinct models')) {
    addLte(checks, measurement.label, 'avgCpuMs', measurement.avgCpuMs, budgets.complexGraphDistinctAvgCpuMs);
    addGte(checks, measurement.label, 'cpuQps', measurement.cpuQps, budgets.complexGraphDistinctCpuQps);
    addLte(checks, measurement.label, 'heapUsedDeltaMiB', measurement.delta.heapUsedMiB, budgets.complexGraphDistinctHeapDeltaMiB);
    addLte(checks, measurement.label, 'rssDeltaMiB', measurement.delta.rssMiB, budgets.complexGraphDistinctRssDeltaMiB);
    return;
  }
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
        ['Complex graph groups', String(report.config.complexGraphGroupCount)],
        ['Complex graph fallback stages/model', String(report.config.complexGraphFallbackStageCount)],
        ['Complex graph endpoints/fallback stage', String(report.config.complexGraphEndpointsPerFallbackStage)],
        ['Complex graph hot iterations', String(report.config.complexGraphHotIterations)],
        ['Complex graph distinct samples', String(report.config.complexGraphDistinctSamples)],
        ['Complex graph distinct width', String(report.config.complexGraphDistinctWidth)],
        ['Insert chunk size', String(report.config.insertChunkSize)],
        ['Node', report.config.node],
        ['Platform', `${report.config.platform}/${report.config.arch}`],
        ['Heap cap MiB', report.config.heapLimitMiB == null ? 'unbounded' : String(report.config.heapLimitMiB)],
      ],
    ),
    '',
    '## Complex Active Graph',
    '',
    report.complexGraph
      ? markdownTable(
        ['Metric', 'Value'],
        [
          ['Version id', String(report.complexGraph.versionId)],
          ['Route groups', String(report.complexGraph.groupCount)],
          ['Fallback stages/model', String(report.complexGraph.fallbackStageCount)],
          ['Endpoints/fallback stage', String(report.complexGraph.endpointsPerFallbackStage)],
          ['Source graph MiB', formatNumber(report.complexGraph.sourceGraphBytes / 1024 / 1024)],
          ['Compiled graph MiB', formatNumber(report.complexGraph.compiledGraphBytes / 1024 / 1024)],
          ['Compiled router bundle MiB', formatNumber(report.complexGraph.compiledRouterBundleBytes / 1024 / 1024)],
          ['First model', report.complexGraph.firstModel],
          ['Last model', report.complexGraph.lastModel],
        ],
      )
      : 'No complex active graph fixture was published.',
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
      ['Runtime', 'Value'],
      [
        ['runtime', report.cacheStats.runtime],
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
    complexGraphGroupCount,
    complexGraphFallbackStageCount,
    complexGraphEndpointsPerFallbackStage,
    complexGraphHotIterations,
    complexGraphDistinctSamples,
    complexGraphDistinctWidth,
    dataDir,
    reportDir,
    budgets,
  }));

  const setupStartMemory = memory();
  const measurements: Measurement[] = [];
  const checks: Budget[] = [];
  let dbModule: DbModule | null = null;
  let seeded: SeededRouteRuntimeFixture | null = null;
  let complexGraph: ComplexActiveRouteGraphFixture | null = null;

  try {
    await measure('import database runtime', 1, async () => {
      await migrateRouteRuntimeDatabase();
      dbModule = await import('../../src/server/db/index.js');
    });
    if (!dbModule) throw new Error('database module did not load');

    await measure(`seed ${groupCount} route groups`, groupCount, async () => {
      seeded = await seedRouteRuntimeFixture({
        dbModule: dbModule!,
        groupCount,
        insertChunkSize,
      });
    });
    if (!seeded) throw new Error('route runtime fixture did not seed');
    await measure('publish seeded route groups through graph authoring', groupCount, () => (
      publishSeededRouteRuntimeFixture(seeded!, 'route-runtime-performance-gate')
    ));
    const { invalidateRouteRuntimeCaches } = await import('../../src/server/services/routeRuntimeCacheService.js');

    const runtimeModule: RouteRuntimeExecutionModule = await import('../../src/server/services/routeRuntimeExecutionService.js');
    const selector: RouteRuntimeSelector = {
      selectExecutionAttempt: (model, options = {}) => runtimeModule.selectRouteRuntimeExecutionAttempt({
        requestedModel: model,
        retryCount: 0,
        disabledExecutionTargetIds: options.disabledExecutionTargetIds,
      }),
    };
    const firstModel = 'perf-group-0';
    const lastModel = `perf-group-${groupCount - 1}`;

    invalidateRouteRuntimeCaches('manual');
    const routingStartMemory = memory();

    measurements.push((await measure('single cold compiled runtime selection first model', 1, async () => {
      failIfNull('single cold first model', await selector.selectExecutionAttempt(firstModel));
    })).measurement);

    measurements.push((await measure('single cold compiled runtime selection last model', 1, async () => {
      failIfNull('single cold last model', await selector.selectExecutionAttempt(lastModel));
    })).measurement);

    invalidateRouteRuntimeCaches('manual');
    measurements.push((await measure(`concurrent same cold model x${concurrency}`, concurrency, async () => {
      const results = await Promise.all(Array.from({ length: concurrency }, () => selector.selectExecutionAttempt(lastModel)));
      if (results.some((result) => !result)) throw new Error('concurrent same cold model returned null');
    })).measurement);

    measurements.push((await measure(`hot same model x${hotIterations}`, hotIterations, async () => {
      for (let index = 0; index < hotIterations; index += 1) {
        failIfNull(`hot same model ${index}`, await selector.selectExecutionAttempt(lastModel));
      }
    })).measurement);

    const sequentialSamples = Math.min(distinctSequentialSamples, groupCount);
    invalidateRouteRuntimeCaches('manual');
    measurements.push((await measure(`distinct models sequential x${sequentialSamples}`, sequentialSamples, async () => {
      for (let index = 0; index < sequentialSamples; index += 1) {
        const model = `perf-group-${Math.floor((index * groupCount) / sequentialSamples)}`;
        failIfNull(`distinct sequential ${model}`, await selector.selectExecutionAttempt(model));
      }
    })).measurement);

    const distinctConcurrentTotal = Math.min(distinctConcurrentSamples, groupCount);
    const distinctConcurrency = Math.min(distinctConcurrentWidth, distinctConcurrentTotal);
    const distinctCounterLabel = `concurrent distinct cold models x${distinctConcurrentTotal} (${distinctConcurrency}-wide)`;
    invalidateRouteRuntimeCaches('manual');
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
            return selector.selectExecutionAttempt(model);
          }));
          if (results.some((result) => !result)) throw new Error('concurrent distinct cold models returned null');
        }
      },
    );
    measurements.push(distinctConcurrentMeasurement.measurement);

    invalidateRouteRuntimeCaches('manual');
    measurements.push((await measure('single cold compiled runtime selection after cache invalidation', 1, async () => {
      failIfNull('cache invalidated last model', await selector.selectExecutionAttempt(lastModel));
    })).measurement);

    const complexPublish = await measure(
      `publish complex active route graph x${complexGraphGroupCount}`,
      complexGraphGroupCount,
      async () => {
        complexGraph = await publishComplexActiveRouteGraphFixture({
          dbModule: dbModule!,
          seeded: seeded!,
          groupCount: complexGraphGroupCount,
          fallbackStageCount: complexGraphFallbackStageCount,
          endpointsPerFallbackStage: complexGraphEndpointsPerFallbackStage,
        });
      },
    );
    measurements.push(complexPublish.measurement);
    if (!complexGraph) throw new Error('complex active route graph fixture was not published');

    invalidateRouteRuntimeCaches('manual');
    measurements.push((await measure('complex active graph cold-cache route decision first model', 1, async () => {
      failIfNull('complex active graph cold first model', await selector.selectExecutionAttempt(complexGraph!.firstModel));
    })).measurement);

    measurements.push((await measure(`complex active graph hot same model x${complexGraphHotIterations}`, complexGraphHotIterations, async () => {
      for (let index = 0; index < complexGraphHotIterations; index += 1) {
        failIfNull(`complex active graph hot same model ${index}`, await selector.selectExecutionAttempt(complexGraph!.lastModel));
      }
    })).measurement);

    measurements.push((await measure('complex active graph failure-overlay decision', 1, async () => {
      const attempt = failIfNull('complex active graph overlay selection', await selector.selectExecutionAttempt(
        complexGraph!.overlayModel,
        { disabledExecutionTargetIds: [complexGraph!.overlayDisabledExecutionTargetId] },
      ));
      if (attempt.executionTargetId === complexGraph!.overlayDisabledExecutionTargetId) {
        throw new Error(`complex active graph overlay selected disabled endpoint ${complexGraph!.overlayDisabledExecutionTargetId}`);
      }
    })).measurement);

    const complexDistinctTotal = Math.min(complexGraphDistinctSamples, complexGraph.groupCount);
    const complexDistinctConcurrency = Math.min(complexGraphDistinctWidth, complexDistinctTotal);
    invalidateRouteRuntimeCaches('manual');
    measurements.push((await measure(
      `complex active graph distinct models x${complexDistinctTotal} (${complexDistinctConcurrency}-wide)`,
      complexDistinctTotal,
      async () => {
        for (let offset = 0; offset < complexDistinctTotal; offset += complexDistinctConcurrency) {
          const batchSize = Math.min(complexDistinctConcurrency, complexDistinctTotal - offset);
          const results = await Promise.all(Array.from({ length: batchSize }, (_, index) => {
            const modelIndex = offset + index;
            const model = `perf-complex-group-${Math.floor((modelIndex * complexGraph!.groupCount) / complexDistinctTotal)}`;
            return selector.selectExecutionAttempt(model);
          }));
          if (results.some((result) => !result)) throw new Error('complex active graph distinct models returned null');
        }
      },
    )).measurement);

    for (const measurement of measurements) {
      addMeasurementBudgets(checks, measurement);
    }

    const routingEndMemory = memory();
    const finalMemory = memory();
    const routingMemoryDelta = memoryDelta(routingEndMemory, routingStartMemory);
    const totalMemoryDelta = memoryDelta(finalMemory, setupStartMemory);
    const cacheStats = { runtime: 'compiled-runtime' as const };
    addLte(checks, 'routing retained memory', 'heapUsedDeltaMiB', routingMemoryDelta.heapUsedMiB, budgets.routingHeapDeltaMiB);
    addLte(checks, 'routing retained memory', 'rssDeltaMiB', routingMemoryDelta.rssMiB, budgets.routingRssDeltaMiB);
    addLte(checks, 'final memory', 'rssMiB', finalMemory.rssMiB, budgets.finalRssMiB);
    addLte(checks, 'final memory', 'heapUsedMiB', finalMemory.heapUsedMiB, budgets.finalHeapUsedMiB);

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
        complexGraphGroupCount,
        complexGraphFallbackStageCount,
        complexGraphEndpointsPerFallbackStage,
        complexGraphHotIterations,
        complexGraphDistinctSamples,
        complexGraphDistinctWidth,
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
      complexGraph,
      cacheStats,
    };

    console.log(JSON.stringify({
      type: 'summary',
      routeGroups: groupCount,
      concurrency,
      distinctConcurrentSamples,
      distinctConcurrentWidth,
      measurements,
      complexGraph,
      memory: report.memory,
      cacheStats,
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
