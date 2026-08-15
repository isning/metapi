import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitForBackgroundTaskToReachTerminalState } from '../../test-fixtures/backgroundTaskTestUtils.js';
import { clearRouteGroupMemberTestData } from '../../../testing/routeGroupMemberTestUtils.js';

const verifyTokenMock = vi.fn();
const getModelsMock = vi.fn();

vi.mock('../../services/platforms/index.js', () => ({
  getAdapter: () => ({
    credentialCapabilities: {
      session: true,
      apiKey: true,
      sessionCredentialOptions: [{
        kind: 'access_token',
        labelI18nKey: 'pages.accounts.credentialKindAccessToken',
      }],
    },
    accountConnectionFields: [],
    verifyToken: (...args: unknown[]) => verifyTokenMock(...args),
    getModels: (...args: unknown[]) => getModelsMock(...args),
  }),
}));

type DbModule = typeof import('../../db/index.js');
type BackgroundTaskModule = typeof import('../../services/backgroundTaskService.js');

describe('accounts api endpoint host selection', { timeout: 15_000 }, () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let dataDir = '';
  let resetBackgroundTasks: BackgroundTaskModule['__resetBackgroundTasksForTests'];
  let getBackgroundTask: BackgroundTaskModule['getBackgroundTask'];
  let listBackgroundTasks: BackgroundTaskModule['listBackgroundTasks'];

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-accounts-api-site-'));
    process.env.DATA_DIR = dataDir;

    await import('../../db/migrate.js');
    const dbModule = await import('../../db/index.js');
    const routesModule = await import('./accounts.js');
    const backgroundTaskModule = await import('../../services/backgroundTaskService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    resetBackgroundTasks = backgroundTaskModule.__resetBackgroundTasksForTests;
    getBackgroundTask = backgroundTaskModule.getBackgroundTask;
    listBackgroundTasks = backgroundTaskModule.listBackgroundTasks;

    app = Fastify();
    await app.register(routesModule.accountsRoutes);
  });

  beforeEach(async () => {
    verifyTokenMock.mockReset();
    getModelsMock.mockReset();
    resetBackgroundTasks();

    await db.delete(schema.proxyLogs).run();
    await db.delete(schema.checkinLogs).run();
    await clearRouteGroupMemberTestData();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.siteApiEndpoints).run();
    await db.delete(schema.sites).run();
  });

  afterEach(async () => {
    const tasks = listBackgroundTasks(200);
    await Promise.all(tasks.map((task) => (
      waitForBackgroundTaskToReachTerminalState(getBackgroundTask, task.id, {
        timeoutMs: 10_000,
        pollMs: 5,
      })
    )));
    resetBackgroundTasks();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  it('uses the configured ai endpoint for API key verification', async () => {
    getModelsMock.mockResolvedValueOnce(['gpt-4o-mini']);

    const site = await db.insert(schema.sites).values({
      name: 'Nihao Panel',
      url: 'https://console.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api.example.com',
      enabled: true,
      sortOrder: 0,
    }).run();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: {
        siteId: site.id,
        apiKey: 'sk-nihao',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tokenType: 'apikey',
      modelCount: 1,
    });
    expect(getModelsMock).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: { baseUrl: 'https://api.example.com' },
      token: expect.objectContaining({ token: 'sk-nihao' }),
    }));
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });

  it('rotates API key verification across configured ai endpoints after a retryable failure', async () => {
    getModelsMock
      .mockRejectedValueOnce(new Error('HTTP 502: temporary upstream failure'))
      .mockResolvedValueOnce(['gpt-4o-mini']);

    const site = await db.insert(schema.sites).values({
      name: 'Nihao Pool',
      url: 'https://console.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    await db.insert(schema.siteApiEndpoints).values([
      {
        siteId: site.id,
        url: 'https://api-a.example.com',
        enabled: true,
        sortOrder: 0,
      },
      {
        siteId: site.id,
        url: 'https://api-b.example.com',
        enabled: true,
        sortOrder: 1,
      },
    ]).run();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: {
        siteId: site.id,
        apiKey: 'sk-rotate',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tokenType: 'apikey',
      modelCount: 1,
    });
    expect(getModelsMock.mock.calls.slice(0, 2).map(([context]) => [context.endpoint.baseUrl, context.token?.token])).toEqual([
      ['https://api-a.example.com', 'sk-rotate'],
      ['https://api-b.example.com', 'sk-rotate'],
    ]);

    const endpoints = await db.select().from(schema.siteApiEndpoints).all();
    const firstEndpoint = endpoints.find((item) => item.url === 'https://api-a.example.com');
    const secondEndpoint = endpoints.find((item) => item.url === 'https://api-b.example.com');
    expect(firstEndpoint?.cooldownUntil).toBeTruthy();
    expect(firstEndpoint?.lastFailureReason).toContain('HTTP 502');
    expect(secondEndpoint?.lastSelectedAt).toBeTruthy();
  });

  it('keeps session verification on the panel host even when api endpoints exist', async () => {
    verifyTokenMock.mockResolvedValueOnce({
      tokenType: 'session',
      userInfo: { username: 'nihao-user' },
      balance: 12.5,
      apiToken: 'sk-derived',
    });

    const site = await db.insert(schema.sites).values({
      name: 'Nihao Panel',
      url: 'https://console.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api.example.com',
      enabled: true,
      sortOrder: 0,
    }).run();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts/verify-token',
      payload: {
        siteId: site.id,
        credential: 'session-token',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      tokenType: 'session',
    });
    expect(verifyTokenMock).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: { baseUrl: 'https://console.example.com' },
      account: expect.objectContaining({ mode: 'session', credential: 'session-token' }),
      token: null,
    }));
    expect(getModelsMock).not.toHaveBeenCalled();
  });

  it('uses the configured ai endpoint when adding an API key connection', async () => {
    getModelsMock.mockResolvedValueOnce(['gpt-4o-mini']);

    const site = await db.insert(schema.sites).values({
      name: 'Nihao Panel',
      url: 'https://console.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api.example.com',
      enabled: true,
      sortOrder: 0,
    }).run();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: {
        siteId: site.id,
        apiKey: 'sk-nihao-create',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tokenType: 'apikey',
    });
    expect(getModelsMock).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: { baseUrl: 'https://api.example.com' },
      token: expect.objectContaining({ token: 'sk-nihao-create' }),
    }));
  });

  it('rotates API key account creation across configured ai endpoints after a retryable failure', async () => {
    let failedPrimaryEndpoint = false;
    getModelsMock.mockImplementation(async (context) => {
      const baseUrl = context.endpoint.baseUrl;
      const token = context.token?.token;
      if (token !== 'sk-nihao-create-rotate') return ['gpt-4o-mini'];
      if (baseUrl === 'https://api-create-a.example.com' && !failedPrimaryEndpoint) {
        failedPrimaryEndpoint = true;
        throw new Error('HTTP 502: temporary upstream failure');
      }
      if (baseUrl === 'https://api-create-b.example.com') return ['gpt-4o-mini'];
      return ['gpt-4o-mini'];
    });

    const site = await db.insert(schema.sites).values({
      name: 'Nihao Create Pool',
      url: 'https://console.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    await db.insert(schema.siteApiEndpoints).values([
      {
        siteId: site.id,
        url: 'https://api-create-a.example.com',
        enabled: true,
        sortOrder: 0,
      },
      {
        siteId: site.id,
        url: 'https://api-create-b.example.com',
        enabled: true,
        sortOrder: 1,
      },
    ]).run();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: {
        siteId: site.id,
        apiKey: 'sk-nihao-create-rotate',
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { tokenType?: string; queued?: boolean; jobId?: string };
    expect(payload).toMatchObject({
      tokenType: 'apikey',
      queued: true,
    });
    expect(payload.jobId).toBeTruthy();
    const task = await waitForBackgroundTaskToReachTerminalState(getBackgroundTask, payload.jobId!, {
      timeoutMs: 10_000,
      pollMs: 5,
    });
    expect(task?.status).toBe('succeeded');

    const createRotateCalls = getModelsMock.mock.calls
      .filter(([context]) => context.token?.token === 'sk-nihao-create-rotate')
      .map(([context]) => [context.endpoint.baseUrl, context.token?.token]);
    expect(createRotateCalls.slice(0, 2)).toEqual([
      ['https://api-create-a.example.com', 'sk-nihao-create-rotate'],
      ['https://api-create-b.example.com', 'sk-nihao-create-rotate'],
    ]);
  });

  it('supports batch creating multiple API key connections for one site', async () => {
    getModelsMock.mockImplementation(async (context) => {
      const token = context.token?.token;
      if (token === 'sk-batch-a') return ['gpt-4o-mini'];
      if (token === 'sk-batch-b') return ['gpt-4.1-mini'];
      throw new Error(`unexpected token ${String(token)}`);
    });

    const site = await db.insert(schema.sites).values({
      name: 'Nihao Batch Pool',
      url: 'https://console.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api.example.com',
      enabled: true,
      sortOrder: 0,
    }).run();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: {
        siteId: site.id,
        username: 'batch-key',
        apiKey: 'sk-batch-a\nsk-batch-b',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      batch: true,
      totalCount: 2,
      createdCount: 2,
      failedCount: 0,
    });
    expect(getModelsMock.mock.calls.map(([context]) => [context.endpoint.baseUrl, context.token?.token])).toEqual(expect.arrayContaining([
      ['https://api.example.com', 'sk-batch-a'],
      ['https://api.example.com', 'sk-batch-b'],
    ]));

    const accounts = await db.select().from(schema.accounts).all();
    const tokens = await db.select().from(schema.accountTokens).all();
    expect(accounts).toHaveLength(2);
    expect(tokens.map((item) => item.token).sort()).toEqual(['sk-batch-a', 'sk-batch-b']);
    expect(accounts.map((item) => item.username)).toEqual(['batch-key #1', 'batch-key #2']);
  });

  it('treats newline-delimited apiKey payloads as batch API key creation', async () => {
    getModelsMock.mockImplementation(async (context) => {
      const token = context.token?.token;
      if (token === 'sk-array-a') return ['gpt-4o-mini'];
      if (token === 'sk-array-b') return ['gpt-4.1-mini'];
      throw new Error(`unexpected token ${String(token)}`);
    });

    const site = await db.insert(schema.sites).values({
      name: 'Nihao Batch Array',
      url: 'https://console.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api.example.com',
      enabled: true,
      sortOrder: 0,
    }).run();

    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: {
        siteId: site.id,
        username: 'array-key',
        apiKey: 'sk-array-a\nsk-array-b',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      batch: true,
      totalCount: 2,
      createdCount: 2,
      failedCount: 0,
    });
    expect(getModelsMock.mock.calls.map(([context]) => [context.endpoint.baseUrl, context.token?.token])).toEqual(expect.arrayContaining([
      ['https://api.example.com', 'sk-array-a'],
      ['https://api.example.com', 'sk-array-b'],
    ]));

    const accounts = await db.select().from(schema.accounts).all();
    const tokens = await db.select().from(schema.accountTokens).all();
    expect(accounts).toHaveLength(2);
    expect(tokens.map((item) => item.token).sort()).toEqual(['sk-array-a', 'sk-array-b']);
    expect(accounts.map((item) => item.username)).toEqual(['array-key #1', 'array-key #2']);
  });

});
