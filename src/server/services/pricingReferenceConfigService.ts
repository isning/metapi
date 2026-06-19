import { eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { upsertSetting } from '../db/upsertSetting.js';

export const PRICING_REFERENCE_CONFIG_SETTING_KEY = 'pricing_reference_config_v1';

export type PricingReferenceMode = 'auto' | 'manual' | 'default' | 'override';
export type PricingFallbackProfile = 'system_default' | 'free' | 'unknown';

export type PricingReferenceConfig = {
  schemaVersion: 1;
  defaultReferenceMode: PricingReferenceMode;
  fallbackProfile: PricingFallbackProfile;
  catalog: {
    builtInCatalogEnabled: boolean;
    providerCatalogSuggestionsEnabled: boolean;
  };
  driftCheck: {
    enabled: boolean;
    windowHours: number;
    minSampleSize: number;
    relativeTolerance: number;
    absoluteToleranceUsd: number;
    notifyOnWarning: boolean;
  };
};

export function getDefaultPricingReferenceConfig(): PricingReferenceConfig {
  return {
    schemaVersion: 1,
    defaultReferenceMode: 'auto',
    fallbackProfile: 'system_default',
    catalog: {
      builtInCatalogEnabled: true,
      providerCatalogSuggestionsEnabled: true,
    },
    driftCheck: {
      enabled: false,
      windowHours: 24,
      minSampleSize: 20,
      relativeTolerance: 0.1,
      absoluteToleranceUsd: 0.000001,
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

function normalizeReferenceMode(value: unknown, fallback: PricingReferenceMode): PricingReferenceMode {
  return value === 'auto' || value === 'manual' || value === 'default' || value === 'override'
    ? value
    : fallback;
}

function normalizeFallbackProfile(value: unknown, fallback: PricingFallbackProfile): PricingFallbackProfile {
  return value === 'system_default' || value === 'free' || value === 'unknown'
    ? value
    : fallback;
}

export function normalizePricingReferenceConfig(input: unknown): PricingReferenceConfig {
  const defaults = getDefaultPricingReferenceConfig();
  const source = isRecord(input) ? input : {};
  const catalog = isRecord(source.catalog) ? source.catalog : {};
  const driftCheck = isRecord(source.driftCheck) ? source.driftCheck : {};

  return {
    schemaVersion: 1,
    defaultReferenceMode: normalizeReferenceMode(source.defaultReferenceMode, defaults.defaultReferenceMode),
    fallbackProfile: normalizeFallbackProfile(source.fallbackProfile, defaults.fallbackProfile),
    catalog: {
      builtInCatalogEnabled: normalizeBoolean(
        catalog.builtInCatalogEnabled,
        defaults.catalog.builtInCatalogEnabled,
      ),
      providerCatalogSuggestionsEnabled: normalizeBoolean(
        catalog.providerCatalogSuggestionsEnabled,
        defaults.catalog.providerCatalogSuggestionsEnabled,
      ),
    },
    driftCheck: {
      enabled: normalizeBoolean(driftCheck.enabled, defaults.driftCheck.enabled),
      windowHours: Math.trunc(normalizePositiveNumber(driftCheck.windowHours, defaults.driftCheck.windowHours)),
      minSampleSize: Math.trunc(normalizePositiveNumber(driftCheck.minSampleSize, defaults.driftCheck.minSampleSize)),
      relativeTolerance: normalizeNonNegativeNumber(driftCheck.relativeTolerance, defaults.driftCheck.relativeTolerance),
      absoluteToleranceUsd: normalizeNonNegativeNumber(
        driftCheck.absoluteToleranceUsd,
        defaults.driftCheck.absoluteToleranceUsd,
      ),
      notifyOnWarning: normalizeBoolean(driftCheck.notifyOnWarning, defaults.driftCheck.notifyOnWarning),
    },
  };
}

function parseSettingValue(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function loadPricingReferenceConfig(): Promise<PricingReferenceConfig> {
  const row = await db.select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, PRICING_REFERENCE_CONFIG_SETTING_KEY))
    .get();
  return normalizePricingReferenceConfig(parseSettingValue(row?.value));
}

export async function savePricingReferenceConfig(input: unknown): Promise<PricingReferenceConfig> {
  const next = normalizePricingReferenceConfig(input);
  await upsertSetting(PRICING_REFERENCE_CONFIG_SETTING_KEY, next);
  return next;
}
