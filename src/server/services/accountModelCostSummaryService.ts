import { quoteEndpointPricing } from "./pricingQuoteService.js";

export type AccountModelCostSummary = {
  status: 'configured' | 'unconfigured' | 'error';
  configured: boolean;
  matchedScope: string | null;
  pricingId: number | null;
  totalCost: number | null;
  diagnostics: Array<{ level: 'error'; message: string }>;
};

export type AccountModelCostToken = {
  id: number;
  tokenGroup: string | null;
  enabled: boolean | null;
  isDefault: boolean | null;
};

export type ModelPricingSubject = {
  siteId: number;
  accountId: number;
  token: AccountModelCostToken | null;
};

export function resolveAccountPricingToken(tokens: AccountModelCostToken[]): AccountModelCostToken | null {
  const enabledTokens = tokens.filter((token) => token.enabled !== false);
  return enabledTokens.find((token) => token.isDefault) || enabledTokens[0] || null;
}

export async function buildModelCostSummary(input: {
  subject: ModelPricingSubject;
  modelName: string;
}): Promise<AccountModelCostSummary> {
  try {
    const quote = await quoteEndpointPricing({
      supply: {
        siteId: input.subject.siteId,
        accountId: input.subject.accountId,
        tokenId: input.subject.token?.id,
        tokenGroup: input.subject.token?.tokenGroup || undefined,
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

export async function buildPricedModelRows<T extends { name: string }>(input: {
  models: T[];
  subject: ModelPricingSubject;
}): Promise<Array<T & { costPricing: AccountModelCostSummary }>> {
  const costPricing = await Promise.all(input.models.map((model) =>
    buildModelCostSummary({ subject: input.subject, modelName: model.name }),
  ));
  return input.models.map((model, index) => ({ ...model, costPricing: costPricing[index] }));
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
