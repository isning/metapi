export type RouteGroupPublicExposureRow = {
  id?: number | null;
  kind?: string | null;
  groupKey?: string | null;
  upstreamModelName?: string | null;
  normalizedModelName?: string | null;
  publicModelName?: string | null;
  displayName?: string | null;
  visibility?: string | null;
  enabled?: boolean | null;
  syncStatus?: string | null;
};

export type RouteGroupPublicExposureConflict = {
  key: string;
  first: RouteGroupPublicExposureRow;
  next: RouteGroupPublicExposureRow;
};

export class RouteGroupPublicExposureConflictError extends RouteGroupCommandError {
  conflict: RouteGroupPublicExposureConflict;

  constructor(conflict: RouteGroupPublicExposureConflict) {
    super('public_model_conflict', {
      modelName: conflict.key,
      existingRouteGroupId: describeRouteGroup(conflict.first),
      conflictingRouteGroupId: describeRouteGroup(conflict.next),
    });
    this.name = 'RouteGroupPublicExposureConflictError';
    this.conflict = conflict;
  }
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export function normalizeRouteGroupPublicModelKey(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

export function routeGroupPublicModelName(group: RouteGroupPublicExposureRow): string {
  return normalizeText(group.publicModelName)
    || normalizeText(group.upstreamModelName)
    || normalizeText(group.normalizedModelName);
}

export function routeGroupPublicExposureKey(group: RouteGroupPublicExposureRow): string {
  return normalizeRouteGroupPublicModelKey(routeGroupPublicModelName(group));
}

export function isRouteGroupPubliclyExposed(group: RouteGroupPublicExposureRow): boolean {
  return group.visibility !== 'internal'
    && group.enabled !== false
    && group.syncStatus !== 'unresolved'
    && !!routeGroupPublicExposureKey(group);
}

export function findRouteGroupPublicExposureConflicts(
  groups: RouteGroupPublicExposureRow[],
): RouteGroupPublicExposureConflict[] {
  const firstByKey = new Map<string, RouteGroupPublicExposureRow>();
  const conflicts: RouteGroupPublicExposureConflict[] = [];
  for (const group of groups) {
    if (!isRouteGroupPubliclyExposed(group)) continue;
    const key = routeGroupPublicExposureKey(group);
    const first = firstByKey.get(key);
    if (!first) {
      firstByKey.set(key, group);
      continue;
    }
    conflicts.push({ key, first, next: group });
  }
  return conflicts;
}

function describeRouteGroup(group: RouteGroupPublicExposureRow): string {
  return normalizeText(group.groupKey)
    || (group.id != null ? `#${group.id}` : '')
    || routeGroupPublicModelName(group)
    || 'unknown route group';
}

export function formatRouteGroupPublicExposureConflict(conflict: RouteGroupPublicExposureConflict): string {
  return `Public model name "${conflict.key}" is already exposed by route group ${describeRouteGroup(conflict.first)} and cannot also be exposed by route group ${describeRouteGroup(conflict.next)}.`;
}

export function assertNoRouteGroupPublicExposureConflicts(groups: RouteGroupPublicExposureRow[]): void {
  const conflicts = findRouteGroupPublicExposureConflicts(groups);
  if (conflicts.length === 0) return;
  throw new RouteGroupPublicExposureConflictError(conflicts[0]);
}
import { RouteGroupCommandError } from './routeGroupCommandError.js';
