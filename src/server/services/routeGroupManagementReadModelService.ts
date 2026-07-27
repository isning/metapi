import type { RouteGroupManagementSummary } from '../../shared/routeGroupManagement.js';
import { projectRouteGroupsFromGraph } from './routeGroupManagementProjectionService.js';
import {
  getActiveRouteGraphSourceVersion,
  getActiveRouteGraphVersionId,
} from './routeGraphService.js';
import { loadRuntimeExecutionTargetCatalogFacts } from './runtimeExecutionTargetFactsService.js';
import { loadRouteGroupManagementCatalogRevision } from './routeGroupManagementCatalogRevisionService.js';

type RouteGroupManagementRows = RouteGroupManagementSummary[];

let cache: {
  graphVersionId: number;
  catalogRevision: string;
  rows: RouteGroupManagementRows;
} | null = null;

/** Called only by owners of stable Graph/catalog facts, never by runtime health updates. */
export function invalidateRouteGroupManagementReadModel(): void {
  cache = null;
}

/**
 * Stable Route Group facade projection. Runtime target health is deliberately
 * absent; candidate detail hydrates it for the requested group only.
 */
export async function loadRouteGroupManagementReadModel(): Promise<RouteGroupManagementRows> {
  const [graphVersionId, catalogRevision] = await Promise.all([
    getActiveRouteGraphVersionId(),
    loadRouteGroupManagementCatalogRevision(),
  ]);
  if (!graphVersionId) {
    cache = null;
    return [];
  }
  if (
    cache?.graphVersionId === graphVersionId
    && cache.catalogRevision === catalogRevision
  ) return cache.rows;

  const [active, catalogFacts] = await Promise.all([
    getActiveRouteGraphSourceVersion(),
    loadRuntimeExecutionTargetCatalogFacts(),
  ]);
  if (!active || active.id !== graphVersionId) {
    cache = null;
    return [];
  }
  const rows = projectRouteGroupsFromGraph(active.sourceGraph, catalogFacts);
  cache = { graphVersionId, catalogRevision, rows };
  return rows;
}
