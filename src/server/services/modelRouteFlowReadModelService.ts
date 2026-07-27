import type { EntryPricingUsage } from './routeEntryPricingService.js';
import {
  getCompiledRuntimeRouteFlow,
  type CompiledRouteFlow,
} from './routeFlowService.js';

const PRICING_USAGE_FIELDS = [
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'totalTokens',
  'requestCount',
  'imageInputUnits',
  'imageOutputUnits',
  'audioInputSeconds',
  'audioOutputSeconds',
  'videoInputSeconds',
  'storageMegabyteMonths',
] as const;

export function normalizeModelRouteFlowPricingUsage(
  input: Record<string, unknown> | null | undefined,
): EntryPricingUsage | null {
  if (!input) return null;
  const usage: EntryPricingUsage = {};
  for (const key of PRICING_USAGE_FIELDS) {
    const value = input[key];
    if (value === undefined || value === null || value === '') continue;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) usage[key] = parsed;
  }
  if (input.custom && typeof input.custom === 'object' && !Array.isArray(input.custom)) {
    const custom: Record<string, number> = {};
    for (const [key, value] of Object.entries(input.custom)) {
      const parsed = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) custom[key] = parsed;
    }
    if (Object.keys(custom).length > 0) usage.custom = custom;
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

export function projectModelRouteFlowDiagnostics(flow: CompiledRouteFlow) {
  const runtime = flow.compiledRuntime;
  return {
    requestedModel: flow.requestedModel,
    actualModel: runtime?.selected.actualModel ?? null,
    matched: flow.matched,
    entryId: runtime?.match.entryNodeId ?? null,
    selectedEndpointId: runtime?.selected.endpointId ?? null,
    selectedAccountId: runtime?.selected.accountId ?? null,
    diagnostics: flow.diagnostics,
    projectedAt: flow.projectedAt,
  };
}

type ModelRouteFlowReadModelInput = {
  model: string;
  forcedExecutionAttemptId?: string | null;
  request?: Record<string, unknown> | null;
  pricingUsage?: Record<string, unknown> | null;
  view?: 'full' | 'diagnostics';
};

export function getModelRouteFlowReadModel(
  input: ModelRouteFlowReadModelInput & { view: 'diagnostics' },
): Promise<{ kind: 'diagnostics'; diagnostics: ReturnType<typeof projectModelRouteFlowDiagnostics> }>;
export function getModelRouteFlowReadModel(
  input: ModelRouteFlowReadModelInput & { view?: 'full' },
): Promise<{ kind: 'flow'; flow: CompiledRouteFlow }>;
export async function getModelRouteFlowReadModel(input: ModelRouteFlowReadModelInput) {
  const diagnosticsOnly = input.view === 'diagnostics';
  const flow = await getCompiledRuntimeRouteFlow(input.model, {
    forcedExecutionAttemptId: input.forcedExecutionAttemptId || null,
    ...(input.request !== undefined ? { request: input.request } : {}),
    ...(input.pricingUsage !== undefined
      ? { pricingUsage: normalizeModelRouteFlowPricingUsage(input.pricingUsage) }
      : {}),
    includeEntryPricing: !diagnosticsOnly,
    includeCompatibilityPolicy: !diagnosticsOnly,
  });
  return diagnosticsOnly
    ? { kind: 'diagnostics' as const, diagnostics: projectModelRouteFlowDiagnostics(flow) }
    : { kind: 'flow' as const, flow };
}
