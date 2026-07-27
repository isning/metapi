import { describe, expect, it } from 'vitest';
import type {
  CompiledExecutionAlternative,
  CompiledExecutionSelectionTerm,
  CompiledRouterBundle,
  CompiledRouterPlan,
  DispatcherPolicy,
} from '../../shared/compiledRuntime.js';
import { estimateCompiledRuntimeAlternativeProbabilities } from './compiledRuntimeProbabilityService.js';

const parentPolicy: DispatcherPolicy = {
  kind: 'inline',
  policy: {
    id: 'parent-cost',
    name: 'Parent cost signal',
    kind: 'cel',
    selectionMode: 'weighted',
    contributionExpression: 'runtime.routingSignals.normalizedCostScore',
  },
};

function term(input: {
  termId: string;
  optionId: string;
  optionIndex: number;
  weight: number;
  policy: DispatcherPolicy;
}): CompiledExecutionSelectionTerm {
  return {
    ...input,
    nodeId: input.termId,
    mode: 'route',
    optionKind: 'route',
    enabled: true,
    order: input.optionIndex,
    controlOrder: input.termId === 'parent' ? 0 : 1,
  };
}

function alternative(input: {
  id: string;
  parentOption: 'a' | 'b';
  parentIndex: number;
  costScore: number;
  child?: { option: string; index: number; weight: number };
}): CompiledExecutionAlternative {
  return {
    alternativeId: input.id,
    kind: 'execution_attempt',
    enabled: true,
    filterStageIndexes: [],
    fallbackStages: [],
    selectionTerms: [
      term({ termId: 'parent', optionId: input.parentOption, optionIndex: input.parentIndex, weight: 1, policy: parentPolicy }),
      ...(input.child ? [term({
        termId: 'child',
        optionId: input.child.option,
        optionIndex: input.child.index,
        weight: input.child.weight,
        policy: { kind: 'builtin', builtin: 'weighted' },
      })] : []),
    ],
    terminal: { kind: 'supply', endpointId: `endpoint:${input.id}` },
    endpoint: { endpointId: `endpoint:${input.id}`, nodeId: `endpoint:${input.id}`, model: input.id },
    executionAttempt: {
      executionAttemptId: input.id,
      targetId: `target:${input.id}`,
      model: input.id,
      enabled: true,
      transportBinding: { kind: 'execution_target', executionTargetId: input.parentIndex * 10 + (input.child?.index ?? 9) + 1 },
      runtime: {
        routingSignals: {
          normalizedCostScore: input.costScore,
          normalizedBalanceScore: null,
          normalizedUsageScore: null,
        },
      },
    },
  };
}

describe('compiled runtime recursive probability inference', () => {
  it('uses downstream selector probability to aggregate parent routing signals', () => {
    const alternatives = [
      alternative({ id: 'a1', parentOption: 'a', parentIndex: 0, costScore: 0.2, child: { option: 'a1', index: 0, weight: 1 } }),
      alternative({ id: 'a2', parentOption: 'a', parentIndex: 0, costScore: 0.8, child: { option: 'a2', index: 1, weight: 3 } }),
      alternative({ id: 'b', parentOption: 'b', parentIndex: 1, costScore: 0.2 }),
    ];
    const plan: CompiledRouterPlan = {
      id: 'plan:nested',
      entryNodeId: 'entry:nested',
      publicModelName: 'nested',
      enabled: true,
      filterStages: [],
      executionAlternatives: alternatives,
    };
    const bundle = {
      hash: 'nested',
      matcher: { exact: {}, normalizedExact: {}, patterns: [] },
      plans: [plan],
      planIndex: { [plan.id]: 0 },
      diagnostics: [],
    } as CompiledRouterBundle;

    const estimate = estimateCompiledRuntimeAlternativeProbabilities({ plan, bundle });

    expect(estimate.incomplete).toBe(false);
    expect(estimate.probabilities.get('a1')).toMatchObject({ status: 'static' });
    expect(estimate.probabilities.get('a1')?.probability).toBeCloseTo(13 / 68);
    expect(estimate.probabilities.get('a2')?.probability).toBeCloseTo(39 / 68);
    expect(estimate.probabilities.get('b')?.probability).toBeCloseTo(4 / 17);
  });
});
