import { startBackgroundTask } from './backgroundTaskService.js';
import {
  rebuildManagedRouteGroupsFromAvailability,
  refreshModelsAndRebuildRoutes as refreshModelsAndRebuildRoutesViaModelService,
} from './modelService.js';
import { warmRuntimeFactsOnce } from './runtimeFactWarmService.js';

export async function rebuildRoutesOnly() {
  return rebuildManagedRouteGroupsFromAvailability();
}

export async function rebuildRoutesBestEffort() {
  try {
    await rebuildRoutesOnly();
    return true;
  } catch {
    return false;
  }
}

export async function refreshModelsAndRebuildRoutes() {
  const result = await refreshModelsAndRebuildRoutesViaModelService();
  await warmRuntimeFactsOnce('model-refresh');
  return result;
}

export type RefreshModelsAndRebuildRoutesResult = Awaited<
  ReturnType<typeof refreshModelsAndRebuildRoutes>
>;

function refreshTaskResult(value: unknown): RefreshModelsAndRebuildRoutesResult | null {
  if (!value || typeof value !== 'object' || !('rebuild' in value)) return null;
  return value as RefreshModelsAndRebuildRoutesResult;
}

export function queueRefreshModelsAndRebuildRoutesTask(input: {
  source?: 'route_group' | 'models_marketplace';
} = {}) {
  const marketplace = input.source === 'models_marketplace';
  const title = marketplace
    ? 'Refresh model marketplace data'
    : 'Refresh models and rebuild routes';
  const titleKey = marketplace
    ? 'backgroundTask.task.refreshModelsMarketplace'
    : 'backgroundTask.task.refreshModelsAndRebuildRoutes';
  const completedNoRebuildKey = marketplace
    ? 'backgroundTask.message.modelsMarketplace.completedNoRebuild'
    : 'backgroundTask.message.refreshModelsAndRebuildRoutes.completedNoRebuild';
  const completedWithRebuildKey = marketplace
    ? 'backgroundTask.message.modelsMarketplace.completedWithRebuild'
    : 'backgroundTask.message.refreshModelsAndRebuildRoutes.completedWithRebuild';
  return startBackgroundTask(
    {
      type: 'route',
      title,
      titleKey,
      dedupeKey: 'refresh-models-and-rebuild-routes',
      notifyOnFailure: true,
      successMessage: (task) => {
        const result = refreshTaskResult(task.result);
        if (!result) return `${title} completed`;
        const { rebuild } = result;
        return `${title} completed: ${rebuild.createdRoutes ?? 0} routes added, ${rebuild.removedRoutes ?? 0} stale routes removed, ${rebuild.createdRouteGroupCandidates ?? 0} candidates added, ${rebuild.removedRouteGroupCandidates ?? 0} candidates removed`;
      },
      successMessageI18n: (task) => {
        const result = refreshTaskResult(task.result);
        if (!result) {
          return { key: completedNoRebuildKey };
        }
        const { rebuild } = result;
        return {
          key: completedWithRebuildKey,
          params: {
            createdRoutes: rebuild.createdRoutes ?? 0,
            removedRoutes: rebuild.removedRoutes ?? 0,
            createdCandidates: rebuild.createdRouteGroupCandidates ?? 0,
            removedCandidates: rebuild.removedRouteGroupCandidates ?? 0,
          },
        };
      },
      failureMessage: (task) => `${title} failed: ${task.error || 'unknown error'}`,
      failureMessageI18n: (task) => ({
        key: 'backgroundTask.lifecycle.failedMessage',
        params: { error: task.error || 'unknown error' },
      }),
    },
    async () => refreshModelsAndRebuildRoutes(),
  );
}
