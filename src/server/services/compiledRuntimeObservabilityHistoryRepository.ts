import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  bucketStartUtc,
  mapAggregateRow,
  type AggregateRow,
} from './compiledRuntimeObservabilityProjection.js';
import { runtimeIdentityKeyColumns } from './compiledRuntimeObservabilityRepository.js';
import {
  aggregateTerminalRequestBuckets,
  aggregateTerminalRequestDayBuckets,
  appendObservationTiming,
  blankAggregate,
} from './compiledRuntimeTerminalRequestRepository.js';
import type {
  RuntimeHealth,
  RuntimeHistoryBucket,
  RuntimeObservationWindow,
} from './compiledRuntimeObservabilityTypes.js';

export async function aggregateTerminalEntryHistory(input: {
  routeEntrypointId: string | null;
  executionAttemptIds: string[];
  endpointIds: string[];
  window: RuntimeObservationWindow;
}): Promise<RuntimeHistoryBucket[]> {
  const identityClause = input.routeEntrypointId
    ? eq(schema.proxyLogs.routeEntrypointId, input.routeEntrypointId)
    : null;
  if (!identityClause) return [];
  if (input.window.realtime) {
    const terminalEntryByBucket = await aggregateTerminalRequestBuckets({
      routeEntrypointId: input.routeEntrypointId,
      window: input.window,
    });

    const rows = await db.select({
      createdAt: schema.proxyLogs.createdAt,
      status: schema.proxyLogs.status,
      totalTokens: schema.proxyLogs.totalTokens,
      completionTokens: schema.proxyLogs.completionTokens,
      latencyMs: schema.proxyLogs.latencyMs,
      firstTokenLatencyMs: schema.proxyLogs.firstTokenLatencyMs,
      runtimeEndpointId: schema.proxyLogs.runtimeEndpointId,
      executionAttemptId: schema.proxyLogs.executionAttemptId,
    })
      .from(schema.proxyLogs)
      .where(and(
        gte(schema.proxyLogs.createdAt, input.window.realtime.fromUtc),
        identityClause,
        inArray(schema.proxyLogs.status, ['success', 'failed', 'retried']),
      ))
      .all();
    const endpointsByBucket = new Map<string, Map<string, AggregateRow>>();
    const attemptsByBucket = new Map<string, Map<string, AggregateRow>>();
    const append = (row: typeof rows[number], aggregate: AggregateRow) => {
      const status = String(row.status || '');
      aggregate.totalCalls = Number(aggregate.totalCalls || 0) + 1;
      aggregate.successCalls = Number(aggregate.successCalls || 0) + (status === 'success' ? 1 : 0);
      aggregate.failedCalls = Number(aggregate.failedCalls || 0) + (status === 'failed' || status === 'retried' ? 1 : 0);
      aggregate.totalTokens = Number(aggregate.totalTokens || 0) + Number(row.totalTokens || 0);
      appendObservationTiming({
        aggregate,
        latencyMs: row.latencyMs,
        firstTokenLatencyMs: row.firstTokenLatencyMs,
        completionTokens: row.completionTokens,
      });
    };
    for (const row of rows) {
      const bucket = bucketStartUtc(row.createdAt, input.window.range);
      if (!bucket) continue;
      const endpointId = String(row.runtimeEndpointId || '').trim();
      if (endpointId) {
        const endpointMap = endpointsByBucket.get(bucket) || new Map<string, AggregateRow>();
        const endpointAggregate = endpointMap.get(endpointId) || blankAggregate(bucket);
        append(row, endpointAggregate);
        endpointMap.set(endpointId, endpointAggregate);
        endpointsByBucket.set(bucket, endpointMap);
      }
      const executionAttemptId = String(row.executionAttemptId || '').trim();
      if (executionAttemptId && input.executionAttemptIds.includes(executionAttemptId)) {
        const attemptMap = attemptsByBucket.get(bucket) || new Map<string, AggregateRow>();
        const attemptAggregate = attemptMap.get(executionAttemptId) || blankAggregate(bucket);
        append(row, attemptAggregate);
        attemptMap.set(executionAttemptId, attemptAggregate);
        attemptsByBucket.set(bucket, attemptMap);
      }
    }
    return Array.from(new Set([
      ...terminalEntryByBucket.keys(),
      ...endpointsByBucket.keys(),
      ...attemptsByBucket.keys(),
    ]))
      .sort((a, b) => a.localeCompare(b))
      .map((bucket) => ({
        bucketStart: bucket,
        bucketEnd: bucket,
        entry: mapAggregateRow(
          terminalEntryByBucket.get(bucket),
          'entry_projection',
          input.window,
        ),
        endpoints: Array.from((endpointsByBucket.get(bucket) || new Map()).entries())
          .filter(([endpointId]) => input.endpointIds.length === 0 || input.endpointIds.includes(endpointId))
          .map(([endpointId, row]) => ({
            endpointId,
            health: mapAggregateRow(row, 'endpoint_projection', input.window),
          })),
        executionAttempts: Array.from((attemptsByBucket.get(bucket) || new Map()).entries())
          .map(([executionAttemptId, row]) => ({
            executionAttemptId,
            health: mapAggregateRow(row, 'execution_attempt_projection', input.window),
          })),
    }));
  }
  const terminalEntryByDay = await aggregateTerminalRequestDayBuckets({
    routeEntrypointId: input.routeEntrypointId,
    window: input.window,
  });
  const attemptRows = input.executionAttemptIds.length > 0
    ? await db.select({
      localDay: schema.routeRuntimeDayUsage.localDay,
      executionAttemptId: schema.routeRuntimeDayUsage.executionAttemptId,
      ...runtimeIdentityKeyColumns(),
    })
      .from(schema.routeRuntimeDayUsage)
      .where(and(
        gte(schema.routeRuntimeDayUsage.localDay, input.window.fromLocalDay),
        lte(schema.routeRuntimeDayUsage.localDay, input.window.toLocalDay),
        inArray(schema.routeRuntimeDayUsage.executionAttemptId, input.executionAttemptIds),
      ))
      .groupBy(schema.routeRuntimeDayUsage.localDay, schema.routeRuntimeDayUsage.executionAttemptId)
      .all()
    : [];
  const attemptsByDay = new Map<string, Array<{ executionAttemptId: string; health: RuntimeHealth }>>();
  for (const row of attemptRows) {
    const localDay = String(row.localDay || '').trim();
    const executionAttemptId = String(row.executionAttemptId || '').trim();
    if (!localDay || !executionAttemptId) continue;
    const items = attemptsByDay.get(localDay) || [];
    items.push({
      executionAttemptId,
      health: mapAggregateRow(row, 'execution_attempt_projection', input.window),
    });
    attemptsByDay.set(localDay, items);
  }
  const endpointRows = input.endpointIds.length > 0
    ? await db.select({
      localDay: schema.routeRuntimeDayUsage.localDay,
      runtimeEndpointId: schema.routeRuntimeDayUsage.runtimeEndpointId,
      ...runtimeIdentityKeyColumns(),
    })
      .from(schema.routeRuntimeDayUsage)
      .where(and(
        gte(schema.routeRuntimeDayUsage.localDay, input.window.fromLocalDay),
        lte(schema.routeRuntimeDayUsage.localDay, input.window.toLocalDay),
        inArray(schema.routeRuntimeDayUsage.runtimeEndpointId, input.endpointIds),
      ))
      .groupBy(schema.routeRuntimeDayUsage.localDay, schema.routeRuntimeDayUsage.runtimeEndpointId)
      .all()
    : [];
  const endpointsByDay = new Map<string, Array<{ endpointId: string; health: RuntimeHealth }>>();
  for (const row of endpointRows) {
    const localDay = String(row.localDay || '').trim();
    const endpointId = String(row.runtimeEndpointId || '').trim();
    if (!localDay || !endpointId) continue;
    const items = endpointsByDay.get(localDay) || [];
    items.push({
      endpointId,
      health: mapAggregateRow(row, 'endpoint_projection', input.window),
    });
    endpointsByDay.set(localDay, items);
  }

  return Array.from(new Set([
    ...terminalEntryByDay.keys(),
    ...attemptsByDay.keys(),
    ...endpointsByDay.keys(),
  ]))
    .sort((a, b) => a.localeCompare(b))
    .map((localDay) => ({
      bucketStart: localDay,
      bucketEnd: localDay,
      entry: mapAggregateRow(
        terminalEntryByDay.get(localDay),
        'entry_projection',
        input.window,
      ),
      endpoints: endpointsByDay.get(localDay) || [],
      executionAttempts: attemptsByDay.get(localDay) || [],
    }));
}
