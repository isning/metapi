import { describe, expect, it } from 'vitest';
import { simulateDispatchPolicy } from './dispatchPolicySimulationService.js';

describe('dispatchPolicySimulationService', () => {
  it('evaluates CEL contributions without mutating caller-owned runtime state', () => {
    const options = [
      { id: 'a', runtime: { routingSignals: { normalizedCostScore: 0.2 } } },
      { id: 'b', runtime: { routingSignals: { normalizedCostScore: 0.8 } } },
    ];
    const result = simulateDispatchPolicy({
      policy: { kind: 'inline', policy: { id: 'p', name: 'P', kind: 'cel', selectionMode: 'weighted', contributionExpression: 'runtime.routingSignals.normalizedCostScore' } },
      options,
      request: { payload: { tier: 'pro' }, headers: {} },
    });
    expect(result.options.map((option) => option.probability)).toEqual([0.2, 0.8]);
    expect(result.selectedOptionId).toBe('b');
    expect(options).toEqual([
      { id: 'a', runtime: { routingSignals: { normalizedCostScore: 0.2 } } },
      { id: 'b', runtime: { routingSignals: { normalizedCostScore: 0.8 } } },
    ]);
  });

  it('reports request-dependent CEL probabilities as dynamic without a request', () => {
    const result = simulateDispatchPolicy({
      policy: {
        kind: 'inline',
        policy: {
          id: 'request-dependent',
          name: 'Request dependent',
          kind: 'cel',
          selectionMode: 'weighted',
          contributionExpression: 'request.payload.priority == candidate.idx ? 1 : 0',
        },
      },
      options: [
        { id: 'a' },
        { id: 'b' },
      ],
      requestKnown: false,
    });

    expect(result.selectedOptionId).toBeNull();
    expect(result.options.map((option) => option.probability)).toEqual([null, null]);
  });
});
