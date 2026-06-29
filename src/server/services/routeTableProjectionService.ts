import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  deriveLegacyModelPatternFromSpecs,
  deriveLegacyRouteModeFromBackendSpec,
  deriveLegacySourceRouteIdsFromBackendSpec,
  normalizeRouteGraphBackendSpec,
  normalizeRouteGraphMatchSpec,
  type RouteGraphBackendSpec,
  type RouteGraphMatchSpec,
  type RouteGraphVisibility,
} from '../../shared/routeGraph.js';

const ROUTE_PROJECTION_CHUNK_SIZE = 500;

export type RouteBindingProjection = {
  routeId: number;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  visibility: RouteGraphVisibility;
  modelPattern: string;
  routeMode: 'pattern' | 'explicit_group';
  sourceRouteIds: number[];
  updatedAt: string;
};

type RouteBindingProjectionInput = {
  routeId: number;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  visibility?: RouteGraphVisibility;
};

type RouteBindingProjectionRow = typeof schema.routeBindingProjections.$inferSelect;
type RouteBindingProjectionInsert = typeof schema.routeBindingProjections.$inferInsert;

export type EnabledRouteBindingProjectionMatch = {
  route: typeof schema.tokenRoutes.$inferSelect;
  projection: RouteBindingProjection;
};

function normalizeRouteIds(routeIdsInput: number[]): number[] {
  return Array.from(new Set(routeIdsInput
    .map((routeId) => Math.trunc(Number(routeId)))
    .filter((routeId) => Number.isFinite(routeId) && routeId > 0)));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonValue(raw: string | null | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseSourceRouteIds(raw: string | null | undefined): number[] {
  const parsed = parseJsonValue(raw);
  if (!Array.isArray(parsed)) return [];
  return normalizeRouteIds(parsed.map((value) => Number(value)));
}

function normalizeProjection(input: RouteBindingProjectionInput, updatedAt: string): RouteBindingProjection | null {
  const routeId = Math.trunc(Number(input.routeId));
  if (!Number.isFinite(routeId) || routeId <= 0) return null;

  const match = normalizeRouteGraphMatchSpec({
    ...input.match,
    routeId,
  });
  const backend = normalizeRouteGraphBackendSpec(input.backend);
  const routeMode = deriveLegacyRouteModeFromBackendSpec(backend) === 'explicit_group'
    ? 'explicit_group'
    : 'pattern';
  const sourceRouteIds = deriveLegacySourceRouteIdsFromBackendSpec(backend);
  return {
    routeId,
    match,
    backend,
    visibility: input.visibility === 'internal' ? 'internal' : 'public',
    modelPattern: deriveLegacyModelPatternFromSpecs(match, backend),
    routeMode,
    sourceRouteIds,
    updatedAt,
  };
}

export function hydrateRouteBindingProjection(row: RouteBindingProjectionRow): RouteBindingProjection {
  const match = normalizeRouteGraphMatchSpec(readRecord(parseJsonValue(row.matchJson)) || undefined);
  const backend = normalizeRouteGraphBackendSpec(readRecord(parseJsonValue(row.backendJson)) || undefined);
  const routeMode = row.routeMode === 'explicit_group'
    ? 'explicit_group'
    : (deriveLegacyRouteModeFromBackendSpec(backend) === 'explicit_group' ? 'explicit_group' : 'pattern');
  const sourceRouteIds = parseSourceRouteIds(row.sourceRouteIdsJson);
  const modelPattern = String(row.modelPattern || deriveLegacyModelPatternFromSpecs(match, backend) || '').trim();
  return {
    routeId: row.routeId,
    match,
    backend,
    visibility: row.visibility === 'internal' ? 'internal' : 'public',
    modelPattern,
    routeMode,
    sourceRouteIds: sourceRouteIds.length > 0 ? sourceRouteIds : deriveLegacySourceRouteIdsFromBackendSpec(backend),
    updatedAt: row.updatedAt || '',
  };
}

function projectionToRow(projection: RouteBindingProjection): RouteBindingProjectionInsert {
  return {
    routeId: projection.routeId,
    matchJson: JSON.stringify(projection.match),
    backendJson: JSON.stringify(projection.backend),
    visibility: projection.visibility,
    modelPattern: projection.modelPattern,
    routeMode: projection.routeMode,
    sourceRouteIdsJson: JSON.stringify(projection.sourceRouteIds),
    updatedAt: projection.updatedAt,
  };
}

async function countProjectionRows(): Promise<number> {
  const row = await db.select({ count: sql<number>`count(*)` })
    .from(schema.routeBindingProjections)
    .get();
  return Number(row?.count || 0);
}

async function insertProjectionRows(tx: typeof db, rows: RouteBindingProjectionInsert[]): Promise<void> {
  for (let index = 0; index < rows.length; index += ROUTE_PROJECTION_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + ROUTE_PROJECTION_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    await tx.insert(schema.routeBindingProjections).values(chunk).run();
  }
}

async function deleteProjectionRows(tx: typeof db, routeIds: number[]): Promise<void> {
  for (let index = 0; index < routeIds.length; index += ROUTE_PROJECTION_CHUNK_SIZE) {
    const chunk = routeIds.slice(index, index + ROUTE_PROJECTION_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    await tx.delete(schema.routeBindingProjections)
      .where(inArray(schema.routeBindingProjections.routeId, chunk))
      .run();
  }
}

export async function loadRouteBindingProjectionMap(): Promise<Map<number, RouteBindingProjection>> {
  const rows = await db.select().from(schema.routeBindingProjections).all();
  return new Map(rows.map((row) => [row.routeId, hydrateRouteBindingProjection(row)]));
}

export async function loadRouteBindingProjectionsForRouteIds(routeIdsInput: number[]): Promise<Map<number, RouteBindingProjection>> {
  const routeIds = normalizeRouteIds(routeIdsInput);
  if (routeIds.length === 0) return new Map();

  const projections = new Map<number, RouteBindingProjection>();
  for (let index = 0; index < routeIds.length; index += ROUTE_PROJECTION_CHUNK_SIZE) {
    const chunk = routeIds.slice(index, index + ROUTE_PROJECTION_CHUNK_SIZE);
    const rows = await db.select().from(schema.routeBindingProjections)
      .where(inArray(schema.routeBindingProjections.routeId, chunk))
      .all();
    for (const row of rows) {
      projections.set(row.routeId, hydrateRouteBindingProjection(row));
    }
  }
  return projections;
}

export async function loadEnabledRouteBindingProjectionsByModelPattern(
  modelPattern: string,
): Promise<EnabledRouteBindingProjectionMatch[]> {
  const normalizedPattern = modelPattern.trim();
  if (!normalizedPattern) return [];

  const rows = await db.select()
    .from(schema.routeBindingProjections)
    .innerJoin(schema.tokenRoutes, eq(schema.routeBindingProjections.routeId, schema.tokenRoutes.id))
    .where(and(
      eq(schema.routeBindingProjections.modelPattern, normalizedPattern),
      eq(schema.tokenRoutes.enabled, true),
    ))
    .all();

  return rows.map((row) => ({
    route: row.token_routes,
    projection: hydrateRouteBindingProjection(row.route_binding_projections),
  }));
}

export async function upsertRouteBindingProjections(input: RouteBindingProjectionInput[]): Promise<void> {
  if (input.length === 0) return;
  const updatedAt = new Date().toISOString();
  const projections = input
    .map((item) => normalizeProjection(item, updatedAt))
    .filter((item): item is RouteBindingProjection => !!item);
  if (projections.length === 0) return;

  const routeIds = projections.map((projection) => projection.routeId);
  const rows = projections.map(projectionToRow);
  await db.transaction(async (tx) => {
    await deleteProjectionRows(tx as typeof db, routeIds);
    await insertProjectionRows(tx as typeof db, rows);
  });
}

export async function deleteRouteBindingProjections(routeIdsInput: number[]): Promise<void> {
  const routeIds = normalizeRouteIds(routeIdsInput);
  if (routeIds.length === 0) return;
  await db.transaction(async (tx) => {
    await deleteProjectionRows(tx as typeof db, routeIds);
  });
}

function routeBindingProjectionFromRouteTable(input: {
  route: typeof schema.tokenRoutes.$inferSelect;
  existing: RouteBindingProjection | null;
  sourceRouteIds: number[];
  updatedAt: string;
}): RouteBindingProjection {
  const sourceRouteIds = normalizeRouteIds(input.sourceRouteIds);
  const displayName = input.route.displayName ?? input.existing?.match.displayName ?? null;
  const backend = normalizeRouteGraphBackendSpec(sourceRouteIds.length > 0
    ? { kind: 'routes', routeIds: sourceRouteIds }
    : { kind: 'supply' });
  const existingPattern = deriveLegacyModelPatternFromSpecs(input.existing?.match, input.existing?.backend);
  const modelPattern = backend.kind === 'routes'
    ? (displayName || existingPattern || '')
    : (input.existing?.match.requestedModelPattern || input.route.displayName || input.existing?.match.displayName || '');
  const match = normalizeRouteGraphMatchSpec({
    ...(input.existing?.match || {}),
    requestedModelPattern: backend.kind === 'routes' ? '' : modelPattern,
    displayName,
    routeId: input.route.id,
  });
  return normalizeProjection({
    routeId: input.route.id,
    match,
    backend,
    visibility: input.existing?.visibility ?? 'public',
  }, input.updatedAt) || {
    routeId: input.route.id,
    match,
    backend,
    visibility: input.existing?.visibility ?? 'public',
    modelPattern: deriveLegacyModelPatternFromSpecs(match, backend),
    routeMode: backend.kind === 'routes' ? 'explicit_group' : 'pattern',
    sourceRouteIds: backend.kind === 'routes' ? backend.routeIds : [],
    updatedAt: input.updatedAt,
  };
}

export async function syncRouteBindingProjectionsFromRouteTable(routeIdsInput?: number[]): Promise<{
  upserted: number;
  deleted: number;
  total: number;
}> {
  const routeIds = routeIdsInput ? normalizeRouteIds(routeIdsInput) : null;
  if (routeIds && routeIds.length === 0) {
    return { upserted: 0, deleted: 0, total: await countProjectionRows() };
  }

  const [routes, routeGroupSources, existingProjections] = routeIds
    ? await Promise.all([
      db.select().from(schema.tokenRoutes)
        .where(inArray(schema.tokenRoutes.id, routeIds))
        .all(),
      db.select().from(schema.routeGroupSources)
        .where(inArray(schema.routeGroupSources.groupRouteId, routeIds))
        .all(),
      loadRouteBindingProjectionsForRouteIds(routeIds),
    ])
    : await Promise.all([
      db.select().from(schema.tokenRoutes).all(),
      db.select().from(schema.routeGroupSources).all(),
      loadRouteBindingProjectionMap(),
    ]);

  const sourceRouteIdsByGroupRouteId = new Map<number, number[]>();
  for (const source of routeGroupSources) {
    const existing = sourceRouteIdsByGroupRouteId.get(source.groupRouteId) || [];
    existing.push(source.sourceRouteId);
    sourceRouteIdsByGroupRouteId.set(source.groupRouteId, existing);
  }

  const updatedAt = new Date().toISOString();
  const projections = routes.map((route) => routeBindingProjectionFromRouteTable({
    route,
    existing: existingProjections.get(route.id) || null,
    sourceRouteIds: sourceRouteIdsByGroupRouteId.get(route.id) || [],
    updatedAt,
  }));
  const rows = projections.map(projectionToRow);

  let deleted = 0;
  if (routeIds) {
    const routeIdSet = new Set(routes.map((route) => route.id));
    deleted = routeIds.filter((routeId) => existingProjections.has(routeId) && !routeIdSet.has(routeId)).length;
    await db.transaction(async (tx) => {
      await deleteProjectionRows(tx as typeof db, routeIds);
      await insertProjectionRows(tx as typeof db, rows);
    });
    return {
      upserted: rows.length,
      deleted,
      total: await countProjectionRows(),
    };
  }

  deleted = Math.max(0, existingProjections.size - rows.length);
  await db.transaction(async (tx) => {
    await tx.delete(schema.routeBindingProjections).run();
    await insertProjectionRows(tx as typeof db, rows);
  });
  return {
    upserted: rows.length,
    deleted,
    total: rows.length,
  };
}
