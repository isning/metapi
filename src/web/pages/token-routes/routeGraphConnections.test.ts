import { describe, expect, it } from 'vitest';

import { validateRouteGraphConnection } from './routeGraphConnections.js';
import type { RouteGraphConnectionGraph } from './routeGraphConnections.js';

function graph(overrides: Partial<RouteGraphConnectionGraph> = {}): RouteGraphConnectionGraph {
  return {
    nodes: [],
    edges: [],
    macros: [],
    ...overrides,
  };
}

describe('routeGraphConnections', () => {
  it('requires both endpoint ids and concrete port handles', () => {
    expect(validateRouteGraphConnection(graph(), {
      source: 'entry.a',
      sourceHandle: 'bidirect.out',
      target: 'dispatcher.a',
      targetHandle: null,
    })).toMatchObject({
      ok: false,
      message: '连接必须从具体接口连接到具体接口',
    });

    expect(validateRouteGraphConnection(graph({
      nodes: [
        {
          id: 'entry.a',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'a' },
        },
      ],
    }), {
      source: 'entry.a',
      sourceHandle: 'bidirect.out',
      target: 'dispatcher.missing',
      targetHandle: 'bidirect.in',
    })).toMatchObject({
      ok: false,
      message: '节点不存在',
    });
  });

  it('allows macro outputs to be reused while keeping macro inputs guarded', () => {
    const sourceGraph = graph({
      nodes: [
        {
          id: 'dispatcher.public',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'entry.public',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'macro-model' },
        },
      ],
      macros: [
        {
          id: 'macro:model-group',
          kind: 'candidate_selector',
          enabled: true,
          visibility: 'public',
          ownership: 'auto_generated',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: { displayName: 'macro-model' },
              },
              output: 'route',
            },
            policy: { strategy: 'weighted' },
            groups: [],
          },
        },
      ],
    });

    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'macro:macro:model-group',
      sourceHandle: 'route.out',
      target: 'dispatcher.public',
      targetHandle: 'route.in',
    })).toMatchObject({ ok: true });

    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'entry.public',
      sourceHandle: 'bidirect.out',
      target: 'macro:macro:model-group',
      targetHandle: 'bidirect.in',
    })).toMatchObject({
      ok: false,
      message: '自动路由组只允许从输出接口复用',
    });
  });

  it('rejects disabled ports, wrong directions, and incompatible kinds', () => {
    const sourceGraph = graph({
      nodes: [
        {
          id: 'dispatcher.route',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'dispatcher.flow',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'flow',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'filter.disabled',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.out', label: 'disabled out', direction: 'output', kind: 'request', enabled: false },
          ],
        },
        {
          id: 'filter.enabled',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          operations: [],
        },
      ],
      edges: [],
    });

    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'dispatcher.route',
      sourceHandle: 'bidirect[1...].out',
      target: 'dispatcher.flow',
      targetHandle: 'route.in',
    })).toMatchObject({
      ok: false,
      message: '禁用接口不能连接',
    });

    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'filter.enabled',
      sourceHandle: 'request.in',
      target: 'dispatcher.route',
      targetHandle: 'bidirect.in',
    })).toMatchObject({
      ok: false,
      message: '起点必须是输出接口',
    });

    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'dispatcher.flow',
      sourceHandle: 'bidirect[1...].out',
      target: 'dispatcher.route',
      targetHandle: 'route.in',
    })).toMatchObject({
      ok: false,
      message: 'bidirect 不能连接到 route',
    });
  });

  it('rejects duplicate edges and cycles', () => {
    const sourceGraph = graph({
      nodes: [
        {
          id: 'entry.a',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'a' },
        },
        {
          id: 'dispatcher.a',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'flow',
          policy: { strategy: 'weighted' },
        },
      ],
      edges: [
        {
          id: 'edge:a',
          sourceNodeId: 'entry.a',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'dispatcher.a',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
      ],
    });

    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'entry.a',
      sourceHandle: 'bidirect.out',
      target: 'dispatcher.a',
      targetHandle: 'bidirect.in',
    })).toMatchObject({
      ok: false,
      message: '重复连接',
    });

    expect(validateRouteGraphConnection(graph({
      nodes: [
        {
          id: 'entry.a',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'a' },
        },
        {
          id: 'filter.b',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          operations: [],
        },
      ],
      edges: [
        {
          id: 'edge:b',
          sourceNodeId: 'filter.b',
          sourcePortId: 'bidirect.out',
          targetNodeId: 'entry.a',
          targetPortId: 'bidirect.in',
          kind: 'bidirect_flow',
          ownership: 'manual',
        },
      ],
    }), {
      source: 'entry.a',
      sourceHandle: 'bidirect.out',
      target: 'filter.b',
      targetHandle: 'bidirect.in',
    })).toMatchObject({
      ok: false,
      message: '不能创建环路',
    });
  });

  it('rejects new outgoing connections from non-manual primitive nodes while allowing manual targets', () => {
    const sourceGraph = graph({
      nodes: [
        {
          id: 'endpoint.derived',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'derived',
          config: {
            targets: [{ targetId: 'derived', model: 'derived-model' }],
            targetSelection: { strategy: 'weighted' },
          },
        },
        {
          id: 'dispatcher.manual',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'flow',
          policy: { strategy: 'weighted' },
        },
      ],
    });

    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'endpoint.derived',
      sourceHandle: 'route.out',
      target: 'dispatcher.manual',
      targetHandle: 'route.in',
    })).toMatchObject({
      ok: false,
      message: '只有手动节点可以新增出边',
    });

    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'dispatcher.manual',
      sourceHandle: 'bidirect[1...].out',
      target: 'endpoint.derived',
      targetHandle: 'bidirect.in',
    })).toMatchObject({
      ok: true,
      kind: 'bidirect_flow',
    });
  });

  it('rejects non-manual macro input editing while still allowing output reuse', () => {
    const sourceGraph = graph({
      nodes: [
        {
          id: 'entry.manual',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'manual' },
        },
        {
          id: 'dispatcher.manual',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
      ],
      macros: [
        {
          id: 'auto-group',
          kind: 'candidate_selector',
          enabled: true,
          visibility: 'public',
          ownership: 'auto_generated',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: { displayName: 'auto-group' },
              },
              output: 'route',
            },
            policy: { strategy: 'weighted' },
            groups: [],
          },
        },
      ],
    });

    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'macro:auto-group',
      sourceHandle: 'bidirect.in',
      target: 'dispatcher.manual',
      targetHandle: 'bidirect.in',
    })).toMatchObject({
      ok: false,
      message: '自动路由组只允许从输出接口复用',
    });

    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'macro:auto-group',
      sourceHandle: 'route.out',
      target: 'dispatcher.manual',
      targetHandle: 'route.in',
    })).toMatchObject({
      ok: true,
      kind: 'route_flow',
    });
  });

  it('rejects a second connection to an explicitly single input port', () => {
    const sourceGraph = graph({
      nodes: [
        {
          id: 'source.a',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.out', label: 'request out', direction: 'output', kind: 'request' },
          ],
        },
        {
          id: 'source.b',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.out', label: 'request out', direction: 'output', kind: 'request' },
          ],
        },
        {
          id: 'target.single',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.in', label: 'request in', direction: 'input', kind: 'request', multiple: false },
          ],
        },
      ],
      edges: [
        {
          id: 'existing',
          sourceNodeId: 'source.a',
          sourcePortId: 'request.out',
          targetNodeId: 'target.single',
          targetPortId: 'request.in',
          kind: 'request_flow',
          ownership: 'manual',
        },
      ],
    });

    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'source.b',
      sourceHandle: 'request.out',
      target: 'target.single',
      targetHandle: 'request.in',
    })).toMatchObject({
      ok: false,
      message: '该输入接口已连接',
    });
  });

  it('rejects connections beyond collection max on set and arr input ports', () => {
    const sourceGraph = graph({
      nodes: [
        {
          id: 'source.a',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.out', label: 'request out', direction: 'output', kind: 'request' },
          ],
        },
        {
          id: 'source.b',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.out', label: 'request out', direction: 'output', kind: 'request' },
          ],
        },
        {
          id: 'target.set',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.in', label: 'request in', direction: 'input', kind: 'request', collection: { type: 'set', max: 1 } },
          ],
        },
        {
          id: 'target.arr',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.in', label: 'request in', direction: 'input', kind: 'request', collection: { type: 'arr', max: 1 } },
          ],
        },
      ],
      edges: [
        {
          id: 'existing:set',
          sourceNodeId: 'source.a',
          sourcePortId: 'request.out',
          targetNodeId: 'target.set',
          targetPortId: 'request.in',
          kind: 'request_flow',
          ownership: 'manual',
        },
        {
          id: 'existing:arr',
          sourceNodeId: 'source.a',
          sourcePortId: 'request.out',
          targetNodeId: 'target.arr',
          targetPortId: 'request.in',
          kind: 'request_flow',
          ownership: 'manual',
        },
      ],
    });

    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'source.b',
      sourceHandle: 'request.out',
      target: 'target.set',
      targetHandle: 'request.in',
    })).toMatchObject({
      ok: false,
      message: '该输入接口最多允许 1 条连接',
    });

    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'source.b',
      sourceHandle: 'request.out',
      target: 'target.arr',
      targetHandle: 'request.in',
    })).toMatchObject({
      ok: false,
      message: '该输入接口最多允许 1 条连接',
    });
  });

  it('maps supported output port kinds to matching edge kinds', () => {
    const sourceGraph = graph({
      nodes: [
        {
          id: 'source',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          dynamicPorts: [
            { id: 'bidirect.out', label: 'bidirect out', direction: 'output', kind: 'bidirect' },
            { id: 'route.out', label: 'route out', direction: 'output', kind: 'route' },
            { id: 'request.out', label: 'request out', direction: 'output', kind: 'request' },
          ],
        },
        {
          id: 'target',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          dynamicPorts: [
            { id: 'bidirect.in', label: 'bidirect in', direction: 'input', kind: 'bidirect' },
            { id: 'route.in', label: 'route in', direction: 'input', kind: 'route' },
            { id: 'request.in', label: 'request in', direction: 'input', kind: 'request' },
          ],
        },
      ],
    });

    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'source',
      sourceHandle: 'request.out',
      target: 'target',
      targetHandle: 'request.in',
    })).toEqual({ ok: true, kind: 'request_flow' });
    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'source',
      sourceHandle: 'bidirect.out',
      target: 'target',
      targetHandle: 'bidirect.in',
    })).toEqual({ ok: true, kind: 'bidirect_flow' });
    expect(validateRouteGraphConnection(sourceGraph, {
      source: 'source',
      sourceHandle: 'route.out',
      target: 'target',
      targetHandle: 'route.in',
    })).toEqual({ ok: true, kind: 'route_flow' });
  });
});
