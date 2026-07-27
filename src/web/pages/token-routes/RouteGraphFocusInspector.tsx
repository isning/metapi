import {
  AlertTriangle,
  Boxes,
  CircleDot,
  Copy,
  DoorOpen,
  Eye,
  GitBranch,
  GitFork,
  Inspect,
  OctagonX,
  Sparkles,
  Trash2,
  Workflow,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  getRouteGraphMacroPorts,
  getRouteGraphNodePorts,
  normalizeRouteGraphMacro,
  normalizeRouteGraphNode,
  type RouteGraphDiagnostic,
} from '../../../shared/routeGraph.js';
import type {
  RouteGraphFocusedWorkspace,
  RouteGraphWorkspaceConnectionEndpointRef,
  RouteGraphWorkspacePortal,
} from '../../../shared/routeGraphWorkspace.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import type { DispatchPolicyRegistryPayload } from '../../api.js';
import JsonCodeEditor from '../../components/JsonCodeEditor.js';
import { useToast } from '../../components/Toast.js';
import { Badge } from '../../components/ui/badge/index.js';
import { Button } from '../../components/ui/button/index.js';
import { ButtonGroup } from '../../components/ui/button-group/index.js';
import { Input } from '../../components/ui/input/index.js';
import { ScrollArea } from '../../components/ui/scroll-area/index.js';
import { Switch } from '../../components/ui/switch/index.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs/index.js';
import { tr } from '../../i18n.js';
import { NodeForm } from './NodeForm.js';
import { CandidateSelectorMacroForm } from './CandidateSelectorMacroForm.js';
import { ROUTE_GRAPH_VISUAL_COLORS, getNodeDefinitionTitle } from './routeGraphRegistry.js';
import {
  getEndpointExposureLabel,
  getEndpointKindLabel,
  getEndpointResolutionStatusLabel,
  getEndpointSourceKindLabel,
  getNodeCardSubtitle,
  getNodeTypeLabel,
  getOwnershipLabel,
  getPortSummary,
} from './routeGraphViewModel.js';
import type { RouteGraphWorkspaceSource } from './routeGraphWorkspace.js';
import type { RouteGraphEdge, RouteGraphMacro, RouteGraphNode } from './routeGraphTypes.js';

export type RouteGraphFocusSelection =
  | { kind: 'node'; item: RouteGraphNode }
  | { kind: 'macro'; item: RouteGraphMacro }
  | { kind: 'edge'; item: RouteGraphEdge }
  | { kind: 'portal'; item: RouteGraphWorkspacePortal };

type InspectorTab = 'overview' | 'config' | 'ports' | 'connections' | 'json' | 'diagnostics';

type RouteGraphFocusInspectorProps = {
  workspace: RouteGraphFocusedWorkspace;
  selected: RouteGraphFocusSelection;
  selectedGraphElementId: string | null;
  graph: RouteGraphWorkspaceSource;
  editable: boolean;
  connectionAuthoringEnabled: boolean;
  onGraphChange: (graph: RouteGraphWorkspaceSource) => void;
  onSelect: (selected: RouteGraphFocusSelection | null) => void;
  onOpenPortal: (portal: RouteGraphWorkspacePortal) => void;
  onDeletePortalEdge: (edgeId: string) => void;
  onRewirePortalEdge: (source: RouteGraphWorkspaceConnectionEndpointRef, edgeId: string) => void;
  onRequestDeleteElement: (
    selected: Extract<RouteGraphFocusSelection, { kind: 'node' | 'macro' }>,
    graphElementId: string,
  ) => void;
  onClose: () => void;
  policyRegistry?: DispatchPolicyRegistryPayload | null;
  referenceEndpoints?: Array<{ id: string; label: string }>;
  referenceEndpointCatalog?: {
    query: string;
    loading: boolean;
    hasMore: boolean;
    onQueryChange: (query: string) => void;
    onLoadMore: () => void;
  };
};

function inspectorAccentStyle(accent: string): CSSProperties {
  return { '--route-focus-accent': accent } as CSSProperties;
}

function selectedItemId(selected: RouteGraphFocusSelection): string {
  return selected.item.id;
}

function graphElementIdForSelection(
  selected: RouteGraphFocusSelection,
  selectedGraphElementId: string | null,
): string | null {
  if (selected.kind === 'node' || selected.kind === 'macro') return selectedGraphElementId || selected.item.id;
  return null;
}

export function resolveFocusDiagnosticSelection(
  diagnostic: RouteGraphDiagnostic,
  workspace: RouteGraphFocusedWorkspace,
  graph: RouteGraphWorkspaceSource,
): RouteGraphFocusSelection | null {
  if (diagnostic.edgeId) {
    const edge = graph.edges.find((item) => item.id === diagnostic.edgeId);
    if (edge) return { kind: 'edge', item: edge };
  }
  if (!diagnostic.nodeId) return null;
  const directNode = graph.nodes.find((item) => item.id === diagnostic.nodeId);
  if (directNode) return { kind: 'node', item: directNode };
  const directMacro = graph.macros.find((item) => item.id === diagnostic.nodeId);
  if (directMacro) return { kind: 'macro', item: directMacro };
  const binding = workspace.residentElements.find((item) => item.graphElementId === diagnostic.nodeId);
  if (!binding) return null;
  if (binding.element.kind === 'node') {
    const node = graph.nodes.find((item) => item.id === binding.element.id);
    return node ? { kind: 'node', item: node } : null;
  }
  const macro = graph.macros.find((item) => item.id === binding.element.id);
  return macro ? { kind: 'macro', item: macro } : null;
}

function diagnosticsForSelection(
  selected: RouteGraphFocusSelection,
  selectedGraphElementId: string | null,
  graph: RouteGraphWorkspaceSource,
  diagnostics: readonly RouteGraphDiagnostic[],
): RouteGraphDiagnostic[] {
  if (selected.kind === 'edge') return diagnostics.filter((item) => item.edgeId === selected.item.id);
  if (selected.kind === 'portal') {
    if (selected.item.kind === 'collection') return [];
    const edgeIds = new Set(selected.item.connection.edges.map((edge) => edge.id));
    return diagnostics.filter((diagnostic) => !!diagnostic.edgeId && edgeIds.has(diagnostic.edgeId));
  }
  const ids = new Set([selected.item.id, selectedGraphElementId].filter((value): value is string => !!value));
  if (selected.kind === 'macro') return diagnostics.filter((item) => item.nodeId && ids.has(item.nodeId));
  const incidentEdgeIds = new Set(graph.edges.filter((edge) => (
    ids.has(edge.sourceNodeId) || ids.has(edge.targetNodeId)
  )).map((edge) => edge.id));
  return diagnostics.filter((item) => (
    (item.nodeId ? ids.has(item.nodeId) : false)
    || (item.edgeId ? incidentEdgeIds.has(item.edgeId) : false)
  ));
}

function selectionConnections(
  selected: RouteGraphFocusSelection,
  selectedGraphElementId: string | null,
  graph: RouteGraphWorkspaceSource,
): Array<{ edge: RouteGraphEdge; direction: 'incoming' | 'outgoing'; peerId: string }> {
  const elementId = graphElementIdForSelection(selected, selectedGraphElementId);
  if (!elementId) return [];
  const connections: Array<{ edge: RouteGraphEdge; direction: 'incoming' | 'outgoing'; peerId: string }> = [];
  for (const edge of graph.edges) {
    if (edge.sourceNodeId === elementId) connections.push({ edge, direction: 'outgoing', peerId: edge.targetNodeId });
    else if (edge.targetNodeId === elementId) connections.push({ edge, direction: 'incoming', peerId: edge.sourceNodeId });
  }
  return connections;
}

function selectionIcon(selected: RouteGraphFocusSelection): ReactNode {
  if (selected.kind === 'macro') return <Sparkles size={15} />;
  if (selected.kind === 'edge') return <GitBranch size={15} />;
  if (selected.kind === 'portal') return <Eye size={15} />;
  if (selected.item.type === 'entry') return <DoorOpen size={15} />;
  if (selected.item.type === 'dispatcher') return <GitFork size={15} />;
  if (selected.item.type === 'filter') return <Workflow size={15} />;
  if (selected.item.type === 'route_endpoint') return <Boxes size={15} />;
  if (selected.item.type === 'synthetic_endpoint') return <OctagonX size={15} />;
  return <CircleDot size={15} />;
}

function selectionTitle(selected: RouteGraphFocusSelection): string {
  if (selected.kind === 'portal') return selected.item.label;
  if (selected.kind === 'edge') return tr('pages.tokenRoutes.routeGraphWorkspace.edge');
  return String(selected.item.name || selected.item.id);
}

function selectionSubtitle(selected: RouteGraphFocusSelection): string {
  if (selected.kind === 'node') return getNodeCardSubtitle(selected.item);
  if (selected.kind === 'macro') return selected.item.kind;
  if (selected.kind === 'edge') return selected.item.kind;
  if (selected.item.kind === 'collection') return tr(`pages.tokenRoutes.routeGraphWorkspace.portalKind.${selected.item.kind}`);
  return selected.item.preview.elementKind === 'macro'
    ? tr('pages.tokenRoutes.routeGraphWorkspace.kind.macro')
    : getNodeTypeLabel(selected.item.preview.elementKind);
}

function selectionAccent(selected: RouteGraphFocusSelection): string {
  if (selected.kind === 'node') return ROUTE_GRAPH_VISUAL_COLORS.node[selected.item.type];
  if (selected.kind === 'macro') return ROUTE_GRAPH_VISUAL_COLORS.macro.candidate_selector;
  if (selected.kind === 'edge') return ROUTE_GRAPH_VISUAL_COLORS.edge[selected.item.kind];
  return ROUTE_GRAPH_VISUAL_COLORS.edge[selected.item.connection.edgeKind];
}

function FactGrid({ facts }: { facts: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-x-3 gap-y-2 text-xs">
      {facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="text-muted-foreground">{fact.label}</dt>
          <dd className="min-w-0 break-words text-right text-foreground">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EmptyInspectorList({ title }: { title: string }) {
  return <EmptyStateBlock className="min-h-36 p-4" title={title} icon={<CircleDot size={17} />} />;
}

function resolvePeerSelection(
  graphElementId: string,
  workspace: RouteGraphFocusedWorkspace,
  graph: RouteGraphWorkspaceSource,
): RouteGraphFocusSelection | null {
  const binding = workspace.residentElements.find((item) => item.graphElementId === graphElementId);
  if (binding?.element.kind === 'node') {
    const node = graph.nodes.find((item) => item.id === binding.element.id);
    if (node) return { kind: 'node', item: node };
  }
  if (binding?.element.kind === 'macro') {
    const macro = graph.macros.find((item) => item.id === binding.element.id);
    if (macro) return { kind: 'macro', item: macro };
  }
  const node = graph.nodes.find((item) => item.id === graphElementId);
  if (node) return { kind: 'node', item: node };
  const macro = graph.macros.find((item) => item.id === graphElementId);
  return macro ? { kind: 'macro', item: macro } : null;
}

function JsonInspector({
  selected,
  editable,
  graph,
  onGraphChange,
}: {
  selected: RouteGraphFocusSelection;
  editable: boolean;
  graph: RouteGraphWorkspaceSource;
  onGraphChange: (graph: RouteGraphWorkspaceSource) => void;
}) {
  const toast = useToast();
  const serialized = useMemo(() => JSON.stringify(selected.item, null, 2), [selected]);
  const [text, setText] = useState(serialized);
  useEffect(() => setText(serialized), [serialized]);
  const mutable = editable
    && (selected.kind === 'node' || selected.kind === 'macro')
    && selected.item.ownership === 'manual';
  const apply = () => {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (selected.kind === 'node') {
        const normalized = normalizeRouteGraphNode(parsed) as RouteGraphNode;
        if (normalized.id !== selected.item.id || normalized.type !== selected.item.type || normalized.ownership !== selected.item.ownership) {
          toast.error(tr('pages.tokenRoutes.routeGraphWorkspace.identityFieldsImmutable'));
          return;
        }
        onGraphChange({
          ...graph,
          nodes: graph.nodes.map((node) => node.id === selected.item.id ? normalized : node),
        });
        return;
      }
      if (selected.kind === 'macro') {
        const normalized = normalizeRouteGraphMacro(parsed) as RouteGraphMacro;
        if (normalized.id !== selected.item.id || normalized.kind !== selected.item.kind || normalized.ownership !== selected.item.ownership) {
          toast.error(tr('pages.tokenRoutes.routeGraphWorkspace.identityFieldsImmutable'));
          return;
        }
        onGraphChange({
          ...graph,
          macros: graph.macros.map((macro) => macro.id === selected.item.id ? normalized : macro),
        });
      }
    } catch {
      toast.error(tr('pages.tokenRoutes.routeGraphWorkspace.invalidElementJson'));
    }
  };
  return (
    <div className="grid gap-2">
      <JsonCodeEditor
        value={text}
        onChange={setText}
        readOnly={!mutable}
        minHeight={320}
        maxHeight={560}
        ariaLabel={tr('pages.tokenRoutes.routeGraphWorkspace.elementJson')}
      />
      <ButtonGroup className="flex-wrap">
        {mutable && <Button type="button" size="sm" onClick={apply}>{tr('pages.tokenRoutes.routeGraphWorkspace.applyJson')}</Button>}
        <Button type="button" size="sm" variant="outline" onClick={() => setText(serialized)}>{tr('pages.tokenRoutes.routeGraphWorkspace.resetJson')}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(text)}>
          <Copy size={13} />
          {tr('pages.tokenRoutes.routeGraphWorkspace.copyJson')}
        </Button>
      </ButtonGroup>
    </div>
  );
}

function DiagnosticRows({
  diagnostics,
  workspace,
  graph,
  onSelect,
}: {
  diagnostics: readonly RouteGraphDiagnostic[];
  workspace: RouteGraphFocusedWorkspace;
  graph: RouteGraphWorkspaceSource;
  onSelect: (selected: RouteGraphFocusSelection | null) => void;
}) {
  if (diagnostics.length === 0) return <EmptyInspectorList title={tr('pages.tokenRoutes.routeGraphWorkspace.noDiagnostics')} />;
  return (
    <div className="grid gap-2">
      {diagnostics.map((diagnostic, index) => {
        const selection = resolveFocusDiagnosticSelection(diagnostic, workspace, graph);
        return (
          <Button
            type="button"
            variant="outline"
            key={`${diagnostic.code}:${diagnostic.nodeId || diagnostic.edgeId || index}`}
            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-md border p-2.5 text-left transition-colors hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent"
            disabled={!selection}
            onClick={() => selection && onSelect(selection)}
          >
            {diagnostic.severity === 'error'
              ? <XCircle size={15} className="mt-0.5 text-destructive" />
              : <AlertTriangle size={15} className="mt-0.5 text-amber-500" />}
            <span className="grid min-w-0 gap-1">
              <span className="flex min-w-0 items-center justify-between gap-2">
                <code className="truncate text-[10px] font-semibold text-foreground">{diagnostic.code}</code>
                {selection && <span className="shrink-0 text-[10px] text-primary">{tr('pages.tokenRoutes.routeGraphWorkspace.locate')}</span>}
              </span>
              <span className="break-words text-xs text-muted-foreground">{diagnostic.message}</span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function NodeOverview({
  node,
  connectionCount,
}: {
  node: RouteGraphNode;
  connectionCount: number;
}) {
  const facts: Array<{ label: string; value: ReactNode }> = [
    { label: tr('pages.tokenRoutes.routeGraphWorkspace.type'), value: getNodeTypeLabel(node.type) },
    { label: tr('pages.tokenRoutes.routeGraphWorkspace.ownership'), value: getOwnershipLabel(node.ownership) },
    { label: tr('pages.tokenRoutes.routeGraphWorkspace.statusLabel'), value: node.enabled ? tr('pages.tokenRoutes.routeGraphWorkspace.status.enabled') : tr('pages.tokenRoutes.routeGraphWorkspace.status.disabled') },
    { label: tr('pages.tokenRoutes.routeGraphWorkspace.connections'), value: connectionCount },
  ];
  if (node.type === 'route_endpoint') {
    facts.push(
      { label: tr('pages.tokenRoutes.routeGraphWorkspace.endpointKind'), value: getEndpointKindLabel(node.endpointKind) },
      { label: tr('pages.tokenRoutes.routeGraphWorkspace.endpointSource'), value: getEndpointSourceKindLabel(node.sourceKind) },
      { label: tr('pages.tokenRoutes.routeGraphWorkspace.endpointResolution'), value: getEndpointResolutionStatusLabel(node.resolutionStatus) },
      { label: tr('pages.tokenRoutes.routeGraphWorkspace.endpointExposure'), value: getEndpointExposureLabel(node.exposure) },
    );
  }
  return <FactGrid facts={facts} />;
}

function NodePorts({ node, graphElementId, graph }: { node: RouteGraphNode; graphElementId: string; graph: RouteGraphWorkspaceSource }) {
  const ports = getRouteGraphNodePorts(node);
  return (
    <div className="grid gap-2">
      {ports.map((port) => {
        const count = graph.edges.filter((edge) => (
          (edge.sourceNodeId === graphElementId && edge.sourcePortId === port.id)
          || (edge.targetNodeId === graphElementId && edge.targetPortId === port.id)
        )).length;
        return (
          <div key={port.id} className="grid gap-1 rounded-md border p-2.5 text-xs">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <strong className="truncate text-foreground">{port.label || port.id}</strong>
              <Badge variant="secondary">{count}</Badge>
            </div>
            <code className="break-all text-[10px] text-muted-foreground">{port.id}</code>
            <span className="text-muted-foreground">{getPortSummary(port)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ConnectionRows({
  connections,
  workspace,
  graph,
  onSelect,
}: {
  connections: ReturnType<typeof selectionConnections>;
  workspace: RouteGraphFocusedWorkspace;
  graph: RouteGraphWorkspaceSource;
  onSelect: (selected: RouteGraphFocusSelection | null) => void;
}) {
  if (connections.length === 0) return <EmptyInspectorList title={tr('pages.tokenRoutes.routeGraphWorkspace.noConnections')} />;
  return (
    <div className="grid gap-2">
      {connections.map(({ edge, direction, peerId }) => {
        const peer = resolvePeerSelection(peerId, workspace, graph);
        return (
          <div key={edge.id} className="grid gap-1.5 rounded-md border p-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="secondary">{tr(`pages.tokenRoutes.routeGraphWorkspace.direction.${direction}`)}</Badge>
              <span className="text-[10px] text-muted-foreground">{edge.kind}</span>
            </div>
            <code className="break-all text-[10px] text-muted-foreground">{peerId}</code>
            {peer && (
              <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => onSelect(peer)}>
                <Eye size={13} />
                {tr('pages.tokenRoutes.routeGraphWorkspace.inspectConnected')}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function RouteGraphDiagnosticsPanel({
  diagnostics,
  workspace,
  graph,
  onSelect,
}: {
  diagnostics: readonly RouteGraphDiagnostic[];
  workspace: RouteGraphFocusedWorkspace;
  graph: RouteGraphWorkspaceSource;
  onSelect: (selected: RouteGraphFocusSelection | null) => void;
}) {
  if (diagnostics.length === 0) return null;
  const errors = diagnostics.filter((item) => item.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  return (
    <section data-testid="route-graph-diagnostics-panel" className="overflow-hidden rounded-md border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <AlertTriangle size={14} className={errors > 0 ? 'text-destructive' : 'text-amber-500'} />
          {tr('pages.tokenRoutes.routeGraphWorkspace.diagnostics')}
        </div>
        <div className="flex items-center gap-1.5">
          {errors > 0 && <Badge variant="destructive">{tr('pages.tokenRoutes.routeGraphWorkspace.errors')} {errors}</Badge>}
          {warnings > 0 && <Badge variant="warning">{tr('pages.tokenRoutes.routeGraphWorkspace.warnings')} {warnings}</Badge>}
        </div>
      </header>
      <div className="grid max-h-44 gap-1.5 overflow-y-auto p-2">
        <DiagnosticRows diagnostics={diagnostics} workspace={workspace} graph={graph} onSelect={onSelect} />
      </div>
    </section>
  );
}

export default function RouteGraphFocusInspector({
  workspace,
  selected,
  selectedGraphElementId,
  graph,
  editable,
  connectionAuthoringEnabled,
  onGraphChange,
  onSelect,
  onOpenPortal,
  onDeletePortalEdge,
  onRewirePortalEdge,
  onRequestDeleteElement,
  onClose,
  policyRegistry,
  referenceEndpoints,
  referenceEndpointCatalog,
}: RouteGraphFocusInspectorProps) {
  const toast = useToast();
  const [tab, setTab] = useState<InspectorTab>('overview');
  const selectionId = selectedItemId(selected);
  useEffect(() => setTab('overview'), [selectionId, selected.kind]);
  const elementId = graphElementIdForSelection(selected, selectedGraphElementId);
  const connections = selectionConnections(selected, selectedGraphElementId, graph);
  const diagnostics = diagnosticsForSelection(selected, selectedGraphElementId, graph, workspace.diagnostics);
  const readonly = !editable
    || (selected.kind !== 'portal' && selected.item.ownership !== 'manual');
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(selectionId);
      toast.success(tr('pages.tokenRoutes.routeGraphWorkspace.copied'));
    } catch {
      toast.error(tr('pages.tokenRoutes.routeGraphWorkspace.copyFailed'));
    }
  };
  const removeSelected = () => {
    if (selected.kind === 'node' || selected.kind === 'macro') {
      if (elementId) onRequestDeleteElement(selected, elementId);
      return;
    }
    if (selected.kind === 'edge') {
      onGraphChange({ ...graph, edges: graph.edges.filter((edge) => edge.id !== selected.item.id) });
      onSelect(null);
    }
  };
  const ports = selected.kind === 'node'
    ? getRouteGraphNodePorts(selected.item)
    : selected.kind === 'macro'
      ? getRouteGraphMacroPorts(selected.item)
      : [];

  return (
    <aside data-testid="route-graph-inspector" className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-l bg-background">
      <header className="route-focus-inspector-header grid gap-2 border-b p-3" style={inspectorAccentStyle(selectionAccent(selected))}>
        <div className="flex min-w-0 items-start gap-2">
          <span className="route-focus-accent-icon mt-0.5 grid size-8 shrink-0 place-items-center rounded border bg-muted/30">
            {selectionIcon(selected)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-medium uppercase text-muted-foreground">
              <Inspect size={11} />
              {tr('pages.tokenRoutes.routeGraphWorkspace.inspector')}
            </div>
            <div className="truncate text-sm font-semibold text-foreground">{selectionTitle(selected)}</div>
            <div className="truncate text-[11px] text-muted-foreground">{selectionSubtitle(selected)}</div>
          </div>
          <ButtonGroup>
            <Button type="button" variant="ghost" size="icon" onClick={() => void copyId()} title={tr('pages.tokenRoutes.routeGraphWorkspace.copyId')}>
              <Copy size={14} />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} title={tr('common.close')}>
              <XCircle size={14} />
            </Button>
          </ButtonGroup>
        </div>
        <code className="truncate rounded bg-muted/35 px-2 py-1 text-[10px] text-muted-foreground" title={selectionId}>{selectionId}</code>
      </header>
      <Tabs value={tab} onValueChange={(value) => setTab(value as InspectorTab)} className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <div className="border-b p-2">
          <TabsList className="grid h-auto w-full grid-cols-3 rounded-md p-0.5">
            <TabsTrigger value="overview" className="min-h-7 px-2">{tr('pages.tokenRoutes.routeGraphWorkspace.tab.overview')}</TabsTrigger>
            {(selected.kind === 'node' || selected.kind === 'macro') && <TabsTrigger value="config" className="min-h-7 px-2">{tr('pages.tokenRoutes.routeGraphWorkspace.tab.config')}</TabsTrigger>}
            {(selected.kind === 'node' || selected.kind === 'macro') && <TabsTrigger value="ports" className="min-h-7 px-2">{tr('pages.tokenRoutes.routeGraphWorkspace.tab.ports')}</TabsTrigger>}
            {(selected.kind !== 'portal' || selected.item.kind !== 'collection') && <TabsTrigger value="connections" className="min-h-7 px-2">{tr('pages.tokenRoutes.routeGraphWorkspace.tab.connections')}</TabsTrigger>}
            <TabsTrigger value="json" className="min-h-7 px-2">{tr('pages.tokenRoutes.routeGraphWorkspace.tab.json')}</TabsTrigger>
            <TabsTrigger value="diagnostics" className="min-h-7 px-2">
              {tr('pages.tokenRoutes.routeGraphWorkspace.tab.diagnostics')}
              {diagnostics.length > 0 && <span className="ml-1 text-destructive">{diagnostics.length}</span>}
            </TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea data-testid="route-graph-inspector-scroll" className="h-full min-h-0">
          <div className="p-3">
            <TabsContent value="overview" className="m-0 grid gap-4">
              {selected.kind === 'node' && <NodeOverview node={selected.item} connectionCount={connections.length} />}
              {selected.kind === 'macro' && <FactGrid facts={[
                { label: tr('pages.tokenRoutes.routeGraphWorkspace.type'), value: selected.item.kind },
                { label: tr('pages.tokenRoutes.routeGraphWorkspace.ownership'), value: getOwnershipLabel(selected.item.ownership) },
                { label: tr('pages.tokenRoutes.routeGraphWorkspace.statusLabel'), value: selected.item.enabled ? tr('pages.tokenRoutes.routeGraphWorkspace.status.enabled') : tr('pages.tokenRoutes.routeGraphWorkspace.status.disabled') },
                { label: tr('pages.tokenRoutes.routeGraphWorkspace.connections'), value: connections.length },
              ]} />}
              {selected.kind === 'edge' && <FactGrid facts={[
                { label: tr('pages.tokenRoutes.routeGraphWorkspace.edgeKind'), value: selected.item.kind },
                { label: tr('pages.tokenRoutes.routeGraphWorkspace.ownership'), value: getOwnershipLabel(selected.item.ownership) },
                { label: tr('pages.tokenRoutes.routeGraphWorkspace.source'), value: `${selected.item.sourceNodeId}.${selected.item.sourcePortId}` },
                { label: tr('pages.tokenRoutes.routeGraphWorkspace.target'), value: `${selected.item.targetNodeId}.${selected.item.targetPortId}` },
              ]} />}
              {selected.kind === 'portal' && (
                <div className="grid gap-3">
                  <FactGrid facts={[
                    { label: tr('pages.tokenRoutes.routeGraphWorkspace.type'), value: tr(`pages.tokenRoutes.routeGraphWorkspace.portalKind.${selected.item.kind}`) },
                    { label: tr('pages.tokenRoutes.routeGraphWorkspace.direction'), value: tr(`pages.tokenRoutes.routeGraphWorkspace.direction.${selected.item.direction}`) },
                    { label: tr('pages.tokenRoutes.routeGraphWorkspace.connections'), value: selected.item.connection.count },
                    { label: tr('pages.tokenRoutes.routeGraphWorkspace.port'), value: selected.item.connection.portLabel },
                    ...(selected.item.kind === 'collection' ? [{
                      label: tr('pages.tokenRoutes.routeGraphWorkspace.collectionWindow'),
                      value: `${selected.item.collection.start + 1}-${selected.item.collection.end} / ${selected.item.collection.total}`,
                    }] : []),
                    ...(selected.item.kind === 'collection' ? [] : [{
                      label: tr('pages.tokenRoutes.routeGraphWorkspace.statusLabel'),
                      value: selected.item.preview.enabled
                        ? tr('pages.tokenRoutes.routeGraphWorkspace.status.enabled')
                        : tr('pages.tokenRoutes.routeGraphWorkspace.status.disabled'),
                    }]),
                  ]} />
                  <Button type="button" size="sm" onClick={() => onOpenPortal(selected.item)}>
                    <Eye size={14} />
                    {selected.item.kind === 'collection'
                      ? tr('pages.tokenRoutes.routeGraphWorkspace.openCollectionWindow')
                      : tr('pages.tokenRoutes.routeGraphWorkspace.openBoundary')}
                  </Button>
                </div>
              )}
              {!readonly && selected.kind !== 'portal' && (
                <Button type="button" variant="destructive" size="sm" onClick={removeSelected}>
                  {selected.kind === 'edge' ? tr('pages.tokenRoutes.routeGraphWorkspace.deleteEdge') : selected.kind === 'macro' ? tr('pages.tokenRoutes.routeGraphWorkspace.deleteMacro') : tr('pages.tokenRoutes.nodeForm.delete')}
                </Button>
              )}
            </TabsContent>
            <TabsContent value="config" className="m-0">
              {selected.kind === 'node' && (
                <NodeForm
                  node={selected.item}
                  readonly={readonly}
                  policyRegistry={policyRegistry}
                  referenceEndpoints={referenceEndpoints || graph.nodes.filter((node) => node.type === 'route_endpoint').map((node) => ({ id: node.routeEndpointId, label: node.name || node.routeEndpointId }))}
                  referenceEndpointCatalog={referenceEndpointCatalog}
                  onChange={(node) => onGraphChange({
                    ...graph,
                    nodes: graph.nodes.map((item) => item.id === node.id ? node : item),
                  })}
                  onDelete={removeSelected}
                />
              )}
              {selected.kind === 'macro' && (
                <div className="grid gap-3 text-xs">
                  <label className="grid gap-1.5 text-muted-foreground">
                    {tr('pages.tokenRoutes.nodeForm.name')}
                    <Input
                      disabled={readonly}
                      value={String(selected.item.name || '')}
                      onChange={(event) => onGraphChange({
                        ...graph,
                        macros: graph.macros.map((macro) => macro.id === selected.item.id ? { ...macro, name: event.target.value } : macro),
                      })}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-muted-foreground">
                    {tr('pages.tokenRoutes.nodeForm.enabled')}
                    <Switch
                      disabled={readonly}
                      checked={selected.item.enabled}
                      onCheckedChange={(enabled) => onGraphChange({
                        ...graph,
                        macros: graph.macros.map((macro) => macro.id === selected.item.id ? { ...macro, enabled } : macro),
                      })}
                    />
                  </label>
                  <CandidateSelectorMacroForm
                    macro={selected.item}
                    readonly={readonly}
                    registry={policyRegistry}
                    endpoints={referenceEndpoints || graph.nodes.filter((node) => node.type === 'route_endpoint').map((node) => ({ id: node.routeEndpointId, label: node.name || node.routeEndpointId }))}
                    macros={graph.macros.map((macro) => ({ id: macro.id, label: macro.name || macro.id }))}
                    onChange={(nextMacro) => onGraphChange({ ...graph, macros: graph.macros.map((macro) => macro.id === nextMacro.id ? nextMacro : macro) })}
                  />
                  {readonly && <p className="text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.readOnlyElement')}</p>}
                </div>
              )}
            </TabsContent>
            <TabsContent value="ports" className="m-0">
              {selected.kind === 'node' && elementId && <NodePorts node={selected.item} graphElementId={elementId} graph={graph} />}
              {selected.kind === 'macro' && (
                <div className="grid gap-2">
                  {ports.map((port) => <div key={port.id} className="grid gap-1 rounded-md border p-2.5 text-xs"><strong>{port.label || port.id}</strong><code className="break-all text-[10px] text-muted-foreground">{port.id}</code><span className="text-muted-foreground">{getPortSummary(port)}</span></div>)}
                </div>
              )}
            </TabsContent>
            <TabsContent value="connections" className="m-0">
              {selected.kind === 'portal' ? (
                selected.item.kind === 'collection' ? <EmptyInspectorList title={tr('pages.tokenRoutes.routeGraphWorkspace.noConnections')} /> : (
                  <div className="grid gap-2">
                    {selected.item.connection.edges.map((edge) => (
                      <div key={edge.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border p-2.5">
                        <div className="grid min-w-0 gap-1 text-xs">
                          <code className="truncate" title={edge.id}>{edge.id}</code>
                          <span className="truncate text-muted-foreground">{tr('pages.tokenRoutes.routeGraphWorkspace.remotePort')}: {edge.destinationPortId}</span>
                        </div>
                        {connectionAuthoringEnabled && edge.ownership === 'manual' && (
                          <ButtonGroup>
                            <Button type="button" size="icon" variant="ghost" onClick={() => onRewirePortalEdge(selected.item.resident, edge.id)} title={tr('pages.tokenRoutes.routeGraphConnection.rewire')}>
                              <GitFork size={14} />
                            </Button>
                            <Button type="button" size="icon" variant="ghost" className="text-destructive" onClick={() => onDeletePortalEdge(edge.id)} title={tr('pages.tokenRoutes.routeGraphWorkspace.deleteEdge')}>
                              <Trash2 size={14} />
                            </Button>
                          </ButtonGroup>
                        )}
                      </div>
                    ))}
                  </div>
                )
              ) : <ConnectionRows connections={connections} workspace={workspace} graph={graph} onSelect={onSelect} />}
            </TabsContent>
            <TabsContent value="json" className="m-0">
              <JsonInspector selected={selected} editable={editable} graph={graph} onGraphChange={onGraphChange} />
            </TabsContent>
            <TabsContent value="diagnostics" className="m-0">
              <DiagnosticRows diagnostics={diagnostics} workspace={workspace} graph={graph} onSelect={onSelect} />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </aside>
  );
}

export function EmptyRouteGraphFocusInspector() {
  return (
    <aside data-testid="route-graph-inspector-empty" className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-l bg-background">
      <header className="flex items-center gap-2 border-b p-3 text-xs font-medium text-foreground">
        <Inspect size={14} className="text-muted-foreground" />
        {tr('pages.tokenRoutes.routeGraphWorkspace.inspector')}
      </header>
      <div className="grid min-h-0 place-items-center p-4">
        <EmptyStateBlock title={tr('pages.tokenRoutes.routeGraphWorkspace.noSelection')} icon={<CircleDot size={18} />} />
      </div>
    </aside>
  );
}
