import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
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
import { getRouteGraphMacroPort, getRouteGraphMacroPorts } from '../../../shared/routeGraph.js';
import { useToast } from '../../components/Toast.js';
import { Badge } from '../../components/ui/badge/index.js';
import { Button } from '../../components/ui/button/index.js';
import { ButtonGroup } from '../../components/ui/button-group/index.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card/index.js';
import * as Command from '../../components/ui/command/index.js';
import * as ContextMenu from '../../components/ui/context-menu/index.js';
import * as DropdownMenu from '../../components/ui/dropdown-menu/index.js';
import { Input } from '../../components/ui/input/index.js';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../../components/ui/resizable/index.js';
import { ScrollArea } from '../../components/ui/scroll-area/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select/index.js';
import { Switch } from '../../components/ui/switch/index.js';
import * as Tabs from '../../components/ui/tabs/index.js';
import { Textarea } from '../../components/ui/textarea/index.js';
import * as Tooltip from '../../components/ui/tooltip/index.js';
import { NodeForm } from './NodeForm.js';
import type {
  AddTemplate,
  RouteGraphEdge,
  RouteGraphMacro,
  RouteGraphNode,
  RouteGraphNodeType,
  RouteGraphPort,
} from './routeGraphTypes.js';
import {
  NODE_TYPES,
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
  selectionForContextMenu,
  selectionFromFlowNodeId as deriveSelectionFromFlowNodeId,
  selectionFromFlowSelection,
  toggleGraphEdgeSelection,
  toggleGraphNodeSelection,
} from './routeGraphEditorInteractions.js';

type RouteFlowEdgeData = RouteGraphEdge & {
  __highlighted?: boolean;
};

type RouteGraphSource = {
  version: 1;
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

type RouteFlowNodeType = RouteGraphNodeType | 'macro';
type RouteFlowNodeData =
  | (RouteGraphNode & { __compact?: boolean; __cardMetrics?: string[] })
  | (RouteGraphMacro & { __isMacroNode: true; __compact?: boolean; __cardMetrics?: string[] });
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
type GraphContextMenuState = {
  x: number;
  y: number;
  position: { x: number; y: number };
  target: SelectionState;
};
type GraphSelectionState = {
  nodeIds: string[];
  edgeIds: string[];
};

type RouteGraphWorkbenchProps = {
  mode?: 'graph' | 'json';
};
type ViewState = {
  showInternal: boolean;
  showGenerated: boolean;
  compactNodes: boolean;
  highlightSelectedPath: boolean;
};
const INSPECTOR_TABS = ['Overview', 'Config', 'Ports', 'Connections', 'JSON'] as const;
const BOTTOM_TABS = ['Diagnostics', 'Impact', 'Trace', 'Diff', 'History'] as const;
const QUICK_TEMPLATE_IDS = ['entry', 'dispatcher', 'model_endpoint', 'reasoning_effort'] as const;
const RouteGraphContextMenuContext = createContext<{
  target: SelectionState;
  onContextMenu: (event: MouseEvent | globalThis.MouseEvent, fallbackTarget: SelectionState) => void;
  renderMenu: () => ReactNode;
} | null>(null);
const DEFAULT_VIEW_STATE: ViewState = {
  showInternal: true,
  showGenerated: true,
  compactNodes: false,
  highlightSelectedPath: true,
};

function routeGraphAccentStyle(color: string): CSSProperties {
  return { '--route-graph-accent': color } as CSSProperties;
}

function defaultGraph(): RouteGraphSource {
  return { version: 1, nodes: [], edges: [], macros: [], metadata: {} };
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

function isMacroFlowNodeData(data: RouteFlowNodeData): data is RouteGraphMacro & { __isMacroNode: true; __compact?: boolean; __cardMetrics?: string[] } {
  return (data as { __isMacroNode?: boolean }).__isMacroNode === true;
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

function selectionFromFlowNodeId(nodeId: string): SelectionState {
  return deriveSelectionFromFlowNodeId(nodeId);
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
  return {
    version: 1,
    nodes: Array.isArray(raw.nodes) ? raw.nodes.map((node: any) => ({
      ...node,
      id: String(node.id || ''),
      type: NODE_TYPES.includes(node.type) || node.type === 'auto_node' ? node.type : 'entry',
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

function filterGraphForView(graph: RouteGraphSource, view: ViewState): RouteGraphSource {
  const visibleNodeIds = new Set(
    graph.nodes
      .filter((node) => view.showInternal || node.visibility !== 'internal')
      .filter((node) => view.showGenerated || node.ownership === 'manual')
      .map((node) => node.id),
  );
  const visibleMacroIds = new Set(
    graph.macros
      .filter((macro) => view.showInternal || macro.visibility !== 'internal')
      .filter((macro) => view.showGenerated || macro.ownership === 'manual')
      .map((macro) => macroFlowNodeId(macro.id)),
  );
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => visibleNodeIds.has(node.id)),
    macros: graph.macros.filter((macro) => visibleMacroIds.has(macroFlowNodeId(macro.id))),
    edges: graph.edges.filter((edge) => (
      (visibleNodeIds.has(edge.sourceNodeId) || visibleMacroIds.has(edge.sourceNodeId))
      && (visibleNodeIds.has(edge.targetNodeId) || visibleMacroIds.has(edge.targetNodeId))
    )),
  };
}

function updateNode(graph: RouteGraphSource, node: RouteGraphNode): RouteGraphSource {
  return { ...graph, nodes: graph.nodes.map((item) => (item.id === node.id ? node : item)) };
}

function flowToGraphPositions(graph: RouteGraphSource, nodes: RouteFlowNode[]): RouteGraphSource {
  const positionById = new Map(nodes.map((node) => [node.id, node.position]));
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, position: positionById.get(node.id) || node.position })),
    macros: graph.macros.map((macro) => ({ ...macro, position: positionById.get(macroFlowNodeId(macro.id)) || macro.position })),
  };
}

function layoutGraph(graph: RouteGraphSource): RouteGraphSource {
  const childrenBySource = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  for (const node of graph.nodes) incomingCount.set(node.id, 0);
  for (const edge of graph.edges) {
    if (!childrenBySource.has(edge.sourceNodeId)) childrenBySource.set(edge.sourceNodeId, []);
    childrenBySource.get(edge.sourceNodeId)!.push(edge.targetNodeId);
    incomingCount.set(edge.targetNodeId, (incomingCount.get(edge.targetNodeId) || 0) + 1);
  }

  const roots = graph.nodes
    .filter((node) => node.type === 'entry' && node.visibility === 'public')
    .concat(graph.nodes.filter((node) => (incomingCount.get(node.id) || 0) === 0 && node.type !== 'entry'))
    .map((node) => node.id);
  const queue: Array<{ id: string; level: number }> = roots.map((id) => ({ id, level: 0 }));
  const levels = new Map<string, number>();
  while (queue.length > 0) {
    const item = queue.shift()!;
    const current = levels.get(item.id);
    if (current !== undefined && current <= item.level) continue;
    levels.set(item.id, item.level);
    for (const child of childrenBySource.get(item.id) || []) {
      queue.push({ id: child, level: item.level + 1 });
    }
  }

  const byLevel = new Map<number, RouteGraphNode[]>();
  for (const node of graph.nodes) {
    const level = levels.get(node.id) ?? 0;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push(node);
  }
  const positionByNodeId = new Map<string, { x: number; y: number }>();
  for (const [level, nodes] of byLevel.entries()) {
    const sorted = [...nodes].sort((left, right) => {
      const leftPublic = left.visibility === 'public' ? 0 : 1;
      const rightPublic = right.visibility === 'public' ? 0 : 1;
      if (leftPublic !== rightPublic) return leftPublic - rightPublic;
      return left.id.localeCompare(right.id);
    });
    sorted.forEach((node, index) => {
      positionByNodeId.set(node.id, {
        x: 120 + level * 340,
        y: 110 + index * 220,
      });
    });
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, position: positionByNodeId.get(node.id) || node.position })),
    macros: graph.macros.map((macro, index) => ({
      ...macro,
      position: macro.position || { x: 120, y: 110 + (graph.nodes.length + index) * 220 },
    })),
  };
}

function graphToFlowNodes(graph: RouteGraphSource, view: ViewState): RouteFlowNode[] {
  const primitiveNodes: RouteFlowNode[] = graph.nodes.map((node, index) => ({
    id: node.id,
    type: node.type,
    data: { ...node, __compact: view.compactNodes, __cardMetrics: getNodeCardMetrics(graph, node) },
    position: node.position || { x: 120 + (index % 4) * 300, y: 120 + Math.floor(index / 4) * 190 },
    draggable: node.ownership === 'manual',
  }));
  const macroNodes: RouteFlowNode[] = graph.macros.map((macro, index) => ({
    id: macroFlowNodeId(macro.id),
    type: 'macro',
    data: { ...macro, __isMacroNode: true, __compact: view.compactNodes, __cardMetrics: getMacroCardMetrics(macro) },
    position: macro.position || { x: 120 + ((graph.nodes.length + index) % 4) * 300, y: 120 + Math.floor((graph.nodes.length + index) / 4) * 190 },
    draggable: macro.ownership === 'manual',
  }));
  return [...primitiveNodes, ...macroNodes];
}

function graphToFlowEdges(graph: RouteGraphSource, highlightedEdgeIds: Set<string>): RouteFlowEdge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    type: 'routeGraphEdge',
    source: edge.sourceNodeId,
    sourceHandle: edge.sourcePortId,
    target: edge.targetNodeId,
    targetHandle: edge.targetPortId,
    data: { ...edge, __highlighted: highlightedEdgeIds.has(edge.id) },
    animated: highlightedEdgeIds.has(edge.id),
  }));
}

function getMacroCardMetrics(macro: RouteGraphMacro): string[] {
  const config = macro.config || {};
  const groups = Array.isArray(config.groups) ? config.groups : [];
  return [
    groups.length === 1 ? '1 group' : `${groups.length} groups`,
    String(config.policy && typeof config.policy === 'object' && 'strategy' in config.policy ? (config.policy as any).strategy : 'priority_order'),
    macro.visibility,
  ];
}

function MacroNodeShell({ data }: NodeProps<RouteFlowNode>) {
  if (!isMacroFlowNodeData(data)) return null;
  const contextMenuBridge = useContext(RouteGraphContextMenuContext);
  const readonly = data.ownership !== 'manual';
  const compact = data.__compact === true;
  const nodeContent = (
    <div
      className={`route-blueprint-node route-blueprint-node-macro ${readonly ? 'readonly' : ''} ${compact ? 'compact' : ''} ${data.enabled === false ? 'disabled' : ''}`}
      data-node-id={data.id}
      data-node-type="macro"
      data-ownership={data.ownership}
      style={routeGraphAccentStyle(ROUTE_GRAPH_VISUAL_COLORS.macro.candidate_selector)}
      onContextMenu={(event) => {
        const target = event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>('.route-blueprint-port')
          : null;
        const portId = target?.dataset.portId;
        contextMenuBridge?.onContextMenu(event, portId ? { kind: 'port', nodeId: data.id, portId } : { kind: 'macro', macroId: data.id.replace(/^macro:/, '') });
      }}
    >
      <div className="route-blueprint-node-head">
        <span className="route-blueprint-node-icon" aria-hidden="true">
          <Sparkles size={13} />
        </span>
        <div className="route-blueprint-node-head-main">
          <div className="route-blueprint-node-title">{data.name || data.id}</div>
          <div className="route-blueprint-node-subtitle">{data.kind} · macro</div>
        </div>
        <span className={`route-blueprint-node-state ${data.enabled ? 'online' : 'disabled'}`}>{data.enabled ? 'enabled' : 'disabled'}</span>
      </div>
      <div className="route-blueprint-node-ports">
        {(() => {
          const ports = getMacroPorts(data);
          const inputs = ports.filter((port) => port.direction === 'input');
          const outputs = ports.filter((port) => port.direction === 'output');
          return (
            <>
              <div className="route-blueprint-port-list inputs">
                {inputs.map((port) => <PortRow key={port.id} nodeId={data.id} port={port} />)}
              </div>
              <div className="route-blueprint-port-list outputs">
                {outputs.map((port) => <PortRow key={port.id} nodeId={data.id} port={port} />)}
              </div>
            </>
          );
        })()}
      </div>
      {!compact && (
        <div className="route-blueprint-node-metrics">
          {Array.isArray(data.__cardMetrics) ? data.__cardMetrics.map((metric) => <span key={metric}>{metric}</span>) : null}
        </div>
      )}
    </div>
  );
  if (!contextMenuBridge) return nodeContent;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{nodeContent}</ContextMenu.Trigger>
      {contextMenuBridge.renderMenu()}
    </ContextMenu.Root>
  );
}

function NodeShell({ data }: NodeProps<RouteFlowNode>) {
  const contextMenuBridge = useContext(RouteGraphContextMenuContext);
  if (isMacroFlowNodeData(data)) return null;
  const ports = getNodePorts(data);
  const inputs = ports.filter((port) => port.direction === 'input');
  const outputs = ports.filter((port) => port.direction === 'output');
  const readonly = data.ownership !== 'manual';
  const compact = data.__compact === true;
  const title = getNodeTitle(data);
  const statusHistory = Array.isArray(data.statusHistory) ? data.statusHistory.slice(0, 8) : [];
  const metrics = Array.isArray(data.__cardMetrics) ? data.__cardMetrics.slice(0, 3).map(String) : [];
  const nodeContent = (
    <div
      className={`route-blueprint-node ${readonly ? 'readonly' : ''} ${compact ? 'compact' : ''} ${data.enabled === false ? 'disabled' : ''}`}
      data-node-id={data.id}
      data-node-type={data.type}
      data-ownership={data.ownership}
      style={routeGraphAccentStyle(ROUTE_GRAPH_VISUAL_COLORS.node[data.type])}
      onContextMenu={(event) => {
        const target = event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>('.route-blueprint-port')
          : null;
        const portId = target?.dataset.portId;
        contextMenuBridge?.onContextMenu(event, portId ? { kind: 'port', nodeId: data.id, portId } : { kind: 'node', nodeId: data.id });
      }}
    >
      <div className="route-blueprint-node-head">
        <span className="route-blueprint-node-icon" aria-hidden="true">
          {data.type === 'dispatcher' ? <GitFork size={13} /> : data.type === 'filter' ? <Workflow size={13} /> : data.type === 'model_endpoint' ? <Boxes size={13} /> : <Layers3 size={13} />}
        </span>
        <div className="route-blueprint-node-head-main">
          <div className="route-blueprint-node-title">{title}</div>
          <div className="route-blueprint-node-subtitle">{getNodeCardSubtitle(data)}</div>
        </div>
        <span className={`route-blueprint-node-state ${data.enabled ? 'online' : 'disabled'}`}>{data.enabled ? 'enabled' : 'disabled'}</span>
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
      {!compact && metrics.length > 0 && (
        <div className="route-blueprint-node-metrics">
          {metrics.map((metric) => <span key={metric}>{metric}</span>)}
        </div>
      )}
      {!compact && statusHistory.length > 0 && (
        <div className="route-blueprint-status-history">
          {statusHistory.map((item, index) => (
            <i key={index} className={String(item)} />
          ))}
        </div>
      )}
    </div>
  );
  if (!contextMenuBridge) return nodeContent;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{nodeContent}</ContextMenu.Trigger>
      {contextMenuBridge.renderMenu()}
    </ContextMenu.Root>
  );
}

function PortRow({ nodeId, node, port }: { nodeId: string; node?: RouteGraphNode; port: RouteGraphPort }) {
  const isInput = port.direction === 'input';
  const displayLabel = getPortDisplayLabel(port);
  const collection = getPortCollectionKind(port);
  const tooltip = getPortTypeSignature(port);
  const modeNote = node ? getPortModeNote(node, port) : null;
  const disabled = port.enabled === false;
  return (
    <div
      className={`route-blueprint-port ${isInput ? 'input' : 'output'} ${port.required ? 'required' : ''} ${disabled ? 'disabled' : ''}`}
      data-port-id={port.id}
      data-kind={port.kind}
      style={routeGraphAccentStyle(ROUTE_GRAPH_VISUAL_COLORS.port[port.kind])}
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
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="route-blueprint-port-label" title={`${nodeId}.${port.id}`}>{displayLabel}</span>
        </Tooltip.Trigger>
        <Tooltip.Content>{tooltip}</Tooltip.Content>
      </Tooltip.Root>
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
}

function RouteGraphEdgeView(props: EdgeProps<RouteFlowEdge>) {
  const contextMenuBridge = useContext(RouteGraphContextMenuContext);
  const edge = props.data;
  const [path] = getBezierPath(props);
  const highlighted = edge?.__highlighted === true;
  const edgeContent = (
    <g onContextMenu={(event) => {
      if (!edge) return;
      contextMenuBridge?.onContextMenu(event, { kind: 'edge', edgeId: edge.id });
    }}>
      <path className="react-flow__edge-path route-blueprint-edge-hit" d={path} data-kind={edge?.kind} />
      <path
        className="react-flow__edge-path route-blueprint-edge"
        d={path}
        data-kind={edge?.kind}
        style={routeGraphAccentStyle(edge ? ROUTE_GRAPH_VISUAL_COLORS.edge[edge.kind] : ROUTE_GRAPH_VISUAL_COLORS.edge.request_flow)}
        strokeWidth={props.selected || highlighted ? 3 : 2}
        strokeDasharray={edge?.ownership === 'auto_generated' || edge?.kind === 'metrics_link' ? '6 5' : undefined}
      />
    </g>
  );
  if (!contextMenuBridge) return edgeContent;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{edgeContent}</ContextMenu.Trigger>
      {contextMenuBridge.renderMenu()}
    </ContextMenu.Root>
  );
}

const flowNodeTypes = {
  entry: NodeShell,
  filter: NodeShell,
  dispatcher: NodeShell,
  model_endpoint: NodeShell,
  synthetic_endpoint: NodeShell,
  auto_node: NodeShell,
  macro: MacroNodeShell,
};
const flowEdgeTypes = { routeGraphEdge: RouteGraphEdgeView };

export default function RouteGraphWorkbench({ mode = 'graph' }: RouteGraphWorkbenchProps) {
  return (
    <ReactFlowProvider>
      <RouteGraphWorkbenchInner mode={mode} />
    </ReactFlowProvider>
  );
}

function RouteGraphWorkbenchInner({ mode = 'graph' }: RouteGraphWorkbenchProps) {
  const toast = useToast();
  const reactFlow = useReactFlow<RouteFlowNode, RouteFlowEdge>();
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const canvasPanelRef = useRef<HTMLDivElement | null>(null);
  const paneContextMenuTriggerRef = useRef<HTMLSpanElement | null>(null);
  const suppressSelectionRef = useRef(false);
  const contextMenuHandledRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [graph, setGraph] = useState<RouteGraphSource>(defaultGraph());
  const graphRef = useRef<RouteGraphSource>(defaultGraph());
  const [undoStack, setUndoStack] = useState<RouteGraphSource[]>([]);
  const [redoStack, setRedoStack] = useState<RouteGraphSource[]>([]);
  const [activeVersion, setActiveVersion] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<RouteGraphDiagnostic[]>([]);
  const [selection, setSelection] = useState<SelectionState>({ kind: 'graph' });
  const [inspectorTarget, setInspectorTarget] = useState<SelectionState>({ kind: 'graph' });
  const [graphSelection, setGraphSelection] = useState<GraphSelectionState>({ nodeIds: [], edgeIds: [] });
  const graphSelectionRef = useRef<GraphSelectionState>({ nodeIds: [], edgeIds: [] });
  const [inspectorAnchor, setInspectorAnchor] = useState<InspectorAnchor | null>(null);
  const [inspectorTab, setInspectorTab] = useState<typeof INSPECTOR_TABS[number]>('Overview');
  const [bottomTab, setBottomTab] = useState<typeof BOTTOM_TABS[number]>('Diagnostics');
  const [viewState, setViewState] = useState<ViewState>(DEFAULT_VIEW_STATE);
  const [jsonText, setJsonText] = useState('');
  const [nodeJsonText, setNodeJsonText] = useState('');
  const [saving, setSaving] = useState(false);
  const [dragTemplateId, setDragTemplateId] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<GraphContextMenuState>({
    x: 0,
    y: 0,
    position: { x: 120, y: 120 },
    target: { kind: 'graph' },
  });
  const inspectorDragRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startClientX: number;
    startClientY: number;
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
  const selectedNode = inspectorNodeId ? graph.nodes.find((node) => node.id === inspectorNodeId) || null : null;
  const selectedPort = selectedNode && inspectorPortId ? getNodePort(selectedNode, inspectorPortId) : null;
  const selectedEdge = inspectorTarget.kind === 'edge' ? graph.edges.find((edge) => edge.id === inspectorTarget.edgeId) || null : null;
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
  const anchorInspectorAtViewportRect = useCallback((rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>) => {
    const container = workbenchRef.current?.getBoundingClientRect();
    if (!container) return;
    const panelWidth = Math.min(440, Math.max(320, container.width - 32));
    const bounds = canvasPanelRef.current?.getBoundingClientRect() || container;
    const gap = 12;
    const side: InspectorAnchor['side'] = window.innerWidth - rect.right >= panelWidth + gap ? 'right' : 'left';
    const preferredX = side === 'right' ? rect.right + gap : rect.left - panelWidth - gap;
    const preferredY = rect.top;
    const minX = bounds.left + 12;
    const maxX = bounds.right - panelWidth - 12;
    const minY = bounds.top + 12;
    const maxY = bounds.bottom - 180;
    setInspectorAnchor({
      x: Math.min(Math.max(preferredX, minX), Math.max(minX, maxX)) - container.left,
      y: Math.min(Math.max(preferredY, minY), Math.max(minY, maxY)) - container.top,
      side,
      mode: 'auto',
    });
  }, []);

  const anchorInspectorAtFlowNode = useCallback((node: RouteGraphNode) => {
    const position = node.position || { x: 120, y: 120 };
    const width = viewState.compactNodes ? 224 : 258;
    const screenPosition = reactFlow.flowToScreenPosition({ x: position.x + width, y: position.y });
    anchorInspectorAtViewportRect({
      left: screenPosition.x - width,
      right: screenPosition.x,
      top: screenPosition.y,
      bottom: screenPosition.y + 96,
    });
  }, [anchorInspectorAtViewportRect, reactFlow, viewState.compactNodes]);

  const anchorInspectorAtMacro = useCallback((macro: RouteGraphMacro) => {
    const position = macro.position || { x: 120, y: 120 };
    const width = viewState.compactNodes ? 180 : 196;
    const screenPosition = reactFlow.flowToScreenPosition({ x: position.x + width, y: position.y });
    anchorInspectorAtViewportRect({
      left: screenPosition.x - width,
      right: screenPosition.x,
      top: screenPosition.y,
      bottom: screenPosition.y + 96,
    });
  }, [anchorInspectorAtViewportRect, reactFlow, viewState.compactNodes]);

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
      const nextGraph = normalizeGraph(response?.draft?.workingGraph || response?.activeVersion?.sourceGraph || defaultGraph());
      setActiveVersion(response?.activeVersion || null);
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
    const visibleGraph = filterGraphForView(graph, viewState);
    const selectedNodeIds = new Set(graphSelectionRef.current.nodeIds);
    const visibleFlowNodes = graphToFlowNodes(visibleGraph, viewState).map((node) => ({ ...node, selected: selectedNodeIds.has(node.id) }));
    setFlowNodes(visibleFlowNodes);
  }, [graph, setFlowNodes, viewState]);

  useEffect(() => {
    applyGraphSelection(graphSelection);
  }, [applyGraphSelection, graphSelection]);

  useEffect(() => {
    const visibleGraph = filterGraphForView(graph, viewState);
    const visibleFlowNodes = graphToFlowNodes(visibleGraph, viewState);
    const visibleFlowEdges = graphToFlowEdges(visibleGraph, new Set());
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
    setFlowEdges(graphToFlowEdges(visibleGraph, highlightedEdgeIds).map((edge) => {
      const selected = selectedEdgeIds.has(edge.id);
      return edge.selected === selected ? edge : { ...edge, selected };
    }));
  }, [graph, graphSelection.edgeIds, selection, setFlowEdges, viewState]);

  useEffect(() => {
    setNodeJsonText(selectedNode ? JSON.stringify(selectedNode, null, 2) : '');
  }, [selectedNode]);

  useEffect(() => {
    if (selectedMacro) setNodeJsonText(JSON.stringify(selectedMacro, null, 2));
  }, [selectedMacro]);

  useEffect(() => {
    if (!selectedNode) return;
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
    applyGraph({
      ...currentGraph,
      macros: currentGraph.macros.map((item) => (item.id === macro.id ? macro : item)),
    });
  }, [applyGraph]);

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
              input: { kind: 'route_ids', routeIds: [] },
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
    inspectorDragRef.current = {
      pointerId: event.pointerId,
      originX: inspectorAnchor.x,
      originY: inspectorAnchor.y,
      startClientX: event.clientX,
      startClientY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [inspectorAnchor]);

  const updateInspectorDrag = useCallback((event: globalThis.PointerEvent) => {
    const drag = inspectorDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const container = workbenchRef.current?.getBoundingClientRect();
    if (!container) return;
    const panelWidth = Math.min(440, Math.max(320, container.width - 32));
    const bounds = canvasPanelRef.current?.getBoundingClientRect() || container;
    const nextX = drag.originX + (event.clientX - drag.startClientX);
    const nextY = drag.originY + (event.clientY - drag.startClientY);
    const minX = bounds.left - container.left + 12;
    const maxX = Math.max(minX, bounds.right - container.left - panelWidth - 12);
    const minY = bounds.top - container.top + 12;
    const maxY = Math.max(minY, bounds.bottom - container.top - 180);
    setInspectorAnchor((current) => current ? {
      ...current,
      x: Math.min(Math.max(nextX, minX), maxX),
      y: Math.min(Math.max(nextY, minY), maxY),
      mode: 'manual',
    } : current);
  }, []);

  const endInspectorDrag = useCallback((event: globalThis.PointerEvent) => {
    const drag = inspectorDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    inspectorDragRef.current = null;
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
    applyGraph(layoutGraph(flowToGraphPositions(graphRef.current, flowNodes)));
    window.requestAnimationFrame(() => reactFlow.fitView({ padding: 0.2, duration: 220 }));
  }, [applyGraph, flowNodes, reactFlow]);

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

  const focusNode = useCallback((nodeId: string) => {
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node) {
      const macro = graph.macros.find((item) => macroFlowNodeId(item.id) === nodeId || item.id === nodeId);
      if (!macro) return;
      const flowNodeId = macroFlowNodeId(macro.id);
      setSelection({ kind: 'macro', macroId: macro.id });
      applyGraphSelection({ nodeIds: [flowNodeId], edgeIds: [] });
      reactFlow.setCenter((macro.position?.x || 120) + 98, (macro.position?.y || 120) + 60, { zoom: reactFlow.getZoom(), duration: 220 });
      return;
    }
    setSelection({ kind: 'node', nodeId });
    applyGraphSelection({ nodeIds: [nodeId], edgeIds: [] });
    reactFlow.setCenter((node.position?.x || 120) + 129, (node.position?.y || 120) + 60, { zoom: reactFlow.getZoom(), duration: 220 });
  }, [applyGraphSelection, graph.macros, graph.nodes, reactFlow]);

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
    const edge = graph.edges.find((item) => direction === 'downstream' ? item.sourceNodeId === nodeId : item.targetNodeId === nodeId);
    const peerNodeId = edge ? (direction === 'downstream' ? edge.targetNodeId : edge.sourceNodeId) : nodeId;
    focusNode(peerNodeId);
  }, [focusNode, graph.edges]);

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
      const node = graph.nodes.find((item) => item.id === nodeId);
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
  }, [anchorInspectorAtFlowNode, anchorInspectorAtMacro, anchorInspectorAtRenderedNode, anchorInspectorAtViewportRect, contextMenu.x, contextMenu.y, graph.macros, graph.nodes]);

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
      toast.error('非 manual 边不能重连');
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

  const persistNodePositions = useCallback(() => {
    applyGraph(flowToGraphPositions(graphRef.current, flowNodes));
  }, [applyGraph, flowNodes]);

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
    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const nextGraphSelection = selectionForContextMenu({
      current: graphSelectionRef.current,
      target,
    });
    if (nextGraphSelection !== graphSelectionRef.current) applyGraphSelection(nextGraphSelection);
    setContextMenu((current) => ({
      ...current,
      x: event.clientX,
      y: event.clientY,
      position,
      target,
    }));
    setSelection(target);
    if (target.kind === 'graph') {
      setInspectorAnchor(null);
    }
  }, [applyGraphSelection, reactFlow]);

  const openPaneContextMenu = useCallback((event: MouseEvent | globalThis.MouseEvent) => {
    event.preventDefault();
    prepareGraphContextMenu(event, { kind: 'graph' });
    const trigger = paneContextMenuTriggerRef.current;
    if (!trigger) return;
    trigger.style.left = `${event.clientX}px`;
    trigger.style.top = `${event.clientY}px`;
    trigger.dispatchEvent(new globalThis.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      button: 2,
      buttons: 2,
      view: window,
    }));
  }, [prepareGraphContextMenu]);

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
    if (result?.ok) toast.success('图校验通过');
    else toast.error('图校验存在阻塞项');
    setBottomTab('Diagnostics');
    return result;
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      const positioned = flowToGraphPositions(graph, flowNodes);
      const response = await api.saveRouteGraphDraft(positioned) as any;
      const nextGraph = normalizeGraph(response?.draft?.workingGraph || positioned);
      setDiagnostics(response?.draft?.diagnostics || []);
      applyGraph(nextGraph);
      toast.success('草稿已保存');
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    await saveDraft();
    const response = await api.publishRouteGraphDraft() as any;
    if (response?.success) {
      toast.success('路由图已发布');
      await refresh();
    }
  };

  const applyWholeJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      applyGraph(normalizeGraph(parsed));
      toast.success('JSON 已应用到草稿视图');
    } catch (error) {
      toast.error(`JSON 解析失败: ${(error as Error).message}`);
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

  const applyNodeJson = () => {
    try {
      if (selectedMacro) {
        const parsed = normalizeGraph({ ...graph, macros: [JSON.parse(nodeJsonText)] }).macros[0];
        if (!parsed) {
          toast.error('Macro JSON 必须包含 id/kind');
          return;
        }
        if (parsed.ownership !== 'manual') {
          toast.error('不能把 macro JSON 改成非 manual 所有权');
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
          toast.error('不能把节点 JSON 改成非 manual 所有权');
          return;
        }
        applyGraph(updateNode(graph, parsed));
        setSelection({ kind: 'node', nodeId: parsed.id });
        anchorInspectorAtFlowNode(parsed);
      }
    } catch (error) {
      toast.error(`节点 JSON 解析失败: ${(error as Error).message}`);
    }
  };

  const publicEntries = getPublicEntryNodes(graph);
  const errorCount = diagnostics.filter((item) => item.severity === 'error').length;
  const warningCount = diagnostics.filter((item) => item.severity === 'warning').length;
  const contextMenuNode = (
    <RouteGraphContextMenu
      target={contextMenu.target}
      graph={graph}
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
      onContextMenu={(event) => {
        if (event.defaultPrevented || contextMenuHandledRef.current) return;
        openPaneContextMenu(event);
      }}
    >
      {loading ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading route graph...</div>
      ) : (
        <RouteGraphContextMenuContext.Provider value={{
          target: contextMenu.target,
          onContextMenu: prepareGraphContextMenu,
          renderMenu: () => contextMenuNode,
        }}>
        <ReactFlow<RouteFlowNode, RouteFlowEdge>
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={flowNodeTypes}
          edgeTypes={flowEdgeTypes}
          onNodesChange={onNodesChange}
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
            const nextSelection = selectionFromFlowSelection({ nodeIds, edgeIds });
            if (nextSelection) {
              setSelection((current) => JSON.stringify(current) === JSON.stringify(nextSelection) ? current : nextSelection);
            }
          }}
          onConnect={onConnect}
          onReconnect={onReconnect}
          isValidConnection={isValidConnection}
          onNodeDragStop={persistNodePositions}
          onNodeClick={(event, node) => {
            const multiIntent = event.shiftKey || event.ctrlKey || event.metaKey;
            const nextSelection = selectionFromFlowNodeId(node.id);
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
          onNodeContextMenu={(event, node) => prepareGraphContextMenu(event, selectionFromFlowNodeId(node.id))}
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
          onEdgeContextMenu={(event, edge) => prepareGraphContextMenu(event, { kind: 'edge', edgeId: edge.id })}
          onPaneClick={() => {
            clearGraphSelection();
          }}
          onPaneContextMenu={openPaneContextMenu}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          selectionKeyCode="Shift"
          selectionOnDrag
          panOnDrag={[1, 2]}
          fitView
        >
          <Background gap={22} />
          <Controls />
          <MiniMap pannable zoomable nodeStrokeWidth={2} />
          <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
              <span
                ref={paneContextMenuTriggerRef}
                aria-hidden="true"
                className="absolute left-0 top-0 h-px w-px opacity-0 pointer-events-none"
              />
            </ContextMenu.Trigger>
            {contextMenuNode}
          </ContextMenu.Root>
          {dragTemplateId && (
            <Panel position="top-center" className="rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
              Drop to create node
            </Panel>
          )}
          <Panel position="top-left" className="inline-flex max-w-40 items-center gap-2 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
            <Workflow size={14} />
            <span className="truncate font-medium">
              {graphSelection.nodeIds.length + graphSelection.edgeIds.length > 1
                ? `${graphSelection.nodeIds.length + graphSelection.edgeIds.length} selected`
                : selection.kind === 'node'
                  ? selection.nodeId
                  : selection.kind === 'edge'
                    ? selection.edgeId
                    : 'Route Graph'}
            </span>
          </Panel>
          <Panel position="top-right">
            <ButtonGroup>
              <Button type="button" variant="secondary" size="sm" onClick={() => setCommandOpen(true)} title="Command palette">
                <CommandIcon size={13} />
                Command
              </Button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    <Plus size={13} />
                    Add
                    <ChevronDown size={13} />
                  </Button>
                </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Label>Quick Add</DropdownMenu.Label>
                {quickTemplates.map((template) => (
                  <DropdownMenu.Item key={template.id} onSelect={() => addTemplateById(template.id)}>
                    {template.title}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={addModelGroupMacro}>
                  <Sparkles size={13} />
                  Add macro
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => setCommandOpen(true)}>
                  Search all nodes
                  <DropdownMenu.Shortcut>⌘K</DropdownMenu.Shortcut>
                </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
              <Button type="button" variant="outline" size="sm" onClick={autoLayout} title="Auto layout">
                <Wand2 size={13} />
                Layout
              </Button>
            </ButtonGroup>
          </Panel>
        </ReactFlow>
        </RouteGraphContextMenuContext.Provider>
      )}
    </main>
  );

  if (mode === 'json') {
    return (
      <Card className="route-graph-advanced-json">
        <CardHeader className="route-graph-advanced-head">
          <div>
            <CardTitle>Advanced JSON</CardTitle>
            <CardDescription>Whole graph import, export, validation, and draft edits.</CardDescription>
          </div>
          <ButtonGroup>
            <Button variant="outline" size="sm" type="button" onClick={() => setJsonText(JSON.stringify(graph, null, 2))}>Format</Button>
            <Button variant="outline" size="sm" type="button" onClick={() => navigator.clipboard?.writeText(jsonText)}>Copy</Button>
            <Button variant="outline" size="sm" type="button" onClick={exportWholeJson}>Export</Button>
            <Button variant="secondary" size="sm" type="button" onClick={applyWholeJson}>Apply JSON</Button>
            <Button size="sm" type="button" disabled={saving} onClick={saveDraft}>Save Draft</Button>
            <Button size="sm" type="button" disabled={saving || errorCount > 0} onClick={publish}>Publish</Button>
          </ButtonGroup>
        </CardHeader>
        <Textarea className="font-mono text-xs" value={jsonText} onChange={(event) => setJsonText(event.target.value)} />
      </Card>
    );
  }

  return (
    <Tooltip.Provider>
    <div ref={workbenchRef} className="route-graph-workbench relative grid min-h-0 gap-3">
      <header className="route-graph-toolbar flex min-w-0 items-center justify-between gap-3 rounded-lg border bg-card p-3 text-card-foreground">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Route Graph</div>
          <div className="truncate text-xs text-muted-foreground">
            active v{activeVersion?.version ?? '-'} · {graph.nodes.length} nodes · {graph.edges.length} edges · {graph.macros.length} macros · {publicEntries.length} public
          </div>
        </div>
        <div className="route-graph-toolbar-status flex items-center gap-1.5">
          <Badge variant={errorCount > 0 ? 'destructive' : 'success'}>{errorCount > 0 ? `${errorCount} errors` : 'Validatable'}</Badge>
          {warningCount > 0 && <Badge variant="warning">{warningCount} warnings</Badge>}
        </div>
        <ButtonGroup className="route-graph-toolbar-actions">
          <Button variant="outline" size="sm" type="button" disabled={undoStack.length === 0} onClick={undo}>Undo</Button>
          <Button variant="outline" size="sm" type="button" disabled={redoStack.length === 0} onClick={redo}>Redo</Button>
          <Button variant="outline" size="sm" type="button" onClick={autoLayout}>Auto Layout</Button>
          <Button variant="outline" size="sm" type="button" onClick={validate}>Validate</Button>
          <Button size="sm" type="button" disabled={saving} onClick={saveDraft}>Save Draft</Button>
          <Button size="sm" type="button" disabled={saving || errorCount > 0} onClick={publish}>Publish</Button>
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
              <div ref={canvasPanelRef} className="h-full min-h-0">
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
                      <BottomPanel tab={tab} graph={graph} diagnostics={diagnostics} onSelectNode={(nodeId) => setSelection({ kind: 'node', nodeId })} />
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
          <div className="text-sm font-medium">{graphSelection.nodeIds.length + graphSelection.edgeIds.length} selected</div>
          <div className="text-xs text-muted-foreground">{graphSelection.nodeIds.length} nodes · {graphSelection.edgeIds.length} edges</div>
          <ButtonGroup>
            <Button type="button" variant="destructive" size="sm" onClick={deleteSelected}>Delete selected</Button>
          </ButtonGroup>
        </aside>
      )}

      {(selectedNode || selectedEdge || selectedMacro) && inspectorAnchor && (
        <aside
          className="absolute z-[80] flex w-[min(440px,calc(100%-2rem))] min-w-0 flex-col overflow-y-auto rounded-lg border bg-background text-foreground shadow-lg"
          style={{
            left: inspectorAnchor.x,
            top: inspectorAnchor.y,
            height: `min(560px, calc(100% - ${inspectorAnchor.y}px - 12px))`,
            maxHeight: `min(560px, calc(100% - ${inspectorAnchor.y}px - 12px))`,
          }}
          data-side={inspectorAnchor.side}
          aria-label="Route graph inspector"
        >
          <div className="route-graph-inspector-controls">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="route-graph-inspector-drag-handle"
              aria-label="Move inspector"
              onPointerDown={beginInspectorDrag}
            >
              <span />
              <span />
              <span />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="route-graph-inspector-close"
              aria-label="Close inspector"
              onClick={clearGraphSelection}
            >
              <X size={15} />
            </Button>
          </div>
          <div className="route-graph-inspector-scroll min-h-0 flex-1">
            <Inspector
              graph={graph}
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
              onChangeNode={(node) => applyGraph(updateNode(graph, node))}
              onChangeMacro={updateMacro}
              onAddMacroGroup={addMacroGroup}
              onSelectNode={(nodeId) => setSelection({ kind: 'node', nodeId })}
              onCopyText={copyText}
              onDuplicateNode={duplicateNode}
              onFocusNode={focusNode}
              onSelectConnectedPath={selectConnectedPath}
              onToggleNodeEnabled={toggleNodeEnabled}
            />
          </div>
        </aside>
      )}

      <Command.CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <Command.Command className="route-graph-command-shell">
          <Command.CommandInput placeholder="Search nodes or actions..." />
          <Command.CommandList>
            <Command.CommandEmpty>No results.</Command.CommandEmpty>
            <Command.CommandGroup heading="Actions">
              <Command.CommandItem onSelect={() => { autoLayout(); setCommandOpen(false); }}>
                Auto Layout
                <Command.CommandShortcut>⌘L</Command.CommandShortcut>
              </Command.CommandItem>
              <Command.CommandItem onSelect={() => { validate(); setCommandOpen(false); }}>
                Validate graph
                <Command.CommandShortcut>⌘⇧V</Command.CommandShortcut>
              </Command.CommandItem>
              <Command.CommandItem onSelect={() => { saveDraft(); setCommandOpen(false); }}>
                Save draft
                <Command.CommandShortcut>⌘S</Command.CommandShortcut>
              </Command.CommandItem>
            </Command.CommandGroup>
            <Command.CommandSeparator />
            <Command.CommandGroup heading="Quick add">
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
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search nodes..." />
      </div>
      <Tabs.Tabs value={category} onValueChange={(value) => setCategory(value as typeof category)}>
        <Tabs.TabsList className="flex w-full overflow-x-auto">
          {(['All', 'Core', 'Transform', 'Fallback', 'Primitive'] as const).map((item) => (
            <Tabs.TabsTrigger key={item} value={item} className="shrink-0">{item}</Tabs.TabsTrigger>
          ))}
        </Tabs.TabsList>
      </Tabs.Tabs>

      {coreTemplates.length > 0 && (
        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <div className="text-xs font-semibold text-muted-foreground">Core Flow</div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">{coreTemplates.map(renderTemplate)}</div>
        </section>
      )}
      {transformTemplates.length > 0 && (
        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <div className="text-xs font-semibold text-muted-foreground">Request Mutations</div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">{transformTemplates.map(renderTemplate)}</div>
        </section>
      )}
      {fallbackTemplates.length > 0 && (
        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <div className="text-xs font-semibold text-muted-foreground">Fallbacks</div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">{fallbackTemplates.map(renderTemplate)}</div>
        </section>
      )}
      {primitiveNodeTypes.length > 0 && (
        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <div className="text-xs font-semibold text-muted-foreground">Primitive Nodes</div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">{primitiveNodeTypes.map(renderPrimitiveNode)}</div>
        </section>
      )}
      <div className="route-graph-template-hint">
        Use node handles to connect ports. Right click canvas, nodes, or edges for contextual actions.
      </div>
    </div>
    </ScrollArea>
  );
}

function ModelsPanel({ nodes, onSelect }: { nodes: RouteGraphNode[]; onSelect: (nodeId: string) => void }) {
  return (
    <ScrollArea className="route-graph-sidebar-scroll h-full min-h-0">
    <div className="grid gap-2 p-3">
      {nodes.length === 0 ? <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No public entries.</div> : nodes.map((node) => {
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

function getMacroDisplayName(macro: RouteGraphMacro): string {
  const config = getMacroConfig(macro);
  const surface = config.surface && typeof config.surface === 'object' ? config.surface as Record<string, any> : {};
  const entry = surface.entry && typeof surface.entry === 'object' ? surface.entry as Record<string, any> : {};
  const match = entry.match && typeof entry.match === 'object' ? entry.match as Record<string, any> : {};
  return String(match.displayName || macro.name || macro.id);
}

function getMacroGroups(macro: RouteGraphMacro): Array<Record<string, any>> {
  const groups = getMacroConfig(macro).groups;
  return Array.isArray(groups) ? groups : [];
}

function getMacroRouteIds(macro: RouteGraphMacro): number[] {
  const routeIds: number[] = [];
  for (const group of getMacroGroups(macro)) {
    const input = group.input && typeof group.input === 'object' ? group.input as Record<string, any> : {};
    if (input.kind !== 'route_ids' || !Array.isArray(input.routeIds)) continue;
    for (const rawRouteId of input.routeIds) {
      const routeId = Number(rawRouteId);
      if (Number.isFinite(routeId) && routeId > 0 && !routeIds.includes(Math.trunc(routeId))) {
        routeIds.push(Math.trunc(routeId));
      }
    }
  }
  return routeIds;
}

function getMacroStrategy(macro: RouteGraphMacro): string {
  const policy = getMacroConfig(macro).policy;
  return String(policy && typeof policy === 'object' && 'strategy' in policy ? (policy as any).strategy : 'priority_order');
}

function MacrosPanel({ macros, onSelect, onAdd }: { macros: RouteGraphMacro[]; onSelect: (macroId: string) => void; onAdd: () => void }) {
  const sortedMacros = [...macros].sort((left, right) => getMacroDisplayName(left).localeCompare(getMacroDisplayName(right)));
  return (
    <ScrollArea className="route-graph-sidebar-scroll h-full min-h-0">
      <div className="grid gap-2 p-3">
        <Button type="button" variant="secondary" className="justify-start gap-2" onClick={onAdd}>
          <Plus size={14} />
          Add Model Group macro
        </Button>
        {sortedMacros.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No semantic macros.</div>
        ) : sortedMacros.map((macro) => {
          const routeIds = getMacroRouteIds(macro);
          return (
            <Button key={macro.id} type="button" variant="outline" className="h-auto min-w-0 justify-start gap-2 p-3 text-left" onClick={() => onSelect(macro.id)}>
              <Sparkles className="size-4 shrink-0 text-muted-foreground" />
              <span className="grid min-w-0 gap-1">
                <span className="flex min-w-0 items-center gap-2">
                  <strong className="truncate text-sm font-medium">{getMacroDisplayName(macro)}</strong>
                  <Badge variant={macro.enabled ? 'secondary' : 'outline'}>{macro.enabled ? 'enabled' : 'disabled'}</Badge>
                </span>
                <small className="truncate text-xs text-muted-foreground">
                  {macro.kind} · {macro.visibility} · {getMacroStrategy(macro)} · {routeIds.length} routes
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
        <span>Show internal nodes</span>
        <Switch checked={value.showInternal} onCheckedChange={(checked) => update({ showInternal: checked })} />
      </label>
      <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
        <span>Show generated nodes</span>
        <Switch checked={value.showGenerated} onCheckedChange={(checked) => update({ showGenerated: checked })} />
      </label>
      <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
        <span>Compact nodes</span>
        <Switch checked={value.compactNodes} onCheckedChange={(checked) => update({ compactNodes: checked })} />
      </label>
      <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
        <span>Highlight selected path</span>
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
            <div className="text-sm font-semibold">Graph Tools</div>
            <div className="truncate text-xs text-muted-foreground">Library, entries, outline, and display state.</div>
          </div>
          <Tabs.TabsList className="grid w-full grid-cols-5" aria-label="Route graph tools">
            <Tabs.TabsTrigger value="library" title="Library" className="gap-1 px-2">
              <Plus size={15} />
              <span className="hidden xl:inline">Library</span>
            </Tabs.TabsTrigger>
            <Tabs.TabsTrigger value="models" title="Models" className="gap-1 px-2">
              <Layers3 size={15} />
              <span className="hidden xl:inline">Models</span>
            </Tabs.TabsTrigger>
            <Tabs.TabsTrigger value="macros" title="Macros" className="gap-1 px-2">
              <Sparkles size={15} />
              <span className="hidden xl:inline">Macros</span>
            </Tabs.TabsTrigger>
            <Tabs.TabsTrigger value="outline" title="Outline" className="gap-1 px-2">
              <ListTree size={15} />
              <span className="hidden xl:inline">Outline</span>
            </Tabs.TabsTrigger>
            <Tabs.TabsTrigger value="view" title="View" className="gap-1 px-2">
              <Eye size={15} />
              <span className="hidden xl:inline">View</span>
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
          <Tabs.TabsContent value="macros" className="h-full min-h-0 overflow-hidden"><MacrosPanel macros={macros} onSelect={onSelectMacro} onAdd={onAddModelGroupMacro} /></Tabs.TabsContent>
          <Tabs.TabsContent value="outline" className="h-full min-h-0 overflow-hidden"><NodesPanel nodes={nodes} onSelect={onSelect} /></Tabs.TabsContent>
          <Tabs.TabsContent value="view" className="h-full min-h-0 overflow-hidden"><ViewsPanel value={viewState} onChange={onChangeView} /></Tabs.TabsContent>
        </div>
      </Tabs.Tabs>
    </aside>
  );
}

function setModeToJsonUnavailableToast(toast: ReturnType<typeof useToast>) {
  toast.error('Use the Advanced JSON tab for whole-graph JSON edits');
}

function RouteGraphContextMenu({
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
  onToggleNodeEnabled,
  onSelectConnectedPath,
  onDisconnectPort,
  selectedCount,
}: {
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
  onToggleNodeEnabled: (nodeId: string) => void;
  onSelectConnectedPath: (nodeId: string, direction: 'upstream' | 'downstream') => void;
  onDisconnectPort: (nodeId: string, portId: string) => void;
  selectedCount: number;
}) {
  const nodeId = getSelectionNodeId(target);
  const portId = getSelectionPortId(target);
  const node = nodeId ? graph.nodes.find((item) => item.id === nodeId) || null : null;
  const macro = target.kind === 'macro' ? graph.macros.find((item) => item.id === target.macroId) || null : nodeId?.startsWith('macro:') ? graph.macros.find((item) => macroFlowNodeId(item.id) === nodeId) || null : null;
  const edge = target.kind === 'edge' ? graph.edges.find((item) => item.id === target.edgeId) || null : null;
  const port = node && portId ? getNodePort(node, portId) : macro && portId ? getMacroPort(macro, portId) : null;
  const readonlyNode = (!node && !macro) || (node ? node.ownership !== 'manual' : macro?.ownership !== 'manual');
  const readonlyEdge = !edge || edge.ownership !== 'manual';
  const coreTemplates = templates.filter((template) => template.category === 'Core');
  const transformTemplates = templates.filter((template) => template.category === 'Transform');
  const fallbackTemplates = templates.filter((template) => template.category === 'Fallback');

  return (
    <ContextMenu.Content className="min-w-56" onCloseAutoFocus={(event) => event.preventDefault()}>
      {target.kind === 'graph' && (
        <>
          <ContextMenu.Label>Canvas</ContextMenu.Label>
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger><Plus size={14} />Add node</ContextMenu.SubTrigger>
          <ContextMenu.SubContent className="min-w-56">
              {(templateById.get('entry') || coreTemplates[0]) && <ContextMenu.Item onSelect={() => onAddTemplate(templateById.get('entry') || coreTemplates[0]!)}>Entry</ContextMenu.Item>}
              {(templateById.get('dispatcher-route') || coreTemplates[1]) && <ContextMenu.Item onSelect={() => onAddTemplate(templateById.get('dispatcher-route') || coreTemplates[1]!)}>Dispatcher</ContextMenu.Item>}
              {coreTemplates.map((template) => (
                <ContextMenu.Item key={template.id} onSelect={() => onAddTemplate(template)}>{template.title}</ContextMenu.Item>
              ))}
            </ContextMenu.SubContent>
          </ContextMenu.Sub>
          <ContextMenu.Item onSelect={onAddMacro}><Sparkles size={14} />Add macro</ContextMenu.Item>
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger><Sparkles size={14} />Add transform</ContextMenu.SubTrigger>
            <ContextMenu.SubContent className="min-w-56">
              {transformTemplates.map((template) => (
                <ContextMenu.Item key={template.id} onSelect={() => onAddTemplate(template)}>{template.title}</ContextMenu.Item>
              ))}
            </ContextMenu.SubContent>
          </ContextMenu.Sub>
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger><Trash2 size={14} />Add fallback</ContextMenu.SubTrigger>
            <ContextMenu.SubContent className="min-w-56">
              {fallbackTemplates.map((template) => (
                <ContextMenu.Item key={template.id} onSelect={() => onAddTemplate(template)}>{template.title}</ContextMenu.Item>
              ))}
            </ContextMenu.SubContent>
          </ContextMenu.Sub>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={onFitView}><Crosshair size={14} />Fit view</ContextMenu.Item>
          <ContextMenu.Item onSelect={onAutoLayout}><Wand2 size={14} />Auto layout</ContextMenu.Item>
          <ContextMenu.Item onSelect={onValidate}><Check size={14} />Validate graph</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={onOpenCommand}><CommandIcon size={14} />Command palette<ContextMenu.Shortcut>⌘K</ContextMenu.Shortcut></ContextMenu.Item>
          <ContextMenu.Item onSelect={onOpenJson}><Copy size={14} />Advanced JSON</ContextMenu.Item>
          {selectedCount > 1 && (
            <>
              <ContextMenu.Separator />
              <ContextMenu.Item variant="destructive" onSelect={onDelete}><Trash2 size={14} />Delete selected ({selectedCount})</ContextMenu.Item>
            </>
          )}
        </>
      )}

      {(target.kind === 'node' && node && !nodeId?.startsWith('macro:')) && (
        <>
          <ContextMenu.Label>{getNodeTitle(node)}</ContextMenu.Label>
          <ContextMenu.Item onSelect={() => onOpenInspector(target, 'Overview')}><MousePointer2 size={14} />Inspect overview</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onOpenInspector(target, 'Config')}><Settings2 size={14} />Edit config</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onOpenInspector(target, 'Ports')}><Link2 size={14} />Edit ports</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onOpenInspector(target, 'JSON')}><Copy size={14} />Edit JSON</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger><Plus size={14} />Insert after</ContextMenu.SubTrigger>
            <ContextMenu.SubContent className="min-w-56">
              {templates.map((template) => (
                <ContextMenu.Item key={template.id} onSelect={() => onInsertTemplate(template)}>{template.title}</ContextMenu.Item>
              ))}
            </ContextMenu.SubContent>
          </ContextMenu.Sub>
          <ContextMenu.Item disabled={readonlyNode} onSelect={() => onToggleNodeEnabled(node.id)}><Power size={14} />{node.enabled ? 'Disable node' : 'Enable node'}</ContextMenu.Item>
          <ContextMenu.Item disabled={readonlyNode} onSelect={() => onDuplicateNode(node.id)}><Copy size={14} />Duplicate node</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={() => onFocusNode(node.id)}><Crosshair size={14} />Focus node</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onSelectConnectedPath(node.id, 'upstream')}>Select upstream</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onSelectConnectedPath(node.id, 'downstream')}>Select downstream</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={() => onCopyText(node.id, 'Node ID')}>Copy node ID</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onCopyText(JSON.stringify(node, null, 2), 'Node JSON')}>Copy node JSON</ContextMenu.Item>
          <ContextMenu.Separator />
          {selectedCount > 1 ? (
            <ContextMenu.Item variant="destructive" disabled={readonlyNode} onSelect={onDelete}><Trash2 size={14} />Delete selected ({selectedCount})</ContextMenu.Item>
          ) : (
            <ContextMenu.Item variant="destructive" disabled={readonlyNode} onSelect={onDelete}><Trash2 size={14} />Delete node</ContextMenu.Item>
          )}
        </>
      )}

      {(target.kind === 'macro' || nodeId?.startsWith('macro:')) && macro && (
        <>
          <ContextMenu.Label>{getMacroDisplayName(macro)}</ContextMenu.Label>
          <ContextMenu.Item onSelect={() => onOpenInspector({ kind: 'macro', macroId: macro.id }, 'Overview')}><MousePointer2 size={14} />Inspect macro</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onOpenInspector({ kind: 'macro', macroId: macro.id }, 'Config')}><Settings2 size={14} />Edit macro</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onCopyText(macro.id, 'Macro ID')}>Copy macro ID</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onCopyText(JSON.stringify(macro, null, 2), 'Macro JSON')}>Copy macro JSON</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" disabled={readonlyNode} onSelect={onDelete}><Trash2 size={14} />Delete macro</ContextMenu.Item>
        </>
      )}

      {target.kind === 'edge' && edge && (
        <>
          <ContextMenu.Label>{edge.kind}</ContextMenu.Label>
          <ContextMenu.Item onSelect={() => onOpenInspector(target, 'Overview')}><MousePointer2 size={14} />Inspect edge</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onFocusNode(edge.sourceNodeId)}>Select source</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onFocusNode(edge.targetNodeId)}>Select target</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={() => onCopyText(JSON.stringify(edge, null, 2), 'Edge JSON')}>Copy edge JSON</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onCopyText(`${edge.sourceNodeId}.${edge.sourcePortId}`, 'Source ref')}>Copy source ref</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onCopyText(`${edge.targetNodeId}.${edge.targetPortId}`, 'Target ref')}>Copy target ref</ContextMenu.Item>
          <ContextMenu.Separator />
          {selectedCount > 1 ? (
            <ContextMenu.Item variant="destructive" disabled={readonlyEdge} onSelect={onDelete}><Trash2 size={14} />Delete selected ({selectedCount})</ContextMenu.Item>
          ) : (
            <ContextMenu.Item variant="destructive" disabled={readonlyEdge} onSelect={onDelete}><Trash2 size={14} />Delete edge</ContextMenu.Item>
          )}
        </>
      )}

      {target.kind === 'port' && port && (
        <>
          <ContextMenu.Label>{port.label}</ContextMenu.Label>
          <ContextMenu.Item onSelect={() => onOpenInspector(node ? target : { kind: 'macro', macroId: macro!.id }, node ? 'Ports' : 'Config')}><MousePointer2 size={14} />Inspect port</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onOpenInspector(node ? { kind: 'node', nodeId: node.id } : { kind: 'macro', macroId: macro!.id }, 'Config')}><Settings2 size={14} />Edit config</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={() => onCopyText(`${node?.id || macroFlowNodeId(macro!.id)}.${port.id}`, 'Port ref')}>Copy port ref</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => onCopyText(getPortTypeSignature(port), 'Port signature')}>Copy signature</ContextMenu.Item>
          <ContextMenu.Item disabled={readonlyNode} onSelect={() => onDisconnectPort(node?.id || macroFlowNodeId(macro!.id), port.id)}>Disconnect all</ContextMenu.Item>
        </>
      )}
    </ContextMenu.Content>
  );
}

function Inspector({
  graph,
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
  onSelectNode,
  onCopyText,
  onDuplicateNode,
  onFocusNode,
  onSelectConnectedPath,
  onToggleNodeEnabled,
}: {
  graph: RouteGraphSource;
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
  onSelectNode: (nodeId: string) => void;
  onCopyText: (text: string, label: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onFocusNode: (nodeId: string) => void;
  onSelectConnectedPath: (nodeId: string, direction: 'upstream' | 'downstream') => void;
  onToggleNodeEnabled: (nodeId: string) => void;
}) {
  if (selectedMacro) {
    const readonly = selectedMacro.ownership !== 'manual';
    const routeIds = getMacroRouteIds(selectedMacro);
    return (
      <div className="route-graph-inspector-content">
        <InspectorHeader
          icon={<Sparkles size={15} />}
          kicker="Macro"
          title={getMacroDisplayName(selectedMacro)}
          subtitle={`${selectedMacro.kind} · ${selectedMacro.visibility} · ${selectedMacro.ownership}`}
          action={(
            <ButtonGroup>
              <Button type="button" variant="outline" size="sm" onClick={() => onCopyText(selectedMacro.id, 'Macro ID')}>Copy ID</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onCopyText(JSON.stringify(selectedMacro, null, 2), 'Macro JSON')}>Copy JSON</Button>
              <Button type="button" variant="destructive" size="sm" disabled={readonly} onClick={onDelete}>Delete</Button>
            </ButtonGroup>
          )}
        />
        <Tabs.Tabs value={inspectorTab} onValueChange={(value) => setInspectorTab(value as typeof inspectorTab)} className="route-graph-inspector-tabs">
          <Tabs.TabsList className="route-graph-inspector-tablist">
            <Tabs.TabsTrigger value="Overview">Overview</Tabs.TabsTrigger>
            <Tabs.TabsTrigger value="Config">Config</Tabs.TabsTrigger>
            <Tabs.TabsTrigger value="JSON">JSON</Tabs.TabsTrigger>
          </Tabs.TabsList>
          <Tabs.TabsContent value="Overview">
            <div className="route-graph-inspector-summary">
              <span>Kind<b>{selectedMacro.kind}</b></span>
              <span>Strategy<b>{getMacroStrategy(selectedMacro)}</b></span>
              <span>Groups<b>{getMacroGroups(selectedMacro).length}</b></span>
              <span>Routes<b>{routeIds.length}</b></span>
            </div>
            <div className="route-graph-panel-stack">
              <div className="text-sm font-medium">Priority Bands</div>
              {getMacroGroups(selectedMacro).map((group, index) => (
                <div key={String(group.id || index)} className="route-graph-port-inspector-row">
                  <strong>{String(group.label || group.id || `group:${index}`)}</strong>
                  <small>priority {Number.isFinite(Number(group.priority)) ? Math.trunc(Number(group.priority)) : index}</small>
                  <small>{Array.isArray(group.input?.routeIds) ? group.input.routeIds.join(', ') : String(group.input?.kind || 'unknown')}</small>
                </div>
              ))}
            </div>
          </Tabs.TabsContent>
          <Tabs.TabsContent value="Config">
            <MacroForm macro={selectedMacro} readonly={readonly} onChange={onChangeMacro} onAddGroup={() => onAddMacroGroup(selectedMacro.id)} />
          </Tabs.TabsContent>
          <Tabs.TabsContent value="JSON">
            <Textarea className="font-mono text-xs" value={nodeJsonText} onChange={(event) => setNodeJsonText(event.target.value)} />
            <ButtonGroup>
              <Button type="button" disabled={readonly} onClick={onApplyNodeJson}>Apply Macro JSON</Button>
              <Button type="button" variant="outline" onClick={() => setNodeJsonText(JSON.stringify(selectedMacro, null, 2))}>Format</Button>
              <Button type="button" variant="outline" onClick={() => onCopyText(nodeJsonText, 'Macro JSON')}>Copy</Button>
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
          kicker="Selected Edge"
          title={selectedEdge.kind}
          subtitle={`${selectedEdge.sourceNodeId}.${selectedEdge.sourcePortId} -> ${selectedEdge.targetNodeId}.${selectedEdge.targetPortId}`}
          action={(
            <ButtonGroup>
              <Button type="button" variant="outline" size="sm" onClick={() => onSelectNode(selectedEdge.sourceNodeId)}>Source</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onSelectNode(selectedEdge.targetNodeId)}>Target</Button>
              <Button type="button" variant="destructive" size="sm" disabled={selectedEdge.ownership !== 'manual'} onClick={onDelete}>
                <Trash2 size={13} />
                Delete
              </Button>
            </ButtonGroup>
          )}
        />
        <div className="route-graph-inspector-summary">
          <span>Kind<b>{selectedEdge.kind}</b></span>
          <span>Ownership<b>{selectedEdge.ownership}</b></span>
          <span>Source<b>{selectedEdge.sourceNodeId}.{selectedEdge.sourcePortId}</b></span>
          <span>Target<b>{selectedEdge.targetNodeId}.{selectedEdge.targetPortId}</b></span>
        </div>
        <div className="route-graph-inspector-section">
          <div className="text-sm font-medium">Actions</div>
          <ButtonGroup>
            <Button type="button" variant="outline" size="sm" onClick={() => onCopyText(`${selectedEdge.sourceNodeId}.${selectedEdge.sourcePortId}`, 'Source ref')}>Copy source</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onCopyText(`${selectedEdge.targetNodeId}.${selectedEdge.targetPortId}`, 'Target ref')}>Copy target</Button>
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
          kicker="Graph"
          title="Route Summary"
          subtitle="Select a node or edge to edit its local contract."
        />
        <div className="route-graph-fact-grid">
          {getGraphFacts(graph).map((fact) => (
            <span key={fact.label}>{fact.label}<b>{fact.value}</b></span>
          ))}
        </div>
        <div className="route-graph-inspector-empty">
          <ListTree size={16} />
          <span>Select a node or edge to edit it. Use the left rail to add nodes or drag from the library.</span>
        </div>
      </div>
    );
  }

  const readonly = selectedNode.ownership !== 'manual';
  const selectedPortSummary = selectedPort ? `${selectedPort.direction} · ${getPortSummary(selectedPort)}` : '';
  const nodeConnections = selectedNode ? getNodeConnections(graph, selectedNode.id) : [];
  const hasUpstream = nodeConnections.some(({ direction }) => direction === 'inbound');
  const hasDownstream = nodeConnections.some(({ direction }) => direction === 'outbound');
  return (
    <div className="route-graph-inspector-content">
      <InspectorHeader
        icon={<Boxes size={15} />}
        kicker="Node"
        title={getNodeTitle(selectedNode)}
        subtitle={selectedPort ? `${getNodeSubtitle(selectedNode)} · ${selectedPort.id}` : getNodeSubtitle(selectedNode)}
        action={<ButtonGroup><Button type="button" variant="outline" size="sm" onClick={() => onFocusNode(selectedNode.id)}>Focus</Button><Button type="button" variant="outline" size="sm" disabled={readonly} onClick={() => onDuplicateNode(selectedNode.id)}>Duplicate</Button><Button type="button" variant="destructive" size="sm" disabled={readonly} onClick={onDelete}>Delete</Button></ButtonGroup>}
      />
      <Tabs.Tabs value={inspectorTab} onValueChange={(value) => setInspectorTab(value as typeof inspectorTab)} className="route-graph-inspector-tabs">
        <Tabs.TabsList className="route-graph-inspector-tablist">
          <Tabs.TabsTrigger value="Overview">Overview</Tabs.TabsTrigger>
          <Tabs.TabsTrigger value="Config">Config</Tabs.TabsTrigger>
          <Tabs.TabsTrigger value="Ports">Ports</Tabs.TabsTrigger>
          <Tabs.TabsTrigger value="Connections">Connections</Tabs.TabsTrigger>
          <Tabs.TabsTrigger value="JSON">JSON</Tabs.TabsTrigger>
        </Tabs.TabsList>
        <div className="route-graph-inspector-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => onToggleNodeEnabled(selectedNode.id)}>{selectedNode.enabled ? 'Disable' : 'Enable'}</Button>
          <Button type="button" variant="outline" size="sm" disabled={!hasUpstream} onClick={() => onSelectConnectedPath(selectedNode.id, 'upstream')}>Upstream</Button>
          <Button type="button" variant="outline" size="sm" disabled={!hasDownstream} onClick={() => onSelectConnectedPath(selectedNode.id, 'downstream')}>Downstream</Button>
        </div>
        {selectedPort && (
          <div className="route-graph-inspector-summary">
            <span>Port<b>{selectedPort.id}</b></span>
            <span>Signature<b>{getPortTypeSignature(selectedPort)}</b></span>
            <span>Status<b>{selectedPort.enabled === false ? 'disabled' : 'enabled'}</b></span>
            <span>Connections<b>{getPortConnectionCount(graph, selectedNode.id, selectedPort.id)}</b></span>
          </div>
        )}
        <Tabs.TabsContent value="Overview">
          <div className="route-graph-inspector-summary">
            {getNodeInspectorFacts(graph, selectedNode).map((fact) => (
              <span key={fact.label}>{fact.label}<b>{fact.value}</b></span>
            ))}
          </div>
          <div className="route-graph-inspector-section">
            <div className="text-sm font-medium">Local Ports</div>
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
            <div className="text-sm font-medium">Connected Ports</div>
            {getNodePorts(selectedNode).map((port) => (
              <div key={port.id} className="route-graph-port-inspector-row">
                <strong>{port.id}</strong>
                <small>{getPortSummary(port)}</small>
                {getPortModeNote(selectedNode, port) && <small>{getPortModeNote(selectedNode, port)}</small>}
                <small>{getPortConnectionCount(graph, selectedNode.id, port.id)} connections</small>
              </div>
            ))}
          </div>
        </Tabs.TabsContent>
        <Tabs.TabsContent value="Connections">
          <div className="route-graph-panel-stack">
            <div className="text-sm font-medium">Inbound / Outbound</div>
            {getNodeConnections(graph, selectedNode.id).map(({ edge, direction, peerNodeId }) => (
              <div key={edge.id} className="route-graph-port-inspector-row">
                <strong>{direction === 'inbound' ? 'Inbound' : 'Outbound'}</strong>
                <small>{direction === 'inbound' ? `${edge.sourceNodeId}.${edge.sourcePortId}` : `${edge.targetNodeId}.${edge.targetPortId}`}</small>
                <small>{edge.kind} · {edge.ownership}</small>
                <small>{peerNodeId}</small>
              </div>
            ))}
          </div>
        </Tabs.TabsContent>
        <Tabs.TabsContent value="JSON">
          <Textarea className="font-mono text-xs" value={nodeJsonText} onChange={(event) => setNodeJsonText(event.target.value)} />
          <ButtonGroup>
            <Button type="button" disabled={readonly} onClick={onApplyNodeJson}>Apply Node JSON</Button>
            <Button type="button" variant="outline" onClick={() => setNodeJsonText(JSON.stringify(selectedNode, null, 2))}>Format</Button>
            <Button type="button" variant="outline" onClick={() => onCopyText(nodeJsonText, 'Node JSON')}>Copy</Button>
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

function MacroForm({ macro, readonly, onChange, onAddGroup }: {
  macro: RouteGraphMacro;
  readonly: boolean;
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
        <div className="text-sm font-medium">Route Priority Bands</div>
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
          Add priority band
        </Button>
      </div>
      {groups.length === 0 && (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          No priority bands. Add a band, then enter route IDs.
        </div>
      )}
      {groups.map((group, index) => {
        const input = group.input && typeof group.input === 'object' ? group.input as Record<string, any> : {};
        const routeIdsText = Array.isArray(input.routeIds) ? input.routeIds.join(', ') : '';
        return (
          <Card key={String(group.id || index)} className="p-3">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline">Band {index + 1}</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={readonly}
                  onClick={() => removeGroup(index)}
                >
                  Remove
                </Button>
              </div>
              <label>
                Label
                <Input disabled={readonly} value={String(group.label || group.id || '')} onChange={(event) => updateGroup(index, { label: event.target.value })} />
              </label>
              <label>
                Route IDs
                <Input
                  disabled={readonly}
                  value={routeIdsText}
                  onChange={(event) => {
                    const routeIds = event.target.value
                      .split(',')
                      .map((item) => Number(item.trim()))
                      .filter((value) => Number.isFinite(value) && value > 0)
                      .map((value) => Math.trunc(value));
                    updateGroup(index, { input: { kind: 'route_ids', routeIds: Array.from(new Set(routeIds)) } });
                  }}
                />
              </label>
              <label>
                Priority
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
        Public model name
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
        Visibility
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
        <span>Enabled</span>
        <Switch disabled={readonly} checked={macro.enabled} onCheckedChange={(enabled) => onChange({ ...macro, enabled })} aria-label="Macro enabled" />
      </div>
      <label>
        Strategy
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


function BottomPanel({ tab, graph, diagnostics, onSelectNode }: {
  tab: typeof BOTTOM_TABS[number];
  graph: RouteGraphSource;
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
            <span className="text-xs font-medium text-foreground">Problems</span>
            <Badge variant={errors.length > 0 ? 'destructive' : 'outline'}>{errors.length} errors</Badge>
            <Badge variant={warnings.length > 0 ? 'warning' : 'outline'}>{warnings.length} warnings</Badge>
          </div>
          <div className="route-graph-diagnostics-counts">
            <span className="text-xs text-muted-foreground">{diagnostics.length === 0 ? 'Clean' : `${diagnostics.length} total`}</span>
          </div>
        </div>

        {diagnostics.length === 0 ? (
          <div className="route-graph-diagnostics-empty text-xs text-muted-foreground">No problems detected.</div>
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
  if (tab === 'Trace') {
    return (
      <div className="route-graph-bottom-content">
        {graph.edges.slice(0, 10).map((edge) => (
          <span key={edge.id} className="route-graph-trace-chip">{edge.sourceNodeId}.{edge.sourcePortId} {'->'} {edge.targetNodeId}.{edge.targetPortId}</span>
        ))}
      </div>
    );
  }
  return <div className="route-graph-bottom-content">No {tab.toLowerCase()} data yet.</div>;
}
