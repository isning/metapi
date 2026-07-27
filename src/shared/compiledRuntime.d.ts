export type DispatcherPolicy =
  | { kind: 'inherit_default' }
  | { kind: 'registry'; policyId: string }
  | { kind: 'inline'; policy: Record<string, unknown> }
  | { kind: 'builtin'; builtin: 'weighted' | 'round_robin' | 'stable_first' };

export type RouteFilter =
  | { type: 'rewrite_model'; source: 'current_model' | 'upstream_model'; operation: 'strip_suffix' | 'set'; suffix?: string; value?: string }
  | { type: 'set_payload'; path: string; value: unknown; mode?: 'default' | 'override' }
  | { type: 'remove_payload'; path: string }
  | { type: 'set_header'; name: string; value: string; mode?: 'default' | 'override' }
  | { type: 'remove_header'; name: string }
  | { type: 'set_endpoint_preference'; endpoint: 'chat' | 'messages' | 'responses' };

export type RouteProgramSourceRef = { nodeId?: string; edgeId?: string; macroId?: string; endpointId?: string; generatedNodeIds?: string[]; generatedEdgeIds?: string[] };
export type RouteMatcherTarget = { programId: string; entryNodeId: string; publicModelName: string; sourceRef?: RouteProgramSourceRef };
export type RouteMatcherPattern = RouteMatcherTarget & { pattern: string; patternKind: 'wildcard' | 'regex' };
export type RouteMatcherTable = { exact: Record<string, RouteMatcherTarget>; normalizedExact: Record<string, RouteMatcherTarget>; patterns: RouteMatcherPattern[] };
export type CompiledEndpointTarget = { endpointId?: string; executionAttemptId: string; targetId: string; nodeId?: string; model: string; modelSource?: 'fixed' | 'request'; enabled: boolean; accountId?: string | number | null; tokenId?: string | number | null; siteId?: string | number | null; weight?: number | null; transportBinding?: { kind: 'execution_target'; executionTargetId: number }; metadata?: Record<string, unknown>; runtime?: Record<string, unknown>; compatibilityPolicy?: Record<string, unknown>; sourceRef?: RouteProgramSourceRef };
export type CompiledRouterDiagnostic = { severity: 'error' | 'warning'; code: string; message: string; nodeId?: string; edgeId?: string; sourceRef?: RouteProgramSourceRef };
export type CompiledRouterFilterStage = { nodeId: string; phase: 'pre_selection' | 'post_build'; operations: RouteFilter[]; sourceRef?: RouteProgramSourceRef };
export type CompiledRouterTerminal = { kind: 'supply'; endpointId: string } | { kind: 'synthetic'; nodeId: string; statusCode: 429 | 503; message: string; metadata?: Record<string, unknown>; runtime?: Record<string, unknown>; sourceRef?: RouteProgramSourceRef };
export type CompiledExecutionSelectionTerm = { termId: string; nodeId?: string | null; mode: 'route' | 'flow' | 'target' | 'execution_attempt' | string; policy: DispatcherPolicy; optionId: string; optionIndex: number; optionKind: 'route' | 'bidirect' | 'target' | 'execution_attempt' | string; enabled: boolean; weight: number; order: number; controlOrder: number; metadata?: Record<string, unknown>; runtime?: Record<string, unknown>; sourceRef?: RouteProgramSourceRef };
export type CompiledFallbackStage = { fallbackId: string; stageId: string; stageIndex: number; nodeId: string; controlOrder: number; sourceRef?: RouteProgramSourceRef };
export type CompiledExecutionAlternative = { alternativeId: string; kind: 'execution_attempt' | 'endpoint_delegation' | 'synthetic_response'; enabled: boolean; filterStageIndexes: number[]; selectionTerms: CompiledExecutionSelectionTerm[]; fallbackStages: CompiledFallbackStage[]; terminal: CompiledRouterTerminal; endpoint?: { endpointId: string; nodeId: string; model: string | null; compatibilityPolicy?: Record<string, unknown>; metadata?: Record<string, unknown>; runtime?: Record<string, unknown>; sourceRef?: RouteProgramSourceRef } | null; executionAttempt?: CompiledEndpointTarget | null; syntheticResponse?: { nodeId: string; statusCode: 429 | 503; message: string; metadata?: Record<string, unknown>; runtime?: Record<string, unknown>; sourceRef?: RouteProgramSourceRef } | null; metadata?: Record<string, unknown>; runtime?: Record<string, unknown> };
export type CompiledRouterPlan = { id: string; entryNodeId: string; publicModelName: string; enabled: boolean; sourceRef?: RouteProgramSourceRef; metadata?: Record<string, unknown>; runtime?: Record<string, unknown>; filterStages: CompiledRouterFilterStage[]; executionAlternatives: CompiledExecutionAlternative[] };
export type CompiledRouterBundle = { hash: string; matcher: RouteMatcherTable; plans: CompiledRouterPlan[]; planIndex: Record<string, number>; diagnostics: CompiledRouterDiagnostic[]; executionTable?: Record<string, unknown>; metadata?: Record<string, unknown>; runtime?: Record<string, unknown> };
export type CompiledRouteGraph = { hash: string; metadata?: Record<string, unknown>; runtime?: Record<string, unknown>; compiledRouterBundle?: CompiledRouterBundle };

export function compactCompiledRouterBundle(bundle: CompiledRouterBundle): CompiledRouterBundle;
export function materializeCompiledRouterPlan(bundle: CompiledRouterBundle, plan: CompiledRouterPlan): CompiledRouterPlan;
export function getCompiledRouterPlanById(bundle: CompiledRouterBundle | null | undefined, planId: unknown): CompiledRouterPlan | null;
export function getCompiledExecutionAttemptId(target: CompiledEndpointTarget | null | undefined): string | null;
export function getCompiledExecutionTargetId(target: CompiledEndpointTarget | null | undefined): number | null;
export function getCompiledRouterExecutionTargetIds(bundle: CompiledRouterBundle | null | undefined): number[];
export function validateCompiledRouterBundle(bundle: unknown):
  | { ok: true; value: CompiledRouterBundle }
  | { ok: false; reason: string };
