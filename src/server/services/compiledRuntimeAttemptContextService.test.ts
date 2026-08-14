import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type DbModule = typeof import('../db/index.js');
type AttemptContextModule = typeof import('./compiledRuntimeAttemptContextService.js');

describe('compiledRuntimeAttemptContextService', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let closeDbConnections: DbModule['closeDbConnections'];
  let loadCompiledRuntimeAttemptHealth: AttemptContextModule['loadCompiledRuntimeAttemptHealth'];
  let loadCompiledRuntimeCredentialIdentities: AttemptContextModule['loadCompiledRuntimeCredentialIdentities'];
  let buildCompiledRuntimeRoutingSignalContexts: AttemptContextModule['buildCompiledRuntimeRoutingSignalContexts'];

  beforeAll(async () => {
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'metapi-compiled-runtime-attempt-context-'));
    const migrate = await import('../db/migrate.js');
    await migrate.runSqliteMigrations();
    const dbModule = await import('../db/index.js');
    const service = await import('./compiledRuntimeAttemptContextService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    closeDbConnections = dbModule.closeDbConnections;
    loadCompiledRuntimeAttemptHealth = service.loadCompiledRuntimeAttemptHealth;
    loadCompiledRuntimeCredentialIdentities = service.loadCompiledRuntimeCredentialIdentities;
    buildCompiledRuntimeRoutingSignalContexts = service.buildCompiledRuntimeRoutingSignalContexts;
  });

  beforeEach(async () => {
    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await closeDbConnections?.();
    delete process.env.DATA_DIR;
  });

  it('does not count endpoint-matched logs as execution-attempt health', async () => {
    const now = new Date().toISOString();
    await db.insert(schema.proxyLogs).values([
      {
        executionAttemptId: 'ea_foreign',
        executionTargetId: 202,
        runtimeEndpointId: 'endpoint:shared',
        status: 'failed',
        latencyMs: 900,
        createdAt: now,
      },
      {
        executionAttemptId: 'ea_2t',
        executionTargetId: 101,
        runtimeEndpointId: 'endpoint:shared',
        status: 'success',
        latencyMs: 100,
        createdAt: now,
      },
    ]).run();

    const health = await loadCompiledRuntimeAttemptHealth([{
      executionAttemptId: 'ea_2t',
      endpointId: 'endpoint:shared',
      model: 'upstream-model',
      executionTargetId: 101,
      health: {
        successRate: null,
        totalCalls: 0,
        avgLatencyMs: null,
        cooldownUntil: null,
        consecutiveFailureCount: null,
      },
    }]);

    expect(health.get('ea_2t')).toMatchObject({
      totalCalls: 1,
      successCount: 1,
      failureCount: 0,
      successRate: 1,
      avgLatencyMs: 100,
    });
  });

  it('does not use compiled projection labels or health when credential identity is missing', async () => {
    const attempt = {
      executionAttemptId: 'ea_missing_identity',
      endpointId: 'endpoint:missing',
      model: 'upstream-model',
      executionTargetId: 404,
      siteId: 404,
      siteName: 'stale-site',
      siteUrl: 'https://stale.example.com',
      sitePlatform: 'new-api',
      accountId: 405,
      accountLabel: 'stale-account',
      tokenId: 406,
      tokenLabel: 'stale-token',
      tokenGroup: 'stale-group',
      health: {
        successRate: 1,
        totalCalls: 99,
        avgLatencyMs: 123,
        cooldownUntil: '2099-01-01T00:00:00.000Z',
        consecutiveFailureCount: 7,
      },
    };

    const identities = await loadCompiledRuntimeCredentialIdentities([attempt]);
    const contextLoad = await buildCompiledRuntimeRoutingSignalContexts({ attempts: [attempt] });

    expect(identities.size).toBe(0);
    expect(contextLoad.signalContexts).toEqual([]);
    expect(contextLoad.healthByAttemptId.has('ea_missing_identity')).toBe(false);
  });

  it('uses current database credential identity instead of compiled projection labels', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'db-site',
      url: 'https://db.example.com',
      platform: 'new-api',
      status: 'active',
      globalWeight: 3,
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'db-account',

      credential: 'access-db-account',
      status: 'active',
      balance: 42,
      unitCost: 0.5,
      oauthProvider: 'oauth-provider',
      extraConfig: '{"tier":"db"}',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'db-token',
      token: 'sk-db-token',
      tokenGroup: 'db-group',
      enabled: true,
    }).returning().get();
    await db.insert(schema.runtimeExecutionTargets).values({
      id: 501,
      executionKey: 'attempt-context:db-identity',
      siteId: site.id,
      accountId: account.id,
      tokenId: token.id,
      upstreamModelName: 'upstream-model',
      normalizedModelName: 'upstream-model',
      enabled: true,
      discovered: false,
      source: 'test',
    }).run();

    const contextLoad = await buildCompiledRuntimeRoutingSignalContexts({
      selectionGroupIdByExecutionAttemptId: new Map([
        ['ea_db_identity', 'plan:public:term'],
      ]),
      attempts: [{
        executionAttemptId: 'ea_db_identity',
        endpointId: 'endpoint:db',
        model: 'upstream-model',
        executionTargetId: 501,
        siteId: site.id,
        siteName: 'stale-site',
        siteUrl: 'https://stale.example.com',
        sitePlatform: 'stale-platform',
        accountId: account.id,
        accountLabel: 'stale-account',
        tokenId: token.id,
        tokenLabel: 'stale-token',
        tokenGroup: 'stale-group',
      }],
    });

    expect(contextLoad.identities.get('ea_db_identity')).toMatchObject({
      siteId: site.id,
      siteName: 'db-site',
      siteUrl: 'https://db.example.com',
      sitePlatform: 'new-api',
      accountId: account.id,
      accountUsername: 'db-account',
      accountBalance: 42,
      accountExtraConfig: '{"tier":"db"}',
      accountOauthProvider: 'oauth-provider',
      tokenId: token.id,
      tokenName: 'db-token',
      tokenGroup: 'db-group',
    });
    expect(contextLoad.signalContexts).toEqual([
      expect.objectContaining({
        executionAttemptId: 'ea_db_identity',
        siteId: site.id,
        accountId: account.id,
        tokenId: token.id,
        tokenGroup: 'db-group',
        provider: 'new-api',
        accountBalance: 42,
        accountExtraConfig: '{"tier":"db"}',
        accountOauthProvider: 'oauth-provider',
        siteGlobalWeight: 3,
      }),
    ]);
  });
});
