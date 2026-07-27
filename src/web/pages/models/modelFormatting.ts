import type { ModelGroupPricing } from './modelDetailsView.js';

export function renderGroupPricingValue(pricing: ModelGroupPricing): string {
  const unit = pricing.currency ? `${pricing.currency} ` : '';
  if (pricing.quotaType === 0) {
    return `${unit}${pricing.inputPerMillion ?? 0}/${pricing.outputPerMillion ?? 0} / 1M`;
  }

  if (pricing.perCallInput != null || pricing.perCallOutput != null) {
    return `${unit}${pricing.perCallInput ?? 0}/${pricing.perCallOutput ?? 0} / call`;
  }

  return `${unit}${pricing.perCallTotal ?? 0} / call`;
}
