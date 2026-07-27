import type { RouteGraphEdge, RouteGraphMacro, RouteGraphNode } from './routeGraphTypes.js';
import type { RouteGraphWorkspaceOperation } from '../../../shared/routeGraphOperations.js';

/**
 * The editable portion of a graph workspace.  This intentionally lives next
 * to the workspace diff rather than importing the workbench page: helpers
 * must not depend on a top-level page module.
 */
export type RouteGraphWorkspaceSource = {
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
  macros: RouteGraphMacro[];
  metadata?: Record<string, unknown>;
};

export type RouteGraphWorkspaceFocus = {
  id: string;
  kind: 'macro' | 'node';
  label: string;
};

export type RouteGraphWorkspaceBreadcrumb = {
  key: 'root' | 'focus';
  label: string;
  current: boolean;
};

export function buildRouteGraphWorkspaceBreadcrumbs(
  focus: RouteGraphWorkspaceFocus | null,
  rootLabel: string,
): RouteGraphWorkspaceBreadcrumb[] {
  return focus
    ? [
      { key: 'root', label: rootLabel, current: false },
      { key: 'focus', label: focus.label, current: true },
    ]
    : [{ key: 'root', label: rootLabel, current: true }];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function diffById<T extends { id: string }>(
  before: T[],
  after: T[],
  upsert: (item: T) => RouteGraphWorkspaceOperation,
  remove: (id: string) => RouteGraphWorkspaceOperation,
): RouteGraphWorkspaceOperation[] {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const afterById = new Map(after.map((item) => [item.id, item]));
  const operations: RouteGraphWorkspaceOperation[] = [];
  for (const [id, item] of afterById) {
    const previous = beforeById.get(id);
    if (!previous || stableJson(previous) !== stableJson(item)) operations.push(upsert(item));
  }
  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) operations.push(remove(id));
  }
  return operations;
}

/** Produces operations only for elements resident in the current workspace. */
export function diffRouteGraphWorkspace(
  before: RouteGraphWorkspaceSource,
  after: RouteGraphWorkspaceSource,
): RouteGraphWorkspaceOperation[] {
  return [
    ...diffById(before.nodes, after.nodes, (node) => ({ kind: 'upsert_node', node }), (nodeId) => ({ kind: 'remove_node', nodeId })),
    ...diffById(before.macros, after.macros, (macro) => ({ kind: 'upsert_macro', macro }), (macroId) => ({ kind: 'remove_macro', macroId })),
    ...diffById(before.edges, after.edges, (edge) => ({ kind: 'upsert_edge', edge }), (edgeId) => ({ kind: 'remove_edge', edgeId })),
  ];
}
