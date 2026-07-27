import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import {
  getCachedActiveRouteRuntimeArtifact,
  getOrLoadActiveRouteRuntimeArtifact,
  getRouteRuntimeCacheStats,
  invalidateRouteRuntimeCaches,
} from './routeRuntimeCacheService.js';

describe('routeRuntimeCacheService', () => {
  beforeEach(() => {
    invalidateRouteRuntimeCaches('test-reset');
    config.routeRuntimeCacheTtlMs = 1_500;
  });

  it('caches active runtime artifacts until TTL or invalidation', async () => {
    const loader = vi.fn(async () => ({ id: 1, value: 'runtime' }));

    await expect(getOrLoadActiveRouteRuntimeArtifact('artifact-1', loader)).resolves.toEqual({ id: 1, value: 'runtime' });
    await expect(getOrLoadActiveRouteRuntimeArtifact('artifact-1', loader)).resolves.toEqual({ id: 1, value: 'runtime' });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(getCachedActiveRouteRuntimeArtifact('artifact-1')).toEqual({ id: 1, value: 'runtime' });

    invalidateRouteRuntimeCaches('route-graph-published');
    expect(getCachedActiveRouteRuntimeArtifact('artifact-1')).toBeUndefined();
  });

  it('singleflights active runtime loads', async () => {
    let resolveLoad!: (value: { id: number }) => void;
    const loader = vi.fn(() => new Promise<{ id: number }>((resolve) => {
      resolveLoad = resolve;
    }));

    const first = getOrLoadActiveRouteRuntimeArtifact('artifact-7', loader);
    const second = getOrLoadActiveRouteRuntimeArtifact('artifact-7', loader);
    resolveLoad({ id: 7 });

    await expect(Promise.all([first, second])).resolves.toEqual([{ id: 7 }, { id: 7 }]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('expires active runtime entries by route runtime cache TTL', async () => {
    const now = new Date('2026-07-05T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    config.routeRuntimeCacheTtlMs = 100;
    const loader = vi.fn(async () => ({ id: 3 }));

    try {
      await getOrLoadActiveRouteRuntimeArtifact('artifact-3', loader);
      expect(getCachedActiveRouteRuntimeArtifact('artifact-3', now.getTime() + 99)).toEqual({ id: 3 });
      expect(getCachedActiveRouteRuntimeArtifact('artifact-3', now.getTime() + 100)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports runtime cache stats', async () => {
    await getOrLoadActiveRouteRuntimeArtifact('artifact-4', async () => ({ id: 4 }));

    const stats = getRouteRuntimeCacheStats();
    expect(stats.activeRuntime).toMatchObject({
      present: true,
      artifactId: 'artifact-4',
      loadInFlight: false,
    });
    expect(stats).not.toHaveProperty('routeTableRuntime');
  });
});
