import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
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

export type UpstreamCostPricingScope = 'site_model' | 'account_model' | 'token_model' | 'token_model_group';

export interface UpstreamCostPricingPayload {
  scope: UpstreamCostPricingScope;
  siteId: number;
  accountId?: number | null;
  tokenId?: number | null;
  tokenGroup?: string | null;
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
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UpstreamCostResolveInput {
  siteId: number;
  accountId?: number | null;
  tokenId?: number | null;
  tokenGroup?: string | null;
  modelName: string;
}

export interface UpstreamCostResolveResult {
  pricing: UpstreamCostPricingRecord;
  matchedScope: UpstreamCostPricingScope;
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

const VALID_SCOPES = new Set<UpstreamCostPricingScope>([
  'site_model',
  'account_model',
  'token_model',
  'token_model_group',
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
  requestUsd?: number;
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

  if (input.requestUsd !== undefined && Number.isFinite(input.requestUsd) && input.requestUsd >= 0) {
    components.push({
      id: 'request',
      label: 'Request',
      role: 'charge',
      kind: 'request',
      meter: { unit: 'request', quantityPath: 'usage.requestCount', scale: 1, missingQuantity: 'zero' },
      price: { currency: 'USD', amount: input.requestUsd, unitLabel: 'request' },
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
  const tokenGroup = normalizeOptionalText(input.tokenGroup, 128);
  const modelName = String(input.modelName || '').trim();
  const normalizedModelName = normalizeUpstreamModelName(modelName);
  if (!normalizedModelName) {
    throw new Error('modelName is required.');
  }

  if (scope === 'site_model' && (accountId != null || tokenId != null || tokenGroup != null)) {
    throw new Error('site_model scope cannot include accountId, tokenId, or tokenGroup.');
  }
  if (scope === 'account_model' && (accountId == null || tokenId != null || tokenGroup != null)) {
    throw new Error('account_model scope requires accountId only.');
  }
  if (scope === 'token_model' && (accountId == null || tokenId == null || tokenGroup != null)) {
    throw new Error('token_model scope requires accountId and tokenId.');
  }
  if (scope === 'token_model_group' && (accountId == null || tokenId == null || !tokenGroup)) {
    throw new Error('token_model_group scope requires accountId, tokenId, and tokenGroup.');
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
    tokenGroup,
    normalizedModelName,
  });

  return {
    ...input,
    scopeKey,
    siteId,
    accountId,
    tokenId,
    tokenGroup,
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
  tokenGroup: string | null;
  normalizedModelName: string;
}): string {
  return [
    input.scope,
    `site:${input.siteId}`,
    `account:${input.accountId ?? '-'}`,
    `token:${input.tokenId ?? '-'}`,
    `group:${input.tokenGroup || '-'}`,
    `model:${input.normalizedModelName}`,
  ].join('|');
}

export async function listUpstreamCostPricings(filters: {
  siteId?: number;
  accountId?: number;
  tokenId?: number;
  modelName?: string;
  enabled?: boolean;
} = {}): Promise<UpstreamCostPricingRecord[]> {
  const clauses: SQL[] = [];
  if (filters.siteId != null) clauses.push(eq(schema.upstreamModelCostPricings.siteId, normalizePositiveId(filters.siteId, 'siteId')));
  if (filters.accountId != null) clauses.push(eq(schema.upstreamModelCostPricings.accountId, normalizePositiveId(filters.accountId, 'accountId')));
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
    tokenGroup: input.tokenGroup !== undefined ? input.tokenGroup : existing.tokenGroup,
    modelName: input.modelName ?? existing.modelName,
    displayName: input.displayName !== undefined ? input.displayName : existing.displayName,
    enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
    plan: input.plan ?? existing.plan,
    sourceType: input.sourceType ?? existing.sourceType,
    metadata: input.metadata !== undefined ? input.metadata : existing.metadata,
    notes: input.notes !== undefined ? input.notes : existing.notes,
  });

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
  if (!match) return null;
  return {
    pricing: rowToRecord(match.row),
    matchedScope: match.row.scope as UpstreamCostPricingScope,
    priority: match.priority,
  };
}

export async function evaluateUpstreamCostPricing(input: UpstreamCostEvaluationInput): Promise<UpstreamCostEvaluationResult | null> {
  const resolved = await resolveUpstreamCostPricing(input);
  if (!resolved) return null;
  const usage = normalizeCanonicalUsage(input.usage);
  const evaluation = evaluatePricingPlan({
    plan: resolved.pricing.plan,
    usage,
    source: 'user_override',
    context: {
      model: input.modelName,
      provider: input.context?.provider,
      serviceTier: input.context?.serviceTier,
      batch: input.context?.batch,
      modality: input.context?.modality,
      region: input.context?.region,
      metadata: {
        ...(input.context?.metadata || {}),
        upstreamCostPricingId: resolved.pricing.id,
        upstreamCostPricingScope: resolved.pricing.scope,
      },
    },
  });
  return { ...resolved, evaluation };
}

function matchPriority(row: Row, input: UpstreamCostResolveInput): number {
  const scope = row.scope as UpstreamCostPricingScope;
  const accountId = input.accountId ?? null;
  const tokenId = input.tokenId ?? null;
  const tokenGroup = normalizeOptionalText(input.tokenGroup, 128);

  if (scope === 'token_model_group') {
    return tokenId != null
      && row.tokenId === tokenId
      && row.accountId === accountId
      && row.tokenGroup === tokenGroup
      ? 400
      : 0;
  }
  if (scope === 'token_model') {
    return tokenId != null
      && row.tokenId === tokenId
      && row.accountId === accountId
      && row.tokenGroup == null
      ? 300
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

function toInsertValues(input: ReturnType<typeof normalizeUpstreamCostPricingPayload>) {
  return {
    scope: input.scope,
    scopeKey: input.scopeKey,
    siteId: input.siteId,
    accountId: input.accountId,
    tokenId: input.tokenId,
    tokenGroup: input.tokenGroup,
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
