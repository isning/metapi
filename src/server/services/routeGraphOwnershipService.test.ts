import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../testing/dbHarness.js';

type RouteGraphServiceModule = typeof import('./routeGraphService.js');

type RouteGraphSourceFixture = {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  macros: Array<Record<string, unknown>>;
};

function syntheticNode(id: string, message: string): Record<string, unknown> {
  return {
    id,
    type: 'synthetic_endpoint',
    enabled: true,
    ownership: 'derived',
    statusCode: 503,
    message,
  };
}

function syntheticCandidateEdge(
  id: string,
  sourceNodeId: string,
  weight: number,
  ownership = 'derived',
): Record<string, unknown> {
  return {
    id,
    sourceNodeId,
    sourcePortId: 'route.out',
    targetNodeId: 'dispatcher.generated',
    targetPortId: 'route.in',
    kind: 'route_flow',
    ownership,
    metadata: {
      candidate: {
        id: `candidate.${sourceNodeId}`,
        routeEndpointId: sourceNodeId,
        endpointKind: 'synthetic',
        weight,
      },
    },
  };
}

function baseGraph(): RouteGraphSourceFixture {
  return {
    nodes: [
      {
        id: 'entry.public',
        type: 'entry',
        enabled: true,
        ownership: 'manual',
        match: {
          kind: 'model',
          requestedModelPattern: 'owned-model',
          displayName: null,
        },
      },
      {
        id: 'dispatcher.generated',
        type: 'dispatcher',
        enabled: true,
        ownership: 'derived',
        mode: 'route',
        policy: { kind: 'builtin', builtin: 'weighted' },
      },
      syntheticNode('synthetic.generated.a', 'generated unavailable a'),
      syntheticNode('synthetic.generated.b', 'generated unavailable b'),
    ],
    edges: [
      {
        id: 'edge.entry.dispatcher',
        sourceNodeId: 'entry.public',
        sourcePortId: 'bidirect.out',
        targetNodeId: 'dispatcher.generated',
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
        ownership: 'manual',
      },
      syntheticCandidateEdge('edge.synthetic.a.dispatcher', 'synthetic.generated.a', 10),
      syntheticCandidateEdge('edge.synthetic.b.dispatcher', 'synthetic.generated.b', 20),
    ],
    macros: [
      {
        id: 'macro.generated',
        kind: 'candidate_selector',
        enabled: false,
        ownership: 'system',
        config: {
          surface: {
            entry: { kind: 'embedded', input: 'bidirect' },
            output: 'route',
          },
          policy: { kind: 'builtin', builtin: 'weighted' },
          groups: [],
        },
      },
    ],
  };
}

function graphWithNonManualOwnershipViolations(): RouteGraphSourceFixture {
  const base = baseGraph();
  return {
    nodes: [
      base.nodes[0]!,
      {
        ...base.nodes[1]!,
        policy: { kind: 'builtin', builtin: 'stable_first' },
      },
      base.nodes[3]!,
      syntheticNode('synthetic.generated.created', 'created generated endpoint'),
    ],
    edges: [
      base.edges[0]!,
      {
        ...base.edges[2]!,
        metadata: {
          candidate: {
            id: 'candidate.synthetic.generated.b',
            routeEndpointId: 'synthetic.generated.b',
            endpointKind: 'synthetic',
            weight: 30,
          },
        },
      },
      syntheticCandidateEdge(
        'edge.synthetic.created.dispatcher',
        'synthetic.generated.created',
        40,
        'derived',
      ),
    ],
    macros: [
      {
        ...base.macros[0]!,
        name: 'mutated generated macro',
      },
      {
        id: 'macro.created',
        kind: 'candidate_selector',
        enabled: false,
        ownership: 'system',
        config: {
          surface: {
            entry: { kind: 'embedded', input: 'bidirect' },
            output: 'route',
          },
          policy: { kind: 'builtin', builtin: 'weighted' },
          groups: [],
        },
      },
    ],
  };
}

describe('routeGraphService graph-native ownership guards', () => {
  let runtimeDb: IsolatedRuntimeDbHandle;
  let publishRouteGraphSource: RouteGraphServiceModule['publishRouteGraphSource'];
  let saveRouteGraphDraft: RouteGraphServiceModule['saveRouteGraphDraft'];
  let publishRouteGraphDraft: RouteGraphServiceModule['publishRouteGraphDraft'];

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-route-graph-ownership-');
    const routeGraphService = await import('./routeGraphService.js');
    publishRouteGraphSource = routeGraphService.publishRouteGraphSource;
    saveRouteGraphDraft = routeGraphService.saveRouteGraphDraft;
    publishRouteGraphDraft = routeGraphService.publishRouteGraphDraft;
  });

  afterAll(async () => {
    await runtimeDb.cleanup();
  });

  it('rejects draft edits that delete, mutate, or create non-manual graph artifacts', async () => {
    const published = await publishRouteGraphSource({
      sourceGraph: baseGraph(),
      createdBy: 'test',
    });
    expect(published.ok).toBe(true);

    const draft = await saveRouteGraphDraft(graphWithNonManualOwnershipViolations());
    const draftCodes = draft.diagnostics.map((diagnostic) => diagnostic.code);
    expect(draftCodes).toEqual(expect.arrayContaining([
      'ownership.non_manual_delete',
      'ownership.non_manual_mutation',
      'ownership.non_manual_create',
      'ownership.non_manual_edge_delete',
      'ownership.non_manual_edge_mutation',
      'ownership.non_manual_edge_create',
      'ownership.non_manual_macro_mutation',
      'ownership.non_manual_macro_create',
    ]));

    const publishDraft = await publishRouteGraphDraft();
    expect(publishDraft.ok).toBe(false);
    expect(publishDraft.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'ownership.non_manual_delete',
      'ownership.non_manual_mutation',
      'ownership.non_manual_create',
      'ownership.non_manual_edge_delete',
      'ownership.non_manual_edge_mutation',
      'ownership.non_manual_edge_create',
      'ownership.non_manual_macro_mutation',
      'ownership.non_manual_macro_create',
    ]));
  });
});
