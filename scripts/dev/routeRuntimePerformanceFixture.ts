import { mkdtempSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import {
  buildCandidateSelectorMacro,
  type RouteGraphSource,
} from '../../src/shared/routeGraph.js';
import { createManagedRouteGraphElementId } from '../../src/shared/routingIdentity.js';

export type DbModule = typeof import('../../src/server/db/index.js');

export type MemorySnapshot = {
  rssMiB: number;
  heapUsedMiB: number;
  heapTotalMiB: number;
  externalMiB: number;
};

export type SeededRouteRuntimeEndpointRoute = {
  publicModelName: string;
  upstreamModelName: string;
  executionTargetId: number;
  routeEndpointId: string;
};

export type SeededRouteRuntimeFixture = {
  accountId: number;
  tokenId: number;
  sourceEndpointRoutes: SeededRouteRuntimeEndpointRoute[];
  sourceGraph: RouteGraphSource;
};

export type ComplexActiveRouteGraphFixture = {
  versionId: number;
  version: number;
  groupCount: number;
  fallbackStageCount: number;
  endpointsPerFallbackStage: number;
  firstModel: string;
  lastModel: string;
  overlayModel: string;
  overlayDisabledExecutionTargetId: number;
  sourceGraphBytes: number;
  compiledGraphBytes: number;
  compiledRouterBundleBytes: number;
};

export function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Math.trunc(Number(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readPositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveReportDir(input: string): string {
  const trimmed = input.trim() || 'test-results/performance';
  return isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
}

export function createRouteRuntimeDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'metapi-route-runtime-perf-'));
}

export function configureRouteRuntimeDataDir(dataDir: string): void {
  process.env.DATA_DIR = dataDir;
  process.env.DB_TYPE = 'sqlite';
  delete process.env.DB_URL;
}

export async function migrateRouteRuntimeDatabase(): Promise<void> {
  const migrationModule = await import('../../src/server/db/migrate.js');
  await migrationModule.runSqliteMigrations();
}

export function gc(): void {
  if (typeof global.gc === 'function') global.gc();
}

export function memory(): MemorySnapshot {
  gc();
  const usage = process.memoryUsage();
  return {
    rssMiB: usage.rss / 1024 / 1024,
    heapUsedMiB: usage.heapUsed / 1024 / 1024,
    heapTotalMiB: usage.heapTotal / 1024 / 1024,
    externalMiB: usage.external / 1024 / 1024,
  };
}

export function round(value: number, fractionDigits = 2): number {
  return Number(value.toFixed(fractionDigits));
}

export function memoryDelta(after: MemorySnapshot, before: MemorySnapshot): MemorySnapshot {
  return {
    rssMiB: round(after.rssMiB - before.rssMiB, 1),
    heapUsedMiB: round(after.heapUsedMiB - before.heapUsedMiB, 1),
    heapTotalMiB: round(after.heapTotalMiB - before.heapTotalMiB, 1),
    externalMiB: round(after.externalMiB - before.externalMiB, 1),
  };
}

export function cpuUsageMs(usage: NodeJS.CpuUsage): number {
  return (usage.user + usage.system) / 1000;
}

export function heapLimitMiB(): number | null {
  const arg = process.execArgv.find((item) => item.startsWith('--max-old-space-size='));
  if (!arg) return null;
  const value = Number(arg.slice('--max-old-space-size='.length));
  return Number.isFinite(value) ? value : null;
}

async function insertReturningChunks<T, R>(
  rows: T[],
  chunkSize: number,
  insert: (chunk: T[]) => Promise<R[]>,
): Promise<R[]> {
  const inserted: R[] = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    inserted.push(...await insert(rows.slice(index, index + chunkSize)));
  }
  return inserted;
}

export function complexRouteGraphModelName(index: number): string {
  return `perf-complex-group-${index}`;
}

function sourceEndpointRouteModelName(index: number): string {
  return `perf-source-${index}`;
}

function normalizeComplexGraphCount(input: {
  requestedGroupCount: number;
  sourceEndpointRouteCount: number;
  fallbackStageCount: number;
  endpointsPerFallbackStage: number;
}): number {
  const minimumSourceEndpointRoutes = input.fallbackStageCount * input.endpointsPerFallbackStage;
  if (input.sourceEndpointRouteCount < minimumSourceEndpointRoutes) {
    throw new Error(
      `complex route graph fixture needs at least ${minimumSourceEndpointRoutes} source endpoint routes, got ${input.sourceEndpointRouteCount}`,
    );
  }
  return Math.max(1, Math.min(input.requestedGroupCount, input.sourceEndpointRouteCount));
}

export function buildComplexRouteGraphSourceFixture(input: {
  sourceEndpointRoutes: SeededRouteRuntimeEndpointRoute[];
  accountId: number;
  tokenId: number;
  groupCount: number;
  fallbackStageCount: number;
  endpointsPerFallbackStage: number;
}): RouteGraphSource {
  const fallbackStageCount = Math.max(1, Math.trunc(input.fallbackStageCount));
  const endpointsPerFallbackStage = Math.max(1, Math.trunc(input.endpointsPerFallbackStage));
  const groupCount = normalizeComplexGraphCount({
    requestedGroupCount: input.groupCount,
    sourceEndpointRouteCount: input.sourceEndpointRoutes.length,
    fallbackStageCount,
    endpointsPerFallbackStage,
  });
  const sourceEndpointRoutes = input.sourceEndpointRoutes.slice(
    0,
    Math.min(input.sourceEndpointRoutes.length, groupCount + (fallbackStageCount * endpointsPerFallbackStage)),
  );
  const source: RouteGraphSource = {
    nodes: sourceEndpointRoutes.map((route, index) => {
      const modelName = route.upstreamModelName || sourceEndpointRouteModelName(index);
      return {
        id: route.routeEndpointId,
        type: 'route_endpoint',
        name: modelName,
        enabled: true,
        ownership: 'manual',
        endpointKind: 'supply',
        exposure: 'none',
        resolutionStatus: 'resolved',
        ownerKind: 'manual',
        sourceKind: 'upstream_model',
        routeEndpointId: route.routeEndpointId,
        backend: { kind: 'supply' },
        match: {
          kind: 'model',
          requestedModelPattern: modelName,
          displayName: modelName,
        },
        metadata: {
          upstreamModel: modelName,
          normalizedModel: modelName.toLowerCase(),
          suppliedModels: [modelName],
        },
        config: {
          targets: [{
            targetId: createManagedRouteGraphElementId('target', randomUUID()),
            model: modelName,
            weight: 10,
            transportBinding: {
              kind: 'execution_target',
              executionTargetId: route.executionTargetId,
            },
          }],
          targetSelection: { kind: 'inherit_default' },
        },
        provenance: { source: 'route_runtime_performance_fixture' },
      };
    }),
    edges: [],
    macros: [],
  };
  source.macros = Array.from({ length: groupCount }, (_, groupIndex) => {
    const modelName = complexRouteGraphModelName(groupIndex);
    return buildCandidateSelectorMacro({
      stableId: `perf-complex:${groupIndex}`,
      displayName: modelName,
      enabled: true,
      ownership: 'manual',
      match: {
        kind: 'model',
        requestedModelPattern: modelName,
        displayName: modelName,
      },
      policy: { kind: 'builtin', builtin: 'weighted' },
      filters: {
        operations: [
          {
            type: 'rewrite_model',
            source: 'current_model',
            operation: 'strip_suffix',
            suffix: '-debug',
          },
          {
            type: 'set_payload',
            path: 'metadata.route_plan',
            value: modelName,
            mode: 'default',
          },
        ],
      },
      fallbackStages: Array.from({ length: fallbackStageCount }, (_, stageIndex) => ({
        id: `fallback-stage-${stageIndex}`,
        label: `Fallback stage ${stageIndex + 1}`,
        enabled: true,
        policy: { kind: 'builtin', builtin: 'weighted' },
        members: Array.from({ length: endpointsPerFallbackStage }, (_, endpointIndex) => {
          const routeIndex = (groupIndex + (stageIndex * endpointsPerFallbackStage) + endpointIndex) % sourceEndpointRoutes.length;
          return {
            endpointId: sourceEndpointRoutes[routeIndex]!.routeEndpointId,
            weight: Math.max(1, 10 - stageIndex),
          };
        }),
      })),
    });
  });
  return source;
}

export async function seedRouteRuntimeFixture(input: {
  dbModule: DbModule;
  groupCount: number;
  insertChunkSize: number;
}): Promise<SeededRouteRuntimeFixture> {
  const { db, schema } = input.dbModule;
  const site = await db.insert(schema.sites).values({
    name: 'perf-site',
    url: 'https://perf.example.com',
    platform: 'openai',
    status: 'active',
  }).returning().get();
  const account = await db.insert(schema.accounts).values({
    siteId: site.id,
    username: 'perf-account',
    accessToken: 'perf-access',
    apiToken: 'perf-api',
    status: 'active',
  }).returning().get();
  const token = await db.insert(schema.accountTokens).values({
    accountId: account.id,
    name: 'perf-token',
    token: 'sk-perf-token',
    valueStatus: 'ready',
    enabled: true,
    isDefault: true,
  }).returning().get();

  const sourceSupplyEndpointInputs = Array.from({ length: input.groupCount }, (_, groupIndex) => {
    const modelName = `perf-source-${groupIndex}`;
    const executionKey = randomUUID();
    return {
      publicModelName: `perf-group-${groupIndex}`,
      modelName,
      executionKey,
      values: {
        executionKey,
        sourceRef: randomUUID(),
        siteId: site.id,
        accountId: account.id,
        tokenId: token.id,
        oauthRouteUnitId: null,
        credentialBindingId: null,
        endpointProfileId: null,
        upstreamModelName: modelName,
        normalizedModelName: modelName.toLowerCase(),
        enabled: true,
        discovered: false,
        source: 'route-runtime-performance-fixture',
        metadataJson: JSON.stringify({ source: 'route-runtime-performance-fixture' }),
      },
    };
  });
  const supplyEndpoints = await insertReturningChunks(
    sourceSupplyEndpointInputs.map((input) => input.values),
    input.insertChunkSize,
    async (chunk) => await db.insert(schema.runtimeExecutionTargets).values(chunk).returning().all(),
  );
  const executionTargetByKey = new Map(supplyEndpoints.map((endpoint) => [endpoint.executionKey, endpoint]));
  const sourceEndpointRoutes = sourceSupplyEndpointInputs.map((sourceInput) => {
    const executionTarget = executionTargetByKey.get(sourceInput.executionKey);
    if (!executionTarget) throw new Error(`Missing execution target for ${sourceInput.publicModelName}`);
    return {
      publicModelName: sourceInput.publicModelName,
      upstreamModelName: sourceInput.modelName,
      executionTargetId: executionTarget.id,
      routeEndpointId: createManagedRouteGraphElementId('endpoint', randomUUID()),
    };
  });
  const sourceGraph: RouteGraphSource = {
    nodes: sourceEndpointRoutes.map((route) => ({
      id: route.routeEndpointId,
      type: 'route_endpoint',
      name: route.upstreamModelName,
      enabled: true,
      ownership: 'manual',
      endpointKind: 'supply',
      exposure: 'none',
      resolutionStatus: 'resolved',
      ownerKind: 'manual',
      sourceKind: 'upstream_model',
      routeEndpointId: route.routeEndpointId,
      backend: { kind: 'supply' },
      match: {
        kind: 'model',
        requestedModelPattern: route.upstreamModelName,
        displayName: route.upstreamModelName,
      },
      metadata: {
        upstreamModel: route.upstreamModelName,
        normalizedModel: route.upstreamModelName.toLowerCase(),
      },
      config: {
        targets: [{
          targetId: createManagedRouteGraphElementId('target', randomUUID()),
          model: route.upstreamModelName,
          modelSource: 'fixed',
          enabled: true,
          transportBinding: {
            kind: 'execution_target',
            executionTargetId: route.executionTargetId,
          },
        }],
        targetSelection: { kind: 'builtin', builtin: 'stable_first' },
      },
      provenance: { source: 'route_runtime_performance_fixture' },
    })),
    edges: [],
    macros: sourceEndpointRoutes.map((route) => buildCandidateSelectorMacro({
      stableId: createManagedRouteGraphElementId('macro', randomUUID()),
      displayName: route.publicModelName,
      enabled: true,
      ownership: 'manual',
      match: {
        kind: 'model',
        requestedModelPattern: route.publicModelName,
        displayName: route.publicModelName,
      },
      policy: { kind: 'builtin', builtin: 'weighted' },
      fallbackStages: [{
        id: createManagedRouteGraphElementId('stage', randomUUID()),
        label: 'Default',
        enabled: true,
        policy: { kind: 'builtin', builtin: 'weighted' },
        members: [{ endpointId: route.routeEndpointId, weight: 10 }],
      }],
    })),
  };
  return {
    accountId: account.id,
    tokenId: token.id,
    sourceEndpointRoutes,
    sourceGraph,
  };
}

export async function publishSeededRouteRuntimeFixture(
  seeded: SeededRouteRuntimeFixture,
  createdBy: string,
): Promise<void> {
  const { publishRouteGraphSource } = await import('../../src/server/services/routeGraphService.js');
  const published = await publishRouteGraphSource({ sourceGraph: seeded.sourceGraph, createdBy });
  if (!published.ok) {
    throw new Error(`seeded route graph fixture did not compile: ${published.diagnostics.map((item) => item.message).join('; ')}`);
  }
}

export async function publishComplexActiveRouteGraphFixture(input: {
  dbModule: DbModule;
  seeded: SeededRouteRuntimeFixture;
  groupCount: number;
  fallbackStageCount: number;
  endpointsPerFallbackStage: number;
}): Promise<ComplexActiveRouteGraphFixture> {
  const fallbackStageCount = Math.max(1, Math.trunc(input.fallbackStageCount));
  const endpointsPerFallbackStage = Math.max(1, Math.trunc(input.endpointsPerFallbackStage));
  const groupCount = normalizeComplexGraphCount({
    requestedGroupCount: input.groupCount,
    sourceEndpointRouteCount: input.seeded.sourceEndpointRoutes.length,
    fallbackStageCount,
    endpointsPerFallbackStage,
  });
  const sourceGraph = buildComplexRouteGraphSourceFixture({
    sourceEndpointRoutes: input.seeded.sourceEndpointRoutes,
    accountId: input.seeded.accountId,
    tokenId: input.seeded.tokenId,
    groupCount,
    fallbackStageCount,
    endpointsPerFallbackStage,
  });
  const { publishRouteGraphSource } = await import('../../src/server/services/routeGraphService.js');
  const published = await publishRouteGraphSource({
    sourceGraph,
    createdBy: 'route-runtime-performance-gate',
  });
  if (!published.ok) {
    throw new Error(`complex route graph fixture did not compile: ${published.diagnostics.map((item) => item.message).join('; ')}`);
  }
  const sourceGraphJson = JSON.stringify(published.version.sourceGraph);
  const { buildRouteRuntimeStorageArtifact } = await import('../../src/server/services/routeRuntimeArtifactService.js');
  const compiledGraphJson = JSON.stringify(buildRouteRuntimeStorageArtifact(published.version.compiledGraph));

  return {
    versionId: published.version.id,
    version: published.version.version,
    groupCount,
    fallbackStageCount,
    endpointsPerFallbackStage,
    firstModel: complexRouteGraphModelName(0),
    lastModel: complexRouteGraphModelName(groupCount - 1),
    overlayModel: complexRouteGraphModelName(0),
    overlayDisabledExecutionTargetId: input.seeded.sourceEndpointRoutes[0]?.executionTargetId || 0,
    sourceGraphBytes: Buffer.byteLength(sourceGraphJson, 'utf8'),
    compiledGraphBytes: Buffer.byteLength(compiledGraphJson, 'utf8'),
    compiledRouterBundleBytes: Buffer.byteLength(JSON.stringify(published.version.compiledGraph.compiledRouterBundle || {}), 'utf8'),
  };
}
