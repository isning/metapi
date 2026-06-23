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

export type PricingQuote = {
  subject: PricingQuoteSubject;
  usageProfile: PricingUsageProfile;
  usage: Partial<CanonicalUsage>;
  endpoint: PricingResolution | null;
  reference: PricingResolution | null;
  comparison: PricingQuoteComparison;
  diagnostics: PricingQuoteDiagnostic[];
};
