import type {
  RouteRuntimeExecutionAttemptSnapshot,
  RouteRuntimeFiltersSnapshot,
  RouteRuntimeMetadataSnapshot,
  RouteRuntimeSnapshot,
  RouteRuntimeSnapshotPayload,
  RouteRuntimeStateSnapshot,
} from '../../shared/routeRuntimeSnapshot.js';

type NullableNumber = number | null;

export type ProxyLogRuntimeMetadataSnapshot = RouteRuntimeMetadataSnapshot;
export type ProxyLogRouteRuntimeSnapshot = RouteRuntimeSnapshotPayload;
export type ProxyLogRouteRuntime = RouteRuntimeSnapshot;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNullableNumber(value: unknown): value is NullableNumber {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function parseStoredJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === 'string') ? value : null;
}

function positiveIntegerArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => Number.isSafeInteger(item) && item > 0) ? value as number[] : null;
}

function nullableRecord(value: unknown): Record<string, unknown> | null | undefined {
  if (value === null) return null;
  return isRecord(value) ? value : undefined;
}

function parseMetadata(value: unknown): RouteRuntimeMetadataSnapshot | null {
  if (!isRecord(value)) return null;
  const graph = nullableRecord(value.graph);
  const plan = nullableRecord(value.plan);
  const selection = nullableRecord(value.selection);
  const endpoint = nullableRecord(value.endpoint);
  const executionAttempt = nullableRecord(value.executionAttempt);
  if (
    graph === undefined
    || plan === undefined
    || selection === undefined
    || endpoint === undefined
    || executionAttempt === undefined
  ) return null;
  return { graph, plan, selection, endpoint, executionAttempt };
}

function parseEndpointPreference(value: unknown): RouteRuntimeFiltersSnapshot['endpointPreference'] | undefined {
  if (value === null || value === 'chat' || value === 'messages' || value === 'responses') return value;
  return undefined;
}

function parseState(value: unknown): RouteRuntimeStateSnapshot | null {
  if (!isRecord(value) || !isRecord(value.failureOverlay)) return null;
  const disabledExecutionAttemptIds = stringArray(value.failureOverlay.disabledExecutionAttemptIds);
  const disabledExecutionTargetIds = positiveIntegerArray(value.failureOverlay.disabledExecutionTargetIds);
  if (!disabledExecutionAttemptIds || !disabledExecutionTargetIds) return null;
  if (value.executionAttemptState !== null && !isRecord(value.executionAttemptState)) return null;
  const rawState = value.executionAttemptState;
  if (rawState && (
    !isNullableNumber(rawState.executionTargetId)
    || !isNullableNumber(rawState.successCount)
    || !isNullableNumber(rawState.failCount)
    || !isNullableNumber(rawState.totalLatencyMs)
    || !isNullableNumber(rawState.latencySampleCount)
    || !isNullableNumber(rawState.consecutiveFailCount)
    || !isNullableNumber(rawState.cooldownLevel)
    || !isNullableText(rawState.cooldownUntil)
    || !isNullableText(rawState.lastUsedAt)
    || !isNullableText(rawState.lastSelectedAt)
    || !isNullableText(rawState.lastFailAt)
  )) return null;
  const executionAttemptState = rawState as NonNullable<RouteRuntimeStateSnapshot['executionAttemptState']> | null;
  return {
    failureOverlay: {
      disabledExecutionAttemptIds,
      disabledExecutionTargetIds,
    },
    executionAttemptState: executionAttemptState ? {
      executionTargetId: executionAttemptState.executionTargetId,
      successCount: executionAttemptState.successCount,
      failCount: executionAttemptState.failCount,
      totalLatencyMs: executionAttemptState.totalLatencyMs,
      latencySampleCount: executionAttemptState.latencySampleCount,
      consecutiveFailCount: executionAttemptState.consecutiveFailCount,
      cooldownLevel: executionAttemptState.cooldownLevel,
      cooldownUntil: executionAttemptState.cooldownUntil,
      lastUsedAt: executionAttemptState.lastUsedAt,
      lastSelectedAt: executionAttemptState.lastSelectedAt,
      lastFailAt: executionAttemptState.lastFailAt,
    } : null,
  };
}

function parseFilters(value: unknown): RouteRuntimeFiltersSnapshot | null {
  if (!isRecord(value)) return null;
  const endpointPreference = parseEndpointPreference(value.endpointPreference);
  const postBuild = nullableRecord(value.postBuild);
  if (endpointPreference === undefined || postBuild === undefined) return null;
  return { endpointPreference, postBuild };
}

function parseRequestUsage(value: unknown): RouteRuntimeSnapshotPayload['requestUsage'] | null {
  if (!isRecord(value)) return null;
  if (!isNullableNumber(value.inputBytes) || !isNullableNumber(value.maxOutputTokens)) return null;
  return {
    inputBytes: value.inputBytes,
    maxOutputTokens: value.maxOutputTokens,
  };
}

function parseEndpoint(value: unknown): ProxyLogRouteRuntimeSnapshot['endpoint'] | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (!isNullableText(value.endpointId) || !isNullableNumber(value.executionTargetId)) return undefined;
  const compatibilityPolicy = nullableRecord(value.compatibilityPolicy);
  if (compatibilityPolicy === undefined) return undefined;
  return {
    endpointId: value.endpointId,
    executionTargetId: value.executionTargetId,
    compatibilityPolicy,
  };
}

function parseExecutionAttempt(value: unknown): RouteRuntimeExecutionAttemptSnapshot | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (
    !isNullableText(value.executionAttemptId)
    || !isNullableText(value.model)
    || !isNullableNumber(value.executionTargetId)
    || !isNullableNumber(value.accountId)
    || !isNullableNumber(value.tokenId)
    || !isNullableNumber(value.siteId)
    || (value.credential !== null && !isRecord(value.credential))
  ) return undefined;
  return value as RouteRuntimeExecutionAttemptSnapshot;
}

function parseSyntheticResponse(value: unknown): ProxyLogRouteRuntimeSnapshot['syntheticResponse'] | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (value.statusCode !== 429 && value.statusCode !== 503) return undefined;
  if (typeof value.message !== 'string' || value.message.length === 0) return undefined;
  return {
    statusCode: value.statusCode,
    message: value.message,
  };
}

function parseCanonicalSnapshot(value: unknown): ProxyLogRouteRuntimeSnapshot | null {
  const record = parseStoredJsonObject(value);
  if (!record || typeof record.capturedAt !== 'string' || record.capturedAt.length === 0) return null;
  if (!isRecord(record.request) || !isRecord(record.compiledRuntime) || !isRecord(record.match)) return null;
  if (!isNullableText(record.request.downstreamPath)) return null;
  if (record.request.stream !== null && typeof record.request.stream !== 'boolean') return null;
  if (
    !isNullableText(record.compiledRuntime.runtimeArtifactId)
    || !isNullableText(record.compiledRuntime.bundleHash)
    || (record.compiledRuntime.program !== null && !isRecord(record.compiledRuntime.program))
  ) return null;
  if (
    !isNullableText(record.match.requestedModel)
    || !isNullableText(record.match.actualModel)
    || !isNullableText(record.match.planId)
    || !isNullableText(record.match.entryId)
    || !isNullableText(record.match.publicModelName)
  ) return null;
  const terminalKind = record.match.terminalKind;
  if (terminalKind !== null && terminalKind !== 'endpoint' && terminalKind !== 'synthetic_response') return null;

  const metadata = parseMetadata(record.metadata);
  const endpoint = parseEndpoint(record.endpoint);
  const executionAttempt = parseExecutionAttempt(record.executionAttempt);
  const state = parseState(record.state);
  const filters = parseFilters(record.filters);
  const requestUsage = parseRequestUsage(record.requestUsage);
  const syntheticResponse = parseSyntheticResponse(record.syntheticResponse);
  if (
    !metadata
    || endpoint === undefined
    || executionAttempt === undefined
    || !state
    || !filters
    || !requestUsage
    || syntheticResponse === undefined
  ) return null;

  return {
    capturedAt: record.capturedAt,
    request: {
      downstreamPath: record.request.downstreamPath,
      stream: record.request.stream,
    },
    compiledRuntime: {
      runtimeArtifactId: record.compiledRuntime.runtimeArtifactId,
      bundleHash: record.compiledRuntime.bundleHash,
      program: record.compiledRuntime.program as ProxyLogRouteRuntimeSnapshot['compiledRuntime']['program'],
    },
    match: {
      requestedModel: record.match.requestedModel,
      actualModel: record.match.actualModel,
      planId: record.match.planId,
      entryId: record.match.entryId,
      publicModelName: record.match.publicModelName,
      terminalKind,
    },
    metadata,
    endpoint,
    executionAttempt,
    requestUsage,
    state,
    filters,
    syntheticResponse,
  };
}

export function mapRouteRuntimeSnapshotToResponse(value: unknown): ProxyLogRouteRuntime | null {
  const snapshot = parseCanonicalSnapshot(value);
  if (!snapshot) return null;
  return {
    ...snapshot,
    source: 'snapshot',
  };
}
