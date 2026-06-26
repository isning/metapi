import { eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { upsertSetting } from '../db/upsertSetting.js';

export const PRICING_REFERENCE_CONFIG_SETTING_KEY = 'pricing_reference_config_v1';

export type PricingReferenceConfig = {
  schemaVersion: 1;
  sync: {
    enabled: boolean;
    url: string;
    cron: string;
    replaceOnSync: boolean;
    lastSyncedAt: string | null;
    lastError: string | null;
  };
};

export function getDefaultPricingReferenceConfig(): PricingReferenceConfig {
  return {
    schemaVersion: 1,
    sync: {
      enabled: false,
      url: '',
      cron: '0 3 * * *',
      replaceOnSync: true,
      lastSyncedAt: null,
      lastError: null,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

export function normalizePricingReferenceConfig(input: unknown): PricingReferenceConfig {
  const defaults = getDefaultPricingReferenceConfig();
  const source = isRecord(input) ? input : {};
  const sync = isRecord(source.sync) ? source.sync : {};

  return {
    schemaVersion: 1,
    sync: {
      enabled: normalizeBoolean(sync.enabled, defaults.sync.enabled),
      url: normalizeString(sync.url, defaults.sync.url),
      cron: normalizeString(sync.cron, defaults.sync.cron) || defaults.sync.cron,
      replaceOnSync: normalizeBoolean(sync.replaceOnSync, defaults.sync.replaceOnSync),
      lastSyncedAt: normalizeNullableString(sync.lastSyncedAt),
      lastError: normalizeNullableString(sync.lastError),
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
