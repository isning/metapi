import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
  useUpdateNodeInternals,
} from '@xyflow/react';
import {
  ArrowLeftToLine,
  Boxes,
  ChevronRight,
  CircleDot,
  DoorOpen,
  GitFork,
  Layers3,
  Link2,
  OctagonX,
  Sparkles,
  TriangleAlert,
  Workflow,
} from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import '@xyflow/react/dist/style.css';
import {
  getRouteGraphMacroPorts,
  getRouteGraphNodePorts,
  canAttachManualRouteGraphEdge,
  type RouteGraphPort,
} from '../../../shared/routeGraph.js';
import type {
  RouteGraphFocusedWorkspace,
  RouteGraphElementRef,
  RouteGraphWorkspaceConnectionEndpointRef,
  RouteGraphWorkspacePortal,
} from '../../../shared/routeGraphWorkspace.js';
import { useToast } from '../../components/Toast.js';
import { Badge } from '../../components/ui/badge/index.js';
import { Button } from '../../components/ui/button/index.js';
import { tr } from '../../i18n.js';
import RouteGraphNodeMenu from './RouteGraphNodeMenu.js';
import type { RouteGraphFocusSelection } from './RouteGraphFocusInspector.js';
import { ROUTE_GRAPH_VISUAL_COLORS, getNodeDefinitionTitle } from './routeGraphRegistry.js';
import {
  getPortCollectionKind,
  getPortDisplayLabel,
  getPortKindDisplayLabel,
  getPortTypeSignature,
} from './routeGraphPortPresentation.js';
import {
  getEndpointKindLabel,
  getEndpointResolutionStatusLabel,
  getEndpointSourceKindLabel,
  getNodeCardMetrics,
  getNodeCardSubtitle,
} from './routeGraphViewModel.js';
import { findAvailableRouteGraphPosition } from './routeGraphWorkspaceAuthoring.js';
import type { RouteGraphWorkspaceSource } from './routeGraphWorkspace.js';
import type { RouteGraphEdge, RouteGraphMacro, RouteGraphNode } from './routeGraphTypes.js';

const RESIDENT_WIDTH = 264;
const RESIDENT_MIN_HEIGHT = 126;
const PORTAL_WIDTH = 236;
const COLLECTION_PORTAL_HEIGHT = 72;
const BOUNDARY_PORTAL_HEIGHT = 92;
const COLUMN_GAP = 356;
const ROW_GAP = 184;
const VIEWPORT_CACHE_LIMIT = 40;
const EMPTY_DIAGNOSTIC_COUNTS = { errors: 0, warnings: 0 } as const;

type ResidentNodeData = {
  kind: 'node';
  item: RouteGraphNode;
  title: string;
  typeLabel: string;
  subtitle: string;
  accent: string;
  contextBadges: Array<{ label: string; state?: 'success' | 'warning' | 'danger' }>;
  metrics: string[];
  diagnostics: { errors: number; warnings: number };
  ports: RouteGraphPort[];
  element: RouteGraphElementRef;
  connectionEditingEnabled: boolean;
  onStartConnection?: (endpoint: RouteGraphWorkspaceConnectionEndpointRef) => void;
};

type ResidentMacroData = {
  kind: 'macro';
  item: RouteGraphMacro;
  title: string;
  typeLabel: string;
  subtitle: string;
  accent: string;
  contextBadges: Array<{ label: string; state?: 'success' | 'warning' | 'danger' }>;
  metrics: string[];
  diagnostics: { errors: number; warnings: number };
  ports: RouteGraphPort[];
  element: RouteGraphElementRef;
  connectionEditingEnabled: boolean;
  onStartConnection?: (endpoint: RouteGraphWorkspaceConnectionEndpointRef) => void;
};

type PortalNodeData = {
  kind: 'portal';
  item: RouteGraphWorkspacePortal;
  onOpen: (portal: RouteGraphWorkspacePortal) => void;
};

type FocusCanvasNodeData = ResidentNodeData | ResidentMacroData | PortalNodeData;
type FocusCanvasNode = Node<FocusCanvasNodeData, 'resident' | 'portal'>;
type FocusCanvasEdgeData =
  | { kind: 'edge'; item: RouteGraphEdge }
  | { kind: 'portal'; item: RouteGraphWorkspacePortal };
type FocusCanvasEdge = Edge<FocusCanvasEdgeData>;

type RouteGraphFocusCanvasProps = {
  workspace: RouteGraphFocusedWorkspace;
  graph: RouteGraphWorkspaceSource;
  editable: boolean;
  onGraphChange: (graph: RouteGraphWorkspaceSource) => void;
  onCreateNode: (type: RouteGraphNode['type'], position: { x: number; y: number }) => Promise<RouteGraphNode | null>;
  onSelect: (selected: RouteGraphFocusSelection | null) => void;
  onOpenPortal: (portal: RouteGraphWorkspacePortal) => void;
  onStartConnection: (endpoint: RouteGraphWorkspaceConnectionEndpointRef) => void;
  onCreateConnection: (
    first: RouteGraphWorkspaceConnectionEndpointRef,
    second: RouteGraphWorkspaceConnectionEndpointRef,
  ) => void;
  connectionAuthoringEnabled: boolean;
};

type GraphElementItem = {
  graphElementId: string;
  kind: 'node' | 'macro';
  node?: RouteGraphNode;
  macro?: RouteGraphMacro;
  position?: { x: number; y: number };
};

type FocusCanvasModel = {
  nodes: FocusCanvasNode[];
  edges: FocusCanvasEdge[];
  unresolvedPortalCount: number;
};

function resolveFocusCanvasConnectionEndpoints(
  nodes: readonly FocusCanvasNode[],
  connection: Connection,
): [RouteGraphWorkspaceConnectionEndpointRef, RouteGraphWorkspaceConnectionEndpointRef] | null {
  if (!connection.sourceHandle || !connection.targetHandle) return null;
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (!source || !target || source.data.kind === 'portal' || target.data.kind === 'portal') return null;
  return [
    { element: source.data.element, portId: connection.sourceHandle },
    { element: target.data.element, portId: connection.targetHandle },
  ];
}

type FocusCanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const viewportCache = new Map<string, Viewport>();

function focusAccentStyle(accent: string): CSSProperties {
  return { '--route-focus-accent': accent } as CSSProperties;
}

function focusPortStyle(kind: RouteGraphPort['kind']): CSSProperties {
  return { '--route-focus-port-color': ROUTE_GRAPH_VISUAL_COLORS.port[kind] } as CSSProperties;
}

function rememberViewport(key: string, viewport: Viewport): void {
  viewportCache.delete(key);
  viewportCache.set(key, viewport);
  while (viewportCache.size > VIEWPORT_CACHE_LIMIT) {
    const oldest = viewportCache.keys().next().value;
    if (oldest === undefined) break;
    viewportCache.delete(oldest);
  }
}

export function findAvailablePortalPosition(
  desired: { x: number; y: number },
  direction: RouteGraphWorkspacePortal['direction'],
  occupied: readonly FocusCanvasRect[],
  size: { width: number; height: number },
  gap = 24,
): { x: number; y: number } {
  const isFree = (position: { x: number; y: number }) => occupied.every((rect) => (
    position.x + size.width + gap <= rect.x
    || rect.x + rect.width + gap <= position.x
    || position.y + size.height + gap <= rect.y
    || rect.y + rect.height + gap <= position.y
  ));
  const verticalStep = size.height + gap;
  const horizontalStep = size.width + gap;
  for (let column = 0; column < 8; column += 1) {
    const x = desired.x + (direction === 'incoming' ? -1 : 1) * column * horizontalStep;
    for (let radius = 0; radius <= 96; radius += 1) {
      const offsets = radius === 0 ? [0] : [-radius, radius];
      for (const offset of offsets) {
        const candidate = { x, y: desired.y + offset * verticalStep };
        if (isFree(candidate)) return candidate;
      }
    }
  }
  return desired;
}

function elementHeight(ports: RouteGraphPort[], hasContext = false): number {
  const contextHeight = hasContext ? 26 : 0;
  const inputCount = ports.filter((port) => port.enabled !== false && port.direction === 'input').length;
  const outputCount = ports.filter((port) => port.enabled !== false && port.direction === 'output').length;
  return Math.max(RESIDENT_MIN_HEIGHT + contextHeight, 112 + Math.max(1, inputCount, outputCount) * 24 + contextHeight);
}

function edgeColor(kind: RouteGraphEdge['kind']): string {
  return ROUTE_GRAPH_VISUAL_COLORS.edge[kind] || '#64748b';
}

function edgeHandleClass(kind: RouteGraphEdge['kind']): string {
  return kind === 'route_flow' ? 'route-focus-handle-success' : 'route-focus-handle-primary';
}

function formatOwnership(ownership: RouteGraphNode['ownership'] | RouteGraphMacro['ownership']): string {
  return tr(`pages.tokenRoutes.routeGraphViewModel.ownership.${ownership}`);
}

function formatPortalKind(portal: RouteGraphWorkspacePortal): string {
  return tr(`pages.tokenRoutes.routeGraphWorkspace.portalKind.${portal.kind}`);
}

function portalActionLabel(portal: RouteGraphWorkspacePortal): string {
  return portal.kind === 'collection'
    ? tr('pages.tokenRoutes.routeGraphWorkspace.openCollectionWindow')
    : tr('pages.tokenRoutes.routeGraphWorkspace.openBoundary');
}

function formatPortalDetail(portal: RouteGraphWorkspacePortal): string {
  if (portal.kind !== 'collection') {
    const kindLabel = portal.preview.elementKind === 'macro'
      ? tr('pages.tokenRoutes.routeGraphWorkspace.kind.macro')
      : getNodeDefinitionTitle(portal.preview.elementKind);
    return `${kindLabel} · ${portal.connection.portLabel}`;
  }
  const key = portal.collection.action === 'previous'
    ? 'pages.tokenRoutes.routeGraphWorkspace.collectionPrevious'
    : 'pages.tokenRoutes.routeGraphWorkspace.collectionNext';
  const windowLabel = tr(key)
    .replace('{start}', String(portal.collection.start + 1))
    .replace('{end}', String(portal.collection.end))
    .replace('{total}', String(portal.collection.total));
  return `${portal.connection.portLabel} · ${windowLabel}`;
}

function portalAccent(portal: RouteGraphWorkspacePortal): string {
  if (portal.kind === 'collection') return edgeColor(portal.connection.edgeKind);
  return portal.preview.elementKind === 'macro'
    ? ROUTE_GRAPH_VISUAL_COLORS.macro.candidate_selector
    : ROUTE_GRAPH_VISUAL_COLORS.node[portal.preview.elementKind];
}

function portalIcon(portal: RouteGraphWorkspacePortal) {
  if (portal.kind === 'collection') return <Layers3 size={15} />;
  if (portal.preview.elementKind === 'macro') return <Sparkles size={15} />;
  if (portal.preview.elementKind === 'entry') return <DoorOpen size={15} />;
  if (portal.preview.elementKind === 'dispatcher') return <GitFork size={15} />;
  if (portal.preview.elementKind === 'filter') return <Workflow size={15} />;
  if (portal.preview.elementKind === 'route_endpoint') return <Boxes size={15} />;
  if (portal.preview.elementKind === 'synthetic_endpoint') return <OctagonX size={15} />;
  return <CircleDot size={15} />;
}

function PortRow({
  port,
  connectionEditingEnabled,
  onConnect,
}: {
  port: RouteGraphPort;
  connectionEditingEnabled: boolean;
  onConnect?: () => void;
}) {
  const input = port.direction === 'input';
  const connectionEditable = connectionEditingEnabled && canAttachManualRouteGraphEdge(port);
  const collection = getPortCollectionKind(port);
  const signature = getPortTypeSignature(port);
  const label = getPortDisplayLabel(port);
  return (
    <div
      className={`route-focus-port-row ${input ? 'is-input' : 'is-output'} ${connectionEditable ? 'is-connection-editable' : 'is-connection-locked'}`}
      data-port-kind={port.kind}
      data-connection-editable={connectionEditable ? 'true' : 'false'}
      style={focusPortStyle(port.kind)}
    >
      <Handle
        id={port.id}
        type={input ? 'target' : 'source'}
        position={input ? Position.Left : Position.Right}
        className="route-focus-port-handle"
        data-collection={collection}
        data-connection-editable={connectionEditable ? 'true' : 'false'}
        title={signature}
        aria-label={signature}
        aria-disabled={!connectionEditable}
        isConnectable={connectionEditable}
      />
      {input ? (
        <>
          {connectionEditable && onConnect && <Button type="button" size="icon" variant="ghost" className="nodrag nopan size-5 shrink-0 text-muted-foreground" onClick={(event) => { event.stopPropagation(); onConnect(); }} title={tr('pages.tokenRoutes.routeGraphConnection.start')}>
            <Link2 size={11} />
          </Button>}
          <span className="route-focus-port-kind">{getPortKindDisplayLabel(port.kind)}</span>
          <span className="min-w-0 truncate" title={label}>{label}</span>
        </>
      ) : (
        <>
          <span className="min-w-0 truncate" title={label}>{label}</span>
          <span className="route-focus-port-kind">{getPortKindDisplayLabel(port.kind)}</span>
          {connectionEditable && onConnect && <Button type="button" size="icon" variant="ghost" className="nodrag nopan size-5 shrink-0 text-muted-foreground" onClick={(event) => { event.stopPropagation(); onConnect(); }} title={tr('pages.tokenRoutes.routeGraphConnection.start')}>
            <Link2 size={11} />
          </Button>}
        </>
      )}
    </div>
  );
}

const ResidentNode = memo(function ResidentNode({ id, data, selected }: NodeProps<FocusCanvasNode>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const visiblePorts = data.kind === 'portal'
    ? []
    : data.ports.filter((port) => port.enabled !== false);
  const portGeometrySignature = visiblePorts
    .map((port) => `${port.id}:${port.direction}:${port.kind}:${getPortCollectionKind(port)}`)
    .join('|');
  const contextGeometrySignature = data.kind === 'portal'
    ? ''
    : data.contextBadges.map((badge) => badge.label).join('|');
  useLayoutEffect(() => {
    updateNodeInternals(id);
  }, [contextGeometrySignature, id, portGeometrySignature, updateNodeInternals]);
  if (data.kind === 'portal') return null;
  const enabled = data.item.enabled !== false;
  const ownership = data.item.ownership;
  // React Flow may retain pre-HMR node data while this renderer is replaced.
  const diagnostics = data.diagnostics ?? EMPTY_DIAGNOSTIC_COUNTS;
  const icon = data.kind === 'macro'
    ? <Sparkles size={15} />
    : data.item.type === 'entry'
      ? <DoorOpen size={15} />
      : data.item.type === 'dispatcher'
        ? <GitFork size={15} />
        : data.item.type === 'filter'
          ? <Workflow size={15} />
          : data.item.type === 'route_endpoint'
            ? <Boxes size={15} />
            : data.item.type === 'synthetic_endpoint'
              ? <OctagonX size={15} />
              : <CircleDot size={15} />;
  return (
    <div
      className={`route-focus-resident-node grid h-full w-full grid-rows-[auto_minmax(0,1fr)] overflow-visible rounded-md border bg-card text-card-foreground shadow-sm transition-[border-color,box-shadow] ${selected ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}
      style={focusAccentStyle(data.accent)}
      data-node-kind={data.kind === 'node' ? data.item.type : 'macro'}
      data-endpoint-kind={data.kind === 'node' && data.item.type === 'route_endpoint' ? String(data.item.endpointKind || '') : undefined}
    >
      <header className="flex min-w-0 items-start gap-2 rounded-t-[5px] border-b bg-muted/25 px-3 py-2.5">
        <span className="route-focus-node-icon mt-0.5 grid size-7 shrink-0 place-items-center rounded border bg-background">
          {icon}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-xs font-semibold">{data.title}</span>
          <span className="truncate text-[10px] text-muted-foreground">{data.typeLabel}</span>
        </span>
        {diagnostics.errors > 0 ? (
          <span className="mt-0.5 flex shrink-0 items-center gap-0.5 text-[9px] font-semibold text-destructive" title={tr('pages.tokenRoutes.routeGraphWorkspace.errors')}>
            <OctagonX size={13} />
            {diagnostics.errors}
          </span>
        ) : diagnostics.warnings > 0 ? (
          <span className="mt-0.5 flex shrink-0 items-center gap-0.5 text-[9px] font-semibold text-amber-500" title={tr('pages.tokenRoutes.routeGraphWorkspace.warnings')}>
            <TriangleAlert size={13} />
            {diagnostics.warnings}
          </span>
        ) : null}
        <span className={`mt-1 size-2 shrink-0 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
      </header>
      <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] px-3 py-2 text-[10px] text-muted-foreground">
        <div className="truncate pb-1.5 text-[11px] text-foreground/80" title={data.subtitle}>{data.subtitle}</div>
        {data.contextBadges.length > 0 && (
          <div className="flex min-w-0 flex-wrap gap-1 pb-2">
            {data.contextBadges.map((badge) => (
              <span
                key={badge.label}
                className={`route-focus-context-badge ${badge.state ? `is-${badge.state}` : ''}`}
              >
                {badge.label}
              </span>
            ))}
          </div>
        )}
        <div className="grid min-h-0 grid-cols-2 gap-3">
          <div className="grid content-start gap-1">
            {visiblePorts.filter((port) => port.direction === 'input').map((port) => <PortRow key={port.id} port={port} connectionEditingEnabled={data.connectionEditingEnabled} onConnect={data.onStartConnection ? () => data.onStartConnection!({ element: data.element, portId: port.id }) : undefined} />)}
          </div>
          <div className="grid content-start gap-1 text-right">
            {visiblePorts.filter((port) => port.direction === 'output').map((port) => <PortRow key={port.id} port={port} connectionEditingEnabled={data.connectionEditingEnabled} onConnect={data.onStartConnection ? () => data.onStartConnection!({ element: data.element, portId: port.id }) : undefined} />)}
          </div>
        </div>
        <div className="mt-auto flex min-w-0 items-center justify-between gap-2 border-t pt-1.5">
          <span className="truncate">{data.metrics[0] || formatOwnership(ownership)}</span>
          <span className="truncate text-right">{data.metrics[1] || formatOwnership(ownership)}</span>
        </div>
      </div>
    </div>
  );
});

const PortalNode = memo(function PortalNode({ data, selected }: NodeProps<FocusCanvasNode>) {
  if (data.kind !== 'portal') return null;
  const portal = data.item;
  const incoming = portal.direction === 'incoming';
  const warning = portal.kind === 'overflow';
  const collection = portal.kind === 'collection';
  const accent = portalAccent(portal);
  return (
    <div
      className={`grid h-full w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 overflow-visible rounded-md border border-l-[3px] bg-background px-3 text-left shadow-sm transition-colors hover:bg-accent/40 ${warning ? 'border-dashed border-amber-500/70' : `route-focus-portal-node ${selected ? 'border-primary ring-2 ring-primary/15' : 'border-border'}`}`}
      style={focusAccentStyle(accent)}
      data-portal-kind={portal.kind}
    >
      <span className="route-focus-accent-icon grid size-8 shrink-0 place-items-center rounded border bg-muted/25">
        {portalIcon(portal)}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-[11px] font-semibold">{portal.label}</span>
        <span className="truncate text-[10px] text-muted-foreground">{formatPortalDetail(portal)}</span>
        {!collection && (
          <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <span className={`size-1.5 rounded-full ${portal.preview.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
            {portal.preview.enabled
              ? tr('pages.tokenRoutes.routeGraphWorkspace.status.enabled')
              : tr('pages.tokenRoutes.routeGraphWorkspace.status.disabled')}
            <span>·</span>
            {formatPortalKind(portal)}
          </span>
        )}
      </span>
      <span className="grid justify-items-end gap-1.5">
        {warning ? <TriangleAlert size={15} className="text-amber-500" /> : <Badge variant="secondary" className="px-1.5 text-[9px]">{portal.connection.count}</Badge>}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="nodrag nopan grid size-7 shrink-0 place-items-center text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            data.onOpen(portal);
          }}
          aria-label={`${portalActionLabel(portal)}: ${portal.label}`}
          title={portalActionLabel(portal)}
        >
          {incoming ? <ArrowLeftToLine size={15} /> : <ChevronRight size={15} />}
        </Button>
      </span>
      <Handle
        type={incoming ? 'source' : 'target'}
        position={incoming ? Position.Right : Position.Left}
        className={edgeHandleClass(portal.connection.edgeKind)}
      />
    </div>
  );
});

const nodeTypes = {
  resident: ResidentNode,
  portal: PortalNode,
};

function residentItems(workspace: RouteGraphFocusedWorkspace, graph: RouteGraphWorkspaceSource): GraphElementItem[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const macroById = new Map(graph.macros.map((macro) => [macro.id, macro]));
  const items: GraphElementItem[] = [];
  const boundNodeIds = new Set<string>();
  const boundMacroIds = new Set<string>();
  for (const binding of workspace.residentElements) {
    if (binding.element.kind === 'node') {
      const node = nodeById.get(binding.element.id);
      if (node) {
        boundNodeIds.add(node.id);
        items.push({ graphElementId: binding.graphElementId, kind: 'node', node, position: node.position });
      }
      continue;
    }
    const macro = macroById.get(binding.element.id);
    if (macro) {
      boundMacroIds.add(macro.id);
      items.push({ graphElementId: binding.graphElementId, kind: 'macro', macro, position: macro.position });
    }
  }
  for (const node of graph.nodes) {
    if (!boundNodeIds.has(node.id)) items.push({ graphElementId: node.id, kind: 'node', node, position: node.position });
  }
  for (const macro of graph.macros) {
    if (!boundMacroIds.has(macro.id)) {
      items.push({ graphElementId: macro.id, kind: 'macro', macro, position: macro.position });
    }
  }
  return items;
}

function focusGraphElementId(workspace: RouteGraphFocusedWorkspace): string | null {
  return workspace.residentElements.find((binding) => (
    binding.element.kind === workspace.focus.kind && binding.element.id === workspace.focus.id
  ))?.graphElementId || null;
}

function layoutResidentItems(
  items: GraphElementItem[],
  edges: RouteGraphEdge[],
  anchorId: string | null,
): Map<string, { x: number; y: number }> {
  const itemIds = new Set(items.map((item) => item.graphElementId));
  const fallbackAnchorId = anchorId && itemIds.has(anchorId) ? anchorId : items[0]?.graphElementId || null;
  const anchorItem = items.find((item) => item.graphElementId === fallbackAnchorId);
  const anchorPosition = anchorItem?.position || { x: 80, y: 120 };
  const lanes = new Map<string, number>();
  if (fallbackAnchorId) lanes.set(fallbackAnchorId, 0);
  const queue = fallbackAnchorId ? [fallbackAnchorId] : [];
  const sortedEdges = edges
    .filter((edge) => itemIds.has(edge.sourceNodeId) && itemIds.has(edge.targetNodeId))
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
  while (queue.length > 0) {
    const current = queue.shift()!;
    const lane = lanes.get(current) || 0;
    for (const edge of sortedEdges) {
      const next = edge.sourceNodeId === current
        ? { id: edge.targetNodeId, lane: lane + 1 }
        : edge.targetNodeId === current
          ? { id: edge.sourceNodeId, lane: lane - 1 }
          : null;
      if (!next || lanes.has(next.id)) continue;
      lanes.set(next.id, next.lane);
      queue.push(next.id);
    }
  }
  let orphanLane = Math.max(0, ...lanes.values()) + 1;
  for (const item of items) {
    if (!lanes.has(item.graphElementId)) lanes.set(item.graphElementId, orphanLane++);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const occupied: Array<{ x: number; y: number; height: number }> = [];
  for (const item of items) {
    if (!item.position) continue;
    positions.set(item.graphElementId, item.position);
    const ports = item.node ? getRouteGraphNodePorts(item.node) : getRouteGraphMacroPorts(item.macro);
    occupied.push({ ...item.position, height: elementHeight(ports) });
  }
  const unpositionedByLane = new Map<number, GraphElementItem[]>();
  for (const item of items) {
    if (item.position) continue;
    const lane = lanes.get(item.graphElementId) || 0;
    const laneItems = unpositionedByLane.get(lane) || [];
    laneItems.push(item);
    unpositionedByLane.set(lane, laneItems);
  }
  for (const [lane, laneItems] of [...unpositionedByLane.entries()].sort(([left], [right]) => left - right)) {
    const sorted = laneItems.sort((left, right) => left.graphElementId.localeCompare(right.graphElementId));
    let y = anchorPosition.y - ((sorted.length - 1) * ROW_GAP) / 2;
    for (const item of sorted) {
      const ports = item.node ? getRouteGraphNodePorts(item.node) : getRouteGraphMacroPorts(item.macro);
      const height = elementHeight(ports);
      let position = { x: anchorPosition.x + lane * COLUMN_GAP, y };
      while (occupied.some((other) => (
        Math.abs(other.x - position.x) < RESIDENT_WIDTH + 32
        && position.y < other.y + other.height + 28
        && other.y < position.y + height + 28
      ))) position = { ...position, y: position.y + ROW_GAP };
      positions.set(item.graphElementId, position);
      occupied.push({ ...position, height });
      y = position.y + ROW_GAP;
    }
  }
  return positions;
}

function buildFocusCanvasModel(
  workspace: RouteGraphFocusedWorkspace,
  graph: RouteGraphWorkspaceSource,
  onOpenPortal: (portal: RouteGraphWorkspacePortal) => void = () => {},
  onStartConnection?: (endpoint: RouteGraphWorkspaceConnectionEndpointRef) => void,
  connectionAuthoringEnabled = !!onStartConnection,
  editable = workspace.capabilities.editable,
): FocusCanvasModel {
  const items = residentItems(workspace, graph);
  const positions = layoutResidentItems(items, graph.edges, focusGraphElementId(workspace));
  const diagnosticCounts = (ids: string[]) => {
    const identity = new Set(ids);
    const relevant = workspace.diagnostics.filter((diagnostic) => diagnostic.nodeId && identity.has(diagnostic.nodeId));
    return {
      errors: relevant.filter((diagnostic) => diagnostic.severity === 'error').length,
      warnings: relevant.filter((diagnostic) => diagnostic.severity === 'warning').length,
    };
  };
  const nodes: FocusCanvasNode[] = items.map((item) => {
    const position = positions.get(item.graphElementId) || { x: 80, y: 120 };
    if (item.kind === 'node') {
      const node = item.node!;
      const ports = getRouteGraphNodePorts(node);
      const endpointContext = node.type === 'route_endpoint'
        ? [
            { label: getEndpointKindLabel(node.endpointKind || 'supply') },
            { label: getEndpointSourceKindLabel(node.sourceKind || 'inline') },
            {
              label: getEndpointResolutionStatusLabel(node.resolutionStatus || 'unresolved'),
              state: node.resolutionStatus === 'resolved' ? 'success' as const : node.resolutionStatus === 'degraded' ? 'warning' as const : 'danger' as const,
            },
          ]
        : [];
      const uniqueEndpointContext = endpointContext.filter((badge, index, badges) => (
        badges.findIndex((candidate) => candidate.label === badge.label) === index
      ));
      return {
        id: item.graphElementId,
        type: 'resident',
        position,
        data: {
          kind: 'node',
          item: node,
          title: String(node.name || getNodeDefinitionTitle(node.type)),
          typeLabel: getNodeDefinitionTitle(node.type),
          subtitle: getNodeCardSubtitle(node),
          accent: ROUTE_GRAPH_VISUAL_COLORS.node[node.type],
          contextBadges: uniqueEndpointContext,
          metrics: getNodeCardMetrics(graph, node),
          diagnostics: diagnosticCounts([item.graphElementId, node.id]),
          ports,
          element: { kind: 'node', id: node.id },
          connectionEditingEnabled: editable && connectionAuthoringEnabled,
          onStartConnection: editable ? onStartConnection : undefined,
        },
        style: { width: RESIDENT_WIDTH, height: elementHeight(ports, uniqueEndpointContext.length > 0) },
        draggable: editable && node.ownership === 'manual',
      };
    }
    const macro = item.macro!;
    const ports = getRouteGraphMacroPorts(macro);
    return {
      id: item.graphElementId,
      type: 'resident',
      position,
        data: {
          kind: 'macro',
          item: macro,
          title: String(macro.name || workspace.focus.label || macro.kind),
          typeLabel: tr('pages.tokenRoutes.routeGraphWorkspace.kind.macro'),
          subtitle: macro.kind,
          accent: ROUTE_GRAPH_VISUAL_COLORS.macro.candidate_selector,
          contextBadges: [],
          metrics: [formatOwnership(macro.ownership)],
          diagnostics: diagnosticCounts([item.graphElementId, macro.id]),
          ports,
          element: { kind: 'macro', id: macro.id },
          connectionEditingEnabled: editable && connectionAuthoringEnabled,
          onStartConnection: editable ? onStartConnection : undefined,
        },
      style: { width: RESIDENT_WIDTH, height: elementHeight(ports) },
      draggable: editable && macro.ownership === 'manual',
    };
  });

  const edges: FocusCanvasEdge[] = graph.edges.map((edge) => {
    const diagnostics = workspace.diagnostics.filter((item) => item.edgeId === edge.id);
    const color = diagnostics.some((item) => item.severity === 'error')
      ? '#dc2626'
      : diagnostics.some((item) => item.severity === 'warning')
        ? '#d97706'
        : edgeColor(edge.kind);
    return {
      id: edge.id,
      source: edge.sourceNodeId,
      sourceHandle: edge.sourcePortId,
      target: edge.targetNodeId,
      targetHandle: edge.targetPortId,
      type: 'smoothstep',
      data: { kind: 'edge', item: edge },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
      style: { stroke: color, strokeWidth: diagnostics.length > 0 ? 2.4 : 1.8 },
    };
  });

  const occupied: FocusCanvasRect[] = nodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    width: Number(node.style?.width || RESIDENT_WIDTH),
    height: Number(node.style?.height || RESIDENT_MIN_HEIGHT),
  }));
  let unresolvedPortalCount = 0;
  for (const portal of workspace.portals) {
    const binding = workspace.residentElements.find((candidate) => (
      candidate.element.kind === portal.resident.element.kind
      && candidate.element.id === portal.resident.element.id
    ));
    const residentPosition = binding ? positions.get(binding.graphElementId) : null;
    if (!binding || !residentPosition) {
      unresolvedPortalCount += 1;
      continue;
    }
    const incoming = portal.direction === 'incoming';
    const portalHeight = portal.kind === 'collection' ? COLLECTION_PORTAL_HEIGHT : BOUNDARY_PORTAL_HEIGHT;
    const preferredPosition = {
      x: incoming
        ? residentPosition.x - PORTAL_WIDTH - 104
        : residentPosition.x + RESIDENT_WIDTH + 104,
      y: residentPosition.y,
    };
    const portalPosition = findAvailablePortalPosition(
      preferredPosition,
      portal.direction,
      occupied,
      { width: PORTAL_WIDTH, height: portalHeight },
    );
    occupied.push({ ...portalPosition, width: PORTAL_WIDTH, height: portalHeight });
    nodes.push({
      id: portal.id,
      type: 'portal',
      position: portalPosition,
      data: { kind: 'portal', item: portal, onOpen: onOpenPortal },
      style: {
        width: PORTAL_WIDTH,
        height: portalHeight,
      },
      draggable: false,
    });
    edges.push({
      id: portal.id,
      source: incoming ? portal.id : binding.graphElementId,
      sourceHandle: incoming ? undefined : portal.resident.portId,
      target: incoming ? binding.graphElementId : portal.id,
      targetHandle: incoming ? portal.resident.portId : undefined,
      type: 'smoothstep',
      data: { kind: 'portal', item: portal },
      markerEnd: incoming ? { type: MarkerType.ArrowClosed, width: 16, height: 16, color: edgeColor(portal.connection.edgeKind) } : undefined,
      style: {
        stroke: edgeColor(portal.connection.edgeKind),
        strokeWidth: 1.6,
        strokeDasharray: portal.kind === 'neighbor' ? '5 4' : portal.kind === 'overflow' ? '2 4' : undefined,
      },
    });
  }
  return { nodes, edges, unresolvedPortalCount };
}

function RouteGraphFocusCanvasInner({
  workspace,
  graph,
  editable,
  onGraphChange,
  onCreateNode,
  onSelect,
  onOpenPortal,
  onStartConnection,
  onCreateConnection,
  connectionAuthoringEnabled,
}: RouteGraphFocusCanvasProps) {
  const toast = useToast();
  const model = useMemo(
    () => buildFocusCanvasModel(workspace, graph, onOpenPortal, onStartConnection, connectionAuthoringEnabled, editable),
    [connectionAuthoringEnabled, editable, graph, onOpenPortal, onStartConnection, workspace],
  );
  const [nodes, setNodes] = useState<FocusCanvasNode[]>(model.nodes);
  const instanceRef = useRef<ReactFlowInstance<FocusCanvasNode, FocusCanvasEdge> | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const viewportKey = `${workspace.focus.kind}\u0000${workspace.focus.id}\u0000${workspace.representation}`;

  useEffect(() => setNodes(model.nodes), [model.nodes]);

  const handleNodesChange = useCallback((changes: NodeChange<FocusCanvasNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const handleDragStop = useCallback((_event: unknown, flowNode: FocusCanvasNode) => {
    if (!editable || flowNode.data.kind === 'portal') return;
    const position = { x: flowNode.position.x, y: flowNode.position.y };
    if (flowNode.data.kind === 'node') {
      if (flowNode.data.item.ownership !== 'manual') return;
      onGraphChange({
        ...graph,
        nodes: graph.nodes.map((node) => node.id === flowNode.data.item.id ? { ...node, position } : node),
      });
      return;
    }
    if (flowNode.data.item.ownership !== 'manual') return;
    onGraphChange({
      ...graph,
      macros: graph.macros.map((macro) => macro.id === flowNode.data.item.id ? { ...macro, position } : macro),
    });
  }, [editable, graph, onGraphChange]);

  const handleAddNode = useCallback(async (type: RouteGraphNode['type']) => {
    const instance = instanceRef.current;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!editable || !instance || !bounds) return;
    const desired = instance.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    });
    const position = findAvailableRouteGraphPosition(
      desired,
      nodes.filter((node) => node.data.kind !== 'portal').map((node) => ({
        x: node.position.x,
        y: node.position.y,
        width: Number(node.width || node.style?.width || RESIDENT_WIDTH),
        height: Number(node.height || node.style?.height || RESIDENT_MIN_HEIGHT),
      })),
      { width: RESIDENT_WIDTH, height: RESIDENT_MIN_HEIGHT },
    );
    const node = await onCreateNode(type, position);
    if (!node) return;
    onSelect({ kind: 'node', item: node });
    window.requestAnimationFrame(() => {
      const zoom = Math.min(1.1, Math.max(0.65, instance.getZoom()));
      void instance.setCenter(
        position.x + RESIDENT_WIDTH / 2,
        position.y + RESIDENT_MIN_HEIGHT / 2,
        { zoom, duration: 180 },
      );
    });
  }, [editable, nodes, onCreateNode, onSelect]);

  const handleConnect = useCallback((connection: Connection) => {
    const endpoints = connectionAuthoringEnabled
      ? resolveFocusCanvasConnectionEndpoints(nodes, connection)
      : null;
    if (!endpoints) {
      toast.error(tr('pages.tokenRoutes.routeGraphConnection.error.binding'));
      return;
    }
    onCreateConnection(...endpoints);
  }, [connectionAuthoringEnabled, nodes, onCreateConnection, toast]);

  return (
    <div ref={canvasRef} className="h-full min-h-0 w-full">
      <ReactFlow<FocusCanvasNode, FocusCanvasEdge>
      nodes={nodes}
      edges={model.edges}
      nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      onNodeDragStop={handleDragStop}
      onConnect={handleConnect}
      onNodeClick={(_event, node) => {
        if (node.data.kind === 'portal') onSelect({ kind: 'portal', item: node.data.item });
        else if (node.data.kind === 'macro') onSelect({ kind: 'macro', item: node.data.item });
        else onSelect({ kind: 'node', item: node.data.item });
      }}
      onNodeDoubleClick={(_event, node) => {
        if (node.data.kind === 'portal') onOpenPortal(node.data.item);
      }}
      onEdgeClick={(_event, edge) => {
        if (!edge.data) return;
        if (edge.data.kind === 'portal') onSelect({ kind: 'portal', item: edge.data.item });
        else onSelect({ kind: 'edge', item: edge.data.item });
      }}
      onPaneClick={() => onSelect(null)}
      onInit={(instance) => {
        instanceRef.current = instance;
        const saved = viewportCache.get(viewportKey);
        window.requestAnimationFrame(() => {
          if (saved) void instance.setViewport(saved, { duration: 0 });
          else void instance.fitView({ padding: 0.22, minZoom: 0.35, maxZoom: 1.1, duration: 0 });
        });
      }}
      onMoveEnd={(_event, viewport) => rememberViewport(viewportKey, viewport)}
      fitView={false}
      minZoom={0.18}
      maxZoom={1.8}
      panOnDrag={[1, 2]}
      selectionOnDrag={false}
      nodesConnectable={connectionAuthoringEnabled}
      elementsSelectable
      elevateNodesOnSelect={false}
      proOptions={{ hideAttribution: true }}
      className="route-focus-canvas bg-background"
    >
      <Background gap={22} size={1} />
      <Controls showInteractive={false} />
      {nodes.length > 14 && <MiniMap pannable zoomable nodeStrokeWidth={2} />}
      <Panel position="top-left" className="pointer-events-none flex items-center gap-2 rounded-md border bg-background/92 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
        <Layers3 size={13} />
        <span>{workspace.representation === 'semantic' ? tr('pages.tokenRoutes.routeGraphWorkspace.semantic') : tr('pages.tokenRoutes.routeGraphWorkspace.primitive')}</span>
      </Panel>
      {editable && (
        <Panel position="top-right">
          <RouteGraphNodeMenu onSelect={handleAddNode} />
        </Panel>
      )}
      {model.unresolvedPortalCount > 0 && (
        <Panel position="top-center" className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <TriangleAlert size={14} />
          {tr('pages.tokenRoutes.routeGraphWorkspace.portalBindingError').replace('{count}', String(model.unresolvedPortalCount))}
        </Panel>
      )}
      <Panel position="bottom-right">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void instanceRef.current?.fitView({ padding: 0.22, minZoom: 0.35, maxZoom: 1.1, duration: 180 })}
        >
          {tr('pages.tokenRoutes.routeGraphWorkspace.fitView')}
        </Button>
      </Panel>
      </ReactFlow>
    </div>
  );
}

export default function RouteGraphFocusCanvas(props: RouteGraphFocusCanvasProps) {
  return (
    <ReactFlowProvider>
      <RouteGraphFocusCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export {
  buildFocusCanvasModel,
  focusGraphElementId,
  layoutResidentItems,
  residentItems,
  resolveFocusCanvasConnectionEndpoints,
};
