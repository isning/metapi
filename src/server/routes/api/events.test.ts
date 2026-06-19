import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestAppHandle } from '../../../testing/appHarness.js';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../../testing/dbHarness.js';

type DbModule = typeof import('../../db/index.js');

describe('events routes', () => {
  let app: TestAppHandle;
  let runtimeDb: IsolatedRuntimeDbHandle;
  let db: DbModule['db'];
  let schema: DbModule['schema'];

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-events-routes-');
    const dbModule = runtimeDb.dbModule;
    const routesModule = await import('./events.js');
    db = dbModule.db;
    schema = dbModule.schema;

    app = await createTestApp({
      routes: [routesModule.eventsRoutes],
      auth: 'admin-api',
      env: {
        DATA_DIR: runtimeDb.path,
        DB_TYPE: 'sqlite',
      },
    });
  });

  beforeEach(async () => {
    await db.delete(schema.events).run();
  });

  afterAll(async () => {
    await app?.close();
    await runtimeDb?.cleanup();
  });

  it('lists events with type/read filters, pagination, and unread count', async () => {
    await db.insert(schema.events).values([
      {
        type: 'status',
        title: 'read status',
        message: 'old event',
        level: 'info',
        read: true,
        createdAt: '2026-06-01T00:00:00.000Z',
      },
      {
        type: 'status',
        title: 'unread status',
        message: 'newer event',
        level: 'warning',
        read: false,
        createdAt: '2026-06-02T00:00:00.000Z',
      },
      {
        type: 'task',
        title: 'unread task',
        message: 'task event',
        level: 'error',
        read: false,
        createdAt: '2026-06-03T00:00:00.000Z',
      },
    ]).run();

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/events?type=status&read=false&limit=10&offset=0',
      headers: app.adminHeaders(),
    });

    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toEqual([
      expect.objectContaining({
        type: 'status',
        title: 'unread status',
        read: false,
      }),
    ]);

    const count = await app.inject({
      method: 'GET',
      url: '/api/events/count',
      headers: app.adminHeaders(),
    });

    expect(count.statusCode).toBe(200);
    expect(count.json()).toEqual({ count: 2 });
  });

  it('marks a single event, marks all events, and clears events through route boundaries', async () => {
    const first = await db.insert(schema.events).values({
      type: 'status',
      title: 'first',
      message: 'first event',
      level: 'info',
      read: false,
      createdAt: '2026-06-01T00:00:00.000Z',
    }).returning().get();
    await db.insert(schema.events).values({
      type: 'task',
      title: 'second',
      message: 'second event',
      level: 'warning',
      read: false,
      createdAt: '2026-06-02T00:00:00.000Z',
    }).run();

    const markOne = await app.inject({
      method: 'POST',
      url: `/api/events/${first.id}/read`,
      headers: app.adminHeaders(),
    });
    expect(markOne.statusCode).toBe(200);
    expect(markOne.json()).toEqual({ success: true });

    const countAfterOne = await app.inject({
      method: 'GET',
      url: '/api/events/count',
      headers: app.adminHeaders(),
    });
    expect(countAfterOne.json()).toEqual({ count: 1 });

    const markAll = await app.inject({
      method: 'POST',
      url: '/api/events/read-all',
      headers: app.adminHeaders(),
    });
    expect(markAll.statusCode).toBe(200);
    expect(markAll.json()).toEqual({ success: true });

    const countAfterAll = await app.inject({
      method: 'GET',
      url: '/api/events/count',
      headers: app.adminHeaders(),
    });
    expect(countAfterAll.json()).toEqual({ count: 0 });

    const clear = await app.inject({
      method: 'DELETE',
      url: '/api/events',
      headers: app.adminHeaders(),
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json()).toEqual({ success: true });

    const list = await app.inject({
      method: 'GET',
      url: '/api/events',
      headers: app.adminHeaders(),
    });
    expect(list.json()).toEqual([]);
  });
});
