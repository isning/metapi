import {
  formatUtcSqlDateTime,
  getLocalDayRangeUtc,
  getLocalRangeStartDayKey,
  getRecentMinuteRangeStartUtc,
  parseStoredUtcDateTime,
  toLocalDayKeyFromStoredUtc,
} from './localTimeService.js';
import type { CompiledRouteFlow } from './routeFlowService.js';
import type {
  CompiledRuntimeObservabilityRange,
  RuntimeCapabilitySummary,
  RuntimeHealth,
  RuntimeHealthSource,
  RuntimeHealthStatus,
  RuntimeHistory,
  RuntimeObservationWindow,
} from './compiledRuntimeObservabilityTypes.js';

export type AggregateRow = {
  localDay?: string | null;
  totalCalls: number | null;
  successCalls: number | null;
  failedCalls: number | null;
  totalTokens: number | null;
  totalLatencyMs: number | null;
  latencyCount: number | null;
  totalFirstTokenLatencyMs: number | null;
  firstTokenLatencyCount: number | null;
  outputTokens: number | null;
  outputTokenDurationMs: number | null;
  outputTokenSampleCount: number | null;
};

const DEFAULT_REALTIME_HEALTH_WINDOW_MINUTES = 5;

export function normalizeRange(raw: CompiledRuntimeObservabilityRange | undefined): CompiledRuntimeObservabilityRange {
  return raw === '5m' || raw === '15m' || raw === '1h' || raw === '6h' || raw === '24h' || raw === '7d' || raw === '30d'
    ? raw
    : '6h';
}

function rangeToWindowDays(range: CompiledRuntimeObservabilityRange): number {
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  return 1;
}

export function buildWindow(range: CompiledRuntimeObservabilityRange): RuntimeObservationWindow {
  const windowDays = rangeToWindowDays(range);
  return {
    range,
    windowDays,
    fromLocalDay: getLocalRangeStartDayKey(windowDays),
    toLocalDay: getLocalDayRangeUtc().localDay,
  };
}

export function rangeToRealtimeMinutes(range: CompiledRuntimeObservabilityRange): number | null {
  if (range === '5m') return 5;
  if (range === '15m') return 15;
  if (range === '1h') return 60;
  if (range === '6h') return 6 * 60;
  if (range === '24h') return 24 * 60;
  return null;
}

export function buildRealtimeWindow(minutesInput: number | null | undefined): RuntimeObservationWindow {
  const minutes = Number.isFinite(Number(minutesInput))
    ? Math.max(1, Math.min(30 * 24 * 60, Math.trunc(Number(minutesInput))))
    : DEFAULT_REALTIME_HEALTH_WINDOW_MINUTES;
  const dayRange = getLocalDayRangeUtc();
  return {
    range: minutes <= 5 ? '5m' : minutes <= 15 ? '15m' : minutes <= 60 ? '1h' : minutes <= 6 * 60 ? '6h' : '24h',
    windowDays: 1,
    fromLocalDay: dayRange.localDay,
    toLocalDay: dayRange.localDay,
    realtime: {
      minutes,
      fromUtc: getRecentMinuteRangeStartUtc(minutes),
    },
  };
}

export function historyGranularity(range: CompiledRuntimeObservabilityRange): RuntimeHistory['granularity'] {
  if (range === '5m' || range === '15m' || range === '1h' || range === '6h') return 'minute';
  if (range === '24h') return 'hour';
  return 'day';
}

function historyBucketSizeMs(range: CompiledRuntimeObservabilityRange): number {
  if (historyGranularity(range) === 'minute') return 60 * 1000;
  if (range === '24h') return 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

export function bucketStartUtc(raw: string | null | undefined, range: CompiledRuntimeObservabilityRange): string | null {
  const parsed = parseStoredUtcDateTime(raw);
  if (!parsed) return null;
  if (historyGranularity(range) === 'day') {
    const day = toLocalDayKeyFromStoredUtc(raw);
    return day;
  }
  const bucketSizeMs = historyBucketSizeMs(range);
  const timestamp = Math.floor(parsed.getTime() / bucketSizeMs) * bucketSizeMs;
  return formatUtcSqlDateTime(new Date(timestamp));
}

function emptyCapabilitySummary(): RuntimeCapabilitySummary {
  return {
    supportedEndpointTypes: [],
    inputModalities: [],
    outputModalities: [],
    capabilities: [],
    contextLength: null,
    maxOutputTokens: null,
    source: 'none',
    partial: false,
  };
}

export function buildCapabilitySummary(flow: CompiledRouteFlow): RuntimeCapabilitySummary {
  const endpointTypes = new Set<string>();
  for (const attempt of flow.compiledRuntime?.executionAttempts ?? []) {
    for (const apiAttempt of attempt.apiAttempts ?? []) {
      const apiType = String(apiAttempt.apiType || '').trim();
      if (apiType) endpointTypes.add(apiType);
    }
  }
  if (endpointTypes.size <= 0) return emptyCapabilitySummary();
  return {
    ...emptyCapabilitySummary(),
    supportedEndpointTypes: Array.from(endpointTypes).sort((a, b) => a.localeCompare(b)),
    source: 'runtime_attempt_catalog_merge',
    partial: true,
  };
}

function statusFromHealth(
  successRate: number | null,
  avgLatencyMs: number | null,
  avgFirstTokenLatencyMs: number | null,
  totalCalls: number,
): RuntimeHealthStatus {
  if (totalCalls <= 0 || successRate == null) return 'unknown';
  if (successRate < 90) return 'degraded';
  const interactiveLatencyMs = avgFirstTokenLatencyMs ?? avgLatencyMs;
  if (interactiveLatencyMs != null && interactiveLatencyMs >= 3000) return 'degraded';
  return 'healthy';
}

function isFutureTimestamp(value: string | null | undefined): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > Date.now();
}

export function hasAvailableExecutionAttempt(flow: CompiledRouteFlow): boolean {
  const attempts = flow.compiledRuntime?.executionAttempts ?? [];
  if (attempts.length <= 0) return false;
  return attempts.some((attempt) => (
    attempt.enabled !== false
    && !isFutureTimestamp(attempt.health.cooldownUntil)
  ));
}

export function withStatus(health: RuntimeHealth, status: RuntimeHealthStatus): RuntimeHealth {
  return { ...health, status };
}

export function mapAggregateRow(
  row: AggregateRow | undefined,
  source: RuntimeHealthSource,
  window: RuntimeObservationWindow,
): RuntimeHealth {
  const totalCalls = Number(row?.totalCalls || 0);
  const successCalls = Number(row?.successCalls || 0);
  const failedCalls = Number(row?.failedCalls || 0);
  const latencySamples = Number(row?.latencyCount || 0);
  const totalLatencyMs = Number(row?.totalLatencyMs || 0);
  const firstTokenLatencySamples = Number(row?.firstTokenLatencyCount || 0);
  const totalFirstTokenLatencyMs = Number(row?.totalFirstTokenLatencyMs || 0);
  const outputTokens = Number(row?.outputTokens || 0);
  const outputTokenDurationMs = Number(row?.outputTokenDurationMs || 0);
  const outputTokenSamples = Number(row?.outputTokenSampleCount || 0);
  const successRate = totalCalls > 0
    ? Math.round((successCalls / totalCalls) * 10_000) / 100
    : null;
  const avgLatencyMs = latencySamples > 0 ? Math.round(totalLatencyMs / latencySamples) : null;
  const avgFirstTokenLatencyMs = firstTokenLatencySamples > 0
    ? Math.round(totalFirstTokenLatencyMs / firstTokenLatencySamples)
    : null;
  const avgOutputTokensPerSecond = outputTokens > 0 && outputTokenDurationMs > 0
    ? Math.round((outputTokens / outputTokenDurationMs) * 1000 * 100) / 100
    : null;
  return {
    status: statusFromHealth(successRate, avgLatencyMs, avgFirstTokenLatencyMs, totalCalls),
    successRate,
    totalCalls,
    successCalls,
    failedCalls,
    avgLatencyMs,
    latencySamples,
    avgFirstTokenLatencyMs,
    firstTokenLatencySamples,
    avgOutputTokensPerSecond,
    outputTokens,
    outputTokenDurationMs,
    outputTokenSamples,
    source: totalCalls > 0 ? source : 'none',
    window,
  };
}

export function emptyHealth(window: RuntimeObservationWindow): RuntimeHealth {
  return mapAggregateRow(undefined, 'none', window);
}
