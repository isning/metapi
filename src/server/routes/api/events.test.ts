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

  it('normalizes inbox fields and supports scope/state filters', async () => {
    await db.insert(schema.events).values([
      {
        type: 'status',
        title: 'needs attention',
        summary: 'Route build failed',
        message: 'Route graph failed to compile',
        level: 'error',
        severity: 'critical',
        scope: 'attention',
        category: 'routing',
        state: 'open',
        read: false,
        subjectType: 'route',
        subjectId: 'route-1',
        detailsJson: JSON.stringify([{ type: 'text', text: 'compiler output' }]),
        actionsJson: JSON.stringify([{ id: 'resolve', label: 'Resolve', kind: 'invoke', command: 'resolve' }]),
        occurrenceCount: 2,
        firstSeenAt: '2026-06-01T00:00:00.000Z',
        lastSeenAt: '2026-06-02T00:00:00.000Z',
        createdAt: '2026-06-02T00:00:00.000Z',
      },
      {
        type: 'status',
        title: 'activity',
        message: 'background task finished',
        level: 'info',
        read: false,
        createdAt: '2026-06-03T00:00:00.000Z',
      },
    ]).run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/events?scope=attention&state=open',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        title: 'needs attention',
        scope: 'attention',
        category: 'routing',
        severity: 'critical',
        state: 'open',
        summary: 'Route build failed',
        subject: expect.objectContaining({ type: 'route', id: 'route-1' }),
        details: [expect.objectContaining({ type: 'text', text: 'compiler output' })],
        actions: [expect.objectContaining({ command: 'resolve' })],
        occurrenceCount: 2,
      }),
    ]);

    const count = await app.inject({
      method: 'GET',
      url: '/api/events/count?scope=attention',
      headers: app.adminHeaders(),
    });
    expect(count.json()).toEqual({ count: 1 });
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

  it('scopes bulk read and clear while preserving attention lifecycle state', async () => {
    const attention = await db.insert(schema.events).values({
      type: 'proxy',
      title: 'route attention',
      message: 'all upstreams failed',
      level: 'error',
      severity: 'critical',
      scope: 'attention',
      category: 'routing',
      state: 'open',
      read: false,
      createdAt: '2026-06-01T00:00:00.000Z',
    }).returning().get();

    await db.insert(schema.events).values([
      {
        type: 'status',
        title: 'notification',
        message: 'notify me',
        level: 'info',
        scope: 'notification',
        category: 'system',
        state: 'open',
        read: false,
        createdAt: '2026-06-02T00:00:00.000Z',
      },
      {
        type: 'status',
        title: 'activity',
        message: 'audit row',
        level: 'info',
        scope: 'activity',
        category: 'system',
        state: 'open',
        read: false,
        createdAt: '2026-06-03T00:00:00.000Z',
      },
    ]).run();

    const markNotifications = await app.inject({
      method: 'POST',
      url: '/api/events/read-all?scope=notification',
      headers: app.adminHeaders(),
    });
    expect(markNotifications.statusCode).toBe(200);

    const notificationCount = await app.inject({
      method: 'GET',
      url: '/api/events/count?scope=notification',
      headers: app.adminHeaders(),
    });
    expect(notificationCount.json()).toEqual({ count: 0 });

    const markAttentionRead = await app.inject({
      method: 'POST',
      url: `/api/events/${attention.id}/read`,
      headers: app.adminHeaders(),
    });
    expect(markAttentionRead.statusCode).toBe(200);

    const attentionList = await app.inject({
      method: 'GET',
      url: '/api/events?scope=attention&state=open',
      headers: app.adminHeaders(),
    });
    expect(attentionList.json()).toEqual([
      expect.objectContaining({
        id: attention.id,
        read: true,
        state: 'open',
      }),
    ]);

    const clearNotifications = await app.inject({
      method: 'DELETE',
      url: '/api/events?scope=notification',
      headers: app.adminHeaders(),
    });
    expect(clearNotifications.statusCode).toBe(200);

    const remaining = await app.inject({
      method: 'GET',
      url: '/api/events?limit=10',
      headers: app.adminHeaders(),
    });
    expect(remaining.json().map((row: any) => row.scope).sort()).toEqual(['activity', 'attention']);
  });

  it('applies inbox lifecycle actions', async () => {
    const inserted = await db.insert(schema.events).values({
      type: 'status',
      title: 'attention',
      message: 'needs review',
      level: 'warning',
      severity: 'warning',
      scope: 'attention',
      category: 'health',
      state: 'open',
      read: false,
      createdAt: '2026-06-01T00:00:00.000Z',
    }).returning().get();

    const resolve = await app.inject({
      method: 'POST',
      url: `/api/events/${inserted.id}/action`,
      headers: app.adminHeaders(),
      payload: { command: 'resolve' },
    });

    expect(resolve.statusCode).toBe(200);
    expect(resolve.json()).toEqual({
      success: true,
      item: expect.objectContaining({
        id: inserted.id,
        read: true,
        state: 'resolved',
        resolvedAt: expect.any(String),
      }),
    });

    const countAfterResolve = await app.inject({
      method: 'GET',
      url: '/api/events/count?scope=attention',
      headers: app.adminHeaders(),
    });
    expect(countAfterResolve.json()).toEqual({ count: 0 });
  });
});
