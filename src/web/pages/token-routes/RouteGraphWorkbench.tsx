import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  getConnectedEdges,
  useReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnReconnect,
} from '@xyflow/react';
import {
  Boxes,
  ChevronDown,
  Check,
  Command as CommandIcon,
  Eye,
  GitBranch,
  GitFork,
  Layers3,
  Link2,
  ListTree,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Copy,
  Crosshair,
  MousePointer2,
  Power,
  Trash2,
  Wand2,
  Workflow,
  X,
} from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { api } from '../../api.js';
import { getRouteGraphMacroPort, getRouteGraphMacroPorts, lowerRouteGraphSource } from '../../../shared/routeGraph.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import { useToast } from '../../components/Toast.js';
import { Badge } from '../../components/ui/badge/index.js';
import { Button } from '../../components/ui/button/index.js';
import { ButtonGroup } from '../../components/ui/button-group/index.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card/index.js';
import * as Command from '../../components/ui/command/index.js';
import * as DropdownMenu from '../../components/ui/dropdown-menu/index.js';
import * as HoverCard from '../../components/ui/hover-card/index.js';
import { Input } from '../../components/ui/input/index.js';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../../components/ui/resizable/index.js';
import { ScrollArea } from '../../components/ui/scroll-area/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select/index.js';
import { Switch } from '../../components/ui/switch/index.js';
import * as Tabs from '../../components/ui/tabs/index.js';
import * as Tooltip from '../../components/ui/tooltip/index.js';
import { DragHandleButton } from './DragHandleButton.js';
import JsonCodeEditor from '../../components/JsonCodeEditor.js';
import { NodeForm } from './NodeForm.js';
import type {
  AddTemplate,
  RouteGraphEdge,
  RouteGraphMacro,
  RouteGraphNode,
  RouteGraphNodeType,
  RouteGraphPort,
} from './routeGraphTypes.js';
import type { RouteEndpointCatalogItem } from './types.js';
import {
  NODE_TYPES,
  ROUTE_GRAPH_NODE_TYPES,
  ROUTE_GRAPH_VISUAL_COLORS,
  buildAddTemplates,
  getNodePorts,
  makeNode,
  routeGraphNodeDefinitions,
  templateAccent,
} from './routeGraphRegistry.js';
import {
  getGraphFacts,
  getModelListSubtitle,
  getNodeCardMetrics,
  getNodeCardSubtitle,
  getNodeConnections,
  getNodeInspectorFacts,
  getNodePortsPreview,
  getNodeStatusLabel,
  getNodeSubtitle,
  getNodeTitle,
  getOutlineSubtitle,
  getPortCollectionKind,
  getPortConnectionCount,
  getPortDisplayLabel,
  getPortModeNote,
  getPortSummary,
  getPortTypeSignature,
  getPublicEntryNodes,
} from './routeGraphViewModel.js';
import {
  macroFlowNodeId,
  validateRouteGraphConnection,
} from './routeGraphConnections.js';
import {
  deleteSelectedGraphElements,
  getRouteGraphContextMenuTarget,
  normalizeContextMenuTargetForGraph,
  selectionForContextMenu,
  selectionFromFlowNode,
  selectionFromFlowNodeId as deriveSelectionFromFlowNodeId,
  selectionFromFlowSelection,
  toggleGraphEdgeSelection,
  toggleGraphNodeSelection,
} from './routeGraphEditorInteractions.js';
import { estimateRouteGraphMacroRowGap, layoutRouteGraph } from './routeGraphLayout.js';

import { tr } from '../../i18n.js';
type RouteFlowEdgeData = RouteGraphEdge & {
  __highlighted?: boolean;
  __hiddenSupplyControl?: {
    macroId: string;
    count: number;
    expanded: boolean;
    targetKind: 'macro' | 'dispatcher';
    onToggle: (macroId: string) => void;
  };
};
type HiddenSupplyAnchorData = {
  __hiddenSupplyAnchor: true;
  macroId: string;
};

export type RouteGraphSource = {
  version: 2;
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
  macros: RouteGraphMacro[];
  metadata?: Record<string, unknown>;
};

type RouteGraphDiagnostic = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
  portId?: string;
};

type RouteFlowNodeType = RouteGraphNodeType | 'macro' | 'hidden_supply_anchor';
type RouteFlowNodeData =
  | (RouteGraphNode & { __cardMetrics?: string[] })
  | (RouteGraphMacro & {
    __isMacroNode: true;
    __cardMetrics?: string[];
    __hiddenSupplyByPort?: Record<string, number>;
    __expandedSupply?: boolean;
    __hiddenSupplyCount?: number;
    __onToggleSupply?: (macroId: string) => void;
    __onExpandGenerated?: (macroId: string) => void;
  })
  | HiddenSupplyAnchorData;
type RouteFlowNode = Node<RouteFlowNodeData, RouteFlowNodeType>;
type RouteFlowEdge = Edge<RouteFlowEdgeData, 'routeGraphEdge'>;
type SelectionState =
  | { kind: 'graph' }
  | { kind: 'node'; nodeId: string }
  | { kind: 'edge'; edgeId: string }
  | { kind: 'port'; nodeId: string; portId: string }
  | { kind: 'macro'; macroId: string };
type InspectorAnchor = {
  x: number;
  y: number;
  side: 'left' | 'right';
  mode?: 'auto' | 'manual';
};
type InspectorAnchorInputRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
type GraphContextMenuState = {
  instance: number;
  x: number;
  y: number;
  position: { x: number; y: number };
  target: SelectionState;
};
type GraphSelectionState = {
  nodeIds: string[];
  edgeIds: string[];
};
type RouteGraphVersionSummary = {
  id: number;
  version: number;
  status: string;
  createdBy: string | null;
  createdAt: string | null;
  activatedAt: string | null;
  sourceSummary?: {
    nodes: number;
    edges: number;
    macros: number;
    publicModels: number;
  };
};
type RouteGraphDiffRow = {
  kind: 'node' | 'edge' | 'macro';
  id: string;
  change: 'added' | 'removed' | 'changed';
};

export type RouteGraphFocusIntent =
  | { id: number; kind: 'macro'; macroId: string }
  | { id: number; kind: 'node'; nodeId: string; macroId?: string | null };

type RouteGraphWorkbenchProps = {
  mode?: 'graph' | 'json';
  focusIntent?: RouteGraphFocusIntent | null;
  onFocusIntentConsumed?: (id: number) => void;
};
type ViewState = {
  showGeneratedPrimitives: boolean;
  expandedMacroIds: string[];
  expandedSupplyMacroIds: string[];
  highlightSelectedPath: boolean;
};
const INSPECTOR_TABS = ['Overview', 'Config', 'Ports', 'Connections', 'JSON'] as const;
const BOTTOM_TABS = ['Diagnostics', 'Diff', 'History'] as const;
const QUICK_TEMPLATE_IDS = ['entry', 'dispatcher', 'route_endpoint', 'reasoning_effort'] as const;
const ROUTE_GRAPH_MINIMAP_NODE_LIMIT = 240;
export const DEFAULT_ROUTE_GRAPH_VIEW_STATE: ViewState = {
  showGeneratedPrimitives: false,
  expandedMacroIds: [],
  expandedSupplyMacroIds: [],
  highlightSelectedPath: true,
};

function normalizeEndpointId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

function routeGraphAccentStyle(color: string): CSSProperties {
  return { '--route-graph-accent': color } as CSSProperties;
}

function hiddenSupplyAnchorNodeId(macroId: string): string {
  return `hidden-supply-anchor:${macroId}`;
}

function routeGraphSafeId(value: string): string {
  return String(value || 'x')
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';
}

function macroDispatcherNodeId(macroId: string): string {
  return `macro:${routeGraphSafeId(macroId)}:dispatcher`;
}

function getVisibleMacroSupplyTarget(input: {
  macro: RouteGraphMacro;
  visibleNodeIds: Set<string>;
  visibleMacroIds: Set<string>;
}): { nodeId: string; kind: 'macro' | 'dispatcher' } | null {
  const macroNodeId = macroFlowNodeId(input.macro.id);
  if (input.visibleMacroIds.has(macroNodeId) || input.visibleMacroIds.has(input.macro.id)) {
    return { nodeId: macroNodeId, kind: 'macro' };
  }
  const dispatcherNodeId = macroDispatcherNodeId(input.macro.id);
  if (input.visibleNodeIds.has(dispatcherNodeId)) {
    return { nodeId: dispatcherNodeId, kind: 'dispatcher' };
  }
  return null;
}

export function defaultGraph(): RouteGraphSource {
  return { version: 2, nodes: [], edges: [], macros: [], metadata: {} };
}

function comparableGraphEntity(value: unknown): string {
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function diffEntityCollection<T extends { id: string }>(
  kind: RouteGraphDiffRow['kind'],
  baseItems: T[] = [],
  currentItems: T[] = [],
): RouteGraphDiffRow[] {
  const rows: RouteGraphDiffRow[] = [];
  const baseById = new Map(baseItems.map((item) => [item.id, item]));
  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  for (const [id, current] of currentById) {
    const base = baseById.get(id);
    if (!base) {
      rows.push({ kind, id, change: 'added' });
    } else if (comparableGraphEntity(base) !== comparableGraphEntity(current)) {
      rows.push({ kind, id, change: 'changed' });
    }
  }
  for (const id of baseById.keys()) {
    if (!currentById.has(id)) rows.push({ kind, id, change: 'removed' });
  }
  return rows;
}

function getRouteGraphDiffRows(baseGraph: RouteGraphSource | null, currentGraph: RouteGraphSource): RouteGraphDiffRow[] {
  if (!baseGraph) return [];
  return [
    ...diffEntityCollection('macro', baseGraph.macros || [], currentGraph.macros || []),
    ...diffEntityCollection('node', baseGraph.nodes || [], currentGraph.nodes || []),
    ...diffEntityCollection('edge', baseGraph.edges || [], currentGraph.edges || []),
  ].sort((left, right) => {
    const changeOrder = { added: 0, changed: 1, removed: 2 } as const;
    if (changeOrder[left.change] !== changeOrder[right.change]) return changeOrder[left.change] - changeOrder[right.change];
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    return left.id.localeCompare(right.id);
  });
}

function formatRouteGraphTimestamp(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function routeEndpointIdFromRouteId(routeId: number): string {
  return `route-endpoint:product:route:${Math.trunc(routeId)}`;
}

function routeIdFromRouteEndpointId(endpointId: unknown): number | null {
  const match = /^route-endpoint:(?:product|supply):route:(\d+)/.exec(String(endpointId || ''));
  if (!match) return null;
  const routeId = Number(match[1]);
  return Number.isFinite(routeId) && routeId > 0 ? Math.trunc(routeId) : null;
}

function normalizeRouteIdsFromMacroInput(input: Record<string, any>): number[] {
  const endpointRouteIds = Array.isArray(input.endpointIds)
    ? input.endpointIds
      .map(routeIdFromRouteEndpointId)
      .filter((routeId): routeId is number => routeId !== null)
    : [];
  return Array.from(new Set(endpointRouteIds));
}

function getNodePort(node: RouteGraphNode | null, portId?: string | null): RouteGraphPort | null {
  if (!node || !portId) return null;
  return getNodePorts(node).find((port) => port.id === portId) || null;
}

function getMacroPort(macro: RouteGraphMacro | null, portId?: string | null): RouteGraphPort | null {
  if (!macro || !portId) return null;
  return getRouteGraphMacroPort(macro, portId) as RouteGraphPort | null;
}

function getMacroPorts(macro: RouteGraphMacro | null): RouteGraphPort[] {
  if (!macro) return [];
  return getRouteGraphMacroPorts(macro) as RouteGraphPort[];
}

function isMacroFlowNodeData(data: RouteFlowNodeData): data is RouteGraphMacro & { __isMacroNode: true; __cardMetrics?: string[] } {
  return (data as { __isMacroNode?: boolean }).__isMacroNode === true;
}

function isHiddenSupplyAnchorData(data: RouteFlowNodeData): data is HiddenSupplyAnchorData {
  return (data as { __hiddenSupplyAnchor?: boolean }).__hiddenSupplyAnchor === true;
}

function isRouteGraphMacroItem(item: RouteGraphNode | RouteGraphMacro | null): item is RouteGraphMacro {
  return !!item && typeof item === 'object' && typeof (item as RouteGraphMacro).kind === 'string' && 'config' in item && !('type' in item);
}

function getSelectionNodeId(selection: SelectionState): string | null {
  if (selection.kind === 'node' || selection.kind === 'port') return selection.nodeId;
  return null;
}

function getSelectionPortId(selection: SelectionState): string | null {
  return selection.kind === 'port' ? selection.portId : null;
}

function getSelectionMacroId(selection: SelectionState): string | null {
  return selection.kind === 'macro' ? selection.macroId : null;
}

function selectionFromFlowNodeId(nodeId: string, nodeType?: string | null): SelectionState {
  return nodeType ? selectionFromFlowNode({ id: nodeId, type: nodeType }) : deriveSelectionFromFlowNodeId(nodeId);
}

function normalizeEdge(edge: Partial<RouteGraphEdge>): RouteGraphEdge {
  const sourceNodeId = String(edge.sourceNodeId || '');
  const sourcePortId = String(edge.sourcePortId || '');
  const targetNodeId = String(edge.targetNodeId || '');
  const targetPortId = String(edge.targetPortId || '');
  return {
    id: edge.id || `edge:${sourceNodeId}:${sourcePortId}:${targetNodeId}:${targetPortId}`,
    sourceNodeId,
    sourcePortId,
    targetNodeId,
    targetPortId,
    kind: edge.kind || 'request_flow',
    ownership: edge.ownership || 'manual',
    metadata: edge.metadata && typeof edge.metadata === 'object' ? edge.metadata as Record<string, unknown> : undefined,
  };
}

function normalizeGraph(input: unknown): RouteGraphSource {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as any : {};
  const normalizeNodeType = (type: unknown): RouteGraphNodeType => (
    ROUTE_GRAPH_NODE_TYPES.includes(type as RouteGraphNodeType) ? type as RouteGraphNodeType : 'entry'
  );
  return {
    version: 2,
    nodes: Array.isArray(raw.nodes) ? raw.nodes.map((node: any) => ({
      ...node,
      id: String(node.id || ''),
      type: normalizeNodeType(node.type),
      enabled: node.enabled !== false,
      visibility: node.visibility === 'internal' ? 'internal' : 'public',
      ownership: ['manual', 'auto_generated', 'system', 'derived'].includes(node.ownership) ? node.ownership : 'manual',
    })).filter((node: RouteGraphNode) => node.id) : [],
    edges: Array.isArray(raw.edges)
      ? raw.edges.map((edge: any) => normalizeEdge(edge)).filter((edge: RouteGraphEdge) => (
        edge.sourceNodeId && edge.targetNodeId && edge.sourcePortId && edge.targetPortId
      ))
      : [],
    macros: Array.isArray(raw.macros)
      ? raw.macros.map((macro: any) => ({
        ...macro,
        id: String(macro.id || ''),
        kind: String(macro.kind || ''),
        enabled: macro.enabled !== false,
        visibility: macro.visibility === 'public' ? 'public' : 'internal',
        ownership: ['manual', 'auto_generated', 'system'].includes(macro.ownership) ? macro.ownership : 'manual',
        config: macro.config && typeof macro.config === 'object' ? macro.config : {},
      })).filter((macro: RouteGraphMacro) => macro.id && macro.kind)
      : [],
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
  };
}

export function filterGraphForView(graph: RouteGraphSource, view: ViewState): RouteGraphSource {
  const semanticGraph = layoutRouteGraph({
    ...graph,
    macros: graph.macros.map((macro) => (
      macro.ownership === 'manual' ? macro : { ...macro, position: undefined }
    )),
  }, { preserveExistingPositions: true });
  const expandedMacroIds = new Set(view.expandedMacroIds);
  const expandedSupplyMacroIds = new Set(view.expandedSupplyMacroIds || []);
  const usePrimitiveGraph = view.showGeneratedPrimitives || expandedMacroIds.size > 0;
  const primitiveGraph = usePrimitiveGraph ? getPrimitiveGraphForView(semanticGraph) : semanticGraph;
  const expandedPrimitiveNodeIds = new Set<string>();
  const expandedPrimitivePositions = new Map<string, { x: number; y: number }>();
  const expandedReservations: ExpandedMacroReservation[] = [];
  const expandedSupplyNodeIds = new Set<string>();
  const expandedSupplyPositions = new Map<string, { x: number; y: number }>();
  const semanticCandidateEdgesByMacroId = new Map<string, RouteGraphEdge[]>();
  for (const macro of semanticGraph.macros) {
    semanticCandidateEdgesByMacroId.set(macro.id, getMacroSemanticCandidateEdges(semanticGraph, macro));
  }
  if (!view.showGeneratedPrimitives) {
    for (const macro of semanticGraph.macros) {
      if (!expandedMacroIds.has(macro.id)) continue;
      const candidateNodeIds = new Set(getMacroCandidateNodeIdsFromEdges(primitiveGraph, macro.id));
      const expandedSupplyNodes = expandedSupplyMacroIds.has(macro.id)
        ? getSupplyNodesForSemanticCandidateEdges(semanticGraph, semanticCandidateEdgesByMacroId.get(macro.id) || [])
        : [];
      for (const node of getMacroInternalPrimitiveNodes(primitiveGraph, macro.id)) {
        expandedPrimitiveNodeIds.add(node.id);
      }
      for (const [nodeId, position] of getAnchoredMacroPrimitivePositions(
        primitiveGraph,
        macro,
        expandedSupplyNodes.length,
        candidateNodeIds,
      )) {
        expandedPrimitivePositions.set(nodeId, position);
      }
      expandedReservations.push(...getExpandedMacroReservations(
        primitiveGraph,
        macro,
        expandedSupplyNodes.length,
        candidateNodeIds,
      ));
    }
    for (const macro of semanticGraph.macros) {
      if (!expandedSupplyMacroIds.has(macro.id)) continue;
      const edges = semanticCandidateEdgesByMacroId.get(macro.id) || [];
      const supplyNodes = getSupplyNodesForSemanticCandidateEdges(semanticGraph, edges);
      const candidateNodeIds = new Set(getMacroCandidateNodeIdsFromEdges(primitiveGraph, macro.id));
      const occupiedInputPositions = expandedMacroIds.has(macro.id)
        ? getAnchoredMacroPrimitivePositions(primitiveGraph, macro, supplyNodes.length, candidateNodeIds)
          .map(([, position]) => position)
          .filter((position) => Math.abs(position.x - ((macro.position?.x || 120) + EXPANDED_MACRO_INPUT_X_OFFSET)) < 1)
        : [];
      for (const node of supplyNodes) expandedSupplyNodeIds.add(node.id);
      for (const [nodeId, position] of getAnchoredMacroSupplyPositions(macro, supplyNodes, occupiedInputPositions)) {
        expandedSupplyPositions.set(nodeId, position);
      }
    }
  }
  const visibleNodeIds = new Set<string>();
  const visibleNodes = primitiveGraph.nodes
    .filter((node) => (
      view.showGeneratedPrimitives
      || (node.ownership !== 'auto_generated' && node.ownership !== 'derived')
      || expandedPrimitiveNodeIds.has(node.id)
      || expandedSupplyNodeIds.has(node.id)
    ))
    .map((node) => {
      visibleNodeIds.add(node.id);
      const supplyPosition = expandedSupplyPositions.get(node.id);
      if (supplyPosition) return { ...node, position: supplyPosition };
      const position = expandedPrimitivePositions.get(node.id);
      if (position) return { ...node, position };
      const shiftedPosition = shiftPositionForExpandedMacroReservations(node.position, expandedReservations);
      return shiftedPosition === node.position ? node : { ...node, position: shiftedPosition };
    });
  const visibleMacroIds = new Set(
    semanticGraph.macros
      .filter((macro) => !view.showGeneratedPrimitives && !expandedMacroIds.has(macro.id))
      .map((macro) => macroFlowNodeId(macro.id)),
  );
  return {
    ...semanticGraph,
    nodes: visibleNodes,
    macros: stackVisibleMacrosAfterExpandedReservations(
      semanticGraph.macros.filter((macro) => visibleMacroIds.has(macroFlowNodeId(macro.id))),
      expandedReservations,
    ),
    edges: Array.from(new Map(getEdgesForVisibleRouteGraph({
      semanticGraph,
      primitiveGraph,
      showGeneratedPrimitives: view.showGeneratedPrimitives,
      hasExpandedMacros: expandedMacroIds.size > 0,
      expandedSupplyMacroIds,
    })
      .filter((edge) => (
        (visibleNodeIds.has(edge.sourceNodeId) || visibleMacroIds.has(edge.sourceNodeId))
        && (visibleNodeIds.has(edge.targetNodeId) || visibleMacroIds.has(edge.targetNodeId))
      ))
      .map((edge) => [edge.id, edge])).values()),
  };
}

function getEdgesForVisibleRouteGraph(input: {
  semanticGraph: RouteGraphSource;
  primitiveGraph: RouteGraphSource;
  showGeneratedPrimitives: boolean;
  hasExpandedMacros: boolean;
  expandedSupplyMacroIds: Set<string>;
}): RouteGraphEdge[] {
  if (input.showGeneratedPrimitives) return input.primitiveGraph.edges;
  const supplyEdges = getExpandedSupplySemanticEdges(input.semanticGraph, input.expandedSupplyMacroIds);
  if (input.hasExpandedMacros) return [...input.primitiveGraph.edges, ...input.semanticGraph.edges, ...supplyEdges];
  if (supplyEdges.length > 0) return [...input.semanticGraph.edges, ...supplyEdges];
  return input.semanticGraph.edges;
}

function getSupplyNodesForSemanticCandidateEdges(graph: RouteGraphSource, edges: RouteGraphEdge[]): RouteGraphNode[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodes: RouteGraphNode[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const node = nodeById.get(edge.sourceNodeId);
    if (!node || node.type !== 'route_endpoint' || node.endpointKind !== 'supply' || seen.has(node.id)) continue;
    seen.add(node.id);
    nodes.push(node);
  }
  return nodes;
}

function getExpandedSupplySemanticEdges(graph: RouteGraphSource, expandedSupplyMacroIds: Set<string>): RouteGraphEdge[] {
  if (expandedSupplyMacroIds.size === 0) return [];
  return graph.macros.flatMap((macro) => expandedSupplyMacroIds.has(macro.id) ? getMacroSemanticCandidateEdges(graph, macro) : []);
}

function getAnchoredMacroSupplyPositions(
  macro: RouteGraphMacro,
  supplyNodes: RouteGraphNode[],
  occupiedInputPositions: Array<{ x: number; y: number }> = [],
): Array<[string, { x: number; y: number }]> {
  const anchor = macro.position || { x: 120, y: 120 };
  const sortedSupplyNodes = supplyNodes
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
  if (occupiedInputPositions.length === 0) {
    const startY = anchor.y - Math.max(0, sortedSupplyNodes.length - 1) * (EXPANDED_MACRO_STACK_Y_GAP / 2);
    return sortedSupplyNodes.map((node, index) => [node.id, { x: anchor.x + EXPANDED_MACRO_INPUT_X_OFFSET, y: startY + index * EXPANDED_MACRO_STACK_Y_GAP }]);
  }

  const occupiedYs = occupiedInputPositions.map((position) => position.y);
  const totalSlots = occupiedYs.length + sortedSupplyNodes.length;
  const startY = anchor.y - Math.max(0, totalSlots - 1) * (EXPANDED_MACRO_STACK_Y_GAP / 2);
  const slots = Array.from({ length: totalSlots }, (_, index) => startY + index * EXPANDED_MACRO_STACK_Y_GAP);
  const availableSlots = slots.filter((slotY) => !occupiedYs.some((occupiedY) => Math.abs(occupiedY - slotY) < EXPANDED_MACRO_STACK_Y_GAP / 2));
  return sortedSupplyNodes.map((node, index) => {
    const fallbackY = (Math.max(...occupiedYs) || anchor.y) + (index + 1) * EXPANDED_MACRO_STACK_Y_GAP;
    return [node.id, { x: anchor.x + EXPANDED_MACRO_INPUT_X_OFFSET, y: availableSlots[index] ?? fallbackY }];
  });
}

export type MacroGeneratedPreviewRow = {
  id: string;
  routeId: number | null;
  entryId: string | null;
  dispatcherId: string | null;
  endpointId: string;
  nodeIds: string[];
  links: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    label: string;
  }>;
  index: number;
  groupIndex: number;
  groupLabel: string;
  priority: number;
};

export type MacroGeneratedPreviewGraph = {
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
};

const EXPANDED_MACRO_INPUT_X_OFFSET = -276;
const EXPANDED_MACRO_OUTPUT_X_OFFSET = 276;
const EXPANDED_MACRO_STACK_Y_GAP = 96;
const EXPANDED_MACRO_ESTIMATED_NODE_HEIGHT = 96;
const EXPANDED_MACRO_RESERVED_GAP = 32;
const EXPANDED_MACRO_COLLISION_COLUMN_WIDTH = 172;
const HIDDEN_SUPPLY_CONTROL_LENGTH = 72;
const HIDDEN_SUPPLY_DISPATCHER_CONTROL_LENGTH = 38;
const HIDDEN_SUPPLY_CONTROL_PORT_ROW_HEIGHT = 15;
const HIDDEN_SUPPLY_CONTROL_MACRO_PORTS_TOP = 33;
const HIDDEN_SUPPLY_CONTROL_PORT_CENTER_OFFSET = 7;
const HIDDEN_SUPPLY_CONTROL_SOURCE_Y_OFFSET = 3;
const ROUTE_GRAPH_NODE_WIDTH = 224;
const ROUTE_GRAPH_NODE_HEIGHT_ESTIMATE = 120;

type ExpandedMacroReservation = {
  macroId: string;
  x: number;
  top: number;
  reservedBottom: number;
};

function getPrimitiveGraphForView(graph: RouteGraphSource): RouteGraphSource {
  return normalizeGraph(lowerRouteGraphSource(graph).primitiveSource);
}

function getRecordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getPrimitiveNodeMacroId(node: RouteGraphNode): string | null {
  const provenance = getRecordValue(node.provenance);
  if (provenance?.source === 'macro' && typeof provenance.macroId === 'string') return provenance.macroId;
  const metadata = getRecordValue(node.metadata);
  const macroCandidate = getRecordValue(metadata?.macroCandidate);
  return typeof macroCandidate?.macroId === 'string' ? macroCandidate.macroId : null;
}

function getPrimitiveNodeMacroRole(node: RouteGraphNode): string {
  const provenance = getRecordValue(node.provenance);
  if (typeof provenance?.role === 'string') return provenance.role;
  const metadata = getRecordValue(node.metadata);
  return getRecordValue(metadata?.macroCandidate) ? 'candidate_endpoint' : '';
}

function getPrimitiveEdgeMacroId(edge: RouteGraphEdge): string | null {
  const metadata = getRecordValue(edge.metadata);
  const provenance = getRecordValue(metadata?.provenance);
  return (provenance?.source === 'macro' || provenance?.source === 'macro_semantic_edge') && typeof provenance.macroId === 'string' ? provenance.macroId : null;
}

function getPrimitiveEdgeMacroRole(edge: RouteGraphEdge): string {
  const metadata = getRecordValue(edge.metadata);
  const provenance = getRecordValue(metadata?.provenance);
  return typeof provenance?.role === 'string' ? provenance.role : '';
}

function getMacroCandidateNodeIdsFromEdges(primitiveGraph: RouteGraphSource, macroId: string): string[] {
  const candidateNodeIds = new Set<string>();
  const generatedNodeIds = new Set(
    primitiveGraph.nodes
      .filter((node) => getPrimitiveNodeMacroId(node) === macroId)
      .map((node) => node.id),
  );
  for (const edge of primitiveGraph.edges) {
    if (getPrimitiveEdgeMacroId(edge) !== macroId || getPrimitiveEdgeMacroRole(edge) !== 'candidate_edge') continue;
    if (generatedNodeIds.has(edge.targetNodeId)) candidateNodeIds.add(edge.sourceNodeId);
    if (generatedNodeIds.has(edge.sourceNodeId)) candidateNodeIds.add(edge.targetNodeId);
  }
  return Array.from(candidateNodeIds);
}

function getMacroGeneratedPrimitiveNodes(primitiveGraph: RouteGraphSource, macroId: string): RouteGraphNode[] {
  const candidateNodeIds = new Set(getMacroCandidateNodeIdsFromEdges(primitiveGraph, macroId));
  return primitiveGraph.nodes.filter((node) => getPrimitiveNodeMacroId(node) === macroId || candidateNodeIds.has(node.id));
}

function getMacroInternalPrimitiveNodes(primitiveGraph: RouteGraphSource, macroId: string): RouteGraphNode[] {
  return primitiveGraph.nodes.filter((node) => getPrimitiveNodeMacroId(node) === macroId);
}

function getMacroSemanticCandidateEdges(graph: RouteGraphSource, macro: RouteGraphMacro): RouteGraphEdge[] {
  const macroNodeId = macroFlowNodeId(macro.id);
  return graph.edges.filter((edge) => (
    edge.targetNodeId === macroNodeId
    && edge.targetPortId === 'candidates.in'
    && edge.sourcePortId === 'route.out'
  ));
}

export function getMacroGeneratedPreviewGraph(graph: RouteGraphSource, macro: RouteGraphMacro): MacroGeneratedPreviewGraph {
  const primitiveGraph = getPrimitiveGraphForView(graph);
  const nodeIds = new Set(getMacroGeneratedPrimitiveNodes(primitiveGraph, macro.id).map((node) => node.id));
  const edges = primitiveGraph.edges.filter((edge) => (
    (getPrimitiveEdgeMacroId(edge) === macro.id || (nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)))
    && nodeIds.has(edge.sourceNodeId)
    && nodeIds.has(edge.targetNodeId)
  ));
  const edgeEndpointIds = new Set(edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]));
  const nodes = primitiveGraph.nodes.filter((node) => nodeIds.has(node.id) || edgeEndpointIds.has(node.id));
  return {
    nodes,
    edges,
  };
}

function getMacroPreviewEdgeLabel(edge: RouteGraphEdge): string {
  const role = getPrimitiveEdgeMacroRole(edge);
  if (role === 'candidate_edge') return 'candidate input';
  if (role === 'entry_dispatcher_edge') return 'entry';
  return edge.kind || 'link';
}

function getExpandedMacroCandidateNodes(primitiveGraph: RouteGraphSource, macroId: string): RouteGraphNode[] {
  return getMacroGeneratedPrimitiveNodes(primitiveGraph, macroId).filter((node) => {
    const role = getPrimitiveNodeMacroRole(node);
    return role.endsWith('_endpoint') || getRecordValue(getRecordValue(node.metadata)?.macroCandidate);
  });
}

export function getMacroGeneratedPreviewRows(graph: RouteGraphSource, macro: RouteGraphMacro): MacroGeneratedPreviewRow[] {
  const primitiveGraph = getPrimitiveGraphForView(graph);
  const generatedNodes = getMacroGeneratedPrimitiveNodes(primitiveGraph, macro.id);
  const entryId = generatedNodes.find((node) => getPrimitiveNodeMacroRole(node) === 'entry')?.id || null;
  const dispatcherId = generatedNodes.find((node) => getPrimitiveNodeMacroRole(node) === 'dispatcher')?.id || null;
  const groupPreviews = getMacroGroupPreviews(macro);
  const groupById = new Map(groupPreviews.map((group) => [group.id, group]));
  const candidateEdges = primitiveGraph.edges.filter((edge) => (
    getPrimitiveEdgeMacroId(edge) === macro.id
    && getPrimitiveEdgeMacroRole(edge) === 'candidate_edge'
    && (!dispatcherId || edge.sourceNodeId === dispatcherId || edge.targetNodeId === dispatcherId)
  ));
  if (candidateEdges.length > 0) {
    return candidateEdges.map((edge, index) => {
      const metadata = getRecordValue(edge.metadata);
      const candidateMetadata = getRecordValue(metadata?.candidate);
      const groupMetadata = getRecordValue(metadata?.group);
      const groupId = typeof groupMetadata?.id === 'string' ? groupMetadata.id : '';
      const group = groupById.get(groupId);
      const candidateId = edge.sourceNodeId === dispatcherId ? edge.targetNodeId : edge.sourceNodeId;
      const candidateNode = primitiveGraph.nodes.find((node) => node.id === candidateId) || null;
      const metadataRouteId = Number(candidateMetadata?.routeId);
      const endpointId = String(candidateMetadata?.routeEndpointId || candidateId);
      const endpointRouteId = routeIdFromRouteEndpointId(endpointId);
      const nodeRouteId = Number(candidateNode?.routeId || candidateNode?.legacyRouteId);
      const priority = Number(candidateMetadata?.priority);
      const nodeIds = [entryId, dispatcherId, candidateId].filter((nodeId): nodeId is string => !!nodeId);
      const entryEdge = primitiveGraph.edges.find((item) => (
        entryId
        && dispatcherId
        && item.sourceNodeId === entryId
        && item.targetNodeId === dispatcherId
      ));
      return {
        id: edge.id,
        routeId: Number.isFinite(metadataRouteId) && metadataRouteId > 0
          ? Math.trunc(metadataRouteId)
          : endpointRouteId ?? (Number.isFinite(nodeRouteId) && nodeRouteId > 0 ? Math.trunc(nodeRouteId) : null),
        entryId,
        dispatcherId,
        endpointId,
        nodeIds: Array.from(new Set(nodeIds)),
        links: [
          ...(entryEdge ? [{
            id: entryEdge.id,
            sourceNodeId: entryEdge.sourceNodeId,
            targetNodeId: entryEdge.targetNodeId,
            label: getMacroPreviewEdgeLabel(entryEdge),
          }] : []),
          {
            id: edge.id,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
            label: getMacroPreviewEdgeLabel(edge),
          },
        ],
        index,
        groupIndex: group?.index ?? index,
        groupLabel: group?.label || groupId || `Candidate ${index + 1}`,
        priority: Number.isFinite(priority) ? Math.trunc(priority) : group?.priority ?? index,
      };
    });
  }
  const candidates = generatedNodes.filter((node) => {
    const role = getPrimitiveNodeMacroRole(node);
    return role.endsWith('_endpoint') || getRecordValue(getRecordValue(node.metadata)?.macroCandidate);
  });

  const candidateRows = candidates.map((candidate, index) => {
    const macroCandidate = getRecordValue(getRecordValue(candidate.metadata)?.macroCandidate);
    const groupId = typeof macroCandidate?.groupId === 'string' ? macroCandidate.groupId : '';
    const group = groupById.get(groupId);
    const routeId = Number(macroCandidate?.routeId);
    const priority = Number(macroCandidate?.priority);
    const nodeIds = [entryId, dispatcherId, candidate.id].filter((nodeId): nodeId is string => !!nodeId);
    return {
      id: candidate.id,
      routeId: Number.isFinite(routeId) && routeId > 0 ? Math.trunc(routeId) : null,
      entryId,
      dispatcherId,
      endpointId: candidate.id,
      nodeIds: Array.from(new Set(nodeIds)),
      links: dispatcherId ? [{
        id: `${candidate.id}:candidate-preview-link`,
        sourceNodeId: candidate.id,
        targetNodeId: dispatcherId,
        label: 'candidate input',
      }] : [],
      index,
      groupIndex: group?.index ?? index,
      groupLabel: group?.label || groupId || `Candidate ${index + 1}`,
      priority: Number.isFinite(priority) ? Math.trunc(priority) : group?.priority ?? index,
    };
  });
  if (candidateRows.length > 0) return candidateRows;

  return groupPreviews.flatMap((group) => {
    const rawGroup = getMacroGroups(macro)[group.index] || {};
    const input = getRecordValue(rawGroup.input);
    const endpointIds = Array.isArray(input?.endpointIds)
      ? input.endpointIds.map((endpointId) => String(endpointId || '').trim()).filter(Boolean)
      : [];
    return endpointIds.map((endpointId, endpointIndex) => {
      const routeEndpoint = graph.nodes.find((node) => (
        node.type === 'route_endpoint'
        && (node.id === endpointId || node.routeEndpointId === endpointId || node.endpointId === endpointId)
      )) || primitiveGraph.nodes.find((node) => (
        node.type === 'route_endpoint'
        && (node.id === endpointId || node.routeEndpointId === endpointId || node.endpointId === endpointId)
      )) || null;
      const endpointRouteId = routeIdFromRouteEndpointId(endpointId);
      const nodeRouteId = Number(routeEndpoint?.routeId || routeEndpoint?.legacyRouteId);
      const rowIndex = group.index + endpointIndex;
      return {
        id: `${macro.id}:${group.id}:${endpointId}`,
        routeId: endpointRouteId ?? (Number.isFinite(nodeRouteId) && nodeRouteId > 0 ? Math.trunc(nodeRouteId) : null),
        entryId,
        dispatcherId,
        endpointId,
        nodeIds: Array.from(new Set([entryId, dispatcherId, routeEndpoint?.id || endpointId].filter((nodeId): nodeId is string => !!nodeId))),
        links: dispatcherId ? [{
          id: `${macro.id}:${group.id}:${endpointId}:candidate-preview-link`,
          sourceNodeId: routeEndpoint?.id || endpointId,
          targetNodeId: dispatcherId,
          label: 'candidate input',
        }] : [],
        index: rowIndex,
        groupIndex: group.index,
        groupLabel: group.label,
        priority: group.priority,
      };
    });
  });
}

export function getMacroPriorityGroupCount(macro: RouteGraphMacro, generatedRows: MacroGeneratedPreviewRow[] = []): number {
  const rowPriorities = new Set<number>();
  for (const row of generatedRows) {
    const priority = Number(row.priority);
    if (Number.isFinite(priority)) rowPriorities.add(Math.trunc(priority));
  }
  if (rowPriorities.size > 0) return rowPriorities.size;

  const groupPriorities = new Set<number>();
  for (const group of getMacroGroupPreviews(macro)) {
    if (!group.enabled) continue;
    const priority = Number(group.priority);
    if (Number.isFinite(priority)) groupPriorities.add(Math.trunc(priority));
  }
  return groupPriorities.size;
}

function getAnchoredMacroPrimitivePositions(
  primitiveGraph: RouteGraphSource,
  macro: RouteGraphMacro,
  extraInputSlotCount = 0,
  excludedInputNodeIds: ReadonlySet<string> = new Set(),
): Array<[string, { x: number; y: number }]> {
  const anchor = macro.position || { x: 120, y: 120 };
  const generatedNodes = getMacroGeneratedPrimitiveNodes(primitiveGraph, macro.id);
  const dispatcher = generatedNodes.find((node) => getPrimitiveNodeMacroRole(node) === 'dispatcher');
  const dispatcherId = dispatcher?.id;
  const generatedNodeIds = new Set(generatedNodes.map((node) => node.id));
  const inputNodeIds = new Set<string>();
  const outputNodeIds = new Set<string>();
  const candidateEdgeSourceIds = new Set<string>();
  if (dispatcherId) {
    for (const edge of primitiveGraph.edges) {
      const isCandidateEdge = getPrimitiveEdgeMacroId(edge) === macro.id && getPrimitiveEdgeMacroRole(edge) === 'candidate_edge';
      if (edge.targetNodeId === dispatcherId && (generatedNodeIds.has(edge.sourceNodeId) || isCandidateEdge)) {
        inputNodeIds.add(edge.sourceNodeId);
        if (isCandidateEdge) candidateEdgeSourceIds.add(edge.sourceNodeId);
      }
      if (edge.sourceNodeId === dispatcherId && generatedNodeIds.has(edge.targetNodeId)) outputNodeIds.add(edge.targetNodeId);
    }
  }
  for (const node of generatedNodes) {
    if (node.id === dispatcherId || inputNodeIds.has(node.id) || outputNodeIds.has(node.id)) continue;
    const role = getPrimitiveNodeMacroRole(node);
    if (role === 'entry' || role.endsWith('_endpoint') || candidateEdgeSourceIds.has(node.id) || getRecordValue(getRecordValue(node.metadata)?.macroCandidate)) {
      inputNodeIds.add(node.id);
    } else {
      outputNodeIds.add(node.id);
    }
  }
  const sortByRoleThenId = (left: RouteGraphNode, right: RouteGraphNode) => {
    const leftRole = getPrimitiveNodeMacroRole(left);
    const rightRole = getPrimitiveNodeMacroRole(right);
    if (leftRole === 'entry' && rightRole !== 'entry') return -1;
    if (rightRole === 'entry' && leftRole !== 'entry') return 1;
    return left.id.localeCompare(right.id);
  };
  const inputNodes = generatedNodes
    .filter((node) => inputNodeIds.has(node.id) && !excludedInputNodeIds.has(node.id))
    .sort(sortByRoleThenId);
  const outputNodes = generatedNodes.filter((node) => outputNodeIds.has(node.id)).sort(sortByRoleThenId);
  const positions: Array<[string, { x: number; y: number }]> = [];
  if (dispatcher) positions.push([dispatcher.id, { x: anchor.x, y: anchor.y }]);
  const inputSlotCount = inputNodes.length + extraInputSlotCount;
  const inputStartY = anchor.y - Math.max(0, inputSlotCount - 1) * (EXPANDED_MACRO_STACK_Y_GAP / 2);
  inputNodes.forEach((node, index) => {
    positions.push([node.id, { x: anchor.x + EXPANDED_MACRO_INPUT_X_OFFSET, y: inputStartY + index * EXPANDED_MACRO_STACK_Y_GAP }]);
  });
  const outputStartY = anchor.y - Math.max(0, outputNodes.length - 1) * (EXPANDED_MACRO_STACK_Y_GAP / 2);
  outputNodes.forEach((node, index) => {
    positions.push([node.id, { x: anchor.x + EXPANDED_MACRO_OUTPUT_X_OFFSET, y: outputStartY + index * EXPANDED_MACRO_STACK_Y_GAP }]);
  });
  return positions;
}

function getExpandedMacroReservations(
  primitiveGraph: RouteGraphSource,
  macro: RouteGraphMacro,
  extraInputSlotCount = 0,
  excludedInputNodeIds: ReadonlySet<string> = new Set(),
): ExpandedMacroReservation[] {
  const positions = getAnchoredMacroPrimitivePositions(primitiveGraph, macro, extraInputSlotCount, excludedInputNodeIds);
  const anchor = macro.position || { x: 120, y: 120 };
  const byColumn = new Map<number, { top: number; bottom: number }>();
  for (const [, position] of positions.length > 0 ? positions : [[macroFlowNodeId(macro.id), anchor] as const]) {
    const current = byColumn.get(position.x);
    const bottom = position.y + EXPANDED_MACRO_ESTIMATED_NODE_HEIGHT;
    byColumn.set(position.x, current
      ? { top: Math.min(current.top, position.y), bottom: Math.max(current.bottom, bottom) }
      : { top: position.y, bottom });
  }
  return [...byColumn.entries()].map(([x, range]) => ({
    macroId: macro.id,
    x,
    top: range.top,
    reservedBottom: range.bottom + EXPANDED_MACRO_RESERVED_GAP,
  }));
}

function shiftPositionForExpandedMacroReservations(
  position: { x: number; y: number } | undefined,
  reservations: ExpandedMacroReservation[],
): { x: number; y: number } | undefined {
  if (!position || reservations.length === 0) return position;
  let shifted = position;
  for (const reservation of [...reservations].sort((left, right) => left.top - right.top)) {
    const inCollisionColumn = Math.abs(shifted.x - reservation.x) <= EXPANDED_MACRO_COLLISION_COLUMN_WIDTH;
    if (!inCollisionColumn || shifted.y < reservation.top) continue;
    const minY = reservation.reservedBottom;
    if (shifted.y < minY) shifted = { ...shifted, y: minY };
  }
  return shifted;
}

function stackVisibleMacrosAfterExpandedReservations(
  macros: RouteGraphMacro[],
  reservations: ExpandedMacroReservation[],
): RouteGraphMacro[] {
  if (macros.length === 0 || reservations.length === 0) return macros;
  const sorted = [...macros].sort((left, right) => {
    const leftPosition = left.position || { x: 120, y: 120 };
    const rightPosition = right.position || { x: 120, y: 120 };
    if (leftPosition.x !== rightPosition.x) return leftPosition.x - rightPosition.x;
    if (leftPosition.y !== rightPosition.y) return leftPosition.y - rightPosition.y;
    return left.id.localeCompare(right.id);
  });
  const nextYByColumn = new Map<number, number>();
  const positionByMacroId = new Map<string, { x: number; y: number }>();

  for (const macro of sorted) {
    const shiftedPosition = shiftPositionForExpandedMacroReservations(macro.position, reservations);
    if (!shiftedPosition) continue;
    const column = Math.round(shiftedPosition.x / EXPANDED_MACRO_COLLISION_COLUMN_WIDTH);
    const nextY = nextYByColumn.get(column);
    const position = nextY === undefined || shiftedPosition.y >= nextY
      ? shiftedPosition
      : { ...shiftedPosition, y: nextY };
    positionByMacroId.set(macro.id, position);
    nextYByColumn.set(column, position.y + estimateRouteGraphMacroRowGap(macro));
  }

  return macros.map((macro) => {
    const position = positionByMacroId.get(macro.id);
    return position && position !== macro.position ? { ...macro, position } : macro;
  });
}

function updateNode(graph: RouteGraphSource, node: RouteGraphNode): RouteGraphSource {
  return { ...graph, nodes: graph.nodes.map((item) => (item.id === node.id ? node : item)) };
}

export function canReplaceRouteGraphNode(graph: RouteGraphSource, node: RouteGraphNode): boolean {
  const existing = graph.nodes.find((item) => item.id === node.id);
  return !!existing && existing.ownership === 'manual' && node.ownership === 'manual';
}

export function canReplaceRouteGraphMacro(graph: RouteGraphSource, macro: RouteGraphMacro): boolean {
  const existing = (graph.macros || []).find((item) => item.id === macro.id);
  return !!existing && existing.ownership === 'manual' && macro.ownership === 'manual';
}

function nonManualArtifactSignature(graph: RouteGraphSource): string {
  const byId = (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id);
  return JSON.stringify({
    nodes: graph.nodes.filter((node) => node.ownership !== 'manual').sort(byId),
    edges: graph.edges.filter((edge) => edge.ownership !== 'manual').sort(byId),
    macros: (graph.macros || []).filter((macro) => macro.ownership !== 'manual').sort(byId),
  });
}

export function preservesGeneratedRouteGraphArtifacts(base: RouteGraphSource, next: RouteGraphSource): boolean {
  return nonManualArtifactSignature(normalizeGraph(base)) === nonManualArtifactSignature(normalizeGraph(next));
}

export function computeRouteGraphInspectorAnchor(input: {
  target: InspectorAnchorInputRect;
  container: InspectorAnchorInputRect;
  bounds: InspectorAnchorInputRect;
  viewportWidth: number;
  panelWidth: number;
  panelHeight: number;
  gap?: number;
}): InspectorAnchor {
  const { target, container, bounds, viewportWidth, panelWidth, panelHeight } = input;
  const gap = input.gap ?? 12;
  const minX = bounds.left + 12;
  const maxX = bounds.right - panelWidth - 12;
  const minY = bounds.top + 12;
  const maxY = bounds.bottom - panelHeight - 12;
  const clampX = (value: number) => Math.min(Math.max(value, minX), Math.max(minX, maxX));
  const clampY = (value: number) => Math.min(Math.max(value, minY), Math.max(minY, maxY));
  const overlapArea = (left: number, top: number) => {
    const overlapWidth = Math.max(0, Math.min(left + panelWidth, target.right) - Math.max(left, target.left));
    const overlapHeight = Math.max(0, Math.min(top + panelHeight, target.bottom) - Math.max(top, target.top));
    return overlapWidth * overlapHeight;
  };
  const preferredSide: InspectorAnchor['side'] = viewportWidth - target.right >= panelWidth + gap ? 'right' : 'left';
  const candidates = [
    {
      side: 'right' as const,
      x: clampX(target.right + gap),
      y: clampY(target.top),
      priority: preferredSide === 'right' ? 0 : 1,
    },
    {
      side: 'left' as const,
      x: clampX(target.left - panelWidth - gap),
      y: clampY(target.top),
      priority: preferredSide === 'left' ? 0 : 1,
    },
    {
      side: preferredSide,
      x: clampX(target.left),
      y: clampY(target.bottom + gap),
      priority: 2,
    },
    {
      side: preferredSide,
      x: clampX(target.left),
      y: clampY(target.top - panelHeight - gap),
      priority: 3,
    },
  ];
  const best = candidates
    .map((candidate) => ({ ...candidate, overlap: overlapArea(candidate.x, candidate.y) }))
    .sort((left, right) => (
      left.overlap - right.overlap
      || left.priority - right.priority
      || left.y - right.y
      || left.x - right.x
    ))[0]!;
  return {
    x: best.x - container.left,
    y: best.y - container.top,
    side: best.side,
    mode: 'auto',
  };
}

export function isRouteGraphFlowNodeDraggable(item: RouteGraphNode | RouteGraphMacro, kind: 'node' | 'macro'): boolean {
  void kind;
  return item.ownership === 'manual';
}

export function filterRouteGraphFlowNodeChanges(changes: NodeChange<RouteFlowNode>[], nodes: RouteFlowNode[]): NodeChange<RouteFlowNode>[] {
  if (changes.length === 0) return changes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return changes.filter((change) => {
    if (change.type !== 'position') return true;
    const node = nodeById.get(change.id);
    if (!node) return true;
    if (isHiddenSupplyAnchorData(node.data)) return false;
    if (isMacroFlowNodeData(node.data)) return isRouteGraphFlowNodeDraggable(node.data, 'macro');
    return isRouteGraphFlowNodeDraggable(node.data, 'node');
  });
}

function graphToFlowNodes(
  graph: RouteGraphSource,
  view: ViewState,
  hiddenSupplyGraph: RouteGraphSource = graph,
  actions: { onToggleSupply?: (macroId: string) => void; onExpandGenerated?: (macroId: string) => void } = {},
): RouteFlowNode[] {
  const positionedGraph = layoutRouteGraph(graph, { preserveExistingPositions: true });
  const primitiveNodes: RouteFlowNode[] = positionedGraph.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    data: { ...node, __cardMetrics: getNodeCardMetrics(positionedGraph, node) },
    position: node.position || { x: 120, y: 120 },
    draggable: isRouteGraphFlowNodeDraggable(node, 'node'),
  }));
  const macroNodes: RouteFlowNode[] = positionedGraph.macros.map((macro) => ({
    id: macroFlowNodeId(macro.id),
    type: 'macro',
    data: {
      ...macro,
      __isMacroNode: true,
      __cardMetrics: getMacroCardMetrics(macro),
      __hiddenSupplyByPort: getMacroHiddenSupplyByPort(hiddenSupplyGraph, macro),
      __expandedSupply: (view.expandedSupplyMacroIds || []).includes(macro.id),
      __hiddenSupplyCount: getMacroHiddenSupplyByPort(hiddenSupplyGraph, macro)['candidates.in'] || 0,
      __onToggleSupply: actions.onToggleSupply,
      __onExpandGenerated: actions.onExpandGenerated,
    },
    position: macro.position || { x: 120, y: 120 },
    draggable: isRouteGraphFlowNodeDraggable(macro, 'macro'),
  }));
  const positionedNodeById = new Map(positionedGraph.nodes.map((node) => [node.id, node]));
  const positionedMacroById = new Map(positionedGraph.macros.map((macro) => [macro.id, macro]));
  const visibleNodeIds = new Set(positionedGraph.nodes.map((node) => node.id));
  const visibleMacroIds = new Set(positionedGraph.macros.flatMap((macro) => [macro.id, macroFlowNodeId(macro.id)]));
  const hiddenSupplyAnchorNodes = hiddenSupplyGraph.macros
    .filter((macro) => (getMacroHiddenSupplyByPort(hiddenSupplyGraph, macro)['candidates.in'] || 0) > 0)
    .filter((macro) => !view.showGeneratedPrimitives && !(view.expandedSupplyMacroIds || []).includes(macro.id))
    .map((macro): RouteFlowNode | null => {
      const target = getVisibleMacroSupplyTarget({ macro, visibleNodeIds, visibleMacroIds });
      if (!target) return null;
      const targetNode = target.kind === 'dispatcher' ? positionedNodeById.get(target.nodeId) : null;
      const anchor = target.kind === 'macro'
        ? positionedMacroById.get(macro.id)?.position
        : targetNode?.position;
      if (!anchor) return null;
      const anchorY = target.kind === 'macro'
        ? getMacroPortAnchorY(macro, 'candidates.in', anchor.y)
        : targetNode
          ? getNodePortAnchorY(targetNode, 'route.in', anchor.y)
          : anchor.y;
      const anchorX = anchor.x;
      const controlLength = target.kind === 'dispatcher'
        ? HIDDEN_SUPPLY_DISPATCHER_CONTROL_LENGTH
        : HIDDEN_SUPPLY_CONTROL_LENGTH;
      return {
        id: hiddenSupplyAnchorNodeId(macro.id),
        type: 'hidden_supply_anchor',
        data: { __hiddenSupplyAnchor: true, macroId: macro.id },
        position: { x: anchorX - controlLength, y: anchorY + HIDDEN_SUPPLY_CONTROL_SOURCE_Y_OFFSET },
        draggable: false,
        selectable: false,
      };
    })
    .filter((node): node is RouteFlowNode => node !== null);
  return [...primitiveNodes, ...macroNodes, ...hiddenSupplyAnchorNodes];
}

function getMacroPortAnchorY(macro: RouteGraphMacro, portId: string, macroY: number): number {
  const inputPorts = getMacroPorts(macro).filter((port) => port.direction === 'input');
  const index = Math.max(0, inputPorts.findIndex((port) => port.id === portId));
  return macroY
    + HIDDEN_SUPPLY_CONTROL_MACRO_PORTS_TOP
    + HIDDEN_SUPPLY_CONTROL_PORT_CENTER_OFFSET
    + index * HIDDEN_SUPPLY_CONTROL_PORT_ROW_HEIGHT;
}

function getNodePortAnchorY(node: RouteGraphNode, portId: string, nodeY: number): number {
  const inputPorts = getNodePorts(node).filter((port) => port.direction === 'input');
  const index = Math.max(0, inputPorts.findIndex((port) => port.id === portId));
  return nodeY
    + HIDDEN_SUPPLY_CONTROL_MACRO_PORTS_TOP
    + HIDDEN_SUPPLY_CONTROL_PORT_CENTER_OFFSET
    + index * HIDDEN_SUPPLY_CONTROL_PORT_ROW_HEIGHT;
}

function graphToFlowEdges(graph: RouteGraphSource, highlightedEdgeIds: Set<string>, hiddenSupplyControls: Map<string, RouteFlowEdgeData['__hiddenSupplyControl']> = new Map()): RouteFlowEdge[] {
  const edges: RouteFlowEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    type: 'routeGraphEdge' as const,
    source: edge.sourceNodeId,
    sourceHandle: edge.sourcePortId,
    target: edge.targetNodeId,
    targetHandle: edge.targetPortId,
    data: { ...edge, __highlighted: highlightedEdgeIds.has(edge.id), __hiddenSupplyControl: hiddenSupplyControls.get(edge.id) },
    animated: highlightedEdgeIds.has(edge.id),
  }));
  return edges;
}

function getHiddenSupplyControlEdges(input: {
  graph: RouteGraphSource;
  visibleGraph: RouteGraphSource;
  view: ViewState;
  onToggle: (macroId: string) => void;
}): { edges: RouteGraphEdge[]; controls: Map<string, RouteFlowEdgeData['__hiddenSupplyControl']> } {
  if (input.view.showGeneratedPrimitives) return { edges: [], controls: new Map() };
  const visibleNodeIds = new Set(input.visibleGraph.nodes.map((node) => node.id));
  const visibleMacroIds = new Set(input.visibleGraph.macros.map((macro) => macroFlowNodeId(macro.id)));
  const expandedSupplyMacroIds = new Set(input.view.expandedSupplyMacroIds || []);
  const edges: RouteGraphEdge[] = [];
  const controls = new Map<string, RouteFlowEdgeData['__hiddenSupplyControl']>();
  for (const macro of input.graph.macros) {
    const count = getMacroHiddenSupplyByPort(input.graph, macro)['candidates.in'] || 0;
    if (count <= 0) continue;
    const expanded = expandedSupplyMacroIds.has(macro.id);
    const target = getVisibleMacroSupplyTarget({ macro, visibleNodeIds, visibleMacroIds });
    if (!target) continue;
    const id = expanded ? `hidden-supply-control:${macro.id}:${target.kind}:expanded` : `hidden-supply-control:${macro.id}:${target.kind}:collapsed`;
    const sourceNodeId = expanded
      ? (getMacroSemanticCandidateEdges(input.graph, macro).find((edge) => visibleNodeIds.has(edge.sourceNodeId))?.sourceNodeId || hiddenSupplyAnchorNodeId(macro.id))
      : hiddenSupplyAnchorNodeId(macro.id);
    if (!visibleNodeIds.has(sourceNodeId) && sourceNodeId !== hiddenSupplyAnchorNodeId(macro.id)) continue;
    edges.push({
      id,
      sourceNodeId,
      sourcePortId: 'route.out',
      targetNodeId: target.nodeId,
      targetPortId: target.kind === 'macro' ? 'candidates.in' : 'route.in',
      kind: 'route_flow',
      ownership: 'derived',
      metadata: { hiddenSupplyControl: true },
    });
    controls.set(id, { macroId: macro.id, count, expanded, targetKind: target.kind, onToggle: input.onToggle });
  }
  return { edges, controls };
}

function getMacroCardMetrics(macro: RouteGraphMacro): string[] {
  const config = macro.config || {};
  const groups = Array.isArray(config.groups) ? config.groups : [];
  const candidateCount = groups.reduce((sum, group) => {
    const input = getRecordValue(group.input);
    return sum + (Array.isArray(input?.endpointIds) ? input.endpointIds.length : 0);
  }, 0);
  return [
    groups.length === 1 ? '1 group' : `${groups.length} groups`,
    candidateCount > 0 ? `${candidateCount} hidden supply` : 'no hidden supply',
    String(config.policy && typeof config.policy === 'object' && 'strategy' in config.policy ? (config.policy as any).strategy : 'priority_order'),
    macro.visibility,
  ];
}

export function getMacroHiddenSupplyByPort(graph: RouteGraphSource, macro: RouteGraphMacro): Record<string, number> {
  const counts: Record<string, number> = {};
  const endpointIds = new Set<string>();
  const supplyNodeIds = new Set(
    graph.nodes
      .filter((node) => node.type === 'route_endpoint' && node.endpointKind === 'supply')
      .flatMap((node) => [node.id, node.routeEndpointId, node.endpointId].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)),
  );
  for (const edge of getMacroSemanticCandidateEdges(graph, macro)) {
    if (supplyNodeIds.has(edge.sourceNodeId)) endpointIds.add(edge.sourceNodeId);
  }
  const groups = Array.isArray(macro.config?.groups) ? macro.config.groups : [];
  for (const group of groups) {
    const input = getRecordValue(group.input);
    if (!Array.isArray(input?.endpointIds)) continue;
    for (const endpointId of input.endpointIds) {
      const normalized = normalizeEndpointId(endpointId);
      if (normalized && supplyNodeIds.has(normalized)) endpointIds.add(normalized);
    }
  }
  if (endpointIds.size > 0) counts['candidates.in'] = endpointIds.size;
  return counts;
}

const MacroNodeShell = memo(function MacroNodeShell({ data }: NodeProps<RouteFlowNode>) {
  if (!isMacroFlowNodeData(data)) return null;
  const readonly = data.ownership !== 'manual';
  const generated = data.ownership === 'auto_generated';
  const hiddenSupplyByPort = data.__hiddenSupplyByPort || {};
  return (
    <>
      <NodeToolbar position={Position.Top} align="center" className="route-blueprint-node-toolbar">
        {(data.__hiddenSupplyCount || 0) > 0 && data.__onToggleSupply && (
          <button
            type="button"
            className="route-blueprint-toolbar-button nodrag nopan"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              data.__onToggleSupply?.(data.id);
            }}
          >
            {data.__expandedSupply ? '− Supply' : '+ Supply'}
          </button>
        )}
        {data.__onExpandGenerated && (
          <button
            type="button"
            className="route-blueprint-toolbar-button nodrag nopan"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              data.__onExpandGenerated?.(data.id);
            }}
          >
            Generated
          </button>
        )}
      </NodeToolbar>
      <div
        className={`route-blueprint-node route-blueprint-node-macro ${readonly ? 'readonly' : ''} ${data.enabled === false ? 'disabled' : ''}`}
        data-node-id={data.id}
        data-node-type="macro"
        data-ownership={data.ownership}
        style={routeGraphAccentStyle(ROUTE_GRAPH_VISUAL_COLORS.macro.candidate_selector)}
      >
      <div className="route-blueprint-node-head">
        <span className="route-blueprint-node-icon" aria-hidden="true">
          <Sparkles size={13} />
        </span>
        <div className="route-blueprint-node-head-main">
          <div className="route-blueprint-node-title">{data.name || data.id}</div>
          <div className="route-blueprint-node-subtitle">{data.kind} · macro</div>
        </div>
        <span className={`route-blueprint-node-state ${data.enabled ? 'online' : 'disabled'}`}>{generated ? tr('pages.tokenRoutes.routeGraphWorkbench.generated') : data.enabled ? tr('pages.tokenRoutes.routeGraphWorkbench.enabled') : tr('pages.tokenRoutes.routeGraphWorkbench.disabled')}</span>
      </div>
      <div className="route-blueprint-node-ports">
        {(() => {
          const ports = getMacroPorts(data);
          const inputs = ports.filter((port) => port.direction === 'input');
          const outputs = ports.filter((port) => port.direction === 'output');
          return (
            <>
              <div className="route-blueprint-port-list inputs">
                {inputs.map((port) => (
                  <PortRow
                    key={port.id}
                    nodeId={data.id}
                    port={port}
                    hiddenSupplyCount={hiddenSupplyByPort[port.id] || 0}
                  />
                ))}
              </div>
              <div className="route-blueprint-port-list outputs">
                {outputs.map((port) => <PortRow key={port.id} nodeId={data.id} port={port} />)}
              </div>
            </>
          );
        })()}
      </div>
      <div className="route-blueprint-node-metrics">
        {Array.isArray(data.__cardMetrics) ? data.__cardMetrics.map((metric) => <span key={metric}>{metric}</span>) : null}
      </div>
      </div>
    </>
  );
});

const NodeShell = memo(function NodeShell({ data }: NodeProps<RouteFlowNode>) {
  if (isMacroFlowNodeData(data) || isHiddenSupplyAnchorData(data)) return null;
  const ports = getNodePorts(data);
  const inputs = ports.filter((port) => port.direction === 'input');
  const outputs = ports.filter((port) => port.direction === 'output');
  const readonly = data.ownership !== 'manual';
  const generated = data.ownership === 'auto_generated' || data.ownership === 'derived';
  const title = getNodeTitle(data);
  const statusHistory = Array.isArray(data.statusHistory) ? data.statusHistory.slice(0, 8) : [];
  const metrics = Array.isArray(data.__cardMetrics) ? data.__cardMetrics.slice(0, 3).map(String) : [];
  return (
    <div
      className={`route-blueprint-node ${readonly ? 'readonly' : ''} ${data.enabled === false ? 'disabled' : ''}`}
      data-node-id={data.id}
      data-node-type={data.type}
      data-ownership={data.ownership}
      style={routeGraphAccentStyle(ROUTE_GRAPH_VISUAL_COLORS.node[data.type])}
    >
      <div className="route-blueprint-node-head">
        <span className="route-blueprint-node-icon" aria-hidden="true">
          {data.type === 'dispatcher' ? <GitFork size={13} /> : data.type === 'filter' ? <Workflow size={13} /> : data.type === 'route_endpoint' ? <Boxes size={13} /> : <Layers3 size={13} />}
        </span>
        <div className="route-blueprint-node-head-main">
          <div className="route-blueprint-node-title">{title}</div>
          <div className="route-blueprint-node-subtitle">{getNodeCardSubtitle(data)}</div>
        </div>
        <span className={`route-blueprint-node-state ${data.enabled ? 'online' : 'disabled'}`}>{generated ? tr('pages.tokenRoutes.routeGraphWorkbench.generated') : data.enabled ? tr('pages.tokenRoutes.routeGraphWorkbench.enabled') : tr('pages.tokenRoutes.routeGraphWorkbench.disabled')}</span>
      </div>
      <div className="route-blueprint-node-ports">
        <div className="route-blueprint-port-list inputs">
          {inputs.map((port) => (
            <PortRow key={port.id} nodeId={data.id} node={data} port={port} />
          ))}
        </div>
        <div className="route-blueprint-port-list outputs">
          {outputs.map((port) => (
            <PortRow key={port.id} nodeId={data.id} node={data} port={port} />
          ))}
        </div>
      </div>
      {metrics.length > 0 && (
        <div className="route-blueprint-node-metrics">
          {metrics.map((metric) => <span key={metric}>{metric}</span>)}
        </div>
      )}
      {statusHistory.length > 0 && (
        <div className="route-blueprint-status-history">
          {statusHistory.map((item, index) => (
            <i key={index} className={String(item)} />
          ))}
        </div>
      )}
    </div>
  );
});

const PortRow = memo(function PortRow({
  nodeId,
  node,
  port,
  hiddenSupplyCount = 0,
}: {
  nodeId: string;
  node?: RouteGraphNode;
  port: RouteGraphPort;
  hiddenSupplyCount?: number;
}) {
  const isInput = port.direction === 'input';
  const displayLabel = getPortDisplayLabel(port);
  const collection = getPortCollectionKind(port);
  const tooltip = getPortTypeSignature(port);
  const modeNote = node ? getPortModeNote(node, port) : null;
  const disabled = port.enabled === false;
  const lightweightLabel = node?.ownership !== 'manual';
  return (
    <div
      className={`route-blueprint-port ${isInput ? 'input' : 'output'} ${port.required ? 'required' : ''} ${disabled ? 'disabled' : ''} ${hiddenSupplyCount > 0 ? 'has-hidden-supply' : ''}`}
      data-port-id={port.id}
      data-kind={port.kind}
      data-hidden-supply-count={hiddenSupplyCount > 0 ? String(hiddenSupplyCount) : undefined}
      style={{
        ...routeGraphAccentStyle(ROUTE_GRAPH_VISUAL_COLORS.port[port.kind]),
        '--route-graph-hidden-edge': ROUTE_GRAPH_VISUAL_COLORS.edge.route_flow,
      } as CSSProperties}
    >
      {isInput && (
        <Handle
          id={port.id}
          type="target"
          position={Position.Left}
          className="route-blueprint-handle"
          data-kind={port.kind}
          data-collection={collection}
          data-disabled={disabled ? 'true' : undefined}
          title={tooltip}
          aria-label={tooltip}
          isConnectable={!disabled}
        />
      )}
      {lightweightLabel ? (
        <span className="route-blueprint-port-label" title={tooltip} aria-label={`${nodeId}.${port.id}`}>{displayLabel}</span>
      ) : (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span className="route-blueprint-port-label" title={`${nodeId}.${port.id}`}>{displayLabel}</span>
          </Tooltip.Trigger>
          <Tooltip.Content>{tooltip}</Tooltip.Content>
        </Tooltip.Root>
      )}
      {modeNote && <span className="route-blueprint-port-note">{modeNote}</span>}
      {!isInput && (
        <Handle
          id={port.id}
          type="source"
          position={Position.Right}
          className="route-blueprint-handle"
          data-kind={port.kind}
          data-collection={collection}
          data-disabled={disabled ? 'true' : undefined}
          title={tooltip}
          aria-label={tooltip}
          isConnectable={!disabled}
        />
      )}
    </div>
  );
});

const RouteGraphEdgeView = memo(function RouteGraphEdgeView(props: EdgeProps<RouteFlowEdge>) {
  const edge = props.data;
  const [path] = getBezierPath(props);
  const highlighted = edge?.__highlighted === true;
  const control = edge?.__hiddenSupplyControl;
  const labelX = (props.sourceX + props.targetX) / 2;
  const labelY = (props.sourceY + props.targetY) / 2;
  return (
    <>
      <g data-route-graph-edge-id={edge?.id}>
        <path className="react-flow__edge-path route-blueprint-edge-hit" d={path} data-kind={edge?.kind} />
        <path
          className={`react-flow__edge-path route-blueprint-edge ${control ? 'route-blueprint-edge-hidden-supply' : ''}`}
          d={path}
          data-kind={edge?.kind}
          style={routeGraphAccentStyle(edge ? ROUTE_GRAPH_VISUAL_COLORS.edge[edge.kind] : ROUTE_GRAPH_VISUAL_COLORS.edge.request_flow)}
          strokeWidth={props.selected || highlighted ? 3 : control ? 1.25 : 2}
          strokeDasharray={control ? '4 4' : edge?.ownership === 'auto_generated' || edge?.kind === 'metrics_link' ? '6 5' : undefined}
        />
      </g>
      {control && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className={`route-blueprint-hidden-supply-label nodrag nopan ${control.expanded ? 'is-expanded' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={`${control.expanded ? 'Collapse' : 'Expand'} ${control.count} hidden supply endpoints`}
            aria-label={`${control.expanded ? 'Collapse' : 'Expand'} ${control.count} hidden supply endpoints`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              control.onToggle(control.macroId);
            }}
          >
            {control.expanded ? '−' : '+'}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const HiddenSupplyAnchorNode = memo(function HiddenSupplyAnchorNode({ data }: NodeProps<RouteFlowNode>) {
  if (!isHiddenSupplyAnchorData(data)) return null;
  return (
    <div className="route-blueprint-hidden-supply-anchor" data-macro-id={data.macroId}>
      <Handle
        id="route.out"
        type="source"
        position={Position.Right}
        className="route-blueprint-hidden-supply-anchor-handle"
        isConnectable={false}
      />
    </div>
  );
});

const flowNodeTypes = {
  entry: NodeShell,
  route_endpoint: NodeShell,
  filter: NodeShell,
  dispatcher: NodeShell,
  synthetic_endpoint: NodeShell,
  auto_node: NodeShell,
  macro: MacroNodeShell,
  hidden_supply_anchor: HiddenSupplyAnchorNode,
} as const;
const flowEdgeTypes = { routeGraphEdge: RouteGraphEdgeView };

function getRenderedFlowNodeCenter(
  node: { position: { x: number; y: number }; width?: number | null; height?: number | null; measured?: { width?: number | null; height?: number | null } } | null | undefined,
  fallbackSize: { width: number; height: number },
): { x: number; y: number } | null {
  if (!node) return null;
  const width = Number(node.width || node.measured?.width || fallbackSize.width);
  const height = Number(node.height || node.measured?.height || fallbackSize.height);
  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  };
}

export default function RouteGraphWorkbench({ mode = 'graph', focusIntent = null, onFocusIntentConsumed }: RouteGraphWorkbenchProps) {
  return (
    <ReactFlowProvider>
      <RouteGraphWorkbenchInner mode={mode} focusIntent={focusIntent} onFocusIntentConsumed={onFocusIntentConsumed} />
    </ReactFlowProvider>
  );
}

function RouteGraphWorkbenchInner({ mode = 'graph', focusIntent = null, onFocusIntentConsumed }: RouteGraphWorkbenchProps) {
  const toast = useToast();
  const reactFlow = useReactFlow<RouteFlowNode, RouteFlowEdge>();
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const canvasPanelRef = useRef<HTMLDivElement | null>(null);
  const inspectorPanelRef = useRef<HTMLElement | null>(null);
  const suppressSelectionRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [graph, setGraph] = useState<RouteGraphSource>(defaultGraph());
  const graphRef = useRef<RouteGraphSource>(defaultGraph());
  const [undoStack, setUndoStack] = useState<RouteGraphSource[]>([]);
  const [redoStack, setRedoStack] = useState<RouteGraphSource[]>([]);
  const [activeVersion, setActiveVersion] = useState<any>(null);
  const [activeGraph, setActiveGraph] = useState<RouteGraphSource | null>(null);
  const [versionHistory, setVersionHistory] = useState<RouteGraphVersionSummary[]>([]);
  const [diagnostics, setDiagnostics] = useState<RouteGraphDiagnostic[]>([]);
  const [selection, setSelection] = useState<SelectionState>({ kind: 'graph' });
  const [inspectorTarget, setInspectorTarget] = useState<SelectionState>({ kind: 'graph' });
  const [graphSelection, setGraphSelection] = useState<GraphSelectionState>({ nodeIds: [], edgeIds: [] });
  const graphSelectionRef = useRef<GraphSelectionState>({ nodeIds: [], edgeIds: [] });
  const [inspectorAnchor, setInspectorAnchor] = useState<InspectorAnchor | null>(null);
  const [inspectorTab, setInspectorTab] = useState<typeof INSPECTOR_TABS[number]>('Overview');
  const [bottomTab, setBottomTab] = useState<typeof BOTTOM_TABS[number]>('Diagnostics');
  const [viewState, setViewState] = useState<ViewState>(DEFAULT_ROUTE_GRAPH_VIEW_STATE);
  const [jsonText, setJsonText] = useState('');
  const [nodeJsonText, setNodeJsonText] = useState('');
  const [saving, setSaving] = useState(false);
  const [routeEndpointCatalog, setRouteEndpointCatalog] = useState<RouteEndpointCatalogItem[]>([]);
  const [dragTemplateId, setDragTemplateId] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<GraphContextMenuState>({
    instance: 0,
    x: 0,
    y: 0,
    position: { x: 120, y: 120 },
    target: { kind: 'graph' },
  });
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const consumedFocusIntentIdRef = useRef<number | null>(null);
  const inspectorDragRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startClientX: number;
    startClientY: number;
    nextX: number;
    nextY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);
  const inspectorAnchorKeyRef = useRef<string | null>(null);

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<RouteFlowNode>([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<RouteFlowEdge>([]);
  const templates = useMemo(() => buildAddTemplates(), []);
  const templateById = useMemo(() => new Map(templates.map((template) => [template.id, template])), [templates]);
  const quickTemplates = useMemo(() => QUICK_TEMPLATE_IDS.map((id) => templateById.get(id)).filter(Boolean) as AddTemplate[], [templateById]);
  const paletteTemplates = useMemo(() => templates.slice(0, 6), [templates]);
  const inspectorNodeId = getSelectionNodeId(inspectorTarget);
  const inspectorPortId = getSelectionPortId(inspectorTarget);
  const inspectorMacroId = getSelectionMacroId(inspectorTarget);
  const visibleGraph = useMemo(() => filterGraphForView(graph, viewState), [graph, viewState]);
  const interactiveGraph = useMemo(() => ({ ...visibleGraph, macros: graph.macros }), [graph.macros, visibleGraph]);

  const selectedNode = inspectorNodeId ? interactiveGraph.nodes.find((node) => node.id === inspectorNodeId) || null : null;
  const selectedPort = selectedNode && inspectorPortId ? getNodePort(selectedNode, inspectorPortId) : null;
  const selectedEdge = inspectorTarget.kind === 'edge' ? interactiveGraph.edges.find((edge) => edge.id === inspectorTarget.edgeId) || null : null;
  const selectedMacro = inspectorMacroId ? graph.macros.find((macro) => macro.id === inspectorMacroId) || null : null;
  const selectedNodeId = getSelectionNodeId(selection);
  const selectedPortId = getSelectionPortId(selection);

  const applyGraphSelection = useCallback((next: GraphSelectionState) => {
    graphSelectionRef.current = next;
    setGraphSelection(next);
    const selectedNodeIds = new Set(next.nodeIds);
    const selectedEdgeIds = new Set(next.edgeIds);
    setFlowNodes((nodes) => nodes.map((node) => {
      const selected = selectedNodeIds.has(node.id);
      return node.selected === selected ? node : { ...node, selected };
    }));
    setFlowEdges((edges) => edges.map((edge) => {
      const selected = selectedEdgeIds.has(edge.id);
      return edge.selected === selected ? edge : { ...edge, selected };
    }));
  }, [setFlowEdges, setFlowNodes]);

  const onRouteGraphNodesChange = useCallback((changes: NodeChange<RouteFlowNode>[]) => {
    const allowedChanges = filterRouteGraphFlowNodeChanges(changes, flowNodes);
    if (allowedChanges.length > 0) onNodesChange(allowedChanges);
  }, [flowNodes, onNodesChange]);
  const anchorInspectorAtViewportRect = useCallback((rect: InspectorAnchorInputRect) => {
    const container = workbenchRef.current?.getBoundingClientRect();
    if (!container) return;
    const panelWidth = Math.min(440, Math.max(320, container.width - 32));
    const bounds = canvasPanelRef.current?.getBoundingClientRect() || container;
    const panelHeight = Math.min(560, Math.max(180, bounds.bottom - bounds.top - 24));
    setInspectorAnchor(computeRouteGraphInspectorAnchor({
      target: rect,
      container,
      bounds,
      viewportWidth: window.innerWidth,
      panelWidth,
      panelHeight,
    }));
  }, []);

  const anchorInspectorAtFlowNode = useCallback((node: RouteGraphNode) => {
    const position = node.position || { x: 120, y: 120 };
    const width = ROUTE_GRAPH_NODE_WIDTH;
    const screenPosition = reactFlow.flowToScreenPosition({ x: position.x + width, y: position.y });
    anchorInspectorAtViewportRect({
      left: screenPosition.x - width,
      right: screenPosition.x,
      top: screenPosition.y,
      bottom: screenPosition.y + 96,
    });
  }, [anchorInspectorAtViewportRect, reactFlow]);

  const anchorInspectorAtMacro = useCallback((macro: RouteGraphMacro) => {
    const position = macro.position || { x: 120, y: 120 };
    const width = ROUTE_GRAPH_NODE_WIDTH;
    const screenPosition = reactFlow.flowToScreenPosition({ x: position.x + width, y: position.y });
    anchorInspectorAtViewportRect({
      left: screenPosition.x - width,
      right: screenPosition.x,
      top: screenPosition.y,
      bottom: screenPosition.y + 96,
    });
  }, [anchorInspectorAtViewportRect, reactFlow]);

  const anchorInspectorAtRenderedNode = useCallback((nodeId: string) => {
    const applyRenderedAnchor = () => {
      const escapedNodeId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(nodeId) : nodeId.replace(/"/g, '\\"');
      const element = document.querySelector(`[data-id="${escapedNodeId}"]`);
      if (element instanceof HTMLElement) {
        anchorInspectorAtViewportRect(element.getBoundingClientRect());
      }
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(applyRenderedAnchor));
    window.setTimeout(applyRenderedAnchor, 140);
  }, [anchorInspectorAtViewportRect]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getRouteGraphDraft() as any;
      const nextActiveGraph = response?.activeVersion?.sourceGraph ? normalizeGraph(response.activeVersion.sourceGraph) : null;
      const nextGraph = normalizeGraph(response?.draft?.workingGraph || response?.activeVersion?.sourceGraph || defaultGraph());
      setActiveVersion(response?.activeVersion || null);
      setActiveGraph(nextActiveGraph);
      setVersionHistory(Array.isArray(response?.history) ? response.history as RouteGraphVersionSummary[] : []);
      setGraph(nextGraph);
      graphRef.current = nextGraph;
      setUndoStack([]);
      setRedoStack([]);
      setJsonText(JSON.stringify(nextGraph, null, 2));
      setDiagnostics(response?.draft?.diagnostics || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    api.getRouteEndpoints()
      .then((items) => {
        if (!cancelled) setRouteEndpointCatalog(Array.isArray(items) ? items as RouteEndpointCatalogItem[] : []);
      })
      .catch((error) => {
        if (!cancelled) toast.error((error as Error).message || tr('pages.tokenRoutes.routeGraphWorkbench.check'));
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const expandMacroOnCanvas = useCallback((macroId: string) => {
    setViewState((current) => {
      if (current.expandedMacroIds.includes(macroId) && !current.showGeneratedPrimitives) return current;
      return {
        ...current,
        showGeneratedPrimitives: false,
        expandedMacroIds: [...current.expandedMacroIds.filter((id) => id !== macroId), macroId],
      };
    });
  }, []);

  const toggleMacroSupplyOnCanvas = useCallback((macroId: string) => {
    setViewState((current) => {
      const expandedSupplyMacroIds = current.expandedSupplyMacroIds || [];
      const expanded = expandedSupplyMacroIds.includes(macroId);
      return {
        ...current,
        showGeneratedPrimitives: false,
        expandedSupplyMacroIds: expanded
          ? expandedSupplyMacroIds.filter((id) => id !== macroId)
          : [...expandedSupplyMacroIds, macroId],
      };
    });
  }, []);

  useEffect(() => {
    const selectedNodeIds = new Set(graphSelectionRef.current.nodeIds);
    const visibleFlowNodes = graphToFlowNodes(visibleGraph, viewState, graph, {
      onToggleSupply: toggleMacroSupplyOnCanvas,
      onExpandGenerated: expandMacroOnCanvas,
    });
    setFlowNodes(visibleFlowNodes.map((node) => {
      const selected = selectedNodeIds.has(node.id);
      return node.selected === selected ? node : { ...node, selected };
    }));
  }, [expandMacroOnCanvas, graph, setFlowNodes, toggleMacroSupplyOnCanvas, viewState, visibleGraph]);

  useEffect(() => {
    const visibleFlowNodes = graphToFlowNodes(visibleGraph, viewState, graph, {
      onToggleSupply: toggleMacroSupplyOnCanvas,
      onExpandGenerated: expandMacroOnCanvas,
    });
    const hiddenSupply = getHiddenSupplyControlEdges({
      graph,
      visibleGraph,
      view: viewState,
      onToggle: toggleMacroSupplyOnCanvas,
    });
    const graphWithHiddenSupplyEdges = {
      ...visibleGraph,
      edges: [...visibleGraph.edges, ...hiddenSupply.edges],
    };
    const visibleFlowEdges = graphToFlowEdges(graphWithHiddenSupplyEdges, new Set<string>(), hiddenSupply.controls);
    const highlightedEdgeIds = new Set<string>();
    if (viewState.highlightSelectedPath && selection.kind === 'node') {
      for (const edge of getConnectedEdges(
        visibleFlowNodes.filter((node) => node.id === selection.nodeId),
        visibleFlowEdges,
      )) {
        highlightedEdgeIds.add(edge.id);
      }
    }
    const selectedEdgeIds = new Set(graphSelection.edgeIds);
    setFlowEdges(graphToFlowEdges(graphWithHiddenSupplyEdges, highlightedEdgeIds, hiddenSupply.controls).map((edge) => {
      const selected = selectedEdgeIds.has(edge.id);
      return edge.selected === selected ? edge : { ...edge, selected };
    }));
  }, [expandMacroOnCanvas, graph, graphSelection.edgeIds, selection, setFlowEdges, toggleMacroSupplyOnCanvas, viewState, visibleGraph]);

  useEffect(() => {
    setNodeJsonText(selectedNode ? JSON.stringify(selectedNode, null, 2) : '');
  }, [selectedNode]);

  useEffect(() => {
    if (selectedMacro) setNodeJsonText(JSON.stringify(selectedMacro, null, 2));
  }, [selectedMacro]);

  useEffect(() => {
    if (!selectedNode) return;
    if (inspectorAnchor?.mode === 'manual') return;
    const targetKey = inspectorTarget.kind === 'port'
      ? `port:${inspectorTarget.nodeId}:${inspectorTarget.portId}`
      : `node:${selectedNode.id}:`;
    if (inspectorAnchor && inspectorAnchorKeyRef.current === targetKey) return;
    const applyRenderedAnchor = () => {
      const escapedNodeId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(selectedNode.id) : selectedNode.id.replace(/"/g, '\\"');
      const element = document.querySelector(`[data-id="${escapedNodeId}"]`);
      if (element instanceof HTMLElement) {
        anchorInspectorAtViewportRect(element.getBoundingClientRect());
        inspectorAnchorKeyRef.current = targetKey;
      }
    };
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(applyRenderedAnchor));
    const timeout = window.setTimeout(applyRenderedAnchor, 140);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [anchorInspectorAtViewportRect, inspectorAnchor, inspectorTarget, selectedNode]);

  const applyGraph = useCallback((next: RouteGraphSource, options: { recordHistory?: boolean } = {}) => {
    const normalized = normalizeGraph(next);
    if (options.recordHistory !== false) {
      setUndoStack((items) => [...items.slice(-49), graphRef.current]);
      setRedoStack([]);
    }
    graphRef.current = normalized;
    setGraph(normalized);
    setJsonText(JSON.stringify(normalized, null, 2));
  }, []);

  const updateMacro = useCallback((macro: RouteGraphMacro) => {
    const currentGraph = graphRef.current;
    if (!canReplaceRouteGraphMacro(currentGraph, macro)) {
      toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.macroJsonManual'));
      return;
    }
    applyGraph({
      ...currentGraph,
      macros: currentGraph.macros.map((item) => (item.id === macro.id ? macro : item)),
    });
  }, [applyGraph, toast]);

  const collapseMacroToSemanticNode = useCallback((macroId: string) => {
    setViewState((current) => ({
      ...current,
      showGeneratedPrimitives: false,
      expandedMacroIds: current.expandedMacroIds.filter((id) => id !== macroId),
    }));
    const macro = graphRef.current.macros.find((item) => item.id === macroId);
    if (macro) {
      setSelection({ kind: 'macro', macroId });
      setInspectorTarget({ kind: 'macro', macroId });
      applyGraphSelection({ nodeIds: [macroFlowNodeId(macroId)], edgeIds: [] });
      anchorInspectorAtMacro(macro);
      window.requestAnimationFrame(() => anchorInspectorAtRenderedNode(macroFlowNodeId(macroId)));
    }
  }, [anchorInspectorAtMacro, anchorInspectorAtRenderedNode, applyGraphSelection]);

  const addMacroGroup = useCallback((macroId: string) => {
    const currentGraph = graphRef.current;
    const macro = currentGraph.macros.find((item) => item.id === macroId);
    if (!macro || macro.ownership !== 'manual') return;
    const config = getMacroConfig(macro);
    const groups = getMacroGroups(macro);
    const nextIndex = groups.length;
    applyGraph({
      ...currentGraph,
      macros: currentGraph.macros.map((item) => item.id === macroId ? {
        ...macro,
        config: {
          ...config,
          groups: [
            ...groups,
            {
              id: `source:new:${Date.now()}`,
              label: `band ${nextIndex + 1}`,
              enabled: true,
              priority: nextIndex,
              input: { kind: 'route_endpoints', endpointIds: [] },
              defaults: { enabled: true, weight: 10, priority: nextIndex },
            },
          ],
        },
      } : item),
    });
  }, [applyGraph]);

  const clearGraphSelection = useCallback(() => {
    suppressSelectionRef.current = true;
    setSelection({ kind: 'graph' });
    setInspectorTarget({ kind: 'graph' });
    graphSelectionRef.current = { nodeIds: [], edgeIds: [] };
    setGraphSelection({ nodeIds: [], edgeIds: [] });
    setInspectorAnchor(null);
    setFlowNodes((nodes) => nodes.map((node) => (node.selected ? { ...node, selected: false } : node)));
    setFlowEdges((edges) => edges.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)));
    inspectorAnchorKeyRef.current = null;
    window.setTimeout(() => {
      suppressSelectionRef.current = false;
    }, 120);
  }, [setFlowEdges, setFlowNodes]);

  const beginInspectorDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!inspectorAnchor) return;
    event.preventDefault();
    event.stopPropagation();
    const container = workbenchRef.current?.getBoundingClientRect();
    if (!container) return;
    const panelWidth = Math.min(440, Math.max(320, container.width - 32));
    const minX = 12;
    const maxX = Math.max(minX, container.width - panelWidth - 12);
    const minY = 12;
    const maxY = Math.max(minY, container.height - 180);
    inspectorDragRef.current = {
      pointerId: event.pointerId,
      originX: inspectorAnchor.x,
      originY: inspectorAnchor.y,
      nextX: inspectorAnchor.x,
      nextY: inspectorAnchor.y,
      minX,
      maxX,
      minY,
      maxY,
      startClientX: event.clientX,
      startClientY: event.clientY,
    };
    const panel = inspectorPanelRef.current;
    if (panel) {
      panel.style.willChange = 'transform';
      panel.style.transform = 'translate3d(0, 0, 0)';
      panel.classList.add('is-dragging');
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [inspectorAnchor]);

  const updateInspectorDrag = useCallback((event: globalThis.PointerEvent) => {
    const drag = inspectorDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextX = drag.originX + (event.clientX - drag.startClientX);
    const nextY = drag.originY + (event.clientY - drag.startClientY);
    drag.nextX = Math.min(Math.max(nextX, drag.minX), drag.maxX);
    drag.nextY = Math.min(Math.max(nextY, drag.minY), drag.maxY);
    const panel = inspectorPanelRef.current;
    if (panel) {
      panel.style.transform = `translate3d(${drag.nextX - drag.originX}px, ${drag.nextY - drag.originY}px, 0)`;
    }
  }, []);

  const endInspectorDrag = useCallback((event: globalThis.PointerEvent) => {
    const drag = inspectorDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    inspectorDragRef.current = null;
    const nextX = drag.nextX;
    const nextY = drag.nextY;
    const panel = inspectorPanelRef.current;
    if (panel) {
      panel.style.willChange = '';
      panel.style.transform = '';
      panel.classList.remove('is-dragging');
    }
    setInspectorAnchor((current) => current ? {
      ...current,
      x: nextX,
      y: nextY,
      mode: 'manual',
    } : current);
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', updateInspectorDrag);
    window.addEventListener('pointerup', endInspectorDrag);
    window.addEventListener('pointercancel', endInspectorDrag);
    return () => {
      window.removeEventListener('pointermove', updateInspectorDrag);
      window.removeEventListener('pointerup', endInspectorDrag);
      window.removeEventListener('pointercancel', endInspectorDrag);
    };
  }, [endInspectorDrag, updateInspectorDrag]);

  const undo = useCallback(() => {
    setUndoStack((items) => {
      const previous = items[items.length - 1];
      if (!previous) return items;
      setRedoStack((redoItems) => [...redoItems.slice(-49), graphRef.current]);
      graphRef.current = previous;
      setGraph(previous);
      setJsonText(JSON.stringify(previous, null, 2));
      clearGraphSelection();
      return items.slice(0, -1);
    });
  }, [clearGraphSelection]);

  const redo = useCallback(() => {
    setRedoStack((items) => {
      const next = items[items.length - 1];
      if (!next) return items;
      setUndoStack((undoItems) => [...undoItems.slice(-49), graphRef.current]);
      graphRef.current = next;
      setGraph(next);
      setJsonText(JSON.stringify(next, null, 2));
      clearGraphSelection();
      return items.slice(0, -1);
    });
  }, [clearGraphSelection]);

  const autoLayout = useCallback(() => {
    applyGraph(layoutRouteGraph(graphRef.current, { preserveExistingPositions: false }));
    window.requestAnimationFrame(() => reactFlow.fitView({ padding: 0.2, duration: 220 }));
  }, [applyGraph, reactFlow]);

  const addNode = useCallback((type: RouteGraphNodeType, position?: { x: number; y: number }, options: { openInspector?: boolean } = {}) => {
    const currentGraph = graphRef.current;
    const node = makeNode(type, currentGraph.nodes.length, position);
    applyGraph({ ...currentGraph, nodes: [...currentGraph.nodes, node] });
    setSelection({ kind: 'node', nodeId: node.id });
    applyGraphSelection({ nodeIds: [node.id], edgeIds: [] });
    if (options.openInspector !== false) {
      setInspectorTarget({ kind: 'node', nodeId: node.id });
      anchorInspectorAtFlowNode(node);
      anchorInspectorAtRenderedNode(node.id);
      setInspectorTab('Config');
    }
  }, [anchorInspectorAtFlowNode, anchorInspectorAtRenderedNode, applyGraph, applyGraphSelection]);

  const addTemplate = useCallback((template: AddTemplate, position?: { x: number; y: number }, options: { openInspector?: boolean } = {}) => {
    const currentGraph = graphRef.current;
    const node = template.create(currentGraph.nodes.length, position);
    applyGraph({ ...currentGraph, nodes: [...currentGraph.nodes, node] });
    setSelection({ kind: 'node', nodeId: node.id });
    applyGraphSelection({ nodeIds: [node.id], edgeIds: [] });
    if (options.openInspector !== false) {
      setInspectorTarget({ kind: 'node', nodeId: node.id });
      anchorInspectorAtFlowNode(node);
      anchorInspectorAtRenderedNode(node.id);
      setInspectorTab('Config');
    }
  }, [anchorInspectorAtFlowNode, anchorInspectorAtRenderedNode, applyGraph, applyGraphSelection]);

  const addTemplateById = useCallback((templateId: string, position?: { x: number; y: number }) => {
    const template = templateById.get(templateId);
    if (!template) return;
    addTemplate(template, position);
  }, [addTemplate, templateById]);

  const addTemplateFromContext = useCallback((template: AddTemplate) => {
    addTemplate(template, contextMenu.position);
  }, [addTemplate, contextMenu.position]);

  const focusNode = useCallback((nodeId: string, options: { moveInspector?: boolean } = {}) => {
    const moveInspector = options.moveInspector !== false;
    const node = interactiveGraph.nodes.find((item) => item.id === nodeId);
    if (!node) {
      const macro = graph.macros.find((item) => macroFlowNodeId(item.id) === nodeId || item.id === nodeId);
      if (!macro) return;
      const flowNodeId = macroFlowNodeId(macro.id);
      setSelection({ kind: 'macro', macroId: macro.id });
      setInspectorTarget({ kind: 'macro', macroId: macro.id });
      setInspectorTab('Overview');
      applyGraphSelection({ nodeIds: [flowNodeId], edgeIds: [] });
      if (moveInspector) {
        anchorInspectorAtMacro(macro);
        anchorInspectorAtRenderedNode(flowNodeId);
      }
      const renderedCenter = getRenderedFlowNodeCenter(reactFlow.getNode(flowNodeId), {
        width: ROUTE_GRAPH_NODE_WIDTH,
        height: ROUTE_GRAPH_NODE_HEIGHT_ESTIMATE,
      });
      const fallbackCenter = {
        x: (macro.position?.x || 120) + ROUTE_GRAPH_NODE_WIDTH / 2,
        y: (macro.position?.y || 120) + ROUTE_GRAPH_NODE_HEIGHT_ESTIMATE / 2,
      };
      const center = renderedCenter || fallbackCenter;
      reactFlow.setCenter(center.x, center.y, { zoom: reactFlow.getZoom(), duration: 220 });
      return;
    }
    setSelection({ kind: 'node', nodeId });
    setInspectorTarget({ kind: 'node', nodeId });
    setInspectorTab('Overview');
    applyGraphSelection({ nodeIds: [nodeId], edgeIds: [] });
    if (moveInspector) {
      anchorInspectorAtFlowNode(node);
      anchorInspectorAtRenderedNode(nodeId);
    }
    reactFlow.setCenter((node.position?.x || 120) + ROUTE_GRAPH_NODE_WIDTH / 2, (node.position?.y || 120) + ROUTE_GRAPH_NODE_HEIGHT_ESTIMATE / 2, { zoom: reactFlow.getZoom(), duration: 220 });
  }, [anchorInspectorAtFlowNode, anchorInspectorAtMacro, anchorInspectorAtRenderedNode, applyGraphSelection, graph.macros, interactiveGraph.nodes, reactFlow]);

  const focusEdge = useCallback((edgeId: string, options: { moveInspector?: boolean } = {}) => {
    const moveInspector = options.moveInspector !== false;
    const edge = interactiveGraph.edges.find((item) => item.id === edgeId);
    if (!edge) return;
    const sourceNode = reactFlow.getNode(edge.sourceNodeId) || reactFlow.getNode(macroFlowNodeId(edge.sourceNodeId));
    const targetNode = reactFlow.getNode(edge.targetNodeId) || reactFlow.getNode(macroFlowNodeId(edge.targetNodeId));
    const getGraphCenter = (nodeId: string) => {
      const node = interactiveGraph.nodes.find((item) => item.id === nodeId);
      if (node) {
        return {
          x: (node.position?.x || 120) + ROUTE_GRAPH_NODE_WIDTH / 2,
          y: (node.position?.y || 120) + ROUTE_GRAPH_NODE_HEIGHT_ESTIMATE / 2,
        };
      }
      const macro = graph.macros.find((item) => item.id === nodeId || macroFlowNodeId(item.id) === nodeId);
      if (!macro) return null;
      return {
        x: (macro.position?.x || 120) + ROUTE_GRAPH_NODE_WIDTH / 2,
        y: (macro.position?.y || 120) + ROUTE_GRAPH_NODE_HEIGHT_ESTIMATE / 2,
      };
    };
    const fallbackSize = {
      width: ROUTE_GRAPH_NODE_WIDTH,
      height: ROUTE_GRAPH_NODE_HEIGHT_ESTIMATE,
    };
    const sourceCenter = getRenderedFlowNodeCenter(sourceNode, fallbackSize) || getGraphCenter(edge.sourceNodeId);
    const targetCenter = getRenderedFlowNodeCenter(targetNode, fallbackSize) || getGraphCenter(edge.targetNodeId);
    const center = sourceCenter && targetCenter
      ? { x: (sourceCenter.x + targetCenter.x) / 2, y: (sourceCenter.y + targetCenter.y) / 2 }
      : sourceCenter || targetCenter || { x: 120, y: 120 };
    setSelection({ kind: 'edge', edgeId });
    setInspectorTarget({ kind: 'edge', edgeId });
    setInspectorTab('Overview');
    applyGraphSelection({ nodeIds: [], edgeIds: [edgeId] });
    reactFlow.setCenter(center.x, center.y, { zoom: reactFlow.getZoom(), duration: 220 });
    if (moveInspector) {
      const screenPosition = reactFlow.flowToScreenPosition(center);
      anchorInspectorAtViewportRect({
        left: screenPosition.x,
        right: screenPosition.x,
        top: screenPosition.y,
        bottom: screenPosition.y,
      });
    }
  }, [anchorInspectorAtViewportRect, applyGraphSelection, graph.macros, interactiveGraph.edges, interactiveGraph.nodes, reactFlow]);

  const selectAndCenterRenderedNode = useCallback((nodeId: string, fallbackPosition?: { x: number; y: number } | null) => {
    let attempts = 0;
    const apply = () => {
      attempts += 1;
      const flowNode = reactFlow.getNode(nodeId);
      const position = flowNode?.position || fallbackPosition || null;
      if (!flowNode && attempts < 8) {
        window.setTimeout(apply, attempts < 3 ? 32 : 80);
        return;
      }
      setSelection({ kind: 'node', nodeId });
      setInspectorTarget({ kind: 'node', nodeId });
      applyGraphSelection({ nodeIds: [nodeId], edgeIds: [] });
      if (position) {
        const measured = (flowNode as any)?.measured;
        const width = Number((flowNode as any)?.width || measured?.width || ROUTE_GRAPH_NODE_WIDTH);
        const height = Number((flowNode as any)?.height || measured?.height || ROUTE_GRAPH_NODE_HEIGHT_ESTIMATE);
        reactFlow.setCenter(position.x + width / 2, position.y + height / 2, { zoom: reactFlow.getZoom(), duration: 220 });
      }
      anchorInspectorAtRenderedNode(nodeId);
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(apply));
    window.setTimeout(apply, 180);
  }, [anchorInspectorAtRenderedNode, applyGraphSelection, reactFlow]);

  const focusGeneratedPrimitive = useCallback((macroId: string, nodeId: string) => {
    expandMacroOnCanvas(macroId);
    setInspectorTarget({ kind: 'node', nodeId });
    setInspectorTab('Overview');
    const macro = graphRef.current.macros.find((item) => item.id === macroId);
    const fallbackPosition = macro
      ? getAnchoredMacroPrimitivePositions(getPrimitiveGraphForView(graphRef.current), macro).find(([id]) => id === nodeId)?.[1] || null
      : null;
    selectAndCenterRenderedNode(nodeId, fallbackPosition);
  }, [expandMacroOnCanvas, selectAndCenterRenderedNode]);

  useEffect(() => {
    if (mode !== 'graph' || loading || !focusIntent) return;
    if (consumedFocusIntentIdRef.current === focusIntent.id) return;
    consumedFocusIntentIdRef.current = focusIntent.id;

    if (focusIntent.kind === 'macro') {
      focusNode(focusIntent.macroId);
    } else if (focusIntent.macroId) {
      focusGeneratedPrimitive(focusIntent.macroId, focusIntent.nodeId);
    } else {
      focusNode(focusIntent.nodeId);
    }

    onFocusIntentConsumed?.(focusIntent.id);
  }, [focusGeneratedPrimitive, focusIntent, focusNode, loading, mode, onFocusIntentConsumed]);

  const copyText = useCallback((text: string, label: string) => {
    void navigator.clipboard?.writeText(text);
    toast.success(`${label} copied`);
  }, [toast]);

  const toggleNodeEnabled = useCallback((nodeId: string) => {
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node || node.ownership !== 'manual') return;
    applyGraph(updateNode(graph, { ...node, enabled: !node.enabled }));
  }, [applyGraph, graph]);

  const duplicateNode = useCallback((nodeId: string) => {
    const currentGraph = graphRef.current;
    const node = currentGraph.nodes.find((item) => item.id === nodeId);
    if (!node || node.ownership !== 'manual') return;
    const duplicate: RouteGraphNode = {
      ...node,
      id: `${node.type}:${Date.now()}:${currentGraph.nodes.length}`,
      name: `${getNodeTitle(node)} copy`,
      position: {
        x: (node.position?.x || 120) + 36,
        y: (node.position?.y || 120) + 36,
      },
      ownership: 'manual',
    };
    applyGraph({ ...currentGraph, nodes: [...currentGraph.nodes, duplicate] });
    setSelection({ kind: 'node', nodeId: duplicate.id });
    setInspectorTarget({ kind: 'node', nodeId: duplicate.id });
    applyGraphSelection({ nodeIds: [duplicate.id], edgeIds: [] });
    anchorInspectorAtFlowNode(duplicate);
    anchorInspectorAtRenderedNode(duplicate.id);
  }, [anchorInspectorAtFlowNode, anchorInspectorAtRenderedNode, applyGraph, applyGraphSelection]);

  const selectConnectedPath = useCallback((nodeId: string, direction: 'upstream' | 'downstream') => {
    const edge = interactiveGraph.edges.find((item) => direction === 'downstream' ? item.sourceNodeId === nodeId : item.targetNodeId === nodeId);
    const peerNodeId = edge ? (direction === 'downstream' ? edge.targetNodeId : edge.sourceNodeId) : nodeId;
    focusNode(peerNodeId);
  }, [focusNode, interactiveGraph.edges]);

  const disconnectPort = useCallback((nodeId: string, portId: string) => {
    const node = graph.nodes.find((item) => item.id === nodeId);
    const macro = graph.macros.find((item) => macroFlowNodeId(item.id) === nodeId);
    if (node ? node.ownership !== 'manual' : macro?.ownership !== 'manual') return;
    applyGraph({
      ...graph,
      edges: graph.edges.filter((edge) => !(
        (edge.sourceNodeId === nodeId && edge.sourcePortId === portId)
        || (edge.targetNodeId === nodeId && edge.targetPortId === portId)
      )),
    });
  }, [applyGraph, graph]);

  const openInspector = useCallback((target: SelectionState, tab: typeof INSPECTOR_TABS[number] = 'Overview') => {
    setSelection(target);
    setInspectorTarget(target);
    setInspectorTab(tab);
    const nodeId = getSelectionNodeId(target);
    if (nodeId) {
      const node = interactiveGraph.nodes.find((item) => item.id === nodeId);
      if (node) {
        anchorInspectorAtFlowNode(node);
        anchorInspectorAtRenderedNode(nodeId);
        return;
      }
    }
    const macroId = getSelectionMacroId(target);
    if (macroId) {
      const macro = graph.macros.find((item) => item.id === macroId);
      if (macro) {
        anchorInspectorAtMacro(macro);
        anchorInspectorAtRenderedNode(macroFlowNodeId(macroId));
        return;
      }
    }
    anchorInspectorAtViewportRect({
      left: contextMenu.x,
      right: contextMenu.x,
      top: contextMenu.y,
      bottom: contextMenu.y,
    });
  }, [anchorInspectorAtFlowNode, anchorInspectorAtMacro, anchorInspectorAtRenderedNode, anchorInspectorAtViewportRect, contextMenu.x, contextMenu.y, graph.macros, interactiveGraph.nodes]);

  const insertTemplateAfterSelected = useCallback((template: AddTemplate) => {
    if (selection.kind !== 'node') {
      addTemplate(template);
      return;
    }
    const currentGraph = graphRef.current;
    const sourceNode = currentGraph.nodes.find((node) => node.id === selection.nodeId);
    if (!sourceNode) {
      addTemplate(template);
      return;
    }
    const position = {
      x: (sourceNode.position?.x || 120) + 340,
      y: sourceNode.position?.y || 120,
    };
    const nextNode = template.create(currentGraph.nodes.length, position);
    const sourcePort = getNodePorts(sourceNode).find((port) => port.direction === 'output' && !port.readonly);
    const targetPort = getNodePorts(nextNode).find((port) => port.direction === 'input' && (port.accepts || [port.kind]).includes(sourcePort?.kind || 'request'));
    const nextGraph = { ...currentGraph, nodes: [...currentGraph.nodes, nextNode] };
    if (!sourcePort || !targetPort) {
      applyGraph(nextGraph);
      setSelection({ kind: 'node', nodeId: nextNode.id });
      setInspectorTarget({ kind: 'node', nodeId: nextNode.id });
      applyGraphSelection({ nodeIds: [nextNode.id], edgeIds: [] });
      anchorInspectorAtFlowNode(nextNode);
      anchorInspectorAtRenderedNode(nextNode.id);
      return;
    }
    const connection = {
      source: sourceNode.id,
      sourceHandle: sourcePort.id,
      target: nextNode.id,
      targetHandle: targetPort.id,
    };
    const validation = validateRouteGraphConnection(nextGraph, connection);
    const nextEdge = validation.ok ? normalizeEdge({
      id: `edge:${connection.source}:${connection.sourceHandle}:${connection.target}:${connection.targetHandle}`,
      sourceNodeId: connection.source,
      sourcePortId: connection.sourceHandle,
      targetNodeId: connection.target,
      targetPortId: connection.targetHandle,
      kind: validation.kind,
      ownership: 'manual',
    }) : null;
    applyGraph({
      ...nextGraph,
      edges: nextEdge ? [...nextGraph.edges, nextEdge] : nextGraph.edges,
    });
    setSelection({ kind: 'node', nodeId: nextNode.id });
    setInspectorTarget({ kind: 'node', nodeId: nextNode.id });
    applyGraphSelection({ nodeIds: [nextNode.id], edgeIds: [] });
    anchorInspectorAtFlowNode(nextNode);
    anchorInspectorAtRenderedNode(nextNode.id);
    setInspectorTab('Config');
  }, [addTemplate, anchorInspectorAtFlowNode, anchorInspectorAtRenderedNode, applyGraph, applyGraphSelection, selection]);

  const insertTemplateFromContext = useCallback((template: AddTemplate) => {
    insertTemplateAfterSelected(template);
  }, [insertTemplateAfterSelected]);

  const addModelGroupMacro = useCallback(() => {
    const currentGraph = graphRef.current;
    const index = currentGraph.macros.length + 1;
    const macroId = `model-group:manual:${Date.now()}:${index}`;
    const macro: RouteGraphMacro = {
      id: macroId,
      kind: 'candidate_selector',
      enabled: false,
      visibility: 'public',
      ownership: 'manual',
      name: `model-group-${index}`,
      position: contextMenu.position,
      config: {
        surface: {
          entry: {
            kind: 'external',
            visibility: 'public',
            match: {
              kind: 'model',
              requestedModelPattern: '',
              displayName: `model-group-${index}`,
            },
          },
          output: 'route',
        },
        policy: { strategy: 'weighted' },
        groups: [],
        presentation: {},
      },
    };
    applyGraph({ ...currentGraph, macros: [...currentGraph.macros, macro] });
    setSelection({ kind: 'macro', macroId });
    setInspectorTarget({ kind: 'macro', macroId });
    anchorInspectorAtMacro(macro);
    anchorInspectorAtRenderedNode(macroFlowNodeId(macroId));
    setInspectorTab('Config');
  }, [anchorInspectorAtMacro, anchorInspectorAtRenderedNode, applyGraph, contextMenu.position]);

  const deleteSelected = useCallback(() => {
    const nextGraph = deleteSelectedGraphElements(graph, selection, graphSelection);
    if (nextGraph === graph) return;
    applyGraph(nextGraph);
    clearGraphSelection();
  }, [applyGraph, clearGraphSelection, graph, graphSelection, selection]);

  const onConnect = useCallback((connection: Connection) => {
    const result = validateRouteGraphConnection(graph, connection);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    const nextEdge = normalizeEdge({
      id: `edge:${connection.source}:${connection.sourceHandle}:${connection.target}:${connection.targetHandle}`,
      sourceNodeId: connection.source!,
      sourcePortId: connection.sourceHandle!,
      targetNodeId: connection.target!,
      targetPortId: connection.targetHandle!,
      kind: result.kind,
      ownership: 'manual',
    });
    applyGraph({ ...graph, edges: [...graph.edges, nextEdge] });
    setSelection({ kind: 'edge', edgeId: nextEdge.id });
    setInspectorTarget({ kind: 'edge', edgeId: nextEdge.id });
    applyGraphSelection({ nodeIds: [], edgeIds: [nextEdge.id] });
    anchorInspectorAtViewportRect({
      left: window.innerWidth / 2,
      right: window.innerWidth / 2,
      top: window.innerHeight / 2,
      bottom: window.innerHeight / 2,
    });
  }, [anchorInspectorAtViewportRect, applyGraph, graph, toast]);

  const isValidConnection = useCallback((connection: RouteFlowEdge | Connection) => validateRouteGraphConnection(graph, {
    source: connection.source || '',
    sourceHandle: connection.sourceHandle || null,
    target: connection.target || '',
    targetHandle: connection.targetHandle || null,
  }).ok, [graph]);

  const onReconnect: OnReconnect<RouteFlowEdge> = useCallback((oldEdge, connection) => {
    const edge = graph.edges.find((item) => item.id === oldEdge.id);
    if (!edge || edge.ownership !== 'manual') {
      toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.manual'));
      return;
    }
    const graphWithoutOldEdge = {
      ...graph,
      edges: graph.edges.filter((item) => item.id !== edge.id),
    };
    const result = validateRouteGraphConnection(graphWithoutOldEdge, connection);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    const nextEdge = normalizeEdge({
      id: `edge:${connection.source}:${connection.sourceHandle}:${connection.target}:${connection.targetHandle}`,
      sourceNodeId: connection.source!,
      sourcePortId: connection.sourceHandle!,
      targetNodeId: connection.target!,
      targetPortId: connection.targetHandle!,
      kind: result.kind,
      ownership: 'manual',
    });
    applyGraph({ ...graphWithoutOldEdge, edges: [...graphWithoutOldEdge.edges, nextEdge] });
    setSelection({ kind: 'edge', edgeId: nextEdge.id });
    applyGraphSelection({ nodeIds: [], edgeIds: [nextEdge.id] });
  }, [applyGraph, graph, toast]);

  const onCanvasDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragTemplateId(null);
    const templateId = event.dataTransfer.getData('application/x-metapi-route-template') || dragTemplateId || '';
    const primitiveNodeType = event.dataTransfer.getData('application/x-metapi-route-node-type') as RouteGraphNodeType;
    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    if (NODE_TYPES.includes(primitiveNodeType)) {
      addNode(primitiveNodeType, position, { openInspector: false });
      return;
    }
    const template = templateById.get(templateId);
    if (!template) return;
    addTemplate(template, position, { openInspector: false });
  }, [addNode, addTemplate, dragTemplateId, reactFlow, templateById]);

  const onCanvasDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('application/x-metapi-route-template') && !event.dataTransfer.types.includes('application/x-metapi-route-node-type')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const prepareGraphContextMenu = useCallback((event: MouseEvent | globalThis.MouseEvent, target: SelectionState = { kind: 'graph' }) => {
    event.preventDefault();
    const menuTarget = normalizeContextMenuTargetForGraph(interactiveGraph, target);
    const canvasBounds = canvasPanelRef.current?.getBoundingClientRect();
    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const nextGraphSelection = selectionForContextMenu({
      current: graphSelectionRef.current,
      target: menuTarget,
    });
    if (nextGraphSelection !== graphSelectionRef.current) applyGraphSelection(nextGraphSelection);
    setContextMenu((current) => ({
      ...current,
      instance: current.instance + 1,
      x: canvasBounds ? event.clientX - canvasBounds.left : event.clientX,
      y: canvasBounds ? event.clientY - canvasBounds.top : event.clientY,
      position,
      target: menuTarget,
    }));
    setContextMenuOpen(true);
    setSelection(menuTarget);
    if (menuTarget.kind === 'graph') {
      setInspectorAnchor(null);
    }
  }, [applyGraphSelection, interactiveGraph, reactFlow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = !!target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
        event.preventDefault();
        redo();
        return;
      }
      if (!isTyping && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelected, redo, undo]);

  const validate = async () => {
    const result = await api.validateRouteGraph(graph) as any;
    setDiagnostics(result?.diagnostics || []);
    if (result?.ok) toast.success(tr('pages.tokenRoutes.routeGraphWorkbench.check2'));
    else toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.check'));
    setBottomTab('Diagnostics');
    return result;
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      const response = await api.saveRouteGraphDraft(graph) as any;
      const nextGraph = normalizeGraph(response?.draft?.workingGraph || graph);
      setDiagnostics(response?.draft?.diagnostics || []);
      applyGraph(nextGraph);
      toast.success(tr('pages.tokenRoutes.routeGraphWorkbench.save'));
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    await saveDraft();
    const response = await api.publishRouteGraphDraft() as any;
    if (response?.success) {
      toast.success(tr('pages.tokenRoutes.routeGraphWorkbench.routes'));
      await refresh();
    }
  };

  const applyWholeJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      const normalized = normalizeGraph(parsed);
      if (!preservesGeneratedRouteGraphArtifacts(graph, normalized)) {
        toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.jsonManual'));
        return;
      }
      applyGraph(normalized);
      toast.success(tr('pages.tokenRoutes.routeGraphWorkbench.jsonApplyDraft'));
    } catch (error) {
      toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.jsonParseFailed').replace('{message}', (error as Error).message));
    }
  };

  const exportWholeJson = () => {
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `metapi-route-graph-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const applyNodeJson = useCallback(() => {
    try {
      if (selectedMacro) {
        const parsed = normalizeGraph({ ...graph, macros: [JSON.parse(nodeJsonText)] }).macros[0];
        if (!parsed) {
          toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.macroJsonIdKind'));
          return;
        }
        if (parsed.ownership !== 'manual') {
          toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.macroJsonManual'));
          return;
        }
        if (!canReplaceRouteGraphMacro(graph, parsed)) {
          toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.macroJsonManual'));
          return;
        }
        applyGraph({
          ...graph,
          macros: graph.macros.map((macro) => (macro.id === selectedMacro.id ? parsed : macro)),
        });
        setSelection({ kind: 'macro', macroId: parsed.id });
        setInspectorTarget({ kind: 'macro', macroId: parsed.id });
        return;
      }
      if (selectedNode) {
        const parsed = JSON.parse(nodeJsonText) as RouteGraphNode;
        if (parsed.ownership !== 'manual') {
          toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.jsonManual'));
          return;
        }
        if (!canReplaceRouteGraphNode(graph, parsed)) {
          toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.jsonManual'));
          return;
        }
        applyGraph(updateNode(graph, parsed));
        setSelection({ kind: 'node', nodeId: parsed.id });
        anchorInspectorAtFlowNode(parsed);
      }
    } catch (error) {
      toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.nodeJsonParseFailed').replace('{message}', (error as Error).message));
    }
  }, [anchorInspectorAtFlowNode, applyGraph, graph, nodeJsonText, selectedMacro, selectedNode, toast]);

  const publicEntries = getPublicEntryNodes(graph);
  const errorCount = diagnostics.filter((item) => item.severity === 'error').length;
  const warningCount = diagnostics.filter((item) => item.severity === 'warning').length;
  const minimapEnabled = flowNodes.length <= ROUTE_GRAPH_MINIMAP_NODE_LIMIT;
  const contextMenuNode = (
    <RouteGraphPointMenu
      key={contextMenu.instance}
      open={contextMenuOpen}
      onOpenChange={setContextMenuOpen}
      x={contextMenu.x}
      y={contextMenu.y}
      target={contextMenu.target}
      graph={interactiveGraph}
      templates={templates}
      templateById={templateById}
      onAddTemplate={addTemplateFromContext}
      onAddMacro={addModelGroupMacro}
      onInsertTemplate={insertTemplateFromContext}
      onOpenInspector={openInspector}
      onOpenCommand={() => setCommandOpen(true)}
      onOpenJson={() => setModeToJsonUnavailableToast(toast)}
      onAutoLayout={autoLayout}
      onValidate={() => { void validate(); }}
      onFitView={() => reactFlow.fitView({ padding: 0.2, duration: 220 })}
      onCopyText={copyText}
      onDelete={deleteSelected}
      onDuplicateNode={duplicateNode}
      onFocusNode={focusNode}
      expandedMacroIds={viewState.expandedMacroIds}
      onExpandMacro={expandMacroOnCanvas}
      onCollapseMacro={collapseMacroToSemanticNode}
      onToggleNodeEnabled={toggleNodeEnabled}
      onSelectConnectedPath={selectConnectedPath}
      onDisconnectPort={disconnectPort}
      selectedCount={graphSelection.nodeIds.length + graphSelection.edgeIds.length}
    />
  );
  const canvas = (
    <main
      className={`h-full min-h-0 overflow-hidden bg-background ${dragTemplateId ? 'ring-2 ring-ring ring-offset-2' : ''}`}
      onDrop={onCanvasDrop}
      onDragOver={onCanvasDragOver}
      onDragLeave={() => setDragTemplateId(null)}
      onContextMenuCapture={(event) => {
        prepareGraphContextMenu(event, getRouteGraphContextMenuTarget(event.target));
      }}
    >
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.loadingRouteGraph')}</div>
          ) : (
            <ReactFlow<RouteFlowNode, RouteFlowEdge>
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={flowNodeTypes}
          edgeTypes={flowEdgeTypes}
          onNodesChange={onRouteGraphNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={(items) => {
            const nodeIds = (items.nodes || []).map((node) => node.id);
            const edgeIds = (items.edges || []).map((edge) => edge.id);
            if (suppressSelectionRef.current) {
              if (nodeIds.length === 0 && edgeIds.length === 0) suppressSelectionRef.current = false;
              return;
            }
            if (nodeIds.length === 0 && edgeIds.length === 0) return;
            applyGraphSelection({ nodeIds, edgeIds });
            const nextSelection = nodeIds.length > 0
              ? selectionFromFlowNodeId(nodeIds[0]!, items.nodes?.[0]?.type)
              : selectionFromFlowSelection({ nodeIds, edgeIds });
            if (nextSelection) {
              setSelection((current) => JSON.stringify(current) === JSON.stringify(nextSelection) ? current : nextSelection);
            }
          }}
          onConnect={onConnect}
          onReconnect={onReconnect}
          isValidConnection={isValidConnection}
          onNodeClick={(event, node) => {
            const multiIntent = event.shiftKey || event.ctrlKey || event.metaKey;
            const nextSelection = selectionFromFlowNodeId(node.id, node.type);
            setSelection(nextSelection);
            if (multiIntent) {
              suppressSelectionRef.current = true;
              const current = graphSelectionRef.current;
              applyGraphSelection(toggleGraphNodeSelection(current, node.id));
              window.setTimeout(() => {
                suppressSelectionRef.current = false;
              }, 80);
            } else {
              applyGraphSelection({ nodeIds: [node.id], edgeIds: [] });
              setInspectorTarget(nextSelection);
              anchorInspectorAtViewportRect((event.currentTarget as HTMLElement).getBoundingClientRect());
              setInspectorTab('Overview');
            }
          }}
          onEdgeClick={(event, edge) => {
            const multiIntent = event.shiftKey || event.ctrlKey || event.metaKey;
            setSelection({ kind: 'edge', edgeId: edge.id });
            if (multiIntent) {
              suppressSelectionRef.current = true;
              const current = graphSelectionRef.current;
              applyGraphSelection(toggleGraphEdgeSelection(current, edge.id));
              window.setTimeout(() => {
                suppressSelectionRef.current = false;
              }, 80);
            } else {
              applyGraphSelection({ nodeIds: [], edgeIds: [edge.id] });
              setInspectorTarget({ kind: 'edge', edgeId: edge.id });
              anchorInspectorAtViewportRect({
                left: event.clientX,
                right: event.clientX,
                top: event.clientY,
                bottom: event.clientY,
              });
            }
          }}
          onPaneClick={() => {
            clearGraphSelection();
          }}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          selectionKeyCode="Shift"
          selectionOnDrag={false}
          panOnDrag={[1, 2]}
          fitView
          onlyRenderVisibleElements
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect={false}
          nodesFocusable={false}
          edgesFocusable={false}
          disableKeyboardA11y
          nodeDragThreshold={2}
          connectionDragThreshold={4}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} />
          <Controls />
          {minimapEnabled && <MiniMap pannable zoomable nodeStrokeWidth={2} />}
          {dragTemplateId && (
            <Panel position="top-center" className="rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
              {tr('pages.tokenRoutes.routeGraphWorkbench.dropToCreateNode')}
            </Panel>
          )}
          <Panel position="top-left" className="inline-flex max-w-40 items-center gap-2 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
            <Workflow size={14} />
            <span className="truncate font-medium">
              {graphSelection.nodeIds.length + graphSelection.edgeIds.length > 1
                ? tr('pages.tokenRoutes.routeGraphWorkbench.selectedCount').replace('{count}', String(graphSelection.nodeIds.length + graphSelection.edgeIds.length))
                : selection.kind === 'node'
                  ? selection.nodeId
                  : selection.kind === 'edge'
                    ? selection.edgeId
                    : tr('pages.tokenRoutes.routeGraphWorkbench.routeGraph')}
            </span>
          </Panel>
          <Panel position="top-right">
            <ButtonGroup>
              <Button type="button" variant="secondary" size="sm" onClick={() => setCommandOpen(true)} title={tr('pages.tokenRoutes.routeGraphWorkbench.commandPalette')}>
                <CommandIcon size={13} />
                {tr('pages.tokenRoutes.routeGraphWorkbench.command')}
              </Button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    <Plus size={13} />
                    {tr('pages.tokenRoutes.routeGraphWorkbench.add')}
                    <ChevronDown size={13} />
                  </Button>
                </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Label>{tr('pages.tokenRoutes.routeGraphWorkbench.quickAdd')}</DropdownMenu.Label>
                {quickTemplates.map((template) => (
                  <DropdownMenu.Item key={template.id} onSelect={() => addTemplateById(template.id)}>
                    {template.title}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={addModelGroupMacro}>
                  <Sparkles size={13} />
                  {tr('pages.tokenRoutes.routeGraphWorkbench.addMacro')}
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => setCommandOpen(true)}>
                  {tr('pages.tokenRoutes.routeGraphWorkbench.searchAllNodes')}
                  <DropdownMenu.Shortcut>⌘K</DropdownMenu.Shortcut>
                </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
              <Button type="button" variant="outline" size="sm" onClick={autoLayout} title={tr('pages.tokenRoutes.routeGraphWorkbench.autoLayout')}>
                <Wand2 size={13} />
                {tr('pages.tokenRoutes.routeGraphWorkbench.layout')}
              </Button>
            </ButtonGroup>
          </Panel>
        </ReactFlow>
      )}
      {contextMenuNode}
    </main>
  );

  if (mode === 'json') {
    return (
      <Card className="route-graph-advanced-json min-w-0 max-w-full overflow-hidden">
        <CardHeader className="route-graph-advanced-head">
          <div>
            <CardTitle>{tr('pages.tokenRoutes.routeGraphWorkbench.advancedJson')}</CardTitle>
            <CardDescription>{tr('pages.tokenRoutes.routeGraphWorkbench.advancedJsonDescription')}</CardDescription>
          </div>
          <ButtonGroup>
            <Button variant="outline" size="sm" type="button" onClick={() => setJsonText(JSON.stringify(graph, null, 2))}>{tr('pages.tokenRoutes.routeGraphWorkbench.format')}</Button>
            <Button variant="outline" size="sm" type="button" onClick={() => navigator.clipboard?.writeText(jsonText)}>{tr('pages.tokenRoutes.routeGraphWorkbench.copy')}</Button>
            <Button variant="outline" size="sm" type="button" onClick={exportWholeJson}>{tr('pages.tokenRoutes.routeGraphWorkbench.export')}</Button>
            <Button variant="secondary" size="sm" type="button" onClick={applyWholeJson}>{tr('pages.tokenRoutes.routeGraphWorkbench.applyJson')}</Button>
            <Button size="sm" type="button" disabled={saving} onClick={saveDraft}>{tr('pages.tokenRoutes.routeGraphWorkbench.saveDraft')}</Button>
            <Button size="sm" type="button" disabled={saving || errorCount > 0} onClick={publish}>{tr('pages.tokenRoutes.routeGraphWorkbench.publish')}</Button>
          </ButtonGroup>
        </CardHeader>
        <JsonCodeEditor value={jsonText} onChange={setJsonText} minHeight={420} maxHeight={720} ariaLabel={tr('pages.tokenRoutes.routeGraphWorkbench.advancedJson')} />
      </Card>
    );
  }

  return (
    <Tooltip.Provider>
    <div ref={workbenchRef} className="route-graph-workbench relative grid min-h-0 gap-3">
      <header className="route-graph-toolbar flex min-w-0 items-center justify-between gap-3 rounded-lg border bg-card p-3 text-card-foreground">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{tr('pages.tokenRoutes.routeGraphWorkbench.routeGraph')}</div>
          <div className="truncate text-xs text-muted-foreground">
            {tr('pages.tokenRoutes.routeGraphWorkbench.graphSummary')
              .replace('{version}', String(activeVersion?.version ?? '-'))
              .replace('{nodes}', String(graph.nodes.length))
              .replace('{edges}', String(graph.edges.length))
              .replace('{macros}', String(graph.macros.length))
              .replace('{publicEntries}', String(publicEntries.length))}
          </div>
        </div>
        <div className="route-graph-toolbar-status flex items-center gap-1.5">
          <Badge variant={errorCount > 0 ? 'destructive' : 'success'}>{errorCount > 0 ? tr('pages.tokenRoutes.routeGraphWorkbench.errorsCount').replace('{count}', String(errorCount)) : tr('pages.tokenRoutes.routeGraphWorkbench.validatable')}</Badge>
          {warningCount > 0 && <Badge variant="warning">{tr('pages.tokenRoutes.routeGraphWorkbench.warningsCount').replace('{count}', String(warningCount))}</Badge>}
        </div>
        <ButtonGroup className="route-graph-toolbar-actions">
          <Button variant="outline" size="sm" type="button" disabled={undoStack.length === 0} onClick={undo}>{tr('pages.tokenRoutes.routeGraphWorkbench.undo')}</Button>
          <Button variant="outline" size="sm" type="button" disabled={redoStack.length === 0} onClick={redo}>{tr('pages.tokenRoutes.routeGraphWorkbench.redo')}</Button>
          <Button variant="outline" size="sm" type="button" onClick={autoLayout}>{tr('pages.tokenRoutes.routeGraphWorkbench.autoLayout')}</Button>
          <Button variant="outline" size="sm" type="button" onClick={validate}>{tr('pages.tokenRoutes.routeGraphWorkbench.validate')}</Button>
          <Button size="sm" type="button" disabled={saving} onClick={saveDraft}>{tr('pages.tokenRoutes.routeGraphWorkbench.saveDraft')}</Button>
          <Button size="sm" type="button" disabled={saving || errorCount > 0} onClick={publish}>{tr('pages.tokenRoutes.routeGraphWorkbench.publish')}</Button>
        </ButtonGroup>
      </header>

      <ResizablePanelGroup
        id="route-graph-main-layout"
        orientation="horizontal"
        className="route-graph-main-layout h-[calc(100vh-220px)] min-h-[620px] overflow-hidden rounded-lg border bg-card"
      >
        <ResizablePanel id="left" defaultSize="24%" minSize="260px" maxSize="36%" className="min-h-0 overflow-hidden">
          <LeftWorkbenchPanel
            templates={templates}
            publicEntries={publicEntries}
            nodes={graph.nodes}
            macros={graph.macros}
            viewState={viewState}
            onAdd={addNode}
            onAddTemplate={addTemplate}
            onStartDrag={setDragTemplateId}
            onSelect={(nodeId) => {
              setSelection({ kind: 'node', nodeId });
              applyGraphSelection({ nodeIds: [nodeId], edgeIds: [] });
            }}
            onSelectMacro={(macroId) => {
              setSelection({ kind: 'macro', macroId });
              setInspectorTarget({ kind: 'macro', macroId });
              setInspectorAnchor({ x: 280, y: 96, side: 'right', mode: 'manual' });
              setInspectorTab('Config');
            }}
            onAddModelGroupMacro={addModelGroupMacro}
            onChangeView={setViewState}
          />
        </ResizablePanel>
        <ResizableHandle orientation="horizontal" withHandle />
        <ResizablePanel id="center" defaultSize="76%" minSize="420px" className="min-h-0 overflow-hidden">
          <ResizablePanelGroup
            id="route-graph-center-layout"
            orientation="vertical"
            className="min-h-0"
          >
            <ResizablePanel id="canvas" defaultSize="70%" minSize="360px" className="min-h-0 overflow-hidden">
              <div ref={canvasPanelRef} className="relative h-full min-h-0">
              {canvas}
              </div>
            </ResizablePanel>
            <ResizableHandle orientation="vertical" withHandle />
            <ResizablePanel id="bottom" defaultSize="30%" minSize="120px" maxSize="55%" className="min-h-0 overflow-hidden">
              <Card className="grid h-full min-h-0 overflow-hidden rounded-none border-0 shadow-none">
                <Tabs.Tabs value={bottomTab} onValueChange={(value) => setBottomTab(value as typeof bottomTab)}>
                  <CardHeader className="p-2">
                    <Tabs.TabsList className="max-w-full overflow-auto">
                      {BOTTOM_TABS.map((tab) => (
                        <Tabs.TabsTrigger key={tab} value={tab}>{tab}</Tabs.TabsTrigger>
                      ))}
                    </Tabs.TabsList>
                  </CardHeader>
                  {BOTTOM_TABS.map((tab) => (
                    <Tabs.TabsContent key={tab} value={tab}>
                      <BottomPanel
                        tab={tab}
                        graph={graph}
                        activeGraph={activeGraph}
                        history={versionHistory}
                        diagnostics={diagnostics}
                        onSelectNode={(nodeId) => setSelection({ kind: 'node', nodeId })}
                      />
                    </Tabs.TabsContent>
                  ))}
                </Tabs.Tabs>
              </Card>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>

      {graphSelection.nodeIds.length + graphSelection.edgeIds.length > 1 && (
        <aside className="absolute right-3 top-16 z-40 grid gap-2 rounded-lg border bg-background p-3 text-foreground shadow-lg">
          <div className="text-sm font-medium">{tr('pages.tokenRoutes.routeGraphWorkbench.selectedCount').replace('{count}', String(graphSelection.nodeIds.length + graphSelection.edgeIds.length))}</div>
          <div className="text-xs text-muted-foreground">
            {tr('pages.tokenRoutes.routeGraphWorkbench.selectionSummary')
              .replace('{nodes}', String(graphSelection.nodeIds.length))
              .replace('{edges}', String(graphSelection.edgeIds.length))}
          </div>
          <ButtonGroup>
            <Button type="button" variant="destructive" size="sm" onClick={deleteSelected}>{tr('pages.tokenRoutes.routeGraphWorkbench.deleteSelected')}</Button>
          </ButtonGroup>
        </aside>
      )}

      {(selectedNode || selectedEdge || selectedMacro) && inspectorAnchor && (
        <aside
          ref={inspectorPanelRef}
          className="route-graph-inspector-panel absolute z-[80] flex w-[min(440px,calc(100%-2rem))] min-w-0 flex-col overflow-y-auto rounded-lg border bg-background text-foreground shadow-lg"
          style={{
            left: inspectorAnchor.x,
            top: inspectorAnchor.y,
            height: `clamp(180px, calc(100% - ${inspectorAnchor.y}px - 12px), 560px)`,
            maxHeight: `clamp(180px, calc(100% - ${inspectorAnchor.y}px - 12px), 560px)`,
          }}
          data-side={inspectorAnchor.side}
          aria-label={tr('pages.tokenRoutes.routeGraphWorkbench.routeGraphInspector')}
        >
          <div className="route-graph-inspector-controls">
            <DragHandleButton
              className="route-graph-inspector-drag-handle"
              aria-label={tr('pages.tokenRoutes.routeGraphWorkbench.moveInspector')}
              onPointerDown={beginInspectorDrag}
            >
              <span />
              <span />
              <span />
            </DragHandleButton>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="route-graph-inspector-close"
              aria-label={tr('pages.tokenRoutes.routeGraphWorkbench.closeInspector')}
              onClick={clearGraphSelection}
            >
              <X size={15} />
            </Button>
          </div>
          <div className="route-graph-inspector-scroll min-h-0 flex-1">
            <Inspector
              graph={interactiveGraph}
              semanticGraph={graph}
              routeEndpointCatalog={routeEndpointCatalog}
              selectedNode={selectedNode}
              selectedPort={selectedPort}
              selectedEdge={selectedEdge}
              selectedMacro={selectedMacro}
              inspectorTab={inspectorTab}
              setInspectorTab={setInspectorTab}
              nodeJsonText={nodeJsonText}
              setNodeJsonText={setNodeJsonText}
              onApplyNodeJson={applyNodeJson}
              onDelete={deleteSelected}
              onChangeNode={(node) => {
                if (!canReplaceRouteGraphNode(graph, node)) {
                  toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.jsonManual'));
                  return;
                }
                applyGraph(updateNode(graph, node));
              }}
              onChangeMacro={updateMacro}
              onAddMacroGroup={addMacroGroup}
              expandedMacroIds={viewState.expandedMacroIds}
              onExpandMacro={expandMacroOnCanvas}
              onCollapseMacro={collapseMacroToSemanticNode}
              onFocusGeneratedPrimitive={focusGeneratedPrimitive}
              onCopyText={copyText}
              onDuplicateNode={duplicateNode}
              onFocusNode={focusNode}
              onFocusEdge={focusEdge}
              onSelectConnectedPath={selectConnectedPath}
              onToggleNodeEnabled={toggleNodeEnabled}
            />
          </div>
        </aside>
      )}

      <Command.CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <Command.Command className="route-graph-command-shell">
          <Command.CommandInput placeholder={tr('pages.tokenRoutes.routeGraphWorkbench.searchNodesOrActions')} />
          <Command.CommandList>
            <Command.CommandEmpty>{tr('pages.tokenRoutes.routeGraphWorkbench.noResults')}</Command.CommandEmpty>
            <Command.CommandGroup heading={tr('pages.tokenRoutes.routeGraphWorkbench.actions')}>
              <Command.CommandItem onSelect={() => { autoLayout(); setCommandOpen(false); }}>
                {tr('pages.tokenRoutes.routeGraphWorkbench.autoLayout')}
                <Command.CommandShortcut>⌘L</Command.CommandShortcut>
              </Command.CommandItem>
              <Command.CommandItem onSelect={() => { validate(); setCommandOpen(false); }}>
                {tr('pages.tokenRoutes.routeGraphWorkbench.validateGraph')}
                <Command.CommandShortcut>⌘⇧V</Command.CommandShortcut>
              </Command.CommandItem>
              <Command.CommandItem onSelect={() => { saveDraft(); setCommandOpen(false); }}>
                {tr('pages.tokenRoutes.routeGraphWorkbench.saveDraft')}
                <Command.CommandShortcut>⌘S</Command.CommandShortcut>
              </Command.CommandItem>
            </Command.CommandGroup>
            <Command.CommandSeparator />
            <Command.CommandGroup heading={tr('pages.tokenRoutes.routeGraphWorkbench.quickAdd')}>
              {paletteTemplates.map((template) => (
                <Command.CommandItem key={template.id} onSelect={() => { addTemplateById(template.id, contextMenu.position); setCommandOpen(false); }}>
                  <span>{template.kicker}</span>
                  {template.title}
                </Command.CommandItem>
              ))}
            </Command.CommandGroup>
          </Command.CommandList>
        </Command.Command>
      </Command.CommandDialog>

    </div>
    </Tooltip.Provider>
  );
}

function AddPanel({
  templates,
  onAdd,
  onAddTemplate,
  onStartDrag,
}: {
  templates: AddTemplate[];
  onAdd: (type: RouteGraphNodeType) => void;
  onAddTemplate: (template: AddTemplate) => void;
  onStartDrag: (templateId: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'All' | 'Primitive' | AddTemplate['category']>('All');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTemplates = templates.filter((template) => (
    (category === 'All' || template.category === category)
    && (!normalizedQuery
      || template.title.toLowerCase().includes(normalizedQuery)
      || template.kicker.toLowerCase().includes(normalizedQuery)
      || template.detail.toLowerCase().includes(normalizedQuery))
  ));
  const coreTemplates = filteredTemplates.filter((template) => template.category === 'Core');
  const transformTemplates = filteredTemplates.filter((template) => template.category === 'Transform');
  const fallbackTemplates = filteredTemplates.filter((template) => template.category === 'Fallback');
  const primitiveNodeTypes = NODE_TYPES.filter((type) => {
    if (category !== 'All' && category !== 'Primitive') return false;
    const detail = routeGraphNodeDefinitions[type];
    return !normalizedQuery
      || type.includes(normalizedQuery)
      || detail.title.toLowerCase().includes(normalizedQuery)
      || detail.detail.toLowerCase().includes(normalizedQuery);
  });
  const renderTemplate = (template: AddTemplate) => (
    <Card
      key={template.id}
      className="route-graph-template-card relative min-w-0 overflow-hidden"
      role="button"
      tabIndex={0}
      data-template-category={template.category}
      data-template-type={template.primitiveType || template.id}
      style={routeGraphAccentStyle(templateAccent(template))}
      draggable
      onClick={() => onAddTemplate(template)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onAddTemplate(template);
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-metapi-route-template', template.id);
        event.dataTransfer.effectAllowed = 'copy';
        onStartDrag(template.id);
      }}
      onDragEnd={() => onStartDrag(null)}
    >
      <span className="route-graph-template-accent" aria-hidden="true" />
      <div className="route-graph-template-card-main">
        <span className="route-graph-template-card-icon">
          {template.primitiveType ? <Boxes size={13} /> : <Sparkles size={13} />}
        </span>
        <div className="min-w-0">
          <div className="route-graph-template-card-title">{template.title}</div>
          <div className="route-graph-template-card-kicker">{template.kicker}</div>
          <p className="route-graph-template-card-detail">{template.detail}</p>
        </div>
      </div>
    </Card>
  );
  const renderPrimitiveNode = (type: RouteGraphNodeType) => {
    const detail = routeGraphNodeDefinitions[type];
    return (
      <Card
        key={type}
        className="route-graph-template-card relative min-w-0 overflow-hidden"
        role="button"
        tabIndex={0}
        data-template-category="Primitive"
        data-template-type={type}
        style={routeGraphAccentStyle(ROUTE_GRAPH_VISUAL_COLORS.node[type])}
        draggable
        onClick={() => onAdd(type)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onAdd(type);
          }
        }}
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-metapi-route-node-type', type);
          event.dataTransfer.effectAllowed = 'copy';
          onStartDrag(type);
        }}
        onDragEnd={() => onStartDrag(null)}
      >
        <span className="route-graph-template-accent" aria-hidden="true" />
        <div className="route-graph-template-card-main">
          <span className="route-graph-template-card-icon">
            <Boxes size={13} />
          </span>
          <div className="min-w-0">
            <div className="route-graph-template-card-title">{detail.title}</div>
            <div className="route-graph-template-card-kicker">{detail.kicker} · {type}</div>
            <p className="route-graph-template-card-detail">{detail.detail}</p>
          </div>
        </div>
      </Card>
    );
  };
  return (
    <ScrollArea className="route-graph-sidebar-scroll h-full min-h-0">
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 p-3">
      <div className="route-graph-template-search">
        <Search className="shrink-0 text-muted-foreground" size={14} />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr('pages.tokenRoutes.routeGraphWorkbench.searchNodes')} />
      </div>
      <Tabs.Tabs value={category} onValueChange={(value) => setCategory(value as typeof category)}>
        <Tabs.TabsList className="flex w-full overflow-x-auto">
          {(['All', 'Core', 'Transform', 'Fallback', 'Primitive'] as const).map((item) => (
            <Tabs.TabsTrigger key={item} value={item} className="shrink-0">{getLibraryCategoryLabel(item)}</Tabs.TabsTrigger>
          ))}
        </Tabs.TabsList>
      </Tabs.Tabs>

      {coreTemplates.length > 0 && (
        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <div className="text-xs font-semibold text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.coreFlow')}</div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">{coreTemplates.map(renderTemplate)}</div>
        </section>
      )}
      {transformTemplates.length > 0 && (
        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <div className="text-xs font-semibold text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.requestMutations')}</div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">{transformTemplates.map(renderTemplate)}</div>
        </section>
      )}
      {fallbackTemplates.length > 0 && (
        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <div className="text-xs font-semibold text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.fallbacks')}</div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">{fallbackTemplates.map(renderTemplate)}</div>
        </section>
      )}
      {primitiveNodeTypes.length > 0 && (
        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <div className="text-xs font-semibold text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.primitiveNodes')}</div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">{primitiveNodeTypes.map(renderPrimitiveNode)}</div>
        </section>
      )}
      <div className="route-graph-template-hint">
        {tr('pages.tokenRoutes.routeGraphWorkbench.libraryHint')}
      </div>
    </div>
    </ScrollArea>
  );
}

function getLibraryCategoryLabel(category: 'All' | 'Core' | 'Transform' | 'Fallback' | 'Primitive'): string {
  if (category === 'Core') return tr('pages.tokenRoutes.routeGraphWorkbench.categoryCore');
  if (category === 'Transform') return tr('pages.tokenRoutes.routeGraphWorkbench.categoryTransform');
  if (category === 'Fallback') return tr('pages.tokenRoutes.routeGraphWorkbench.categoryFallback');
  if (category === 'Primitive') return tr('pages.tokenRoutes.routeGraphWorkbench.categoryPrimitive');
  return tr('pages.tokenRoutes.routeGraphWorkbench.categoryAll');
}

function ModelsPanel({ nodes, onSelect }: { nodes: RouteGraphNode[]; onSelect: (nodeId: string) => void }) {
  return (
    <ScrollArea className="route-graph-sidebar-scroll h-full min-h-0">
    <div className="grid gap-2 p-3">
      {nodes.length === 0 ? <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.noPublicEntries')}</div> : nodes.map((node) => {
        const match = (node.match || {}) as any;
        const title = String(match.displayName || match.requestedModelPattern || getNodeTitle(node));
        return (
          <Button key={node.id} type="button" variant="outline" className="h-auto min-w-0 justify-start gap-2 p-3 text-left" onClick={() => onSelect(node.id)}>
            <Layers3 className="size-4 shrink-0 text-muted-foreground" />
            <span className="grid min-w-0 gap-0.5">
              <strong className="truncate text-sm font-medium">{title}</strong>
              <small className="truncate text-xs text-muted-foreground">{getModelListSubtitle(node)}</small>
            </span>
          </Button>
        );
      })}
    </div>
    </ScrollArea>
  );
}

function getMacroConfig(macro: RouteGraphMacro): Record<string, any> {
  return macro.config && typeof macro.config === 'object' ? macro.config as Record<string, any> : {};
}

export function getMacroDisplayName(macro: RouteGraphMacro): string {
  const config = getMacroConfig(macro);
  const surface = config.surface && typeof config.surface === 'object' ? config.surface as Record<string, any> : {};
  const entry = surface.entry && typeof surface.entry === 'object' ? surface.entry as Record<string, any> : {};
  const match = entry.match && typeof entry.match === 'object' ? entry.match as Record<string, any> : {};
  return String(match.displayName || macro.name || macro.id);
}

export function getMacroGroups(macro: RouteGraphMacro): Array<Record<string, any>> {
  const groups = getMacroConfig(macro).groups;
  return Array.isArray(groups) ? groups : [];
}

type MacroGroupPreview = {
  index: number;
  id: string;
  label: string;
  priority: number;
  inputKind: string;
  routeIds: number[];
  endpointIds: string[];
  pattern?: string | null;
  enabled: boolean;
};

export function getMacroGroupPreviews(macro: RouteGraphMacro): MacroGroupPreview[] {
  return getMacroGroups(macro).map((group, index) => {
    const input = group.input && typeof group.input === 'object' ? group.input as Record<string, any> : {};
    const endpointIds = Array.isArray(input.endpointIds)
      ? input.endpointIds.map((endpointId) => String(endpointId || '').trim()).filter(Boolean)
      : [];
    const routeIds = normalizeRouteIdsFromMacroInput(input);
    const priority = Number.isFinite(Number(group.priority)) ? Math.trunc(Number(group.priority)) : index;
    const explicitLabel = typeof group.label === 'string' && group.label.trim() ? group.label.trim() : '';
    return {
      index,
      id: String(group.id || `group:${index + 1}`),
      label: explicitLabel || (endpointIds.length > 0 ? `Endpoint ${index + 1}` : `Priority ${priority}`),
      priority,
      inputKind: String(input.kind || (routeIds.length > 0 ? 'route_endpoints' : 'unknown')),
      routeIds: Array.from(new Set(routeIds)),
      endpointIds,
      pattern: typeof input.pattern === 'string'
        ? input.pattern
        : typeof input.requestedModelPattern === 'string'
          ? input.requestedModelPattern
          : null,
      enabled: group.enabled !== false,
    };
  }).sort((left, right) => left.priority - right.priority || left.index - right.index);
}

function getMacroGroupPreviewSummary(group: MacroGroupPreview): string {
  if (group.inputKind === 'route_endpoints') {
    if (group.routeIds.length > 0) {
      return tr('pages.tokenRoutes.routeGraphWorkbench.routesList').replace('{routes}', group.routeIds.join(', '));
    }
    if (group.endpointIds.length > 0) {
      return `${group.endpointIds.length} ${tr('pages.tokenRoutes.routeGraphWorkbench.endpointSet')}`;
    }
  }
  if (group.pattern) return `${group.inputKind} · ${group.pattern}`;
  return group.inputKind;
}

function getMacroGroupDisplayLabel(group: MacroGroupPreview): string {
  const embedsEndpointId = group.endpointIds.some((endpointId) => group.label.includes(endpointId));
  if (embedsEndpointId || (group.endpointIds.length > 0 && group.label.length > 48)) {
    return `Endpoint ${group.index + 1}`;
  }
  return group.label;
}

function getMacroGeneratedRowDisplayLabel(row: MacroGeneratedPreviewRow, groups: MacroGroupPreview[]): string {
  const group = groups.find((item) => item.index === row.groupIndex) || groups[row.index] || null;
  if (group) return getMacroGroupDisplayLabel(group);
  return getMacroGroupDisplayLabel({
    index: row.index,
    id: row.id,
    label: row.groupLabel,
    priority: row.priority,
    inputKind: 'unknown',
    routeIds: row.routeId ? [row.routeId] : [],
    endpointIds: row.endpointId ? [row.endpointId] : [],
    enabled: true,
  });
}

function getMacroRouteIds(macro: RouteGraphMacro): number[] {
  const routeIds: number[] = [];
  for (const group of getMacroGroupPreviews(macro)) {
    if (group.inputKind !== 'route_endpoints') continue;
    for (const routeId of group.routeIds) {
      if (!routeIds.includes(routeId)) routeIds.push(routeId);
    }
  }
  return routeIds;
}

function findMacroForGeneratedPrimitive(graph: RouteGraphSource, nodeId: string): RouteGraphMacro | null {
  const node = graph.nodes.find((item) => item.id === nodeId);
  const macroId = node ? getPrimitiveNodeMacroId(node) : null;
  if (macroId) return graph.macros.find((macro) => macro.id === macroId) || null;
  for (const macro of graph.macros) {
    const rows = getMacroGeneratedPreviewRows(graph, macro);
    if (rows.some((row) => row.nodeIds.includes(nodeId))) {
      return macro;
    }
  }
  return null;
}

function getMacroStrategy(macro: RouteGraphMacro): string {
  const policy = getMacroConfig(macro).policy;
  return String(policy && typeof policy === 'object' && 'strategy' in policy ? (policy as any).strategy : 'priority_order');
}

function MacrosPanel({
  macros,
  onSelect,
  onAdd,
}: {
  macros: RouteGraphMacro[];
  onSelect: (macroId: string) => void;
  onAdd: () => void;
}) {
  const sortedMacros = [...macros].sort((left, right) => getMacroDisplayName(left).localeCompare(getMacroDisplayName(right)));
  return (
    <ScrollArea className="route-graph-sidebar-scroll h-full min-h-0">
      <div className="grid gap-2 p-3">
        <Button type="button" variant="secondary" className="justify-start gap-2" onClick={onAdd}>
          <Plus size={14} />
          {tr('pages.tokenRoutes.routeGraphWorkbench.addModelGroupMacro')}
        </Button>
        {sortedMacros.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.noSemanticMacros')}</div>
        ) : sortedMacros.map((macro) => {
          const routeIds = getMacroRouteIds(macro);
          return (
            <Button key={macro.id} type="button" variant="outline" className="h-auto min-w-0 justify-start gap-2 p-3 text-left" onClick={() => onSelect(macro.id)}>
                <Sparkles className="size-4 shrink-0 text-muted-foreground" />
                <span className="grid min-w-0 gap-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <strong className="truncate text-sm font-medium">{getMacroDisplayName(macro)}</strong>
                    <Badge variant={macro.enabled ? 'secondary' : 'outline'}>{macro.enabled ? tr('pages.tokenRoutes.routeGraphWorkbench.enabled') : tr('pages.tokenRoutes.routeGraphWorkbench.disabled')}</Badge>
                  </span>
                  <small className="truncate text-xs text-muted-foreground">
                    {macro.kind} · {macro.visibility} · {getMacroStrategy(macro)} · {tr('pages.tokenRoutes.routeGraphWorkbench.routesCount').replace('{count}', String(routeIds.length))}
                  </small>
                </span>
            </Button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function NodesPanel({ nodes, onSelect }: { nodes: RouteGraphNode[]; onSelect: (nodeId: string) => void }) {
  return (
    <ScrollArea className="route-graph-sidebar-scroll h-full min-h-0">
    <div className="grid gap-2 p-3">
      {nodes.map((node) => (
        <Button key={node.id} type="button" variant="outline" className="h-auto min-w-0 justify-start gap-2 p-3 text-left" onClick={() => onSelect(node.id)}>
          <ListTree className="size-4 shrink-0 text-muted-foreground" />
          <span className="grid min-w-0 gap-0.5">
            <strong className="truncate text-sm font-medium">{getNodeTitle(node)}</strong>
            <small className="truncate text-xs text-muted-foreground">{getOutlineSubtitle(node)}</small>
          </span>
        </Button>
      ))}
    </div>
    </ScrollArea>
  );
}

function ViewsPanel({ value, onChange }: { value: ViewState; onChange: (value: ViewState) => void }) {
  const update = (patch: Partial<ViewState>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-2 p-3">
      <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
        <span className="grid gap-0.5">
          <span>{tr('pages.tokenRoutes.routeGraphWorkbench.showCompiledGraph')}</span>
          <span className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.showCompiledGraphDescription')}</span>
        </span>
        <Switch checked={value.showGeneratedPrimitives} onCheckedChange={(checked) => update({ showGeneratedPrimitives: checked, expandedMacroIds: [], expandedSupplyMacroIds: [] })} />
      </label>
      <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
        <span>{tr('pages.tokenRoutes.routeGraphWorkbench.highlightSelectedPath')}</span>
        <Switch checked={value.highlightSelectedPath} onCheckedChange={(checked) => update({ highlightSelectedPath: checked })} />
      </label>
    </div>
  );
}

function LeftWorkbenchPanel({
  templates,
  publicEntries,
  nodes,
  macros,
  viewState,
  onAdd,
  onAddTemplate,
  onStartDrag,
  onSelect,
  onSelectMacro,
  onAddModelGroupMacro,
  onChangeView,
}: {
  templates: AddTemplate[];
  publicEntries: RouteGraphNode[];
  nodes: RouteGraphNode[];
  macros: RouteGraphMacro[];
  viewState: ViewState;
  onAdd: (type: RouteGraphNodeType) => void;
  onAddTemplate: (template: AddTemplate) => void;
  onStartDrag: (templateId: string | null) => void;
  onSelect: (nodeId: string) => void;
  onSelectMacro: (macroId: string) => void;
  onAddModelGroupMacro: () => void;
  onChangeView: (value: ViewState) => void;
}) {
  const [section, setSection] = useState<'library' | 'models' | 'macros' | 'outline' | 'view'>('library');
  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r bg-card">
      <Tabs.Tabs value={section} onValueChange={(value) => setSection(value as typeof section)} className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <div className="grid gap-3 border-b p-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{tr('pages.tokenRoutes.routeGraphWorkbench.graphTools')}</div>
            <div className="truncate text-xs text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.graphToolsDescription')}</div>
          </div>
          <Tabs.TabsList className="grid w-full grid-cols-5" aria-label={tr('pages.tokenRoutes.routeGraphWorkbench.graphTools')}>
            <Tabs.TabsTrigger value="library" title={tr('pages.tokenRoutes.routeGraphWorkbench.library')} className="gap-1 px-2">
              <Plus size={15} />
              <span className="hidden xl:inline">{tr('pages.tokenRoutes.routeGraphWorkbench.library')}</span>
            </Tabs.TabsTrigger>
            <Tabs.TabsTrigger value="models" title={tr('pages.tokenRoutes.routeGraphWorkbench.models')} className="gap-1 px-2">
              <Layers3 size={15} />
              <span className="hidden xl:inline">{tr('pages.tokenRoutes.routeGraphWorkbench.models')}</span>
            </Tabs.TabsTrigger>
            <Tabs.TabsTrigger value="macros" title={tr('pages.tokenRoutes.routeGraphWorkbench.macros')} className="gap-1 px-2">
              <Sparkles size={15} />
              <span className="hidden xl:inline">{tr('pages.tokenRoutes.routeGraphWorkbench.macros')}</span>
            </Tabs.TabsTrigger>
            <Tabs.TabsTrigger value="outline" title={tr('pages.tokenRoutes.routeGraphWorkbench.outline')} className="gap-1 px-2">
              <ListTree size={15} />
              <span className="hidden xl:inline">{tr('pages.tokenRoutes.routeGraphWorkbench.outline')}</span>
            </Tabs.TabsTrigger>
            <Tabs.TabsTrigger value="view" title={tr('pages.tokenRoutes.routeGraphWorkbench.view')} className="gap-1 px-2">
              <Eye size={15} />
              <span className="hidden xl:inline">{tr('pages.tokenRoutes.routeGraphWorkbench.view')}</span>
            </Tabs.TabsTrigger>
          </Tabs.TabsList>
        </div>
        <div className="h-full min-h-0 min-w-0 overflow-hidden">
          <Tabs.TabsContent value="library" className="h-full min-h-0 overflow-hidden">
            <AddPanel
              templates={templates}
              onAdd={onAdd}
              onAddTemplate={onAddTemplate}
              onStartDrag={onStartDrag}
            />
          </Tabs.TabsContent>
          <Tabs.TabsContent value="models" className="h-full min-h-0 overflow-hidden"><ModelsPanel nodes={publicEntries} onSelect={onSelect} /></Tabs.TabsContent>
          <Tabs.TabsContent value="macros" className="h-full min-h-0 overflow-hidden">
            <MacrosPanel
              macros={macros}
              onSelect={onSelectMacro}
              onAdd={onAddModelGroupMacro}
            />
          </Tabs.TabsContent>
          <Tabs.TabsContent value="outline" className="h-full min-h-0 overflow-hidden"><NodesPanel nodes={nodes} onSelect={onSelect} /></Tabs.TabsContent>
          <Tabs.TabsContent value="view" className="h-full min-h-0 overflow-hidden"><ViewsPanel value={viewState} onChange={onChangeView} /></Tabs.TabsContent>
        </div>
      </Tabs.Tabs>
    </aside>
  );
}

function setModeToJsonUnavailableToast(toast: ReturnType<typeof useToast>) {
  toast.error(tr('pages.tokenRoutes.routeGraphWorkbench.useAdvancedJsonTab'));
}

function RouteGraphPointMenu({
  open,
  onOpenChange,
  x,
  y,
  target,
  graph,
  templates,
  templateById,
  onAddTemplate,
  onAddMacro,
  onInsertTemplate,
  onOpenInspector,
  onOpenCommand,
  onOpenJson,
  onAutoLayout,
  onValidate,
  onFitView,
  onCopyText,
  onDelete,
  onDuplicateNode,
  onFocusNode,
  expandedMacroIds,
  onExpandMacro,
  onCollapseMacro,
  onToggleNodeEnabled,
  onSelectConnectedPath,
  onDisconnectPort,
  selectedCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  x: number;
  y: number;
  target: SelectionState;
  graph: RouteGraphSource;
  templates: AddTemplate[];
  templateById: Map<string, AddTemplate>;
  onAddTemplate: (template: AddTemplate) => void;
  onAddMacro: () => void;
  onInsertTemplate: (template: AddTemplate) => void;
  onOpenInspector: (target: SelectionState, tab?: typeof INSPECTOR_TABS[number]) => void;
  onOpenCommand: () => void;
  onOpenJson: () => void;
  onAutoLayout: () => void;
  onValidate: () => void;
  onFitView: () => void;
  onCopyText: (text: string, label: string) => void;
  onDelete: () => void;
  onDuplicateNode: (nodeId: string) => void;
  onFocusNode: (nodeId: string) => void;
  expandedMacroIds: string[];
  onExpandMacro: (macroId: string) => void;
  onCollapseMacro: (macroId: string) => void;
  onToggleNodeEnabled: (nodeId: string) => void;
  onSelectConnectedPath: (nodeId: string, direction: 'upstream' | 'downstream') => void;
  onDisconnectPort: (nodeId: string, portId: string) => void;
  selectedCount: number;
}) {
  const renderTarget = normalizeContextMenuTargetForGraph(graph, target);
  const nodeId = getSelectionNodeId(renderTarget);
  const portId = getSelectionPortId(renderTarget);
  const node = nodeId ? graph.nodes.find((item) => item.id === nodeId) || null : null;
  const macro = renderTarget.kind === 'macro' ? graph.macros.find((item) => item.id === renderTarget.macroId) || null : null;
  const edge = renderTarget.kind === 'edge' ? graph.edges.find((item) => item.id === renderTarget.edgeId) || null : null;
  const port = node && portId ? getNodePort(node, portId) : macro && portId ? getMacroPort(macro, portId) : null;
  const safeTarget = (renderTarget.kind === 'node' && !node)
    || (renderTarget.kind === 'macro' && !macro)
    || (renderTarget.kind === 'edge' && !edge)
    || (renderTarget.kind === 'port' && !port)
    ? { kind: 'graph' } as SelectionState
    : renderTarget;
  const generatedOwnerMacro = node ? findMacroForGeneratedPrimitive(graph, node.id) : null;
  const generatedOwnerExpanded = generatedOwnerMacro ? expandedMacroIds.includes(generatedOwnerMacro.id) : false;
  const readonlyNode = (!node && !macro) || (node ? node.ownership !== 'manual' : macro?.ownership !== 'manual');
  const readonlyEdge = !edge || edge.ownership !== 'manual';
  const coreTemplates = templates.filter((template) => template.category === 'Core');
  const transformTemplates = templates.filter((template) => template.category === 'Transform');
  const fallbackTemplates = templates.filter((template) => template.category === 'Fallback');

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={tr('pages.tokenRoutes.routeGraphWorkbench.contextMenuAnchor')}
          aria-hidden="true"
          className="pointer-events-none absolute size-0 opacity-0"
          style={{ left: x, top: y }}
          tabIndex={-1}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        className="min-w-56"
        side="bottom"
        align="start"
        sideOffset={0}
        avoidCollisions={false}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
      {safeTarget.kind === 'graph' && (
        <>
          <DropdownMenu.Label>{tr('pages.tokenRoutes.routeGraphWorkbench.canvas')}</DropdownMenu.Label>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger><Plus size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.addNode')}</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent className="min-w-56">
              {(templateById.get('entry') || coreTemplates[0]) && <DropdownMenu.Item onSelect={() => onAddTemplate(templateById.get('entry') || coreTemplates[0]!)}>{tr('pages.tokenRoutes.routeGraphWorkbench.entry')}</DropdownMenu.Item>}
              {(templateById.get('dispatcher-route') || coreTemplates[1]) && <DropdownMenu.Item onSelect={() => onAddTemplate(templateById.get('dispatcher-route') || coreTemplates[1]!)}>{tr('pages.tokenRoutes.routeGraphWorkbench.dispatcher')}</DropdownMenu.Item>}
              {coreTemplates.map((template) => (
                <DropdownMenu.Item key={template.id} onSelect={() => onAddTemplate(template)}>{template.title}</DropdownMenu.Item>
              ))}
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
          <DropdownMenu.Item onSelect={onAddMacro}><Sparkles size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.addMacro')}</DropdownMenu.Item>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger><Sparkles size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.addTransform')}</DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent className="min-w-56">
              {transformTemplates.map((template) => (
                <DropdownMenu.Item key={template.id} onSelect={() => onAddTemplate(template)}>{template.title}</DropdownMenu.Item>
              ))}
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger><Trash2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.addFallback')}</DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent className="min-w-56">
              {fallbackTemplates.map((template) => (
                <DropdownMenu.Item key={template.id} onSelect={() => onAddTemplate(template)}>{template.title}</DropdownMenu.Item>
              ))}
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={onFitView}><Crosshair size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.fitView')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={onAutoLayout}><Wand2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.autoLayout')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={onValidate}><Check size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.validateGraph')}</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={onOpenCommand}><CommandIcon size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.commandPalette')}<DropdownMenu.Shortcut>⌘K</DropdownMenu.Shortcut></DropdownMenu.Item>
          <DropdownMenu.Item onSelect={onOpenJson}><Copy size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.advancedJson')}</DropdownMenu.Item>
          {selectedCount > 1 && (
            <>
              <DropdownMenu.Separator />
              <DropdownMenu.Item variant="destructive" onSelect={onDelete}><Trash2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.deleteSelectedCount').replace('{count}', String(selectedCount))}</DropdownMenu.Item>
            </>
          )}
        </>
      )}

      {(safeTarget.kind === 'node' && node) && (
        <>
          <DropdownMenu.Label>{getNodeTitle(node)}</DropdownMenu.Label>
          <DropdownMenu.Item onSelect={() => onOpenInspector(safeTarget, 'Overview')}><MousePointer2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.inspectOverview')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => onOpenInspector(safeTarget, 'Config')}><Settings2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.editConfig')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => onOpenInspector(safeTarget, 'Ports')}><Link2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.editPorts')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => onOpenInspector(safeTarget, 'JSON')}><Copy size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.editJson')}</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger><Plus size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.insertAfter')}</DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent className="min-w-56">
              {templates.map((template) => (
                <DropdownMenu.Item key={template.id} onSelect={() => onInsertTemplate(template)}>{template.title}</DropdownMenu.Item>
              ))}
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
          <DropdownMenu.Item disabled={readonlyNode} onSelect={() => onToggleNodeEnabled(node.id)}><Power size={14} />{node.enabled ? tr('pages.tokenRoutes.routeGraphWorkbench.disableNode') : tr('pages.tokenRoutes.routeGraphWorkbench.enableNode')}</DropdownMenu.Item>
          <DropdownMenu.Item disabled={readonlyNode} onSelect={() => onDuplicateNode(node.id)}><Copy size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.duplicateNode')}</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={() => onFocusNode(node.id)}><Crosshair size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.focusNode')}</DropdownMenu.Item>
          {generatedOwnerMacro && generatedOwnerExpanded && (
            <DropdownMenu.Item onSelect={() => onCollapseMacro(generatedOwnerMacro.id)}><GitBranch size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.collapseToMacro')}</DropdownMenu.Item>
          )}
          <DropdownMenu.Item onSelect={() => onSelectConnectedPath(node.id, 'upstream')}>{tr('pages.tokenRoutes.routeGraphWorkbench.selectUpstream')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => onSelectConnectedPath(node.id, 'downstream')}>{tr('pages.tokenRoutes.routeGraphWorkbench.selectDownstream')}</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={() => onCopyText(node.id, tr('pages.tokenRoutes.routeGraphWorkbench.nodeId'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copyNodeId')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => onCopyText(JSON.stringify(node, null, 2), tr('pages.tokenRoutes.routeGraphWorkbench.nodeJson'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copyNodeJson')}</DropdownMenu.Item>
          <DropdownMenu.Separator />
          {selectedCount > 1 ? (
            <DropdownMenu.Item variant="destructive" disabled={readonlyNode} onSelect={onDelete}><Trash2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.deleteSelectedCount').replace('{count}', String(selectedCount))}</DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item variant="destructive" disabled={readonlyNode} onSelect={onDelete}><Trash2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.deleteNode')}</DropdownMenu.Item>
          )}
        </>
      )}

      {safeTarget.kind === 'macro' && macro && (
        <>
          <DropdownMenu.Label>{getMacroDisplayName(macro)}</DropdownMenu.Label>
          <DropdownMenu.Item onSelect={() => onOpenInspector({ kind: 'macro', macroId: macro.id }, 'Overview')}><MousePointer2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.inspectMacro')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => onOpenInspector({ kind: 'macro', macroId: macro.id }, 'Config')}><Settings2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.editMacro')}</DropdownMenu.Item>
          {expandedMacroIds.includes(macro.id) ? (
            <DropdownMenu.Item onSelect={() => onCollapseMacro(macro.id)}><GitBranch size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.collapseGeneratedView')}</DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item onSelect={() => onExpandMacro(macro.id)}><GitBranch size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.expandGeneratedView')}</DropdownMenu.Item>
          )}
          <DropdownMenu.Item onSelect={() => onCopyText(macro.id, tr('pages.tokenRoutes.routeGraphWorkbench.macroId'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copyMacroId')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => onCopyText(JSON.stringify(macro, null, 2), tr('pages.tokenRoutes.routeGraphWorkbench.macroJson'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copyMacroJson')}</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item variant="destructive" disabled={readonlyNode} onSelect={onDelete}><Trash2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.deleteMacro')}</DropdownMenu.Item>
        </>
      )}

      {safeTarget.kind === 'edge' && edge && (
        <>
          <DropdownMenu.Label>{edge.kind}</DropdownMenu.Label>
          <DropdownMenu.Item onSelect={() => onOpenInspector(safeTarget, 'Overview')}><MousePointer2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.inspectEdge')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => onFocusNode(edge.sourceNodeId)}>{tr('pages.tokenRoutes.routeGraphWorkbench.selectSource')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => onFocusNode(edge.targetNodeId)}>{tr('pages.tokenRoutes.routeGraphWorkbench.selectTarget')}</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={() => onCopyText(JSON.stringify(edge, null, 2), tr('pages.tokenRoutes.routeGraphWorkbench.edgeJson'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copyEdgeJson')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => onCopyText(`${edge.sourceNodeId}.${edge.sourcePortId}`, tr('pages.tokenRoutes.routeGraphWorkbench.sourceRef'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copySourceRef')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => onCopyText(`${edge.targetNodeId}.${edge.targetPortId}`, tr('pages.tokenRoutes.routeGraphWorkbench.targetRef'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copyTargetRef')}</DropdownMenu.Item>
          <DropdownMenu.Separator />
          {selectedCount > 1 ? (
            <DropdownMenu.Item variant="destructive" disabled={readonlyEdge} onSelect={onDelete}><Trash2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.deleteSelectedCount').replace('{count}', String(selectedCount))}</DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item variant="destructive" disabled={readonlyEdge} onSelect={onDelete}><Trash2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.deleteEdge')}</DropdownMenu.Item>
          )}
        </>
      )}

      {safeTarget.kind === 'port' && port && (
        <>
          <DropdownMenu.Label>{port.label}</DropdownMenu.Label>
          <DropdownMenu.Item onSelect={() => onOpenInspector(node ? safeTarget : { kind: 'macro', macroId: macro!.id }, node ? 'Ports' : 'Config')}><MousePointer2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.inspectPort')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => onOpenInspector(node ? { kind: 'node', nodeId: node.id } : { kind: 'macro', macroId: macro!.id }, 'Config')}><Settings2 size={14} />{tr('pages.tokenRoutes.routeGraphWorkbench.editConfig')}</DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onSelect={() => onCopyText(`${node?.id || macroFlowNodeId(macro!.id)}.${port.id}`, tr('pages.tokenRoutes.routeGraphWorkbench.portRef'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copyPortRef')}</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => onCopyText(getPortTypeSignature(port), tr('pages.tokenRoutes.routeGraphWorkbench.portSignature'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copySignature')}</DropdownMenu.Item>
          <DropdownMenu.Item disabled={readonlyNode} onSelect={() => onDisconnectPort(node?.id || macroFlowNodeId(macro!.id), port.id)}>{tr('pages.tokenRoutes.routeGraphWorkbench.disconnectAll')}</DropdownMenu.Item>
        </>
      )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

function Inspector({
  graph,
  semanticGraph,
  routeEndpointCatalog,
  selectedNode,
  selectedPort,
  selectedEdge,
  selectedMacro,
  inspectorTab,
  setInspectorTab,
  nodeJsonText,
  setNodeJsonText,
  onApplyNodeJson,
  onDelete,
  onChangeNode,
  onChangeMacro,
  onAddMacroGroup,
  expandedMacroIds,
  onExpandMacro,
  onCollapseMacro,
  onFocusGeneratedPrimitive,
  onCopyText,
  onDuplicateNode,
  onFocusNode,
  onFocusEdge,
  onSelectConnectedPath,
  onToggleNodeEnabled,
}: {
  graph: RouteGraphSource;
  semanticGraph: RouteGraphSource;
  routeEndpointCatalog: RouteEndpointCatalogItem[];
  selectedNode: RouteGraphNode | null;
  selectedPort: RouteGraphPort | null;
  selectedEdge: RouteGraphEdge | null;
  selectedMacro: RouteGraphMacro | null;
  inspectorTab: typeof INSPECTOR_TABS[number];
  setInspectorTab: (tab: typeof INSPECTOR_TABS[number]) => void;
  nodeJsonText: string;
  setNodeJsonText: (value: string) => void;
  onApplyNodeJson: () => void;
  onDelete: () => void;
  onChangeNode: (node: RouteGraphNode) => void;
  onChangeMacro: (macro: RouteGraphMacro) => void;
  onAddMacroGroup: (macroId: string) => void;
  expandedMacroIds: string[];
  onExpandMacro: (macroId: string) => void;
  onCollapseMacro: (macroId: string) => void;
  onFocusGeneratedPrimitive: (macroId: string, nodeId: string) => void;
  onCopyText: (text: string, label: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onFocusNode: (nodeId: string, options?: { moveInspector?: boolean }) => void;
  onFocusEdge: (edgeId: string, options?: { moveInspector?: boolean }) => void;
  onSelectConnectedPath: (nodeId: string, direction: 'upstream' | 'downstream') => void;
  onToggleNodeEnabled: (nodeId: string) => void;
}) {
  if (selectedMacro) {
    const readonly = selectedMacro.ownership !== 'manual';
    const routeIds = getMacroRouteIds(selectedMacro);
    const generatedRows = getMacroGeneratedPreviewRows(semanticGraph, selectedMacro);
    const generatedPreviewGraph = getMacroGeneratedPreviewGraph(semanticGraph, selectedMacro);
    const groupPreviews = getMacroGroupPreviews(selectedMacro);
    const priorityGroupCount = getMacroPriorityGroupCount(selectedMacro, generatedRows);
    const expandedOnCanvas = expandedMacroIds.includes(selectedMacro.id);
    return (
      <div className="route-graph-inspector-content">
        <InspectorHeader
          icon={<Sparkles size={15} />}
          kicker={tr('pages.tokenRoutes.routeGraphWorkbench.macro')}
          title={getMacroDisplayName(selectedMacro)}
          subtitle={`${selectedMacro.kind} · ${selectedMacro.visibility} · ${selectedMacro.ownership}`}
          action={(
            <ButtonGroup>
              <Button type="button" variant="outline" size="sm" onClick={() => onFocusNode(selectedMacro.id, { moveInspector: false })}>
                <Crosshair size={13} />
                {tr('pages.tokenRoutes.routeGraphWorkbench.focus')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onCopyText(selectedMacro.id, tr('pages.tokenRoutes.routeGraphWorkbench.macroId'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copyId')}</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onCopyText(JSON.stringify(selectedMacro, null, 2), tr('pages.tokenRoutes.routeGraphWorkbench.macroJson'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copyJson')}</Button>
              <Button type="button" variant="destructive" size="sm" disabled={readonly} onClick={onDelete}>{tr('pages.tokenRoutes.routeGraphWorkbench.delete')}</Button>
            </ButtonGroup>
          )}
        />
        <Tabs.Tabs value={inspectorTab} onValueChange={(value) => setInspectorTab(value as typeof inspectorTab)} className="route-graph-inspector-tabs">
          <Tabs.TabsList className="route-graph-inspector-tablist">
            <Tabs.TabsTrigger value="Overview">{tr('pages.tokenRoutes.routeGraphWorkbench.overview')}</Tabs.TabsTrigger>
            <Tabs.TabsTrigger value="Config">{tr('pages.tokenRoutes.routeGraphWorkbench.config')}</Tabs.TabsTrigger>
            <Tabs.TabsTrigger value="JSON">{tr('pages.tokenRoutes.routeGraphWorkbench.json')}</Tabs.TabsTrigger>
          </Tabs.TabsList>
          <Tabs.TabsContent value="Overview">
            <div className="route-graph-inspector-summary">
              <span>{tr('pages.tokenRoutes.routeGraphWorkbench.kind')}<b>{selectedMacro.kind}</b></span>
              <span>{tr('pages.tokenRoutes.routeGraphWorkbench.strategy')}<b>{getMacroStrategy(selectedMacro)}</b></span>
              <span>{tr('pages.tokenRoutes.routeGraphWorkbench.groups')}<b>{getMacroGroups(selectedMacro).length}</b></span>
              <span>{tr('pages.tokenRoutes.routeGraphWorkbench.routesLabel')}<b>{routeIds.length}</b></span>
            </div>
            <div className="route-graph-panel-stack">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{tr('pages.tokenRoutes.routeGraphWorkbench.generatedView')}</div>
                  <div className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.generatedViewDescription')}</div>
                </div>
                <ButtonGroup className="min-w-0 flex-wrap justify-end">
                  <Button type="button" variant="secondary" size="sm" disabled>
                    {tr('pages.tokenRoutes.routeGraphWorkbench.previewInInspector')}
                  </Button>
                  {expandedOnCanvas ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => onCollapseMacro(selectedMacro.id)}>
                      {tr('pages.tokenRoutes.routeGraphWorkbench.collapse')}
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => onExpandMacro(selectedMacro.id)}>
                      {tr('pages.tokenRoutes.routeGraphWorkbench.expandOnCanvas')}
                    </Button>
                  )}
                </ButtonGroup>
              </div>
              <div className="grid min-w-0 gap-2 rounded-md border p-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-xs">
                  <Badge variant="outline">{tr('pages.tokenRoutes.routeGraphWorkbench.entry')}</Badge>
                  <span className="text-muted-foreground">{'->'}</span>
                  <Badge variant="outline">{tr('pages.tokenRoutes.routeGraphWorkbench.dispatcher')}</Badge>
                  <span className="text-muted-foreground">{'->'}</span>
                  <Badge variant="outline">{tr('pages.tokenRoutes.routeGraphWorkbench.endpointSet')}</Badge>
                </div>
                <div className="min-w-0 break-words text-xs text-muted-foreground">
                  {tr('pages.tokenRoutes.routeGraphWorkbench.generatedViewSummary')
                    .replace('{name}', getMacroDisplayName(selectedMacro))
                    .replace('{paths}', String(generatedRows.length))
                    .replace('{groups}', String(priorityGroupCount))}
                </div>
              </div>
              <div className="route-graph-hidden-supply-summary rounded-md border border-dashed p-3">
                <div className="route-graph-hidden-supply-lines" aria-hidden="true">
                  {generatedRows.slice(0, 8).map((row) => <span key={row.id} />)}
                </div>
                <div className="min-w-0 text-xs text-muted-foreground">
                  {generatedPreviewGraph.nodes.length} generated nodes · {generatedPreviewGraph.edges.length} generated links. Use Expand on canvas to inspect supply candidates.
                </div>
              </div>
              <div className="grid min-w-0 gap-2">
                {generatedRows.length === 0 ? (
                  <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.noGeneratedPrimitiveRoutes')}</div>
                ) : generatedRows.map((row) => (
                  <div key={row.id} className="grid min-w-0 gap-2 rounded-md border p-2 text-xs">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <strong className="min-w-0 truncate">{row.routeId ? tr('pages.tokenRoutes.routeGraphWorkbench.routeNumber').replace('{id}', String(row.routeId)) : tr('pages.tokenRoutes.routeGraphWorkbench.candidateNumber').replace('{index}', String(row.index + 1))}</strong>
                      <span className="min-w-0 flex-1 break-words text-muted-foreground">{getMacroGeneratedRowDisplayLabel(row, groupPreviews)} · {tr('pages.tokenRoutes.routeGraphWorkbench.priorityValue').replace('{value}', String(row.priority))}</span>
                      <Badge variant="outline" className="shrink-0">{tr('pages.tokenRoutes.routeGraphWorkbench.readOnly')}</Badge>
                    </div>
                    <div className="grid min-w-0 gap-1">
                      {row.links.length > 0 ? row.links.map((link) => (
                        <div key={link.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 rounded-md bg-muted/35 px-2 py-1.5">
                          <Button type="button" variant="ghost" size="sm" className="h-auto min-w-0 justify-start whitespace-normal px-1.5 py-1 text-left text-xs" onClick={() => onFocusGeneratedPrimitive(selectedMacro.id, link.sourceNodeId)}>
                            <Crosshair size={12} className="mt-0.5 shrink-0" />
                            <span className="min-w-0 break-all font-mono leading-snug">{link.sourceNodeId}</span>
                          </Button>
                          <span className="shrink-0 rounded-full border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {link.label}
                          </span>
                          <Button type="button" variant="ghost" size="sm" className="h-auto min-w-0 justify-start whitespace-normal px-1.5 py-1 text-left text-xs" onClick={() => onFocusGeneratedPrimitive(selectedMacro.id, link.targetNodeId)}>
                            <Crosshair size={12} className="mt-0.5 shrink-0" />
                            <span className="min-w-0 break-all font-mono leading-snug">{link.targetNodeId}</span>
                          </Button>
                        </div>
                      )) : row.nodeIds.map((nodeId) => (
                        <Button key={nodeId} type="button" variant="ghost" size="sm" className="h-auto min-w-0 justify-start whitespace-normal px-2 py-1 text-left text-xs" onClick={() => onFocusGeneratedPrimitive(selectedMacro.id, nodeId)}>
                          <Crosshair size={12} className="mt-0.5 shrink-0" />
                          <span className="min-w-0 break-all font-mono leading-snug">{nodeId}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="route-graph-panel-stack">
              <div className="text-sm font-medium">{tr('pages.tokenRoutes.routeGraphWorkbench.priorityBands')}</div>
              {groupPreviews.map((group) => (
                <div key={group.id} className="route-graph-port-inspector-row">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <strong className="min-w-0 truncate">{getMacroGroupDisplayLabel(group)}</strong>
                    <HoverCard.Root openDelay={150} closeDelay={80}>
                      <HoverCard.Trigger asChild>
                        <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs">
                          {tr('pages.tokenRoutes.routeGraphWorkbench.details')}
                        </Button>
                      </HoverCard.Trigger>
                      <HoverCard.Content className="z-[90] w-[min(420px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] p-3 text-xs" side="left" align="start">
                        <div className="grid gap-2">
                          <div className="break-all font-medium">{group.label}</div>
                          <div className="grid gap-1 text-muted-foreground">
                            <div>{tr('pages.tokenRoutes.routeGraphWorkbench.priorityValue').replace('{value}', String(group.priority))}</div>
                            <div>{group.enabled ? tr('pages.tokenRoutes.routeGraphWorkbench.enabled') : tr('pages.tokenRoutes.routeGraphWorkbench.disabled')}</div>
                            <div>{group.inputKind}</div>
                          </div>
                          {group.routeIds.length > 0 && (
                            <div className="grid gap-1">
                              <div className="font-medium">{tr('pages.tokenRoutes.routeGraphWorkbench.routesLabel')}</div>
                              <div className="break-words font-mono text-muted-foreground">{group.routeIds.join(', ')}</div>
                            </div>
                          )}
                          {group.endpointIds.length > 0 && (
                            <div className="grid gap-1">
                              <div className="font-medium">{tr('pages.tokenRoutes.routeGraphWorkbench.endpointSet')}</div>
                              <div className="grid gap-1">
                                {group.endpointIds.map((endpointId) => (
                                  <div key={endpointId} className="break-all rounded-md border p-1.5 font-mono text-muted-foreground">
                                    {endpointId}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {group.pattern && (
                            <div className="grid gap-1">
                              <div className="font-medium">{tr('pages.tokenRoutes.routeGraphWorkbench.pattern')}</div>
                              <div className="break-all font-mono text-muted-foreground">{group.pattern}</div>
                            </div>
                          )}
                        </div>
                      </HoverCard.Content>
                    </HoverCard.Root>
                  </div>
                  <small>{tr('pages.tokenRoutes.routeGraphWorkbench.priorityValue').replace('{value}', String(group.priority))} · {group.enabled ? tr('pages.tokenRoutes.routeGraphWorkbench.enabled') : tr('pages.tokenRoutes.routeGraphWorkbench.disabled')}</small>
                  <small>{getMacroGroupPreviewSummary(group)}</small>
                </div>
              ))}
            </div>
          </Tabs.TabsContent>
          <Tabs.TabsContent value="Config">
            <MacroForm
              macro={selectedMacro}
              readonly={readonly}
              endpointCatalog={routeEndpointCatalog}
              onChange={onChangeMacro}
              onAddGroup={() => onAddMacroGroup(selectedMacro.id)}
            />
          </Tabs.TabsContent>
          <Tabs.TabsContent value="JSON">
            <JsonCodeEditor value={nodeJsonText} onChange={setNodeJsonText} minHeight={260} maxHeight={520} ariaLabel={tr('pages.tokenRoutes.routeGraphWorkbench.macroJson')} />
            <ButtonGroup>
              <Button type="button" disabled={readonly} onClick={onApplyNodeJson}>{tr('pages.tokenRoutes.routeGraphWorkbench.applyMacroJson')}</Button>
              <Button type="button" variant="outline" onClick={() => setNodeJsonText(JSON.stringify(selectedMacro, null, 2))}>{tr('pages.tokenRoutes.routeGraphWorkbench.format')}</Button>
              <Button type="button" variant="outline" onClick={() => onCopyText(nodeJsonText, tr('pages.tokenRoutes.routeGraphWorkbench.macroJson'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copy')}</Button>
            </ButtonGroup>
          </Tabs.TabsContent>
        </Tabs.Tabs>
      </div>
    );
  }

  if (selectedEdge) {
    return (
      <div className="route-graph-inspector-content">
        <InspectorHeader
          icon={<GitBranch size={15} />}
          kicker={tr('pages.tokenRoutes.routeGraphWorkbench.selectedEdge')}
          title={selectedEdge.kind}
          subtitle={`${selectedEdge.sourceNodeId}.${selectedEdge.sourcePortId} -> ${selectedEdge.targetNodeId}.${selectedEdge.targetPortId}`}
          action={(
            <ButtonGroup>
              <Button type="button" variant="outline" size="sm" onClick={() => onFocusEdge(selectedEdge.id, { moveInspector: false })}>
                <Crosshair size={13} />
                {tr('pages.tokenRoutes.routeGraphWorkbench.focus')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onFocusNode(selectedEdge.sourceNodeId, { moveInspector: false })}>{tr('pages.tokenRoutes.routeGraphWorkbench.source')}</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onFocusNode(selectedEdge.targetNodeId, { moveInspector: false })}>{tr('pages.tokenRoutes.routeGraphWorkbench.target')}</Button>
              <Button type="button" variant="destructive" size="sm" disabled={selectedEdge.ownership !== 'manual'} onClick={onDelete}>
                <Trash2 size={13} />
                {tr('pages.tokenRoutes.routeGraphWorkbench.delete')}
              </Button>
            </ButtonGroup>
          )}
        />
        <div className="route-graph-inspector-summary">
          <span>{tr('pages.tokenRoutes.routeGraphWorkbench.kind')}<b>{selectedEdge.kind}</b></span>
          <span>{tr('pages.tokenRoutes.routeGraphWorkbench.ownership')}<b>{selectedEdge.ownership}</b></span>
          <span>{tr('pages.tokenRoutes.routeGraphWorkbench.source')}<b>{selectedEdge.sourceNodeId}.{selectedEdge.sourcePortId}</b></span>
          <span>{tr('pages.tokenRoutes.routeGraphWorkbench.target')}<b>{selectedEdge.targetNodeId}.{selectedEdge.targetPortId}</b></span>
        </div>
        <div className="route-graph-inspector-section">
          <div className="text-sm font-medium">{tr('pages.tokenRoutes.routeGraphWorkbench.actions')}</div>
          <ButtonGroup>
            <Button type="button" variant="outline" size="sm" onClick={() => onCopyText(`${selectedEdge.sourceNodeId}.${selectedEdge.sourcePortId}`, tr('pages.tokenRoutes.routeGraphWorkbench.sourceRef'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copySource')}</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onCopyText(`${selectedEdge.targetNodeId}.${selectedEdge.targetPortId}`, tr('pages.tokenRoutes.routeGraphWorkbench.targetRef'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copyTarget')}</Button>
          </ButtonGroup>
        </div>
      </div>
    );
  }

  if (!selectedNode) {
    return (
      <div className="route-graph-inspector-content">
        <InspectorHeader
          icon={<Settings2 size={15} />}
          kicker={tr('pages.tokenRoutes.routeGraphWorkbench.graph')}
          title={tr('pages.tokenRoutes.routeGraphWorkbench.routeSummary')}
          subtitle={tr('pages.tokenRoutes.routeGraphWorkbench.routeSummaryDescription')}
        />
        <div className="route-graph-fact-grid">
          {getGraphFacts(graph).map((fact) => (
            <span key={fact.label}>{fact.label}<b>{fact.value}</b></span>
          ))}
        </div>
        <EmptyStateBlock
          className="route-graph-inspector-empty p-4"
          icon={<ListTree size={16} />}
          title={tr('pages.tokenRoutes.routeGraphWorkbench.emptyInspectorHint')}
        />
      </div>
    );
  }

  const readonly = selectedNode.ownership !== 'manual';
  const generatedOwnerMacro = findMacroForGeneratedPrimitive(graph, selectedNode.id);
  const generatedOwnerExpanded = generatedOwnerMacro ? expandedMacroIds.includes(generatedOwnerMacro.id) : false;
  const selectedPortSummary = selectedPort ? `${selectedPort.direction} · ${getPortSummary(selectedPort)}` : '';
  const nodeConnections = selectedNode ? getNodeConnections(graph, selectedNode.id) : [];
  const hasUpstream = nodeConnections.some(({ direction }) => direction === 'inbound');
  const hasDownstream = nodeConnections.some(({ direction }) => direction === 'outbound');
  return (
    <div className="route-graph-inspector-content">
      <InspectorHeader
        icon={<Boxes size={15} />}
        kicker={tr('pages.tokenRoutes.routeGraphWorkbench.node')}
        title={getNodeTitle(selectedNode)}
        subtitle={selectedPort ? `${getNodeSubtitle(selectedNode)} · ${selectedPort.id}` : getNodeSubtitle(selectedNode)}
        action={<ButtonGroup><Button type="button" variant="outline" size="sm" onClick={() => onFocusNode(selectedNode.id, { moveInspector: false })}><Crosshair size={13} />{tr('pages.tokenRoutes.routeGraphWorkbench.focus')}</Button>{generatedOwnerMacro && generatedOwnerExpanded && <Button type="button" variant="outline" size="sm" onClick={() => onCollapseMacro(generatedOwnerMacro.id)}>{tr('pages.tokenRoutes.routeGraphWorkbench.collapseToMacro')}</Button>}<Button type="button" variant="outline" size="sm" disabled={readonly} onClick={() => onDuplicateNode(selectedNode.id)}>{tr('pages.tokenRoutes.routeGraphWorkbench.duplicate')}</Button><Button type="button" variant="destructive" size="sm" disabled={readonly} onClick={onDelete}>{tr('pages.tokenRoutes.routeGraphWorkbench.delete')}</Button></ButtonGroup>}
      />
      <Tabs.Tabs value={inspectorTab} onValueChange={(value) => setInspectorTab(value as typeof inspectorTab)} className="route-graph-inspector-tabs">
        <Tabs.TabsList className="route-graph-inspector-tablist">
          <Tabs.TabsTrigger value="Overview">{tr('pages.tokenRoutes.routeGraphWorkbench.overview')}</Tabs.TabsTrigger>
          <Tabs.TabsTrigger value="Config">{tr('pages.tokenRoutes.routeGraphWorkbench.config')}</Tabs.TabsTrigger>
          <Tabs.TabsTrigger value="Ports">{tr('pages.tokenRoutes.routeGraphWorkbench.ports')}</Tabs.TabsTrigger>
          <Tabs.TabsTrigger value="Connections">{tr('pages.tokenRoutes.routeGraphWorkbench.connections')}</Tabs.TabsTrigger>
          <Tabs.TabsTrigger value="JSON">{tr('pages.tokenRoutes.routeGraphWorkbench.json')}</Tabs.TabsTrigger>
        </Tabs.TabsList>
        <div className="route-graph-inspector-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => onToggleNodeEnabled(selectedNode.id)}>{selectedNode.enabled ? tr('pages.tokenRoutes.routeGraphWorkbench.disable') : tr('pages.tokenRoutes.routeGraphWorkbench.enable')}</Button>
          <Button type="button" variant="outline" size="sm" disabled={!hasUpstream} onClick={() => onSelectConnectedPath(selectedNode.id, 'upstream')}>{tr('pages.tokenRoutes.routeGraphWorkbench.upstream')}</Button>
          <Button type="button" variant="outline" size="sm" disabled={!hasDownstream} onClick={() => onSelectConnectedPath(selectedNode.id, 'downstream')}>{tr('pages.tokenRoutes.routeGraphWorkbench.downstream')}</Button>
        </div>
        {selectedPort && (
          <div className="route-graph-inspector-summary">
            <span>{tr('pages.tokenRoutes.routeGraphWorkbench.port')}<b>{selectedPort.id}</b></span>
            <span>{tr('pages.tokenRoutes.routeGraphWorkbench.signature')}<b>{getPortTypeSignature(selectedPort)}</b></span>
            <span>{tr('pages.tokenRoutes.routeGraphWorkbench.status')}<b>{selectedPort.enabled === false ? tr('pages.tokenRoutes.routeGraphWorkbench.disabled') : tr('pages.tokenRoutes.routeGraphWorkbench.enabled')}</b></span>
            <span>{tr('pages.tokenRoutes.routeGraphWorkbench.connections')}<b>{getPortConnectionCount(graph, selectedNode.id, selectedPort.id)}</b></span>
          </div>
        )}
        <Tabs.TabsContent value="Overview">
          <div className="route-graph-inspector-summary">
            {getNodeInspectorFacts(graph, selectedNode).map((fact) => (
              <span key={fact.label}>{fact.label}<b>{fact.value}</b></span>
            ))}
          </div>
          <div className="route-graph-inspector-section">
            <div className="text-sm font-medium">{tr('pages.tokenRoutes.routeGraphWorkbench.localPorts')}</div>
            {getNodePortsPreview(selectedNode).map((port) => (
              <div key={port.id} className="route-graph-port-inspector-row compact">
                <strong>{port.label}</strong>
                <small>{getPortSummary(port)}</small>
                {getPortModeNote(selectedNode, port) && <small>{getPortModeNote(selectedNode, port)}</small>}
              </div>
            ))}
          </div>
        </Tabs.TabsContent>
        <Tabs.TabsContent value="Config">
          <NodeForm node={selectedNode} readonly={readonly} onChange={onChangeNode} onDelete={onDelete} />
        </Tabs.TabsContent>
        <Tabs.TabsContent value="Ports">
          <div className="route-graph-panel-stack">
            <div className="text-sm font-medium">{tr('pages.tokenRoutes.routeGraphWorkbench.connectedPorts')}</div>
            {getNodePorts(selectedNode).map((port) => (
              <div key={port.id} className="route-graph-port-inspector-row">
                <strong>{port.id}</strong>
                <small>{getPortSummary(port)}</small>
                {getPortModeNote(selectedNode, port) && <small>{getPortModeNote(selectedNode, port)}</small>}
                <small>{tr('pages.tokenRoutes.routeGraphWorkbench.connectionsCount').replace('{count}', String(getPortConnectionCount(graph, selectedNode.id, port.id)))}</small>
              </div>
            ))}
          </div>
        </Tabs.TabsContent>
        <Tabs.TabsContent value="Connections">
          <div className="route-graph-panel-stack">
            <div className="text-sm font-medium">{tr('pages.tokenRoutes.routeGraphWorkbench.inboundOutbound')}</div>
            {getNodeConnections(graph, selectedNode.id).map(({ edge, direction, peerNodeId }) => (
              <div key={edge.id} className="route-graph-port-inspector-row">
                <strong>{direction === 'inbound' ? tr('pages.tokenRoutes.routeGraphWorkbench.inbound') : tr('pages.tokenRoutes.routeGraphWorkbench.outbound')}</strong>
                <small>{direction === 'inbound' ? `${edge.sourceNodeId}.${edge.sourcePortId}` : `${edge.targetNodeId}.${edge.targetPortId}`}</small>
                <small>{edge.kind} · {edge.ownership}</small>
                <small>{peerNodeId}</small>
              </div>
            ))}
          </div>
        </Tabs.TabsContent>
        <Tabs.TabsContent value="JSON">
          <JsonCodeEditor value={nodeJsonText} onChange={setNodeJsonText} minHeight={260} maxHeight={520} ariaLabel={tr('pages.tokenRoutes.routeGraphWorkbench.nodeJson')} />
          <ButtonGroup>
            <Button type="button" disabled={readonly} onClick={onApplyNodeJson}>{tr('pages.tokenRoutes.routeGraphWorkbench.applyNodeJson')}</Button>
            <Button type="button" variant="outline" onClick={() => setNodeJsonText(JSON.stringify(selectedNode, null, 2))}>{tr('pages.tokenRoutes.routeGraphWorkbench.format')}</Button>
            <Button type="button" variant="outline" onClick={() => onCopyText(nodeJsonText, tr('pages.tokenRoutes.routeGraphWorkbench.nodeJson'))}>{tr('pages.tokenRoutes.routeGraphWorkbench.copy')}</Button>
          </ButtonGroup>
        </Tabs.TabsContent>
      </Tabs.Tabs>
    </div>
  );
}

function InspectorHeader({
  icon,
  kicker,
  title,
  subtitle,
  action,
}: {
  icon: ReactNode;
  kicker: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="route-graph-inspector-header">
      <span className="route-graph-inspector-icon">{icon}</span>
      <div>
        <small>{kicker}</small>
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      {action && <div className="route-graph-inspector-action">{action}</div>}
    </div>
  );
}

function RouteEndpointPicker({
  readonly,
  catalog,
  selectedEndpointIds,
  onChange,
}: {
  readonly: boolean;
  catalog: RouteEndpointCatalogItem[];
  selectedEndpointIds: string[];
  onChange: (endpointIds: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const selected = new Set(selectedEndpointIds);
  const selectedItems = selectedEndpointIds.map((endpointId) => catalog.find((item) => item.endpointId === endpointId || item.nodeId === endpointId) || null);
  const filtered = catalog
    .filter((item) => !selected.has(item.endpointId))
    .filter((item) => {
      const text = [
        item.endpointId,
        item.nodeId,
        item.label,
        item.endpointKind,
        item.exposure,
        item.modelPattern,
        item.publicModelName || '',
        ...item.upstreamModels,
        ...item.siteNames,
      ].join(' ').toLowerCase();
      return !query.trim() || text.includes(query.trim().toLowerCase());
    })
    .slice(0, 40);
  const grouped = {
    route_product: filtered.filter((item) => item.endpointKind === 'route_product'),
    supply: filtered.filter((item) => item.endpointKind === 'supply'),
  };
  const addEndpoint = (endpointId: string) => {
    if (readonly || selected.has(endpointId)) return;
    onChange([...selectedEndpointIds, endpointId]);
    setQuery('');
  };
  const removeEndpoint = (endpointId: string) => {
    if (readonly) return;
    onChange(selectedEndpointIds.filter((item) => item !== endpointId));
  };
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.endpointCandidates')}</div>
      {selectedEndpointIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedEndpointIds.map((endpointId, index) => {
            const item = selectedItems[index];
            return (
              <Badge key={endpointId} variant={item?.endpointKind === 'supply' ? 'warning' : 'info'} className="max-w-full gap-1">
                <span className="min-w-0 truncate">{item?.label || endpointId}</span>
                {!readonly && (
                  <button type="button" className="ml-1 text-current/70 hover:text-current" onClick={() => removeEndpoint(endpointId)} aria-label="Remove endpoint">
                    <X size={11} />
                  </button>
                )}
              </Badge>
            );
          })}
        </div>
      )}
      <Command.Command className="rounded-md border">
        <Command.CommandInput
          value={query}
          onValueChange={setQuery}
          disabled={readonly}
          placeholder={tr('pages.tokenRoutes.routeGraphWorkbench.searchEndpoints')}
        />
        {!readonly && (
          <Command.CommandList className="max-h-52">
            <Command.CommandEmpty>{tr('pages.tokenRoutes.routeGraphWorkbench.noEndpointMatches')}</Command.CommandEmpty>
            {grouped.route_product.length > 0 && (
              <Command.CommandGroup heading={tr('pages.tokenRoutes.routeGraphWorkbench.routeProducts')}>
                {grouped.route_product.map((item) => (
                  <Command.CommandItem key={item.endpointId} value={`${item.endpointId} ${item.label} ${item.publicModelName || ''}`} onSelect={() => addEndpoint(item.endpointId)}>
                    <Badge variant="info">{tr('pages.tokenRoutes.routeGraphWorkbench.product')}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{item.label}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{item.endpointId}</div>
                    </div>
                  </Command.CommandItem>
                ))}
              </Command.CommandGroup>
            )}
            {grouped.supply.length > 0 && (
              <Command.CommandGroup heading={tr('pages.tokenRoutes.routeGraphWorkbench.supplyEndpoints')}>
                {grouped.supply.map((item) => (
                  <Command.CommandItem key={item.endpointId} value={`${item.endpointId} ${item.label} ${item.upstreamModels.join(' ')}`} onSelect={() => addEndpoint(item.endpointId)}>
                    <Badge variant="warning">{tr('pages.tokenRoutes.routeGraphWorkbench.supply')}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{item.label}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{[item.upstreamModels[0], item.siteNames[0], item.endpointId].filter(Boolean).join(' · ')}</div>
                    </div>
                  </Command.CommandItem>
                ))}
              </Command.CommandGroup>
            )}
          </Command.CommandList>
        )}
      </Command.Command>
    </div>
  );
}

function MacroForm({ macro, readonly, endpointCatalog, onChange, onAddGroup }: {
  macro: RouteGraphMacro;
  readonly: boolean;
  endpointCatalog: RouteEndpointCatalogItem[];
  onChange: (macro: RouteGraphMacro) => void;
  onAddGroup: () => void;
}) {
  const config = getMacroConfig(macro);
  const surface = config.surface && typeof config.surface === 'object' ? config.surface as Record<string, any> : {};
  const entry = surface.entry && typeof surface.entry === 'object' ? surface.entry as Record<string, any> : {};
  const match = entry.match && typeof entry.match === 'object' ? entry.match as Record<string, any> : {};
  const policy = config.policy && typeof config.policy === 'object' ? config.policy as Record<string, any> : {};
  const presentation = config.presentation && typeof config.presentation === 'object' ? config.presentation as Record<string, any> : {};
  const groups = getMacroGroups(macro);
  const candidateOverrides = config.candidateOverrides && typeof config.candidateOverrides === 'object' ? config.candidateOverrides as Record<string, any> : {};

  const updateConfig = (patch: Record<string, unknown>) => onChange({
    ...macro,
    config: {
      ...config,
      ...patch,
    },
  });
  const updateEntryMatch = (patch: Record<string, unknown>) => updateConfig({
    surface: {
      ...surface,
      entry: {
        ...entry,
        kind: 'external',
        match: {
          ...match,
          kind: 'model',
          ...patch,
        },
      },
      output: surface.output || 'route',
    },
  });
  const updateGroup = (index: number, patch: Record<string, unknown>) => {
    updateConfig({
      groups: groups.map((group, groupIndex) => (groupIndex === index ? { ...group, ...patch } : group)),
    });
  };
  const updateEndpointOverride = (endpointId: string, patch: Record<string, unknown>, endpointKind?: string) => {
    const bucketName = endpointKind === 'supply' ? 'bySupplyEndpointId' : 'byEndpointId';
    const bucket = candidateOverrides[bucketName] && typeof candidateOverrides[bucketName] === 'object'
      ? candidateOverrides[bucketName] as Record<string, any>
      : {};
    const current = bucket[endpointId] && typeof bucket[endpointId] === 'object' ? bucket[endpointId] as Record<string, any> : {};
    const nextOverride = Object.fromEntries(Object.entries({ ...current, ...patch }).filter(([, value]) => value !== undefined && value !== null && value !== ''));
    const nextBucket = { ...bucket };
    if (Object.keys(nextOverride).length === 0) delete nextBucket[endpointId];
    else nextBucket[endpointId] = nextOverride;
    updateConfig({
      candidateOverrides: {
        ...candidateOverrides,
        [bucketName]: nextBucket,
      },
    });
  };
  const resetEndpointOverride = (endpointId: string, endpointKind?: string) => {
    const bucketName = endpointKind === 'supply' ? 'bySupplyEndpointId' : 'byEndpointId';
    const bucket = candidateOverrides[bucketName] && typeof candidateOverrides[bucketName] === 'object'
      ? { ...(candidateOverrides[bucketName] as Record<string, any>) }
      : {};
    delete bucket[endpointId];
    updateConfig({
      candidateOverrides: {
        ...candidateOverrides,
        [bucketName]: bucket,
      },
    });
  };
  const getEndpointOverride = (endpointId: string, endpointKind?: string): Record<string, any> => {
    const primary = endpointKind === 'supply' ? candidateOverrides.bySupplyEndpointId : candidateOverrides.byEndpointId;
    const fallback = candidateOverrides.byEndpointId;
    const primaryRecord = primary && typeof primary === 'object' ? primary as Record<string, any> : {};
    const fallbackRecord = fallback && typeof fallback === 'object' ? fallback as Record<string, any> : {};
    const override = primaryRecord[endpointId] || fallbackRecord[endpointId];
    return override && typeof override === 'object' ? override as Record<string, any> : {};
  };
  const removeGroup = (index: number) => {
    const currentGroups = getMacroGroups(macro);
    onChange({
      ...macro,
      config: {
        ...getMacroConfig(macro),
        groups: currentGroups.filter((_, groupIndex) => groupIndex !== index),
      },
    });
  };
  const priorityBandEditor = (
    <div className="route-graph-panel-stack">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{tr('pages.tokenRoutes.routeGraphWorkbench.routePriorityBands')}</div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readonly}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onAddGroup();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <Plus size={13} />
          {tr('pages.tokenRoutes.routeGraphWorkbench.addPriorityBand')}
        </Button>
      </div>
      {groups.length === 0 && (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          {tr('pages.tokenRoutes.routeGraphWorkbench.noPriorityBands')}
        </div>
      )}
      {groups.map((group, index) => {
        const input = group.input && typeof group.input === 'object' ? group.input as Record<string, any> : {};
        const endpointIds = Array.isArray(input.endpointIds)
          ? input.endpointIds.map((endpointId) => String(endpointId || '').trim()).filter(Boolean)
          : [];
        return (
          <Card key={String(group.id || index)} className="p-3">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline">{tr('pages.tokenRoutes.routeGraphWorkbench.bandNumber').replace('{index}', String(index + 1))}</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={readonly}
                  onClick={() => removeGroup(index)}
                >
                  {tr('pages.tokenRoutes.routeGraphWorkbench.remove')}
                </Button>
              </div>
              <label>
                {tr('pages.tokenRoutes.routeGraphWorkbench.label')}
                <Input disabled={readonly} value={String(group.label || group.id || '')} onChange={(event) => updateGroup(index, { label: event.target.value })} />
              </label>
              <RouteEndpointPicker
                readonly={readonly}
                catalog={endpointCatalog}
                selectedEndpointIds={endpointIds}
                onChange={(endpointIds) => updateGroup(index, { input: { kind: 'route_endpoints', endpointIds } })}
              />
              {endpointIds.length > 0 && (
                <div className="route-graph-panel-stack">
                  {endpointIds.map((endpointId) => {
                    const endpoint = endpointCatalog.find((item) => item.endpointId === endpointId || item.nodeId === endpointId);
                    const override = getEndpointOverride(endpointId, endpoint?.endpointKind);
                    return (
                      <div key={endpointId} className="rounded-md border p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium">{endpoint?.label || endpointId}</div>
                            <div className="truncate text-[11px] text-muted-foreground">{endpoint?.endpointKind || 'endpoint'} · {endpointId}</div>
                          </div>
                          <Badge variant={endpoint?.endpointKind === 'supply' ? 'warning' : 'info'}>{endpoint?.endpointKind || 'endpoint'}</Badge>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <label className="text-[11px] text-muted-foreground">
                            {tr('pages.tokenRoutes.routeGraphWorkbench.weight')}
                            <Input
                              disabled={readonly}
                              type="number"
                              value={override.weight === undefined ? '' : String(override.weight)}
                              placeholder={String(group.defaults?.weight ?? 10)}
                              onChange={(event) => updateEndpointOverride(endpointId, { weight: event.target.value === '' ? undefined : Number(event.target.value) }, endpoint?.endpointKind)}
                            />
                          </label>
                          <label className="text-[11px] text-muted-foreground">
                            {tr('pages.tokenRoutes.routeGraphWorkbench.priority')}
                            <Input
                              disabled={readonly}
                              type="number"
                              value={override.priority === undefined ? '' : String(override.priority)}
                              placeholder={String(group.priority ?? index)}
                              onChange={(event) => updateEndpointOverride(endpointId, { priority: event.target.value === '' ? undefined : Number(event.target.value) }, endpoint?.endpointKind)}
                            />
                          </label>
                          <label className="text-[11px] text-muted-foreground">
                            {tr('pages.tokenRoutes.routeGraphWorkbench.enabled')}
                            <Select
                              disabled={readonly}
                              value={override.excluded ? 'excluded' : override.enabled === false ? 'disabled' : 'default'}
                              onValueChange={(value) => updateEndpointOverride(endpointId, {
                                enabled: value === 'disabled' ? false : undefined,
                                excluded: value === 'excluded' ? true : undefined,
                              }, endpoint?.endpointKind)}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="default">default</SelectItem>
                                <SelectItem value="disabled">disabled</SelectItem>
                                <SelectItem value="excluded">excluded</SelectItem>
                              </SelectContent>
                            </Select>
                          </label>
                        </div>
                        {Object.keys(override).length > 0 && (
                          <Button type="button" variant="ghost" size="sm" disabled={readonly} onClick={() => resetEndpointOverride(endpointId, endpoint?.endpointKind)}>
                            {tr('pages.tokenRoutes.routeGraphWorkbench.reset')}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <label>
                {tr('pages.tokenRoutes.routeGraphWorkbench.priority')}
                <Input disabled={readonly} type="number" value={String(Number.isFinite(Number(group.priority)) ? group.priority : index)} onChange={(event) => updateGroup(index, { priority: Number(event.target.value) || 0 })} />
              </label>
            </div>
          </Card>
        );
      })}
    </div>
  );
  return (
    <div className="grid gap-3">
      {priorityBandEditor}
      <label>
        {tr('pages.tokenRoutes.routeGraphWorkbench.publicModelName')}
        <Input
          disabled={readonly}
          value={String(match.displayName || macro.name || '')}
          onChange={(event) => {
            const displayName = event.target.value;
            onChange({
              ...macro,
              name: displayName || null,
              config: {
                ...config,
                surface: {
                  ...surface,
                  entry: {
                    ...entry,
                    kind: 'external',
                    match: {
                      ...match,
                      kind: 'model',
                      displayName,
                    },
                  },
                  output: surface.output || 'route',
                },
              },
            });
          }}
        />
      </label>
      <label>
        {tr('pages.tokenRoutes.routeGraphWorkbench.visibility')}
        <Select disabled={readonly} value={macro.visibility} onValueChange={(visibility: string) => onChange({
          ...macro,
          visibility: visibility as 'public' | 'internal',
          config: {
            ...config,
            surface: {
              ...surface,
              entry: { ...entry, visibility },
            },
          },
        })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="public">public</SelectItem>
            <SelectItem value="internal">internal</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <div className="flex items-center justify-between gap-3">
        <span>{tr('pages.tokenRoutes.routeGraphWorkbench.enabled')}</span>
        <Switch disabled={readonly} checked={macro.enabled} onCheckedChange={(enabled) => onChange({ ...macro, enabled })} aria-label={tr('pages.tokenRoutes.routeGraphWorkbench.macroEnabled')} />
      </div>
      <label>
        {tr('pages.tokenRoutes.routeGraphWorkbench.strategy')}
        <Select disabled={readonly} value={String(policy.strategy || 'weighted')} onValueChange={(strategy: string) => updateConfig({ policy: { ...policy, strategy } })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="priority_order">priority_order</SelectItem>
            <SelectItem value="weighted">weighted</SelectItem>
            <SelectItem value="round_robin">round_robin</SelectItem>
            <SelectItem value="stable_first">stable_first</SelectItem>
            <SelectItem value="cel_select">cel_select</SelectItem>
            <SelectItem value="cel_score">cel_score</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label>
        Display icon
        <Input
          disabled={readonly}
          value={String(presentation.displayIcon || '')}
          onChange={(event) => updateConfig({ presentation: { ...presentation, displayIcon: event.target.value || null } })}
        />
      </label>
    </div>
  );
}


function BottomPanel({ tab, graph, activeGraph, history, diagnostics, onSelectNode }: {
  tab: typeof BOTTOM_TABS[number];
  graph: RouteGraphSource;
  activeGraph: RouteGraphSource | null;
  history: RouteGraphVersionSummary[];
  diagnostics: RouteGraphDiagnostic[];
  onSelectNode: (nodeId: string) => void;
}) {
  if (tab === 'Diagnostics') {
    const errors = diagnostics.filter((item) => item.severity === 'error');
    const warnings = diagnostics.filter((item) => item.severity === 'warning');
    const ordered = [...errors, ...warnings];
    return (
      <div className="route-graph-bottom-content route-graph-diagnostics-panel">
        <div className="route-graph-diagnostics-header">
          <div className="route-graph-diagnostics-title">
            <span className="text-xs font-medium text-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.problems')}</span>
            <Badge variant={errors.length > 0 ? 'destructive' : 'outline'}>{errors.length} errors</Badge>
            <Badge variant={warnings.length > 0 ? 'warning' : 'outline'}>{warnings.length} warnings</Badge>
          </div>
          <div className="route-graph-diagnostics-counts">
            <span className="text-xs text-muted-foreground">{diagnostics.length === 0 ? 'Clean' : `${diagnostics.length} total`}</span>
          </div>
        </div>

        {diagnostics.length === 0 ? (
          <EmptyStateBlock
            className="route-graph-diagnostics-empty p-4"
            title={tr('pages.tokenRoutes.routeGraphWorkbench.noProblemsDetected')}
          />
        ) : (
          <div className="route-graph-diagnostics-list">
            {ordered.slice(0, 50).map((item, index) => {
              const target = item.nodeId ? `Node ${item.nodeId}` : item.edgeId ? `Edge ${item.edgeId}` : item.portId ? `Port ${item.portId}` : 'Graph';
              return (
                <Button
                  key={`${item.code}-${index}`}
                  type="button"
                  variant="ghost"
                  className={`route-graph-diagnostic-row ${item.severity}`}
                  onClick={() => item.nodeId && onSelectNode(item.nodeId)}
                >
                  <Badge variant={item.severity === 'error' ? 'destructive' : 'warning'}>{item.severity}</Badge>
                  <span className="route-graph-diagnostic-code">{item.code}</span>
                  <span className="route-graph-diagnostic-message">{item.message}</span>
                  <span className="route-graph-diagnostic-target">{target}</span>
                </Button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (tab === 'Diff') {
    const rows = getRouteGraphDiffRows(activeGraph, graph);
    const added = rows.filter((row) => row.change === 'added').length;
    const changed = rows.filter((row) => row.change === 'changed').length;
    const removed = rows.filter((row) => row.change === 'removed').length;
    const currentNodeIds = new Set(graph.nodes.map((node) => node.id));
    return (
      <div className="route-graph-bottom-content route-graph-diagnostics-panel">
        <div className="route-graph-diagnostics-header">
          <div className="route-graph-diagnostics-title">
            <span className="text-xs font-medium text-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.draftDiff')}</span>
            <Badge variant={added > 0 ? 'success' : 'outline'}>{added} added</Badge>
            <Badge variant={changed > 0 ? 'warning' : 'outline'}>{changed} changed</Badge>
            <Badge variant={removed > 0 ? 'destructive' : 'outline'}>{removed} removed</Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {activeGraph
              ? tr('pages.tokenRoutes.routeGraphWorkbench.totalCount').replace('{count}', String(rows.length))
              : tr('pages.tokenRoutes.routeGraphWorkbench.noActiveVersion')}
          </span>
        </div>

        {!activeGraph ? (
          <EmptyStateBlock
            className="route-graph-diagnostics-empty p-4"
            title={tr('pages.tokenRoutes.routeGraphWorkbench.noActiveGraph')}
            description={tr('pages.tokenRoutes.routeGraphWorkbench.noActiveGraphDescription')}
          />
        ) : rows.length === 0 ? (
          <EmptyStateBlock
            className="route-graph-diagnostics-empty p-4"
            title={tr('pages.tokenRoutes.routeGraphWorkbench.noDraftChanges')}
            description={tr('pages.tokenRoutes.routeGraphWorkbench.noDraftChangesDescription')}
          />
        ) : (
          <div className="route-graph-diagnostics-list">
            {rows.slice(0, 80).map((row) => {
              const canSelect = row.kind === 'node' && currentNodeIds.has(row.id);
              return (
                <Button
                  key={`${row.kind}:${row.id}:${row.change}`}
                  type="button"
                  variant="ghost"
                  className="route-graph-diff-row"
                  disabled={!canSelect}
                  onClick={() => canSelect && onSelectNode(row.id)}
                >
                  <Badge variant={row.change === 'added' ? 'success' : row.change === 'removed' ? 'destructive' : 'warning'}>{row.change}</Badge>
                  <span className="route-graph-diff-kind">{row.kind}</span>
                  <span className="route-graph-diff-id">{row.id}</span>
                </Button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (tab === 'History') {
    return (
      <div className="route-graph-bottom-content route-graph-diagnostics-panel">
        <div className="route-graph-diagnostics-header">
          <div className="route-graph-diagnostics-title">
            <span className="text-xs font-medium text-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.versionHistory')}</span>
            <Badge variant="outline">{tr('pages.tokenRoutes.routeGraphWorkbench.versionCount').replace('{count}', String(history.length))}</Badge>
          </div>
          <span className="text-xs text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkbench.latestFirst')}</span>
        </div>

        {history.length === 0 ? (
          <EmptyStateBlock
            className="route-graph-diagnostics-empty p-4"
            title={tr('pages.tokenRoutes.routeGraphWorkbench.noRouteGraphHistory')}
            description={tr('pages.tokenRoutes.routeGraphWorkbench.noRouteGraphHistoryDescription')}
          />
        ) : (
          <div className="route-graph-history-list">
            {history.map((version) => {
              const summary = version.sourceSummary;
              return (
                <div key={version.id} className="route-graph-history-row">
                  <div className="route-graph-history-main">
                    <span className="font-mono text-xs font-semibold text-foreground">v{version.version}</span>
                    <Badge variant={version.status === 'active' ? 'success' : 'outline'}>{version.status}</Badge>
                    {version.createdBy && <span className="text-xs text-muted-foreground">{version.createdBy}</span>}
                  </div>
                  <div className="route-graph-history-summary">
                    <span>{tr('pages.tokenRoutes.routeGraphWorkbench.nodesCount').replace('{count}', String(summary?.nodes ?? 0))}</span>
                    <span>{tr('pages.tokenRoutes.routeGraphWorkbench.edgesCount').replace('{count}', String(summary?.edges ?? 0))}</span>
                    <span>{tr('pages.tokenRoutes.routeGraphWorkbench.macrosCount').replace('{count}', String(summary?.macros ?? 0))}</span>
                    <span>{tr('pages.tokenRoutes.routeGraphWorkbench.publicModelsCount').replace('{count}', String(summary?.publicModels ?? 0))}</span>
                  </div>
                  <div className="route-graph-history-time">
                    <span>{tr('pages.tokenRoutes.routeGraphWorkbench.createdAt').replace('{time}', formatRouteGraphTimestamp(version.createdAt))}</span>
                    {version.activatedAt && <span>{tr('pages.tokenRoutes.routeGraphWorkbench.activatedAt').replace('{time}', formatRouteGraphTimestamp(version.activatedAt))}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return null;
}
