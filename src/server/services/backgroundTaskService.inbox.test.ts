import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../testing/dbHarness.js';

type DbModule = typeof import('../db/index.js');
type BackgroundTaskModule = typeof import('./backgroundTaskService.js');

async function waitForEventDetailsJson(
  db: DbModule['db'],
  schema: DbModule['schema'],
  title: string,
): Promise<unknown[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const row = await db.select()
      .from(schema.events)
      .where(eq(schema.events.title, title))
      .get();
    if (row?.detailsJson) return JSON.parse(row.detailsJson);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Event details were not written for ${title}`);
}

async function waitForEventTitle(
  db: DbModule['db'],
  schema: DbModule['schema'],
  title: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const row = await db.select()
      .from(schema.events)
      .where(eq(schema.events.title, title))
      .get();
    if (row) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Event title was not written: ${title}`);
}

describe('background task inbox details', () => {
  let runtimeDb: IsolatedRuntimeDbHandle;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let startBackgroundTask: BackgroundTaskModule['startBackgroundTask'];
  let waitForBackgroundTaskCompletion: BackgroundTaskModule['waitForBackgroundTaskCompletion'];
  let resetBackgroundTasks: BackgroundTaskModule['__resetBackgroundTasksForTests'];

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-background-task-inbox-');
    const backgroundTaskModule = await import('./backgroundTaskService.js');
    db = runtimeDb.dbModule.db;
    schema = runtimeDb.dbModule.schema;
    startBackgroundTask = backgroundTaskModule.startBackgroundTask;
    waitForBackgroundTaskCompletion = backgroundTaskModule.waitForBackgroundTaskCompletion;
    resetBackgroundTasks = backgroundTaskModule.__resetBackgroundTasksForTests;
  });

  beforeEach(async () => {
    resetBackgroundTasks();
    await db.delete(schema.events).run();
  });

  afterAll(async () => {
    resetBackgroundTasks?.();
    await runtimeDb.cleanup();
  });

  it('expands model refresh and route rebuild result metrics into structured event details', async () => {
    const { task } = startBackgroundTask(
      {
        type: 'route',
        title: '刷新模型并重建路由',
        titleKey: 'backgroundTask.task.refreshModelsAndRebuildRoutes',
        notifyOnFailure: false,
      },
      async () => ({
        refresh: [{ accountId: 1 }, { accountId: 2 }],
        rebuild: {
          models: 117,
          createdRoutes: 117,
          removedRoutes: 0,
          createdRouteGroups: 117,
          updatedRouteGroups: 0,
          createdRouteGroupBuckets: 117,
          createdSupplyEndpoints: 174,
          updatedSupplyEndpoints: 0,
          createdRouteGroupCandidates: 174,
          updatedRouteGroupCandidates: 0,
          removedRouteGroupCandidates: 0,
        },
      }),
    );

    await waitForBackgroundTaskCompletion(task.id);

    const details = await waitForEventDetailsJson(db, schema, '刷新模型并重建路由 已完成');
    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'i18n',
        titleKey: 'backgroundTask.lifecycle.completedTitle',
        messageKey: 'backgroundTask.lifecycle.completedMessage',
        paramKeys: expect.objectContaining({
          title: 'backgroundTask.task.refreshModelsAndRebuildRoutes',
        }),
      }),
      expect.objectContaining({
        type: 'metrics',
        title: 'backgroundTask.details.resultMetrics',
        items: expect.arrayContaining([
          expect.objectContaining({ label: 'refresh.count', value: '2' }),
          expect.objectContaining({ label: 'rebuild.createdRoutes', value: '117' }),
          expect.objectContaining({ label: 'rebuild.removedRoutes', value: '0' }),
          expect.objectContaining({ label: 'rebuild.createdRouteGroupCandidates', value: '174' }),
          expect.objectContaining({ label: 'rebuild.removedRouteGroupCandidates', value: '0' }),
        ]),
      }),
    ]));
  });

  it('uses a consistent separator in background task lifecycle event titles', async () => {
    const { task } = startBackgroundTask(
      {
        type: 'route',
        title: '刷新模型并重建路由',
        titleKey: 'backgroundTask.task.refreshModelsAndRebuildRoutes',
        notifyOnFailure: false,
      },
      async () => ({ ok: true }),
    );

    await waitForEventTitle(db, schema, '刷新模型并重建路由 已开始');
    await waitForBackgroundTaskCompletion(task.id);
    await waitForEventTitle(db, schema, '刷新模型并重建路由 已完成');
  });
});
