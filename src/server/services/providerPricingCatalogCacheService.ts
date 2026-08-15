import { and, eq, sql, type SQL } from 'drizzle-orm';
import { insertAndGetById } from '../db/insertHelpers.js';
import { db, schema } from '../db/index.js';
import { stableSha256 } from '../pricing-core/index.js';
import {
  DEFAULT_PRICING_GROUP,
  type UpstreamPricingCatalog,
  type UpstreamPricingModel,
} from './upstreamPricingCatalog.js';
import {
  fetchUpstreamPricingCatalogWithMetadata,
  type UpstreamPricingCatalogRequest,
} from './upstreamPricingCatalogService.js';
import { loadPlatformPricingConfig } from './platformPricingConfigService.js';
import { getPreferredAccountToken } from './accountTokenService.js';

export const PROVIDER_PRICING_CATALOG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type ProviderPricingCatalogCacheStatus = 'success' | 'error';

export type ProviderPricingCatalogCacheRecord = {
  id: number;
  scopeKey: string;
  siteId: number;
  accountId: number | null;
  platform: string;
  credentialKind: string | null;
  catalog: UpstreamPricingCatalog | null;
  modelCount: number;
  groupCount: number;
  catalogFingerprint: string | null;
  lastStatus: ProviderPricingCatalogCacheStatus;
  lastError: string | null;
  diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
  fetchedAt: string;
  expiresAt: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ProviderPricingCatalogRefreshResult = {
  record: ProviderPricingCatalogCacheRecord | null;
  refreshed: boolean;
  status: ProviderPricingCatalogCacheStatus;
  error: string | null;
};

type Row = typeof schema.providerPricingCatalogCaches.$inferSelect;

type CatalogJson = {
  models: UpstreamPricingModel[];
  groupRatio: Record<string, number>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function expiresAtIso(ttlMs = PROVIDER_PRICING_CATALOG_CACHE_TTL_MS): string {
  return new Date(Date.now() + Math.max(1, ttlMs)).toISOString();
}

async function resolveProviderPricingCatalogCacheTtlMs(overrideMs?: number | null): Promise<number> {
  if (overrideMs != null && Number.isFinite(overrideMs) && overrideMs > 0) {
    return Math.trunc(overrideMs);
  }
  const config = await loadPlatformPricingConfig();
  return Math.max(1, Math.trunc(config.providerCatalogCache.ttlHours * 60 * 60 * 1000));
}

function normalizePositiveId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function scopeKey(input: { siteId: number; accountId?: number | null }): string {
  return [
    'provider_catalog',
    `site:${input.siteId}`,
    `account:${input.accountId ?? '-'}`,
  ].join('|');
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeCatalog(catalog: UpstreamPricingCatalog): CatalogJson {
  const models = [...catalog.models.values()].sort((a, b) => a.modelName.localeCompare(b.modelName));
  const groupRatio = Object.fromEntries(
    Object.entries(catalog.groupRatio || { [DEFAULT_PRICING_GROUP]: 1 })
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return { models, groupRatio };
}

function deserializeCatalog(raw: unknown): UpstreamPricingCatalog | null {
  const parsed = typeof raw === 'string'
    ? parseJson<CatalogJson | null>(raw, null)
    : raw as CatalogJson | null;
  if (!parsed || !Array.isArray(parsed.models)) return null;
  const models = new Map<string, UpstreamPricingModel>();
  for (const model of parsed.models) {
    if (!model?.modelName) continue;
    models.set(model.modelName, model);
  }
  if (models.size === 0) return null;
  return {
    models,
    groupRatio: parsed.groupRatio && Object.keys(parsed.groupRatio).length > 0
      ? parsed.groupRatio
      : { [DEFAULT_PRICING_GROUP]: 1 },
  };
}

function rowToRecord(row: Row): ProviderPricingCatalogCacheRecord {
  const diagnostics = parseJson<ProviderPricingCatalogCacheRecord['diagnostics']>(row.diagnosticsJson, []);
  return {
    id: Number(row.id),
    scopeKey: row.scopeKey,
    siteId: Number(row.siteId),
    accountId: row.accountId == null ? null : Number(row.accountId),
    platform: row.platform,
    credentialKind: row.credentialKind,
    catalog: deserializeCatalog(row.catalogJson),
    modelCount: Number(row.modelCount || 0),
    groupCount: Number(row.groupCount || 0),
    catalogFingerprint: row.catalogFingerprint,
    lastStatus: (row.lastStatus === 'error' ? 'error' : 'success'),
    lastError: row.lastError,
    diagnostics: Array.isArray(diagnostics) ? diagnostics : [],
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isFresh(record: ProviderPricingCatalogCacheRecord, maxAgeMs: number): boolean {
  if (!record.catalog || record.lastStatus !== 'success') return false;
  const fetchedAt = Date.parse(record.fetchedAt);
  const now = Date.now();
  if (!Number.isFinite(fetchedAt)) return false;
  return now - fetchedAt <= Math.max(1, maxAgeMs);
}

async function getCacheRow(input: { siteId: number; accountId?: number | null }): Promise<Row | null> {
  const siteId = normalizePositiveId(input.siteId);
  if (siteId == null) return null;
  const accountId = normalizePositiveId(input.accountId);
  return await db.select()
    .from(schema.providerPricingCatalogCaches)
    .where(eq(schema.providerPricingCatalogCaches.scopeKey, scopeKey({ siteId, accountId })))
    .get() as Row | null;
}

export async function getCachedProviderPricingCatalog(input: {
  siteId: number;
  accountId?: number | null;
  maxAgeMs?: number;
}): Promise<ProviderPricingCatalogCacheRecord | null> {
  const row = await getCacheRow(input);
  if (!row) return null;
  const record = rowToRecord(row);
  const maxAgeMs = await resolveProviderPricingCatalogCacheTtlMs(input.maxAgeMs);
  return isFresh(record, maxAgeMs)
    ? record
    : null;
}

export async function getProviderPricingCatalogCacheRecord(input: {
  siteId: number;
  accountId?: number | null;
}): Promise<ProviderPricingCatalogCacheRecord | null> {
  const row = await getCacheRow(input);
  return row ? rowToRecord(row) : null;
}

async function loadCatalogRequest(input: {
  siteId: number;
  accountId?: number | null;
}): Promise<UpstreamPricingCatalogRequest | null> {
  const siteId = normalizePositiveId(input.siteId);
  if (siteId == null) return null;
  const accountId = normalizePositiveId(input.accountId);

  if (accountId == null) {
    const site = await db.select({
      id: schema.sites.id,
      url: schema.sites.url,
      platform: schema.sites.platform,
      apiKey: schema.sites.apiKey,
    })
      .from(schema.sites)
      .where(eq(schema.sites.id, siteId))
      .get();
    if (!site) return null;
    return {
      site,
      account: { id: 0 },
    };
  }

  const row = await db.select({
    siteId: schema.sites.id,
    siteUrl: schema.sites.url,
    sitePlatform: schema.sites.platform,
    siteApiKey: schema.sites.apiKey,
    accountId: schema.accounts.id,
    accountUsername: schema.accounts.username,
    accountCredential: schema.accounts.credential,
    accountCredentialKind: schema.accounts.credentialKind,
    accountExtraConfig: schema.accounts.extraConfig,
  })
    .from(schema.accounts)
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .where(and(
      eq(schema.accounts.id, accountId),
      eq(schema.sites.id, siteId),
    ))
    .get();
  if (!row) return null;
  const preferredToken = await getPreferredAccountToken(row.accountId);
  return {
    site: {
      id: row.siteId,
      url: row.siteUrl,
      platform: row.sitePlatform,
      apiKey: row.siteApiKey,
    },
    account: {
      id: row.accountId,
      username: row.accountUsername,
      credential: row.accountCredential,
      credentialKind: row.accountCredentialKind,
      extraConfig: row.accountExtraConfig,
    },
    upstreamCredential: preferredToken
      ? { token: preferredToken.token, tokenKind: 'api_token' }
      : null,
  };
}

async function upsertSuccess(input: {
  siteId: number;
  accountId: number | null;
  platform: string;
  credentialKind: string | null;
  catalog: UpstreamPricingCatalog;
  ttlMs?: number;
}): Promise<ProviderPricingCatalogCacheRecord> {
  const serialized = serializeCatalog(input.catalog);
  const values = {
    scopeKey: scopeKey({ siteId: input.siteId, accountId: input.accountId }),
    siteId: input.siteId,
    accountId: input.accountId,
    platform: input.platform,
    credentialKind: input.credentialKind,
    catalogJson: JSON.stringify(serialized),
    modelCount: serialized.models.length,
    groupCount: Object.keys(serialized.groupRatio).length,
    catalogFingerprint: stableSha256(serialized),
    lastStatus: 'success',
    lastError: null,
    diagnosticsJson: JSON.stringify([]),
    fetchedAt: nowIso(),
    expiresAt: expiresAtIso(input.ttlMs),
  };
  const existing = await getCacheRow(input);
  if (!existing) {
    const inserted = await insertAndGetById<Row>({
      table: schema.providerPricingCatalogCaches,
      idColumn: schema.providerPricingCatalogCaches.id,
      values,
      insertErrorMessage: 'Failed to create provider pricing catalog cache.',
    });
    return rowToRecord(inserted);
  }

  await db.update(schema.providerPricingCatalogCaches)
    .set({
      ...values,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(schema.providerPricingCatalogCaches.id, existing.id))
    .run();
  const row = await getCacheRow(input);
  if (!row) throw new Error('Provider pricing catalog cache disappeared after update.');
  return rowToRecord(row);
}

async function upsertFailure(input: {
  siteId: number;
  accountId: number | null;
  platform: string;
  error: string;
  ttlMs?: number;
}): Promise<ProviderPricingCatalogCacheRecord | null> {
  const existing = await getCacheRow(input);
  const values = {
    scopeKey: scopeKey({ siteId: input.siteId, accountId: input.accountId }),
    siteId: input.siteId,
    accountId: input.accountId,
    platform: input.platform,
    lastStatus: 'error',
    lastError: input.error.slice(0, 2000),
    diagnosticsJson: JSON.stringify([{ level: 'warn', message: input.error.slice(0, 2000) }]),
    fetchedAt: nowIso(),
    expiresAt: expiresAtIso(input.ttlMs),
  };

  if (!existing) {
    const inserted = await insertAndGetById<Row>({
      table: schema.providerPricingCatalogCaches,
      idColumn: schema.providerPricingCatalogCaches.id,
      values: {
        ...values,
        credentialKind: null,
        catalogJson: null,
        modelCount: 0,
        groupCount: 0,
        catalogFingerprint: null,
      },
      insertErrorMessage: 'Failed to create provider pricing catalog failure cache.',
    });
    return rowToRecord(inserted);
  }

  await db.update(schema.providerPricingCatalogCaches)
    .set({
      lastStatus: values.lastStatus,
      lastError: values.lastError,
      diagnosticsJson: values.diagnosticsJson,
      fetchedAt: values.fetchedAt,
      expiresAt: values.expiresAt,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(schema.providerPricingCatalogCaches.id, existing.id))
    .run();
  const row = await getCacheRow(input);
  return row ? rowToRecord(row) : null;
}

export async function refreshProviderPricingCatalog(input: {
  siteId: number;
  accountId?: number | null;
  reason?: string;
  ttlMs?: number;
}): Promise<ProviderPricingCatalogRefreshResult> {
  const ttlMs = await resolveProviderPricingCatalogCacheTtlMs(input.ttlMs);
  const request = await loadCatalogRequest(input);
  if (!request) {
    return {
      record: null,
      refreshed: false,
      status: 'error',
      error: 'Provider pricing catalog subject was not found.',
    };
  }

  const siteId = request.site.id;
  const accountId = request.account.id > 0 ? request.account.id : null;
  try {
    const result = await fetchUpstreamPricingCatalogWithMetadata(request);
    if (!result) {
      const record = await upsertFailure({
        siteId,
        accountId,
        platform: request.site.platform,
        error: 'Provider pricing catalog is unavailable for this site/account.',
        ttlMs,
      });
      return { record, refreshed: true, status: 'error', error: record?.lastError ?? null };
    }

    const record = await upsertSuccess({
      siteId,
      accountId,
      platform: request.site.platform,
      credentialKind: result.credentialKind,
      catalog: result.catalog,
      ttlMs,
    });
    return { record, refreshed: true, status: 'success', error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown error');
    const record = await upsertFailure({
      siteId,
      accountId,
      platform: request.site.platform,
      error: message,
      ttlMs,
    });
    return { record, refreshed: true, status: 'error', error: message };
  }
}

export async function listProviderPricingCatalogRefreshSubjects(): Promise<Array<{
  siteId: number;
  accountId: number | null;
}>> {
  const rows = await db.select({
    siteId: schema.sites.id,
    accountId: schema.accounts.id,
  })
    .from(schema.sites)
    .leftJoin(schema.accounts, eq(schema.accounts.siteId, schema.sites.id))
    .all();

  const seen = new Set<string>();
  const subjects: Array<{ siteId: number; accountId: number | null }> = [];
  for (const row of rows) {
    const siteId = normalizePositiveId(row.siteId);
    if (siteId == null) continue;
    const accountId = normalizePositiveId(row.accountId);
    for (const subject of [
      { siteId, accountId },
      { siteId, accountId: null },
    ]) {
      const key = scopeKey(subject);
      if (seen.has(key)) continue;
      seen.add(key);
      subjects.push(subject);
    }
  }
  return subjects;
}

/**
 * Returns catalog subjects that are absent or close enough to expiry to refresh
 * in the next scheduler pass. This keeps provider I/O out of routing requests.
 */
export async function listDueProviderPricingCatalogRefreshSubjects(input: {
  dueWithinMs?: number;
  nowMs?: number;
} = {}): Promise<Array<{ siteId: number; accountId: number | null }>> {
  const subjects = await listProviderPricingCatalogRefreshSubjects();
  if (subjects.length === 0) return [];

  const nowMs = input.nowMs ?? Date.now();
  const dueAtMs = nowMs + Math.max(0, input.dueWithinMs ?? 0);
  const rows = await db.select({
    siteId: schema.providerPricingCatalogCaches.siteId,
    accountId: schema.providerPricingCatalogCaches.accountId,
    expiresAt: schema.providerPricingCatalogCaches.expiresAt,
  })
    .from(schema.providerPricingCatalogCaches)
    .all();
  const expiryByScope = new Map(rows.map((row) => [
    scopeKey({ siteId: Number(row.siteId), accountId: row.accountId == null ? null : Number(row.accountId) }),
    Date.parse(row.expiresAt),
  ]));

  return subjects.filter((subject) => {
    const expiresAtMs = expiryByScope.get(scopeKey(subject));
    return !Number.isFinite(expiresAtMs) || (expiresAtMs as number) <= dueAtMs;
  });
}

export async function listProviderPricingCatalogCaches(filters: {
  siteId?: number;
  accountId?: number | null;
  status?: ProviderPricingCatalogCacheStatus;
} = {}): Promise<ProviderPricingCatalogCacheRecord[]> {
  const clauses: SQL[] = [];
  const siteId = normalizePositiveId(filters.siteId);
  const accountId = normalizePositiveId(filters.accountId);
  if (siteId != null) clauses.push(eq(schema.providerPricingCatalogCaches.siteId, siteId));
  if (filters.accountId !== undefined) {
    if (accountId == null) {
      clauses.push(sql`${schema.providerPricingCatalogCaches.accountId} is null`);
    } else {
      clauses.push(eq(schema.providerPricingCatalogCaches.accountId, accountId));
    }
  }
  if (filters.status) clauses.push(eq(schema.providerPricingCatalogCaches.lastStatus, filters.status));

  const query = db.select().from(schema.providerPricingCatalogCaches);
  const rows = clauses.length > 0
    ? await query.where(and(...clauses)).all()
    : await query.all();
  return (rows as Row[]).map(rowToRecord);
}

/**
 * Lists usable catalog snapshots without ever refreshing them. Request-time
 * projections must remain local and must not issue upstream network requests.
 */
export async function listCachedProviderPricingCatalogs(): Promise<ProviderPricingCatalogCacheRecord[]> {
  const maxAgeMs = await resolveProviderPricingCatalogCacheTtlMs();
  const rows = await db.select().from(schema.providerPricingCatalogCaches).all();
  return (rows as Row[])
    .map(rowToRecord)
    .filter((record) => isFresh(record, maxAgeMs));
}
