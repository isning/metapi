import type {
  RouteGraphElementRef,
  RouteGraphWorkspaceRemovalImpact,
} from '../../shared/routeGraphWorkspace.js';
import { RouteGraphWorkspaceRevisionConflictError } from './routeGraphWorkspaceOperationsService.js';
import { routeGraphSemanticElementLabel } from './routeGraphWorkspaceIndexService.js';
import { getRouteGraphWorkspaceRevisionContext } from './routeGraphWorkspaceQueryService.js';

export class RouteGraphWorkspaceMutationError extends Error {
  constructor(readonly code: 'element_not_found' | 'element_not_authorable') {
    super(code);
    this.name = 'RouteGraphWorkspaceMutationError';
  }
}

export async function getRouteGraphWorkspaceRemovalImpact(input: {
  revision: string;
  element: RouteGraphElementRef;
}): Promise<RouteGraphWorkspaceRemovalImpact> {
  const { revision, semanticIndex } = await getRouteGraphWorkspaceRevisionContext();
  if (input.revision !== revision) throw new RouteGraphWorkspaceRevisionConflictError();
  const element = [...semanticIndex.elementsById.values()].find((candidate) => (
    candidate.ref.kind === input.element.kind && candidate.ref.id === input.element.id
  ));
  if (!element) throw new RouteGraphWorkspaceMutationError('element_not_found');
  if ((element.node || element.macro)?.ownership !== 'manual') {
    throw new RouteGraphWorkspaceMutationError('element_not_authorable');
  }
  const edges = semanticIndex.edgesByElementId.get(element.elementId) || [];
  return {
    revision,
    element: element.ref,
    elementLabel: routeGraphSemanticElementLabel(element),
    incidentConnections: {
      total: edges.length,
      incoming: edges.filter((edge) => edge.targetNodeId === element.elementId).length,
      outgoing: edges.filter((edge) => edge.sourceNodeId === element.elementId).length,
    },
  };
}
