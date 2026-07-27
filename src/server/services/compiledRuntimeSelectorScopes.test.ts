import { describe, expect, it } from 'vitest';
import type { CompiledExecutionAlternative } from '../../shared/compiledRuntime.js';
import {
  compiledRuntimeExecutionAttemptScope,
  compiledRuntimeRuntimeScopeForSelectionOption,
} from './compiledRuntimeSelectorScopes.js';
import { DEFAULT_DISPATCH_POLICY } from './dispatchPolicyTypes.js';
import { evaluateSelectorCelExpression } from './selectorEngine.js';

function alternative(id: string, cost: number | null, balance: number | null, usage: number | null): CompiledExecutionAlternative {
  return {
    alternativeId: id,
    kind: 'execution_attempt',
    enabled: true,
    filterStageIndexes: [],
    fallbackStages: [],
    selectionTerms: [{
      termId: 'selector', nodeId: 'dispatcher', mode: 'route', policy: { kind: 'inherit_default' },
      optionId: 'option', optionIndex: 0, optionKind: 'route', enabled: true, weight: 1, order: 0, controlOrder: 0,
      runtime: { routingSignals: { normalizedCostScore: cost, normalizedBalanceScore: balance, normalizedUsageScore: usage, rawBalance: 999 } },
    }],
    terminal: { kind: 'supply', endpointId: `endpoint:${id}` },
  };
}

describe('compiled runtime selector scopes', () => {
  it('uses the compiler-issued attempt identity without exposing its transport binding', () => {
    const scope = compiledRuntimeExecutionAttemptScope({
      executionAttemptId: 'opaque-attempt',
      targetId: 'compiled-target',
      model: 'test',
      enabled: true,
      transportBinding: { kind: 'execution_target', executionTargetId: 41 },
    });

    expect(scope).toMatchObject({
      id: 'opaque-attempt',
      executionAttemptId: 'opaque-attempt',
      targetId: 'compiled-target',
    });
    expect(scope).not.toHaveProperty('transportBinding');
    expect(scope).not.toHaveProperty('executionTargetId');
  });

  it('represents a multi-alternative option with explicit member aggregation', () => {
    const members = [alternative('a', 0.2, 0.4, 0.6), alternative('b', 0.8, 0.6, 0.4)];
    const runtime = compiledRuntimeRuntimeScopeForSelectionOption(
      { optionId: 'option', term: members[0].selectionTerms[0], alternatives: members },
      new Map([
        ['a', { probability: 0.25, status: 'static' }],
        ['b', { probability: 0.75, status: 'static' }],
      ]),
    );
    expect(runtime.routingSignals).toMatchObject({
      scope: 'selection_option', aggregation: 'downstream_probability', probabilityStatus: 'static', memberCount: 2,
    });
    expect((runtime.routingSignals as Record<string, number>).normalizedCostScore).toBeCloseTo(0.65);
    expect((runtime.routingSignals as Record<string, number>).normalizedBalanceScore).toBeCloseTo(0.55);
    expect((runtime.routingSignals as Record<string, number>).normalizedUsageScore).toBeCloseTo(0.45);
    expect((runtime.routingSignals as Record<string, unknown>).members).toHaveLength(2);
    expect(runtime.routingSignals).not.toHaveProperty('rawBalance');
  });

  it('does not coerce a missing member signal into zero', () => {
    const members = [alternative('a', null, 0.4, 0.6), alternative('b', 0.8, 0.6, 0.4)];
    const runtime = compiledRuntimeRuntimeScopeForSelectionOption(
      { optionId: 'option', term: members[0].selectionTerms[0], alternatives: members },
      new Map([
        ['a', { probability: 0.5, status: 'static' }],
        ['b', { probability: 0.5, status: 'static' }],
      ]),
    );
    expect((runtime.routingSignals as Record<string, unknown>).normalizedCostScore).toBeNull();
  });

  it('keeps aggregate scalars explicitly unknown when downstream probability is dynamic', () => {
    const members = [alternative('a', 0.2, 0.4, 0.6), alternative('b', 0.8, 0.6, 0.4)];
    const runtime = compiledRuntimeRuntimeScopeForSelectionOption(
      { optionId: 'option', term: members[0].selectionTerms[0], alternatives: members },
      new Map([
        ['a', { probability: null, status: 'dynamic' }],
        ['b', { probability: null, status: 'dynamic' }],
      ]),
    );
    expect(runtime.routingSignals).toMatchObject({
      aggregation: 'downstream_probability',
      probabilityStatus: 'dynamic',
      memberCount: 2,
    });
    expect(runtime.routingSignals).toMatchObject({
      normalizedCostScore: null,
      normalizedBalanceScore: null,
      normalizedUsageScore: null,
    });
  });

  it('keeps missing member signals aligned with their alternatives', () => {
    const members = [alternative('a', 0.2, 0.4, 0.6), alternative('b', 0.8, 0.6, 0.4)];
    delete members[0]!.selectionTerms[0]!.runtime;
    const runtime = compiledRuntimeRuntimeScopeForSelectionOption(
      { optionId: 'option', term: members[0]!.selectionTerms[0]!, alternatives: members },
      new Map([
        ['a', { probability: 0.5, status: 'static' }],
        ['b', { probability: 0.5, status: 'static' }],
      ]),
    );
    const signals = runtime.routingSignals as { members: Array<{ alternativeId: string; routingSignals: unknown }> };
    expect(signals.members).toEqual([
      expect.objectContaining({ alternativeId: 'a', routingSignals: null }),
      expect.objectContaining({ alternativeId: 'b', routingSignals: expect.objectContaining({ normalizedCostScore: 0.8 }) }),
    ]);
    expect((runtime.routingSignals as Record<string, unknown>).normalizedCostScore).toBeNull();
  });

  it('exposes an explicit all-unknown signal scope so the default CEL remains finite', () => {
    const members = [alternative('a', null, null, null), alternative('b', null, null, null)];
    delete members[0]!.selectionTerms[0]!.runtime;
    delete members[1]!.selectionTerms[0]!.runtime;
    const runtime = compiledRuntimeRuntimeScopeForSelectionOption({
      optionId: 'option', term: members[0].selectionTerms[0], alternatives: members,
    });

    expect(runtime.routingSignals).toMatchObject({
      probabilityStatus: 'insufficient_data',
      normalizedCostScore: null,
      normalizedBalanceScore: null,
      normalizedUsageScore: null,
    });
    expect(evaluateSelectorCelExpression(DEFAULT_DISPATCH_POLICY.contributionExpression!, { runtime })).toBe(1);
  });
});
