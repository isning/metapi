import { evaluateUpstreamCostPricing } from "./upstreamCostPricingService.js";

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

const ACCOUNT_MODEL_COST_PREVIEW_USAGE = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  requestCount: 1,
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
    const evaluated = await evaluateUpstreamCostPricing({
      siteId: input.siteId,
      accountId: input.accountId,
      tokenId: preferredToken?.id,
      tokenGroup: preferredToken?.tokenGroup || undefined,
      modelName: input.modelName,
      usage: ACCOUNT_MODEL_COST_PREVIEW_USAGE,
    });
    if (!evaluated) return emptyAccountModelCostSummary();
    return {
      configured: true,
      matchedScope: evaluated.matchedScope,
      pricingId: evaluated.pricing.id,
      totalCostUsd: Number.isFinite(evaluated.evaluation.totalCostUsd)
        ? evaluated.evaluation.totalCostUsd
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
