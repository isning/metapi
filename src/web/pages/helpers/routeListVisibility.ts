import type { RouteGraphBackendSpec, RouteGraphMatchSpec } from '../../../shared/routeGraph.js';

export type RouteListVisibilityItem = {
  id: number;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  presentation: { displayName: string | null };
  enabled: boolean;
};

function isRouteBackendReferences(route: Pick<RouteListVisibilityItem, 'backend'>): boolean {
  return route.backend.kind === 'routes';
}

function getRouteBackendRouteIds(route: Pick<RouteListVisibilityItem, 'backend'>): number[] {
  return route.backend.kind === 'routes' ? route.backend.routeIds : [];
}

function getRoutePattern(route: Pick<RouteListVisibilityItem, 'match'>): string {
  return route.match.requestedModelPattern || '';
}

function getRouteDisplayName(route: Pick<RouteListVisibilityItem, 'presentation' | 'match'>): string {
  return (route.presentation.displayName || route.match.displayName || '').trim();
}

function hasCustomDisplayName(route: Pick<RouteListVisibilityItem, 'match' | 'presentation'>): boolean {
  const displayName = getRouteDisplayName(route);
  const modelPattern = getRoutePattern(route).trim();
  return !!displayName && displayName !== modelPattern;
}

export function buildVisibleRouteList<T extends RouteListVisibilityItem>(
  routes: T[],
  isExactModelPattern: (pattern: string) => boolean,
  matchesModelPattern: (model: string, pattern: string) => boolean,
): T[] {
  const exactModelNames = new Set(
    routes
      .filter((route) => !isRouteBackendReferences(route) && isExactModelPattern(getRoutePattern(route)))
      .map((route) => getRoutePattern(route).trim())
      .filter(Boolean),
  );
  const coveringGroups = routes.filter((route) => (
    route.enabled
    && (
      (isRouteBackendReferences(route) && getRouteDisplayName(route).length > 0 && getRouteBackendRouteIds(route).length > 0)
      || (!isRouteBackendReferences(route) && !isExactModelPattern(getRoutePattern(route)) && hasCustomDisplayName(route))
    )
  ));

  if (coveringGroups.length === 0) return routes;

  return routes.filter((route) => {
    if (isRouteBackendReferences(route)) return true;
    if (!isExactModelPattern(getRoutePattern(route))) return true;
    if (hasCustomDisplayName(route)) return true;

    const exactModel = getRoutePattern(route).trim();
    if (!exactModel) return true;

    return !coveringGroups.some((groupRoute) => (
      groupRoute.id !== route.id
      && !exactModelNames.has(getRouteDisplayName(groupRoute))
      && (
        (isRouteBackendReferences(groupRoute) && getRouteBackendRouteIds(groupRoute).includes(route.id))
        || (!isRouteBackendReferences(groupRoute) && matchesModelPattern(exactModel, getRoutePattern(groupRoute)))
      )
    ));
  });
}
