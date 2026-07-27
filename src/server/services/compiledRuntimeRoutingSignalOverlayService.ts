import type {
  CompiledEndpointTarget,
  CompiledExecutionAlternative,
  CompiledExecutionSelectionTerm,
  CompiledRouterBundle,
  CompiledRouterPlan,
} from '../../shared/compiledRuntime.js';
import {
  getCompiledExecutionAttemptId,
  getCompiledExecutionTargetId,
  getCompiledRouterPlanById,
} from '../../shared/compiledRuntime.js';
import {
  type RuntimeHealthSummary,
} from './compiledRuntimeProjectionService.js';
import {
  buildRuntimeRoutingSignalMap,
  type RuntimeRoutingSignalContext,
} from './compiledRuntimeRoutingSignalService.js';
import {
  buildCompiledRuntimeRoutingSignalContexts,
  type CompiledRuntimeSignalAttempt,
  type RuntimeCredentialIdentity,
} from './compiledRuntimeAttemptContextService.js';
import type { RouteRuntimeStorageArtifact } from './routeRuntimeArtifactService.js';
import type { CompiledRouteRuntimeRequest } from './compiledRuntimeRequestTypes.js';
import {
  collectCompiledRuntimeRoutingSignalSharedTermIds,
  compiledRuntimeRoutingSignalScopeId,
} from './compiledRuntimeRoutingSignalScope.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function cloneExecutionAlternativeForRoutingOverlay(
  alternative: CompiledExecutionAlternative,
): CompiledExecutionAlternative {
  return {
    ...alternative,
    selectionTerms: (alternative.selectionTerms || []).map((term) => ({
      ...term,
      metadata: term.metadata ? { ...term.metadata } : undefined,
      runtime: term.runtime ? { ...term.runtime } : undefined,
    })),
    endpoint: alternative.endpoint
      ? {
          ...alternative.endpoint,
          metadata: alternative.endpoint.metadata ? { ...alternative.endpoint.metadata } : undefined,
          runtime: alternative.endpoint.runtime ? { ...alternative.endpoint.runtime } : undefined,
        }
      : alternative.endpoint,
    executionAttempt: alternative.executionAttempt
      ? {
          ...alternative.executionAttempt,
          metadata: alternative.executionAttempt.metadata ? { ...alternative.executionAttempt.metadata } : undefined,
          runtime: alternative.executionAttempt.runtime ? { ...alternative.executionAttempt.runtime } : undefined,
        }
      : alternative.executionAttempt,
    runtime: alternative.runtime ? { ...alternative.runtime } : undefined,
  };
}

function defaultHealth(): RuntimeHealthSummary {
  return {
    successRate: null,
    totalCalls: 0,
    avgLatencyMs: null,
    cooldownUntil: null,
    consecutiveFailureCount: null,
  };
}

function selectedExecutionAttemptTerm(
  alternative: CompiledExecutionAlternative,
): CompiledExecutionSelectionTerm | null {
  return [...(alternative.selectionTerms || [])].reverse()
    .find((term) => term.mode === 'execution_attempt')
    || alternative.selectionTerms.at(-1)
    || null;
}

export function compiledRuntimeSignalAttemptFromAlternative(input: {
  alternative: CompiledExecutionAlternative;
  plan: Pick<CompiledRouterPlan, 'id' | 'entryNodeId' | 'publicModelName'>;
  index: number;
}): CompiledRuntimeSignalAttempt | null {
  const target = input.alternative.executionAttempt;
  if (!target) return null;
  const executionAttemptId = getCompiledExecutionAttemptId(target);
  const executionTargetId = getCompiledExecutionTargetId(target);
  if (!executionAttemptId || executionTargetId == null) return null;
  const term = selectedExecutionAttemptTerm(input.alternative);
  const model = target.modelSource === 'request'
    ? input.plan.publicModelName
    : asTrimmedString(target.model);
  if (!model) return null;
  return {
    executionAttemptId,
    entryId: input.plan.entryNodeId,
    endpointId: input.alternative.endpoint?.endpointId || (
      input.alternative.terminal.kind === 'supply' ? input.alternative.terminal.endpointId : ''
    ),
    model,
    enabled: target.enabled !== false && input.alternative.enabled !== false,
    siteId: asPositiveInteger(target.siteId),
    accountId: asPositiveInteger(target.accountId),
    tokenId: asPositiveInteger(target.tokenId),
    tokenGroup: isRecord(target.metadata) ? asTrimmedString(target.metadata.tokenGroup) || null : null,
    executionTargetId,
    weight: asFiniteNumber(term?.weight ?? target.weight),
    order: asFiniteNumber(term?.order) ?? input.index,
    health: defaultHealth(),
  };
}

export function compiledRuntimeSelectionGroupIdForAlternative(input: {
  alternative: CompiledExecutionAlternative;
  plan: Pick<CompiledRouterPlan, 'id'>;
  sharedTermIds?: Set<string>;
}): string {
  return compiledRuntimeRoutingSignalScopeId({
    planId: input.plan.id,
    selectionTerms: input.alternative.selectionTerms,
    sharedTermIds: input.sharedTermIds,
  }) || `${input.plan.id}:execution_attempt`;
}

export async function attachCompiledRuntimeRoutingSignals(input: {
  alternatives: CompiledExecutionAlternative[];
  contexts: RuntimeRoutingSignalContext[];
  identities: Map<string, RuntimeCredentialIdentity>;
  request?: CompiledRouteRuntimeRequest | null;
}): Promise<void> {
  if (input.alternatives.length === 0 || input.contexts.length === 0) return;
  const routingSignalsByAttemptId = await buildRuntimeRoutingSignalMap({
    contexts: input.contexts,
    request: input.request,
  });

  for (const alternative of input.alternatives) {
    const target = alternative.executionAttempt;
    if (!target) continue;
    const executionAttemptId = getCompiledExecutionAttemptId(target);
    if (!executionAttemptId) continue;
    const routingSignals = routingSignalsByAttemptId.get(executionAttemptId);
    const identity = input.identities.get(executionAttemptId) || null;
    if (!routingSignals && !identity) continue;
    if (routingSignals) {
      alternative.selectionTerms = (alternative.selectionTerms || []).map((term) => ({
        ...term,
        runtime: {
          ...(term.runtime || {}),
          routingSignals,
        },
      }));
    }
    alternative.executionAttempt = {
      ...target,
      ...(identity ? {
        siteId: identity.siteId,
        accountId: identity.accountId,
        tokenId: identity.tokenId,
      } : {}),
      runtime: {
        ...(target.runtime || {}),
        ...(routingSignals ? { routingSignals } : {}),
      },
    };
    if (routingSignals) {
      alternative.runtime = {
        ...(alternative.runtime || {}),
        routingSignals,
      };
    }
  }
}

export async function overlayCompiledRuntimeRoutingSignals(
  artifact: RouteRuntimeStorageArtifact,
  options: {
    request?: CompiledRouteRuntimeRequest | null;
    planIds?: string[];
  } = {},
): Promise<RouteRuntimeStorageArtifact> {
  const bundle = artifact.compiledRouterBundle;
  if (!bundle?.plans?.length) return artifact;

  const selectedPlanIds = new Set((options.planIds || []).map(asTrimmedString).filter(Boolean));
  const storedPlans = selectedPlanIds.size > 0
    ? bundle.plans.filter((plan) => selectedPlanIds.has(plan.id))
    : bundle.plans;
  const plansToOverlay = storedPlans
    .map((storedPlan) => getCompiledRouterPlanById(bundle, storedPlan.id))
    .filter((plan): plan is CompiledRouterPlan => !!plan);
  const attempts: CompiledRuntimeSignalAttempt[] = [];
  const selectionGroupIdByExecutionAttemptId = new Map<string, string>();
  const overlaidPlans = new Map<string, CompiledRouterPlan>();
  for (const plan of plansToOverlay) {
    const executionAlternatives = (plan.executionAlternatives || []).map(cloneExecutionAlternativeForRoutingOverlay);
    const sharedTermIds = collectCompiledRuntimeRoutingSignalSharedTermIds(executionAlternatives);
    executionAlternatives.forEach((alternative, index) => {
      const attempt = compiledRuntimeSignalAttemptFromAlternative({
        alternative,
        plan,
        index,
      });
      if (!attempt) return;
      attempts.push(attempt);
      selectionGroupIdByExecutionAttemptId.set(
        attempt.executionAttemptId,
        compiledRuntimeSelectionGroupIdForAlternative({ alternative, plan, sharedTermIds }),
      );
    });
    overlaidPlans.set(plan.id, {
      ...plan,
      executionAlternatives,
    });
  }
  if (attempts.length === 0) return artifact;

  const contextLoad = await buildCompiledRuntimeRoutingSignalContexts({
    attempts,
    selectionGroupIdByExecutionAttemptId,
  });
  await attachCompiledRuntimeRoutingSignals({
    alternatives: Array.from(overlaidPlans.values()).flatMap((plan) => plan.executionAlternatives || []),
    contexts: contextLoad.signalContexts,
    identities: contextLoad.identities,
    request: options.request,
  });

  const nextBundle: CompiledRouterBundle = {
    ...bundle,
    plans: bundle.plans.map((plan) => overlaidPlans.get(plan.id) || plan),
  };
  return {
    ...artifact,
    compiledRouterBundle: nextBundle,
  };
}
