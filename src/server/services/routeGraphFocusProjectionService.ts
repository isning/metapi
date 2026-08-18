import { stableRoutingIdentityHash } from '../../shared/routingIdentity.js';
import {
  getRouteGraphPortConnectionBounds,
} from '../../shared/routeGraph.js';
import type {
  RouteGraphDiagnostic,
  RouteGraphEdge,
  RouteGraphEdgeKind,
  RouteGraphPort,
  RouteGraphSource,
} from '../../shared/routeGraph.js';
import type {
  RouteGraphElementRef,
  RouteGraphFocusedWorkspace,
  RouteGraphFocusRef,
  RouteGraphWorkspacePortal,
  RouteGraphWorkspaceRepresentation,
} from '../../shared/routeGraphWorkspace.js';
import {
  buildRouteGraphSemanticIndex,
  routeGraphSemanticElementLabel,
  type RouteGraphSemanticIndex,
} from './routeGraphWorkspaceIndexService.js';

const DEFAULT_COLLECTION_WINDOW_SIZE = 24;
const MAX_COLLECTION_WINDOW_SIZE = 100;
const MAX_RESIDENT_ELEMENTS = 180;
const MAX_RESIDENT_EDGES = 360;

type CollectionWindow = {
  offset: number;
  size: number;
};

export type RouteGraphWorkspaceWindowTokenState = {
  revision: string;
  focus: RouteGraphFocusRef;
  representation: RouteGraphWorkspaceRepresentation;
  collections: Record<string, CollectionWindow>;
};

type WindowTokenEnvelope = {
  state: RouteGraphWorkspaceWindowTokenState;
  checksum: string;
};

type CollectionGroup = {
  key: string;
  ownerElementId: string;
  owner: RouteGraphElementRef;
  portId: string;
  portLabel: string;
  direction: RouteGraphWorkspacePortal['direction'];
  edgeKind: RouteGraphEdgeKind;
  edges: RouteGraphEdge[];
};

type PortalAccumulator = RouteGraphWorkspacePortal;

export class RouteGraphWorkspaceFocusNotFoundError extends Error {
  readonly code = 'focus_not_found';

  constructor(readonly focus: RouteGraphFocusRef) {
    super(`Route graph focus ${focus.kind}:${focus.id} was not found.`);
    this.name = 'RouteGraphWorkspaceFocusNotFoundError';
  }
}

export class RouteGraphWorkspaceWindowTokenError extends Error {
  readonly code = 'invalid_window_token';

  constructor() {
    super('The route graph workspace window token is invalid or stale.');
    this.name = 'RouteGraphWorkspaceWindowTokenError';
  }
}

function focusKey(ref: RouteGraphElementRef): string {
  return `${ref.kind}\u0000${ref.id}`;
}

function tokenChecksum(state: RouteGraphWorkspaceWindowTokenState): string {
  return stableRoutingIdentityHash(state);
}

export function encodeRouteGraphWorkspaceWindowToken(state: RouteGraphWorkspaceWindowTokenState): string {
  const envelope: WindowTokenEnvelope = { state, checksum: tokenChecksum(state) };
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
}

function isFocusRef(value: unknown): value is RouteGraphFocusRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Partial<RouteGraphFocusRef>;
  return (ref.kind === 'macro' || ref.kind === 'node') && typeof ref.id === 'string' && ref.id.length > 0;
}

function isCollectionWindows(value: unknown): value is Record<string, CollectionWindow> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((window) => {
    if (!window || typeof window !== 'object' || Array.isArray(window)) return false;
    const candidate = window as Partial<CollectionWindow>;
    return Number.isInteger(candidate.offset)
      && Number(candidate.offset) >= 0
      && Number.isInteger(candidate.size)
      && Number(candidate.size) > 0
      && Number(candidate.size) <= MAX_COLLECTION_WINDOW_SIZE;
  });
}

export function decodeRouteGraphWorkspaceWindowToken(input: string): RouteGraphWorkspaceWindowTokenState | null {
  try {
    const envelope = JSON.parse(Buffer.from(input, 'base64url').toString('utf8')) as Partial<WindowTokenEnvelope>;
    const state = envelope.state as Partial<RouteGraphWorkspaceWindowTokenState> | undefined;
    if (
      !state
      || typeof state.revision !== 'string'
      || !isFocusRef(state.focus)
      || (state.representation !== 'semantic' && state.representation !== 'primitive')
      || !isCollectionWindows(state.collections)
      || envelope.checksum !== tokenChecksum(state as RouteGraphWorkspaceWindowTokenState)
    ) return null;
    return state as RouteGraphWorkspaceWindowTokenState;
  } catch {
    return null;
  }
}

function resolveWindowState(input: {
  revision: string;
  focus: RouteGraphFocusRef;
  representation: RouteGraphWorkspaceRepresentation;
  windowToken?: string;
}): RouteGraphWorkspaceWindowTokenState {
  if (!input.windowToken) {
    return {
      revision: input.revision,
      focus: input.focus,
      representation: input.representation,
      collections: {},
    };
  }
  const decoded = decodeRouteGraphWorkspaceWindowToken(input.windowToken);
  if (
    !decoded
    || decoded.revision !== input.revision
    || focusKey(decoded.focus) !== focusKey(input.focus)
    || decoded.representation !== input.representation
  ) throw new RouteGraphWorkspaceWindowTokenError();
  return decoded;
}

function elementIdForFocus(index: RouteGraphSemanticIndex, focus: RouteGraphFocusRef): string | null {
  if (focus.kind === 'node') return index.elementsById.has(focus.id) ? focus.id : null;
  const semanticFocus = index.focusByKey.get(focusKey(focus));
  return semanticFocus?.element.elementId || null;
}

function portForElement(index: RouteGraphSemanticIndex, elementId: string, portId: string): RouteGraphPort | null {
  return index.portsByElementId.get(elementId)?.get(portId) || null;
}

function collectionDescriptorForEdge(index: RouteGraphSemanticIndex, edge: RouteGraphEdge): Omit<CollectionGroup, 'key' | 'edges'> | null {
  const targetPort = portForElement(index, edge.targetNodeId, edge.targetPortId);
  if (getRouteGraphPortConnectionBounds(targetPort).collection) {
    return {
      ownerElementId: edge.targetNodeId,
      owner: index.elementsById.get(edge.targetNodeId)!.ref,
      portId: edge.targetPortId,
      portLabel: targetPort?.label || edge.targetPortId,
      direction: 'incoming',
      edgeKind: edge.kind,
    };
  }
  const sourcePort = portForElement(index, edge.sourceNodeId, edge.sourcePortId);
  if (getRouteGraphPortConnectionBounds(sourcePort).collection) {
    return {
      ownerElementId: edge.sourceNodeId,
      owner: index.elementsById.get(edge.sourceNodeId)!.ref,
      portId: edge.sourcePortId,
      portLabel: sourcePort?.label || edge.sourcePortId,
      direction: 'outgoing',
      edgeKind: edge.kind,
    };
  }
  return null;
}

function collectionKey(descriptor: Omit<CollectionGroup, 'key' | 'edges'>): string {
  return `collection:${stableRoutingIdentityHash({
    owner: descriptor.owner,
    portId: descriptor.portId,
    direction: descriptor.direction,
    edgeKind: descriptor.edgeKind,
  })}`;
}

function buildCollectionGroups(index: RouteGraphSemanticIndex): {
  groupsByKey: Map<string, CollectionGroup>;
  groupKeyByEdgeId: Map<string, string>;
} {
  const groupsByKey = new Map<string, CollectionGroup>();
  const groupKeyByEdgeId = new Map<string, string>();
  for (const edge of index.graph.edges) {
    const descriptor = collectionDescriptorForEdge(index, edge);
    if (!descriptor) continue;
    const key = collectionKey(descriptor);
    const existing = groupsByKey.get(key);
    if (existing) existing.edges.push(edge);
    else groupsByKey.set(key, { key, ...descriptor, edges: [edge] });
    groupKeyByEdgeId.set(edge.id, key);
  }
  return { groupsByKey, groupKeyByEdgeId };
}

function otherElementId(edge: RouteGraphEdge, currentElementId: string): string {
  return edge.sourceNodeId === currentElementId ? edge.targetNodeId : edge.sourceNodeId;
}

function edgeDirection(edge: RouteGraphEdge, residentElementId: string): RouteGraphWorkspacePortal['direction'] {
  return edge.sourceNodeId === residentElementId ? 'outgoing' : 'incoming';
}

function residentPortId(edge: RouteGraphEdge, residentElementId: string): string {
  return edge.sourceNodeId === residentElementId ? edge.sourcePortId : edge.targetPortId;
}

function destinationPortId(edge: RouteGraphEdge, residentElementId: string): string {
  return edge.sourceNodeId === residentElementId ? edge.targetPortId : edge.sourcePortId;
}

function portalId(kind: RouteGraphWorkspacePortal['kind'], identity: unknown): string {
  return `portal:${kind}:${stableRoutingIdentityHash(identity)}`;
}

function withCollectionWindow(
  state: RouteGraphWorkspaceWindowTokenState,
  key: string,
  window: CollectionWindow,
): RouteGraphWorkspaceWindowTokenState {
  return {
    ...state,
    collections: {
      ...state.collections,
      [key]: window,
    },
  };
}

function addCollectionPortals(
  portals: Map<string, PortalAccumulator>,
  group: CollectionGroup,
  window: CollectionWindow,
  total: number,
  state: RouteGraphWorkspaceWindowTokenState,
): void {
  const start = Math.min(window.offset, Math.max(0, total - 1));
  const end = Math.min(total, start + window.size);
  if (start > 0) {
    const previousStart = Math.max(0, start - window.size);
    const identity = { group: group.key, action: 'previous', start: previousStart, end: start, state };
    const id = portalId('collection', identity);
    portals.set(id, {
      id,
      kind: 'collection',
      direction: group.direction,
      resident: { element: group.owner, portId: group.portId },
      label: `${start} previous connections`,
      connection: { edgeKind: group.edgeKind, count: start, portLabel: group.portLabel },
      collection: { action: 'previous', start: previousStart, end: start, total },
      destination: {
        kind: 'window',
        token: encodeRouteGraphWorkspaceWindowToken(withCollectionWindow(state, group.key, {
          offset: previousStart,
          size: window.size,
        })),
      },
    });
  }
  if (end < total) {
    const remaining = total - end;
    const nextEnd = Math.min(total, end + window.size);
    const identity = { group: group.key, action: 'next', start: end, end: nextEnd, state };
    const id = portalId('collection', identity);
    portals.set(id, {
      id,
      kind: 'collection',
      direction: group.direction,
      resident: { element: group.owner, portId: group.portId },
      label: `${remaining} more connections`,
      connection: { edgeKind: group.edgeKind, count: remaining, portLabel: group.portLabel },
      collection: { action: 'next', start: end, end: nextEnd, total },
      destination: {
        kind: 'window',
        token: encodeRouteGraphWorkspaceWindowToken(withCollectionWindow(state, group.key, {
          offset: end,
          size: window.size,
        })),
      },
    });
  }
}

function addBoundaryPortal(input: {
  portals: Map<string, PortalAccumulator>;
  kind: 'neighbor' | 'overflow';
  edge: RouteGraphEdge;
  residentElementId: string;
  destinationElementId: string;
  index: RouteGraphSemanticIndex;
}): void {
  const residentElement = input.index.elementsById.get(input.residentElementId)!;
  const destinationElement = input.index.elementsById.get(input.destinationElementId)!;
  const destinationSource = destinationElement.macro || destinationElement.node!;
  const direction = edgeDirection(input.edge, input.residentElementId);
  const portId = residentPortId(input.edge, input.residentElementId);
  const remotePortId = destinationPortId(input.edge, input.residentElementId);
  const identity = {
    kind: input.kind,
    resident: residentElement.ref,
    destination: destinationElement.ref,
    direction,
    portId,
    remotePortId,
    edgeKind: input.edge.kind,
  };
  const id = portalId(input.kind, identity);
  const existing = input.portals.get(id);
  if (existing) {
    existing.connection.count += 1;
    if (existing.kind !== 'collection') existing.connection.edges.push({
      id: input.edge.id,
      destinationPortId: remotePortId,
      ownership: input.edge.ownership,
    });
    return;
  }
  input.portals.set(id, {
    id,
    kind: input.kind,
    direction,
    resident: { element: residentElement.ref, portId },
    label: routeGraphSemanticElementLabel(destinationElement),
    connection: {
      edgeKind: input.edge.kind,
      count: 1,
      portLabel: portForElement(input.index, input.residentElementId, portId)?.label || portId,
      edges: [{
        id: input.edge.id,
        destinationPortId: remotePortId,
        ownership: input.edge.ownership,
      }],
    },
    preview: {
      elementKind: destinationElement.macro ? 'macro' : destinationElement.node!.type,
      subtitle: destinationElement.macro?.kind || null,
      enabled: destinationSource.enabled !== false,
    },
    destination: { kind: 'focus', focus: destinationElement.ref },
  });
}

export function collectRouteGraphFocusClosure(
  startElementId: string,
  index: RouteGraphSemanticIndex,
  stopAtTraversalBoundaries: boolean,
): { elementIds: Set<string>; edgeIds: Set<string> } {
  const elementIds = new Set([startElementId]);
  const edgeIds = new Set<string>();
  const queue = [startElementId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of index.edgesByElementId.get(current) || []) {
      const next = otherElementId(edge, current);
      edgeIds.add(edge.id);
      if (stopAtTraversalBoundaries && next !== startElementId && index.traversalBoundaryByElementId.has(next)) continue;
      if (elementIds.has(next)) continue;
      elementIds.add(next);
      queue.push(next);
    }
  }
  return { elementIds, edgeIds };
}

export function filterRouteGraphDiagnosticsForClosure(
  diagnostics: readonly RouteGraphDiagnostic[],
  closure: { elementIds: ReadonlySet<string>; edgeIds: ReadonlySet<string> },
): RouteGraphDiagnostic[] {
  return diagnostics.filter((diagnostic) => {
    if (!diagnostic.nodeId && !diagnostic.edgeId) return true;
    return (diagnostic.nodeId ? closure.elementIds.has(diagnostic.nodeId) : false)
      || (diagnostic.edgeId ? closure.edgeIds.has(diagnostic.edgeId) : false);
  });
}

function normalizeCollectionWindowSize(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_COLLECTION_WINDOW_SIZE;
  return Math.max(1, Math.min(MAX_COLLECTION_WINDOW_SIZE, Math.trunc(numeric)));
}

export function projectRouteGraphFocusedGraphWindow(input: {
  graph: RouteGraphSource;
  diagnostics: readonly RouteGraphDiagnostic[];
  revision: string;
  focus: RouteGraphFocusRef;
  representation: RouteGraphWorkspaceRepresentation;
  startElementId?: string;
  focusLabel?: string;
  focusSubtitle?: string | null;
  stopAtTraversalBoundaries?: boolean;
  editable?: boolean;
  primitiveAvailable?: boolean;
  totals?: RouteGraphFocusedWorkspace['totals'];
  windowToken?: string;
  collectionWindowSize?: number;
  semanticIndex?: RouteGraphSemanticIndex;
}): RouteGraphFocusedWorkspace {
  const index = input.semanticIndex || buildRouteGraphSemanticIndex(input.graph);
  const startElementId = input.startElementId || elementIdForFocus(index, input.focus);
  if (!startElementId) throw new RouteGraphWorkspaceFocusNotFoundError(input.focus);
  const startElement = index.elementsById.get(startElementId)!;
  if (!startElement) throw new RouteGraphWorkspaceFocusNotFoundError(input.focus);
  const stopAtTraversalBoundaries = input.stopAtTraversalBoundaries !== false;
  const windowState = resolveWindowState(input);
  const defaultWindowSize = normalizeCollectionWindowSize(input.collectionWindowSize);
  const { groupsByKey, groupKeyByEdgeId } = buildCollectionGroups(index);
  const processedCollectionGroups = new Set<string>();
  const processedEdges = new Set<string>();
  const residentElementIds = new Set([startElementId]);
  const residentEdgeIds = new Set<string>();
  const portals = new Map<string, PortalAccumulator>();
  const queue = [startElementId];

  const traverseEdge = (edge: RouteGraphEdge, currentElementId: string): void => {
    if (processedEdges.has(edge.id)) return;
    processedEdges.add(edge.id);
    const nextElementId = otherElementId(edge, currentElementId);
    if (stopAtTraversalBoundaries && nextElementId !== startElementId && index.traversalBoundaryByElementId.has(nextElementId)) {
      addBoundaryPortal({
        portals,
        kind: 'neighbor',
        edge,
        residentElementId: currentElementId,
        destinationElementId: nextElementId,
        index,
      });
      return;
    }
    if (!residentElementIds.has(nextElementId) && residentElementIds.size >= MAX_RESIDENT_ELEMENTS) {
      addBoundaryPortal({
        portals,
        kind: 'overflow',
        edge,
        residentElementId: currentElementId,
        destinationElementId: nextElementId,
        index,
      });
      return;
    }
    if (residentEdgeIds.size >= MAX_RESIDENT_EDGES) {
      addBoundaryPortal({
        portals,
        kind: 'overflow',
        edge,
        residentElementId: currentElementId,
        destinationElementId: nextElementId,
        index,
      });
      return;
    }
    residentEdgeIds.add(edge.id);
    if (!residentElementIds.has(nextElementId)) {
      residentElementIds.add(nextElementId);
      queue.push(nextElementId);
    }
  };

  while (queue.length > 0) {
    const currentElementId = queue.shift()!;
    for (const edge of index.edgesByElementId.get(currentElementId) || []) {
      if (processedEdges.has(edge.id)) continue;
      const groupKey = groupKeyByEdgeId.get(edge.id);
      const group = groupKey ? groupsByKey.get(groupKey) : null;
      if (group && group.ownerElementId === currentElementId) {
        if (processedCollectionGroups.has(group.key)) continue;
        processedCollectionGroups.add(group.key);
        const tokenWindow = windowState.collections[group.key];
        const window = tokenWindow || { offset: 0, size: defaultWindowSize };
        const start = Math.min(window.offset, Math.max(0, group.edges.length - 1));
        const selectedEdges = group.edges.slice(start, start + window.size);
        for (const selectedEdge of selectedEdges) traverseEdge(selectedEdge, currentElementId);
        for (const omittedEdge of group.edges) {
          if (!selectedEdges.includes(omittedEdge)) processedEdges.add(omittedEdge.id);
        }
        addCollectionPortals(portals, group, { offset: start, size: window.size }, group.edges.length, windowState);
        continue;
      }
      if (group && group.ownerElementId !== currentElementId && processedCollectionGroups.has(group.key)) {
        processedEdges.add(edge.id);
        continue;
      }
      traverseEdge(edge, currentElementId);
    }
  }

  const closure = collectRouteGraphFocusClosure(startElementId, index, stopAtTraversalBoundaries);
  return {
    revision: input.revision,
    representation: input.representation,
    focus: {
      ...input.focus,
      label: input.focusLabel || routeGraphSemanticElementLabel(startElement),
      subtitle: input.focusSubtitle === undefined
        ? startElement.macro?.kind || startElement.node?.type || null
        : input.focusSubtitle,
    },
    residentGraph: {
      nodes: input.graph.nodes.filter((node) => residentElementIds.has(node.id)),
      macros: (input.graph.macros || []).filter((macro) => (
        residentElementIds.has(index.focusByKey.get(focusKey({ kind: 'macro', id: macro.id }))?.element.elementId || '')
      )),
      edges: input.graph.edges.filter((edge) => residentEdgeIds.has(edge.id)),
      metadata: input.graph.metadata,
    },
    residentElements: [...residentElementIds].map((elementId) => ({
      element: index.elementsById.get(elementId)!.ref,
      graphElementId: elementId,
    })),
    portals: [...portals.values()],
    diagnostics: filterRouteGraphDiagnosticsForClosure(input.diagnostics, closure),
    affinityTargets: [],
    totals: input.totals || {
      nodes: [...closure.elementIds].filter((elementId) => index.elementsById.get(elementId)?.node).length,
      edges: closure.edgeIds.size,
      macros: [...closure.elementIds].filter((elementId) => index.elementsById.get(elementId)?.macro).length,
    },
    capabilities: {
      editable: input.editable !== false,
      primitiveAvailable: input.primitiveAvailable !== false,
    },
  };
}

export function buildRouteGraphFocusedWorkspace(input: {
  graph: RouteGraphSource;
  diagnostics: readonly RouteGraphDiagnostic[];
  revision: string;
  focus: RouteGraphFocusRef;
  representation: 'semantic';
  windowToken?: string;
  collectionWindowSize?: number;
  semanticIndex?: RouteGraphSemanticIndex;
}): RouteGraphFocusedWorkspace {
  return projectRouteGraphFocusedGraphWindow(input);
}
