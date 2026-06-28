import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp, type TestAppHandle } from '../../../testing/appHarness.js';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../../testing/dbHarness.js';
import { waitForBackgroundTaskToReachTerminalState } from '../../test-fixtures/backgroundTaskTestUtils.js';

const getModelsMock = vi.fn();
const undiciFetchMock = vi.fn();

class MockProxyAgent {}
class MockAgent {}

vi.mock('../../services/platforms/index.js', () => ({
  getAdapter: () => ({
    getModels: (...args: unknown[]) => getModelsMock(...args),
  }),
}));

vi.mock('undici', () => ({
  fetch: (...args: unknown[]) => undiciFetchMock(...args),
  ProxyAgent: MockProxyAgent,
  Agent: MockAgent,
}));

type DbModule = typeof import('../../db/index.js');
type BackgroundTaskModule = typeof import('../../services/backgroundTaskService.js');

describe('accounts model catalog source discovery', () => {
  let app: TestAppHandle;
  let runtimeDb: IsolatedRuntimeDbHandle;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let backgroundTasks: Pick<BackgroundTaskModule, 'getBackgroundTask' | '__resetBackgroundTasksForTests'>;

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-accounts-model-catalog-');
    const dbModule = runtimeDb.dbModule;
    db = dbModule.db;
    schema = dbModule.schema;
    const routesModule = await import('./accounts.js');
    backgroundTasks = await import('../../services/backgroundTaskService.js');
    app = await createTestApp({
      routes: [routesModule.accountsRoutes],
      auth: 'admin-api',
      env: {
        DATA_DIR: runtimeDb.path,
        DB_TYPE: 'sqlite',
      },
    });
  });

  beforeEach(async () => {
    getModelsMock.mockReset();
    undiciFetchMock.mockReset();
    backgroundTasks.__resetBackgroundTasksForTests();

    await db.delete(schema.routeEndpointTargets).run();
    await db.delete(schema.tokenRoutes).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.modelCatalogSources).run();
    await db.delete(schema.apiEndpointProfiles).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    backgroundTasks?.__resetBackgroundTasksForTests();
    await app?.close();
    await runtimeDb?.cleanup();
  });

  it('refreshes API key models from a configured non-standard catalog URL', async () => {
    getModelsMock.mockResolvedValue(['verification-only-model']);
    undiciFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        payload: {
          models: [
            { name: 'catalog-chat-model' },
            { name: 'catalog-responses-model' },
          ],
        },
      }),
    });

    const site = await db.insert(schema.sites).values({
      name: 'Catalog API Site',
      url: 'https://console.catalog.example.com',
      platform: 'openai',
      status: 'active',
    }).returning().get();

    await db.insert(schema.modelCatalogSources).values({
      siteId: site.id,
      sourceKey: 'custom-catalog',
      label: 'Custom catalog',
      discoveryMethod: 'POST',
      discoveryUrl: 'https://models.catalog.example.com/private/list',
      parser: 'custom_json',
      credentialScope: 'credential',
      enabled: true,
      metadataJson: JSON.stringify({
        modelPath: 'payload.models',
        requestBody: { include: ['chat', 'responses'] },
        headers: { 'x-catalog-source': 'custom' },
      }),
    }).run();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: app.adminHeaders(),
      payload: {
        siteId: site.id,
        credentialMode: 'apikey',
        accessToken: 'sk-catalog-credential',
      },
    });

    expect(createResponse.statusCode, createResponse.body).toBe(200);
    const created = createResponse.json() as { id: number; queued?: boolean; jobId?: string };
    expect(created.queued).toBe(true);
    expect(created.jobId).toBeTruthy();
    await waitForBackgroundTaskToReachTerminalState(backgroundTasks.getBackgroundTask, created.jobId!);

    const modelsResponse = await app.inject({
      method: 'GET',
      url: `/api/accounts/${created.id}/models`,
      headers: app.adminHeaders(),
    });

    expect(modelsResponse.statusCode, modelsResponse.body).toBe(200);
    const body = modelsResponse.json() as { models: Array<{ name: string }> };
    expect(body.models.map((model) => model.name).sort()).toEqual([
      'catalog-chat-model',
      'catalog-responses-model',
    ]);
    expect(getModelsMock).toHaveBeenCalledTimes(1);
    expect(getModelsMock).toHaveBeenCalledWith(
      'https://console.catalog.example.com',
      'sk-catalog-credential',
      undefined,
    );
    expect(undiciFetchMock).toHaveBeenCalledWith(
      'https://models.catalog.example.com/private/list',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-catalog-credential',
          'Content-Type': 'application/json',
          'x-catalog-source': 'custom',
        }),
        body: JSON.stringify({ include: ['chat', 'responses'] }),
      }),
    );
  });
});
