import { describe, expect, it, vi } from 'vitest';

const resolveEndpointPricingMock = vi.hoisted(() => vi.fn());
const resolveReferencePricingMock = vi.hoisted(() => vi.fn());

vi.mock('./endpointPricingService.js', async () => {
  const actual = await vi.importActual<typeof import('./endpointPricingService.js')>('./endpointPricingService.js');
  return {
    ...actual,
    resolveEndpointPricing: resolveEndpointPricingMock,
  };
});

vi.mock('./referencePricingService.js', () => ({
  resolveReferencePricing: resolveReferencePricingMock,
}));

describe('pricingQuoteService', () => {
  it('combines endpoint and reference pricing into comparable multipliers', async () => {
    resolveEndpointPricingMock.mockResolvedValue({
      summary: {
        inputPerMillion: 6,
        outputPerMillion: 10,
        totalCostUsd: 16,
      },
    });
    resolveReferencePricingMock.mockResolvedValue({
      summary: {
        inputPerMillion: 2,
        outputPerMillion: 5,
        totalCostUsd: 8,
      },
    });

    const { quoteEndpointPricing } = await import('./pricingQuoteService.js');
    const quote = await quoteEndpointPricing({
      supply: {
        siteId: 1,
        accountId: 2,
        tokenId: 3,
        tokenGroup: 'vip',
        provider: 'new-api',
        modelName: 'gpt-4o-mini',
      },
      usageProfile: 'preview_1m_io',
    });

    expect(resolveEndpointPricingMock).toHaveBeenCalledWith({
      supply: expect.objectContaining({
        siteId: 1,
        accountId: 2,
        tokenId: 3,
        tokenGroup: 'vip',
        modelName: 'gpt-4o-mini',
      }),
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        requestCount: 1,
      },
    });
    expect(resolveReferencePricingMock).toHaveBeenCalledWith({
      subject: {
        provider: 'new-api',
        modelName: 'gpt-4o-mini',
      },
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        requestCount: 1,
      },
    });
    expect(quote.comparison).toEqual({
      inputMultiplier: 3,
      outputMultiplier: 2,
      totalMultiplier: 2,
    });
  });
});
