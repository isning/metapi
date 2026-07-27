import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import type { RouteGraphMacro, RouteGraphSource } from '../../src/shared/routeGraph.js';
import { createRouteMacroSemanticNodeId } from '../../src/shared/routingIdentity.js';
import {
  buildRouteGraphFocusedWorkspace,
} from '../../src/server/services/routeGraphFocusProjectionService.js';
import {
  lowerRouteGraphPrimitiveFocus,
  projectRouteGraphPrimitiveFocusArtifact,
} from '../../src/server/services/routeGraphPrimitiveFocusService.js';
import {
  buildRouteGraphSemanticIndex,
  buildRouteGraphWorkspaceIndexPage,
} from '../../src/server/services/routeGraphWorkspaceIndexService.js';

const INDEX_MACRO_COUNT = 10_000;
const COLLECTION_SIZE = 1_000;
const SAMPLE_COUNT = 30;
const INDEX_P95_LIMIT_MS = Number(process.env.ROUTE_GRAPH_WORKSPACE_INDEX_P95_MS || 100);
const SEMANTIC_P95_LIMIT_MS = Number(process.env.ROUTE_GRAPH_WORKSPACE_SEMANTIC_P95_MS || 100);
const PRIMITIVE_P95_LIMIT_MS = Number(process.env.ROUTE_GRAPH_WORKSPACE_PRIMITIVE_P95_MS || 250);
const INDEX_PAYLOAD_LIMIT_BYTES = 128 * 1024;
const FOCUS_PAYLOAD_LIMIT_BYTES = 512 * 1024;
const REPORT_PATH = 'test-results/performance/route-graph-workspace-performance-report.json';

function macro(id: string, endpointIds: string[] = []): RouteGraphMacro {
  return {
    id,
    name: id,
    kind: 'candidate_selector',
    enabled: true,
    visibility: 'public',
    ownership: 'system',
    config: {
      surface: {
        entry: {
          kind: 'external',
          visibility: 'public',
          match: { kind: 'model', requestedModelPattern: id, displayName: id },
        },
        output: 'route',
        ports: [
          { id: 'candidates.in', label: 'Candidates', direction: 'input', kind: 'route', collection: { type: 'set', min: 1 } },
          { id: 'route.out', label: 'Route', direction: 'output', kind: 'route' },
        ],
      },
      policy: { kind: 'inherit_default' },
      groups: endpointIds.length > 0 ? [{
        id: `${id}:stage`,
        enabled: true,
        input: { kind: 'route_endpoints', endpointIds },
      }] : [],
    },
  };
}

function endpoint(id: string) {
  return {
    id,
    name: id,
    type: 'route_endpoint' as const,
    enabled: true,
    visibility: 'internal' as const,
    ownership: 'system' as const,
    routeEndpointId: id,
    endpointKind: 'supply' as const,
    exposure: 'none' as const,
    resolutionStatus: 'resolved' as const,
    ownerKind: 'manual' as const,
    sourceKind: 'upstream_model' as const,
    backend: { kind: 'supply' as const },
    config: { targets: [{ targetId: `target:${id}`, model: id }] },
  };
}

function collectionGraph(size: number): RouteGraphSource {
  const nodes = Array.from({ length: size }, (_, index) => endpoint(`endpoint:${String(index).padStart(4, '0')}`));
  const routeMacro = macro('route:workspace-performance', nodes.map((node) => node.routeEndpointId));
  return {
    nodes,
    macros: [routeMacro],
    edges: nodes.map((node, index) => ({
      id: `edge:${index}`,
      sourceNodeId: node.id,
      sourcePortId: 'route.out',
      targetNodeId: createRouteMacroSemanticNodeId(routeMacro.id),
      targetPortId: 'candidates.in',
      kind: 'route_flow',
      ownership: 'system',
    })),
  };
}

function percentile(samples: number[], percentileValue: number): number {
  const ordered = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentileValue / 100) * ordered.length) - 1);
  return Number((ordered[index] || 0).toFixed(4));
}

function sample(run: () => void): { p50Ms: number; p95Ms: number; maxMs: number } {
  const durations: number[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const started = performance.now();
    run();
    durations.push(performance.now() - started);
  }
  return {
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: Number(Math.max(...durations).toFixed(4)),
  };
}

function assertAtMost(label: string, actual: number, limit: number): void {
  if (actual > limit) throw new Error(`${label} ${actual} exceeds ${limit}`);
}

function main(): void {
  const indexGraph: RouteGraphSource = {
    nodes: [],
    edges: [],
    macros: Array.from({ length: INDEX_MACRO_COUNT }, (_, index) => macro(`macro:${String(index).padStart(5, '0')}`)),
  };
  const index = buildRouteGraphSemanticIndex(indexGraph);
  const firstPage = buildRouteGraphWorkspaceIndexPage(indexGraph, [], 'draft:performance', { limit: 40 }, index);
  const indexPayloadBytes = Buffer.byteLength(JSON.stringify(firstPage), 'utf8');
  const indexTiming = sample(() => {
    buildRouteGraphWorkspaceIndexPage(indexGraph, [], 'draft:performance', { limit: 40 }, index);
  });

  const focusGraph = collectionGraph(COLLECTION_SIZE);
  const focusIndex = buildRouteGraphSemanticIndex(focusGraph);
  const focusInput = {
    graph: focusGraph,
    diagnostics: [],
    revision: 'draft:performance',
    focus: { kind: 'macro' as const, id: 'route:workspace-performance' },
    representation: 'semantic' as const,
    semanticIndex: focusIndex,
  };
  const semanticWorkspace = buildRouteGraphFocusedWorkspace(focusInput);
  const semanticPayloadBytes = Buffer.byteLength(JSON.stringify(semanticWorkspace), 'utf8');
  const semanticTiming = sample(() => {
    buildRouteGraphFocusedWorkspace(focusInput);
  });

  const artifact = lowerRouteGraphPrimitiveFocus({
    graph: focusGraph,
    diagnostics: [],
    focus: focusInput.focus,
  });
  if (!artifact.available) throw new Error('primitive workspace performance fixture did not lower');
  const primitiveWorkspace = projectRouteGraphPrimitiveFocusArtifact({
    artifact,
    revision: 'draft:performance',
    focus: focusInput.focus,
  });
  const primitivePayloadBytes = Buffer.byteLength(JSON.stringify(primitiveWorkspace), 'utf8');
  const primitiveTiming = sample(() => {
    projectRouteGraphPrimitiveFocusArtifact({
      artifact,
      revision: 'draft:performance',
      focus: focusInput.focus,
    });
  });

  if (firstPage.items.length !== 40 || firstPage.totalCount !== INDEX_MACRO_COUNT) {
    throw new Error('workspace index response is not bounded to one page');
  }
  assertAtMost('index payload bytes', indexPayloadBytes, INDEX_PAYLOAD_LIMIT_BYTES);
  assertAtMost('semantic payload bytes', semanticPayloadBytes, FOCUS_PAYLOAD_LIMIT_BYTES);
  assertAtMost('primitive payload bytes', primitivePayloadBytes, FOCUS_PAYLOAD_LIMIT_BYTES);
  assertAtMost('semantic resident elements', semanticWorkspace.residentElements.length, 180);
  assertAtMost('semantic resident edges', semanticWorkspace.residentGraph.edges.length, 360);
  assertAtMost('primitive resident elements', primitiveWorkspace.residentElements.length, 180);
  assertAtMost('primitive resident edges', primitiveWorkspace.residentGraph.edges.length, 360);
  assertAtMost('warm index p95 ms', indexTiming.p95Ms, INDEX_P95_LIMIT_MS);
  assertAtMost('warm semantic focus p95 ms', semanticTiming.p95Ms, SEMANTIC_P95_LIMIT_MS);
  assertAtMost('warm primitive focus p95 ms', primitiveTiming.p95Ms, PRIMITIVE_P95_LIMIT_MS);

  const report = {
    generatedAt: new Date().toISOString(),
    status: 'passed',
    fixture: { indexMacros: INDEX_MACRO_COUNT, collectionSize: COLLECTION_SIZE, samples: SAMPLE_COUNT },
    payloadBytes: { index: indexPayloadBytes, semantic: semanticPayloadBytes, primitive: primitivePayloadBytes },
    resident: {
      semanticElements: semanticWorkspace.residentElements.length,
      semanticEdges: semanticWorkspace.residentGraph.edges.length,
      primitiveElements: primitiveWorkspace.residentElements.length,
      primitiveEdges: primitiveWorkspace.residentGraph.edges.length,
    },
    timing: { index: indexTiming, semantic: semanticTiming, primitive: primitiveTiming },
    limits: {
      indexP95Ms: INDEX_P95_LIMIT_MS,
      semanticP95Ms: SEMANTIC_P95_LIMIT_MS,
      primitiveP95Ms: PRIMITIVE_P95_LIMIT_MS,
      indexPayloadBytes: INDEX_PAYLOAD_LIMIT_BYTES,
      focusPayloadBytes: FOCUS_PAYLOAD_LIMIT_BYTES,
    },
  };
  mkdirSync('test-results/performance', { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ type: 'route-graph-workspace-performance', report: REPORT_PATH, ...report }));
}

main();
