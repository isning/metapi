import {
  compileRouteGraphSource,
  normalizeRouteGraphEdge,
  normalizeRouteGraphMacro,
  normalizeRouteGraphNode,
  normalizeRouteGraphSource,
  type RouteGraphCompileResult,
  type RouteGraphEdge,
  type RouteGraphMacro,
  type RouteGraphNode,
  type RouteGraphNodeType,
  type RouteGraphSource,
} from '../shared/routeGraph.js';

type RouteGraphBuilderNodeInput = Partial<RouteGraphNode> & {
  id: string;
  type: RouteGraphNodeType;
};

type RouteGraphBuilderEdgeInput = Partial<RouteGraphEdge> & {
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
};

export type RouteGraphBuilder = {
  source: RouteGraphSource;
  node: (input: RouteGraphBuilderNodeInput) => RouteGraphBuilder;
  edge: (input: RouteGraphBuilderEdgeInput) => RouteGraphBuilder;
  macro: (input: RouteGraphMacro) => RouteGraphBuilder;
  compile: () => RouteGraphCompileResult;
  compileOrThrow: () => RouteGraphCompileResult;
};

function diagnosticsText(result: RouteGraphCompileResult): string {
  return result.diagnostics
    .map((diagnostic) => `${diagnostic.severity}:${diagnostic.code}:${diagnostic.message}`)
    .join('\n');
}

export function compileRouteGraphOrThrow(source: unknown): RouteGraphCompileResult {
  const result = compileRouteGraphSource(source);
  if (!result.ok) {
    throw new Error(`Route graph did not compile:\n${diagnosticsText(result)}`);
  }
  return result;
}

export function createRouteGraphBuilder(input: Partial<RouteGraphSource> = {}): RouteGraphBuilder {
  const source = normalizeRouteGraphSource({
    version: 1,
    nodes: [],
    edges: [],
    macros: [],
    ...input,
  });

  const builder: RouteGraphBuilder = {
    source,
    node(nodeInput) {
      source.nodes.push(normalizeRouteGraphNode({
        enabled: true,
        visibility: nodeInput.type === 'entry' ? 'public' : 'internal',
        ownership: 'manual',
        ...nodeInput,
      }));
      return builder;
    },
    edge(edgeInput) {
      source.edges.push(normalizeRouteGraphEdge({
        id: `edge:${edgeInput.sourceNodeId}:${edgeInput.sourcePortId}:${edgeInput.targetNodeId}:${edgeInput.targetPortId}`,
        kind: 'bidirect_flow',
        ownership: 'manual',
        ...edgeInput,
      }));
      return builder;
    },
    macro(macroInput) {
      source.macros = source.macros || [];
      source.macros.push(normalizeRouteGraphMacro(macroInput));
      return builder;
    },
    compile() {
      return compileRouteGraphSource(source);
    },
    compileOrThrow() {
      return compileRouteGraphOrThrow(source);
    },
  };

  return builder;
}

export function createDirectModelRouteGraph(model = 'gpt-test'): RouteGraphSource {
  return createRouteGraphBuilder()
    .node({
      id: 'entry:test',
      type: 'entry',
      name: model,
      match: {
        kind: 'model',
        requestedModelPattern: model,
        displayName: model,
      },
      selectionStrategy: 'weighted',
    })
    .node({
      id: 'dispatcher:test',
      type: 'dispatcher',
      mode: 'route',
      policy: { strategy: 'weighted' },
    })
    .node({
      id: 'endpoint:test',
      type: 'model_endpoint',
      config: {
        targets: [{
          channelId: 'test-channel',
          model,
          modelSource: 'fixed',
        }],
        targetSelection: { strategy: 'defer_to_router' },
      },
    })
    .edge({
      sourceNodeId: 'entry:test',
      sourcePortId: 'bidirect.out',
      targetNodeId: 'dispatcher:test',
      targetPortId: 'bidirect.in',
      kind: 'bidirect_flow',
    })
    .edge({
      sourceNodeId: 'endpoint:test',
      sourcePortId: 'route.out',
      targetNodeId: 'dispatcher:test',
      targetPortId: 'route.in',
      kind: 'route_flow',
    })
    .source;
}
