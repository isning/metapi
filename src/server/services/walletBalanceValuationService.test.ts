import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveWalletAcquisitionProfileMock = vi.hoisted(() => vi.fn());
const resolveFxRateMock = vi.hoisted(() => vi.fn());
const loadPlatformPricingConfigMock = vi.hoisted(() => vi.fn());

vi.mock('./walletAcquisitionService.js', () => ({
  resolveWalletAcquisitionProfile: resolveWalletAcquisitionProfileMock,
}));

vi.mock('./fxRateService.js', () => ({
  resolveFxRate: resolveFxRateMock,
}));

vi.mock('./platformPricingConfigService.js', () => ({
  loadPlatformPricingConfig: loadPlatformPricingConfigMock,
}));

describe('walletBalanceValuationService', () => {
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
  });

  it('uses the global default wallet valuation when no profile matches', async () => {
    resolveWalletAcquisitionProfileMock.mockResolvedValue({
      profile: null,
      status: 'unmatched',
      diagnostics: [{ level: 'info', message: 'No wallet acquisition profile matched this endpoint supply.' }],
    });

    const { valueWalletBalanceInBaseUnit } = await import('./walletBalanceValuationService.js');
    const valuation = await valueWalletBalanceInBaseUnit({
      siteId: 1,
      accountId: 2,
      balance: 12.5,
    });

    expect(valuation.normalizedValue).toBe(12.5);
    expect(valuation.walletUnit).toBe('USD');
    expect(valuation.baseCostUnit).toBe('USD');
    expect(valuation.profile).toBeNull();
  });

  it('does not let the global default override a disabled wallet profile boundary', async () => {
    resolveWalletAcquisitionProfileMock.mockResolvedValue({
      profile: null,
      status: 'disabled',
      diagnostics: [{ level: 'info', message: 'Wallet acquisition profile disabled at account scope.' }],
    });

    const { valueWalletBalanceInBaseUnit } = await import('./walletBalanceValuationService.js');
    const valuation = await valueWalletBalanceInBaseUnit({
      siteId: 1,
      accountId: 2,
      balance: 12.5,
    });

    expect(valuation.normalizedValue).toBeNull();
    expect(valuation.profile).toBeNull();
    expect(valuation.diagnostics.some((item) => item.message.includes('disabled'))).toBe(true);
  });
});
