import type {
  PricingComponentKind,
  PricingEvaluation,
} from '../pricing-core/index.js';
import type { PricingResolutionSummary } from './pricingQuoteTypes.js';

export function roundPricingNumber(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function pricingComponentUnitPrice(
  evaluation: PricingEvaluation,
  kind: PricingComponentKind,
): number | null {
  const components = evaluation.components.filter((component) => component.kind === kind);
  if (components.length === 0) return null;

  const totalUnitPrice = components.reduce((sum, component) => {
    if (!Number.isFinite(component.unitPriceUsd)) return sum;
    const sign = component.costUsd < 0 ? -1 : 1;
    return sum + component.unitPriceUsd * sign;
  }, 0);
  return roundPricingNumber(totalUnitPrice);
}

export function pricingEvaluationSummary(evaluation: PricingEvaluation): PricingResolutionSummary {
  return {
    inputPerMillion: pricingComponentUnitPrice(evaluation, 'input_tokens'),
    outputPerMillion: pricingComponentUnitPrice(evaluation, 'output_tokens'),
    cacheReadPerMillion: pricingComponentUnitPrice(evaluation, 'cache_read_tokens'),
    cacheWritePerMillion: pricingComponentUnitPrice(evaluation, 'cache_write_tokens'),
    reasoningPerMillion: pricingComponentUnitPrice(evaluation, 'reasoning_tokens'),
    requestUsd: pricingComponentUnitPrice(evaluation, 'request'),
    totalCostUsd: roundPricingNumber(evaluation.totalCostUsd),
  };
}
