import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  createRouteRuntimeDataDir,
  configureRouteRuntimeDataDir,
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

type StartupMemoryReport = {
  generatedAt: string;
  status: 'passed' | 'failed';
  config: {
    dataDir: string;
    groupCount: number;
    insertChunkSize: number;
    compiledGraphPaddingMiB: number;
    childHeapMiB: number;
    timeoutMs: number;
    parentHeapLimitMiB: number | null;
  };
  timings: {
    seedMs: number;
    childStartupMs: number;
  };
  memory: {
    setupStart: MemorySnapshot;
    seedEnd: MemorySnapshot;
    final: MemorySnapshot;
    parentDelta: MemorySnapshot;
  };
  child: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdoutTail: string;
    stderrTail: string;
  };
};

const reportDir = resolveReportDir(process.env.ROUTE_STARTUP_MEMORY_REPORT_DIR || 'test-results/performance/startup');
const dataDir = createRouteRuntimeDataDir();
const groupCount = readPositiveInteger('ROUTE_STARTUP_MEMORY_GROUPS', 1_000);
const insertChunkSize = readPositiveInteger('ROUTE_STARTUP_MEMORY_INSERT_CHUNK_SIZE', 250);
const compiledGraphPaddingMiB = readPositiveInteger('ROUTE_STARTUP_MEMORY_COMPILED_GRAPH_MIB', 128);
const childHeapMiB = readPositiveInteger('ROUTE_STARTUP_MEMORY_CHILD_HEAP_MIB', 256);
const timeoutMs = readPositiveInteger('ROUTE_STARTUP_MEMORY_TIMEOUT_MS', 20_000);

function tail(input: string, maxLength = 8_000): string {
  return input.length <= maxLength ? input : input.slice(input.length - maxLength);
}

function waitForServerReady(child: ChildProcessWithoutNullStreams): Promise<{
  startupMs: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}> {
  const started = performance.now();
  let stdout = '';
  let stderr = '';
  let settled = false;
  let readyStartupMs: number | null = null;

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
      if (readyStartupMs === null && stdout.includes('metapi running on')) {
        readyStartupMs = round(performance.now() - started, 1);
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', fail);
    child.once('exit', (exitCode, signal) => {
      if (readyStartupMs !== null) {
        finish({
          startupMs: readyStartupMs,
          stdout,
          stderr,
          exitCode,
          signal,
        });
        return;
      }
      fail(new Error(`server exited before startup completed (code=${exitCode ?? 'null'}, signal=${signal ?? 'null'})\nstdout:\n${tail(stdout)}\nstderr:\n${tail(stderr)}`));
    });
  });
}

async function seedStartupDatabase(): Promise<number> {
  configureRouteRuntimeDataDir(dataDir);
  const started = performance.now();
  await import('../../src/server/db/migrate.js');
  const dbModule: DbModule & { closeDbConnections: () => Promise<void> } = await import('../../src/server/db/index.js');
  await seedRouteRuntimeFixture({
    dbModule,
    groupCount,
    insertChunkSize,
  });

  const createdAt = new Date().toISOString();
  const sourceGraphJson = JSON.stringify({ version: 1, nodes: [], edges: [], macros: [] });
  const compiledGraphJson = JSON.stringify({
    version: 1,
    hash: 'startup-memory-gate',
    compiledRouterBundle: { version: 2, routes: [] },
    padding: 'x'.repeat(compiledGraphPaddingMiB * 1024 * 1024),
  });
  const version = await dbModule.db.insert(dbModule.schema.routeGraphVersions).values({
    version: 1,
    sourceGraphJson,
    compiledGraphJson,
    status: 'active',
    createdBy: 'startup-memory-gate',
    createdAt,
    activatedAt: createdAt,
  }).returning().get();
  await dbModule.db.insert(dbModule.schema.routeGraphActiveVersion).values({
    id: 1,
    versionId: version.id,
    updatedAt: createdAt,
  }).run();
  await dbModule.closeDbConnections();
  return round(performance.now() - started, 1);
}

async function main(): Promise<void> {
  mkdirSync(reportDir, { recursive: true });
  const setupStart = memory();
  const seedMs = await seedStartupDatabase();
  const seedEnd = memory();
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
      PORT: '0',
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

  const childResult = await waitForServerReady(child);
  const final = memory();
  const report: StartupMemoryReport = {
    generatedAt: new Date().toISOString(),
    status: 'passed',
    config: {
      dataDir,
      groupCount,
      insertChunkSize,
      compiledGraphPaddingMiB,
      childHeapMiB,
      timeoutMs,
      parentHeapLimitMiB: heapLimitMiB(),
    },
    timings: {
      seedMs,
      childStartupMs: childResult.startupMs,
    },
    memory: {
      setupStart,
      seedEnd,
      final,
      parentDelta: memoryDelta(final, setupStart),
    },
    child: {
      exitCode: childResult.exitCode,
      signal: childResult.signal,
      stdoutTail: tail(childResult.stdout),
      stderrTail: tail(childResult.stderr),
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
      `| Seed ms | ${seedMs} |`,
      `| Child startup ms | ${childResult.startupMs} |`,
      `| Parent RSS delta MiB | ${report.memory.parentDelta.rssMiB.toFixed(1)} |`,
      `| Parent heap delta MiB | ${report.memory.parentDelta.heapUsedMiB.toFixed(1)} |`,
      '',
    ].join('\n'),
  );

  console.log(JSON.stringify({
    type: 'startup-memory-summary',
    status: report.status,
    routeGroups: groupCount,
    compiledGraphPaddingMiB,
    childHeapMiB,
    childStartupMs: childResult.startupMs,
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
