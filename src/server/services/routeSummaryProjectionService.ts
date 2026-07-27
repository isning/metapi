import { getBrand } from "../shared/modelBrand.js";
import type { RouteGroupManagementSummary } from "../../shared/routeGroupManagement.js";
import { matchesModelPattern } from "../../shared/modelPatternMatcher.js";

export type RouteSummaryProjectionQuery = {
  page?: string;
  pageSize?: string;
  q?: string;
  tab?: string;
  group?: string;
  brand?: string;
  site?: string;
  enabled?: string;
  endpointType?: string;
  sortBy?: string;
  sortDir?: string;
};

export type RouteSummaryProjectionContext = {
  endpointTypesByModel?: Record<string, string[]>;
};

export type RouteGroupManagementListItem = RouteGroupManagementSummary;

type Query = {
  page: number;
  pageSize: number;
  search: string;
  tab: "public" | "internal" | "manual" | null;
  group: "__all__" | string | null;
  brand: string | null;
  site: string | null;
  endpointType: string | null;
  enabled: "all" | "enabled" | "disabled";
  sortBy: "candidateCount" | "name";
  sortDir: "asc" | "desc";
};

function text(value: unknown): string {
  return String(value || "").trim();
}
function lower(value: unknown): string {
  return text(value).toLowerCase();
}
function positive(value: unknown, fallback: number, max?: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

function query(input: RouteSummaryProjectionQuery): Query {
  const tab = text(input.tab);
  const enabled = text(input.enabled);
  return {
    page: positive(input.page, 1),
    pageSize: positive(input.pageSize, 50, 500),
    search: lower(input.q),
    tab:
      tab === "public" || tab === "internal" || tab === "manual" ? tab : null,
    group: text(input.group) || null,
    brand: text(input.brand) || null,
    site: text(input.site) || null,
    endpointType: text(input.endpointType) || null,
    enabled: enabled === "enabled" || enabled === "disabled" ? enabled : "all",
    sortBy: text(input.sortBy) === "name" ? "name" : "candidateCount",
    sortDir: lower(input.sortDir) === "asc" ? "asc" : "desc",
  };
}

function modelName(row: RouteGroupManagementListItem): string {
  return (
    text(row.model.publicName) ||
    text(row.model.normalizedName) ||
    text(row.model.upstreamName)
  );
}

function title(row: RouteGroupManagementListItem): string {
  return text(row.presentation.displayName) || modelName(row) || row.id;
}

function manual(row: RouteGroupManagementListItem): boolean {
  return row.kind === "manual" || row.sourceMode === "manual";
}

function typeIndex(
  context: RouteSummaryProjectionContext,
): Map<string, string[]> {
  return new Map(
    Object.entries(context.endpointTypesByModel || {}).map(([name, types]) => [
      lower(name),
      types,
    ]),
  );
}

function endpointTypes(
  row: RouteGroupManagementListItem,
  byId: Map<string, RouteGroupManagementListItem>,
  catalog: Map<string, string[]>,
  cache: Map<string, string[]>,
  visiting = new Set<string>(),
): string[] {
  if (cache.has(row.id)) return cache.get(row.id)!;
  if (visiting.has(row.id)) return [];
  visiting.add(row.id);
  const result = new Set<string>();
  const explicitSources =
    row.sourceSelection.kind === "explicit" ? row.sourceSelection.sources : [];
  for (const source of explicitSources) {
    if (source.source.kind === "route_group") {
      const child = byId.get(source.source.id);
      if (child)
        endpointTypes(child, byId, catalog, cache, visiting).forEach((type) =>
          result.add(type),
        );
      continue;
    }
    const sourceModel = lower(source.modelName);
    for (const type of catalog.get(sourceModel) || [])
      if (text(type)) result.add(text(type));
  }
  if (row.sourceSelection.kind === "model_pattern") {
    for (const [model, types] of catalog) {
      if (!matchesModelPattern(model, row.sourceSelection.pattern)) continue;
      for (const type of types) if (text(type)) result.add(text(type));
    }
  }
  // Automatic groups may have no explicitly persisted source list. Their model is
  // still a management identity and can be matched directly against catalog data.
  if (result.size === 0) {
    for (const name of [
      row.model.upstreamName,
      row.model.publicName,
      row.model.normalizedName,
    ]) {
      for (const type of catalog.get(lower(name)) || [])
        if (text(type)) result.add(text(type));
    }
  }
  visiting.delete(row.id);
  const types = [...result].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  cache.set(row.id, types);
  return types;
}

function matches(
  row: RouteGroupManagementListItem,
  input: Query,
  types: string[],
): boolean {
  if (input.tab === "manual" && !manual(row)) return false;
  if (input.tab === "public" && (manual(row) || row.visibility !== "public"))
    return false;
  if (input.tab === "internal" && row.visibility !== "internal") return false;
  if (
    input.group === "__all__" &&
    row.kind === "automatic" &&
    row.sourceMode === "auto"
  )
    return false;
  if (input.group && input.group !== "__all__" && row.id !== input.group)
    return false;
  if (input.enabled === "enabled" && !row.enabled) return false;
  if (input.enabled === "disabled" && row.enabled) return false;
  if (input.site && !row.siteNames.includes(input.site)) return false;
  if (input.endpointType && !types.includes(input.endpointType)) return false;
  if (input.brand) {
    const brand = getBrand(modelName(row)) || getBrand(title(row));
    if (input.brand === "__other__" ? !!brand : brand?.name !== input.brand)
      return false;
  }
  return (
    !input.search ||
    [row.id, modelName(row), title(row), ...row.siteNames]
      .join("\n")
      .toLowerCase()
      .includes(input.search)
  );
}

function facets(
  rows: RouteGroupManagementListItem[],
  typeFor: (row: RouteGroupManagementListItem) => string[],
) {
  const tabs = { public: 0, internal: 0, manual: 0 };
  const enabled = { enabled: 0, disabled: 0 };
  const brands = new Map<
    string,
    { name: string; icon?: string | null; color?: string | null; count: number }
  >();
  const sites = new Map<string, number>();
  const endpointTypes = new Map<string, number>();
  let otherBrandCount = 0;
  for (const row of rows) {
    if (manual(row)) tabs.manual += 1;
    else if (row.visibility === "internal") tabs.internal += 1;
    else tabs.public += 1;
    if (row.enabled) enabled.enabled += 1;
    else enabled.disabled += 1;
    const brand = getBrand(modelName(row)) || getBrand(title(row));
    if (brand) {
      const current = brands.get(brand.name);
      brands.set(
        brand.name,
        current
          ? { ...current, count: current.count + 1 }
          : {
              name: brand.name,
              icon: brand.icon,
              color: brand.color,
              count: 1,
            },
      );
    } else otherBrandCount += 1;
    for (const site of new Set(row.siteNames.filter(Boolean)))
      sites.set(site, (sites.get(site) || 0) + 1);
    for (const type of typeFor(row))
      endpointTypes.set(type, (endpointTypes.get(type) || 0) + 1);
  }
  return {
    brands: [...brands.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    ),
    otherBrandCount,
    sites: [...sites.entries()]
      .map(([name, count]) => ({ name, count, siteId: 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    endpointTypes: [...endpointTypes.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    tabs,
    enabled,
  };
}

export function hasRouteSummaryProjectionQuery(
  input: RouteSummaryProjectionQuery,
): boolean {
  return Object.values(input).some((value) => text(value));
}

export function buildRouteSummaryProjectionPage(
  sourceRows: RouteGroupManagementSummary[],
  input: RouteSummaryProjectionQuery,
  context: RouteSummaryProjectionContext = {},
) {
  const normalized = query(input);
  const rows: RouteGroupManagementListItem[] = [...sourceRows];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const catalog = typeIndex(context);
  const cache = new Map<string, string[]>();
  const typeFor = (row: RouteGroupManagementListItem) =>
    endpointTypes(row, byId, catalog, cache);
  const searchRows = rows.filter(
    (row) =>
      !normalized.search ||
      [row.id, modelName(row), title(row), ...row.siteNames]
        .join("\n")
        .toLowerCase()
        .includes(normalized.search),
  );
  const filtered = searchRows
    .filter((row) => matches(row, normalized, typeFor(row)))
    .sort((left, right) => {
      const first =
        normalized.sortBy === "candidateCount"
          ? left.candidateCount - right.candidateCount
          : modelName(left).localeCompare(modelName(right));
      return normalized.sortDir === "asc" ? first : -first;
    });
  const offset = (normalized.page - 1) * normalized.pageSize;
  return {
    items: filtered.slice(offset, offset + normalized.pageSize),
    pageInfo: {
      page: normalized.page,
      pageSize: normalized.pageSize,
      totalCount: filtered.length,
      hasMore: offset + normalized.pageSize < filtered.length,
    },
    summary: {
      candidateCount: filtered.reduce(
        (total, row) => total + row.candidateCount,
        0,
      ),
    },
    facets: facets(searchRows, typeFor),
  };
}

export function buildRouteSummaryProjectionOverview(
  rows: RouteGroupManagementSummary[],
  context: RouteSummaryProjectionContext = {},
) {
  const list = [...rows] as RouteGroupManagementListItem[];
  const byId = new Map(list.map((row) => [row.id, row]));
  const catalog = typeIndex(context);
  const cache = new Map<string, string[]>();
  return facets(list, (row) => endpointTypes(row, byId, catalog, cache));
}
