import { describe, expect, it } from 'vitest';
import {
  buildRouteGraphSourceFromLegacyRoutes,
  compileRouteGraphSource,
  findRouteGraphEntryForModel,
  getRouteGraphMacroPorts,
  getRouteGraphMacroPort,
  getRouteGraphNodePorts,
  normalizeRouteGraphSource,
} from './routeGraph.js';

describe('routeGraph port-native source', () => {
  it('normalizes route graph sources with unique edge ids', () => {
    const source = normalizeRouteGraphSource({
      version: 1,
      nodes: [],
      macros: [],
      edges: [
        { id: 'edge:duplicate', sourceNodeId: 'a', sourcePortId: 'route.out', targetNodeId: 'b', targetPortId: 'route.in', kind: 'route_flow' },
        { id: 'edge:duplicate', sourceNodeId: 'a', sourcePortId: 'route.out', targetNodeId: 'b', targetPortId: 'route.in', kind: 'route_flow' },
      ],
    });

    expect(source.edges).toHaveLength(1);
  });

  it('builds direct legacy routes as entry-dispatcher graphs', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
        {
          id: 11,
          enabled: true,
          displayName: null,
          match: {
            kind: 'model',
            requestedModelPattern: 'gpt-4o',
            displayName: null,
            routeId: 11,
          },
          backend: { kind: 'supply' },
          targets: [{ targetId: '11', model: 'gpt-4o', accountId: 1, tokenId: 1, weight: 10 }],
        },
    ]);

    expect(source.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'entry:legacy:11', type: 'entry' }),
      expect.objectContaining({ id: 'dispatcher:legacy:11', type: 'dispatcher', mode: 'route' }),
      expect.objectContaining({ id: 'route-endpoint:product:route:11', type: 'route_endpoint', endpointKind: 'route_product' }),
    ]));
    expect(source.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: 'entry:legacy:11', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:legacy:11', targetPortId: 'bidirect.in', kind: 'bidirect_flow' }),
      expect.objectContaining({ sourceNodeId: 'route-endpoint:supply:route:11', sourcePortId: 'route.out', targetNodeId: 'dispatcher:legacy:11', targetPortId: 'route.in', kind: 'route_flow' }),
    ]));
    expect(compileRouteGraphSource(source).ok).toBe(true);
    const compiled = compileRouteGraphSource(source);
    expect(compiled.compiled.programBundle).toMatchObject({
      version: 1,
      matcher: {
        exact: {
          'gpt-4o': expect.objectContaining({
            programId: 'program:entry:legacy:11',
            entryNodeId: 'entry:legacy:11',
            publicModelName: 'gpt-4o',
            rootEndpointId: 'route-endpoint:product:route:11',
          }),
        },
        normalizedExact: {
          'gpt-4o': expect.objectContaining({
            programId: 'program:entry:legacy:11',
          }),
        },
      },
      endpointCatalog: {
        productToProgram: {
          'route-endpoint:product:route:11': 'program:entry:legacy:11',
        },
        byId: {
          'route-endpoint:product:route:11': expect.objectContaining({
            endpointKind: 'route_product',
            exposure: 'public',
            routeId: 11,
          }),
        },
      },
    });
    expect(compiled.compiled.flatProgramBundle).toMatchObject({
      version: 1,
      matcher: {
        exact: {
          'gpt-4o': expect.objectContaining({
            programId: 'program:entry:legacy:11',
            entryNodeId: 'entry:legacy:11',
            publicModelName: 'gpt-4o',
            rootEndpointId: 'route-endpoint:product:route:11',
          }),
        },
      },
      programs: [
        expect.objectContaining({
          id: 'program:entry:legacy:11',
          start: expect.objectContaining({
            kind: 'dispatch',
            dispatch: expect.objectContaining({
              nodeId: 'dispatcher:legacy:11',
              candidates: [
                expect.objectContaining({
                  endpointId: 'route-endpoint:supply:route:11',
                  terminalKind: 'supply',
                  targetCount: 1,
                  next: expect.objectContaining({
                    kind: 'terminal',
                    terminal: expect.objectContaining({
                      kind: 'supply',
                      endpointId: 'route-endpoint:supply:route:11',
                      routeId: 11,
                      targets: [
                        expect.objectContaining({
                          endpointId: 'route-endpoint:supply:route:11',
                          routeId: 11,
                          model: 'gpt-4o',
                        }),
                      ],
                    }),
                  }),
                }),
              ],
            }),
          }),
        }),
      ],
    });
    expect(compiled.compiled.programBundle.programs).toEqual([
      expect.objectContaining({
        id: 'program:entry:legacy:11',
        entryNodeId: 'entry:legacy:11',
        publicModelName: 'gpt-4o',
        rootEndpointId: 'route-endpoint:product:route:11',
        startOpId: 'program:entry:legacy:11:op:dispatcher:legacy:11:dispatch-route',
        ops: expect.arrayContaining([
          expect.objectContaining({
            id: 'program:entry:legacy:11:op:dispatcher:legacy:11:dispatch-route',
            op: 'dispatch',
            mode: 'route',
            nodeId: 'dispatcher:legacy:11',
            candidates: [
              expect.objectContaining({
                nodeId: 'route-endpoint:supply:route:11',
                endpointId: 'route-endpoint:supply:route:11',
                targetOpId: 'program:entry:legacy:11:op:route-endpoint:supply:route:11:select-supply',
              }),
            ],
          }),
          expect.objectContaining({
            id: 'program:entry:legacy:11:op:route-endpoint:supply:route:11:select-supply',
            op: 'select_supply',
            endpointId: 'route-endpoint:supply:route:11',
            nodeId: 'route-endpoint:supply:route:11',
            routeId: 11,
          }),
        ]),
      }),
    ]);
  });

  it('builds legacy route groups as Model Group macros without route_ref nodes', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
        {
          id: 11,
          enabled: true,
          displayName: null,
          match: { kind: 'model', requestedModelPattern: 'source-model', displayName: null, routeId: 11 },
          backend: { kind: 'supply' },
          targets: [{ targetId: '11', model: 'source-model', accountId: 1, tokenId: 1, weight: 10 }],
        },
      {
        id: 21,
        enabled: true,
        displayName: 'public-group',
        match: { kind: 'model', requestedModelPattern: '', displayName: 'public-group', routeId: 21 },
        backend: { kind: 'routes', routeIds: [11] },
      },
    ]);

    expect(source.nodes.some((node) => node.type === 'route_ref')).toBe(false);
    expect(source.macros).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'route:21:model-group',
        kind: 'candidate_selector',
        config: expect.objectContaining({
          groups: [
            expect.objectContaining({
              input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:route:11'] },
            }),
          ],
        }),
      }),
    ]));
    const result = compileRouteGraphSource(source);
    expect(result.ok).toBe(true);
    expect(result.primitiveSource.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'macro:route:21:model-group:dispatcher', type: 'dispatcher', mode: 'route', ownership: 'derived' }),
      expect.objectContaining({ id: 'route-endpoint:product:route:11', type: 'route_endpoint', endpointKind: 'route_product' }),
    ]));
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: 'route-endpoint:supply:route:11', sourcePortId: 'route.out', targetNodeId: 'macro:route:21:model-group:dispatcher', targetPortId: 'route.in', kind: 'route_flow' }),
    ]));
  });

  it('groups automatic exact-model supplies behind one public route product per canonical model', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 11,
        enabled: true,
        displayName: 'GLM-5.1',
        match: { kind: 'model', requestedModelPattern: 'GLM-5.1', displayName: 'GLM-5.1', routeId: 11 },
        backend: { kind: 'supply' },
        ownership: 'auto_generated',
        targets: [{ targetId: '11', model: 'GLM-5.1', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 22,
        enabled: true,
        displayName: 'glm-5.1',
        match: { kind: 'model', requestedModelPattern: 'glm-5.1', displayName: 'glm-5.1', routeId: 22 },
        backend: { kind: 'supply' },
        ownership: 'auto_generated',
        targets: [{ targetId: '22', model: 'glm-5.1', accountId: 1, tokenId: 2, weight: 10 }],
      },
    ]);

    expect(source.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'route-endpoint:supply:route:11', type: 'route_endpoint', endpointKind: 'supply', exposure: 'none' }),
      expect.objectContaining({ id: 'route-endpoint:supply:route:22', type: 'route_endpoint', endpointKind: 'supply', exposure: 'none' }),
      expect.objectContaining({
        id: 'route-endpoint:product:auto-model:glm-5.1',
        type: 'route_endpoint',
        endpointKind: 'route_product',
        exposure: 'public',
        backend: { kind: 'routes', routeIds: [11, 22] },
      }),
    ]));
    expect(source.macros).toEqual([
      expect.objectContaining({
        id: 'auto-model:glm-5.1',
        ownership: 'auto_generated',
        config: expect.objectContaining({
          groups: [
            expect.objectContaining({
              priority: 0,
              input: {
                kind: 'route_endpoints',
                endpointIds: ['route-endpoint:supply:route:11', 'route-endpoint:supply:route:22'],
              },
            }),
          ],
        }),
      }),
    ]);
    expect(source.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:route:11',
        targetNodeId: 'macro:auto-model:glm-5.1',
        targetPortId: 'candidates.in',
        metadata: expect.objectContaining({ candidate: expect.objectContaining({ priority: 0 }) }),
      }),
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:route:22',
        targetNodeId: 'macro:auto-model:glm-5.1',
        targetPortId: 'candidates.in',
        metadata: expect.objectContaining({ candidate: expect.objectContaining({ priority: 0 }) }),
      }),
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:route:11',
        sourcePortId: 'route.out',
        targetNodeId: 'macro:auto-model:glm-5.1',
        targetPortId: 'candidates.in',
        kind: 'route_flow',
      }),
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:route:22',
        sourcePortId: 'route.out',
        targetNodeId: 'macro:auto-model:glm-5.1',
        targetPortId: 'candidates.in',
        kind: 'route_flow',
      }),
    ]));

    const result = compileRouteGraphSource(source);
    expect(result.ok).toBe(true);
    expect(result.compiled.publicModels).toEqual([
      { nodeId: 'macro:auto-model:glm-5.1:entry', model: 'GLM-5.1' },
    ]);
    expect(result.compiled.routeEndpoints.filter((endpoint) => endpoint.publicModelName.toLowerCase() === 'glm-5.1')).toHaveLength(1);
    expect(result.compiled.programBundle.matcher.exact['GLM-5.1']).toEqual(expect.objectContaining({
      programId: 'program:macro:auto-model:glm-5.1:entry',
      rootEndpointId: 'route-endpoint:product:auto-model:glm-5.1',
    }));
    expect(result.compiled.programBundle.endpointCatalog.productToProgram).toMatchObject({
      'route-endpoint:product:auto-model:glm-5.1': 'program:macro:auto-model:glm-5.1:entry',
    });
    expect(result.compiled.programBundle.endpointCatalog.supplyTargets['route-endpoint:supply:route:11']).toEqual([
      expect.objectContaining({
        endpointId: 'route-endpoint:supply:route:11',
        nodeId: 'route-endpoint:supply:route:11',
        model: 'GLM-5.1',
        routeId: 11,
      }),
    ]);
    expect(result.primitiveSource.nodes.some((node) => node.id.startsWith('macro:auto-model:glm-5.1:candidate:') && node.type === 'route_endpoint')).toBe(false);
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:route:11',
        targetNodeId: 'macro:auto-model:glm-5.1:dispatcher',
        targetPortId: 'route.in',
        metadata: expect.objectContaining({
          candidate: expect.objectContaining({ endpointKind: 'supply' }),
        }),
      }),
    ]));
    expect(result.compiled.programBundle.programs[0].ops).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'program:macro:auto-model:glm-5.1:entry:op:macro:auto-model:glm-5.1:dispatcher:dispatch-route',
        op: 'dispatch',
        candidates: expect.arrayContaining([
          expect.objectContaining({
            nodeId: 'route-endpoint:supply:route:11',
            endpointId: 'route-endpoint:supply:route:11',
            priority: 0,
            targetOpId: 'program:macro:auto-model:glm-5.1:entry:op:route-endpoint:supply:route:11:select-supply',
          }),
          expect.objectContaining({
            nodeId: 'route-endpoint:supply:route:22',
            endpointId: 'route-endpoint:supply:route:22',
            priority: 0,
            targetOpId: 'program:macro:auto-model:glm-5.1:entry:op:route-endpoint:supply:route:22:select-supply',
          }),
        ]),
      }),
      expect.objectContaining({
        id: 'program:macro:auto-model:glm-5.1:entry:op:route-endpoint:supply:route:11:select-supply',
        op: 'select_supply',
        endpointId: 'route-endpoint:supply:route:11',
        nodeId: 'route-endpoint:supply:route:11',
        routeId: 11,
        targets: expect.arrayContaining([
          expect.objectContaining({ nodeId: 'route-endpoint:supply:route:11', model: 'GLM-5.1' }),
        ]),
      }),
    ]));
    expect(result.compiled.programBundle.debug.generatedByMacro['auto-model:glm-5.1'].nodeIds).toEqual(expect.arrayContaining([
      'macro:auto-model:glm-5.1:entry',
      'macro:auto-model:glm-5.1:dispatcher',
    ]));
  });

  it('groups automatic exact-model supplies with colon model names without duplicate primitive ids', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 3392,
        enabled: true,
        displayName: 'deepseek-v4-flash:free',
        match: { kind: 'model', requestedModelPattern: 'deepseek-v4-flash:free', displayName: 'deepseek-v4-flash:free', routeId: 3392 },
        backend: { kind: 'supply' },
        ownership: 'auto_generated',
        targets: [{ targetId: '3392', model: 'deepseek-v4-flash:free', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 3393,
        enabled: true,
        displayName: 'DeepSeek-V4-Flash:Free',
        match: { kind: 'model', requestedModelPattern: 'DeepSeek-V4-Flash:Free', displayName: 'DeepSeek-V4-Flash:Free', routeId: 3393 },
        backend: { kind: 'supply' },
        ownership: 'auto_generated',
        targets: [{ targetId: '3393', model: 'DeepSeek-V4-Flash:Free', accountId: 1, tokenId: 2, weight: 10 }],
      },
    ]);

    expect(source.nodes.filter((node) => node.id === 'route-endpoint:product:auto-model:deepseek-v4-flash:free')).toHaveLength(1);
    expect(source.macros.filter((macro) => macro.id === 'auto-model:deepseek-v4-flash:free')).toHaveLength(1);

    const result = compileRouteGraphSource(source);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'node.duplicate_id')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.compiled.publicModels).toEqual([
      { nodeId: 'macro:auto-model:deepseek-v4-flash:free:entry', model: 'deepseek-v4-flash:free' },
    ]);
  });

  it('keeps compiled route program metadata compact', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
      ...Array.from({ length: 24 }, (_, index) => ({
        id: index + 1,
        enabled: true,
        displayName: `compact-model-${index}`,
        match: { kind: 'model' as const, requestedModelPattern: `compact-model-${index}`, displayName: null, routeId: index + 1 },
        backend: { kind: 'supply' as const },
        ownership: 'auto_generated' as const,
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
    expect(compiled.compiled.programBundle.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(compiled.compiled.flatProgramBundle.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(compiled.compiled.compiledRouterBundle?.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(compiled.compiled.programBundle.debug.sourceRefs).toEqual({});
    expect(compiled.compiled.flatProgramBundle.endpointCatalog).toEqual({ byId: {}, productToProgram: {}, supplyTargets: {} });
    expect(compiled.compiled.compiledRouterBundle?.plans).toHaveLength(24);
    expect(JSON.stringify(compiled.compiled.compiledRouterBundle)).not.toContain('"next"');
    const flatProgramBytes = Buffer.byteLength(JSON.stringify(compiled.compiled.flatProgramBundle), 'utf8');
    const compiledRouterBytes = Buffer.byteLength(JSON.stringify(compiled.compiled.compiledRouterBundle), 'utf8');
    expect(compiledRouterBytes).toBeLessThan(flatProgramBytes);
    const firstCompiledRouterPlan = compiled.compiled.compiledRouterBundle?.plans[0];
    expect(firstCompiledRouterPlan?.targets.length).toBeGreaterThan(0);
    expect(firstCompiledRouterPlan?.targets[0]).not.toHaveProperty('endpointId');
    expect(firstCompiledRouterPlan?.targets[0]).not.toHaveProperty('nodeId');
    expect(firstCompiledRouterPlan?.targets[0]).not.toHaveProperty('sourceRef');
    expect(firstCompiledRouterPlan?.candidates[0]?.terminal).toMatchObject({
      kind: 'supply',
      targetIndexes: expect.any(Array),
    });
    expect(firstCompiledRouterPlan?.candidates[0]?.terminal).not.toHaveProperty('targets');
    expect(firstCompiledRouterPlan?.candidates[0]).toHaveProperty('filterStageIndexes');
    expect(firstCompiledRouterPlan?.candidates[0]).not.toHaveProperty('filterStages');
    expect(Buffer.byteLength(JSON.stringify(compiled.compiled), 'utf8')).toBeLessThan(2 * 1024 * 1024);
  });

  it('exposes clear default labels for candidate selector macro ports', () => {
    const macro = normalizeRouteGraphSource({
      version: 1,
      macros: [
        {
          id: 'model-group:labels',
          kind: 'candidate_selector',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'internal',
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
      version: 1,
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
      visibility: 'internal',
      ownership: 'manual',
      config: {
        surface: {
          entry: {
            kind: 'external',
            visibility: 'public',
          },
          output: 'route',
        },
        policy: { strategy: 'priority_order' },
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
      version: 1,
      nodes: [
        {
          id: 'endpoint.compat',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
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
      ],
      route_endpoint: [
        { id: 'route.out', label: 'route product', direction: 'output', kind: 'route', enabled: true, collection: undefined, required: undefined, multiple: undefined },
        { id: 'bidirect.in', label: 'invoke route', direction: 'input', kind: 'bidirect', enabled: true, collection: undefined, required: undefined, multiple: true },
      ],
      synthetic_endpoint: [
        { id: 'route.out', label: 'synthetic target', direction: 'output', kind: 'route', enabled: true, collection: undefined, required: undefined, multiple: undefined },
        { id: 'bidirect.in', label: 'return response', direction: 'input', kind: 'bidirect', enabled: true, collection: undefined, required: undefined, multiple: true },
      ],
    });
  });

  it('normalizes single port collections without cardinality bounds', () => {
    const source = normalizeRouteGraphSource({
      version: 1,
      nodes: [
        {
          id: 'filter:single-collection',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
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
      version: 1,
      nodes: [
        {
          id: 'entry:a',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'a' },
        },
        {
          id: 'pool:a',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:a', model: 'a' }], targetSelection: { strategy: 'weighted' } },
        },
      ],
      edges: [
        { id: 'legacy-edge', sourceNodeId: 'entry:a', targetNodeId: 'pool:a' },
      ],
    });

    const result = compileRouteGraphSource(source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('edge.invalid');
  });

  it('rejects incompatible port connections', () => {
    const source = normalizeRouteGraphSource({
      version: 1,
      nodes: [
        {
          id: 'entry:a',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'a' },
        },
        {
          id: 'dispatcher:a',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'pool:a',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:a', model: 'a' }], targetSelection: { strategy: 'weighted' } },
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
      version: 1,
      nodes: [
        {
          id: 'entry:missing',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'missing-model' },
        },
        {
          id: 'dispatcher:missing',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
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
      version: 1,
      nodes: [
        {
          id: 'entry:a',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'a' },
        },
        {
          id: 'entry:b',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'b' },
        },
        {
          id: 'dispatcher:single',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
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
      version: 1,
      nodes: [
        {
          id: 'entry:multi',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'multi-model' },
        },
        {
          id: 'dispatcher:multi',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'endpoint:a',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'a', model: 'multi-model-a' }], targetSelection: { strategy: 'weighted' } },
        },
        {
          id: 'endpoint:b',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'b', model: 'multi-model-b' }], targetSelection: { strategy: 'weighted' } },
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
    expect(result.compiled.edgesByFromPort['endpoint:a:route.out'].map((edge) => edge.id)).toEqual(['a-dispatcher']);
    expect(result.compiled.edgesByFromPort['endpoint:b:route.out'].map((edge) => edge.id)).toEqual(['b-dispatcher']);
  });

  it('enforces collection bounds on set and arr input ports', () => {
    const belowMin = compileRouteGraphSource({
      version: 1,
      nodes: [
        {
          id: 'filter:set-required',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
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
      version: 1,
      nodes: [
        {
          id: 'source:a',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.out', label: 'request out', direction: 'output', kind: 'request' },
          ],
        },
        {
          id: 'source:b',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          dynamicPorts: [
            { id: 'request.out', label: 'request out', direction: 'output', kind: 'request' },
          ],
        },
        {
          id: 'filter:arr-limited',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
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
      visibility: 'internal',
      ownership: 'manual',
      endpointKind: 'supply',
      resolutionStatus: 'resolved',
      config: {
        targets: [{ targetId: id, model: `model-${id}` }],
        targetSelection: { strategy: 'weighted' },
      },
    });
    const result = compileRouteGraphSource({
      version: 1,
      nodes: [endpoint('a'), endpoint('b')],
      macros: [
        {
          id: 'macro:limited-candidates',
          kind: 'candidate_selector',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: { requestedModelPattern: 'limited-candidates', displayName: 'limited-candidates' },
              },
              output: 'route',
              ports: [
                { id: 'bidirect.in', label: 'input', direction: 'input', kind: 'bidirect' },
                { id: 'candidates.in', label: 'candidate inputs', direction: 'input', kind: 'route', multiple: true, collection: { type: 'set', max: 1 } },
                { id: 'route.out', label: 'route output', direction: 'output', kind: 'route' },
              ],
            },
            policy: { strategy: 'weighted' },
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
      version: 1,
      nodes: [
        {
          id: 'entry:a',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'duplicate-public' },
        },
        {
          id: 'entry:b',
          type: 'entry',
          enabled: true,
          visibility: 'public',
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
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 1,
        enabled: true,
        displayName: 'same-route-public',
        match: { kind: 'model', requestedModelPattern: 'same-route-public', displayName: 'same-route-public', routeId: 1 },
        backend: { kind: 'supply' },
        ownership: 'auto_generated',
        targets: [{ targetId: '1', model: 'same-route-public', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const result = compileRouteGraphSource(source);

    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((item) => item.code)).not.toContain('public_model.duplicate');
  });

  it('detects active graph cycles before runtime dispatch', () => {
    const result = compileRouteGraphSource({
      version: 1,
      nodes: [
        {
          id: 'filter:a',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          operations: [],
        },
        {
          id: 'filter:b',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
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
      version: 1,
      nodes: [
        {
          id: 'entry:bad-regex',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 're:[invalid' },
        },
        {
          id: 'dispatcher:bad-regex',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          ordering: 'explicit',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'pool:bad-regex',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:bad-regex', model: 'bad-regex' }], targetSelection: { strategy: 'weighted' } },
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
      version: 1,
      nodes: [
        {
          id: 'entry:route',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'route-model' },
        },
        {
          id: 'dispatcher:route',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'endpoint:route',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:route', model: 'route-model' }], targetSelection: { strategy: 'weighted' } },
        },
        {
          id: 'endpoint:ignored-flow',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:ignored', model: 'ignored' }], targetSelection: { strategy: 'weighted' } },
        },
      ],
      edges: [
        { id: 'entry-route', sourceNodeId: 'entry:route', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:route', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'route-candidate', sourceNodeId: 'endpoint:route', sourcePortId: 'route.out', targetNodeId: 'dispatcher:route', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
        { id: 'ignored-flow', sourceNodeId: 'dispatcher:route', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint:ignored-flow', targetPortId: 'bidirect.in', kind: 'request_flow', ownership: 'manual' },
      ],
    });

    expect(routeMode.ok).toBe(true);
    expect(routeMode.compiled.edgesBySource['dispatcher:route'] || []).toEqual([]);

    const flowMode = compileRouteGraphSource({
      version: 1,
      nodes: [
        {
          id: 'entry:flow',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'flow-model' },
        },
        {
          id: 'dispatcher:flow',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'flow',
          policy: { strategy: 'stable_first' },
        },
        {
          id: 'endpoint:flow',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:flow', model: 'flow-model' }], targetSelection: { strategy: 'weighted' } },
        },
        {
          id: 'endpoint:ignored-route',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:ignored-route', model: 'ignored-route' }], targetSelection: { strategy: 'weighted' } },
        },
      ],
      edges: [
        { id: 'entry-flow', sourceNodeId: 'entry:flow', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher:flow', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'flow-candidate', sourceNodeId: 'dispatcher:flow', sourcePortId: 'bidirect[1...].out', targetNodeId: 'endpoint:flow', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
        { id: 'ignored-route', sourceNodeId: 'endpoint:ignored-route', sourcePortId: 'route.out', targetNodeId: 'dispatcher:flow', targetPortId: 'route.in', kind: 'request_flow', ownership: 'manual' },
      ],
    });

    expect(flowMode.ok).toBe(true);
    expect(flowMode.compiled.edgesBySource['endpoint:ignored-route'] || []).toEqual([]);
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
      version: 1,
      nodes: [
        {
          id: 'source:disabled-port',
          type: 'auto_node',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          dynamicPorts: [
            { id: 'disabled.out', label: 'disabled output', direction: 'output', kind: 'request', enabled: false },
          ],
        },
        {
          id: 'target:disabled-port',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
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
      version: 1,
      nodes: [
        {
          id: 'entry:metadata',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'metadata-model' },
        },
        {
          id: 'dispatcher:metadata',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'flow',
          policy: { strategy: 'weighted', score: 'candidate.metadata.weight' },
        },
        {
          id: 'endpoint:metadata',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'metadata', model: 'metadata-model' }], targetSelection: { strategy: 'weighted' } },
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
    expect(compiled.compiled.edgesByFromPort['dispatcher:metadata:bidirect[1...].out'][0].metadata).toEqual({ weight: 7 });
  });

  it('allows a filter to be connected through the bidirect path without request.in', () => {
    const result = compileRouteGraphSource({
      version: 1,
      nodes: [
        {
          id: 'entry:filter',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'filter-model' },
        },
        {
          id: 'filter:bidirect',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          operations: [{ type: 'set_payload', path: 'reasoning_effort', value: 'high' }],
        },
        {
          id: 'dispatcher:filter',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'flow',
          policy: { strategy: 'stable_first' },
        },
        {
          id: 'endpoint:filter',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'target:filter', model: 'filter-model' }], targetSelection: { strategy: 'weighted' } },
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
      version: 1,
      nodes: [
        {
          id: 'filter:orphan',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          operations: [],
        },
      ],
      edges: [],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain('filter.input_required');
  });

  it('lowers candidate_selector model groups backed by route id priority bands', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 11,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'source-model', displayName: null, routeId: 11 },
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
          visibility: 'public',
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: { displayName: 'public-group' },
              },
              output: 'route',
            },
            policy: { strategy: 'priority_order' },
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
                priority: 0,
                input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:route:11'] },
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
      expect.objectContaining({ id: 'macro:model-group:public:entry', type: 'entry', visibility: 'public', ownership: 'derived' }),
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
      expect.objectContaining({ id: 'route-endpoint:product:route:11', type: 'route_endpoint', endpointKind: 'route_product' }),
    ]));
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: 'macro:model-group:public:entry', targetNodeId: 'macro:model-group:public:filter', kind: 'bidirect_flow' }),
      expect.objectContaining({ sourceNodeId: 'macro:model-group:public:filter', targetNodeId: 'macro:model-group:public:dispatcher', kind: 'bidirect_flow' }),
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:route:11',
        targetNodeId: 'macro:model-group:public:dispatcher',
        kind: 'route_flow',
        metadata: expect.objectContaining({
          candidate: expect.objectContaining({ routeId: 11, priority: 0, weight: 10 }),
        }),
      }),
    ]));
    expect(result.compiled.publicModels).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'public-group' }),
    ]));
    const program = result.compiled.flatProgramBundle.programs.find((item) => item.id === 'program:macro:model-group:public:entry');
    expect(program?.start.filterStages).toEqual([
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

  it('lowers semantic macro-node edges into primitive candidate and dispatcher edges', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 11,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'source-model', displayName: null, routeId: 11 },
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
          visibility: 'public',
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
          visibility: 'internal',
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
            policy: { strategy: 'priority_order' },
            groups: [
              { id: 'p0', enabled: true, priority: 0, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:route:11'] } },
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
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 11,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'source-model', displayName: null, routeId: 11 },
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
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'reuse-output-model' },
        },
        {
          id: 'dispatcher:reuse',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'priority_order' },
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
          visibility: 'internal',
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
            policy: { strategy: 'priority_order' },
            groups: [
              { id: 'p0', enabled: true, priority: 0, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:route:11'] } },
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
        id: 'macro-semantic:macro-to-dispatcher:route-out:route-endpoint:supply:route:11',
        sourceNodeId: 'route-endpoint:supply:route:11',
        sourcePortId: 'route.out',
        targetNodeId: 'dispatcher:reuse',
        targetPortId: 'route.in',
        kind: 'route_flow',
      }),
    ]));
  });

  it('lowers route endpoint edges into candidate selector macro candidate inputs', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 11,
        enabled: true,
        displayName: 'source-model',
        match: { kind: 'model', requestedModelPattern: 'source-model', displayName: 'source-model', routeId: 11 },
        backend: { kind: 'supply' },
        ownership: 'auto_generated',
        targets: [{ targetId: '11', model: 'source-model', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const result = compileRouteGraphSource({
      ...source,
      edges: [
        ...source.edges,
        {
          id: 'supply-to-macro-candidates',
          sourceNodeId: 'route-endpoint:supply:route:11',
          sourcePortId: 'route.out',
          targetNodeId: 'macro:auto-model:source-model',
          targetPortId: 'candidates.in',
          kind: 'route_flow',
          ownership: 'auto_generated',
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
        sourceNodeId: 'route-endpoint:supply:route:11',
        sourcePortId: 'route.out',
        targetNodeId: 'macro:auto-model:source-model:dispatcher',
        targetPortId: 'route.in',
        kind: 'route_flow',
        ownership: 'derived',
        metadata: expect.objectContaining({
          reason: 'auto candidate binding',
          provenance: expect.objectContaining({
            source: 'macro_semantic_edge',
            semanticEdgeId: 'supply-to-macro-candidates',
            macroId: 'auto-model:source-model',
            role: 'candidate_edge',
          }),
        }),
      }),
    ]));
  });

  it('lowers candidate input edges when the macro id already has a macro prefix', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 11,
        enabled: true,
        displayName: 'model-example',
        match: { kind: 'model', requestedModelPattern: 'model-example', displayName: 'model-example', routeId: 11 },
        backend: { kind: 'supply' },
        ownership: 'auto_generated',
        targets: [{ targetId: '11', model: 'model-example', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const result = compileRouteGraphSource({
      ...source,
      macros: [{ ...source.macros[0], id: 'macro:auto-model:model-example' }],
      edges: [{
        id: 'supply-to-prefixed-macro-candidates',
        sourceNodeId: 'route-endpoint:supply:route:11',
        sourcePortId: 'route.out',
        targetNodeId: 'macro:auto-model:model-example',
        targetPortId: 'candidates.in',
        kind: 'route_flow',
        ownership: 'auto_generated',
      }],
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).not.toContain('Semantic macro target port candidates.in is not supported');
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'macro-semantic:supply-to-prefixed-macro-candidates:candidate-in',
        sourceNodeId: 'route-endpoint:supply:route:11',
        sourcePortId: 'route.out',
        targetNodeId: 'macro:macro:auto-model:model-example:dispatcher',
        targetPortId: 'route.in',
        kind: 'route_flow',
      }),
    ]));
  });

  it('applies candidate selector endpoint overrides without editing generated candidate edges', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 11,
        enabled: true,
        displayName: 'GLM-5.1',
        match: { kind: 'model', requestedModelPattern: 'GLM-5.1', displayName: 'GLM-5.1', routeId: 11 },
        backend: { kind: 'supply' },
        ownership: 'auto_generated',
        targets: [{ targetId: '11', model: 'GLM-5.1', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 22,
        enabled: true,
        displayName: 'glm-5.1',
        match: { kind: 'model', requestedModelPattern: 'glm-5.1', displayName: 'glm-5.1', routeId: 22 },
        backend: { kind: 'supply' },
        ownership: 'auto_generated',
        targets: [{ targetId: '22', model: 'glm-5.1', accountId: 1, tokenId: 2, weight: 10 }],
      },
    ]);
    const macro = source.macros[0];
    const result = compileRouteGraphSource({
      ...source,
      macros: [
        {
          ...macro,
          config: {
            ...macro.config,
            candidateOverrides: {
              bySupplyEndpointId: {
                'route-endpoint:supply:route:11': { weight: 3, priority: 7, enabled: false },
                'route-endpoint:supply:route:22': { excluded: true },
              },
            },
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    const dispatch = result.compiled.programBundle.programs[0].ops.find((op) => op.op === 'dispatch');
    expect(dispatch?.candidates).toEqual([
      expect.objectContaining({
        nodeId: 'route-endpoint:supply:route:11',
        endpointId: 'route-endpoint:supply:route:11',
        enabled: false,
        weight: 3,
        priority: 7,
        metadata: expect.objectContaining({
          candidate: expect.objectContaining({
            override: { weight: 3, priority: 7, enabled: false },
          }),
        }),
      }),
    ]);
    expect(result.primitiveSource.edges.some((edge) => edge.sourceNodeId === 'route-endpoint:supply:route:22' && edge.targetNodeId === 'macro:auto-model:glm-5.1:dispatcher')).toBe(false);
  });

  it('ignores semantic candidate edges that target a disabled macro', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 11,
        enabled: false,
        displayName: 'disabled-model',
        match: { kind: 'model', requestedModelPattern: 'disabled-model', displayName: 'disabled-model', routeId: 11 },
        backend: { kind: 'supply' },
        ownership: 'auto_generated',
        targets: [{ targetId: '11', model: 'disabled-model', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const result = compileRouteGraphSource({
      ...source,
      edges: [{
        id: 'supply-to-disabled-macro-candidates',
        sourceNodeId: 'route-endpoint:supply:route:11',
        sourcePortId: 'route.out',
        targetNodeId: 'macro:auto-model:disabled-model',
        targetPortId: 'candidates.in',
        kind: 'route_flow',
        ownership: 'auto_generated',
      }],
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n')).not.toContain('Semantic macro target port candidates.in is not supported');
  });

  it('lowers embedded internal candidate_selector surfaces without exposing public models', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 11,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'source-model', displayName: null, routeId: 11 },
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
          visibility: 'internal',
          ownership: 'manual',
          config: {
            surface: {
              entry: { kind: 'embedded', input: 'bidirect' },
              output: 'route',
            },
            policy: { strategy: 'priority_order' },
            groups: [
              { id: 'p0', enabled: true, priority: 0, input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:route:11'] } },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.primitiveSource.nodes.some((node) => node.id === 'macro:model-group:internal:entry')).toBe(false);
    expect(result.compiled.publicModels.some((item) => item.model === 'internal-group')).toBe(false);
  });

  it('materializes candidate selector model_pattern groups from matching route endpoints', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 11,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'claude-opus-4-6', displayName: null, routeId: 11 },
        backend: { kind: 'supply' },
        targets: [{ targetId: '11', model: 'claude-opus-4-6', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 12,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'claude-sonnet-4-6', displayName: null, routeId: 12 },
        backend: { kind: 'supply' },
        targets: [{ targetId: '12', model: 'claude-sonnet-4-6', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 13,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'gpt-4o-mini', displayName: null, routeId: 13 },
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
          visibility: 'public',
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: { displayName: 'claude-group' },
              },
              output: 'route',
            },
            policy: { strategy: 'priority_order' },
            groups: [
              {
                id: 'claude',
                enabled: true,
                priority: 0,
                input: { kind: 'model_pattern', pattern: 'claude-*' },
                defaults: { weight: 8, priority: 2 },
                materialization: { sort: 'model_name', dedupeBy: 'route_id' },
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
        id: 'macro:pattern-selector:candidate:claude:route:11',
        type: 'route_endpoint',
        ownership: 'derived',
        metadata: expect.objectContaining({
          macroCandidate: expect.objectContaining({
            pattern: 'claude-*',
            matchedModel: 'claude-opus-4-6',
            routeId: 11,
            weight: 8,
            priority: 2,
          }),
        }),
      }),
      expect.objectContaining({
        id: 'macro:pattern-selector:candidate:claude:route:12',
        type: 'route_endpoint',
        ownership: 'derived',
        metadata: expect.objectContaining({
          macroCandidate: expect.objectContaining({
            matchedModel: 'claude-sonnet-4-6',
            routeId: 12,
          }),
        }),
      }),
    ]));
    expect(result.primitiveSource.nodes.some((node) => node.id === 'macro:pattern-selector:candidate:claude:route:13')).toBe(false);
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: 'macro:pattern-selector:candidate:claude:route:11',
        targetNodeId: 'macro:pattern-selector:dispatcher',
        metadata: expect.objectContaining({
          candidate: expect.objectContaining({
            pattern: 'claude-*',
            matchedModel: 'claude-opus-4-6',
            routeId: 11,
          }),
        }),
      }),
      expect.objectContaining({
        sourceNodeId: 'macro:pattern-selector:candidate:claude:route:12',
        targetNodeId: 'macro:pattern-selector:dispatcher',
      }),
    ]));
    expect(result.compiled.publicModels).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'claude-group' }),
    ]));
  });

  it('keeps model_pattern macro materialization deterministic with limit and model dedupe', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 11,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'claude-opus-4-6', displayName: null, routeId: 11 },
        backend: { kind: 'supply' },
        targets: [{ targetId: '11', model: 'claude-opus-4-6', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 12,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'claude-opus-4-6-alt', displayName: null, routeId: 12 },
        backend: { kind: 'supply' },
        targets: [{ targetId: '12', model: 'claude-opus-4-6', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 13,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'claude-sonnet-4-6', displayName: null, routeId: 13 },
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
          visibility: 'public',
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: { displayName: 'limited-claude-group' },
              },
              output: 'route',
            },
            policy: { strategy: 'priority_order' },
            groups: [
              {
                id: 'claude',
                enabled: true,
                priority: 0,
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
    expect(candidateIds).toEqual(['macro:pattern-limited:candidate:claude:route:11']);
  });

  it('reports public macro entries with empty model_pattern groups as candidate-less dispatchers', () => {
    const result = compileRouteGraphSource({
      version: 1,
      nodes: [],
      edges: [],
      macros: [
        {
          id: 'pattern-empty',
          kind: 'candidate_selector',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: { displayName: 'empty-pattern-group' },
              },
              output: 'route',
            },
            policy: { strategy: 'priority_order' },
            groups: [
              { id: 'none', enabled: true, priority: 0, input: { kind: 'model_pattern', pattern: 'no-match-*' } },
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
      version: 1,
      nodes: [],
      edges: [],
      macros: [
        {
          id: 'pattern-selector',
          kind: 'candidate_selector',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: { displayName: 'pattern-group' },
              },
              output: 'route',
            },
            policy: { strategy: 'priority_order' },
            groups: [
              { id: 'metadata', enabled: true, priority: 0, input: { kind: 'metadata_query', cel: 'metadata.tier == "gold"' } },
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
      version: 1,
      nodes: [
        {
          id: 'entry:missing',
          type: 'entry',
          enabled: true,
          visibility: 'public',
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
      version: 1,
      nodes: [
        { id: 'entry:a', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'dup-model' } },
        { id: 'entry:b', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'dup-model' } },
        { id: 'dispatcher:a', type: 'dispatcher', enabled: true, visibility: 'internal', ownership: 'manual', mode: 'route', policy: { strategy: 'weighted' } },
        { id: 'filter:a', type: 'filter', enabled: true, visibility: 'internal', ownership: 'manual', operations: [] },
        { id: 'endpoint:a', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', config: { targets: [{ targetId: 'a', model: 'dup-model' }], targetSelection: { strategy: 'weighted' } } },
        { id: 'endpoint:b', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', config: { targets: [{ targetId: 'b', model: 'dup-model' }], targetSelection: { strategy: 'weighted' } } },
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
      version: 1,
      nodes: [
        { id: 'entry:required', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'required-model' } },
        { id: 'dispatcher:required', type: 'dispatcher', enabled: true, visibility: 'internal', ownership: 'manual', mode: 'route', policy: { strategy: 'weighted' } },
        { id: 'endpoint:required', type: 'route_endpoint', enabled: true, visibility: 'internal', ownership: 'manual', config: { targets: [{ targetId: 'required', model: 'required-model' }], targetSelection: { strategy: 'weighted' } } },
      ],
      edges: [
        { id: 'route-only', sourceNodeId: 'endpoint:required', sourcePortId: 'route.out', targetNodeId: 'dispatcher:required', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      ],
    });

    expect(missingRequiredPort.ok).toBe(false);
    expect(missingRequiredPort.diagnostics.map((item) => item.code)).toContain('port.required_missing');
  });

  it('lowers synthetic and inline candidate selector groups with defaults and provenance', () => {
    const result = compileRouteGraphSource({
      version: 1,
      nodes: [],
      edges: [],
      macros: [
        {
          id: 'model-group:mixed',
          kind: 'candidate_selector',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: { displayName: 'mixed-group' },
              },
              output: 'route',
            },
            policy: { strategy: 'priority_order' },
            groups: [
              {
                id: 'disabled-inline',
                enabled: false,
                priority: 0,
                input: {
                  kind: 'inline_endpoints',
                  endpoints: [{ targetId: 'disabled', model: 'disabled-model' }],
                },
              },
              {
                id: 'inline',
                enabled: true,
                priority: 1,
                input: {
                  kind: 'inline_endpoints',
                  endpoints: [
                    { targetId: 'inline-a', model: 'inline-model-a', metadata: { region: 'sg' } },
                    { targetId: 'inline-b', model: 'inline-model-b' },
                  ],
                },
                defaults: {
                  weight: 8,
                  priority: 3,
                  metadata: { tier: 'premium' },
                },
              },
              {
                id: 'synthetic',
                label: 'capacity guard',
                enabled: true,
                priority: 2,
                input: { kind: 'synthetic', statusCode: 429, message: 'capacity exceeded' },
                defaults: { weight: 1, priority: 9 },
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
        metadata: expect.objectContaining({
          tier: 'premium',
          macroCandidate: expect.objectContaining({
            macroId: 'model-group:mixed',
            groupId: 'inline',
            weight: 8,
            priority: 3,
          }),
        }),
        config: expect.objectContaining({
          targets: [
            expect.objectContaining({ targetId: 'inline-a', model: 'inline-model-a', metadata: { region: 'sg' } }),
            expect.objectContaining({ targetId: 'inline-b', model: 'inline-model-b' }),
          ],
          targetSelection: { strategy: 'defer_to_router' },
        }),
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
          candidate: expect.objectContaining({ weight: 8, priority: 3 }),
        }),
      }),
      expect.objectContaining({
        sourceNodeId: 'macro:model-group:mixed:candidate:synthetic:synthetic',
        targetNodeId: 'macro:model-group:mixed:dispatcher',
        metadata: expect.objectContaining({
          candidate: expect.objectContaining({ synthetic: true, weight: 1, priority: 9 }),
        }),
      }),
    ]));
  });

  it('lowers candidate_selector bidirect outputs as flow dispatcher paths', () => {
    const result = compileRouteGraphSource({
      version: 1,
      nodes: [],
      edges: [],
      macros: [
        {
          id: 'model-group:flow',
          kind: 'candidate_selector',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          config: {
            surface: {
              entry: {
                kind: 'external',
                visibility: 'public',
                match: { displayName: 'flow-group' },
              },
              output: 'bidirect',
              ports: [
                { id: 'bidirect.in', label: 'incoming flow', direction: 'input', kind: 'bidirect', multiple: true },
                { id: 'bidirect.out', label: 'selected flow', direction: 'output', kind: 'bidirect', multiple: true, collection: { type: 'arr', min: 1 } },
              ],
            },
            policy: { strategy: 'round_robin' },
            groups: [
              {
                id: 'primary',
                enabled: true,
                priority: 0,
                input: {
                  kind: 'inline_endpoints',
                  endpoints: [{ targetId: 'flow-a', model: 'flow-model-a' }],
                },
              },
              {
                id: 'fallback',
                enabled: true,
                priority: 1,
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
        policy: { strategy: 'round_robin' },
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
        sourcePortId: 'bidirect[1...].out',
        targetNodeId: 'macro:model-group:flow:candidate:primary:inline',
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
      }),
      expect.objectContaining({
        sourceNodeId: 'macro:model-group:flow:dispatcher',
        sourcePortId: 'bidirect[1...].out',
        targetNodeId: 'macro:model-group:flow:candidate:fallback:synthetic',
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
      }),
    ]));
    expect(result.compiled.publicModels).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'flow-group' }),
    ]));
  });

  it('lowers semantic bidirect macro output ports through the macro-defined dispatcher output', () => {
    const result = compileRouteGraphSource({
      version: 1,
      nodes: [
        {
          id: 'entry:outer',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'outer-model' },
        },
        {
          id: 'filter:after-macro',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          operations: [{ type: 'set_payload', path: 'afterMacro', value: true }],
        },
        {
          id: 'endpoint:outer',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'outer', model: 'outer-model' }], targetSelection: { strategy: 'weighted' } },
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
          visibility: 'internal',
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
            policy: { strategy: 'stable_first' },
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
      version: 1,
      nodes: [
        {
          id: 'entry:outer-embedded',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'outer-embedded-model' },
        },
        {
          id: 'endpoint:outer-embedded',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          legacyRouteId: 77,
          config: { targets: [{ targetId: 'outer-embedded', model: 'outer-embedded-model' }], targetSelection: { strategy: 'weighted' } },
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
          visibility: 'internal',
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
            policy: { strategy: 'stable_first' },
            groups: [
              {
                id: 'guard',
                priority: 0,
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
    expect(result.compiled.publicModels).toEqual([
      expect.objectContaining({ model: 'outer-embedded-model' }),
    ]);
    expect(result.compiled.publicModels.some((item) => item.model === 'model-group:embedded')).toBe(false);
  });

  it('normalizes request-input embedded macro ports but rejects them until request dispatch is defined', () => {
    const macroSource = normalizeRouteGraphSource({
      version: 1,
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
          visibility: 'internal',
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
      version: 1,
      nodes: [
        {
          id: 'entry:direction',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'direction-model' },
        },
        {
          id: 'dispatcher:direction',
          type: 'dispatcher',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          mode: 'route',
          policy: { strategy: 'weighted' },
        },
        {
          id: 'endpoint:direction',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'direction', model: 'direction-model' }], targetSelection: { strategy: 'weighted' } },
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
      version: 1,
      nodes: [
        { id: 'entry:a', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'multi-a' } },
        { id: 'entry:b', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'multi-b' } },
        {
          id: 'endpoint:shared',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'shared', model: 'multi-shared' }], targetSelection: { strategy: 'weighted' } },
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
      version: 1,
      nodes: [
        {
          id: 'entry:reachable',
          type: 'entry',
          enabled: true,
          visibility: 'public',
          ownership: 'manual',
          match: { requestedModelPattern: 'reachable-model' },
        },
        {
          id: 'endpoint:reachable',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'reachable', model: 'reachable-model' }], targetSelection: { strategy: 'weighted' } },
        },
        {
          id: 'filter:orphan-connected',
          type: 'filter',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          operations: [],
        },
        {
          id: 'endpoint:orphan-connected',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: { targets: [{ targetId: 'orphan', model: 'orphan-model' }], targetSelection: { strategy: 'weighted' } },
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
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 11,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'source-a', routeId: 11 },
        backend: { kind: 'supply' },
        targets: [{ targetId: '11', model: 'source-a' }],
      },
      {
        id: 22,
        enabled: true,
        displayName: null,
        match: { kind: 'model', requestedModelPattern: 'source-b', routeId: 22 },
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
              entry: { kind: 'external', visibility: 'public', match: { displayName: 'limited-group' } },
              output: 'route',
            },
            groups: [
              {
                id: 'limited',
                priority: 0,
                input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:route:22', 'route-endpoint:supply:route:11'] },
                materialization: { sort: 'route_id', limit: 1 },
              },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.primitiveSource.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: 'route-endpoint:supply:route:11',
        targetNodeId: 'macro:model-group:limited:dispatcher',
        kind: 'route_flow',
      }),
    ]));
    expect(result.primitiveSource.edges.some((edge) => (
      edge.sourceNodeId === 'route-endpoint:supply:route:22'
      && edge.targetNodeId === 'macro:model-group:limited:dispatcher'
    ))).toBe(false);
  });

  it('rejects candidate_selector route-backed aliases colliding with exact public routes', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 1,
        enabled: true,
        displayName: 'source-model',
        match: { kind: 'model', requestedModelPattern: 'source-model', displayName: null, routeId: 1 },
        backend: { kind: 'supply' },
        targets: [{ targetId: '1', model: 'source-model', accountId: 1, tokenId: 1, weight: 10 }],
      },
      {
        id: 2,
        enabled: true,
        displayName: 'colliding',
        match: { kind: 'model', requestedModelPattern: '', displayName: 'colliding', routeId: 2 },
        backend: { kind: 'routes', routeIds: [1] },
      },
      {
        id: 3,
        enabled: true,
        displayName: 'colliding',
        match: { kind: 'model', requestedModelPattern: 'colliding', displayName: 'colliding', routeId: 3 },
        backend: { kind: 'supply' },
        targets: [{ targetId: '3', model: 'colliding', accountId: 1, tokenId: 1, weight: 10 }],
      },
    ]);

    const compiled = compileRouteGraphSource(source);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((item) => item.code)).toContain('public_model.duplicate');
  });

  it('resolves route entries with macro aliases before plain route aliases and exact channel entries', () => {
    const source = buildRouteGraphSourceFromLegacyRoutes([
      {
        id: 1,
        enabled: true,
        displayName: 'base-one',
        match: { kind: 'model', requestedModelPattern: 'base-one', displayName: 'base-one', routeId: 1 },
        backend: { kind: 'supply' },
        targets: [{ targetId: '1', model: 'base-one' }],
      },
      {
        id: 2,
        enabled: true,
        displayName: 'macro-hit',
        match: { kind: 'model', requestedModelPattern: '', displayName: 'macro-hit', routeId: 2 },
        backend: { kind: 'routes', routeIds: [1] },
      },
      {
        id: 3,
        enabled: true,
        displayName: 'exact-target',
        match: { kind: 'model', requestedModelPattern: 'macro-hit', displayName: 'exact-target', routeId: 3 },
        backend: { kind: 'supply' },
        targets: [{ targetId: '3', model: 'macro-hit' }],
      },
    ]);

    const compiled = compileRouteGraphSource(source);
    expect(compiled.ok).toBe(true);
    expect(findRouteGraphEntryForModel(compiled.compiled, 'macro-hit')?.nodeId).toBe('macro:route:2:model-group:entry');
  });
});
