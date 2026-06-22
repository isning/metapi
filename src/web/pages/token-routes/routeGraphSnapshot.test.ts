import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/BrandIcon.js', () => ({
  getBrand: () => null,
  normalizeBrandIconKey: (icon: string) => icon.trim().toLowerCase(),
}));

import {
  buildRouteGraphSnapshot,
  buildCandidateSelectorMacro,
  routeGraphEditorFormToRoutePayload,
  routeGraphNodeToEditorForm,
  routeGraphNodeToRoutePayload,
  updateCandidateSelectorMacroFromEditor,
  validateRouteGraphNodeDraft,
  validateRouteGraphSnapshot,
} from './routeGraphSnapshot.js';
import type { RouteSummaryRow } from './types.js';

function buildRoute(overrides: Partial<RouteSummaryRow> = {}): RouteSummaryRow {
  return {
    id: 7,
    match: { kind: 'model', requestedModelPattern: 'gpt-4o', displayName: 'gpt-4o' },
    backend: { kind: 'channels' },
    presentation: { displayName: 'gpt-4o', displayIcon: null },
    modelMapping: null,
    routingStrategy: 'weighted',
    enabled: true,
    channelCount: 1,
    enabledChannelCount: 1,
    siteNames: ['openai'],
    decisionSnapshot: null,
    decisionRefreshedAt: null,
    ...overrides,
  };
}

describe('routeGraphSnapshot', () => {
  it('exports only manual routes from the current route list', () => {
    const snapshot = buildRouteGraphSnapshot([
      buildRoute({ id: 1, match: { kind: 'model', requestedModelPattern: 'gpt-4o', displayName: 'gpt-4o' } }),
      buildRoute({ id: 4, modelMapping: '{"public":"upstream"}' }),
      buildRoute({ id: 5, modelMapping: '[]' }),
      buildRoute({ id: 6, modelMapping: '{"public":42}' }),
      buildRoute({ id: 2, match: { kind: 'model', requestedModelPattern: 'missing-model', displayName: null }, kind: 'zero_channel', isVirtual: true }),
      buildRoute({ id: 3, match: { kind: 'model', requestedModelPattern: 'readonly-model', displayName: null }, readOnly: true }),
    ]);

    expect(snapshot.scope).toBe('whole_graph');
    expect(snapshot.nodes.map((node) => node.id)).toEqual([1, 4, 5, 6]);
    expect(snapshot.nodes[0]?.ownership).toBe('manual');
    expect(snapshot.nodes[1]?.modelMapping).toEqual({ public: 'upstream' });
    expect(snapshot.nodes[2]?.modelMapping).toBeNull();
    expect(snapshot.nodes[3]?.modelMapping).toBeNull();
  });

  it('rejects non-manual nodes during advanced editing/import', () => {
    const validation = validateRouteGraphNodeDraft({
      ownership: 'auto_generated',
      match: { requestedModelPattern: 'gpt-*' },
      backend: { kind: 'channels' },
    });

    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.message).toContain('只允许编辑 manual 节点');
    }
  });

  it('normalizes manual explicit group nodes into route payloads', () => {
    const validation = validateRouteGraphSnapshot({
      version: 1,
      exportedAt: '2026-06-15T00:00:00.000Z',
      scope: 'whole_graph',
      nodes: [
        {
          id: 12,
          ownership: 'manual',
          visibility: 'public',
          enabled: false,
          match: { kind: 'model', requestedModelPattern: '', displayName: 'public-model' },
          presentation: { displayName: 'public-model', displayIcon: 'openai' },
          backend: { kind: 'routes', routeIds: [2, 2, 3] },
          routingStrategy: 'round_robin',
          modelMapping: { 'public-model': 'upstream-model' },
        },
      ],
    });

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    expect(routeGraphNodeToRoutePayload(validation.snapshot.nodes[0]!)).toMatchObject({
      match: {
        kind: 'model',
        requestedModelPattern: '',
        displayName: 'public-model',
      },
      backend: {
        kind: 'routes',
        routeIds: [2, 3],
      },
      presentation: {
        displayName: 'public-model',
        displayIcon: 'openai',
      },
      enabled: false,
      routingStrategy: 'round_robin',
      modelMapping: '{"public-model":"upstream-model"}',
      macro: expect.objectContaining({
        kind: 'candidate_selector',
      }),
    });
  });

  it('exports explicit groups as Model Group candidate_selector macros', () => {
    const snapshot = buildRouteGraphSnapshot([
      buildRoute({
        id: 12,
        match: { kind: 'model', requestedModelPattern: '', displayName: 'public-model' },
        backend: { kind: 'routes', routeIds: [2, 3] },
        presentation: { displayName: 'public-model', displayIcon: 'openai' },
        routingStrategy: 'stable_first',
        visibility: 'internal',
      }),
    ]);

    expect(snapshot.nodes[0]?.macro).toEqual(expect.objectContaining({
      kind: 'candidate_selector',
      config: expect.objectContaining({
        surface: expect.objectContaining({
          entry: expect.objectContaining({
            kind: 'external',
            visibility: 'internal',
            match: expect.objectContaining({ displayName: 'public-model' }),
          }),
          output: 'route',
        }),
        policy: { strategy: 'stable_first' },
      }),
    }));
    expect(snapshot.nodes[0]?.macro?.config.groups.map((group) => group.input.endpointIds)).toEqual([
      ['route-endpoint:product:route:2'],
      ['route-endpoint:product:route:3'],
    ]);
    expect(snapshot.nodes[0]?.visibility).toBe('internal');
    expect(snapshot.nodes[0]?.macro?.visibility).toBe('internal');
  });

  it('imports Model Group macros and projects them to route payloads', () => {
    const validation = validateRouteGraphNodeDraft({
      id: 12,
      ownership: 'manual',
      visibility: 'public',
      enabled: true,
      match: { kind: 'model', requestedModelPattern: '', displayName: 'ignored-old-name' },
      presentation: { displayName: 'ignored-old-name', displayIcon: null },
      backend: { kind: 'routes', routeIds: [] },
      macro: {
        id: 'route:12:model-group',
        kind: 'candidate_selector',
        enabled: true,
        visibility: 'public',
        ownership: 'manual',
        config: {
          surface: {
            entry: {
              kind: 'external',
              visibility: 'public',
              match: { kind: 'model', requestedModelPattern: '', displayName: 'public-model' },
            },
            output: 'route',
          },
          policy: { strategy: 'round_robin' },
          groups: [
            { id: 'source:3', enabled: true, priority: 1, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:3'] } },
            { id: 'source:2', enabled: true, priority: 0, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:2'] } },
          ],
          presentation: { displayIcon: 'openai' },
        },
      },
    });

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(routeGraphNodeToRoutePayload(validation.node)).toMatchObject({
      match: { requestedModelPattern: '', displayName: 'public-model' },
      backend: { kind: 'routes', routeIds: [2, 3] },
      presentation: { displayName: 'public-model', displayIcon: 'openai' },
      routingStrategy: 'round_robin',
    });
  });

  it('builds Model Group route payloads from editor form with ordered macro groups', () => {
    const payload = routeGraphEditorFormToRoutePayload({
      match: { kind: 'model', requestedModelPattern: '', displayName: 'public-model' },
      backend: { kind: 'routes', routeIds: [5, 3, 8] },
      presentation: { displayName: 'public-model', displayIcon: 'openai' },
      routingStrategy: 'stable_first',
      enabled: true,
      visibility: 'public',
      modelMapping: '',
      advancedOpen: false,
      macro: buildCandidateSelectorMacro({
        displayName: 'public-model',
        displayIcon: 'openai',
        visibility: 'public',
        enabled: true,
        routingStrategy: 'stable_first',
        routeIds: [5, 3, 8],
      }),
    });

    expect(payload).toMatchObject({
      backend: { kind: 'routes', routeIds: [5, 3, 8] },
      presentation: {
        displayName: 'public-model',
        displayIcon: 'openai',
      },
      routingStrategy: 'stable_first',
      macro: expect.objectContaining({
        kind: 'candidate_selector',
        config: expect.objectContaining({
          policy: { strategy: 'stable_first' },
          presentation: { displayIcon: 'openai' },
          groups: [
            expect.objectContaining({ priority: 0, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:5'] } }),
            expect.objectContaining({ priority: 1, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:3'] } }),
            expect.objectContaining({ priority: 2, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:8'] } }),
          ],
        }),
      }),
    });
  });

  it('builds channel route payloads from editor form without macro data', () => {
    const payload = routeGraphEditorFormToRoutePayload({
      match: { kind: 'model', requestedModelPattern: 'gpt-*', displayName: 'GPT wildcard' },
      backend: { kind: 'channels' },
      presentation: { displayName: ' ', displayIcon: ' anthropic ' },
      routingStrategy: 'round_robin',
      enabled: false,
      visibility: 'public',
      modelMapping: '{"gpt-4o":"upstream"}',
      advancedOpen: true,
      macro: buildCandidateSelectorMacro({
        displayName: 'ignored-group',
        displayIcon: 'openai',
        visibility: 'public',
        enabled: true,
        routingStrategy: 'stable_first',
        routeIds: [1],
      }),
    });

    expect(payload).toMatchObject({
      match: {
        kind: 'model',
        requestedModelPattern: 'gpt-*',
        displayName: 'GPT wildcard',
      },
      backend: { kind: 'channels' },
      macro: undefined,
      presentation: {
        displayName: 'GPT wildcard',
        displayIcon: 'anthropic',
      },
      routingStrategy: 'round_robin',
      enabled: false,
      modelMapping: '{"gpt-4o":"upstream"}',
    });
  });

  it('updates Model Group macros without dropping existing group defaults or metadata', () => {
    const macro = updateCandidateSelectorMacroFromEditor({
      macro: {
        ...buildCandidateSelectorMacro({
          displayName: 'old-name',
          displayIcon: 'openai',
          visibility: 'public',
          enabled: true,
          routingStrategy: 'weighted',
          routeIds: [5, 3],
        }),
        config: {
          ...buildCandidateSelectorMacro({
            displayName: 'old-name',
            displayIcon: 'openai',
            visibility: 'public',
            enabled: true,
            routingStrategy: 'weighted',
            routeIds: [5, 3],
          }).config,
          groups: [
            {
              id: 'source:5',
              label: 'fast lane',
              enabled: true,
              priority: 0,
              input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:5'] },
              defaults: { enabled: true, weight: 99, priority: 0 },
            },
            {
              id: 'source:3',
              label: 'cheap lane',
              enabled: true,
              priority: 1,
              input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:3'] },
              defaults: { enabled: true, weight: 12, priority: 1 },
            },
          ],
        },
      },
      displayName: 'public-model',
      displayIcon: 'anthropic',
      visibility: 'public',
      enabled: false,
      routingStrategy: 'round_robin',
      routeIds: [3, 5],
    });

    expect(macro.enabled).toBe(false);
    expect(macro.config.surface.entry.match.displayName).toBe('public-model');
    expect(macro.config.policy.strategy).toBe('round_robin');
    expect(macro.config.presentation?.displayIcon).toBe('anthropic');
    expect(macro.config.groups.map((group) => group.input.endpointIds[0])).toEqual([
      'route-endpoint:product:route:3',
      'route-endpoint:product:route:5',
    ]);
    expect(macro.config.groups.map((group) => group.defaults.weight)).toEqual([12, 99]);
    expect(macro.config.groups.map((group) => group.priority)).toEqual([0, 1]);
  });

  it('omits disabled macro groups from generated route backend payloads', () => {
    const validation = validateRouteGraphNodeDraft({
      id: 12,
      ownership: 'manual',
      visibility: 'public',
      enabled: true,
      match: { kind: 'model', requestedModelPattern: '', displayName: 'public-model' },
      presentation: { displayName: 'public-model', displayIcon: null },
      backend: { kind: 'routes', routeIds: [1, 2, 3] },
      macro: {
        id: 'route:12:model-group',
        kind: 'candidate_selector',
        enabled: true,
        visibility: 'public',
        ownership: 'manual',
        config: {
          surface: {
            entry: {
              kind: 'external',
              visibility: 'public',
              match: { kind: 'model', requestedModelPattern: '', displayName: 'public-model' },
            },
            output: 'route',
          },
          policy: { strategy: 'priority_order' },
          groups: [
            { id: 'source:1', enabled: true, priority: 0, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:1'] } },
            { id: 'source:2', enabled: false, priority: 1, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:2'] } },
            { id: 'source:3', enabled: true, priority: 2, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:3'] } },
          ],
        },
      },
    });

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    expect(routeGraphNodeToRoutePayload(validation.node)).toMatchObject({
      backend: { kind: 'routes', routeIds: [1, 3] },
      macro: expect.objectContaining({
        config: expect.objectContaining({
          groups: [
            expect.objectContaining({ id: 'source:1', enabled: true }),
            expect.objectContaining({ id: 'source:2', enabled: false }),
            expect.objectContaining({ id: 'source:3', enabled: true }),
          ],
        }),
      }),
    });
  });

  it('validates imported snapshots with indexed node errors and normalized defaults', () => {
    expect(validateRouteGraphSnapshot(null)).toEqual({
      ok: false,
      message: '导入内容必须是对象',
    });
    expect(validateRouteGraphSnapshot({ version: 2, nodes: [] })).toEqual({
      ok: false,
      message: '仅支持 version=1 的 RouteGraphSnapshot',
    });
    expect(validateRouteGraphSnapshot({ version: 1, nodes: [{}] })).toEqual({
      ok: false,
      message: 'nodes[0]: pattern 节点必须提供 match.requestedModelPattern',
    });

    const valid = validateRouteGraphSnapshot({
      version: 1,
      exportedAt: '',
      scope: 'selected_node',
      nodes: [
        {
          ownership: 'manual',
          visibility: 'internal',
          enabled: false,
          match: { requestedModelPattern: 'gpt-*', displayName: 'GPT' },
          presentation: { displayName: 'GPT', displayIcon: ' OpenAI ' },
          backend: { kind: 'channels' },
          routingStrategy: 'round_robin',
          modelMapping: {
            ' public ': ' upstream ',
            empty: '',
            ignored: 1,
          },
        },
      ],
    });

    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.snapshot.scope).toBe('selected_node');
    expect(valid.snapshot.exportedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(valid.snapshot.nodes[0]).toMatchObject({
      visibility: 'internal',
      enabled: false,
      backend: { kind: 'channels' },
      routingStrategy: 'round_robin',
      modelMapping: { public: 'upstream' },
    });
  });

  it('roundtrips editor form values without leaking disabled macro groups into backend routeIds', () => {
    const validation = validateRouteGraphNodeDraft({
      ownership: 'manual',
      visibility: 'public',
      enabled: true,
      match: { requestedModelPattern: '', displayName: 'public-model' },
      presentation: { displayName: 'public-model', displayIcon: 'anthropic' },
      backend: { kind: 'routes', routeIds: [1, 2, 3] },
      modelMapping: { public: 'upstream' },
      macro: {
        id: 'model-group:public-model',
        kind: 'candidate_selector',
        enabled: true,
        visibility: 'public',
        ownership: 'manual',
        config: {
          surface: {
            entry: {
              kind: 'external',
              visibility: 'public',
              match: { displayName: 'public-model' },
            },
            output: 'route',
          },
          policy: { strategy: 'stable_first' },
          groups: [
            { id: 'p0', enabled: true, priority: 0, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:2'] } },
            { id: 'p1', enabled: false, priority: 1, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:1'] } },
            { id: 'p2', enabled: true, priority: 2, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:3'] } },
          ],
          presentation: { displayIcon: 'anthropic' },
        },
      },
    });

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    expect(routeGraphNodeToEditorForm(validation.node)).toMatchObject({
      match: { requestedModelPattern: '', displayName: 'public-model' },
      backend: { kind: 'routes', routeIds: [2, 3] },
      presentation: { displayName: 'public-model', displayIcon: 'anthropic' },
      routingStrategy: 'stable_first',
      modelMapping: '{"public":"upstream"}',
      advancedOpen: false,
    });
    expect(routeGraphNodeToRoutePayload(validation.node)).toMatchObject({
      backend: { kind: 'routes', routeIds: [2, 3] },
      modelMapping: '{"public":"upstream"}',
      routingStrategy: 'stable_first',
    });
  });

  it('converts plain channel nodes to route payloads and editor forms', () => {
    const validation = validateRouteGraphNodeDraft({
      id: 21,
      stableId: 'route:21',
      ownership: 'manual',
      visibility: 'public',
      enabled: true,
      match: { requestedModelPattern: 're:^gpt-.*', displayName: 'GPT regex' },
      presentation: { displayName: 'GPT regex', displayIcon: ' openai ' },
      backend: { kind: 'channels' },
      routingStrategy: 'stable_first',
      modelMapping: { 'gpt-4o': 'upstream-gpt-4o' },
    });

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    expect(routeGraphNodeToRoutePayload(validation.node)).toMatchObject({
      match: {
        kind: 'model',
        requestedModelPattern: 're:^gpt-.*',
        displayName: 'GPT regex',
      },
      backend: { kind: 'channels' },
      presentation: {
        displayName: 'GPT regex',
        displayIcon: 'openai',
      },
      routingStrategy: 'stable_first',
      modelMapping: '{"gpt-4o":"upstream-gpt-4o"}',
    });
    expect(routeGraphNodeToEditorForm(validation.node)).toMatchObject({
      match: {
        requestedModelPattern: 're:^gpt-.*',
        displayName: 'GPT regex',
      },
      backend: { kind: 'channels' },
      advancedOpen: true,
      modelMapping: '{"gpt-4o":"upstream-gpt-4o"}',
    });
  });
});
