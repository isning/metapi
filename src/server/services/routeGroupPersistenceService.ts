import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getInsertedRowId } from '../db/insertHelpers.js';
import {
  DEFAULT_ROUTE_ROUTING_STRATEGY,
  normalizeRouteRoutingStrategy,
  type RouteRoutingStrategy,
} from './routeRoutingStrategy.js';

export type AutomaticRouteGroupCandidate = {
  accountId: number;
  tokenId: number | null;
  oauthRouteUnitId: number | null;
  siteId: number;
};

export type AutomaticRouteGroupCandidateMap = Map<string, Map<string, AutomaticRouteGroupCandidate>>;

export type AutomaticRouteGroupBridge = {
  modelName: string;
  routeGroupId: number;
  routeId: number;
  bucketId: number;
};

export type AutomaticRouteGroupBridgeSyncResult = {
  bridgesByModelName: Map<string, AutomaticRouteGroupBridge>;
  createdRouteGroups: number;
  createdLegacyRoutes: number;
  createdBuckets: number;
  updatedRouteGroups: number;
};

export type AutomaticRouteGroupCandidateSyncResult = {
  createdSupplyEndpoints: number;
  updatedSupplyEndpoints: number;
  createdCandidates: number;
  updatedCandidates: number;
  removedCandidates: number;
  createdSupplyEndpointStates: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeModelName(modelName: string): string {
  return modelName.trim().toLowerCase();
}

function buildAutomaticGroupKey(modelName: string): string {
  return `upstream:${modelName.trim()}`;
}

function buildSupplyKey(modelName: string, candidateKey: string): string {
  return `upstream:${normalizeModelName(modelName)}|${candidateKey}`;
}

function normalizePositiveId(input: unknown): number | null {
  const value = Number(input);
  if (!Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
}

function parseJsonObject(input: string | null | undefined): Record<string, unknown> {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeVisibility(input: unknown): 'public' | 'internal' {
  return input === 'internal' ? 'internal' : 'public';
}

function resolveGroupVisibility(group: typeof schema.routeGroups.$inferSelect): 'public' | 'internal' {
  const override = parseJsonObject(group.userOverrideJson);
  return normalizeVisibility(override.visibility ?? group.visibility);
}

function resolveGroupEnabled(group: typeof schema.routeGroups.$inferSelect): boolean {
  const override = parseJsonObject(group.userOverrideJson);
  if (typeof override.enabled === 'boolean') return override.enabled;
  return group.enabled !== false;
}

function resolveGroupRoutingStrategy(group: typeof schema.routeGroups.$inferSelect): RouteRoutingStrategy {
  const override = parseJsonObject(group.userOverrideJson);
  return normalizeRouteRoutingStrategy(override.routingStrategy ?? group.routingStrategy);
}

async function insertAndLoadRouteGroup(values: typeof schema.routeGroups.$inferInsert) {
  const inserted = await db.insert(schema.routeGroups).values(values).run();
  const insertedId = getInsertedRowId(inserted);
  if (insertedId == null) {
    throw new Error('Failed to create automatic route group');
  }
  const row = await db.select().from(schema.routeGroups).where(eq(schema.routeGroups.id, insertedId)).get();
  if (!row) throw new Error('Failed to load automatic route group');
  return row;
}

async function insertAndLoadTokenRoute(values: typeof schema.tokenRoutes.$inferInsert) {
  const inserted = await db.insert(schema.tokenRoutes).values(values).run();
  const insertedId = getInsertedRowId(inserted);
  if (insertedId == null) {
    throw new Error('Failed to create automatic route bridge');
  }
  const row = await db.select().from(schema.tokenRoutes).where(eq(schema.tokenRoutes.id, insertedId)).get();
  if (!row) throw new Error('Failed to load automatic route bridge');
  return row;
}

async function insertAndLoadBucket(values: typeof schema.routeGroupBuckets.$inferInsert) {
  const inserted = await db.insert(schema.routeGroupBuckets).values(values).run();
  const insertedId = getInsertedRowId(inserted);
  if (insertedId == null) {
    throw new Error('Failed to create automatic route group bucket');
  }
  const row = await db.select().from(schema.routeGroupBuckets).where(eq(schema.routeGroupBuckets.id, insertedId)).get();
  if (!row) throw new Error('Failed to load automatic route group bucket');
  return row;
}

async function ensureAutomaticRouteGroup(modelName: string): Promise<{
  row: typeof schema.routeGroups.$inferSelect;
  created: boolean;
  updated: boolean;
}> {
  const trimmedModelName = modelName.trim();
  const groupKey = buildAutomaticGroupKey(trimmedModelName);
  const existing = await db.select().from(schema.routeGroups)
    .where(and(
      eq(schema.routeGroups.kind, 'automatic'),
      eq(schema.routeGroups.groupKey, groupKey),
    ))
    .get();

  if (!existing) {
    return {
      row: await insertAndLoadRouteGroup({
        kind: 'automatic',
        groupKey,
        upstreamModelName: trimmedModelName,
        normalizedModelName: normalizeModelName(trimmedModelName),
        publicModelName: trimmedModelName,
        displayName: trimmedModelName,
        visibility: 'public',
        enabled: true,
        routingStrategy: DEFAULT_ROUTE_ROUTING_STRATEGY,
        sourceMode: 'auto',
        syncStatus: 'active',
        configJson: JSON.stringify({ version: 1, groupKey }),
      }),
      created: true,
      updated: false,
    };
  }

  const updates: Partial<typeof schema.routeGroups.$inferInsert> = {
    upstreamModelName: trimmedModelName,
    normalizedModelName: normalizeModelName(trimmedModelName),
    syncStatus: 'active',
    updatedAt: nowIso(),
  };
  if (!existing.publicModelName) updates.publicModelName = trimmedModelName;
  if (!existing.displayName) updates.displayName = trimmedModelName;
  if (!existing.configJson) updates.configJson = JSON.stringify({ version: 1, groupKey });

  await db.update(schema.routeGroups)
    .set(updates)
    .where(eq(schema.routeGroups.id, existing.id))
    .run();

  return {
    row: {
      ...existing,
      ...updates,
    } as typeof schema.routeGroups.$inferSelect,
    created: false,
    updated: true,
  };
}

async function ensureAutomaticRouteBridge(group: typeof schema.routeGroups.$inferSelect, modelName: string): Promise<{
  route: typeof schema.tokenRoutes.$inferSelect;
  created: boolean;
}> {
  const routeId = normalizePositiveId(group.legacyRouteId);
  const visibility = resolveGroupVisibility(group);
  const enabled = resolveGroupEnabled(group);
  const routingStrategy = resolveGroupRoutingStrategy(group);
  const displayName = group.displayName || group.publicModelName || modelName;

  if (routeId != null) {
    const existing = await db.select().from(schema.tokenRoutes)
      .where(eq(schema.tokenRoutes.id, routeId))
      .get();
    if (existing) {
      await db.update(schema.tokenRoutes)
        .set({
          displayName: existing.displayName || displayName,
          displayIcon: existing.displayIcon || group.displayIcon || null,
          enabled,
          routingStrategy,
          updatedAt: nowIso(),
        })
        .where(eq(schema.tokenRoutes.id, existing.id))
        .run();
      return {
        route: {
          ...existing,
          displayName: existing.displayName || displayName,
          displayIcon: existing.displayIcon || group.displayIcon || null,
          enabled,
          routingStrategy,
        } as typeof schema.tokenRoutes.$inferSelect,
        created: false,
      };
    }
  }

  const route = await insertAndLoadTokenRoute({
    displayName,
    displayIcon: group.displayIcon || null,
    enabled,
    routingStrategy,
  });
  await db.update(schema.routeGroups)
    .set({
      legacyRouteId: route.id,
      visibility,
      enabled,
      routingStrategy,
      updatedAt: nowIso(),
    })
    .where(eq(schema.routeGroups.id, group.id))
    .run();
  return { route, created: true };
}

async function ensureDefaultBucket(group: typeof schema.routeGroups.$inferSelect): Promise<{
  bucket: typeof schema.routeGroupBuckets.$inferSelect;
  created: boolean;
}> {
  const existing = await db.select().from(schema.routeGroupBuckets)
    .where(and(
      eq(schema.routeGroupBuckets.groupId, group.id),
      eq(schema.routeGroupBuckets.bucketKey, 'default'),
    ))
    .get();
  if (existing) return { bucket: existing, created: false };

  return {
    bucket: await insertAndLoadBucket({
      groupId: group.id,
      bucketKey: 'default',
      priority: 0,
      label: 'Default',
      strategy: resolveGroupRoutingStrategy(group),
      enabled: true,
    }),
    created: true,
  };
}

export async function ensureAutomaticRouteGroupBridges(
  modelCandidates: AutomaticRouteGroupCandidateMap,
): Promise<AutomaticRouteGroupBridgeSyncResult> {
  const bridgesByModelName = new Map<string, AutomaticRouteGroupBridge>();
  const desiredGroupKeys = new Set(Array.from(modelCandidates.keys()).map(buildAutomaticGroupKey));
  let createdRouteGroups = 0;
  let createdLegacyRoutes = 0;
  let createdBuckets = 0;
  let updatedRouteGroups = 0;

  for (const modelName of modelCandidates.keys()) {
    const groupResult = await ensureAutomaticRouteGroup(modelName);
    if (groupResult.created) createdRouteGroups += 1;
    if (groupResult.updated) updatedRouteGroups += 1;

    const bridgeResult = await ensureAutomaticRouteBridge(groupResult.row, modelName);
    if (bridgeResult.created) createdLegacyRoutes += 1;

    const bucketResult = await ensureDefaultBucket({
      ...groupResult.row,
      legacyRouteId: bridgeResult.route.id,
    } as typeof schema.routeGroups.$inferSelect);
    if (bucketResult.created) createdBuckets += 1;

    bridgesByModelName.set(modelName, {
      modelName,
      routeGroupId: groupResult.row.id,
      routeId: bridgeResult.route.id,
      bucketId: bucketResult.bucket.id,
    });
  }

  const automaticGroups = await db.select().from(schema.routeGroups)
    .where(eq(schema.routeGroups.kind, 'automatic'))
    .all();
  for (const group of automaticGroups) {
    if (desiredGroupKeys.has(group.groupKey)) continue;
    if (group.syncStatus === 'unresolved') continue;
    await db.update(schema.routeGroups)
      .set({ syncStatus: 'unresolved', updatedAt: nowIso() })
      .where(eq(schema.routeGroups.id, group.id))
      .run();
  }

  return {
    bridgesByModelName,
    createdRouteGroups,
    createdLegacyRoutes,
    createdBuckets,
    updatedRouteGroups,
  };
}

function buildTargetKey(target: typeof schema.routeEndpointTargets.$inferSelect): string {
  return target.oauthRouteUnitId
    ? `route-unit:${target.oauthRouteUnitId}`
    : `${target.accountId}:${target.tokenId ?? 'account'}`;
}

async function upsertSupplyEndpoint(input: {
  modelName: string;
  candidateKey: string;
  candidate: AutomaticRouteGroupCandidate;
  target: typeof schema.routeEndpointTargets.$inferSelect | null;
}): Promise<{ row: typeof schema.routeSupplyEndpoints.$inferSelect; created: boolean; updated: boolean }> {
  const supplyKey = buildSupplyKey(input.modelName, input.candidateKey);
  const existing = await db.select().from(schema.routeSupplyEndpoints)
    .where(eq(schema.routeSupplyEndpoints.supplyKey, supplyKey))
    .get();
  const metadataJson = JSON.stringify({
    version: 1,
    candidateKey: input.candidateKey,
    source: 'availability_rebuild',
    legacyTargetId: input.target?.id ?? null,
    legacyRouteId: input.target?.routeId ?? null,
  });

  if (!existing) {
    const inserted = await db.insert(schema.routeSupplyEndpoints).values({
      supplyKey,
      siteId: input.candidate.siteId,
      accountId: input.candidate.accountId,
      tokenId: input.candidate.tokenId,
      oauthRouteUnitId: input.candidate.oauthRouteUnitId,
      upstreamModelName: input.modelName,
      normalizedModelName: normalizeModelName(input.modelName),
      enabled: input.target ? input.target.enabled !== false : true,
      discovered: true,
      source: 'availability_rebuild',
      legacyTargetId: input.target?.id ?? null,
      metadataJson,
    }).run();
    const insertedId = getInsertedRowId(inserted);
    if (insertedId == null) throw new Error('Failed to create route supply endpoint');
    const row = await db.select().from(schema.routeSupplyEndpoints)
      .where(eq(schema.routeSupplyEndpoints.id, insertedId))
      .get();
    if (!row) throw new Error('Failed to load route supply endpoint');
    return { row, created: true, updated: false };
  }

  await db.update(schema.routeSupplyEndpoints)
    .set({
      siteId: input.candidate.siteId,
      accountId: input.candidate.accountId,
      tokenId: input.candidate.tokenId,
      oauthRouteUnitId: input.candidate.oauthRouteUnitId,
      upstreamModelName: input.modelName,
      normalizedModelName: normalizeModelName(input.modelName),
      enabled: input.target ? input.target.enabled !== false : existing.enabled,
      discovered: true,
      legacyTargetId: input.target?.id ?? existing.legacyTargetId ?? null,
      metadataJson,
      updatedAt: nowIso(),
    })
    .where(eq(schema.routeSupplyEndpoints.id, existing.id))
    .run();

  return {
    row: {
      ...existing,
      siteId: input.candidate.siteId,
      accountId: input.candidate.accountId,
      tokenId: input.candidate.tokenId,
      oauthRouteUnitId: input.candidate.oauthRouteUnitId,
      upstreamModelName: input.modelName,
      normalizedModelName: normalizeModelName(input.modelName),
      enabled: input.target ? input.target.enabled !== false : existing.enabled,
      discovered: true,
      legacyTargetId: input.target?.id ?? existing.legacyTargetId ?? null,
      metadataJson,
    } as typeof schema.routeSupplyEndpoints.$inferSelect,
    created: false,
    updated: true,
  };
}

async function ensureSupplyEndpointState(
  supplyEndpoint: typeof schema.routeSupplyEndpoints.$inferSelect,
  target: typeof schema.routeEndpointTargets.$inferSelect | null,
): Promise<boolean> {
  const existing = await db.select().from(schema.routeSupplyEndpointState)
    .where(eq(schema.routeSupplyEndpointState.supplyEndpointId, supplyEndpoint.id))
    .get();
  if (existing) return false;

  await db.insert(schema.routeSupplyEndpointState).values({
    supplyEndpointId: supplyEndpoint.id,
    successCount: target?.successCount ?? 0,
    failCount: target?.failCount ?? 0,
    totalLatencyMs: target?.totalLatencyMs ?? 0,
    totalCost: target?.totalCost ?? 0,
    lastUsedAt: target?.lastUsedAt ?? null,
    lastSelectedAt: target?.lastSelectedAt ?? null,
    lastFailAt: target?.lastFailAt ?? null,
    consecutiveFailCount: target?.consecutiveFailCount ?? 0,
    cooldownLevel: target?.cooldownLevel ?? 0,
    cooldownUntil: target?.cooldownUntil ?? null,
  }).run();
  return true;
}

async function upsertRouteGroupCandidate(input: {
  bridge: AutomaticRouteGroupBridge;
  candidateKey: string;
  supplyEndpoint: typeof schema.routeSupplyEndpoints.$inferSelect;
  target: typeof schema.routeEndpointTargets.$inferSelect | null;
  sortOrder: number;
}): Promise<{ created: boolean; updated: boolean }> {
  const existing = await db.select().from(schema.routeGroupCandidates)
    .where(and(
      eq(schema.routeGroupCandidates.groupId, input.bridge.routeGroupId),
      eq(schema.routeGroupCandidates.bucketId, input.bridge.bucketId),
      eq(schema.routeGroupCandidates.candidateKey, input.candidateKey),
    ))
    .get();
  const weight = input.target?.weight ?? 10;
  const enabled = input.target ? input.target.enabled !== false : true;

  if (!existing) {
    await db.insert(schema.routeGroupCandidates).values({
      groupId: input.bridge.routeGroupId,
      bucketId: input.bridge.bucketId,
      candidateKey: input.candidateKey,
      candidateKind: 'supply_endpoint',
      supplyEndpointId: input.supplyEndpoint.id,
      childGroupId: null,
      weight,
      sortOrder: input.sortOrder,
      enabled,
      source: 'availability_rebuild',
      manualOverride: false,
    }).run();
    return { created: true, updated: false };
  }

  await db.update(schema.routeGroupCandidates)
    .set({
      candidateKind: 'supply_endpoint',
      supplyEndpointId: input.supplyEndpoint.id,
      childGroupId: null,
      weight: existing.manualOverride ? existing.weight : weight,
      sortOrder: existing.manualOverride ? existing.sortOrder : input.sortOrder,
      enabled: existing.manualOverride ? existing.enabled : enabled,
      source: existing.manualOverride ? existing.source : 'availability_rebuild',
      updatedAt: nowIso(),
    })
    .where(eq(schema.routeGroupCandidates.id, existing.id))
    .run();
  return { created: false, updated: true };
}

export async function syncAutomaticRouteGroupCandidates(input: {
  modelCandidates: AutomaticRouteGroupCandidateMap;
  bridgesByModelName: Map<string, AutomaticRouteGroupBridge>;
}): Promise<AutomaticRouteGroupCandidateSyncResult> {
  const routeIds = Array.from(input.bridgesByModelName.values()).map((bridge) => bridge.routeId);
  const allTargets = routeIds.length > 0
    ? await db.select().from(schema.routeEndpointTargets).all()
    : [];
  const targetsByRouteAndCandidateKey = new Map<string, typeof schema.routeEndpointTargets.$inferSelect>();
  for (const target of allTargets) {
    if (!routeIds.includes(target.routeId)) continue;
    targetsByRouteAndCandidateKey.set(`${target.routeId}:${buildTargetKey(target)}`, target);
  }

  let createdSupplyEndpoints = 0;
  let updatedSupplyEndpoints = 0;
  let createdCandidates = 0;
  let updatedCandidates = 0;
  let removedCandidates = 0;
  let createdSupplyEndpointStates = 0;

  for (const [modelName, candidateMap] of input.modelCandidates.entries()) {
    const bridge = input.bridgesByModelName.get(modelName);
    if (!bridge) continue;

    const desiredCandidateKeys = new Set<string>();
    let sortOrder = 0;
    for (const [candidateKey, candidate] of candidateMap.entries()) {
      desiredCandidateKeys.add(candidateKey);
      const target = targetsByRouteAndCandidateKey.get(`${bridge.routeId}:${candidateKey}`) ?? null;
      const supply = await upsertSupplyEndpoint({ modelName, candidateKey, candidate, target });
      if (supply.created) createdSupplyEndpoints += 1;
      if (supply.updated) updatedSupplyEndpoints += 1;
      if (await ensureSupplyEndpointState(supply.row, target)) {
        createdSupplyEndpointStates += 1;
      }

      const candidateResult = await upsertRouteGroupCandidate({
        bridge,
        candidateKey,
        supplyEndpoint: supply.row,
        target,
        sortOrder,
      });
      if (candidateResult.created) createdCandidates += 1;
      if (candidateResult.updated) updatedCandidates += 1;
      sortOrder += 1;
    }

    const existingCandidates = await db.select().from(schema.routeGroupCandidates)
      .where(eq(schema.routeGroupCandidates.groupId, bridge.routeGroupId))
      .all();
    for (const candidate of existingCandidates) {
      if (candidate.bucketId !== bridge.bucketId) continue;
      if (desiredCandidateKeys.has(candidate.candidateKey)) continue;
      if (candidate.manualOverride) continue;
      const deleted = await db.delete(schema.routeGroupCandidates)
        .where(eq(schema.routeGroupCandidates.id, candidate.id))
        .run();
      removedCandidates += Number(deleted?.changes || 0);
    }
  }

  return {
    createdSupplyEndpoints,
    updatedSupplyEndpoints,
    createdCandidates,
    updatedCandidates,
    removedCandidates,
    createdSupplyEndpointStates,
  };
}
