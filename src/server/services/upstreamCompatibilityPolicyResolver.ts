import {
  parseUpstreamCompatibilityPolicyJson,
  resolveUpstreamCompatibilityPolicy,
  type ResolvedUpstreamCompatibilityPolicy,
  type UpstreamCompatibilityPolicy,
} from '../contracts/upstreamCompatibilityPolicy.js';
import { getCompatibilityPolicyFromExtraConfig } from './upstreamCompatibilityPolicyStorage.js';

type PolicyCarrier = {
  compatibilityPolicy?: string | Record<string, unknown> | null;
};

type AccountCarrier = {
  extraConfig?: string | Record<string, unknown> | null;
};

function policyFromCarrier(carrier?: PolicyCarrier | null): UpstreamCompatibilityPolicy | undefined {
  if (!carrier) return undefined;
  return parseUpstreamCompatibilityPolicyJson(carrier.compatibilityPolicy);
}

export function resolveDispatchUpstreamCompatibilityPolicy(input: {
  defaultCompatibilityPolicy?: UpstreamCompatibilityPolicy | null;
  site?: PolicyCarrier | null;
  account?: AccountCarrier | null;
  token?: PolicyCarrier | null;
  modelEndpointCompatibilityPolicy?: UpstreamCompatibilityPolicy | null;
  selectedEndpointTarget?: {
    compatibilityPolicy?: UpstreamCompatibilityPolicy | null;
  } | null;
}): ResolvedUpstreamCompatibilityPolicy {
  return resolveUpstreamCompatibilityPolicy(
    input.defaultCompatibilityPolicy || undefined,
    policyFromCarrier(input.site),
    getCompatibilityPolicyFromExtraConfig(input.account?.extraConfig),
    policyFromCarrier(input.token),
    input.modelEndpointCompatibilityPolicy || undefined,
    input.selectedEndpointTarget?.compatibilityPolicy || undefined,
  );
}
