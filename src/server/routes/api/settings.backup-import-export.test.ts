import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createTestApp, type TestAppHandle } from '../../../testing/appHarness.js';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../../testing/dbHarness.js';

type DbModule = typeof import('../../db/index.js');

describe('settings backup import/export api', () => {
  let app: TestAppHandle;
  let runtimeDb: IsolatedRuntimeDbHandle;
  let db: DbModule['db'];
  let schema: DbModule['schema'];

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-settings-backup-import-export-');
    const dbModule = runtimeDb.dbModule;
    const routesModule = await import('./settings.js');
    db = dbModule.db;
    schema = dbModule.schema;

    app = await createTestApp({
      routes: [routesModule.settingsRoutes],
      auth: 'admin-api',
      env: {
        DATA_DIR: runtimeDb.path,
        DB_TYPE: 'sqlite',
      },
    });
  });

  beforeEach(async () => {
    await db.delete(schema.settings).run();
    await db.delete(schema.events).run();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.routeGroupSources).run();
    await db.delete(schema.routeChannels).run();
    await db.delete(schema.tokenRoutes).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app?.close();
    await runtimeDb?.cleanup();
  });

  it('exports preferences through the settings route without runtime database secrets', async () => {
    await db.insert(schema.settings).values([
      { key: 'routing_fallback_unit_cost', value: JSON.stringify(0.42) },
      { key: 'db_type', value: JSON.stringify('postgres') },
      { key: 'db_url', value: JSON.stringify('postgres://metapi:secret@db.example.com:5432/metapi') },
    ]).run();

    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/backup/export?type=preferences',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      version: string;
      type: string;
      preferences: { settings: Array<{ key: string; value: unknown }> };
    };
    expect(body).toMatchObject({
      version: '2.1',
      type: 'preferences',
    });
    expect(body.preferences.settings).toEqual(expect.arrayContaining([
      { key: 'routing_fallback_unit_cost', value: 0.42 },
    ]));
    expect(body.preferences.settings.map((item) => item.key)).not.toEqual(expect.arrayContaining([
      'db_type',
      'db_url',
    ]));
  });

  it('rejects invalid export types at the route boundary', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/backup/export?type=runtime',
      headers: app.adminHeaders(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      success: false,
      message: '导出类型无效，仅支持 all/accounts/preferences',
    });
  });

  it('imports preferences through the settings route and applies imported settings', async () => {
    const payload = {
      version: '2.1',
      timestamp: Date.now(),
      type: 'preferences',
      preferences: {
        settings: [
          { key: 'routing_fallback_unit_cost', value: 0.73 },
          { key: 'proxy_debug_trace_enabled', value: true },
          { key: 'db_url', value: 'postgres://metapi:secret@db.example.com:5432/metapi' },
        ],
      },
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/backup/import',
      headers: app.adminHeaders(),
      payload: { data: payload },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      message: '导入完成',
      allImported: true,
      sections: { preferences: true },
      appliedSettings: expect.arrayContaining([
        { key: 'routing_fallback_unit_cost', value: 0.73 },
        { key: 'proxy_debug_trace_enabled', value: true },
      ]),
    });

    const fallbackCost = await db.select().from(schema.settings)
      .where(eq(schema.settings.key, 'routing_fallback_unit_cost'))
      .get();
    const debugEnabled = await db.select().from(schema.settings)
      .where(eq(schema.settings.key, 'proxy_debug_trace_enabled'))
      .get();
    const dbUrl = await db.select().from(schema.settings)
      .where(eq(schema.settings.key, 'db_url'))
      .get();

    expect(fallbackCost?.value).toBe('0.73');
    expect(debugEnabled?.value).toBe('true');
    expect(dbUrl).toBeUndefined();
  });

  it('rejects malformed import envelopes before touching backup state', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/backup/import',
      headers: app.adminHeaders(),
      payload: { data: 'not an object' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      success: false,
      message: '导入数据格式错误：需要 JSON 对象',
    });
  });
});
