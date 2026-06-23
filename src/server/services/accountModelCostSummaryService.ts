import { quoteEndpointPricing } from "./pricingQuoteService.js";

export type AccountModelCostSummary = {
  configured: boolean;
  matchedScope: string | null;
  pricingId: number | null;
  totalCostUsd: number | null;
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
      configured: true,
      matchedScope: quote.endpoint.matchedScope,
      pricingId: typeof quote.endpoint.sourceId === 'number' ? quote.endpoint.sourceId : null,
      totalCostUsd: Number.isFinite(quote.endpoint.summary.totalCostUsd)
        ? quote.endpoint.summary.totalCostUsd
        : null,
    };
  } catch {
    return emptyAccountModelCostSummary();
  }
}

function emptyAccountModelCostSummary(): AccountModelCostSummary {
  return {
    configured: false,
    matchedScope: null,
    pricingId: null,
    totalCostUsd: null,
  };
}
