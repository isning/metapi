import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { config } from '../config.js';
import {
  endpointTypeFromRequest,
  endpointTypeFromUpstreamEndpoint,
} from '../contracts/upstreamEndpointType.js';
import { db, schema } from '../db/index.js';
import { requireInsertedRowId } from '../db/insertHelpers.js';
import { formatUtcSqlDateTime } from './localTimeService.js';

type HeadersLike = Headers | Record<string, unknown> | null | undefined;

export type ProxyDebugCaptureOptions = {
  enabled: boolean;
  captureHeaders: boolean;
  captureBodies: boolean;
  captureStreamChunks: boolean;
  targetSessionId: string;
  targetClientKind: string;
  targetModel: string;
  retentionHours: number;
  maxBodyBytes: number;
};

export type ProxyDebugTraceSession = {
  traceId: number;
  options: ProxyDebugCaptureOptions;
};

let lastPruneAtMs = 0;
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;

type TruncatedDebugPreview = {
  __metapiTruncated: true;
  preview: string;
  originalBytes: number;
  storedBytes: number;
};

function buildTruncatedDebugPreview(text: string, maxBytes: number, originalBytes: number): string {
  const truncated = Buffer.from(text, 'utf8').subarray(0, Math.max(0, maxBytes)).toString('utf8');
  const payload: TruncatedDebugPreview = {
    __metapiTruncated: true,
    preview: truncated,
    originalBytes,
    storedBytes: maxBytes,
  };
  return JSON.stringify(payload, null, 2);
}

function stringifyDebugValue(value: unknown, maxBytes: number): string | null {
  if (value == null) return null;

  let text = '';
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }

  if (!text) return null;
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) {
    return text;
  }

  return buildTruncatedDebugPreview(text, maxBytes, buffer.length);
}

function normalizeHeadersValue(value: HeadersLike): Record<string, unknown> | null {
  if (!value) return null;

  const headerEntries = value as { entries?: unknown; get?: unknown };
  if (typeof headerEntries.get === 'function' && typeof headerEntries.entries === 'function') {
    return Object.fromEntries(
      [...headerEntries.entries.call(value) as Iterable<[string, string]>]
        .sort((left, right) => left[0].localeCompare(right[0])),
    );
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value)
    .filter(([key]) => !!key)
    .sort((left, right) => left[0].localeCompare(right[0]));
  return Object.fromEntries(entries);
}

function normalizeLimit(rawLimit: number | undefined): number {
  const parsed = Number(rawLimit || 20);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(200, Math.trunc(parsed)));
}

function asNormalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getCaptureOptions(): ProxyDebugCaptureOptions {
  return {
    enabled: config.proxyDebugTraceEnabled,
    captureHeaders: config.proxyDebugCaptureHeaders,
    captureBodies: config.proxyDebugCaptureBodies,
    captureStreamChunks: config.proxyDebugCaptureStreamChunks,
    targetSessionId: (config.proxyDebugFilterSessionId || '').trim(),
    targetClientKind: (config.proxyDebugFilterClientKind || '').trim(),
    targetModel: (config.proxyDebugFilterModel || '').trim(),
    retentionHours: Math.max(1, Math.trunc(config.proxyDebugRetentionHours || 24)),
    maxBodyBytes: Math.max(1024, Math.trunc(config.proxyDebugMaxBodyBytes || 262_144)),
  };
}

function serializeHeaders(value: HeadersLike, maxBytes: number): string | null {
  return stringifyDebugValue(normalizeHeadersValue(value), maxBytes);
}

export function normalizeProxyDebugResponseHeaders(value: HeadersLike): Record<string, unknown> | null {
  return normalizeHeadersValue(value);
}

export function getProxyDebugCaptureOptions(): ProxyDebugCaptureOptions {
  return getCaptureOptions();
}

export function shouldTraceProxyDebugRequest(input: {
  clientKind?: string | null;
  sessionId?: string | null;
  requestedModel?: string | null;
}, options = getCaptureOptions()): boolean {
  if (!options.enabled) return false;

  const targetSessionId = options.targetSessionId;
  if (targetSessionId && (input.sessionId || '').trim() !== targetSessionId) {
    return false;
  }

  const targetClientKind = asNormalizedText(options.targetClientKind);
  if (targetClientKind && asNormalizedText(input.clientKind) !== targetClientKind) {
    return false;
  }

  const targetModel = asNormalizedText(options.targetModel);
  if (targetModel && asNormalizedText(input.requestedModel) !== targetModel) {
    return false;
  }

  return true;
}

export async function deleteExpiredProxyDebugTraces(retentionHours = config.proxyDebugRetentionHours): Promise<number> {
  const normalizedRetentionHours = Math.max(1, Math.trunc(Number(retentionHours || 24)));
  const cutoff = formatUtcSqlDateTime(new Date(Date.now() - (normalizedRetentionHours * 60 * 60 * 1000)));
  const result = await db
    .delete(schema.proxyDebugTraces)
    .where(lt(schema.proxyDebugTraces.createdAt, cutoff))
    .run();
  return Number(result.changes || 0);
}

async function pruneProxyDebugTracesIfNeeded(nowMs = Date.now(), retentionHours = config.proxyDebugRetentionHours): Promise<void> {
  if (nowMs - lastPruneAtMs < PRUNE_INTERVAL_MS) return;
  lastPruneAtMs = nowMs;
  try {
    await deleteExpiredProxyDebugTraces(retentionHours);
  } catch (error) {
    console.warn('[proxy-debug] failed to prune expired traces', error);
  }
}

export async function createProxyDebugTrace(input: {
  requestId?: string | null;
  downstreamPath: string;
  clientKind?: string | null;
  sessionId?: string | null;
  traceHint?: string | null;
  requestedModel?: string | null;
  downstreamApiKeyId?: number | null;
  requestHeaders?: HeadersLike;
  requestBody?: unknown;
  maxBodyBytes?: number;
}) {
  const now = formatUtcSqlDateTime(new Date());
  const maxBodyBytes = Math.max(1024, Math.trunc(input.maxBodyBytes || config.proxyDebugMaxBodyBytes || 262_144));
  await pruneProxyDebugTracesIfNeeded(Date.now(), config.proxyDebugRetentionHours);

  const inserted = await db.insert(schema.proxyDebugTraces).values({
    requestId: input.requestId ?? null,
    downstreamPath: input.downstreamPath,
    clientKind: input.clientKind ?? null,
    sessionId: input.sessionId ?? null,
    traceHint: input.traceHint ?? null,
    requestedModel: input.requestedModel ?? null,
    downstreamApiKeyId: input.downstreamApiKeyId ?? null,
    requestHeadersJson: serializeHeaders(input.requestHeaders, maxBodyBytes),
    requestBodyJson: stringifyDebugValue(input.requestBody, maxBodyBytes),
    createdAt: now,
    updatedAt: now,
  }).run();

  return {
    id: requireInsertedRowId(inserted, 'failed to create proxy debug trace'),
    createdAt: now,
  };
}

export async function startProxyDebugTraceSession(input: {
  requestId?: string | null;
  downstreamPath: string;
  clientKind?: string | null;
  sessionId?: string | null;
  traceHint?: string | null;
  requestedModel?: string | null;
  downstreamApiKeyId?: number | null;
  requestHeaders?: HeadersLike;
  requestBody?: unknown;
}): Promise<ProxyDebugTraceSession | null> {
  const options = getCaptureOptions();
  if (!shouldTraceProxyDebugRequest(input, options)) {
    return null;
  }

  const trace = await createProxyDebugTrace({
    requestId: input.requestId ?? null,
    downstreamPath: input.downstreamPath,
    clientKind: input.clientKind ?? null,
    sessionId: input.sessionId ?? null,
    traceHint: input.traceHint ?? null,
    requestedModel: input.requestedModel ?? null,
    downstreamApiKeyId: input.downstreamApiKeyId ?? null,
    requestHeaders: options.captureHeaders ? input.requestHeaders : null,
    requestBody: options.captureBodies ? input.requestBody : null,
    maxBodyBytes: options.maxBodyBytes,
  });

  return {
    traceId: trace.id,
    options,
  };
}

export async function updateProxyDebugTraceSelection(traceId: number, input: {
  stickySessionKey?: string | null;
  stickyHitExecutionAttemptId?: string | null;
  selectedExecutionAttemptId?: string | null;
  routeEntrypointId?: string | null;
  runtimeEndpointId?: string | null;
  selectedAccountId?: number | null;
  selectedSiteId?: number | null;
  selectedSitePlatform?: string | null;
}) {
  const now = formatUtcSqlDateTime(new Date());
  await db.update(schema.proxyDebugTraces).set({
    stickySessionKey: input.stickySessionKey ?? null,
    stickyHitExecutionAttemptId: input.stickyHitExecutionAttemptId ?? null,
    selectedExecutionAttemptId: input.selectedExecutionAttemptId ?? null,
    routeEntrypointId: input.routeEntrypointId ?? null,
    runtimeEndpointId: input.runtimeEndpointId ?? null,
    selectedAccountId: input.selectedAccountId ?? null,
    selectedSiteId: input.selectedSiteId ?? null,
    selectedSitePlatform: input.selectedSitePlatform ?? null,
    updatedAt: now,
  }).where(eq(schema.proxyDebugTraces.id, traceId)).run();
}

export async function updateProxyDebugTraceRuntime(traceId: number, input: {
  protocol?: unknown;
  runtimeState?: unknown;
  context?: unknown;
  preflightOutcomes?: unknown;
}) {
  const now = formatUtcSqlDateTime(new Date());
  await db.update(schema.proxyDebugTraces).set({
    runtimeTraceJson: stringifyDebugValue(input, config.proxyDebugMaxBodyBytes),
    updatedAt: now,
  }).where(eq(schema.proxyDebugTraces.id, traceId)).run();
}

export async function appendProxyDebugTracePreflightOutcome(traceId: number, outcome: unknown) {
  const trace = await db.select({ runtimeTraceJson: schema.proxyDebugTraces.runtimeTraceJson })
    .from(schema.proxyDebugTraces)
    .where(eq(schema.proxyDebugTraces.id, traceId))
    .get();
  let runtimeTrace: Record<string, unknown> = {};
  if (trace?.runtimeTraceJson) {
    try {
      const parsed = JSON.parse(trace.runtimeTraceJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        runtimeTrace = parsed as Record<string, unknown>;
      }
    } catch {
      // Preserve the trace by replacing only malformed runtime metadata.
    }
  }
  const preflightOutcomes = Array.isArray(runtimeTrace.preflightOutcomes)
    ? runtimeTrace.preflightOutcomes
    : [];
  await updateProxyDebugTraceRuntime(traceId, {
    ...runtimeTrace,
    preflightOutcomes: [...preflightOutcomes, outcome],
  });
}

export async function insertProxyDebugAttempt(input: {
  traceId: number;
  attemptIndex: number;
  executionAttemptId?: string | null;
  endpoint: string;
  requestPath: string;
  targetUrl: string;
  runtimeExecutor?: string | null;
  requestHeaders?: HeadersLike;
  requestBody?: unknown;
  responseStatus?: number | null;
  responseHeaders?: HeadersLike;
  responseBody?: unknown;
  rawErrorText?: string | null;
  recoverApplied?: boolean;
  downgradeDecision?: boolean;
  downgradeReason?: string | null;
  fallbackScope?: string | null;
  failureClass?: string | null;
  memoryWrite?: unknown;
  maxBodyBytes?: number;
}) {
  const now = formatUtcSqlDateTime(new Date());
  const maxBodyBytes = Math.max(1024, Math.trunc(input.maxBodyBytes || config.proxyDebugMaxBodyBytes || 262_144));
  const inserted = await db.insert(schema.proxyDebugAttempts).values({
    traceId: input.traceId,
    attemptIndex: input.attemptIndex,
    executionAttemptId: input.executionAttemptId ?? null,
    endpoint: input.endpoint,
    requestPath: input.requestPath,
    targetUrl: input.targetUrl,
    runtimeExecutor: input.runtimeExecutor ?? null,
    requestHeadersJson: serializeHeaders(input.requestHeaders, maxBodyBytes),
    requestBodyJson: stringifyDebugValue(input.requestBody, maxBodyBytes),
    responseStatus: input.responseStatus ?? null,
    responseHeadersJson: serializeHeaders(input.responseHeaders, maxBodyBytes),
    responseBodyJson: stringifyDebugValue(input.responseBody, maxBodyBytes),
    rawErrorText: input.rawErrorText ?? null,
    recoverApplied: input.recoverApplied === true,
    downgradeDecision: input.downgradeDecision === true,
    downgradeReason: input.downgradeReason ?? null,
    fallbackScope: input.fallbackScope ?? null,
    failureClass: input.failureClass ?? null,
    memoryWriteJson: stringifyDebugValue(input.memoryWrite, maxBodyBytes),
    createdAt: now,
  }).run();

  return {
    id: requireInsertedRowId(inserted, 'failed to create proxy debug attempt'),
    createdAt: now,
  };
}

export async function updateProxyDebugAttempt(traceId: number, attemptIndex: number, input: {
  requestHeaders?: HeadersLike;
  requestBody?: unknown;
  responseStatus?: number | null;
  responseHeaders?: HeadersLike;
  responseBody?: unknown;
  recoverApplied?: boolean;
  downgradeDecision?: boolean;
  downgradeReason?: string | null;
  fallbackScope?: string | null;
  failureClass?: string | null;
  rawErrorText?: string | null;
  memoryWrite?: unknown;
  maxBodyBytes?: number;
}) {
  const maxBodyBytes = Math.max(1024, Math.trunc(input.maxBodyBytes || config.proxyDebugMaxBodyBytes || 262_144));
  await db.update(schema.proxyDebugAttempts).set({
    ...(input.requestHeaders !== undefined ? { requestHeadersJson: serializeHeaders(input.requestHeaders, maxBodyBytes) } : {}),
    ...(input.requestBody !== undefined ? { requestBodyJson: stringifyDebugValue(input.requestBody, maxBodyBytes) } : {}),
    ...(input.responseStatus !== undefined ? { responseStatus: input.responseStatus } : {}),
    ...(input.responseHeaders !== undefined ? { responseHeadersJson: serializeHeaders(input.responseHeaders, maxBodyBytes) } : {}),
    ...(input.responseBody !== undefined ? { responseBodyJson: stringifyDebugValue(input.responseBody, maxBodyBytes) } : {}),
    ...(input.recoverApplied !== undefined ? { recoverApplied: input.recoverApplied === true } : {}),
    ...(input.downgradeDecision !== undefined ? { downgradeDecision: input.downgradeDecision } : {}),
    ...(input.downgradeReason !== undefined ? { downgradeReason: input.downgradeReason } : {}),
    ...(input.fallbackScope !== undefined ? { fallbackScope: input.fallbackScope } : {}),
    ...(input.failureClass !== undefined ? { failureClass: input.failureClass } : {}),
    ...(input.rawErrorText !== undefined ? { rawErrorText: input.rawErrorText } : {}),
    ...(input.memoryWrite !== undefined ? { memoryWriteJson: stringifyDebugValue(input.memoryWrite, maxBodyBytes) } : {}),
  }).where(and(
    eq(schema.proxyDebugAttempts.traceId, traceId),
    eq(schema.proxyDebugAttempts.attemptIndex, attemptIndex),
  )).run();
}

export async function finalizeProxyDebugTrace(traceId: number, input: {
  finalStatus?: string | null;
  finalHttpStatus?: number | null;
  finalUpstreamPath?: string | null;
  finalResponseHeaders?: HeadersLike;
  finalResponseBody?: unknown;
  maxBodyBytes?: number;
}) {
  const now = formatUtcSqlDateTime(new Date());
  const maxBodyBytes = Math.max(1024, Math.trunc(input.maxBodyBytes || config.proxyDebugMaxBodyBytes || 262_144));
  await db.update(schema.proxyDebugTraces).set({
    finalStatus: input.finalStatus ?? null,
    finalHttpStatus: input.finalHttpStatus ?? null,
    finalUpstreamPath: input.finalUpstreamPath ?? null,
    finalResponseHeadersJson: serializeHeaders(input.finalResponseHeaders, maxBodyBytes),
    finalResponseBodyJson: stringifyDebugValue(input.finalResponseBody, maxBodyBytes),
    updatedAt: now,
  }).where(eq(schema.proxyDebugTraces.id, traceId)).run();
}

type ProxyDebugTraceListRow = {
  id: number;
  requestId: string | null;
  createdAt: string | null;
  downstreamPath: string;
  clientKind: string | null;
  sessionId: string | null;
  requestedModel: string | null;
  selectedExecutionAttemptId: string | null;
  finalStatus: string | null;
  finalHttpStatus: number | null;
  finalUpstreamPath: string | null;
};

export async function listProxyDebugTraces(input: { limit?: number }) {
  const limit = normalizeLimit(input.limit);
  const rows: ProxyDebugTraceListRow[] = await db.select({
    id: schema.proxyDebugTraces.id,
    requestId: schema.proxyDebugTraces.requestId,
    createdAt: schema.proxyDebugTraces.createdAt,
    downstreamPath: schema.proxyDebugTraces.downstreamPath,
    clientKind: schema.proxyDebugTraces.clientKind,
    sessionId: schema.proxyDebugTraces.sessionId,
    requestedModel: schema.proxyDebugTraces.requestedModel,
    selectedExecutionAttemptId: schema.proxyDebugTraces.selectedExecutionAttemptId,
    finalStatus: schema.proxyDebugTraces.finalStatus,
    finalHttpStatus: schema.proxyDebugTraces.finalHttpStatus,
    finalUpstreamPath: schema.proxyDebugTraces.finalUpstreamPath,
  }).from(schema.proxyDebugTraces)
    .orderBy(desc(schema.proxyDebugTraces.createdAt), desc(schema.proxyDebugTraces.id))
    .limit(limit)
    .all();
  return rows;
}

export async function getProxyDebugTraceDetail(
  traceId: number,
  options?: { includeBodies?: boolean; attemptBodyId?: number },
) {
  const includeBodies = options?.includeBodies === true;
  const attemptBodyId = Number.isFinite(options?.attemptBodyId) && (options?.attemptBodyId || 0) > 0
    ? Math.trunc(options!.attemptBodyId!)
    : null;
  const includeAllBodies = includeBodies && attemptBodyId == null;
  const trace = await db.select({
    id: schema.proxyDebugTraces.id,
    requestId: schema.proxyDebugTraces.requestId,
    downstreamPath: schema.proxyDebugTraces.downstreamPath,
    clientKind: schema.proxyDebugTraces.clientKind,
    sessionId: schema.proxyDebugTraces.sessionId,
    traceHint: schema.proxyDebugTraces.traceHint,
    requestedModel: schema.proxyDebugTraces.requestedModel,
    downstreamApiKeyId: schema.proxyDebugTraces.downstreamApiKeyId,
    requestHeadersJson: schema.proxyDebugTraces.requestHeadersJson,
    ...(includeAllBodies ? { requestBodyJson: schema.proxyDebugTraces.requestBodyJson } : {}),
    stickySessionKey: schema.proxyDebugTraces.stickySessionKey,
    stickyHitExecutionAttemptId: schema.proxyDebugTraces.stickyHitExecutionAttemptId,
    selectedExecutionAttemptId: schema.proxyDebugTraces.selectedExecutionAttemptId,
    routeEntrypointId: schema.proxyDebugTraces.routeEntrypointId,
    runtimeEndpointId: schema.proxyDebugTraces.runtimeEndpointId,
    selectedAccountId: schema.proxyDebugTraces.selectedAccountId,
    selectedSiteId: schema.proxyDebugTraces.selectedSiteId,
    selectedSitePlatform: schema.proxyDebugTraces.selectedSitePlatform,
    runtimeTraceJson: schema.proxyDebugTraces.runtimeTraceJson,
    finalStatus: schema.proxyDebugTraces.finalStatus,
    finalHttpStatus: schema.proxyDebugTraces.finalHttpStatus,
    finalUpstreamPath: schema.proxyDebugTraces.finalUpstreamPath,
    finalResponseHeadersJson: schema.proxyDebugTraces.finalResponseHeadersJson,
    ...(includeAllBodies ? { finalResponseBodyJson: schema.proxyDebugTraces.finalResponseBodyJson } : {}),
    createdAt: schema.proxyDebugTraces.createdAt,
    updatedAt: schema.proxyDebugTraces.updatedAt,
  }).from(schema.proxyDebugTraces)
    .where(eq(schema.proxyDebugTraces.id, traceId))
    .get();
  if (!trace) return null;

  const selectedSite = trace.selectedSiteId
    ? await db.select({
      id: schema.sites.id,
      name: schema.sites.name,
      platform: schema.sites.platform,
      url: schema.sites.url,
    }).from(schema.sites)
      .where(eq(schema.sites.id, trace.selectedSiteId))
      .get()
    : null;

  const attempts = await db.select({
    id: schema.proxyDebugAttempts.id,
    traceId: schema.proxyDebugAttempts.traceId,
    attemptIndex: schema.proxyDebugAttempts.attemptIndex,
    executionAttemptId: schema.proxyDebugAttempts.executionAttemptId,
    endpoint: schema.proxyDebugAttempts.endpoint,
    requestPath: schema.proxyDebugAttempts.requestPath,
    targetUrl: schema.proxyDebugAttempts.targetUrl,
    runtimeExecutor: schema.proxyDebugAttempts.runtimeExecutor,
    requestHeadersJson: schema.proxyDebugAttempts.requestHeadersJson,
    ...(includeAllBodies ? { requestBodyJson: schema.proxyDebugAttempts.requestBodyJson } : {}),
    responseStatus: schema.proxyDebugAttempts.responseStatus,
    responseHeadersJson: schema.proxyDebugAttempts.responseHeadersJson,
    ...(includeAllBodies ? { responseBodyJson: schema.proxyDebugAttempts.responseBodyJson } : {}),
    rawErrorText: schema.proxyDebugAttempts.rawErrorText,
    recoverApplied: schema.proxyDebugAttempts.recoverApplied,
    downgradeDecision: schema.proxyDebugAttempts.downgradeDecision,
    downgradeReason: schema.proxyDebugAttempts.downgradeReason,
    fallbackScope: schema.proxyDebugAttempts.fallbackScope,
    failureClass: schema.proxyDebugAttempts.failureClass,
    ...(includeAllBodies ? { memoryWriteJson: schema.proxyDebugAttempts.memoryWriteJson } : {}),
    createdAt: schema.proxyDebugAttempts.createdAt,
  }).from(schema.proxyDebugAttempts)
    .where(eq(schema.proxyDebugAttempts.traceId, traceId))
    .orderBy(asc(schema.proxyDebugAttempts.attemptIndex), asc(schema.proxyDebugAttempts.id))
    .all();

  let attemptsWithBodies = attempts;
  if (includeBodies && attemptBodyId != null) {
    const body = await db.select({
      id: schema.proxyDebugAttempts.id,
      requestBodyJson: schema.proxyDebugAttempts.requestBodyJson,
      responseBodyJson: schema.proxyDebugAttempts.responseBodyJson,
      memoryWriteJson: schema.proxyDebugAttempts.memoryWriteJson,
    }).from(schema.proxyDebugAttempts)
      .where(and(
        eq(schema.proxyDebugAttempts.traceId, traceId),
        eq(schema.proxyDebugAttempts.id, attemptBodyId),
      ))
      .get();
    attemptsWithBodies = attempts.map((attempt) => (
      attempt.id === body?.id ? { ...attempt, ...body } : attempt
    ));
  }

  return {
    trace: {
      ...trace,
      selectedSiteDisplay: selectedSite ? {
        id: selectedSite.id,
        label: selectedSite.name,
        platform: selectedSite.platform,
        url: selectedSite.url,
      } : null,
    },
    attempts: attemptsWithBodies.map((attempt) => ({
      ...attempt,
      endpointType: endpointTypeFromUpstreamEndpoint(attempt.endpoint)
        || endpointTypeFromRequest({ path: attempt.requestPath }),
    })),
  };
}

export async function findLatestProxyDebugTrace(input: {
  sessionId?: string | null;
  clientKind?: string | null;
  requestedModel?: string | null;
}) {
  const conditions = [
    input.sessionId ? eq(schema.proxyDebugTraces.sessionId, input.sessionId) : null,
    input.clientKind ? eq(schema.proxyDebugTraces.clientKind, input.clientKind) : null,
    input.requestedModel ? eq(schema.proxyDebugTraces.requestedModel, input.requestedModel) : null,
  ].filter((condition): condition is NonNullable<typeof condition> => condition !== null);

  let query = db.select().from(schema.proxyDebugTraces);
  if (conditions.length === 1) {
    query = query.where(conditions[0]) as typeof query;
  } else if (conditions.length > 1) {
    query = query.where(and(...conditions)) as typeof query;
  }
  return await query
    .orderBy(desc(schema.proxyDebugTraces.createdAt), desc(schema.proxyDebugTraces.id))
    .get();
}
