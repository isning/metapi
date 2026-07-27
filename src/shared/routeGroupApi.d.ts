import type { RouteGraphDiagnostic } from "./routeGraph.js";

export type RouteGroupCommandErrorCode =
  | "invalid_route_group_payload"
  | "route_group_rate_limited"
  | "route_group_not_found"
  | "candidate_not_found"
  | "source_not_found"
  | "duplicate_candidate"
  | "candidate_kind_unsupported"
  | "candidate_create_failed"
  | "fallback_stage_not_found"
  | "fallback_stage_placement_not_allowed"
  | "fallback_stage_reference_not_found"
  | "fallback_stage_order_invalid"
  | "fallback_stage_required"
  | "fallback_stage_not_empty"
  | "fallback_stage_projection_failed"
  | "model_source_pattern_required"
  | "model_source_pattern_invalid"
  | "route_group_source_not_found"
  | "route_group_self_reference"
  | "automatic_source_selection_unsupported"
  | "public_model_conflict"
  | "source_graph_invalid";

export type RouteGroupCommandErrorResponse = {
  success: false;
  code: RouteGroupCommandErrorCode;
  params: Record<string, string | number | boolean | null>;
  diagnostics?: RouteGraphDiagnostic[];
};
