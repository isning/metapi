import {
  normalizeRouteGraphBackendSpec,
  normalizeRouteGraphMatchSpec,
  type RouteGraphEndpointKind,
} from '../../shared/routeGraph.js';
import type { RouteEndpointCatalogItem, RouteEndpointCatalogPage } from '../../shared/routeEndpointCatalog.js';
import { getRouteGraphWorkspaceRevisionContext } from './routeGraphWorkspaceQueryService.js';

export type RouteEndpointCatalogQuery = {
  page?: number;
  pageSize?: number;
  endpointKind?: 'all' | RouteGraphEndpointKind;
  siteId?: number | null;
  q?: string | null;
  revision?: string | null;
};

export type RouteEndpointCatalogHttpQuery = {
  page?: string;
  pageSize?: string;
  endpointKind?: string;
  siteId?: string;
  q?: string;
  revision?: string;
};

export function parseRouteEndpointCatalogQuery(input: RouteEndpointCatalogHttpQuery): RouteEndpointCatalogQuery {
  const siteId = Number(input.siteId);
  return {
    page: Number(input.page),
    pageSize: Number(input.pageSize),
    endpointKind: input.endpointKind === 'supply' ? 'supply' : 'all',
    siteId: Number.isFinite(siteId) && siteId > 0 ? Math.trunc(siteId) : null,
    q: input.q ?? null,
    revision: input.revision ?? null,
  };
}

export class RouteEndpointCatalogRevisionConflictError extends Error {
  readonly code = 'stale_revision';
}

let catalogCache: { revision: string; items: RouteEndpointCatalogItem[] } | null = null;

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readStringList(value: unknown): string[] {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(readString)
    .filter(Boolean)));
}

function readNumberList(value: unknown): number[] {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.trunc(item))));
}

function normalizeCatalogQuery(input: RouteEndpointCatalogQuery): Required<Omit<RouteEndpointCatalogQuery, 'siteId' | 'q' | 'revision'>> & {
  siteId: number | null;
  q: string;
} {
  const page = Math.max(1, Math.trunc(Number(input.page) || 1));
  const pageSize = Math.max(1, Math.min(500, Math.trunc(Number(input.pageSize) || 100)));
  const endpointKind = input.endpointKind === 'supply' ? 'supply' : 'all';
  const siteId = Number(input.siteId);
  return {
    page,
    pageSize,
    endpointKind,
    siteId: Number.isFinite(siteId) && siteId > 0 ? Math.trunc(siteId) : null,
    q: readString(input.q).toLowerCase(),
  };
}

function catalogItemMatchesQuery(item: RouteEndpointCatalogItem, query: ReturnType<typeof normalizeCatalogQuery>): boolean {
  if (query.endpointKind !== 'all' && item.endpointKind !== query.endpointKind) return false;
  if (query.siteId != null) {
    const siteIds = readNumberList(item.metadata.siteIds);
    if (!siteIds.includes(query.siteId)) return false;
  }
  if (!query.q) return true;
  return [
    item.endpointId,
    item.nodeId,
    item.label,
    item.modelPattern,
    item.publicModelName || '',
    ...item.upstreamModels,
    ...item.siteNames,
  ].some((value) => value.toLowerCase().includes(query.q));
}

function itemFromRouteEndpointNode(node: any): RouteEndpointCatalogItem | null {
  if (!node || node.type !== 'route_endpoint') return null;
  if (node.endpointKind !== 'supply') return null;
  const endpointKind = 'supply' as const;
  const metadata = readObject(node.metadata);
  const config = readObject(node.config);
  const targets = Array.isArray(config.targets) ? config.targets.map(readObject) : [];
  const targetMetadata = targets.map((target) => readObject(target.metadata));
  const endpointIdentities = [
    readObject(metadata.endpointIdentity),
    ...targetMetadata.map((item) => readObject(item.endpointIdentity)),
  ].filter((item) => Object.keys(item).length > 0);
  const siteNames = Array.from(new Set(endpointIdentities
    .map((identity) => readString(identity.siteName))
    .filter(Boolean)));
  const siteIds = readNumberList(targets.map((target) => target.siteId));
  const backend = normalizeRouteGraphBackendSpec(node.backend);
  const sourceEndpointIds = backend.kind === 'route_endpoints' ? backend.endpointIds : [];
  const match = normalizeRouteGraphMatchSpec(node.match);
  const endpointId = readString(node.routeEndpointId);
  if (!endpointId) return null;
  const upstreamModels = Array.from(new Set([
    ...readStringList(metadata.suppliedModels),
    readString(metadata.upstreamModel),
    ...targets.map((target) => readString(target.model)),
  ].filter(Boolean)));

  return {
    endpointId,
    nodeId: readString(node.id),
    label: readString(node.name) || readString(node.id),
    endpointKind,
    exposure: node.exposure === 'public' || node.exposure === 'internal' ? node.exposure : 'none',
    resolutionStatus: node.resolutionStatus === 'degraded' || node.resolutionStatus === 'unresolved' ? node.resolutionStatus : 'resolved',
    ownerKind: node.ownerKind === 'macro' || node.ownerKind === 'manual'
      ? node.ownerKind
      : null,
    sourceKind: node.sourceKind || null,
    enabled: node.enabled !== false,
    displayIcon: readString(metadata.displayIcon) || null,
    modelPattern: match.requestedModelPattern,
    publicModelName: match.displayName || null,
    upstreamModels,
    siteNames,
    candidateCount: targets.length,
    sourceEndpointIds,
    tags: readStringList(metadata.tags),
    metadata: {
      ...metadata,
      siteIds,
    },
  };
}

export async function listRouteEndpointCatalog(input: RouteEndpointCatalogQuery = {}): Promise<RouteEndpointCatalogItem[]> {
  const query = normalizeCatalogQuery(input);
  const { draft, revision } = await getRouteGraphWorkspaceRevisionContext();
  if (input.revision && input.revision !== revision) throw new RouteEndpointCatalogRevisionConflictError();
  if (!catalogCache || catalogCache.revision !== revision) {
    catalogCache = {
      revision,
      items: (draft.workingGraph.nodes || [])
        .map(itemFromRouteEndpointNode)
        .filter((item): item is RouteEndpointCatalogItem => !!item)
        .sort((left, right) => left.label.localeCompare(right.label) || left.endpointId.localeCompare(right.endpointId)),
    };
  }
  return catalogCache.items.filter((item) => catalogItemMatchesQuery(item, query));
}

export async function listRouteEndpointCatalogPage(input: RouteEndpointCatalogQuery = {}): Promise<RouteEndpointCatalogPage> {
  const query = normalizeCatalogQuery(input);
  const { revision } = await getRouteGraphWorkspaceRevisionContext();
  if (input.revision && input.revision !== revision) throw new RouteEndpointCatalogRevisionConflictError();
  const items = await listRouteEndpointCatalog(query);
  const start = (query.page - 1) * query.pageSize;
  const pageItems = items.slice(start, start + query.pageSize);
  return {
    revision,
    items: pageItems,
    pageInfo: {
      page: query.page,
      pageSize: query.pageSize,
      totalCount: items.length,
      hasMore: start + pageItems.length < items.length,
    },
  };
}
