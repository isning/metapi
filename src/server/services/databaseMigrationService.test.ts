import currentContract from '../db/generated/schemaContract.json' with { type: 'json' };
import { describe, expect, it, vi } from 'vitest';
import {
  __databaseMigrationServiceTestUtils,
  maskConnectionString,
  normalizeMigrationInput,
} from './databaseMigrationService.js';

function cloneContract<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const CURRENT_SCHEMA_TABLES = [
  'settings',
  'sites',
  'siteApiEndpoints',
  'modelCatalogSources',
  'apiEndpointProfiles',
  'endpointModelObservations',
  'credentialEndpointBindings',
  'siteAnnouncements',
  'siteDisabledModels',
  'accounts',
  'accountTokens',
  'checkinLogs',
  'modelAvailability',
  'tokenModelAvailability',
  'tokenDisabledModels',
  'upstreamModelCostPricings',
  'providerPricingCatalogCaches',
  'walletAcquisitionProfiles',
  'fxRateSnapshots',
  'oauthRouteUnits',
  'oauthRouteUnitMembers',
  'routeGraphVersions',
  'compiledRuntimeArtifacts',
  'routeGraphDrafts',
  'routeGraphWorkspaceOperationBatches',
  'routeGraphActiveVersion',
  'compiledRuntimeActiveArtifact',
  'runtimeExecutionTargets',
  'runtimeExecutionTargetState',
  'proxyLogs',
  'proxyRequests',
  'proxyDebugTraces',
  'proxyDebugAttempts',
  'proxyVideoTasks',
  'proxyFiles',
  'downstreamApiKeys',
  'siteDayUsage',
  'siteHourUsage',
  'modelDayUsage',
  'routeRuntimeDayUsage',
  'adminSnapshots',
  'analyticsProjectionCheckpoints',
  'events',
  'settings',
] as const;

function createDbSchemaMock() {
  return Object.fromEntries(CURRENT_SCHEMA_TABLES.map((table) => [table, { __table: table }]));
}

function createDbMock(rowsByTable: Record<string, unknown[]>) {
  return {
    select() {
      return {
        from(table: { __table: string }) {
          return {
            all: async () => rowsByTable[table.__table] ?? [],
          };
        },
      };
    },
  };
}

describe('databaseMigrationService', () => {
  it('accepts postgres migration input with normalized url', () => {
    const normalized = normalizeMigrationInput({
      dialect: 'postgres',
      connectionString: '  postgres://user:pass@db.example.com:5432/metapi  ',
      overwrite: true,
    });

    expect(normalized).toEqual({
      dialect: 'postgres',
      connectionString: 'postgres://user:pass@db.example.com:5432/metapi',
      overwrite: true,
      ssl: false,
    });
  });

  it('accepts mysql migration input', () => {
    const normalized = normalizeMigrationInput({
      dialect: 'mysql',
      connectionString: 'mysql://root:pass@db.example.com:3306/metapi',
    });

    expect(normalized.dialect).toBe('mysql');
    expect(normalized.overwrite).toBe(false);
    expect(normalized.ssl).toBe(false);
  });

  it('accepts sqlite file migration target path', () => {
    const normalized = normalizeMigrationInput({
      dialect: 'sqlite',
      connectionString: './data/target.db',
      overwrite: false,
    });

    expect(normalized).toEqual({
      dialect: 'sqlite',
      connectionString: './data/target.db',
      overwrite: false,
      ssl: false,
    });
  });

  it('rejects unknown dialect', () => {
    expect(() => normalizeMigrationInput({
      dialect: 'oracle',
      connectionString: 'oracle://db',
    } as any)).toThrow(/Unsupported database dialect/i);
  });

  it('masks connection string credentials', () => {
    const masked = maskConnectionString('postgres://admin:super-secret@db.example.com:5432/metapi');
    expect(masked).toBe('postgres://****:****@db.example.com:5432/metapi');
  });

  it.each([
    ['mysql', true, '1'],
    ['mysql', false, '0'],
    ['postgres', false, undefined],
  ] as const)('normalizes ssl for %s from %s', (dialect, expected, ssl) => {
    const normalized = normalizeMigrationInput({
      dialect,
      connectionString: `${dialect}://user:pass@host:5432/db`,
      ssl,
    });
    expect(normalized.ssl).toBe(expected);
  });

  it.each(['postgres', 'mysql', 'sqlite'] as const)('creates or patches current runtime schema for %s', async (dialect) => {
    const executedSql: string[] = [];
    const liveContract = cloneContract(currentContract);
    delete liveContract.tables.sites.columns.use_system_proxy;
    delete liveContract.tables.sites.columns.custom_headers;

    await __databaseMigrationServiceTestUtils.ensureSchema({
      dialect,
      connectionString: dialect === 'sqlite' ? ':memory:' : `${dialect}://example.invalid/metapi`,
      ssl: false,
      begin: async () => {},
      commit: async () => {},
      rollback: async () => {},
      execute: async (sqlText) => {
        executedSql.push(sqlText);
        return [];
      },
      queryScalar: async () => 1,
      close: async () => {},
    }, {
      currentContract,
      liveContract,
    });

    const useSystemProxySql = executedSql.find((sqlText) => sqlText.includes('use_system_proxy'));
    const customHeadersSql = executedSql.find((sqlText) => sqlText.includes('custom_headers'));

    expect(useSystemProxySql).toContain('use_system_proxy');
    expect(customHeadersSql).toContain('custom_headers');
  });

  it('migrates current native route runtime tables and JSON logical columns', async () => {
    vi.resetModules();

    const rowsByTable: Record<string, unknown[]> = Object.fromEntries(
      CURRENT_SCHEMA_TABLES.map((table) => [table, []]),
    );
    Object.assign(rowsByTable, {
      sites: [{
        id: 1,
        name: 'demo',
        url: 'https://example.com',
        platform: 'openai',
        useSystemProxy: true,
        customHeaders: { 'x-site-scope': 'internal' },
        status: 'active',
      }],
      accounts: [{
        id: 2,
        siteId: 1,
        username: 'user-1',
        accessToken: 'access-1',
        extraConfig: { platformUserId: 42 },
        status: 'active',
      }],
      accountTokens: [{
        id: 3,
        accountId: 2,
        name: 'primary',
        token: 'sk-token',
        source: 'manual',
        enabled: true,
        isDefault: true,
      }],
      routeGraphVersions: [{
        id: 10,
        version: 1,
        sourceGraphJson: { nodes: [], edges: [], macros: [] },
        status: 'active',
        createdBy: 'fixture',
      }],
      compiledRuntimeArtifacts: [{
        id: 'runtime:v1',
        artifactJson: { hash: 'runtime-fixture', compiledRouterBundle: { plans: [] } },
        bundleHash: 'runtime-fixture',
        sourceGraphVersionId: 10,
        sourceGraphHash: 'sha256:source-fixture',
      }],
      compiledRuntimeActiveArtifact: [{ id: 1, artifactId: 'runtime:v1' }],
      routeGraphActiveVersion: [{ id: 1, versionId: 10 }],
      runtimeExecutionTargets: [{
        id: 21,
        executionKey: 'upstream:deepseek-v4-flash|site:1|account:2|token:3',
        siteId: 1,
        accountId: 2,
        tokenId: 3,
        upstreamModelName: 'deepseek-v4-flash',
        normalizedModelName: 'deepseek-v4-flash',
        enabled: true,
        discovered: true,
        source: 'manual',
        metadataJson: { provider: 'openai' },
      }],
      runtimeExecutionTargetState: [{
        id: 51,
        executionTargetId: 21,
        successCount: 3,
        failCount: 1,
        totalLatencyMs: 1200,
        totalCost: 0.12,
        consecutiveFailCount: 0,
        cooldownLevel: 0,
      }],
      proxyLogs: [{
        id: 61,
        executionAttemptId: 'attempt:runtime:1',
        accountId: 2,
        modelRequested: 'deepseek-v4-flash',
        modelActual: 'deepseek-v4-flash',
        routeEntrypointId: 'route:manual:fixture-deepseek-v4-flash:entry',
        runtimeEndpointId: 'route-endpoint:supply:upstream-model:demo',
        runtimeArtifactId: 'runtime:v1',
        executionTargetId: 21,
        status: 'success',
        httpStatus: 200,
        billingDetails: { total: 0.42, unit: 'credit' },
      }],
      proxyRequests: [{
        id: 'request:runtime:1',
        downstreamPath: '/v1/chat/completions',
        decisionSnapshot: { runtime: {}, metadata: { graph: 'current' } },
        status: 'success',
      }],
      downstreamApiKeys: [{
        id: 71,
        name: 'managed',
        key: 'sk-managed',
        enabled: true,
        supportedModels: ['deepseek-v4-flash'],
        allowedPlanIds: JSON.stringify(['program:route:manual:fixture-deepseek-v4-flash:entry']),
        siteWeightMultipliers: { 1: 1.5 },
        excludedSiteIds: [1],
        excludedCredentialRefs: [{ kind: 'account_token', siteId: 1, accountId: 2, tokenId: 3 }],
      }],
      settings: [{
        key: 'platform_pricing_config_v1',
        value: '{"defaultUnit":"credit"}',
      }],
    });

    const executed: Array<{ sqlText: string; params: unknown[] }> = [];
    const client = {
      dialect: 'sqlite' as const,
      connectionString: ':memory:',
      ssl: false,
      begin: vi.fn(async () => {}),
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
      execute: vi.fn(async (sqlText: string, params: unknown[] = []) => {
        executed.push({ sqlText, params });
        return [];
      }),
      queryScalar: vi.fn(async () => 0),
      close: vi.fn(async () => {}),
    };

    vi.doMock('../db/index.js', () => ({
      db: createDbMock(rowsByTable),
      schema: createDbSchemaMock(),
    }));
    vi.doMock('../db/runtimeSchemaBootstrap.js', () => ({
      createRuntimeSchemaClient: async () => client,
      ensureRuntimeDatabaseSchema: async () => {},
    }));

    try {
      const { migrateCurrentDatabase } = await import('./databaseMigrationService.js');
      const summary = await migrateCurrentDatabase({
        dialect: 'sqlite',
        connectionString: ':memory:',
        overwrite: true,
      });

      expect(summary.rows.routeGraphVersions).toBe(1);
      expect(summary.rows.routeGraphActiveVersion).toBe(1);
      expect(summary.rows.compiledRuntimeArtifacts).toBe(1);
      expect(summary.rows.compiledRuntimeActiveArtifact).toBe(1);
      expect(summary.rows.runtimeExecutionTargets).toBe(1);
      expect(summary.rows.routeGraphWorkspaceOperationBatches).toBe(0);
      expect(summary.rows.proxyLogs).toBe(1);
      expect(client.begin).toHaveBeenCalledTimes(1);
      expect(client.commit).toHaveBeenCalledTimes(1);
      expect(client.rollback).not.toHaveBeenCalled();
      expect(client.close).toHaveBeenCalledTimes(1);

      const tableSql = executed.map((item) => item.sqlText).join('\n');
      expect(tableSql).toContain('INSERT INTO "route_graph_versions"');
      expect(tableSql).toContain('INSERT INTO "compiled_runtime_artifacts"');
      expect(tableSql).toContain('INSERT INTO "runtime_execution_targets"');
      expect(tableSql).not.toContain('token_routes');
      expect(tableSql).not.toContain('route_group_sources');
      expect(tableSql).not.toContain('route_binding_projections');

      const graphVersionInsert = executed.find((item) => item.sqlText.includes('INSERT INTO "route_graph_versions"'));
      expect(graphVersionInsert?.params).toContain('{"nodes":[],"edges":[],"macros":[]}');
      const runtimeArtifactInsert = executed.find((item) => item.sqlText.includes('INSERT INTO "compiled_runtime_artifacts"'));
      expect(runtimeArtifactInsert?.params).toContain('{"hash":"runtime-fixture","compiledRouterBundle":{"plans":[]}}');

      const endpointInsert = executed.find((item) => item.sqlText.includes('INSERT INTO "runtime_execution_targets"'));
      expect(endpointInsert?.params).toContain('{"provider":"openai"}');

      const proxyLogInsert = executed.find((item) => item.sqlText.includes('INSERT INTO "proxy_logs"'));
      expect(proxyLogInsert?.params).toContain('{"total":0.42,"unit":"credit"}');
      const proxyRequestInsert = executed.find((item) => item.sqlText.includes('INSERT INTO "proxy_requests"'));
      expect(proxyRequestInsert?.params).toContain('{"runtime":{},"metadata":{"graph":"current"}}');

      const downstreamKeyInsert = executed.find((item) => item.sqlText.includes('INSERT INTO "downstream_api_keys"'));
      expect(downstreamKeyInsert?.params).toContain('["deepseek-v4-flash"]');
      expect(downstreamKeyInsert?.params).toContain('["program:route:manual:fixture-deepseek-v4-flash:entry"]');
      expect(downstreamKeyInsert?.params).toContain('{"1":1.5}');
      expect(downstreamKeyInsert?.params).toContain('[1]');
      expect(downstreamKeyInsert?.params).toContain('[{"kind":"account_token","siteId":1,"accountId":2,"tokenId":3}]');
    } finally {
      vi.doUnmock('../db/index.js');
      vi.doUnmock('../db/runtimeSchemaBootstrap.js');
      vi.resetModules();
    }
  });
});
