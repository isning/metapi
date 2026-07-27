import type { ModelsMarketplaceModel } from "../../shared/modelsMarketplace.js";

const MODELS_MARKETPLACE_BASE_TTL_MS = 15_000;
const MODELS_MARKETPLACE_PRICING_TTL_MS = 90_000;

type ModelsMarketplaceCacheEntry = {
  expiresAt: number;
  models: ModelsMarketplaceModel[];
};

type ModelsMarketplaceCacheKey = "base" | "pricing";
type ModelsMarketplaceCacheOptions = boolean | {
  includePricing?: boolean;
};

const modelsMarketplaceCache = new Map<ModelsMarketplaceCacheKey, ModelsMarketplaceCacheEntry>();

function resolveCacheKey(options: ModelsMarketplaceCacheOptions): ModelsMarketplaceCacheKey {
  if (typeof options === "boolean") return options ? "pricing" : "base";
  if (options.includePricing) return "pricing";
  return "base";
}

export function readModelsMarketplaceCache(options: ModelsMarketplaceCacheOptions): ModelsMarketplaceModel[] | null {
  const key = resolveCacheKey(options);
  const cached = modelsMarketplaceCache.get(key);
  if (!cached) return null;
  if (Date.now() >= cached.expiresAt) {
    modelsMarketplaceCache.delete(key);
    return null;
  }
  return cached.models;
}

export function writeModelsMarketplaceCache(options: ModelsMarketplaceCacheOptions, models: ModelsMarketplaceModel[]): void {
  const key = resolveCacheKey(options);
  const ttl = key === "base"
    ? MODELS_MARKETPLACE_BASE_TTL_MS
    : MODELS_MARKETPLACE_PRICING_TTL_MS;
  modelsMarketplaceCache.set(key, {
    expiresAt: Date.now() + ttl,
    models,
  });
}

export function clearModelsMarketplaceCache(): void {
  modelsMarketplaceCache.clear();
}

export function resetModelsMarketplaceCacheForTests(): void {
  clearModelsMarketplaceCache();
}
