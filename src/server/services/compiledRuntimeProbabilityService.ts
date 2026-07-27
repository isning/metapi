import type {
  CompiledExecutionAlternative,
  CompiledRouterBundle,
  CompiledRouterPlan,
} from '../../shared/compiledRuntime.js';
import {
  buildCompiledRuntimeSelectorCandidate,
  groupCompiledRuntimeSelectionOptions,
  type CompiledRuntimeAlternativeProbability,
} from './compiledRuntimeSelectorScopes.js';
import {
  nextCommonCompiledRuntimeControl,
  selectLowestAvailableCompiledFallbackStage,
} from './compiledRuntimeControlFlow.js';
import { resolveDispatchSelectorPolicy } from './dispatchPolicyService.js';
import {
  estimateRuntimeSelectorProbabilities,
  type RuntimeSelectorState,
} from './selectorEngine.js';

export type CompiledRuntimeProbabilityStatus = CompiledRuntimeAlternativeProbability['status'];
export type CompiledRuntimeSelectionMode = 'weighted' | 'ordered' | 'round_robin' | 'direct';

export type CompiledRuntimeProbabilityEstimate = {
  probabilities: Map<string, CompiledRuntimeAlternativeProbability>;
  selectionModes: Set<CompiledRuntimeSelectionMode>;
  incomplete: boolean;
};

function statusForLevel(level: 'static' | 'dynamic' | 'unsupported'): CompiledRuntimeProbabilityStatus {
  return level;
}

function combineStatus(
  left: CompiledRuntimeProbabilityStatus,
  right: CompiledRuntimeProbabilityStatus,
): CompiledRuntimeProbabilityStatus {
  if (left === 'unsupported' || right === 'unsupported') return 'unsupported';
  if (left === 'dynamic' || right === 'dynamic') return 'dynamic';
  return 'static';
}

function selectionMode(policy: unknown): CompiledRuntimeSelectionMode | null {
  const resolved = resolveDispatchSelectorPolicy(policy);
  const mode = resolved.resolvedPolicy?.selectionMode;
  if (mode === 'weighted' || mode === 'ordered' || mode === 'round_robin' || mode === 'direct') return mode;
  const strategy = String((resolved.selectorPolicy as Record<string, unknown>).strategy || '').trim();
  if (strategy === 'weighted' || strategy === 'policy_weighted') return 'weighted';
  if (strategy === 'round_robin' || strategy === 'policy_round_robin') return 'round_robin';
  if (strategy === 'stable_first' || strategy === 'policy_ordered') return 'ordered';
  if (strategy === 'direct') return 'direct';
  return null;
}

function inferSubset(input: {
  alternatives: CompiledExecutionAlternative[];
  processedControlKeys: Set<string>;
  plan: CompiledRouterPlan;
  bundle: CompiledRouterBundle;
  state?: RuntimeSelectorState;
}): CompiledRuntimeProbabilityEstimate {
  const alternatives = input.alternatives.filter((alternative) => alternative.enabled !== false);
  const control = nextCommonCompiledRuntimeControl({
    alternatives,
    processedControlKeys: input.processedControlKeys,
  });
  if (!control) {
    const deterministic = alternatives.length === 1;
    return {
      probabilities: new Map(alternatives.map((alternative) => [alternative.alternativeId, {
        probability: deterministic ? 1 : null,
        status: deterministic ? 'static' : 'unsupported',
      }])),
      selectionModes: new Set(),
      incomplete: !deterministic,
    };
  }

  const nextProcessed = new Set(input.processedControlKeys);
  nextProcessed.add(control.key);
  if (control.kind === 'fallback') {
    const selected = selectLowestAvailableCompiledFallbackStage({
      alternatives,
      fallbackId: control.fallbackId,
    });
    if (!selected) return { probabilities: new Map(), selectionModes: new Set(), incomplete: true };
    const downstream = inferSubset({ ...input, alternatives: selected.alternatives, processedControlKeys: nextProcessed });
    const selectedIds = new Set(selected.alternatives.map((alternative) => alternative.alternativeId));
    const probabilities = new Map(downstream.probabilities);
    for (const alternative of alternatives) {
      if (!selectedIds.has(alternative.alternativeId)) {
        probabilities.set(alternative.alternativeId, { probability: 0, status: 'static' });
      }
    }
    return { ...downstream, probabilities };
  }

  const options = groupCompiledRuntimeSelectionOptions(alternatives, control.termId);
  if (!options || options.length === 0) {
    return {
      probabilities: new Map(alternatives.map((alternative) => [alternative.alternativeId, { probability: null, status: 'unsupported' }])),
      selectionModes: new Set(),
      incomplete: true,
    };
  }
  const downstreamByOption = options.map((option) => inferSubset({
    ...input,
    alternatives: option.alternatives,
    processedControlKeys: nextProcessed,
  }));
  const resolved = resolveDispatchSelectorPolicy(options[0]!.term.policy);
  const estimate = estimateRuntimeSelectorProbabilities({
    selectorId: control.termId,
    policy: resolved.selectorPolicy,
    candidates: options.map((option, index) => buildCompiledRuntimeSelectorCandidate({
      index,
      option,
      plan: input.plan,
      bundle: input.bundle,
      enabled: option.term.enabled !== false,
      memberProbabilities: downstreamByOption[index]!.probabilities,
    })),
    state: input.state,
  });
  const probabilities = new Map<string, CompiledRuntimeAlternativeProbability>();
  const selectionModes = new Set<CompiledRuntimeSelectionMode>();
  const mode = selectionMode(options[0]!.term.policy);
  if (mode) selectionModes.add(mode);
  let incomplete = estimate.estimateLevel !== 'static';
  for (const downstream of downstreamByOption) {
    for (const downstreamMode of downstream.selectionModes) selectionModes.add(downstreamMode);
    incomplete ||= downstream.incomplete;
  }
  for (const [optionIndex, option] of options.entries()) {
    const optionProbability = estimate.probabilities[optionIndex] ?? null;
    const optionStatus = statusForLevel(estimate.estimateLevel);
    for (const alternative of option.alternatives) {
      const downstream = downstreamByOption[optionIndex]!.probabilities.get(alternative.alternativeId)
        ?? { probability: null, status: 'unsupported' as const };
      if (optionProbability === 0) {
        probabilities.set(alternative.alternativeId, { probability: 0, status: optionStatus });
        continue;
      }
      const probability = optionProbability == null || downstream.probability == null
        ? null
        : optionProbability * downstream.probability;
      const status = combineStatus(optionStatus, downstream.status);
      probabilities.set(alternative.alternativeId, { probability, status });
      if (probability == null || status !== 'static') incomplete = true;
    }
  }
  return { probabilities, selectionModes, incomplete };
}

export function estimateCompiledRuntimeAlternativeProbabilities(input: {
  plan: CompiledRouterPlan;
  bundle: CompiledRouterBundle;
  state?: RuntimeSelectorState;
}): CompiledRuntimeProbabilityEstimate {
  const enabled = input.plan.executionAlternatives.filter((alternative) => alternative.enabled !== false);
  const estimate = inferSubset({
    alternatives: enabled,
    processedControlKeys: new Set(),
    plan: input.plan,
    bundle: input.bundle,
    state: input.state,
  });
  for (const alternative of input.plan.executionAlternatives) {
    if (alternative.enabled === false) {
      estimate.probabilities.set(alternative.alternativeId, { probability: 0, status: 'static' });
    }
  }
  return estimate;
}
