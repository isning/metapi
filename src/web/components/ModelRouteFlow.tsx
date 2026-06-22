import React, { useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { tr } from '../i18n.js';

type RouteFlowNodeKind =
  | 'request'
  | 'entry'
  | 'dispatcher'
  | 'filter'
  | 'route_endpoint'
  | 'model_endpoint'
  | 'synthetic_endpoint'
  | 'route'
  | 'transform'
  | 'pool'
  | 'channel';
type RouteFlowNodeStatus = 'active' | 'selected' | 'available' | 'blocked' | 'inactive';

export type ModelRouteFlowData = {
  version: 1;
  requestedModel: string;
  actualModel: string;
  matched: boolean;
  selectedRouteId?: number | null;
  selectedChannelId?: number | null;
  selectedAccountId?: number | null;
  routePattern?: string | null;
  summary: string[];
  nodes: Array<{
    id: string;
    kind: RouteFlowNodeKind;
    visibility: 'public' | 'internal' | 'terminal';
    label: string;
    subtitle?: string | null;
    status: RouteFlowNodeStatus;
    badges: string[];
    metrics: {
      successRate?: number | null;
      totalCalls?: number | null;
      recentSuccessCount?: number | null;
      recentFailureCount?: number | null;
      avgLatencyMs?: number | null;
      probability?: number | null;
      priority?: number | null;
      weight?: number | null;
      failCount?: number | null;
      consecutiveFailureCount?: number | null;
      lastUsedAt?: string | null;
      lastSelectedAt?: string | null;
      lastFailureAt?: string | null;
      cooldownUntil?: string | null;
    };
    history: Array<{
      at: string;
      status: 'success' | 'failed' | 'retried';
      httpStatus?: number | null;
      message?: string | null;
    }>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label?: string | null;
  }>;
  diagnostics: Array<{
    level: 'info' | 'warn' | 'error';
    message: string;
  }>;
  entryPricing?: {
    theoretical: {
      inputPerMillion: number | null;
      outputPerMillion: number | null;
      totalCostUsd: number | null;
      inputMultiplier: number | null;
      outputMultiplier: number | null;
      totalMultiplier: number | null;
      sourceCount: number;
      estimateLevel: 'exact' | 'static_estimate' | 'incomplete';
      strategy: string | null;
      diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
      candidates: Array<{
        targetId: string;
        endpointId: string;
        nodeId: string;
        channelId: string;
        siteId: number | null;
        accountId: number | null;
        tokenId: number | null;
        modelName: string;
        probability: number;
        weight: number | null;
        priority: number | null;
        inputPerMillion: number | null;
        outputPerMillion: number | null;
        totalCostUsd: number | null;
        pricingId: number | null;
        matchedScope: string | null;
        sourceRef: {
          nodeId?: string;
          edgeId?: string;
          macroId?: string;
          endpointId?: string;
          routeId?: number | null;
          generatedNodeIds?: string[];
          generatedEdgeIds?: string[];
        };
      }>;
    } | null;
  };
  compatibilityPolicy?: {
    resolved: {
      reasoningHistory: {
        transport: {
          mode: 'native' | 'content_think_tag' | 'drop';
          maxReasoningBytes: number;
          overflow: 'truncate' | 'drop';
          thinkTag: {
            openTag: string;
            closeTag: string;
            separator: string;
          };
          applyTo: {
            assistantHistory: boolean;
            assistantToolCalls: boolean;
            responseContinuation: boolean;
          };
          toolCallMessageBehavior: 'same_as_assistant' | 'native' | 'drop';
        };
      };
      payloadDefaults: unknown[];
      requestTransforms: unknown[];
    };
    layers: Array<{
      source: 'site' | 'account' | 'token' | 'model_endpoint' | 'target';
      configured: boolean;
    }>;
  };
  compiledAt: string;
};

type FlowNodeData = ModelRouteFlowData['nodes'][number];

type ModelRouteFlowProps = {
  flow: ModelRouteFlowData | null;
  loading?: boolean;
  error?: string;
};

const statusColor: Record<RouteFlowNodeStatus, string> = {
  active: 'var(--primary)',
  selected: 'var(--success)',
  available: 'var(--info)',
  blocked: 'var(--destructive)',
  inactive: 'var(--muted-foreground)',
};

const kindLabel: Record<RouteFlowNodeKind, string> = {
  request: 'Request',
  entry: 'Entry',
  dispatcher: 'Dispatcher',
  filter: 'Filter',
  route_endpoint: 'Route endpoint',
  model_endpoint: 'Model endpoint',
  synthetic_endpoint: 'Synthetic endpoint',
  route: 'Route',
  transform: 'Filter',
  pool: 'Pool',
  channel: 'Channel',
};

const LEVEL_GAP = 104;
const NODE_GAP = 28;
const DEFAULT_NODE_WIDTH = 272;
const CHANNEL_NODE_WIDTH = 288;
const BADGE_ROW_HEIGHT = 24;
const TEXT_LINE_HEIGHT = 18;
const CARD_VERTICAL_CHROME = 78;
const HEALTH_SECTION_HEIGHT = 116;

type NodeSize = {
  width: number;
  height: number;
};

function formatPercent(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return `${Math.round(value * 10) / 10}%`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'n/a';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function RouteNodeCard({ data }: NodeProps<Node<FlowNodeData>>) {
  const node = data;
  const color = statusColor[node.status] || statusColor.inactive;
  const history = node.history.slice(0, 6);
  const showHealth = node.kind === 'channel';

  return (
    <div
      className={`max-w-72 overflow-hidden rounded-md border bg-card text-card-foreground shadow-sm ${node.kind === 'channel' ? 'min-w-56' : 'min-w-52'} ${node.status === 'selected' ? 'ring-2 ring-primary' : ''}`}
    >
      <Handle type="target" position={Position.Left} style={{ background: color }} />
      <div className="border-b px-3 py-2.5">
        <div className="mb-1.5 flex items-center gap-2">
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: color,
              flex: '0 0 auto',
            }}
          />
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            {kindLabel[node.kind]} / {node.visibility}
          </span>
        </div>
        <div className="break-words text-sm font-semibold leading-tight">
          {node.label}
        </div>
        {node.subtitle && (
          <div className="mt-1 break-words text-xs leading-tight text-muted-foreground">
            {node.subtitle}
          </div>
        )}
      </div>
      <div className="px-3 py-2.5">
        <div className={`flex flex-wrap gap-1.5 ${showHealth ? 'mb-2' : ''}`}>
          {node.badges.slice(0, 8).map((badge) => (
            <span
              key={badge}
              className="rounded-full border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground"
            >
              {badge}
            </span>
          ))}
        </div>
        {showHealth && (
          <>
            <div className="mb-2 grid grid-cols-2 gap-1.5">
              <Metric label={tr('components.modelAnalysisPanel.successRate')} value={formatPercent(node.metrics.successRate)} />
              <Metric label={tr('components.modelRouteFlow.probability')} value={formatPercent(node.metrics.probability)} />
              <Metric label={tr('components.modelAnalysisPanel.calls')} value={String(node.metrics.totalCalls ?? 0)} />
              <Metric label={tr('components.modelRouteFlow.latency')} value={node.metrics.avgLatencyMs == null ? 'n/a' : `${node.metrics.avgLatencyMs}ms`} />
              <Metric label={tr('components.modelRouteFlow.failed')} value={String(node.metrics.consecutiveFailureCount ?? 0)} />
              <Metric label={tr('components.modelRouteFlow.cooldown')} value={node.metrics.cooldownUntil ? formatDateTime(node.metrics.cooldownUntil) : 'none'} />
            </div>
            {history.length > 0 && (
              <div className="flex gap-1">
                {history.map((item, index) => (
                  <span
                    key={`${item.at}-${index}`}
                    title={`${item.status} ${item.httpStatus ?? ''} ${formatDateTime(item.at)} ${item.message || ''}`.trim()}
                    style={{
                      width: 18,
                      height: 6,
                      borderRadius: 99,
                      background: item.status === 'success'
                        ? 'var(--success)'
                        : (item.status === 'retried' ? 'var(--warning)' : 'var(--destructive)'),
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-px text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-xs font-semibold">
        {value}
      </div>
    </div>
  );
}

function estimateWrappedLines(value: string | null | undefined, charsPerLine: number): number {
  const text = (value || '').trim();
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

function estimateNodeSize(node: FlowNodeData): NodeSize {
  const isChannel = node.kind === 'channel';
  const width = isChannel ? CHANNEL_NODE_WIDTH : DEFAULT_NODE_WIDTH;
  const contentCharsPerLine = isChannel ? 34 : 32;
  const labelLines = estimateWrappedLines(node.label, contentCharsPerLine);
  const subtitleLines = estimateWrappedLines(node.subtitle, contentCharsPerLine);
  const visibleBadgeCount = Math.min(node.badges.length, 8);
  const badgeRows = visibleBadgeCount > 0 ? Math.ceil(visibleBadgeCount / 3) : 0;
  const height = CARD_VERTICAL_CHROME
    + (labelLines * TEXT_LINE_HEIGHT)
    + (subtitleLines * TEXT_LINE_HEIGHT)
    + (badgeRows * BADGE_ROW_HEIGHT)
    + (isChannel ? HEALTH_SECTION_HEIGHT : 0);

  return {
    width,
    height: Math.max(isChannel ? 224 : 118, height),
  };
}

function isCandidateInputEdge(edge: ModelRouteFlowData['edges'][number], flow: ModelRouteFlowData): boolean {
  if (edge.id.startsWith('graph-candidate-supply-')) return true;
  const source = flow.nodes.find((node) => node.id === edge.source);
  const target = flow.nodes.find((node) => node.id === edge.target);
  return source?.kind === 'route_endpoint' && target?.kind === 'dispatcher' && edge.label != null && /%|selected/.test(edge.label);
}

export function layoutNodes(flow: ModelRouteFlowData): Node<FlowNodeData>[] {
  const levels = new Map<string, number>();
  const childrenBySource = new Map<string, string[]>();
  for (const edge of flow.edges) {
    if (isCandidateInputEdge(edge, flow)) continue;
    if (!childrenBySource.has(edge.source)) childrenBySource.set(edge.source, []);
    childrenBySource.get(edge.source)!.push(edge.target);
  }

  const queue: Array<{ id: string; level: number }> = [{ id: 'request', level: 0 }];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    levels.set(item.id, item.level);
    for (const child of childrenBySource.get(item.id) || []) {
      queue.push({ id: child, level: item.level + 1 });
    }
  }

  for (const edge of flow.edges.filter((item) => isCandidateInputEdge(item, flow))) {
    const dispatcherLevel = levels.get(edge.target);
    if (dispatcherLevel == null) continue;
    const candidateLevel = Math.max(0, dispatcherLevel - 1);
    const current = levels.get(edge.source);
    if (current == null || current > candidateLevel) levels.set(edge.source, candidateLevel);
  }

  for (const edge of flow.edges.filter((item) => isCandidateInputEdge(item, flow))) {
    const sourceLevel = levels.get(edge.source);
    if (sourceLevel == null) continue;
    for (const child of flow.edges.filter((item) => item.source === edge.source && !isCandidateInputEdge(item, flow)).map((item) => item.target)) {
      const current = levels.get(child);
      const next = sourceLevel + 1;
      if (current == null || current < next) levels.set(child, next);
    }
  }

  const byLevel = new Map<number, FlowNodeData[]>();
  for (const node of flow.nodes) {
    const level = levels.get(node.id) ?? 0;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push(node);
  }

  const levelWidths = new Map<number, number>();
  for (const [level, nodes] of byLevel.entries()) {
    levelWidths.set(level, Math.max(...nodes.map((node) => estimateNodeSize(node).width)));
  }

  const sortedLevels = [...byLevel.keys()].sort((left, right) => left - right);
  const levelX = new Map<number, number>();
  let nextX = 0;
  for (const level of sortedLevels) {
    levelX.set(level, nextX);
    nextX += (levelWidths.get(level) ?? DEFAULT_NODE_WIDTH) + LEVEL_GAP;
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, nodes] of byLevel.entries()) {
    const sorted = [...nodes].sort((left, right) => {
      if (left.status === 'selected' && right.status !== 'selected') return -1;
      if (right.status === 'selected' && left.status !== 'selected') return 1;
      return left.id.localeCompare(right.id);
    });
    const sizes = sorted.map(estimateNodeSize);
    const totalHeight = sizes.reduce((sum, size) => sum + size.height, 0)
      + Math.max(0, sorted.length - 1) * NODE_GAP;
    let y = -(totalHeight / 2);
    sorted.forEach((node, index) => {
      const size = sizes[index];
      positions.set(node.id, {
        x: levelX.get(level) ?? 0,
        y,
      });
      y += size.height + NODE_GAP;
    });
  }

  return flow.nodes.map((node) => ({
    id: node.id,
    type: 'routeNode',
    position: positions.get(node.id) || { x: 0, y: 0 },
    data: node,
    width: estimateNodeSize(node).width,
    height: estimateNodeSize(node).height,
    draggable: false,
  }));
}

export default function ModelRouteFlow({ flow, loading = false, error = '' }: ModelRouteFlowProps) {
  const nodeTypes = useMemo(() => ({ routeNode: RouteNodeCard }), []);
  const nodes = useMemo(() => (flow ? layoutNodes(flow) : []), [flow]);
  const edges: Edge[] = useMemo(() => (flow?.edges || []).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label || undefined,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 },
    labelStyle: { fontSize: 11, fill: 'var(--muted-foreground)', fontWeight: 600 },
  })), [flow]);

  if (loading) {
    return <div className="p-3.5 text-xs text-muted-foreground">{tr('components.modelRouteFlow.routes')}</div>;
  }

  if (error) {
    return <div className="p-3.5 text-xs text-destructive">{error}</div>;
  }

  if (!flow) {
    return <div className="p-3.5 text-xs text-muted-foreground">{tr('components.modelRouteFlow.selectmodelRoutes')}</div>;
  }

  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>compiled {formatDateTime(flow.compiledAt)}</span>
        <span>route {flow.routePattern || 'n/a'}</span>
        <span>actual {flow.actualModel}</span>
        {flow.selectedChannelId != null ? <span>channel {flow.selectedChannelId}</span> : null}
      </div>
      {flow.diagnostics.length > 0 && (
        <div className="grid gap-1">
          {flow.diagnostics.map((item) => (
            <div key={item.message} className={item.level === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
              {item.message}
            </div>
          ))}
        </div>
      )}
      <div className="h-[430px] overflow-hidden rounded-md border bg-card">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.35}
          maxZoom={1.4}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background color="var(--border)" gap={18} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {flow.summary.length > 0 && (
        <div className="grid gap-1">
          {flow.summary.slice(0, 5).map((line) => (
            <div key={line} className="text-xs text-muted-foreground">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
