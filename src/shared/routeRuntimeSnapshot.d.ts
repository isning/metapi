export type RouteRuntimeNullableNumber = number | null;

export type RouteRuntimeCredentialSnapshot = {
  site: {
    id: RouteRuntimeNullableNumber;
    name: string | null;
    url: string | null;
    platform: string | null;
  } | null;
  account: {
    id: RouteRuntimeNullableNumber;
    username: string | null;
    status: string | null;
  } | null;
  token: {
    id: RouteRuntimeNullableNumber;
    name: string | null;
    tokenGroup: string | null;
    enabled: boolean | null;
    valueStatus: string | null;
    source: string | null;
  } | null;
};

export type RouteRuntimeCompiledSnapshot = {
  runtimeArtifactId: string | null;
  bundleHash: string | null;
  program: CompiledRouterPlan | null;
};

export type RouteRuntimeMatchSnapshot = {
  requestedModel: string | null;
  actualModel: string | null;
  planId: string | null;
  entryId: string | null;
  publicModelName: string | null;
  terminalKind: 'endpoint' | 'synthetic_response' | null;
};

export type RouteRuntimeEndpointSnapshot = {
  endpointId: string | null;
  executionTargetId: RouteRuntimeNullableNumber;
  compatibilityPolicy: Record<string, unknown> | null;
};

export type RouteRuntimeExecutionAttemptSnapshot = {
  executionAttemptId: string | null;
  model: string | null;
  executionTargetId: RouteRuntimeNullableNumber;
  accountId: RouteRuntimeNullableNumber;
  tokenId: RouteRuntimeNullableNumber;
  siteId: RouteRuntimeNullableNumber;
  credential: RouteRuntimeCredentialSnapshot | null;
  affinity: {
    mode: 'disabled' | 'pool' | 'target';
    selectedPoolId: string | null;
    selectedExecutionTargetId: RouteRuntimeNullableNumber;
    primaryPoolId: string | null;
    primaryExecutionTargetId: RouteRuntimeNullableNumber;
    primaryRevision: RouteRuntimeNullableNumber;
    fallback: boolean;
    promoteOnSuccess: boolean;
    bindingOutcome: 'pending' | 'bound' | 'primary_refreshed' | 'temporary_fallback' | 'promoted' | 'stale_ignored' | 'invalid' | 'disabled';
    resultingPrimaryPoolId: string | null;
    resultingPrimaryExecutionTargetId: RouteRuntimeNullableNumber;
    resultingRevision: RouteRuntimeNullableNumber;
  } | null;
};

export type RouteRuntimeDecisionCandidateSnapshot = {
  choiceId: string;
  endpointId: string | null;
  executionTargetIds: number[];
  targets?: Array<{
    executionTargetId: number;
    executionAttemptId: string | null;
    upstreamModel: string | null;
    credential: RouteRuntimeCredentialSnapshot | null;
  }>;
  enabled: boolean;
  eligible: boolean;
  selected: boolean;
  weight: number;
  contribution: number;
  order: number;
  score: number;
};

export type RouteRuntimeDecisionSelectorSnapshot = {
  selectorId: string;
  nodeId: string | null;
  mode: string;
  policySource: 'default' | 'registry' | 'inline' | 'builtin';
  policyId: string | null;
  policyKind: 'cel' | 'builtin' | null;
  selectionMode: string | null;
  selectedChoiceId: string | null;
  candidates: RouteRuntimeDecisionCandidateSnapshot[];
};

export type RouteRuntimeDecisionSnapshot = {
  selectedAlternativeId: string | null;
  selectors: RouteRuntimeDecisionSelectorSnapshot[];
  fallbackStages: Array<{
    fallbackId: string;
    stageId: string;
    stageIndex: number;
    nodeId: string;
  }>;
  unavailable?: {
    reason: 'execution_attempts_exhausted' | 'no_active_runtime' | 'no_matching_route';
    rejectedAttempts: Array<{
      executionAttemptId: string | null;
      executionTargetId: RouteRuntimeNullableNumber;
      reason:
        | 'execution_target_disabled'
        | 'account_inactive'
        | 'site_disabled'
        | 'cooldown'
        | 'downstream_policy_excluded'
        | 'missing_token'
        | 'identity_missing'
        | 'route_scope_excluded';
    }>;
  };
};

export type RouteRuntimeStateSnapshot = {
  failureOverlay: {
    disabledExecutionAttemptIds: string[];
    disabledExecutionTargetIds: number[];
  };
  executionAttemptState: {
    executionTargetId: RouteRuntimeNullableNumber;
    successCount: RouteRuntimeNullableNumber;
    failCount: RouteRuntimeNullableNumber;
    totalLatencyMs: RouteRuntimeNullableNumber;
    latencySampleCount: RouteRuntimeNullableNumber;
    consecutiveFailCount: RouteRuntimeNullableNumber;
    cooldownLevel: RouteRuntimeNullableNumber;
    cooldownUntil: string | null;
    lastUsedAt: string | null;
    lastSelectedAt: string | null;
    lastFailAt: string | null;
  } | null;
};

export type RouteRuntimeFiltersSnapshot = {
  endpointPreference: 'chat' | 'messages' | 'responses' | null;
  postBuild: Record<string, unknown> | null;
};

export type RouteRuntimeRequestUsageSnapshot = {
  inputBytes: RouteRuntimeNullableNumber;
  maxOutputTokens: RouteRuntimeNullableNumber;
};

export type RouteRuntimeMetadataSnapshot = {
  graph: Record<string, unknown> | null;
  plan: Record<string, unknown> | null;
  selection: Record<string, unknown> | null;
  endpoint: Record<string, unknown> | null;
  executionAttempt: Record<string, unknown> | null;
};

export type RouteRuntimeSnapshotPayload = {
  capturedAt: string;
  request: {
    downstreamPath: string | null;
    stream: boolean | null;
  };
  compiledRuntime: RouteRuntimeCompiledSnapshot;
  match: RouteRuntimeMatchSnapshot;
  metadata: RouteRuntimeMetadataSnapshot;
  decision: RouteRuntimeDecisionSnapshot | null;
  endpoint: RouteRuntimeEndpointSnapshot | null;
  executionAttempt: RouteRuntimeExecutionAttemptSnapshot | null;
  requestUsage: RouteRuntimeRequestUsageSnapshot;
  state: RouteRuntimeStateSnapshot;
  filters: RouteRuntimeFiltersSnapshot;
  syntheticResponse: {
    statusCode: 429 | 503;
    message: string;
  } | null;
};

export type RouteRuntimeSnapshotBody = Omit<
  RouteRuntimeSnapshotPayload,
  'capturedAt' | 'request'
>;

export type RouteRuntimeSnapshot = RouteRuntimeSnapshotPayload & {
  source: 'snapshot';
};
import type { CompiledRouterPlan } from './compiledRuntime.js';
