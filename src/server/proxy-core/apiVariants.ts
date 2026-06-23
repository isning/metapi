import type { UpstreamEndpoint } from './orchestration/upstreamRequest.js';

export const API_TYPES = [
  'openai_chat_completions',
  'openai_responses',
  'anthropic_messages',
  'openai_embeddings',
  'openai_completions',
  'openai_images_generations',
  'openai_images_edits',
  'openai_videos_generations',
  'openai_videos',
  'gemini_generate_content',
  'newapi_chat_completions',
  'newapi_responses',
  'vendor_native',
  'custom_http',
] as const;

export type ApiType = typeof API_TYPES[number];

export type ApiVariantCapabilityState = 'native' | 'emulated' | 'unsupported' | 'unknown';
export type ApiVariantSupportState = 'supported' | 'unsupported' | 'unknown' | 'blocked';
export type ApiVariantSource = 'discovered' | 'manual' | 'inherited' | 'default';

export interface ApiVariantCapability {
  status: 'supported' | 'unsupported' | 'emulated' | 'unknown';
  input: {
    text: ApiVariantCapabilityState;
    image: ApiVariantCapabilityState;
    audio: ApiVariantCapabilityState;
    tools: ApiVariantCapabilityState;
    toolChoice: ApiVariantCapabilityState;
    jsonSchema: ApiVariantCapabilityState;
    stream: ApiVariantCapabilityState;
  };
  output: {
    text: ApiVariantCapabilityState;
    reasoning: ApiVariantCapabilityState;
    toolCalls: ApiVariantCapabilityState;
    usage: ApiVariantCapabilityState;
    citations: ApiVariantCapabilityState;
  };
  limits?: {
    maxContextTokens?: number;
    maxOutputTokens?: number;
  };
}

export interface ApiVariantCapabilityOverride {
  status?: ApiVariantCapability['status'];
  input?: Partial<ApiVariantCapability['input']>;
  output?: Partial<ApiVariantCapability['output']>;
  limits?: ApiVariantCapability['limits'];
}

export interface ApiEndpointProfile {
  id: string;
  siteId: number;
  apiType: ApiType;
  label: string;
  baseUrl?: string | null;
  pathTemplate?: string | null;
  authMode: 'bearer' | 'api_key_header' | 'query' | 'custom';
  enabled: boolean;
  priority?: number;
  capabilityDefaults: ApiVariantCapability;
  compatibilityPolicyRef?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CredentialEndpointBinding {
  id: string;
  siteId: number;
  credentialId: string;
  apiEndpointProfileId: string;
  enabled: boolean;
  support: ApiVariantSupportState;
  source: ApiVariantSource;
  priority?: number;
  capabilityOverride?: ApiVariantCapabilityOverride;
  compatibilityPolicyRef?: string | null;
  pricingPolicyRef?: string | null;
  measuredPricingRef?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SupplyTarget {
  id: string;
  routeEndpointId?: string | null;
  siteId: number;
  credentialId?: string | null;
  upstreamModel: string;
  canonicalModel: string;
  platform?: string | null;
  scopeKey?: string | null;
  enabled: boolean;
  resolutionStatus: 'resolved' | 'unresolved' | 'degraded';
  defaultVariantPolicy?: ApiVariantPolicy;
  metadata?: Record<string, unknown>;
}

export interface ApiVariantPolicy {
  pinnedApiType?: ApiType | null;
  pinnedCredentialEndpointBindingId?: string | null;
  allowFallback?: boolean;
  allowUnknownBindings?: boolean;
}

export interface ApiVariant {
  id: string;
  supplyTargetId: string;
  apiType: ApiType;
  upstreamEndpoint: UpstreamEndpoint;
  apiEndpointProfileId: string;
  credentialEndpointBindingId: string;
  adapterId: string;
  capability: ApiVariantCapability;
  health: {
    status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
    reason?: string | null;
  };
  pricingPolicyRef?: string | null;
  measuredPricingRef?: string | null;
  compatibilityPolicyRef?: string | null;
  fallbackPolicy?: {
    downgradeAllowed: boolean;
  };
  priority?: number;
  metadata?: Record<string, unknown>;
}

export type ApiAttemptReason =
  | 'derived_endpoint_order'
  | 'credential_binding_supported'
  | 'default_binding'
  | 'pinned_api_type'
  | 'pinned_binding';

export interface ApiAttempt {
  id: string;
  variantId: string;
  supplyTargetId: string;
  apiType: ApiType;
  upstreamEndpoint: UpstreamEndpoint;
  adapterId: string;
  credentialEndpointBindingId: string;
  apiEndpointProfileId: string;
  reason: ApiAttemptReason[];
  downgradeAllowed: boolean;
}

export interface ApiAttemptDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  apiType?: ApiType;
  upstreamEndpoint?: UpstreamEndpoint;
  credentialEndpointBindingId?: string;
  apiEndpointProfileId?: string;
}

export interface ApiAttemptPlan {
  supplyTargetId: string;
  attempts: ApiAttempt[];
  variants: ApiVariant[];
  diagnostics: ApiAttemptDiagnostic[];
}

export interface BuildApiAttemptPlanInput {
  siteId: number;
  credentialId?: number | string | null;
  modelName?: string | null;
  canonicalModel?: string | null;
  supplyTargetId?: string | null;
  endpointCandidates: UpstreamEndpoint[];
  endpointProfiles?: ApiEndpointProfile[];
  credentialEndpointBindings?: CredentialEndpointBinding[];
  policy?: ApiVariantPolicy | null;
  disableCrossProtocolFallback?: boolean;
}

export const DEFAULT_API_VARIANT_CAPABILITY: ApiVariantCapability = Object.freeze({
  status: 'unknown',
  input: Object.freeze({
    text: 'unknown',
    image: 'unknown',
    audio: 'unknown',
    tools: 'unknown',
    toolChoice: 'unknown',
    jsonSchema: 'unknown',
    stream: 'unknown',
  }),
  output: Object.freeze({
    text: 'unknown',
    reasoning: 'unknown',
    toolCalls: 'unknown',
    usage: 'unknown',
    citations: 'unknown',
  }),
});

const UPSTREAM_ENDPOINT_TO_API_TYPE: Record<UpstreamEndpoint, ApiType> = {
  chat: 'openai_chat_completions',
  messages: 'anthropic_messages',
  responses: 'openai_responses',
  embeddings: 'openai_embeddings',
  completions: 'openai_completions',
  'images/generations': 'openai_images_generations',
  'images/edits': 'openai_images_edits',
  'videos/generations': 'openai_videos_generations',
  videos: 'openai_videos',
};

const API_TYPE_TO_UPSTREAM_ENDPOINT = new Map<ApiType, UpstreamEndpoint>(
  Object.entries(UPSTREAM_ENDPOINT_TO_API_TYPE)
    .map(([endpoint, apiType]) => [apiType, endpoint as UpstreamEndpoint]),
);

function asStableSegment(value: unknown, fallback = 'unknown'): string {
  const normalized = String(value ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function uniqueEndpoints(endpoints: UpstreamEndpoint[]): UpstreamEndpoint[] {
  const seen = new Set<UpstreamEndpoint>();
  const next: UpstreamEndpoint[] = [];
  for (const endpoint of endpoints) {
    if (seen.has(endpoint)) continue;
    seen.add(endpoint);
    next.push(endpoint);
  }
  return next;
}

function mergeCapability(
  base: ApiVariantCapability,
  override?: ApiVariantCapabilityOverride,
): ApiVariantCapability {
  if (!override) return base;
  return {
    ...base,
    ...override,
    input: {
      ...base.input,
      ...(override.input || {}),
    },
    output: {
      ...base.output,
      ...(override.output || {}),
    },
    limits: override.limits || base.limits,
  };
}

function sortBindings(left: CredentialEndpointBinding, right: CredentialEndpointBinding): number {
  const priority = (left.priority ?? 0) - (right.priority ?? 0);
  if (priority !== 0) return priority;
  return left.id.localeCompare(right.id);
}

export function apiTypeFromUpstreamEndpoint(endpoint: UpstreamEndpoint): ApiType {
  return UPSTREAM_ENDPOINT_TO_API_TYPE[endpoint] || 'custom_http';
}

export function upstreamEndpointFromApiType(apiType: ApiType): UpstreamEndpoint | null {
  return API_TYPE_TO_UPSTREAM_ENDPOINT.get(apiType) || null;
}

export function buildSupplyTargetId(input: {
  siteId: number | string;
  credentialId?: number | string | null;
  scopeKey?: string | null;
  canonicalModel?: string | null;
  modelName?: string | null;
}): string {
  return [
    'supply-target',
    `site-${asStableSegment(input.siteId)}`,
    `credential-${asStableSegment(input.credentialId ?? 'default')}`,
    asStableSegment(input.scopeKey ?? 'default'),
    asStableSegment(input.canonicalModel || input.modelName || 'model'),
  ].join(':');
}

export function buildDefaultApiEndpointProfile(input: {
  siteId: number;
  endpoint: UpstreamEndpoint;
}): ApiEndpointProfile {
  const apiType = apiTypeFromUpstreamEndpoint(input.endpoint);
  return {
    id: `api-endpoint:site-${asStableSegment(input.siteId)}:${apiType}`,
    siteId: input.siteId,
    apiType,
    label: apiType,
    authMode: 'bearer',
    enabled: true,
    capabilityDefaults: DEFAULT_API_VARIANT_CAPABILITY,
    metadata: {
      upstreamEndpoint: input.endpoint,
      source: 'default',
    },
  };
}

export function buildDefaultCredentialEndpointBinding(input: {
  credentialId?: number | string | null;
  profile: ApiEndpointProfile;
}): CredentialEndpointBinding {
  const credentialId = String(input.credentialId ?? 'default');
  return {
    id: `credential-endpoint:${asStableSegment(credentialId)}:${input.profile.id}`,
    siteId: input.profile.siteId,
    credentialId,
    apiEndpointProfileId: input.profile.id,
    enabled: true,
    support: 'supported',
    source: 'default',
    priority: input.profile.priority,
  };
}

function defaultBindingForEndpoint(input: {
  siteId: number;
  credentialId?: number | string | null;
  endpoint: UpstreamEndpoint;
}): { profile: ApiEndpointProfile; binding: CredentialEndpointBinding } {
  const profile = buildDefaultApiEndpointProfile({
    siteId: input.siteId,
    endpoint: input.endpoint,
  });
  return {
    profile,
    binding: buildDefaultCredentialEndpointBinding({
      credentialId: input.credentialId,
      profile,
    }),
  };
}

function bindingCanPlan(
  binding: CredentialEndpointBinding,
  input: {
    allowUnknownBindings: boolean;
  },
): boolean {
  if (!binding.enabled) return false;
  if (binding.support === 'supported') return true;
  return binding.support === 'unknown' && input.allowUnknownBindings;
}

function buildVariant(input: {
  supplyTargetId: string;
  endpoint: UpstreamEndpoint;
  profile: ApiEndpointProfile;
  binding: CredentialEndpointBinding;
  downgradeAllowed: boolean;
}): ApiVariant {
  const capability = mergeCapability(input.profile.capabilityDefaults, input.binding.capabilityOverride);
  return {
    id: `api-variant:${input.supplyTargetId}:${input.binding.id}`,
    supplyTargetId: input.supplyTargetId,
    apiType: input.profile.apiType,
    upstreamEndpoint: input.endpoint,
    apiEndpointProfileId: input.profile.id,
    credentialEndpointBindingId: input.binding.id,
    adapterId: input.profile.apiType,
    capability,
    health: {
      status: input.binding.support === 'supported' ? 'unknown' : 'degraded',
      reason: input.binding.support === 'unknown' ? 'endpoint support is unknown' : null,
    },
    pricingPolicyRef: input.binding.pricingPolicyRef ?? null,
    measuredPricingRef: input.binding.measuredPricingRef ?? null,
    compatibilityPolicyRef: input.binding.compatibilityPolicyRef ?? input.profile.compatibilityPolicyRef ?? null,
    fallbackPolicy: {
      downgradeAllowed: input.downgradeAllowed,
    },
    priority: input.binding.priority ?? input.profile.priority,
    metadata: {
      source: input.binding.source,
    },
  };
}

function attemptFromVariant(input: {
  variant: ApiVariant;
  reason: ApiAttemptReason[];
  downgradeAllowed: boolean;
}): ApiAttempt {
  return {
    id: `api-attempt:${input.variant.id}`,
    variantId: input.variant.id,
    supplyTargetId: input.variant.supplyTargetId,
    apiType: input.variant.apiType,
    upstreamEndpoint: input.variant.upstreamEndpoint,
    adapterId: input.variant.adapterId,
    credentialEndpointBindingId: input.variant.credentialEndpointBindingId,
    apiEndpointProfileId: input.variant.apiEndpointProfileId,
    reason: input.reason,
    downgradeAllowed: input.downgradeAllowed,
  };
}

function reorderPinnedAttempts(attempts: ApiAttempt[], policy?: ApiVariantPolicy | null): ApiAttempt[] {
  if (!policy?.pinnedCredentialEndpointBindingId && !policy?.pinnedApiType) return attempts;

  const pinned: ApiAttempt[] = [];
  const rest: ApiAttempt[] = [];
  for (const attempt of attempts) {
    const matchesBinding = (
      !!policy.pinnedCredentialEndpointBindingId
      && attempt.credentialEndpointBindingId === policy.pinnedCredentialEndpointBindingId
    );
    const matchesApiType = !!policy.pinnedApiType && attempt.apiType === policy.pinnedApiType;
    if (matchesBinding || matchesApiType) {
      pinned.push({
        ...attempt,
        reason: [
          ...attempt.reason,
          matchesBinding ? 'pinned_binding' : 'pinned_api_type',
        ],
      });
    } else {
      rest.push(attempt);
    }
  }
  return pinned.length > 0 ? [...pinned, ...rest] : attempts;
}

export function buildApiAttemptPlan(input: BuildApiAttemptPlanInput): ApiAttemptPlan {
  const supplyTargetId = input.supplyTargetId || buildSupplyTargetId({
    siteId: input.siteId,
    credentialId: input.credentialId,
    canonicalModel: input.canonicalModel,
    modelName: input.modelName,
  });
  const allowUnknownBindings = input.policy?.allowUnknownBindings === true;
  const downgradeAllowed = input.policy?.allowFallback !== false && input.disableCrossProtocolFallback !== true;
  const diagnostics: ApiAttemptDiagnostic[] = [];
  const variants: ApiVariant[] = [];
  const attempts: ApiAttempt[] = [];
  const endpoints = uniqueEndpoints(input.endpointCandidates);
  const profilesById = new Map((input.endpointProfiles || []).map((profile) => [profile.id, profile]));
  const hasExplicitBindings = Array.isArray(input.credentialEndpointBindings);

  for (const endpoint of endpoints) {
    const apiType = apiTypeFromUpstreamEndpoint(endpoint);
    const candidateProfiles = hasExplicitBindings
      ? [...profilesById.values()].filter((profile) => (
          profile.siteId === input.siteId
          && profile.enabled
          && profile.apiType === apiType
        ))
      : [];
    const candidateBindings = hasExplicitBindings
      ? candidateProfiles
          .flatMap((profile) => {
            const bindings = (input.credentialEndpointBindings || [])
              .filter((binding) => (
                binding.siteId === input.siteId
                && (input.credentialId === null || input.credentialId === undefined || binding.credentialId === String(input.credentialId))
                && binding.apiEndpointProfileId === profile.id
              ))
              .sort(sortBindings);
            return bindings.length > 0
              ? bindings
              : [buildDefaultCredentialEndpointBinding({
                  credentialId: input.credentialId,
                  profile,
                })];
          })
          .sort(sortBindings)
      : [defaultBindingForEndpoint({ siteId: input.siteId, credentialId: input.credentialId, endpoint }).binding];

    if (hasExplicitBindings && candidateProfiles.length === 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'api_endpoint_profile.missing',
        message: `No endpoint profile is configured for ${apiType}.`,
        apiType,
        upstreamEndpoint: endpoint,
      });
      continue;
    }

    if (candidateBindings.length === 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'credential_endpoint_binding.missing',
        message: `No credential endpoint binding is configured for ${apiType}.`,
        apiType,
        upstreamEndpoint: endpoint,
      });
      continue;
    }

    for (const binding of candidateBindings) {
      const profile = profilesById.get(binding.apiEndpointProfileId) || defaultBindingForEndpoint({
        siteId: input.siteId,
        credentialId: input.credentialId,
        endpoint,
      }).profile;
      if (!bindingCanPlan(binding, { allowUnknownBindings })) {
        diagnostics.push({
          severity: binding.support === 'unknown' ? 'info' : 'warning',
          code: 'credential_endpoint_binding.not_plannable',
          message: `Credential endpoint binding ${binding.id} is ${binding.enabled ? binding.support : 'disabled'}.`,
          apiType,
          upstreamEndpoint: endpoint,
          credentialEndpointBindingId: binding.id,
          apiEndpointProfileId: binding.apiEndpointProfileId,
        });
        continue;
      }

      const variant = buildVariant({
        supplyTargetId,
        endpoint,
        profile,
        binding,
        downgradeAllowed,
      });
      variants.push(variant);
      attempts.push(attemptFromVariant({
        variant,
        reason: [
          'derived_endpoint_order',
          binding.source === 'default' ? 'default_binding' : 'credential_binding_supported',
        ],
        downgradeAllowed,
      }));
    }
  }

  const orderedAttempts = reorderPinnedAttempts(attempts, input.policy);

  return {
    supplyTargetId,
    attempts: orderedAttempts,
    variants,
    diagnostics,
  };
}

export function endpointCandidatesFromApiAttemptPlan(plan: ApiAttemptPlan): UpstreamEndpoint[] {
  return uniqueEndpoints(plan.attempts.map((attempt) => attempt.upstreamEndpoint));
}

export function summarizeApiAttemptPlanForDebug(plan: ApiAttemptPlan): Record<string, unknown> {
  return {
    supplyTargetId: plan.supplyTargetId,
    attempts: plan.attempts.map((attempt, index) => ({
      index,
      apiType: attempt.apiType,
      endpoint: attempt.upstreamEndpoint,
      variantId: attempt.variantId,
      credentialEndpointBindingId: attempt.credentialEndpointBindingId,
      apiEndpointProfileId: attempt.apiEndpointProfileId,
      reason: attempt.reason,
      downgradeAllowed: attempt.downgradeAllowed,
    })),
    diagnostics: plan.diagnostics,
  };
}
