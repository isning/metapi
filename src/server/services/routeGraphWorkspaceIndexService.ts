import { createRouteMacroSemanticNodeId, stableRoutingIdentityHash } from '../../shared/routingIdentity.js';
import {
  getRouteGraphMacroPorts,
  getRouteGraphNodePorts,
} from '../../shared/routeGraph.js';
import type {
  RouteGraphDiagnostic,
  RouteGraphEdge,
  RouteGraphMacro,
  RouteGraphNode,
  RouteGraphPort,
  RouteGraphSource,
} from '../../shared/routeGraph.js';
import type {
  RouteGraphElementRef,
  RouteGraphWorkspaceIndexFilters,
  RouteGraphWorkspaceIndexItem,
  RouteGraphWorkspaceIndexPage,
} from '../../shared/routeGraphWorkspace.js';

const DEFAULT_INDEX_LIMIT = 40;
const MAX_INDEX_LIMIT = 100;

type SemanticElement = {
  elementId: string;
  ref: RouteGraphElementRef;
  node: RouteGraphNode | null;
  macro: RouteGraphMacro | null;
  sourceOrder: number;
};

export type RouteGraphSemanticFocus = {
  key: string;
  element: SemanticElement;
  elementKind: RouteGraphWorkspaceIndexItem['elementKind'];
  componentElementIds: string[];
};

export type RouteGraphSemanticIndex = {
  graph: RouteGraphSource;
  elementsById: Map<string, SemanticElement>;
  portsByElementId: Map<string, Map<string, RouteGraphPort>>;
  edgesByElementId: Map<string, RouteGraphEdge[]>;
  edgeById: Map<string, RouteGraphEdge>;
  focuses: RouteGraphSemanticFocus[];
  focusByKey: Map<string, RouteGraphSemanticFocus>;
  focusByElementId: Map<string, RouteGraphSemanticFocus>;
  focusesByElementId: Map<string, RouteGraphSemanticFocus[]>;
  traversalBoundaryByElementId: Map<string, SemanticElement>;
};

type IndexCursor = {
  revision: string;
  filtersHash: string;
  label: string;
  kind: RouteGraphElementRef['kind'];
  id: string;
};

export class RouteGraphWorkspaceIndexCursorError extends Error {
  constructor(readonly code: 'invalid_workspace_index_cursor' | 'stale_workspace_index_cursor') {
    super(code);
    this.name = 'RouteGraphWorkspaceIndexCursorError';
  }
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function focusKey(ref: RouteGraphElementRef): string {
  return `${ref.kind}\u0000${ref.id}`;
}

function macroLabel(macro: RouteGraphMacro): string {
  const entry = macro.config?.surface?.entry;
  const match = entry?.kind === 'external' ? entry.match : null;
  return normalizedText(match?.displayName)
    || normalizedText(match?.requestedModelPattern)
    || normalizedText(macro.name)
    || macro.id;
}

function nodeLabel(node: RouteGraphNode): string {
  if (node.type === 'entry') {
    return normalizedText(node.match?.displayName)
      || normalizedText(node.match?.requestedModelPattern)
      || normalizedText(node.name)
      || node.id;
  }
  return normalizedText(node.name) || node.id;
}

export function routeGraphSemanticElementLabel(element: SemanticElement): string {
  return element.macro ? macroLabel(element.macro) : nodeLabel(element.node!);
}

function appendMapArray<T>(map: Map<string, T[]>, key: string, value: T): void {
  const current = map.get(key);
  if (current) current.push(value);
  else map.set(key, [value]);
}

function buildElements(graph: RouteGraphSource): Map<string, SemanticElement> {
  const elements = new Map<string, SemanticElement>();
  let sourceOrder = 0;
  for (const macro of graph.macros || []) {
    const elementId = createRouteMacroSemanticNodeId(macro.id);
    elements.set(elementId, {
      elementId,
      ref: { kind: 'macro', id: macro.id },
      node: null,
      macro,
      sourceOrder: sourceOrder++,
    });
  }
  for (const node of graph.nodes) {
    elements.set(node.id, {
      elementId: node.id,
      ref: { kind: 'node', id: node.id },
      node,
      macro: null,
      sourceOrder: sourceOrder++,
    });
  }
  return elements;
}

function buildPortIndexes(elementsById: ReadonlyMap<string, SemanticElement>): Map<string, Map<string, RouteGraphPort>> {
  const portsByElementId = new Map<string, Map<string, RouteGraphPort>>();
  for (const element of elementsById.values()) {
    const ports = element.macro
      ? getRouteGraphMacroPorts(element.macro)
      : getRouteGraphNodePorts(element.node);
    portsByElementId.set(element.elementId, new Map(ports.map((port) => [port.id, port])));
  }
  return portsByElementId;
}

function buildEdgeIndexes(graph: RouteGraphSource, elementsById: ReadonlyMap<string, SemanticElement>): {
  edgesByElementId: Map<string, RouteGraphEdge[]>;
  edgeById: Map<string, RouteGraphEdge>;
} {
  const edgesByElementId = new Map<string, RouteGraphEdge[]>();
  const edgeById = new Map<string, RouteGraphEdge>();
  for (const edge of graph.edges) {
    edgeById.set(edge.id, edge);
    if (!elementsById.has(edge.sourceNodeId) || !elementsById.has(edge.targetNodeId)) continue;
    appendMapArray(edgesByElementId, edge.sourceNodeId, edge);
    appendMapArray(edgesByElementId, edge.targetNodeId, edge);
  }
  return { edgesByElementId, edgeById };
}

function nodeSemanticRank(node: RouteGraphNode): number {
  if (node.type === 'entry') return 0;
  if (node.type === 'dispatcher') return 1;
  if (node.type === 'filter') return 2;
  if (node.type === 'route_endpoint') return 3;
  return 4;
}

function connectedComponents(
  elementsById: ReadonlyMap<string, SemanticElement>,
  edgesByElementId: ReadonlyMap<string, RouteGraphEdge[]>,
): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const elementId of elementsById.keys()) {
    if (visited.has(elementId)) continue;
    const component: string[] = [];
    const queue = [elementId];
    visited.add(elementId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const edge of edgesByElementId.get(current) || []) {
        const next = edge.sourceNodeId === current ? edge.targetNodeId : edge.sourceNodeId;
        if (!elementsById.has(next) || visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

function isNaturalFocus(element: SemanticElement): boolean {
  if (element.macro) return true;
  return element.node?.type === 'entry'
    && element.node.ownership !== 'derived';
}

function chooseResidualFocus(
  component: readonly string[],
  elementsById: ReadonlyMap<string, SemanticElement>,
): SemanticElement {
  return component
    .map((elementId) => elementsById.get(elementId)!)
    .filter((element) => element.node)
    .sort((left, right) => (
      nodeSemanticRank(left.node!) - nodeSemanticRank(right.node!)
      || left.sourceOrder - right.sourceOrder
      || left.elementId.localeCompare(right.elementId)
    ))[0]!;
}

export function buildRouteGraphSemanticIndex(graph: RouteGraphSource): RouteGraphSemanticIndex {
  const elementsById = buildElements(graph);
  const portsByElementId = buildPortIndexes(elementsById);
  const { edgesByElementId, edgeById } = buildEdgeIndexes(graph, elementsById);
  const components = connectedComponents(elementsById, edgesByElementId);
  const focuses: RouteGraphSemanticFocus[] = [];
  const focusByKey = new Map<string, RouteGraphSemanticFocus>();
  const focusByElementId = new Map<string, RouteGraphSemanticFocus>();
  const focusesByElementId = new Map<string, RouteGraphSemanticFocus[]>();
  const traversalBoundaryByElementId = new Map<string, SemanticElement>();

  for (const element of elementsById.values()) {
    if (isNaturalFocus(element)) traversalBoundaryByElementId.set(element.elementId, element);
  }

  for (const component of components) {
    const naturalFocuses = component
      .map((elementId) => elementsById.get(elementId)!)
      .filter(isNaturalFocus);
    const componentFocuses = naturalFocuses.length > 0
      ? naturalFocuses.map((element) => ({
        key: focusKey(element.ref),
        element,
        elementKind: element.macro ? 'macro' as const : 'entry' as const,
        componentElementIds: [...component],
      }))
      : (() => {
        const element = chooseResidualFocus(component, elementsById);
        return [{
          key: focusKey(element.ref),
          element,
          elementKind: 'component' as const,
          componentElementIds: [...component],
        }];
      })();

    for (const focus of componentFocuses) {
      focuses.push(focus);
      focusByKey.set(focus.key, focus);
      focusByElementId.set(focus.element.elementId, focus);
    }
    for (const elementId of component) {
      focusesByElementId.set(elementId, componentFocuses);
    }
  }

  return {
    graph,
    elementsById,
    portsByElementId,
    edgesByElementId,
    edgeById,
    focuses,
    focusByKey,
    focusByElementId,
    focusesByElementId,
    traversalBoundaryByElementId,
  };
}

function aggregateStatus(focus: RouteGraphSemanticFocus, index: RouteGraphSemanticIndex): RouteGraphWorkspaceIndexItem['status'] {
  const elements = focus.elementKind === 'component'
    ? focus.componentElementIds.map((elementId) => index.elementsById.get(elementId)!)
    : [focus.element];
  const enabledCount = elements.filter((element) => (element.macro || element.node)?.enabled !== false).length;
  if (enabledCount === 0) return 'disabled';
  if (enabledCount === elements.length) return 'enabled';
  return 'mixed';
}

function aggregateOwnership(focus: RouteGraphSemanticFocus, index: RouteGraphSemanticIndex): RouteGraphWorkspaceIndexItem['ownership'] {
  const elements = focus.elementKind === 'component'
    ? focus.componentElementIds.map((elementId) => index.elementsById.get(elementId)!)
    : [focus.element];
  const values = new Set(elements.map((element) => (element.macro || element.node)?.ownership));
  if (values.size !== 1) return 'mixed';
  return values.has('manual') ? 'manual' : 'system';
}

function focusesForDiagnostic(
  diagnostic: RouteGraphDiagnostic,
  index: RouteGraphSemanticIndex,
): RouteGraphSemanticFocus[] {
  if (diagnostic.nodeId) {
    const direct = index.focusByElementId.get(diagnostic.nodeId);
    if (direct) return [direct];
    const componentFocuses = index.focusesByElementId.get(diagnostic.nodeId);
    if (componentFocuses) return componentFocuses;
  }
  if (diagnostic.edgeId) {
    const edge = index.edgeById.get(diagnostic.edgeId);
    if (edge) {
      const direct = [edge.sourceNodeId, edge.targetNodeId]
        .map((elementId) => index.focusByElementId.get(elementId))
        .filter((focus): focus is RouteGraphSemanticFocus => !!focus);
      if (direct.length > 0) return Array.from(new Map(direct.map((focus) => [focus.key, focus])).values());
      return index.focusesByElementId.get(edge.sourceNodeId)
        || index.focusesByElementId.get(edge.targetNodeId)
        || [];
    }
  }
  return [];
}

function buildDiagnosticCounts(
  diagnostics: readonly RouteGraphDiagnostic[],
  index: RouteGraphSemanticIndex,
): Map<string, { errors: number; warnings: number }> {
  const counts = new Map<string, { errors: number; warnings: number }>();
  for (const diagnostic of diagnostics) {
    for (const focus of focusesForDiagnostic(diagnostic, index)) {
      const current = counts.get(focus.key) || { errors: 0, warnings: 0 };
      if (diagnostic.severity === 'error') current.errors += 1;
      else current.warnings += 1;
      counts.set(focus.key, current);
    }
  }
  return counts;
}

function subtitleForFocus(focus: RouteGraphSemanticFocus): string | null {
  if (focus.elementKind === 'macro') return focus.element.macro?.kind || null;
  if (focus.elementKind === 'entry') return focus.element.node?.type || null;
  return focus.element.node?.type || null;
}

function itemForFocus(
  focus: RouteGraphSemanticFocus,
  index: RouteGraphSemanticIndex,
  diagnosticCounts: ReadonlyMap<string, { errors: number; warnings: number }>,
): RouteGraphWorkspaceIndexItem {
  const counts = diagnosticCounts.get(focus.key) || { errors: 0, warnings: 0 };
  return {
    focus: focus.element.ref,
    label: routeGraphSemanticElementLabel(focus.element),
    subtitle: subtitleForFocus(focus),
    elementKind: focus.elementKind,
    status: aggregateStatus(focus, index),
    ownership: aggregateOwnership(focus, index),
    counts: {
      directConnections: index.edgesByElementId.get(focus.element.elementId)?.length || 0,
      ...counts,
    },
  };
}

function normalizeFilters(input: RouteGraphWorkspaceIndexFilters): Required<Omit<RouteGraphWorkspaceIndexFilters, 'cursor' | 'limit'>> {
  return {
    query: normalizedText(input.query).toLocaleLowerCase(),
    elementKind: input.elementKind || null,
    ownership: input.ownership || null,
    diagnosticState: input.diagnosticState || 'all',
  };
}

function itemMatchesFilters(
  item: RouteGraphWorkspaceIndexItem,
  filters: ReturnType<typeof normalizeFilters>,
): boolean {
  if (filters.query && !`${item.label}\n${item.subtitle || ''}\n${item.focus.id}`.toLocaleLowerCase().includes(filters.query)) return false;
  if (filters.elementKind && item.elementKind !== filters.elementKind) return false;
  if (filters.ownership && item.ownership !== filters.ownership) return false;
  if (filters.diagnosticState === 'issues' && item.counts.errors + item.counts.warnings === 0) return false;
  if (filters.diagnosticState === 'errors' && item.counts.errors === 0) return false;
  if (filters.diagnosticState === 'warnings' && item.counts.warnings === 0) return false;
  return true;
}

function compareItems(left: RouteGraphWorkspaceIndexItem, right: RouteGraphWorkspaceIndexItem): number {
  return left.label.localeCompare(right.label)
    || left.focus.kind.localeCompare(right.focus.kind)
    || left.focus.id.localeCompare(right.focus.id);
}

function encodeCursor(cursor: IndexCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(input: string | null | undefined): IndexCursor | null {
  if (!input) return null;
  try {
    const value = JSON.parse(Buffer.from(input, 'base64url').toString('utf8')) as Partial<IndexCursor>;
    if (
      typeof value.revision !== 'string'
      || typeof value.filtersHash !== 'string'
      || typeof value.label !== 'string'
      || (value.kind !== 'macro' && value.kind !== 'node')
      || typeof value.id !== 'string'
    ) throw new RouteGraphWorkspaceIndexCursorError('invalid_workspace_index_cursor');
    return value as IndexCursor;
  } catch {
    throw new RouteGraphWorkspaceIndexCursorError('invalid_workspace_index_cursor');
  }
}

function isAfterCursor(item: RouteGraphWorkspaceIndexItem, cursor: IndexCursor): boolean {
  return compareItems(item, {
    focus: { kind: cursor.kind, id: cursor.id },
    label: cursor.label,
  } as RouteGraphWorkspaceIndexItem) > 0;
}

export function buildRouteGraphWorkspaceIndexPage(
  graph: RouteGraphSource,
  diagnostics: readonly RouteGraphDiagnostic[],
  revision: string,
  input: RouteGraphWorkspaceIndexFilters = {},
  semanticIndex = buildRouteGraphSemanticIndex(graph),
): RouteGraphWorkspaceIndexPage {
  const filters = normalizeFilters(input);
  const filtersHash = stableRoutingIdentityHash(filters);
  const diagnosticCounts = buildDiagnosticCounts(diagnostics, semanticIndex);
  const items = semanticIndex.focuses
    .map((focus) => itemForFocus(focus, semanticIndex, diagnosticCounts))
    .filter((item) => itemMatchesFilters(item, filters))
    .sort(compareItems);
  const cursor = decodeCursor(input.cursor);
  if (cursor && (cursor.revision !== revision || cursor.filtersHash !== filtersHash)) {
    throw new RouteGraphWorkspaceIndexCursorError('stale_workspace_index_cursor');
  }
  const startIndex = cursor
    ? Math.max(0, items.findIndex((item) => isAfterCursor(item, cursor)))
    : 0;
  const numericLimit = Number(input.limit);
  const limit = Number.isFinite(numericLimit)
    ? Math.max(1, Math.min(MAX_INDEX_LIMIT, Math.trunc(numericLimit)))
    : DEFAULT_INDEX_LIMIT;
  const pageItems = items.slice(startIndex, startIndex + limit);
  const last = pageItems.at(-1);
  const nextCursor = last && startIndex + pageItems.length < items.length
    ? encodeCursor({
      revision,
      filtersHash,
      label: last.label,
      kind: last.focus.kind,
      id: last.focus.id,
    })
    : null;

  return {
    revision,
    summary: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      macros: (graph.macros || []).length,
      focuses: semanticIndex.focuses.length,
      errors: diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
      warnings: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
    },
    items: pageItems,
    nextCursor,
    totalCount: items.length,
  };
}
