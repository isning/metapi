import type {
  RouteRuntimeExecutionAttemptSnapshot,
  RouteRuntimeDecisionSnapshot,
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

function isNullablePositiveInteger(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && Number(value) > 0);
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
  const affinity = parseAffinity(value.affinity);
  if (affinity === undefined) return undefined;
  return {
    ...(value as Omit<RouteRuntimeExecutionAttemptSnapshot, 'affinity'>),
    affinity,
  };
}

function parseAffinity(value: unknown): RouteRuntimeExecutionAttemptSnapshot['affinity'] | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return undefined;
  const mode = value.mode;
  const bindingOutcome = value.bindingOutcome;
  if (
    (mode !== 'disabled' && mode !== 'pool' && mode !== 'target')
    || !isNullableText(value.selectedPoolId)
    || !isNullableNumber(value.selectedExecutionTargetId)
    || !isNullableText(value.primaryPoolId)
    || !isNullableNumber(value.primaryExecutionTargetId)
    || !isNullableNumber(value.primaryRevision)
    || typeof value.fallback !== 'boolean'
    || typeof value.promoteOnSuccess !== 'boolean'
    || ![
      'pending',
      'bound',
      'primary_refreshed',
      'temporary_fallback',
      'promoted',
      'stale_ignored',
      'invalid',
      'disabled',
    ].includes(String(bindingOutcome))
    || !isNullableText(value.resultingPrimaryPoolId)
    || !isNullableNumber(value.resultingPrimaryExecutionTargetId)
    || !isNullableNumber(value.resultingRevision)
  ) return undefined;
  return {
    mode,
    selectedPoolId: value.selectedPoolId,
    selectedExecutionTargetId: value.selectedExecutionTargetId,
    primaryPoolId: value.primaryPoolId,
    primaryExecutionTargetId: value.primaryExecutionTargetId,
    primaryRevision: value.primaryRevision,
    fallback: value.fallback,
    promoteOnSuccess: value.promoteOnSuccess,
    bindingOutcome: bindingOutcome as NonNullable<RouteRuntimeExecutionAttemptSnapshot['affinity']>['bindingOutcome'],
    resultingPrimaryPoolId: value.resultingPrimaryPoolId,
    resultingPrimaryExecutionTargetId: value.resultingPrimaryExecutionTargetId,
    resultingRevision: value.resultingRevision,
  };
}

function parseDecisionCandidate(value: unknown): RouteRuntimeDecisionSnapshot['selectors'][number]['candidates'][number] | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.choiceId !== 'string'
    || !isNullableText(value.endpointId)
    || typeof value.enabled !== 'boolean'
    || typeof value.eligible !== 'boolean'
    || typeof value.selected !== 'boolean'
    || typeof value.weight !== 'number'
    || !Number.isFinite(value.weight)
    || typeof value.contribution !== 'number'
    || !Number.isFinite(value.contribution)
    || typeof value.order !== 'number'
    || !Number.isFinite(value.order)
    || typeof value.score !== 'number'
    || !Number.isFinite(value.score)
  ) return null;
  const executionTargetIds = positiveIntegerArray(value.executionTargetIds);
  if (!executionTargetIds) return null;
  let targets: NonNullable<RouteRuntimeDecisionSnapshot['selectors'][number]['candidates'][number]['targets']> | undefined;
  if (value.targets !== undefined) {
    if (!Array.isArray(value.targets)) return null;
    targets = [];
    for (const rawTarget of value.targets) {
      if (
        !isRecord(rawTarget)
        || !Number.isSafeInteger(rawTarget.executionTargetId)
        || Number(rawTarget.executionTargetId) <= 0
        || !isNullableText(rawTarget.executionAttemptId)
        || !isNullableText(rawTarget.upstreamModel)
        || (rawTarget.credential !== null && !isRecord(rawTarget.credential))
      ) return null;
      targets.push({
        executionTargetId: Number(rawTarget.executionTargetId),
        executionAttemptId: rawTarget.executionAttemptId,
        upstreamModel: rawTarget.upstreamModel,
        credential: rawTarget.credential as typeof targets[number]['credential'],
      });
    }
    const targetIds = targets.map((target) => target.executionTargetId);
    if (
      new Set(targetIds).size !== targetIds.length
      || targetIds.some((targetId) => !executionTargetIds.includes(targetId))
    ) return null;
  }
  return {
    choiceId: value.choiceId,
    endpointId: value.endpointId,
    executionTargetIds,
    ...(targets ? { targets } : {}),
    enabled: value.enabled,
    eligible: value.eligible,
    selected: value.selected,
    weight: value.weight,
    contribution: value.contribution,
    order: value.order,
    score: value.score,
  };
}

function parseDecision(value: unknown): RouteRuntimeDecisionSnapshot | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !isNullableText(value.selectedAlternativeId)) return undefined;
  if (!Array.isArray(value.selectors) || !Array.isArray(value.fallbackStages)) return undefined;
  const selectors: RouteRuntimeDecisionSnapshot['selectors'] = [];
  for (const rawSelector of value.selectors) {
    if (!isRecord(rawSelector)) return undefined;
    const policySource = rawSelector.policySource;
    const policyKind = rawSelector.policyKind;
    if (
      typeof rawSelector.selectorId !== 'string'
      || !isNullableText(rawSelector.nodeId)
      || typeof rawSelector.mode !== 'string'
      || (policySource !== 'default' && policySource !== 'registry' && policySource !== 'inline' && policySource !== 'builtin')
      || !isNullableText(rawSelector.policyId)
      || (policyKind !== null && policyKind !== 'cel' && policyKind !== 'builtin')
      || !isNullableText(rawSelector.selectionMode)
      || !isNullableText(rawSelector.selectedChoiceId)
      || !Array.isArray(rawSelector.candidates)
    ) return undefined;
    const candidates = rawSelector.candidates.map(parseDecisionCandidate);
    if (candidates.some((candidate) => candidate === null)) return undefined;
    selectors.push({
      selectorId: rawSelector.selectorId,
      nodeId: rawSelector.nodeId,
      mode: rawSelector.mode,
      policySource,
      policyId: rawSelector.policyId,
      policyKind,
      selectionMode: rawSelector.selectionMode,
      selectedChoiceId: rawSelector.selectedChoiceId,
      candidates: candidates as RouteRuntimeDecisionSnapshot['selectors'][number]['candidates'],
    });
  }
  const fallbackStages: RouteRuntimeDecisionSnapshot['fallbackStages'] = [];
  for (const rawStage of value.fallbackStages) {
    if (
      !isRecord(rawStage)
      || typeof rawStage.fallbackId !== 'string'
      || typeof rawStage.stageId !== 'string'
      || !Number.isSafeInteger(rawStage.stageIndex)
      || typeof rawStage.nodeId !== 'string'
    ) return undefined;
    fallbackStages.push({
      fallbackId: rawStage.fallbackId,
      stageId: rawStage.stageId,
      stageIndex: rawStage.stageIndex as number,
      nodeId: rawStage.nodeId,
    });
  }
  let unavailable: RouteRuntimeDecisionSnapshot['unavailable'];
  if (value.unavailable !== undefined) {
    if (
      !isRecord(value.unavailable)
      || !['execution_attempts_exhausted', 'no_active_runtime', 'no_matching_route'].includes(String(value.unavailable.reason))
      || !Array.isArray(value.unavailable.rejectedAttempts)
    ) return undefined;
    const allowedReasons = new Set([
      'execution_target_disabled',
      'account_inactive',
      'site_disabled',
      'cooldown',
      'downstream_policy_excluded',
      'missing_token',
      'identity_missing',
      'route_scope_excluded',
    ]);
    const rejectedAttempts = [] as NonNullable<RouteRuntimeDecisionSnapshot['unavailable']>['rejectedAttempts'];
    for (const rejected of value.unavailable.rejectedAttempts) {
      if (
        !isRecord(rejected)
        || !isNullableText(rejected.executionAttemptId)
        || !isNullablePositiveInteger(rejected.executionTargetId)
        || typeof rejected.reason !== 'string'
        || !allowedReasons.has(rejected.reason)
      ) return undefined;
      rejectedAttempts.push({
        executionAttemptId: rejected.executionAttemptId,
        executionTargetId: rejected.executionTargetId,
        reason: rejected.reason as typeof rejectedAttempts[number]['reason'],
      });
    }
    unavailable = {
      reason: value.unavailable.reason as NonNullable<RouteRuntimeDecisionSnapshot['unavailable']>['reason'],
      rejectedAttempts,
    };
  }
  return {
    selectedAlternativeId: value.selectedAlternativeId,
    selectors,
    fallbackStages,
    ...(unavailable ? { unavailable } : {}),
  };
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
  const decision = parseDecision(record.decision);
  const endpoint = parseEndpoint(record.endpoint);
  const executionAttempt = parseExecutionAttempt(record.executionAttempt);
  const state = parseState(record.state);
  const filters = parseFilters(record.filters);
  const requestUsage = parseRequestUsage(record.requestUsage);
  const syntheticResponse = parseSyntheticResponse(record.syntheticResponse);
  if (
    !metadata
    || decision === undefined
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
    decision,
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
