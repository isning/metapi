import { db, schema } from '../db/index.js';
import { invalidateCompiledRuntimeUsageForecast } from './compiledRuntimeUsageForecastService.js';

export type ProxyLogInsertInput = {
  requestId?: string | null;
  executionAttemptId?: string | null;
  accountId?: number | null;
  downstreamApiKeyId?: number | null;
  modelRequested?: string | null;
  modelActual?: string | null;
  routeEntrypointId?: string | null;
  runtimeEndpointId?: string | null;
  runtimeArtifactId?: string | null;
  executionTargetId?: number | null;
  status?: string | null;
  httpStatus?: number | null;
  isStream?: boolean | null;
  firstByteLatencyMs?: number | null;
  firstTokenLatencyMs?: number | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  billingDetails?: unknown;
  clientFamily?: string | null;
  clientAppId?: string | null;
  clientAppName?: string | null;
  clientConfidence?: string | null;
  errorMessage?: string | null;
  retryCount?: number | null;
  createdAt?: string | null;
};

function buildProxyLogCoreSelectFields() {
  return {
    id: schema.proxyLogs.id,
    executionAttemptId: schema.proxyLogs.executionAttemptId,
    accountId: schema.proxyLogs.accountId,
    downstreamApiKeyId: schema.proxyLogs.downstreamApiKeyId,
    modelRequested: schema.proxyLogs.modelRequested,
    modelActual: schema.proxyLogs.modelActual,
    routeEntrypointId: schema.proxyLogs.routeEntrypointId,
    runtimeEndpointId: schema.proxyLogs.runtimeEndpointId,
    runtimeArtifactId: schema.proxyLogs.runtimeArtifactId,
    executionTargetId: schema.proxyLogs.executionTargetId,
    status: schema.proxyLogs.status,
    httpStatus: schema.proxyLogs.httpStatus,
    latencyMs: schema.proxyLogs.latencyMs,
    promptTokens: schema.proxyLogs.promptTokens,
    completionTokens: schema.proxyLogs.completionTokens,
    totalTokens: schema.proxyLogs.totalTokens,
    estimatedCost: schema.proxyLogs.estimatedCost,
    errorMessage: schema.proxyLogs.errorMessage,
    retryCount: schema.proxyLogs.retryCount,
    createdAt: schema.proxyLogs.createdAt,
  };
}

function buildProxyLogClientSelectFields() {
  return {
    clientFamily: schema.proxyLogs.clientFamily,
    clientAppId: schema.proxyLogs.clientAppId,
    clientAppName: schema.proxyLogs.clientAppName,
    clientConfidence: schema.proxyLogs.clientConfidence,
  };
}

function buildProxyLogStreamTimingSelectFields() {
  return {
    isStream: schema.proxyLogs.isStream,
    firstByteLatencyMs: schema.proxyLogs.firstByteLatencyMs,
    firstTokenLatencyMs: schema.proxyLogs.firstTokenLatencyMs,
  };
}

function buildProxyLogSelectFields(options?: {
  includeBillingDetails?: boolean;
  includeClientFields?: boolean;
  includeStreamTimingFields?: boolean;
}) {
  return {
    ...buildProxyLogCoreSelectFields(),
    ...(options?.includeStreamTimingFields ? buildProxyLogStreamTimingSelectFields() : {}),
    ...(options?.includeClientFields ? buildProxyLogClientSelectFields() : {}),
    ...(options?.includeBillingDetails ? { billingDetails: schema.proxyLogs.billingDetails } : {}),
  };
}

export function getProxyLogBaseSelectFields() {
  return buildProxyLogCoreSelectFields();
}

export type ProxyLogSelectFields = ReturnType<typeof buildProxyLogSelectFields>;

export type ResolvedProxyLogSelectFields = {
  includeBillingDetails: boolean;
  includeClientFields: boolean;
  includeStreamTimingFields: boolean;
  fields: ProxyLogSelectFields;
};

export async function resolveProxyLogSelectFields(options?: {
  includeBillingDetails?: boolean;
  includeClientFields?: boolean;
  includeStreamTimingFields?: boolean;
}) {
  const includeBillingDetails = options?.includeBillingDetails === true;
  const includeClientFields = options?.includeClientFields !== false;
  const includeStreamTimingFields = options?.includeStreamTimingFields !== false;

  return {
    includeBillingDetails,
    includeClientFields,
    includeStreamTimingFields,
    fields: buildProxyLogSelectFields({
      includeBillingDetails,
      includeClientFields,
      includeStreamTimingFields,
    }),
  };
}

export async function withProxyLogSelectFields<T>(
  runner: (selection: ResolvedProxyLogSelectFields) => Promise<T>,
  options?: {
    includeBillingDetails?: boolean;
    includeClientFields?: boolean;
    includeStreamTimingFields?: boolean;
  },
): Promise<T> {
  return await runner(await resolveProxyLogSelectFields(options));
}

export function parseProxyLogBillingDetails(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function insertProxyLog(input: ProxyLogInsertInput): Promise<void> {
  const baseValues = {
    requestId: input.requestId ?? null,
    executionAttemptId: input.executionAttemptId ?? null,
    accountId: input.accountId ?? null,
    modelRequested: input.modelRequested ?? null,
    modelActual: input.modelActual ?? null,
    routeEntrypointId: input.routeEntrypointId ?? null,
    runtimeEndpointId: input.runtimeEndpointId ?? null,
    runtimeArtifactId: input.runtimeArtifactId ?? null,
    executionTargetId: input.executionTargetId ?? null,
    status: input.status ?? null,
    httpStatus: input.httpStatus ?? null,
    latencyMs: input.latencyMs ?? null,
    promptTokens: input.promptTokens ?? null,
    completionTokens: input.completionTokens ?? null,
    totalTokens: input.totalTokens ?? null,
    estimatedCost: input.estimatedCost ?? null,
    errorMessage: input.errorMessage ?? null,
    retryCount: input.retryCount ?? 0,
    createdAt: input.createdAt ?? null,
  };
  const serializedBillingDetails = input.billingDetails == null
    ? null
    : JSON.stringify(input.billingDetails);
  await db.insert(schema.proxyLogs).values({
    ...baseValues,
    downstreamApiKeyId: input.downstreamApiKeyId ?? null,
    isStream: input.isStream ?? null,
    firstByteLatencyMs: input.firstByteLatencyMs ?? null,
    firstTokenLatencyMs: input.firstTokenLatencyMs ?? null,
    billingDetails: serializedBillingDetails,
    clientFamily: input.clientFamily ?? null,
    clientAppId: input.clientAppId ?? null,
    clientAppName: input.clientAppName ?? null,
    clientConfidence: input.clientConfidence ?? null,
  }).run();
  if (input.status === 'success') {
    invalidateCompiledRuntimeUsageForecast(input.routeEntrypointId);
  }
}
