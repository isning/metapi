export type ModelsMarketplaceToken = {
  id: number;
  name: string;
  isDefault: boolean;
};

export type ModelsMarketplaceAccount = {
  id: number;
  site: string;
  username: string | null;
  latency: number | null;
  balance: number | null;
  tokens: ModelsMarketplaceToken[];
  managedTokenCount: number;
  credentialCount: number;
  endpointCount: number;
  executionAttemptCount: number;
};

export type ModelsMarketplaceGroupPricing = {
  currency?: string | null;
  quotaType: number;
  inputPerMillion?: number;
  outputPerMillion?: number;
  perCallInput?: number;
  perCallOutput?: number;
  perCallTotal?: number;
};

export type ModelsMarketplacePricingSource = {
  siteId: number;
  siteName: string;
  accountId: number;
  username: string | null;
  ownerBy: string | null;
  enableGroups: string[];
  groupPricing: Record<string, ModelsMarketplaceGroupPricing>;
};

export type ModelsMarketplaceRuntimeIssue = {
  level: "warn" | "error";
  code: "compiled_runtime_invalid_execution_attempt";
  reason: string;
  alternativeId: string;
  executionAttemptId: string | null;
  executionTargetId: number | null;
  endpointId: string | null;
  modelName: string | null;
};

export type ModelsMarketplaceMeasuredPricing = {
  currency: string | null;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  totalCost: number | null;
  inputMultiplier: number | null;
  outputMultiplier: number | null;
  totalMultiplier: number | null;
  sampleCount: number;
  lastMeasuredAt: string | null;
};

export type ModelsMarketplaceModel = {
  name: string;
  accountCount: number;
  tokenCount: number;
  managedTokenCount: number;
  credentialCount: number;
  endpointCount: number;
  executionAttemptCount: number;
  avgLatency: number | null;
  successRate: number | null;
  description: string | null;
  tags: string[];
  supportedEndpointTypes: string[];
  runtimeInventoryIssues: ModelsMarketplaceRuntimeIssue[];
  pricingSources: ModelsMarketplacePricingSource[];
  measuredEntryPricing: ModelsMarketplaceMeasuredPricing | null;
  accounts: ModelsMarketplaceAccount[];
  siteCounts: Record<string, {
    endpointCount: number;
    executionAttemptCount: number;
    credentialCount: number;
  }>;
};

export type ModelsMarketplaceMeta = {
  refreshRequested: boolean;
  refreshQueued: boolean;
  refreshReused: boolean;
  refreshRunning: boolean;
  refreshJobId: string | null;
  includePricing: boolean;
  cacheHit?: boolean;
};

export type ModelsMarketplaceResponse = {
  models: ModelsMarketplaceModel[];
  pageInfo: {
    page: number;
    pageSize: number;
    totalCount: number;
    hasMore: boolean;
  };
  facets: {
    brands: Array<{ name: string; icon?: string | null; color?: string | null; count: number }>;
    otherBrandCount: number;
    sites: Array<{ name: string; count: number }>;
  };
  meta: ModelsMarketplaceMeta;
};
