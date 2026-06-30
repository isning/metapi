import { getBrand } from "../shared/modelBrand.js";
import {
  isExactTokenRouteModelPattern,
  matchesTokenRouteModelPattern,
} from "../../shared/tokenRoutePatterns.js";

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
  includeZeroTarget?: string;
  sortBy?: string;
  sortDir?: string;
};

type MissingTokenModelAccount = {
  siteName?: string | null;
};

export type RouteSummaryProjectionContext = {
  endpointTypesByModel?: Record<string, string[]>;
  modelsWithoutToken?: Record<string, MissingTokenModelAccount[]>;
  modelsMissingTokenGroups?: Record<string, MissingTokenModelAccount[]>;
};

type NormalizedRouteSummaryProjectionQuery = {
  page: number;
  pageSize: number;
  search: string;
  tab: "public" | "internal" | "manual" | null;
  group: "__all__" | number | null;
  brand: string | null;
  site: string | null;
  endpointType: string | null;
  includeZeroTarget: boolean;
  enabled: "all" | "enabled" | "disabled";
  sortBy: "targetCount" | "name";
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

function normalizeRouteSummaryProjectionQuery(
  query: RouteSummaryProjectionQuery,
): NormalizedRouteSummaryProjectionQuery {
  const tab = String(query.tab || "").trim();
  const group = String(query.group || "").trim();
  const groupId = Math.trunc(Number(group));
  const enabled = String(query.enabled || "").trim();
  const sortBy = String(query.sortBy || "").trim();
  const sortDir = String(query.sortDir || "").trim().toLowerCase();
  const brand = String(query.brand || "").trim();
  const site = String(query.site || "").trim();
  const endpointType = String(query.endpointType || "").trim();
  const includeZeroTarget = ["1", "true", "yes"].includes(
    String(query.includeZeroTarget || "").trim().toLowerCase(),
  );

  return {
    page: normalizePositiveInteger(query.page, 1),
    pageSize: normalizePositiveInteger(query.pageSize, 50, 500),
    search: String(query.q || "").trim().toLowerCase(),
    tab: tab === "public" || tab === "internal" || tab === "manual" ? tab : null,
    group: group === "__all__"
      ? "__all__"
      : (Number.isFinite(groupId) && groupId > 0 ? groupId : null),
    brand: brand || null,
    site: site || null,
    endpointType: endpointType || null,
    includeZeroTarget,
    enabled: enabled === "enabled" || enabled === "disabled" ? enabled : "all",
    sortBy: sortBy === "name" ? "name" : "targetCount",
    sortDir: sortDir === "asc" ? "asc" : "desc",
  };
}

function readRouteName(route: any): string {
  const match = route?.match && typeof route.match === "object" && !Array.isArray(route.match)
    ? route.match as Record<string, unknown>
    : {};
  const presentation = route?.presentation && typeof route.presentation === "object" && !Array.isArray(route.presentation)
    ? route.presentation as Record<string, unknown>
    : {};
  return String(
    match.requestedModelPattern ||
    match.displayName ||
    presentation.displayName ||
    route?.modelPattern ||
    "",
  ).trim();
}

function readRouteTitle(route: any): string {
  const presentation = route?.presentation && typeof route.presentation === "object" && !Array.isArray(route.presentation)
    ? route.presentation as Record<string, unknown>
    : {};
  return String(presentation.displayName || readRouteName(route)).trim();
}

function readRouteDisplayName(route: any): string {
  const match = route?.match && typeof route.match === "object" && !Array.isArray(route.match)
    ? route.match as Record<string, unknown>
    : {};
  const presentation = route?.presentation && typeof route.presentation === "object" && !Array.isArray(route.presentation)
    ? route.presentation as Record<string, unknown>
    : {};
  return String(presentation.displayName || match.displayName || "").trim();
}

function isManualRoute(route: any): boolean {
  const backend = route?.backend && typeof route.backend === "object" && !Array.isArray(route.backend)
    ? route.backend as Record<string, unknown>
    : {};
  return route?.routeMode === "explicit_group" || backend.kind === "routes";
}

function isExactModelRoute(route: any): boolean {
  const match = route?.match && typeof route.match === "object" && !Array.isArray(route.match)
    ? route.match as Record<string, unknown>
    : {};
  const pattern = readRouteName(route);
  return match.kind === "model" && isExactTokenRouteModelPattern(pattern);
}

function readBackendRouteIds(route: any): number[] {
  const backend = route?.backend && typeof route.backend === "object" && !Array.isArray(route.backend)
    ? route.backend as Record<string, unknown>
    : {};
  if (!Array.isArray(backend.routeIds)) return [];
  return backend.routeIds
    .map((routeId) => Math.trunc(Number(routeId)))
    .filter((routeId) => Number.isFinite(routeId) && routeId > 0);
}

function hasCustomDisplayName(route: any): boolean {
  const displayName = readRouteDisplayName(route);
  const pattern = readRouteName(route).trim();
  return !!displayName && displayName !== pattern;
}

function buildVisibleRouteList<T extends Record<string, any>>(routes: T[]): T[] {
  const exactModelNames = new Set(
    routes
      .filter((route) => !isManualRoute(route) && isExactModelRoute(route))
      .map((route) => readRouteName(route).trim())
      .filter(Boolean),
  );
  const coveringGroups = routes.filter((route) => (
    route?.enabled !== false
    && (
      (isManualRoute(route) && readRouteDisplayName(route).length > 0 && readBackendRouteIds(route).length > 0)
      || (!isManualRoute(route) && !isExactModelRoute(route) && hasCustomDisplayName(route))
    )
  ));

  if (coveringGroups.length === 0) return routes;

  return routes.filter((route) => {
    if (isManualRoute(route)) return true;
    if (!isExactModelRoute(route)) return true;
    if (hasCustomDisplayName(route)) return true;

    const exactModel = readRouteName(route).trim();
    if (!exactModel) return true;

    return !coveringGroups.some((groupRoute) => (
      Number(groupRoute?.id) !== Number(route?.id)
      && !exactModelNames.has(readRouteDisplayName(groupRoute))
      && (
        (isManualRoute(groupRoute) && readBackendRouteIds(groupRoute).includes(Number(route?.id)))
        || (!isManualRoute(groupRoute) && matchesTokenRouteModelPattern(exactModel, readRouteName(groupRoute)))
      )
    ));
  });
}

function routeMatchesTab(route: any, tab: NormalizedRouteSummaryProjectionQuery["tab"]): boolean {
  if (!tab) return true;
  if (tab === "manual") return isManualRoute(route);
  if (isManualRoute(route)) return false;
  if (tab === "internal") return route?.visibility === "internal";
  return route?.visibility !== "internal";
}

function routeMatchesGroup(route: any, group: NormalizedRouteSummaryProjectionQuery["group"]): boolean {
  if (group == null) return true;
  if (group === "__all__") return !isExactModelRoute(route);
  return Number(route?.id) === group;
}

function routeMatchesSearch(route: any, search: string): boolean {
  if (!search) return true;
  return [
    readRouteName(route),
    readRouteTitle(route),
  ].some((value) => value.toLowerCase().includes(search));
}

function routeMatchesBrand(route: any, brandName: string | null): boolean {
  if (!brandName) return true;
  const brand = getBrand(readRouteName(route)) || getBrand(readRouteTitle(route));
  if (brandName === "__other__") return !brand;
  return brand?.name === brandName;
}

function routeMatchesSite(route: any, site: string | null): boolean {
  if (!site) return true;
  return Array.isArray(route?.siteNames) && route.siteNames.includes(site);
}

function routeMatchesEnabled(route: any, enabled: NormalizedRouteSummaryProjectionQuery["enabled"]): boolean {
  if (enabled === "all") return true;
  return enabled === "enabled" ? route?.enabled !== false : route?.enabled === false;
}

function buildStableVirtualRouteId(modelName: string): number {
  const normalized = modelName.trim().toLowerCase();
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash * 131) + normalized.charCodeAt(index)) % 2_147_483_647;
  }
  return -Math.max(1, hash || normalized.length || 1);
}

function getEndpointTypesForRoute(
  route: any,
  routesById: Map<number, any>,
  endpointTypesByModel: Record<string, string[]>,
  cache: Map<number, string[]>,
  visiting = new Set<number>(),
): string[] {
  const routeId = Number(route?.id);
  if (Number.isFinite(routeId) && cache.has(routeId)) return cache.get(routeId)!;
  if (Number.isFinite(routeId) && visiting.has(routeId)) return [];
  if (Number.isFinite(routeId)) visiting.add(routeId);

  const types = new Set<string>();
  const sourceRouteIds = readBackendRouteIds(route);
  if (sourceRouteIds.length > 0) {
    for (const sourceRouteId of sourceRouteIds) {
      const sourceRoute = routesById.get(sourceRouteId);
      if (!sourceRoute) continue;
      for (const endpointType of getEndpointTypesForRoute(sourceRoute, routesById, endpointTypesByModel, cache, visiting)) {
        types.add(endpointType);
      }
    }
  } else {
    const pattern = readRouteName(route);
    for (const [modelName, endpointTypes] of Object.entries(endpointTypesByModel || {})) {
      if (!pattern || !matchesTokenRouteModelPattern(modelName, pattern)) continue;
      for (const endpointType of endpointTypes || []) {
        const normalizedType = String(endpointType || "").trim();
        if (normalizedType) types.add(normalizedType);
      }
    }
  }

  const result = Array.from(types).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  if (Number.isFinite(routeId)) {
    visiting.delete(routeId);
    cache.set(routeId, result);
  }
  return result;
}

function routeMatchesEndpointType(
  route: any,
  endpointType: string | null,
  routesById: Map<number, any>,
  endpointTypesByModel: Record<string, string[]>,
  endpointTypesCache: Map<number, string[]>,
): boolean {
  if (!endpointType) return true;
  return getEndpointTypesForRoute(route, routesById, endpointTypesByModel, endpointTypesCache).includes(endpointType);
}

function buildZeroTargetRoutes(
  routes: any[],
  context: RouteSummaryProjectionContext,
): any[] {
  const exactRouteNames = new Set(
    routes
      .filter((route) => isExactModelRoute(route))
      .map((route) => readRouteName(route).toLowerCase())
      .filter(Boolean),
  );
  const placeholders = new Map<string, any>();
  const mergeMissingModels = (missingByModel: Record<string, MissingTokenModelAccount[]> | undefined) => {
    for (const [rawModelName, accounts] of Object.entries(missingByModel || {})) {
      const modelName = String(rawModelName || "").trim();
      if (!modelName) continue;
      if (!isExactModelRoute({ match: { kind: "model", requestedModelPattern: modelName } })) continue;
      const routeKey = modelName.toLowerCase();
      if (exactRouteNames.has(routeKey)) continue;

      const existing = placeholders.get(routeKey);
      const siteNames = new Set<string>(existing?.siteNames || []);
      for (const account of accounts || []) {
        const siteName = String(account?.siteName || "").trim();
        if (siteName) siteNames.add(siteName);
      }
      placeholders.set(routeKey, {
        id: buildStableVirtualRouteId(modelName),
        match: {
          kind: "model",
          requestedModelPattern: modelName,
          currentModelPattern: "",
          displayName: null,
          downstreamProtocol: null,
          upstreamProtocol: null,
          sitePlatform: null,
          routeId: null,
          accountId: null,
          tokenId: null,
          siteId: null,
        },
        backend: { kind: "supply" },
        presentation: { displayName: null, displayIcon: null },
        modelMapping: null,
        routingStrategy: null,
        enabled: false,
        targetCount: 0,
        enabledTargetCount: 0,
        siteNames: Array.from(siteNames).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })),
        decisionSnapshot: null,
        decisionRefreshedAt: null,
        kind: "zero_target",
        readOnly: true,
        isVirtual: true,
      });
    }
  };

  mergeMissingModels(context.modelsWithoutToken);
  mergeMissingModels(context.modelsMissingTokenGroups);
  return Array.from(placeholders.values());
}

function compareRouteSummaryRows(
  a: any,
  b: any,
  query: NormalizedRouteSummaryProjectionQuery,
): number {
  if (query.sortBy === "targetCount") {
    const countA = Number(a?.targetCount || 0);
    const countB = Number(b?.targetCount || 0);
    if (countA !== countB) return query.sortDir === "asc" ? countA - countB : countB - countA;
  }
  const cmp = readRouteName(a).localeCompare(readRouteName(b), undefined, { sensitivity: "base" });
  return query.sortDir === "asc" ? cmp : -cmp;
}

function buildFacets(
  routes: any[],
  context: Required<Pick<RouteSummaryProjectionContext, "endpointTypesByModel">>,
  routeLookup?: Map<number, any>,
) {
  const brands = new Map<string, { name: string; icon?: string | null; color?: string | null; count: number }>();
  const sites = new Map<string, number>();
  const endpointTypes = new Map<string, number>();
  let otherBrandCount = 0;
  const tabs = { public: 0, internal: 0, manual: 0 };
  const enabled = { enabled: 0, disabled: 0 };
  const routesById = routeLookup || new Map(routes.map((route) => [Number(route?.id), route]));
  const endpointTypesCache = new Map<number, string[]>();

  for (const route of routes) {
    if (isManualRoute(route)) tabs.manual += 1;
    else if (route?.visibility === "internal") tabs.internal += 1;
    else tabs.public += 1;

    if (route?.enabled === false) enabled.disabled += 1;
    else enabled.enabled += 1;

    const brand = getBrand(readRouteName(route)) || getBrand(readRouteTitle(route));
    if (brand) {
      const existing = brands.get(brand.name);
      if (existing) existing.count += 1;
      else brands.set(brand.name, {
        name: brand.name,
        icon: brand.icon,
        color: brand.color,
        count: 1,
      });
    } else {
      otherBrandCount += 1;
    }

    const seenSites = new Set<string>();
    for (const rawSite of Array.isArray(route?.siteNames) ? route.siteNames : []) {
      const site = String(rawSite || "").trim();
      if (!site || seenSites.has(site)) continue;
      seenSites.add(site);
      sites.set(site, (sites.get(site) || 0) + 1);
    }

    for (const endpointType of getEndpointTypesForRoute(route, routesById, context.endpointTypesByModel, endpointTypesCache)) {
      endpointTypes.set(endpointType, (endpointTypes.get(endpointType) || 0) + 1);
    }
  }

  return {
    brands: Array.from(brands.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    otherBrandCount,
    sites: Array.from(sites.entries())
      .map(([name, count]) => ({ name, count, siteId: 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    endpointTypes: Array.from(endpointTypes.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    tabs,
    enabled,
  };
}

export function hasRouteSummaryProjectionQuery(query: RouteSummaryProjectionQuery): boolean {
  return [
    query.q,
    query.tab,
    query.group,
    query.brand,
    query.site,
    query.enabled,
    query.endpointType,
    query.includeZeroTarget,
    query.sortBy,
    query.sortDir,
  ].some((value) => String(value || "").trim());
}

export function buildRouteSummaryProjectionPage(
  routes: any[],
  query: RouteSummaryProjectionQuery,
  context: RouteSummaryProjectionContext = {},
) {
  const normalized = normalizeRouteSummaryProjectionQuery(query);
  const endpointTypesByModel = context.endpointTypesByModel || {};
  const allRoutes = normalized.includeZeroTarget
    ? [...routes, ...buildZeroTargetRoutes(routes, context)]
    : routes;
  const routesById = new Map(allRoutes.map((route) => [Number(route?.id), route]));
  const endpointTypesCache = new Map<number, string[]>();
  const visibleRoutes = buildVisibleRouteList(allRoutes);
  const searchFiltered = visibleRoutes.filter((route) => routeMatchesSearch(route, normalized.search));
  const facets = buildFacets(searchFiltered, { endpointTypesByModel }, routesById);
  const filtered = searchFiltered
    .filter((route) => routeMatchesTab(route, normalized.tab))
    .filter((route) => routeMatchesGroup(route, normalized.group))
    .filter((route) => routeMatchesBrand(route, normalized.brand))
    .filter((route) => routeMatchesSite(route, normalized.site))
    .filter((route) => routeMatchesEndpointType(route, normalized.endpointType, routesById, endpointTypesByModel, endpointTypesCache))
    .filter((route) => routeMatchesEnabled(route, normalized.enabled))
    .sort((a, b) => compareRouteSummaryRows(a, b, normalized));
  const totalCount = filtered.length;
  const offset = (normalized.page - 1) * normalized.pageSize;
  const items = filtered.slice(offset, offset + normalized.pageSize);

  return {
    items,
    pageInfo: {
      page: normalized.page,
      pageSize: normalized.pageSize,
      totalCount,
      hasMore: offset + items.length < totalCount,
    },
    facets,
  };
}
