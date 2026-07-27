import { and, desc, eq, gte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getLocalRangeStartUtc } from './localTimeService.js';
import type { CompiledRouteRuntimeRequest } from './compiledRuntimeRequestTypes.js';

const MIN_FORECAST_SAMPLES = 20;
const MAX_FORECAST_SAMPLES = 400;
const FORECAST_CACHE_TTL_MS = 30_000;

type ForecastCacheEntry = {
  expiresAt: number;
  value: Promise<CompiledRuntimeUsageForecast>;
};

const forecastCache = new Map<string, ForecastCacheEntry>();

export type CompiledRuntimeRequestUsageConstraints = {
  inputBytes: number | null;
  maxOutputTokens: number | null;
};

export type CompiledRuntimeUsageForecast =
  | {
      status: 'available';
      sampleCount: number;
      confidence: number;
      estimatedInputTokens: number;
      expectedOutputTokens: number;
      p90OutputTokens: number;
      maxOutputTokens: number | null;
    }
  | {
      status: 'insufficient_data';
      sampleCount: number;
      confidence: number;
      maxOutputTokens: number | null;
    };

export type CompiledRuntimeUsageObservation = {
  inputBytes: number;
  maxOutputTokens: number | null;
  promptTokens: number;
  completionTokens: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function positiveInteger(value: unknown): number | null {
  const numeric = nonNegativeInteger(value);
  return numeric != null && numeric > 0 ? numeric : null;
}

function payloadForUsageConstraints(request: CompiledRouteRuntimeRequest | null | undefined): Record<string, unknown> | null {
  if (isRecord(request?.normalizedPayload)) return request.normalizedPayload;
  if (isRecord(request?.payload)) return request.payload;
  return null;
}

function maxOutputTokensFromPayload(payload: Record<string, unknown> | null): number | null {
  if (!payload) return null;
  for (const key of ['max_tokens', 'maxTokens', 'max_output_tokens', 'maxOutputTokens']) {
    const value = positiveInteger(payload[key]);
    if (value != null) return value;
  }
  const generationConfig = isRecord(payload.generationConfig) ? payload.generationConfig : null;
  return positiveInteger(generationConfig?.maxOutputTokens);
}

function serializedByteLength(value: Record<string, unknown> | null): number | null {
  if (!value) return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized ? Buffer.byteLength(serialized, 'utf8') : null;
  } catch {
    return null;
  }
}

export function compiledRuntimeRequestUsageConstraints(
  request: CompiledRouteRuntimeRequest | null | undefined,
): CompiledRuntimeRequestUsageConstraints {
  const payload = payloadForUsageConstraints(request);
  return {
    inputBytes: serializedByteLength(payload),
    maxOutputTokens: maxOutputTokensFromPayload(payload),
  };
}

function parseSnapshotUsageConstraints(value: unknown): CompiledRuntimeRequestUsageConstraints | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    const usage = isRecord(parsed) && isRecord(parsed.requestUsage)
      ? parsed.requestUsage
      : null;
    if (!usage) return null;
    const inputBytes = positiveInteger(usage.inputBytes);
    if (inputBytes == null) return null;
    return {
      inputBytes,
      maxOutputTokens: positiveInteger(usage.maxOutputTokens),
    };
  } catch {
    return null;
  }
}

function quantile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * percentile) - 1));
  return ordered[index] || 0;
}

function sameRequestShape(
  observation: CompiledRuntimeUsageObservation,
  constraints: CompiledRuntimeRequestUsageConstraints,
): boolean {
  if (constraints.inputBytes == null || constraints.inputBytes <= 0) return false;
  const inputRatio = observation.inputBytes / constraints.inputBytes;
  if (inputRatio < 0.5 || inputRatio > 2) return false;
  if (constraints.maxOutputTokens == null) return observation.maxOutputTokens == null;
  if (observation.maxOutputTokens == null) return false;
  const outputRatio = observation.maxOutputTokens / constraints.maxOutputTokens;
  return outputRatio >= 0.5 && outputRatio <= 2;
}

export function forecastCompiledRuntimeUsage(input: {
  constraints: CompiledRuntimeRequestUsageConstraints;
  observations: CompiledRuntimeUsageObservation[];
}): CompiledRuntimeUsageForecast {
  const matching = input.observations.filter((observation) => sameRequestShape(observation, input.constraints));
  const sampleCount = matching.length;
  const confidence = Math.min(1, sampleCount / MIN_FORECAST_SAMPLES);
  if (sampleCount < MIN_FORECAST_SAMPLES || input.constraints.inputBytes == null) {
    return {
      status: 'insufficient_data',
      sampleCount,
      confidence,
      maxOutputTokens: input.constraints.maxOutputTokens,
    };
  }

  const inputTokenRatios = matching
    .map((observation) => observation.promptTokens / observation.inputBytes)
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (inputTokenRatios.length < MIN_FORECAST_SAMPLES) {
    return {
      status: 'insufficient_data',
      sampleCount: inputTokenRatios.length,
      confidence: Math.min(1, inputTokenRatios.length / MIN_FORECAST_SAMPLES),
      maxOutputTokens: input.constraints.maxOutputTokens,
    };
  }

  const estimatedInputTokens = Math.max(0, Math.round(quantile(inputTokenRatios, 0.5) * input.constraints.inputBytes));
  const completionTokens = matching
    .map((observation) => observation.completionTokens)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const clampOutput = (value: number) => input.constraints.maxOutputTokens == null
    ? value
    : Math.min(value, input.constraints.maxOutputTokens);
  return {
    status: 'available',
    sampleCount,
    confidence,
    estimatedInputTokens,
    expectedOutputTokens: clampOutput(Math.round(quantile(completionTokens, 0.5))),
    p90OutputTokens: clampOutput(Math.round(quantile(completionTokens, 0.9))),
    maxOutputTokens: input.constraints.maxOutputTokens,
  };
}

function forecastCacheKey(input: {
  entryId: string;
  constraints: CompiledRuntimeRequestUsageConstraints;
}): string {
  return [
    input.entryId,
    input.constraints.inputBytes ?? 'unknown-input',
    input.constraints.maxOutputTokens ?? 'unbounded-output',
  ].join(':');
}

export function invalidateCompiledRuntimeUsageForecast(entryId?: string | null): void {
  const normalizedEntryId = String(entryId || '').trim();
  if (!normalizedEntryId) {
    forecastCache.clear();
    return;
  }
  for (const key of forecastCache.keys()) {
    if (key.startsWith(`${normalizedEntryId}:`)) forecastCache.delete(key);
  }
}

async function loadCompiledRuntimeUsageForecastUncached(input: {
  entryId: string;
  constraints: CompiledRuntimeRequestUsageConstraints;
  now?: Date;
}): Promise<CompiledRuntimeUsageForecast> {
  const entryId = String(input.entryId || '').trim();
  if (!entryId) {
    return forecastCompiledRuntimeUsage({ constraints: input.constraints, observations: [] });
  }
  const rows = await db.select({
    promptTokens: schema.proxyRequests.promptTokens,
    completionTokens: schema.proxyRequests.completionTokens,
    decisionSnapshot: schema.proxyRequests.decisionSnapshot,
  }).from(schema.proxyRequests)
    .where(and(
      eq(schema.proxyRequests.routeEntrypointId, entryId),
      eq(schema.proxyRequests.status, 'success'),
      gte(schema.proxyRequests.completedAt, getLocalRangeStartUtc(30, input.now)),
    ))
    .orderBy(desc(schema.proxyRequests.completedAt))
    .limit(MAX_FORECAST_SAMPLES)
    .all();

  const observations: CompiledRuntimeUsageObservation[] = [];
  for (const row of rows) {
    const snapshot = parseSnapshotUsageConstraints(row.decisionSnapshot);
    const promptTokens = nonNegativeInteger(row.promptTokens);
    const completionTokens = nonNegativeInteger(row.completionTokens);
    if (snapshot?.inputBytes == null || promptTokens == null || completionTokens == null) continue;
    observations.push({
      inputBytes: snapshot.inputBytes,
      maxOutputTokens: snapshot.maxOutputTokens,
      promptTokens,
      completionTokens,
    });
  }
  return forecastCompiledRuntimeUsage({ constraints: input.constraints, observations });
}

export async function loadCompiledRuntimeUsageForecast(input: {
  entryId: string;
  request: CompiledRouteRuntimeRequest | null | undefined;
  now?: Date;
}): Promise<CompiledRuntimeUsageForecast> {
  const constraints = compiledRuntimeRequestUsageConstraints(input.request);
  const entryId = String(input.entryId || '').trim();
  if (!entryId) return forecastCompiledRuntimeUsage({ constraints, observations: [] });
  const key = forecastCacheKey({ entryId, constraints });
  const nowMs = input.now?.getTime() ?? Date.now();
  const cached = forecastCache.get(key);
  if (cached && cached.expiresAt > nowMs) return await cached.value;
  const value = loadCompiledRuntimeUsageForecastUncached({ entryId, constraints, now: input.now });
  forecastCache.set(key, { expiresAt: nowMs + FORECAST_CACHE_TTL_MS, value });
  try {
    return await value;
  } catch (error) {
    forecastCache.delete(key);
    throw error;
  }
}
