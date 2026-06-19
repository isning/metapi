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

type RouteFlowNodeKind = 'request' | 'route' | 'transform' | 'pool' | 'channel';
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
  compiledAt: string;
};

type FlowNodeData = ModelRouteFlowData['nodes'][number];

type ModelRouteFlowProps = {
  flow: ModelRouteFlowData | null;
  loading?: boolean;
  error?: string;
};

const statusColor: Record<RouteFlowNodeStatus, string> = {
  active: '#2563eb',
  selected: '#059669',
  available: '#0f766e',
  blocked: '#dc2626',
  inactive: '#64748b',
};

const kindLabel: Record<RouteFlowNodeKind, string> = {
  request: 'Request',
  route: 'Route',
  transform: 'Filter',
  pool: 'Pool',
  channel: 'Channel',
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
              <Metric label="成功率" value={formatPercent(node.metrics.successRate)} />
              <Metric label="概率" value={formatPercent(node.metrics.probability)} />
              <Metric label="调用" value={String(node.metrics.totalCalls ?? 0)} />
              <Metric label="延迟" value={node.metrics.avgLatencyMs == null ? 'n/a' : `${node.metrics.avgLatencyMs}ms`} />
              <Metric label="连续失败" value={String(node.metrics.consecutiveFailureCount ?? 0)} />
              <Metric label="冷却" value={node.metrics.cooldownUntil ? formatDateTime(node.metrics.cooldownUntil) : 'none'} />
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
                        ? '#10b981'
                        : (item.status === 'retried' ? '#f59e0b' : '#ef4444'),
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

function layoutNodes(flow: ModelRouteFlowData): Node<FlowNodeData>[] {
  const levels = new Map<string, number>();
  const childrenBySource = new Map<string, string[]>();
  for (const edge of flow.edges) {
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

  const byLevel = new Map<number, FlowNodeData[]>();
  for (const node of flow.nodes) {
    const level = levels.get(node.id) ?? 0;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push(node);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, nodes] of byLevel.entries()) {
    const sorted = [...nodes].sort((left, right) => {
      if (left.status === 'selected' && right.status !== 'selected') return -1;
      if (right.status === 'selected' && left.status !== 'selected') return 1;
      return left.id.localeCompare(right.id);
    });
    const startY = -((sorted.length - 1) * 130) / 2;
    sorted.forEach((node, index) => {
      positions.set(node.id, {
        x: level * 300,
        y: startY + index * 130,
      });
    });
  }

  return flow.nodes.map((node) => ({
    id: node.id,
    type: 'routeNode',
    position: positions.get(node.id) || { x: 0, y: 0 },
    data: node,
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
    style: { stroke: '#64748b', strokeWidth: 1.5 },
    labelStyle: { fontSize: 11, fill: '#475569', fontWeight: 600 },
  })), [flow]);

  if (loading) {
    return <div className="p-3.5 text-xs text-muted-foreground">正在编译路由流程...</div>;
  }

  if (error) {
    return <div className="p-3.5 text-xs text-destructive">{error}</div>;
  }

  if (!flow) {
    return <div className="p-3.5 text-xs text-muted-foreground">选择模型后显示完整路由流程。</div>;
  }

  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>compiled {formatDateTime(flow.compiledAt)}</span>
        <span>route {flow.routePattern || 'n/a'}</span>
        <span>actual {flow.actualModel}</span>
        <span>channel {flow.selectedChannelId ?? 'n/a'}</span>
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
          <Background color="#cbd5e1" gap={18} />
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
