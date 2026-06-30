import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  buildRouteGraphSourceFromLegacyRoutes,
  compileRouteGraphSource,
} from '../../../shared/routeGraph.js';

import { createTestApp, type TestAppHandle } from '../../../testing/appHarness.js';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../../testing/dbHarness.js';

type DbModule = typeof import('../../db/index.js');

function buildLegacyNativeRouteGraphWithRouteEndpointIds(): unknown {
  const routes = [
    {
      id: 157,
      ownership: 'auto_generated',
      visibility: 'public',
      enabled: true,
      routingStrategy: 'weighted',
      displayName: 'deepseek-v4-flash',
      match: { kind: 'model', requestedModelPattern: 'deepseek-v4-flash', displayName: 'deepseek-v4-flash', routeId: 157 },
      backend: { kind: 'supply' },
      supplyEndpointSpecs: [
        {
          endpointIdentity: {
            kind: 'upstream_model',
            provider: 'new-api',
            credentialFingerprint: 'account:1:token:1',
            model: 'deepseek-v4-flash',
          },
          endpointLocalRefs: [{ localRouteId: 157, routeTargetId: 1, accountId: 1, tokenId: 1 }],
          targets: [{ targetId: '1', accountId: 1, tokenId: 1, model: 'deepseek-v4-flash' }],
        },
      ],
    },
    {
      id: 166,
      ownership: 'auto_generated',
      visibility: 'public',
      enabled: true,
      routingStrategy: 'weighted',
      displayName: 'deepseek-v4-chat',
      match: { kind: 'model', requestedModelPattern: 'deepseek-v4-chat', displayName: 'deepseek-v4-chat', routeId: 166 },
      backend: { kind: 'supply' },
      supplyEndpointSpecs: [
        {
          endpointIdentity: {
            kind: 'upstream_model',
            provider: 'new-api',
            credentialFingerprint: 'account:1:token:1',
            model: 'deepseek-v4-chat',
          },
          endpointLocalRefs: [{ localRouteId: 166, routeTargetId: 2, accountId: 1, tokenId: 1 }],
          targets: [{ targetId: '2', accountId: 1, tokenId: 1, model: 'deepseek-v4-chat' }],
        },
      ],
    },
    {
      id: 300,
      ownership: 'manual',
      visibility: 'public',
      enabled: true,
      routingStrategy: 'weighted',
      displayName: 'deepseek-manual-group',
      match: { kind: 'model', requestedModelPattern: '', displayName: 'deepseek-manual-group', routeId: 300 },
      backend: { kind: 'routes', routeIds: [157, 166] },
    },
  ];
  const currentGraph = buildRouteGraphSourceFromLegacyRoutes(routes);
  const stableEndpointIdByRouteId = new Map<number, string>();
  for (const node of currentGraph.nodes) {
    if (node.type === 'route_endpoint' && node.endpointKind === 'supply' && node.routeId) {
      stableEndpointIdByRouteId.set(node.routeId, node.id);
    }
  }
  let raw = JSON.stringify(currentGraph);
  for (const [routeId, stableEndpointId] of stableEndpointIdByRouteId) {
    raw = raw.split(stableEndpointId).join(`route-endpoint:supply:route:${routeId}`);
  }
  return JSON.parse(raw) as unknown;
}

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
    await db.delete(schema.routeEndpointTargets).run();
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
      version: '2.4',
      type: 'preferences',
    });
    expect(body.preferences.settings).toEqual(expect.arrayContaining([
      { key: 'metapi_config_version', value: '2.4' },
      {
        key: 'pricing_reference_config_v1',
        value: expect.objectContaining({
          schemaVersion: 1,
        }),
      },
      {
        key: 'platform_pricing_config_v1',
        value: expect.objectContaining({
          schemaVersion: 1,
          upstreamDefaultPricing: expect.objectContaining({
            inputPerMillion: 1,
            outputPerMillion: 1,
          }),
        }),
      },
    ]));
    expect(body.preferences.settings.map((item) => item.key)).not.toEqual(expect.arrayContaining([
      'routing_fallback_unit_cost',
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
        { key: 'proxy_debug_trace_enabled', value: true },
        { key: 'metapi_config_version', value: '2.4' },
        {
          key: 'pricing_reference_config_v1',
          value: expect.objectContaining({
            schemaVersion: 1,
          }),
        },
        {
          key: 'platform_pricing_config_v1',
          value: expect.objectContaining({
            schemaVersion: 1,
            upstreamDefaultPricing: expect.objectContaining({
              inputPerMillion: 1,
              outputPerMillion: 1,
            }),
          }),
        },
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
    const configVersion = await db.select().from(schema.settings)
      .where(eq(schema.settings.key, 'metapi_config_version'))
      .get();
    const pricingReference = await db.select().from(schema.settings)
      .where(eq(schema.settings.key, 'pricing_reference_config_v1'))
      .get();

    expect(fallbackCost).toBeUndefined();
    expect(debugEnabled?.value).toBe('true');
    expect(JSON.parse(configVersion?.value || 'null')).toBe('2.4');
    expect(JSON.parse(pricingReference?.value || '{}')).toMatchObject({
      schemaVersion: 1,
    });
    expect(JSON.parse(pricingReference?.value || '{}')).not.toHaveProperty('defaultReferenceMode');
    expect(JSON.parse(pricingReference?.value || '{}')).not.toHaveProperty('fallbackProfile');
    expect(dbUrl).toBeUndefined();
  });

  it('imports full backups and silently migrates legacy route graph endpoint references', async () => {
    const legacyGraph = buildLegacyNativeRouteGraphWithRouteEndpointIds();
    const legacyCompiledGraph = compileRouteGraphSource(legacyGraph).compiled;
    const payload = {
      version: '2.4',
      timestamp: Date.now(),
      accounts: {
        sites: [
          {
            id: 1,
            name: 'manual-group-site',
            url: 'https://manual-group.example.com',
            platform: 'new-api',
            status: 'active',
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
          },
        ],
        accounts: [
          {
            id: 1,
            siteId: 1,
            username: 'manual-group-user',
            accessToken: '',
            apiToken: 'manual-group-token',
            balance: 10,
            quota: 20,
            status: 'active',
            checkinEnabled: true,
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
          },
        ],
        accountTokens: [
          {
            id: 1,
            accountId: 1,
            name: 'default',
            token: 'manual-group-token',
            tokenGroup: 'default',
            source: 'manual',
            enabled: true,
            isDefault: true,
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
          },
        ],
        tokenRoutes: [
          {
            id: 157,
            modelPattern: 'deepseek-v4-flash',
            routingStrategy: 'weighted',
            enabled: true,
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
          },
          {
            id: 166,
            modelPattern: 'deepseek-v4-chat',
            routingStrategy: 'weighted',
            enabled: true,
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
          },
          {
            id: 300,
            displayName: 'deepseek-manual-group',
            routingStrategy: 'weighted',
            enabled: true,
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
          },
        ],
        routeEndpointTargets: [
          {
            id: 1,
            routeId: 157,
            routeEndpointId: 'route-endpoint:supply:route:157',
            accountId: 1,
            tokenId: 1,
            sourceModel: 'deepseek-v4-flash',
            priority: 0,
            weight: 10,
            enabled: true,
            manualOverride: false,
          },
          {
            id: 2,
            routeId: 166,
            routeEndpointId: 'route-endpoint:supply:route:166',
            accountId: 1,
            tokenId: 1,
            sourceModel: 'deepseek-v4-chat',
            priority: 1,
            weight: 10,
            enabled: true,
            manualOverride: false,
          },
        ],
        routeGroupSources: [
          { id: 1, groupRouteId: 300, sourceRouteId: 157 },
          { id: 2, groupRouteId: 300, sourceRouteId: 166 },
        ],
        routeGraph: {
          versions: [
            {
              id: 9,
              version: 9,
              sourceGraphJson: JSON.stringify(legacyGraph),
              compiledGraphJson: JSON.stringify(legacyCompiledGraph),
              status: 'active',
              createdBy: 'old-backup',
              createdAt: '2026-03-20T00:00:00.000Z',
              activatedAt: '2026-03-20T00:00:00.000Z',
            },
          ],
          activeVersion: {
            id: 1,
            versionId: 9,
            updatedAt: '2026-03-20T00:00:00.000Z',
          },
          drafts: [],
        },
      },
      preferences: {
        settings: [
          { key: 'proxy_debug_trace_enabled', value: true },
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
      allImported: true,
      sections: { accounts: true, preferences: true },
      appliedSettings: expect.arrayContaining([
        { key: 'proxy_debug_trace_enabled', value: true },
        { key: 'metapi_config_version', value: '2.4' },
      ]),
    });

    const activeGraph = await db.select().from(schema.routeGraphVersions)
      .where(eq(schema.routeGraphVersions.status, 'active'))
      .get();
    expect(activeGraph?.sourceGraphJson).not.toContain('route-endpoint:supply:route:157');
    expect(activeGraph?.sourceGraphJson).not.toContain('route-endpoint:supply:route:166');
    expect(activeGraph?.compiledGraphJson).not.toContain('route-endpoint:supply:route:157');
    expect(activeGraph?.compiledGraphJson).not.toContain('route-endpoint:supply:route:166');
    expect(activeGraph?.sourceGraphJson).toContain('route-endpoint:supply:upstream-model:');
    expect(activeGraph?.compiledGraphJson).toContain('route-endpoint:supply:upstream-model:');

    const targetRows = await db.select().from(schema.routeEndpointTargets).all();
    expect(targetRows.map((row) => row.routeEndpointId).sort()).toEqual([null, null]);
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
