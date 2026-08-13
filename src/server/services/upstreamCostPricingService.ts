import { and, asc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { insertAndGetById } from '../db/insertHelpers.js';
import { db, schema } from '../db/index.js';
import {
  evaluatePricingPlan,
  normalizeCanonicalUsage,
  parsePricingPlan,
  stableSha256,
  type CanonicalUsage,
  type PricingEvaluation,
  type PricingPlan,
} from '../pricing-core/index.js';
import {
  resolveUpstreamPricingModelGroup,
  type UpstreamPricingCatalog,
  type UpstreamPricingModel,
} from './upstreamPricingCatalog.js';
import {
  getCachedProviderPricingCatalog,
  getProviderPricingCatalogCacheRecord,
  refreshProviderPricingCatalog,
} from './providerPricingCatalogCacheService.js';
import { loadPlatformPricingConfig } from './platformPricingConfigService.js';

export type UpstreamCostPricingScope = 'site_model' | 'account_model' | 'token_model';
export type UpstreamCostMatchedScope = UpstreamCostPricingScope | 'provider_catalog' | 'system_default';
export type ProviderCatalogResolveMode = 'disabled' | 'cache_only' | 'refresh';

export interface UpstreamCostPricingPayload {
  scope: UpstreamCostPricingScope;
  siteId: number;
  accountId?: number | null;
  tokenId?: number | null;
  modelName: string;
  displayName?: string | null;
  enabled?: boolean;
  plan: PricingPlan;
  sourceType?: 'user' | 'official' | 'provider_catalog' | 'system_default';
  metadata?: Record<string, unknown> | null;
  notes?: string | null;
}

export interface UpstreamCostPricingRecord extends Omit<UpstreamCostPricingPayload, 'plan' | 'metadata'> {
  id: number;
  scopeKey: string;
  normalizedModelName: string;
  enabled: boolean;
  plan: PricingPlan;
  planFingerprint: string;
  sourceType: 'user' | 'official' | 'provider_catalog' | 'system_default';
  metadata: Record<string, unknown>;
  /** Retained while upgrading databases that contain historical group records. */
  tokenGroup?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UpstreamCostResolveInput {
  siteId: number;
  accountId?: number | null;
  tokenId?: number | null;
  tokenGroup?: string | null;
  modelName: string;
  allowProviderCatalog?: boolean;
  providerCatalogMode?: ProviderCatalogResolveMode;
}

export interface UpstreamCostResolveResult {
  pricing: UpstreamCostPricingRecord;
  matchedScope: UpstreamCostMatchedScope;
  priority: number;
}

export interface UpstreamCostEvaluationInput extends UpstreamCostResolveInput {
  usage: Partial<CanonicalUsage>;
  context?: {
    provider?: string;
    serviceTier?: string;
    batch?: boolean;
    modality?: string;
    region?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface UpstreamCostEvaluationResult extends UpstreamCostResolveResult {
  evaluation: PricingEvaluation;
}

type Row = typeof schema.upstreamModelCostPricings.$inferSelect;
type CatalogContext = {
  site: {
    id: number;
    url: string;
    platform: string;
    apiKey?: string | null;
  };
  account: {
    id: number;
    username?: string | null;
    accessToken?: string | null;
    apiToken?: string | null;
    extraConfig?: string | Record<string, unknown> | null;
  };
  tokenGroup?: string | null;
};

const VALID_SCOPES = new Set<UpstreamCostPricingScope>([
  'site_model',
  'account_model',
  'token_model',
]);

export function normalizeUpstreamModelName(modelName: string): string {
  return String(modelName || '').trim().toLowerCase();
}

export function createSimpleTokenPricingPlan(input: {
  inputPerMillion?: number;
  outputPerMillion?: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
  reasoningPerMillion?: number;
  requestCost?: number;
}): PricingPlan {
  const components: PricingPlan['components'] = [];
  const pushTokenComponent = (
    id: string,
    label: string,
    kind: PricingPlan['components'][number]['kind'],
    quantityPath: string,
    amount: number | undefined,
  ) => {
    if (amount === undefined || !Number.isFinite(amount) || amount < 0) return;
    components.push({
      id,
      label,
      role: 'charge',
      kind,
      meter: { unit: 'token', quantityPath, scale: 1_000_000, missingQuantity: 'zero' },
      price: { currency: 'USD', amount, unitLabel: '1M tokens' },
    });
  };

  pushTokenComponent('input_tokens', 'Input tokens', 'input_tokens', 'usage.inputTokens', input.inputPerMillion);
  pushTokenComponent('output_tokens', 'Output tokens', 'output_tokens', 'usage.outputTokens', input.outputPerMillion);
  pushTokenComponent('cache_read_tokens', 'Cache read tokens', 'cache_read_tokens', 'usage.cacheReadTokens', input.cacheReadPerMillion);
  pushTokenComponent('cache_write_tokens', 'Cache write tokens', 'cache_write_tokens', 'usage.cacheWriteTokens', input.cacheWritePerMillion);
  pushTokenComponent('reasoning_tokens', 'Reasoning tokens', 'reasoning_tokens', 'usage.reasoningTokens', input.reasoningPerMillion);

  if (input.requestCost !== undefined && Number.isFinite(input.requestCost) && input.requestCost >= 0) {
    components.push({
      id: 'request',
      label: 'Request',
      role: 'charge',
      kind: 'request',
      meter: { unit: 'request', quantityPath: 'usage.requestCount', scale: 1, missingQuantity: 'zero' },
      price: { currency: 'USD', amount: input.requestCost, unitLabel: 'request' },
    });
  }

  if (components.length === 0) {
    throw new Error('At least one pricing component is required.');
  }

  return {
    schemaVersion: 1,
    planKind: 'rate_card',
    unitPrecision: 'mixed',
    billingMode: 'mixed',
    aggregation: { mode: 'sum_components', period: 'request' },
    rounding: { mode: 'total', precision: 12 },
    components,
    tiers: [],
  };
}

export function normalizeUpstreamCostPricingPayload(input: UpstreamCostPricingPayload): UpstreamCostPricingPayload & {
  scopeKey: string;
  normalizedModelName: string;
  planFingerprint: string;
  metadata: Record<string, unknown>;
  enabled: boolean;
  sourceType: 'user' | 'official' | 'provider_catalog' | 'system_default';
} {
  const scope = input.scope;
  if (!VALID_SCOPES.has(scope)) {
    throw new Error('Invalid upstream cost pricing scope.');
  }

  const siteId = normalizePositiveId(input.siteId, 'siteId');
  const accountId = input.accountId == null ? null : normalizePositiveId(input.accountId, 'accountId');
  const tokenId = input.tokenId == null ? null : normalizePositiveId(input.tokenId, 'tokenId');
  const modelName = String(input.modelName || '').trim();
  const normalizedModelName = normalizeUpstreamModelName(modelName);
  if (!normalizedModelName) {
    throw new Error('modelName is required.');
  }

  if (scope === 'site_model' && (accountId != null || tokenId != null)) {
    throw new Error('site_model scope cannot include accountId or tokenId.');
  }
  if (scope === 'account_model' && (accountId == null || tokenId != null)) {
    throw new Error('account_model scope requires accountId only.');
  }
  if (scope === 'token_model' && (accountId == null || tokenId == null)) {
    throw new Error('token_model scope requires accountId and tokenId.');
  }

  const parsedPlan = parsePricingPlan(input.plan);
  if (!parsedPlan.success) {
    throw new Error(parsedPlan.error);
  }

  const scopeKey = buildUpstreamCostPricingScopeKey({
    scope,
    siteId,
    accountId,
    tokenId,
    normalizedModelName,
  });

  return {
    ...input,
    scopeKey,
    siteId,
    accountId,
    tokenId,
    modelName,
    normalizedModelName,
    displayName: normalizeOptionalText(input.displayName, 160),
    enabled: input.enabled ?? true,
    plan: parsedPlan.data,
    planFingerprint: stableSha256(parsedPlan.data),
    sourceType: input.sourceType || 'user',
    metadata: normalizeMetadata(input.metadata),
    notes: normalizeOptionalText(input.notes, 2000),
  };
}

export function buildUpstreamCostPricingScopeKey(input: {
  scope: UpstreamCostPricingScope;
  siteId: number;
  accountId: number | null;
  tokenId: number | null;
  normalizedModelName: string;
}): string {
  return [
    input.scope,
    `site:${input.siteId}`,
    `account:${input.accountId ?? '-'}`,
    `token:${input.tokenId ?? '-'}`,
    'group:-',
    `model:${input.normalizedModelName}`,
  ].join('|');
}

export async function listUpstreamCostPricings(filters: {
  siteId?: number;
  accountId?: number;
  tokenId?: number;
  modelName?: string;
  enabled?: boolean;
  includeSiteScope?: boolean;
} = {}): Promise<UpstreamCostPricingRecord[]> {
  const clauses: SQL[] = [];
  if (filters.siteId != null) clauses.push(eq(schema.upstreamModelCostPricings.siteId, normalizePositiveId(filters.siteId, 'siteId')));
  if (filters.accountId != null) {
    const accountId = normalizePositiveId(filters.accountId, 'accountId');
    const accountClause = filters.includeSiteScope
      ? or(
        eq(schema.upstreamModelCostPricings.accountId, accountId),
        and(isNull(schema.upstreamModelCostPricings.accountId), isNull(schema.upstreamModelCostPricings.tokenId)),
      )
      : eq(schema.upstreamModelCostPricings.accountId, accountId);
    if (accountClause) clauses.push(accountClause);
  }
  if (filters.tokenId != null) clauses.push(eq(schema.upstreamModelCostPricings.tokenId, normalizePositiveId(filters.tokenId, 'tokenId')));
  if (filters.modelName) clauses.push(eq(schema.upstreamModelCostPricings.normalizedModelName, normalizeUpstreamModelName(filters.modelName)));
  if (filters.enabled != null) clauses.push(eq(schema.upstreamModelCostPricings.enabled, filters.enabled));

  const query = db.select().from(schema.upstreamModelCostPricings);
  const rows = clauses.length > 0
    ? await query.where(and(...clauses)).orderBy(asc(schema.upstreamModelCostPricings.scope), asc(schema.upstreamModelCostPricings.modelName)).all()
    : await query.orderBy(asc(schema.upstreamModelCostPricings.scope), asc(schema.upstreamModelCostPricings.modelName)).all();
  return rows.map(rowToRecord);
}

export async function createUpstreamCostPricing(input: UpstreamCostPricingPayload): Promise<UpstreamCostPricingRecord> {
  const normalized = normalizeUpstreamCostPricingPayload(input);
  await assertUpstreamCostPricingOwnership(normalized);
  const result = await insertAndGetById<Row>({
    table: schema.upstreamModelCostPricings,
    idColumn: schema.upstreamModelCostPricings.id,
    values: toInsertValues(normalized),
    insertErrorMessage: 'Failed to create upstream cost pricing.',
  });
  return rowToRecord(result);
}

export async function updateUpstreamCostPricing(id: number, input: Partial<UpstreamCostPricingPayload>): Promise<UpstreamCostPricingRecord | null> {
  const existing = await getUpstreamCostPricing(id);
  if (!existing) return null;
  const normalized = normalizeUpstreamCostPricingPayload({
    scope: input.scope ?? existing.scope,
    siteId: input.siteId ?? existing.siteId,
    accountId: input.accountId !== undefined ? input.accountId : existing.accountId,
    tokenId: input.tokenId !== undefined ? input.tokenId : existing.tokenId,
    modelName: input.modelName ?? existing.modelName,
    displayName: input.displayName !== undefined ? input.displayName : existing.displayName,
    enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
    plan: input.plan ?? existing.plan,
    sourceType: input.sourceType ?? existing.sourceType,
    metadata: input.metadata !== undefined ? input.metadata : existing.metadata,
    notes: input.notes !== undefined ? input.notes : existing.notes,
  });
  await assertUpstreamCostPricingOwnership(normalized);

  await db.update(schema.upstreamModelCostPricings)
    .set({
      ...toInsertValues(normalized),
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(schema.upstreamModelCostPricings.id, normalizePositiveId(id, 'id')))
    .run();
  return await getUpstreamCostPricing(id);
}

export async function deleteUpstreamCostPricing(id: number): Promise<boolean> {
  const existing = await getUpstreamCostPricing(id);
  if (!existing) return false;
  await db.delete(schema.upstreamModelCostPricings)
    .where(eq(schema.upstreamModelCostPricings.id, normalizePositiveId(id, 'id')))
    .run();
  return true;
}

export async function getUpstreamCostPricing(id: number): Promise<UpstreamCostPricingRecord | null> {
  const row = await db.select().from(schema.upstreamModelCostPricings)
    .where(eq(schema.upstreamModelCostPricings.id, normalizePositiveId(id, 'id')))
    .get();
  return row ? rowToRecord(row) : null;
}

export async function resolveUpstreamCostPricing(input: UpstreamCostResolveInput): Promise<UpstreamCostResolveResult | null> {
  const modelName = normalizeUpstreamModelName(input.modelName);
  if (!modelName) return null;
  const candidates = await db.select().from(schema.upstreamModelCostPricings)
    .where(and(
      eq(schema.upstreamModelCostPricings.siteId, normalizePositiveId(input.siteId, 'siteId')),
      eq(schema.upstreamModelCostPricings.normalizedModelName, modelName),
      eq(schema.upstreamModelCostPricings.enabled, true),
    ))
    .all();

  const ranked = candidates
    .map((row) => ({ row, priority: matchPriority(row, input) }))
    .filter((candidate) => candidate.priority > 0)
    .sort((a, b) => b.priority - a.priority);

  const match = ranked[0];
  if (match) {
    return {
      pricing: rowToRecord(match.row),
      matchedScope: match.row.scope as UpstreamCostPricingScope,
      priority: match.priority,
    };
  }

  const providerCatalogPricing = input.allowProviderCatalog === false || input.providerCatalogMode === 'disabled'
    ? null
    : await resolveProviderCatalogCostPricing(input);
  return providerCatalogPricing ?? await resolveDefaultUpstreamCostPricing(input);
}

export async function evaluateUpstreamCostPricing(input: UpstreamCostEvaluationInput): Promise<UpstreamCostEvaluationResult | null> {
  const resolved = await resolveUpstreamCostPricing(input);
  if (!resolved) return null;
  const usage = normalizeCanonicalUsage(input.usage);
  const evaluation = evaluatePricingPlan({
    plan: resolved.pricing.plan,
    usage,
    source: resolved.pricing.sourceType === 'provider_catalog'
      ? 'upstream_catalog'
      : (resolved.pricing.sourceType === 'system_default' ? 'default' : 'user_override'),
    context: {
      model: input.modelName,
      provider: input.context?.provider,
      serviceTier: input.context?.serviceTier,
      batch: input.context?.batch,
      modality: input.context?.modality,
      region: input.context?.region,
      metadata: {
        ...(input.context?.metadata || {}),
        upstreamCostPricingId: resolved.pricing.id > 0 ? resolved.pricing.id : null,
        upstreamCostPricingScope: resolved.pricing.scope,
        upstreamCostPricingMatchedScope: resolved.matchedScope,
        upstreamCostPricingSourceType: resolved.pricing.sourceType,
      },
    },
  });
  return { ...resolved, evaluation };
}

export async function shouldUseProviderCatalogPricing(): Promise<boolean> {
  return true;
}

async function resolveProviderCatalogCostPricing(
  input: UpstreamCostResolveInput,
): Promise<UpstreamCostResolveResult | null> {
  if (!await shouldUseProviderCatalogPricing()) return null;

  const context = await loadProviderCatalogContext(input);
  if (!context) return null;
  const catalogScope = {
    siteId: context.site.id,
    accountId: context.account.id > 0 ? context.account.id : null,
  };

  let catalogRecord = await getCachedProviderPricingCatalog(catalogScope);

  if (!catalogRecord?.catalog) {
    const existing = await getProviderPricingCatalogCacheRecord(catalogScope);
    if (input.providerCatalogMode === 'refresh') {
      const refreshed = await refreshProviderPricingCatalog({
        ...catalogScope,
        reason: 'upstream-cost-resolution',
      });
      catalogRecord = refreshed.status === 'success' ? refreshed.record : null;
    }

    // Runtime routing must not perform upstream I/O. A periodic refresh keeps the
    // catalog current; if that refresh is late or temporarily fails, continue
    // pricing from the last successful catalog rather than dropping its cost.
    catalogRecord ??= existing?.catalog ? existing : null;
  }

  const catalog = catalogRecord?.catalog;
  if (!catalog || !catalogRecord) return null;
  const resolvedCatalogRecord = catalogRecord;

  const normalizedModelName = normalizeUpstreamModelName(input.modelName);
  const model = findCatalogModel(catalog, normalizedModelName);
  if (!model) return null;

  const resolvedGroup = resolveUpstreamPricingModelGroup({
    model,
    groupRatio: catalog.groupRatio,
    preferredGroup: input.tokenGroup || context.tokenGroup,
  });
  const plan = buildProviderCatalogPricingPlan(resolvedGroup);
  if (!plan) return null;

  const pricing: UpstreamCostPricingRecord = {
    id: 0,
    scope: input.accountId ? 'account_model' : 'site_model',
    scopeKey: [
      'provider_catalog',
      `site:${input.siteId}`,
      `account:${input.accountId ?? '-'}`,
      `token:${input.tokenId ?? '-'}`,
      `group:${resolvedGroup.group}`,
      `model:${normalizedModelName}`,
    ].join('|'),
    siteId: input.siteId,
    accountId: input.accountId ?? null,
    tokenId: input.tokenId ?? null,
    tokenGroup: resolvedGroup.group === 'default' ? null : resolvedGroup.group,
    modelName: model.modelName,
    normalizedModelName,
    displayName: model.modelName,
    enabled: true,
    plan,
    planFingerprint: stableSha256(plan),
    sourceType: 'provider_catalog',
    metadata: {
      source: 'provider_catalog',
      catalogModelName: model.modelName,
      group: resolvedGroup.group,
      ownerBy: model.ownerBy ?? null,
      quotaType: model.quotaType,
      cacheId: resolvedCatalogRecord.id,
      cacheFingerprint: resolvedCatalogRecord.catalogFingerprint,
      cacheFetchedAt: resolvedCatalogRecord.fetchedAt,
      cacheExpiresAt: resolvedCatalogRecord.expiresAt,
      cacheCredentialKind: resolvedCatalogRecord.credentialKind,
    },
    notes: null,
    createdAt: null,
    updatedAt: null,
  };

  return {
    pricing,
    matchedScope: 'provider_catalog',
    priority: 10,
  };
}

async function resolveDefaultUpstreamCostPricing(
  input: UpstreamCostResolveInput,
): Promise<UpstreamCostResolveResult | null> {
  const normalizedModelName = normalizeUpstreamModelName(input.modelName);
  if (!normalizedModelName) return null;
  const config = await loadPlatformPricingConfig();
  const plan = createSimpleTokenPricingPlan({
    inputPerMillion: config.upstreamDefaultPricing.inputPerMillion,
    outputPerMillion: config.upstreamDefaultPricing.outputPerMillion,
    cacheReadPerMillion: config.upstreamDefaultPricing.cacheReadPerMillion ?? undefined,
    cacheWritePerMillion: config.upstreamDefaultPricing.cacheWritePerMillion ?? undefined,
    reasoningPerMillion: config.upstreamDefaultPricing.reasoningPerMillion ?? undefined,
    requestCost: config.upstreamDefaultPricing.requestCost ?? undefined,
  });
  const pricing: UpstreamCostPricingRecord = {
    id: 0,
    scope: input.accountId ? 'account_model' : 'site_model',
    scopeKey: [
      'system_default',
      `site:${input.siteId}`,
      `account:${input.accountId ?? '-'}`,
      `token:${input.tokenId ?? '-'}`,
      `group:${input.tokenGroup || '-'}`,
      `model:${normalizedModelName}`,
    ].join('|'),
    siteId: input.siteId,
    accountId: input.accountId ?? null,
    tokenId: input.tokenId ?? null,
    tokenGroup: input.tokenGroup ?? null,
    modelName: input.modelName,
    normalizedModelName,
    displayName: input.modelName,
    enabled: true,
    plan,
    planFingerprint: stableSha256(plan),
    sourceType: 'system_default',
    metadata: {
      source: 'system_default',
      baseCostUnit: config.baseCostUnit,
    },
    notes: null,
    createdAt: null,
    updatedAt: null,
  };

  return {
    pricing,
    matchedScope: 'system_default',
    priority: 1,
  };
}

async function loadProviderCatalogContext(input: UpstreamCostResolveInput): Promise<CatalogContext | null> {
  const accountId = input.accountId ?? null;
  if (accountId == null) {
    const site = await db.select({
      id: schema.sites.id,
      url: schema.sites.url,
      platform: schema.sites.platform,
      apiKey: schema.sites.apiKey,
    })
      .from(schema.sites)
      .where(eq(schema.sites.id, normalizePositiveId(input.siteId, 'siteId')))
      .get();
    if (!site) return null;
    return {
      site,
      account: { id: 0 },
      tokenGroup: input.tokenGroup ?? null,
    };
  }

  const rows = await db.select({
    siteId: schema.sites.id,
    siteUrl: schema.sites.url,
    sitePlatform: schema.sites.platform,
    siteApiKey: schema.sites.apiKey,
    accountId: schema.accounts.id,
    accountUsername: schema.accounts.username,
    accountAccessToken: schema.accounts.accessToken,
    accountApiToken: schema.accounts.apiToken,
    accountExtraConfig: schema.accounts.extraConfig,
    tokenGroup: schema.accountTokens.tokenGroup,
  })
    .from(schema.accounts)
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .leftJoin(schema.accountTokens, and(
      eq(schema.accountTokens.id, input.tokenId ?? -1),
      eq(schema.accountTokens.accountId, schema.accounts.id),
    ))
    .where(and(
      eq(schema.accounts.id, normalizePositiveId(accountId, 'accountId')),
      eq(schema.sites.id, normalizePositiveId(input.siteId, 'siteId')),
    ))
    .all();

  const row = rows[0];
  if (!row) return null;
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
      accessToken: row.accountAccessToken,
      apiToken: row.accountApiToken,
      extraConfig: row.accountExtraConfig,
    },
    tokenGroup: input.tokenGroup ?? row.tokenGroup ?? null,
  };
}

function findCatalogModel(catalog: UpstreamPricingCatalog, normalizedModelName: string): UpstreamPricingModel | null {
  for (const model of catalog.models.values()) {
    if (normalizeUpstreamModelName(model.modelName) === normalizedModelName) return model;
  }
  return null;
}

function buildProviderCatalogPricingPlan(
  resolved: ReturnType<typeof resolveUpstreamPricingModelGroup>,
): PricingPlan | null {
  const { model: modelForGroup, multiplier } = resolved;
  if (modelForGroup.quotaType === 1) {
    const requestCost = providerCatalogPerCallPrice(modelForGroup, multiplier);
    if (requestCost == null) return null;
    return createSimpleTokenPricingPlan({ requestCost });
  }

  const direct = providerCatalogDirectTokenPrices(modelForGroup, multiplier);
  return createSimpleTokenPricingPlan({
    inputPerMillion: direct.inputPerMillion,
    outputPerMillion: direct.outputPerMillion,
    ...(direct.cacheReadPerMillion == null ? {} : { cacheReadPerMillion: direct.cacheReadPerMillion }),
    ...(direct.cacheWritePerMillion == null ? {} : { cacheWritePerMillion: direct.cacheWritePerMillion }),
  });
}

function providerCatalogDirectTokenPrices(model: UpstreamPricingModel, multiplier: number) {
  const price = model.modelPrice;
  const hasDirectPrice = price && typeof price === 'object';
  const input = hasDirectPrice
    ? (price.input == null ? undefined : Number(price.input) * multiplier)
    : model.modelRatio * 2 * multiplier;
  const output = hasDirectPrice
    ? (price.output == null ? undefined : Number(price.output) * multiplier)
    : model.modelRatio * model.completionRatio * 2 * multiplier;
  const cacheRead = hasDirectPrice
    ? (price.cacheRead == null ? undefined : Number(price.cacheRead) * multiplier)
    : (model.cacheRatio == null ? undefined : model.modelRatio * model.cacheRatio * 2 * multiplier);
  const cacheWrite = hasDirectPrice
    ? (price.cacheWrite == null ? undefined : Number(price.cacheWrite) * multiplier)
    : (model.cacheCreationRatio == null ? undefined : model.modelRatio * model.cacheCreationRatio * 2 * multiplier);

  return {
    inputPerMillion: sanitizeNonNegative(input),
    outputPerMillion: sanitizeNonNegative(output),
    cacheReadPerMillion: sanitizeNonNegative(cacheRead),
    cacheWritePerMillion: sanitizeNonNegative(cacheWrite),
  };
}

function providerCatalogPerCallPrice(model: UpstreamPricingModel, multiplier: number): number | null {
  if (typeof model.modelPrice === 'number') return sanitizeNonNegative(model.modelPrice * multiplier) ?? null;
  if (model.modelPrice && typeof model.modelPrice === 'object') {
    if (model.modelPrice.input == null) return null;
    return sanitizeNonNegative(Number(model.modelPrice.input) * multiplier * 0.002) ?? null;
  }
  return null;
}

function sanitizeNonNegative(value: unknown): number | undefined {
  if (value == null) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.round(numeric * 1_000_000_000_000) / 1_000_000_000_000;
}

function matchPriority(row: Row, input: UpstreamCostResolveInput): number {
  const scope = String(row.scope);
  const accountId = input.accountId ?? null;
  const tokenId = input.tokenId ?? null;
  if (scope === 'token_model') {
    return tokenId != null
      && row.tokenId === tokenId
      && row.accountId === accountId
      && row.tokenGroup == null
      ? 300
      : 0;
  }
  // Historical group-scoped bindings were bound to one token and therefore
  // have the same effective scope as token_model in the current model.
  if (scope === 'token_model_group') {
    return tokenId != null
      && row.tokenId === tokenId
      && row.accountId === accountId
      ? 250
      : 0;
  }
  if (scope === 'account_model') {
    return accountId != null
      && row.accountId === accountId
      && row.tokenId == null
      && row.tokenGroup == null
      ? 200
      : 0;
  }
  if (scope === 'site_model') {
    return row.accountId == null && row.tokenId == null && row.tokenGroup == null ? 100 : 0;
  }
  return 0;
}

async function assertUpstreamCostPricingOwnership(input: Pick<
  UpstreamCostPricingPayload,
  'scope' | 'siteId' | 'accountId' | 'tokenId'
>): Promise<void> {
  if (input.accountId == null) return;

  const account = await db.select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, input.accountId), eq(schema.accounts.siteId, input.siteId)))
    .get();
  if (!account) {
    throw new Error('Account does not belong to the specified site.');
  }

  if (input.tokenId == null) return;
  const token = await db.select({ id: schema.accountTokens.id })
    .from(schema.accountTokens)
    .where(and(eq(schema.accountTokens.id, input.tokenId), eq(schema.accountTokens.accountId, input.accountId)))
    .get();
  if (!token) {
    throw new Error('Token does not belong to the specified account.');
  }
}

function toInsertValues(input: ReturnType<typeof normalizeUpstreamCostPricingPayload>) {
  return {
    scope: input.scope,
    scopeKey: input.scopeKey,
    siteId: input.siteId,
    accountId: input.accountId,
    tokenId: input.tokenId,
    tokenGroup: null,
    modelName: input.modelName,
    normalizedModelName: input.normalizedModelName,
    displayName: input.displayName,
    enabled: input.enabled,
    planJson: JSON.stringify(input.plan),
    planFingerprint: input.planFingerprint,
    sourceType: input.sourceType,
    metadataJson: JSON.stringify(input.metadata),
    notes: input.notes,
  };
}

function rowToRecord(row: Row): UpstreamCostPricingRecord {
  return {
    id: Number(row.id),
    scope: row.scope as UpstreamCostPricingScope,
    scopeKey: row.scopeKey,
    siteId: Number(row.siteId),
    accountId: row.accountId == null ? null : Number(row.accountId),
    tokenId: row.tokenId == null ? null : Number(row.tokenId),
    tokenGroup: row.tokenGroup,
    modelName: row.modelName,
    normalizedModelName: row.normalizedModelName,
    displayName: row.displayName,
    enabled: row.enabled ?? true,
    plan: parseJson(row.planJson, {}) as unknown as PricingPlan,
    planFingerprint: row.planFingerprint,
    sourceType: (row.sourceType || 'user') as UpstreamCostPricingRecord['sourceType'],
    metadata: parseJson(row.metadataJson, {}),
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizePositiveId(value: unknown, label: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return Math.trunc(numeric);
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseJson(value: string | null, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}
