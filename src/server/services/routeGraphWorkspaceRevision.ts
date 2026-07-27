import type { RouteGraphDraftState } from './routeGraphService.js';

export function formatRouteGraphWorkspaceRevision(
  draft: Pick<RouteGraphDraftState, 'id' | 'baseVersion' | 'revision'>,
): string {
  return `draft:${draft.id}:${draft.baseVersion || 0}:${draft.revision}`;
}
