import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  getLocalRangeStartUtc,
  toLocalDayKeyFromStoredUtc,
} from './localTimeService.js';
import {
  bucketStartUtc,
  mapAggregateRow,
  type AggregateRow,
} from './compiledRuntimeObservabilityProjection.js';
import type {
  RuntimeHealth,
  RuntimeObservationWindow,
} from './compiledRuntimeObservabilityTypes.js';

type TerminalRequestRow = {
  completedAt: string | null;
  status: string;
  latencyMs: number | null;
  firstTokenLatencyMs: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export function blankAggregate(bucket?: string | null): AggregateRow {
  return {
    localDay: bucket ?? null,
    totalCalls: 0,
    successCalls: 0,
    failedCalls: 0,
    totalTokens: 0,
    totalLatencyMs: 0,
    latencyCount: 0,
    totalFirstTokenLatencyMs: 0,
    firstTokenLatencyCount: 0,
    outputTokens: 0,
    outputTokenDurationMs: 0,
    outputTokenSampleCount: 0,
  };
}

function nonNegativeFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveFiniteNumber(value: unknown): number | null {
  const parsed = nonNegativeFiniteNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

export function appendObservationTiming(input: {
  aggregate: AggregateRow;
  latencyMs: unknown;
  firstTokenLatencyMs?: unknown;
  completionTokens?: unknown;
}): void {
  const latencyMs = nonNegativeFiniteNumber(input.latencyMs);
  const firstTokenLatencyMs = positiveFiniteNumber(input.firstTokenLatencyMs);
  if (latencyMs != null) {
    input.aggregate.totalLatencyMs = Number(input.aggregate.totalLatencyMs || 0) + latencyMs;
    input.aggregate.latencyCount = Number(input.aggregate.latencyCount || 0) + 1;
  }
  if (firstTokenLatencyMs != null) {
    input.aggregate.totalFirstTokenLatencyMs = Number(input.aggregate.totalFirstTokenLatencyMs || 0) + firstTokenLatencyMs;
    input.aggregate.firstTokenLatencyCount = Number(input.aggregate.firstTokenLatencyCount || 0) + 1;
  }
  const completionTokens = nonNegativeFiniteNumber(input.completionTokens);
  if (
    completionTokens != null
    && completionTokens > 0
    && latencyMs != null
    && firstTokenLatencyMs != null
    && latencyMs > firstTokenLatencyMs
  ) {
    input.aggregate.outputTokens = Number(input.aggregate.outputTokens || 0) + completionTokens;
    input.aggregate.outputTokenDurationMs = Number(input.aggregate.outputTokenDurationMs || 0) + (latencyMs - firstTokenLatencyMs);
    input.aggregate.outputTokenSampleCount = Number(input.aggregate.outputTokenSampleCount || 0) + 1;
  }
}

export function proxyAttemptRealtimeMetricColumns() {
  return {
    totalLatencyMs: sql<number>`coalesce(sum(case when ${schema.proxyLogs.latencyMs} is not null and ${schema.proxyLogs.latencyMs} >= 0 then ${schema.proxyLogs.latencyMs} else 0 end), 0)`,
    latencyCount: sql<number>`coalesce(sum(case when ${schema.proxyLogs.latencyMs} is not null and ${schema.proxyLogs.latencyMs} >= 0 then 1 else 0 end), 0)`,
    totalFirstTokenLatencyMs: sql<number>`coalesce(sum(case when ${schema.proxyLogs.firstTokenLatencyMs} is not null and ${schema.proxyLogs.firstTokenLatencyMs} > 0 then ${schema.proxyLogs.firstTokenLatencyMs} else 0 end), 0)`,
    firstTokenLatencyCount: sql<number>`coalesce(sum(case when ${schema.proxyLogs.firstTokenLatencyMs} is not null and ${schema.proxyLogs.firstTokenLatencyMs} > 0 then 1 else 0 end), 0)`,
    outputTokens: sql<number>`coalesce(sum(case when ${schema.proxyLogs.completionTokens} is not null and ${schema.proxyLogs.completionTokens} > 0 and ${schema.proxyLogs.latencyMs} is not null and ${schema.proxyLogs.firstTokenLatencyMs} is not null and ${schema.proxyLogs.firstTokenLatencyMs} > 0 and ${schema.proxyLogs.latencyMs} > ${schema.proxyLogs.firstTokenLatencyMs} then ${schema.proxyLogs.completionTokens} else 0 end), 0)`,
    outputTokenDurationMs: sql<number>`coalesce(sum(case when ${schema.proxyLogs.completionTokens} is not null and ${schema.proxyLogs.completionTokens} > 0 and ${schema.proxyLogs.latencyMs} is not null and ${schema.proxyLogs.firstTokenLatencyMs} is not null and ${schema.proxyLogs.firstTokenLatencyMs} > 0 and ${schema.proxyLogs.latencyMs} > ${schema.proxyLogs.firstTokenLatencyMs} then ${schema.proxyLogs.latencyMs} - ${schema.proxyLogs.firstTokenLatencyMs} else 0 end), 0)`,
    outputTokenSampleCount: sql<number>`coalesce(sum(case when ${schema.proxyLogs.completionTokens} is not null and ${schema.proxyLogs.completionTokens} > 0 and ${schema.proxyLogs.latencyMs} is not null and ${schema.proxyLogs.firstTokenLatencyMs} is not null and ${schema.proxyLogs.firstTokenLatencyMs} > 0 and ${schema.proxyLogs.latencyMs} > ${schema.proxyLogs.firstTokenLatencyMs} then 1 else 0 end), 0)`,
  };
}

function appendTerminalRequest(row: TerminalRequestRow, aggregate: AggregateRow): void {
  aggregate.totalCalls = Number(aggregate.totalCalls || 0) + 1;
  aggregate.successCalls = Number(aggregate.successCalls || 0) + (row.status === 'success' ? 1 : 0);
  aggregate.failedCalls = Number(aggregate.failedCalls || 0) + (row.status === 'failure' ? 1 : 0);
  aggregate.totalTokens = Number(aggregate.totalTokens || 0) + Number(row.totalTokens || 0);
  appendObservationTiming({
    aggregate,
    latencyMs: row.latencyMs,
    firstTokenLatencyMs: row.firstTokenLatencyMs,
    completionTokens: row.completionTokens,
  });
}

async function loadTerminalRequests(input: {
  routeEntrypointId: string | null;
  fromUtc: string;
}): Promise<TerminalRequestRow[]> {
  if (!input.routeEntrypointId) return [];
  return await db.select({
    completedAt: schema.proxyRequests.completedAt,
    status: schema.proxyRequests.status,
    latencyMs: schema.proxyRequests.latencyMs,
    firstTokenLatencyMs: schema.proxyRequests.firstTokenLatencyMs,
    completionTokens: schema.proxyRequests.completionTokens,
    totalTokens: schema.proxyRequests.totalTokens,
  })
    .from(schema.proxyRequests)
    .where(and(
      gte(schema.proxyRequests.completedAt, input.fromUtc),
      eq(schema.proxyRequests.routeEntrypointId, input.routeEntrypointId),
      inArray(schema.proxyRequests.status, ['success', 'failure']),
    ))
    .all();
}

export async function aggregateTerminalRequestHealth(input: {
  routeEntrypointId: string | null;
  window: RuntimeObservationWindow;
}): Promise<RuntimeHealth | null> {
  const rows = await loadTerminalRequests({
    routeEntrypointId: input.routeEntrypointId,
    fromUtc: input.window.realtime?.fromUtc || getLocalRangeStartUtc(input.window.windowDays),
  });
  if (rows.length === 0) return null;
  const aggregate = blankAggregate();
  for (const row of rows) appendTerminalRequest(row, aggregate);
  return mapAggregateRow(aggregate, 'entry_projection', input.window);
}

export async function aggregateTerminalRequestBuckets(input: {
  routeEntrypointId: string | null;
  window: RuntimeObservationWindow;
}): Promise<Map<string, AggregateRow>> {
  const result = new Map<string, AggregateRow>();
  if (!input.window.realtime) return result;
  const rows = await loadTerminalRequests({
    routeEntrypointId: input.routeEntrypointId,
    fromUtc: input.window.realtime.fromUtc,
  });
  for (const row of rows) {
    const bucket = bucketStartUtc(row.completedAt, input.window.range);
    if (!bucket) continue;
    const aggregate = result.get(bucket) || blankAggregate(bucket);
    appendTerminalRequest(row, aggregate);
    result.set(bucket, aggregate);
  }
  return result;
}

export async function aggregateTerminalRequestDayBuckets(input: {
  routeEntrypointId: string | null;
  window: RuntimeObservationWindow;
}): Promise<Map<string, AggregateRow>> {
  const result = new Map<string, AggregateRow>();
  const rows = await loadTerminalRequests({
    routeEntrypointId: input.routeEntrypointId,
    fromUtc: getLocalRangeStartUtc(input.window.windowDays),
  });
  for (const row of rows) {
    const localDay = toLocalDayKeyFromStoredUtc(row.completedAt);
    if (!localDay) continue;
    const aggregate = result.get(localDay) || blankAggregate(localDay);
    appendTerminalRequest(row, aggregate);
    result.set(localDay, aggregate);
  }
  return result;
}
