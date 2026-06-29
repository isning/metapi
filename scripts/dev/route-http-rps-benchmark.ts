import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { availableParallelism, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type autocannon from 'autocannon';

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
import {
  buildConcurrencySweep,
  parsePositiveIntegerList,
  percentile,
} from './route-runtime-throughput-benchmark.js';

type TokenRouterModule = typeof import('../../src/server/services/tokenRouter.js');
type AutocannonResult = Awaited<ReturnType<typeof autocannon>>;

type HttpRun = {
  connections: number;
  repeat: number;
  requests: number;
  rps: number;
  serverCpuMs: number;
  serverCpuRps: number;
  serverCpuUtilization: number;
  eventLoopUtilization: number;
  eventLoopDelayP99Ms: number;
  latency: {
    averageMs: number;
    p50Ms: number;
    p97_5Ms: number;
    p99Ms: number;
    maxMs: number;
  };
  throughputBytesPerSec: number;
  errors: number;
  timeouts: number;
  non2xx: number;
  statusCodeStats: Record<string, { count?: number }> | undefined;
  before: MemorySnapshot;
  after: MemorySnapshot;
  delta: MemorySnapshot;
};

type HttpSummary = {
  connections: number;
  repeats: number;
  medianRps: number;
  medianServerCpuRps: number;
  medianP99LatencyMs: number;
  medianEventLoopDelayP99Ms: number;
  medianServerCpuUtilization: number;
};

type HttpReport = {
  generatedAt: string;
  config: {
    groupCount: number;
    modelCardinality: number;
    connectionSweep: number[];
    repeats: number;
    warmupSeconds: number;
    durationSeconds: number;
    pipelining: number;
    autocannonWorkers: number;
    insertChunkSize: number;
    dataDir: string;
    reportDir: string;
    node: string;
    platform: NodeJS.Platform;
    arch: string;
    availableCpuCount: number;
    heapLimitMiB: number | null;
  };
  endpoint: string;
  recommendedConnections: number;
  peakConnections: number;
  peakMedianRps: number;
  summaries: HttpSummary[];
  runs: HttpRun[];
};

const execFileAsync = promisify(execFile);

function availableCpuCount(): number {
  try {
    return Math.max(1, availableParallelism());
  } catch {
    return Math.max(1, cpus().length);
  }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function startEventLoopHeartbeat(intervalMs: number): { stop: () => Promise<number> } {
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
      const sorted = delays.sort((left, right) => left - right);
      return round(percentile(sorted, 0.99), 4);
    },
  };
}

export function summarizeHttpRuns(runs: HttpRun[]): HttpSummary[] {
  const byConnections = new Map<number, HttpRun[]>();
  for (const run of runs) {
    const entries = byConnections.get(run.connections) || [];
    entries.push(run);
    byConnections.set(run.connections, entries);
  }
  return Array.from(byConnections.entries())
    .sort(([left], [right]) => left - right)
    .map(([connections, entries]) => ({
      connections,
      repeats: entries.length,
      medianRps: round(percentile(entries.map((entry) => entry.rps).sort((left, right) => left - right), 0.5)),
      medianServerCpuRps: round(percentile(entries.map((entry) => entry.serverCpuRps).sort((left, right) => left - right), 0.5)),
      medianP99LatencyMs: round(percentile(entries.map((entry) => entry.latency.p99Ms).sort((left, right) => left - right), 0.5), 4),
      medianEventLoopDelayP99Ms: round(percentile(entries.map((entry) => entry.eventLoopDelayP99Ms).sort((left, right) => left - right), 0.5), 4),
      medianServerCpuUtilization: round(percentile(entries.map((entry) => entry.serverCpuUtilization).sort((left, right) => left - right), 0.5), 2),
    }));
}

export function selectRecommendedConnections(summaries: HttpSummary[]): {
  recommendedConnections: number;
  peakConnections: number;
  peakMedianRps: number;
} {
  const fallback: HttpSummary = {
    connections: 1,
    repeats: 0,
    medianRps: 0,
    medianServerCpuRps: 0,
    medianP99LatencyMs: 0,
    medianEventLoopDelayP99Ms: 0,
    medianServerCpuUtilization: 0,
  };
  const peak = summaries.reduce(
    (best, entry) => entry.medianRps > best.medianRps ? entry : best,
    summaries[0] || fallback,
  );
  const threshold = peak.medianRps * 0.95;
  const recommended = summaries.find((entry) => entry.medianRps >= threshold) || peak;
  return {
    recommendedConnections: recommended.connections,
    peakConnections: peak.connections,
    peakMedianRps: round(peak.medianRps),
  };
}

function parseAutocannonJson(stdout: string): AutocannonResult {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]) as AutocannonResult;
    } catch {
      // Autocannon JSON mode can emit newline-delimited progress records; skip non-final lines.
    }
  }
  throw new Error('autocannon did not emit a JSON result');
}

async function runAutocannon(input: {
  url: string;
  connections: number;
  durationSeconds: number;
  pipelining: number;
  workers: number;
  authToken: string;
  title: string;
}): Promise<AutocannonResult> {
  const autocannonCli = resolve(process.cwd(), 'node_modules/autocannon/autocannon.js');
  const args = [
    autocannonCli,
    '--json',
    '--no-progress',
    '--connections',
    String(input.connections),
    '--duration',
    String(input.durationSeconds),
    '--pipelining',
    String(input.pipelining),
    '--workers',
    String(input.workers),
    '--method',
    'POST',
    '--headers',
    `authorization=Bearer ${input.authToken}`,
    '--headers',
    'content-type=application/json',
    '--body',
    '{}',
    '--title',
    input.title,
    input.url,
  ];
  const { stdout } = await execFileAsync(process.execPath, args, {
    cwd: process.cwd(),
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseAutocannonJson(stdout);
}

async function createBenchmarkServer(input: {
  routerModule: TokenRouterModule;
  modelCardinality: number;
  authToken: string;
}): Promise<{ app: FastifyInstance; url: string }> {
  const app = Fastify({ logger: false });
  let requestIndex = 0;

  app.post('/__bench/route-decision', async (request, reply) => {
    const authorization = String(request.headers.authorization || '');
    if (authorization !== `Bearer ${input.authToken}`) {
      reply.code(401);
      return { ok: false };
    }
    const modelIndex = requestIndex % input.modelCardinality;
    requestIndex = (requestIndex + 1) % Number.MAX_SAFE_INTEGER;
    const selected = await input.routerModule.tokenRouter.selectTarget(`perf-group-${modelIndex}`);
    if (!selected) {
      reply.code(404);
      return { ok: false };
    }
    return { ok: true };
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo | null;
  if (!address || typeof address === 'string') {
    await app.close();
    throw new Error('benchmark server did not expose a TCP address');
  }
  return {
    app,
    url: `http://127.0.0.1:${address.port}/__bench/route-decision`,
  };
}

async function measureHttpRun(input: {
  url: string;
  connections: number;
  repeat: number;
  warmupSeconds: number;
  durationSeconds: number;
  pipelining: number;
  workers: number;
  authToken: string;
}): Promise<HttpRun> {
  await runAutocannon({
    url: input.url,
    connections: input.connections,
    durationSeconds: input.warmupSeconds,
    pipelining: input.pipelining,
    workers: input.workers,
    authToken: input.authToken,
    title: `warmup-${input.connections}`,
  });

  gc();
  const before = memory();
  const eventLoopHeartbeat = startEventLoopHeartbeat(10);
  const eventLoopBefore = performance.eventLoopUtilization();
  const cpuBefore = process.cpuUsage();
  const started = performance.now();
  const result = await runAutocannon({
    url: input.url,
    connections: input.connections,
    durationSeconds: input.durationSeconds,
    pipelining: input.pipelining,
    workers: input.workers,
    authToken: input.authToken,
    title: `http-route-decision-c${input.connections}-r${input.repeat}`,
  });
  const elapsedMs = performance.now() - started;
  const serverCpuMs = cpuUsageMs(process.cpuUsage(cpuBefore));
  const eventLoopDelayP99Ms = await eventLoopHeartbeat.stop();
  const eventLoopUse = performance.eventLoopUtilization(eventLoopBefore);
  const after = memory();
  const requestTotal = Math.max(1, Math.round(result.requests.total || (result.requests.average * result.duration)));

  return {
    connections: input.connections,
    repeat: input.repeat,
    requests: requestTotal,
    rps: round(result.requests.average),
    serverCpuMs: round(serverCpuMs),
    serverCpuRps: round(requestTotal / Math.max(serverCpuMs / 1000, 0.001)),
    serverCpuUtilization: round((serverCpuMs / Math.max(elapsedMs, 1)) * 100, 2),
    eventLoopUtilization: round(eventLoopUse.utilization * 100, 2),
    eventLoopDelayP99Ms,
    latency: {
      averageMs: round(result.latency.average, 4),
      p50Ms: round(result.latency.p50, 4),
      p97_5Ms: round(result.latency.p97_5, 4),
      p99Ms: round(result.latency.p99, 4),
      maxMs: round(result.latency.max, 4),
    },
    throughputBytesPerSec: round(result.throughput.average),
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    statusCodeStats: result.statusCodeStats,
    before,
    after,
    delta: memoryDelta(after, before),
  };
}

function buildMarkdownReport(report: HttpReport): string {
  return [
    '# Route HTTP RPS Benchmark Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Endpoint: ${report.endpoint}`,
    '',
    '## Scenario',
    '',
    markdownTable(
      ['Setting', 'Value'],
      [
        ['Route groups', String(report.config.groupCount)],
        ['Model cardinality', String(report.config.modelCardinality)],
        ['Connection sweep', report.config.connectionSweep.join(', ')],
        ['Repeats', String(report.config.repeats)],
        ['Warmup seconds', String(report.config.warmupSeconds)],
        ['Duration seconds', String(report.config.durationSeconds)],
        ['Pipelining', String(report.config.pipelining)],
        ['Autocannon workers', String(report.config.autocannonWorkers)],
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
        ['Recommended connections', String(report.recommendedConnections)],
        ['Peak connections', String(report.peakConnections)],
        ['Peak median RPS', formatNumber(report.peakMedianRps)],
      ],
    ),
    '',
    '## Connection Summary',
    '',
    markdownTable(
      ['Connections', 'Repeats', 'Median RPS', 'Median server CPU RPS', 'Median p99 latency ms', 'Median event-loop p99 delay ms', 'Median server CPU %'],
      report.summaries.map((entry) => [
        String(entry.connections),
        String(entry.repeats),
        formatNumber(entry.medianRps),
        formatNumber(entry.medianServerCpuRps),
        formatNumber(entry.medianP99LatencyMs, 4),
        formatNumber(entry.medianEventLoopDelayP99Ms, 4),
        formatNumber(entry.medianServerCpuUtilization, 2),
      ]),
    ),
    '',
    '## Raw Runs',
    '',
    markdownTable(
      ['Connections', 'Repeat', 'Requests', 'RPS', 'Server CPU RPS', 'Server CPU %', 'ELU %', 'p50 ms', 'p97.5 ms', 'p99 ms', 'Errors', 'Timeouts', 'Non-2xx', 'RSS delta MiB', 'Heap delta MiB'],
      report.runs.map((run) => [
        String(run.connections),
        String(run.repeat),
        String(run.requests),
        formatNumber(run.rps),
        formatNumber(run.serverCpuRps),
        formatNumber(run.serverCpuUtilization, 2),
        formatNumber(run.eventLoopUtilization, 2),
        formatNumber(run.latency.p50Ms, 4),
        formatNumber(run.latency.p97_5Ms, 4),
        formatNumber(run.latency.p99Ms, 4),
        String(run.errors),
        String(run.timeouts),
        String(run.non2xx),
        formatNumber(run.delta.rssMiB, 1),
        formatNumber(run.delta.heapUsedMiB, 1),
      ]),
    ),
    '',
    'Notes:',
    '',
    '- Uses autocannon as an external load generator process.',
    '- Measures HTTP ingress, Fastify routing, JSON parsing/serialization, auth header check, and token router selection.',
    '- Does not include upstream provider network I/O or streaming response relay.',
    '',
  ].join('\n');
}

function writeReport(report: HttpReport): void {
  mkdirSync(report.config.reportDir, { recursive: true });
  const jsonPath = join(report.config.reportDir, 'route-http-rps-benchmark-report.json');
  const markdownPath = join(report.config.reportDir, 'route-http-rps-benchmark-report.md');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, buildMarkdownReport(report), 'utf8');
  console.log(JSON.stringify({ type: 'http-rps-report', format: 'json', path: jsonPath }));
  console.log(JSON.stringify({ type: 'http-rps-report', format: 'markdown', path: markdownPath }));
}

async function main(): Promise<void> {
  const explicitSweep = parsePositiveIntegerList(process.env.ROUTE_HTTP_RPS_CONNECTION_SWEEP, []);
  const maxConnections = readPositiveInteger('ROUTE_HTTP_RPS_MAX_CONNECTIONS', 1_024);
  const connectionSweep = buildConcurrencySweep({ maxConcurrency: maxConnections, explicitSweep });
  const modelCardinalityInput = readPositiveInteger('ROUTE_HTTP_RPS_MODEL_CARDINALITY', 10_000);
  const groupCount = Math.max(readPositiveInteger('ROUTE_HTTP_RPS_GROUPS', 10_000), modelCardinalityInput);
  const modelCardinality = Math.min(modelCardinalityInput, groupCount);
  const insertChunkSize = readPositiveInteger('ROUTE_HTTP_RPS_INSERT_CHUNK_SIZE', 250);
  const warmupSeconds = readPositiveInteger('ROUTE_HTTP_RPS_WARMUP_SECONDS', 2);
  const durationSeconds = readPositiveInteger('ROUTE_HTTP_RPS_DURATION_SECONDS', 5);
  const repeats = readPositiveInteger('ROUTE_HTTP_RPS_REPEATS', 3);
  const pipelining = readPositiveInteger('ROUTE_HTTP_RPS_PIPELINING', 1);
  const autocannonWorkers = readPositiveInteger('ROUTE_HTTP_RPS_WORKERS', 1);
  const reportDir = resolveReportDir(process.env.ROUTE_HTTP_RPS_REPORT_DIR || 'test-results/performance/http-rps');
  const authToken = 'bench-http-token';
  const dataDir = createRouteRuntimeDataDir();
  configureRouteRuntimeDataDir(dataDir);

  let dbModule: DbModule | null = null;
  let server: { app: FastifyInstance; url: string } | null = null;
  try {
    await import('../../src/server/db/migrate.js');
    dbModule = await import('../../src/server/db/index.js');
    await seedRouteRuntimeFixture({ dbModule, groupCount, insertChunkSize });
    const projection = await import('../../src/server/services/routeTableProjectionService.js');
    await projection.syncRouteBindingProjectionsFromRouteTable();
    const routerModule: TokenRouterModule = await import('../../src/server/services/tokenRouter.js');
    server = await createBenchmarkServer({ routerModule, modelCardinality, authToken });

    console.log(JSON.stringify({
      type: 'http-rps-config',
      groupCount,
      modelCardinality,
      connectionSweep,
      repeats,
      warmupSeconds,
      durationSeconds,
      pipelining,
      autocannonWorkers,
      url: server.url,
      dataDir,
      reportDir,
    }));

    const runs: HttpRun[] = [];
    for (const connections of connectionSweep) {
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        routerModule.invalidateTokenRouterCache();
        const run = await measureHttpRun({
          url: server.url,
          connections,
          repeat,
          warmupSeconds,
          durationSeconds,
          pipelining,
          workers: autocannonWorkers,
          authToken,
        });
        runs.push(run);
        console.log(JSON.stringify({ type: 'http-rps-run', ...run }));
      }
    }

    const summaries = summarizeHttpRuns(runs);
    const recommendation = selectRecommendedConnections(summaries);
    writeReport({
      generatedAt: new Date().toISOString(),
      config: {
        groupCount,
        modelCardinality,
        connectionSweep,
        repeats,
        warmupSeconds,
        durationSeconds,
        pipelining,
        autocannonWorkers,
        insertChunkSize,
        dataDir,
        reportDir,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        availableCpuCount: availableCpuCount(),
        heapLimitMiB: heapLimitMiB(),
      },
      endpoint: server.url,
      ...recommendation,
      summaries,
      runs,
    });
  } finally {
    await server?.app.close().catch(() => undefined);
    await dbModule?.closeDbConnections().catch(() => undefined);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

const currentScript = process.argv[1] || '';
if (currentScript.endsWith('route-http-rps-benchmark.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
