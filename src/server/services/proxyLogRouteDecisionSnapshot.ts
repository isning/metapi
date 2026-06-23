import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

type NullableNumber = number | null;

export type ProxyLogRouteDecisionSnapshotSummary = {
  matchKind: string | null;
  requestedModelPattern: string | null;
  backendKind: string | null;
  sourceRouteIds: number[];
};

export type ProxyLogRouteDecisionRoute = {
  id: NullableNumber;
  displayName: string | null;
  displayIcon: string | null;
  routingStrategy: string | null;
  enabled: boolean | null;
  decisionRefreshedAt: string | null;
  snapshotSummary: ProxyLogRouteDecisionSnapshotSummary | null;
};

export type ProxyLogRouteDecisionTarget = {
  id: NullableNumber;
  routeEndpointId: string | null;
  accountId: NullableNumber;
  tokenId: NullableNumber;
  oauthRouteUnitId: NullableNumber;
  sourceModel: string | null;
  priority: NullableNumber;
  weight: NullableNumber;
  enabled: boolean | null;
  manualOverride: boolean | null;
  successCount: NullableNumber;
  failCount: NullableNumber;
  totalLatencyMs: NullableNumber;
  totalCost: NullableNumber;
  lastUsedAt: string | null;
  lastSelectedAt: string | null;
  lastFailAt: string | null;
  consecutiveFailCount: NullableNumber;
  cooldownLevel: NullableNumber;
  cooldownUntil: string | null;
};

export type ProxyLogRouteDecisionToken = {
  id: NullableNumber;
  name: string | null;
  tokenGroup: string | null;
  enabled: boolean | null;
  valueStatus: string | null;
  source: string | null;
};

export type ProxyLogRouteDecision = {
  source: 'snapshot' | 'current';
  capturedAt: string | null;
  requestedModel: string | null;
  actualModel: string | null;
  route: ProxyLogRouteDecisionRoute | null;
  target: ProxyLogRouteDecisionTarget | null;
  token: ProxyLogRouteDecisionToken | null;
};

export type ProxyLogRouteDecisionSnapshot = {
  schemaVersion: 1;
  capturedAt: string;
  requestedModel: string | null;
  actualModel: string | null;
  route: ProxyLogRouteDecisionRoute | null;
  target: ProxyLogRouteDecisionTarget | null;
  token: ProxyLogRouteDecisionToken | null;
};

type SnapshotSelectedTarget = {
  target: Partial<ProxyLogRouteDecisionTarget> & {
    id?: number | null;
    routeId?: number | null;
  };
  token?: Partial<ProxyLogRouteDecisionToken> | null;
  actualModel?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toNullableNumber(value: unknown): NullableNumber {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toNullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function toNullableBoolean(value: unknown): boolean | null {
  if (value == null) return null;
  return Boolean(value);
}

function parseStoredJsonObject(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function summarizeRouteDecisionSnapshotValue(
  value: unknown,
): ProxyLogRouteDecisionSnapshotSummary | null {
  const snapshot = parseStoredJsonObject(value);
  if (!snapshot) return null;
  const match = isRecord(snapshot.match) ? snapshot.match : null;
  const backend = isRecord(snapshot.backend) ? snapshot.backend : null;
  const sourceRouteIds = Array.isArray(backend?.routeIds)
    ? backend.routeIds
      .map((routeId) => Number(routeId))
      .filter((routeId) => Number.isFinite(routeId) && routeId > 0)
      .map((routeId) => Math.trunc(routeId))
    : [];

  return {
    matchKind: typeof match?.kind === 'string' ? match.kind : null,
    requestedModelPattern:
      typeof match?.requestedModelPattern === 'string'
        ? match.requestedModelPattern
        : null,
    backendKind: typeof backend?.kind === 'string' ? backend.kind : null,
    sourceRouteIds,
  };
}

function mapSelectedTargetSnapshot(
  target: (Partial<ProxyLogRouteDecisionTarget> & {
    id?: number | null;
    routeId?: number | null;
  }) | Record<string, unknown> | null | undefined,
): ProxyLogRouteDecisionTarget | null {
  if (!target) return null;
  return {
    id: toNullableNumber(target.id),
    routeEndpointId: toNullableText(target.routeEndpointId),
    accountId: toNullableNumber(target.accountId),
    tokenId: toNullableNumber(target.tokenId),
    oauthRouteUnitId: toNullableNumber(target.oauthRouteUnitId),
    sourceModel: toNullableText(target.sourceModel),
    priority: toNullableNumber(target.priority),
    weight: toNullableNumber(target.weight),
    enabled: toNullableBoolean(target.enabled),
    manualOverride: toNullableBoolean(target.manualOverride),
    successCount: toNullableNumber(target.successCount),
    failCount: toNullableNumber(target.failCount),
    totalLatencyMs: toNullableNumber(target.totalLatencyMs),
    totalCost: toNullableNumber(target.totalCost),
    lastUsedAt: toNullableText(target.lastUsedAt),
    lastSelectedAt: toNullableText(target.lastSelectedAt),
    lastFailAt: toNullableText(target.lastFailAt),
    consecutiveFailCount: toNullableNumber(target.consecutiveFailCount),
    cooldownLevel: toNullableNumber(target.cooldownLevel),
    cooldownUntil: toNullableText(target.cooldownUntil),
  };
}

function mapSelectedTokenSnapshot(
  token: Partial<ProxyLogRouteDecisionToken> | Record<string, unknown> | null | undefined,
): ProxyLogRouteDecisionToken | null {
  if (!token) return null;
  return {
    id: toNullableNumber(token.id),
    name: toNullableText(token.name),
    tokenGroup: toNullableText(token.tokenGroup),
    enabled: toNullableBoolean(token.enabled),
    valueStatus: toNullableText(token.valueStatus),
    source: toNullableText(token.source),
  };
}

function normalizeRouteDecisionSnapshot(
  value: unknown,
): ProxyLogRouteDecisionSnapshot | null {
  const record = parseStoredJsonObject(value);
  if (!record || record.schemaVersion !== 1) return null;
  const route = isRecord(record.route) ? record.route : null;
  const target = isRecord(record.target) ? record.target : null;
  const token = isRecord(record.token) ? record.token : null;

  return {
    schemaVersion: 1,
    capturedAt: toNullableText(record.capturedAt) || '',
    requestedModel: toNullableText(record.requestedModel),
    actualModel: toNullableText(record.actualModel),
    route: route
      ? {
          id: toNullableNumber(route.id),
          displayName: toNullableText(route.displayName),
          displayIcon: toNullableText(route.displayIcon),
          routingStrategy: toNullableText(route.routingStrategy),
          enabled: toNullableBoolean(route.enabled),
          decisionRefreshedAt: toNullableText(route.decisionRefreshedAt),
          snapshotSummary: isRecord(route.snapshotSummary)
            ? {
                matchKind: toNullableText(route.snapshotSummary.matchKind),
                requestedModelPattern: toNullableText(route.snapshotSummary.requestedModelPattern),
                backendKind: toNullableText(route.snapshotSummary.backendKind),
                sourceRouteIds: Array.isArray(route.snapshotSummary.sourceRouteIds)
                  ? route.snapshotSummary.sourceRouteIds
                    .map((routeId) => Number(routeId))
                    .filter((routeId) => Number.isFinite(routeId) && routeId > 0)
                    .map((routeId) => Math.trunc(routeId))
                  : [],
              }
            : null,
        }
      : null,
    target: mapSelectedTargetSnapshot(target),
    token: mapSelectedTokenSnapshot(token),
  };
}

export function mapRouteDecisionSnapshotToResponse(
  value: unknown,
): ProxyLogRouteDecision | null {
  const snapshot = normalizeRouteDecisionSnapshot(value);
  if (!snapshot) return null;
  return {
    source: 'snapshot',
    capturedAt: snapshot.capturedAt || null,
    requestedModel: snapshot.requestedModel,
    actualModel: snapshot.actualModel,
    route: snapshot.route,
    target: snapshot.target,
    token: snapshot.token,
  };
}

export async function buildProxyLogRouteDecisionSnapshot(input: {
  selected: SnapshotSelectedTarget;
  modelRequested: string;
  capturedAt: string;
}): Promise<ProxyLogRouteDecisionSnapshot | null> {
  const target = mapSelectedTargetSnapshot(input.selected.target);
  const routeId = toNullableNumber(input.selected.target.routeId);
  if (!target && !routeId) return null;

  const routeRow = routeId
    ? await db.select({
        id: schema.tokenRoutes.id,
        displayName: schema.tokenRoutes.displayName,
        displayIcon: schema.tokenRoutes.displayIcon,
        routingStrategy: schema.tokenRoutes.routingStrategy,
        enabled: schema.tokenRoutes.enabled,
        decisionSnapshot: schema.tokenRoutes.decisionSnapshot,
        decisionRefreshedAt: schema.tokenRoutes.decisionRefreshedAt,
      }).from(schema.tokenRoutes)
        .where(eq(schema.tokenRoutes.id, routeId))
        .get()
    : null;

  return {
    schemaVersion: 1,
    capturedAt: input.capturedAt,
    requestedModel: input.modelRequested || null,
    actualModel: input.selected.actualModel || null,
    route: routeId
      ? {
          id: routeId,
          displayName: routeRow?.displayName ?? null,
          displayIcon: routeRow?.displayIcon ?? null,
          routingStrategy: routeRow?.routingStrategy ?? null,
          enabled: routeRow?.enabled == null ? null : Boolean(routeRow.enabled),
          decisionRefreshedAt: routeRow?.decisionRefreshedAt ?? null,
          snapshotSummary: summarizeRouteDecisionSnapshotValue(routeRow?.decisionSnapshot),
        }
      : null,
    target,
    token: mapSelectedTokenSnapshot(input.selected.token),
  };
}
