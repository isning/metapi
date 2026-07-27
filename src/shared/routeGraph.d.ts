export type RouteGraphMatchKind = 'model';
export type RouteGraphBackendKind = 'supply' | 'route_endpoints';
export type RouteGraphNodeType =
  | 'entry'
  | 'route_endpoint'
  | 'filter'
  | 'dispatcher'
  | 'synthetic_endpoint';
export type RouteGraphEndpointKind = 'supply';
export type RouteGraphEndpointExposure = 'none' | 'public' | 'internal';
export type RouteGraphEndpointResolutionStatus = 'resolved' | 'degraded' | 'unresolved';
export type RouteGraphEndpointSourceKind =
  | 'upstream_model'
  | 'synthetic'
  | 'inline';
export type RouteGraphOwnership = 'manual' | 'system' | 'derived';
export type RouteGraphPortKind =
  | 'request'
  | 'bidirect'
  | 'route';
export type RouteGraphManualEdgePolicy = 'allow' | 'deny';
export type RouteGraphEdgeKind =
  | 'request_flow'
  | 'bidirect_flow'
  | 'route_flow';
export type RouteGraphPort = {
  id: string;
  label: string;
  direction: 'input' | 'output';
  kind: RouteGraphPortKind;
  required?: boolean;
  multiple?: boolean;
  collection?: { type: 'single' } | { type: 'arr'; min?: number; max?: number } | { type: 'set'; min?: number; max?: number };
  /** Whether a manually authored edge may attach to this port. */
  manualEdgePolicy: RouteGraphManualEdgePolicy;
  enabled?: boolean;
  description?: string;
};

export type RouteGraphPortConnectionBounds = {
  min: number;
  max: number;
  collection: boolean;
};

export type RouteGraphMatchSpec = {
  kind: RouteGraphMatchKind;
  requestedModelPattern: string;
  currentModelPattern?: string;
  displayName: string | null;
  downstreamProtocol?: string | null;
  upstreamProtocol?: string | null;
  sitePlatform?: string | null;
  accountId?: number | null;
  tokenId?: number | null;
  siteId?: number | null;
};

export type RouteGraphBackendSpec =
  | { kind: 'supply' }
  | { kind: 'route_endpoints'; endpointIds: string[] };

export type RouteNodeProvenance =
  | { source: 'manual' }
  | { source: 'preset'; presetId: string }
  | { source: 'import'; importId: string }
  | Record<string, unknown>;

export type RouteGraphPosition = { x: number; y: number };
export type BaseRouteGraphNode = {
  id: string;
  type: RouteGraphNodeType;
  name?: string | null;
  enabled: boolean;
  ownership: RouteGraphOwnership;
  position?: RouteGraphPosition;
  provenance?: RouteNodeProvenance;
  dynamicPorts?: RouteGraphPort[];
  metadata?: Record<string, unknown>;
};

export type EntryNode = BaseRouteGraphNode & {
  type: 'entry';
  match: RouteGraphMatchSpec;
};

export type RouteEndpointNode = BaseRouteGraphNode & {
  type: 'route_endpoint';
  routeEndpointId: string;
  endpointKind: RouteGraphEndpointKind;
  exposure: RouteGraphEndpointExposure;
  resolutionStatus: RouteGraphEndpointResolutionStatus;
  ownerKind: 'manual' | 'macro';
  sourceKind: RouteGraphEndpointSourceKind;
  resolvesTo?: {
    kind: 'route_builder' | 'synthetic' | 'external';
    id: string;
  };
  backend: RouteGraphBackendSpec;
  match?: RouteGraphMatchSpec;
  config?: RouteEndpointConfig | Record<string, unknown>;
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
  | { kind: 'inherit_default' }
  | {
      kind: 'registry';
      policyId: string;
    }
  | {
      kind: 'inline';
      policy: Record<string, unknown>;
    }
  | {
      kind: 'builtin';
      builtin: 'weighted' | 'round_robin' | 'stable_first';
    };

export function normalizeDispatcherPolicy(input: unknown): DispatcherPolicy;

export type TargetSelectionPolicy = DispatcherPolicy | { kind: 'defer_to_router' };

export function validateNativeDispatcherPolicy(input: unknown):
  | { ok: true; value: DispatcherPolicy }
  | { ok: false; error: string };
export function requireNativeDispatcherPolicy(input: unknown): DispatcherPolicy;
export function validateNativeTargetSelectionPolicy(input: unknown):
  | { ok: true; value: TargetSelectionPolicy }
  | { ok: false; error: string };
export function validateNativeRouteGraphSourcePolicies(input: unknown): string[];

export function normalizeTargetSelectionPolicy(input: unknown): TargetSelectionPolicy;

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
  transportBinding?: { kind: 'execution_target'; executionTargetId: number };
  metadata?: Record<string, unknown>;
  compatibilityPolicy?: Record<string, unknown>;
};

export type RouteEndpointConfig = {
  targets: RouteExecutableTarget[];
  targetSelection?: TargetSelectionPolicy;
  compatibilityPolicy?: Record<string, unknown>;
};

export type SyntheticEndpointNode = BaseRouteGraphNode & {
  type: 'synthetic_endpoint';
  statusCode: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503;
  message: string;
  headers?: Record<string, unknown>;
  body?: unknown;
};

export type RouteGraphNode =
  | EntryNode
  | RouteEndpointNode
  | FilterNode
  | DispatcherNode
  | SyntheticEndpointNode;

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
      | { kind: 'external'; match: RouteGraphMatchSpec }
      | { kind: 'embedded'; input: 'request' | 'bidirect' }
      | { kind: 'none' };
    output: 'route' | 'bidirect';
    ports: RouteGraphPort[];
  };
  policy: DispatcherPolicy;
  filters?: {
    operations: RouteFilter[];
  };
  /** Optional macro-wide candidate universe. Fallback stages assign and override members from this universe. */
  candidateSource?: { kind: 'model_pattern'; pattern: string };
  groups: Array<{
    id: string;
    label?: string;
    enabled: boolean;
    /** Receives candidateSource matches that are not assigned to another stage member. */
    acceptUnassigned?: boolean;
    policy?: DispatcherPolicy;
    input:
      | { kind: 'route_endpoints'; endpointIds: string[] }
      | { kind: 'graph_references'; endpointIds: string[]; macroIds: string[] }
      | { kind: 'model_pattern'; pattern: string }
      | { kind: 'metadata_query'; cel: string }
      | { kind: 'endpoint_query'; cel: string }
      | { kind: 'inline_endpoints'; endpoints: RouteExecutableTarget[] }
      | { kind: 'synthetic'; statusCode: SyntheticEndpointNode['statusCode']; message: string };
    defaults?: {
      enabled?: boolean;
      weight?: number;
      metadata?: Record<string, unknown>;
    };
    members?: Array<{
      /** Opaque identity scoped to this dispatcher group; not a global resource. */
      memberId?: string;
      endpointId?: string;
      macroId?: string;
      enabled?: boolean;
      weight?: number;
      metadata?: Record<string, unknown>;
    }>;
    materialization?: {
      sort?: 'model_name' | 'health' | 'cel';
      limit?: number;
      dedupeBy?: 'endpoint_id' | 'model' | 'metadata';
    };
    metadata?: Record<string, unknown>;
  }>;
  presentation?: { displayIcon?: string | null };
};

export type RouteGraphMacro = {
  id: string;
  kind: 'candidate_selector';
  enabled: boolean;
  ownership: Exclude<RouteGraphOwnership, 'derived'>;
  name?: string | null;
  config: CandidateSelectorMacroConfig;
  position?: RouteGraphPosition;
  metadata?: Record<string, unknown>;
};

export type RouteGraphSource = {
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
  generatedNodeIds?: string[];
  generatedEdgeIds?: string[];
};

export type RouteMatcherTarget = {
  programId: string;
  entryNodeId: string;
  publicModelName: string;
  sourceRef?: RouteProgramSourceRef;
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
  endpointId?: string;
  executionAttemptId: string;
  targetId: string;
  nodeId?: string;
  model: string;
  modelSource?: 'fixed' | 'request';
  enabled: boolean;
  accountId?: string | number | null;
  tokenId?: string | number | null;
  siteId?: string | number | null;
  weight?: number | null;
  transportBinding?: { kind: 'execution_target'; executionTargetId: number };
  metadata?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  compatibilityPolicy?: Record<string, unknown>;
  sourceRef?: RouteProgramSourceRef;
};

export type CompiledRouterDiagnostic = RouteGraphDiagnostic & {
  sourceRef?: RouteProgramSourceRef;
};

export type CompiledRouterFilterStage = {
  nodeId: string;
  phase: 'pre_selection' | 'post_build';
  operations: RouteFilter[];
  sourceRef?: RouteProgramSourceRef;
};

export type CompiledRouterTerminal =
  | {
      kind: 'supply';
      endpointId: string;
    }
  | {
      kind: 'synthetic';
      nodeId: string;
      statusCode: 429 | 503;
      message: string;
      metadata?: Record<string, unknown>;
      runtime?: Record<string, unknown>;
      sourceRef?: RouteProgramSourceRef;
    };

export type CompiledExecutionSelectionTerm = {
  termId: string;
  nodeId?: string | null;
  mode: 'route' | 'flow' | 'target' | 'execution_attempt' | string;
  policy: DispatcherPolicy;
  optionId: string;
  optionIndex: number;
  optionKind: 'route' | 'bidirect' | 'target' | 'execution_attempt' | string;
  enabled: boolean;
  weight: number;
  order: number;
  controlOrder: number;
  metadata?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  sourceRef?: RouteProgramSourceRef;
};

export type CompiledFallbackStage = {
  fallbackId: string;
  stageId: string;
  stageIndex: number;
  nodeId: string;
  controlOrder: number;
  sourceRef?: RouteProgramSourceRef;
};

export type CompiledExecutionAlternative = {
  alternativeId: string;
  kind: 'execution_attempt' | 'endpoint_delegation' | 'synthetic_response';
  enabled: boolean;
  filterStageIndexes: number[];
  selectionTerms: CompiledExecutionSelectionTerm[];
  fallbackStages: CompiledFallbackStage[];
  terminal: CompiledRouterTerminal;
  endpoint?: {
    endpointId: string;
    nodeId: string;
    model: string | null;
    compatibilityPolicy?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    runtime?: Record<string, unknown>;
    sourceRef?: RouteProgramSourceRef;
  } | null;
  executionAttempt?: CompiledEndpointTarget | null;
  syntheticResponse?: {
    nodeId: string;
    statusCode: 429 | 503;
    message: string;
    metadata?: Record<string, unknown>;
    runtime?: Record<string, unknown>;
    sourceRef?: RouteProgramSourceRef;
  } | null;
  metadata?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
};

export type CompiledRouterPlan = {
  id: string;
  entryNodeId: string;
  publicModelName: string;
  enabled: boolean;
  sourceRef?: RouteProgramSourceRef;
  metadata?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  filterStages: CompiledRouterFilterStage[];
  executionAlternatives: CompiledExecutionAlternative[];
};

export type CompiledRouterBundle = {
  hash: string;
  matcher: RouteMatcherTable;
  plans: CompiledRouterPlan[];
  /** Maps a compiled program id to its immutable position in `plans`. */
  planIndex: Record<string, number>;
  diagnostics: CompiledRouterDiagnostic[];
  /** Compact immutable execution tables used only by persisted runtime artifacts. */
  executionTable?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
};

export type CompiledRouteGraph = {
  hash: string;
  metadata?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  compiledRouterBundle?: CompiledRouterBundle;
};

export type RouteGraphCompileResult = {
  source: RouteGraphSource;
  primitiveSource?: RouteGraphSource;
  compiled: CompiledRouteGraph;
  diagnostics: RouteGraphDiagnostic[];
  ok: boolean;
};

export const ROUTE_GRAPH_MATCH_KIND_MODEL: 'model';
export const ROUTE_GRAPH_BACKEND_KIND_SUPPLY: 'supply';
export const ROUTE_GRAPH_BACKEND_KIND_ROUTE_ENDPOINTS: 'route_endpoints';
export const ROUTE_GRAPH_NODE_TYPES: readonly RouteGraphNodeType[];
export const ROUTE_GRAPH_TERMINAL_NODE_TYPES: readonly ('route_endpoint' | 'synthetic_endpoint')[];
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
export function getRouteGraphModelPatternFromSpecs(matchSpec: unknown, backendSpec: unknown): string;
export function getRouteGraphExposedModelName(matchSpec: unknown, backendSpec: unknown): string;
export function isRouteGraphExactModelMatch(matchSpec: unknown, backendSpec: unknown): boolean;
export function routeGraphMatchesRequestedModel(model: string, matchSpec: unknown, backendSpec: unknown): boolean;
export function routeGraphSupplyEndpointIdFromSupplyKey(supplyKey: unknown): string;
export function routeGraphSupplyEndpointIdFromIdentity(identity: unknown): string;
export function getRouteGraphNodePorts(nodeInput: unknown): RouteGraphPort[];
export function getRouteGraphNodePort(nodeInput: unknown, portId: string): RouteGraphPort | null;
export function getRouteGraphMacroPorts(macroInput: unknown): RouteGraphPort[];
export function getRouteGraphMacroPort(macroInput: unknown, portId: string): RouteGraphPort | null;
export function canAttachManualRouteGraphEdge(port: RouteGraphPort | null | undefined): boolean;
export function getRouteGraphPortConnectionBounds(port: RouteGraphPort | null | undefined): RouteGraphPortConnectionBounds;
export function normalizeRouteGraphNode(input: unknown): RouteGraphNode;
export function normalizeRouteGraphEdge(input: unknown): RouteGraphEdge;
export function normalizeRouteGraphMacro(input: unknown): RouteGraphMacro;
export function buildCandidateSelectorSurfacePorts(surface: Pick<CandidateSelectorMacroConfig['surface'], 'entry' | 'output'>): RouteGraphPort[];
export function buildCandidateSelectorMacro(input: {
  stableId?: string | null;
  displayName?: string | null;
  displayIcon?: string | null;
  ingress?: 'external' | 'embedded' | 'none';
  enabled?: boolean;
  policy?: DispatcherPolicy;
  match?: RouteGraphMatchSpec;
  filters?: RouteGraphFilters;
  endpointIds?: string[];
  fallbackStages?: Array<{
    id?: string;
    label?: string | null;
    enabled?: boolean;
    policy?: DispatcherPolicy;
    members?: Array<{
      /** Opaque identity scoped to this dispatcher group; not a global resource. */
      memberId?: string;
      endpointId?: string;
      macroId?: string;
      enabled?: boolean;
      weight?: number;
      metadata?: Record<string, unknown>;
    }>;
  }>;
  ownership?: RouteGraphOwnership;
  metadata?: Record<string, unknown>;
}): RouteGraphMacro;
export function normalizeRouteGraphSource(input: unknown): RouteGraphSource;
export function parseRouteGraphSource(raw: string | null | undefined): RouteGraphSource;
export function stringifyRouteGraphSource(source: unknown): string;
export function lowerRouteGraphSource(sourceInput: unknown): { semanticSource: RouteGraphSource; primitiveSource: RouteGraphSource; diagnostics: RouteGraphDiagnostic[] };
export function validateRouteGraphSource(sourceInput: unknown): { ok: boolean; diagnostics: RouteGraphDiagnostic[] };
export function compileRouteGraphSource(sourceInput: unknown, options?: {
  includePrimitiveSource?: boolean;
  compactRuntimeBundle?: boolean;
}): RouteGraphCompileResult;
export function findRouteGraphEntryForModel(compiledGraph: unknown, model: string): {
  nodeId: string;
  enabled: boolean;
  match: RouteGraphMatchSpec;
  backend: RouteGraphBackendSpec;
  publicModelName: string;
} | null;
