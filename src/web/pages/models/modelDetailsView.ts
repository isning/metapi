import type { ModelRouteFlowData } from '../../components/ModelRouteFlow.js';
import { tr } from '../../i18n.js';

export type ModelTokenInfo = {
  id: number;
  name: string;
  isDefault: boolean;
};

export type ModelGroupPricing = {
  quotaType: number;
  inputPerMillion?: number;
  outputPerMillion?: number;
  perCallInput?: number;
  perCallOutput?: number;
  perCallTotal?: number;
};

export type ModelPricingSource = {
  siteId: number;
  siteName: string;
  accountId: number;
  username: string | null;
  ownerBy: string | null;
  enableGroups: string[];
  groupPricing: Record<string, ModelGroupPricing>;
};

type RouteFlowTheoreticalPricing = NonNullable<NonNullable<ModelRouteFlowData['entryPricing']>['theoretical']>;
type ModelEntryPricingCandidate = RouteFlowTheoreticalPricing['candidates'][number];

export type ModelEntryPricing = {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  totalCostUsd?: number | null;
  inputMultiplier: number | null;
  outputMultiplier: number | null;
  totalMultiplier?: number | null;
  effectiveCost?: {
    walletCostBaseCurrency: number | null;
    baseCostUnit: string | null;
    freeQuotaDaysCost: number | null;
    balanceBurn: Array<{ unit: string; amount: number }>;
    estimateLevel: 'exact' | 'static_estimate' | 'incomplete';
    diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
  } | null;
  sourceCount: number;
  estimateLevel?: 'exact' | 'static_estimate' | 'incomplete';
  strategy?: string | null;
  sampleCount?: number;
  lastMeasuredAt?: string | null;
  diagnostics?: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
  candidates?: ModelEntryPricingCandidate[];
};

export type ModelAccountInfo = {
  id: number;
  site: string;
  username: string | null;
  latency: number | null;
  balance: number;
  tokens: ModelTokenInfo[];
  managedTokenCount?: number;
  credentialCount?: number;
};

export type ModelRow = {
  name: string;
  accountCount: number;
  tokenCount: number;
  managedTokenCount?: number;
  credentialCount?: number;
  endpointCount?: number;
  avgLatency: number | null;
  successRate: number | null;
  description: string | null;
  tags: string[];
  supportedEndpointTypes: string[];
  pricingSources: ModelPricingSource[];
  measuredEntryPricing?: {
    inputPerMillion: number | null;
    outputPerMillion: number | null;
    totalCostUsd?: number | null;
    inputMultiplier?: number | null;
    outputMultiplier?: number | null;
    totalMultiplier?: number | null;
    sampleCount: number;
    lastMeasuredAt: string | null;
  } | null;
  accounts: ModelAccountInfo[];
};

export type ModelDetailsTab = 'overview' | 'routing' | 'performance' | 'api' | 'diagnostics';
export type ModelMetricsRange = '1h' | '24h' | '7d';

export type ModelDetailsView = {
  model: ModelRow;
  brandName: string | null;
  status: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  routeFlow: ModelRouteFlowData | null;
  routeFlowLoading: boolean;
  routeFlowError: string;
  diagnostics: ModelRouteFlowData['diagnostics'];
  freshnessLabel: string;
  descriptionText: string;
  pricing: {
    measured: ModelEntryPricing | null;
    theoretical: ModelEntryPricing | null;
  };
};

function normalizeFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function buildMeasuredEntryPricing(model: ModelRow): ModelEntryPricing | null {
  const measured = model.measuredEntryPricing;
  if (!measured) return null;
  const inputPerMillion = normalizeFiniteNumber(measured.inputPerMillion);
  const outputPerMillion = normalizeFiniteNumber(measured.outputPerMillion);
  if (inputPerMillion == null && outputPerMillion == null) return null;
  const totalCostUsd = normalizeFiniteNumber(measured.totalCostUsd);
  return {
    inputPerMillion,
    outputPerMillion,
    totalCostUsd,
    inputMultiplier: normalizeFiniteNumber(measured.inputMultiplier),
    outputMultiplier: normalizeFiniteNumber(measured.outputMultiplier),
    totalMultiplier: normalizeFiniteNumber(measured.totalMultiplier),
    sourceCount: 1,
    sampleCount: measured.sampleCount,
    lastMeasuredAt: measured.lastMeasuredAt,
  };
}

export function buildTheoreticalEntryPricing(model: ModelRow): ModelEntryPricing | null {
  const inputPrices: number[] = [];
  const outputPrices: number[] = [];
  let sourceCount = 0;

  for (const source of model.pricingSources) {
    for (const pricing of Object.values(source.groupPricing)) {
      const input = normalizeFiniteNumber(pricing.inputPerMillion);
      const output = normalizeFiniteNumber(pricing.outputPerMillion);
      if (input == null && output == null) continue;
      sourceCount += 1;
      if (input != null) inputPrices.push(input);
      if (output != null) outputPrices.push(output);
    }
  }

  if (inputPrices.length === 0 && outputPrices.length === 0) return null;
  const inputPerMillion = inputPrices.length > 0 ? Math.min(...inputPrices) : null;
  const outputPerMillion = outputPrices.length > 0 ? Math.min(...outputPrices) : null;
  return {
    inputPerMillion,
    outputPerMillion,
    inputMultiplier: null,
    outputMultiplier: null,
    sourceCount,
  };
}

export function buildRouteFlowTheoreticalEntryPricing(routeFlow: ModelRouteFlowData | null): ModelEntryPricing | null {
  const pricing = routeFlow?.entryPricing?.theoretical;
  if (!pricing) return null;
  const inputPerMillion = normalizeFiniteNumber(pricing.inputPerMillion);
  const outputPerMillion = normalizeFiniteNumber(pricing.outputPerMillion);
  const totalCostUsd = normalizeFiniteNumber(pricing.totalCostUsd);
  if (inputPerMillion == null && outputPerMillion == null && totalCostUsd == null) return null;
  return {
    inputPerMillion,
    outputPerMillion,
    totalCostUsd,
    inputMultiplier: normalizeFiniteNumber(pricing.inputMultiplier),
    outputMultiplier: normalizeFiniteNumber(pricing.outputMultiplier),
    totalMultiplier: normalizeFiniteNumber(pricing.totalMultiplier),
    effectiveCost: pricing.effectiveCost ?? null,
    sourceCount: pricing.sourceCount,
    estimateLevel: pricing.estimateLevel,
    strategy: pricing.strategy,
    diagnostics: pricing.diagnostics,
    candidates: pricing.candidates,
  };
}

export function resolveModelStatus(model: ModelRow): ModelDetailsView['status'] {
  if (model.successRate == null && model.avgLatency == null) return 'unknown';
  if (model.successRate != null && model.successRate < 60) return 'unavailable';
  if (model.successRate != null && model.successRate < 90) return 'degraded';
  if (model.avgLatency != null && model.avgLatency >= 3000) return 'degraded';
  return 'healthy';
}

export function buildModelDetailsView(input: {
  model: ModelRow;
  brandName: string | null;
  routeFlow: ModelRouteFlowData | null;
  routeFlowLoading: boolean;
  routeFlowError: string;
  metadataHydrating: boolean;
}): ModelDetailsView {
  const hasOtherMetadata = input.model.tags.length > 0
    || input.model.supportedEndpointTypes.length > 0
    || input.model.pricingSources.length > 0;

  return {
    model: input.model,
    brandName: input.brandName,
    status: resolveModelStatus(input.model),
    routeFlow: input.routeFlow,
    routeFlowLoading: input.routeFlowLoading,
    routeFlowError: input.routeFlowError,
    diagnostics: input.routeFlow?.diagnostics ?? [],
    freshnessLabel: input.metadataHydrating
      ? tr('pages.models.modelDetailsView.updating')
      : tr('pages.models.modelDetailsView.partialView'),
    descriptionText: input.model.description?.trim()
      || (input.metadataHydrating
        ? tr('pages.models.modelDetailsView.loadingModelMetadata')
        : hasOtherMetadata
          ? tr('pages.models.modelDetailsView.notProvidedTextSynctagsCapabilitiesInfo')
          : tr('pages.models.modelDetailsView.modelId')),
    pricing: {
      measured: buildMeasuredEntryPricing(input.model),
      theoretical: buildRouteFlowTheoreticalEntryPricing(input.routeFlow) || buildTheoreticalEntryPricing(input.model),
    },
  };
}

export function getModelManagedTokenCount(model: ModelRow): number {
  const explicit = normalizeFiniteNumber(model.managedTokenCount);
  if (explicit != null) return explicit;
  return normalizeFiniteNumber(model.tokenCount) ?? 0;
}

export function getAccountCredentialCount(account: ModelAccountInfo): number {
  const explicit = normalizeFiniteNumber(account.credentialCount);
  if (explicit != null) return explicit;
  return account.tokens.length;
}

export function getModelCredentialCount(model: ModelRow): number {
  const explicit = normalizeFiniteNumber(model.credentialCount);
  if (explicit != null) return explicit;
  return model.accounts.reduce((sum, account) => sum + getAccountCredentialCount(account), 0);
}

export function formatLatencyValue(latency: number | null): string {
  return typeof latency === 'number' && Number.isFinite(latency) ? `${latency}ms` : tr('common.notAvailable');
}

export function formatSuccessRate(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}%` : tr('common.notAvailable');
}
