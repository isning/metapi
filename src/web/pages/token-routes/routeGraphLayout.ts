import { macroFlowNodeId } from './routeGraphConnections.js';
import type { RouteGraphEdge, RouteGraphMacro, RouteGraphNode } from './routeGraphTypes.js';

export type RouteGraphLayoutSource = {
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
  macros: RouteGraphMacro[];
};

export type RouteGraphLayoutOptions = {
  preserveExistingPositions?: boolean;
};

type LayoutItem = {
  id: string;
  kind: 'node' | 'macro';
  node?: RouteGraphNode;
  macro?: RouteGraphMacro;
};

const ORIGIN_X = 120;
const ORIGIN_Y = 96;
const COLUMN_GAP = 284;
const ROW_GAP = 112;
const MACRO_ROW_GAP = 120;
const GROUP_GAP = 32;

function getItemId(item: LayoutItem): string {
  return item.kind === 'macro' ? macroFlowNodeId(item.macro!.id) : item.node!.id;
}

function getExistingPosition(item: LayoutItem): { x: number; y: number } | undefined {
  return item.kind === 'macro' ? item.macro!.position : item.node!.position;
}

function getItemRank(item: LayoutItem): number {
  if (item.kind === 'macro') return 20;
  const type = item.node!.type;
  if (type === 'entry') return 0;
  if (type === 'filter') return 10;
  if (type === 'dispatcher') return 30;
  if (type === 'route_endpoint') return 40;
  if (type === 'synthetic_endpoint') return 50;
  return 60;
}

function getItemRowGapWithOptions(item: LayoutItem, options: RouteGraphLayoutOptions): number {
  void options;
  if (item.kind !== 'macro') return ROW_GAP;
  return estimateRouteGraphMacroRowGap(item.macro!);
}

export function getRouteGraphMacroRowGap(): number {
  return MACRO_ROW_GAP;
}

export function estimateRouteGraphMacroRowGap(macro: RouteGraphMacro): number {
  void macro;
  return getRouteGraphMacroRowGap();
}

function getItemGroupRank(item: LayoutItem): number {
  if (item.kind === 'macro') return 1;
  const ownership = item.node!.ownership;
  if (ownership === 'manual') return 0;
  if (ownership === 'auto_generated') return 2;
  if (ownership === 'derived') return 3;
  return 4;
}

function sortLayoutItems(left: LayoutItem, right: LayoutItem): number {
  const leftGroup = getItemGroupRank(left);
  const rightGroup = getItemGroupRank(right);
  if (leftGroup !== rightGroup) return leftGroup - rightGroup;

  const leftRank = getItemRank(left);
  const rightRank = getItemRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;

  const leftId = getItemId(left);
  const rightId = getItemId(right);
  const leftPriority = left.kind === 'macro' ? getMacroPriority(left.macro!) : getNodePriority(left.node!);
  const rightPriority = right.kind === 'macro' ? getMacroPriority(right.macro!) : getNodePriority(right.node!);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  return leftId.localeCompare(rightId);
}

function getNodePriority(node: RouteGraphNode): number {
  const raw = node.priority ?? node.routeId ?? node.id.match(/\d+/)?.[0];
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function getMacroPriority(macro: RouteGraphMacro): number {
  const groups = Array.isArray(macro.config?.groups) ? macro.config.groups : [];
  const priorities = groups
    .map((group) => Number((group as { priority?: unknown }).priority))
    .filter((value) => Number.isFinite(value));
  if (priorities.length > 0) return Math.min(...priorities);
  const value = Number(macro.metadata?.priority ?? macro.id.match(/\d+/)?.[0]);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function normalizeEndpointId(id: string): string {
  return id;
}

export function layoutRouteGraph<TGraph extends RouteGraphLayoutSource>(
  graph: TGraph,
  options: RouteGraphLayoutOptions = {},
): TGraph {
  const preserveExistingPositions = options.preserveExistingPositions !== false;
  const items: LayoutItem[] = [
    ...graph.nodes.map((node): LayoutItem => ({ id: node.id, kind: 'node', node })),
    ...graph.macros.map((macro): LayoutItem => ({ id: macroFlowNodeId(macro.id), kind: 'macro', macro })),
  ];
  const itemById = new Map(items.map((item) => [normalizeEndpointId(getItemId(item)), item]));
  const childrenBySource = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();

  for (const item of items) incomingCount.set(getItemId(item), 0);
  for (const edge of graph.edges) {
    const source = normalizeEndpointId(edge.sourceNodeId);
    const target = normalizeEndpointId(edge.targetNodeId);
    if (!itemById.has(source) || !itemById.has(target)) continue;
    if (!childrenBySource.has(source)) childrenBySource.set(source, []);
    childrenBySource.get(source)!.push(target);
    incomingCount.set(target, (incomingCount.get(target) || 0) + 1);
  }

  const roots = items
    .filter((item) => {
      if (item.kind === 'node' && item.node!.type === 'entry' && item.node!.visibility === 'public') return true;
      return (incomingCount.get(getItemId(item)) || 0) === 0;
    })
    .sort(sortLayoutItems)
    .map(getItemId);

  const queue: Array<{ id: string; level: number }> = roots.map((id) => ({ id, level: 0 }));
  const levels = new Map<string, number>();
  while (queue.length > 0) {
    const item = queue.shift()!;
    const current = levels.get(item.id);
    if (current !== undefined && current <= item.level) continue;
    levels.set(item.id, item.level);
    const children = [...(childrenBySource.get(item.id) || [])].sort((left, right) => {
      const leftItem = itemById.get(left);
      const rightItem = itemById.get(right);
      if (!leftItem || !rightItem) return left.localeCompare(right);
      return sortLayoutItems(leftItem, rightItem);
    });
    for (const child of children) queue.push({ id: child, level: item.level + 1 });
  }

  const byLevel = new Map<number, LayoutItem[]>();
  for (const item of items) {
    const id = getItemId(item);
    const level = levels.get(id) ?? 0;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push(item);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, levelItems] of [...byLevel.entries()].sort((left, right) => left[0] - right[0])) {
    let cursorY = ORIGIN_Y;
    const groups = new Map<number, LayoutItem[]>();
    for (const item of [...levelItems].sort(sortLayoutItems)) {
      const group = getItemGroupRank(item);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(item);
    }

    for (const [, groupItems] of [...groups.entries()].sort((left, right) => left[0] - right[0])) {
      for (const item of groupItems) {
        const id = getItemId(item);
        const existing = getExistingPosition(item);
        positions.set(id, preserveExistingPositions && existing ? existing : {
          x: ORIGIN_X + level * COLUMN_GAP,
          y: cursorY,
        });
        cursorY += getItemRowGapWithOptions(item, options);
      }
      cursorY += GROUP_GAP;
    }
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, position: positions.get(node.id) || node.position })),
    macros: graph.macros.map((macro) => ({ ...macro, position: positions.get(macroFlowNodeId(macro.id)) || macro.position })),
  };
}
