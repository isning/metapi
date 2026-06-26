export type RouteGraphMatchKind = 'model';
export type RouteGraphBackendKind = 'supply' | 'routes';
export type RouteGraphNodeType =
  | 'entry'
  | 'route_endpoint'
  | 'filter'
  | 'dispatcher'
  | 'synthetic_endpoint'
  | 'auto_node';
export type RouteGraphVisibility = 'public' | 'internal';
export type RouteGraphEndpointKind = 'supply' | 'route_product';
export type RouteGraphEndpointExposure = 'none' | 'public' | 'internal';
export type RouteGraphEndpointResolutionStatus = 'resolved' | 'degraded' | 'unresolved';
export type RouteGraphEndpointSourceKind =
  | 'upstream_model'
  | 'automatic_model_group'
  | 'manual_group'
  | 'synthetic'
  | 'inline';
export type RouteGraphOwnership = 'manual' | 'auto_generated' | 'system' | 'derived';
export type RouteGraphSelectionStrategy = 'priority_order' | 'weighted' | 'round_robin' | 'stable_first';
export type RouteGraphPortKind =
  | 'request'
  | 'bidirect'
  | 'route'
  | 'response'
  | 'control'
  | 'metrics';
export type RouteGraphEdgeKind =
  | 'request_flow'
  | 'bidirect_flow'
  | 'route_flow'
  | 'response_flow'
  | 'control_flow'
  | 'metrics_link';
export type RouteGraphPort = {
  id: string;
  label: string;
  direction: 'input' | 'output';
  kind: RouteGraphPortKind;
  accepts?: RouteGraphPortKind[];
  required?: boolean;
  multiple?: boolean;
  collection?: { type: 'single' } | { type: 'arr'; min?: number; max?: number } | { type: 'set'; min?: number; max?: number };
  readonly?: boolean;
  enabled?: boolean;
  description?: string;
};

export type RouteGraphMatchSpec = {
  kind: RouteGraphMatchKind;
  requestedModelPattern: string;
  currentModelPattern?: string;
  displayName: string | null;
  downstreamProtocol?: string | null;
  upstreamProtocol?: string | null;
  sitePlatform?: string | null;
  routeId?: number | null;
  accountId?: number | null;
  tokenId?: number | null;
  siteId?: number | null;
};

export type RouteGraphBackendSpec =
  | { kind: 'supply' }
  | { kind: 'routes'; routeIds: number[] };

export type RouteNodeProvenance =
  | { source: 'manual' }
  | { source: 'auto_model_availability'; modelName: string }
  | { source: 'preset'; presetId: string }
  | { source: 'import'; importId: string }
  | { source: 'legacy'; routeId: number }
  | Record<string, unknown>;

export type RouteGraphPosition = { x: number; y: number };
export type BaseRouteGraphNode = {
  id: string;
  type: RouteGraphNodeType;
  name?: string | null;
  enabled: boolean;
  visibility: RouteGraphVisibility;
  ownership: RouteGraphOwnership;
  position?: RouteGraphPosition;
  provenance?: RouteNodeProvenance;
  dynamicPorts?: RouteGraphPort[];
};

export type EntryNode = BaseRouteGraphNode & {
  type: 'entry';
  visibility: 'public';
  match: RouteGraphMatchSpec;
  selectionStrategy: RouteGraphSelectionStrategy;
};

export type RouteEndpointNode = BaseRouteGraphNode & {
  type: 'route_endpoint';
  routeEndpointId: string;
  endpointId?: string;
  routeId?: number | null;
  legacyRouteId?: number | null;
  endpointKind: RouteGraphEndpointKind;
  exposure: RouteGraphEndpointExposure;
  resolutionStatus: RouteGraphEndpointResolutionStatus;
  ownerKind: 'automatic_route' | 'manual_route' | 'macro';
  sourceKind: RouteGraphEndpointSourceKind;
  resolvesTo?: {
    kind: 'route_builder' | 'synthetic' | 'external';
    id: string;
  };
  backend: RouteGraphBackendSpec;
  match?: RouteGraphMatchSpec;
  config?: RouteExecutableTargetConfig | Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type RouteFilter =
  | { type: 'rewrite_model'; source: 'current_model' | 'upstream_model'; operation: 'strip_suffix' | 'set'; suffix?: string; value?: string }
  | { type: 'set_payload'; path: string; value: unknown; mode?: 'default' | 'override' }
  | { type: 'remove_payload'; path: string }
  | { type: 'set_header'; name: string; value: string; mode?: 'default' | 'override' }
  | { type: 'remove_header'; name: string }
  | { type: 'set_endpoint_preference'; endpoint: 'chat' | 'messages' | 'responses' };

export type FilterNode = BaseRouteGraphNode & {
  type: 'filter';
  operations: RouteFilter[];
};

export type DispatcherPolicy =
  | {
      strategy: 'priority_order' | 'weighted' | 'round_robin' | 'stable_first';
      score?: unknown;
      fallback?: unknown;
    }
  | {
      strategy: 'direct';
      select: string;
      fallback?: unknown;
    };

export type DispatcherNode = BaseRouteGraphNode & {
  type: 'dispatcher';
  mode: 'route' | 'flow';
  ordering?: 'explicit';
  policy: DispatcherPolicy;
};

export type RouteExecutableTarget = {
  targetId: string;
  model: string;
  modelSource?: 'fixed' | 'request';
  enabled?: boolean;
  tokenId?: string | number | null;
  accountId?: string | number | null;
  siteId?: string | number | null;
  weight?: number | null;
  priority?: number | null;
  metadata?: Record<string, unknown>;
  compatibilityPolicy?: Record<string, unknown>;
};

export type RouteExecutableTargetConfig = {
  targets: RouteExecutableTarget[];
  targetSelection?: {
    strategy: RouteGraphSelectionStrategy | 'direct' | 'defer_to_router';
    score?: unknown;
    fallback?: unknown;
    select?: string;
  };
  compatibilityPolicy?: Record<string, unknown>;
};

export type SyntheticEndpointNode = BaseRouteGraphNode & {
  type: 'synthetic_endpoint';
  statusCode: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503;
  message: string;
  headers?: Record<string, unknown>;
  body?: unknown;
};

export type AutoNode = BaseRouteGraphNode & {
  type: 'auto_node';
  routeEndpointId?: string;
  routingStrategy?: 'weighted' | 'round_robin' | 'stable_first';
  legacyRouteId?: number | null;
};

export type RouteGraphNode =
  | EntryNode
  | RouteEndpointNode
  | FilterNode
  | DispatcherNode
  | SyntheticEndpointNode
  | AutoNode;

export type RouteGraphEdge = {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  kind: RouteGraphEdgeKind;
  ownership: RouteGraphOwnership;
  metadata?: Record<string, unknown>;
};

export type CandidateSelectorMacroConfig = {
  surface: {
    entry:
      | { kind: 'external'; visibility: RouteGraphVisibility; match: RouteGraphMatchSpec }
      | { kind: 'embedded'; input: 'request' | 'bidirect' };
    output: 'route' | 'bidirect';
    ports: RouteGraphPort[];
  };
  policy: {
    strategy: RouteGraphSelectionStrategy | 'cel_select' | 'cel_score';
    cel?: string;
  };
  filters?: {
    operations: RouteFilter[];
  };
  groups: Array<{
    id: string;
    label?: string;
    enabled: boolean;
    priority: number;
    input:
      | { kind: 'route_endpoints'; endpointIds: string[] }
      | { kind: 'model_pattern'; pattern: string }
      | { kind: 'metadata_query'; cel: string }
      | { kind: 'endpoint_query'; cel: string }
      | { kind: 'inline_endpoints'; endpoints: RouteExecutableTarget[] }
      | { kind: 'synthetic'; statusCode: SyntheticEndpointNode['statusCode']; message: string };
    defaults?: {
      enabled?: boolean;
      weight?: number;
      priority?: number;
      metadata?: Record<string, unknown>;
    };
    materialization?: {
      sort?: 'route_id' | 'model_name' | 'health' | 'cel';
      limit?: number;
      dedupeBy?: 'route_id' | 'endpoint_id' | 'model' | 'metadata';
    };
    metadata?: Record<string, unknown>;
  }>;
  candidateOverrides?: {
    bySupplyEndpointId?: Record<string, CandidateOverride>;
    byEndpointId?: Record<string, CandidateOverride>;
  };
  presentation?: { displayIcon?: string | null };
};

export type CandidateOverride = {
  groupId?: string;
  priority?: number;
  weight?: number;
  enabled?: boolean;
  excluded?: boolean;
};

export type RouteGraphMacro = {
  id: string;
  kind: 'candidate_selector';
  enabled: boolean;
  visibility: RouteGraphVisibility;
  ownership: Exclude<RouteGraphOwnership, 'derived'>;
  name?: string | null;
  config: CandidateSelectorMacroConfig;
  position?: RouteGraphPosition;
  metadata?: Record<string, unknown>;
};

export type RouteGraphSource = {
  version: 2;
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
  macros?: RouteGraphMacro[];
  metadata?: Record<string, unknown>;
};

export type RouteGraphDiagnostic = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
};

export type RouteProgramSourceRef = {
  nodeId?: string;
  edgeId?: string;
  macroId?: string;
  endpointId?: string;
  routeId?: number | null;
  generatedNodeIds?: string[];
  generatedEdgeIds?: string[];
};

export type RouteMatcherTarget = {
  programId: string;
  entryNodeId: string;
  publicModelName: string;
  rootEndpointId?: string | null;
  sourceRef: RouteProgramSourceRef;
};

export type RouteMatcherPattern = RouteMatcherTarget & {
  pattern: string;
  patternKind: 'wildcard' | 'regex';
};

export type RouteMatcherTable = {
  exact: Record<string, RouteMatcherTarget>;
  normalizedExact: Record<string, RouteMatcherTarget>;
  patterns: RouteMatcherPattern[];
};

export type CompiledEndpointTarget = {
  endpointId: string;
  targetId: string;
  nodeId: string;
  targetId: string;
  model: string;
  modelSource?: 'fixed' | 'request';
  enabled: boolean;
  routeId: number | null;
  accountId?: string | number | null;
  tokenId?: string | number | null;
  siteId?: string | number | null;
  weight?: number | null;
  priority?: number | null;
  metadata?: Record<string, unknown>;
  compatibilityPolicy?: Record<string, unknown>;
  sourceRef: RouteProgramSourceRef;
};

export type RouteProgramCandidate = {
  id: string;
  kind?: 'route' | 'bidirect' | 'target';
  nodeId?: string;
  edgeId?: string;
  endpointId?: string;
  targetOpId?: string;
  targetRef?: CompiledEndpointTarget;
  enabled: boolean;
  weight: number;
  priority: number;
  metadata?: Record<string, unknown>;
  sourceRef: RouteProgramSourceRef;
};

export type RouteProgramOp =
  | {
      id: string;
      op: 'filter';
      phase: 'pre_selection' | 'post_build';
      nodeId: string;
      operations: RouteFilter[];
      nextOpId?: string | null;
      sourceRef: RouteProgramSourceRef;
    }
  | {
      id: string;
      op: 'dispatch';
      mode: 'route' | 'flow' | 'target';
      nodeId: string;
      policy: DispatcherPolicy;
      candidates: RouteProgramCandidate[];
      sourceRef: RouteProgramSourceRef;
    }
  | {
      id: string;
      op: 'call_product';
      endpointId: string;
      nextOpId?: string | null;
      sourceRef: RouteProgramSourceRef;
    }
  | {
      id: string;
      op: 'select_supply';
      endpointId: string;
      nodeId: string;
      routeId: number | null;
      routeEndpointId?: string | null;
      terminalModel?: string;
      targetSelectionPolicy?: Record<string, unknown>;
      targets: CompiledEndpointTarget[];
      compatibilityPolicy?: Record<string, unknown>;
      sourceRef: RouteProgramSourceRef;
    }
  | {
      id: string;
      op: 'synthetic';
      nodeId: string;
      statusCode: number;
      message: string;
      sourceRef: RouteProgramSourceRef;
    };

export type RouteProgram = {
  id: string;
  entryNodeId: string;
  publicModelName: string;
  enabled: boolean;
  rootEndpointId?: string | null;
  startOpId?: string | null;
  ops: RouteProgramOp[];
  sourceRef: RouteProgramSourceRef;
};

export type RouteProgramEndpoint = {
  endpointId: string;
  nodeId: string;
  enabled: boolean;
  endpointKind: RouteGraphEndpointKind;
  exposure: RouteGraphEndpointExposure;
  resolutionStatus: RouteGraphEndpointResolutionStatus;
  ownerKind: 'automatic_route' | 'manual_route' | 'macro';
  sourceKind: RouteGraphEndpointSourceKind;
  routeId: number | null;
  publicModelName: string;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  resolvesTo?: {
    kind: 'route_builder' | 'synthetic' | 'external';
    id: string;
  };
  targetRefs: string[];
  sourceRef: RouteProgramSourceRef;
};

export type RouteProgramEndpointCatalog = {
  byId: Record<string, RouteProgramEndpoint>;
  productToProgram: Record<string, string>;
  supplyTargets: Record<string, CompiledEndpointTarget[]>;
};

export type RouteProgramDiagnostic = RouteGraphDiagnostic & {
  sourceRef?: RouteProgramSourceRef;
};

export type RouteProgramDebugInfo = {
  sourceHash: string;
  primitiveHash: string;
  sourceRefs: Record<string, RouteProgramSourceRef>;
  generatedByMacro: Record<string, { nodeIds: string[]; edgeIds: string[] }>;
};

export type RouteProgramBundleV3 = {
  version: 3;
  hash: string;
  matcher: RouteMatcherTable;
  programs: RouteProgram[];
  endpointCatalog: RouteProgramEndpointCatalog;
  debug: RouteProgramDebugInfo;
  diagnostics: RouteProgramDiagnostic[];
};

export type RouteFlatFilterStage = {
  nodeId: string;
  phase: 'pre_selection' | 'post_build';
  operations: RouteFilter[];
  sourceRef: RouteProgramSourceRef;
};

export type RouteFlatTerminal =
  | {
      kind: 'supply';
      endpointId: string;
      nodeId: string;
      routeId: number | null;
      routeEndpointId?: string | null;
      terminalModel?: string;
      targetSelectionPolicy?: Record<string, unknown>;
      targets: CompiledEndpointTarget[];
      compatibilityPolicy?: Record<string, unknown>;
      sourceRef: RouteProgramSourceRef;
    }
  | {
      kind: 'synthetic';
      nodeId: string;
      statusCode: 429 | 503;
      message: string;
      sourceRef: RouteProgramSourceRef;
    };

export type RouteFlatDecision =
  | {
      kind: 'dispatch';
      filterStages: RouteFlatFilterStage[];
      dispatch: RouteFlatDispatchPlan;
    }
  | {
      kind: 'terminal';
      filterStages: RouteFlatFilterStage[];
      terminal: RouteFlatTerminal;
    };

export type RouteFlatCandidate = {
  id: string;
  kind: 'route' | 'bidirect' | 'target';
  nodeId?: string;
  edgeId?: string;
  endpointId?: string;
  enabled: boolean;
  weight: number;
  priority: number;
  order: number;
  metadata?: Record<string, unknown>;
  sourceRef: RouteProgramSourceRef;
  next: RouteFlatDecision;
  terminalKind: 'supply' | 'synthetic' | 'dispatch';
  targetCount: number;
  enabledTargetCount: number;
};

export type RouteFlatDispatchPlan = {
  id: string;
  nodeId: string;
  mode: 'route' | 'flow' | 'target';
  policy: DispatcherPolicy;
  candidates: RouteFlatCandidate[];
  enabledCandidateCount: number;
  sourceRef: RouteProgramSourceRef;
};

export type RouteFlatProgram = {
  id: string;
  entryNodeId: string;
  publicModelName: string;
  enabled: boolean;
  rootEndpointId?: string | null;
  start: RouteFlatDecision | null;
  sourceRef: RouteProgramSourceRef;
};

export type RouteProgramBundleV4 = {
  version: 4;
  hash: string;
  matcher: RouteMatcherTable;
  programs: RouteFlatProgram[];
  endpointCatalog: RouteProgramEndpointCatalog;
  debug: RouteProgramDebugInfo;
  diagnostics: RouteProgramDiagnostic[];
};

export type CompiledRouteGraph = {
  version: 2;
  hash: string;
  programBundle: RouteProgramBundleV3;
  flatProgramBundle: RouteProgramBundleV4;
  entries: Array<{
    nodeId: string;
    enabled: boolean;
    visibility: RouteGraphVisibility;
    match: RouteGraphMatchSpec;
    backend: RouteGraphBackendSpec;
    selectionStrategy: RouteGraphSelectionStrategy;
    publicModelName: string;
  }>;
  routeEndpoints: Array<{
    nodeId: string;
    endpointId: string;
    routeId: number | null;
    enabled: boolean;
    endpointKind: RouteGraphEndpointKind;
    exposure: RouteGraphEndpointExposure;
    resolutionStatus: RouteGraphEndpointResolutionStatus;
    ownerKind: 'automatic_route' | 'manual_route' | 'macro';
    sourceKind: RouteGraphEndpointSourceKind;
    resolvesTo?: {
      kind: 'route_builder' | 'synthetic' | 'external';
      id: string;
    };
    backend: RouteGraphBackendSpec;
    match: RouteGraphMatchSpec;
    publicModelName: string;
  }>;
  nodesById: Record<string, RouteGraphNode>;
  edgesBySource: Record<string, string[]>;
  edgesByFromPort: Record<string, RouteGraphEdge[]>;
  terminals: Array<{
    nodeId: string;
    type: 'route_endpoint' | 'synthetic_endpoint' | 'auto_node';
    routeEndpointId: string;
    legacyRouteId: number | null;
    routingStrategy: string;
    statusCode: number | null;
    message: string | null;
  }>;
  publicModels: Array<{ nodeId: string; model: string }>;
};

export type RouteGraphCompileResult = {
  version: 2;
  source: RouteGraphSource;
  primitiveSource?: RouteGraphSource;
  compiled: CompiledRouteGraph;
  diagnostics: RouteGraphDiagnostic[];
  ok: boolean;
};

export const ROUTE_GRAPH_SCHEMA_VERSION: 2;
export const ROUTE_PROGRAM_BUNDLE_VERSION: 3;
export const ROUTE_FLAT_PROGRAM_BUNDLE_VERSION: 4;
export const ROUTE_GRAPH_MATCH_KIND_MODEL: 'model';
export const ROUTE_GRAPH_BACKEND_KIND_SUPPLY: 'supply';
export const ROUTE_GRAPH_BACKEND_KIND_ROUTES: 'routes';
export const ROUTE_GRAPH_NODE_TYPES: readonly RouteGraphNodeType[];
export const ROUTE_GRAPH_TERMINAL_NODE_TYPES: readonly ('route_endpoint' | 'synthetic_endpoint' | 'auto_node')[];
export const ROUTE_GRAPH_SELECTION_STRATEGIES: readonly RouteGraphSelectionStrategy[];
export const ROUTE_GRAPH_VISIBILITIES: readonly RouteGraphVisibility[];
export const ROUTE_GRAPH_OWNERSHIPS: readonly RouteGraphOwnership[];
export const ROUTE_GRAPH_PORT_KINDS: readonly RouteGraphPortKind[];
export const ROUTE_GRAPH_EDGE_KINDS: readonly RouteGraphEdgeKind[];
export const ROUTE_GRAPH_MACRO_KINDS: readonly ('candidate_selector')[];

export function normalizeRouteGraphMatchSpec(input: unknown): RouteGraphMatchSpec;
export function normalizeRouteGraphBackendSpec(input: unknown): RouteGraphBackendSpec;
export function parseRouteGraphMatchSpec(raw: string | null | undefined): RouteGraphMatchSpec;
export function parseRouteGraphBackendSpec(raw: string | null | undefined): RouteGraphBackendSpec;
export function stringifyRouteGraphMatchSpec(spec: unknown): string;
export function stringifyRouteGraphBackendSpec(spec: unknown): string;
export function buildRouteGraphSpecsFromLegacyRoute(input: {
  routeMode?: unknown;
  modelPattern?: unknown;
  displayName?: unknown;
  sourceRouteIds?: unknown;
}): { matchSpec: RouteGraphMatchSpec; backendSpec: RouteGraphBackendSpec };
export function deriveLegacyRouteModeFromBackendSpec(backendSpec: unknown): 'pattern' | 'explicit_group';
export function deriveLegacyModelPatternFromSpecs(matchSpec: unknown, backendSpec: unknown): string;
export function deriveLegacySourceRouteIdsFromBackendSpec(backendSpec: unknown): number[];
export function getRouteGraphExposedModelName(matchSpec: unknown, backendSpec: unknown): string;
export function isRouteGraphExactModelMatch(matchSpec: unknown, backendSpec: unknown): boolean;
export function routeGraphMatchesRequestedModel(model: string, matchSpec: unknown, backendSpec: unknown): boolean;
export function legacyRouteIdToRouteGraphEntryNodeId(routeId: number): string;
export function routeGraphRouteProductEndpointIdFromRoute(routeId: number): string;
export function routeGraphSupplyEndpointIdFromRoute(routeId: number): string;
export function routeGraphSupplyEndpointIdFromIdentity(identity: unknown, fallbackRouteId: number): string;
export function routeGraphAutoModelProductEndpointId(canonicalModelKey: string): string;
export function getRouteGraphNodePorts(nodeInput: unknown): RouteGraphPort[];
export function getRouteGraphNodePort(nodeInput: unknown, portId: string): RouteGraphPort | null;
export function getRouteGraphMacroPorts(macroInput: unknown): RouteGraphPort[];
export function getRouteGraphMacroPort(macroInput: unknown, portId: string): RouteGraphPort | null;
export function normalizeRouteGraphNode(input: unknown): RouteGraphNode;
export function normalizeRouteGraphEdge(input: unknown): RouteGraphEdge;
export function normalizeRouteGraphMacro(input: unknown): RouteGraphMacro;
export function buildCandidateSelectorMacroFromRouteBinding(input: {
  id?: number;
  stableId?: string | null;
  displayName?: string | null;
  displayIcon?: string | null;
  visibility?: RouteGraphVisibility;
  enabled?: boolean;
  routingStrategy?: RouteGraphSelectionStrategy;
  match?: RouteGraphMatchSpec;
  endpointIds?: string[];
  candidateBands?: Array<{
    id?: string;
    label?: string | null;
    enabled?: boolean;
    priority?: number;
    weight?: number;
    endpointIds?: string[];
  }>;
  ownership?: RouteGraphOwnership;
  metadata?: Record<string, unknown>;
}): RouteGraphMacro;
export function normalizeRouteGraphSource(input: unknown): RouteGraphSource;
export function parseRouteGraphSource(raw: string | null | undefined): RouteGraphSource;
export function stringifyRouteGraphSource(source: unknown): string;
export function lowerRouteGraphSource(sourceInput: unknown): { semanticSource: RouteGraphSource; primitiveSource: RouteGraphSource; diagnostics: RouteGraphDiagnostic[] };
export function validateRouteGraphSource(sourceInput: unknown): { ok: boolean; diagnostics: RouteGraphDiagnostic[] };
export function compileRouteGraphSource(sourceInput: unknown): RouteGraphCompileResult;
export function findRouteGraphEntryForModel(compiledGraph: unknown, model: string): CompiledRouteGraph['entries'][number] | null;
export function buildRouteGraphSourceFromLegacyRoutes(routesInput: unknown): RouteGraphSource;
