import type { CompiledRouteFlow } from './routeFlowService.js';
import type { EntryPricingUsage } from './routeEntryPricingService.js';
import type { CompiledRouteRuntimeRequest } from './compiledRuntimeRequestTypes.js';

export type CompiledRuntimeObservabilityRange = '5m' | '15m' | '1h' | '6h' | '24h' | '7d' | '30d';

export type RuntimeObservabilityDiagnostic = {
  level: 'info' | 'warn' | 'error';
  code:
    | 'runtime_unmatched'
    | 'projection_pending'
    | 'entry_usage_missing'
    | 'history_empty';
  messageKey: string;
  params?: Record<string, string | number | boolean | null>;
  technicalDetail?: string;
};

export type RuntimeObservationWindow = {
  range: CompiledRuntimeObservabilityRange;
  windowDays: number;
  fromLocalDay: string;
  toLocalDay: string;
  realtime?: {
    minutes: number;
    fromUtc: string;
  };
};

export type RuntimeHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

export type RuntimeHealthSource =
  | 'entry_projection'
  | 'endpoint_projection'
  | 'execution_attempt_projection'
  | 'none';

export type RuntimeHealth = {
  status: RuntimeHealthStatus;
  successRate: number | null;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  avgLatencyMs: number | null;
  latencySamples: number;
  avgFirstTokenLatencyMs: number | null;
  firstTokenLatencySamples: number;
  avgOutputTokensPerSecond: number | null;
  outputTokens: number;
  outputTokenDurationMs: number;
  outputTokenSamples: number;
  source: RuntimeHealthSource;
  window: RuntimeObservationWindow;
};

export type RuntimeEntrySummary = {
  entryId: string;
  displayName: string;
  requestedModel: string;
  actualModel: string | null;
  matchedBy: 'exact' | 'normalized_exact' | 'pattern' | 'unknown';
};

export type RuntimeIdentitySummary = {
  runtimeId: string | null;
  artifactHash: string | null;
  projectedAt: string | null;
  source: 'active_runtime' | 'unknown';
};

export type RuntimeCapabilitySummary = {
  supportedEndpointTypes: string[];
  inputModalities: string[];
  outputModalities: string[];
  capabilities: string[];
  contextLength: number | null;
  maxOutputTokens: number | null;
  source: 'runtime_attempt_catalog_merge' | 'single_provider_catalog' | 'none';
  partial: boolean;
};

export type RuntimeAlternativeObservability = {
  alternativeId: string;
  label: string | null;
  selected: boolean;
  enabled: boolean;
  probability: {
    value: number | null;
    status: 'static' | 'dynamic' | 'unsupported';
  };
  health: RuntimeHealth;
  pricing: null;
  endpointIds: string[];
  executionAttemptIds: string[];
};

export type RuntimeEndpointObservability = {
  endpointId: string;
  label: string;
  actualModel: null;
  models: string[];
  endpointType: string | null;
  site: { id: number; name: string | null } | null;
  account: { id: number; label: string | null } | null;
  health: RuntimeHealth;
  pricing: null;
  capabilitySummary: RuntimeCapabilitySummary;
};

export type RuntimeExecutionAttemptObservability = {
  executionAttemptId: string;
  alternativeId: string | null;
  endpointId: string | null;
  selected: boolean;
  enabled: boolean;
  actualModel: string | null;
  target: {
    executionTargetId: number | null;
    siteId: number | null;
    siteName: string | null;
    accountId: number | null;
    accountLabel: string | null;
    tokenId: number | null;
    tokenLabel: string | null;
  } | null;
  health: RuntimeHealth;
  pricing: null;
  routingSignals: unknown | null;
  apiFallbackAttemptIds: string[];
};

export type RuntimeApiFallbackAttemptObservability = {
  apiAttemptId: string;
  executionAttemptId: string;
  order: number;
  endpointType: string;
  selected: boolean;
  supported: boolean;
  health: RuntimeHealth;
  pricing: null;
  diagnostics: RuntimeObservabilityDiagnostic[];
};

export type RuntimeHistoryBucket = {
  bucketStart: string;
  bucketEnd: string;
  entry: RuntimeHealth;
  endpoints: Array<{ endpointId: string; health: RuntimeHealth }>;
  executionAttempts: Array<{ executionAttemptId: string; health: RuntimeHealth }>;
};

export type RuntimeHistory = {
  range: CompiledRuntimeObservabilityRange;
  buckets: RuntimeHistoryBucket[];
  granularity: 'minute' | 'hour' | 'day';
  emptyReason: 'no_logs' | 'projection_pending' | 'unmatched' | null;
};

export type CompiledRuntimeObservabilitySummary = {
  requestedModel: string;
  matched: boolean;
  runtime: RuntimeIdentitySummary | null;
  entry: RuntimeEntrySummary | null;
  health: RuntimeHealth;
  capabilitySummary: RuntimeCapabilitySummary;
  pricingSummary: CompiledRouteFlow['entryPricing'] | null;
  freshness: {
    projected: boolean;
    projectionProcessedLogs: number;
  };
  diagnostics: RuntimeObservabilityDiagnostic[];
};

export type CompiledRuntimeObservability = CompiledRuntimeObservabilitySummary & {
  request: {
    requestedModel: string;
    hasRequestSnapshot: boolean;
  };
  match: CompiledRouteFlow['compiledRuntime'] extends infer T
    ? T extends { match: infer M } ? M | null : null
    : null;
  alternatives: RuntimeAlternativeObservability[];
  endpoints: RuntimeEndpointObservability[];
  executionAttempts: RuntimeExecutionAttemptObservability[];
  apiFallbackAttempts: RuntimeApiFallbackAttemptObservability[];
  history: RuntimeHistory;
  pricing: CompiledRouteFlow['entryPricing'] | null;
  routeFlow: CompiledRouteFlow;
};

export type CompiledRuntimeObservabilityInput = {
  requestedModel: string;
  range?: CompiledRuntimeObservabilityRange;
  healthWindowMinutes?: number | null;
  request?: CompiledRouteRuntimeRequest | null;
  pricingUsage?: EntryPricingUsage | null;
  freshness?: 'cached' | 'sync_projection';
};
