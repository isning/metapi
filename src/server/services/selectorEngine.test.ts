import { describe, expect, it } from 'vitest';
import {
  __selectorEngineTestUtils,
  estimateRuntimeSelectorProbabilities,
  rankContributionIndexes,
  selectContributionSnapshot,
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
      policy: { strategy: 'policy_ordered', order: '-(self.metadata.quality - self.metadata.cost)' },
      candidates,
      state: { requestedModel: 'model-a', currentModel: 'model-a' },
    });
    expect(selected?.idx).toBe(1);
    expect(utils.celPlanCacheSize()).toBe(1);

    selectRuntimeCandidate({
      selectorId: 'route.dispatcher',
      policy: { strategy: 'policy_ordered', order: '-(self.metadata.quality - self.metadata.cost)' },
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

  it('supports direct CEL selection against the compiled route request snapshot', () => {
    const selected = selectRuntimeCandidate({
      selectorId: 'route.request-snapshot',
      policy: { strategy: 'direct', select: 'request.headers["x-route-choice"] == "b" && request.payload.tier == "pro" ? 1 : 0' },
      candidates: [candidate({ idx: 0 }), candidate({ idx: 1 })],
      state: {
        request: {
          headers: { 'x-route-choice': 'b' },
          payload: { tier: 'pro' },
          query: { region: 'us' },
        },
        headers: { 'x-route-choice': 'b' },
        payload: { tier: 'pro' },
      },
    });

    expect(selected?.idx).toBe(1);
  });

  it('applies CEL eligibility before direct selection and probability estimation', () => {
    const policy = {
      strategy: 'direct',
      eligibility: 'self.metadata.available',
      select: '1',
    };
    const candidates = [
      candidate({ idx: 0, metadata: { available: true } }),
      candidate({ idx: 1, metadata: { available: false } }),
      candidate({ idx: 2, metadata: { available: true } }),
    ];

    const selected = selectRuntimeCandidate({
      selectorId: 'route.direct-eligibility',
      policy,
      candidates,
    });
    const estimate = estimateRuntimeSelectorProbabilities({
      selectorId: 'route.direct-eligibility',
      policy,
      candidates,
    });

    expect(selected?.idx).toBe(2);
    expect(estimate.estimateLevel).toBe('static');
    expect(estimate.probabilities).toEqual([0, 0, 1]);
  });

  it('marks direct policies with unresolved dynamic eligibility as dynamic', () => {
    const estimate = estimateRuntimeSelectorProbabilities({
      selectorId: 'route.direct-dynamic-eligibility',
      policy: {
        strategy: 'direct',
        eligibility: 'request.payload.region == self.metadata.region',
        select: '0',
      },
      candidates: [
        candidate({ idx: 0, metadata: { region: 'sg' } }),
        candidate({ idx: 1, metadata: { region: 'us' } }),
      ],
    });

    expect(estimate.estimateLevel).toBe('dynamic');
    expect(estimate.probabilities).toEqual([null, null]);
  });

  it('estimates static ordered probabilities with metadata CEL policies', () => {
    const estimate = estimateRuntimeSelectorProbabilities({
      selectorId: 'route.score',
      policy: { strategy: 'policy_ordered', order: '-(self.metadata.quality - self.metadata.cost)' },
      candidates: [
        candidate({ idx: 0, metadata: { quality: 5, cost: 1 } }),
        candidate({ idx: 1, metadata: { quality: 10, cost: 2 } }),
      ],
      state: { requestedModel: 'model-a', currentModel: 'model-a' },
    });

    expect(estimate.estimateLevel).toBe('static');
    expect(estimate.probabilities).toEqual([0, 1]);
  });

  it('does not let compiled runtime facts bypass the resolved dispatch policy', () => {
    const candidates = [
      candidate({ idx: 0, weight: 10, runtime: { routingSignals: { opaqueSignal: 9 } } }),
      candidate({ idx: 1, weight: 90, runtime: { routingSignals: { opaqueSignal: 1 } } }),
    ];

    const selected = selectRuntimeCandidate({
      selectorId: 'route.routing-signals',
      policy: { strategy: 'weighted' },
      candidates,
      random: () => 0.89,
    });
    const estimate = estimateRuntimeSelectorProbabilities({
      selectorId: 'route.routing-signals',
      policy: { strategy: 'weighted' },
      candidates,
    });

    expect(selected?.idx).toBe(1);
    expect(estimate.estimateLevel).toBe('static');
    expect(estimate.probabilities).toEqual([0.1, 0.9]);
  });

  it('uses CEL contribution and eligibility for a weighted dispatch policy', () => {
    const candidates = [
      candidate({ idx: 0, runtime: { routingSignals: { normalizedCostScore: 0.2 } } }),
      candidate({ idx: 1, runtime: { routingSignals: { normalizedCostScore: 0.8 } } }),
    ];
    const policy = {
      strategy: 'policy_weighted',
      eligibility: 'runtime.routingSignals.normalizedCostScore > 0.0',
      contribution: 'runtime.routingSignals.normalizedCostScore * 10.0',
    };

    const selected = selectRuntimeCandidate({
      selectorId: 'route.policy-cel',
      policy,
      candidates,
      random: () => 0.3,
    });
    const estimate = estimateRuntimeSelectorProbabilities({
      selectorId: 'route.policy-cel',
      policy,
      candidates,
    });

    expect(selected?.idx).toBe(1);
    expect(estimate.probabilities).toEqual([0.2, 0.8]);
  });

  it('keeps zero CEL contribution at zero in selection and probability estimation', () => {
    const policy = {
      strategy: 'policy_weighted',
      contribution: 'runtime.routingSignals.value',
    };
    const candidates = [
      candidate({ idx: 0, runtime: { routingSignals: { value: 0 } } }),
      candidate({ idx: 1, runtime: { routingSignals: { value: 0.4 } } }),
    ];

    expect(selectRuntimeCandidate({
      selectorId: 'route.zero-contribution',
      policy,
      candidates,
      random: () => 0,
    })?.idx).toBe(1);
    expect(estimateRuntimeSelectorProbabilities({
      selectorId: 'route.zero-contribution',
      policy,
      candidates,
    }).probabilities).toEqual([0, 1]);
  });

  it('uses an explicit equal distribution when every contribution is zero', () => {
    const policy = { strategy: 'policy_weighted', contribution: '0.0' };
    const candidates = [candidate({ idx: 0 }), candidate({ idx: 1 })];

    expect(selectRuntimeCandidate({
      selectorId: 'route.all-zero',
      policy,
      candidates,
      random: () => 0.75,
    })?.idx).toBe(1);
    expect(estimateRuntimeSelectorProbabilities({
      selectorId: 'route.all-zero',
      policy,
      candidates,
    }).probabilities).toEqual([0.5, 0.5]);
  });

  it('fails closed with a diagnostic error when CEL evaluation is invalid', () => {
    const candidates = [candidate({ idx: 0 }), candidate({ idx: 1 })];
    expect(() => selectRuntimeCandidate({
      selectorId: 'route.invalid-cel-result',
      policy: { strategy: 'policy_weighted', contribution: 'self.metadata.missing' },
      candidates,
    })).toThrow(/route.invalid-cel-result.*contribution/i);
    expect(() => selectRuntimeCandidate({
      selectorId: 'route.invalid-direct-result',
      policy: { strategy: 'direct', select: '99' },
      candidates,
    })).toThrow(/route.invalid-direct-result.*direct selection/i);
  });

  it('does not treat source metadata as compiled runtime routing signals', () => {
    const estimate = estimateRuntimeSelectorProbabilities({
      selectorId: 'route.metadata-routing-signals',
      policy: { strategy: 'weighted' },
      candidates: [
        candidate({ idx: 0, weight: 10, metadata: { routingSignals: { opaqueSignal: 90 } } }),
        candidate({ idx: 1, weight: 30, metadata: { routingSignals: { opaqueSignal: 1 } } }),
      ],
    });

    expect(estimate.estimateLevel).toBe('static');
    expect(estimate.probabilities).toEqual([0.25, 0.75]);
  });

  it('marks request-dependent selector policies as dynamic probabilities', () => {
    const estimate = estimateRuntimeSelectorProbabilities({
      selectorId: 'route.request-dependent',
      policy: { strategy: 'policy_ordered', order: 'payload.currentModel == "fast" ? -self.weight : -1' },
      candidates: [
        candidate({ idx: 0, weight: 1 }),
        candidate({ idx: 1, weight: 3 }),
      ],
    });

    expect(estimate.estimateLevel).toBe('dynamic');
    expect(estimate.probabilities).toEqual([null, null]);
  });

  it('estimates request-dependent ordered CEL policies when the request snapshot is known', () => {
    const estimate = estimateRuntimeSelectorProbabilities({
      selectorId: 'route.request-known-score',
      policy: { strategy: 'policy_ordered', order: 'request.payload.tier == "pro" ? -self.metadata.score : -self.weight' },
      candidates: [
        candidate({ idx: 0, weight: 10, metadata: { score: 1 } }),
        candidate({ idx: 1, weight: 1, metadata: { score: 9 } }),
      ],
      state: {
        requestKnown: true,
        request: {
          payload: { tier: 'pro' },
          headers: {},
        },
        payload: { tier: 'pro' },
        headers: {},
      },
    });

    expect(estimate.estimateLevel).toBe('static');
    expect(estimate.probabilities).toEqual([0, 1]);
  });

  it('estimates request-dependent direct CEL selection when the request snapshot is known', () => {
    const estimate = estimateRuntimeSelectorProbabilities({
      selectorId: 'route.request-known-direct',
      policy: { strategy: 'direct', select: 'request.headers["x-route-choice"] == "b" ? 1 : 0' },
      candidates: [candidate({ idx: 0 }), candidate({ idx: 1 })],
      state: {
        requestKnown: true,
        request: {
          payload: {},
          headers: { 'x-route-choice': 'b' },
        },
        payload: {},
        headers: { 'x-route-choice': 'b' },
      },
    });

    expect(estimate.estimateLevel).toBe('static');
    expect(estimate.probabilities).toEqual([0, 1]);
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

  it('stores round-robin cursor under selector scope instead of dispatcher identity scope', () => {
    const stateStore: Record<string, unknown> = {};
    const candidates = [candidate({ idx: 0 }), candidate({ idx: 1 })];

    expect(selectRuntimeCandidate({
      selectorId: 'route.dispatcher',
      policy: { strategy: 'round_robin' },
      candidates,
      state: { stateStore },
    })?.idx).toBe(0);
    expect(selectRuntimeCandidate({
      selectorId: 'route.dispatcher',
      policy: { strategy: 'round_robin' },
      candidates,
      state: { stateStore },
    })?.idx).toBe(1);

    expect(stateStore).toEqual({ 'selector:route.dispatcher:round_robin': 2 });
    expect(stateStore).not.toHaveProperty('dispatcher:route.dispatcher:round_robin');
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
    expect(selectWeightedContributionIndex({ contributions: [0, 0], random: () => 0.75 })).toBe(1);
    expect(selectContributionSnapshot({ contributions: [0, 0], random: () => 0.75 }).probabilities).toEqual([0.5, 0.5]);
  });
});
