import { eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { upsertSetting } from '../db/upsertSetting.js';
import {
  getDefaultPricingReferenceConfig,
  normalizePricingReferenceConfig,
  PRICING_REFERENCE_CONFIG_SETTING_KEY,
} from './pricingReferenceConfigService.js';
import {
  extractLegacyPlatformPricingConfig,
  getDefaultPlatformPricingConfig,
  normalizePlatformPricingConfig,
  PLATFORM_PRICING_CONFIG_SETTING_KEY,
} from './platformPricingConfigContract.js';

export const CURRENT_CONFIG_VERSION = '2.4';
export const CONFIG_VERSION_SETTING_KEY = 'metapi_config_version';

export type ConfigMigrationSetting = {
  key: string;
  value: unknown;
};

export type ConfigMigrationSummary = {
  fromVersion: string | null;
  toVersion: string;
  migrated: boolean;
  appliedSettings: string[];
};

function parseSettingValue(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function normalizeConfigVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function migratePreferenceSettingsToCurrentConfigVersion(
  settings: ConfigMigrationSetting[],
): { settings: ConfigMigrationSetting[]; appliedSettings: string[] } {
  const nextSettings: ConfigMigrationSetting[] = [];
  const appliedSettings: string[] = [];
  let legacyPlatformPricingConfig: ConfigMigrationSetting | null = null;
  let sawPricingReferenceConfig = false;
  let sawPlatformPricingConfig = false;
  let sawConfigVersion = false;

  for (const row of settings) {
    if (row.key === 'routing_fallback_unit_cost') {
      appliedSettings.push(row.key);
      continue;
    }

    if (row.key === PRICING_REFERENCE_CONFIG_SETTING_KEY) {
      sawPricingReferenceConfig = true;
      const normalized = normalizePricingReferenceConfig(row.value);
      nextSettings.push({ key: row.key, value: normalized });
      legacyPlatformPricingConfig = {
        key: PLATFORM_PRICING_CONFIG_SETTING_KEY,
        value: extractLegacyPlatformPricingConfig(row.value),
      };
      if (!sameJson(row.value, normalized)) {
        appliedSettings.push(row.key);
      }
      continue;
    }

    if (row.key === PLATFORM_PRICING_CONFIG_SETTING_KEY) {
      sawPlatformPricingConfig = true;
      const normalized = normalizePlatformPricingConfig(row.value);
      nextSettings.push({ key: row.key, value: normalized });
      if (!sameJson(row.value, normalized)) {
        appliedSettings.push(row.key);
      }
      continue;
    }

    if (row.key === CONFIG_VERSION_SETTING_KEY) {
      sawConfigVersion = true;
      nextSettings.push({ key: row.key, value: CURRENT_CONFIG_VERSION });
      if (normalizeConfigVersion(row.value) !== CURRENT_CONFIG_VERSION) {
        appliedSettings.push(row.key);
      }
      continue;
    }

    nextSettings.push(row);
  }

  if (!sawPricingReferenceConfig) {
    nextSettings.push({
      key: PRICING_REFERENCE_CONFIG_SETTING_KEY,
      value: getDefaultPricingReferenceConfig(),
    });
    appliedSettings.push(PRICING_REFERENCE_CONFIG_SETTING_KEY);
  }

  if (!sawPlatformPricingConfig) {
    nextSettings.push({
      key: PLATFORM_PRICING_CONFIG_SETTING_KEY,
      value: legacyPlatformPricingConfig?.value ?? getDefaultPlatformPricingConfig(),
    });
    appliedSettings.push(PLATFORM_PRICING_CONFIG_SETTING_KEY);
  }

  if (!sawConfigVersion) {
    nextSettings.push({
      key: CONFIG_VERSION_SETTING_KEY,
      value: CURRENT_CONFIG_VERSION,
    });
    appliedSettings.push(CONFIG_VERSION_SETTING_KEY);
  }

  return {
    settings: nextSettings,
    appliedSettings: Array.from(new Set(appliedSettings)),
  };
}

export async function ensureCurrentConfigVersion(): Promise<ConfigMigrationSummary> {
  const rows = await db.select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, CONFIG_VERSION_SETTING_KEY))
    .all();
  const fromVersion = normalizeConfigVersion(parseSettingValue(rows[0]?.value));
  const allSettings = await db.select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .all();
  const parsedSettings = allSettings.map((row) => ({
    key: row.key,
    value: parseSettingValue(row.value),
  }));
  const migrated = migratePreferenceSettingsToCurrentConfigVersion(parsedSettings);
  const appliedSettings: string[] = [];

  for (const key of migrated.appliedSettings) {
    const row = migrated.settings.find((item) => item.key === key);
    if (!row) {
      await db.delete(schema.settings)
        .where(eq(schema.settings.key, key))
        .run();
      appliedSettings.push(key);
      continue;
    }
    await upsertSetting(row.key, row.value);
    appliedSettings.push(row.key);
  }

  return {
    fromVersion,
    toVersion: CURRENT_CONFIG_VERSION,
    migrated: appliedSettings.length > 0,
    appliedSettings,
  };
}
