import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  clearRouteDecisionSnapshot,
  clearRouteDecisionSnapshots,
} from './routeDecisionSnapshotStore.js';
import { loadActiveRouteGraphRouteBindings } from './routeGraphService.js';
import { tokenRouter } from './tokenRouter.js';
import type { RouteMode } from '../../shared/tokenRouteContract.js';
import {
  isRouteGraphExactModelMatch,
  normalizeRouteGraphBackendSpec,
  type RouteGraphBackendSpec,
  type RouteGraphMatchSpec,
} from '../../shared/routeGraph.js';

type RouteRow = typeof schema.tokenRoutes.$inferSelect & {
  routeMode: RouteMode;
  modelPattern: string;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  sourceRouteIds: number[];
};

function isExplicitGroupRoute(route: Pick<RouteRow, 'backend'> | Pick<RouteRow, 'routeMode'>): boolean {
  if ('backend' in route) {
    return normalizeRouteGraphBackendSpec(route.backend).kind === 'routes';
  }
  return route.routeMode === 'explicit_group';
}

function normalizeSourceRouteIds(sourceRouteIds: number[]): number[] {
  return Array.from(new Set(
    sourceRouteIds
      .filter((routeId): routeId is number => Number.isFinite(routeId) && routeId > 0)
      .map((routeId) => Math.trunc(routeId)),
  ));
}

async function loadRouteSourceIdsMap(routeIds: number[]): Promise<Map<number, number[]>> {
  const normalizedRouteIds = normalizeSourceRouteIds(routeIds);
  if (normalizedRouteIds.length === 0) return new Map();

  const rows = await db.select().from(schema.routeGroupSources)
    .where(inArray(schema.routeGroupSources.groupRouteId, normalizedRouteIds))
    .all();
  const sourceRouteIdsByRouteId = new Map<number, number[]>();
  for (const row of rows) {
    if (!sourceRouteIdsByRouteId.has(row.groupRouteId)) {
      sourceRouteIdsByRouteId.set(row.groupRouteId, []);
    }
    sourceRouteIdsByRouteId.get(row.groupRouteId)!.push(row.sourceRouteId);
  }
  for (const [routeId, sourceRouteIds] of sourceRouteIdsByRouteId.entries()) {
    sourceRouteIdsByRouteId.set(routeId, normalizeSourceRouteIds(sourceRouteIds));
  }
  return sourceRouteIdsByRouteId;
}

async function decorateRoutesWithSources(
  routes: Array<typeof schema.tokenRoutes.$inferSelect>,
  sourceRouteIdsByRouteId: Map<number, number[]>,
): Promise<RouteRow[]> {
  const routeBindings = await loadActiveRouteGraphRouteBindings();
  return routes.map((route) => {
    const binding = routeBindings.get(route.id);
    return {
      ...route,
      match: binding?.match ?? {
        kind: 'model',
        requestedModelPattern: route.displayName || '',
        currentModelPattern: '',
        displayName: route.displayName || null,
        downstreamProtocol: null,
        upstreamProtocol: null,
        sitePlatform: null,
        routeId: route.id,
        accountId: null,
        tokenId: null,
        siteId: null,
      },
      backend: binding?.backend ?? { kind: 'channels' },
      routeMode: binding?.routeMode ?? 'pattern',
      modelPattern: binding?.exactModelName || binding?.exposedModelName || '',
      sourceRouteIds: sourceRouteIdsByRouteId.get(route.id) ?? binding?.sourceRouteIds ?? [],
    } as RouteRow;
  });
}

async function getRouteWithSources(routeId: number): Promise<RouteRow | null> {
  const route = await db.select().from(schema.tokenRoutes).where(eq(schema.tokenRoutes.id, routeId)).get();
  if (!route) return null;
  const sourceRouteIdsByRouteId = await loadRouteSourceIdsMap([routeId]);
  return (await decorateRoutesWithSources([route], sourceRouteIdsByRouteId))[0] ?? null;
}

async function resolveCooldownClearRouteIds(route: RouteRow): Promise<number[]> {
  if (!isExplicitGroupRoute(route)) {
    return [route.id];
  }

  const sourceRouteIds = normalizeSourceRouteIds(route.sourceRouteIds);
  if (sourceRouteIds.length === 0) return [];

  const sourceRoutes = await decorateRoutesWithSources(await db.select().from(schema.tokenRoutes)
    .where(inArray(schema.tokenRoutes.id, sourceRouteIds))
    .all(), new Map());

  return sourceRoutes
    .filter((sourceRoute) => (
      sourceRoute.enabled
      && !isExplicitGroupRoute(sourceRoute)
      && isRouteGraphExactModelMatch(sourceRoute.match, sourceRoute.backend)
    ))
    .map((sourceRoute) => sourceRoute.id);
}

async function clearDependentExplicitGroupSnapshotsBySourceRouteIds(sourceRouteIds: number[]): Promise<void> {
  const normalizedSourceRouteIds = normalizeSourceRouteIds(sourceRouteIds);
  if (normalizedSourceRouteIds.length === 0) return;

  const rows = await db.select({ groupRouteId: schema.routeGroupSources.groupRouteId })
    .from(schema.routeGroupSources)
    .where(inArray(schema.routeGroupSources.sourceRouteId, normalizedSourceRouteIds))
    .all();
  const dependentRouteIds: number[] = Array.from(new Set(
    rows
      .map((row) => row.groupRouteId)
      .filter((routeId): routeId is number => Number.isFinite(routeId) && routeId > 0),
  ));
  if (dependentRouteIds.length === 0) return;
  await clearRouteDecisionSnapshots(dependentRouteIds);
}

export async function clearRouteCooldown(routeId: number): Promise<{ success: true; clearedChannels: number } | null> {
  const route = await getRouteWithSources(routeId);
  if (!route) return null;

  const actualRouteIds = await resolveCooldownClearRouteIds(route);
  const channelRows: Array<{ id: number; routeId: number }> = actualRouteIds.length > 0
    ? await db.select({
      id: schema.routeChannels.id,
      routeId: schema.routeChannels.routeId,
    }).from(schema.routeChannels)
      .where(inArray(schema.routeChannels.routeId, actualRouteIds))
      .all()
    : [];

  const affectedRouteIds = Array.from(new Set(channelRows.map((row) => row.routeId)));
  const clearedChannels = await tokenRouter.clearChannelFailureState(channelRows.map((row) => row.id));

  await clearRouteDecisionSnapshot(route.id);
  if (affectedRouteIds.length > 0) {
    await clearRouteDecisionSnapshots(affectedRouteIds);
    await clearDependentExplicitGroupSnapshotsBySourceRouteIds(affectedRouteIds);
  }

  return {
    success: true,
    clearedChannels,
  };
}
