import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

type MatrixEnv = Pick<NodeJS.ProcessEnv,
  | 'ROUTE_PERF_MATRIX_VCPUS'
  | 'ROUTE_PERF_MATRIX_WORKERS'
  | 'ROUTE_PERF_MATRIX_REPEATS'
  | 'ROUTE_PERF_MATRIX_INCLUDE_UNRESTRICTED'
  | 'ROUTE_PERF_MATRIX_REPORT_DIR'
  | 'ROUTE_PERF_DISTINCT_BARRIER_TIMEOUT_MS'
>;

type CpuProfile = {
  label: string;
  vcpus: number | null;
  cpuSet: string | null;
  usesTaskset: boolean;
};

type MatrixConfig = {
  cpuProfiles: CpuProfile[];
  workerCounts: number[];
  repeats: number;
  reportDir: string;
  tasksetAvailable: boolean;
};

type GateMeasurement = {
  label: string;
  operations: number;
  elapsedMs: number;
  cpuMs: number;
  elapsedQps: number;
  cpuQps: number;
  avgCpuMs: number;
};

type GateCounterDelta = {
  label: string;
  routeCacheLoadCount: number;
  routeMatchLoadCount: number;
  routeMatchBatchLoadCount: number;
  routeModelCandidateLoadCount: number;
  routeModelCandidateBatchLoadCount: number;
};

type GateReport = {
  status: 'passed' | 'failed';
  config: {
    groupCount: number;
    distinctConcurrentSamples: number;
    distinctConcurrentWidth: number;
  };
  measurements: GateMeasurement[];
  runtimeCounterDeltas?: GateCounterDelta[];
};

type WorkerResult = {
  workerId: number;
  exitCode: number | null;
  reportPath: string;
  logPath: string;
  report: GateReport;
  distinctMeasurement: GateMeasurement;
  distinctCounterDelta: GateCounterDelta | null;
};

type ScenarioResult = {
  label: string;
  cpuProfile: CpuProfile;
  workerCount: number;
  repeat: number;
  wallMs: number;
  workerResults: WorkerResult[];
  aggregate: {
    operations: number;
    maxMeasuredElapsedMs: number;
    sumMeasuredCpuMs: number;
    measuredElapsedQps: number;
    cpuQps: number;
    endToEndElapsedQps: number;
    workerCpuQpsMin: number;
    workerCpuQpsMedian: number;
    workerCpuQpsP95: number;
    workerCpuQpsMax: number;
  };
};

type MatrixReport = {
  generatedAt: string;
  config: MatrixConfig;
  scenarios: ScenarioResult[];
};

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(currentFile), '../..');
const gateScript = resolve(repoRoot, 'scripts/dev/route-runtime-performance-gate.ts');
const defaultReportDir = resolve(repoRoot, 'test-results/performance/matrix');

export function parsePositiveIntegerList(input: string | undefined, fallback: number[]): number[] {
  if (!input?.trim()) return fallback;
  const values = input
    .split(',')
    .map((item) => Math.trunc(Number(item.trim())))
    .filter((value) => Number.isFinite(value) && value > 0);
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

export function normalizeCpuProfiles(input: {
  requestedVcpus: number[];
  availableCpuCount: number;
  tasksetAvailable: boolean;
  includeUnrestricted: boolean;
}): CpuProfile[] {
  const cpuCount = Math.max(1, input.availableCpuCount);
  const profiles: CpuProfile[] = [];

  if (input.tasksetAvailable) {
    for (const requested of input.requestedVcpus) {
      const vcpus = Math.min(Math.max(1, requested), cpuCount);
      if (profiles.some((profile) => profile.vcpus === vcpus)) continue;
      profiles.push({
        label: `vcpu-${vcpus}`,
        vcpus,
        cpuSet: vcpus === 1 ? '0' : `0-${vcpus - 1}`,
        usesTaskset: true,
      });
    }
  }

  if (input.includeUnrestricted || profiles.length === 0) {
    profiles.push({
      label: 'unrestricted',
      vcpus: null,
      cpuSet: null,
      usesTaskset: false,
    });
  }

  return profiles;
}

export function summarizeMeasurements(measurements: GateMeasurement[]): ScenarioResult['aggregate'] {
  const operations = measurements.reduce((sum, measurement) => sum + measurement.operations, 0);
  const maxMeasuredElapsedMs = Math.max(...measurements.map((measurement) => measurement.elapsedMs));
  const sumMeasuredCpuMs = measurements.reduce((sum, measurement) => sum + measurement.cpuMs, 0);
  const workerCpuQps = measurements.map((measurement) => measurement.cpuQps).sort((left, right) => left - right);
  return {
    operations,
    maxMeasuredElapsedMs,
    sumMeasuredCpuMs,
    measuredElapsedQps: round(operations / Math.max(maxMeasuredElapsedMs / 1000, 0.001)),
    cpuQps: round(operations / Math.max(sumMeasuredCpuMs / 1000, 0.001)),
    endToEndElapsedQps: 0,
    workerCpuQpsMin: round(workerCpuQps[0] || 0),
    workerCpuQpsMedian: round(percentile(workerCpuQps, 0.5)),
    workerCpuQpsP95: round(percentile(workerCpuQps, 0.95)),
    workerCpuQpsMax: round(workerCpuQps[workerCpuQps.length - 1] || 0),
  };
}

export function shouldAcceptWorkerReport(exitCode: number | null, report: { status: 'passed' | 'failed' }): boolean {
  return exitCode === 0 || (exitCode !== null && report.status === 'failed');
}

function detectTaskset(): boolean {
  const result = spawnSync('taskset', ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

function readAvailableCpuCount(): number {
  try {
    return Math.max(1, availableParallelism());
  } catch {
    return Math.max(1, cpus().length);
  }
}

function buildMatrixConfig(env: MatrixEnv = process.env): MatrixConfig {
  const tasksetAvailable = detectTaskset();
  const availableCpuCount = readAvailableCpuCount();
  const requestedVcpus = parsePositiveIntegerList(env.ROUTE_PERF_MATRIX_VCPUS, [1, 2, 4]);
  const workerCounts = parsePositiveIntegerList(env.ROUTE_PERF_MATRIX_WORKERS, [1, 2, 4]);
  const includeUnrestricted = /^(1|true|yes|on)$/i.test(env.ROUTE_PERF_MATRIX_INCLUDE_UNRESTRICTED || '');
  return {
    cpuProfiles: normalizeCpuProfiles({
      requestedVcpus,
      availableCpuCount,
      tasksetAvailable,
      includeUnrestricted,
    }),
    workerCounts,
    repeats: parsePositiveIntegerList(env.ROUTE_PERF_MATRIX_REPEATS, [1])[0] || 1,
    reportDir: resolve(env.ROUTE_PERF_MATRIX_REPORT_DIR || defaultReportDir),
    tasksetAvailable,
  };
}

function round(value: number, fractionDigits = 2): number {
  return Number(value.toFixed(fractionDigits));
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * fraction) - 1));
  return sortedValues[index] || 0;
}

function isDirectRun(): boolean {
  return process.argv[1] ? resolve(process.argv[1]) === currentFile : false;
}

function buildWorkerCommand(profile: CpuProfile): { command: string; args: string[] } {
  const nodeArgs = [
    '--expose-gc',
    '--max-old-space-size=384',
    '--import',
    'tsx',
    gateScript,
  ];
  if (profile.usesTaskset && profile.cpuSet) {
    return {
      command: 'taskset',
      args: ['-c', profile.cpuSet, process.execPath, ...nodeArgs],
    };
  }
  return {
    command: process.execPath,
    args: nodeArgs,
  };
}

function findDistinctMeasurement(report: GateReport): GateMeasurement {
  const measurement = report.measurements.find((entry) => entry.label.startsWith('concurrent distinct cold models'));
  if (!measurement) throw new Error('worker report is missing distinct concurrent measurement');
  return measurement;
}

function findDistinctCounter(report: GateReport): GateCounterDelta | null {
  return report.runtimeCounterDeltas?.find((entry) => entry.label.startsWith('concurrent distinct cold models')) || null;
}

function waitForBarrierReady(input: {
  barrierDir: string;
  workerCount: number;
  workers: Array<{ child: ChildProcessWithoutNullStreams | null; workerId: number; exited: boolean; exitCode: number | null }>;
  timeoutMs: number;
}): Promise<void> {
  const startFile = join(input.barrierDir, 'start');
  const deadline = Date.now() + input.timeoutMs;
  return new Promise((resolveWait, rejectWait) => {
    const timer = setInterval(() => {
      const failedWorker = input.workers.find((worker) => worker.exited && worker.exitCode !== 0);
      if (failedWorker) {
        clearInterval(timer);
        rejectWait(new Error(`worker ${failedWorker.workerId} exited before the distinct benchmark barrier`));
        return;
      }
      const readyCount = existsSync(input.barrierDir)
        ? readdirSync(input.barrierDir).filter((entry) => entry.startsWith('ready-')).length
        : 0;
      if (readyCount >= input.workerCount) {
        writeFileSync(startFile, `${Date.now()}\n`, 'utf8');
        clearInterval(timer);
        resolveWait();
        return;
      }
      if (Date.now() > deadline) {
        clearInterval(timer);
        rejectWait(new Error(`timed out waiting for ${input.workerCount} workers at ${input.barrierDir}`));
      }
    }, 25);
  });
}

async function runWorker(input: {
  workerId: number;
  profile: CpuProfile;
  scenarioDir: string;
  barrierDir: string;
  timeoutMs: number;
  state: { child: ChildProcessWithoutNullStreams | null; workerId: number; exited: boolean; exitCode: number | null };
}): Promise<WorkerResult> {
  const workerDir = join(input.scenarioDir, `worker-${input.workerId}`);
  mkdirSync(workerDir, { recursive: true });
  const command = buildWorkerCommand(input.profile);
  const env = {
    ...process.env,
    ROUTE_PERF_REPORT_DIR: workerDir,
    ROUTE_PERF_DISTINCT_BARRIER_DIR: input.barrierDir,
    ROUTE_PERF_DISTINCT_BARRIER_ID: String(input.workerId),
    ROUTE_PERF_DISTINCT_BARRIER_TIMEOUT_MS: String(input.timeoutMs),
  };
  const child = spawn(command.command, command.args, {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  input.state.child = child;

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += String(chunk);
  });

  const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
    child.on('error', rejectExit);
    child.on('exit', (code) => {
      input.state.exited = true;
      input.state.exitCode = code;
      resolveExit(code);
    });
  });

  const logPath = join(workerDir, 'worker.log');
  writeFileSync(logPath, output, 'utf8');
  const reportPath = join(workerDir, 'route-runtime-performance-report.json');
  if (!existsSync(reportPath)) {
    throw new Error(`worker ${input.workerId} failed with code ${exitCode}; see ${logPath}`);
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as GateReport;
  if (!shouldAcceptWorkerReport(exitCode, report)) {
    throw new Error(`worker ${input.workerId} failed after writing a ${report.status} report with code ${exitCode}; see ${logPath}`);
  }
  const distinctMeasurement = findDistinctMeasurement(report);
  return {
    workerId: input.workerId,
    exitCode,
    reportPath,
    logPath,
    report,
    distinctMeasurement,
    distinctCounterDelta: findDistinctCounter(report),
  };
}

async function runScenario(input: {
  profile: CpuProfile;
  workerCount: number;
  repeat: number;
  reportDir: string;
  timeoutMs: number;
}): Promise<ScenarioResult> {
  const label = `${input.profile.label}-workers-${input.workerCount}-run-${input.repeat}`;
  const scenarioDir = join(input.reportDir, label);
  const barrierDir = join(scenarioDir, 'barrier');
  rmSync(scenarioDir, { recursive: true, force: true });
  mkdirSync(barrierDir, { recursive: true });

  const states = Array.from({ length: input.workerCount }, (_, index) => ({
    child: null as ChildProcessWithoutNullStreams | null,
    workerId: index + 1,
    exited: false,
    exitCode: null as number | null,
  }));
  const started = performance.now();
  const workerPromises = states.map((state) => runWorker({
    workerId: state.workerId,
    profile: input.profile,
    scenarioDir,
    barrierDir,
    timeoutMs: input.timeoutMs,
    state,
  }));

  try {
    await waitForBarrierReady({
      barrierDir,
      workerCount: input.workerCount,
      workers: states,
      timeoutMs: input.timeoutMs,
    });
    const workerResults = await Promise.all(workerPromises);
    const wallMs = performance.now() - started;
    const aggregate = summarizeMeasurements(workerResults.map((result) => result.distinctMeasurement));
    aggregate.endToEndElapsedQps = round(aggregate.operations / Math.max(wallMs / 1000, 0.001));
    const result: ScenarioResult = {
      label,
      cpuProfile: input.profile,
      workerCount: input.workerCount,
      repeat: input.repeat,
      wallMs: round(wallMs),
      workerResults,
      aggregate,
    };
    console.log(JSON.stringify({
      type: 'matrix-scenario',
      label,
      cpuProfile: input.profile,
      workerCount: input.workerCount,
      repeat: input.repeat,
      wallMs: result.wallMs,
      aggregate,
    }));
    return result;
  } catch (error) {
    for (const state of states) {
      if (!state.exited) state.child?.kill('SIGTERM');
    }
    await Promise.allSettled(workerPromises);
    throw error;
  }
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function buildMarkdownReport(report: MatrixReport): string {
  const rows = report.scenarios.map((scenario) => [
    scenario.label,
    scenario.cpuProfile.cpuSet || 'unrestricted',
    String(scenario.workerCount),
    scenario.workerResults.every((worker) => worker.report.status === 'passed') ? 'passed' : 'failed',
    String(scenario.aggregate.operations),
    round(scenario.wallMs).toFixed(2),
    scenario.aggregate.measuredElapsedQps.toFixed(2),
    scenario.aggregate.cpuQps.toFixed(2),
    scenario.aggregate.endToEndElapsedQps.toFixed(2),
    scenario.aggregate.workerCpuQpsMin.toFixed(2),
    scenario.aggregate.workerCpuQpsMedian.toFixed(2),
    scenario.aggregate.workerCpuQpsP95.toFixed(2),
    scenario.aggregate.workerCpuQpsMax.toFixed(2),
  ]);
  return [
    '# Route Runtime Performance Matrix Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    markdownTable(
      ['Scenario', 'CPU set', 'Workers', 'Gate status', 'Ops', 'Wall ms', 'Measured elapsed QPS', 'CPU QPS', 'End-to-end QPS', 'Worker CPU QPS min', 'Worker CPU QPS median', 'Worker CPU QPS p95', 'Worker CPU QPS max'],
      rows,
    ),
    '',
    'Notes:',
    '',
    '- Worker count means independent Node processes running the route-runtime gate.',
    '- CPU set is enforced with `taskset` when available.',
    '- Measured elapsed QPS uses the synchronized distinct-concurrent window; end-to-end QPS includes setup and seeding.',
    '- CPU QPS is route-decision CPU throughput, not HTTP ingress throughput.',
    '- Gate status preserves each worker route-runtime gate result; failed benchmark budgets remain visible without aborting the matrix.',
    '',
  ].join('\n');
}

function writeMatrixReport(report: MatrixReport): void {
  mkdirSync(report.config.reportDir, { recursive: true });
  const jsonPath = join(report.config.reportDir, 'route-runtime-performance-matrix-report.json');
  const markdownPath = join(report.config.reportDir, 'route-runtime-performance-matrix-report.md');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, buildMarkdownReport(report), 'utf8');
  console.log(JSON.stringify({ type: 'matrix-report', format: 'json', path: jsonPath }));
  console.log(JSON.stringify({ type: 'matrix-report', format: 'markdown', path: markdownPath }));
}

async function main(): Promise<void> {
  const config = buildMatrixConfig();
  rmSync(config.reportDir, { recursive: true, force: true });
  mkdirSync(config.reportDir, { recursive: true });
  console.log(JSON.stringify({
    type: 'matrix-config',
    cpuProfiles: config.cpuProfiles,
    workerCounts: config.workerCounts,
    repeats: config.repeats,
    reportDir: config.reportDir,
    tasksetAvailable: config.tasksetAvailable,
  }));

  const scenarios: ScenarioResult[] = [];
  const timeoutMs = Math.max(1, Number(process.env.ROUTE_PERF_DISTINCT_BARRIER_TIMEOUT_MS || 120_000));
  for (let repeat = 1; repeat <= config.repeats; repeat += 1) {
    for (const cpuProfile of config.cpuProfiles) {
      for (const workerCount of config.workerCounts) {
        scenarios.push(await runScenario({
          profile: cpuProfile,
          workerCount,
          repeat,
          reportDir: config.reportDir,
          timeoutMs,
        }));
      }
    }
  }

  writeMatrixReport({
    generatedAt: new Date().toISOString(),
    config,
    scenarios,
  });
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
