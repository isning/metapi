import type { PricingResolutionSummary } from './pricingQuoteTypes.js';
import { roundPricingNumber } from './pricingResolutionSummary.js';

export type PricingComparisonSummary = {
  inputMultiplier: number | null;
  outputMultiplier: number | null;
  totalMultiplier: number | null;
};

function multiplier(value: number | null, baseline: number | null): number | null {
  if (value == null || baseline == null || !Number.isFinite(value) || !Number.isFinite(baseline) || baseline <= 0) {
    return null;
  }
  return roundPricingNumber(value / baseline);
}

export function comparePricingSummaries(
  value: Pick<PricingResolutionSummary, 'inputPerMillion' | 'outputPerMillion' | 'totalCostUsd'> | null | undefined,
  reference: Pick<PricingResolutionSummary, 'inputPerMillion' | 'outputPerMillion' | 'totalCostUsd'> | null | undefined,
): PricingComparisonSummary {
  return {
    inputMultiplier: multiplier(value?.inputPerMillion ?? null, reference?.inputPerMillion ?? null),
    outputMultiplier: multiplier(value?.outputPerMillion ?? null, reference?.outputPerMillion ?? null),
    totalMultiplier: multiplier(value?.totalCostUsd ?? null, reference?.totalCostUsd ?? null),
  };
}

export function hasReferencePricingBaseline(
  reference: Pick<PricingResolutionSummary, 'inputPerMillion' | 'outputPerMillion' | 'totalCostUsd'> | null | undefined,
): boolean {
  return Boolean(
    reference
    && (
      (reference.inputPerMillion != null && Number.isFinite(reference.inputPerMillion) && reference.inputPerMillion > 0)
      || (reference.outputPerMillion != null && Number.isFinite(reference.outputPerMillion) && reference.outputPerMillion > 0)
      || (reference.totalCostUsd != null && Number.isFinite(reference.totalCostUsd) && reference.totalCostUsd > 0)
    ),
  );
}
