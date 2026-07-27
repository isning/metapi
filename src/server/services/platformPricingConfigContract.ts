export const PLATFORM_PRICING_CONFIG_SETTING_KEY = 'platform_pricing_config_v1';

export type PlatformPricingConfig = {
  schemaVersion: 1;
  baseCostUnit: string;
  walletDefaultValuation: {
    enabled: boolean;
    walletUnit: string | null;
    faceValuePrice: number;
    rechargeDiscount: number;
    confidence: 'exact' | 'estimated' | 'incomplete';
  };
  upstreamDefaultPricing: {
    inputPerMillion: number;
    outputPerMillion: number;
    cacheReadPerMillion: number | null;
    cacheWritePerMillion: number | null;
    reasoningPerMillion: number | null;
    requestCost: number | null;
  };
  providerCatalogCache: {
    ttlHours: number;
  };
  driftCheck: {
    enabled: boolean;
    windowHours: number;
    minSampleSize: number;
    relativeTolerance: number;
    absoluteToleranceCost: number;
    notifyOnWarning: boolean;
  };
};

export function getDefaultPlatformPricingConfig(): PlatformPricingConfig {
  return {
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
      requestCost: null,
    },
    providerCatalogCache: {
      ttlHours: 6,
    },
    driftCheck: {
      enabled: false,
      windowHours: 24,
      minSampleSize: 20,
      relativeTolerance: 0.1,
      absoluteToleranceCost: 0.000001,
      notifyOnWarning: true,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeOptionalNonNegativeNumber(value: unknown, fallback: number | null): number | null {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeUnit(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.toUpperCase() : fallback;
}

function normalizeOptionalUnit(value: unknown, fallback: string | null): string | null {
  if (value == null || value === '') return fallback;
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.toUpperCase() : fallback;
}

function normalizeConfidence(value: unknown, fallback: PlatformPricingConfig['walletDefaultValuation']['confidence']) {
  return value === 'exact' || value === 'estimated' || value === 'incomplete' ? value : fallback;
}

export function normalizePlatformPricingConfig(input: unknown): PlatformPricingConfig {
  const defaults = getDefaultPlatformPricingConfig();
  const source = isRecord(input) ? input : {};
  const walletDefaultValuation = isRecord(source.walletDefaultValuation) ? source.walletDefaultValuation : {};
  const upstreamDefaultPricing = isRecord(source.upstreamDefaultPricing) ? source.upstreamDefaultPricing : {};
  const providerCatalogCache = isRecord(source.providerCatalogCache) ? source.providerCatalogCache : {};
  const driftCheck = isRecord(source.driftCheck) ? source.driftCheck : {};
  const baseCostUnit = normalizeUnit(source.baseCostUnit, defaults.baseCostUnit);

  return {
    schemaVersion: 1,
    baseCostUnit,
    walletDefaultValuation: {
      enabled: normalizeBoolean(
        walletDefaultValuation.enabled,
        defaults.walletDefaultValuation.enabled,
      ),
      walletUnit: normalizeOptionalUnit(
        walletDefaultValuation.walletUnit,
        defaults.walletDefaultValuation.walletUnit,
      ),
      faceValuePrice: normalizeNonNegativeNumber(
        walletDefaultValuation.faceValuePrice,
        defaults.walletDefaultValuation.faceValuePrice,
      ),
      rechargeDiscount: normalizeNonNegativeNumber(
        walletDefaultValuation.rechargeDiscount,
        defaults.walletDefaultValuation.rechargeDiscount,
      ),
      confidence: normalizeConfidence(
        walletDefaultValuation.confidence,
        defaults.walletDefaultValuation.confidence,
      ),
    },
    upstreamDefaultPricing: {
      inputPerMillion: normalizeNonNegativeNumber(
        upstreamDefaultPricing.inputPerMillion,
        defaults.upstreamDefaultPricing.inputPerMillion,
      ),
      outputPerMillion: normalizeNonNegativeNumber(
        upstreamDefaultPricing.outputPerMillion,
        defaults.upstreamDefaultPricing.outputPerMillion,
      ),
      cacheReadPerMillion: normalizeOptionalNonNegativeNumber(
        upstreamDefaultPricing.cacheReadPerMillion,
        defaults.upstreamDefaultPricing.cacheReadPerMillion,
      ),
      cacheWritePerMillion: normalizeOptionalNonNegativeNumber(
        upstreamDefaultPricing.cacheWritePerMillion,
        defaults.upstreamDefaultPricing.cacheWritePerMillion,
      ),
      reasoningPerMillion: normalizeOptionalNonNegativeNumber(
        upstreamDefaultPricing.reasoningPerMillion,
        defaults.upstreamDefaultPricing.reasoningPerMillion,
      ),
      requestCost: normalizeOptionalNonNegativeNumber(
        upstreamDefaultPricing.requestCost,
        defaults.upstreamDefaultPricing.requestCost,
      ),
    },
    providerCatalogCache: {
      ttlHours: Math.trunc(normalizePositiveNumber(
        providerCatalogCache.ttlHours,
        defaults.providerCatalogCache.ttlHours,
      )),
    },
    driftCheck: {
      enabled: normalizeBoolean(driftCheck.enabled, defaults.driftCheck.enabled),
      windowHours: Math.trunc(normalizePositiveNumber(driftCheck.windowHours, defaults.driftCheck.windowHours)),
      minSampleSize: Math.trunc(normalizePositiveNumber(driftCheck.minSampleSize, defaults.driftCheck.minSampleSize)),
      relativeTolerance: normalizeNonNegativeNumber(driftCheck.relativeTolerance, defaults.driftCheck.relativeTolerance),
      absoluteToleranceCost: normalizeNonNegativeNumber(
        driftCheck.absoluteToleranceCost,
        defaults.driftCheck.absoluteToleranceCost,
      ),
      notifyOnWarning: normalizeBoolean(driftCheck.notifyOnWarning, defaults.driftCheck.notifyOnWarning),
    },
  };
}

export function calculateRoutingFallbackUnitCostFromPlatformPricingConfig(
  input: unknown,
): number {
  const config = normalizePlatformPricingConfig(input);
  const pricing = config.upstreamDefaultPricing;
  const total = (
    pricing.inputPerMillion * 0.5
    + pricing.outputPerMillion * 0.5
    + (pricing.requestCost ?? 0)
  );
  return Math.max(1e-6, Number.isFinite(total) && total > 0 ? total : 1);
}

export function extractLegacyPlatformPricingConfig(input: unknown): PlatformPricingConfig {
  const source = isRecord(input) ? input : {};
  return normalizePlatformPricingConfig({
    driftCheck: isRecord(source.driftCheck) ? source.driftCheck : undefined,
  });
}
