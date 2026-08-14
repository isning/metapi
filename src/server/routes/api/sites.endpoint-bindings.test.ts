import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../../testing/dbHarness.js';

type DbModule = typeof import('../../db/index.js');

describe('sites endpoint bindings API', () => {
  let runtimeDb: IsolatedRuntimeDbHandle;
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-sites-endpoint-bindings-');
    db = runtimeDb.dbModule.db;
    schema = runtimeDb.dbModule.schema;
    const routesModule = await import('./sites.js');
    app = Fastify();
    await app.register(routesModule.sitesRoutes);
  });

  beforeEach(async () => {
    await db.delete(schema.credentialEndpointBindings).run();
    await db.delete(schema.apiEndpointProfiles).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await app.close();
    await runtimeDb.cleanup();
  });

  async function createSiteWithToken(suffix = 'primary') {
    const site = await db.insert(schema.sites).values({
      name: `Endpoint API ${suffix}`,
      url: `https://endpoint-api-${suffix}.example.com`,
      platform: 'openai',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'api-account',
      credential: 'access-token',

    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'api-token',
      token: 'sk-token',
    }).returning().get();
    return { site, account, token };
  }

  it('returns the credential endpoint matrix for a site', async () => {
    const { site, account, token } = await createSiteWithToken();

    const response = await app.inject({
      method: 'GET',
      url: `/api/sites/${site.id}/endpoint-bindings`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      profiles: Array<{ apiType: string; rowId: number }>;
      credentials: Array<{ credentialKey: string; bindings: Array<{ persisted: boolean }> }>;
    };
    expect(body.profiles.map((profile) => profile.apiType)).toEqual([
      'openai_chat_completions',
      'openai_responses',
      'anthropic_messages',
      'openai_embeddings',
      'openai_completions',
      'openai_images_generations',
      'openai_images_edits',
      'openai_videos_generations',
      'openai_videos',
    ]);
    expect(body.credentials.map((credential) => credential.credentialKey)).toEqual([
      `account:${account.id}`,
      `account-token:${token.id}`,
    ]);
    expect(body.credentials[0]?.bindings.every((binding) => binding.persisted === false)).toBe(true);
  });

  it('replaces endpoint bindings for one credential', async () => {
    const { site, token } = await createSiteWithToken();
    const matrixResponse = await app.inject({
      method: 'GET',
      url: `/api/sites/${site.id}/endpoint-bindings`,
    });
    const matrix = matrixResponse.json() as {
      profiles: Array<{ apiType: string; rowId: number }>;
    };
    const chat = matrix.profiles.find((profile) => profile.apiType === 'openai_chat_completions');
    const responses = matrix.profiles.find((profile) => profile.apiType === 'openai_responses');
    expect(chat).toBeTruthy();
    expect(responses).toBeTruthy();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/sites/${site.id}/endpoint-bindings/${encodeURIComponent(`account-token:${token.id}`)}`,
      payload: {
        bindings: [
          {
            apiEndpointProfileId: responses!.rowId,
            enabled: false,
            support: 'supported',
            priority: 0,
          },
          {
            apiEndpointProfileId: chat!.rowId,
            enabled: true,
            support: 'supported',
            priority: 1,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      credentials: Array<{
        credentialKey: string;
        bindings: Array<{ apiEndpointProfileId: number; enabled: boolean; persisted: boolean }>;
      }>;
    };
    const credential = body.credentials.find((row) => row.credentialKey === `account-token:${token.id}`);
    expect(credential?.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        apiEndpointProfileId: responses!.rowId,
        enabled: false,
        persisted: true,
      }),
      expect.objectContaining({
        apiEndpointProfileId: chat!.rowId,
        enabled: true,
        persisted: true,
      }),
    ]));
  });

  it('updates executable endpoint profiles for a site', async () => {
    const { site } = await createSiteWithToken();
    const matrixResponse = await app.inject({
      method: 'GET',
      url: `/api/sites/${site.id}/endpoint-bindings`,
    });
    const matrix = matrixResponse.json() as {
      profiles: Array<{ apiType: string; rowId: number }>;
      catalogSources: Array<{ id: number }>;
    };
    const chat = matrix.profiles.find((profile) => profile.apiType === 'openai_chat_completions');
    const catalogSource = matrix.catalogSources[0];
    expect(chat).toBeTruthy();
    expect(catalogSource).toBeTruthy();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/sites/${site.id}/endpoint-profiles`,
      payload: {
        profiles: [{
          id: chat!.rowId,
          label: 'DeepSeek Chat',
          requestMethod: 'POST',
          requestUrl: 'https://api.deepseek.com/chat/completions',
          defaultHeaders: {
            'x-provider': 'deepseek',
          },
          modelCatalogSourceId: catalogSource!.id,
          capabilityDefaults: {
            status: 'supported',
            input: {
              text: 'native',
              image: 'emulated',
              audio: 'unsupported',
              tools: 'native',
              toolChoice: 'emulated',
              jsonSchema: 'native',
              stream: 'native',
            },
            output: {
              text: 'native',
              reasoning: 'emulated',
              toolCalls: 'native',
              usage: 'native',
              citations: 'unsupported',
            },
            limits: {
              maxContextTokens: 131072,
              maxOutputTokens: 8192,
            },
            operations: {
              'operation.responses.create': 'native',
              'operation.chat.completions.create': 'emulated',
            },
            nativeProtocols: {
              'native.gemini.cachedContent': 'unsupported',
              'native.gemini.thinkingConfig': 'emulated',
            },
            transport: {
              streamSse: 'native',
              jsonBody: 'native',
            },
          },
          enabled: true,
          priority: 3,
        }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      profiles: Array<{
        rowId: number;
        label: string;
        requestUrl: string;
        defaultHeaders: Record<string, string>;
        modelCatalogSourceId: string;
        capabilityDefaults: {
          status: string;
          input: Record<string, string>;
          output: Record<string, string>;
          limits: Record<string, number>;
          operations: Record<string, string>;
          nativeProtocols: Record<string, string>;
          transport: Record<string, string>;
        };
        priority: number;
      }>;
    };
    expect(body.profiles.find((profile) => profile.rowId === chat!.rowId)).toMatchObject({
      label: 'DeepSeek Chat',
      requestUrl: 'https://api.deepseek.com/chat/completions',
      defaultHeaders: {
        'x-provider': 'deepseek',
      },
      modelCatalogSourceId: String(catalogSource!.id),
      priority: 3,
    });
    const savedProfile = body.profiles.find((profile) => profile.rowId === chat!.rowId)!;
    expect(savedProfile.capabilityDefaults.status).toBe('supported');
    expect(savedProfile.capabilityDefaults.input).toMatchObject({
      text: 'native',
      image: 'emulated',
      audio: 'unsupported',
      tools: 'native',
      toolChoice: 'emulated',
      jsonSchema: 'native',
      stream: 'native',
    });
    expect(savedProfile.capabilityDefaults.output).toMatchObject({
      text: 'native',
      reasoning: 'emulated',
      toolCalls: 'native',
      usage: 'native',
      citations: 'unsupported',
    });
    expect(savedProfile.capabilityDefaults.limits).toMatchObject({
      maxContextTokens: 131072,
      maxOutputTokens: 8192,
    });
    expect(savedProfile.capabilityDefaults.operations).toEqual({
      'operation.responses.create': 'native',
      'operation.chat.completions.create': 'emulated',
    });
    expect(savedProfile.capabilityDefaults.nativeProtocols).toEqual({
      'native.gemini.cachedContent': 'unsupported',
      'native.gemini.thinkingConfig': 'emulated',
    });
    expect(savedProfile.capabilityDefaults.transport).toEqual({
      streamSse: 'native',
      jsonBody: 'native',
    });
  });

  it('rejects invalid endpoint profile capability defaults', async () => {
    const { site } = await createSiteWithToken();
    const matrixResponse = await app.inject({
      method: 'GET',
      url: `/api/sites/${site.id}/endpoint-bindings`,
    });
    const matrix = matrixResponse.json() as {
      profiles: Array<{ apiType: string; rowId: number }>;
    };
    const chat = matrix.profiles.find((profile) => profile.apiType === 'openai_chat_completions');
    expect(chat).toBeTruthy();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/sites/${site.id}/endpoint-profiles`,
      payload: {
        profiles: [{
          id: chat!.rowId,
          capabilityDefaults: {
            operations: {
              'operation.responses.create': 'maybe',
            },
          },
        }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: expect.stringContaining('Invalid capability state'),
    });
  });

  it('rejects credentials outside the site', async () => {
    const { site } = await createSiteWithToken();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/sites/${site.id}/endpoint-bindings/${encodeURIComponent('account:999999')}`,
      payload: { bindings: [] },
    });

    expect(response.statusCode).toBe(404);
  });

  it('rejects endpoint profile ids outside the site', async () => {
    const { site, token } = await createSiteWithToken();
    const other = await createSiteWithToken('other');
    const otherMatrixResponse = await app.inject({
      method: 'GET',
      url: `/api/sites/${other.site.id}/endpoint-bindings`,
    });
    const otherMatrix = otherMatrixResponse.json() as {
      profiles: Array<{ rowId: number }>;
    };

    const response = await app.inject({
      method: 'PUT',
      url: `/api/sites/${site.id}/endpoint-bindings/${encodeURIComponent(`account-token:${token.id}`)}`,
      payload: {
        bindings: [{
          apiEndpointProfileId: otherMatrix.profiles[0]!.rowId,
          enabled: true,
          support: 'supported',
        }],
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
