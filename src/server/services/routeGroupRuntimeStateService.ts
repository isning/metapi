import { clearRouteRuntimeExecutionAttemptFailureState } from './routeRuntimeExecutionService.js';
import { getActiveRouteGraphSourceVersion } from './routeGraphService.js';
import { executionTargetIdForRouteGraphEndpoint } from './routeGraphExecutionTargetEndpointService.js';
import { RouteGroupCommandError } from './routeGroupCommandError.js';

function normalizeGroupKey(input: unknown): string {
  return String(input || '').trim();
}

export async function clearRouteGroupFailureState(groupKeyInput: unknown): Promise<{
  success: true;
  routeGroupKey: string;
  clearedExecutionTargets: number;
}> {
  const routeGroupKey = normalizeGroupKey(groupKeyInput);
  if (!routeGroupKey) throw new RouteGroupCommandError('invalid_route_group_payload', { field: 'id' });

  const active = await getActiveRouteGraphSourceVersion();
  const group = (active?.sourceGraph.macros || []).find((macro) => macro.id === routeGroupKey && macro.kind === 'candidate_selector');
  if (!group) throw new RouteGroupCommandError('route_group_not_found');
  const endpointsById = new Map(active!.sourceGraph.nodes.map((node) => [node.type === 'route_endpoint' ? node.routeEndpointId : node.id, node]));
  const executionTargetIdSet = new Set<number>();
  for (const stage of group.config.groups) {
    for (const member of stage.members || []) {
      const id = executionTargetIdForRouteGraphEndpoint(endpointsById.get(member.endpointId || ''));
      if (id) executionTargetIdSet.add(id);
    }
  }
  const executionTargetIds = [...executionTargetIdSet];

  const clearedExecutionTargets = executionTargetIds.length > 0
    ? await clearRouteRuntimeExecutionAttemptFailureState(executionTargetIds)
    : 0;
  return { success: true, routeGroupKey, clearedExecutionTargets };
}
