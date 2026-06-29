import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export type DbModule = typeof import('../../src/server/db/index.js');

export type MemorySnapshot = {
  rssMiB: number;
  heapUsedMiB: number;
  heapTotalMiB: number;
  externalMiB: number;
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

export async function seedRouteRuntimeFixture(input: {
  dbModule: DbModule;
  groupCount: number;
  insertChunkSize: number;
}): Promise<void> {
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

  await insertChunks(
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
    async (chunk) => {
      await db.insert(schema.routeEndpointTargets).values(chunk).run();
    },
  );
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
}
