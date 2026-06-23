export const DEFAULT_PRICING_GROUP = 'default';

export interface UpstreamPricingModel {
  modelName: string;
  quotaType: number;
  modelRatio: number;
  completionRatio: number;
  cacheRatio?: number;
  cacheCreationRatio?: number;
  modelPrice: number | { input?: number; output?: number } | null;
  enableGroups: string[];
  modelDescription?: string | null;
  tags?: string[];
  supportedEndpointTypes?: string[];
  ownerBy?: string | null;
}

export interface UpstreamPricingCatalog {
  models: Map<string, UpstreamPricingModel>;
  groupRatio: Record<string, number>;
}

export interface UpstreamPricingCredential {
  token?: string | null;
  tokenKind: 'access_token' | 'api_token' | 'site_api_key' | 'public';
  platformUserId?: number;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function toPositiveInt(value: unknown): number {
  return Math.max(0, Math.round(toNumber(value, 0)));
}

function normalizeModelPrice(value: unknown): number | { input?: number; output?: number } | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') return null;

  const input = toNumber((value as any).input, Number.NaN);
  const output = toNumber((value as any).output, Number.NaN);
  if (Number.isNaN(input) && Number.isNaN(output)) return null;

  return {
    ...(Number.isNaN(input) ? {} : { input }),
    ...(Number.isNaN(output) ? {} : { output }),
  };
}

function normalizeStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || '').trim()).filter(Boolean);
  }

  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeRatio(value: unknown, fallback: number): number {
  const ratio = toNumber(value, Number.NaN);
  if (Number.isFinite(ratio) && ratio >= 0) return ratio;
  return fallback;
}

export function normalizePricingGroupRatio(raw: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const ratio = toNumber(value, 1);
      if (ratio > 0) result[key] = ratio;
    }
  }

  if (Object.keys(result).length === 0) {
    result[DEFAULT_PRICING_GROUP] = 1;
  } else if (!(DEFAULT_PRICING_GROUP in result)) {
    result[DEFAULT_PRICING_GROUP] = 1;
  }

  return result;
}

export function normalizePricingModels(rawModels: unknown[]): Map<string, UpstreamPricingModel> {
  const models = new Map<string, UpstreamPricingModel>();

  for (const raw of rawModels) {
    if (!raw || typeof raw !== 'object') continue;

    const modelName = String((raw as any).model_name || '').trim();
    if (!modelName) continue;

    const quotaType = toPositiveInt((raw as any).quota_type);
    const modelRatio = toNumber((raw as any).model_ratio, 1);
    const completionRatio = toNumber((raw as any).completion_ratio, 1);
    const cacheRatio = normalizeRatio(
      (raw as any).cache_ratio ?? (raw as any).cacheRatio,
      1,
    );
    const cacheCreationRatio = normalizeRatio(
      (raw as any).cache_creation_ratio
        ?? (raw as any).cacheCreationRatio
        ?? (raw as any).create_cache_ratio
        ?? (raw as any).createCacheRatio,
      1,
    );
    const enableGroupsRaw = (raw as any).enable_groups;
    const enableGroups = Array.isArray(enableGroupsRaw)
      ? enableGroupsRaw.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : [DEFAULT_PRICING_GROUP];
    const modelDescriptionRaw = (raw as any).model_description;
    const modelDescription = typeof modelDescriptionRaw === 'string'
      ? (modelDescriptionRaw.trim() || null)
      : null;
    const tags = normalizeStringArray((raw as any).tags);
    const supportedEndpointTypes = normalizeStringArray((raw as any).supported_endpoint_types);
    const ownerByRaw = (raw as any).owner_by;
    const ownerBy = typeof ownerByRaw === 'string' ? (ownerByRaw.trim() || null) : null;

    models.set(modelName, {
      modelName,
      quotaType,
      modelRatio: modelRatio > 0 ? modelRatio : 1,
      completionRatio: completionRatio > 0 ? completionRatio : 1,
      cacheRatio,
      cacheCreationRatio,
      modelPrice: normalizeModelPrice((raw as any).model_price),
      enableGroups: enableGroups.length > 0 ? enableGroups : [DEFAULT_PRICING_GROUP],
      modelDescription,
      tags,
      supportedEndpointTypes,
      ownerBy,
    });
  }

  return models;
}

export function unwrapPricingPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  if ('data' in (payload as any)) return (payload as any).data;
  return payload;
}

export function normalizeCommonPricingPayload(payload: unknown): UpstreamPricingCatalog | null {
  const maybeData = unwrapPricingPayload(payload);
  if (!Array.isArray(maybeData)) return null;

  const models = normalizePricingModels(maybeData);
  if (models.size === 0) return null;

  const groupRatio = normalizePricingGroupRatio((payload as any)?.group_ratio);
  return { models, groupRatio };
}

export function normalizeOneHubPricingPayload(
  availablePayload: unknown,
  groupPayload: unknown,
): UpstreamPricingCatalog | null {
  const available = unwrapPricingPayload(availablePayload);
  if (!available || typeof available !== 'object') return null;

  const transformed: unknown[] = [];
  for (const [modelName, rawValue] of Object.entries(available as Record<string, unknown>)) {
    const item = rawValue as any;
    const price = item?.price || {};
    const input = toNumber(price.input, Number.NaN);
    const output = toNumber(price.output, Number.NaN);
    const cacheRead = toNumber(
      price.input_cache_read ?? price.inputCacheRead ?? price.cache_read ?? price.cacheRead,
      Number.NaN,
    );
    const cacheWrite = toNumber(
      price.input_cache_write ?? price.inputCacheWrite ?? price.cache_write ?? price.cacheWrite,
      Number.NaN,
    );
    const isTokenType = String(price.type || '').toLowerCase() === 'tokens';

    transformed.push({
      model_name: modelName,
      model_description: item?.description || item?.desc || '',
      quota_type: isTokenType ? 0 : 1,
      model_ratio: 1,
      completion_ratio: input > 0 && Number.isFinite(output) ? output / input : 1,
      cache_ratio: input > 0 && Number.isFinite(cacheRead) && cacheRead >= 0 ? (cacheRead / input) : 1,
      cache_creation_ratio: input > 0 && Number.isFinite(cacheWrite) && cacheWrite >= 0 ? (cacheWrite / input) : 1,
      model_price: { input, output },
      enable_groups: Array.isArray(item?.groups) && item.groups.length > 0 ? item.groups : [DEFAULT_PRICING_GROUP],
      supported_endpoint_types: Array.isArray(item?.supported_endpoint_types) ? item.supported_endpoint_types : [],
      tags: Array.isArray(item?.tags) ? item.tags : [],
      owner_by: item?.owned_by || item?.provider || null,
    });
  }

  const models = normalizePricingModels(transformed);
  if (models.size === 0) return null;

  const groupMap = unwrapPricingPayload(groupPayload);
  const groupRatioSource: Record<string, number> = {};
  if (groupMap && typeof groupMap === 'object') {
    for (const [key, group] of Object.entries(groupMap as Record<string, any>)) {
      groupRatioSource[key] = toNumber(group?.ratio ?? group, 1);
    }
  }

  const groupRatio = normalizePricingGroupRatio(groupRatioSource);
  return { models, groupRatio };
}
