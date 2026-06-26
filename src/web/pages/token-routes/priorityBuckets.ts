import type { RouteEndpointTarget } from './types.js';
import { normalizeTargets } from './utils.js';

export const PRIORITY_BUCKET_SEPARATOR_PREFIX = 'priority-separator:';

export type PriorityBucket = {
  priority: number;
  targets: RouteEndpointTarget[];
};

type PriorityBucketEditorTargetItem = {
  id: number;
  kind: 'route_target';
  target: RouteEndpointTarget;
};

type PriorityBucketEditorSeparatorItem = {
  id: string;
  kind: 'separator';
};

export type PriorityBucketEditorItem = PriorityBucketEditorTargetItem | PriorityBucketEditorSeparatorItem;

export function createPriorityBucketSeparatorId(index: number): string {
  return `${PRIORITY_BUCKET_SEPARATOR_PREFIX}${index}`;
}

export function isPriorityBucketSeparatorId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PRIORITY_BUCKET_SEPARATOR_PREFIX);
}

export function buildPriorityBuckets(targets: RouteEndpointTarget[]): PriorityBucket[] {
  const grouped = new Map<number, RouteEndpointTarget[]>();
  for (const target of normalizeTargets(targets || [])) {
    const priority = target.priority ?? 0;
    if (!grouped.has(priority)) grouped.set(priority, []);
    grouped.get(priority)!.push(target);
  }
  return Array.from(grouped.entries()).map(([priority, bucketTargets]) => ({
    priority,
    targets: bucketTargets,
  }));
}

export function buildPriorityBucketEditorItems(targets: RouteEndpointTarget[]): PriorityBucketEditorItem[] {
  const buckets = buildPriorityBuckets(targets);
  const items: PriorityBucketEditorItem[] = [];
  buckets.forEach((bucket, index) => {
    for (const target of bucket.targets) {
      items.push({ id: target.id, kind: 'route_target', target });
    }
    if (index < buckets.length - 1) {
      items.push({ id: createPriorityBucketSeparatorId(index), kind: 'separator' });
    }
  });
  return items;
}

export function splitPriorityBucketAfterTarget(
  targets: RouteEndpointTarget[],
  targetId: number,
): RouteEndpointTarget[] {
  const normalized = normalizeTargets(targets || []);
  if (normalized.length <= 1) return normalized;

  const items = buildPriorityBucketEditorItems(normalized);
  const targetIndex = items.findIndex((item) => item.kind === 'route_target' && item.id === targetId);
  if (targetIndex < 0) return normalized;

  const nextItem = items[targetIndex + 1];
  if (!nextItem || nextItem.kind === 'separator') {
    return normalized;
  }

  const next = [...items];
  next.splice(targetIndex + 1, 0, {
    id: `${PRIORITY_BUCKET_SEPARATOR_PREFIX}split:${targetId}`,
    kind: 'separator',
  });
  return denseRenormalizeTargets(next);
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function denseRenormalizeTargets(items: PriorityBucketEditorItem[]): RouteEndpointTarget[] {
  let rawBucketIndex = 0;
  let nextPriority = 0;
  const rawToDense = new Map<number, number>();
  const reordered: RouteEndpointTarget[] = [];

  for (const item of items) {
    if (item.kind === 'separator') {
      rawBucketIndex += 1;
      continue;
    }
    if (!rawToDense.has(rawBucketIndex)) {
      rawToDense.set(rawBucketIndex, nextPriority);
      nextPriority += 1;
    }
    reordered.push({
      ...item.target,
      priority: rawToDense.get(rawBucketIndex)!,
    });
  }

  return normalizeTargets(reordered);
}

export function applyPriorityBucketDrag(
  targets: RouteEndpointTarget[],
  activeId: string | number,
  overId: string | number,
): RouteEndpointTarget[] {
  const normalized = normalizeTargets(targets || []);
  if (normalized.length === 0 || activeId === overId) return normalized;

  const items = buildPriorityBucketEditorItems(normalized);
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const overIndex = items.findIndex((item) => item.id === overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
    return normalized;
  }

  const activeItem = items[activeIndex];
  if (activeItem.kind === 'separator') {
    const targetItem = items[overIndex];
    if (targetItem.kind !== 'route_target') {
      return normalized;
    }

    let previousSeparatorIndex = -1;
    for (let index = activeIndex - 1; index >= 0; index -= 1) {
      if (items[index]?.kind === 'separator') {
        previousSeparatorIndex = index;
        break;
      }
    }

    let nextSeparatorIndex = items.length;
    for (let index = activeIndex + 1; index < items.length; index += 1) {
      if (items[index]?.kind === 'separator') {
        nextSeparatorIndex = index;
        break;
      }
    }

    if (overIndex <= previousSeparatorIndex || overIndex >= nextSeparatorIndex) {
      return normalized;
    }
  }

  return denseRenormalizeTargets(moveItem(items, activeIndex, overIndex));
}
