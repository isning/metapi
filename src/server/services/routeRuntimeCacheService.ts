import { config } from '../config.js';

export type RouteRuntimeInvalidationReason =
  | 'route-graph-published'
  | 'route-source-mutated'
  | 'route-group-mutated'
  | 'route-group-candidate-mutated'
  | 'route-supply-endpoint-mutated'
  | 'account-mutated'
  | 'account-token-mutated'
  | 'site-mutated'
  | 'site-api-endpoint-mutated'
  | 'model-availability-rebuilt'
  | 'pricing-config-mutated'
  | 'routing-weights-mutated'
  | 'route-failure-cooldown-mutated'
  | 'test-reset'
  | 'manual';

type TimedCacheEntry<T> = {
  value: T;
  storedAtMs: number;
  generation: number;
};

type ActiveRuntimeCacheEntry<T> = TimedCacheEntry<T> & {
  artifactId: string;
};

type ActiveRuntimeLoad<T> = {
  artifactId: string;
  promise: Promise<T | null>;
};

export type RouteRuntimeCacheStats = {
  generation: number;
  activeRuntime: {
    present: boolean;
    ageMs: number | null;
    artifactId: string | null;
    loadInFlight: boolean;
  };
  lastInvalidation: {
    reason: RouteRuntimeInvalidationReason;
    at: string;
  } | null;
};

let generation = 0;
let activeRuntimeCache: ActiveRuntimeCacheEntry<unknown> | null = null;
let activeRuntimeLoad: ActiveRuntimeLoad<unknown> | null = null;
let lastInvalidation: RouteRuntimeCacheStats['lastInvalidation'] = null;

function isFresh(entry: TimedCacheEntry<unknown>, nowMs: number): boolean {
  return entry.generation === generation
    && nowMs - entry.storedAtMs < config.routeRuntimeCacheTtlMs;
}

export function invalidateRouteRuntimeCaches(
  reason: RouteRuntimeInvalidationReason = 'manual',
): void {
  generation += 1;
  activeRuntimeCache = null;
  activeRuntimeLoad = null;
  lastInvalidation = {
    reason,
    at: new Date().toISOString(),
  };
}

export function getRouteRuntimeCacheStats(nowMs = Date.now()): RouteRuntimeCacheStats {
  return {
    generation,
    activeRuntime: {
      present: activeRuntimeCache != null,
      ageMs: activeRuntimeCache ? Math.max(0, nowMs - activeRuntimeCache.storedAtMs) : null,
      artifactId: activeRuntimeCache?.artifactId ?? null,
      loadInFlight: activeRuntimeLoad != null,
    },
    lastInvalidation,
  };
}

export function getCachedActiveRouteRuntimeArtifact<T>(
  artifactId: string,
  nowMs = Date.now(),
): T | undefined {
  if (!activeRuntimeCache || activeRuntimeCache.artifactId !== artifactId) return undefined;
  if (!isFresh(activeRuntimeCache, nowMs)) return undefined;
  return activeRuntimeCache.value as T;
}

export function setCachedActiveRouteRuntimeArtifact<T>(
  artifactId: string,
  value: T,
  nowMs = Date.now(),
): void {
  activeRuntimeCache = {
    artifactId,
    value,
    storedAtMs: nowMs,
    generation,
  };
}

export function clearCachedActiveRouteRuntimeArtifact(): void {
  activeRuntimeCache = null;
  activeRuntimeLoad = null;
}

export async function getOrLoadActiveRouteRuntimeArtifact<T>(
  artifactId: string,
  loader: () => Promise<T | null>,
): Promise<T | null> {
  const cached = getCachedActiveRouteRuntimeArtifact<T>(artifactId);
  if (cached !== undefined) return cached;
  if (activeRuntimeLoad?.artifactId === artifactId) {
    return await activeRuntimeLoad.promise as T | null;
  }

  const loadGeneration = generation;
  const loadPromise = loader().then((value) => {
    if (value !== null && loadGeneration === generation) {
      setCachedActiveRouteRuntimeArtifact(artifactId, value);
    }
    return value;
  }).finally(() => {
    if (activeRuntimeLoad?.promise === loadPromise) {
      activeRuntimeLoad = null;
    }
  });
  activeRuntimeLoad = { artifactId, promise: loadPromise };
  return await loadPromise;
}
