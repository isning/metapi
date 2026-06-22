import { describe, expect, it } from 'vitest';
import { layoutNodes, type ModelRouteFlowData } from './ModelRouteFlow.js';

function buildFlow(nodes: ModelRouteFlowData['nodes'], edges: ModelRouteFlowData['edges']): ModelRouteFlowData {
  return {
    version: 1,
    requestedModel: 'gpt-test',
    actualModel: 'gpt-test',
    matched: true,
    summary: [],
    nodes,
    edges,
    diagnostics: [],
    compiledAt: '2026-06-20T00:00:00.000Z',
  };
}

const baseMetrics = {};

function node(input: Partial<ModelRouteFlowData['nodes'][number]> & Pick<ModelRouteFlowData['nodes'][number], 'id' | 'kind' | 'label'>): ModelRouteFlowData['nodes'][number] {
  return {
    visibility: 'public',
    subtitle: null,
    status: 'available',
    badges: [],
    metrics: baseMetrics,
    history: [],
    ...input,
  };
}

function overlaps(
  left: { position: { x: number; y: number }; width?: number | null; height?: number | null },
  right: { position: { x: number; y: number }; width?: number | null; height?: number | null },
): boolean {
  const leftWidth = left.width ?? 0;
  const leftHeight = left.height ?? 0;
  const rightWidth = right.width ?? 0;
  const rightHeight = right.height ?? 0;

  return left.position.x < right.position.x + rightWidth
    && left.position.x + leftWidth > right.position.x
    && left.position.y < right.position.y + rightHeight
    && left.position.y + leftHeight > right.position.y;
}

describe('ModelRouteFlow layoutNodes', () => {
  it('keeps same-level route flow cards from overlapping when channel cards are tall', () => {
    const flow = buildFlow([
      node({ id: 'request', kind: 'request', label: 'gpt-test', status: 'active' }),
      node({
        id: 'candidate-a',
        kind: 'channel',
        label: 'very-long-upstream-channel-name-with-visible-health-history',
        subtitle: 'site 1 / account 2 / token 3 / route endpoint with detailed compiled graph label',
        status: 'selected',
        badges: ['terminal', 'model_endpoint', 'request model', 'P10', 'W100', 'healthy', 'recent', 'selected'],
        metrics: {
          successRate: 98.3,
          probability: 50,
          totalCalls: 120,
          avgLatencyMs: 345,
          consecutiveFailureCount: 0,
        },
        history: [
          { at: '2026-06-20T00:00:00.000Z', status: 'success' },
          { at: '2026-06-20T00:01:00.000Z', status: 'retried' },
          { at: '2026-06-20T00:02:00.000Z', status: 'failed' },
        ],
      }),
      node({
        id: 'candidate-b',
        kind: 'route_endpoint',
        label: 'another-generated-route-endpoint',
        subtitle: 'generated primitive endpoint',
        badges: ['generated', 'readonly', 'candidate'],
      }),
      node({
        id: 'candidate-c',
        kind: 'route_endpoint',
        label: 'third-generated-route-endpoint',
        subtitle: 'generated primitive endpoint',
        badges: ['generated', 'readonly', 'candidate'],
      }),
    ], [
      { id: 'request-a', source: 'request', target: 'candidate-a' },
      { id: 'request-b', source: 'request', target: 'candidate-b' },
      { id: 'request-c', source: 'request', target: 'candidate-c' },
    ]);

    const laidOutNodes = layoutNodes(flow);
    for (let leftIndex = 0; leftIndex < laidOutNodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < laidOutNodes.length; rightIndex += 1) {
        expect(
          overlaps(laidOutNodes[leftIndex], laidOutNodes[rightIndex]),
          `${laidOutNodes[leftIndex].id} overlaps ${laidOutNodes[rightIndex].id}`,
        ).toBe(false);
      }
    }
  });

  it('places graph-native supply candidates before the dispatcher even when candidate edges point into it', () => {
    const flow = buildFlow([
      node({ id: 'request', kind: 'request', label: 'gpt-test', status: 'active' }),
      node({ id: 'graph:entry', kind: 'entry', label: 'gpt-test', status: 'active' }),
      node({ id: 'graph:dispatcher', kind: 'dispatcher', label: 'selector', status: 'active' }),
      node({ id: 'graph:supply:a', kind: 'route_endpoint', label: 'supply-a', status: 'selected', badges: ['supply', '75%'] }),
    ], [
      { id: 'request-entry', source: 'request', target: 'graph:entry', label: 'matched' },
      { id: 'entry-dispatcher', source: 'graph:entry', target: 'graph:dispatcher', label: 'entry' },
      { id: 'graph-candidate-supply-a', source: 'graph:supply:a', target: 'graph:dispatcher', label: 'selected · 75%' },
    ]);

    const laidOutNodes = layoutNodes(flow);
    const supply = laidOutNodes.find((item) => item.id === 'graph:supply:a')!;
    const dispatcher = laidOutNodes.find((item) => item.id === 'graph:dispatcher')!;

    expect(supply.position.x).toBeLessThan(dispatcher.position.x);
    expect(laidOutNodes.some((item) => item.id.startsWith('channel:'))).toBe(false);
    for (let leftIndex = 0; leftIndex < laidOutNodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < laidOutNodes.length; rightIndex += 1) {
        expect(
          overlaps(laidOutNodes[leftIndex], laidOutNodes[rightIndex]),
          `${laidOutNodes[leftIndex].id} overlaps ${laidOutNodes[rightIndex].id}`,
        ).toBe(false);
      }
    }
  });
});
