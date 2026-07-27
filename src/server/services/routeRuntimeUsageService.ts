import { and, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getLocalRangeStartDayKey, getLocalDayRangeUtc, getLocalRangeStartUtc } from './localTimeService.js';
import { getBillingCostSummary } from './billingCostAggregateReadService.js';
import { runUsageAggregationProjectionPass } from './usageAggregationService.js';
import type { BillingCostSummary, BillingObservationGrain, BillingCostSubjectKind } from '../../shared/billingCost.js';

export type RouteRuntimeUsageMetric = {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  successRate: number | null;
  totalTokens: number;
  cost: BillingCostSummary;
  averageLatencyMs: number | null;
  latencyCount: number;
};

export type RouteRuntimeUsageScope =
  & RouteRuntimeUsageMetric
  & {
    scope: 'entry' | 'endpoint' | 'executionAttempt' | 'model';
    identity: string;
  };

export type RouteRuntimeUsageSummary = {
  windowDays: number;
  fromLocalDay: string;
  toLocalDay: string;
  entry: RouteRuntimeUsageScope | null;
  endpoint: RouteRuntimeUsageScope | null;
  executionAttempt: RouteRuntimeUsageScope | null;
  model: RouteRuntimeUsageScope | null;
  diagnostics: Record<string, never>;
};

export type RouteRuntimeUsageIdentityInput = {
  routeEntrypointId?: string | null;
  runtimeEndpointId?: string | null;
  executionAttemptId?: string | null;
  model?: string | null;
  siteId?: number | null;
  accountId?: number | null;
  createdAt?: string | number | Date | null;
};

type AggregateRow = {
  totalCalls: number | null;
  successCalls: number | null;
  failedCalls: number | null;
  totalTokens: number | null;
  totalLatencyMs: number | null;
  latencyCount: number | null;
};

function normalizePositiveInt(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function normalizeText(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function mapAggregateRow(
  scope: RouteRuntimeUsageScope['scope'],
  identity: string,
  row: AggregateRow | undefined,
  cost: BillingCostSummary,
): RouteRuntimeUsageScope | null {
  const totalCalls = Number(row?.totalCalls || 0);
  if (totalCalls <= 0) return null;
  const successCalls = Number(row?.successCalls || 0);
  const failedCalls = Number(row?.failedCalls || 0);
  const latencyCount = Number(row?.latencyCount || 0);
  const totalLatencyMs = Number(row?.totalLatencyMs || 0);
  return {
    scope,
    identity,
    totalCalls,
    successCalls,
    failedCalls,
    successRate: totalCalls > 0 ? Math.round((successCalls / totalCalls) * 10_000) / 100 : null,
    totalTokens: Number(row?.totalTokens || 0),
    cost,
    averageLatencyMs: latencyCount > 0 ? Math.round(totalLatencyMs / latencyCount) : null,
    latencyCount,
  };
}

async function aggregateRuntimeUsage(
  scope: RouteRuntimeUsageScope['scope'],
  identity: string | number | null,
  whereClause: SQL | undefined,
  costInput: {
    observationGrain: BillingObservationGrain;
    subjectKind: BillingCostSubjectKind;
    fromDay: string;
    toDay: string;
  },
): Promise<RouteRuntimeUsageScope | null> {
  if (identity == null || identity === '' || !whereClause) return null;
  const [row, cost] = await Promise.all([
    db.select({
      totalCalls: sql<number>`coalesce(sum(${schema.routeRuntimeDayUsage.totalCalls}), 0)`,
      successCalls: sql<number>`coalesce(sum(${schema.routeRuntimeDayUsage.successCalls}), 0)`,
      failedCalls: sql<number>`coalesce(sum(${schema.routeRuntimeDayUsage.failedCalls}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${schema.routeRuntimeDayUsage.totalTokens}), 0)`,
      totalLatencyMs: sql<number>`coalesce(sum(${schema.routeRuntimeDayUsage.totalLatencyMs}), 0)`,
      latencyCount: sql<number>`coalesce(sum(${schema.routeRuntimeDayUsage.latencyCount}), 0)`,
    })
      .from(schema.routeRuntimeDayUsage)
      .where(whereClause)
      .get(),
    getBillingCostSummary({
      ...costInput,
      subjectKey: String(identity),
    }),
  ]);
  return mapAggregateRow(scope, String(identity), row, cost);
}

async function aggregateTerminalEntryUsage(input: {
  identity: string | null;
  fromUtc: string;
  fromDay: string;
  toDay: string;
}): Promise<RouteRuntimeUsageScope | null> {
  if (!input.identity) return null;
  const [row, cost] = await Promise.all([
    db.select({
      totalCalls: sql<number>`coalesce(count(*), 0)`,
      successCalls: sql<number>`coalesce(sum(case when ${schema.proxyRequests.status} = 'success' then 1 else 0 end), 0)`,
      failedCalls: sql<number>`coalesce(sum(case when ${schema.proxyRequests.status} = 'failure' then 1 else 0 end), 0)`,
      totalTokens: sql<number>`coalesce(sum(${schema.proxyRequests.totalTokens}), 0)`,
      totalLatencyMs: sql<number>`coalesce(sum(case when ${schema.proxyRequests.latencyMs} >= 0 then ${schema.proxyRequests.latencyMs} else 0 end), 0)`,
      latencyCount: sql<number>`coalesce(sum(case when ${schema.proxyRequests.latencyMs} >= 0 then 1 else 0 end), 0)`,
    }).from(schema.proxyRequests).where(and(
      gte(schema.proxyRequests.completedAt, input.fromUtc),
      eq(schema.proxyRequests.routeEntrypointId, input.identity),
      inArray(schema.proxyRequests.status, ['success', 'failure']),
    )).get(),
    getBillingCostSummary({
      observationGrain: 'request',
      subjectKind: 'entry',
      subjectKey: input.identity,
      fromDay: input.fromDay,
      toDay: input.toDay,
    }),
  ]);
  return mapAggregateRow('entry', input.identity, row, cost);
}

async function aggregateTerminalModelUsage(input: {
  identity: string | null;
  siteId: number | null;
  accountId: number | null;
  fromDay: string;
  toDay: string;
}): Promise<RouteRuntimeUsageScope | null> {
  if (!input.identity) return null;
  const conditions: SQL[] = [
    gte(schema.modelDayUsage.localDay, input.fromDay),
    lte(schema.modelDayUsage.localDay, input.toDay),
    eq(schema.modelDayUsage.model, input.identity),
  ];
  if (input.siteId) conditions.push(eq(schema.modelDayUsage.siteId, input.siteId));
  if (input.accountId) conditions.push(eq(schema.modelDayUsage.accountId, input.accountId));
  const [row, cost] = await Promise.all([
    db.select({
      totalCalls: sql<number>`coalesce(sum(${schema.modelDayUsage.totalCalls}), 0)`,
      successCalls: sql<number>`coalesce(sum(${schema.modelDayUsage.successCalls}), 0)`,
      failedCalls: sql<number>`coalesce(sum(${schema.modelDayUsage.failedCalls}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${schema.modelDayUsage.totalTokens}), 0)`,
      totalLatencyMs: sql<number>`coalesce(sum(${schema.modelDayUsage.totalLatencyMs}), 0)`,
      latencyCount: sql<number>`coalesce(sum(${schema.modelDayUsage.latencyCount}), 0)`,
    }).from(schema.modelDayUsage).where(and(...conditions)).get(),
    getBillingCostSummary({
      observationGrain: 'request',
      subjectKind: 'model',
      subjectKey: input.identity,
      fromDay: input.fromDay,
      toDay: input.toDay,
    }),
  ]);
  return mapAggregateRow('model', input.identity, row, cost);
}

export async function getRouteRuntimeUsageForLog(
  input: RouteRuntimeUsageIdentityInput,
  options?: { windowDays?: number },
): Promise<RouteRuntimeUsageSummary> {
  const windowDays = Math.max(1, Math.min(365, Math.trunc(options?.windowDays || 30)));
  await runUsageAggregationProjectionPass();
  const fromLocalDay = getLocalRangeStartDayKey(windowDays);
  const toLocalDay = getLocalDayRangeUtc().localDay;
  const fromUtc = getLocalRangeStartUtc(windowDays);
  const routeEntrypointId = normalizeText(input.routeEntrypointId);
  const runtimeEndpointId = normalizeText(input.runtimeEndpointId);
  const executionAttemptId = normalizeText(input.executionAttemptId);
  const model = normalizeText(input.model);
  const siteId = normalizePositiveInt(input.siteId);
  const accountId = normalizePositiveInt(input.accountId);
  const base = and(
    gte(schema.routeRuntimeDayUsage.localDay, fromLocalDay),
    lte(schema.routeRuntimeDayUsage.localDay, toLocalDay),
  ) as SQL;

  const [
    entry,
    endpoint,
    executionAttempt,
    modelScope,
  ] = await Promise.all([
    aggregateTerminalEntryUsage({
      identity: routeEntrypointId,
      fromUtc,
      fromDay: fromLocalDay,
      toDay: toLocalDay,
    }),
    aggregateRuntimeUsage(
      'endpoint',
      runtimeEndpointId,
      runtimeEndpointId ? and(base, eq(schema.routeRuntimeDayUsage.runtimeEndpointId, runtimeEndpointId)) : undefined,
      { observationGrain: 'attempt', subjectKind: 'endpoint', fromDay: fromLocalDay, toDay: toLocalDay },
    ),
    aggregateRuntimeUsage(
      'executionAttempt',
      executionAttemptId,
      executionAttemptId ? and(base, eq(schema.routeRuntimeDayUsage.executionAttemptId, executionAttemptId)) : undefined,
      { observationGrain: 'attempt', subjectKind: 'execution_attempt', fromDay: fromLocalDay, toDay: toLocalDay },
    ),
    aggregateTerminalModelUsage({
      identity: model,
      siteId,
      accountId,
      fromDay: fromLocalDay,
      toDay: toLocalDay,
    }),
  ]);

  return {
    windowDays,
    fromLocalDay,
    toLocalDay,
    entry,
    endpoint,
    executionAttempt,
    model: modelScope,
    diagnostics: {},
  };
}
