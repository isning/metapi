import type { FastifyReply, FastifyRequest } from 'fastify';
import { getProxyAuthContext } from '../middleware/auth.js';
import { isModelAllowedByPolicyOrAllowedPlans, recordManagedKeyBillingUsage } from '../services/downstreamApiKeyService.js';
import {
  EMPTY_DOWNSTREAM_ROUTING_POLICY,
  type DownstreamRoutingPolicy,
} from '../services/downstreamPolicyTypes.js';

export async function getDownstreamRoutingPolicy(request: FastifyRequest): Promise<DownstreamRoutingPolicy> {
  const authContext = getProxyAuthContext(request);
  if (!authContext) return EMPTY_DOWNSTREAM_ROUTING_POLICY;
  return authContext.policy;
}

export async function ensureModelAllowedForDownstreamKey(
  request: FastifyRequest,
  reply: FastifyReply,
  requestedModel: string,
): Promise<boolean> {
  const authContext = getProxyAuthContext(request);
  if (!authContext) return true;

  if (await isModelAllowedByPolicyOrAllowedPlans(requestedModel, authContext.policy)) {
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

export async function recordDownstreamBillingUsage(request: FastifyRequest, input: {
  billingDetails: unknown;
  siteId: number | null;
  accountId: number | null;
}): Promise<void> {
  const authContext = getProxyAuthContext(request);
  if (!authContext || authContext.keyId === null) return;
  await recordManagedKeyBillingUsage({ keyId: authContext.keyId, ...input });
}
