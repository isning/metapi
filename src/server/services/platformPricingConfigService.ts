import { eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { upsertSetting } from '../db/upsertSetting.js';
import {
  normalizePlatformPricingConfig,
  PLATFORM_PRICING_CONFIG_SETTING_KEY,
  type PlatformPricingConfig,
} from './platformPricingConfigContract.js';

export {
  calculateRoutingFallbackUnitCostFromPlatformPricingConfig,
  getDefaultPlatformPricingConfig,
  normalizePlatformPricingConfig,
  PLATFORM_PRICING_CONFIG_SETTING_KEY,
  type PlatformPricingConfig,
} from './platformPricingConfigContract.js';

function parseSettingValue(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function loadPlatformPricingConfig(): Promise<PlatformPricingConfig> {
  const row = await db.select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, PLATFORM_PRICING_CONFIG_SETTING_KEY))
    .get();
  return normalizePlatformPricingConfig(parseSettingValue(row?.value));
}

export async function savePlatformPricingConfig(input: unknown): Promise<PlatformPricingConfig> {
  const next = normalizePlatformPricingConfig(input);
  await upsertSetting(PLATFORM_PRICING_CONFIG_SETTING_KEY, next);
  return next;
}
