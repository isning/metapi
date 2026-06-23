import { describe, expect, it } from 'vitest';
import {
  __selectorEngineTestUtils,
  estimateRuntimeSelectorProbabilities,
  rankContributionIndexes,
  selectRuntimeCandidate,
  selectStableFirstContributionIndex,
  selectWeightedContributionIndex,
  type RuntimeSelectorCandidate,
} from './selectorEngine.js';

function candidate(input: Partial<RuntimeSelectorCandidate> & { idx: number }): RuntimeSelectorCandidate {
  return {
    kind: 'route',
    metadata: {},
    runtime: {},
    enabled: true,
    weight: 1,
    priority: 0,
    score: 1,
    order: input.idx,
    ...input,
  };
}

describe('selectorEngine', () => {
  it('plans CEL expressions once and reuses them across selector evaluations', () => {
    const utils = __selectorEngineTestUtils();
    utils.clearCelPlanCache();

    const candidates = [
      candidate({ idx: 0, metadata: { quality: 5, cost: 1 } }),
      candidate({ idx: 1, metadata: { quality: 10, cost: 2 } }),
    ];

    const selected = selectRuntimeCandidate({
      selectorId: 'route.dispatcher',
      policy: { strategy: 'weighted', score: 'candidate.metadata.quality - candidate.metadata.cost' },
      candidates,
      state: { requestedModel: 'model-a', currentModel: 'model-a' },
    });
    expect(selected?.idx).toBe(1);
    expect(utils.celPlanCacheSize()).toBe(1);

    selectRuntimeCandidate({
      selectorId: 'route.dispatcher',
      policy: { strategy: 'weighted', score: 'candidate.metadata.quality - candidate.metadata.cost' },
      candidates,
      state: { requestedModel: 'model-a', currentModel: 'model-a' },
    });
    expect(utils.celPlanCacheSize()).toBe(1);
  });

  it('supports direct CEL selection against request payload state', () => {
    const selected = selectRuntimeCandidate({
      selectorId: 'route.direct',
      policy: { strategy: 'direct', select: 'payload.currentModel == "fast" ? 1 : 0' },
      candidates: [candidate({ idx: 0 }), candidate({ idx: 1 })],
      state: { currentModel: 'fast' },
    });

    expect(selected?.idx).toBe(1);
  });

  it('keeps priority-order candidate selection weighted inside the best priority bucket', () => {
    const selected = selectRuntimeCandidate({
      selectorId: 'route.priority',
      policy: { strategy: 'priority_order' },
      candidates: [
        candidate({ idx: 0, priority: 0, weight: 100 }),
        candidate({ idx: 1, priority: 2, weight: 1 }),
        candidate({ idx: 2, priority: 2, weight: 10 }),
      ],
      random: () => 0.99,
    });

    expect(selected?.idx).toBe(2);
  });

  it('estimates static weighted probabilities with metadata CEL score policies', () => {
    const estimate = estimateRuntimeSelectorProbabilities({
      selectorId: 'route.score',
      policy: { strategy: 'weighted', score: 'candidate.metadata.quality - candidate.metadata.cost' },
      candidates: [
        candidate({ idx: 0, metadata: { quality: 5, cost: 1 } }),
        candidate({ idx: 1, metadata: { quality: 10, cost: 2 } }),
      ],
      state: { requestedModel: 'model-a', currentModel: 'model-a' },
    });

    expect(estimate.estimateLevel).toBe('static');
    expect(estimate.probabilities).toEqual([0, 1]);
  });

  it('marks request-dependent selector policies as dynamic probabilities', () => {
    const estimate = estimateRuntimeSelectorProbabilities({
      selectorId: 'route.request-dependent',
      policy: { strategy: 'weighted', score: 'payload.currentModel == "fast" ? candidate.weight : 1' },
      candidates: [
        candidate({ idx: 0, weight: 1 }),
        candidate({ idx: 1, weight: 3 }),
      ],
    });

    expect(estimate.estimateLevel).toBe('dynamic');
    expect(estimate.probabilities).toEqual([null, null]);
  });

  it('marks router-deferred policies as dynamic probabilities', () => {
    const estimate = estimateRuntimeSelectorProbabilities({
      selectorId: 'route.defer-to-router',
      policy: { strategy: 'defer_to_router' },
      candidates: [
        candidate({ idx: 0, weight: 1 }),
        candidate({ idx: 1, weight: 3 }),
      ],
    });

    expect(estimate.estimateLevel).toBe('dynamic');
    expect(estimate.probabilities).toEqual([null, null]);
  });

  it('selects contribution indexes for weighted and stable-first runtime plans', () => {
    expect(rankContributionIndexes([0.2, 0.9, 0.4])).toEqual([1, 2, 0]);
    expect(selectWeightedContributionIndex({
      contributions: [1, 3, 6],
      random: () => 0.39,
    })).toBe(1);

    expect(selectStableFirstContributionIndex({
      rankedIndices: [2, 1, 0],
      stableLeaderIndices: [2, 1],
      lastSelectedGroupId: 'site-a',
      groupIdForIndex: (index) => index === 2 ? 'site-a' : (index === 1 ? 'site-b' : 'site-a'),
    })).toBe(1);
  });
});
