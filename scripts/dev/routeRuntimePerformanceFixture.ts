import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import {
  buildRouteGraphSourceFromLegacyRoutes,
  compileRouteGraphSource,
  type RouteGraphSource,
} from '../../src/shared/routeGraph.js';

export type DbModule = typeof import('../../src/server/db/index.js');

export type MemorySnapshot = {
  rssMiB: number;
  heapUsedMiB: number;
  heapTotalMiB: number;
  externalMiB: number;
};

export type SeededRouteRuntimeRoute = {
  id: number;
  displayName: string;
  targetId: number;
};

export type SeededRouteRuntimeFixture = {
  accountId: number;
  tokenId: number;
  sourceRoutes: SeededRouteRuntimeRoute[];
};

export type ComplexActiveRouteGraphFixture = {
  versionId: number;
  version: number;
  groupCount: number;
  candidateGroupsPerModel: number;
  endpointsPerCandidateGroup: number;
  firstModel: string;
  lastModel: string;
  overlayModel: string;
  overlayDisabledTargetId: number;
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
  process.env.TOKEN_ROUTER_CACHE_TTL_MS = '600000';
  delete process.env.DB_URL;
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

async function insertChunks<T>(
  rows: T[],
  chunkSize: number,
  insert: (chunk: T[]) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < rows.length; index += chunkSize) {
    await insert(rows.slice(index, index + chunkSize));
  }
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

function sourceRouteModelName(index: number): string {
  return `perf-source-${index}`;
}

function normalizeComplexGraphCount(input: {
  requestedGroupCount: number;
  sourceRouteCount: number;
  candidateGroupsPerModel: number;
  endpointsPerCandidateGroup: number;
}): number {
  const minimumSourceRoutes = input.candidateGroupsPerModel * input.endpointsPerCandidateGroup;
  if (input.sourceRouteCount < minimumSourceRoutes) {
    throw new Error(
      `complex route graph fixture needs at least ${minimumSourceRoutes} source routes, got ${input.sourceRouteCount}`,
    );
  }
  return Math.max(1, Math.min(input.requestedGroupCount, input.sourceRouteCount));
}

export function buildComplexRouteGraphSourceFixture(input: {
  sourceRoutes: SeededRouteRuntimeRoute[];
  accountId: number;
  tokenId: number;
  groupCount: number;
  candidateGroupsPerModel: number;
  endpointsPerCandidateGroup: number;
}): RouteGraphSource {
  const candidateGroupsPerModel = Math.max(1, Math.trunc(input.candidateGroupsPerModel));
  const endpointsPerCandidateGroup = Math.max(1, Math.trunc(input.endpointsPerCandidateGroup));
  const groupCount = normalizeComplexGraphCount({
    requestedGroupCount: input.groupCount,
    sourceRouteCount: input.sourceRoutes.length,
    candidateGroupsPerModel,
    endpointsPerCandidateGroup,
  });
  const sourceRoutes = input.sourceRoutes.slice(
    0,
    Math.min(input.sourceRoutes.length, groupCount + (candidateGroupsPerModel * endpointsPerCandidateGroup)),
  );
  const legacyRoutes = sourceRoutes.map((route, index) => ({
    id: route.id,
    enabled: true,
    displayName: route.displayName || sourceRouteModelName(index),
    visibility: 'internal',
    ownership: 'manual',
    projectAsMacro: false,
    match: {
      kind: 'model',
      requestedModelPattern: route.displayName || sourceRouteModelName(index),
      displayName: route.displayName || sourceRouteModelName(index),
      routeId: route.id,
    },
    backend: { kind: 'supply' },
    targets: [{
      targetId: String(route.targetId),
      model: route.displayName || sourceRouteModelName(index),
      accountId: input.accountId,
      tokenId: input.tokenId,
      weight: 10,
    }],
  }));
  const source = buildRouteGraphSourceFromLegacyRoutes(legacyRoutes);
  source.macros = Array.from({ length: groupCount }, (_, groupIndex) => ({
    id: `perf-complex:${groupIndex}`,
    kind: 'candidate_selector',
    enabled: true,
    visibility: 'public',
    ownership: 'manual',
    config: {
      surface: {
        entry: {
          kind: 'external',
          visibility: 'public',
          match: { displayName: complexRouteGraphModelName(groupIndex) },
        },
        output: 'route',
      },
      policy: { strategy: 'priority_order' },
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
            path: 'metadata.route_group',
            value: complexRouteGraphModelName(groupIndex),
            mode: 'default',
          },
        ],
      },
      groups: Array.from({ length: candidateGroupsPerModel }, (_, priority) => ({
        id: `priority-${priority}`,
        enabled: true,
        priority,
        input: {
          kind: 'route_endpoints',
          endpointIds: Array.from({ length: endpointsPerCandidateGroup }, (_, endpointIndex) => {
            const routeIndex = (groupIndex + (priority * endpointsPerCandidateGroup) + endpointIndex) % sourceRoutes.length;
            return `route-endpoint:supply:route:${sourceRoutes[routeIndex]!.id}`;
          }),
        },
        defaults: {
          weight: Math.max(1, 10 - priority),
        },
      })),
    },
  }));
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

  const sourceRoutes = await insertReturningChunks(
    Array.from({ length: input.groupCount }, (_, groupIndex) => ({
      displayName: `perf-source-${groupIndex}`,
      routingStrategy: 'weighted',
      enabled: true,
    })),
    input.insertChunkSize,
    async (chunk) => await db.insert(schema.tokenRoutes).values(chunk).returning().all(),
  );
  const groupRoutes = await insertReturningChunks(
    Array.from({ length: input.groupCount }, (_, groupIndex) => ({
      displayName: `perf-group-${groupIndex}`,
      routingStrategy: 'weighted',
      enabled: true,
    })),
    input.insertChunkSize,
    async (chunk) => await db.insert(schema.tokenRoutes).values(chunk).returning().all(),
  );

  const sourceTargets = await insertReturningChunks(
    sourceRoutes.map((sourceRoute, groupIndex) => ({
      routeId: sourceRoute.id,
      accountId: account.id,
      tokenId: token.id,
      sourceModel: `perf-source-${groupIndex}`,
      priority: 0,
      weight: 10,
      enabled: true,
    })),
    input.insertChunkSize,
    async (chunk) => await db.insert(schema.routeEndpointTargets).values(chunk).returning().all(),
  );
  const targetIdByRouteId = new Map(sourceTargets.map((target) => [target.routeId, target.id]));
  await insertChunks(
    groupRoutes.map((groupRoute, groupIndex) => ({
      groupRouteId: groupRoute.id,
      sourceRouteId: sourceRoutes[groupIndex]?.id || 0,
    })),
    input.insertChunkSize,
    async (chunk) => {
      await db.insert(schema.routeGroupSources).values(chunk).run();
    },
  );
  return {
    accountId: account.id,
    tokenId: token.id,
    sourceRoutes: sourceRoutes.map((route, index) => ({
      id: route.id,
      displayName: route.displayName || sourceRouteModelName(index),
      targetId: targetIdByRouteId.get(route.id) || route.id,
    })),
  };
}

export async function publishComplexActiveRouteGraphFixture(input: {
  dbModule: DbModule;
  seeded: SeededRouteRuntimeFixture;
  groupCount: number;
  candidateGroupsPerModel: number;
  endpointsPerCandidateGroup: number;
}): Promise<ComplexActiveRouteGraphFixture> {
  const { db, schema } = input.dbModule;
  const candidateGroupsPerModel = Math.max(1, Math.trunc(input.candidateGroupsPerModel));
  const endpointsPerCandidateGroup = Math.max(1, Math.trunc(input.endpointsPerCandidateGroup));
  const groupCount = normalizeComplexGraphCount({
    requestedGroupCount: input.groupCount,
    sourceRouteCount: input.seeded.sourceRoutes.length,
    candidateGroupsPerModel,
    endpointsPerCandidateGroup,
  });
  const sourceGraph = buildComplexRouteGraphSourceFixture({
    sourceRoutes: input.seeded.sourceRoutes,
    accountId: input.seeded.accountId,
    tokenId: input.seeded.tokenId,
    groupCount,
    candidateGroupsPerModel,
    endpointsPerCandidateGroup,
  });
  const compiled = compileRouteGraphSource(sourceGraph, {
    includeLegacyBundles: false,
    includePrimitiveSource: false,
  });
  if (!compiled.ok) {
    throw new Error(`complex route graph fixture did not compile: ${compiled.diagnostics.map((item) => item.message).join('; ')}`);
  }

  const timestamp = new Date().toISOString();
  const versionRow = await db.select({ version: schema.routeGraphVersions.version })
    .from(schema.routeGraphVersions)
    .orderBy(schema.routeGraphVersions.version)
    .all();
  const version = Math.max(0, ...versionRow.map((row) => Number(row.version) || 0)) + 1;
  const sourceGraphJson = JSON.stringify(compiled.source);
  const compiledGraphJson = JSON.stringify(compiled.compiled);
  await db.update(schema.routeGraphVersions).set({ status: 'archived' }).run();
  const inserted = await db.insert(schema.routeGraphVersions).values({
    version,
    sourceGraphJson,
    compiledGraphJson,
    status: 'active',
    createdBy: 'route-runtime-performance-gate',
    createdAt: timestamp,
    activatedAt: timestamp,
  }).returning().get();
  await db.delete(schema.routeGraphActiveVersion).run();
  await db.insert(schema.routeGraphActiveVersion).values({
    id: 1,
    versionId: inserted.id,
    updatedAt: timestamp,
  }).run();
  const routeGraphService = await import('../../src/server/services/routeGraphService.js');
  routeGraphService.invalidateRouteGraphReadCaches();

  return {
    versionId: inserted.id,
    version,
    groupCount,
    candidateGroupsPerModel,
    endpointsPerCandidateGroup,
    firstModel: complexRouteGraphModelName(0),
    lastModel: complexRouteGraphModelName(groupCount - 1),
    overlayModel: complexRouteGraphModelName(0),
    overlayDisabledTargetId: input.seeded.sourceRoutes[0]?.targetId || 0,
    sourceGraphBytes: Buffer.byteLength(sourceGraphJson, 'utf8'),
    compiledGraphBytes: Buffer.byteLength(compiledGraphJson, 'utf8'),
    compiledRouterBundleBytes: Buffer.byteLength(JSON.stringify(compiled.compiled.compiledRouterBundle || {}), 'utf8'),
  };
}
