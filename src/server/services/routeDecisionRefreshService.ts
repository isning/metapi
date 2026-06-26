import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { saveRouteDecisionSnapshots } from './routeDecisionSnapshotStore.js';
import { loadActiveRouteGraphRouteBindings } from './routeGraphService.js';
import { matchesModelPattern, tokenRouter } from './tokenRouter.js';
import { ROUTE_DECISION_REFRESH_TASK_TYPE } from '../../shared/tokenRouteContract.js';
import {
  isRouteGraphExactModelMatch,
} from '../../shared/routeGraph.js';

export { ROUTE_DECISION_REFRESH_TASK_TYPE };
export const ROUTE_DECISION_REFRESH_DEDUPE_KEY = 'refresh-route-decision-snapshots';

function normalizeModels(models: string[]): string[] {
  return Array.from(new Set(
    models
      .map((model) => String(model || '').trim())
      .filter(Boolean),
  ));
}

function normalizeRouteIds(routeIds: number[]): number[] {
  return Array.from(new Set(
    routeIds
      .map((routeId) => Math.trunc(routeId))
      .filter((routeId) => routeId > 0),
  ));
}

type RefreshOptions = {
  refreshPricingCatalog?: boolean;
  onProgress?: (message: string) => void;
};

export async function refreshAllRouteDecisionSnapshots(options: RefreshOptions = {}): Promise<{
  exactModelCount: number;
  wildcardRouteCount: number;
}> {
  const routeBindings = await loadActiveRouteGraphRouteBindings();
  const routes = (await db.select({
    id: schema.tokenRoutes.id,
  }).from(schema.tokenRoutes)
    .where(eq(schema.tokenRoutes.enabled, true))
    .all()).map((route) => {
      const binding = routeBindings.get(route.id);
      return {
        id: route.id,
        match: binding?.match,
        backend: binding?.backend,
        modelPattern: binding?.exactModelName || binding?.exposedModelName || '',
      };
    }).filter((route) => route.match && route.backend);

  const exactModels = normalizeModels(
    routes
      .filter((route) => isRouteGraphExactModelMatch(route.match, route.backend))
      .map((route) => route.modelPattern),
  );
  const wildcardRouteIds = normalizeRouteIds(
    routes
      .filter((route) => !isRouteGraphExactModelMatch(route.match, route.backend))
      .map((route) => route.id),
  );
  const refreshedKeys = options.refreshPricingCatalog ? new Set<string>() : undefined;

  options.onProgress?.(`开始刷新路由概率：精确模型 ${exactModels.length}，通配符路由 ${wildcardRouteIds.length}`);

  for (const [index, model] of exactModels.entries()) {
    options.onProgress?.(`刷新精确模型概率 ${index + 1}/${exactModels.length}：${model}`);
    const matchingRoutes = routes.filter((route) => (
      isRouteGraphExactModelMatch(route.match, route.backend) && matchesModelPattern(model, route.modelPattern)
    ));
    const snapshotWrites: Array<{ routeId: number; snapshot: unknown }> = [];
    for (const route of matchingRoutes) {
      if (options.refreshPricingCatalog) {
        await tokenRouter.refreshPricingReferenceCostsForRoute(route.id, model, { refreshedKeys });
      }
      const decision = await tokenRouter.explainSelectionForRoute(route.id, model);
      snapshotWrites.push({
        routeId: route.id,
        snapshot: decision,
      });
    }
    if (snapshotWrites.length > 0) {
      await saveRouteDecisionSnapshots(snapshotWrites);
    }
  }

  for (const [index, routeId] of wildcardRouteIds.entries()) {
    options.onProgress?.(`刷新通配符路由概率 ${index + 1}/${wildcardRouteIds.length}：#${routeId}`);
    if (options.refreshPricingCatalog) {
      await tokenRouter.refreshRouteWidePricingReferenceCosts(routeId, { refreshedKeys });
    }

    const decision = await tokenRouter.explainSelectionRouteWide(routeId);
    await saveRouteDecisionSnapshots([
      {
        routeId,
        snapshot: decision,
      },
    ]);
  }

  return {
    exactModelCount: exactModels.length,
    wildcardRouteCount: wildcardRouteIds.length,
  };
}
