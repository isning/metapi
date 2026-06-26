import type { CanonicalUsage } from '../pricing-core/index.js';
import {
  ENDPOINT_PREVIEW_USAGE,
  ENDPOINT_ROUTING_REFERENCE_USAGE,
  resolveEndpointPricing,
} from './endpointPricingService.js';
import { quoteEffectiveEndpointCost } from './effectiveEndpointCostService.js';
import { comparePricingSummaries } from './pricingComparisonService.js';
import { resolveReferencePricing } from './referencePricingService.js';
import type {
  EndpointPricingSupply,
  EffectiveCostQuote,
  PricingQuote,
  PricingQuoteComparison,
  PricingResolution,
  PricingUsageProfile,
  ReferencePricingSubject,
} from './pricingQuoteTypes.js';

export type {
  EndpointPricingSupply,
  EffectiveCostQuote,
  PricingQuote,
  PricingQuoteComparison,
  PricingResolution,
  PricingUsageProfile,
  ReferencePricingSubject,
} from './pricingQuoteTypes.js';

export function usageForPricingProfile(
  usageProfile: PricingUsageProfile,
  usage?: Partial<CanonicalUsage>,
): Partial<CanonicalUsage> {
  if (usageProfile === 'actual') return usage || {};
  if (usageProfile === 'routing_reference') return usage || ENDPOINT_ROUTING_REFERENCE_USAGE;
  return usage || ENDPOINT_PREVIEW_USAGE;
}

export function comparePricingResolutions(
  endpoint: PricingResolution | null,
  reference: PricingResolution | null,
): PricingQuoteComparison {
  return comparePricingSummaries(endpoint?.summary ?? null, reference?.summary ?? null);
}

export async function quoteEndpointPricing(input: {
  supply: EndpointPricingSupply;
  usageProfile?: PricingUsageProfile;
  usage?: Partial<CanonicalUsage>;
  includeReference?: boolean;
}): Promise<PricingQuote> {
  const usageProfile = input.usageProfile || 'preview_1m_io';
  const usage = usageForPricingProfile(usageProfile, input.usage);
  const endpoint = await resolveEndpointPricing({
    supply: input.supply,
    usage,
  });
  const effectiveCost = await quoteEffectiveEndpointCost({
    supply: input.supply,
    endpoint,
  });
  const reference = input.includeReference === false
    ? null
    : await resolveReferencePricing({
      subject: {
        provider: input.supply.provider,
        modelName: input.supply.modelName,
      },
      usage,
    });

  return {
    subject: {
      kind: 'endpoint_supply',
      ...input.supply,
    },
    usageProfile,
    usage,
    endpoint,
    reference,
    effectiveCost,
    comparison: comparePricingResolutions(endpoint, reference),
    diagnostics: [
      ...(!endpoint ? [{ level: 'info' as const, message: 'No endpoint pricing matched.' }] : []),
      ...(effectiveCost?.diagnostics ?? []),
      ...(!reference && input.includeReference !== false
        ? [{ level: 'info' as const, message: 'No reference pricing matched.' }]
        : []),
    ],
  };
}

export async function quoteReferencePricing(input: {
  subject: ReferencePricingSubject;
  usageProfile?: PricingUsageProfile;
  usage?: Partial<CanonicalUsage>;
}): Promise<PricingQuote> {
  const usageProfile = input.usageProfile || 'preview_1m_io';
  const usage = usageForPricingProfile(usageProfile, input.usage);
  const reference = await resolveReferencePricing({
    subject: input.subject,
    usage,
  });

  return {
    subject: {
      kind: 'reference_model',
      ...input.subject,
    },
    usageProfile,
    usage,
    endpoint: null,
    reference,
    effectiveCost: null,
    comparison: comparePricingResolutions(null, reference),
    diagnostics: [
      ...(!reference ? [{ level: 'info' as const, message: 'No reference pricing matched.' }] : []),
    ],
  };
}
