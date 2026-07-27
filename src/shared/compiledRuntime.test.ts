import { describe, expect, it } from 'vitest';
import { compileRouteGraphSource } from './routeGraph.js';
import {
  compactCompiledRouterBundle,
  getCompiledExecutionAttemptId,
  getCompiledExecutionTargetId,
  getCompiledRouterExecutionTargetIds,
  getCompiledRouterPlanById,
  validateCompiledRouterBundle,
} from './compiledRuntime.js';

describe('compiled runtime artifact contract', () => {
  function compiledFixture() {
    const compiled = compileRouteGraphSource({
      nodes: [
        { id: 'entry:test', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'test', displayName: 'test' } },
        { id: 'dispatcher:test', type: 'dispatcher', enabled: true, ownership: 'manual', mode: 'route', policy: { kind: 'inherit_default' } },
        { id: 'endpoint:test', type: 'route_endpoint', routeEndpointId: 'endpoint:test', endpointKind: 'supply', exposure: 'none', resolutionStatus: 'resolved', ownerKind: 'manual', sourceKind: 'upstream_model', enabled: true, ownership: 'manual', config: { targets: [{ targetId: 'target:test', model: 'test', enabled: true, transportBinding: { kind: 'execution_target', executionTargetId: 91 }, metadata: { provider: 'test' } }] } },
      ],
      edges: [
        { id: 'edge:entry-dispatcher', sourceNodeId: 'entry:test', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:test', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'edge:endpoint-dispatcher', sourceNodeId: 'endpoint:test', sourcePortId: 'route.out', targetNodeId: 'dispatcher:test', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });
    return compiled.compiled.compiledRouterBundle!;
  }

  it('materializes the same executable plan after compact storage', () => {
    const bundle = compiledFixture();
    const compact = compactCompiledRouterBundle(bundle);
    const plan = getCompiledRouterPlanById(compact, bundle.plans[0].id);

    expect(validateCompiledRouterBundle(compact)).toMatchObject({ ok: true });
    expect(plan).toEqual(bundle.plans[0]);
    expect(getCompiledExecutionAttemptId(plan?.executionAlternatives[0].executionAttempt)).toBe(
      bundle.plans[0].executionAlternatives[0].alternativeId,
    );
    expect(getCompiledExecutionTargetId(plan?.executionAlternatives[0].executionAttempt)).toBe(91);
    expect(getCompiledRouterExecutionTargetIds(compact)).toEqual([91]);
  });

  it.each([
    {
      name: 'attempt table reference',
      mutate: (bundle: any) => { bundle.plans[0].executionAlternatives[0].attempt = 99; },
      reason: 'execution_attempt_reference_invalid',
    },
    {
      name: 'transport binding',
      mutate: (bundle: any) => { bundle.executionTable.attempts[0][9] = { kind: 'execution_target', executionTargetId: 0 }; },
      reason: 'execution_attempt_transport_binding_invalid',
    },
    {
      name: 'matcher cross-reference',
      mutate: (bundle: any) => { Object.values(bundle.matcher.exact)[0].programId = 'missing-plan'; },
      reason: 'matcher_target_invalid',
    },
  ])('rejects a corrupt $name before runtime execution', ({ mutate, reason }) => {
    const bundle = structuredClone(compactCompiledRouterBundle(compiledFixture()));
    mutate(bundle);
    expect(validateCompiledRouterBundle(bundle)).toEqual({ ok: false, reason });
  });
});
