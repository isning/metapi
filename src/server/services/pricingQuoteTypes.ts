import type { CanonicalUsage, PricingEvaluation } from '../pricing-core/index.js';

export type PricingUsageProfile = 'preview_1m_io' | 'routing_reference' | 'actual';

export type PricingResolutionSource =
  | 'manual_binding'
  | 'provider_catalog'
  | 'official_reference'
  | 'built_in_reference'
  | 'system_default'
  | 'fallback';

export type PricingResolutionSummary = {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cacheReadPerMillion: number | null;
  cacheWritePerMillion: number | null;
  reasoningPerMillion: number | null;
  requestUsd: number | null;
  totalCostUsd: number | null;
};

export type PricingResolution = {
  source: PricingResolutionSource;
  sourceId: string | number | null;
  matchedScope: string | null;
  sourceType: string | null;
  planFingerprint: string | null;
  estimateLevel: PricingEvaluation['estimateLevel'] | null;
  evaluation: PricingEvaluation | null;
  summary: PricingResolutionSummary;
  diagnostics: PricingEvaluation['diagnostics'];
};

export type EndpointPricingSupply = {
  siteId: number;
  accountId: number;
  tokenId?: number | null;
  tokenGroup?: string | null;
  provider?: string | null;
  modelName: string;
};

export type ReferencePricingSubject = {
  provider?: string | null;
  modelName: string;
};

export type PricingQuoteSubject =
  | ({ kind: 'endpoint_supply' } & EndpointPricingSupply)
  | ({ kind: 'reference_model' } & ReferencePricingSubject);

export type PricingQuoteComparison = {
  inputMultiplier: number | null;
  outputMultiplier: number | null;
  totalMultiplier: number | null;
};

export type PricingQuoteDiagnostic = {
  level: 'info' | 'warn' | 'error';
  message: string;
};

export type EffectiveCostBalanceBurnBucket = {
  unit: string;
  amount: number;
};

export type EffectiveCostQuote = {
  estimateLevel: 'exact' | 'estimated' | 'incomplete';
  walletCostBaseCurrency: number | null;
  baseCostUnit: string;
  freeQuotaDaysCost: number | null;
  balanceBurn: EffectiveCostBalanceBurnBucket[];
  walletUnit: string | null;
  faceValuePrice: number | null;
  rechargeDiscount: number | null;
  dailyEarnedBalance: number | null;
  unitConversionRate: {
    fromCurrency: string;
    toCurrency: string;
    rate: number;
    source: 'manual' | 'provider' | 'system_default' | 'identity';
    snapshotId: number | null;
    capturedAt: string | null;
  } | null;
  acquisitionProfile: {
    id: number;
    scope: 'site' | 'account' | 'token';
    confidence: 'exact' | 'estimated' | 'incomplete';
  } | null;
  diagnostics: PricingQuoteDiagnostic[];
};

export type PricingQuote = {
  subject: PricingQuoteSubject;
  usageProfile: PricingUsageProfile;
  usage: Partial<CanonicalUsage>;
  endpoint: PricingResolution | null;
  reference: PricingResolution | null;
  effectiveCost: EffectiveCostQuote | null;
  comparison: PricingQuoteComparison;
  diagnostics: PricingQuoteDiagnostic[];
};
