import { quoteEndpointPricing } from "./pricingQuoteService.js";

export type AccountModelCostSummary = {
  status: 'configured' | 'unconfigured' | 'error';
  configured: boolean;
  matchedScope: string | null;
  pricingId: number | null;
  totalCost: number | null;
  diagnostics: Array<{ level: 'error'; message: string }>;
};

type AccountModelCostToken = {
  id: number;
  tokenGroup: string | null;
  enabled: boolean | null;
  isDefault: boolean | null;
};

export async function buildAccountModelCostSummary(input: {
  siteId: number;
  accountId: number;
  modelName: string;
  tokenRows: AccountModelCostToken[];
}): Promise<AccountModelCostSummary> {
  const enabledTokens = input.tokenRows.filter((token) => token.enabled !== false);
  const preferredToken =
    enabledTokens.find((token) => token.isDefault) || enabledTokens[0] || null;

  try {
    const quote = await quoteEndpointPricing({
      supply: {
        siteId: input.siteId,
        accountId: input.accountId,
        tokenId: preferredToken?.id,
        tokenGroup: preferredToken?.tokenGroup || undefined,
        modelName: input.modelName,
      },
      usageProfile: 'preview_1m_io',
      includeReference: false,
    });
    if (!quote.endpoint) return emptyAccountModelCostSummary();
    return {
      status: 'configured',
      configured: true,
      matchedScope: quote.endpoint.matchedScope,
      pricingId: typeof quote.endpoint.sourceId === 'number' ? quote.endpoint.sourceId : null,
      totalCost: Number.isFinite(quote.endpoint.summary.totalCost)
        ? quote.endpoint.summary.totalCost
        : null,
      diagnostics: [],
    };
  } catch (error) {
    return {
      status: 'error',
      configured: false,
      matchedScope: null,
      pricingId: null,
      totalCost: null,
      diagnostics: [{
        level: 'error',
        message: error instanceof Error ? error.message : String(error || 'pricing quote failed'),
      }],
    };
  }
}

function emptyAccountModelCostSummary(): AccountModelCostSummary {
  return {
    status: 'unconfigured',
    configured: false,
    matchedScope: null,
    pricingId: null,
    totalCost: null,
    diagnostics: [],
  };
}
