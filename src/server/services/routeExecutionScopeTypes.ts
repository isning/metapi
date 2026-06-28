import type {
  RouteGraphRuntimeFailureOverlay,
  RouteGraphRuntimeSelection,
} from './routeGraphRuntimeService.js';

export type RouteExecutionCandidate = {
  candidateId: string;
  routeEndpointId: string;
  routeId: number | null;
  supplyTargetId: string | null;
  targetIds: number[];
  priority: number;
  weight: number;
  enabled: boolean;
};

export type RouteExecutionScope = {
  scopeId: string;
  graphVersionId: number | null;
  graphVersion: number | null;
  requestedModel: string;
  matchedEntryNodeId: string | null;
  matchedRouteId: number | null;
  selectedRouteId: number | null;
  selectedCandidateId: string | null;
  allowedTargetIds: number[];
  candidates: RouteExecutionCandidate[];
  failureOverlay: RouteGraphRuntimeFailureOverlay;
  routeGraph?: RouteGraphRuntimeSelection | null;
  matchSnapshot: unknown;
};
