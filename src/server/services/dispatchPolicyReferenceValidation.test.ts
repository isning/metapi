import { describe, expect, it } from 'vitest';
import { validateRouteGraphDispatchPolicies } from './dispatchPolicyReferenceValidation.js';

const registry = {
  defaultPolicyId: 'default',
  policies: [{
    id: 'default',
    name: 'Default',
    kind: 'builtin' as const,
    selectionMode: 'weighted' as const,
    builtin: 'weighted' as const,
  }],
};

describe('dispatch policy reference validation', () => {
  it('reports dangling references on primitives, endpoint selection, macros, and stages', () => {
    const diagnostics = validateRouteGraphDispatchPolicies({
      nodes: [
        { id: 'dispatcher:a', type: 'dispatcher', policy: { kind: 'registry', policyId: 'missing-a' } },
        { id: 'endpoint:a', type: 'route_endpoint', config: { targetSelection: { kind: 'registry', policyId: 'missing-b' } } },
      ],
      macros: [{
        id: 'macro:a',
        config: {
          policy: { kind: 'registry', policyId: 'missing-c' },
          groups: [{ id: 'stage:a', policy: { kind: 'registry', policyId: 'missing-d' } }],
        },
      }],
    }, registry);

    expect(diagnostics.map((item) => item.policyId)).toEqual([
      'missing-a',
      'missing-b',
      'missing-c',
      'missing-d',
    ]);
    expect(diagnostics.every((item) => item.code === 'route_graph.dispatch_policy_reference')).toBe(true);
  });

  it('accepts registry policies that exist', () => {
    expect(validateRouteGraphDispatchPolicies({
      nodes: [{ id: 'dispatcher:a', type: 'dispatcher', policy: { kind: 'registry', policyId: 'default' } }],
    }, registry)).toEqual([]);
  });

  it('rejects inline policies that cannot execute against the selector contract', () => {
    const diagnostics = validateRouteGraphDispatchPolicies({
      nodes: [{
        id: 'dispatcher:a',
        type: 'dispatcher',
        policy: {
          kind: 'inline',
          policy: {
            id: 'inline-a',
            name: 'Inline A',
            kind: 'cel',
            selectionMode: 'weighted',
            contributionExpression: 'max(0.0, runtime.routingSignals.normalizedCostScore)',
          },
        },
      }],
    }, registry);
    expect(diagnostics).toEqual([expect.objectContaining({ ownerId: 'dispatcher:a', policyId: 'inline-a' })]);
  });
});
