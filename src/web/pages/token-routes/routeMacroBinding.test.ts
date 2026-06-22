import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/BrandIcon.js', () => ({
  getBrand: () => null,
  normalizeBrandIconKey: (icon: string) => icon.trim().toLowerCase(),
}));

import {
  getRouteIdsReferencedByRouteMacro,
  resolveRouteMacroBinding,
} from './routeMacroBinding.js';
import type { RouteSummaryRow } from './types.js';
import type { RouteGraphMacro, RouteGraphNode } from './routeGraphTypes.js';

function route(overrides: Partial<RouteSummaryRow> = {}): RouteSummaryRow {
  return {
    id: 77,
    match: { kind: 'model', requestedModelPattern: 'gpt-auto-native', displayName: 'gpt-auto-native' },
    backend: { kind: 'channels' },
    presentation: { displayName: 'gpt-auto-native', displayIcon: null },
    modelMapping: null,
    routingStrategy: 'weighted',
    visibility: 'public',
    enabled: true,
    channelCount: 1,
    enabledChannelCount: 1,
    siteNames: ['openai'],
    decisionSnapshot: null,
    decisionRefreshedAt: null,
    ...overrides,
  };
}

function macro(overrides: Partial<RouteGraphMacro> = {}): RouteGraphMacro {
  return {
    id: 'auto-model:gpt-auto-native',
    kind: 'candidate_selector',
    enabled: true,
    visibility: 'public',
    ownership: 'auto_generated',
    name: 'gpt-auto-native',
    config: {
      surface: {
        entry: {
          kind: 'external',
          visibility: 'public',
          match: {
            kind: 'model',
            requestedModelPattern: 'gpt-auto-native',
            displayName: 'gpt-auto-native',
            routeId: 77,
          },
        },
        output: 'route',
      },
      policy: { strategy: 'weighted' },
      groups: [
        {
          id: 'source:77',
          enabled: true,
          priority: 0,
          input: {
            kind: 'route_endpoints',
            endpointIds: ['route-endpoint:supply:upstream-model:openai:credential:gpt-auto-native:abc12345'],
          },
        },
      ],
    },
    ...overrides,
  };
}

function endpointNode(overrides: Partial<RouteGraphNode> = {}): RouteGraphNode {
  return {
    id: 'route-endpoint:supply:upstream-model:openai:credential:gpt-auto-native:abc12345',
    type: 'route_endpoint',
    enabled: true,
    visibility: 'internal',
    ownership: 'auto_generated',
    endpointId: 'route-endpoint:supply:upstream-model:openai:credential:gpt-auto-native:abc12345',
    routeId: 77,
    backend: { kind: 'channels' },
    ...overrides,
  };
}

describe('routeMacroBinding', () => {
  it('binds automatic exact route groups to their native candidate_selector macro', () => {
    const automaticMacro = macro();

    expect(resolveRouteMacroBinding(
      route(),
      { nodes: [endpointNode()], macros: [automaticMacro] },
      null,
    )).toBe(automaticMacro);
  });

  it('resolves route ids through stable semantic route_endpoint ids', () => {
    const automaticMacro = macro({
      config: {
        ...macro().config,
        surface: {
          entry: {
            kind: 'external',
            visibility: 'public',
            match: {
              kind: 'model',
              requestedModelPattern: 'gpt-auto-native',
              displayName: 'gpt-auto-native',
            },
          },
          output: 'route',
        },
      },
    });

    expect(getRouteIdsReferencedByRouteMacro(
      automaticMacro,
      { nodes: [endpointNode()], macros: [automaticMacro] },
    )).toEqual([77]);
  });

  it('prefers the route model matching auto macro when another macro references the same upstream route', () => {
    const manualAlias = macro({
      id: 'route:123:model-group',
      ownership: 'manual',
      name: 'manual-alias',
      config: {
        ...macro().config,
        surface: {
          entry: {
            kind: 'external',
            visibility: 'public',
            match: {
              kind: 'model',
              requestedModelPattern: '',
              displayName: 'manual-alias',
            },
          },
          output: 'route',
        },
      },
    });
    const automaticMacro = macro({
      config: {
        ...macro().config,
        surface: {
          entry: {
            kind: 'external',
            visibility: 'public',
            match: {
              kind: 'model',
              requestedModelPattern: 'gpt-auto-native',
              displayName: 'gpt-auto-native',
            },
          },
          output: 'route',
        },
      },
    });

    expect(resolveRouteMacroBinding(
      route(),
      { nodes: [endpointNode()], macros: [manualAlias, automaticMacro] },
      null,
    )).toBe(automaticMacro);
  });
});
