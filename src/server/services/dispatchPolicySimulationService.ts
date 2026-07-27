import {
  estimateRuntimeSelectorProbabilities,
  evaluateRuntimeSelectorCandidates,
  selectRuntimeCandidate,
  type RuntimeSelectorCandidate,
  type RuntimeSelectorState,
} from './selectorEngine.js';
import { resolveDispatchSelectorPolicy } from './dispatchPolicyService.js';
import { getActiveRouteRuntimeArtifact } from './routeRuntimeArtifactService.js';
import { overlayCompiledRuntimeRoutingSignals } from './compiledRuntimeRoutingSignalOverlayService.js';
import { matchCompiledRouterPlanId } from './routeRuntimeEvaluatorService.js';
import {
  buildCompiledRuntimeSelectorCandidate,
  groupCompiledRuntimeSelectionOptions,
} from './compiledRuntimeSelectorScopes.js';
import type {
  DispatchPolicySimulationOption,
  DispatchPolicySimulationResult,
} from '../../shared/dispatchPolicyApi.js';
import type { CompiledRouteRuntimeRequest } from './compiledRuntimeRequestTypes.js';

type RecordValue = Record<string, unknown>;

export type { DispatchPolicySimulationOption } from '../../shared/dispatchPolicyApi.js';

export type DispatchPolicySimulationScope = {
  selectorId: string;
  mode: string;
  options: DispatchPolicySimulationOption[];
  runtimeCandidates: RuntimeSelectorCandidate<DispatchPolicySimulationOption>[];
};

export async function loadCompiledRuntimeDispatchSimulationScopes(input: {
  model: string;
  request?: CompiledRouteRuntimeRequest;
  requestKnown?: boolean;
}): Promise<DispatchPolicySimulationScope[]> {
  const active = await getActiveRouteRuntimeArtifact();
  const baseBundle = active?.compiledGraph.compiledRouterBundle;
  if (!active || !baseBundle) return [];
  const planId = matchCompiledRouterPlanId(baseBundle, input.model);
  if (!planId) return [];
  const artifact = input.request
    ? await overlayCompiledRuntimeRoutingSignals(active.compiledGraph, { request: input.request, planIds: [planId] })
    : active.compiledGraph;
  const bundle = artifact.compiledRouterBundle;
  const plan = bundle?.plans.find((item) => item.id === planId);
  if (!bundle || !plan) return [];
  const scopes = new Map<string, DispatchPolicySimulationScope>();
  const termIds = Array.from(new Set(plan.executionAlternatives.flatMap((alternative) => (
    alternative.enabled === false ? [] : alternative.selectionTerms.map((term) => term.termId)
  ))));
  for (const termId of termIds) {
    const alternatives = plan.executionAlternatives.filter((alternative) => (
      alternative.enabled !== false && alternative.selectionTerms.some((term) => term.termId === termId)
    ));
    const runtimeOptions = groupCompiledRuntimeSelectionOptions(alternatives, termId);
    if (!runtimeOptions?.length) continue;
    const runtimeCandidates = runtimeOptions.map((option, index) => buildCompiledRuntimeSelectorCandidate({ option, index, plan, bundle }));
    const firstTerm = runtimeOptions[0].term;
    const options = runtimeCandidates.map((candidate, index) => ({
      id: runtimeOptions[index].optionId,
      label: String(candidate.executionAttempt?.model || candidate.endpoint?.model || runtimeOptions[index].optionId),
      enabled: candidate.enabled,
      weight: candidate.weight,
      order: candidate.order,
      runtime: record(candidate.runtime),
      selection: record(candidate.selection),
      endpoint: record(candidate.endpoint),
      executionAttempt: record(candidate.executionAttempt),
      plan: record(candidate.plan),
      graph: record(candidate.graph),
    }));
    scopes.set(termId, {
      selectorId: termId,
      mode: firstTerm.mode,
      options,
      runtimeCandidates: runtimeCandidates.map((candidate, index) => ({ ...candidate, payload: options[index] })),
    });
  }
  return Array.from(scopes.values());
}

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

function number(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function simulateDispatchPolicy(input: {
  policy: unknown;
  options: DispatchPolicySimulationOption[];
  request?: CompiledRouteRuntimeRequest;
  requestKnown?: boolean;
  runtimeCandidates?: RuntimeSelectorCandidate<DispatchPolicySimulationOption>[];
}): DispatchPolicySimulationResult {
  const resolved = resolveDispatchSelectorPolicy(input.policy);
  const state: RuntimeSelectorState = {
    requestKnown: input.requestKnown === true,
    request: input.request,
    payload: input.request?.payload,
    headers: record(input.request?.headers),
    stateStore: {},
  };
  const candidates: RuntimeSelectorCandidate<DispatchPolicySimulationOption>[] = input.runtimeCandidates || input.options.map((option, idx) => ({
    idx,
    kind: 'compiled_runtime_option',
    enabled: option.enabled !== false,
    weight: number(option.weight, 1),
    score: number(option.weight, 1),
    order: number(option.order, idx),
    metadata: {},
    runtime: record(option.runtime),
    selection: record(option.selection),
    endpoint: record(option.endpoint),
    executionAttempt: record(option.executionAttempt),
    plan: record(option.plan),
    graph: record(option.graph),
    payload: option,
  }));
  const estimate = estimateRuntimeSelectorProbabilities({ selectorId: 'simulation', policy: resolved.selectorPolicy, candidates, state });
  const evaluated = estimate.estimateLevel === 'static'
    ? evaluateRuntimeSelectorCandidates({ policy: resolved.selectorPolicy, candidates, state })
    : candidates;
  const byIndex = new Map(evaluated.map((option) => [option.idx, option]));
  const selected = estimate.estimateLevel === 'static'
    ? selectRuntimeCandidate({ selectorId: 'simulation', policy: resolved.selectorPolicy, candidates, state, random: () => 0.5 })
    : null;
  return {
    strategy: String(resolved.selectorPolicy.strategy || 'weighted'),
    selectionMode: resolved.resolvedPolicy?.selectionMode ?? null,
    selectedOptionId: selected?.payload?.id ?? null,
    options: input.options.map((option, idx) => {
      const result = byIndex.get(idx);
      return {
        id: option.id,
        label: option.label || option.id,
        eligible: result?.enabled === true,
        contribution: result?.weight ?? 0,
        order: result?.order ?? number(option.order, idx),
        score: result?.score ?? 0,
        probability: estimate.probabilities[idx] ?? null,
      };
    }),
  };
}
