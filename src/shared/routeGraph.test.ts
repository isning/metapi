import { describe, expect, it } from 'vitest';
import {
  buildCandidateSelectorMacro,
  compileRouteGraphSource,
  findRouteGraphEntryForModel,
  getRouteGraphMacroPorts,
  getRouteGraphMacroPort,
  getRouteGraphNodePorts,
  canAttachManualRouteGraphEdge,
  normalizeRouteGraphMacro,
  normalizeRouteGraphNode,
  normalizeRouteGraphSource,
  normalizeRouteFailureBackoffOverride,
  normalizeRouteFailureBackoffPolicy,
} from './routeGraph.js';
import {
  compactCompiledRouterBundle,
  getCompiledRouterExecutionTargetIds,
  getCompiledRouterPlanById,
} from './compiledRuntime.js';

describe('route graph native exposure semantics', () => {
  it('normalizes hierarchical failure backoff overrides without accepting unsafe policies', () => {
    expect(normalizeRouteFailureBackoffPolicy({ failureThreshold: 2, levelsSec: [0, 5, 20], maxSec: 20 })).toEqual({
      failureThreshold: 2,
      levelsSec: [0, 5, 20],
      maxSec: 20,
    });
    expect(normalizeRouteFailureBackoffOverride({ mode: 'disabled' })).toEqual({ mode: 'disabled' });
    expect(normalizeRouteFailureBackoffPolicy({ failureThreshold: 2, levelsSec: [10, 5], maxSec: 20 })).toBeNull();
    expect(normalizeRouteFailureBackoffOverride({ mode: 'custom', policy: { failureThreshold: 2, levelsSec: [0], maxSec: 0 } })).toBeNull();
  });

  it('resolves connection editability only from the port contract', () => {
    const generatedNode = normalizeRouteGraphNode({
      id: 'endpoint:generated',
      type: 'route_endpoint',
      enabled: true,
      ownership: 'derived',
      routeEndpointId: 'route-endpoint:generated',
      endpointKind: 'supply',
      exposure: 'none',
      resolutionStatus: 'resolved',
      ownerKind: 'macro',
      sourceKind: 'upstream_model',
      backend: { kind: 'supply' },
      dynamicPorts: [{
        id: 'route.locked.out',
        label: 'Locked route product',
        direction: 'output',
        kind: 'route',
        manualEdgePolicy: 'deny',
      }],
    });
    const macro = normalizeRouteGraphMacro({
      id: 'macro:locked-surface',
      kind: 'candidate_selector',
      enabled: true,
      ownership: 'system',
      config: {
        surface: {
          entry: { kind: 'none' },
          output: 'route',
          ports: [{ id: 'route.out', label: 'Route output', direction: 'output', kind: 'route', manualEdgePolicy: 'deny' }],
        },
        groups: [],
      },
    });

    expect(canAttachManualRouteGraphEdge(getRouteGraphNodePorts(generatedNode).find((port) => port.id === 'route.out'))).toBe(true);
    expect(canAttachManualRouteGraphEdge(getRouteGraphNodePorts(generatedNode).find((port) => port.id === 'route.locked.out'))).toBe(false);
    expect(canAttachManualRouteGraphEdge(getRouteGraphMacroPorts(macro)[0])).toBe(false);
  });

  it('does not retain generic visibility on nodes or macros', () => {
    const entry = normalizeRouteGraphNode({
      id: 'entry:native',
      type: 'entry',
      enabled: true,
      visibility: 'internal',
      ownership: 'manual',
      match: { requestedModelPattern: 'native' },
    });
    const macro = normalizeRouteGraphMacro({
      id: 'macro:native',
      kind: 'candidate_selector',
      enabled: true,
      visibility: 'public',
      ownership: 'manual',
      config: { surface: { entry: { kind: 'none' }, output: 'route' }, groups: [] },
    });

    expect(entry).not.toHaveProperty('visibility');
    expect(macro).not.toHaveProperty('visibility');
    expect(macro.config.surface.entry).toEqual({ kind: 'none' });
  });

  it('builds internal route macros without a graph ingress', () => {
    const macro = buildCandidateSelectorMacro({
      stableId: 'macro:internal',
      displayName: 'Internal route',
      ingress: 'none',
      endpointIds: ['endpoint:a'],
    });

    expect(macro.config.surface.entry).toEqual({ kind: 'none' });
    expect(getRouteGraphMacroPorts(macro).map((port) => port.id)).not.toContain('bidirect.in');
  });

  it('preserves opaque dispatcher-member identities without changing compiled selection semantics', () => {
    const macro = normalizeRouteGraphMacro({
      id: 'macro:member-identity',
      kind: 'candidate_selector',
      enabled: true,
      ownership: 'manual',
      config: {
        surface: { entry: { kind: 'none' }, output: 'route' },
        groups: [{
          id: 'stage:managed:1',
          input: { kind: 'route_endpoints', endpointIds: ['endpoint:one'] },
          members: [{ memberId: 'member:managed:1', endpointId: 'endpoint:one', weight: 3 }],
        }],
      },
    });

    expect(macro.config.groups[0]?.members).toEqual([
      expect.objectContaining({ memberId: 'member:managed:1', endpointId: 'endpoint:one', weight: 3 }),
    ]);
  });

});

function fixtureRouteKey(route: any): string {
  return String(route?.stableId ?? route?.id ?? route?.displayName ?? route?.match?.requestedModelPattern ?? 'route');
}

function fixtureExecutionTargetId(routeKey: string): string {
  return `route-endpoint:supply:upstream-model-fixture:${routeKey}`;
}

function fixtureEntryId(routeKey: string): string {
  return `entry:route-fixture:${routeKey}`;
}

function fixtureDispatcherId(routeKey: string): string {
  return `dispatcher:route-fixture:${routeKey}`;
}

function compiledRuntimePublicModels(result: { compiled: { compiledRouterBundle?: { plans?: Array<{ entryNodeId: string; publicModelName: string }> } } }) {
  return (result.compiled.compiledRouterBundle?.plans || [])
    .map((plan) => ({ nodeId: plan.entryNodeId, model: plan.publicModelName }));
}

function compiledRuntimeOps(result: { compiled: { compiledRouterBundle?: { plans?: Array<{ ops?: any[] }> } } }): any[] {
  return (result.compiled.compiledRouterBundle?.plans || []).flatMap((plan: any) => (
    plan.executionAlternatives || []
  ).flatMap((alternative: any) => [
    alternative,
    ...(Array.isArray(alternative.selectionTerms) ? alternative.selectionTerms : []),
  ]));
}

function normalizeFixtureTargets(route: any): any[] {
  if (Array.isArray(route?.targets)) return route.targets;
  if (Array.isArray(route?.supplyEndpointSpecs)) {
    return route.supplyEndpointSpecs.flatMap((spec: any) => Array.isArray(spec?.targets) ? spec.targets : []);
  }
  return [];
}

function fixtureModelName(route: any): string {
  return String(
    route?.match?.displayName
    || route?.match?.requestedModelPattern
    || route?.displayName
    || normalizeFixtureTargets(route)[0]?.model
    || '',
  );
}

function createFixtureSupplyNode(route: any) {
  const targets = normalizeFixtureTargets(route);
  if (targets.length === 0) return null;
  const routeKey = fixtureRouteKey(route);
  const model = fixtureModelName(route);
  const endpointId = fixtureExecutionTargetId(routeKey);
  return {
    id: endpointId,
    type: 'route_endpoint',
    name: model || routeKey,
    enabled: route?.enabled !== false,
    ownership: route?.ownership || 'manual',
    endpointKind: 'supply',
    exposure: 'none',
    resolutionStatus: 'resolved',
    routeEndpointId: endpointId,
    backend: { kind: 'supply' },
    match: {
      kind: 'model',
      requestedModelPattern: model,
      displayName: model || null,
    },
    config: {
      targets: targets.map((target: any, index: number) => ({
        targetId: String(target?.targetId ?? `${routeKey}:${index}`),
        model: String(target?.model ?? model),
        modelSource: target?.modelSource || 'fixed',
        accountId: target?.accountId ?? null,
        tokenId: target?.tokenId ?? null,
        siteId: target?.siteId ?? null,
        weight: target?.weight ?? 10,
      })),
      targetSelection: { kind: 'builtin', builtin: route?.dispatcherBuiltin || 'weighted' },
    },
    metadata: {
      fixture: true,
      suppliedModels: model ? [model] : [],
    },
  };
}

function buildDirectFixtureRoute(route: any) {
  const routeKey = fixtureRouteKey(route);
  const model = fixtureModelName(route);
  const entryId = fixtureEntryId(routeKey);
  const dispatcherId = fixtureDispatcherId(routeKey);
  const executionTargetId = fixtureExecutionTargetId(routeKey);
  const supplyNode = createFixtureSupplyNode(route);
  const nodes: any[] = [
    {
      id: entryId,
      type: 'entry',
      name: route?.displayName || model,
      enabled: route?.enabled !== false,
      ownership: route?.ownership || 'manual',
      match: {
        kind: 'model',
        requestedModelPattern: route?.match?.requestedModelPattern || model,
        displayName: route?.match?.displayName ?? route?.displayName ?? null,
      },
    },
    {
      id: dispatcherId,
      type: 'dispatcher',
      name: route?.displayName || model,
      enabled: route?.enabled !== false,
      ownership: route?.ownership || 'manual',
      mode: 'route',
      policy: { kind: 'builtin', builtin: route?.dispatcherBuiltin || 'weighted' },
    },
    ...(supplyNode ? [supplyNode] : []),
  ];
  const edges: any[] = [
    {
      id: `edge:${entryId}:bidirect.out:${dispatcherId}:bidirect.in`,
      sourceNodeId: entryId,
      sourcePortId: 'bidirect.out',
      targetNodeId: dispatcherId,
      targetPortId: 'bidirect.in',
      kind: 'bidirect_flow',
      ownership: route?.ownership || 'manual',
    },
  ];
  if (supplyNode) {
    edges.push({
      id: `edge:${executionTargetId}:route.out:${dispatcherId}:route.in`,
      sourceNodeId: executionTargetId,
      sourcePortId: 'route.out',
      targetNodeId: dispatcherId,
      targetPortId: 'route.in',
      kind: 'route_flow',
      ownership: route?.ownership || 'manual',
      metadata: {
        candidate: {
          id: `candidate:${routeKey}`,
          routeEndpointId: executionTargetId,
          endpointKind: 'supply',
          weight: normalizeFixtureTargets(route)[0]?.weight ?? 10,
        },
      },
    });
  }
  return { nodes, edges, macros: [] };
}

function buildRouteGroupFixtureRoute(route: any) {
  const routeKey = fixtureRouteKey(route);
  const model = fixtureModelName(route);
  const sourceEndpointIds = Array.isArray(route?.backend?.endpointIds)
    ? route.backend.endpointIds.map((endpointId: unknown) => String(endpointId || '').trim()).filter(Boolean)
    : [];
  const macro = buildCandidateSelectorMacro({
    stableId: `route-group:${routeKey}`,
    displayName: route?.displayName || model || routeKey,
    ingress: route?.visibility === 'internal' ? 'none' : 'external',
    enabled: route?.enabled !== false,
    policy: { kind: 'builtin', builtin: route?.dispatcherBuiltin || 'weighted' },
    endpointIds: sourceEndpointIds,
    ownership: route?.ownership || 'manual',
    match: {
      kind: 'model',
      requestedModelPattern: route?.match?.requestedModelPattern || '',
      displayName: route?.match?.displayName ?? route?.displayName ?? null,
    },
    metadata: {},
  });
  return {
    nodes: [],
    edges: sourceEndpointIds.map((endpointId: string) => ({
      id: `edge:${endpointId}:route.out:macro:route-group:${routeKey}:candidates.in`,
      sourceNodeId: endpointId,
      sourcePortId: 'route.out',
      targetNodeId: `macro:route-group:${routeKey}`,
      targetPortId: 'candidates.in',
      kind: 'route_flow',
      ownership: route?.ownership || 'manual',
      metadata: {
          candidate: {
            routeEndpointId: endpointId,
            endpointKind: 'supply',
            weight: 10,
        },
      },
    })),
    macros: [macro],
  };
}

function buildGroupedFixtureRoutes(fixtureGroup: string, routes: any[]) {
  const canonical = fixtureGroup.toLowerCase();
  const nodes: any[] = [];
  const edges: any[] = [];
  const macros: any[] = [];
  const first = routes[0];
  const displayName = fixtureModelName(first);
  const endpointIds: string[] = [];
  for (const route of routes) {
    const supplyNode = createFixtureSupplyNode(route);
    if (!supplyNode) continue;
    nodes.push(supplyNode);
    endpointIds.push(supplyNode.id);
  }
  macros.push(buildCandidateSelectorMacro({
    stableId: `fixture-group:${canonical}`,
    displayName,
    enabled: first?.enabled !== false,
    policy: { kind: 'builtin', builtin: first?.dispatcherBuiltin || 'weighted' },
    endpointIds,
    ownership: 'system',
    match: { kind: 'model', requestedModelPattern: displayName, displayName },
    fallbackStages: endpointIds.length > 0 ? [{
      id: 'default',
      label: 'Default',
      enabled: true,
      policy: { kind: 'builtin', builtin: first?.dispatcherBuiltin || 'weighted' },
      members: endpointIds.map((endpointId) => ({ endpointId, weight: 10 })),
    }] : [],
  }));
  for (const endpointId of endpointIds) {
    edges.push({
      id: `edge:${endpointId}:route.out:macro:fixture-group:${canonical}:candidates.in`,
      sourceNodeId: endpointId,
      sourcePortId: 'route.out',
      targetNodeId: `macro:fixture-group:${canonical}`,
      targetPortId: 'candidates.in',
      kind: 'route_flow',
      ownership: 'system',
      metadata: {
        candidate: {
          routeEndpointId: endpointId,
          endpointKind: 'supply',
          weight: 10,
        },
      },
    });
  }
  return { nodes, edges, macros };
}

function buildRouteGraphSourceFromFixtureRoutes(routes: any[]) {
  const groupedRoutesByFixtureGroup = new Map<string, any[]>();
  for (const route of routes) {
    const fixtureGroup = String(route?.fixtureGroup || '').trim();
    if (!fixtureGroup || route?.backend?.kind !== 'supply') continue;
    const current = groupedRoutesByFixtureGroup.get(fixtureGroup) || [];
    current.push(route);
    groupedRoutesByFixtureGroup.set(fixtureGroup, current);
  }
  const groupedRouteIds = new Set(
    Array.from(groupedRoutesByFixtureGroup.values()).flatMap((groupedRoutes) => groupedRoutes.map((route) => route.id)),
  );
  const pieces = [
    ...Array.from(groupedRoutesByFixtureGroup.entries()).map(([fixtureGroup, groupedRoutes]) => (
      buildGroupedFixtureRoutes(fixtureGroup, groupedRoutes)
    )),
    ...routes
      .filter((route) => !groupedRouteIds.has(route.id))
      .map((route) => route?.backend?.kind === 'route_endpoints'
        ? buildRouteGroupFixtureRoute(route)
        : buildDirectFixtureRoute(route)),
  ];
  const nodesById = new Map<string, any>();
  const edgesById = new Map<string, any>();
  const macrosById = new Map<string, any>();
  for (const piece of pieces) {
    for (const node of piece.nodes) nodesById.set(node.id, node);
    for (const edge of piece.edges) edgesById.set(edge.id, edge);
    for (const macro of piece.macros) macrosById.set(macro.id, macro);
  }
  return normalizeRouteGraphSource({
    nodes: Array.from(nodesById.values()),
    edges: Array.from(edgesById.values()),
    macros: Array.from(macrosById.values()),
  });
}

describe('routeGraph port-native source', () => {
  it('normalizes route graph sources with unique edge ids', () => {
    const source = normalizeRouteGraphSource({
      nodes: [],
      macros: [],
      edges: [
        { id: 'edge:duplicate', sourceNodeId: 'a', sourcePortId: 'route.out', targetNodeId: 'b', targetPortId: 'route.in', kind: 'route_flow' },
        { id: 'edge:duplicate', sourceNodeId: 'a', sourcePortId: 'route.out', targetNodeId: 'b', targetPortId: 'route.in', kind: 'route_flow' },
      ],
    });

    expect(source.edges).toHaveLength(1);
  });

  it('builds direct graph-native routes as entry-dispatcher graphs', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
        {
          id: 11,
          enabled: true,
          displayName: null,
          match: {
            kind: 'model',
            requestedModelPattern: 'gpt-4o',
            displayName: null
          },
          backend: { kind: 'supply' },
          targets: [{ targetId: '11', model: 'gpt-4o', accountId: 1, tokenId: 1, weight: 10 }],
        },
    ]);

    expect(source.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'entry:route-fixture:11', type: 'entry' }),
      expect.objectContaining({ id: 'dispatcher:route-fixture:11', type: 'dispatcher', mode: 'route' }),
    ]));
    expect(source.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: 'entry:route-fixture:11', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:route-fixture:11', targetPortId: 'bidirect.in', kind: 'bidirect_flow' }),
      expect.objectContaining({ sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:11', sourcePortId: 'route.out', targetNodeId: 'dispatcher:route-fixture:11', targetPortId: 'route.in', kind: 'route_flow' }),
    ]));
    expect(compileRouteGraphSource(source).ok).toBe(true);
    const compiled = compileRouteGraphSource(source);
    const router = compiled.compiled.compiledRouterBundle;
    expect(router).toMatchObject({
      planIndex: {
        'program:entry:route-fixture:11': 0,
      },
      matcher: {
        exact: {
          'gpt-4o': expect.objectContaining({
            programId: 'program:entry:route-fixture:11',
            entryNodeId: 'entry:route-fixture:11',
            publicModelName: 'gpt-4o',
          }),
        },
        normalizedExact: {
          'gpt-4o': expect.objectContaining({
            programId: 'program:entry:route-fixture:11',
          }),
        },
      },
    });
    expect(router?.plans).toEqual([
      expect.objectContaining({
        id: 'program:entry:route-fixture:11',
        entryNodeId: 'entry:route-fixture:11',
        publicModelName: 'gpt-4o',
        executionAlternatives: [expect.objectContaining({
          kind: 'execution_attempt',
          // A single static dispatcher branch and execution target are direct.
          selectionTerms: [],
          fallbackStages: [],
          terminal: expect.objectContaining({
            kind: 'supply',
            endpointId: 'route-endpoint:supply:upstream-model-fixture:11',
          }),
          endpoint: expect.objectContaining({
            endpointId: 'route-endpoint:supply:upstream-model-fixture:11',
          }),
          executionAttempt: expect.objectContaining({
            targetId: '11',
            model: 'gpt-4o',
          }),
        })],
      }),
    ]);
  });

  it('rejects executable route endpoint targets without stable target ids', () => {
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry:missing-target-id',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'missing-target-id-model' },
        },
        {
          id: 'dispatcher:missing-target-id',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
        },
        {
          id: 'endpoint:missing-target-id',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          endpointKind: 'supply',
          config: {
            targets: [{ model: 'missing-target-id-model' }],
            targetSelection: { kind: 'builtin', builtin: 'weighted' },
          },
        },
      ],
      edges: [
        { id: 'entry-to-dispatcher', sourceNodeId: 'entry:missing-target-id', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:missing-target-id', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'endpoint-to-dispatcher', sourceNodeId: 'endpoint:missing-target-id', sourcePortId: 'route.out', targetNodeId: 'dispatcher:missing-target-id', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('route_endpoint.target_id_required');
    const plan = result.compiled.compiledRouterBundle?.plans?.[0];
    expect(String(JSON.stringify(plan))).not.toContain('endpoint:missing-target-id:target:0');
  });

  it('keeps compiled execution alternative ids stable across target order changes', () => {
    const buildSource = (targets: Array<{ targetId: string; model: string }>) => ({
      nodes: [
        {
          id: 'entry:stable-target-order',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'stable-target-order-model' },
        },
        {
          id: 'dispatcher:stable-target-order',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
        },
        {
          id: 'endpoint:stable-target-order',
          type: 'route_endpoint',
          routeEndpointId: 'endpoint:stable-target-order',
          enabled: true,
          ownership: 'manual',
          endpointKind: 'supply',
          config: {
            targets,
            targetSelection: { kind: 'builtin', builtin: 'weighted' },
          },
        },
      ],
      edges: [
        { id: 'edge:stable-target-entry-dispatcher', sourceNodeId: 'entry:stable-target-order', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:stable-target-order', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'edge:stable-target-endpoint-dispatcher', sourceNodeId: 'endpoint:stable-target-order', sourcePortId: 'route.out', targetNodeId: 'dispatcher:stable-target-order', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });
    const alternativesByTargetId = (source: ReturnType<typeof buildSource>) => Object.fromEntries(
      (compileRouteGraphSource(source).compiled.compiledRouterBundle?.plans[0]?.executionAlternatives || [])
        .map((alternative: any) => [alternative.executionAttempt?.targetId, alternative.alternativeId]),
    );

    const first = alternativesByTargetId(buildSource([
      { targetId: 'target:a', model: 'stable-target-a' },
      { targetId: 'target:b', model: 'stable-target-b' },
    ]));
    const reversed = alternativesByTargetId(buildSource([
      { targetId: 'target:b', model: 'stable-target-b' },
      { targetId: 'target:a', model: 'stable-target-a' },
    ]));

    expect(first).toEqual(reversed);
    expect(Object.values(first)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^program:entry:stable-target-order:alt:[a-f0-9]{16}$/),
    ]));
    for (const alternativeId of Object.values(first)) {
      expect(String(alternativeId)).not.toMatch(/:alt:\d+$/);
    }
  });

  it('keeps dispatch candidate option ids stable across edge order changes', () => {
    const buildSource = (candidateEdges: any[]) => ({
      nodes: [
        {
          id: 'entry:stable-edge-order',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'stable-edge-order-model' },
        },
        {
          id: 'dispatcher:stable-edge-order',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
        },
        {
          id: 'endpoint:stable-edge-a',
          type: 'route_endpoint',
          routeEndpointId: 'endpoint:stable-edge-a',
          enabled: true,
          ownership: 'manual',
          endpointKind: 'supply',
          config: { targets: [{ targetId: 'target:edge-a', model: 'edge-a' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
        {
          id: 'endpoint:stable-edge-b',
          type: 'route_endpoint',
          routeEndpointId: 'endpoint:stable-edge-b',
          enabled: true,
          ownership: 'manual',
          endpointKind: 'supply',
          config: { targets: [{ targetId: 'target:edge-b', model: 'edge-b' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        { id: 'edge:stable-edge-entry-dispatcher', sourceNodeId: 'entry:stable-edge-order', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:stable-edge-order', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        ...candidateEdges,
      ],
    });
    const edgeA = { id: 'edge:stable-edge-a-dispatcher', sourceNodeId: 'endpoint:stable-edge-a', sourcePortId: 'route.out', targetNodeId: 'dispatcher:stable-edge-order', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' };
    const edgeB = { id: 'edge:stable-edge-b-dispatcher', sourceNodeId: 'endpoint:stable-edge-b', sourcePortId: 'route.out', targetNodeId: 'dispatcher:stable-edge-order', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' };
    const alternativesByTargetId = (source: ReturnType<typeof buildSource>) => Object.fromEntries(
      (compileRouteGraphSource(source).compiled.compiledRouterBundle?.plans[0]?.executionAlternatives || [])
        .map((alternative: any) => [
          alternative.executionAttempt?.targetId,
          {
            alternativeId: alternative.alternativeId,
            dispatchOptionId: alternative.selectionTerms.find((term: any) => term.mode === 'route')?.optionId,
          },
        ]),
    );

    const first = alternativesByTargetId(buildSource([edgeA, edgeB]));
    const reversed = alternativesByTargetId(buildSource([edgeB, edgeA]));

    expect(first).toEqual(reversed);
    expect(first['target:edge-a'].dispatchOptionId).toContain('edge:stable-edge-a-dispatcher');
    expect(JSON.stringify(first)).not.toContain(':candidate:0');
  });

  it('builds generic route endpoint selectors without route_ref nodes', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
        {
          id: 11,
          enabled: true,
          displayName: null,
          match: { kind: 'model', requestedModelPattern: 'source-model', displayName: null},
          backend: { kind: 'supply' },
          targets: [{ targetId: '11', model: 'source-model', accountId: 1, tokenId: 1, weight: 10 }],
        },
      {
        id: 21,
        enabled: true,
        displayName: 'public-group',
        match: { kind: 'model', requestedModelPattern: '', displayName: 'public-group'},
        backend: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:upstream-model-fixture:11'] },
      },
    ]);

    expect(source.nodes.some((node) => node.type === 'route_ref')).toBe(false);
    expect(source.macros).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'route-group:21',
        kind: 'candidate_selector',
        config: expect.objectContaining({
          groups: [
            expect.objectContaining({
              input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:upstream-model-fixture:11'] },
            }),
          ],
        }),
      }),
    ]));
    const result = compileRouteGraphSource(source);
    expect(result.ok).toBe(true);
    expect(result.primitiveSource.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'macro:route-group:21:dispatcher', type: 'dispatcher', mode: 'route', ownership: 'derived' }),
    ]));
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:11',
        sourcePortId: 'route.out',
        targetNodeId: 'macro:route-group:21:dispatcher',
        targetPortId: 'route.in',
        kind: 'route_flow',
      }),
    ]));
  });

  it('groups supply endpoints behind one public macro per canonical model', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 11,
        enabled: true,
        displayName: 'GLM-5.1',
        match: { kind: 'model', requestedModelPattern: 'GLM-5.1', displayName: 'GLM-5.1'},
        backend: { kind: 'supply' },
        ownership: 'system',
        fixtureGroup: 'glm-5.1',
        targets: [{ targetId: '11', model: 'GLM-5.1', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 22,
        enabled: true,
        displayName: 'glm-5.1',
        match: { kind: 'model', requestedModelPattern: 'glm-5.1', displayName: 'glm-5.1'},
        backend: { kind: 'supply' },
        ownership: 'system',
        fixtureGroup: 'glm-5.1',
        targets: [{ targetId: '22', model: 'glm-5.1', accountId: 1, tokenId: 2, weight: 10 }],
      },
    ]);

    expect(source.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'route-endpoint:supply:upstream-model-fixture:11', type: 'route_endpoint', endpointKind: 'supply', exposure: 'none' }),
      expect.objectContaining({ id: 'route-endpoint:supply:upstream-model-fixture:22', type: 'route_endpoint', endpointKind: 'supply', exposure: 'none' }),
    ]));
    expect(source.macros).toEqual([
      expect.objectContaining({
        id: 'fixture-group:glm-5.1',
        ownership: 'system',
        config: expect.objectContaining({
          groups: [
            expect.objectContaining({
              input: {
                kind: 'route_endpoints',
                endpointIds: ['route-endpoint:supply:upstream-model-fixture:11', 'route-endpoint:supply:upstream-model-fixture:22'],
              },
              members: [
                expect.objectContaining({ endpointId: 'route-endpoint:supply:upstream-model-fixture:11', weight: 10 }),
                expect.objectContaining({ endpointId: 'route-endpoint:supply:upstream-model-fixture:22', weight: 10 }),
              ],
            }),
          ],
        }),
      }),
    ]);
    expect(source.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:11',
        targetNodeId: 'macro:fixture-group:glm-5.1',
        targetPortId: 'candidates.in',
        metadata: expect.objectContaining({ candidate: expect.objectContaining({ endpointKind: 'supply' }) }),
      }),
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:22',
        targetNodeId: 'macro:fixture-group:glm-5.1',
        targetPortId: 'candidates.in',
        metadata: expect.objectContaining({ candidate: expect.objectContaining({ endpointKind: 'supply' }) }),
      }),
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:11',
        sourcePortId: 'route.out',
        targetNodeId: 'macro:fixture-group:glm-5.1',
        targetPortId: 'candidates.in',
        kind: 'route_flow',
      }),
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:22',
        sourcePortId: 'route.out',
        targetNodeId: 'macro:fixture-group:glm-5.1',
        targetPortId: 'candidates.in',
        kind: 'route_flow',
      }),
    ]));

    const result = compileRouteGraphSource(source);
    expect(result.ok).toBe(true);
    expect(compiledRuntimePublicModels(result)).toEqual([
      { nodeId: 'macro:fixture-group:glm-5.1:entry', model: 'GLM-5.1' },
    ]);
    const router = result.compiled.compiledRouterBundle;
    expect(router?.matcher.exact['GLM-5.1']).toEqual(expect.objectContaining({
      programId: 'program:macro:fixture-group:glm-5.1:entry',
    }));
    expect(result.primitiveSource.nodes.some((node) => node.id.startsWith('macro:fixture-group:glm-5.1:candidate:') && node.type === 'route_endpoint')).toBe(false);
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:11',
        targetNodeId: 'macro:fixture-group:glm-5.1:dispatcher',
        targetPortId: 'route.in',
        metadata: expect.objectContaining({
          candidate: expect.objectContaining({ endpointKind: 'supply' }),
        }),
      }),
    ]));
    const plan = router?.plans.find((item) => item.id === 'program:macro:fixture-group:glm-5.1:entry');
    expect(plan?.executionAlternatives.map((alternative) => ({
      nodeId: alternative.endpoint?.nodeId,
      endpointId: alternative.endpoint?.endpointId,
      fallbackStage: alternative.fallbackStages[0]?.stageId,
    }))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: 'route-endpoint:supply:upstream-model-fixture:11',
        endpointId: 'route-endpoint:supply:upstream-model-fixture:11',
        fallbackStage: undefined,
      }),
      expect.objectContaining({
        nodeId: 'route-endpoint:supply:upstream-model-fixture:22',
        endpointId: 'route-endpoint:supply:upstream-model-fixture:22',
        fallbackStage: undefined,
      }),
    ]));
    expect(plan?.executionAlternatives).toEqual(expect.arrayContaining([
      expect.objectContaining({
        terminal: expect.objectContaining({
          kind: 'supply',
          endpointId: 'route-endpoint:supply:upstream-model-fixture:11',
        }),
      }),
    ]));
    const firstSupplyAlternative = plan?.executionAlternatives.find((alternative) => alternative.terminal.kind === 'supply' && alternative.terminal.endpointId === 'route-endpoint:supply:upstream-model-fixture:11');
    expect(firstSupplyAlternative?.terminal).toEqual(expect.objectContaining({
      kind: 'supply',
      endpointId: 'route-endpoint:supply:upstream-model-fixture:11',
    }));
    expect(plan?.executionAlternatives
      .filter((alternative) => alternative.endpoint?.endpointId === 'route-endpoint:supply:upstream-model-fixture:11')
      .map((alternative) => alternative.executionAttempt)).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'GLM-5.1' }),
    ]));
    expect(plan?.sourceRef).toBeUndefined();
    expect(firstSupplyAlternative?.selectionTerms[0]?.nodeId).toBe('macro:fixture-group:glm-5.1:dispatcher');
  });

  it('does not synthesize route-fixture supply endpoints for routes without executable targets', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 321,
        enabled: true,
        displayName: 'minimax-m2.7',
        match: { kind: 'model', requestedModelPattern: 'minimax-m2.7', displayName: 'minimax-m2.7'},
        backend: { kind: 'supply' },
        ownership: 'system',
        fixtureGroup: 'minimax-m2.7',
      },
    ]);

    expect(JSON.stringify(source)).not.toContain('route-endpoint:supply:upstream-model-fixture:321');
    expect(source.nodes).toEqual([]);
    expect(source.macros).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'fixture-group:minimax-m2.7',
        config: expect.objectContaining({
          groups: [
            expect.objectContaining({
              id: 'fallback-stage:unavailable',
              input: { kind: 'synthetic', statusCode: 503, message: 'No route is available.' },
            }),
          ],
        }),
      }),
    ]));

    const result = compileRouteGraphSource(source);

    expect(result.ok).toBe(true);
    expect(result.primitiveSource.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'macro:fixture-group:minimax-m2.7:candidate:fallback-stage:unavailable:synthetic',
        type: 'synthetic_endpoint',
      }),
    ]));
  });

  it('groups grouped supply supplies with colon model names without duplicate primitive ids', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 3392,
        enabled: true,
        displayName: 'deepseek-v4-flash:free',
        match: { kind: 'model', requestedModelPattern: 'deepseek-v4-flash:free', displayName: 'deepseek-v4-flash:free'},
        backend: { kind: 'supply' },
        ownership: 'system',
        fixtureGroup: 'deepseek-v4-flash:free',
        targets: [{ targetId: '3392', model: 'deepseek-v4-flash:free', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 3393,
        enabled: true,
        displayName: 'DeepSeek-V4-Flash:Free',
        match: { kind: 'model', requestedModelPattern: 'DeepSeek-V4-Flash:Free', displayName: 'DeepSeek-V4-Flash:Free'},
        backend: { kind: 'supply' },
        ownership: 'system',
        fixtureGroup: 'deepseek-v4-flash:free',
        targets: [{ targetId: '3393', model: 'DeepSeek-V4-Flash:Free', accountId: 1, tokenId: 2, weight: 10 }],
      },
    ]);

    expect(source.nodes.some((node) => node.id.startsWith('route-endpoint:product:'))).toBe(false);
    expect(source.macros.filter((macro) => macro.id === 'fixture-group:deepseek-v4-flash:free')).toHaveLength(1);

    const result = compileRouteGraphSource(source);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'node.duplicate_id')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(compiledRuntimePublicModels(result)).toEqual([
      { nodeId: 'macro:fixture-group:deepseek-v4-flash:free:entry', model: 'deepseek-v4-flash:free' },
    ]);
  });

  it('keeps compiled route program metadata compact', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      ...Array.from({ length: 24 }, (_, index) => ({
        id: index + 1,
        enabled: true,
        displayName: `compact-model-${index}`,
        match: { kind: 'model' as const, requestedModelPattern: `compact-model-${index}`, displayName: null},
        backend: { kind: 'supply' as const },
        ownership: 'system' as const,
        targets: Array.from({ length: 12 }, (__, targetIndex) => ({
          targetId: `${index}-${targetIndex}`,
          model: `compact-model-${index}`,
          accountId: targetIndex + 1,
          tokenId: targetIndex + 100,
          weight: 10,
        })),
      })),
    ]);

    const compiled = compileRouteGraphSource(source);

    expect(compiled.ok).toBe(true);
    expect(compiled.compiled.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(compiled.compiled.compiledRouterBundle?.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(compiled.compiled.compiledRouterBundle?.plans).toHaveLength(24);
    const compiledGraphJson = JSON.stringify(compiled.compiled);
    expect(compiledGraphJson).not.toContain('"programBundle"');
    expect(compiledGraphJson).not.toContain('"flatProgramBundle"');
    expect(JSON.stringify(compiled.compiled.compiledRouterBundle)).not.toContain('"next"');
    const firstCompiledRouterPlan = compiled.compiled.compiledRouterBundle?.plans[0];
    expect(firstCompiledRouterPlan?.executionAlternatives.length).toBeGreaterThan(0);
    expect(firstCompiledRouterPlan).not.toHaveProperty('targets');
    expect(firstCompiledRouterPlan).not.toHaveProperty('selectorLevels');
    expect(firstCompiledRouterPlan).not.toHaveProperty('candidates');
    expect(firstCompiledRouterPlan?.executionAlternatives[0]?.terminal).toMatchObject({
      kind: 'supply',
    });
    expect(firstCompiledRouterPlan?.executionAlternatives[0]?.terminal).not.toHaveProperty('targets');
    expect(firstCompiledRouterPlan?.executionAlternatives[0]?.terminal).not.toHaveProperty('targetIndexes');
    expect(firstCompiledRouterPlan?.executionAlternatives[0]).toHaveProperty('filterStageIndexes');
    expect(firstCompiledRouterPlan?.executionAlternatives[0]).not.toHaveProperty('filterStages');
    expect(Buffer.byteLength(JSON.stringify(compiled.compiled), 'utf8')).toBeLessThan(2 * 1024 * 1024);
  });

  it('stores compact execution tables and materializes the selected plan without changing its runtime meaning', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([{
      id: 1,
      enabled: true,
      displayName: 'packed-runtime-model',
      match: { kind: 'model', requestedModelPattern: 'packed-runtime-model', displayName: 'packed-runtime-model' },
      backend: { kind: 'supply' },
      targets: [
        { targetId: 'packed-a', model: 'packed-a', accountId: 1, tokenId: 1, weight: 10 },
        { targetId: 'packed-b', model: 'packed-b', accountId: 2, tokenId: 2, weight: 5 },
      ],
    }]);
    const compiled = compileRouteGraphSource(source);
    const bundle = compiled.compiled.compiledRouterBundle!;
    const expectedPlan = bundle.plans[0]!;
    const storageCompiled = compileRouteGraphSource(source, { compactRuntimeBundle: true });
    const storageBundle = storageCompiled.compiled.compiledRouterBundle!;
    expect(compiled.ok).toBe(true);
    expect(storageCompiled.ok).toBe(true);
    expect(expectedPlan.executionAlternatives).toHaveLength(2);
    expect(storageBundle.hash).toBe(bundle.hash);
    expect(storageBundle.executionTable).toBeTruthy();
    expect(getCompiledRouterPlanById(storageBundle, expectedPlan.id)).toEqual(expectedPlan);

    expectedPlan.executionAlternatives.forEach((alternative, index) => {
      alternative.executionAttempt!.transportBinding = {
        kind: 'execution_target',
        executionTargetId: [71, 72][index]!,
      };
    });
    const persistedBundle = JSON.parse(JSON.stringify(compactCompiledRouterBundle(bundle))) as typeof bundle;

    expect(persistedBundle.executionTable).toEqual(expect.objectContaining({
      attempts: expect.any(Array),
      terminals: expect.any(Array),
    }));
    expect(persistedBundle.plans[0]?.executionAlternatives[0]).toEqual(expect.objectContaining({
      attempt: expect.any(Number),
      terminal: expect.any(Number),
    }));
    expect(persistedBundle.plans[0]?.executionAlternatives[0]).not.toHaveProperty('executionAttempt');
    expect(getCompiledRouterExecutionTargetIds(persistedBundle)).toEqual([71, 72]);
    expect(getCompiledRouterPlanById(persistedBundle, expectedPlan.id)).toEqual(expectedPlan);
  });

  it('exposes clear default labels for candidate selector macro ports', () => {
    const macro = normalizeRouteGraphSource({
      macros: [
        {
          id: 'model-group:labels',
          kind: 'candidate_selector',
          config: {
            surface: {
              entry: {
                kind: 'external',
                match: { displayName: 'label-check' },
              },
              output: 'route',
            },
          },
        },
      ],
    }).macros[0];

    expect(getRouteGraphMacroPorts(macro).map((port) => [port.id, port.label])).toEqual([
      ['bidirect.in', 'incoming flow'],
      ['candidates.in', 'candidate inputs'],
      ['route.out', 'candidate targets'],
    ]);
  });

  it('normalizes empty candidate selector macros with enabled defaults and default surface ports', () => {
    const source = normalizeRouteGraphSource({
      macros: [
        {
          id: 'model-group:empty',
          kind: 'candidate_selector',
        },
      ],
    });

    expect(source.macros[0]).toMatchObject({
      id: 'model-group:empty',
      kind: 'candidate_selector',
      enabled: true,
      ownership: 'manual',
      config: {
        surface: {
          entry: {
            kind: 'external',
          },
          output: 'route',
        },
        policy: { kind: 'inherit_default' },
        groups: [],
      },
    });
    expect(getRouteGraphMacroPorts(source.macros[0])).toEqual([
      expect.objectContaining({ id: 'bidirect.in', label: 'incoming flow', direction: 'input', kind: 'bidirect', multiple: true }),
      expect.objectContaining({ id: 'candidates.in', label: 'candidate inputs', direction: 'input', kind: 'route', multiple: true, collection: { type: 'set', min: 1 } }),
      expect.objectContaining({ id: 'route.out', label: 'candidate targets', direction: 'output', kind: 'route', multiple: true, collection: { type: 'set', min: 1 } }),
    ]);
  });

  it('preserves compatibility policy on route endpoints and targets', () => {
    const source = normalizeRouteGraphSource({
      nodes: [
        {
          id: 'endpoint.compat',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          compatibilityPolicy: {
            reasoningHistory: {
              transport: {
                mode: 'content_think_tag',
              },
            },
          },
          config: {
            targets: [
              {
                targetId: '1',
                model: 'compat-model',
                compatibilityPolicy: {
                  reasoningHistory: {
                    transport: {
                      mode: 'native',
                    },
                  },
                },
              },
            ],
          },
        },
        {
          id: 'dispatcher.compat',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
        },
      ],
      edges: [
        {
          id: 'edge.compat',
          sourceNodeId: 'endpoint.compat',
          sourcePortId: 'route.out',
          targetNodeId: 'dispatcher.compat',
          targetPortId: 'route.in',
          kind: 'route_flow',
          ownership: 'manual',
        },
      ],
    });

    expect(source.nodes[0]).toMatchObject({
      compatibilityPolicy: {
        reasoningHistory: {
          transport: {
            mode: 'content_think_tag',
          },
        },
      },
      config: {
        targets: [
          expect.objectContaining({
            targetId: '1',
            compatibilityPolicy: {
              reasoningHistory: {
                transport: {
                  mode: 'native',
                },
              },
            },
          }),
        ],
      },
    });
    expect(source.edges[0]).not.toHaveProperty('metadata.candidate.attempts');
  });

  it('exposes stable default ports for every primitive node type', () => {
    const nodes = [
      { id: 'entry:ports', type: 'entry' },
      { id: 'filter:ports', type: 'filter' },
      { id: 'dispatcher:ports', type: 'dispatcher', mode: 'route' },
      { id: 'endpoint:ports', type: 'route_endpoint' },
      { id: 'synthetic:ports', type: 'synthetic_endpoint' },
    ];

    expect(Object.fromEntries(nodes.map((node) => [
      node.type,
      getRouteGraphNodePorts(node).map((port) => ({
        id: port.id,
        label: port.label,
        direction: port.direction,
        kind: port.kind,
        enabled: port.enabled,
        collection: port.collection,
        required: port.required,
        multiple: port.multiple,
      })),
    ]))).toEqual({
      entry: [
        { id: 'bidirect.out', label: 'matched flow', direction: 'output', kind: 'bidirect', enabled: true, collection: undefined, required: undefined, multiple: undefined },
      ],
      filter: [
        { id: 'request.in', label: 'before mutation', direction: 'input', kind: 'request', enabled: true, collection: undefined, required: undefined, multiple: undefined },
        { id: 'request.out', label: 'after mutation', direction: 'output', kind: 'request', enabled: true, collection: undefined, required: undefined, multiple: undefined },
        { id: 'bidirect.in', label: 'before round trip', direction: 'input', kind: 'bidirect', enabled: true, collection: undefined, required: undefined, multiple: undefined },
        { id: 'bidirect.out', label: 'after round trip', direction: 'output', kind: 'bidirect', enabled: true, collection: undefined, required: undefined, multiple: undefined },
      ],
      dispatcher: [
        { id: 'bidirect.in', label: 'dispatch input', direction: 'input', kind: 'bidirect', enabled: true, collection: undefined, required: true, multiple: undefined },
        { id: 'bidirect[1...].out', label: 'dispatch path', direction: 'output', kind: 'bidirect', enabled: false, collection: { type: 'arr', min: 1 }, required: undefined, multiple: true },
        { id: 'route.in', label: 'endpoint candidates', direction: 'input', kind: 'route', enabled: true, collection: { type: 'set', min: 1 }, required: undefined, multiple: true },
        { id: 'route.out', label: 'selected route', direction: 'output', kind: 'route', enabled: true, collection: undefined, required: undefined, multiple: true },
        { id: 'fallback.out', label: 'fallback when exhausted', direction: 'output', kind: 'bidirect', enabled: true, collection: undefined, required: undefined, multiple: undefined },
      ],
      route_endpoint: [
        { id: 'route.out', label: 'route product', direction: 'output', kind: 'route', enabled: true, collection: undefined, required: undefined, multiple: undefined },
        { id: 'bidirect.in', label: 'invoke route', direction: 'input', kind: 'bidirect', enabled: true, collection: undefined, required: undefined, multiple: true },
      ],
      synthetic_endpoint: [
        { id: 'route.out', label: 'synthetic response', direction: 'output', kind: 'route', enabled: true, collection: undefined, required: undefined, multiple: undefined },
        { id: 'bidirect.in', label: 'return response', direction: 'input', kind: 'bidirect', enabled: true, collection: undefined, required: undefined, multiple: true },
      ],
    });
  });

  it('normalizes single port collections without cardinality bounds', () => {
    const source = normalizeRouteGraphSource({
      nodes: [
        {
          id: 'filter:single-collection',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.in', label: 'single request', direction: 'input', kind: 'request', collection: { type: 'single', min: 1, max: 2 } },
          ],
        },
      ],
      edges: [],
    });

    expect(getRouteGraphNodePorts(source.nodes[0]).find((port) => port.id === 'request.in')?.collection).toEqual({ type: 'single' });
  });

  it('rejects node-level edges without ports', () => {
    const source = normalizeRouteGraphSource({
      nodes: [
        {
          id: 'entry:a',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'a' },
        },
        {
          id: 'pool:a',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:a', model: 'a' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        { id: 'node-level-edge', sourceNodeId: 'entry:a', targetNodeId: 'pool:a' },
      ],
    });

    const result = compileRouteGraphSource(source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('edge.invalid');
  });

  it('rejects incompatible port connections', () => {
    const source = normalizeRouteGraphSource({
      nodes: [
        {
          id: 'entry:a',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'a' },
        },
        {
          id: 'dispatcher:a',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
        {
          id: 'pool:a',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:a', model: 'a' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        {
          id: 'bad-edge',
          sourceNodeId: 'entry:a',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'dispatcher:a',
          targetPortId: 'route.in',
          kind: 'request_flow',
        },
      ],
    });

    const result = compileRouteGraphSource(source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('edge.incompatible_ports');
  });

  it('rejects missing edge endpoints and missing ports with specific diagnostics', () => {
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry:missing',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'missing-model' },
        },
        {
          id: 'dispatcher:missing',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
      ],
      edges: [
        {
          id: 'missing-source',
          sourceNodeId: 'node:missing',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'dispatcher:missing',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'missing-target',
          sourceNodeId: 'entry:missing',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'node:missing',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'missing-port',
          sourceNodeId: 'entry:missing',
          sourcePortId: 'bidirect.missing',
          targetNodeId: 'dispatcher:missing',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'edge.missing_source', edgeId: 'missing-source' }),
      expect.objectContaining({ code: 'edge.missing_target', edgeId: 'missing-target' }),
      expect.objectContaining({ code: 'edge.missing_source_port', edgeId: 'missing-port' }),
    ]));
  });

  it('rejects duplicate connections to non-multiple input ports', () => {
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry:a',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'a' },
        },
        {
          id: 'entry:b',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'b' },
        },
        {
          id: 'dispatcher:single',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
      ],
      edges: [
        { id: 'a-dispatcher', sourceNodeId: 'entry:a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:single', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'b-dispatcher', sourceNodeId: 'entry:b', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:single', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'edge.duplicate_input', edgeId: 'b-dispatcher' }),
    ]));
  });

  it('allows multiple connections to explicitly multiple input ports', () => {
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry:multi',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'multi-model' },
        },
        {
          id: 'dispatcher:multi',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
        {
          id: 'endpoint:a',
          type: 'route_endpoint',
          routeEndpointId: 'endpoint:a',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'a', model: 'multi-model-a' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
        {
          id: 'endpoint:b',
          type: 'route_endpoint',
          routeEndpointId: 'endpoint:b',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'b', model: 'multi-model-b' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        { id: 'entry-dispatcher', sourceNodeId: 'entry:multi', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:multi', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'a-dispatcher', sourceNodeId: 'endpoint:a', sourcePortId: 'route.out', targetNodeId: 'dispatcher:multi', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'b-dispatcher', sourceNodeId: 'endpoint:b', sourcePortId: 'route.out', targetNodeId: 'dispatcher:multi', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.source.edges.filter((edge) => edge.targetNodeId === 'dispatcher:multi' && edge.targetPortId === 'route.in').map((edge) => edge.id)).toEqual([
      'a-dispatcher',
      'b-dispatcher',
    ]);
    expect(compiledRuntimeOps(result).flatMap((op) => (
      typeof op.endpoint?.endpointId === 'string' ? [op.endpoint.endpointId] : []
    ))).toEqual(expect.arrayContaining([
      'endpoint:a',
      'endpoint:b',
    ]));
  });

  it('enforces collection bounds on set and arr input ports', () => {
    const belowMin = compileRouteGraphSource({
      nodes: [
        {
          id: 'filter:set-required',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.in', label: 'required request set', direction: 'input', kind: 'request', collection: { type: 'set', min: 1 } },
            { id: 'request.out', label: 'request out', direction: 'output', kind: 'request' },
          ],
        },
      ],
      edges: [],
    });

    expect(belowMin.ok).toBe(false);
    expect(belowMin.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'port.collection_min', nodeId: 'filter:set-required' }),
    ]));

    const aboveMax = compileRouteGraphSource({
      nodes: [
        {
          id: 'source:a',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.out', label: 'request out', direction: 'output', kind: 'request' },
          ],
        },
        {
          id: 'source:b',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.out', label: 'request out', direction: 'output', kind: 'request' },
          ],
        },
        {
          id: 'filter:arr-limited',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.in', label: 'limited request arr', direction: 'input', kind: 'request', collection: { type: 'arr', max: 1 } },
            { id: 'request.out', label: 'request out', direction: 'output', kind: 'request' },
          ],
        },
      ],
      edges: [
        { id: 'edge:a', sourceNodeId: 'source:a', sourcePortId: 'request.out', targetNodeId: 'filter:arr-limited', targetPortId: 'request.in', kind: 'request_flow', ownership: 'manual' },
        { id: 'edge:b', sourceNodeId: 'source:b', sourcePortId: 'request.out', targetNodeId: 'filter:arr-limited', targetPortId: 'request.in', kind: 'request_flow', ownership: 'manual' },
      ],
    });

    expect(aboveMax.ok).toBe(false);
    expect(aboveMax.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'edge.collection_max', edgeId: 'edge:b' }),
    ]));
  });

  it('enforces collection max on semantic macro input ports during compilation', () => {
    const endpoint = (id) => ({
      id: `endpoint:${id}`,
      type: 'route_endpoint',
      enabled: true,
      ownership: 'manual',
      endpointKind: 'supply',
      resolutionStatus: 'resolved',
      config: {
        targets: [{ targetId: id, model: `model-${id}` }],
        targetSelection: { kind: 'builtin', builtin: 'weighted' },
      },
    });
    const result = compileRouteGraphSource({
      nodes: [endpoint('a'), endpoint('b')],
      macros: [
        {
          id: 'macro:limited-candidates',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                match: { requestedModelPattern: 'limited-candidates', displayName: 'limited-candidates' },
              },
              output: 'route',
              ports: [
                { id: 'bidirect.in', label: 'input', direction: 'input', kind: 'bidirect' },
                { id: 'candidates.in', label: 'candidate inputs', direction: 'input', kind: 'route', multiple: true, collection: { type: 'set', max: 1 } },
                { id: 'route.out', label: 'route output', direction: 'output', kind: 'route' },
              ],
            },
            policy: { kind: 'builtin', builtin: 'weighted' },
            groups: [],
          },
        },
      ],
      edges: [
        { id: 'edge:a', sourceNodeId: 'endpoint:a', sourcePortId: 'route.out', targetNodeId: 'macro:limited-candidates', targetPortId: 'candidates.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'edge:b', sourceNodeId: 'endpoint:b', sourcePortId: 'route.out', targetNodeId: 'macro:limited-candidates', targetPortId: 'candidates.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'edge.collection_max', edgeId: 'edge:b' }),
    ]));
  });

  it('rejects duplicate public model names from active public entries', () => {
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry:a',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'duplicate-public' },
        },
        {
          id: 'entry:b',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'duplicate-public' },
        },
      ],
      edges: [],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('public_model.duplicate');
  });

  it('allows generated macro and primitive entries for the same public route', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 1,
        enabled: true,
        displayName: 'same-route-public',
        match: { kind: 'model', requestedModelPattern: 'same-route-public', displayName: 'same-route-public'},
        backend: { kind: 'supply' },
        ownership: 'system',
        targets: [{ targetId: '1', model: 'same-route-public', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const result = compileRouteGraphSource(source);

    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((item) => item.code)).not.toContain('public_model.duplicate');
  });

  it('detects active graph cycles before runtime dispatch', () => {
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: 'filter:a',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          operations: [],
        },
        {
          id: 'filter:b',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          operations: [],
        },
      ],
      edges: [
        { id: 'a-b', sourceNodeId: 'filter:a', sourcePortId: 'request.out', targetNodeId: 'filter:b', targetPortId: 'request.in', kind: 'request_flow', ownership: 'manual' },
        { id: 'b-a', sourceNodeId: 'filter:b', sourcePortId: 'request.out', targetNodeId: 'filter:a', targetPortId: 'request.in', kind: 'request_flow', ownership: 'manual' },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('graph.cycle');
  });

  it('rejects invalid regex model patterns at compile time', () => {
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry:bad-regex',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 're:[invalid' },
        },
        {
          id: 'dispatcher:bad-regex',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          ordering: 'explicit',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
        {
          id: 'pool:bad-regex',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:bad-regex', model: 'bad-regex' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        {
          id: 'flow',
          sourceNodeId: 'entry:bad-regex',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'dispatcher:bad-regex',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('pattern.invalid');
  });

  it('ignores inactive dispatcher mode ports during validation and compilation', () => {
    const routeMode = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry:route',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'route-model' },
        },
        {
          id: 'dispatcher:route',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
        {
          id: 'endpoint:route',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:route', model: 'route-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
        {
          id: 'endpoint:ignored-flow',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:ignored', model: 'ignored' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        { id: 'entry-route', sourceNodeId: 'entry:route', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:route', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'route-candidate', sourceNodeId: 'endpoint:route', sourcePortId: 'route.out', targetNodeId: 'dispatcher:route', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'ignored-flow', sourceNodeId: 'dispatcher:route', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint:ignored-flow', targetPortId: 'bidirect.in', kind: 'request_flow', ownership: 'manual' },
      ],
    });

    expect(routeMode.ok).toBe(true);
    expect(compiledRuntimeOps(routeMode).map((op) => op.sourceRef?.edgeId).filter(Boolean)).not.toContain('ignored-flow');

    const flowMode = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry:flow',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'flow-model' },
        },
        {
          id: 'dispatcher:flow',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'flow',
          policy: { kind: 'builtin', builtin: 'stable_first' },
        },
        {
          id: 'endpoint:flow',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:flow', model: 'flow-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
        {
          id: 'endpoint:ignored-route',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:ignored-route', model: 'ignored-route' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        { id: 'entry-flow', sourceNodeId: 'entry:flow', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:flow', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'flow-candidate', sourceNodeId: 'dispatcher:flow', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint:flow', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'ignored-route', sourceNodeId: 'endpoint:ignored-route', sourcePortId: 'route.out', targetNodeId: 'dispatcher:flow', targetPortId: 'route.in', kind: 'request_flow', ownership: 'manual' },
      ],
    });

    expect(flowMode.ok).toBe(true);
    expect(compiledRuntimeOps(flowMode).map((op) => op.sourceRef?.edgeId).filter(Boolean)).not.toContain('ignored-route');
  });

  it('exposes inactive dispatcher mode ports as disabled ports', () => {
    const routeDispatcher = {
      id: 'dispatcher:route',
      type: 'dispatcher',
      mode: 'route',
    };
    const flowDispatcher = {
      id: 'dispatcher:flow',
      type: 'dispatcher',
      mode: 'flow',
    };

    expect(getRouteGraphNodePorts(routeDispatcher).find((port) => port.id === 'route.in')?.enabled).toBe(true);
    expect(getRouteGraphNodePorts(routeDispatcher).find((port) => port.id === 'bidirect[1...].out')?.enabled).toBe(false);
    expect(getRouteGraphNodePorts(flowDispatcher).find((port) => port.id === 'route.in')?.enabled).toBe(false);
    expect(getRouteGraphNodePorts(flowDispatcher).find((port) => port.id === 'bidirect[1...].out')?.enabled).toBe(true);
  });

  it('rejects edges connected to disabled ports', () => {
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: 'source:disabled-port',
          type: 'auto_node',
          enabled: true,
          ownership: 'manual',
          dynamicPorts: [
            { id: 'disabled.out', label: 'disabled output', direction: 'output', kind: 'request', enabled: false },
          ],
        },
        {
          id: 'target:disabled-port',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
        },
      ],
      edges: [
        {
          id: 'disabled-port-edge',
          sourceNodeId: 'source:disabled-port',
          sourcePortId: 'disabled.out',
          targetNodeId: 'target:disabled-port',
          targetPortId: 'request.in',
          kind: 'request_flow',
          ownership: 'manual',
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('edge.disabled_port');
  });

  it('preserves port collections and edge metadata through normalization and compilation', () => {
    const source = normalizeRouteGraphSource({
      nodes: [
        {
          id: 'entry:metadata',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'metadata-model' },
        },
        {
          id: 'dispatcher:metadata',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'flow',
          policy: {
            kind: 'inline',
            policy: {
              id: 'rank-by-weight',
              name: 'Rank by weight',
              kind: 'cel',
              selectionMode: 'ordered',
              orderExpression: '-(self.metadata.weight)',
            },
          },
        },
        {
          id: 'endpoint:metadata',
          type: 'route_endpoint',
          routeEndpointId: 'endpoint:metadata',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'metadata', model: 'metadata-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        { id: 'entry-flow', sourceNodeId: 'entry:metadata', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:metadata', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        {
          id: 'metadata-flow',
          sourceNodeId: 'dispatcher:metadata',
          sourcePortId: 'bidirect[1...].out',
          targetNodeId: 'endpoint:metadata',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
          metadata: { weight: 7 },
        },
      ],
    });
    const dispatcher = source.nodes.find((node) => node.id === 'dispatcher:metadata');
    const compiled = compileRouteGraphSource(source);

    expect(dispatcher && dispatcher.type === 'dispatcher' ? dispatcher : null).toMatchObject({
      type: 'dispatcher',
    });
    expect(getRouteGraphNodePorts(dispatcher).find((port) => port.id === 'bidirect[1...].out')?.collection).toEqual({ type: 'arr', min: 1 });
    expect(getRouteGraphNodePorts(dispatcher).find((port) => port.id === 'route.in')?.collection).toEqual({ type: 'set', min: 1 });
    expect(compiled.ok).toBe(true);
    expect(compiled.source.edges.find((edge) => edge.id === 'metadata-flow')?.metadata).toEqual({ weight: 7 });
    expect(compiledRuntimeOps(compiled).find((op) => op.mode === 'flow')?.metadata).toEqual(expect.objectContaining({ weight: 7 }));
  });

  it('allows a filter to be connected through the bidirect path without request.in', () => {
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry:filter',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'filter-model' },
        },
        {
          id: 'filter:bidirect',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          operations: [{ type: 'set_payload', path: 'reasoning_effort', value: 'high' }],
        },
        {
          id: 'dispatcher:filter',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'flow',
          policy: { kind: 'builtin', builtin: 'stable_first' },
        },
        {
          id: 'endpoint:filter',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:filter', model: 'filter-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        { id: 'entry-filter', sourceNodeId: 'entry:filter', sourcePortId: 'bidirect.out', targetNodeId: 'filter:bidirect', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'filter-dispatcher', sourceNodeId: 'filter:bidirect', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:filter', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'dispatcher-endpoint', sourceNodeId: 'dispatcher:filter', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint:filter', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });

    expect(result.diagnostics.map((item) => item.code)).not.toContain('port.required_missing');
    expect(result.diagnostics.map((item) => item.code)).not.toContain('filter.input_required');
    expect(result.ok).toBe(true);
  });

  it('requires filters to receive either request.in or bidirect.in', () => {
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: 'filter:orphan',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          operations: [],
        },
      ],
      edges: [],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('filter.input_required');
  });

  it('rejects fallback fan-out instead of choosing a successor by edge order', () => {
    const result = compileRouteGraphSource({
      nodes: [
        { id: 'entry:fallback-fanout', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'fallback-fanout' } },
        { id: 'dispatcher:primary', type: 'dispatcher', mode: 'route', enabled: true, ownership: 'manual' },
        { id: 'dispatcher:backup-a', type: 'dispatcher', mode: 'route', enabled: true, ownership: 'manual' },
        { id: 'dispatcher:backup-b', type: 'dispatcher', mode: 'route', enabled: true, ownership: 'manual' },
        { id: 'endpoint:primary', type: 'route_endpoint', endpointKind: 'supply', enabled: true, ownership: 'manual', config: { targets: [{ targetId: 'primary', model: 'primary' }] } },
        { id: 'endpoint:backup-a', type: 'route_endpoint', endpointKind: 'supply', enabled: true, ownership: 'manual', config: { targets: [{ targetId: 'backup-a', model: 'backup-a' }] } },
        { id: 'endpoint:backup-b', type: 'route_endpoint', endpointKind: 'supply', enabled: true, ownership: 'manual', config: { targets: [{ targetId: 'backup-b', model: 'backup-b' }] } },
      ],
      edges: [
        { id: 'enter', sourceNodeId: 'entry:fallback-fanout', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:primary', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'primary-candidate', sourceNodeId: 'endpoint:primary', sourcePortId: 'route.out', targetNodeId: 'dispatcher:primary', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'backup-a-candidate', sourceNodeId: 'endpoint:backup-a', sourcePortId: 'route.out', targetNodeId: 'dispatcher:backup-a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'backup-b-candidate', sourceNodeId: 'endpoint:backup-b', sourcePortId: 'route.out', targetNodeId: 'dispatcher:backup-b', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'fallback-a', sourceNodeId: 'dispatcher:primary', sourcePortId: 'fallback.out', targetNodeId: 'dispatcher:backup-a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'fallback-b', sourceNodeId: 'dispatcher:primary', sourcePortId: 'fallback.out', targetNodeId: 'dispatcher:backup-b', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('edge.fallback_fanout');
  });

  it('lowers candidate_selector fallback stages backed by route endpoints', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 11,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'source-model', displayName: null},
        backend: { kind: 'supply' },
        targets: [{ targetId: '11', model: 'source-model', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const result = compileRouteGraphSource({
      ...source,
      macros: [
        {
          id: 'model-group:public',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                match: { displayName: 'public-group' },
              },
              output: 'route',
            },
            policy: { kind: 'builtin', builtin: 'weighted' },
            filters: {
              operations: [
                { type: 'rewrite_model', source: 'current_model', operation: 'strip_suffix', suffix: '-debug' },
                { type: 'set_payload', path: 'reasoning_effort', value: 'high', mode: 'default' },
              ],
            },
            groups: [
              {
                id: 'p0',
                enabled: true,
                input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:upstream-model-fixture:11'] },
                defaults: { weight: 10 },
              },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.source.macros).toHaveLength(1);
    expect(result.primitiveSource.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'macro:model-group:public:entry', type: 'entry', ownership: 'derived' }),
      expect.objectContaining({
        id: 'macro:model-group:public:filter',
        type: 'filter',
        ownership: 'derived',
        operations: [
          expect.objectContaining({ type: 'rewrite_model', suffix: '-debug' }),
          expect.objectContaining({ type: 'set_payload', path: 'reasoning_effort', value: 'high' }),
        ],
      }),
      expect.objectContaining({ id: 'macro:model-group:public:dispatcher', type: 'dispatcher', mode: 'route', ownership: 'derived' }),
    ]));
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: 'macro:model-group:public:entry', targetNodeId: 'macro:model-group:public:filter', kind: 'bidirect_flow' }),
      expect.objectContaining({ sourceNodeId: 'macro:model-group:public:filter', targetNodeId: 'macro:model-group:public:dispatcher', kind: 'bidirect_flow' }),
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:11',
        targetNodeId: 'macro:model-group:public:dispatcher',
        kind: 'route_flow',
        metadata: expect.objectContaining({
          candidate: expect.objectContaining({ routeEndpointId: 'route-endpoint:supply:upstream-model-fixture:11', weight: 10 }),
        }),
      }),
    ]));
    expect(compiledRuntimePublicModels(result)).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'public-group' }),
    ]));
    const plan = result.compiled.compiledRouterBundle?.plans.find((item) => item.id === 'program:macro:model-group:public:entry');
    expect(plan?.filterStages).toEqual([
      expect.objectContaining({
        nodeId: 'macro:model-group:public:filter',
        phase: 'pre_selection',
        operations: [expect.objectContaining({ type: 'rewrite_model' })],
      }),
      expect.objectContaining({
        nodeId: 'macro:model-group:public:filter',
        phase: 'post_build',
        operations: [expect.objectContaining({ type: 'set_payload' })],
      }),
    ]);
  });

  it('partitions a macro-wide candidate source across fallback stages without duplicates', () => {
    const endpoint = (id: string) => ({
      id,
      type: 'route_endpoint',
      routeEndpointId: id,
      name: 'source-model',
      enabled: true,
      ownership: 'manual',
      endpointKind: 'supply',
      metadata: { upstreamModel: 'source-model' },
      config: { targets: [{ targetId: 'target-' + id, model: 'source-model' }] },
    });
    const source = normalizeRouteGraphSource({
      nodes: [endpoint('endpoint:a'), endpoint('endpoint:b'), endpoint('endpoint:c')],
      edges: [],
      macros: [{
        id: 'macro:partitioned-source',
        kind: 'candidate_selector',
        enabled: true,
        ownership: 'manual',
        config: {
          surface: {
            entry: { kind: 'external', match: { requestedModelPattern: 'public-model' } },
            output: 'route',
          },
          policy: { kind: 'builtin', builtin: 'weighted' },
          candidateSource: { kind: 'model_pattern', pattern: 'source-model' },
          groups: [
            {
              id: 'primary',
              enabled: true,
              acceptUnassigned: true,
              input: { kind: 'synthetic', statusCode: 503, message: 'unavailable' },
              members: [{ endpointId: 'endpoint:a', weight: 3 }],
            },
            {
              id: 'fallback',
              enabled: true,
              input: { kind: 'synthetic', statusCode: 503, message: 'unavailable' },
              members: [{ endpointId: 'endpoint:b', weight: 7 }],
            },
          ],
        },
      }],
    });

    const result = compileRouteGraphSource(source);

    expect(result.ok).toBe(true);
    const candidateEdges = result.primitiveSource.edges.filter((edge) =>
      edge.metadata?.provenance?.role === 'candidate_edge',
    );
    expect(candidateEdges.map((edge) => ({
      endpointId: edge.metadata?.candidate?.routeEndpointId,
      stageId: edge.metadata?.provenance?.fallbackStage?.id,
      weight: edge.metadata?.candidate?.weight,
    }))).toEqual([
      { endpointId: 'endpoint:a', stageId: 'primary', weight: 3 },
      { endpointId: 'endpoint:c', stageId: 'primary', weight: 1 },
      { endpointId: 'endpoint:b', stageId: 'fallback', weight: 7 },
    ]);
    expect(new Set(candidateEdges.map((edge) => edge.metadata?.candidate?.routeEndpointId)).size).toBe(3);
  });

  it('omits an empty unassigned stage when all source candidates are assigned to fallback', () => {
    const source = normalizeRouteGraphSource({
      nodes: [{
        id: 'endpoint:fallback-only',
        type: 'route_endpoint',
        routeEndpointId: 'endpoint:fallback-only',
        name: 'source-model',
        enabled: true,
        ownership: 'manual',
        endpointKind: 'supply',
        metadata: { upstreamModel: 'source-model' },
        config: { targets: [{ targetId: 'target:fallback-only', model: 'source-model' }] },
      }],
      edges: [],
      macros: [{
        id: 'macro:fallback-only',
        kind: 'candidate_selector',
        enabled: true,
        ownership: 'manual',
        config: {
          surface: {
            entry: { kind: 'external', match: { requestedModelPattern: 'public-model' } },
            output: 'route',
          },
          candidateSource: { kind: 'model_pattern', pattern: 'source-model' },
          groups: [
            {
              id: 'primary',
              enabled: true,
              acceptUnassigned: true,
              input: { kind: 'synthetic', statusCode: 503, message: 'unavailable' },
              members: [],
            },
            {
              id: 'fallback',
              enabled: true,
              input: { kind: 'synthetic', statusCode: 503, message: 'unavailable' },
              members: [{ endpointId: 'endpoint:fallback-only' }],
            },
          ],
        },
      }],
    });

    const result = compileRouteGraphSource(source);

    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('dispatcher.route_candidates_required');
    expect(result.primitiveSource.nodes.some((node) =>
      node.provenance?.fallbackStage?.id === 'primary',
    )).toBe(false);
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({
          candidate: expect.objectContaining({ routeEndpointId: 'endpoint:fallback-only' }),
          provenance: expect.objectContaining({ fallbackStage: expect.objectContaining({ id: 'fallback' }) }),
        }),
      }),
    ]));
  });

  it('lowers graph macro references into explicit dispatcher control flow', () => {
    const source = normalizeRouteGraphSource({
      nodes: [{
        id: 'endpoint:child-target',
        type: 'route_endpoint',
        enabled: true,
        ownership: 'manual',
        endpointKind: 'supply',
        routeEndpointId: 'endpoint:child-target',
        config: {
          targets: [{ targetId: 'attempt:child-target', model: 'child-model' }],
        },
      }],
      macros: [
        buildCandidateSelectorMacro({
          stableId: 'macro:child',
          displayName: 'Child',
          ingress: 'none',
          endpointIds: ['endpoint:child-target'],
        }),
        {
          id: 'macro:parent',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          name: 'Parent',
          config: {
            surface: {
              entry: { kind: 'external', match: { kind: 'model', requestedModelPattern: 'parent-model', displayName: 'parent-model' } },
              output: 'route',
            },
            policy: { kind: 'builtin', builtin: 'weighted' },
            groups: [{
              id: 'parent-stage',
              enabled: true,
              input: { kind: 'graph_references', endpointIds: [], macroIds: ['macro:child'] },
              members: [{ macroId: 'macro:child', weight: 7 }],
            }],
          },
        },
      ],
    });

    const compiled = compileRouteGraphSource(source);
    expect(compiled.ok).toBe(true);
    const plan = compiled.compiled.compiledRouterBundle?.plans.find((item) => item.publicModelName === 'parent-model');
    expect(plan?.executionAlternatives).toHaveLength(1);
    expect(plan?.executionAlternatives[0]?.executionAttempt).toMatchObject({
      targetId: 'attempt:child-target',
    });
    expect(plan?.executionAlternatives[0]?.terminal).toMatchObject({ endpointId: 'endpoint:child-target' });
    expect(plan?.executionAlternatives[0]?.selectionTerms).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'macro:macro:child:dispatcher', optionKind: 'route' }),
    ]));
  });

  it('lowers semantic macro-node edges into primitive candidate and dispatcher edges', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 11,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'source-model', displayName: null},
        backend: { kind: 'supply' },
        targets: [{ targetId: '11', model: 'source-model', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const result = compileRouteGraphSource({
      ...source,
      nodes: [
        ...source.nodes,
        {
          id: 'entry:reuse',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'reuse-model' },
        },
      ],
      edges: [
        ...source.edges,
        {
          id: 'entry-to-macro',
        sourceNodeId: 'entry:reuse',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'macro:model-group:reuse',
          targetPortId: 'reuse.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
      ],
      macros: [
        {
          id: 'model-group:reuse',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: { kind: 'embedded', input: 'bidirect' },
              output: 'route',
              ports: [
                { id: 'reuse.in', label: 'reuse flow', direction: 'input', kind: 'bidirect', multiple: true },
                { id: 'candidates.out', label: 'candidate routes', direction: 'output', kind: 'route', multiple: true, collection: { type: 'set', min: 1 } },
              ],
            },
            policy: { kind: 'builtin', builtin: 'weighted' },
            groups: [
              { id: 'p0', enabled: true, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:upstream-model-fixture:11'] } },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.source.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'entry-to-macro', targetNodeId: 'macro:model-group:reuse' }),
    ]));
    expect(getRouteGraphMacroPort(result.source.macros[0], 'reuse.in')).toEqual(expect.objectContaining({
      id: 'reuse.in',
      kind: 'bidirect',
      direction: 'input',
    }));
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'macro-semantic:entry-to-macro:bidirect-in',
        sourceNodeId: 'entry:reuse',
        targetNodeId: 'macro:model-group:reuse:dispatcher',
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
      }),
    ]));
  });

  it('lowers semantic macro-node source edges through macro-defined output ports', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 11,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'source-model', displayName: null},
        backend: { kind: 'supply' },
        targets: [{ targetId: '11', model: 'source-model', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const result = compileRouteGraphSource({
      ...source,
      nodes: [
        ...source.nodes,
        {
          id: 'entry:reuse-output',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'reuse-output-model' },
        },
        {
          id: 'dispatcher:reuse',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
      ],
      edges: [
        ...source.edges,
        {
          id: 'entry-to-dispatcher',
          sourceNodeId: 'entry:reuse-output',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'dispatcher:reuse',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'macro-to-dispatcher',
          sourceNodeId: 'macro:model-group:reuse',
          sourcePortId: 'candidates.out',
          targetNodeId: 'dispatcher:reuse',
          targetPortId: 'route.in',
          kind: 'route_flow',
          ownership: 'manual',
        },
      ],
      macros: [
        {
          id: 'model-group:reuse',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: { kind: 'embedded', input: 'bidirect' },
              output: 'route',
              ports: [
                { id: 'reuse.in', label: 'reuse flow', direction: 'input', kind: 'bidirect', multiple: true },
                { id: 'candidates.out', label: 'candidate routes', direction: 'output', kind: 'route', multiple: true, collection: { type: 'set', min: 1 } },
              ],
            },
            policy: { kind: 'builtin', builtin: 'weighted' },
            groups: [
              { id: 'p0', enabled: true, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:upstream-model-fixture:11'] } },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(getRouteGraphMacroPort(result.source.macros[0], 'candidates.out')).toEqual(expect.objectContaining({
      id: 'candidates.out',
      kind: 'route',
      direction: 'output',
    }));
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'macro-semantic:macro-to-dispatcher:route-out:route-endpoint:supply:upstream-model-fixture:11',
        sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:11',
        sourcePortId: 'route.out',
        targetNodeId: 'dispatcher:reuse',
        targetPortId: 'route.in',
        kind: 'route_flow',
      }),
    ]));
  });

  it('lowers route endpoint edges into candidate selector macro candidate inputs', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 11,
        enabled: true,
        displayName: 'source-model',
        match: { kind: 'model', requestedModelPattern: 'source-model', displayName: 'source-model'},
        backend: { kind: 'supply' },
        ownership: 'system',
        fixtureGroup: 'source-model',
        targets: [{ targetId: '11', model: 'source-model', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const result = compileRouteGraphSource({
      ...source,
      macros: [{
        ...source.macros[0],
        config: {
          ...source.macros[0]!.config,
          groups: [{
            id: 'semantic',
            enabled: true,
            input: { kind: 'route_endpoints', endpointIds: [] },
          }],
        },
      }],
      edges: [
        {
          id: 'supply-to-macro-candidates',
          sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:11',
          sourcePortId: 'route.out',
          targetNodeId: 'macro:fixture-group:source-model',
          targetPortId: 'candidates.in',
          kind: 'route_flow',
          ownership: 'system',
          metadata: { reason: 'auto candidate binding' },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(getRouteGraphMacroPort(result.source.macros[0], 'candidates.in')).toEqual(expect.objectContaining({
      id: 'candidates.in',
      kind: 'route',
      direction: 'input',
    }));
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'macro-semantic:supply-to-macro-candidates:candidate-in',
        sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:11',
        sourcePortId: 'route.out',
        targetNodeId: 'macro:fixture-group:source-model:dispatcher',
        targetPortId: 'route.in',
        kind: 'route_flow',
        ownership: 'derived',
        metadata: expect.objectContaining({
          reason: 'auto candidate binding',
          provenance: expect.objectContaining({
            source: 'macro_semantic_edge',
            semanticEdgeId: 'supply-to-macro-candidates',
            macroId: 'fixture-group:source-model',
            role: 'candidate_edge',
          }),
        }),
      }),
    ]));
  });

  it('lowers candidate input edges when the macro id already has a macro prefix', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 11,
        enabled: true,
        displayName: 'model-example',
        match: { kind: 'model', requestedModelPattern: 'model-example', displayName: 'model-example'},
        backend: { kind: 'supply' },
        ownership: 'system',
        fixtureGroup: 'model-example',
        targets: [{ targetId: '11', model: 'model-example', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const result = compileRouteGraphSource({
      ...source,
      macros: [{
        ...source.macros[0],
        id: 'macro:fixture-group:model-example',
        config: {
          ...source.macros[0]!.config,
          groups: [{
            id: 'semantic',
            enabled: true,
            input: { kind: 'route_endpoints', endpointIds: [] },
          }],
        },
      }],
      edges: [{
        id: 'supply-to-prefixed-macro-candidates',
        sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:11',
        sourcePortId: 'route.out',
        targetNodeId: 'macro:fixture-group:model-example',
        targetPortId: 'candidates.in',
        kind: 'route_flow',
        ownership: 'system',
      }],
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).not.toContain('Semantic macro target port candidates.in is not supported');
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'macro-semantic:supply-to-prefixed-macro-candidates:candidate-in',
        sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:11',
        sourcePortId: 'route.out',
        targetNodeId: 'macro:macro:fixture-group:model-example:dispatcher',
        targetPortId: 'route.in',
        kind: 'route_flow',
      }),
    ]));
  });

  it('uses group members as the sole candidate-level selection authority', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 11,
        enabled: true,
        displayName: 'GLM-5.1',
        match: { kind: 'model', requestedModelPattern: 'GLM-5.1', displayName: 'GLM-5.1'},
        backend: { kind: 'supply' },
        ownership: 'system',
        fixtureGroup: 'glm-5.1',
        targets: [{ targetId: '11', model: 'GLM-5.1', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 22,
        enabled: true,
        displayName: 'glm-5.1',
        match: { kind: 'model', requestedModelPattern: 'glm-5.1', displayName: 'glm-5.1'},
        backend: { kind: 'supply' },
        ownership: 'system',
        fixtureGroup: 'glm-5.1',
        targets: [{ targetId: '22', model: 'glm-5.1', accountId: 1, tokenId: 2, weight: 10 }],
      },
    ]);
    const macro = source.macros[0];
    const input = {
      ...source,
      macros: [
        {
          ...macro,
          config: {
            ...macro.config,
            groups: macro.config.groups.map((group) => ({
              ...group,
              members: [
                { endpointId: 'route-endpoint:supply:upstream-model-fixture:11', weight: 3, enabled: true },
                { endpointId: 'route-endpoint:supply:upstream-model-fixture:22', enabled: false },
              ],
            })),
            // Unreleased legacy input is deliberately discarded by normalization.
            candidateOverrides: {
              byExecutionTargetId: {
                'route-endpoint:supply:upstream-model-fixture:11': { weight: 3, enabled: false },
                'route-endpoint:supply:upstream-model-fixture:22': { excluded: true },
              },
            },
          },
        },
      ],
    };
    const normalized = normalizeRouteGraphSource(input);
    const result = compileRouteGraphSource(normalized);

    expect(result.ok).toBe(true);
    expect(normalized.macros[0]?.config).not.toHaveProperty('candidateOverrides');
    const firstCandidateEdge = result.primitiveSource.edges.find((edge) => (
      edge.sourceNodeId === 'route-endpoint:supply:upstream-model-fixture:11'
      && edge.targetNodeId === 'macro:fixture-group:glm-5.1:dispatcher'
    ));
    expect(firstCandidateEdge?.metadata?.candidate).toMatchObject({ weight: 3, enabled: true });
    const secondCandidateEdge = result.primitiveSource.edges.find((edge) => (
      edge.sourceNodeId === 'route-endpoint:supply:upstream-model-fixture:22'
      && edge.targetNodeId === 'macro:fixture-group:glm-5.1:dispatcher'
    ));
    expect(secondCandidateEdge?.metadata?.candidate).toMatchObject({ enabled: false });
  });

  it('ignores semantic candidate edges that target a disabled macro', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 11,
        enabled: false,
        displayName: 'disabled-model',
        match: { kind: 'model', requestedModelPattern: 'disabled-model', displayName: 'disabled-model'},
        backend: { kind: 'supply' },
        ownership: 'system',
        targets: [{ targetId: '11', model: 'disabled-model', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const result = compileRouteGraphSource({
      ...source,
      edges: [{
        id: 'supply-to-disabled-macro-candidates',
        sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:11',
        sourcePortId: 'route.out',
        targetNodeId: 'macro:fixture-group:disabled-model',
        targetPortId: 'candidates.in',
        kind: 'route_flow',
        ownership: 'system',
      }],
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).not.toContain('Semantic macro target port candidates.in is not supported');
  });

  it('lowers embedded internal candidate_selector surfaces without exposing public models', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 11,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'source-model', displayName: null},
        backend: { kind: 'supply' },
        targets: [{ targetId: '11', model: 'source-model', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const result = compileRouteGraphSource({
      ...source,
      macros: [
        {
          id: 'model-group:internal',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: { kind: 'embedded', input: 'bidirect' },
              output: 'route',
            },
            policy: { kind: 'builtin', builtin: 'weighted' },
            groups: [
              { id: 'p0', enabled: true, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:upstream-model-fixture:11'] } },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.primitiveSource.nodes.some((node) => node.id === 'macro:model-group:internal:entry')).toBe(false);
    expect(compiledRuntimePublicModels(result).some((item) => item.model === 'internal-group')).toBe(false);
  });

  it('materializes candidate selector model_pattern groups from matching route endpoints', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 11,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'claude-opus-4-6', displayName: null},
        backend: { kind: 'supply' },
        targets: [{ targetId: '11', model: 'claude-opus-4-6', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 12,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'claude-sonnet-4-6', displayName: null},
        backend: { kind: 'supply' },
        targets: [{ targetId: '12', model: 'claude-sonnet-4-6', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 13,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'gpt-4o-mini', displayName: null},
        backend: { kind: 'supply' },
        targets: [{ targetId: '13', model: 'gpt-4o-mini', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const result = compileRouteGraphSource({
      ...source,
      macros: [
        {
          id: 'pattern-selector',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                match: { displayName: 'claude-group' },
              },
              output: 'route',
            },
            policy: { kind: 'builtin', builtin: 'weighted' },
            groups: [
              {
                id: 'claude',
                enabled: true,
                input: { kind: 'model_pattern', pattern: 'claude-*' },
                defaults: { weight: 8 },
                materialization: { sort: 'model_name', dedupeBy: 'endpoint_id' },
              },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((item) => item.code)).not.toContain('macro.resolver_unsupported');
    expect(result.primitiveSource.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'macro:pattern-selector:candidate:claude:endpoint:route-endpoint:supply:upstream-model-fixture:11',
        type: 'route_endpoint',
        ownership: 'derived',
        provenance: expect.objectContaining({ source: 'macro', role: 'pattern_endpoint', macroId: 'pattern-selector' }),
      }),
      expect.objectContaining({
        id: 'macro:pattern-selector:candidate:claude:endpoint:route-endpoint:supply:upstream-model-fixture:12',
        type: 'route_endpoint',
        ownership: 'derived',
        provenance: expect.objectContaining({ source: 'macro', role: 'pattern_endpoint', macroId: 'pattern-selector' }),
      }),
    ]));
    expect(result.primitiveSource.nodes.some((node) => node.id === 'macro:pattern-selector:candidate:claude:endpoint:route-endpoint:supply:upstream-model-fixture:13')).toBe(false);
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: 'macro:pattern-selector:candidate:claude:endpoint:route-endpoint:supply:upstream-model-fixture:11',
        targetNodeId: 'macro:pattern-selector:dispatcher',
        metadata: expect.objectContaining({
          candidate: expect.objectContaining({
            pattern: 'claude-*',
            matchedModel: 'claude-opus-4-6',
          }),
        }),
      }),
      expect.objectContaining({
        sourceNodeId: 'macro:pattern-selector:candidate:claude:endpoint:route-endpoint:supply:upstream-model-fixture:12',
        targetNodeId: 'macro:pattern-selector:dispatcher',
      }),
    ]));
    expect(compiledRuntimePublicModels(result)).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'claude-group' }),
    ]));
  });

  it('materializes model_pattern candidates with canonical route endpoint identity', () => {
    const canonicalEndpointId = 'route-endpoint:supply:canonical:claude-opus';
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: 'graph-node:supply:claude-opus',
          type: 'route_endpoint',
          name: 'Claude Opus',
          enabled: true,
          ownership: 'manual',
          endpointKind: 'supply',
          exposure: 'none',
          resolutionStatus: 'resolved',
          routeEndpointId: canonicalEndpointId,
          backend: { kind: 'supply' },
          match: { kind: 'model', requestedModelPattern: 'claude-opus-4-6', displayName: null },
          config: {
            targets: [{ targetId: 'target:claude-opus', model: 'claude-opus-4-6', weight: 10 }],
            targetSelection: { kind: 'builtin', builtin: 'weighted' },
          },
        },
      ],
      edges: [],
      macros: [
        {
          id: 'pattern-selector',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                match: { displayName: 'claude-group' },
              },
              output: 'route',
            },
            policy: { kind: 'builtin', builtin: 'weighted' },
            groups: [
              {
                id: 'claude',
                enabled: true,
                input: { kind: 'model_pattern', pattern: 'claude-*' },
                materialization: { dedupeBy: 'endpoint_id' },
              },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    const candidateNodeId = `macro:pattern-selector:candidate:claude:endpoint:${canonicalEndpointId}`;
    expect(result.primitiveSource.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: candidateNodeId,
        routeEndpointId: canonicalEndpointId,
        provenance: expect.objectContaining({ source: 'macro', role: 'pattern_endpoint', macroId: 'pattern-selector' }),
      }),
    ]));
    expect(result.primitiveSource.nodes
      .filter((node) => node.ownership === 'derived')
      .some((node) => String(node.id).includes('graph-node:supply:claude-opus'))).toBe(false);
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: candidateNodeId,
        metadata: expect.objectContaining({
          candidate: expect.objectContaining({
            routeEndpointId: canonicalEndpointId,
          }),
        }),
      }),
    ]));
    expect(result.compiled.compiledRouterBundle?.plans[0]?.executionAlternatives[0]).toEqual(expect.objectContaining({
      terminal: expect.objectContaining({
        endpointId: canonicalEndpointId,
      }),
      endpoint: expect.objectContaining({
        endpointId: canonicalEndpointId,
      }),
    }));
  });

  it('lowers route_endpoint macro candidates with separate graph node and canonical endpoint identities', () => {
    const canonicalEndpointId = 'route-endpoint:supply:canonical:glm';
    const graphNodeId = 'graph-node:supply:glm';
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: graphNodeId,
          type: 'route_endpoint',
          name: 'GLM',
          enabled: true,
          ownership: 'manual',
          endpointKind: 'supply',
          exposure: 'none',
          resolutionStatus: 'resolved',
          routeEndpointId: canonicalEndpointId,
          backend: { kind: 'supply' },
          match: { kind: 'model', requestedModelPattern: 'glm-5.1', displayName: null },
          config: {
            targets: [{ targetId: 'target:glm', model: 'glm-5.1', weight: 10 }],
            targetSelection: { kind: 'builtin', builtin: 'weighted' },
          },
        },
      ],
      edges: [],
      macros: [
        {
          id: 'route-endpoint-selector',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                match: { displayName: 'glm-group' },
              },
              output: 'route',
            },
            policy: { kind: 'builtin', builtin: 'weighted' },
            groups: [
              {
                id: 'primary',
                enabled: true,
                input: { kind: 'route_endpoints', endpointIds: [canonicalEndpointId] },
              },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: graphNodeId,
        targetNodeId: 'macro:route-endpoint-selector:dispatcher',
        metadata: expect.objectContaining({
          candidate: expect.objectContaining({
            routeEndpointId: canonicalEndpointId,
          }),
        }),
      }),
    ]));
    const alternative = result.compiled.compiledRouterBundle?.plans[0]?.executionAlternatives[0];
    expect(alternative).toEqual(expect.objectContaining({
      terminal: expect.objectContaining({
        endpointId: canonicalEndpointId,
      }),
      endpoint: expect.objectContaining({
        endpointId: canonicalEndpointId,
        nodeId: graphNodeId,
      }),
    }));
  });

  it('keeps model_pattern macro materialization deterministic with limit and model dedupe', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 11,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'claude-opus-4-6', displayName: null},
        backend: { kind: 'supply' },
        targets: [{ targetId: '11', model: 'claude-opus-4-6', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 12,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'claude-opus-4-6-alt', displayName: null},
        backend: { kind: 'supply' },
        targets: [{ targetId: '12', model: 'claude-opus-4-6', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 13,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'claude-sonnet-4-6', displayName: null},
        backend: { kind: 'supply' },
        targets: [{ targetId: '13', model: 'claude-sonnet-4-6', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const result = compileRouteGraphSource({
      ...source,
      macros: [
        {
          id: 'pattern-limited',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                match: { displayName: 'limited-claude-group' },
              },
              output: 'route',
            },
            policy: { kind: 'builtin', builtin: 'weighted' },
            groups: [
              {
                id: 'claude',
                enabled: true,
                input: { kind: 'model_pattern', pattern: 'claude-*' },
                materialization: { sort: 'model_name', dedupeBy: 'model', limit: 1 },
              },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    const candidateIds = result.primitiveSource.nodes
      .map((node) => node.id)
      .filter((id) => id.startsWith('macro:pattern-limited:candidate:claude:'));
    expect(candidateIds).toEqual(['macro:pattern-limited:candidate:claude:endpoint:route-endpoint:supply:upstream-model-fixture:11']);
  });

  it('reports public macro entries with empty model_pattern groups as candidate-less dispatchers', () => {
    const result = compileRouteGraphSource({
      nodes: [],
      edges: [],
      macros: [
        {
          id: 'pattern-empty',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                match: { displayName: 'empty-pattern-group' },
              },
              output: 'route',
            },
            policy: { kind: 'builtin', builtin: 'weighted' },
            groups: [
              { id: 'none', enabled: true, input: { kind: 'model_pattern', pattern: 'no-match-*' } },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('dispatcher.route_candidates_required');
    expect(result.diagnostics.map((item) => item.code)).not.toContain('macro.resolver_unsupported');
  });

  it('reports unsupported candidate selector query resolvers explicitly', () => {
    const result = compileRouteGraphSource({
      nodes: [],
      edges: [],
      macros: [
        {
          id: 'pattern-selector',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                match: { displayName: 'pattern-group' },
              },
              output: 'route',
            },
            policy: { kind: 'builtin', builtin: 'weighted' },
            groups: [
              { id: 'metadata', enabled: true, input: { kind: 'metadata_query', cel: 'metadata.tier == "gold"' } },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('macro.resolver_unsupported');
  });

  it('rejects missing graph endpoints, missing ports, duplicate single inputs, required ports, duplicate public names, and cycles', () => {
    const missingReferences = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry:missing',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'missing-model' },
        },
      ],
      edges: [
        { id: 'missing-source', sourceNodeId: 'ghost', sourcePortId: 'bidirect.out', targetNodeId: 'entry:missing', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'missing-target', sourceNodeId: 'entry:missing', sourcePortId: 'bidirect.out', targetNodeId: 'ghost', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'missing-source-port', sourceNodeId: 'entry:missing', sourcePortId: 'ghost.out', targetNodeId: 'entry:missing', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'missing-target-port', sourceNodeId: 'entry:missing', sourcePortId: 'bidirect.out', targetNodeId: 'entry:missing', targetPortId: 'ghost.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });

    expect(missingReferences.ok).toBe(false);
    expect(missingReferences.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'edge.missing_source',
      'edge.missing_target',
      'edge.missing_source_port',
      'edge.missing_target_port',
    ]));

    const structural = compileRouteGraphSource({
      nodes: [
        { id: 'entry:a', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'dup-model' } },
        { id: 'entry:b', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'dup-model' } },
        { id: 'dispatcher:a', type: 'dispatcher', enabled: true, ownership: 'manual', mode: 'route', policy: { kind: 'builtin', builtin: 'weighted' } },
        { id: 'filter:a', type: 'filter', enabled: true, ownership: 'manual', operations: [] },
        { id: 'endpoint:a', type: 'route_endpoint', enabled: true, ownership: 'manual', config: { targets: [{ targetId: 'a', model: 'dup-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
        { id: 'endpoint:b', type: 'route_endpoint', enabled: true, ownership: 'manual', config: { targets: [{ targetId: 'b', model: 'dup-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
      ],
      edges: [
        { id: 'entry-a-dispatcher', sourceNodeId: 'entry:a', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'entry-b-filter', sourceNodeId: 'entry:b', sourcePortId: 'bidirect.out', targetNodeId: 'filter:a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'entry-a-filter-duplicate', sourceNodeId: 'entry:a', sourcePortId: 'bidirect.out', targetNodeId: 'filter:a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'filter-entry-a-cycle', sourceNodeId: 'filter:a', sourcePortId: 'bidirect.out', targetNodeId: 'entry:a', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'endpoint-a-route', sourceNodeId: 'endpoint:a', sourcePortId: 'route.out', targetNodeId: 'dispatcher:a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'endpoint-b-route', sourceNodeId: 'endpoint:b', sourcePortId: 'route.out', targetNodeId: 'dispatcher:a', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(structural.ok).toBe(false);
    expect(structural.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'edge.duplicate_input',
      'graph.cycle',
      'public_model.duplicate',
    ]));
    expect(structural.diagnostics.map((item) => item.code)).not.toContain('dispatcher.route_candidates_required');

    const missingRequiredPort = compileRouteGraphSource({
      nodes: [
        { id: 'entry:required', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'required-model' } },
        { id: 'dispatcher:required', type: 'dispatcher', enabled: true, ownership: 'manual', mode: 'route', policy: { kind: 'builtin', builtin: 'weighted' } },
        { id: 'endpoint:required', type: 'route_endpoint', enabled: true, ownership: 'manual', config: { targets: [{ targetId: 'required', model: 'required-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
      ],
      edges: [
        { id: 'route-only', sourceNodeId: 'endpoint:required', sourcePortId: 'route.out', targetNodeId: 'dispatcher:required', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(missingRequiredPort.ok).toBe(false);
    expect(missingRequiredPort.diagnostics.map((item) => item.code)).toContain('port.required_missing');
  });

  it('allows incomplete disabled primitives as authoring drafts', () => {
    const result = compileRouteGraphSource({
      nodes: [
        { id: 'entry:draft', type: 'entry', enabled: false, ownership: 'manual', match: { requestedModelPattern: '' } },
        { id: 'filter:draft', type: 'filter', enabled: false, ownership: 'manual', operations: [] },
        { id: 'dispatcher:draft', type: 'dispatcher', enabled: false, ownership: 'manual', mode: 'route', policy: { kind: 'inherit_default' } },
        { id: 'endpoint:draft', type: 'route_endpoint', enabled: false, ownership: 'manual', config: {} },
        { id: 'synthetic:draft', type: 'synthetic_endpoint', enabled: false, ownership: 'manual', statusCode: 503, message: 'Draft' },
      ],
      edges: [],
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const enabledEntry = compileRouteGraphSource({
      nodes: [
        { id: 'entry:enabled', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'enabled' } },
      ],
      edges: [],
    });
    expect(enabledEntry.ok).toBe(false);
    expect(enabledEntry.diagnostics).toContainEqual(expect.objectContaining({
      code: 'entry.no_terminal',
      nodeId: 'entry:enabled',
    }));
  });

  it('rejects public entry model names that differ only by case', () => {
    const result = compileRouteGraphSource({
      nodes: [
        { id: 'entry:upper', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'DeepSeek-v4-Flash' } },
        { id: 'entry:lower', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'deepseek-v4-flash' } },
        { id: 'endpoint:upper', type: 'route_endpoint', enabled: true, ownership: 'manual', config: { targets: [{ targetId: 'upper', model: 'DeepSeek-v4-Flash' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
        { id: 'endpoint:lower', type: 'route_endpoint', enabled: true, ownership: 'manual', config: { targets: [{ targetId: 'lower', model: 'deepseek-v4-flash' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } } },
      ],
      edges: [
        { id: 'upper-flow', sourceNodeId: 'entry:upper', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint:upper', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'lower-flow', sourceNodeId: 'entry:lower', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint:lower', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('public_model.duplicate');
  });

  it('lowers synthetic and inline candidate selector groups with defaults and provenance', () => {
    const result = compileRouteGraphSource({
      nodes: [],
      edges: [],
      macros: [
        {
          id: 'model-group:mixed',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                match: { displayName: 'mixed-group' },
              },
              output: 'route',
            },
            policy: { kind: 'builtin', builtin: 'weighted' },
            groups: [
              {
                id: 'disabled-inline',
                enabled: false,
                input: {
                  kind: 'inline_endpoints',
                  endpoints: [{ targetId: 'disabled', model: 'disabled-model' }],
                },
              },
              {
                id: 'inline',
                enabled: true,
                input: {
                  kind: 'inline_endpoints',
                  endpoints: [
                    { targetId: 'inline-a', model: 'inline-model-a', metadata: { region: 'sg' } },
                    { targetId: 'inline-b', model: 'inline-model-b' },
                  ],
                },
                defaults: {
                  weight: 8,
                  metadata: { tier: 'premium' },
                },
              },
              {
                id: 'synthetic',
                label: 'capacity guard',
                enabled: true,
                input: { kind: 'synthetic', statusCode: 429, message: 'capacity exceeded' },
                defaults: { weight: 1 },
              },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.primitiveSource.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'macro:model-group:mixed:candidate:inline:inline',
        type: 'route_endpoint',
        ownership: 'derived',
        metadata: expect.objectContaining({ tier: 'premium' }),
        provenance: expect.objectContaining({ source: 'macro', macroId: 'model-group:mixed', role: 'inline_endpoint' }),
        config: {
          targets: [
            expect.objectContaining({ targetId: 'inline-a', model: 'inline-model-a', metadata: { region: 'sg' } }),
            expect.objectContaining({ targetId: 'inline-b', model: 'inline-model-b' }),
          ],
          targetSelection: { kind: 'defer_to_router' },
        },
      }),
      expect.objectContaining({
        id: 'macro:model-group:mixed:candidate:synthetic:synthetic',
        type: 'synthetic_endpoint',
        statusCode: 429,
        message: 'capacity exceeded',
        ownership: 'derived',
      }),
    ]));
    expect(result.primitiveSource.nodes.some((node) => node.id.includes('disabled-inline'))).toBe(false);
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: 'macro:model-group:mixed:candidate:inline:inline',
        targetNodeId: 'macro:model-group:mixed:dispatcher',
        metadata: expect.objectContaining({
          provenance: expect.objectContaining({ source: 'macro', macroId: 'model-group:mixed', role: 'candidate_edge' }),
          candidate: expect.objectContaining({
            weight: 8,
          }),
        }),
      }),
      expect.objectContaining({
        sourceNodeId: 'macro:model-group:mixed:candidate:synthetic:synthetic',
        targetNodeId: 'macro:model-group:mixed:fallback-stage:synthetic:dispatcher',
        metadata: expect.objectContaining({
          candidate: expect.objectContaining({ synthetic: true, weight: 1 }),
        }),
      }),
    ]));
  });

  it('lowers candidate_selector bidirect outputs as flow dispatcher paths', () => {
    const result = compileRouteGraphSource({
      nodes: [],
      edges: [],
      macros: [
        {
          id: 'model-group:flow',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                match: { displayName: 'flow-group' },
              },
              output: 'bidirect',
              ports: [
                { id: 'bidirect.in', label: 'incoming flow', direction: 'input', kind: 'bidirect', multiple: true },
                { id: 'bidirect.out', label: 'selected flow', direction: 'output', kind: 'bidirect', multiple: true, collection: { type: 'arr', min: 1 } },
              ],
            },
            policy: { kind: 'builtin', builtin: 'round_robin' },
            groups: [
              {
                id: 'primary',
                enabled: true,
                input: {
                  kind: 'inline_endpoints',
                  endpoints: [{ targetId: 'flow-a', model: 'flow-model-a' }],
                },
              },
              {
                id: 'fallback',
                enabled: true,
                input: { kind: 'synthetic', statusCode: 503, message: 'flow fallback' },
              },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.primitiveSource.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'macro:model-group:flow:dispatcher',
        type: 'dispatcher',
        mode: 'flow',
        policy: { kind: 'builtin', builtin: 'round_robin' },
      }),
      expect.objectContaining({
        id: 'macro:model-group:flow:candidate:primary:inline',
        type: 'route_endpoint',
      }),
      expect.objectContaining({
        id: 'macro:model-group:flow:candidate:fallback:synthetic',
        type: 'synthetic_endpoint',
      }),
    ]));
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: 'macro:model-group:flow:entry',
        sourcePortId: 'bidirect.out',
        targetNodeId: 'macro:model-group:flow:dispatcher',
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
      }),
      expect.objectContaining({
        sourceNodeId: 'macro:model-group:flow:dispatcher',
        sourcePortId: 'fallback.out',
        targetNodeId: 'macro:model-group:flow:fallback-stage:fallback:dispatcher',
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
        metadata: expect.objectContaining({
          provenance: expect.objectContaining({
            role: 'fallback_stage_edge',
            fallbackStage: { id: 'fallback', index: 1 },
          }),
        }),
      }),
      expect.objectContaining({
        sourceNodeId: 'macro:model-group:flow:dispatcher',
        sourcePortId: 'bidirect[1...].out',
        targetNodeId: 'macro:model-group:flow:candidate:primary:inline',
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
      }),
      expect.objectContaining({
        sourceNodeId: 'macro:model-group:flow:fallback-stage:fallback:dispatcher',
        sourcePortId: 'bidirect[1...].out',
        targetNodeId: 'macro:model-group:flow:candidate:fallback:synthetic',
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
      }),
    ]));
    expect(compiledRuntimePublicModels(result)).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'flow-group' }),
    ]));
  });

  it('lowers semantic bidirect macro output ports through the macro-defined dispatcher output', () => {
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry:outer',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'outer-model' },
        },
        {
          id: 'filter:after-macro',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          operations: [{ type: 'set_payload', path: 'afterMacro', value: true }],
        },
        {
          id: 'endpoint:outer',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'outer', model: 'outer-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        {
          id: 'entry-to-macro',
          sourceNodeId: 'entry:outer',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'macro:model-group:embedded-flow',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'macro-to-filter',
          sourceNodeId: 'macro:model-group:embedded-flow',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'filter:after-macro',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'filter-to-endpoint',
          sourceNodeId: 'filter:after-macro',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'endpoint:outer',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
      ],
      macros: [
        {
          id: 'model-group:embedded-flow',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: { kind: 'embedded', input: 'bidirect' },
              output: 'bidirect',
              ports: [
                { id: 'bidirect.in', label: 'incoming flow', direction: 'input', kind: 'bidirect', multiple: true },
                { id: 'bidirect.out', label: 'selected flow', direction: 'output', kind: 'bidirect', multiple: true, collection: { type: 'arr', min: 1 } },
              ],
            },
            policy: { kind: 'builtin', builtin: 'stable_first' },
            groups: [
              {
                id: 'inline',
                input: { kind: 'inline_endpoints', endpoints: [{ targetId: 'macro-inline', model: 'macro-model' }] },
              },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'macro-semantic:entry-to-macro:bidirect-in',
        targetNodeId: 'macro:model-group:embedded-flow:dispatcher',
        targetPortId: 'bidirect.in',
      }),
      expect.objectContaining({
        id: 'macro-semantic:macro-to-filter:bidirect-out',
        sourceNodeId: 'macro:model-group:embedded-flow:dispatcher',
        sourcePortId: 'bidirect[1...].out',
        targetNodeId: 'filter:after-macro',
        targetPortId: 'bidirect.in',
      }),
    ]));
  });

  it('lowers embedded candidate_selector surfaces without exposing an entry or public model', () => {
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry:outer-embedded',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'outer-embedded-model' },
        },
        {
          id: 'endpoint:outer-embedded',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'outer-embedded', model: 'outer-embedded-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        {
          id: 'outer-to-embedded-macro',
          sourceNodeId: 'entry:outer-embedded',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'macro:model-group:embedded',
          targetPortId: 'flow.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'embedded-macro-to-endpoint',
          sourceNodeId: 'macro:model-group:embedded',
          sourcePortId: 'flow.out',
          targetNodeId: 'endpoint:outer-embedded',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
      ],
      macros: [
        {
          id: 'model-group:embedded',
          kind: 'candidate_selector',
          enabled: true,
          ownership: 'manual',
          config: {
            surface: {
              entry: { kind: 'embedded', input: 'bidirect' },
              output: 'bidirect',
              ports: [
                { id: 'flow.in', label: 'incoming flow', direction: 'input', kind: 'bidirect' },
                { id: 'flow.out', label: 'selected flow', direction: 'output', kind: 'bidirect', collection: { type: 'arr', min: 1 } },
              ],
            },
            policy: { kind: 'builtin', builtin: 'stable_first' },
            groups: [
              {
                id: 'guard',
                input: { kind: 'synthetic', statusCode: 503, message: 'embedded fallback' },
              },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.primitiveSource.nodes.some((node) => node.id === 'macro:model-group:embedded:entry')).toBe(false);
    expect(result.primitiveSource.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'macro:model-group:embedded:dispatcher', type: 'dispatcher', mode: 'flow' }),
      expect.objectContaining({ id: 'macro:model-group:embedded:candidate:guard:synthetic', type: 'synthetic_endpoint' }),
    ]));
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'macro-semantic:outer-to-embedded-macro:bidirect-in',
        sourceNodeId: 'entry:outer-embedded',
        targetNodeId: 'macro:model-group:embedded:dispatcher',
        targetPortId: 'bidirect.in',
      }),
      expect.objectContaining({
        id: 'macro-semantic:embedded-macro-to-endpoint:bidirect-out',
        sourceNodeId: 'macro:model-group:embedded:dispatcher',
        sourcePortId: 'bidirect[1...].out',
        targetNodeId: 'endpoint:outer-embedded',
      }),
    ]));
    expect(compiledRuntimePublicModels(result)).toEqual([
      expect.objectContaining({ model: 'outer-embedded-model' }),
    ]);
    expect(compiledRuntimePublicModels(result).some((item) => item.model === 'model-group:embedded')).toBe(false);
  });

  it('normalizes request-input embedded macro ports but rejects them until request dispatch is defined', () => {
    const macroSource = normalizeRouteGraphSource({
      macros: [
        {
          id: 'request-embedded',
          kind: 'candidate_selector',
          config: {
            surface: {
              entry: { kind: 'embedded', input: 'request' },
              output: 'route',
            },
          },
        },
      ],
    });
    expect(getRouteGraphMacroPorts(macroSource.macros[0]).map((port) => [port.id, port.kind, port.direction])).toEqual([
      ['request.in', 'request', 'input'],
      ['candidates.in', 'route', 'input'],
      ['route.out', 'route', 'output'],
    ]);

    const result = compileRouteGraphSource({
      ...macroSource,
      nodes: [
        {
          id: 'source:request',
          type: 'auto_node',
          enabled: true,
          ownership: 'system',
          dynamicPorts: [
            { id: 'request.out', label: 'request output', direction: 'output', kind: 'request' },
          ],
        },
      ],
      edges: [
        {
          id: 'request-to-macro',
          sourceNodeId: 'source:request',
          sourcePortId: 'request.out',
          targetNodeId: 'macro:request-embedded',
          targetPortId: 'request.in',
          kind: 'request_flow',
          ownership: 'manual',
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('macro.edge_unsupported');
  });

  it('enforces edge direction while allowing declared multiple inputs', () => {
    const badDirection = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry:direction',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'direction-model' },
        },
        {
          id: 'dispatcher:direction',
          type: 'dispatcher',
          enabled: true,
          ownership: 'manual',
          mode: 'route',
          policy: { kind: 'builtin', builtin: 'weighted' },
        },
        {
          id: 'endpoint:direction',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'direction', model: 'direction-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        {
          id: 'input-as-source',
          sourceNodeId: 'dispatcher:direction',
          sourcePortId: 'bidirect.in',
          targetNodeId: 'dispatcher:direction',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
        {
          id: 'route-candidate',
          sourceNodeId: 'endpoint:direction',
          sourcePortId: 'route.out',
          targetNodeId: 'dispatcher:direction',
          targetPortId: 'route.in',
          kind: 'route_flow',
          ownership: 'manual',
        },
      ],
    });

    expect(badDirection.ok).toBe(false);
    expect(badDirection.diagnostics.map((item) => item.code)).toContain('edge.invalid_source_port');

    const multipleInputs = compileRouteGraphSource({
      nodes: [
        { id: 'entry:a', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'multi-a' } },
        { id: 'entry:b', type: 'entry', enabled: true, ownership: 'manual', match: { requestedModelPattern: 'multi-b' } },
        {
          id: 'endpoint:shared',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'shared', model: 'multi-shared' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        { id: 'a-to-shared', sourceNodeId: 'entry:a', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint:shared', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'b-to-shared', sourceNodeId: 'entry:b', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint:shared', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });

    expect(multipleInputs.ok).toBe(true);
    expect(multipleInputs.diagnostics.map((item) => item.code)).not.toContain('edge.duplicate_input');
  });

  it('rejects connected internal nodes that are not reachable from enabled public entries', () => {
    const result = compileRouteGraphSource({
      nodes: [
        {
          id: 'entry:reachable',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'reachable-model' },
        },
        {
          id: 'endpoint:reachable',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'reachable', model: 'reachable-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
        {
          id: 'filter:orphan-connected',
          type: 'filter',
          enabled: true,
          ownership: 'manual',
          operations: [],
        },
        {
          id: 'endpoint:orphan-connected',
          type: 'route_endpoint',
          enabled: true,
          ownership: 'manual',
          config: { targets: [{ targetId: 'orphan', model: 'orphan-model' }], targetSelection: { kind: 'builtin', builtin: 'weighted' } },
        },
      ],
      edges: [
        { id: 'reachable-path', sourceNodeId: 'entry:reachable', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint:reachable', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'orphan-path', sourceNodeId: 'filter:orphan-connected', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint:orphan-connected', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('internal.unreachable');
  });

  it('applies candidate selector materialization limits deterministically', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 11,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'source-a'},
        backend: { kind: 'supply' },
        targets: [{ targetId: '11', model: 'source-a' }],
      },
      {
        id: 22,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'source-b'},
        backend: { kind: 'supply' },
        targets: [{ targetId: '22', model: 'source-b' }],
      },
    ]);

    const result = compileRouteGraphSource({
      ...source,
      macros: [
        {
          id: 'model-group:limited',
          kind: 'candidate_selector',
          config: {
            surface: {
              entry: { kind: 'external', match: { displayName: 'limited-group' } },
              output: 'route',
            },
            groups: [
              {
                id: 'limited',
                input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:upstream-model-fixture:22', 'route-endpoint:supply:upstream-model-fixture:11'] },
                materialization: { limit: 1 },
              },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:upstream-model-fixture:22',
        targetNodeId: 'macro:model-group:limited:dispatcher',
        kind: 'route_flow',
      }),
    ]));
    expect(result.primitiveSource.edges.some((edge) => (
      edge.sourceNodeId === 'route-endpoint:supply:upstream-model-fixture:11'
      && edge.targetNodeId === 'macro:model-group:limited:dispatcher'
    ))).toBe(false);
  });

  it('rejects candidate_selector route-endpoint aliases colliding with exact public routes', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 1,
        enabled: true,
        displayName: 'source-model',
        match: { kind: 'model', requestedModelPattern: 'source-model', displayName: null},
        backend: { kind: 'supply' },
        targets: [{ targetId: '1', model: 'source-model', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 2,
        enabled: true,
        displayName: 'colliding',
        match: { kind: 'model', requestedModelPattern: '', displayName: 'colliding'},
        backend: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:upstream-model-fixture:1'] },
      },
      {
        id: 3,
        enabled: true,
        displayName: 'colliding',
        match: { kind: 'model', requestedModelPattern: 'colliding', displayName: 'colliding'},
        backend: { kind: 'supply' },
        targets: [{ targetId: '3', model: 'colliding', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const compiled = compileRouteGraphSource(source);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((item) => item.code)).toContain('public_model.duplicate');
  });

  it('resolves route entries with macro aliases before plain endpoint aliases and exact channel entries', () => {
    const source = buildRouteGraphSourceFromFixtureRoutes([
      {
        id: 1,
        enabled: true,
        displayName: 'base-one',
        match: { kind: 'model', requestedModelPattern: 'base-one', displayName: 'base-one'},
        backend: { kind: 'supply' },
        targets: [{ targetId: '1', model: 'base-one' }],
      },
      {
        id: 2,
        enabled: true,
        displayName: 'macro-hit',
        match: { kind: 'model', requestedModelPattern: '', displayName: 'macro-hit'},
        backend: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:upstream-model-fixture:1'] },
      },
      {
        id: 3,
        enabled: true,
        displayName: 'exact-target',
        match: { kind: 'model', requestedModelPattern: 'macro-hit', displayName: 'exact-target'},
        backend: { kind: 'supply' },
        targets: [{ targetId: '3', model: 'macro-hit' }],
      },
    ]);

    const compiled = compileRouteGraphSource(source);
    expect(compiled.ok).toBe(true);
    expect(findRouteGraphEntryForModel(compiled.compiled, 'macro-hit')?.nodeId).toBe('macro:route-group:2:entry');
  });
});
