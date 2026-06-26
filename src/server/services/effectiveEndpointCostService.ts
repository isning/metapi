import type { PricingEvaluation } from '../pricing-core/index.js';
import { roundPricingNumber } from './pricingResolutionSummary.js';
import { resolveFxRate } from './fxRateService.js';
import type {
  EffectiveCostQuote,
  EndpointPricingSupply,
  PricingQuoteDiagnostic,
  PricingResolution,
} from './pricingQuoteTypes.js';
import {
  resolveWalletAcquisitionProfile,
  type WalletAcquisitionProfile,
} from './walletAcquisitionService.js';
import { loadPlatformPricingConfig, normalizePlatformPricingConfig } from './platformPricingConfigService.js';

function normalizeUnit(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.toUpperCase();
}

function asNonNegativeFinite(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function roundCost(value: number | null): number | null {
  return value == null ? null : roundPricingNumber(value);
}

function balanceBurnFromEvaluation(evaluation: PricingEvaluation | null): number | null {
  if (!evaluation) return null;
  const charge = evaluation.components
    .filter((component) => component.role === 'charge' || component.role === 'minimum')
    .reduce((sum, component) => sum + Math.max(0, component.costUsd), 0);
  const discount = evaluation.components
    .filter((component) => component.role === 'discount' || component.role === 'credit' || component.role === 'maximum')
    .reduce((sum, component) => sum + Math.abs(Math.min(0, component.costUsd)), 0);
  const total = Math.max(0, charge - discount + Math.max(0, evaluation.adjustmentCostUsd));
  if (Number.isFinite(total)) return total;
  return asNonNegativeFinite(evaluation.totalCostUsd);
}

function profileEstimateLevel(profile: WalletAcquisitionProfile | null, diagnostics: PricingQuoteDiagnostic[]): EffectiveCostQuote['estimateLevel'] {
  if (!profile || diagnostics.some((diagnostic) => diagnostic.level === 'warn' || diagnostic.level === 'error')) return 'incomplete';
  if (profile.confidence === 'exact') return 'exact';
  if (profile.confidence === 'estimated') return 'estimated';
  return 'incomplete';
}

function defaultEstimateLevel(confidence: unknown, diagnostics: PricingQuoteDiagnostic[]): EffectiveCostQuote['estimateLevel'] {
  if (diagnostics.some((diagnostic) => diagnostic.level === 'warn' || diagnostic.level === 'error')) return 'incomplete';
  if (confidence === 'exact') return 'exact';
  if (confidence === 'estimated') return 'estimated';
  return 'incomplete';
}

export async function quoteEffectiveEndpointCost(input: {
  supply: EndpointPricingSupply;
  endpoint: PricingResolution | null;
}): Promise<EffectiveCostQuote | null> {
  if (!input.endpoint?.evaluation) return null;

  const diagnostics: PricingQuoteDiagnostic[] = [];
  const burn = balanceBurnFromEvaluation(input.endpoint.evaluation);
  if (burn == null) {
    diagnostics.push({ level: 'warn', message: 'Endpoint pricing did not produce a usable balance burn amount.' });
  }

  const walletResolution = await resolveWalletAcquisitionProfile({
    siteId: input.supply.siteId,
    accountId: input.supply.accountId,
    tokenId: input.supply.tokenId ?? null,
    tokenGroup: input.supply.tokenGroup ?? null,
  });
  diagnostics.push(...walletResolution.diagnostics);
  const profile = walletResolution.profile;
  const platformConfig = normalizePlatformPricingConfig(await loadPlatformPricingConfig());
  const defaultValuation = platformConfig.walletDefaultValuation;
  const useDefaultValuation = !profile
    && walletResolution.status === 'unmatched'
    && defaultValuation.enabled;

  const baseCostUnit = normalizeUnit(platformConfig.baseCostUnit) || 'USD';
  const walletUnit = normalizeUnit(profile?.walletUnit)
    || (useDefaultValuation ? normalizeUnit(defaultValuation.walletUnit) : null)
    || baseCostUnit;
  const faceValuePrice = profile
    ? asNonNegativeFinite(profile.faceValuePrice ?? 1)
    : useDefaultValuation
      ? asNonNegativeFinite(defaultValuation.faceValuePrice)
      : null;
  const rechargeDiscount = profile
    ? asNonNegativeFinite(profile.rechargeDiscount)
    : useDefaultValuation
      ? asNonNegativeFinite(defaultValuation.rechargeDiscount)
      : null;
  const dailyEarnedBalance = asNonNegativeFinite(profile?.dailyEarnedBalance);

  if (!profile && walletResolution.status !== 'unmatched') {
    diagnostics.push({ level: 'warn', message: 'Wallet cost is incomplete because no acquisition profile is configured.' });
  }
  if (!profile && walletResolution.status === 'unmatched' && !useDefaultValuation) {
    diagnostics.push({ level: 'warn', message: 'Wallet cost is incomplete because default wallet valuation is disabled.' });
  }
  if (profile && faceValuePrice == null) {
    diagnostics.push({ level: 'warn', message: 'Wallet cost is incomplete because face value price is missing.' });
  }
  if ((profile || useDefaultValuation) && rechargeDiscount == null) {
    diagnostics.push({ level: 'warn', message: 'Wallet cost is incomplete because recharge discount is missing.' });
  }

  const fx = await resolveFxRate({
    fromCurrency: walletUnit,
    toCurrency: baseCostUnit,
  });
  diagnostics.push(...fx.diagnostics);

  const walletCostBaseCurrency = burn != null
    && (profile || useDefaultValuation)
    && faceValuePrice != null
    && rechargeDiscount != null
    && fx.rate
    ? roundCost(burn * faceValuePrice * rechargeDiscount * fx.rate.rate)
    : null;

  let freeQuotaDaysCost: number | null = null;
  if (burn != null && dailyEarnedBalance != null && dailyEarnedBalance > 0) {
    freeQuotaDaysCost = roundCost(burn / dailyEarnedBalance);
  } else if ((profile || useDefaultValuation) && burn != null) {
    diagnostics.push({ level: 'info', message: 'Free quota days cost is unavailable because daily earned balance is not configured.' });
  }

  const estimateLevel = profile
    ? profileEstimateLevel(profile, diagnostics)
    : useDefaultValuation
      ? defaultEstimateLevel(defaultValuation.confidence, diagnostics)
      : 'incomplete';

  return {
    estimateLevel,
    walletCostBaseCurrency,
    baseCostUnit,
    freeQuotaDaysCost,
    balanceBurn: burn == null || !walletUnit ? [] : [{ unit: walletUnit, amount: roundCost(burn) ?? burn }],
    walletUnit,
    faceValuePrice,
    rechargeDiscount,
    dailyEarnedBalance,
    unitConversionRate: fx.rate,
    acquisitionProfile: profile
      ? {
        id: profile.id,
        scope: profile.scope,
        confidence: profile.confidence,
      }
      : null,
    diagnostics,
  };
}
