import {
  normalizeRouteGraphMacro,
  type RouteGraphMacro,
  type RouteGraphSource,
} from '../../shared/routeGraph.js';
import { synchronizeRouteGroupFacadeStageInput } from './routeGroupGraphFacadeAccessService.js';

export const AVAILABILITY_ROUTE_GROUP_OWNER = 'availability-rebuild';

export function isAvailabilityManagedRouteGroup(macro: RouteGraphMacro): boolean {
  return macro.kind === 'candidate_selector'
    && macro.ownership === 'system'
    && macro.metadata?.managementOwner === AVAILABILITY_ROUTE_GROUP_OWNER;
}

function normalizeAutomaticRouteGroup(macro: RouteGraphMacro): RouteGraphMacro {
  const { candidateSource: _candidateSource, ...config } = macro.config;
  return normalizeRouteGraphMacro({
    ...macro,
    config: {
      ...config,
      groups: config.groups.map((stage) => {
        const { acceptUnassigned: _acceptUnassigned, ...explicitStage } = stage;
        return synchronizeRouteGroupFacadeStageInput(explicitStage, false);
      }),
    },
    metadata: {
      ...macro.metadata,
      managementOwner: AVAILABILITY_ROUTE_GROUP_OWNER,
    },
  });
}

/**
 * Converts historical system-owned Route Groups to the explicit candidate set
 * produced by availability rebuilds. Manual dynamic selectors are untouched.
 */
export function normalizeAvailabilityManagedRouteGroups(
  source: RouteGraphSource,
): {
  source: RouteGraphSource;
  changed: boolean;
  migratedRouteGroups: number;
} {
  let migratedRouteGroups = 0;
  const macros = (source.macros || []).map((macro) => {
    if (
      macro.kind !== 'candidate_selector'
      || macro.ownership !== 'system'
      || (
        !macro.config.candidateSource
        && macro.metadata?.managementOwner !== AVAILABILITY_ROUTE_GROUP_OWNER
      )
    ) return macro;
    const normalized = normalizeAutomaticRouteGroup(macro);
    if (JSON.stringify(normalized) === JSON.stringify(macro)) return macro;
    migratedRouteGroups += 1;
    return normalized;
  });
  if (migratedRouteGroups === 0) {
    return { source, changed: false, migratedRouteGroups: 0 };
  }
  return {
    source: { ...source, macros },
    changed: true,
    migratedRouteGroups,
  };
}
