import type {
  RouteGraphFocusedWorkspace,
  RouteGraphFocusRef,
  RouteGraphWorkspaceIndexFilters,
  RouteGraphWorkspaceIndexPage,
  RouteGraphWorkspaceRepresentation,
} from '../../shared/routeGraphWorkspace.js';
import {
  collectCompiledRouteAffinityTargets,
  compileRouteGraphSource,
  type CompiledRouteGraph,
  type RouteGraphAffinityTargetProjection,
  type RouteEndpointConfig,
  type RouteGraphSource,
} from '../../shared/routeGraph.js';
import { buildRouteGraphFocusedWorkspace } from './routeGraphFocusProjectionService.js';
import {
  lowerRouteGraphPrimitiveFocus,
  projectRouteGraphPrimitiveFocusArtifact,
  type RouteGraphPrimitiveFocusArtifact,
} from './routeGraphPrimitiveFocusService.js';
import { getRouteGraphDraft } from './routeGraphService.js';
import {
  buildRouteGraphSemanticIndex,
  buildRouteGraphWorkspaceIndexPage,
  type RouteGraphSemanticIndex,
} from './routeGraphWorkspaceIndexService.js';
import { formatRouteGraphWorkspaceRevision } from './routeGraphWorkspaceRevision.js';

const INDEX_PAGE_CACHE_LIMIT = 32;
const FOCUS_PROJECTION_CACHE_LIMIT = 64;
const PRIMITIVE_ARTIFACT_CACHE_LIMIT = 32;

type RevisionWorkspaceCache = {
  revision: string;
  semanticIndex: RouteGraphSemanticIndex;
  indexPages: Map<string, RouteGraphWorkspaceIndexPage>;
  focusProjections: Map<string, RouteGraphFocusedWorkspace>;
  primitiveArtifacts: Map<string, RouteGraphPrimitiveFocusArtifact>;
  compiledGraph: CompiledRouteGraph;
  affinityTargets: Map<string, RouteGraphAffinityTargetProjection[]>;
};

let revisionCache: RevisionWorkspaceCache | null = null;

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V, limit: number): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value!);
}

function focusKey(focus: RouteGraphFocusRef): string {
  return `${focus.kind}\u0000${focus.id}`;
}

function cacheForDraft(input: {
  revision: string;
  graph: Awaited<ReturnType<typeof getRouteGraphDraft>>['workingGraph'];
}): RevisionWorkspaceCache {
  if (revisionCache?.revision === input.revision) return revisionCache;
  revisionCache = {
    revision: input.revision,
    semanticIndex: buildRouteGraphSemanticIndex(input.graph),
    indexPages: new Map(),
    focusProjections: new Map(),
    primitiveArtifacts: new Map(),
    compiledGraph: compileRouteGraphSource(input.graph).compiled,
    affinityTargets: new Map(),
  };
  return revisionCache;
}

function affinityEndpointLabels(graph: RouteGraphSource): Map<string, string> {
  const labels = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.type !== 'route_endpoint') continue;
    const config = node.config && typeof node.config === 'object' && !Array.isArray(node.config)
      ? node.config as RouteEndpointConfig
      : null;
    for (const target of config?.targets || []) {
      if (target.executionTargetSourceRef) {
        labels.set(target.executionTargetSourceRef, node.name || node.routeEndpointId);
      }
    }
  }
  for (const macro of graph.macros || []) {
    for (const group of macro.config.groups) {
      if (group.input.kind !== 'inline_endpoints') continue;
      for (const target of group.input.endpoints) {
        if (target.executionTargetSourceRef) {
          labels.set(target.executionTargetSourceRef, macro.name || macro.id);
        }
      }
    }
  }
  return labels;
}

function projectAffinityTargets(
  cache: RevisionWorkspaceCache,
  graph: RouteGraphSource,
  focus: RouteGraphFocusRef,
): RouteGraphFocusedWorkspace['affinityTargets'] {
  const key = focusKey(focus);
  let targets = cache.affinityTargets.get(key);
  if (!targets) {
    targets = collectCompiledRouteAffinityTargets(cache.compiledGraph, focus, graph);
    cache.affinityTargets.set(key, targets);
  }
  const labels = affinityEndpointLabels(graph);
  return targets.map((target) => ({
    ...target,
    ...(labels.get(target.sourceRef) ? { endpointLabel: labels.get(target.sourceRef) } : {}),
  }));
}

export async function getRouteGraphWorkspaceRevisionContext(): Promise<{
  draft: Awaited<ReturnType<typeof getRouteGraphDraft>>;
  revision: string;
  semanticIndex: RouteGraphSemanticIndex;
}> {
  const draft = await getRouteGraphDraft();
  const revision = formatRouteGraphWorkspaceRevision(draft);
  const cache = cacheForDraft({ revision, graph: draft.workingGraph });
  return { draft, revision, semanticIndex: cache.semanticIndex };
}

export function resetRouteGraphWorkspaceQueryCacheForTests(): void {
  revisionCache = null;
}

export async function getRouteGraphWorkspaceIndexPage(
  input: RouteGraphWorkspaceIndexFilters = {},
): Promise<RouteGraphWorkspaceIndexPage> {
  const { draft, revision, semanticIndex } = await getRouteGraphWorkspaceRevisionContext();
  const cache = cacheForDraft({ revision, graph: draft.workingGraph });
  const key = JSON.stringify(input);
  const existing = cache.indexPages.get(key);
  if (existing) return structuredClone(existing);
  const page = buildRouteGraphWorkspaceIndexPage(
    draft.workingGraph,
    draft.diagnostics,
    revision,
    input,
    semanticIndex,
  );
  boundedSet(cache.indexPages, key, page, INDEX_PAGE_CACHE_LIMIT);
  return structuredClone(page);
}

export async function getRouteGraphFocusedWorkspace(input: {
  focus: RouteGraphFocusRef;
  representation: RouteGraphWorkspaceRepresentation;
  windowToken?: string | null;
}): Promise<RouteGraphFocusedWorkspace> {
  const { draft, revision } = await getRouteGraphWorkspaceRevisionContext();
  const cache = cacheForDraft({ revision, graph: draft.workingGraph });
  const projectionKey = JSON.stringify(input);
  const existing = cache.focusProjections.get(projectionKey);
  if (existing) return structuredClone(existing);

  let workspace: RouteGraphFocusedWorkspace;
  if (input.representation === 'primitive') {
    const artifactKey = focusKey(input.focus);
    let artifact = cache.primitiveArtifacts.get(artifactKey);
    if (!artifact) {
      artifact = lowerRouteGraphPrimitiveFocus({
        graph: draft.workingGraph,
        diagnostics: draft.diagnostics,
        focus: input.focus,
      });
      boundedSet(cache.primitiveArtifacts, artifactKey, artifact, PRIMITIVE_ARTIFACT_CACHE_LIMIT);
    }
    workspace = projectRouteGraphPrimitiveFocusArtifact({
      artifact,
      revision,
      focus: input.focus,
      windowToken: input.windowToken || undefined,
    });
  } else {
    workspace = buildRouteGraphFocusedWorkspace({
      graph: draft.workingGraph,
      diagnostics: draft.diagnostics,
      revision,
      focus: input.focus,
      representation: 'semantic',
      windowToken: input.windowToken || undefined,
      semanticIndex: cache.semanticIndex,
    });
  }
  workspace.affinityTargets = projectAffinityTargets(cache, draft.workingGraph, input.focus);
  boundedSet(cache.focusProjections, projectionKey, workspace, FOCUS_PROJECTION_CACHE_LIMIT);
  return structuredClone(workspace);
}
