import { describe, expect, it } from 'vitest';
import type { RouteEndpointTarget } from './types.js';
import {
  applyPriorityBucketDrag,
  buildPriorityBucketEditorItems,
  buildPriorityBuckets,
  createPriorityBucketSeparatorId,
  isPriorityBucketSeparatorId,
  splitPriorityBucketAfterTarget,
} from './priorityBuckets.js';

function buildTarget(id: number, priority: number): RouteEndpointTarget {
  return {
    id,
    routeId: 1,
    accountId: 100 + id,
    tokenId: 200 + id,
    sourceModel: id % 2 === 0 ? 'model-b' : 'model-a',
    priority,
    weight: 10,
    enabled: true,
    manualOverride: false,
    successCount: 0,
    failCount: 0,
    cooldownUntil: null,
    account: { username: `user-${id}` },
    site: { id: 300 + id, name: `site-${id}`, platform: 'new-api' },
    token: { id: 200 + id, name: `token-${id}`, accountId: 100 + id, enabled: true, isDefault: true },
  };
}

describe('priority bucket helpers', () => {
  it('groups duplicate priorities into the same bucket', () => {
    const buckets = buildPriorityBuckets([
      buildTarget(1, 0),
      buildTarget(2, 0),
      buildTarget(3, 2),
      buildTarget(4, 2),
    ]);

    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ priority: 0 });
    expect(buckets[0].targets.map((target) => target.id)).toEqual([1, 2]);
    expect(buckets[1]).toMatchObject({ priority: 2 });
    expect(buckets[1].targets.map((target) => target.id)).toEqual([3, 4]);
  });

  it('builds editor items with separators between buckets', () => {
    const items = buildPriorityBucketEditorItems([
      buildTarget(1, 0),
      buildTarget(2, 1),
      buildTarget(3, 1),
    ]);

    expect(items.map((item) => item.id)).toEqual([1, createPriorityBucketSeparatorId(0), 2, 3]);
    expect(items.map((item) => item.kind)).toEqual(['route_target', 'separator', 'route_target', 'route_target']);
    expect(isPriorityBucketSeparatorId(createPriorityBucketSeparatorId(2))).toBe(true);
    expect(isPriorityBucketSeparatorId(1)).toBe(false);
  });

  it('moves a target across a separator and preserves duplicate priorities', () => {
    const reordered = applyPriorityBucketDrag(
      [
        buildTarget(1, 0),
        buildTarget(2, 0),
        buildTarget(3, 1),
        buildTarget(4, 2),
      ],
      3,
      1,
    );

    expect(reordered.map((target) => ({ id: target.id, priority: target.priority }))).toEqual([
      { id: 1, priority: 0 },
      { id: 2, priority: 0 },
      { id: 3, priority: 0 },
      { id: 4, priority: 1 },
    ]);
  });

  it('moves a separator within adjacent buckets and dense-renormalizes priorities', () => {
    const reordered = applyPriorityBucketDrag(
      [
        buildTarget(1, 0),
        buildTarget(2, 0),
        buildTarget(3, 1),
        buildTarget(4, 2),
        buildTarget(5, 2),
      ],
      createPriorityBucketSeparatorId(0),
      3,
    );

    expect(reordered.map((target) => ({ id: target.id, priority: target.priority }))).toEqual([
      { id: 1, priority: 0 },
      { id: 2, priority: 0 },
      { id: 3, priority: 0 },
      { id: 4, priority: 1 },
      { id: 5, priority: 1 },
    ]);
  });

  it('can split a single shared-priority bucket into a new next bucket', () => {
    const reordered = splitPriorityBucketAfterTarget(
      [
        buildTarget(1, 0),
        buildTarget(2, 0),
        buildTarget(3, 0),
      ],
      1,
    );

    expect(reordered.map((target) => ({ id: target.id, priority: target.priority }))).toEqual([
      { id: 1, priority: 0 },
      { id: 2, priority: 1 },
      { id: 3, priority: 1 },
    ]);
  });

  it('leaves priorities unchanged for no-op or invalid drag and split operations', () => {
    const targets = [buildTarget(1, 0), buildTarget(2, 1), buildTarget(3, 2)];
    const summarize = (items: RouteEndpointTarget[]) => items.map((target) => ({
      id: target.id,
      priority: target.priority,
    }));

    expect(summarize(applyPriorityBucketDrag([], 1, 2))).toEqual([]);
    expect(summarize(applyPriorityBucketDrag(targets, 1, 1))).toEqual(summarize(targets));
    expect(summarize(applyPriorityBucketDrag(targets, 999, 1))).toEqual(summarize(targets));
    expect(summarize(applyPriorityBucketDrag(targets, 1, 999))).toEqual(summarize(targets));
    expect(summarize(applyPriorityBucketDrag(
      targets,
      createPriorityBucketSeparatorId(0),
      createPriorityBucketSeparatorId(1),
    ))).toEqual(summarize(targets));
    expect(summarize(applyPriorityBucketDrag(
      targets,
      createPriorityBucketSeparatorId(0),
      3,
    ))).toEqual(summarize(targets));
    expect(summarize(applyPriorityBucketDrag(
      [buildTarget(1, 0), buildTarget(2, 1), buildTarget(3, 2), buildTarget(4, 3)],
      createPriorityBucketSeparatorId(1),
      2,
    ))).toEqual([
      { id: 1, priority: 0 },
      { id: 2, priority: 1 },
      { id: 3, priority: 1 },
      { id: 4, priority: 2 },
    ]);
    expect(summarize(splitPriorityBucketAfterTarget([buildTarget(1, 0)], 1))).toEqual([{ id: 1, priority: 0 }]);
    expect(summarize(splitPriorityBucketAfterTarget(targets, 999))).toEqual(summarize(targets));
    expect(summarize(splitPriorityBucketAfterTarget(targets, 1))).toEqual(summarize(targets));
  });
});
