export type RoutingIdentityKind =
  | 'entry'
  | 'dispatcher'
  | 'execution_target'
  | 'macro'
  | 'edge'
  | 'compiled_alternative'
  | 'compiled_attempt'
  | 'compiled_plan'
  | 'unknown';

export type ClassifiedRoutingIdentity = {
  kind: RoutingIdentityKind;
  value: string;
};

export declare function stableRoutingIdentityJson(value: unknown): string;
export declare function stableRoutingIdentityHash(value: unknown): string;
export declare function routingIdentitySafePart(value: unknown): string;
export declare function routeMacroIdentitySafePart(value: unknown): string;
export declare function createRouteBuilderMacroId(routeStableId: unknown): string;
export declare function createManagedRouteGraphElementId(kind: 'macro' | 'endpoint' | 'stage' | 'member' | 'target' | 'edge', opaqueId: unknown): string;
export declare function createManualRouteGraphNodeId(nodeType: unknown, opaqueId: unknown): string;
export declare function createManualRouteGraphEdgeId(opaqueId: unknown): string;
export declare function normalizeRouteGroupModelKey(modelName: unknown): string;
export declare function createAutomaticRouteGroupKey(modelName: unknown): string;
export declare function isAutomaticRouteGroupKey(groupKey: unknown): boolean;
export declare function createRouteSupplyCredentialKey(identity: unknown): string;
export declare function createRouteSupplyKey(input: unknown): string;
export declare function createRuntimeExecutionTargetIdFromSupplyKey(supplyKey: unknown): string;
export declare function createRuntimeExecutionTargetIdFromIdentity(identity: unknown): string;
export declare function createRouteProgramEdgeId(sourceNodeId: unknown, sourcePortId: unknown, targetNodeId: unknown, targetPortId: unknown): string;
export declare function createRouteMacroSemanticNodeId(macroId: unknown): string;
export declare function isRouteMacroSemanticNodeId(value: unknown): boolean;
export declare function createRouteMacroEntryNodeId(macroId: unknown): string;
export declare function createRouteMacroFilterNodeId(macroId: unknown): string;
export declare function createRouteMacroDispatcherNodeId(macroId: unknown): string;
export declare function createRouteMacroFallbackStageId(stageKey: unknown): string;
export declare function createRouteMacroFallbackStageDispatcherNodeId(macroId: unknown, stageId: unknown): string;
export declare function isRouteMacroDispatcherNodeId(value: unknown, macroId: unknown): boolean;
export declare function createRouteMacroCandidateEndpointNodeId(macroId: unknown, groupId: unknown, endpointId: unknown): string;
export declare function createRouteMacroInlineCandidateNodeId(macroId: unknown, groupId: unknown): string;
export declare function createRouteMacroSyntheticCandidateNodeId(macroId: unknown, groupId: unknown): string;
export declare function createRouteMacroCandidateEdgeId(macroId: unknown, groupId: unknown, candidateId: unknown): string;
export declare function createRouteMacroInternalEdgeId(macroId: unknown, edgeName: unknown): string;
export declare function createRouteMacroSemanticCandidateEdgeId(edgeId: unknown, candidateNodeId: unknown): string;
export declare function isRouteMacroIdentity(value: unknown): boolean;
export declare function classifyRoutingIdentity(value: unknown): ClassifiedRoutingIdentity;
