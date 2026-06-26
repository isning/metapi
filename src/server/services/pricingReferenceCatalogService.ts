import cron from 'node-cron';
import { eq } from 'drizzle-orm';
import { fetch } from 'undici';

import { db, schema } from '../db/index.js';
import { upsertSetting } from '../db/upsertSetting.js';
import {
  parsePricingPlan,
  stableSha256,
  type PricingPlan,
} from '../pricing-core/index.js';
import {
  createSimpleTokenPricingPlan,
  normalizeUpstreamModelName,
} from './upstreamCostPricingService.js';
import {
  loadPricingReferenceConfig,
  savePricingReferenceConfig,
} from './pricingReferenceConfigService.js';

export const PRICING_REFERENCE_CATALOG_SETTING_KEY = 'pricing_reference_catalog_v1';

export type PricingReferenceCatalogEntry = {
  id: string;
  provider: string | null;
  modelName: string;
  normalizedModelName: string;
  displayName: string | null;
  aliases: string[];
  plan: PricingPlan;
  planFingerprint: string;
  sourceUrl: string | null;
  sourceType: 'manual' | 'imported' | 'remote';
  updatedAt: string;
  notes: string | null;
};

export type PricingReferenceCatalog = {
  schemaVersion: 1;
  entries: PricingReferenceCatalogEntry[];
  updatedAt: string | null;
};

export type PricingReferenceCatalogImportResult = {
  catalog: PricingReferenceCatalog;
  imported: number;
  replaced: number;
};

let referenceSyncTask: cron.ScheduledTask | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseSettingValue(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function normalizeOptionalText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
}

function normalizeProvider(value: unknown): string | null {
  const text = normalizeOptionalText(value);
  return text ? text.toLowerCase() : null;
}

function buildReferenceEntryId(provider: string | null, normalizedModelName: string): string {
  return `${provider || 'global'}:${normalizedModelName}`;
}

function planFromInput(input: Record<string, unknown>): PricingPlan {
  if (input.plan !== undefined) {
    const parsed = parsePricingPlan(input.plan);
    if (!parsed.success) throw new Error(parsed.error);
    return parsed.data;
  }
  const simple = isRecord(input.simpleTokenPricing) ? input.simpleTokenPricing : input;
  return createSimpleTokenPricingPlan({
    inputPerMillion: toOptionalNonNegativeNumber(simple.inputPerMillion),
    outputPerMillion: toOptionalNonNegativeNumber(simple.outputPerMillion),
    cacheReadPerMillion: toOptionalNonNegativeNumber(simple.cacheReadPerMillion),
    cacheWritePerMillion: toOptionalNonNegativeNumber(simple.cacheWritePerMillion),
    reasoningPerMillion: toOptionalNonNegativeNumber(simple.reasoningPerMillion),
    requestUsd: toOptionalNonNegativeNumber(simple.requestUsd),
  });
}

function toOptionalNonNegativeNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function normalizePricingReferenceCatalogEntry(
  input: unknown,
  options: { sourceType?: PricingReferenceCatalogEntry['sourceType']; sourceUrl?: string | null } = {},
): PricingReferenceCatalogEntry {
  if (!isRecord(input)) throw new Error('Reference pricing entry must be an object.');
  const modelName = normalizeOptionalText(input.modelName ?? input.model ?? input.modelKey);
  if (!modelName) throw new Error('Reference pricing entry requires modelName.');
  const normalizedModelName = normalizeUpstreamModelName(modelName);
  if (!normalizedModelName) throw new Error('Reference pricing entry requires a valid modelName.');
  const provider = normalizeProvider(input.provider);
  const plan = planFromInput(input);
  return {
    id: normalizeOptionalText(input.id) || buildReferenceEntryId(provider, normalizedModelName),
    provider,
    modelName,
    normalizedModelName,
    displayName: normalizeOptionalText(input.displayName),
    aliases: normalizeAliases(input.aliases),
    plan,
    planFingerprint: stableSha256(plan),
    sourceUrl: normalizeOptionalText(input.sourceUrl) || options.sourceUrl || null,
    sourceType: options.sourceType || (input.sourceType === 'remote' || input.sourceType === 'imported' ? input.sourceType : 'manual'),
    updatedAt: normalizeOptionalText(input.updatedAt) || nowIso(),
    notes: normalizeOptionalText(input.notes),
  };
}

export function normalizePricingReferenceCatalog(input: unknown): PricingReferenceCatalog {
  const source = isRecord(input) ? input : {};
  const rawEntries = Array.isArray(source.entries) ? source.entries : [];
  const byId = new Map<string, PricingReferenceCatalogEntry>();
  for (const raw of rawEntries) {
    const entry = normalizePricingReferenceCatalogEntry(raw);
    byId.set(entry.id, entry);
  }
  return {
    schemaVersion: 1,
    entries: Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id)),
    updatedAt: normalizeOptionalText(source.updatedAt),
  };
}

function parseImportPayload(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (isRecord(input) && Array.isArray(input.entries)) return input.entries;
  throw new Error('Reference pricing import must be an array or an object with entries.');
}

export async function loadPricingReferenceCatalog(): Promise<PricingReferenceCatalog> {
  const row = await db.select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, PRICING_REFERENCE_CATALOG_SETTING_KEY))
    .get();
  return normalizePricingReferenceCatalog(parseSettingValue(row?.value));
}

export async function savePricingReferenceCatalog(input: unknown): Promise<PricingReferenceCatalog> {
  const catalog = normalizePricingReferenceCatalog(input);
  const next = {
    ...catalog,
    updatedAt: nowIso(),
  };
  await upsertSetting(PRICING_REFERENCE_CATALOG_SETTING_KEY, next);
  return next;
}

export async function importPricingReferenceCatalog(input: unknown, options: {
  sourceType?: PricingReferenceCatalogEntry['sourceType'];
  sourceUrl?: string | null;
  replace?: boolean;
} = {}): Promise<PricingReferenceCatalogImportResult> {
  const current = options.replace ? { schemaVersion: 1 as const, entries: [], updatedAt: null } : await loadPricingReferenceCatalog();
  const nextById = new Map(current.entries.map((entry) => [entry.id, entry]));
  let replaced = 0;
  let imported = 0;
  for (const raw of parseImportPayload(input)) {
    const entry = normalizePricingReferenceCatalogEntry(raw, {
      sourceType: options.sourceType,
      sourceUrl: options.sourceUrl,
    });
    if (nextById.has(entry.id)) replaced += 1;
    imported += 1;
    nextById.set(entry.id, entry);
  }
  const catalog = await savePricingReferenceCatalog({
    schemaVersion: 1,
    entries: Array.from(nextById.values()),
  });
  return { catalog, imported, replaced };
}

export function findReferenceCatalogEntry(input: {
  catalog: PricingReferenceCatalog;
  provider?: string | null;
  modelName: string;
}): PricingReferenceCatalogEntry | null {
  const provider = normalizeProvider(input.provider);
  const normalizedModelName = normalizeUpstreamModelName(input.modelName);
  if (!normalizedModelName) return null;
  return input.catalog.entries.find((entry) => (
    (entry.provider == null || entry.provider === provider)
    && (
      entry.normalizedModelName === normalizedModelName
      || entry.aliases.some((alias) => normalizeUpstreamModelName(alias) === normalizedModelName)
    )
  )) ?? null;
}

export async function syncPricingReferenceCatalogFromConfiguredUrl(): Promise<PricingReferenceCatalogImportResult | null> {
  const config = await loadPricingReferenceConfig();
  const url = normalizeOptionalText(config.sync.url);
  if (!url || !config.sync.enabled) return null;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Reference pricing sync failed: HTTP ${response.status}`);
  const payload = await response.json();
  const result = await importPricingReferenceCatalog(payload, {
    sourceType: 'remote',
    sourceUrl: url,
    replace: config.sync.replaceOnSync,
  });
  await savePricingReferenceConfig({
    ...config,
    sync: {
      ...config.sync,
      lastSyncedAt: nowIso(),
      lastError: null,
    },
  });
  return result;
}

export async function reloadPricingReferenceCatalogScheduler(): Promise<void> {
  if (referenceSyncTask) {
    referenceSyncTask.stop();
    referenceSyncTask = null;
  }
  const config = await loadPricingReferenceConfig();
  if (!config.sync.enabled || !config.sync.url || !cron.validate(config.sync.cron)) return;
  referenceSyncTask = cron.schedule(config.sync.cron, () => {
    void syncPricingReferenceCatalogFromConfiguredUrl().catch(async (error) => {
      const latest = await loadPricingReferenceConfig();
      await savePricingReferenceConfig({
        ...latest,
        sync: {
          ...latest.sync,
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
    });
  });
}

export function stopPricingReferenceCatalogScheduler(): void {
  if (!referenceSyncTask) return;
  referenceSyncTask.stop();
  referenceSyncTask = null;
}
