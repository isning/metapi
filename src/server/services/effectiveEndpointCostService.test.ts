import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PricingEvaluation } from '../pricing-core/index.js';

const resolveWalletAcquisitionProfileMock = vi.hoisted(() => vi.fn());
const resolveFxRateMock = vi.hoisted(() => vi.fn());
const loadPlatformPricingConfigMock = vi.hoisted(() => vi.fn());

vi.mock('./walletAcquisitionService.js', () => ({
  resolveWalletAcquisitionProfile: resolveWalletAcquisitionProfileMock,
}));

vi.mock('./fxRateService.js', () => ({
  resolveFxRate: resolveFxRateMock,
}));

vi.mock('./platformPricingConfigService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platformPricingConfigService.js')>()),
  loadPlatformPricingConfig: loadPlatformPricingConfigMock,
}));

function evaluation(totalCostUsd: number): PricingEvaluation {
  return {
    catalogEntryId: null,
    source: 'user_override',
    usageHash: 'usage',
    planFingerprint: 'plan',
    totalCostUsd,
    subtotalCostUsd: totalCostUsd,
    adjustmentCostUsd: 0,
    estimateLevel: 'exact',
    components: [{
      componentId: 'input_tokens',
      kind: 'input_tokens',
      quantity: 1_000_000,
      scale: 1_000_000,
      unitPriceUsd: totalCostUsd,
      costUsd: totalCostUsd,
      role: 'charge',
      quantityPricingMode: 'flat',
    }],
    equivalentMultipliers: {},
    diagnostics: [],
  };
}

describe('effectiveEndpointCostService', () => {
  beforeEach(() => {
    resolveWalletAcquisitionProfileMock.mockReset();
    resolveFxRateMock.mockReset();
    loadPlatformPricingConfigMock.mockReset();
    loadPlatformPricingConfigMock.mockResolvedValue({
      schemaVersion: 1,
      baseCostUnit: 'USD',
      walletDefaultValuation: {
        enabled: true,
        walletUnit: null,
        faceValuePrice: 1,
        rechargeDiscount: 1,
        confidence: 'estimated',
      },
      upstreamDefaultPricing: {
        inputPerMillion: 1,
        outputPerMillion: 1,
        cacheReadPerMillion: null,
        cacheWritePerMillion: null,
        reasoningPerMillion: null,
        requestUsd: null,
      },
      driftCheck: {
        enabled: false,
        windowHours: 24,
        minSampleSize: 20,
        relativeTolerance: 0.1,
        absoluteToleranceUsd: 0.000001,
        notifyOnWarning: true,
      },
    });
  });

  it('keeps zero-discount wallet cost separate from free quota days', async () => {
    resolveWalletAcquisitionProfileMock.mockResolvedValue({
      profile: {
        id: 1,
        scope: 'site',
        confidence: 'exact',
        walletUnit: 'CNY',
        faceValuePrice: 1,
        rechargeDiscount: 0,
        dailyEarnedBalance: 10,
      },
      status: 'matched',
      diagnostics: [],
    });
    resolveFxRateMock.mockResolvedValue({
      rate: {
        fromCurrency: 'CNY',
        toCurrency: 'USD',
        rate: 0.14,
        source: 'manual',
        snapshotId: 7,
        capturedAt: '2026-06-24 00:00:00',
      },
      diagnostics: [],
    });

    const { quoteEffectiveEndpointCost } = await import('./effectiveEndpointCostService.js');
    const quote = await quoteEffectiveEndpointCost({
      supply: { siteId: 1, accountId: 2, modelName: 'deepseek-v4-flash' },
      endpoint: {
        source: 'manual_binding',
        sourceId: 10,
        matchedScope: 'site_model',
        sourceType: 'user',
        planFingerprint: 'plan',
        estimateLevel: 'exact',
        evaluation: evaluation(5),
        summary: {
          inputPerMillion: 5,
          outputPerMillion: null,
          cacheReadPerMillion: null,
          cacheWritePerMillion: null,
          reasoningPerMillion: null,
          requestUsd: null,
          totalCostUsd: 5,
        },
        diagnostics: [],
      },
    });

    expect(quote?.walletCostBaseCurrency).toBe(0);
    expect(quote?.freeQuotaDaysCost).toBe(0.5);
    expect(quote?.balanceBurn).toEqual([{ unit: 'CNY', amount: 5 }]);
  });

  it('applies recharge discount and FX for paid wallet cost', async () => {
    resolveWalletAcquisitionProfileMock.mockResolvedValue({
      profile: {
        id: 2,
        scope: 'account',
        confidence: 'estimated',
        walletUnit: 'CNY',
        faceValuePrice: 1,
        rechargeDiscount: 0.8,
        dailyEarnedBalance: null,
      },
      status: 'matched',
      diagnostics: [],
    });
    resolveFxRateMock.mockResolvedValue({
      rate: {
        fromCurrency: 'CNY',
        toCurrency: 'USD',
        rate: 0.125,
        source: 'manual',
        snapshotId: 8,
        capturedAt: '2026-06-24 00:00:00',
      },
      diagnostics: [],
    });

    const { quoteEffectiveEndpointCost } = await import('./effectiveEndpointCostService.js');
    const quote = await quoteEffectiveEndpointCost({
      supply: { siteId: 1, accountId: 2, modelName: 'model' },
      endpoint: {
        source: 'manual_binding',
        sourceId: 10,
        matchedScope: 'account_model',
        sourceType: 'user',
        planFingerprint: 'plan',
        estimateLevel: 'exact',
        evaluation: evaluation(12),
        summary: {
          inputPerMillion: 12,
          outputPerMillion: null,
          cacheReadPerMillion: null,
          cacheWritePerMillion: null,
          reasoningPerMillion: null,
          requestUsd: null,
          totalCostUsd: 12,
        },
        diagnostics: [],
      },
    });

    expect(quote?.walletCostBaseCurrency).toBe(1.2);
    expect(quote?.freeQuotaDaysCost).toBeNull();
    expect(quote?.estimateLevel).toBe('estimated');
  });

  it('uses the global default wallet valuation when no profile matches', async () => {
    resolveWalletAcquisitionProfileMock.mockResolvedValue({
      profile: null,
      status: 'unmatched',
      diagnostics: [{ level: 'info', message: 'No wallet acquisition profile matched this endpoint supply.' }],
    });
    resolveFxRateMock.mockResolvedValue({
      rate: {
        fromCurrency: 'USD',
        toCurrency: 'USD',
        rate: 1,
        source: 'identity',
        snapshotId: null,
        capturedAt: null,
      },
      diagnostics: [],
    });

    const { quoteEffectiveEndpointCost } = await import('./effectiveEndpointCostService.js');
    const quote = await quoteEffectiveEndpointCost({
      supply: { siteId: 1, accountId: 2, modelName: 'model' },
      endpoint: {
        source: 'manual_binding',
        sourceId: 10,
        matchedScope: 'site_model',
        sourceType: 'user',
        planFingerprint: 'plan',
        estimateLevel: 'exact',
        evaluation: evaluation(3),
        summary: {
          inputPerMillion: 3,
          outputPerMillion: null,
          cacheReadPerMillion: null,
          cacheWritePerMillion: null,
          reasoningPerMillion: null,
          requestUsd: null,
          totalCostUsd: 3,
        },
        diagnostics: [],
      },
    });

    expect(quote?.walletCostBaseCurrency).toBe(3);
    expect(quote?.estimateLevel).toBe('estimated');
    expect(quote?.faceValuePrice).toBe(1);
    expect(quote?.rechargeDiscount).toBe(1);
    expect(quote?.balanceBurn).toEqual([{ unit: 'USD', amount: 3 }]);
  });

  it('does not let the global default override a disabled wallet profile boundary', async () => {
    resolveWalletAcquisitionProfileMock.mockResolvedValue({
      profile: null,
      status: 'disabled',
      diagnostics: [{ level: 'info', message: 'Wallet acquisition profile disabled at site scope.' }],
    });
    resolveFxRateMock.mockResolvedValue({
      rate: {
        fromCurrency: 'USD',
        toCurrency: 'USD',
        rate: 1,
        source: 'identity',
        snapshotId: null,
        capturedAt: null,
      },
      diagnostics: [],
    });

    const { quoteEffectiveEndpointCost } = await import('./effectiveEndpointCostService.js');
    const quote = await quoteEffectiveEndpointCost({
      supply: { siteId: 1, accountId: 2, modelName: 'model' },
      endpoint: {
        source: 'manual_binding',
        sourceId: 10,
        matchedScope: 'site_model',
        sourceType: 'user',
        planFingerprint: 'plan',
        estimateLevel: 'exact',
        evaluation: evaluation(3),
        summary: {
          inputPerMillion: 3,
          outputPerMillion: null,
          cacheReadPerMillion: null,
          cacheWritePerMillion: null,
          reasoningPerMillion: null,
          requestUsd: null,
          totalCostUsd: 3,
        },
        diagnostics: [],
      },
    });

    expect(quote?.walletCostBaseCurrency).toBeNull();
    expect(quote?.estimateLevel).toBe('incomplete');
    expect(quote?.faceValuePrice).toBeNull();
    expect(quote?.rechargeDiscount).toBeNull();
    expect(quote?.diagnostics.some((item) => item.message.includes('disabled'))).toBe(true);
  });
});
