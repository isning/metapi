import type { ModelGroupPricing } from './modelDetailsView.js';

export function renderGroupPricingValue(pricing: ModelGroupPricing): string {
  if (pricing.quotaType === 0) {
    return `${pricing.inputPerMillion ?? 0}/${pricing.outputPerMillion ?? 0} USD / 1M`;
  }

  if (pricing.perCallInput != null || pricing.perCallOutput != null) {
    return `${pricing.perCallInput ?? 0}/${pricing.perCallOutput ?? 0} USD / call`;
  }

  return `${pricing.perCallTotal ?? 0} USD / call`;
}
