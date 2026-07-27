import type {
  CompiledRouteGraph,
  CandidateSelectorMacroConfig,
  RouteGraphDiagnostic,
  RouteGraphEdge,
  RouteGraphMacro,
  RouteGraphNode,
  RouteGraphSource,
} from './routeGraph.js';
import type {
  RouteGraphElementRef,
  RouteGraphWorkspaceConnectionEndpointRef,
  RouteGraphWorkspaceRemovalImpact,
} from './routeGraphWorkspace.js';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type AuthoringExisting<T extends { id: string }> = T & { localRef?: never };
type AuthoringNew<T extends { id: string }> = DistributiveOmit<T, 'id'> & { id?: never; localRef: string };

export type RouteGraphWorkspaceNodeDraft = DistributiveOmit<RouteGraphNode, 'id' | 'ownership'> & {
  ownership: 'manual';
};

export type RouteGraphWorkspaceMacroDraft = Omit<RouteGraphMacro, 'id' | 'ownership' | 'config'> & {
  ownership: 'manual';
  config: Omit<CandidateSelectorMacroConfig, 'surface'> & {
    surface: Omit<CandidateSelectorMacroConfig['surface'], 'ports'> & {
      ports?: CandidateSelectorMacroConfig['surface']['ports'];
    };
  };
};

export type RouteGraphWorkspaceOperation =
  | { kind: 'upsert_node'; node: RouteGraphNode }
  | { kind: 'remove_node'; nodeId: string }
  | { kind: 'upsert_macro'; macro: RouteGraphMacro }
  | { kind: 'remove_macro'; macroId: string }
  | { kind: 'upsert_edge'; edge: RouteGraphEdge }
  | { kind: 'remove_edge'; edgeId: string };

export type RouteGraphWorkspaceOperationBatch = {
  id: number;
  sourceRevision: string;
  resultRevision: string;
  forwardOperations: RouteGraphWorkspaceOperation[];
  inverseOperations: RouteGraphWorkspaceOperation[];
  createdAt: string | null;
};

export type RouteGraphWorkspaceOperationsCommand = {
  revision: string;
  operations: RouteGraphWorkspaceOperation[];
};

export type RouteGraphWorkspaceNodeCreateCommand = {
  revision: string;
  node: RouteGraphWorkspaceNodeDraft;
};

export type RouteGraphWorkspaceNodeReservationCommand = {
  node: RouteGraphWorkspaceNodeDraft;
};

export type RouteGraphWorkspaceMacroCreateCommand = {
  revision: string;
  macro: RouteGraphWorkspaceMacroDraft;
};

export type RouteGraphWorkspaceConnectionCreateCommand = {
  revision: string;
  first: RouteGraphWorkspaceConnectionEndpointRef;
  second: RouteGraphWorkspaceConnectionEndpointRef;
  replacingEdgeId?: string | null;
};

export type RouteGraphWorkspaceConnectionDraftCommand = RouteGraphWorkspaceConnectionCreateCommand & {
  operations: RouteGraphWorkspaceOperation[];
};

export type RouteGraphWorkspaceRemovalImpactCommand = {
  revision: string;
  element: RouteGraphElementRef;
};

export type RouteGraphWorkspaceOperationBatchReplayCommand = {
  revision: string;
  direction: 'undo' | 'replay';
};

export type RouteGraphWorkspaceMutationResponse = {
  success: true;
  revision: string;
  batchId: number;
};

export type RouteGraphWorkspaceNodeCreateResponse = RouteGraphWorkspaceMutationResponse & {
  node: RouteGraphNode;
};

export type RouteGraphWorkspaceNodeReservationResponse = {
  node: RouteGraphNode;
};

export type RouteGraphWorkspaceConnectionDraftResponse = {
  edge: RouteGraphEdge;
};

export type RouteGraphWorkspaceMacroCreateResponse = RouteGraphWorkspaceMutationResponse & {
  macro: RouteGraphMacro;
};

export type RouteGraphWorkspaceConnectionCreateResponse = RouteGraphWorkspaceMutationResponse & {
  edge: RouteGraphEdge;
};

export type RouteGraphWorkspaceRemovalImpactResponse = RouteGraphWorkspaceRemovalImpact & {
  success: true;
};

export type RouteGraphWorkspaceValidationResponse = {
  ok: boolean;
  diagnostics: RouteGraphDiagnostic[];
  compiledGraph: CompiledRouteGraph;
};

export type RouteGraphWorkspaceCommandError = {
  success: false;
  code: string;
  message?: string;
  params?: Record<string, unknown>;
  stale?: boolean;
};

export type RouteGraphAuthoringElementRef =
  | { kind: 'node' | 'macro'; id: string; localRef?: never }
  | { kind: 'node' | 'macro'; id?: never; localRef: string };

type NewRouteEndpointNode = Omit<
  Extract<RouteGraphNode, { type: 'route_endpoint' }>,
  'id' | 'routeEndpointId'
> & { id?: never; routeEndpointId?: never; localRef: string };

type NewNonEndpointNode = AuthoringNew<Exclude<RouteGraphNode, { type: 'route_endpoint' }>>;

export type RouteGraphAuthoringNode =
  | AuthoringExisting<RouteGraphNode>
  | NewRouteEndpointNode
  | NewNonEndpointNode;

export type RouteGraphAuthoringMacro =
  | AuthoringExisting<RouteGraphMacro>
  | AuthoringNew<RouteGraphMacro>;

export type RouteGraphAuthoringEdge = {
  id?: string;
  localRef?: string;
  source: RouteGraphAuthoringElementRef;
  sourcePortId: string;
  target: RouteGraphAuthoringElementRef;
  targetPortId: string;
  kind: RouteGraphEdge['kind'];
  ownership: RouteGraphEdge['ownership'];
  metadata?: Record<string, unknown>;
};

export type RouteGraphAuthoringCommand = {
  nodes: RouteGraphAuthoringNode[];
  macros?: RouteGraphAuthoringMacro[];
  edges: RouteGraphAuthoringEdge[];
  metadata?: Record<string, unknown>;
};

export type RouteGraphValidationResponse = RouteGraphWorkspaceValidationResponse;

export type RouteGraphDraftState = {
  id: number;
  baseVersion: number | null;
  revision: number;
  status: string;
  workingGraph: RouteGraphSource;
  diagnostics: RouteGraphDiagnostic[];
  updatedAt: string | null;
  stale: boolean;
};

export type RouteGraphDraftReadResponse = {
  activeVersion: {
    id: number;
    version: number;
    status: string;
    createdAt: string | null;
    activatedAt: string | null;
    sourceGraph: RouteGraphSource;
  };
  draft: RouteGraphDraftState;
  history: unknown[];
};

export type RouteGraphDraftSaveResponse = {
  success: true;
  draft: RouteGraphDraftState;
};
