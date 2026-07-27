import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BackgroundTask,
  BackgroundTaskStartOptions,
} from './backgroundTaskService.js';

const mocks = vi.hoisted(() => ({
  startBackgroundTask: vi.fn(),
  refreshModelsAndRebuildRoutes: vi.fn(),
  rebuildManagedRouteGroupsFromAvailability: vi.fn(),
  warmRuntimeFactsOnce: vi.fn(),
}));

vi.mock('./backgroundTaskService.js', () => ({
  startBackgroundTask: mocks.startBackgroundTask,
}));
vi.mock('./modelService.js', () => ({
  refreshModelsAndRebuildRoutes: mocks.refreshModelsAndRebuildRoutes,
  rebuildManagedRouteGroupsFromAvailability: mocks.rebuildManagedRouteGroupsFromAvailability,
}));
vi.mock('./runtimeFactWarmService.js', () => ({
  warmRuntimeFactsOnce: mocks.warmRuntimeFactsOnce,
}));

import { queueRefreshModelsAndRebuildRoutesTask } from './routeRefreshWorkflow.js';

function taskWith(result: unknown): BackgroundTask {
  return {
    id: 'task-id',
    type: 'route',
    title: 'Refresh models and rebuild routes',
    titleKey: 'backgroundTask.task.refreshModelsAndRebuildRoutes',
    status: 'succeeded',
    message: '',
    error: null,
    result,
    dedupeKey: 'refresh-models-and-rebuild-routes',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    startedAt: '2026-07-27T00:00:00.000Z',
    finishedAt: '2026-07-27T00:00:00.000Z',
    expiresAtMs: 1,
    logs: [],
  };
}

describe('routeRefreshWorkflow background task', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startBackgroundTask.mockReturnValue({
      task: taskWith(null),
      reused: false,
    });
  });

  it('owns one typed task definition with frontend-translatable lifecycle details', () => {
    queueRefreshModelsAndRebuildRoutesTask();

    const [options] = mocks.startBackgroundTask.mock.calls[0] as [
      BackgroundTaskStartOptions,
      () => Promise<unknown>,
    ];
    const task = taskWith({
      refresh: [],
      rebuild: {
        createdRoutes: 3,
        removedRoutes: 1,
        createdRouteGroupCandidates: 5,
        removedRouteGroupCandidates: 2,
      },
    });

    expect(options).toMatchObject({
      type: 'route',
      titleKey: 'backgroundTask.task.refreshModelsAndRebuildRoutes',
      dedupeKey: 'refresh-models-and-rebuild-routes',
    });
    expect(typeof options.successMessage).toBe('function');
    expect(typeof options.successMessageI18n).toBe('function');
    expect((options.successMessageI18n as (value: BackgroundTask) => unknown)(task)).toEqual({
      key: 'backgroundTask.message.refreshModelsAndRebuildRoutes.completedWithRebuild',
      params: {
        createdRoutes: 3,
        removedRoutes: 1,
        createdCandidates: 5,
        removedCandidates: 2,
      },
    });
  });
});
