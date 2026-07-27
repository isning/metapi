import { describe, expect, it } from 'vitest';
import {
  resolveDispatchSelectorPolicy,
  validateDispatchPolicyRegistry,
} from './dispatchPolicyService.js';
import { DEFAULT_DISPATCH_POLICY } from './dispatchPolicyTypes.js';
import { evaluateSelectorCelExpression } from './selectorEngine.js';

describe('dispatchPolicyService', () => {
  it('renormalizes the default weighted CEL over known signals only', () => {
    const evaluate = (routingSignals: Record<string, number | null>) => evaluateSelectorCelExpression(
      DEFAULT_DISPATCH_POLICY.contributionExpression!,
      { runtime: { routingSignals } },
    );

    expect(evaluate({ normalizedCostScore: 0.8, normalizedBalanceScore: null, normalizedUsageScore: null })).toBeCloseTo(0.8);
    expect(evaluate({ normalizedCostScore: null, normalizedBalanceScore: 0, normalizedUsageScore: null })).toBe(0);
    expect(evaluate({ normalizedCostScore: 0.8, normalizedBalanceScore: 0.2, normalizedUsageScore: null })).toBeCloseTo(0.38 / 0.7);
    expect(evaluate({ normalizedCostScore: null, normalizedBalanceScore: null, normalizedUsageScore: null })).toBe(1);
  });

  it('rejects expressions that compile but do not produce the required runtime type', () => {
    const validation = validateDispatchPolicyRegistry({
      defaultPolicyId: 'invalid-runtime',
      policies: [{
        id: 'invalid-runtime',
        name: 'Invalid runtime',
        kind: 'cel',
        selectionMode: 'weighted',
        contributionExpression: 'max(0.0, runtime.routingSignals.normalizedCostScore)',
      }],
    });
    expect(validation.value).toBeNull();
    expect(validation.errors.join(' ')).toMatch(/finite number/i);
  });

  it('validates CEL fields according to the selection mode', () => {
    expect(validateDispatchPolicyRegistry({
      defaultPolicyId: 'ordered',
      policies: [{
        id: 'ordered',
        name: 'Ordered',
        kind: 'cel',
        selectionMode: 'ordered',
        orderExpression: 'self.order',
      }],
    }).errors).toEqual([]);

    expect(validateDispatchPolicyRegistry({
      defaultPolicyId: 'weighted',
      policies: [{
        id: 'weighted',
        name: 'Weighted',
        kind: 'cel',
        selectionMode: 'weighted',
      }],
    }).errors).toEqual(expect.arrayContaining([
      expect.stringContaining('Expression is required.'),
    ]));
  });

  it('validates candidate expressions against non-empty runtime candidate scopes', () => {
    expect(validateDispatchPolicyRegistry({
      defaultPolicyId: 'candidate-weight',
      policies: [{
        id: 'candidate-weight',
        name: 'Candidate weight',
        kind: 'cel',
        selectionMode: 'weighted',
        contributionExpression: 'candidates[0].weight',
      }],
    }).errors).toEqual([]);
  });

  it('rejects unsupported policy modes and invalid builtin definitions', () => {
    expect(validateDispatchPolicyRegistry({
      defaultPolicyId: 'sticky',
      policies: [{
        id: 'sticky',
        name: 'Sticky',
        kind: 'cel',
        selectionMode: ['sti', 'cky'].join(''),
      }],
    }).value).toBeNull();

    expect(validateDispatchPolicyRegistry({
      defaultPolicyId: 'invalid',
      policies: [{
        id: 'invalid',
        name: 'Invalid',
        kind: 'builtin',
        builtin: 'unsupported_builtin',
        selectionMode: 'weighted',
      }],
    }).errors).toEqual(expect.arrayContaining([
      expect.stringContaining('Builtin policy invalid is missing its strategy.'),
    ]));
  });

  it('resolves inline CEL policies without an implicit routing-weight fallback', () => {
    const resolved = resolveDispatchSelectorPolicy({
      kind: 'inline',
      policy: {
        id: 'inline-cost',
        name: 'Inline cost',
        kind: 'cel',
        selectionMode: 'weighted',
        contributionExpression: 'runtime.routingSignals.normalizedCostScore',
      },
    });

    expect(resolved.source).toBe('inline');
    expect(resolved.selectorPolicy).toEqual({
      strategy: 'policy_weighted',
      contribution: 'runtime.routingSignals.normalizedCostScore',
    });
  });

  it('rejects unowned runtime selector shapes instead of executing them as a compatibility policy', () => {
    expect(() => resolveDispatchSelectorPolicy({
      strategy: 'weighted',
      scoreExpr: 'self.weight',
    })).toThrow('Dispatch policy reference is invalid');
  });
});
