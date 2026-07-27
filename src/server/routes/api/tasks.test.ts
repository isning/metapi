import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestAppHandle } from '../../../testing/appHarness.js';

type BackgroundTaskModule = typeof import('../../services/backgroundTaskService.js');

describe('task routes', () => {
  let app: TestAppHandle;
  let startBackgroundTask: BackgroundTaskModule['startBackgroundTask'];
  let appendBackgroundTaskLog: BackgroundTaskModule['appendBackgroundTaskLog'];
  let resetBackgroundTasks: BackgroundTaskModule['__resetBackgroundTasksForTests'];

  beforeAll(async () => {
    const routesModule = await import('./tasks.js');
    const backgroundTaskModule = await import('../../services/backgroundTaskService.js');
    startBackgroundTask = backgroundTaskModule.startBackgroundTask;
    appendBackgroundTaskLog = backgroundTaskModule.appendBackgroundTaskLog;
    resetBackgroundTasks = backgroundTaskModule.__resetBackgroundTasksForTests;

    app = await createTestApp({
      routes: [routesModule.taskRoutes],
      auth: 'admin-api',
    });
  });

  beforeEach(() => {
    resetBackgroundTasks();
  });

  afterAll(async () => {
    resetBackgroundTasks?.();
    await app?.close();
  });

  it('lists recent background tasks with the requested limit', async () => {
    const first = startBackgroundTask({
      type: 'coverage',
      title: 'First task',
      notifyOnFailure: false,
    }, async () => ({ ok: true })).task;
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = startBackgroundTask({
      type: 'coverage',
      title: 'Second task',
      notifyOnFailure: false,
    }, async () => ({ ok: true })).task;

    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks?limit=1',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tasks: [
        expect.objectContaining({
          id: second.id,
          title: 'Second task',
        }),
      ],
    });
    expect(response.json().tasks).toHaveLength(1);
    expect(response.json().tasks.some((task: { id: string }) => task.id === first.id)).toBe(false);
  });

  it('returns task details with logs and a stable 404 for unknown tasks', async () => {
    const task = startBackgroundTask({
      type: 'route-refresh',
      title: 'Refresh routes',
      notifyOnFailure: false,
    }, async () => ({ refreshed: true })).task;
    appendBackgroundTaskLog(task.id, 'queued');
    appendBackgroundTaskLog(task.id, 'running');

    const found = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}`,
      headers: app.adminHeaders(),
    });

    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({
      success: true,
      task: {
        id: task.id,
        type: 'route-refresh',
        title: 'Refresh routes',
        logs: [
          expect.objectContaining({ seq: 1, message: 'queued' }),
          expect.objectContaining({ seq: 2, message: 'running' }),
        ],
      },
    });

    const missing = await app.inject({
      method: 'GET',
      url: '/api/tasks/not-found',
      headers: app.adminHeaders(),
    });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      success: false,
      message: 'task not found',
    });
  });
});
