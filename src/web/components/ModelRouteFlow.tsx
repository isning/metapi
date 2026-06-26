import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  GitBranch,
  Info,
  LoaderCircle,
  Route,
  Server,
  ShieldAlert,
  Target,
} from 'lucide-react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { tr } from '../i18n.js';
import { cn } from '../lib/utils.js';
import ToneBadge from './ToneBadge.js';
import EstimateLevelBadge from './pricing/EstimateLevelBadge.js';
import { Badge } from './ui/badge/index.js';
import { Card, CardContent } from './ui/card/index.js';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyIcon,
  EmptyTitle,
} from './ui/empty/index.js';
import * as Tabs from './ui/tabs/index.js';

type RouteFlowNodeKind =
  | 'request'
  | 'entry'
  | 'dispatcher'
  | 'filter'
  | 'route_endpoint'
  | 'synthetic_endpoint';
type RouteFlowNodeStatus = 'active' | 'selected' | 'available' | 'blocked' | 'inactive';

export type ModelRouteFlowData = {
  version: 1;
  requestedModel: string;
  actualModel: string;
  matched: boolean;
  selectedRouteId?: number | null;
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
      reference: {
        inputPerMillion: number | null;
        outputPerMillion: number | null;
        cacheReadPerMillion: number | null;
        cacheWritePerMillion: number | null;
        reasoningPerMillion: number | null;
        requestUsd: number | null;
        totalCostUsd: number | null;
      } | null;
      effectiveCost: {
        walletCostBaseCurrency: number | null;
        baseCostUnit: string | null;
        freeQuotaDaysCost: number | null;
        balanceBurn: Array<{ unit: string; amount: number }>;
        estimateLevel: 'exact' | 'static_estimate' | 'incomplete';
        diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
      } | null;
      sourceCount: number;
      estimateLevel: 'exact' | 'static_estimate' | 'incomplete';
      strategy: string | null;
      diagnostics: Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
      candidates: Array<{
        targetId: string;
        endpointId: string;
        nodeId: string;
        siteId: number | null;
        accountId: number | null;
        tokenId: number | null;
        modelName: string;
        probability: number | null;
        weight: number | null;
        priority: number | null;
        inputPerMillion: number | null;
        outputPerMillion: number | null;
        totalCostUsd: number | null;
        effectiveCost: {
          walletCostBaseCurrency: number | null;
          baseCostUnit: string;
          freeQuotaDaysCost: number | null;
          balanceBurn: Array<{ unit: string; amount: number }>;
          estimateLevel: 'exact' | 'estimated' | 'incomplete';
        } | null;
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
      source: 'site' | 'account' | 'token' | 'endpoint_policy' | 'target';
      configured: boolean;
    }>;
  };
  compiledAt: string;
};

export type ModelRouteFlowViewMode = 'effective' | 'candidates' | 'compiled' | 'diagnostics';

type FlowNodeData = ModelRouteFlowData['nodes'][number];
type FlowEdgeData = {
  label?: string | null;
  selectedPath?: boolean;
  candidatePath?: boolean;
};

type ModelRouteFlowProps = {
  flow: ModelRouteFlowData | null;
  loading?: boolean;
  error?: string;
  viewMode?: ModelRouteFlowViewMode;
  onViewModeChange?: (mode: ModelRouteFlowViewMode) => void;
  compact?: boolean;
};

const statusTone: Record<RouteFlowNodeStatus, string> = {
  active: '-info',
  selected: '-success',
  available: '-muted',
  blocked: 'warning',
  inactive: '-muted',
};

const statusColor: Record<RouteFlowNodeStatus, string> = {
  active: 'var(--primary)',
  selected: 'var(--success)',
  available: 'var(--muted-foreground)',
  blocked: 'var(--warning)',
  inactive: 'var(--muted-foreground)',
};

const kindColor: Record<RouteFlowNodeKind, string> = {
  request: 'var(--primary)',
  entry: 'var(--primary)',
  dispatcher: 'var(--info)',
  filter: 'var(--warning)',
  route_endpoint: 'var(--success)',
  synthetic_endpoint: 'var(--destructive)',
};

const kindLabel: Record<RouteFlowNodeKind, string> = {
  request: 'Request',
  entry: 'Public entry',
  dispatcher: 'Selector',
  filter: 'Filter',
  route_endpoint: 'Supply endpoint',
  synthetic_endpoint: 'Synthetic response',
};

const LEVEL_GAP = 112;
const NODE_GAP = 20;
const DEFAULT_NODE_WIDTH = 236;
const CANDIDATE_NODE_WIDTH = 252;
const BADGE_ROW_HEIGHT = 20;
const TEXT_LINE_HEIGHT = 17;
const CARD_VERTICAL_CHROME = 72;
const HEALTH_SECTION_HEIGHT = 54;

type NodeSize = {
  width: number;
  height: number;
};

function formatPercent(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return tr('common.notAvailable');
  return `${Math.round(value * 10) / 10}%`;
}

function formatProbabilityRatio(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return tr('common.notAvailable');
  return `${Math.round(value * 1000) / 10}%`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return tr('common.notAvailable');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatMoney(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return tr('components.modelRouteFlow.priceUnavailable');
  return `$${value.toFixed(6).replace(/\.?0+$/, '')}`;
}

function formatWalletCost(value?: number | null, currency?: string | null): string {
  if (value == null || !Number.isFinite(value)) return tr('components.modelRouteFlow.walletCostUnavailable');
  return `${currency || 'USD'} ${value.toFixed(6).replace(/\.?0+$/, '')}`;
}

function formatQuotaDays(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return tr('components.modelRouteFlow.freeQuotaUnavailable');
  return `${value.toFixed(4).replace(/\.?0+$/, '')} d`;
}

function formatBalanceBurn(buckets?: Array<{ unit: string; amount: number }> | null): string {
  if (!buckets || buckets.length === 0) return tr('components.modelRouteFlow.balanceCostUnavailable');
  return buckets
    .map((bucket) => `${bucket.amount.toFixed(6).replace(/\.?0+$/, '')} ${bucket.unit}`)
    .join(' + ');
}

function formatMultiplier(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return tr('components.modelRouteFlow.referenceUnavailable');
  return `${value.toFixed(4).replace(/\.?0+$/, '')}x`;
}

function formatNumber(value?: number | null, suffix = ''): string {
  if (value == null || !Number.isFinite(value)) return tr('common.notAvailable');
  return `${Math.round(value * 100) / 100}${suffix}`;
}

function formatEstimateLevel(level?: string | null): string {
  if (level === 'exact') return tr('components.modelRouteFlow.estimateExact');
  if (level === 'static_estimate') return tr('components.modelRouteFlow.estimateStatic');
  if (level === 'estimated') return tr('components.modelRouteFlow.estimateEstimated');
  if (level === 'incomplete') return tr('components.modelRouteFlow.estimateIncomplete');
  return level || tr('common.notAvailable');
}

function nodeIcon(kind: RouteFlowNodeKind): JSX.Element {
  if (kind === 'request') return <Route className="size-3.5" />;
  if (kind === 'entry') return <GitBranch className="size-3.5" />;
  if (kind === 'dispatcher') return <Cpu className="size-3.5" />;
  if (kind === 'route_endpoint') return <Server className="size-3.5" />;
  if (kind === 'synthetic_endpoint') return <ShieldAlert className="size-3.5" />;
  return <Target className="size-3.5" />;
}

function statusLabel(status: RouteFlowNodeStatus): string {
  if (status === 'selected') return tr('components.modelRouteFlow.selected');
  if (status === 'active') return tr('components.modelRouteFlow.active');
  if (status === 'available') return tr('components.modelRouteFlow.available');
  if (status === 'blocked') return tr('components.modelRouteFlow.blocked');
  return tr('components.modelRouteFlow.inactive');
}

function RouteNodeCard({ data }: NodeProps<Node<FlowNodeData>>) {
  const node = data;
  const color = statusColor[node.status] || statusColor.inactive;
  const typeColor = kindColor[node.kind] || color;
  const isCandidateNode = node.kind === 'route_endpoint';
  const showProbability = isCandidateNode && node.metrics.probability != null;
  const showLatency = isCandidateNode && node.metrics.avgLatencyMs != null;

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-md border bg-card text-card-foreground shadow-sm',
        node.status === 'selected' && 'border-primary/40 ring-2 ring-primary/25',
      )}
    >
      <Handle type="target" position={Position.Left} style={{ background: typeColor, borderColor: 'var(--background)' }} />
      <div className="grid gap-2 p-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border"
            style={{
              color: typeColor,
              borderColor: `color-mix(in srgb, ${typeColor} 28%, var(--border))`,
              background: `color-mix(in srgb, ${typeColor} 9%, transparent)`,
            }}
          >
            {nodeIcon(node.kind)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {kindLabel[node.kind]}
              </span>
              <ToneBadge tone={statusTone[node.status]} className="shrink-0 px-1.5 py-0 text-[10px]">
                {statusLabel(node.status)}
              </ToneBadge>
            </div>
            <div className="mt-0.5 break-words text-sm font-semibold leading-tight">
              {node.label}
            </div>
          </div>
        </div>
        {node.subtitle ? (
          <div className="line-clamp-2 break-words text-xs leading-snug text-muted-foreground">
            {node.subtitle}
          </div>
        ) : null}
        {isCandidateNode ? (
          <div className="grid grid-cols-2 gap-1.5">
            {showProbability ? (
              <MiniMetric label={tr('components.modelRouteFlow.probability')} value={formatPercent(node.metrics.probability)} />
            ) : null}
            {showLatency ? (
              <MiniMetric label={tr('components.modelRouteFlow.latency')} value={formatNumber(node.metrics.avgLatencyMs, 'ms')} />
            ) : null}
            {node.metrics.successRate != null ? (
              <MiniMetric label={tr('components.modelAnalysisPanel.successRate')} value={formatPercent(node.metrics.successRate)} />
            ) : null}
            {node.metrics.consecutiveFailureCount != null ? (
              <MiniMetric label={tr('components.modelRouteFlow.failed')} value={String(node.metrics.consecutiveFailureCount)} />
            ) : null}
          </div>
        ) : null}
        {node.badges.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {node.badges.slice(0, 5).map((badge) => (
              <Badge key={badge} variant="secondary" className="max-w-full truncate px-1.5 py-0 text-[10px]">
                {badge}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: typeColor, borderColor: 'var(--background)' }} />
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 px-2 py-1">
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-xs font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function CompactToneBadge({
  tone,
  children,
}: {
  tone: string;
  children: string;
}) {
  return (
    <ToneBadge
      tone={tone}
      title={children}
      className="min-w-0 max-w-full overflow-hidden text-ellipsis"
    >
      {children}
    </ToneBadge>
  );
}

function estimateWrappedLines(value: string | null | undefined, charsPerLine: number): number {
  const text = (value || '').trim();
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

function estimateNodeSize(node: FlowNodeData): NodeSize {
  const isCandidateNode = node.kind === 'route_endpoint';
  const hasHealth = isCandidateNode && (
    node.metrics.totalCalls != null
    || node.metrics.probability != null
    || node.metrics.avgLatencyMs != null
    || node.history.length > 0
  );
  const width = isCandidateNode ? CANDIDATE_NODE_WIDTH : DEFAULT_NODE_WIDTH;
  const contentCharsPerLine = isCandidateNode ? 30 : 28;
  const labelLines = estimateWrappedLines(node.label, contentCharsPerLine);
  const subtitleLines = estimateWrappedLines(node.subtitle, contentCharsPerLine);
  const visibleBadgeCount = Math.min(node.badges.length, 5);
  const badgeRows = visibleBadgeCount > 0 ? Math.ceil(visibleBadgeCount / 3) : 0;
  const height = CARD_VERTICAL_CHROME
    + (labelLines * TEXT_LINE_HEIGHT)
    + (subtitleLines * TEXT_LINE_HEIGHT)
    + (badgeRows * BADGE_ROW_HEIGHT)
    + (hasHealth ? HEALTH_SECTION_HEIGHT : 0);

  return {
    width,
    height: Math.max(hasHealth ? 166 : 112, height),
  };
}

function isCandidateInputEdge(edge: ModelRouteFlowData['edges'][number], flow: ModelRouteFlowData): boolean {
  if (edge.id.startsWith('graph-candidate-supply-')) return true;
  const source = flow.nodes.find((node) => node.id === edge.source);
  const target = flow.nodes.find((node) => node.id === edge.target);
  return source?.kind === 'route_endpoint' && target?.kind === 'dispatcher' && edge.label != null && /%/.test(edge.label);
}

export function layoutNodes(flow: ModelRouteFlowData): Node<FlowNodeData>[] {
  const levels = new Map<string, number>();
  const childrenBySource = new Map<string, string[]>();
  for (const edge of flow.edges) {
    const candidateInput = isCandidateInputEdge(edge, flow);
    const source = candidateInput ? edge.target : edge.source;
    const target = candidateInput ? edge.source : edge.target;
    if (!childrenBySource.has(source)) childrenBySource.set(source, []);
    childrenBySource.get(source)!.push(target);
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

  for (const node of flow.nodes) {
    if (!levels.has(node.id)) levels.set(node.id, node.kind === 'route_endpoint' ? 3 : 0);
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
      if (left.kind === 'request' && right.kind !== 'request') return -1;
      if (right.kind === 'request' && left.kind !== 'request') return 1;
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

  return flow.nodes.map((node) => {
    const size = estimateNodeSize(node);
    return {
      id: node.id,
      type: 'routeNode',
      position: positions.get(node.id) || { x: 0, y: 0 },
      data: node,
      width: size.width,
      height: size.height,
      draggable: false,
    };
  });
}

function ModelRouteFlowEdge(props: EdgeProps<Edge<FlowEdgeData>>) {
  const [path, labelX, labelY] = getBezierPath(props);
  const selectedPath = props.data?.selectedPath === true;
  const candidatePath = props.data?.candidatePath === true;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        interactionWidth={12}
        className={cn(
          'model-route-flow-edge',
          candidatePath && 'model-route-flow-edge-candidate',
          selectedPath && 'model-route-flow-edge-selected',
        )}
      />
      {selectedPath && (
        <BaseEdge
          id={`${props.id}-flow`}
          path={path}
          interactionWidth={0}
          className="model-route-flow-edge-flow"
        />
      )}
      {props.data?.label ? (
        <EdgeLabelRenderer>
          <div
            className={cn(
              'model-route-flow-edge-label nodrag nopan',
              selectedPath && 'is-selected',
              candidatePath && 'is-candidate',
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {props.data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function getCandidateNodes(flow: ModelRouteFlowData): FlowNodeData[] {
  return flow.nodes
    .filter((node) => node.kind === 'route_endpoint')
    .sort((left, right) => {
      if (left.status === 'selected' && right.status !== 'selected') return -1;
      if (right.status === 'selected' && left.status !== 'selected') return 1;
      const leftProbability = left.metrics.probability ?? -1;
      const rightProbability = right.metrics.probability ?? -1;
      if (rightProbability !== leftProbability) return rightProbability - leftProbability;
      return left.label.localeCompare(right.label);
    });
}

function getSelectedCandidate(flow: ModelRouteFlowData): FlowNodeData | null {
  return getCandidateNodes(flow).find((node) => node.status === 'selected') || null;
}

function buildGraphFlow(flow: ModelRouteFlowData, mode: ModelRouteFlowViewMode): ModelRouteFlowData {
  if (mode !== 'effective') return flow;
  const selectedIds = new Set(flow.nodes.filter((node) => node.status === 'selected' || node.kind === 'request' || node.kind === 'entry' || node.kind === 'dispatcher').map((node) => node.id));
  const selectedEdges = flow.edges.filter((edge) => {
    if (selectedIds.has(edge.source) && selectedIds.has(edge.target)) return true;
    const source = flow.nodes.find((node) => node.id === edge.source);
    const target = flow.nodes.find((node) => node.id === edge.target);
    return source?.status === 'selected' || target?.status === 'selected';
  });
  for (const edge of selectedEdges) {
    selectedIds.add(edge.source);
    selectedIds.add(edge.target);
  }
  return {
    ...flow,
    nodes: flow.nodes.filter((node) => selectedIds.has(node.id)),
    edges: selectedEdges,
  };
}

function collectGraphStats(flow: ModelRouteFlowData) {
  const candidates = getCandidateNodes(flow);
  const selected = candidates.find((node) => node.status === 'selected') || null;
  const blockedCount = candidates.filter((node) => node.status === 'blocked').length;
  const pricing = flow.entryPricing?.theoretical || null;
  return {
    candidates,
    selected,
    blockedCount,
    pricing,
  };
}

function ModelRouteGraph({
  flow,
  mode,
  compact,
}: {
  flow: ModelRouteFlowData;
  mode: ModelRouteFlowViewMode;
  compact?: boolean;
}) {
  const nodeTypes = useMemo(() => ({ routeNode: RouteNodeCard }), []);
  const edgeTypes = useMemo(() => ({ routeFlowEdge: ModelRouteFlowEdge }), []);
  const graphFlow = useMemo(() => buildGraphFlow(flow, mode), [flow, mode]);
  const nodes = useMemo(() => layoutNodes(graphFlow), [graphFlow]);
  const selectedNodeIds = useMemo(() => new Set((graphFlow.nodes || []).filter((node) => node.status === 'selected').map((node) => node.id)), [graphFlow]);
  const edges: Edge<FlowEdgeData>[] = useMemo(() => (graphFlow.edges || []).map((edge) => {
    const candidatePath = isCandidateInputEdge(edge, graphFlow);
    const visualSource = candidatePath ? edge.target : edge.source;
    const visualTarget = candidatePath ? edge.source : edge.target;
    const selectedPath = selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target);
    return {
      id: edge.id,
      source: visualSource,
      target: visualTarget,
      type: 'routeFlowEdge',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: {
        label: edge.label || null,
        selectedPath,
        candidatePath,
      },
    };
  }), [graphFlow, selectedNodeIds]);

  return (
    <div className={cn('overflow-hidden rounded-md border bg-card', compact ? 'h-[420px]' : 'h-[640px]')}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.28}
        maxZoom={1.35}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={18} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function SummaryMetric({
  icon,
  label,
  value,
  description,
  tone = 'default',
}: {
  icon: JSX.Element;
  label: string;
  value: React.ReactNode;
  description?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'muted';
}) {
  const toneClassName = tone === 'success'
    ? 'text-success'
    : tone === 'warning'
      ? 'text-warning'
      : tone === 'destructive'
        ? 'text-destructive'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : 'text-foreground';
  return (
    <div className="min-w-0 rounded-md border bg-card p-3">
      <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="inline-flex shrink-0 items-center">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className={cn('mt-1 min-w-0 truncate font-mono text-lg font-semibold tabular-nums', toneClassName)}>
        {value}
      </div>
      {description ? (
        <div className="mt-0.5 min-w-0 truncate text-xs text-muted-foreground">
          {description}
        </div>
      ) : null}
    </div>
  );
}

function FlowHeader({ flow }: { flow: ModelRouteFlowData }) {
  const stats = collectGraphStats(flow);
  const diagnosticsTone = flow.diagnostics.some((item) => item.level === 'error')
    ? 'destructive'
    : flow.diagnostics.some((item) => item.level === 'warn')
      ? 'warning'
      : 'muted';

  return (
    <div className="grid gap-3">
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="text-sm font-semibold">{tr('components.modelRouteFlow.compiledRoutePreview')}</div>
            <ToneBadge tone={flow.matched ? '-success' : 'warning'}>
              {flow.matched ? tr('components.modelRouteFlow.matched') : tr('components.modelRouteFlow.unmatched')}
            </ToneBadge>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{flow.requestedModel}</span>
            <ArrowRight className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate text-foreground">{flow.actualModel}</span>
            <span className="text-muted-foreground/50">·</span>
            <span>{formatDateTime(flow.compiledAt)}</span>
          </div>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap gap-1.5 sm:max-w-[min(34rem,42vw)] sm:justify-end">
          {flow.selectedRouteId != null ? <CompactToneBadge tone="-info">{`route entry (#${flow.selectedRouteId})`}</CompactToneBadge> : null}
          {stats.pricing?.strategy ? <CompactToneBadge tone="-muted">{stats.pricing.strategy}</CompactToneBadge> : null}
          {stats.pricing?.estimateLevel ? (
            <EstimateLevelBadge
              level={stats.pricing.estimateLevel}
              compact
              className="min-w-0 max-w-full overflow-hidden text-ellipsis"
              diagnostics={stats.pricing.diagnostics}
              candidates={stats.pricing.candidates}
              sourceCount={stats.pricing.sourceCount}
              strategy={stats.pricing.strategy}
            />
          ) : null}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric
          icon={<GitBranch className="size-4" />}
          label={tr('components.modelRouteFlow.candidateEndpoints')}
          value={stats.candidates.length}
          description={stats.blockedCount > 0 ? `${stats.blockedCount} ${tr('components.modelRouteFlow.blocked')}` : tr('components.modelRouteFlow.allCandidatesAvailable')}
          tone={stats.blockedCount > 0 ? 'warning' : 'default'}
        />
        <SummaryMetric
          icon={<Cpu className="size-4" />}
          label={tr('components.modelRouteFlow.entryCost')}
          value={formatMoney(stats.pricing?.totalCostUsd)}
          description={stats.pricing ? `${stats.pricing.sourceCount} ${tr('components.modelRouteFlow.sources')} · ${formatEstimateLevel(stats.pricing.estimateLevel)}` : tr('components.modelRouteFlow.noPricingEstimate')}
          tone={stats.pricing ? 'default' : 'muted'}
        />
        <SummaryMetric
          icon={<Cpu className="size-4" />}
          label={tr('components.modelRouteFlow.cashCost')}
          value={formatWalletCost(stats.pricing?.effectiveCost?.walletCostBaseCurrency, stats.pricing?.effectiveCost?.baseCostUnit)}
          description={`${tr('components.modelRouteFlow.freeQuotaCost')} ${formatQuotaDays(stats.pricing?.effectiveCost?.freeQuotaDaysCost)}`}
          tone={stats.pricing?.effectiveCost ? 'default' : 'muted'}
        />
        <SummaryMetric
          icon={<AlertTriangle className="size-4" />}
          label={tr('components.modelRouteFlow.diagnostics')}
          value={flow.diagnostics.length}
          description={flow.diagnostics.length > 0 ? tr('components.modelRouteFlow.reviewDiagnostics') : tr('components.modelRouteFlow.noDiagnostics')}
          tone={diagnosticsTone}
        />
      </div>
    </div>
  );
}

function CandidateHealthBars({ history }: { history: FlowNodeData['history'] }) {
  const recent = history.slice(0, 12);
  if (recent.length === 0) {
    return <span className="text-xs text-muted-foreground">{tr('components.modelRouteFlow.noHistory')}</span>;
  }
  return (
    <div className="flex items-center gap-1">
      {recent.map((item, index) => (
        <span
          key={`${item.at}-${index}`}
          title={`${item.status} ${item.httpStatus ?? ''} ${formatDateTime(item.at)} ${item.message || ''}`.trim()}
          className={cn(
            'h-2.5 w-5 rounded-full',
            item.status === 'success' && 'bg-success',
            item.status === 'retried' && 'bg-warning',
            item.status === 'failed' && 'bg-destructive',
          )}
        />
      ))}
    </div>
  );
}

function CandidateList({ flow, dense = false }: { flow: ModelRouteFlowData; dense?: boolean }) {
  const candidates = getCandidateNodes(flow);
  const pricingCandidates = flow.entryPricing?.theoretical?.candidates || [];
  if (candidates.length === 0) {
    return (
      <Empty className="min-h-52 rounded-md border bg-card">
        <EmptyHeader>
          <EmptyIcon><Server className="size-5" /></EmptyIcon>
          <EmptyTitle>{tr('components.modelRouteFlow.noCandidateEndpoints')}</EmptyTitle>
          <EmptyDescription>{tr('components.modelRouteFlow.noCandidateEndpointsDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid gap-2">
      {candidates.map((candidate) => {
        const pricing = pricingCandidates.find((item) => (
          item.targetId === candidate.id.replace(/^graph:/, '')
          || item.nodeId === candidate.id.replace(/^graph:/, '')
          || item.endpointId === candidate.id.replace(/^graph:/, '')
          || item.sourceRef?.endpointId === candidate.id.replace(/^graph:/, '')
        ));
        return (
          <div
            key={candidate.id}
            className={cn(
              'grid gap-3 rounded-md border bg-card p-3',
              !dense && 'md:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]',
              candidate.status === 'selected' && 'border-primary/40 ring-2 ring-primary/15',
            )}
          >
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">{candidate.label}</span>
                <ToneBadge tone={statusTone[candidate.status]}>{statusLabel(candidate.status)}</ToneBadge>
                {candidate.metrics.priority != null ? <ToneBadge tone="-muted">P{candidate.metrics.priority}</ToneBadge> : null}
                {candidate.metrics.weight != null ? <ToneBadge tone="-muted">W{candidate.metrics.weight}</ToneBadge> : null}
              </div>
              {candidate.subtitle ? (
                <div className="mt-1 break-words text-xs text-muted-foreground">{candidate.subtitle}</div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1">
                {candidate.badges.slice(0, 10).map((badge) => (
                  <Badge key={badge} variant="secondary" className="max-w-full truncate">{badge}</Badge>
                ))}
              </div>
            </div>
            <div className="grid min-w-0 gap-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniMetric label={tr('components.modelRouteFlow.probability')} value={formatPercent(candidate.metrics.probability)} />
                <MiniMetric label={tr('components.modelAnalysisPanel.successRate')} value={formatPercent(candidate.metrics.successRate)} />
                <MiniMetric label={tr('components.modelRouteFlow.latency')} value={formatNumber(candidate.metrics.avgLatencyMs, 'ms')} />
                <MiniMetric label={tr('components.modelAnalysisPanel.calls')} value={String(candidate.metrics.totalCalls ?? 0)} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <CandidateHealthBars history={candidate.history} />
                <span>{tr('components.modelRouteFlow.cooldown')}: {candidate.metrics.cooldownUntil ? formatDateTime(candidate.metrics.cooldownUntil) : tr('components.modelRouteFlow.none')}</span>
              </div>
              {pricing ? (
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{tr('components.modelRouteFlow.input')}: <span className="font-mono text-foreground">{formatMoney(pricing.inputPerMillion)}</span></span>
                  <span>{tr('components.modelRouteFlow.output')}: <span className="font-mono text-foreground">{formatMoney(pricing.outputPerMillion)}</span></span>
                  <span>{tr('components.modelRouteFlow.cost')}: <span className="font-mono text-foreground">{formatMoney(pricing.totalCostUsd)}</span></span>
                  <span>{tr('components.modelRouteFlow.cashCost')}: <span className="font-mono text-foreground">{formatWalletCost(pricing.effectiveCost?.walletCostBaseCurrency, pricing.effectiveCost?.baseCostUnit)}</span></span>
                  <span>{tr('components.modelRouteFlow.freeQuotaCost')}: <span className="font-mono text-foreground">{formatQuotaDays(pricing.effectiveCost?.freeQuotaDaysCost)}</span></span>
                  <span>{tr('components.modelRouteFlow.upstreamBalanceCost')}: <span className="font-mono text-foreground">{formatBalanceBurn(pricing.effectiveCost?.balanceBurn)}</span></span>
                  <span>{tr('components.modelRouteFlow.probability')}: <span className="font-mono text-foreground">{formatProbabilityRatio(pricing.probability)}</span></span>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DiagnosticsView({ flow }: { flow: ModelRouteFlowData }) {
  const pricingDiagnostics = flow.entryPricing?.theoretical?.diagnostics || [];
  const diagnostics = [...flow.diagnostics, ...pricingDiagnostics];
  if (diagnostics.length === 0) {
    return (
      <Empty className="min-h-52 rounded-md border bg-card">
        <EmptyHeader>
          <EmptyIcon><CheckCircle2 className="size-5" /></EmptyIcon>
          <EmptyTitle>{tr('components.modelRouteFlow.noDiagnostics')}</EmptyTitle>
          <EmptyDescription>{tr('components.modelRouteFlow.noDiagnosticsDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="grid gap-2">
      {diagnostics.map((item, index) => (
        <div
          key={`${item.level}-${item.message}-${index}`}
          className={cn(
            'flex gap-2 rounded-md border bg-card p-3 text-sm',
            item.level === 'error' && 'border-destructive/30',
            item.level === 'warn' && 'border-warning/30',
          )}
        >
          <span className={cn(
            'mt-0.5 shrink-0',
            item.level === 'error' && 'text-destructive',
            item.level === 'warn' && 'text-warning',
            item.level === 'info' && 'text-muted-foreground',
          )}
          >
            {item.level === 'info' ? <Info className="size-4" /> : <AlertTriangle className="size-4" />}
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{item.level}</div>
            <div className="mt-0.5 break-words text-foreground">{item.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CompiledDetails({ flow }: { flow: ModelRouteFlowData }) {
  const pricing = flow.entryPricing?.theoretical || null;
  const layers = flow.compatibilityPolicy?.layers || [];
  const compatibility = flow.compatibilityPolicy?.resolved || null;
  const configuredLayerCount = layers.filter((layer) => layer.configured).length;
  const shape = {
    entries: flow.nodes.filter((node) => node.kind === 'entry').length,
    selectors: flow.nodes.filter((node) => node.kind === 'dispatcher').length,
    filters: flow.nodes.filter((node) => node.kind === 'filter').length,
    endpoints: getCandidateNodes(flow).length,
    synthetic: flow.nodes.filter((node) => node.kind === 'synthetic_endpoint').length,
  };
  return (
    <div className="grid gap-3 xl:grid-cols-3">
      <Card>
        <CardContent className="grid gap-3 p-3">
          <div>
            <div className="text-sm font-semibold">{tr('components.modelRouteFlow.compiledShape')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{tr('components.modelRouteFlow.compiledShapeDescription')}</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <MiniMetric label={tr('components.modelRouteFlow.publicEntries')} value={String(shape.entries)} />
            <MiniMetric label={tr('components.modelRouteFlow.selectors')} value={String(shape.selectors)} />
            <MiniMetric label={tr('components.modelRouteFlow.filters')} value={String(shape.filters)} />
            <MiniMetric label={tr('components.modelRouteFlow.endpoints')} value={String(shape.endpoints)} />
          </div>
          <div className="grid gap-2 text-sm">
            <KeyValue label={tr('components.modelRouteFlow.selectedRoute')} value={flow.selectedRouteId == null ? tr('common.notAvailable') : `ID #${flow.selectedRouteId}`} />
            <KeyValue label={tr('components.modelRouteFlow.syntheticResponses')} value={String(shape.synthetic)} />
            <KeyValue label={tr('components.modelRouteFlow.compiledAt')} value={formatDateTime(flow.compiledAt)} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-3 p-3">
          <div>
            <div className="text-sm font-semibold">{tr('components.modelRouteFlow.pricingInputs')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{tr('components.modelRouteFlow.pricingInputsDescription')}</div>
          </div>
          {pricing ? (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <MiniMetric label={tr('components.modelRouteFlow.input')} value={formatMoney(pricing.inputPerMillion)} />
                <MiniMetric label={tr('components.modelRouteFlow.output')} value={formatMoney(pricing.outputPerMillion)} />
                <MiniMetric label={tr('components.modelRouteFlow.cost')} value={formatMoney(pricing.totalCostUsd)} />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <MiniMetric label={tr('components.modelRouteFlow.cashCost')} value={formatWalletCost(pricing.effectiveCost?.walletCostBaseCurrency, pricing.effectiveCost?.baseCostUnit)} />
                <MiniMetric label={tr('components.modelRouteFlow.freeQuotaCost')} value={formatQuotaDays(pricing.effectiveCost?.freeQuotaDaysCost)} />
                <MiniMetric label={tr('components.modelRouteFlow.upstreamBalanceCost')} value={formatBalanceBurn(pricing.effectiveCost?.balanceBurn)} />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <MiniMetric label={tr('components.modelRouteFlow.inputMultiplier')} value={formatMultiplier(pricing.inputMultiplier)} />
                <MiniMetric label={tr('components.modelRouteFlow.outputMultiplier')} value={formatMultiplier(pricing.outputMultiplier)} />
                <MiniMetric label={tr('components.modelRouteFlow.totalMultiplier')} value={formatMultiplier(pricing.totalMultiplier)} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {pricing.strategy ? <ToneBadge tone="-muted">{pricing.strategy}</ToneBadge> : null}
                <EstimateLevelBadge
                  level={pricing.estimateLevel}
                  diagnostics={pricing.diagnostics}
                  candidates={pricing.candidates}
                  sourceCount={pricing.sourceCount}
                  strategy={pricing.strategy}
                />
                <ToneBadge tone="-muted">{pricing.sourceCount} {tr('components.modelRouteFlow.sources')}</ToneBadge>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">{tr('components.modelRouteFlow.noPricingEstimate')}</div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-3 p-3">
          <div>
            <div className="text-sm font-semibold">{tr('components.modelRouteFlow.resolvedPolicySnapshot')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{tr('components.modelRouteFlow.resolvedPolicySnapshotDescription')}</div>
          </div>
          {compatibility ? (
            <div className="grid gap-2 text-sm">
              <KeyValue label={tr('components.modelRouteFlow.reasoningMode')} value={compatibility.reasoningHistory.transport.mode} />
              <KeyValue label={tr('components.modelRouteFlow.requestTransforms')} value={String(compatibility.requestTransforms.length)} />
              <KeyValue label={tr('components.modelRouteFlow.payloadDefaults')} value={String(compatibility.payloadDefaults.length)} />
              <KeyValue label={tr('components.modelRouteFlow.configuredLayers')} value={`${configuredLayerCount}/${layers.length}`} />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">{tr('components.modelRouteFlow.noCompatibilityLayers')}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-muted/40 px-2 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-xs font-semibold">{value}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-72 items-center justify-center rounded-md border bg-card p-8 text-center">
      <div className="grid justify-items-center gap-2">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        <div className="text-sm font-medium">{tr('components.modelRouteFlow.routes')}</div>
        <div className="max-w-sm text-xs text-muted-foreground">{tr('components.modelRouteFlow.loadingDescription')}</div>
      </div>
    </div>
  );
}

function CompactLoadingState() {
  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-md border bg-card p-3">
      <div className="flex min-w-0 items-center gap-2">
        <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-sm font-medium">{tr('components.modelRouteFlow.routes')}</div>
          <div className="line-clamp-2 text-xs text-muted-foreground">{tr('components.modelRouteFlow.loadingDescription')}</div>
        </div>
      </div>
    </div>
  );
}

function EmptyFlowState() {
  return (
    <Empty className="min-h-72 rounded-md border bg-card">
      <EmptyHeader>
        <EmptyIcon><GitBranch className="size-5" /></EmptyIcon>
        <EmptyTitle>{tr('components.modelRouteFlow.selectmodelRoutes')}</EmptyTitle>
        <EmptyDescription>{tr('components.modelRouteFlow.selectmodelRoutesDescription')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function CompactEmptyFlowState() {
  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-md border bg-card p-3">
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-sm font-medium">{tr('components.modelRouteFlow.selectmodelRoutes')}</div>
          <div className="line-clamp-2 text-xs text-muted-foreground">{tr('components.modelRouteFlow.selectmodelRoutesDescription')}</div>
        </div>
      </div>
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  return (
    <div className="flex min-h-40 gap-3 rounded-md border border-destructive/30 bg-card p-4">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-destructive">{tr('components.modelRouteFlow.loadFailed')}</div>
        <div className="mt-1 break-words text-sm text-muted-foreground">{error}</div>
      </div>
    </div>
  );
}

function CompactErrorState({ error }: { error: string }) {
  return (
    <div className="flex w-full min-w-0 max-w-full overflow-hidden rounded-md border border-destructive/30 bg-card p-3">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-destructive">{tr('components.modelRouteFlow.loadFailed')}</div>
        <div className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">{error}</div>
      </div>
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md bg-muted/35 px-2 py-1.5">
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-xs font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function CompactModelLine({
  label,
  value,
  active = false,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-2">
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          'line-clamp-2 min-w-0 break-all text-xs leading-snug',
          active ? 'font-semibold text-foreground' : 'text-muted-foreground',
        )}
        title={value}
      >
        {value || tr('common.notAvailable')}
      </div>
    </div>
  );
}

function CompactCandidateRow({ candidate }: { candidate: FlowNodeData }) {
  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-md border bg-background/60 px-2.5 py-2',
        candidate.status === 'selected' && 'border-success/30 bg-success/5',
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className="mt-1.5 size-2 shrink-0 rounded-full"
          style={{ background: statusColor[candidate.status] || statusColor.inactive }}
        />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 break-all text-xs font-medium leading-snug" title={candidate.label}>
            {candidate.label}
          </div>
          {candidate.subtitle ? (
            <div className="mt-0.5 line-clamp-1 break-all text-[11px] leading-snug text-muted-foreground" title={candidate.subtitle}>
              {candidate.subtitle}
            </div>
          ) : null}
          <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px] leading-5 text-muted-foreground">
            <span className="whitespace-nowrap">
              {tr('components.modelRouteFlow.probability')} <span className="font-mono text-foreground">{formatPercent(candidate.metrics.probability)}</span>
            </span>
            <span className="whitespace-nowrap">
              {tr('components.modelRouteFlow.latency')} <span className="font-mono text-foreground">{formatNumber(candidate.metrics.avgLatencyMs, 'ms')}</span>
            </span>
            <span className="whitespace-nowrap">
              {tr('components.modelAnalysisPanel.successRate')} <span className="font-mono text-foreground">{formatPercent(candidate.metrics.successRate)}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompactRouteFlow({ flow }: { flow: ModelRouteFlowData }) {
  const stats = collectGraphStats(flow);
  const selected = stats.selected;
  const visibleCandidates = stats.candidates.slice(0, 3);
  const hiddenCandidateCount = Math.max(0, stats.candidates.length - visibleCandidates.length);
  const diagnosticsTone = flow.diagnostics.some((item) => item.level === 'error')
    ? 'destructive'
    : flow.diagnostics.some((item) => item.level === 'warn')
      ? 'warning'
      : '-muted';
  const selectedMeta = selected
    ? [
      `${tr('components.modelRouteFlow.probability')} ${formatPercent(selected.metrics.probability)}`,
      `${tr('components.modelRouteFlow.latency')} ${formatNumber(selected.metrics.avgLatencyMs, 'ms')}`,
      `${tr('components.modelAnalysisPanel.successRate')} ${formatPercent(selected.metrics.successRate)}`,
    ].join(' · ')
    : '';

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-md border bg-card text-card-foreground">
      <div className="grid min-w-0 gap-2 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">
            {tr('components.modelRouteFlow.compactRouteSummary')}
          </div>
          <ToneBadge tone={flow.matched ? '-success' : 'warning'} className="shrink-0 px-1.5 py-0 text-[10px]">
            {flow.matched ? tr('components.modelRouteFlow.matched') : tr('components.modelRouteFlow.unmatched')}
          </ToneBadge>
        </div>

        <div className="grid min-w-0 gap-1.5 rounded-md bg-muted/35 p-2">
          <CompactModelLine label={tr('components.modelRouteFlow.requestedModel')} value={flow.requestedModel} />
          <CompactModelLine label={tr('components.modelRouteFlow.actualModel')} value={flow.actualModel} active />
        </div>

        <div className="min-w-0 overflow-hidden rounded-md border border-success/20 bg-success/5 p-2.5">
          {selected ? (
            <div className="flex min-w-0 items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {tr('components.modelRouteFlow.selectedTarget')}
                </div>
                <div className="mt-0.5 line-clamp-2 break-all text-sm font-semibold leading-snug" title={selected.label}>
                  {selected.label}
                </div>
                {selected.subtitle ? (
                  <div className="mt-0.5 line-clamp-1 break-all text-xs text-muted-foreground" title={selected.subtitle}>
                    {selected.subtitle}
                  </div>
                ) : null}
                {selectedMeta ? (
                  <div className="mt-1 line-clamp-2 break-all text-[11px] leading-snug text-muted-foreground">
                    {selectedMeta}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <Target className="size-4 shrink-0" />
              <span>{tr('components.modelRouteFlow.noSelectedTarget')}</span>
            </div>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5">
          <CompactMetric label={tr('components.modelRouteFlow.candidateEndpoints')} value={String(stats.candidates.length)} />
          <CompactMetric label={tr('components.modelRouteFlow.entryCost')} value={formatMoney(stats.pricing?.totalCostUsd)} />
          <CompactMetric label={tr('components.modelRouteFlow.blocked')} value={String(stats.blockedCount)} />
          <CompactMetric label={tr('components.modelRouteFlow.diagnostics')} value={String(flow.diagnostics.length)} />
        </div>

        <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {flow.selectedRouteId != null ? (
            <span className="max-w-full truncate">
              {tr('components.modelRouteFlow.selectedRoute')} <span className="font-mono text-foreground">ID #{flow.selectedRouteId}</span>
            </span>
          ) : null}
          {stats.pricing?.estimateLevel ? (
            <span className="max-w-full truncate">
              {formatEstimateLevel(stats.pricing.estimateLevel)}
            </span>
          ) : null}
          <span className={cn(
            'max-w-full truncate',
            diagnosticsTone === 'destructive' && 'text-destructive',
            diagnosticsTone === 'warning' && 'text-warning',
          )}
          >
            {flow.diagnostics.length > 0 ? tr('components.modelRouteFlow.reviewDiagnostics') : tr('components.modelRouteFlow.noDiagnostics')}
          </span>
        </div>

        {visibleCandidates.length > 0 ? (
          <div className="grid min-w-0 gap-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate font-medium">{tr('components.modelRouteFlow.candidates')}</span>
              {hiddenCandidateCount > 0 ? <span className="shrink-0">{`+${hiddenCandidateCount}`}</span> : null}
            </div>
            <div className="grid min-w-0 gap-1.5">
              {visibleCandidates.map((candidate) => (
                <CompactCandidateRow key={candidate.id} candidate={candidate} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const modeItems: Array<{ value: ModelRouteFlowViewMode; labelKey: string; descriptionKey: string }> = [
  {
    value: 'effective',
    labelKey: 'components.modelRouteFlow.effectivePath',
    descriptionKey: 'components.modelRouteFlow.effectivePathDescription',
  },
  {
    value: 'candidates',
    labelKey: 'components.modelRouteFlow.candidates',
    descriptionKey: 'components.modelRouteFlow.candidatesDescription',
  },
  {
    value: 'compiled',
    labelKey: 'components.modelRouteFlow.compiled',
    descriptionKey: 'components.modelRouteFlow.compiledDescription',
  },
  {
    value: 'diagnostics',
    labelKey: 'components.modelRouteFlow.diagnostics',
    descriptionKey: 'components.modelRouteFlow.diagnosticsDescription',
  },
];

export default function ModelRouteFlow({
  flow,
  loading = false,
  error = '',
  viewMode,
  onViewModeChange,
  compact = false,
}: ModelRouteFlowProps) {
  const [internalViewMode, setInternalViewMode] = useState<ModelRouteFlowViewMode>('effective');
  if (loading) return compact ? <CompactLoadingState /> : <LoadingState />;
  if (error) return compact ? <CompactErrorState error={error} /> : <ErrorState error={error} />;
  if (!flow) return compact ? <CompactEmptyFlowState /> : <EmptyFlowState />;
  if (compact) return <CompactRouteFlow flow={flow} />;

  const resolvedViewMode = viewMode ?? internalViewMode;
  const currentMode = modeItems.some((item) => item.value === resolvedViewMode) ? resolvedViewMode : 'effective';
  const activeMode = modeItems.find((item) => item.value === currentMode) || modeItems[0]!;
  const handleViewModeChange = (value: string) => {
    const next = value as ModelRouteFlowViewMode;
    if (!modeItems.some((item) => item.value === next)) return;
    if (viewMode == null) setInternalViewMode(next);
    onViewModeChange?.(next);
  };

  return (
    <div className="grid min-w-0 gap-3">
      <FlowHeader flow={flow} />
      <Tabs.Tabs value={currentMode} onValueChange={handleViewModeChange}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Tabs.TabsList className="h-auto flex-wrap justify-start">
            {modeItems.map((item) => (
              <Tabs.TabsTrigger key={item.value} value={item.value}>
                {tr(item.labelKey)}
              </Tabs.TabsTrigger>
            ))}
          </Tabs.TabsList>
          <div className="max-w-xl text-xs text-muted-foreground">{tr(activeMode.descriptionKey)}</div>
        </div>
        <Tabs.TabsContent value="effective" className="mt-3">
          <div className="grid gap-3">
            <SelectedTargetStrip flow={flow} />
            <ModelRouteGraph flow={flow} mode="effective" compact={compact} />
          </div>
        </Tabs.TabsContent>
        <Tabs.TabsContent value="candidates" className="mt-3">
          <div className="grid gap-3">
            <ModelRouteGraph flow={flow} mode="candidates" compact={compact} />
            <CandidateList flow={flow} />
          </div>
        </Tabs.TabsContent>
        <Tabs.TabsContent value="compiled" className="mt-3">
          <CompiledDetails flow={flow} />
        </Tabs.TabsContent>
        <Tabs.TabsContent value="diagnostics" className="mt-3">
          <DiagnosticsView flow={flow} />
        </Tabs.TabsContent>
      </Tabs.Tabs>
    </div>
  );
}

function SelectedTargetStrip({ flow }: { flow: ModelRouteFlowData }) {
  const selected = getSelectedCandidate(flow);
  if (!selected) {
    return (
      <div className="rounded-md border bg-card p-3">
        <div className="text-sm font-semibold">{tr('components.modelRouteFlow.selectedTarget')}</div>
        <div className="mt-1 text-xs text-muted-foreground">{tr('components.modelRouteFlow.noSelectedTarget')}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-3">
      <div className="flex min-w-0 flex-[1_1_320px] items-center gap-2">
        <CheckCircle2 className="size-4 shrink-0 text-success" />
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{tr('components.modelRouteFlow.selectedTarget')}</div>
          <div className="truncate text-sm font-semibold">{selected.label}</div>
          {selected.subtitle ? <div className="truncate text-xs text-muted-foreground">{selected.subtitle}</div> : null}
        </div>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniMetric label={tr('components.modelRouteFlow.probability')} value={formatPercent(selected.metrics.probability)} />
        <MiniMetric label={tr('components.modelRouteFlow.latency')} value={formatNumber(selected.metrics.avgLatencyMs, 'ms')} />
        <MiniMetric label={tr('components.modelAnalysisPanel.successRate')} value={formatPercent(selected.metrics.successRate)} />
        <MiniMetric label={tr('components.modelAnalysisPanel.calls')} value={String(selected.metrics.totalCalls ?? 0)} />
      </div>
      <div className="min-w-36">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{tr('components.modelRouteFlow.recentHealth')}</div>
        <CandidateHealthBars history={selected.history} />
      </div>
    </div>
  );
}
