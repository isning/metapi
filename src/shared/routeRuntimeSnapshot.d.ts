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
