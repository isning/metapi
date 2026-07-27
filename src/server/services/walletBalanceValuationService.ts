import { loadPlatformPricingConfig } from './platformPricingConfigService.js';
import { resolveFxRate } from './fxRateService.js';
import {
  resolveWalletAcquisitionProfile,
  type WalletAcquisitionProfile,
} from './walletAcquisitionService.js';

export type WalletBalanceValuationSubject = {
  siteId: number;
  accountId: number;
  tokenId?: number | null;
  balance: number | null | undefined;
};

export type WalletBalanceValuation = {
  balance: number;
  normalizedValue: number | null;
  baseCostUnit: string;
  walletUnit: string | null;
  profile: Pick<WalletAcquisitionProfile, 'id' | 'scope' | 'confidence'> | null;
  diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
};

function normalizeUnit(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.toUpperCase() : null;
}

function normalizeNonNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function profileCostMultiplier(profile: WalletAcquisitionProfile | null): number | null {
  if (!profile) return null;
  const faceValuePrice = normalizeNonNegativeNumber(profile.faceValuePrice ?? 1);
  const rechargeDiscount = normalizeNonNegativeNumber(profile.rechargeDiscount);
  return faceValuePrice * rechargeDiscount;
}

function defaultCostMultiplier(defaultValuation: Awaited<ReturnType<typeof loadPlatformPricingConfig>>['walletDefaultValuation']): number | null {
  if (!defaultValuation.enabled) return null;
  return normalizeNonNegativeNumber(defaultValuation.faceValuePrice)
    * normalizeNonNegativeNumber(defaultValuation.rechargeDiscount);
}

export async function valueWalletBalanceInBaseUnit(
  subject: WalletBalanceValuationSubject,
): Promise<WalletBalanceValuation> {
  const balance = normalizeNonNegativeNumber(subject.balance);
  const platformConfig = await loadPlatformPricingConfig();
  const baseCostUnit = normalizeUnit(platformConfig.baseCostUnit) || 'USD';
  const walletResolution = await resolveWalletAcquisitionProfile({
    siteId: subject.siteId,
    accountId: subject.accountId,
    tokenId: subject.tokenId ?? null,
  });
  const diagnostics = [...walletResolution.diagnostics];
  const profile = walletResolution.profile;
  const defaultValuation = platformConfig.walletDefaultValuation;
  const useDefaultValuation = !profile
    && walletResolution.status === 'unmatched'
    && defaultValuation.enabled;
  const walletUnit = normalizeUnit(profile?.walletUnit)
    || (useDefaultValuation ? normalizeUnit(defaultValuation.walletUnit) : null)
    || baseCostUnit;
  const multiplier = profile
    ? profileCostMultiplier(profile)
    : useDefaultValuation
      ? defaultCostMultiplier(defaultValuation)
      : null;

  if (!profile && walletResolution.status !== 'unmatched') {
    diagnostics.push({
      level: 'warn',
      message: 'Wallet balance valuation is incomplete because no acquisition profile is configured.',
    });
  }
  if (!profile && walletResolution.status === 'unmatched' && !useDefaultValuation) {
    diagnostics.push({
      level: 'warn',
      message: 'Wallet balance valuation is incomplete because default wallet valuation is disabled.',
    });
  }
  if (profile && multiplier == null) {
    diagnostics.push({
      level: 'warn',
      message: 'Wallet balance valuation is incomplete because wallet acquisition cost is invalid.',
    });
  }

  const fx = await resolveFxRate({
    fromCurrency: walletUnit,
    toCurrency: baseCostUnit,
  });
  diagnostics.push(...fx.diagnostics);

  const normalizedValue = multiplier != null && fx.rate
    ? roundCost(balance * multiplier * fx.rate.rate)
    : null;

  return {
    balance,
    normalizedValue,
    baseCostUnit,
    walletUnit,
    profile: profile
      ? {
        id: profile.id,
        scope: profile.scope,
        confidence: profile.confidence,
      }
      : null,
    diagnostics,
  };
}
