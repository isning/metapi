import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
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
  resolveReportDir,
  round,
  seedRouteRuntimeFixture,
  type DbModule,
  type MemorySnapshot,
} from './routeRuntimePerformanceFixture.js';

type TokenRouterModule = typeof import('../../src/server/services/tokenRouter.js');
type TokenRouter = TokenRouterModule['tokenRouter'];

type LatencyStats = {
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

type ThroughputRun = {
  concurrency: number;
  repeat: number;
  operations: number;
  failures: number;
  elapsedMs: number;
  cpuMs: number;
  elapsedQps: number;
  cpuQps: number;
  processCpuUtilization: number;
  eventLoopUtilization: number;
  eventLoopDelayP95Ms: number;
  eventLoopDelayP99Ms: number;
  latency: LatencyStats;
  before: MemorySnapshot;
  after: MemorySnapshot;
  delta: MemorySnapshot;
};

type ThroughputSummary = {
  concurrency: number;
  repeats: number;
  medianElapsedQps: number;
  medianCpuQps: number;
  medianP99LatencyMs: number;
  medianEventLoopDelayP99Ms: number;
  medianProcessCpuUtilization: number;
};

type ThroughputReport = {
  generatedAt: string;
  config: {
    groupCount: number;
    modelCardinality: number;
    concurrencySweep: number[];
    repeats: number;
    warmupMs: number;
    durationMs: number;
    insertChunkSize: number;
    latencySampleLimit: number;
    dataDir: string;
    reportDir: string;
    node: string;
    platform: NodeJS.Platform;
    arch: string;
    availableCpuCount: number;
    heapLimitMiB: number | null;
  };
  recommendedConcurrency: number;
  peakConcurrency: number;
  peakMedianElapsedQps: number;
  summaries: ThroughputSummary[];
  runs: ThroughputRun[];
};

function availableCpuCount(): number {
  try {
    return Math.max(1, availableParallelism());
  } catch {
    return Math.max(1, cpus().length);
  }
}

export function parsePositiveIntegerList(input: string | undefined, fallback: number[]): number[] {
  if (!input?.trim()) return fallback;
  const values = input
    .split(',')
    .map((item) => Math.trunc(Number(item.trim())))
    .filter((value) => Number.isFinite(value) && value > 0);
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

export function buildConcurrencySweep(input: {
  maxConcurrency: number;
  explicitSweep?: number[];
}): number[] {
  if (input.explicitSweep && input.explicitSweep.length > 0) {
    return Array.from(new Set(input.explicitSweep.filter((value) => value <= input.maxConcurrency)))
      .sort((left, right) => left - right);
  }
  const base = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1_024, 2_048, 4_096, 8_192, 10_000];
  const values = base.filter((value) => value <= input.maxConcurrency);
  if (!values.includes(input.maxConcurrency)) values.push(input.maxConcurrency);
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

export function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * fraction) - 1),
  );
  return sortedValues[index] || 0;
}

function latencyStats(values: number[]): LatencyStats {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    minMs: round(sorted[0] || 0, 4),
    p50Ms: round(percentile(sorted, 0.5), 4),
    p95Ms: round(percentile(sorted, 0.95), 4),
    p99Ms: round(percentile(sorted, 0.99), 4),
    maxMs: round(sorted[sorted.length - 1] || 0, 4),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function startEventLoopHeartbeat(intervalMs: number): { stop: () => Promise<LatencyStats> } {
  const delays: number[] = [];
  let expected = performance.now() + intervalMs;
  const timer = setInterval(() => {
    const now = performance.now();
    delays.push(Math.max(0, now - expected));
    expected += intervalMs;
    while (expected < now) expected += intervalMs;
  }, intervalMs);
  timer.unref();
  return {
    async stop() {
      await sleep(0);
      clearInterval(timer);
      return latencyStats(delays);
    },
  };
}

export function summarizeThroughputRuns(runs: ThroughputRun[]): ThroughputSummary[] {
  const byConcurrency = new Map<number, ThroughputRun[]>();
  for (const run of runs) {
    const entries = byConcurrency.get(run.concurrency) || [];
    entries.push(run);
    byConcurrency.set(run.concurrency, entries);
  }
  return Array.from(byConcurrency.entries())
    .sort(([left], [right]) => left - right)
    .map(([concurrency, entries]) => ({
      concurrency,
      repeats: entries.length,
      medianElapsedQps: round(percentile(entries.map((entry) => entry.elapsedQps).sort((left, right) => left - right), 0.5)),
      medianCpuQps: round(percentile(entries.map((entry) => entry.cpuQps).sort((left, right) => left - right), 0.5)),
      medianP99LatencyMs: round(percentile(entries.map((entry) => entry.latency.p99Ms).sort((left, right) => left - right), 0.5), 4),
      medianEventLoopDelayP99Ms: round(percentile(entries.map((entry) => entry.eventLoopDelayP99Ms).sort((left, right) => left - right), 0.5), 4),
      medianProcessCpuUtilization: round(percentile(entries.map((entry) => entry.processCpuUtilization).sort((left, right) => left - right), 0.5), 2),
    }));
}

export function selectRecommendedConcurrency(summaries: ThroughputSummary[]): {
  recommendedConcurrency: number;
  peakConcurrency: number;
  peakMedianElapsedQps: number;
} {
  const peak = summaries.reduce(
    (best, entry) => entry.medianElapsedQps > best.medianElapsedQps ? entry : best,
    summaries[0] || {
      concurrency: 1,
      repeats: 0,
      medianElapsedQps: 0,
      medianCpuQps: 0,
      medianP99LatencyMs: 0,
      medianEventLoopDelayP99Ms: 0,
      medianProcessCpuUtilization: 0,
    },
  );
  const threshold = peak.medianElapsedQps * 0.95;
  const recommended = summaries.find((entry) => entry.medianElapsedQps >= threshold) || peak;
  return {
    recommendedConcurrency: recommended.concurrency,
    peakConcurrency: peak.concurrency,
    peakMedianElapsedQps: round(peak.medianElapsedQps),
  };
}

async function runForDuration(input: {
  router: TokenRouter;
  concurrency: number;
  durationMs: number;
  modelCardinality: number;
  collectLatencies: boolean;
  latencySampleLimit: number;
}): Promise<{ operations: number; failures: number; latencies: number[] }> {
  const deadline = performance.now() + input.durationMs;
  const latencies: number[] = [];
  let operations = 0;
  let failures = 0;

  async function worker(workerId: number): Promise<void> {
    let modelIndex = workerId;
    while (performance.now() < deadline) {
      const model = `perf-group-${modelIndex % input.modelCardinality}`;
      modelIndex = (modelIndex + (input.concurrency * 8_191)) % input.modelCardinality;
      const started = performance.now();
      const result = await input.router.selectTarget(model);
      const elapsed = performance.now() - started;
      operations += 1;
      if (!result) failures += 1;
      if (input.collectLatencies && latencies.length < input.latencySampleLimit) {
        latencies.push(elapsed);
      }
    }
  }

  await Promise.all(Array.from({ length: input.concurrency }, (_, index) => worker(index)));
  return { operations, failures, latencies };
}

async function measureThroughput(input: {
  router: TokenRouter;
  concurrency: number;
  repeat: number;
  warmupMs: number;
  durationMs: number;
  modelCardinality: number;
  latencySampleLimit: number;
}): Promise<ThroughputRun> {
  await runForDuration({
    router: input.router,
    concurrency: input.concurrency,
    durationMs: input.warmupMs,
    modelCardinality: input.modelCardinality,
    collectLatencies: false,
    latencySampleLimit: input.latencySampleLimit,
  });

  gc();
  const before = memory();
  const eventLoopHeartbeat = startEventLoopHeartbeat(10);
  const eventLoopBefore = performance.eventLoopUtilization();
  const cpuBefore = process.cpuUsage();
  const started = performance.now();
  const result = await runForDuration({
    router: input.router,
    concurrency: input.concurrency,
    durationMs: input.durationMs,
    modelCardinality: input.modelCardinality,
    collectLatencies: true,
    latencySampleLimit: input.latencySampleLimit,
  });
  const elapsedMs = performance.now() - started;
  const cpuMs = cpuUsageMs(process.cpuUsage(cpuBefore));
  const heartbeatStats = await eventLoopHeartbeat.stop();
  const eventLoopUse = performance.eventLoopUtilization(eventLoopBefore);
  const after = memory();
  const operations = Math.max(1, result.operations);

  return {
    concurrency: input.concurrency,
    repeat: input.repeat,
    operations,
    failures: result.failures,
    elapsedMs: round(elapsedMs),
    cpuMs: round(cpuMs),
    elapsedQps: round(operations / Math.max(elapsedMs / 1000, 0.001)),
    cpuQps: round(operations / Math.max(cpuMs / 1000, 0.001)),
    processCpuUtilization: round((cpuMs / Math.max(elapsedMs, 1)) * 100, 2),
    eventLoopUtilization: round(eventLoopUse.utilization * 100, 2),
    eventLoopDelayP95Ms: heartbeatStats.p95Ms,
    eventLoopDelayP99Ms: heartbeatStats.p99Ms,
    latency: latencyStats(result.latencies),
    before,
    after,
    delta: memoryDelta(after, before),
  };
}

function formatNumber(value: number, fractionDigits = 2): string {
  return Number.isFinite(value) ? value.toFixed(fractionDigits) : String(value);
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function buildMarkdownReport(report: ThroughputReport): string {
  return [
    '# Route Runtime Throughput Benchmark Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Scenario',
    '',
    markdownTable(
      ['Setting', 'Value'],
      [
        ['Route groups', String(report.config.groupCount)],
        ['Model cardinality', String(report.config.modelCardinality)],
        ['Concurrency sweep', report.config.concurrencySweep.join(', ')],
        ['Repeats', String(report.config.repeats)],
        ['Warmup ms', String(report.config.warmupMs)],
        ['Duration ms', String(report.config.durationMs)],
        ['Available CPUs', String(report.config.availableCpuCount)],
        ['Heap cap MiB', report.config.heapLimitMiB == null ? 'unbounded' : String(report.config.heapLimitMiB)],
      ],
    ),
    '',
    '## Recommendation',
    '',
    markdownTable(
      ['Metric', 'Value'],
      [
        ['Recommended concurrency', String(report.recommendedConcurrency)],
        ['Peak concurrency', String(report.peakConcurrency)],
        ['Peak median elapsed QPS', formatNumber(report.peakMedianElapsedQps)],
      ],
    ),
    '',
    '## Concurrency Summary',
    '',
    markdownTable(
      ['Concurrency', 'Repeats', 'Median elapsed QPS', 'Median CPU QPS', 'Median p99 latency ms', 'Median event-loop p99 delay ms', 'Median process CPU %'],
      report.summaries.map((entry) => [
        String(entry.concurrency),
        String(entry.repeats),
        formatNumber(entry.medianElapsedQps),
        formatNumber(entry.medianCpuQps),
        formatNumber(entry.medianP99LatencyMs, 4),
        formatNumber(entry.medianEventLoopDelayP99Ms, 4),
        formatNumber(entry.medianProcessCpuUtilization, 2),
      ]),
    ),
    '',
    '## Raw Runs',
    '',
    markdownTable(
      ['Concurrency', 'Repeat', 'Ops', 'Failures', 'Elapsed QPS', 'CPU QPS', 'CPU %', 'ELU %', 'p50 ms', 'p95 ms', 'p99 ms', 'EL delay p99 ms', 'RSS delta MiB', 'Heap delta MiB'],
      report.runs.map((run) => [
        String(run.concurrency),
        String(run.repeat),
        String(run.operations),
        String(run.failures),
        formatNumber(run.elapsedQps),
        formatNumber(run.cpuQps),
        formatNumber(run.processCpuUtilization, 2),
        formatNumber(run.eventLoopUtilization, 2),
        formatNumber(run.latency.p50Ms, 4),
        formatNumber(run.latency.p95Ms, 4),
        formatNumber(run.latency.p99Ms, 4),
        formatNumber(run.eventLoopDelayP99Ms, 4),
        formatNumber(run.delta.rssMiB, 1),
        formatNumber(run.delta.heapUsedMiB, 1),
      ]),
    ),
    '',
    'Notes:',
    '',
    '- This is closed-loop in-process route-decision throughput, not HTTP ingress RPS.',
    '- Use the peak/recommended concurrency from this report to choose fixed-width stress cases.',
    '- HTTP RPS should be measured separately against a running server with a load generator.',
    '',
  ].join('\n');
}

function writeReport(report: ThroughputReport): void {
  mkdirSync(report.config.reportDir, { recursive: true });
  const jsonPath = join(report.config.reportDir, 'route-runtime-throughput-benchmark-report.json');
  const markdownPath = join(report.config.reportDir, 'route-runtime-throughput-benchmark-report.md');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, buildMarkdownReport(report), 'utf8');
  console.log(JSON.stringify({ type: 'throughput-report', format: 'json', path: jsonPath }));
  console.log(JSON.stringify({ type: 'throughput-report', format: 'markdown', path: markdownPath }));
}

async function main(): Promise<void> {
  const explicitSweep = parsePositiveIntegerList(process.env.ROUTE_THROUGHPUT_CONCURRENCY_SWEEP, []);
  const maxConcurrency = readPositiveInteger('ROUTE_THROUGHPUT_MAX_CONCURRENCY', 10_000);
  const concurrencySweep = buildConcurrencySweep({ maxConcurrency, explicitSweep });
  const distinctSamples = readPositiveInteger('ROUTE_THROUGHPUT_MODEL_CARDINALITY', 100_000);
  const groupCount = Math.max(readPositiveInteger('ROUTE_THROUGHPUT_GROUPS', 100_000), distinctSamples);
  const modelCardinality = Math.min(distinctSamples, groupCount);
  const insertChunkSize = readPositiveInteger('ROUTE_THROUGHPUT_INSERT_CHUNK_SIZE', 250);
  const warmupMs = readPositiveInteger('ROUTE_THROUGHPUT_WARMUP_MS', 1_000);
  const durationMs = readPositiveInteger('ROUTE_THROUGHPUT_DURATION_MS', 3_000);
  const repeats = readPositiveInteger('ROUTE_THROUGHPUT_REPEATS', 3);
  const latencySampleLimit = readPositiveInteger('ROUTE_THROUGHPUT_LATENCY_SAMPLE_LIMIT', 100_000);
  const reportDir = resolveReportDir(process.env.ROUTE_THROUGHPUT_REPORT_DIR || 'test-results/performance/throughput');
  const dataDir = createRouteRuntimeDataDir();
  configureRouteRuntimeDataDir(dataDir);

  console.log(JSON.stringify({
    type: 'throughput-config',
    groupCount,
    modelCardinality,
    concurrencySweep,
    repeats,
    warmupMs,
    durationMs,
    dataDir,
    reportDir,
  }));

  let dbModule: DbModule | null = null;
  try {
    await import('../../src/server/db/migrate.js');
    dbModule = await import('../../src/server/db/index.js');
    await seedRouteRuntimeFixture({ dbModule, groupCount, insertChunkSize });
    const projection = await import('../../src/server/services/routeTableProjectionService.js');
    await projection.syncRouteBindingProjectionsFromRouteTable();
    const routerModule: TokenRouterModule = await import('../../src/server/services/tokenRouter.js');
    const router = routerModule.tokenRouter;

    const runs: ThroughputRun[] = [];
    for (const concurrency of concurrencySweep) {
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        routerModule.invalidateTokenRouterCache();
        const run = await measureThroughput({
          router,
          concurrency,
          repeat,
          warmupMs,
          durationMs,
          modelCardinality,
          latencySampleLimit,
        });
        runs.push(run);
        console.log(JSON.stringify({ type: 'throughput-run', ...run }));
      }
    }

    const summaries = summarizeThroughputRuns(runs);
    const recommendation = selectRecommendedConcurrency(summaries);
    writeReport({
      generatedAt: new Date().toISOString(),
      config: {
        groupCount,
        modelCardinality,
        concurrencySweep,
        repeats,
        warmupMs,
        durationMs,
        insertChunkSize,
        latencySampleLimit,
        dataDir,
        reportDir,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        availableCpuCount: availableCpuCount(),
        heapLimitMiB: heapLimitMiB(),
      },
      ...recommendation,
      summaries,
      runs,
    });
    await dbModule.closeDbConnections();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

const currentScript = process.argv[1] || '';
if (currentScript.endsWith('route-runtime-throughput-benchmark.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
