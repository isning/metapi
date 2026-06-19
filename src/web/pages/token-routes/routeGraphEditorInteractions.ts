import { macroFlowNodeId } from './routeGraphConnections.js';
import type {
  RouteGraphEdge,
  RouteGraphMacro,
  RouteGraphNode,
} from './routeGraphTypes.js';

export type RouteGraphSourceLike = {
  version?: number;
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
  macros: RouteGraphMacro[];
  metadata?: Record<string, unknown>;
};

export type RouteGraphSelectionTarget =
  | { kind: 'graph' }
  | { kind: 'node'; nodeId: string }
  | { kind: 'edge'; edgeId: string }
  | { kind: 'port'; nodeId: string; portId: string }
  | { kind: 'macro'; macroId: string };

export type GraphElementSelection = {
  nodeIds: string[];
  edgeIds: string[];
};

export function selectionFromFlowNodeId(nodeId: string): RouteGraphSelectionTarget {
  return nodeId.startsWith('macro:')
    ? { kind: 'macro', macroId: nodeId.replace(/^macro:/, '') }
    : { kind: 'node', nodeId };
}

export function selectionFromFlowSelection(input: {
  nodeIds: string[];
  edgeIds: string[];
}): RouteGraphSelectionTarget | null {
  const nodeIds = input.nodeIds || [];
  const edgeIds = input.edgeIds || [];
  if (nodeIds.length === 0 && edgeIds.length === 0) return null;
  if (nodeIds.length === 1 && edgeIds.length === 0) return selectionFromFlowNodeId(nodeIds[0]!);
  if (edgeIds.length === 1 && nodeIds.length === 0) return { kind: 'edge', edgeId: edgeIds[0]! };
  const primaryNode = nodeIds[0];
  if (primaryNode) return selectionFromFlowNodeId(primaryNode);
  return { kind: 'edge', edgeId: edgeIds[0]! };
}

export function toggleGraphNodeSelection(
  current: GraphElementSelection,
  nodeId: string,
): GraphElementSelection {
  return {
    nodeIds: current.nodeIds.includes(nodeId)
      ? current.nodeIds.filter((item) => item !== nodeId)
      : [...current.nodeIds, nodeId],
    edgeIds: current.edgeIds,
  };
}

export function toggleGraphEdgeSelection(
  current: GraphElementSelection,
  edgeId: string,
): GraphElementSelection {
  return {
    nodeIds: current.nodeIds,
    edgeIds: current.edgeIds.includes(edgeId)
      ? current.edgeIds.filter((item) => item !== edgeId)
      : [...current.edgeIds, edgeId],
  };
}

export function selectionForContextMenu(input: {
  current: GraphElementSelection;
  target: RouteGraphSelectionTarget;
}): GraphElementSelection {
  const { current, target } = input;
  if (target.kind === 'node') {
    return current.nodeIds.includes(target.nodeId)
      ? current
      : { nodeIds: [target.nodeId], edgeIds: [] };
  }
  if (target.kind === 'macro') {
    const nodeId = macroFlowNodeId(target.macroId);
    return current.nodeIds.includes(nodeId)
      ? current
      : { nodeIds: [nodeId], edgeIds: [] };
  }
  if (target.kind === 'edge') {
    return current.edgeIds.includes(target.edgeId)
      ? current
      : { nodeIds: [], edgeIds: [target.edgeId] };
  }
  return current;
}

export function deleteSelectedGraphElements<TGraph extends RouteGraphSourceLike>(
  graph: TGraph,
  selection: RouteGraphSelectionTarget,
  graphSelection: GraphElementSelection,
): TGraph {
  const macroIdsToDelete = graphSelection.nodeIds
    .filter((nodeId) => nodeId.startsWith('macro:'))
    .map((nodeId) => nodeId.replace(/^macro:/, ''))
    .filter((macroId) => graph.macros.find((item) => item.id === macroId)?.ownership === 'manual');
  const nodeIdsToDelete = graphSelection.nodeIds.filter((nodeId) => {
    const node = graph.nodes.find((item) => item.id === nodeId);
    return node?.ownership === 'manual';
  });
  const edgeIdsToDelete = graphSelection.edgeIds.filter((edgeId) => {
    const edge = graph.edges.find((item) => item.id === edgeId);
    return edge?.ownership === 'manual';
  });

  if (nodeIdsToDelete.length === 0 && edgeIdsToDelete.length === 0 && selection.kind === 'node') {
    const node = graph.nodes.find((item) => item.id === selection.nodeId);
    if (node?.ownership === 'manual') nodeIdsToDelete.push(node.id);
  }
  if (nodeIdsToDelete.length === 0 && edgeIdsToDelete.length === 0 && selection.kind === 'edge') {
    const edge = graph.edges.find((item) => item.id === selection.edgeId);
    if (edge?.ownership === 'manual') edgeIdsToDelete.push(edge.id);
  }
  if (nodeIdsToDelete.length === 0 && edgeIdsToDelete.length === 0 && selection.kind === 'macro') {
    const macro = graph.macros.find((item) => item.id === selection.macroId);
    if (macro?.ownership === 'manual' && !macroIdsToDelete.includes(macro.id)) {
      macroIdsToDelete.push(macro.id);
    }
  }

  if (nodeIdsToDelete.length === 0 && edgeIdsToDelete.length === 0 && macroIdsToDelete.length === 0) {
    return graph;
  }

  const removedNodeIds = new Set(nodeIdsToDelete);
  const removedMacroFlowNodeIds = new Set(macroIdsToDelete.map(macroFlowNodeId));
  const removedEdgeIds = new Set(edgeIdsToDelete);
  return {
    ...graph,
    nodes: graph.nodes.filter((item) => !removedNodeIds.has(item.id)),
    macros: graph.macros.filter((item) => !macroIdsToDelete.includes(item.id)),
    edges: graph.edges.filter((edge) => (
      !removedNodeIds.has(edge.sourceNodeId)
      && !removedNodeIds.has(edge.targetNodeId)
      && !removedMacroFlowNodeIds.has(edge.sourceNodeId)
      && !removedMacroFlowNodeIds.has(edge.targetNodeId)
      && !removedEdgeIds.has(edge.id)
    )),
  } as TGraph;
}
