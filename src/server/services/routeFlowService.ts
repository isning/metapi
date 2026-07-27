import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  buildRouteRuntimeProjection,
  type RouteRuntimeSelectionSnapshot,
} from './routeRuntimeExecutionService.js';
import type { CompiledRouteRuntimeRequest } from './compiledRuntimeRequestTypes.js';
import {
  estimateCompiledRuntimeEntryPricing,
  type EntryPricingUsage,
  type EntryPricingEstimate,
} from './routeEntryPricingService.js';
import {
  type CompiledRuntimeProjection,
  type RuntimeApiAttemptDiagnosticProjection,
  type RuntimeApiAttemptProjection,
  type RuntimeProbabilityStatus,
} from './compiledRuntimeProjectionService.js';
import {
  buildRuntimeRoutingSignalMap,
} from './compiledRuntimeRoutingSignalService.js';
import {
  buildCompiledRuntimeRoutingSignalContexts,
  type RuntimeCredentialIdentity,
} from './compiledRuntimeAttemptContextService.js';
import {
  collectCompiledRuntimeRoutingSignalSharedTermIds,
  compiledRuntimeRoutingSignalScopeId,
} from './compiledRuntimeRoutingSignalScope.js';
import {
  resolveDispatchUpstreamCompatibilityPolicy,
} from './upstreamCompatibilityPolicyResolver.js';
import {
  buildApiAttemptPlan,
  type ApiAttemptDiagnostic,
} from '../proxy-core/apiVariants.js';
import { loadCredentialApiVariantConfig } from './credentialEndpointBindingService.js';
import type { ResolvedUpstreamCompatibilityPolicy } from '../contracts/upstreamCompatibilityPolicy.js';
import {
  resolveUpstreamEndpointCandidates,
  type EndpointPreference,
} from './upstreamEndpointDerivation.js';

export type RouteFlowDiagnosticLevel = 'info' | 'warn' | 'error';

export type RouteFlowDiagnostic = {
  level: RouteFlowDiagnosticLevel;
  message: string;
};

export type RuntimeEntryPricingEstimate = EntryPricingEstimate;

export type CompiledRouteFlow = {
  requestedModel: string;
  matched: boolean;
  diagnostics: RouteFlowDiagnostic[];
  compiledRuntime: CompiledRuntimeProjection | null;
  entryPricing?: {
    theoretical: RuntimeEntryPricingEstimate | null;
  };
  compatibilityPolicy?: {
    resolved: ResolvedUpstreamCompatibilityPolicy;
    layers: Array<{
      source: 'site' | 'account' | 'token' | 'endpoint_policy' | 'execution_attempt';
      configured: boolean;
    }>;
  };
  projectedAt: string;
};

function trimDisplay(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function runtimeApiAttemptDiagnosticLevel(severity: ApiAttemptDiagnostic['severity']): RuntimeApiAttemptDiagnosticProjection['level'] {
  if (severity === 'error') return 'error';
  if (severity === 'warning') return 'warn';
  return 'info';
}

function routeFlowEndpointPreference(request?: CompiledRouteRuntimeRequest | null): EndpointPreference {
  const path = trimDisplay(request?.path).toLowerCase();
  if (path.includes('/messages')) return 'claude';
  if (path.includes('/responses')) return 'responses';
  if (path.includes('generatecontent') || path.includes('/gemini')) return 'gemini';
  return 'openai';
}

function runtimeApiAttemptPreview(
  attempt: ReturnType<typeof buildApiAttemptPlan>['attempts'][number],
  order: number,
): RuntimeApiAttemptProjection {
  return {
    apiAttemptId: attempt.id,
    order,
    apiType: attempt.apiType,
    upstreamEndpoint: attempt.upstreamEndpoint,
    requestMethod: attempt.requestMethod,
    requestUrl: attempt.requestUrl,
    adapterId: attempt.adapterId,
    credentialEndpointBindingId: attempt.credentialEndpointBindingId,
    apiEndpointProfileId: attempt.apiEndpointProfileId,
    downgradeAllowed: attempt.downgradeAllowed,
    reason: [...attempt.reason],
  };
}

function runtimeApiAttemptDiagnosticPreview(
  diagnostic: ApiAttemptDiagnostic,
): RuntimeApiAttemptDiagnosticProjection {
  return {
    level: runtimeApiAttemptDiagnosticLevel(diagnostic.severity),
    code: diagnostic.code,
    message: diagnostic.message,
    i18nKey: diagnostic.i18nKey,
    values: diagnostic.values,
    apiType: diagnostic.apiType,
    upstreamEndpoint: diagnostic.upstreamEndpoint,
    credentialEndpointBindingId: diagnostic.credentialEndpointBindingId,
    apiEndpointProfileId: diagnostic.apiEndpointProfileId,
  };
}

async function loadRuntimeApiAttemptPlans(
  attempts: CompiledRuntimeProjection['executionAttempts'],
  identities: Map<string, RuntimeCredentialIdentity>,
  request?: CompiledRouteRuntimeRequest | null,
): Promise<Map<string, {
  apiAttempts: RuntimeApiAttemptProjection[];
  apiAttemptDiagnostics: RuntimeApiAttemptDiagnosticProjection[];
}>> {
  const result = new Map<string, {
    apiAttempts: RuntimeApiAttemptProjection[];
    apiAttemptDiagnostics: RuntimeApiAttemptDiagnosticProjection[];
  }>();
  await Promise.all(attempts.map(async (attempt) => {
    const identity = identities.get(attempt.executionAttemptId) || null;
    const siteId = Math.trunc(Number(identity?.siteId));
    const accountId = Math.trunc(Number(identity?.accountId));
    if (!identity || !Number.isSafeInteger(siteId) || siteId <= 0 || !Number.isSafeInteger(accountId) || accountId <= 0) {
      result.set(attempt.executionAttemptId, {
        apiAttempts: [],
        apiAttemptDiagnostics: [{
          level: 'warn',
          code: 'compiled_runtime.execution_attempt_identity_missing',
          message: 'Compiled runtime execution attempt does not resolve to a current credential identity.',
        }],
      });
      return;
    }
    const tokenId = identity.tokenId ?? null;
    const modelName = attempt.model;
    if (!modelName) {
      result.set(attempt.executionAttemptId, {
        apiAttempts: [],
        apiAttemptDiagnostics: [{
          level: 'warn',
          code: 'compiled_runtime.execution_attempt_model_missing',
          message: 'Compiled runtime execution attempt does not declare an upstream model.',
        }],
      });
      return;
    }
    const config = await loadCredentialApiVariantConfig({
      siteId,
      accountId,
      tokenId,
      modelName,
    });
    const endpointCandidates = await resolveUpstreamEndpointCandidates(
      {
        site: {
          id: identity.siteId,
          url: identity.siteUrl,
          platform: identity.sitePlatform,
        },
        account: {
          id: identity.accountId,
          username: identity.accountUsername,
          extraConfig: identity.accountExtraConfig,
        },
      },
      modelName,
      routeFlowEndpointPreference(request),
      request?.requestedModel || modelName,
      undefined,
      { oauthProvider: identity.accountOauthProvider, useCatalogOrdering: false },
    );
    const credentialId = config?.credentialKey.credentialKey ?? (
      tokenId ? `account-token:${tokenId}` : `account:${accountId}`
    );
    const plan = buildApiAttemptPlan({
      siteId,
      credentialId,
      modelName,
      canonicalModel: modelName,
      supplyTargetId: attempt.executionAttemptId,
      endpointCandidates,
      endpointProfiles: config?.endpointProfiles,
      credentialEndpointBindings: config?.credentialEndpointBindings,
      endpointModelObservations: config?.endpointModelObservations,
      siteUrl: identity?.siteUrl || null,
      disableCrossProtocolFallback: false,
    });
    result.set(attempt.executionAttemptId, {
      apiAttempts: plan.attempts.map(runtimeApiAttemptPreview),
      apiAttemptDiagnostics: plan.diagnostics.map(runtimeApiAttemptDiagnosticPreview),
    });
  }));
  return result;
}

async function enrichCompiledRuntimeProjection(
  runtime: CompiledRuntimeProjection,
  request?: CompiledRouteRuntimeRequest | null,
): Promise<CompiledRuntimeProjection> {
  if (runtime.executionAttempts.length === 0) return runtime;

  const alternativeById = new Map(runtime.alternatives.map((alternative) => [alternative.alternativeId, alternative]));
  const sharedTermIds = collectCompiledRuntimeRoutingSignalSharedTermIds(runtime.alternatives);
  const selectionGroupIdByExecutionAttemptId = new Map<string, string>();
  for (const attempt of runtime.executionAttempts) {
    const alternative = alternativeById.get(attempt.alternativeId) || null;
    const selectionGroupId = compiledRuntimeRoutingSignalScopeId({
      planId: runtime.match.planId,
      selectionTerms: alternative?.selectionTerms,
      sharedTermIds,
    });
    if (selectionGroupId) {
      selectionGroupIdByExecutionAttemptId.set(attempt.executionAttemptId, selectionGroupId);
    }
  }
  const signalAttempts = runtime.executionAttempts
    .filter((attempt): attempt is (typeof runtime.executionAttempts)[number] & { model: string } => (
      typeof attempt.model === 'string' && attempt.model.trim().length > 0
    ))
    .map((attempt) => ({ ...attempt, entryId: runtime.match.entryNodeId }));
  const contextLoad = await buildCompiledRuntimeRoutingSignalContexts({
    attempts: signalAttempts,
    selectionGroupIdByExecutionAttemptId,
  });
  const { identities, healthByAttemptId } = contextLoad;
  const apiPlansByAttemptId = await loadRuntimeApiAttemptPlans(runtime.executionAttempts, identities, request);
  const routingSignalsByAttemptId = await buildRuntimeRoutingSignalMap({
    contexts: contextLoad.signalContexts,
    request,
  });

  const enrichedAttempts = runtime.executionAttempts.map((attempt) => {
    const identity = identities.get(attempt.executionAttemptId) || null;
    const health = healthByAttemptId.get(attempt.executionAttemptId) || null;
    const apiPlan = apiPlansByAttemptId.get(attempt.executionAttemptId) || null;
    const routingSignals = routingSignalsByAttemptId.get(attempt.executionAttemptId);
    return {
      ...attempt,
      siteId: identity?.siteId ?? null,
      siteName: identity?.siteName ?? null,
      siteUrl: identity?.siteUrl ?? null,
      sitePlatform: identity?.sitePlatform ?? null,
      accountId: identity?.accountId ?? null,
      accountLabel: trimDisplay(identity?.accountUsername) || null,
      tokenId: identity?.tokenId ?? null,
      tokenLabel: trimDisplay(identity?.tokenName) || null,
      tokenGroup: trimDisplay(identity?.tokenGroup) || null,
      probability: attempt.probability,
      probabilityStatus: attempt.probabilityStatus as RuntimeProbabilityStatus,
      health: {
        successRate: health?.successRate ?? null,
        totalCalls: health?.totalCalls ?? 0,
        avgLatencyMs: health?.avgLatencyMs ?? null,
        cooldownUntil: identity?.cooldownUntil ?? null,
        consecutiveFailureCount: identity?.consecutiveFailureCount ?? null,
      },
      apiAttempts: apiPlan?.apiAttempts || [],
      apiAttemptDiagnostics: apiPlan?.apiAttemptDiagnostics || [],
      routingSignals,
    };
  });
  const attemptById = new Map(enrichedAttempts.map((attempt) => [attempt.executionAttemptId, attempt]));
  const enrichedSelectedAttempt = runtime.selected.executionAttemptId
    ? attemptById.get(runtime.selected.executionAttemptId) || null
    : null;
  const enrichedAlternatives = runtime.alternatives.map((alternative) => {
    const attempts = alternative.executionAttemptIds
      .map((executionAttemptId) => attemptById.get(executionAttemptId) || null)
      .filter((attempt): attempt is (typeof enrichedAttempts)[number] => !!attempt);
    if (attempts.length === 0) return alternative;
    const probabilities = attempts
      .map((attempt) => attempt.probability)
      .filter((probability): probability is number => typeof probability === 'number' && Number.isFinite(probability));
    if (probabilities.length !== attempts.length) {
      return alternative;
    }
    return {
      ...alternative,
      probability: Math.min(1, probabilities.reduce((sum, probability) => sum + (probability || 0), 0)),
      probabilityStatus: 'static' as RuntimeProbabilityStatus,
    };
  });

  return {
    ...runtime,
    selected: {
      ...runtime.selected,
      accountId: enrichedSelectedAttempt?.accountId ?? null,
      tokenId: enrichedSelectedAttempt?.tokenId ?? null,
      siteId: enrichedSelectedAttempt?.siteId ?? null,
      actualModel: enrichedSelectedAttempt?.model ?? runtime.selected.actualModel ?? null,
    },
    alternatives: enrichedAlternatives,
    executionAttempts: enrichedAttempts,
  };
}

async function resolveCompiledRuntimeCompatibilityPolicy(input: {
  selection: RouteRuntimeSelectionSnapshot;
  selectedAttempt?: CompiledRuntimeProjection['executionAttempts'][number] | null;
}): Promise<CompiledRouteFlow['compatibilityPolicy']> {
  const selectedAttempt = input.selectedAttempt || null;
  const siteId = Number(selectedAttempt?.siteId);
  const accountId = Number(selectedAttempt?.accountId);
  const tokenId = Number(selectedAttempt?.tokenId);
  const [site, account, token] = await Promise.all([
    Number.isFinite(siteId) && siteId > 0
      ? db.select({ compatibilityPolicy: schema.sites.compatibilityPolicy })
        .from(schema.sites)
        .where(eq(schema.sites.id, Math.trunc(siteId)))
        .get()
      : Promise.resolve(null),
    Number.isFinite(accountId) && accountId > 0
      ? db.select({ extraConfig: schema.accounts.extraConfig })
        .from(schema.accounts)
        .where(eq(schema.accounts.id, Math.trunc(accountId)))
        .get()
      : Promise.resolve(null),
    Number.isFinite(tokenId) && tokenId > 0
      ? db.select({ compatibilityPolicy: schema.accountTokens.compatibilityPolicy })
        .from(schema.accountTokens)
        .where(eq(schema.accountTokens.id, Math.trunc(tokenId)))
        .get()
      : Promise.resolve(null),
  ]);

  return {
    resolved: resolveDispatchUpstreamCompatibilityPolicy({
      site,
      account,
      token,
      routeEndpointCompatibilityPolicy: input.selection.routeEndpointCompatibilityPolicy,
    }),
    layers: [
      { source: 'site', configured: !!site?.compatibilityPolicy },
      { source: 'account', configured: !!account?.extraConfig },
      { source: 'token', configured: !!token?.compatibilityPolicy },
      { source: 'endpoint_policy', configured: !!input.selection.routeEndpointCompatibilityPolicy },
      { source: 'execution_attempt', configured: false },
    ],
  };
}

export async function getCompiledRuntimeRouteFlow(
  model: string,
  options: {
    forcedExecutionAttemptId?: string | null;
    request?: CompiledRouteRuntimeRequest | null;
    pricingUsage?: EntryPricingUsage | null;
    includeEntryPricing?: boolean;
    includeCompatibilityPolicy?: boolean;
  } = {},
): Promise<CompiledRouteFlow> {
  const requestedModel = model.trim();
  const projectedAt = new Date().toISOString();
  const diagnostics: RouteFlowDiagnostic[] = [];
  const runtimeProjection = await buildRouteRuntimeProjection({
    requestedModel,
    request: options.request ?? null,
    forcedExecutionAttemptId: options.forcedExecutionAttemptId ?? null,
  });
  const routeBundle = runtimeProjection.routeBundle;
  const runtimeSelection = runtimeProjection.selection;

  if (!runtimeSelection || !routeBundle) {
    diagnostics.push({
      level: 'warn',
      message: routeBundle
        ? '当前模型没有命中启用的 compiled runtime 入口。'
        : '当前没有可用的 compiled runtime 路由包。',
    });
    return {
      requestedModel,
      matched: false,
      diagnostics,
      compiledRuntime: null,
      projectedAt,
    };
  }

  const rawRuntime = runtimeProjection.runtime;

  if (!rawRuntime) {
    diagnostics.push({
      level: 'error',
      message: 'Compiled runtime selection could not be projected for this model.',
    });
    return {
      requestedModel,
      matched: false,
      diagnostics,
      compiledRuntime: null,
      projectedAt,
    };
  }

  const compiledRuntime = await enrichCompiledRuntimeProjection(rawRuntime, options.request);
  if (compiledRuntime.syntheticResponse) {
    diagnostics.push({
      level: 'warn',
      message: compiledRuntime.syntheticResponse.message || '路由返回了配置的 synthetic response。',
    });
  }
  if (compiledRuntime.executionAttempts.length === 0 && !compiledRuntime.syntheticResponse) {
    diagnostics.push({
      level: 'warn',
      message: 'Compiled runtime did not expose any execution attempts for this model.',
    });
  }
  const missingSignalScopeCount = compiledRuntime.executionAttempts.filter((attempt) => (
    attempt.model
    && attempt.siteId != null
    && attempt.accountId != null
    && !attempt.routingSignals
  )).length;
  if (missingSignalScopeCount > 0) {
    diagnostics.push({
      level: 'warn',
      message: `${missingSignalScopeCount} execution attempt(s) are missing compiled selection scope metadata; routing signal estimates were not inferred for them.`,
    });
  }

  const selectedAttempt = compiledRuntime.executionAttempts
    .find((attempt) => attempt.executionAttemptId === compiledRuntime.selected.executionAttemptId) || null;
  const includeEntryPricing = options.includeEntryPricing !== false;
  const includeCompatibilityPolicy = options.includeCompatibilityPolicy !== false;
  const [entryPricing, compatibilityPolicy] = await Promise.all([
    includeEntryPricing
      ? estimateCompiledRuntimeEntryPricing({
          runtime: compiledRuntime,
          usage: options.pricingUsage ?? undefined,
        })
      : Promise.resolve(null),
    includeCompatibilityPolicy
      ? resolveCompiledRuntimeCompatibilityPolicy({
          selection: runtimeSelection,
          selectedAttempt,
        })
      : Promise.resolve(undefined),
  ]);

  return {
    requestedModel,
    matched: true,
    diagnostics,
    compiledRuntime,
    ...(includeEntryPricing ? { entryPricing: { theoretical: entryPricing } } : {}),
    ...(includeCompatibilityPolicy ? { compatibilityPolicy } : {}),
    projectedAt,
  };
}
