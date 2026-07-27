import type { CompiledRouteRuntimeRequest, CompiledRuntimeJsonValue } from '../../services/compiledRuntimeRequestTypes.js';
import type { DownstreamClientContext } from '../downstreamClientContext.js';

type RuntimeRequestSnapshotInput = {
  requestedModel?: string | null;
  payload?: unknown;
  normalizedPayload?: unknown;
  headers?: Record<string, unknown> | null;
  method?: string | null;
  path?: string | null;
  query?: unknown;
  clientContext?: DownstreamClientContext | null;
  downstreamApiKeyId?: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asJsonValue(value: unknown): CompiledRuntimeJsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items = value.map(asJsonValue);
    return items.every((item) => item !== undefined) ? items as CompiledRuntimeJsonValue[] : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const result: Record<string, CompiledRuntimeJsonValue> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalized = asJsonValue(item);
    if (normalized === undefined) return undefined;
    result[key] = normalized;
  }
  return result;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function buildCompiledRouteRuntimeRequestSnapshot(
  input: RuntimeRequestSnapshotInput,
): CompiledRouteRuntimeRequest {
  const payload = asJsonValue(input.payload);
  const normalizedPayload = asJsonValue(input.normalizedPayload);
  const query = asRecord(input.query);
  const clientContext = input.clientContext
    ? {
        clientKind: input.clientContext.clientKind,
        sessionId: input.clientContext.sessionId || null,
        traceHint: input.clientContext.traceHint || null,
        downstreamApiKeyId: input.downstreamApiKeyId ?? null,
      }
    : (input.downstreamApiKeyId != null ? { downstreamApiKeyId: input.downstreamApiKeyId } : null);

  return {
    ...(asText(input.requestedModel) ? { requestedModel: asText(input.requestedModel) } : {}),
    ...(payload === undefined ? {} : { payload }),
    ...(normalizedPayload === undefined ? {} : { normalizedPayload }),
    headers: asRecord(input.headers) || {},
    ...(asText(input.method) ? { method: asText(input.method) } : {}),
    ...(asText(input.path) ? { path: asText(input.path) } : {}),
    ...(query ? { query } : {}),
    ...(clientContext ? { clientContext } : {}),
  };
}
