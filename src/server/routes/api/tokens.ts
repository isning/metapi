import { FastifyInstance, type FastifyReply } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { db, schema } from '../../db/index.js';
import { requireInsertedRowId } from '../../db/insertHelpers.js';
import * as routeRefreshWorkflow from '../../services/routeRefreshWorkflow.js';
import {
  ACCOUNT_TOKEN_VALUE_STATUS_READY,
  isUsableAccountToken,
} from '../../services/accountTokenService.js';
import {
  DEFAULT_ROUTE_ROUTING_STRATEGY,
  normalizeRouteRoutingStrategy,
  type RouteRoutingStrategy,
} from '../../services/routeRoutingStrategy.js';
import { invalidateTokenRouterCache, matchesModelPattern, tokenRouter } from '../../services/tokenRouter.js';
import { appendBackgroundTaskLog, startBackgroundTask } from '../../services/backgroundTaskService.js';
import {
  clearRouteDecisionSnapshot,
  clearRouteDecisionSnapshots,
  parseRouteDecisionSnapshot,
  saveRouteDecisionSnapshots,
} from '../../services/routeDecisionSnapshotStore.js';
import { clearRouteCooldown } from '../../services/routeCooldownService.js';
import {
  discardRouteGraphDraft,
  ensureActiveRouteGraphVersion,
  getRouteGraphDraft,
  loadRouteGraphLegacyProjections,
  publishRouteGraphDraft,
  rebaseRouteGraphDraft,
  reconcileActiveGraphWithProjectionTable,
  saveRouteGraphDraft,
  validateRouteGraphDraft,
} from '../../services/routeGraphService.js';
import {
  refreshAllRouteDecisionSnapshots,
  ROUTE_DECISION_REFRESH_DEDUPE_KEY,
  ROUTE_DECISION_REFRESH_TASK_TYPE,
} from '../../services/routeDecisionRefreshService.js';
import {
  listOauthRouteUnitMembersByUnitIds,
  loadOauthRouteUnitSummariesByIds,
} from '../../services/oauth/routeUnitService.js';
import type { RouteMode } from '../../../shared/tokenRouteContract.js';
import {
  deriveLegacyModelPatternFromSpecs,
  deriveLegacyRouteModeFromBackendSpec,
  deriveLegacySourceRouteIdsFromBackendSpec,
  isRouteGraphExactModelMatch,
  normalizeRouteGraphBackendSpec,
  normalizeRouteGraphMatchSpec,
  parseRouteGraphBackendSpec,
  parseRouteGraphMatchSpec,
  stringifyRouteGraphBackendSpec,
  stringifyRouteGraphMatchSpec,
  normalizeRouteGraphMacro,
  normalizeRouteGraphSource,
  compileRouteGraphSource,
  type RouteGraphBackendSpec,
  type RouteGraphMatchSpec,
  type RouteGraphMacro,
} from '../../../shared/routeGraph.js';
import {
  parseRouteChannelBatchCreatePayload,
  parseRouteChannelCreatePayload,
  parseRouteChannelUpdatePayload,
  parseRouteGraphSourcePayload,
  parseRouteRebuildPayload,
  parseTokenRouteBatchPayload,
  parseTokenRouteCreatePayload,
  parseTokenRouteUpdatePayload,
} from '../../contracts/tokenRoutePayloads.js';

function createTokenRouteReadLimiter(keyPrefix: string, points = 60) {
  return new RateLimiterMemory({
    keyPrefix,
    points,
    duration: 60,
  });
}

let routeSummaryReadLimiter = createTokenRouteReadLimiter('token-routes-summary-read');
let routeListReadLimiter = createTokenRouteReadLimiter('token-routes-list-read');

export function resetTokenRouteReadLimitersForTests(options: {
  summaryPoints?: number;
  listPoints?: number;
} = {}): void {
  routeSummaryReadLimiter = createTokenRouteReadLimiter('token-routes-summary-read', options.summaryPoints ?? 60);
  routeListReadLimiter = createTokenRouteReadLimiter('token-routes-list-read', options.listPoints ?? 60);
}

function sendTokenRouteRateLimit(reply: FastifyReply, error: unknown): void {
  const retryState = error instanceof RateLimiterRes ? error : null;
  const retryAfterSec = Math.max(1, Math.ceil((retryState?.msBeforeNext ?? 60_000) / 1000));
  reply.code(429).header('retry-after', String(retryAfterSec))
    .send({ success: false, message: '请求过于频繁，请稍后再试' });
}

function isExactModelPattern(modelPattern: string | null | undefined): boolean {
  const normalized = String(modelPattern || '').trim();
  if (!normalized) return false;
  if (normalized.toLowerCase().startsWith('re:')) return false;
  return !/[\*\?]/.test(normalized);
}

type RouteRow = typeof schema.tokenRoutes.$inferSelect & {
  routeMode: RouteMode;
  modelPattern: string;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  sourceRouteIds: number[];
};

type GraphRoutePresentation = {
  displayName: string | null;
  displayIcon: string | null;
};

type GraphRouteResponseBase = {
  id: number;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  presentation: GraphRoutePresentation;
  modelMapping: string | null;
  routingStrategy: RouteRoutingStrategy;
  enabled: boolean;
};

function isExplicitGroupRoute(route: Pick<RouteRow, 'backend'> | Pick<RouteRow, 'routeMode'>): boolean {
  if ('backend' in route) {
    return normalizeRouteGraphBackendSpec(route.backend).kind === 'routes';
  }
  return route.routeMode === 'explicit_group';
}

function normalizeSourceRouteIdsInput(input: unknown): number[] {
  const rawValues = Array.isArray(input) ? input : [];
  const normalized: number[] = [];
  for (const raw of rawValues) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const routeId = Math.trunc(value);
    if (routeId <= 0 || normalized.includes(routeId)) continue;
    normalized.push(routeId);
    if (normalized.length >= 500) break;
  }
  return normalized;
}

async function decorateRoutesWithSources(
  routes: Array<typeof schema.tokenRoutes.$inferSelect>,
): Promise<RouteRow[]> {
  const projections = await loadRouteGraphLegacyProjections();
  return routes.map((route) => {
    const projection = projections.get(route.id);
    const fallbackPattern = route.displayName || '';
    const match = projection?.match ?? normalizeRouteGraphMatchSpec({
      requestedModelPattern: fallbackPattern,
      displayName: route.displayName,
      routeId: route.id,
    });
    const backend = projection?.backend ?? normalizeRouteGraphBackendSpec({ kind: 'channels' });
    return {
      ...route,
      match,
      backend,
      routeMode: projection?.routeMode ?? deriveLegacyRouteModeFromBackendSpec(backend),
      modelPattern: projection?.modelPattern ?? fallbackPattern,
      sourceRouteIds: projection?.sourceRouteIds ?? deriveLegacySourceRouteIdsFromBackendSpec(backend),
    };
  });
}

async function listRoutesWithSources(): Promise<RouteRow[]> {
  const routes = await db.select().from(schema.tokenRoutes).all();
  return await decorateRoutesWithSources(routes);
}

async function getRouteWithSources(routeId: number): Promise<RouteRow | null> {
  const route = await db.select().from(schema.tokenRoutes).where(eq(schema.tokenRoutes.id, routeId)).get();
  if (!route) return null;
  return (await decorateRoutesWithSources([route]))[0] ?? null;
}

function routeToGraphResponseBase(route: RouteRow): GraphRouteResponseBase {
  return {
    id: route.id,
    match: normalizeRouteGraphMatchSpec(route.match),
    backend: normalizeRouteGraphBackendSpec(route.backend),
    presentation: {
      displayName: route.displayName ?? route.match.displayName ?? null,
      displayIcon: route.displayIcon ?? null,
    },
    modelMapping: route.modelMapping ?? null,
    routingStrategy: normalizeRouteRoutingStrategy(route.routingStrategy),
    enabled: route.enabled !== false,
  };
}

function normalizeGraphRoutePresentation(input: unknown): GraphRoutePresentation {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const displayName = typeof raw.displayName === 'string' && raw.displayName.trim()
    ? raw.displayName.trim()
    : null;
  const displayIcon = typeof raw.displayIcon === 'string' && raw.displayIcon.trim()
    ? raw.displayIcon.trim()
    : null;
  return { displayName, displayIcon };
}

function normalizeGraphRouteMacro(input: unknown): RouteGraphMacro | null {
  const macro = normalizeRouteGraphMacro(input);
  return macro.kind === 'candidate_selector' ? macro : null;
}

function projectRoutePayloadFromMacro(
  macroInput: RouteGraphMacro | null | undefined,
  fallback: {
    id: number;
    displayName: string | null;
    displayIcon: string | null;
    match: RouteGraphMatchSpec;
    backend: RouteGraphBackendSpec;
    routingStrategy: RouteRoutingStrategy;
  },
): {
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  presentation: GraphRoutePresentation;
  routingStrategy: RouteRoutingStrategy;
} {
  const macro = normalizeGraphRouteMacro(macroInput);
  if (!macro || macro.config.surface.entry.kind !== 'external') {
    return {
      match: fallback.match,
      backend: fallback.backend,
      presentation: {
        displayName: fallback.displayName,
        displayIcon: fallback.displayIcon,
      },
      routingStrategy: fallback.routingStrategy,
    };
  }
  const entry = macro.config.surface.entry;
  const routeIds = macro.config.groups
    .flatMap((group) => group.enabled && group.input.kind === 'route_ids' ? group.input.routeIds : [])
    .filter((routeId, index, array) => array.indexOf(routeId) === index);
  return {
    match: normalizeRouteGraphMatchSpec({
      ...fallback.match,
      requestedModelPattern: entry.match.requestedModelPattern || '',
      displayName: entry.match.displayName ?? fallback.displayName,
      routeId: fallback.id,
    }),
    backend: {
      kind: 'routes',
      routeIds,
    },
    presentation: {
      displayName: entry.match.displayName ?? fallback.displayName,
      displayIcon: macro.config.presentation?.displayIcon ?? fallback.displayIcon,
    },
    routingStrategy: normalizeRouteRoutingStrategy(macro.config.policy.strategy),
  };
}

async function validateExplicitGroupSourceRoutes(sourceRouteIds: number[], currentRouteId?: number): Promise<{ ok: true } | { ok: false; message: string }> {
  if (sourceRouteIds.length === 0) {
    return { ok: false, message: '显式群组至少需要选择一个来源模型' };
  }

  const routes = await db.select().from(schema.tokenRoutes)
    .where(inArray(schema.tokenRoutes.id, sourceRouteIds))
    .all();
  if (routes.length !== sourceRouteIds.length) {
    return { ok: false, message: '来源模型中存在不存在的路由' };
  }

  for (const route of routes) {
    if (currentRouteId && route.id === currentRouteId) {
      return { ok: false, message: '显式群组不能引用自身作为来源模型' };
    }
    const compiled = (await decorateRoutesWithSources([route]))[0]!;
    if (isExplicitGroupRoute(compiled)) {
      return { ok: false, message: '显式群组只能选择精确模型路由作为来源模型' };
    }
    if (!isRouteGraphExactModelMatch(compiled.match, compiled.backend)) {
      return { ok: false, message: '显式群组只能选择精确模型路由作为来源模型' };
    }
  }

  return { ok: true };
}

async function replaceRouteSourceRouteIds(routeId: number, sourceRouteIds: number[]): Promise<void> {
  await db.delete(schema.routeGroupSources)
    .where(eq(schema.routeGroupSources.groupRouteId, routeId))
    .run();
  if (sourceRouteIds.length === 0) return;
  await db.insert(schema.routeGroupSources).values(sourceRouteIds.map((sourceRouteId) => ({
    groupRouteId: routeId,
    sourceRouteId,
  }))).run();
}

async function publishRouteProjectionUpdate(input: {
  routeId: number;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  displayName: string | null;
  routingStrategy: RouteRoutingStrategy;
  enabled: boolean;
}): Promise<void> {
  const active = await ensureActiveRouteGraphVersion();
  if (input.backend.kind === 'routes') {
    await replaceRouteSourceRouteIds(input.routeId, input.backend.routeIds);
  } else {
    await replaceRouteSourceRouteIds(input.routeId, []);
  }
  await reconcileActiveGraphWithProjectionTable(active, new Map([
    [input.routeId, {
      match: normalizeRouteGraphMatchSpec({
        ...input.match,
        displayName: input.displayName,
        routeId: input.routeId,
      }),
      backend: input.backend,
    }],
  ]));
}

async function publishRouteProjectionDelete(routeId: number): Promise<void> {
  const active = await ensureActiveRouteGraphVersion();
  await replaceRouteSourceRouteIds(routeId, []);
  await reconcileActiveGraphWithProjectionTable(active);
}

async function syncExplicitGroupSourceRouteStrategies(input: {
  groupRouteId: number;
  sourceRouteIds: number[];
  targetStrategy: RouteRoutingStrategy;
  previousStrategy?: RouteRoutingStrategy | null;
}): Promise<number[]> {
  const normalizedSourceRouteIds = Array.from(new Set(
    input.sourceRouteIds.filter((routeId): routeId is number => Number.isFinite(routeId) && routeId > 0),
  ));
  if (normalizedSourceRouteIds.length === 0) return [];

  const [sourceRoutes, sourceGroupRows] = await Promise.all([
    db.select().from(schema.tokenRoutes)
      .where(inArray(schema.tokenRoutes.id, normalizedSourceRouteIds))
      .all(),
    db.select().from(schema.tokenRoutes).all(),
  ]);

  const otherGroupRefsBySourceRouteId = new Map<number, Set<number>>();
  for (const row of await decorateRoutesWithSources(sourceGroupRows)) {
    if (row.id === input.groupRouteId || !isExplicitGroupRoute(row)) continue;
    for (const sourceRouteId of row.sourceRouteIds) {
      if (!normalizedSourceRouteIds.includes(sourceRouteId)) continue;
      if (!otherGroupRefsBySourceRouteId.has(sourceRouteId)) {
        otherGroupRefsBySourceRouteId.set(sourceRouteId, new Set());
      }
      otherGroupRefsBySourceRouteId.get(sourceRouteId)!.add(row.id);
    }
  }

  const previousStrategy = input.previousStrategy
    ? normalizeRouteRoutingStrategy(input.previousStrategy)
    : null;
  const updatableRouteIds: number[] = [];
  for (const route of sourceRoutes) {
    const compiled = (await decorateRoutesWithSources([route]))[0]!;
    if (isExplicitGroupRoute(compiled)) continue;
    if (!isRouteGraphExactModelMatch(compiled.match, compiled.backend)) continue;
    if ((otherGroupRefsBySourceRouteId.get(route.id)?.size || 0) > 0) continue;

    const currentStrategy = normalizeRouteRoutingStrategy(route.routingStrategy);
    const shouldSync = (
      currentStrategy === DEFAULT_ROUTE_ROUTING_STRATEGY
      || currentStrategy === input.targetStrategy
      || (previousStrategy !== null && currentStrategy === previousStrategy)
    );
    if (!shouldSync) continue;
    if (currentStrategy === input.targetStrategy) continue;
    updatableRouteIds.push(route.id);
  }

  if (updatableRouteIds.length === 0) return [];

  await db.update(schema.tokenRoutes).set({
    routingStrategy: input.targetStrategy,
    updatedAt: new Date().toISOString(),
  }).where(inArray(schema.tokenRoutes.id, updatableRouteIds)).run();

  return updatableRouteIds;
}

async function clearDependentExplicitGroupSnapshotsBySourceRouteIds(sourceRouteIds: number[]): Promise<void> {
  const normalizedSourceRouteIds = Array.from(new Set(
    sourceRouteIds.filter((routeId): routeId is number => Number.isFinite(routeId) && routeId > 0),
  ));
  if (normalizedSourceRouteIds.length === 0) return;

  const rows = (await decorateRoutesWithSources(await db.select().from(schema.tokenRoutes).all()))
    .filter((route) => isExplicitGroupRoute(route) && route.sourceRouteIds.some((sourceRouteId) => normalizedSourceRouteIds.includes(sourceRouteId)));
  const dependentRouteIdSet = new Set<number>();
  for (const row of rows) {
    const routeId = Number(row.id);
    if (Number.isFinite(routeId) && routeId > 0) {
      dependentRouteIdSet.add(routeId);
    }
  }
  const dependentRouteIds = Array.from(dependentRouteIdSet);
  if (dependentRouteIds.length === 0) return;
  await clearRouteDecisionSnapshots(dependentRouteIds);
}

async function getDefaultTokenId(accountId: number): Promise<number | null> {
  const token = await db.select().from(schema.accountTokens)
    .where(and(
      eq(schema.accountTokens.accountId, accountId),
      eq(schema.accountTokens.enabled, true),
      eq(schema.accountTokens.isDefault, true),
      eq(schema.accountTokens.valueStatus, ACCOUNT_TOKEN_VALUE_STATUS_READY),
    ))
    .get();
  return isUsableAccountToken(token ?? null) ? token!.id : null;
}

function canonicalModelAlias(modelName: string): string {
  const normalized = modelName.trim().toLowerCase();
  if (!normalized) return '';
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex >= 0 && slashIndex < normalized.length - 1) {
    return normalized.slice(slashIndex + 1);
  }
  return normalized;
}

function isModelAliasEquivalent(left: string, right: string): boolean {
  const a = canonicalModelAlias(left);
  const b = canonicalModelAlias(right);
  return !!a && !!b && a === b;
}

async function tokenSupportsModel(tokenId: number, modelName: string): Promise<boolean> {
  const rows = await db.select().from(schema.tokenModelAvailability)
    .where(
      and(
        eq(schema.tokenModelAvailability.tokenId, tokenId),
        eq(schema.tokenModelAvailability.available, true),
      ),
    )
    .all();
  return rows.some((row) => {
    const availableModelName = row.modelName?.trim();
    if (!availableModelName) return false;
    return availableModelName === modelName || isModelAliasEquivalent(availableModelName, modelName);
  });
}

async function checkTokenBelongsToAccount(tokenId: number, accountId: number): Promise<boolean> {
  const row = await db.select().from(schema.accountTokens)
    .where(and(eq(schema.accountTokens.id, tokenId), eq(schema.accountTokens.accountId, accountId)))
    .get();
  return isUsableAccountToken(row ?? null);
}

async function getPatternTokenCandidates(modelPattern: string): Promise<Array<{ tokenId: number; accountId: number; sourceModel: string }>> {
  const rows = await db.select().from(schema.tokenModelAvailability)
    .innerJoin(schema.accountTokens, eq(schema.tokenModelAvailability.tokenId, schema.accountTokens.id))
    .innerJoin(schema.accounts, eq(schema.accountTokens.accountId, schema.accounts.id))
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .where(
      and(
        eq(schema.tokenModelAvailability.available, true),
        eq(schema.accountTokens.enabled, true),
        eq(schema.accountTokens.valueStatus, ACCOUNT_TOKEN_VALUE_STATUS_READY),
        eq(schema.accounts.status, 'active'),
        eq(schema.sites.status, 'active'),
      ),
    )
    .all();

  const result: Array<{ tokenId: number; accountId: number; sourceModel: string }> = [];
  for (const row of rows) {
    if (!isUsableAccountToken(row.account_tokens)) continue;
    const modelName = row.token_model_availability.modelName?.trim();
    if (!modelName) continue;
    if (!matchesModelPattern(modelName, modelPattern)) continue;
    result.push({
      tokenId: row.account_tokens.id,
      accountId: row.accounts.id,
      sourceModel: modelName,
    });
  }

  return result;
}

async function getMatchedExactRouteChannelCandidates(modelPattern: string): Promise<Array<{
  tokenId: number | null;
  accountId: number;
  sourceModel: string;
  priority: number;
  weight: number;
  enabled: boolean;
  manualOverride: boolean;
}>> {
  const matchedRoutes = (await db.select().from(schema.tokenRoutes)
    .where(eq(schema.tokenRoutes.enabled, true))
    .all())
    .filter((route) => isExactModelPattern(route.modelPattern) && matchesModelPattern(route.modelPattern, modelPattern));

  if (matchedRoutes.length === 0) return [];
  const routeMap = new Map<number, typeof matchedRoutes[number]>();
  for (const route of matchedRoutes) routeMap.set(route.id, route);

  const channels = await db.select().from(schema.routeChannels)
    .where(inArray(schema.routeChannels.routeId, matchedRoutes.map((route) => route.id)))
    .all();

  return channels.map((channel) => ({
    tokenId: channel.tokenId ?? null,
    accountId: channel.accountId,
    sourceModel: (channel.sourceModel || routeMap.get(channel.routeId)?.modelPattern || '').trim(),
    priority: channel.priority ?? 0,
    weight: channel.weight ?? 10,
    enabled: !!channel.enabled,
    manualOverride: !!channel.manualOverride,
  })).filter((candidate) => candidate.sourceModel.length > 0);
}

async function populateRouteChannelsByModelPattern(routeId: number, modelPattern: string): Promise<number> {
  const routeCandidates = await getMatchedExactRouteChannelCandidates(modelPattern);
  const availabilityCandidates = (await getPatternTokenCandidates(modelPattern)).map((candidate) => ({
    tokenId: candidate.tokenId,
    accountId: candidate.accountId,
    sourceModel: candidate.sourceModel,
    priority: 0,
    weight: 10,
    enabled: true,
    manualOverride: false,
  }));
  const candidates = [...routeCandidates, ...availabilityCandidates];
  if (candidates.length === 0) return 0;

  const existingChannels = await db.select().from(schema.routeChannels)
    .where(eq(schema.routeChannels.routeId, routeId))
    .all();
  const existingPairs = new Set<string>(
    existingChannels
      .map((channel) => {
        const tokenId = typeof channel.tokenId === 'number' && Number.isFinite(channel.tokenId) ? channel.tokenId : 0;
        const sourceModel = (channel.sourceModel || '').trim().toLowerCase();
        return `${channel.accountId}::${tokenId}::${sourceModel}`;
      }),
  );

  let created = 0;
  for (const candidate of candidates) {
    const tokenId = typeof candidate.tokenId === 'number' && Number.isFinite(candidate.tokenId) ? candidate.tokenId : 0;
    const pairKey = `${candidate.accountId}::${tokenId}::${candidate.sourceModel.trim().toLowerCase()}`;
    if (existingPairs.has(pairKey)) continue;
    await db.insert(schema.routeChannels).values({
      routeId,
      accountId: candidate.accountId,
      tokenId: candidate.tokenId,
      sourceModel: candidate.sourceModel,
      priority: candidate.priority,
      weight: candidate.weight,
      enabled: candidate.enabled,
      manualOverride: candidate.manualOverride,
    }).run();
    existingPairs.add(pairKey);
    created += 1;
  }

  return created;
}

async function rebuildAutomaticRouteChannelsByModelPattern(routeId: number, modelPattern: string): Promise<{
  removedChannels: number;
  createdChannels: number;
}> {
  const removableChannels = await db.select().from(schema.routeChannels)
    .where(
      and(
        eq(schema.routeChannels.routeId, routeId),
        eq(schema.routeChannels.manualOverride, false),
      ),
    )
    .all();

  for (const channel of removableChannels) {
    await db.delete(schema.routeChannels).where(eq(schema.routeChannels.id, channel.id)).run();
  }

  const createdChannels = await populateRouteChannelsByModelPattern(routeId, modelPattern);
  return {
    removedChannels: removableChannels.length,
    createdChannels,
  };
}

type BatchChannelPriorityUpdate = {
  id: number;
  priority: number;
};

type BatchRouteDecisionModels = {
  models: string[];
  refreshPricingCatalog?: boolean;
  persistSnapshots?: boolean;
};

type BatchRouteDecisionRouteModels = {
  items: Array<{
    routeId: number;
    model: string;
  }>;
  refreshPricingCatalog?: boolean;
  persistSnapshots?: boolean;
};

type BatchRouteWideDecisionRouteIds = {
  routeIds: number[];
  refreshPricingCatalog?: boolean;
  persistSnapshots?: boolean;
};

function parseBatchChannelUpdates(input: unknown): { ok: true; updates: BatchChannelPriorityUpdate[] } | { ok: false; message: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, message: '请求体必须是对象' };
  }

  const updates = (input as { updates?: unknown }).updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return { ok: false, message: 'updates 必须是非空数组' };
  }

  const normalized: BatchChannelPriorityUpdate[] = [];
  for (let index = 0; index < updates.length; index += 1) {
    const item = updates[index];
    if (!item || typeof item !== 'object') {
      return { ok: false, message: `updates[${index}] 必须是对象` };
    }

    const { id, priority } = item as { id?: unknown; priority?: unknown };
    if (typeof id !== 'number' || !Number.isFinite(id)) {
      return { ok: false, message: `updates[${index}].id 必须是有限数字` };
    }
    if (typeof priority !== 'number' || !Number.isFinite(priority)) {
      return { ok: false, message: `updates[${index}].priority 必须是有限数字` };
    }

    const normalizedId = Math.trunc(id);
    if (normalizedId <= 0) {
      return { ok: false, message: `updates[${index}].id 必须大于 0` };
    }

    normalized.push({
      id: normalizedId,
      priority: Math.max(0, Math.trunc(priority)),
    });
  }

  return { ok: true, updates: normalized };
}

function parseBatchRouteDecisionModels(
  input: unknown,
): { ok: true; models: string[]; refreshPricingCatalog: boolean; persistSnapshots: boolean } | { ok: false; message: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, message: '请求体必须是对象' };
  }

  const models = (input as BatchRouteDecisionModels).models;
  if (!Array.isArray(models) || models.length === 0) {
    return { ok: false, message: 'models 必须是非空数组' };
  }

  const dedupe = new Set<string>();
  const normalized: string[] = [];
  for (const raw of models) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || dedupe.has(trimmed)) continue;
    dedupe.add(trimmed);
    normalized.push(trimmed);
    if (normalized.length >= 500) break;
  }

  if (normalized.length === 0) {
    return { ok: false, message: 'models 中没有有效模型名称' };
  }

  return {
    ok: true,
    models: normalized,
    refreshPricingCatalog: (input as { refreshPricingCatalog?: unknown }).refreshPricingCatalog === true,
    persistSnapshots: (input as { persistSnapshots?: unknown }).persistSnapshots === true,
  };
}

function parseBatchRouteDecisionRouteModels(
  input: unknown,
): { ok: true; items: Array<{ routeId: number; model: string }>; refreshPricingCatalog: boolean; persistSnapshots: boolean } | { ok: false; message: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, message: '请求体必须是对象' };
  }

  const items = (input as BatchRouteDecisionRouteModels).items;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, message: 'items 必须是非空数组' };
  }

  const dedupe = new Set<string>();
  const normalized: Array<{ routeId: number; model: string }> = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const routeIdRaw = (item as { routeId?: unknown }).routeId;
    const modelRaw = (item as { model?: unknown }).model;
    if (typeof routeIdRaw !== 'number' || !Number.isFinite(routeIdRaw)) continue;
    if (typeof modelRaw !== 'string') continue;

    const routeId = Math.trunc(routeIdRaw);
    const model = modelRaw.trim();
    if (routeId <= 0 || !model) continue;

    const key = `${routeId}::${model}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    normalized.push({ routeId, model });
    if (normalized.length >= 500) break;
  }

  if (normalized.length === 0) {
    return { ok: false, message: 'items 中没有有效 routeId/model' };
  }

  return {
    ok: true,
    items: normalized,
    refreshPricingCatalog: (input as { refreshPricingCatalog?: unknown }).refreshPricingCatalog === true,
    persistSnapshots: (input as { persistSnapshots?: unknown }).persistSnapshots === true,
  };
}

function parseBatchRouteWideDecisionRouteIds(
  input: unknown,
): { ok: true; routeIds: number[]; refreshPricingCatalog: boolean; persistSnapshots: boolean } | { ok: false; message: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, message: '请求体必须是对象' };
  }

  const routeIds = (input as BatchRouteWideDecisionRouteIds).routeIds;
  if (!Array.isArray(routeIds) || routeIds.length === 0) {
    return { ok: false, message: 'routeIds 必须是非空数组' };
  }

  const dedupe = new Set<number>();
  const normalized: number[] = [];
  for (const raw of routeIds) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const routeId = Math.trunc(raw);
    if (routeId <= 0 || dedupe.has(routeId)) continue;
    dedupe.add(routeId);
    normalized.push(routeId);
    if (normalized.length >= 500) break;
  }

  if (normalized.length === 0) {
    return { ok: false, message: 'routeIds 中没有有效 routeId' };
  }

  return {
    ok: true,
    routeIds: normalized,
    refreshPricingCatalog: (input as { refreshPricingCatalog?: unknown }).refreshPricingCatalog === true,
    persistSnapshots: (input as { persistSnapshots?: unknown }).persistSnapshots === true,
  };
}

type RouteChannelSummary = {
  channelCount: number;
  enabledChannelCount: number;
  siteNames: Set<string>;
};

async function fetchChannelsForRouteRows(
  routes: RouteRow[],
  options: {
    includeRouteUnitDetails?: boolean;
  } = {},
): Promise<Map<number, any[]>> {
  if (routes.length === 0) return new Map();
  const includeRouteUnitDetails = options.includeRouteUnitDetails !== false;

  const explicitSourceRouteIds = Array.from(new Set(routes
    .filter((route) => isExplicitGroupRoute(route))
    .flatMap((route) => route.sourceRouteIds)));
  const explicitSourceRoutes = explicitSourceRouteIds.length > 0
    ? await decorateRoutesWithSources(await db.select().from(schema.tokenRoutes)
      .where(inArray(schema.tokenRoutes.id, explicitSourceRouteIds))
      .all())
    : [];
  const enabledExplicitSourceRouteIds = explicitSourceRoutes
    .filter((route) => route.enabled && !isExplicitGroupRoute(route) && isRouteGraphExactModelMatch(route.match, route.backend))
    .map((route) => route.id);
  const actualRouteIds = Array.from(new Set([
    ...routes.filter((route) => !isExplicitGroupRoute(route)).map((route) => route.id),
    ...enabledExplicitSourceRouteIds,
  ]));
  if (actualRouteIds.length === 0) {
    return new Map(routes.map((route) => [route.id, []]));
  }

  const actualRouteById = new Map<number, RouteRow>();
  for (const route of routes.filter((item) => !isExplicitGroupRoute(item))) {
    actualRouteById.set(route.id, route);
  }
  for (const route of explicitSourceRoutes) {
    actualRouteById.set(route.id, route);
  }

  const channelRows = await db.select().from(schema.routeChannels)
    .innerJoin(schema.accounts, eq(schema.routeChannels.accountId, schema.accounts.id))
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .leftJoin(schema.accountTokens, eq(schema.routeChannels.tokenId, schema.accountTokens.id))
    .where(inArray(schema.routeChannels.routeId, actualRouteIds))
    .all();

  const oauthRouteUnitIds: number[] = Array.from(new Set<number>(
    channelRows
      .map((row) => Number(row.route_channels.oauthRouteUnitId))
      .filter((id): id is number => Number.isFinite(id) && id > 0),
  ));
  const routeUnitSummaries = includeRouteUnitDetails
    ? await loadOauthRouteUnitSummariesByIds(oauthRouteUnitIds)
    : new Map();
  const routeUnitMembersByUnitId = includeRouteUnitDetails
    ? await listOauthRouteUnitMembersByUnitIds(oauthRouteUnitIds)
    : new Map();

  const channelsByActualRouteId = new Map<number, any[]>();

  for (const row of channelRows) {
    const routeId = row.route_channels.routeId;
    const actualRoute = actualRouteById.get(routeId);
    const fallbackSourceModel = actualRoute && !isExplicitGroupRoute(actualRoute) && isRouteGraphExactModelMatch(actualRoute.match, actualRoute.backend)
      ? actualRoute.modelPattern
      : null;
    const resolvedSourceModel = (row.route_channels.sourceModel || fallbackSourceModel || '').trim();
    if (!channelsByActualRouteId.has(routeId)) channelsByActualRouteId.set(routeId, []);
    const routeUnit = row.route_channels.oauthRouteUnitId
      ? routeUnitSummaries.get(row.route_channels.oauthRouteUnitId) || null
      : null;
    channelsByActualRouteId.get(routeId)!.push({
      ...row.route_channels,
      sourceModel: resolvedSourceModel || null,
      account: row.accounts,
      site: row.sites,
      token: row.account_tokens
        ? {
          id: row.account_tokens.id,
          name: row.account_tokens.name,
          accountId: row.account_tokens.accountId,
          enabled: row.account_tokens.enabled,
          isDefault: row.account_tokens.isDefault,
        }
        : null,
      routeUnit: includeRouteUnitDetails && routeUnit
        ? {
          id: routeUnit.id,
          name: routeUnit.name,
          strategy: routeUnit.strategy,
          memberCount: routeUnit.memberCount,
          members: (routeUnitMembersByUnitId.get(routeUnit.id) || []).map((member) => ({
            accountId: member.account.id,
            username: member.account.username,
            siteName: member.site.name,
          })),
        }
        : null,
    });
  }

  const channelsByRoute = new Map<number, any[]>();
  for (const route of routes) {
    if (isExplicitGroupRoute(route)) {
      channelsByRoute.set(route.id, route.sourceRouteIds.flatMap((sourceRouteId) => channelsByActualRouteId.get(sourceRouteId) || []));
      continue;
    }
    channelsByRoute.set(route.id, channelsByActualRouteId.get(route.id) || []);
  }

  return channelsByRoute;
}

async function fetchChannelsForRoutes(routeIds: number[]): Promise<Map<number, any[]>> {
  if (routeIds.length === 0) return new Map();
  return await fetchChannelsForRouteRows(await listRoutesWithSources()).then((channelsByRoute) => {
    const filtered = new Map<number, any[]>();
    for (const routeId of routeIds) {
      filtered.set(routeId, channelsByRoute.get(routeId) || []);
    }
    return filtered;
  });
}

async function buildRouteChannelSummaryMap(routes: RouteRow[]): Promise<Map<number, RouteChannelSummary>> {
  const channelsByRoute = await fetchChannelsForRouteRows(routes, { includeRouteUnitDetails: false });
  const summaryByRoute = new Map<number, RouteChannelSummary>();
  for (const route of routes) {
    const channels = channelsByRoute.get(route.id) || [];
    const siteNames = new Set<string>();
    let enabledChannelCount = 0;
    for (const channel of channels) {
      if (channel.enabled) enabledChannelCount += 1;
      if (channel.site?.name) siteNames.add(channel.site.name);
    }
    summaryByRoute.set(route.id, {
      channelCount: channels.length,
      enabledChannelCount,
      siteNames,
    });
  }
  return summaryByRoute;
}

export async function tokensRoutes(app: FastifyInstance) {
  app.get('/api/route-graph/active', async () => {
    const active = await ensureActiveRouteGraphVersion();
    return {
      version: {
        id: active.id,
        version: active.version,
        status: active.status,
        createdAt: active.createdAt,
        activatedAt: active.activatedAt,
      },
      sourceGraph: active.sourceGraph,
      compiledGraph: active.compiledGraph,
    };
  });

  app.get('/api/route-graph/draft', async () => {
    const active = await ensureActiveRouteGraphVersion();
    const currentDraft = await getRouteGraphDraft();
    const draft = currentDraft.stale ? await rebaseRouteGraphDraft() : currentDraft;
    return {
      activeVersion: {
        id: active.id,
        version: active.version,
        status: active.status,
        createdAt: active.createdAt,
        activatedAt: active.activatedAt,
      },
      draft,
    };
  });

  app.post<{ Body: unknown }>('/api/route-graph/validate', async (request, reply) => {
    const parsedBody = parseRouteGraphSourcePayload(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ success: false, message: parsedBody.error });
    }
    const result = await validateRouteGraphDraft(parsedBody.data);
    return {
      ok: result.ok,
      diagnostics: result.diagnostics,
      compiledGraph: result.compiled,
    };
  });

  app.put<{ Body: unknown }>('/api/route-graph/draft', async (request, reply) => {
    const parsedBody = parseRouteGraphSourcePayload(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ success: false, message: parsedBody.error });
    }
    const normalizedGraph = normalizeRouteGraphSource(parsedBody.data);
    const draft = await saveRouteGraphDraft({
      ...normalizedGraph,
    });
    return {
      success: true,
      draft,
    };
  });

  app.post('/api/route-graph/draft/publish', async (_request, reply) => {
    const result = await publishRouteGraphDraft();
    if (!result.ok) {
      return reply.code(result.stale ? 409 : 400).send({
        success: false,
        stale: result.stale || false,
        diagnostics: result.diagnostics,
      });
    }
    invalidateTokenRouterCache();
    return {
      success: true,
      version: result.version,
      diagnostics: result.diagnostics,
    };
  });

  app.post('/api/route-graph/draft/rebase', async () => {
    const draft = await rebaseRouteGraphDraft();
    return { success: true, draft };
  });

  app.delete('/api/route-graph/draft', async () => {
    await discardRouteGraphDraft();
    return { success: true };
  });

  app.post<{ Body: unknown }>('/api/route-graph/compile', async (request, reply) => {
    const parsedBody = parseRouteGraphSourcePayload(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ success: false, message: parsedBody.error });
    }
    return compileRouteGraphSource(parsedBody.data);
  });

  // List routes with basic info only (lightweight for selectors)
  app.get('/api/routes/lite', async () => {
    return (await listRoutesWithSources()).map((route) => ({
      ...routeToGraphResponseBase(route),
    }));
  });

  // Route summary (no channel details) for first-screen rendering
  app.get('/api/routes/summary', async (request, reply) => {
    try {
      await routeSummaryReadLimiter.consume(request.ip);
    } catch (error) {
      sendTokenRouteRateLimit(reply, error);
      return;
    }
    const routes = await listRoutesWithSources();
    if (routes.length === 0) return [];
    const aggByRoute = await buildRouteChannelSummaryMap(routes);

    return routes.map((route) => {
      const agg = aggByRoute.get(route.id);
      return {
        ...routeToGraphResponseBase(route),
        channelCount: agg?.channelCount ?? 0,
        enabledChannelCount: agg?.enabledChannelCount ?? 0,
        siteNames: agg ? Array.from(agg.siteNames) : [],
        decisionSnapshot: parseRouteDecisionSnapshot(route.decisionSnapshot),
        decisionRefreshedAt: route.decisionRefreshedAt ?? null,
      };
    });
  });

  // Get channels for a single route (on-demand loading)
  app.get<{ Params: { id: string } }>('/api/routes/:id/channels', async (request, reply) => {
    const routeId = parseInt(request.params.id, 10);
    const route = await getRouteWithSources(routeId);
    if (!route) {
      return reply.code(404).send({ success: false, message: '路由不存在' });
    }
    const channelsByRoute = await fetchChannelsForRouteRows([route]);
    return channelsByRoute.get(routeId) || [];
  });

  app.post<{ Params: { id: string } }>('/api/routes/:id/cooldown/clear', async (request, reply) => {
    const routeId = parseInt(request.params.id, 10);
    const result = await clearRouteCooldown(routeId);
    if (!result) {
      return reply.code(404).send({ success: false, message: '路由不存在' });
    }
    return result;
  });

  // Batch add channels to a route
  app.post<{ Params: { id: string }; Body: unknown }>('/api/routes/:id/channels/batch', async (request, reply) => {
    const parsedBody = parseRouteChannelBatchCreatePayload(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ success: false, message: parsedBody.error });
    }

    const routeId = parseInt(request.params.id, 10);
    const body = parsedBody.data;

    const route = await getRouteWithSources(routeId);
    if (!route) {
      return reply.code(404).send({ success: false, message: '路由不存在' });
    }
    if (isExplicitGroupRoute(route)) {
      return reply.code(400).send({ success: false, message: '显式群组不支持直接维护通道' });
    }

    const existingChannels = await db.select().from(schema.routeChannels)
      .where(eq(schema.routeChannels.routeId, routeId))
      .all();
    const existingPairs = new Set<string>(
      existingChannels.map((channel) => {
        const tokenId = typeof channel.tokenId === 'number' && Number.isFinite(channel.tokenId) ? channel.tokenId : 0;
        const sourceModel = (channel.sourceModel || '').trim().toLowerCase();
        return `${channel.accountId}::${tokenId}::${sourceModel}`;
      }),
    );

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const item of body.channels) {
      const sourceModel = typeof item.sourceModel === 'string'
        ? item.sourceModel.trim()
        : (isExactModelPattern(route.modelPattern) ? route.modelPattern.trim() : '');
      const effectiveTokenId = item.tokenId ?? await getDefaultTokenId(item.accountId);

      if (item.tokenId && !await checkTokenBelongsToAccount(item.tokenId, item.accountId)) {
        errors.push(`令牌 ${item.tokenId} 不属于账号 ${item.accountId}`);
        continue;
      }

      const tokenIdForKey = typeof effectiveTokenId === 'number' && Number.isFinite(effectiveTokenId) ? effectiveTokenId : 0;
      const pairKey = `${item.accountId}::${tokenIdForKey}::${sourceModel.toLowerCase()}`;
      if (existingPairs.has(pairKey)) {
        skipped += 1;
        continue;
      }

      try {
        await db.insert(schema.routeChannels).values({
          routeId,
          accountId: item.accountId,
          tokenId: effectiveTokenId,
          sourceModel: sourceModel || null,
          priority: 0,
          weight: 10,
          manualOverride: true,
        }).run();
        existingPairs.add(pairKey);
        created += 1;
      } catch (e: any) {
        errors.push(e.message || `添加通道失败: accountId=${item.accountId}`);
      }
    }

    if (created > 0) {
      await clearRouteDecisionSnapshot(routeId);
      await clearDependentExplicitGroupSnapshotsBySourceRouteIds([routeId]);
      invalidateTokenRouterCache();
    }

    return { success: true, created, skipped, errors };
  });

  // List all routes
  app.get('/api/routes', async (request, reply) => {
    try {
      await routeListReadLimiter.consume(request.ip);
    } catch (error) {
      sendTokenRouteRateLimit(reply, error);
      return;
    }
    const routes = await listRoutesWithSources();
    if (routes.length === 0) return [];

    const channelsByRoute = await fetchChannelsForRouteRows(routes);

    return routes.map((route) => ({
      ...routeToGraphResponseBase(route),
      decisionSnapshot: parseRouteDecisionSnapshot(route.decisionSnapshot),
      decisionRefreshedAt: route.decisionRefreshedAt ?? null,
      channels: channelsByRoute.get(route.id) || [],
    }));
  });

  app.get<{ Querystring: { model?: string } }>('/api/routes/decision', async (request, reply) => {
    const model = (request.query.model || '').trim();
    if (!model) {
      return reply.code(400).send({ success: false, message: 'model 不能为空' });
    }

    const decision = await tokenRouter.explainSelection(model);
    return { success: true, decision };
  });

  app.post<{ Body: BatchRouteDecisionModels }>('/api/routes/decision/batch', async (request, reply) => {
    const parsed = parseBatchRouteDecisionModels(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ success: false, message: parsed.message });
    }

    const decisions: Record<string, Awaited<ReturnType<typeof tokenRouter.explainSelection>>> = {};
    const routes = parsed.persistSnapshots
      ? await decorateRoutesWithSources(await db.select().from(schema.tokenRoutes).all())
      : [];
    const refreshedKeys = parsed.refreshPricingCatalog ? new Set<string>() : undefined;
    for (const model of parsed.models) {
      if (parsed.refreshPricingCatalog) {
        await tokenRouter.refreshPricingReferenceCosts(model, { refreshedKeys });
      }
      decisions[model] = await tokenRouter.explainSelection(model);
    }

    if (parsed.persistSnapshots) {
      const snapshotWrites: Array<{ routeId: number; snapshot: unknown }> = [];
      for (const model of parsed.models) {
        const decision = decisions[model];
        for (const route of routes) {
          if (!isRouteGraphExactModelMatch(route.match, route.backend)) continue;
          if (!matchesModelPattern(model, route.modelPattern)) continue;
          snapshotWrites.push({ routeId: route.id, snapshot: decision });
        }
      }
      await saveRouteDecisionSnapshots(snapshotWrites);
    }

    return { success: true, decisions };
  });

  app.post<{ Body: BatchRouteDecisionRouteModels }>('/api/routes/decision/by-route/batch', async (request, reply) => {
    const parsed = parseBatchRouteDecisionRouteModels(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ success: false, message: parsed.message });
    }

    const decisions: Record<string, Record<string, Awaited<ReturnType<typeof tokenRouter.explainSelectionForRoute>>>> = {};
    const refreshedKeys = parsed.refreshPricingCatalog ? new Set<string>() : undefined;
    for (const item of parsed.items) {
      const routeKey = String(item.routeId);
      if (!decisions[routeKey]) decisions[routeKey] = {};
      if (parsed.refreshPricingCatalog) {
        await tokenRouter.refreshPricingReferenceCostsForRoute(item.routeId, item.model, { refreshedKeys });
      }
      decisions[routeKey][item.model] = await tokenRouter.explainSelectionForRoute(item.routeId, item.model);
    }

    if (parsed.persistSnapshots) {
      await saveRouteDecisionSnapshots(parsed.items.map((item) => ({
        routeId: item.routeId,
        snapshot: decisions[String(item.routeId)]?.[item.model] ?? null,
      })));
    }

    return { success: true, decisions };
  });

  app.post<{ Body: BatchRouteWideDecisionRouteIds }>('/api/routes/decision/route-wide/batch', async (request, reply) => {
    const parsed = parseBatchRouteWideDecisionRouteIds(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ success: false, message: parsed.message });
    }

    const decisions: Record<string, Awaited<ReturnType<typeof tokenRouter.explainSelectionRouteWide>>> = {};
    const refreshedKeys = parsed.refreshPricingCatalog ? new Set<string>() : undefined;
    for (const routeId of parsed.routeIds) {
      if (parsed.refreshPricingCatalog) {
        await tokenRouter.refreshRouteWidePricingReferenceCosts(routeId, { refreshedKeys });
      }
      decisions[String(routeId)] = await tokenRouter.explainSelectionRouteWide(routeId);
    }

    if (parsed.persistSnapshots) {
      await saveRouteDecisionSnapshots(parsed.routeIds.map((routeId) => ({
        routeId,
        snapshot: decisions[String(routeId)] ?? null,
      })));
    }

    return { success: true, decisions };
  });

  app.post('/api/routes/decision/refresh', async (_request, reply) => {
    let taskId = '';
    const { task, reused } = startBackgroundTask(
      {
        type: ROUTE_DECISION_REFRESH_TASK_TYPE,
        title: '刷新路由选中概率',
        dedupeKey: ROUTE_DECISION_REFRESH_DEDUPE_KEY,
        successMessage: (currentTask) => {
          const result = currentTask.result as { exactModelCount?: number; wildcardRouteCount?: number } | null;
          const exactModelCount = result?.exactModelCount ?? 0;
          const wildcardRouteCount = result?.wildcardRouteCount ?? 0;
          return `路由选中概率刷新完成：精确模型 ${exactModelCount}，通配符路由 ${wildcardRouteCount}`;
        },
        failureMessage: (currentTask) => `路由选中概率刷新失败：${currentTask.error || 'unknown error'}`,
      },
      async () => {
        await Promise.resolve();
        return await refreshAllRouteDecisionSnapshots({
          refreshPricingCatalog: true,
          onProgress: (message) => {
            appendBackgroundTaskLog(taskId, message);
          },
        });
      },
    );
    taskId = task.id;

    return reply.code(202).send({
      success: true,
      queued: true,
      reused,
      jobId: task.id,
      status: task.status,
      message: reused
        ? '路由选中概率刷新任务执行中，可稍后返回查看'
        : '已开始后台刷新路由选中概率，可稍后返回查看',
    });
  });

  // Create a route
  app.post<{ Body: unknown }>('/api/routes', async (request, reply) => {
    const parsedBody = parseTokenRouteCreatePayload(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ success: false, message: parsedBody.error });
    }

    const body = parsedBody.data;
    let match = normalizeRouteGraphMatchSpec(body.match);
    let backend = normalizeRouteGraphBackendSpec(body.backend);
    let presentation = normalizeGraphRoutePresentation(body.presentation);
    const macroProjection = projectRoutePayloadFromMacro(body.macro as RouteGraphMacro | undefined, {
      id: 0,
      displayName: presentation.displayName ?? match.displayName ?? null,
      displayIcon: presentation.displayIcon,
      match,
      backend,
      routingStrategy: normalizeRouteRoutingStrategy(body.routingStrategy),
    });
    if (body.macro) {
      match = macroProjection.match;
      backend = macroProjection.backend;
      presentation = macroProjection.presentation;
    }
    const displayName = presentation.displayName ?? match.displayName ?? null;
    const sourceRouteIds = backend.kind === 'routes' ? backend.routeIds : [];
    const normalizedRoutingStrategy = normalizeRouteRoutingStrategy(body.routingStrategy);
    const modelPattern = match.requestedModelPattern.trim();

    if (backend.kind === 'routes') {
      if (!displayName) {
        return reply.code(400).send({ success: false, message: 'Route backend 必须填写对外模型名' });
      }
      const validation = await validateExplicitGroupSourceRoutes(sourceRouteIds);
      if (!validation.ok) {
        return reply.code(400).send({ success: false, message: validation.message });
      }
    } else if (!modelPattern) {
      return reply.code(400).send({ success: false, message: '模型匹配不能为空' });
    }

    const insertedRoute = await db.insert(schema.tokenRoutes).values({
      displayName,
      displayIcon: presentation.displayIcon,
      modelMapping: body.modelMapping,
      routingStrategy: normalizedRoutingStrategy,
      enabled: body.enabled ?? true,
    }).run();
    const routeId = requireInsertedRowId(insertedRoute, '创建路由失败');
    const route = await getRouteWithSources(routeId);
    if (!route) {
      return { success: false, message: '创建路由失败' };
    }

    if (backend.kind === 'routes') {
      await publishRouteProjectionUpdate({
        routeId: route.id,
        match,
        backend,
        displayName,
        routingStrategy: normalizedRoutingStrategy,
        enabled: body.enabled ?? true,
      });
      const syncedRouteIds = await syncExplicitGroupSourceRouteStrategies({
        groupRouteId: route.id,
        sourceRouteIds,
        targetStrategy: normalizedRoutingStrategy,
      });
      if (syncedRouteIds.length > 0) {
        await clearRouteDecisionSnapshots(syncedRouteIds);
        await clearDependentExplicitGroupSnapshotsBySourceRouteIds(syncedRouteIds);
      }
    } else {
      await populateRouteChannelsByModelPattern(route.id, modelPattern);
      await publishRouteProjectionUpdate({
        routeId: route.id,
        match,
        backend,
        displayName,
        routingStrategy: normalizedRoutingStrategy,
        enabled: body.enabled ?? true,
      });
    }
    invalidateTokenRouterCache();
    const createdRoute = await getRouteWithSources(routeId);
    return createdRoute ? routeToGraphResponseBase(createdRoute) : null;
  });

  // Update a route
  app.put<{ Params: { id: string }; Body: unknown }>('/api/routes/:id', async (request, reply) => {
    const parsedBody = parseTokenRouteUpdatePayload(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ success: false, message: parsedBody.error });
    }

    const id = parseInt(request.params.id, 10);
    const body = parsedBody.data;
    const existingRoute = await getRouteWithSources(id);
    if (!existingRoute) {
      return reply.code(404).send({ success: false, message: '路由不存在' });
    }

    const updates: Record<string, unknown> = {};
    const previousBackend = normalizeRouteGraphBackendSpec(existingRoute.backend);
    let nextMatch = normalizeRouteGraphMatchSpec(existingRoute.match);
    let nextBackend = previousBackend;
    let nextPresentation: GraphRoutePresentation = {
      displayName: existingRoute.displayName ?? existingRoute.match.displayName ?? null,
      displayIcon: existingRoute.displayIcon ?? null,
    };
    const previousRoutingStrategy = normalizeRouteRoutingStrategy(existingRoute.routingStrategy);
    let nextRoutingStrategy = previousRoutingStrategy;

    if (body.match !== undefined) {
      nextMatch = normalizeRouteGraphMatchSpec({
        ...nextMatch,
        ...body.match,
      });
    }
    if (body.backend !== undefined) {
      nextBackend = normalizeRouteGraphBackendSpec(body.backend);
    }
    if (body.presentation !== undefined) {
      nextPresentation = normalizeGraphRoutePresentation({
        ...nextPresentation,
        ...body.presentation,
      });
    }
    if (body.macro !== undefined) {
      const macroProjection = projectRoutePayloadFromMacro(body.macro as RouteGraphMacro | undefined, {
        id,
        displayName: nextPresentation.displayName ?? nextMatch.displayName ?? null,
        displayIcon: nextPresentation.displayIcon,
        match: nextMatch,
        backend: nextBackend,
        routingStrategy: nextRoutingStrategy,
      });
      nextMatch = macroProjection.match;
      nextBackend = macroProjection.backend;
      nextPresentation = macroProjection.presentation;
      nextRoutingStrategy = macroProjection.routingStrategy;
      updates.routingStrategy = nextRoutingStrategy;
    }

    const nextDisplayName = nextPresentation.displayName ?? nextMatch.displayName ?? null;
    const nextModelPattern = nextMatch.requestedModelPattern.trim();
    const nextSourceRouteIds = nextBackend.kind === 'routes' ? nextBackend.routeIds : [];

    if (nextBackend.kind === 'routes') {
      if (!nextDisplayName) {
        return reply.code(400).send({ success: false, message: 'Route backend 必须填写对外模型名' });
      }
      const validation = await validateExplicitGroupSourceRoutes(nextSourceRouteIds, id);
      if (!validation.ok) {
        return reply.code(400).send({ success: false, message: validation.message });
      }
    } else if (!nextModelPattern) {
      return reply.code(400).send({ success: false, message: '模型匹配不能为空' });
    }

    updates.displayName = nextDisplayName;
    updates.displayIcon = nextPresentation.displayIcon;
    if (body.modelMapping !== undefined) updates.modelMapping = body.modelMapping;
    if (body.routingStrategy !== undefined) {
      nextRoutingStrategy = normalizeRouteRoutingStrategy(body.routingStrategy);
      updates.routingStrategy = nextRoutingStrategy;
    }
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    updates.updatedAt = new Date().toISOString();

    await db.update(schema.tokenRoutes).set(updates).where(eq(schema.tokenRoutes.id, id)).run();
    const modelPatternChanged = nextModelPattern !== existingRoute.match.requestedModelPattern;
    if (nextBackend.kind === 'channels' && modelPatternChanged) {
      await rebuildAutomaticRouteChannelsByModelPattern(id, nextModelPattern);
    }
    await publishRouteProjectionUpdate({
      routeId: id,
      match: nextMatch,
      backend: nextBackend,
      displayName: nextDisplayName,
      routingStrategy: nextRoutingStrategy,
      enabled: body.enabled ?? existingRoute.enabled !== false,
    });
    const shouldSyncExplicitGroupSources = (
      nextBackend.kind === 'routes'
      && (body.routingStrategy !== undefined || body.backend !== undefined)
    );
    let syncedSourceRouteIds: number[] = [];
    if (shouldSyncExplicitGroupSources) {
      syncedSourceRouteIds = await syncExplicitGroupSourceRouteStrategies({
        groupRouteId: id,
        sourceRouteIds: nextSourceRouteIds,
        targetStrategy: nextRoutingStrategy,
        previousStrategy: previousRoutingStrategy,
      });
    }
    const backendChanged = JSON.stringify(nextBackend) !== JSON.stringify(previousBackend);
    const routeBehaviorChanged = modelPatternChanged
      || backendChanged
      || body.match !== undefined
      || body.modelMapping !== undefined
      || body.routingStrategy !== undefined
      || body.enabled !== undefined;
    if (routeBehaviorChanged) {
      await clearRouteDecisionSnapshot(id);
      await clearDependentExplicitGroupSnapshotsBySourceRouteIds([id]);
    }
    if (syncedSourceRouteIds.length > 0) {
      await clearRouteDecisionSnapshots(syncedSourceRouteIds);
      await clearDependentExplicitGroupSnapshotsBySourceRouteIds(syncedSourceRouteIds);
    }
    invalidateTokenRouterCache();
    const updatedRoute = await getRouteWithSources(id);
    return updatedRoute ? routeToGraphResponseBase(updatedRoute) : null;
  });

  // Delete a route
  app.delete<{ Params: { id: string } }>('/api/routes/:id', async (request) => {
    const id = parseInt(request.params.id, 10);
    await clearDependentExplicitGroupSnapshotsBySourceRouteIds([id]);
    await db.delete(schema.tokenRoutes).where(eq(schema.tokenRoutes.id, id)).run();
    await publishRouteProjectionDelete(id);
    invalidateTokenRouterCache();
    return { success: true };
  });


  // Batch update routes (enable/disable)
  app.post<{ Body: unknown }>('/api/routes/batch', async (request, reply) => {
    const parsedBody = parseTokenRouteBatchPayload(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ success: false, message: parsedBody.error });
    }
    const body = parsedBody.data;
    const action = body.action;
    if (action !== 'enable' && action !== 'disable') {
      return reply.code(400).send({ success: false, message: 'action 必须是 enable 或 disable' });
    }
    const rawIds = body.ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return reply.code(400).send({ success: false, message: 'ids 必须是非空数组' });
    }
    const dedupe = new Set<number>();
    const ids: number[] = [];
    for (const raw of rawIds) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      const id = Math.trunc(raw);
      if (id <= 0 || dedupe.has(id)) continue;
      dedupe.add(id);
      ids.push(id);
      if (ids.length >= 500) break;
    }
    if (ids.length === 0) {
      return reply.code(400).send({ success: false, message: 'ids 中没有有效的路由 ID' });
    }

    const enabled = action === 'enable';
    const now = new Date().toISOString();
    const updateResult = await db.update(schema.tokenRoutes)
      .set({ enabled, updatedAt: now })
      .where(inArray(schema.tokenRoutes.id, ids))
      .run();

    await clearRouteDecisionSnapshots(ids);
    await clearDependentExplicitGroupSnapshotsBySourceRouteIds(ids);
    invalidateTokenRouterCache();

    return { success: true, updatedCount: Number(updateResult?.changes || 0) };
  });
  // Add a channel to a route
  app.post<{ Params: { id: string }; Body: unknown }>('/api/routes/:id/channels', async (request, reply) => {
    const parsedBody = parseRouteChannelCreatePayload(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ success: false, message: parsedBody.error });
    }

    const routeId = parseInt(request.params.id, 10);
    const body = parsedBody.data;

    const route = await getRouteWithSources(routeId);
    if (!route) {
      return reply.code(404).send({ success: false, message: '路由不存在' });
    }
    if (isExplicitGroupRoute(route)) {
      return reply.code(400).send({ success: false, message: '显式群组不支持直接维护通道' });
    }

    const sourceModel = typeof body.sourceModel === 'string'
      ? body.sourceModel.trim()
      : (isExactModelPattern(route.modelPattern) ? route.modelPattern.trim() : '');
    const effectiveTokenId = body.tokenId ?? await getDefaultTokenId(body.accountId);

    if (body.tokenId && !await checkTokenBelongsToAccount(body.tokenId, body.accountId)) {
      return reply.code(400).send({ success: false, message: '令牌不存在或不属于当前账号' });
    }

    if (isExactModelPattern(route.modelPattern) && effectiveTokenId && !await tokenSupportsModel(effectiveTokenId, route.modelPattern)) {
      return reply.code(400).send({ success: false, message: '该令牌不支持当前模型' });
    }

    const duplicate = (await db.select().from(schema.routeChannels)
      .where(eq(schema.routeChannels.routeId, routeId))
      .all())
      .some((channel) =>
        channel.accountId === body.accountId
        && (channel.tokenId ?? null) === (body.tokenId ?? null)
        && (channel.sourceModel || '').trim().toLowerCase() === sourceModel.toLowerCase(),
      );
    if (duplicate) {
      return reply.code(400).send({ success: false, message: '该来源模型的通道已存在' });
    }

    const insertedChannel = await db.insert(schema.routeChannels).values({
      routeId,
      accountId: body.accountId,
      tokenId: body.tokenId,
      sourceModel: sourceModel || null,
      priority: body.priority ?? 0,
      weight: body.weight ?? 10,
    }).run();
    const channelId = requireInsertedRowId(insertedChannel, '创建通道失败');
    const created = await db.select().from(schema.routeChannels).where(eq(schema.routeChannels.id, channelId)).get();
    if (!created) {
      return reply.code(500).send({ success: false, message: '创建通道失败' });
    }
    await clearRouteDecisionSnapshot(routeId);
    await clearDependentExplicitGroupSnapshotsBySourceRouteIds([routeId]);
    invalidateTokenRouterCache();
    return created;
  });

  // Batch update channel priorities
  app.put<{ Body: { updates: Array<{ id: number; priority: number }> } }>('/api/channels/batch', async (request, reply) => {
    const parsed = parseBatchChannelUpdates(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ success: false, message: parsed.message });
    }

    const channelIds = Array.from(new Set(parsed.updates.map((update) => update.id)));
    const existingChannels = await db.select().from(schema.routeChannels)
      .where(inArray(schema.routeChannels.id, channelIds))
      .all();
    if (existingChannels.length !== channelIds.length) {
      const existingIds = new Set(existingChannels.map((channel) => channel.id));
      const missingId = channelIds.find((id) => !existingIds.has(id));
      return reply.code(404).send({ success: false, message: `通道不存在: ${missingId}` });
    }

    for (const update of parsed.updates) {
      await db.update(schema.routeChannels).set({
        priority: update.priority,
        manualOverride: true,
      }).where(eq(schema.routeChannels.id, update.id)).run();
    }

    const updatedChannels = await db.select().from(schema.routeChannels)
      .where(inArray(schema.routeChannels.id, channelIds))
      .all();
    await clearRouteDecisionSnapshots(existingChannels.map((channel) => channel.routeId));
    await clearDependentExplicitGroupSnapshotsBySourceRouteIds(existingChannels.map((channel) => channel.routeId));
    invalidateTokenRouterCache();
    return { success: true, channels: updatedChannels };
  });

  // Update a channel
  app.put<{ Params: { channelId: string }; Body: unknown }>('/api/channels/:channelId', async (request, reply) => {
    const parsedBody = parseRouteChannelUpdatePayload(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ success: false, message: parsedBody.error });
    }

    const channelId = parseInt(request.params.channelId, 10);
    const body = parsedBody.data;

    const channel = await db.select().from(schema.routeChannels).where(eq(schema.routeChannels.id, channelId)).get();
    if (!channel) {
      return reply.code(404).send({ success: false, message: '通道不存在' });
    }

    const route = await getRouteWithSources(channel.routeId);
    if (!route) {
      return reply.code(404).send({ success: false, message: '路由不存在' });
    }

    if (body.tokenId !== undefined && body.tokenId !== null) {
      const tokenId = Number(body.tokenId);
      if (!Number.isFinite(tokenId) || !await checkTokenBelongsToAccount(tokenId, channel.accountId)) {
        return reply.code(400).send({ success: false, message: '令牌不存在或不属于通道账号' });
      }
    }

    const nextTokenId = body.tokenId === undefined
      ? (channel.tokenId ?? await getDefaultTokenId(channel.accountId))
      : (body.tokenId === null ? await getDefaultTokenId(channel.accountId) : Number(body.tokenId));

    if (isExactModelPattern(route.modelPattern) && nextTokenId && !await tokenSupportsModel(nextTokenId, route.modelPattern)) {
      return reply.code(400).send({ success: false, message: '该令牌不支持当前模型' });
    }

    const updates: Record<string, unknown> = { manualOverride: true };
    if (body.sourceModel !== undefined) {
      if (body.sourceModel === null) updates.sourceModel = null;
      else updates.sourceModel = String(body.sourceModel).trim() || null;
    }

    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.weight !== undefined) updates.weight = body.weight;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.tokenId !== undefined) updates.tokenId = nextTokenId;

    await db.update(schema.routeChannels).set(updates).where(eq(schema.routeChannels.id, channelId)).run();
    await clearRouteDecisionSnapshot(channel.routeId);
    await clearDependentExplicitGroupSnapshotsBySourceRouteIds([channel.routeId]);
    invalidateTokenRouterCache();
    return await db.select().from(schema.routeChannels).where(eq(schema.routeChannels.id, channelId)).get();
  });

  // Delete a channel
  app.delete<{ Params: { channelId: string } }>('/api/channels/:channelId', async (request) => {
    const channelId = parseInt(request.params.channelId, 10);
    const channel = await db.select().from(schema.routeChannels).where(eq(schema.routeChannels.id, channelId)).get();
    await db.delete(schema.routeChannels).where(eq(schema.routeChannels.id, channelId)).run();
    if (channel) {
      await clearRouteDecisionSnapshot(channel.routeId);
      await clearDependentExplicitGroupSnapshotsBySourceRouteIds([channel.routeId]);
    }
    invalidateTokenRouterCache();
    return { success: true };
  });

  // Rebuild routes/channels from model availability.
  app.post<{ Body: unknown }>('/api/routes/rebuild', async (request, reply) => {
    const parsedBody = parseRouteRebuildPayload(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ success: false, message: parsedBody.error });
    }

    const body = parsedBody.data;
    if (body.refreshModels === false) {
      const rebuild = await routeRefreshWorkflow.rebuildRoutesOnly();
      return { success: true, rebuild };
    }

    if (body.wait) {
      const result = await routeRefreshWorkflow.refreshModelsAndRebuildRoutes();
      return { success: true, ...result };
    }

    const { task, reused } = startBackgroundTask(
      {
        type: 'route',
        title: '刷新模型并重建路由',
        dedupeKey: 'refresh-models-and-rebuild-routes',
        notifyOnFailure: true,
        successMessage: (currentTask) => {
          const rebuild = (currentTask.result as any)?.rebuild;
          if (!rebuild) return '刷新模型并重建路由已完成';
          return `刷新模型并重建路由完成：新增路由 ${rebuild.createdRoutes}，移除旧路由 ${rebuild.removedRoutes ?? 0}，新增通道 ${rebuild.createdChannels}，移除通道 ${rebuild.removedChannels}`;
        },
        failureMessage: (currentTask) => `刷新模型并重建路由失败：${currentTask.error || 'unknown error'}`,
      },
      async () => routeRefreshWorkflow.refreshModelsAndRebuildRoutes(),
    );

    return reply.code(202).send({
      success: true,
      queued: true,
      reused,
      jobId: task.id,
      status: task.status,
      message: reused
        ? '路由重建任务执行中，请稍后查看程序日志'
        : '已开始路由重建，请稍后查看程序日志',
    });
  });
}

