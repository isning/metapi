import { asc, eq } from 'drizzle-orm';
import type { RequestInit as UndiciRequestInit } from 'undici';
import { db, schema } from '../db/index.js';
import { withSiteProxyRequestInit } from './siteProxy.js';

export type ModelCatalogSourceRow = typeof schema.modelCatalogSources.$inferSelect;
export type ModelCatalogParser =
  | 'openai_models'
  | 'anthropic_models'
  | 'gemini_models'
  | 'newapi_models'
  | 'custom_json';

export type ModelCatalogDiscoveryResult = {
  models: string[];
  latencyMs: number | null;
  sourceIds: number[];
  failures: string[];
};

function normalizeSiteUrl(value: unknown): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function defaultCatalogUrlForSite(site: Pick<typeof schema.sites.$inferSelect, 'url'>): string | null {
  const siteUrl = normalizeSiteUrl(site.url);
  if (!siteUrl) return null;
  try {
    const parsed = new URL(siteUrl);
    if (parsed.hostname === 'api.deepseek.com') {
      return `${parsed.protocol}//${parsed.host}/models`;
    }
  } catch {
    return null;
  }
  if (/\/v\d+(?:\.\d+)?(?:beta)?$/i.test(siteUrl)) {
    return `${siteUrl}/models`;
  }
  return `${siteUrl}/v1/models`;
}

export async function ensureDefaultModelCatalogSourcesForSite(siteId: number): Promise<ModelCatalogSourceRow[]> {
  const existing = await db.select().from(schema.modelCatalogSources)
    .where(eq(schema.modelCatalogSources.siteId, siteId))
    .orderBy(asc(schema.modelCatalogSources.id))
    .all();
  if (existing.length > 0) return existing;

  const site = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).get();
  if (!site) return [];
  const discoveryUrl = defaultCatalogUrlForSite(site);
  if (!discoveryUrl) return [];

  await db.insert(schema.modelCatalogSources).values({
    siteId,
    sourceKey: 'default-model-catalog',
    label: 'Model catalog',
    discoveryMethod: 'GET',
    discoveryUrl,
    parser: 'openai_models',
    credentialScope: 'credential',
    enabled: true,
  }).run();

  return db.select().from(schema.modelCatalogSources)
    .where(eq(schema.modelCatalogSources.siteId, siteId))
    .orderBy(asc(schema.modelCatalogSources.id))
    .all();
}

function normalizeParser(value: unknown): ModelCatalogParser {
  if (
    value === 'openai_models'
    || value === 'anthropic_models'
    || value === 'gemini_models'
    || value === 'newapi_models'
    || value === 'custom_json'
  ) {
    return value;
  }
  return 'openai_models';
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function readPath(payload: unknown, path: unknown): unknown {
  if (typeof path !== 'string' || !path.trim()) return undefined;
  let cursor = payload;
  for (const segment of path.split('.').map((part) => part.trim()).filter(Boolean)) {
    if (cursor && typeof cursor === 'object' && !Array.isArray(cursor)) {
      cursor = (cursor as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return cursor;
}

function candidateRowsForParser(parser: ModelCatalogParser, payload: unknown, metadata?: Record<string, unknown>): unknown[] {
  if (parser === 'custom_json') {
    const customRows = readPath(payload, metadata?.modelPath);
    if (Array.isArray(customRows)) return customRows;
  }

  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  if (parser === 'gemini_models') {
    return Array.isArray(record.models) ? record.models : [];
  }
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.models)) return record.models;
  if (Array.isArray(record.results)) return record.results;
  return [];
}

function modelNameFromRow(row: unknown, parser: ModelCatalogParser): string | null {
  if (typeof row === 'string') return row.trim() || null;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  const raw = record.id ?? record.name ?? record.model;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (parser === 'gemini_models') {
    return trimmed.replace(/^models\//, '');
  }
  return trimmed;
}

export function parseModelCatalogPayload(input: {
  parser: unknown;
  payload: unknown;
  metadataJson?: string | null;
}): string[] {
  const parser = normalizeParser(input.parser);
  const metadata = parseJsonRecord(input.metadataJson);
  const rows = candidateRowsForParser(parser, input.payload, metadata);
  const seen = new Set<string>();
  const models: string[] = [];
  for (const row of rows) {
    const modelName = modelNameFromRow(row, parser);
    if (!modelName) continue;
    const key = modelName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    models.push(modelName);
  }
  return models;
}

function buildCatalogHeaders(input: {
  source: ModelCatalogSourceRow;
  credential: string;
  siteApiKey?: string | null;
}): Record<string, string> {
  const metadata = parseJsonRecord(input.source.metadataJson);
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (metadata?.headers && typeof metadata.headers === 'object' && !Array.isArray(metadata.headers)) {
    for (const [name, value] of Object.entries(metadata.headers as Record<string, unknown>)) {
      if (typeof value === 'string' && name.trim()) headers[name.trim()] = value;
    }
  }

  const scope = input.source.credentialScope || 'credential';
  const credential = scope === 'site'
    ? String(input.siteApiKey || '').trim()
    : scope === 'credential'
      ? input.credential
      : '';
  if (credential && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${credential}`;
  }
  return headers;
}

async function fetchCatalogSource(input: {
  source: ModelCatalogSourceRow;
  credential: string;
  siteApiKey?: string | null;
}): Promise<string[]> {
  const url = String(input.source.discoveryUrl || '').trim();
  if (!url) return [];
  const metadata = parseJsonRecord(input.source.metadataJson);
  const method = String(input.source.discoveryMethod || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
  const init: UndiciRequestInit = {
    method,
    headers: buildCatalogHeaders(input),
  };
  if (method === 'POST' && metadata?.requestBody !== undefined) {
    init.body = JSON.stringify(metadata.requestBody);
    init.headers = {
      'Content-Type': 'application/json',
      ...init.headers,
    };
  }

  const { fetch } = await import('undici');
  const proxiedInit = await withSiteProxyRequestInit(url, init);
  const response = await fetch(url, proxiedInit);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json();
  return parseModelCatalogPayload({
    parser: input.source.parser,
    payload,
    metadataJson: input.source.metadataJson,
  });
}

export async function discoverModelsFromCatalogSources(input: {
  site: Pick<typeof schema.sites.$inferSelect, 'id' | 'apiKey'>;
  credential: string;
  sources?: ModelCatalogSourceRow[];
}): Promise<ModelCatalogDiscoveryResult> {
  const sources = (input.sources || await ensureDefaultModelCatalogSourcesForSite(input.site.id))
    .filter((source) => source.enabled !== false)
    .filter((source) => String(source.discoveryMethod || '').toLowerCase() !== 'none')
    .filter((source) => String(source.discoveryMethod || '').toLowerCase() !== 'manual');

  const seen = new Set<string>();
  const models: string[] = [];
  const sourceIds: number[] = [];
  const failures: string[] = [];
  let bestLatency: number | null = null;

  for (const source of sources) {
    const startedAt = Date.now();
    try {
      const sourceModels = await fetchCatalogSource({
        source,
        credential: input.credential,
        siteApiKey: input.site.apiKey,
      });
      const latencyMs = Date.now() - startedAt;
      await db.update(schema.modelCatalogSources)
        .set({
          lastRefreshAt: new Date().toISOString(),
          lastModelCount: sourceModels.length,
          lastError: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.modelCatalogSources.id, source.id))
        .run();
      if (sourceModels.length === 0) continue;
      sourceIds.push(source.id);
      bestLatency = bestLatency === null ? latencyMs : Math.min(bestLatency, latencyMs);
      for (const modelName of sourceModels) {
        const key = modelName.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        models.push(modelName);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'model catalog refresh failed');
      failures.push(`${source.label || source.sourceKey}: ${message}`);
      await db.update(schema.modelCatalogSources)
        .set({
          lastRefreshAt: new Date().toISOString(),
          lastModelCount: 0,
          lastError: message,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.modelCatalogSources.id, source.id))
        .run();
    }
  }

  return {
    models,
    latencyMs: bestLatency,
    sourceIds,
    failures,
  };
}
