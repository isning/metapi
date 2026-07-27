import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createTestApp, type TestAppHandle } from '../../../testing/appHarness.js';
import { clearRouteGroupMemberTestData, listAllRouteGroupMembers } from '../../../testing/routeGroupMemberTestUtils.js';
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
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphVersions).run();
    await clearRouteGroupMemberTestData();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
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
      version: '3.0',
      type: 'preferences',
    });
    expect(body.preferences.settings).toEqual(expect.arrayContaining([
      { key: 'metapi_config_version', value: '3.0' },
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
            inputPerMillion: 0.42,
            outputPerMillion: 0.42,
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
        { key: 'metapi_config_version', value: '3.0' },
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
              inputPerMillion: 0.73,
              outputPerMillion: 0.73,
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
    expect(JSON.parse(configVersion?.value || 'null')).toBe('3.0');
    expect(JSON.parse(pricingReference?.value || '{}')).toMatchObject({
      schemaVersion: 1,
    });
    expect(JSON.parse(pricingReference?.value || '{}')).not.toHaveProperty('defaultReferenceMode');
    expect(JSON.parse(pricingReference?.value || '{}')).not.toHaveProperty('fallbackProfile');
    expect(dbUrl).toBeUndefined();
  });

  it('imports full backups with current route runtime tables and rebuilds active graph when needed', async () => {
    const payload = {
      version: '3.0',
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
        routeGroups: [
          {
            id: 300,
            kind: 'manual',
            groupKey: 'manual:deepseek-rerouted',
            upstreamModelName: 'deepseek-v4-flash',
            normalizedModelName: 'deepseek-v4-flash-rerouted',
            publicModelName: 'deepseek-v4-flash-rerouted',
            displayName: 'deepseek-v4-flash-rerouted',
            displayIcon: null,
            visibility: 'public',
            routingStrategy: 'weighted',
            sourceMode: 'manual',
            configJson: null,
            userOverrideJson: null,
            syncStatus: 'active',
            enabled: true,
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
          },
        ],
        runtimeExecutionTargets: [
          {
            id: 401,
            executionKey: 'upstream:deepseek-v4-flash|site:1|account:1|token:1',
            siteId: 1,
            accountId: 1,
            tokenId: 1,
            oauthRouteUnitId: null,
            credentialBindingId: null,
            endpointProfileId: null,
            upstreamModelName: 'deepseek-v4-flash',
            normalizedModelName: 'deepseek-v4-flash',
            enabled: true,
            discovered: true,
            source: 'manual',
            metadataJson: JSON.stringify({ provider: 'new-api', label: 'flash' }),
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
          },
          {
            id: 402,
            executionKey: 'upstream:deepseek-v4-chat|site:1|account:1|token:1',
            siteId: 1,
            accountId: 1,
            tokenId: 1,
            oauthRouteUnitId: null,
            credentialBindingId: null,
            endpointProfileId: null,
            upstreamModelName: 'deepseek-v4-chat',
            normalizedModelName: 'deepseek-v4-chat',
            enabled: true,
            discovered: true,
            source: 'manual',
            metadataJson: JSON.stringify({ provider: 'new-api', label: 'chat' }),
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
          },
        ],
        routeGroupFallbackStages: [
          {
            id: 501,
            groupId: 300,
            stageKey: 'primary',
            sortOrder: 0,
            label: 'Primary',
            enabled: true,
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
          },
        ],
        routeGroupCandidates: [
          {
            id: 601,
            groupId: 300,
            stageId: 501,
            candidateKey: 'upstream:deepseek-v4-flash|account:1|token:1',
            candidateKind: 'execution_target',
            executionTargetId: 401,
            childGroupId: null,
            weight: 11,
            sortOrder: 0,
            enabled: true,
            source: 'manual',
            manualOverride: true,
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
          },
          {
            id: 602,
            groupId: 300,
            stageId: 501,
            candidateKey: 'upstream:deepseek-v4-chat|account:1|token:1',
            candidateKind: 'execution_target',
            executionTargetId: 402,
            childGroupId: null,
            weight: 13,
            sortOrder: 1,
            enabled: true,
            source: 'manual',
            manualOverride: true,
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
          },
        ],
        runtimeExecutionTargetState: [
          {
            id: 701,
            executionTargetId: 401,
            successCount: 3,
            failCount: 1,
            totalLatencyMs: 120,
            totalCost: 0.25,
            lastUsedAt: '2026-03-20T00:30:00.000Z',
            lastSelectedAt: '2026-03-20T00:30:00.000Z',
            lastFailAt: null,
            consecutiveFailCount: 0,
            cooldownLevel: 0,
            cooldownUntil: null,
            updatedAt: '2026-03-20T00:30:00.000Z',
          },
          {
            id: 702,
            executionTargetId: 402,
            successCount: 5,
            failCount: 0,
            totalLatencyMs: 160,
            totalCost: 0.5,
            lastUsedAt: '2026-03-20T00:31:00.000Z',
            lastSelectedAt: '2026-03-20T00:31:00.000Z',
            lastFailAt: null,
            consecutiveFailCount: 0,
            cooldownLevel: 0,
            cooldownUntil: null,
            updatedAt: '2026-03-20T00:31:00.000Z',
          },
        ],
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
        { key: 'metapi_config_version', value: '3.0' },
      ]),
    });
    const importEvent = await db.select().from(schema.events)
      .where(eq(schema.events.type, 'backup_import'))
      .get();
    expect(importEvent).toMatchObject({
      scope: 'notification',
      category: 'settings',
      severity: 'success',
      relatedType: 'settings_import_export',
      source: 'settings.backup_import',
    });
    const importDetails = JSON.parse(importEvent?.detailsJson || '[]');
    expect(importDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'i18n',
        titleKey: 'backupImport.notification.completedTitle',
        messageKey: 'backupImport.notification.completedMessage',
        paramKeys: { source: 'backupImport.source.manual' },
      }),
      expect.objectContaining({
        type: 'metrics',
        title: 'backupImport.details.importedCounts',
        items: expect.arrayContaining([
          { label: 'backupImport.details.sites', value: '1' },
          { label: 'backupImport.details.accounts', value: '1' },
          { label: 'backupImport.details.settings', value: '4' },
        ]),
      }),
    ]));

    const activeGraph = await db.select().from(schema.routeGraphVersions)
      .where(eq(schema.routeGraphVersions.status, 'active'))
      .get();
    expect(activeGraph?.sourceGraphJson).toContain('route-endpoint:managed:');
    const activeRuntime = await db.select().from(schema.compiledRuntimeArtifacts)
      .where(eq(schema.compiledRuntimeArtifacts.sourceGraphVersionId, activeGraph!.id))
      .get();
    expect(activeRuntime?.artifactJson).toContain('route-endpoint:managed:');
    expect(activeGraph?.sourceGraphJson).toContain('route:managed:');

    const targetRows = await listAllRouteGroupMembers();
    expect(targetRows).toHaveLength(2);
    expect(targetRows.every((row) => row.accountId > 0)).toBe(true);
    expect(targetRows.map((row) => row.sourceModel).sort()).toEqual([
      'deepseek-v4-chat',
      'deepseek-v4-flash',
    ]);
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

  it('records structured failure notifications when backup import fails after parsing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/backup/import',
      headers: app.adminHeaders(),
      payload: {
        data: {
          timestamp: Date.now(),
          type: 'accounts',
          accounts: {
            sites: 'not an array',
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    const importEvent = await db.select().from(schema.events)
      .where(eq(schema.events.type, 'backup_import'))
      .get();
    expect(importEvent).toMatchObject({
      scope: 'notification',
      category: 'settings',
      severity: 'critical',
      relatedType: 'settings_import_export',
      source: 'settings.backup_import',
    });
    const details = JSON.parse(importEvent?.detailsJson || '[]');
    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'i18n',
        titleKey: 'backupImport.notification.failedTitle',
        messageKey: 'backupImport.notification.failedMessage',
        paramKeys: { source: 'backupImport.source.manual' },
      }),
      expect.objectContaining({
        type: 'text',
        title: 'backupImport.details.error',
      }),
    ]));
  });

  it('renders import normalization notices as structured notification tables', async () => {
    const payload = {
      version: '2.3',
      timestamp: Date.now(),
      type: 'accounts',
      accounts: {
        sites: [
          {
            id: 1,
            name: 'previous-route-site',
            url: 'https://previous-route.example.test',
            platform: 'openai',
            status: 'active',
          },
        ],
        accounts: [
          {
            id: 1,
            siteId: 1,
            username: 'previous-route-user',
            accessToken: 'previous-route-access',
            apiToken: 'previous-route-api-key',
            status: 'active',
          },
        ],
        accountTokens: [
          {
            id: 1,
            accountId: 1,
            name: 'default-a',
            token: 'sk-previous-route-a',
            enabled: true,
            isDefault: true,
          },
          {
            id: 2,
            accountId: 1,
            name: 'default-b',
            token: 'sk-previous-route-b',
            enabled: true,
            isDefault: false,
          },
        ],
        tokenRoutes: [
          {
            id: 101,
            modelPattern: 'DeepSeek-V4-Flash',
            routingStrategy: 'weighted',
            enabled: true,
          },
          {
            id: 102,
            modelPattern: 'deepseek-v4-flash',
            routingStrategy: 'weighted',
            enabled: true,
          },
        ],
        routeEndpointTargets: [
          {
            id: 11,
            routeId: 101,
            accountId: 1,
            tokenId: 1,
            sourceModel: 'DeepSeek-V4-Flash',
            priority: 0,
            weight: 10,
            enabled: true,
            manualOverride: false,
          },
          {
            id: 12,
            routeId: 102,
            accountId: 1,
            tokenId: 2,
            sourceModel: 'deepseek-v4-flash',
            priority: 0,
            weight: 20,
            enabled: true,
            manualOverride: false,
          },
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
      warnings: expect.arrayContaining([
        expect.stringContaining('归一化后同为 deepseek-v4-flash'),
      ]),
      notices: expect.arrayContaining([
        expect.objectContaining({
          code: 'automatic_model_normalized_coalesced',
          normalizedModelName: 'deepseek-v4-flash',
        }),
      ]),
    });
    const importEvent = await db.select().from(schema.events)
      .where(eq(schema.events.type, 'backup_import'))
      .get();
    expect(importEvent).toMatchObject({
      severity: 'warning',
    });
    const details = JSON.parse(importEvent?.detailsJson || '[]');
    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'text',
        title: 'backupImport.details.coalescedNormalizationNotices',
        text: 'backupImport.noticeReason.automaticModelNameNormalizedSame',
      }),
      expect.objectContaining({
        type: 'table',
        title: 'backupImport.details.coalescedNormalizationNotices',
        columns: [
          'backupImport.details.normalizedModelName',
          'backupImport.details.sourceNames',
          'backupImport.details.resultTarget',
          'backupImport.details.action',
        ],
        rows: expect.arrayContaining([
          [
            'deepseek-v4-flash',
            'DeepSeek-V4-Flash\ndeepseek-v4-flash',
            '-',
            '合并为一个自动路由组 deepseek-v4-flash',
          ],
        ]),
      }),
    ]));
  });

  it('renders unresolved imported route members as an independent structured table', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/backup/import',
      headers: app.adminHeaders(),
      payload: {
        data: {
          version: '2.3',
          timestamp: Date.now(),
          type: 'accounts',
          accounts: {
            sites: [{
              id: 1,
              name: 'valid-site',
              url: 'https://valid.example.test',
              platform: 'openai',
              status: 'active',
            }],
            accounts: [{
              id: 1,
              siteId: 1,
              username: 'valid-account',
              accessToken: 'valid-access-token',
              apiToken: 'valid-api-token',
              status: 'active',
            }],
            accountTokens: [{
              id: 1,
              accountId: 1,
              name: 'default',
              token: 'sk-valid',
              enabled: true,
              isDefault: true,
            }],
            tokenRoutes: [{ id: 7, modelPattern: 'missing-account-model', enabled: true }],
            routeEndpointTargets: [
              {
                id: 71,
                routeId: 7,
                accountId: 1,
                tokenId: 1,
                sourceModel: 'missing-account-model',
                enabled: true,
              },
              {
                id: 70,
                routeId: 7,
                accountId: 404,
                sourceModel: 'missing-account-model',
                enabled: true,
              },
            ],
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      notices: [expect.objectContaining({
        code: 'route_member_unresolved',
        groupKey: '7',
        groupLabel: 'missing-account-model',
        memberReferenceKind: 'route_endpoint',
        memberReference: '70',
        reason: 'account_missing',
      })],
    });
    const importEvent = await db.select().from(schema.events)
      .where(eq(schema.events.type, 'backup_import'))
      .get();
    const details = JSON.parse(importEvent?.detailsJson || '[]');
    expect(details).toEqual(expect.arrayContaining([
      {
        type: 'text',
        title: 'backupImport.details.unresolvedRouteMembers',
        text: 'backupImport.noticeReason.routeMemberUnresolved',
      },
      {
        type: 'table',
        title: 'backupImport.details.unresolvedRouteMembers',
        columns: [
          'backupImport.details.routeGroup',
          'backupImport.details.groupKey',
          'backupImport.details.memberReferenceKind',
          'backupImport.details.memberReference',
          'backupImport.details.reason',
          'backupImport.details.action',
        ],
        rows: [[
          'missing-account-model',
          '7',
          'backupImport.memberReferenceKind.route_endpoint',
          '70',
          'backupImport.unresolvedReason.account_missing',
          'backupImport.unresolvedAction.skipped',
        ]],
      },
    ]));
  });
});
