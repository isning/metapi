import { getBrand } from "../shared/modelBrand.js";
import type {
  ModelsMarketplaceAccount,
  ModelsMarketplaceMeta,
  ModelsMarketplaceModel,
  ModelsMarketplaceResponse,
} from "../../shared/modelsMarketplace.js";

const MODELS_MARKETPLACE_DEFAULT_PAGE_SIZE = 50;
const MODELS_MARKETPLACE_MAX_PAGE_SIZE = 500;

type ModelsMarketplaceSortColumn =
  | "name"
  | "accountCount"
  | "credentialCount"
  | "avgLatency"
  | "successRate";

export type ModelsMarketplaceQuery = {
  page?: string;
  pageSize?: string;
  q?: string;
  brand?: string;
  site?: string;
  sortBy?: string;
  sortDir?: string;
};

type NormalizedModelsMarketplaceQuery = {
  page: number;
  pageSize: number;
  search: string;
  brand: string | null;
  site: string | null;
  sortBy: ModelsMarketplaceSortColumn;
  sortDir: "asc" | "desc";
};

function normalizePositiveInteger(
  raw: string | number | null | undefined,
  fallback: number,
  max?: number,
): number {
  const parsed = Math.trunc(Number(raw));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

function normalizeModelsMarketplaceQuery(
  query: ModelsMarketplaceQuery,
): NormalizedModelsMarketplaceQuery {
  const sortBy = String(query.sortBy || "").trim();
  const normalizedSortBy: ModelsMarketplaceSortColumn = (
    sortBy === "name" ||
    sortBy === "accountCount" ||
    sortBy === "credentialCount" ||
    sortBy === "avgLatency" ||
    sortBy === "successRate"
  ) ? sortBy : "accountCount";
  const sortDir = String(query.sortDir || "").trim().toLowerCase() === "asc"
    ? "asc"
    : "desc";
  const brand = String(query.brand || "").trim();
  const site = String(query.site || "").trim();
  return {
    page: normalizePositiveInteger(query.page, 1),
    pageSize: normalizePositiveInteger(
      query.pageSize,
      MODELS_MARKETPLACE_DEFAULT_PAGE_SIZE,
      MODELS_MARKETPLACE_MAX_PAGE_SIZE,
    ),
    search: String(query.q || "").trim().toLowerCase(),
    brand: brand || null,
    site: site || null,
    sortBy: normalizedSortBy,
    sortDir,
  };
}

function scopeModelToSite(
  model: ModelsMarketplaceModel,
  site: string | null,
): ModelsMarketplaceModel {
  if (!site) return model;
  const accounts = model.accounts.filter((account) => account.site === site);
  const pricingSources = model.pricingSources.filter((source) => source.siteName === site);
  const topology = model.siteCounts[site];
  if (!topology) throw new Error(`Marketplace site aggregate is missing for ${site}`);
  const latencyValues = accounts
    .map((account) => account.latency)
    .filter((latency: unknown): latency is number => (
      typeof latency === "number" && Number.isFinite(latency)
    ));
  const managedTokenCount = accounts.reduce(
    (sum, account) => sum + account.managedTokenCount,
    0,
  );
  const credentialCount = accounts.reduce(
    (sum, account) => sum + account.credentialCount,
    0,
  );
  return {
    ...model,
    accounts,
    pricingSources,
    accountCount: accounts.length,
    tokenCount: managedTokenCount,
    managedTokenCount,
    credentialCount,
    endpointCount: topology.endpointCount,
    executionAttemptCount: topology.executionAttemptCount,
    siteCounts: { [site]: topology },
    avgLatency: latencyValues.length > 0
      ? Math.round(latencyValues.reduce((sum: number, latency: number) => sum + latency, 0) / latencyValues.length)
      : null,
  };
}

function compareMarketplaceRows(
  a: ModelsMarketplaceModel,
  b: ModelsMarketplaceModel,
  query: NormalizedModelsMarketplaceQuery,
): number {
  if (query.sortBy === "name") {
    const cmp = a.name.localeCompare(b.name);
    return query.sortDir === "asc" ? cmp : -cmp;
  }

  const readNumber = (model: ModelsMarketplaceModel): number => {
    if (query.sortBy === "credentialCount") return model.credentialCount;
    if (query.sortBy === "avgLatency") {
      const latency = Number(model.avgLatency);
      if (!Number.isFinite(latency)) {
        return query.sortDir === "asc"
          ? Number.POSITIVE_INFINITY
          : Number.NEGATIVE_INFINITY;
      }
      return latency;
    }
    if (query.sortBy === "successRate") {
      const rate = Number(model.successRate);
      return Number.isFinite(rate) ? rate : -1;
    }
    const value = Number(model.accountCount);
    return Number.isFinite(value) ? value : 0;
  };

  const va = readNumber(a);
  const vb = readNumber(b);
  if (va === vb) return a.name.localeCompare(b.name);
  return query.sortDir === "desc" ? vb - va : va - vb;
}

function buildMarketplaceFacets(models: ModelsMarketplaceModel[]) {
  const brands = new Map<string, { name: string; icon?: string | null; count: number }>();
  const sites = new Map<string, number>();
  let otherBrandCount = 0;

  for (const model of models) {
    const brand = getBrand(model.name);
    if (brand) {
      const existing = brands.get(brand.name);
      if (existing) existing.count += 1;
      else brands.set(brand.name, {
        name: brand.name,
        icon: brand.icon,
        count: 1,
      });
    } else {
      otherBrandCount += 1;
    }

    for (const account of model.accounts) {
      const site = account.site.trim();
      if (!site) continue;
      sites.set(site, (sites.get(site) || 0) + 1);
    }
  }

  return {
    brands: Array.from(brands.values()).sort((a, b) => (
      b.count - a.count || a.name.localeCompare(b.name)
    )),
    otherBrandCount,
    sites: Array.from(sites.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

export function buildModelsMarketplacePage(
  models: ModelsMarketplaceModel[],
  query: ModelsMarketplaceQuery,
  meta: ModelsMarketplaceMeta,
): ModelsMarketplaceResponse {
  const normalized = normalizeModelsMarketplaceQuery(query);
  const searchFiltered = normalized.search
    ? models.filter((model) => model.name.toLowerCase().includes(normalized.search))
    : models;
  const facets = buildMarketplaceFacets(searchFiltered);
  const filtered = searchFiltered
    .filter((model) => {
      if (!normalized.brand) return true;
      const brand = getBrand(model.name);
      if (normalized.brand === "__other__") return !brand;
      return brand?.name === normalized.brand;
    })
    .filter((model) => {
      if (!normalized.site) return true;
      return model.accounts.some((account) => account.site === normalized.site);
    })
    .map((model) => scopeModelToSite(model, normalized.site))
    .sort((a, b) => compareMarketplaceRows(a, b, normalized));
  const totalCount = filtered.length;
  const offset = (normalized.page - 1) * normalized.pageSize;
  const pageModels = filtered.slice(offset, offset + normalized.pageSize);

  return {
    models: pageModels,
    pageInfo: {
      page: normalized.page,
      pageSize: normalized.pageSize,
      totalCount,
      hasMore: offset + pageModels.length < totalCount,
    },
    facets,
    meta,
  };
}
