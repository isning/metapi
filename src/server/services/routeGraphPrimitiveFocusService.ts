import { createRouteMacroSemanticNodeId } from '../../shared/routingIdentity.js';
import { lowerRouteGraphSource } from '../../shared/routeGraph.js';
import type {
  RouteGraphDiagnostic,
  RouteGraphMacro,
  RouteGraphNode,
  RouteGraphSource,
} from '../../shared/routeGraph.js';
import type {
  RouteGraphFocusedWorkspace,
  RouteGraphFocusRef,
} from '../../shared/routeGraphWorkspace.js';
import {
  collectRouteGraphFocusClosure,
  filterRouteGraphDiagnosticsForClosure,
  projectRouteGraphFocusedGraphWindow,
  RouteGraphWorkspaceFocusNotFoundError,
} from './routeGraphFocusProjectionService.js';
import {
  buildRouteGraphSemanticIndex,
  routeGraphSemanticElementLabel,
} from './routeGraphWorkspaceIndexService.js';

const PRIMITIVE_CORE_ROLE_RANK: Record<string, number> = {
  entry: 0,
  filter: 1,
  fallback_stage_dispatcher: 2,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function macroProvenance(node: RouteGraphNode): Record<string, unknown> | null {
  const provenance = isRecord(node.provenance) ? node.provenance : null;
  return provenance?.source === 'macro' ? provenance : null;
}

function primitiveRootForMacro(nodes: readonly RouteGraphNode[], macroId: string): RouteGraphNode | null {
  return nodes
    .map((node, sourceOrder) => ({ node, sourceOrder, provenance: macroProvenance(node) }))
    .filter((item) => item.provenance?.macroId === macroId && typeof item.provenance.role === 'string')
    .filter((item) => Object.hasOwn(PRIMITIVE_CORE_ROLE_RANK, String(item.provenance!.role)))
    .sort((left, right) => {
      const leftRank = PRIMITIVE_CORE_ROLE_RANK[String(left.provenance!.role)] ?? Number.MAX_SAFE_INTEGER;
      const rightRank = PRIMITIVE_CORE_ROLE_RANK[String(right.provenance!.role)] ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      const leftStage = isRecord(left.provenance!.fallbackStage)
        ? Number(left.provenance!.fallbackStage.index)
        : 0;
      const rightStage = isRecord(right.provenance!.fallbackStage)
        ? Number(right.provenance!.fallbackStage.index)
        : 0;
      return leftStage - rightStage || left.sourceOrder - right.sourceOrder;
    })[0]?.node || null;
}

export type RouteGraphPrimitiveFocusArtifact = {
  primitiveGraph: RouteGraphSource;
  sourceElementId: string;
  rootNodeId: string | null;
  label: string;
  subtitle: string | null;
  diagnostics: RouteGraphDiagnostic[];
  available: boolean;
};

function emptyPrimitiveWorkspace(input: {
  artifact: RouteGraphPrimitiveFocusArtifact;
  revision: string;
  focus: RouteGraphFocusRef;
}): RouteGraphFocusedWorkspace {
  return {
    revision: input.revision,
    representation: 'primitive',
    focus: { ...input.focus, label: input.artifact.label, subtitle: input.artifact.subtitle },
    residentGraph: {
      nodes: [],
      edges: [],
      macros: [],
      metadata: input.artifact.primitiveGraph.metadata,
    },
    residentElements: [],
    portals: [],
    diagnostics: input.artifact.diagnostics,
    totals: { nodes: 0, edges: 0, macros: 0 },
    capabilities: { editable: false, primitiveAvailable: false },
  };
}

function focusMacro(graph: RouteGraphSource, focus: RouteGraphFocusRef): RouteGraphMacro | null {
  if (focus.kind !== 'macro') return null;
  return (graph.macros || []).find((macro) => macro.id === focus.id) || null;
}

export function lowerRouteGraphPrimitiveFocus(input: {
  graph: RouteGraphSource;
  diagnostics: readonly RouteGraphDiagnostic[];
  focus: RouteGraphFocusRef;
}): RouteGraphPrimitiveFocusArtifact {
  const sourceIndex = buildRouteGraphSemanticIndex(input.graph);
  const macro = focusMacro(input.graph, input.focus);
  const sourceElementId = input.focus.kind === 'macro'
    ? macro ? createRouteMacroSemanticNodeId(macro.id) : null
    : sourceIndex.elementsById.has(input.focus.id) ? input.focus.id : null;
  if (!sourceElementId) throw new RouteGraphWorkspaceFocusNotFoundError(input.focus);
  const sourceElement = sourceIndex.elementsById.get(sourceElementId)!;
  const label = routeGraphSemanticElementLabel(sourceElement);
  const subtitle = macro?.kind || sourceElement.node?.type || null;
  const sourceClosure = collectRouteGraphFocusClosure(sourceElementId, sourceIndex, true);
  const dependencyNodeIds = new Set(
    [...sourceClosure.elementIds].filter((elementId) => sourceIndex.elementsById.get(elementId)?.node),
  );
  if (macro) {
    // Candidate resolver inputs are part of the focused Macro's compilation
    // closure even when a query-based group does not have authored edges.
    for (const node of input.graph.nodes) {
      if (node.type === 'route_endpoint') dependencyNodeIds.add(node.id);
    }
  }
  const loweringInput: RouteGraphSource = {
    nodes: input.graph.nodes.filter((node) => dependencyNodeIds.has(node.id)),
    edges: input.graph.edges.filter((edge) => sourceClosure.edgeIds.has(edge.id)),
    macros: macro ? [macro] : [],
    metadata: input.graph.metadata,
  };
  const lowered = lowerRouteGraphSource(loweringInput);
  const sourceDiagnostics = filterRouteGraphDiagnosticsForClosure(input.diagnostics, sourceClosure);
  const diagnostics = [...sourceDiagnostics, ...lowered.diagnostics];
  const primitiveGraph: RouteGraphSource = {
    ...lowered.primitiveSource,
    macros: [],
  };
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return {
      primitiveGraph,
      sourceElementId,
      rootNodeId: null,
      label,
      subtitle,
      diagnostics,
      available: false,
    };
  }

  const rootNode = macro
    ? primitiveRootForMacro(primitiveGraph.nodes, macro.id)
    : primitiveGraph.nodes.find((node) => node.id === input.focus.id) || null;
  if (!rootNode) {
    return {
      primitiveGraph,
      sourceElementId,
      rootNodeId: null,
      label,
      subtitle,
      diagnostics: [...diagnostics, {
        severity: 'warning',
        code: 'workspace.primitive_unavailable',
        message: 'The focused graph element does not produce a primitive route graph.',
        nodeId: sourceElementId,
      }],
      available: false,
    };
  }

  return {
    primitiveGraph,
    sourceElementId,
    rootNodeId: rootNode.id,
    label,
    subtitle,
    diagnostics,
    available: true,
  };
}

export function projectRouteGraphPrimitiveFocusArtifact(input: {
  artifact: RouteGraphPrimitiveFocusArtifact;
  revision: string;
  focus: RouteGraphFocusRef;
  windowToken?: string;
  collectionWindowSize?: number;
}): RouteGraphFocusedWorkspace {
  if (!input.artifact.available || !input.artifact.rootNodeId) {
    return emptyPrimitiveWorkspace(input);
  }

  return projectRouteGraphFocusedGraphWindow({
    graph: input.artifact.primitiveGraph,
    diagnostics: input.artifact.diagnostics,
    revision: input.revision,
    focus: input.focus,
    representation: 'primitive',
    startElementId: input.artifact.rootNodeId,
    focusLabel: input.artifact.label,
    focusSubtitle: input.artifact.subtitle,
    stopAtTraversalBoundaries: false,
    editable: false,
    primitiveAvailable: true,
    windowToken: input.windowToken,
    collectionWindowSize: input.collectionWindowSize,
  });
}

export function buildRouteGraphPrimitiveFocusedWorkspace(input: {
  graph: RouteGraphSource;
  diagnostics: readonly RouteGraphDiagnostic[];
  revision: string;
  focus: RouteGraphFocusRef;
  windowToken?: string;
  collectionWindowSize?: number;
}): RouteGraphFocusedWorkspace {
  return projectRouteGraphPrimitiveFocusArtifact({
    artifact: lowerRouteGraphPrimitiveFocus(input),
    revision: input.revision,
    focus: input.focus,
    windowToken: input.windowToken,
    collectionWindowSize: input.collectionWindowSize,
  });
}
