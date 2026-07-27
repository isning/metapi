import type { RouteGroupManagementListItem } from '../../../shared/routeGroupManagement.js';
import type { RouteGroupCommandErrorCode } from '../../../shared/routeGroupApi.js';
import { ApiRequestError, type DispatchPolicyRegistryPayload } from '../../api.js';
import { getBrand } from '../../components/BrandIcon.js';
import { tr } from '../../i18n.js';

const ROUTE_GROUP_COMMAND_ERROR_KEYS: Record<RouteGroupCommandErrorCode, string> = {
  invalid_route_group_payload: 'pages.tokenRoutes.commandError.invalidPayload',
  route_group_rate_limited: 'pages.tokenRoutes.commandError.rateLimited',
  route_group_not_found: 'pages.tokenRoutes.commandError.routeGroupNotFound',
  candidate_not_found: 'pages.tokenRoutes.commandError.candidateNotFound',
  source_not_found: 'pages.tokenRoutes.commandError.sourceNotFound',
  duplicate_candidate: 'pages.tokenRoutes.commandError.duplicateCandidate',
  candidate_kind_unsupported: 'pages.tokenRoutes.commandError.candidateKindUnsupported',
  candidate_create_failed: 'pages.tokenRoutes.commandError.createFailed',
  fallback_stage_not_found: 'pages.tokenRoutes.commandError.fallbackStageNotFound',
  fallback_stage_placement_not_allowed: 'pages.tokenRoutes.commandError.fallbackStagePlacementNotAllowed',
  fallback_stage_reference_not_found: 'pages.tokenRoutes.commandError.fallbackStageReferenceNotFound',
  fallback_stage_order_invalid: 'pages.tokenRoutes.commandError.fallbackStageOrderInvalid',
  fallback_stage_required: 'pages.tokenRoutes.commandError.fallbackStageRequired',
  fallback_stage_not_empty: 'pages.tokenRoutes.commandError.fallbackStageNotEmpty',
  fallback_stage_projection_failed: 'pages.tokenRoutes.commandError.fallbackStageProjectionFailed',
  model_source_pattern_required: 'pages.tokenRoutes.commandError.modelSourcePatternRequired',
  model_source_pattern_invalid: 'pages.tokenRoutes.commandError.modelSourcePatternInvalid',
  route_group_source_not_found: 'pages.tokenRoutes.commandError.routeGroupSourceNotFound',
  route_group_self_reference: 'pages.tokenRoutes.commandError.routeGroupSelfReference',
  automatic_source_selection_unsupported: 'pages.tokenRoutes.commandError.automaticSourceSelectionUnsupported',
  public_model_conflict: 'pages.tokenRoutes.commandError.publicModelConflict',
  source_graph_invalid: 'pages.tokenRoutes.commandError.sourceGraphInvalid',
};

function formatCommandMessage(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key) => {
    const value = params[key];
    return value == null ? match : String(value);
  });
}

export function routeGroupCommandErrorMessage(error: unknown, fallbackKey: string): string {
  if (error instanceof ApiRequestError && error.code && error.code in ROUTE_GROUP_COMMAND_ERROR_KEYS) {
    const key = ROUTE_GROUP_COMMAND_ERROR_KEYS[error.code as RouteGroupCommandErrorCode];
    return formatCommandMessage(tr(key), error.params);
  }
  if (error instanceof ApiRequestError) return tr(fallbackKey);
  return error instanceof Error ? error.message : tr(fallbackKey);
}

export function labelForRouteGroup(group: RouteGroupManagementListItem): string {
  return group.presentation.displayName || group.model.publicName || group.model.upstreamName || group.id;
}

export function routeGroupBrand(group: RouteGroupManagementListItem) {
  return getBrand(group.model.publicName || group.model.upstreamName || labelForRouteGroup(group));
}

export function routeGroupModelName(group: RouteGroupManagementListItem): string {
  return group.model.publicName || group.model.upstreamName || group.id;
}

export type RouteGroupCapabilities = {
  canEditGroup: boolean;
  canEditGeneratedFields: boolean;
  canEditCandidateControl: boolean;
  canCreateOrDeleteCandidate: boolean;
  canEditFallbackFlow: boolean;
};

export function routeGroupCapabilities(
  group: RouteGroupManagementListItem | null | undefined,
): RouteGroupCapabilities {
  const generated = group?.kind === 'automatic';
  return {
    canEditGroup: true,
    canEditGeneratedFields: !generated,
    canEditCandidateControl: true,
    canCreateOrDeleteCandidate: !generated,
    canEditFallbackFlow: true,
  };
}

export function routeGroupPolicyLabel(
  policy: RouteGroupManagementListItem['dispatcherPolicy'],
  registry?: DispatchPolicyRegistryPayload | null,
): string {
  if (!policy || policy.kind === 'inherit_default') {
    return tr('pages.tokenRoutes.routeGroupPolicy.inheritDefault');
  }
  if (policy.kind === 'builtin') {
    if (policy.builtin === 'weighted') return tr('pages.tokenRoutes.weight');
    if (policy.builtin === 'round_robin') return tr('pages.oAuthManagement.roundRobin');
    if (policy.builtin === 'stable_first') return tr('pages.tokenRoutes.stableFirst');
    return policy.builtin;
  }
  if (policy.kind === 'registry') {
    return registry?.policies.find((item) => item.id === policy.policyId)?.name || policy.policyId;
  }
  return String(policy.policy.name);
}
