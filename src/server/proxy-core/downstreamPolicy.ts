import type { FastifyReply, FastifyRequest } from 'fastify';
import { getProxyAuthContext } from '../middleware/auth.js';
import { isModelAllowedByPolicyOrAllowedRoutes, recordManagedKeyCostUsage } from '../services/downstreamApiKeyService.js';
import { EMPTY_DOWNSTREAM_ROUTING_POLICY, type DownstreamRoutingPolicy } from '../services/downstreamPolicyTypes.js';

export function getDownstreamRoutingPolicy(request: FastifyRequest): DownstreamRoutingPolicy {
  const authContext = getProxyAuthContext(request);
  if (!authContext) return EMPTY_DOWNSTREAM_ROUTING_POLICY;
  return {
    ...EMPTY_DOWNSTREAM_ROUTING_POLICY,
    ...authContext.policy,
    supportedModels: Array.isArray(authContext.policy.supportedModels)
      ? authContext.policy.supportedModels
      : EMPTY_DOWNSTREAM_ROUTING_POLICY.supportedModels,
    allowedRouteIds: Array.isArray(authContext.policy.allowedRouteIds)
      ? authContext.policy.allowedRouteIds
      : EMPTY_DOWNSTREAM_ROUTING_POLICY.allowedRouteIds,
    siteWeightMultipliers: authContext.policy.siteWeightMultipliers || EMPTY_DOWNSTREAM_ROUTING_POLICY.siteWeightMultipliers,
    excludedSiteIds: Array.isArray(authContext.policy.excludedSiteIds)
      ? authContext.policy.excludedSiteIds
      : EMPTY_DOWNSTREAM_ROUTING_POLICY.excludedSiteIds,
    excludedCredentialRefs: Array.isArray(authContext.policy.excludedCredentialRefs)
      ? authContext.policy.excludedCredentialRefs
      : EMPTY_DOWNSTREAM_ROUTING_POLICY.excludedCredentialRefs,
  };
}

export async function ensureModelAllowedForDownstreamKey(
  request: FastifyRequest,
  reply: FastifyReply,
  requestedModel: string,
): Promise<boolean> {
  const authContext = getProxyAuthContext(request);
  if (!authContext) return true;

  if (await isModelAllowedByPolicyOrAllowedRoutes(requestedModel, authContext.policy)) {
    return true;
  }

  reply.code(403).send({
    error: {
      message: `Model not allowed for this API key: ${requestedModel}`,
      type: 'permission_error',
    },
  });
  return false;
}

export function recordDownstreamCostUsage(request: FastifyRequest, estimatedCost: number): void {
  const authContext = getProxyAuthContext(request);
  if (!authContext || authContext.keyId === null) return;
  void recordManagedKeyCostUsage(authContext.keyId, estimatedCost);
}
