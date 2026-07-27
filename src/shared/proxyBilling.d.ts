export type ProxyBillingQuote = {
  amount: number;
  unit: 'currency' | 'quota';
  currency: string | null;
  source: 'billing_override' | 'provider_catalog' | 'upstream_cost_pricing' | 'self_log_quota';
  sourceId: string | number | null;
  matchedScope: string | null;
  estimateLevel: 'exact' | 'request_estimate' | 'period_estimate' | 'incomplete' | null;
  planFingerprint: string | null;
};

export type ProxyBillingBreakdown = {
  diagnostics?: unknown[];
  quotaType: number;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    billablePromptTokens: number;
    promptTokensIncludeCache: boolean | null;
  };
  pricing: {
    modelRatio: number;
    completionRatio: number;
    cacheRatio: number;
    cacheCreationRatio: number;
    groupRatio: number;
  };
  breakdown: {
    inputPerMillion: number | null;
    outputPerMillion: number | null;
    cacheReadPerMillion: number | null;
    cacheCreationPerMillion: number | null;
    inputCost: number;
    outputCost: number;
    cacheReadCost: number;
    cacheCreationCost: number;
    totalCost: number;
  };
};

export type ProxyBillingDetails = ProxyBillingBreakdown & {
  quote: ProxyBillingQuote;
};
