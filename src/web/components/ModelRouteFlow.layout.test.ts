import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { create } from 'react-test-renderer';
import ModelRouteFlow from './ModelRouteFlow.js';
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
  it('keeps same-level route flow cards from overlapping when supply endpoint cards are tall', () => {
    const flow = buildFlow([
      node({ id: 'request', kind: 'request', label: 'gpt-test', status: 'active' }),
      node({
        id: 'candidate-a',
        kind: 'route_endpoint',
        label: 'very-long-upstream-supply-endpoint-name-with-visible-health-history',
        subtitle: 'site 1 / account 2 / token 3 / route endpoint with detailed compiled graph label',
        status: 'selected',
        badges: ['supply', 'route_endpoint', 'request model', 'P10', 'W100', 'healthy', 'recent', 'selected'],
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

  it('projects graph-native candidate inputs after the dispatcher for route-flow readability', () => {
    const flow = buildFlow([
      node({ id: 'request', kind: 'request', label: 'gpt-test', status: 'active' }),
      node({ id: 'graph:entry', kind: 'entry', label: 'gpt-test', status: 'active' }),
      node({ id: 'graph:dispatcher', kind: 'dispatcher', label: 'selector', status: 'active' }),
      node({ id: 'graph:supply:a', kind: 'route_endpoint', label: 'supply-a', status: 'selected', badges: ['supply', '75%'] }),
    ], [
      { id: 'request-entry', source: 'request', target: 'graph:entry', label: 'matched' },
      { id: 'entry-dispatcher', source: 'graph:entry', target: 'graph:dispatcher', label: 'entry' },
      { id: 'graph-candidate-supply-a', source: 'graph:supply:a', target: 'graph:dispatcher', label: '75%' },
    ]);

    const laidOutNodes = layoutNodes(flow);
    const supply = laidOutNodes.find((item) => item.id === 'graph:supply:a')!;
    const dispatcher = laidOutNodes.find((item) => item.id === 'graph:dispatcher')!;

    expect(supply.position.x).toBeGreaterThan(dispatcher.position.x);
    for (let leftIndex = 0; leftIndex < laidOutNodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < laidOutNodes.length; rightIndex += 1) {
        expect(
          overlaps(laidOutNodes[leftIndex], laidOutNodes[rightIndex]),
          `${laidOutNodes[leftIndex].id} overlaps ${laidOutNodes[rightIndex].id}`,
        ).toBe(false);
      }
    }
  });

  it('keeps distinct supply-target nodes when the backend emits multiple upstreams behind one supply endpoint', () => {
    const flow = buildFlow([
      node({ id: 'request', kind: 'request', label: 'multi-upstream-model', status: 'active' }),
      node({ id: 'graph:macro:auto-model:multi-upstream-model:entry', kind: 'entry', label: 'multi-upstream-model', status: 'active' }),
      node({ id: 'graph:macro:auto-model:multi-upstream-model:dispatcher', kind: 'dispatcher', label: 'dispatcher', status: 'active' }),
      node({ id: 'graph:route-endpoint:target-a', kind: 'route_endpoint', label: 'upstream-a / target a', status: 'available', badges: ['supply', 'supply-target', '25%'], metrics: { probability: 25 }, history: [] }),
      node({ id: 'graph:route-endpoint:target-b', kind: 'route_endpoint', label: 'upstream-b / target b', status: 'available', badges: ['supply', 'supply-target', '25%'], metrics: { probability: 25 }, history: [] }),
      node({ id: 'graph:route-endpoint:target-c', kind: 'route_endpoint', label: 'upstream-c / target c', status: 'available', badges: ['supply', 'supply-target', '25%'], metrics: { probability: 25 }, history: [] }),
      node({ id: 'graph:route-endpoint:target-d', kind: 'route_endpoint', label: 'upstream-d / target d', status: 'selected', badges: ['supply', 'supply-target', '25%'], metrics: { probability: 25 }, history: [] }),
    ], [
      { id: 'request-entry', source: 'request', target: 'graph:macro:auto-model:multi-upstream-model:entry', label: 'matched' },
      { id: 'entry-dispatcher', source: 'graph:macro:auto-model:multi-upstream-model:entry', target: 'graph:macro:auto-model:multi-upstream-model:dispatcher', label: 'entry' },
      { id: 'candidate-a', source: 'graph:route-endpoint:target-a', target: 'graph:macro:auto-model:multi-upstream-model:dispatcher', label: '25%' },
      { id: 'candidate-b', source: 'graph:route-endpoint:target-b', target: 'graph:macro:auto-model:multi-upstream-model:dispatcher', label: '25%' },
      { id: 'candidate-c', source: 'graph:route-endpoint:target-c', target: 'graph:macro:auto-model:multi-upstream-model:dispatcher', label: '25%' },
      { id: 'candidate-d', source: 'graph:route-endpoint:target-d', target: 'graph:macro:auto-model:multi-upstream-model:dispatcher', label: '25%' },
    ]);

    const laidOutNodes = layoutNodes(flow);
    const dispatcher = laidOutNodes.find((item) => item.id === 'graph:macro:auto-model:multi-upstream-model:dispatcher')!;
    const candidateNodes = laidOutNodes.filter((item) => item.id.startsWith('graph:route-endpoint:target-'));

    expect(candidateNodes).toHaveLength(4);
    expect(new Set(candidateNodes.map((item) => item.id)).size).toBe(4);
    expect(candidateNodes.every((item) => item.position.x > dispatcher.position.x)).toBe(true);
  });
});

describe('ModelRouteFlow compact mode', () => {
  it('renders as a narrow embedded summary instead of the full graph workspace', () => {
    const longName = 'provider-with-a-very-long-generated-route-endpoint-name/claude-sonnet-4-very-long-context-window-preview-20260623';
    const flow = buildFlow([
      node({ id: 'request', kind: 'request', label: 'very-long-request-model-name-that-should-not-force-horizontal-scroll', status: 'active' }),
      node({ id: 'graph:entry', kind: 'entry', label: 'very-long-request-model-name-that-should-not-force-horizontal-scroll', status: 'active' }),
      node({ id: 'graph:dispatcher', kind: 'dispatcher', label: 'weighted selector', status: 'active' }),
      node({
        id: 'graph:supply:selected',
        kind: 'route_endpoint',
        label: longName,
        subtitle: 'site-name-with-a-long-url.example.com / api-key-with-long-alias / upstream-model-name-with-extra-suffix',
        status: 'selected',
        metrics: {
          probability: 50,
          avgLatencyMs: 238,
          successRate: 99.2,
          totalCalls: 1234,
        },
      }),
      node({
        id: 'graph:supply:available',
        kind: 'route_endpoint',
        label: `${longName}-backup`,
        subtitle: 'backup endpoint with similarly long metadata',
        status: 'available',
        metrics: {
          probability: 50,
          avgLatencyMs: 411,
          successRate: 96.1,
          totalCalls: 88,
        },
      }),
    ], [
      { id: 'request-entry', source: 'request', target: 'graph:entry', label: 'matched' },
      { id: 'entry-dispatcher', source: 'graph:entry', target: 'graph:dispatcher', label: 'entry' },
      { id: 'candidate-selected', source: 'graph:supply:selected', target: 'graph:dispatcher', label: '50%' },
      { id: 'candidate-available', source: 'graph:supply:available', target: 'graph:dispatcher', label: '50%' },
    ]);

    flow.entryPricing = {
      theoretical: {
        inputPerMillion: 1.25,
        outputPerMillion: 10,
        totalCostUsd: 0.00042,
        inputMultiplier: 1,
        outputMultiplier: 1,
        totalMultiplier: 1,
        sourceCount: 2,
        estimateLevel: 'static_estimate',
        strategy: 'weighted',
        diagnostics: [],
        candidates: [],
      },
    };

    const rendered = create(createElement(ModelRouteFlow, { flow, compact: true }));
    const tree = rendered.root;

    expect(tree.findAllByProps({ className: 'react-flow' })).toHaveLength(0);
    expect(tree.findAll((item) => (
      typeof item.props.className === 'string'
      && item.props.className.includes('grid-cols-3')
    ))).toHaveLength(0);
    expect(tree.findAll((item) => (
      typeof item.props.className === 'string'
      && item.props.className.includes('w-full min-w-0 max-w-full overflow-hidden')
    )).length).toBeGreaterThan(0);

    rendered.unmount();
  });
});
