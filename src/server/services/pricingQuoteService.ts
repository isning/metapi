import type { CanonicalUsage } from '../pricing-core/index.js';
import {
  ENDPOINT_PREVIEW_USAGE,
  ENDPOINT_ROUTING_REFERENCE_USAGE,
  resolveEndpointPricing,
} from './endpointPricingService.js';
import { roundPricingNumber } from './pricingResolutionSummary.js';
import { resolveReferencePricing } from './referencePricingService.js';
import type {
  EndpointPricingSupply,
  PricingQuote,
  PricingQuoteComparison,
  PricingResolution,
  PricingUsageProfile,
  ReferencePricingSubject,
} from './pricingQuoteTypes.js';

export type {
  EndpointPricingSupply,
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

function multiplier(value: number | null, baseline: number | null): number | null {
  if (value == null || baseline == null || !Number.isFinite(value) || !Number.isFinite(baseline) || baseline <= 0) {
    return null;
  }
  return roundPricingNumber(value / baseline);
}

export function comparePricingResolutions(
  endpoint: PricingResolution | null,
  reference: PricingResolution | null,
): PricingQuoteComparison {
  return {
    inputMultiplier: multiplier(endpoint?.summary.inputPerMillion ?? null, reference?.summary.inputPerMillion ?? null),
    outputMultiplier: multiplier(endpoint?.summary.outputPerMillion ?? null, reference?.summary.outputPerMillion ?? null),
    totalMultiplier: multiplier(endpoint?.summary.totalCostUsd ?? null, reference?.summary.totalCostUsd ?? null),
  };
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
    comparison: comparePricingResolutions(endpoint, reference),
    diagnostics: [
      ...(!endpoint ? [{ level: 'info' as const, message: 'No endpoint pricing matched.' }] : []),
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
    comparison: comparePricingResolutions(null, reference),
    diagnostics: [
      ...(!reference ? [{ level: 'info' as const, message: 'No reference pricing matched.' }] : []),
    ],
  };
}
