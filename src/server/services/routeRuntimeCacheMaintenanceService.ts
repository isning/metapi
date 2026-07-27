import { config } from '../config.js';
import { startBackgroundTask } from './backgroundTaskService.js';
import { getActiveRouteRuntimeArtifact } from './routeRuntimeArtifactService.js';
import {
  getRouteRuntimeCacheStats,
  invalidateRouteRuntimeCaches,
} from './routeRuntimeCacheService.js';

export function getRouteRuntimeCacheStatus() {
  return {
    ttlMs: config.routeRuntimeCacheTtlMs,
    ...getRouteRuntimeCacheStats(),
  };
}

export function requestRouteRuntimeCacheRefresh() {
  return startBackgroundTask(
    {
      type: 'maintenance',
      title: 'Refresh route runtime cache',
      titleKey: 'backgroundTask.task.refreshRouteRuntimeCache',
      dedupeKey: 'refresh-route-runtime-cache',
      notifyOnFailure: true,
      successMessage: () => 'Route runtime cache refreshed.',
      successMessageI18n: (task) => ({
        key: 'backgroundTask.message.routeRuntimeCache.completed',
        params: {
          artifactId: (task.result as { runtimeArtifactId?: string | null } | null)?.runtimeArtifactId ?? '-',
        },
      }),
      failureMessage: (task) => `Route runtime cache refresh failed: ${task.error || 'unknown error'}`,
      failureMessageI18n: (task) => ({
        key: 'backgroundTask.lifecycle.failedMessage',
        params: { error: task.error || 'unknown error' },
      }),
    },
    async () => {
      invalidateRouteRuntimeCaches('manual');
      const artifact = await getActiveRouteRuntimeArtifact();
      return {
        runtimeArtifactId: artifact?.artifactId ?? null,
        bundleHash: artifact?.bundleHash ?? null,
      };
    },
  );
}
