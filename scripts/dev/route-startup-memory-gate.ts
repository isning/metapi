import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { eq } from 'drizzle-orm';
import {
  createRouteRuntimeDataDir,
  configureRouteRuntimeDataDir,
  heapLimitMiB,
  memory,
  memoryDelta,
  migrateRouteRuntimeDatabase,
  publishSeededRouteRuntimeFixture,
  readPositiveInteger,
  resolveReportDir,
  round,
  seedRouteRuntimeFixture,
  type DbModule,
  type MemorySnapshot,
} from './routeRuntimePerformanceFixture.js';

type StartupMemoryReport = {
  generatedAt: string;
  status: 'passed' | 'failed';
  config: {
    dataDir: string;
    groupCount: number;
    insertChunkSize: number;
    compiledGraphPaddingMiB: number;
    effectiveCompiledGraphPaddingMiB: number;
    childHeapMiB: number;
    childRssLimitMiB: number;
    timeoutMs: number;
    parentHeapLimitMiB: number | null;
  };
  timings: {
    seedMs: number;
    childStartupMs: number;
  };
  httpChecks: HttpCheckResult[];
  memory: {
    setupStart: MemorySnapshot;
    seedEnd: MemorySnapshot;
    final: MemorySnapshot;
    parentDelta: MemorySnapshot;
  };
  child: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    rssMiB: number | null;
    stdoutTail: string;
    stderrTail: string;
  };
};

type HttpCheckResult = {
  label: string;
  path: string;
  status: number;
  responseBytes: number;
  elapsedMs: number;
};

const reportDir = resolveReportDir(process.env.ROUTE_STARTUP_MEMORY_REPORT_DIR || 'test-results/performance/startup');
const dataDir = createRouteRuntimeDataDir();
const groupCount = readPositiveInteger('ROUTE_STARTUP_MEMORY_GROUPS', 1_000);
const insertChunkSize = readPositiveInteger('ROUTE_STARTUP_MEMORY_INSERT_CHUNK_SIZE', 250);
const compiledGraphPaddingMiB = readPositiveInteger('ROUTE_STARTUP_MEMORY_COMPILED_GRAPH_MIB', 32);
let effectiveCompiledGraphPaddingMiB = 0;
const childHeapMiB = readPositiveInteger('ROUTE_STARTUP_MEMORY_CHILD_HEAP_MIB', 160);
const childRssLimitMiB = readPositiveInteger('ROUTE_STARTUP_MEMORY_CHILD_RSS_MIB', 512);
const timeoutMs = readPositiveInteger('ROUTE_STARTUP_MEMORY_TIMEOUT_MS', 20_000);

function tail(input: string, maxLength = 8_000): string {
  return input.length <= maxLength ? input : input.slice(input.length - maxLength);
}

function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error('failed to allocate startup memory gate port'));
          return;
        }
        resolve(port);
      });
    });
  });
}

function waitForServerReady(child: ChildProcessWithoutNullStreams): Promise<{
  startupMs: number;
  getStdout: () => string;
  getStderr: () => string;
  waitForExit: () => Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
}> {
  const started = performance.now();
  let stdout = '';
  let stderr = '';
  let settled = false;
  let exitResult: { exitCode: number | null; signal: NodeJS.Signals | null } | null = null;
  const exitWaiters: Array<(value: { exitCode: number | null; signal: NodeJS.Signals | null }) => void> = [];

  return new Promise((resolve, reject) => {
    const finish = (value: Parameters<typeof resolve>[0]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      fail(new Error(`server startup memory gate timed out after ${timeoutMs}ms\nstdout:\n${tail(stdout)}\nstderr:\n${tail(stderr)}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (!settled && stdout.includes('metapi running on')) {
        finish({
          startupMs: round(performance.now() - started, 1),
          getStdout: () => stdout,
          getStderr: () => stderr,
          waitForExit: () => {
            if (exitResult) return Promise.resolve(exitResult);
            return new Promise((resolveExit) => exitWaiters.push(resolveExit));
          },
        });
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', fail);
    child.once('exit', (exitCode, signal) => {
      exitResult = { exitCode, signal };
      while (exitWaiters.length > 0) {
        exitWaiters.shift()?.(exitResult);
      }
      if (!settled) {
        fail(new Error(`server exited before startup completed (code=${exitCode ?? 'null'}, signal=${signal ?? 'null'})\nstdout:\n${tail(stdout)}\nstderr:\n${tail(stderr)}`));
      }
    });
  });
}

function readProcessRssMiB(pid: number | undefined): number | null {
  if (!pid) return null;
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
    if (!match) return null;
    return round(Number(match[1]) / 1024, 1);
  } catch {
    return null;
  }
}

async function runHttpCheck(input: {
  baseUrl: string;
  label: string;
  path: string;
  headers?: Record<string, string>;
  assertBody?: (body: string) => void;
}): Promise<HttpCheckResult> {
  const started = performance.now();
  const response = await fetch(`${input.baseUrl}${input.path}`, {
    headers: input.headers,
  });
  const body = await response.text();
  const result: HttpCheckResult = {
    label: input.label,
    path: input.path,
    status: response.status,
    responseBytes: Buffer.byteLength(body, 'utf8'),
    elapsedMs: round(performance.now() - started, 1),
  };
  if (!response.ok) {
    throw new Error(`${input.label} failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  input.assertBody?.(body);
  return result;
}

async function runHttpChecks(baseUrl: string): Promise<HttpCheckResult[]> {
  const adminHeaders = { authorization: 'Bearer startup-memory-admin' };
  const proxyHeaders = { authorization: 'Bearer startup-memory-proxy' };
  return [
    await runHttpCheck({
      baseUrl,
      label: 'active route graph manifest',
      path: '/api/route-graph/active',
      headers: adminHeaders,
      assertBody: (body) => {
        if (body.includes('"compiledRouterBundle"') || body.includes('"sourceGraph":{"nodes"')) {
          throw new Error('active route graph manifest hydrated full graph data');
        }
      },
    }),
    await runHttpCheck({
      baseUrl,
      label: 'route-flow graph runtime',
      path: '/api/models/perf-group-0/route-flow',
      headers: adminHeaders,
      assertBody: (body) => {
        if (!body.includes('"success":true') || !body.includes('"compiledRuntime"')) {
          throw new Error(`route-flow did not return a compiled runtime: ${body.slice(0, 500)}`);
        }
      },
    }),
    await runHttpCheck({
      baseUrl,
      label: 'proxy model list',
      path: '/v1/models',
      headers: proxyHeaders,
      assertBody: (body) => {
        if (!body.includes('perf-group-0')) {
          throw new Error('proxy model list did not expose seeded compiled runtime models');
        }
      },
    }),
  ];
}

async function seedStartupDatabase(): Promise<number> {
  configureRouteRuntimeDataDir(dataDir);
  const started = performance.now();
  await migrateRouteRuntimeDatabase();
  const dbModule: DbModule & { closeDbConnections: () => Promise<void> } = await import('../../src/server/db/index.js');
  const seeded = await seedRouteRuntimeFixture({
    dbModule,
    groupCount,
    insertChunkSize,
  });
  const { ROUTE_RUNTIME_STORAGE_ARTIFACT_BYTE_LIMIT } = await import('../../src/server/services/routeRuntimeArtifactService.js');
  await publishSeededRouteRuntimeFixture(seeded, 'route-startup-memory-gate');

  const activePointer = await dbModule.db.select()
    .from(dbModule.schema.routeGraphActiveVersion)
    .where(eq(dbModule.schema.routeGraphActiveVersion.id, 1))
    .get();
  if (!activePointer) throw new Error('startup memory gate did not publish an active route graph');
  const activeVersion = await dbModule.db.select()
    .from(dbModule.schema.routeGraphVersions)
    .where(eq(dbModule.schema.routeGraphVersions.id, activePointer.versionId))
    .get();
  if (!activeVersion) throw new Error('startup memory gate active Source Graph version is missing');
  const runtimePointer = await dbModule.db.select()
    .from(dbModule.schema.compiledRuntimeActiveArtifact)
    .where(eq(dbModule.schema.compiledRuntimeActiveArtifact.id, 1))
    .get();
  if (!runtimePointer) throw new Error('startup memory gate has no active compiled runtime artifact');
  const runtimeArtifact = await dbModule.db.select()
    .from(dbModule.schema.compiledRuntimeArtifacts)
    .where(eq(dbModule.schema.compiledRuntimeArtifacts.id, runtimePointer.artifactId))
    .get();
  if (!runtimeArtifact) throw new Error('startup memory gate active compiled runtime artifact is missing');

  let compiledArtifact: Record<string, unknown>;
  try {
    const parsed = JSON.parse(runtimeArtifact.artifactJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    compiledArtifact = parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`startup memory gate could not parse the active compiled runtime artifact: ${error instanceof Error ? error.message : String(error)}`);
  }
  const baseArtifactBytes = Buffer.byteLength(JSON.stringify({ ...compiledArtifact, startupMemoryPadding: '' }), 'utf8');
  const requestedPaddingBytes = compiledGraphPaddingMiB * 1024 * 1024;
  const artifactLimitBytes = Math.max(0, ROUTE_RUNTIME_STORAGE_ARTIFACT_BYTE_LIMIT - baseArtifactBytes - 1_024);
  // JSON parsing temporarily retains both the source bytes and the decoded
  // string. Keep the synthetic payload below a fifth of the child heap so the
  // gate tests startup behavior rather than forcing a V8 allocation failure.
  const heapSafePaddingBytes = Math.floor(childHeapMiB * 1024 * 1024 * 0.2);
  const paddingBytes = Math.min(requestedPaddingBytes, artifactLimitBytes, heapSafePaddingBytes);
  effectiveCompiledGraphPaddingMiB = paddingBytes / (1024 * 1024);
  await dbModule.db.update(dbModule.schema.compiledRuntimeArtifacts)
    .set({
      artifactJson: JSON.stringify({
        ...compiledArtifact,
        startupMemoryPadding: 'x'.repeat(paddingBytes),
      }),
    })
    .where(eq(dbModule.schema.compiledRuntimeArtifacts.id, runtimeArtifact.id))
    .run();
  await dbModule.closeDbConnections();
  return round(performance.now() - started, 1);
}

async function main(): Promise<void> {
  mkdirSync(reportDir, { recursive: true });
  const setupStart = memory();
  const seedMs = await seedStartupDatabase();
  const seedEnd = memory();
  const port = await allocateFreePort();
  const child = spawn(process.execPath, [
    `--max-old-space-size=${childHeapMiB}`,
    '--import',
    'tsx',
    'src/server/index.ts',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      DB_TYPE: 'sqlite',
      DB_URL: '',
      HOST: '127.0.0.1',
      PORT: String(port),
      AUTH_TOKEN: 'startup-memory-admin',
      PROXY_TOKEN: 'startup-memory-proxy',
      WEBHOOK_ENABLED: 'false',
      BARK_ENABLED: 'false',
      SERVERCHAN_ENABLED: 'false',
      TELEGRAM_ENABLED: 'false',
      SMTP_ENABLED: 'false',
      MODEL_AVAILABILITY_PROBE_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const childReady = await waitForServerReady(child);
  let childExit: { exitCode: number | null; signal: NodeJS.Signals | null } = {
    exitCode: null,
    signal: null,
  };
  let httpChecks: HttpCheckResult[] = [];
  let childRssMiB: number | null = null;
  try {
    httpChecks = await runHttpChecks(`http://127.0.0.1:${port}`);
    childRssMiB = readProcessRssMiB(child.pid);
    if (childRssMiB !== null && childRssMiB > childRssLimitMiB) {
      throw new Error(`server startup memory gate exceeded child RSS budget: ${childRssMiB} MiB > ${childRssLimitMiB} MiB`);
    }
  } finally {
    if (!child.killed) child.kill('SIGTERM');
    childExit = await childReady.waitForExit();
  }
  const final = memory();
  const report: StartupMemoryReport = {
    generatedAt: new Date().toISOString(),
    status: 'passed',
    config: {
      dataDir,
      groupCount,
      insertChunkSize,
      compiledGraphPaddingMiB,
      effectiveCompiledGraphPaddingMiB: round(effectiveCompiledGraphPaddingMiB),
      childHeapMiB,
      childRssLimitMiB,
      timeoutMs,
      parentHeapLimitMiB: heapLimitMiB(),
    },
    timings: {
      seedMs,
      childStartupMs: childReady.startupMs,
    },
    httpChecks,
    memory: {
      setupStart,
      seedEnd,
      final,
      parentDelta: memoryDelta(final, setupStart),
    },
    child: {
      exitCode: childExit.exitCode,
      signal: childExit.signal,
      rssMiB: childRssMiB,
      stdoutTail: tail(childReady.getStdout()),
      stderrTail: tail(childReady.getStderr()),
    },
  };

  writeFileSync(
    join(reportDir, 'route-startup-memory-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(
    join(reportDir, 'route-startup-memory-report.md'),
    [
      '# Route Startup Memory Gate',
      '',
      `Status: ${report.status}`,
      '',
      '| Metric | Value |',
      '| --- | ---: |',
      `| Route groups | ${groupCount} |`,
      `| Persisted compiled graph padding MiB | ${compiledGraphPaddingMiB} |`,
      `| Child heap cap MiB | ${childHeapMiB} |`,
      `| Child RSS MiB | ${childRssMiB == null ? 'unavailable' : childRssMiB.toFixed(1)} |`,
      `| Child RSS limit MiB | ${childRssLimitMiB} |`,
      `| Seed ms | ${seedMs} |`,
      `| Child startup ms | ${childReady.startupMs} |`,
      `| Parent RSS delta MiB | ${report.memory.parentDelta.rssMiB.toFixed(1)} |`,
      `| Parent heap delta MiB | ${report.memory.parentDelta.heapUsedMiB.toFixed(1)} |`,
      '',
      '## HTTP Checks',
      '',
      '| Check | Status | Bytes | Elapsed ms |',
      '| --- | ---: | ---: | ---: |',
      ...httpChecks.map((check) => `| ${check.label} | ${check.status} | ${check.responseBytes} | ${check.elapsedMs.toFixed(1)} |`),
      '',
    ].join('\n'),
  );

  console.log(JSON.stringify({
    type: 'startup-memory-summary',
    status: report.status,
    routeGroups: groupCount,
    compiledGraphPaddingMiB,
    childHeapMiB,
    childStartupMs: childReady.startupMs,
    childRssMiB,
    httpChecks,
    reportDir,
  }));
}

const currentScript = process.argv[1] || '';
if (currentScript.endsWith('route-startup-memory-gate.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
