import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../testing/dbHarness.js';

type DbModule = typeof import('../db/index.js');
type InboxServiceModule = typeof import('./inboxService.js');

describe('inboxService', () => {
  let runtimeDb: IsolatedRuntimeDbHandle;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let service: InboxServiceModule;

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-inbox-service-');
    db = runtimeDb.dbModule.db;
    schema = runtimeDb.dbModule.schema;
    service = await import('./inboxService.js');
  });

  beforeEach(async () => {
    await db.delete(schema.events).run();
  });

  afterAll(async () => {
    await runtimeDb.cleanup();
  });

  it('deduplicates recurring active attention items and preserves the first occurrence', async () => {
    const first = await service.emitInboxItem({
      scope: 'attention',
      category: 'routing',
      severity: 'warning',
      title: 'Route build failed',
      summary: 'The route compiler failed.',
      subject: { type: 'route', id: 'route-1', label: 'Auto route' },
      dedupeKey: 'route:route-1:compile',
      details: [{ type: 'text', text: 'first failure' }],
      actions: [{ id: 'open-route', label: 'Open route', kind: 'link', href: '/routes/route-1' }],
    });

    const repeated = await service.emitInboxItem({
      scope: 'attention',
      category: 'routing',
      severity: 'critical',
      title: 'Route build still failing',
      summary: 'The latest compile failed again.',
      subject: { type: 'route', id: 'route-1', label: 'Auto route' },
      dedupeKey: 'route:route-1:compile',
      details: [{ type: 'text', text: 'second failure' }],
      actions: [{ id: 'open-route', label: 'Open route', kind: 'link', href: '/routes/route-1' }],
    });

    expect(repeated).toMatchObject({
      id: first.id,
      occurrenceCount: 2,
      title: 'Route build still failing',
      summary: 'The latest compile failed again.',
      severity: 'critical',
      state: 'open',
      read: false,
      firstSeenAt: first.firstSeenAt,
      subject: { type: 'route', id: 'route-1', label: 'Auto route' },
      details: [{ type: 'text', text: 'second failure' }],
      actions: [{ id: 'open-route', label: 'Open route', kind: 'link', href: '/routes/route-1' }],
    });

    await expect(service.listInboxItems({ scope: 'attention' })).resolves.toHaveLength(1);
  });

  it('starts a new attention item when a resolved dedupe key appears again', async () => {
    const original = await service.emitInboxItem({
      scope: 'attention',
      category: 'health',
      severity: 'critical',
      title: 'All endpoints failed',
      dedupeKey: 'site:1:health',
    });

    await service.resolveInboxItemByDedupeKey('site:1:health');

    const reopened = await service.emitInboxItem({
      scope: 'attention',
      category: 'health',
      severity: 'critical',
      title: 'All endpoints failed again',
      dedupeKey: 'site:1:health',
    });

    expect(reopened.id).not.toBe(original.id);
    expect(reopened).toMatchObject({
      occurrenceCount: 1,
      state: 'open',
      read: false,
      title: 'All endpoints failed again',
    });

    const items = await service.listInboxItems({ scope: 'attention', includeSnoozed: true });
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: original.id, state: 'resolved', read: true }),
      expect.objectContaining({ id: reopened.id, state: 'open', read: false }),
    ]));
  });
});
