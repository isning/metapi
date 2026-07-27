import { and, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  getLocalRangeStartUtc,
} from './localTimeService.js';
import {
  emptyHealth,
  mapAggregateRow,
} from './compiledRuntimeObservabilityProjection.js';
import {
  aggregateTerminalRequestHealth,
  proxyAttemptRealtimeMetricColumns,
} from './compiledRuntimeTerminalRequestRepository.js';

import type {
  RuntimeObservationWindow,
  RuntimeHealthSource,
  RuntimeHealth,
} from './compiledRuntimeObservabilityTypes.js';

type AggregateScope = 'entry' | 'endpoint' | 'executionAttempt';

export function runtimeIdentityKeyColumns() {
  return {
    totalCalls: sql<number>`coalesce(sum(${schema.routeRuntimeDayUsage.totalCalls}), 0)`,
    successCalls: sql<number>`coalesce(sum(${schema.routeRuntimeDayUsage.successCalls}), 0)`,
    failedCalls: sql<number>`coalesce(sum(${schema.routeRuntimeDayUsage.failedCalls}), 0)`,
    totalTokens: sql<number>`coalesce(sum(${schema.routeRuntimeDayUsage.totalTokens}), 0)`,
    totalLatencyMs: sql<number>`coalesce(sum(${schema.routeRuntimeDayUsage.totalLatencyMs}), 0)`,
    latencyCount: sql<number>`coalesce(sum(${schema.routeRuntimeDayUsage.latencyCount}), 0)`,
  };
}

async function aggregateUsage(whereClause: SQL | undefined, source: RuntimeHealthSource, window: RuntimeObservationWindow) {
  if (!whereClause) return emptyHealth(window);
  const row = await db
    .select(runtimeIdentityKeyColumns())
    .from(schema.routeRuntimeDayUsage)
    .where(whereClause)
    .get();
  return mapAggregateRow(row, source, window);
}

function baseWindowWhere(window: RuntimeObservationWindow): SQL {
  return and(
    gte(schema.routeRuntimeDayUsage.localDay, window.fromLocalDay),
    lte(schema.routeRuntimeDayUsage.localDay, window.toLocalDay),
  ) as SQL;
}

export async function aggregateByIdentity(input: {
  scope: AggregateScope;
  identity: string | number | null;
  window: RuntimeObservationWindow;
}): Promise<RuntimeHealth> {
  const base = baseWindowWhere(input.window);
  if (input.identity == null || input.identity === '') return emptyHealth(input.window);
  if (input.scope === 'entry') {
    return aggregateUsage(
      and(base, eq(schema.routeRuntimeDayUsage.routeEntrypointId, String(input.identity))),
      'entry_projection',
      input.window,
    );
  }
  if (input.scope === 'endpoint') {
    return aggregateUsage(
      and(base, eq(schema.routeRuntimeDayUsage.runtimeEndpointId, String(input.identity))),
      'endpoint_projection',
      input.window,
    );
  }
  return aggregateUsage(
    and(base, eq(schema.routeRuntimeDayUsage.executionAttemptId, String(input.identity))),
    'execution_attempt_projection',
    input.window,
  );
}

export async function aggregateTerminalEntryHealth(input: {
  routeEntrypointId: string | null;
  window: RuntimeObservationWindow;
}): Promise<RuntimeHealth> {
  const terminalHealth = await aggregateTerminalRequestHealth({
    routeEntrypointId: input.routeEntrypointId,
    window: input.window,
  });
  return terminalHealth || emptyHealth(input.window);
}

export async function aggregateRealtimeExecutionAttemptHealth(input: {
  executionAttemptId: string | null;
  window: RuntimeObservationWindow;
}): Promise<RuntimeHealth> {
  if (!input.executionAttemptId) return emptyHealth(input.window);
  const row = await db.select({
    totalCalls: sql<number>`coalesce(count(*), 0)`,
    successCalls: sql<number>`coalesce(sum(case when ${schema.proxyLogs.status} = 'success' then 1 else 0 end), 0)`,
    failedCalls: sql<number>`coalesce(sum(case when ${schema.proxyLogs.status} in ('failed', 'retried') then 1 else 0 end), 0)`,
    totalTokens: sql<number>`coalesce(sum(${schema.proxyLogs.totalTokens}), 0)`,
    ...proxyAttemptRealtimeMetricColumns(),
  })
    .from(schema.proxyLogs)
    .where(and(
      gte(schema.proxyLogs.createdAt, input.window.realtime?.fromUtc || getLocalRangeStartUtc(input.window.windowDays)),
      eq(schema.proxyLogs.executionAttemptId, input.executionAttemptId),
      inArray(schema.proxyLogs.status, ['success', 'failed', 'retried']),
    ))
    .get();
  return mapAggregateRow(row, 'execution_attempt_projection', input.window);
}

export async function aggregateRealtimeEndpointHealth(input: {
  runtimeEndpointId: string | null;
  window: RuntimeObservationWindow;
}): Promise<RuntimeHealth> {
  if (!input.runtimeEndpointId) return emptyHealth(input.window);
  const row = await db.select({
    totalCalls: sql<number>`coalesce(count(*), 0)`,
    successCalls: sql<number>`coalesce(sum(case when ${schema.proxyLogs.status} = 'success' then 1 else 0 end), 0)`,
    failedCalls: sql<number>`coalesce(sum(case when ${schema.proxyLogs.status} in ('failed', 'retried') then 1 else 0 end), 0)`,
    totalTokens: sql<number>`coalesce(sum(${schema.proxyLogs.totalTokens}), 0)`,
    ...proxyAttemptRealtimeMetricColumns(),
  })
    .from(schema.proxyLogs)
    .where(and(
      gte(schema.proxyLogs.createdAt, input.window.realtime?.fromUtc || getLocalRangeStartUtc(input.window.windowDays)),
      eq(schema.proxyLogs.runtimeEndpointId, input.runtimeEndpointId),
      inArray(schema.proxyLogs.status, ['success', 'failed', 'retried']),
    ))
    .get();
  return mapAggregateRow(row, 'endpoint_projection', input.window);
}
