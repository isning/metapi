import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { clearRouteGroupMemberTestData, insertRouteGroupMember } from '../../../testing/routeGroupMemberTestUtils.js';
import {
  createGraphNativeRouteFixture,
  publishCurrentGraphNativeRouteFixtures,
  resetGraphNativeRouteFixtures,
} from '../../test/graphNativeRouteFixtures.js';

const fetchMock = vi.fn();
const refreshModelsAndRebuildRoutesMock = vi.fn();
const reportProxyAllFailedMock = vi.fn();
const reportTokenExpiredMock = vi.fn();
const insertProxyLogMock = vi.fn();
const resolveProxyUsageWithSelfLogFallbackMock = vi.fn();
const resolveProxyLogBillingMock = vi.fn();

vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  return {
    ...actual,
    fetch: (...args: unknown[]) => fetchMock(...args),
  };
});

vi.mock('../../services/routeRefreshWorkflow.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../services/routeRefreshWorkflow.js')>(
      '../../services/routeRefreshWorkflow.js',
    );
  return {
    ...actual,
    refreshModelsAndRebuildRoutes: (...args: unknown[]) =>
      refreshModelsAndRebuildRoutesMock(...args),
  };
});

vi.mock('../../services/alertService.js', () => ({
  reportProxyAllFailed: (...args: unknown[]) => reportProxyAllFailedMock(...args),
  reportTokenExpired: (...args: unknown[]) => reportTokenExpiredMock(...args),
}));

vi.mock('../../services/proxyLogStore.js', () => ({
  insertProxyLog: (...args: unknown[]) => insertProxyLogMock(...args),
}));

vi.mock('../../services/proxyUsageFallbackService.js', () => ({
  resolveProxyUsageWithSelfLogFallback: (...args: unknown[]) => resolveProxyUsageWithSelfLogFallbackMock(...args),
}));

vi.mock('../../services/proxyBilling.js', () => ({
  resolveProxyLogBilling: (...args: unknown[]) => resolveProxyLogBillingMock(...args),
}));

vi.mock('../../services/proxyRetryPolicy.js', () => ({
  shouldRetryProxyRequest: () => false,
  shouldAbortSameSiteEndpointFallback: () => false,
  RETRYABLE_TIMEOUT_PATTERNS: [/(request timed out|connection timed out|read timeout|\btimed out\b)/i],
}));

type DbModule = typeof import('../../db/index.js');

describe('/v1/completions site api endpoint rotation', () => {
  let app: FastifyInstance;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-completions-site-api-endpoint-'));
    process.env.DATA_DIR = dataDir;

    await import('../../db/migrate.js');
    const { registerDownstreamProtocolSurface } = await import('../surfaces/downstreamProtocolSurface.js');
    const dbModule = await import('../../db/index.js');
    const { openaiCompletionsProtocolAdapter } = await import('./completions.js');
    db = dbModule.db;
    schema = dbModule.schema;

    app = Fastify();
    await registerDownstreamProtocolSurface(app, openaiCompletionsProtocolAdapter);
  });

  beforeEach(async () => {
    fetchMock.mockReset();
    refreshModelsAndRebuildRoutesMock.mockReset();
    reportProxyAllFailedMock.mockReset();
    reportTokenExpiredMock.mockReset();
    insertProxyLogMock.mockReset();
    resolveProxyUsageWithSelfLogFallbackMock.mockReset();
    resolveProxyLogBillingMock.mockReset();

    resolveProxyUsageWithSelfLogFallbackMock.mockResolvedValue({
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
    });
    resolveProxyLogBillingMock.mockResolvedValue({
      estimatedCost: 0,
      billingDetails: null,
    });

    await db.delete(schema.proxyLogs).run();
    await clearRouteGroupMemberTestData();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.siteApiEndpoints).run();
    await db.delete(schema.sites).run();
    resetGraphNativeRouteFixtures();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.DATA_DIR;
  });

  it('cools down a retryable failed endpoint and retries the next endpoint within the same site', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'nihao-panel',
      url: 'https://console.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'nihao-user',
      accessToken: '',
      apiToken: 'sk-nihao',
      status: 'active',
      checkinEnabled: false,
      extraConfig: JSON.stringify({ credentialMode: 'apikey' }),
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

    const route = await createGraphNativeRouteFixture({
      modelPattern: 'gpt-4o-mini',
      enabled: true,
    });
    await insertRouteGroupMember({
      groupId: route.id,
      accountId: account.id,
      tokenId: null,
      sourceModel: 'gpt-4o-mini',
      priority: 0,
      weight: 10,
      enabled: true,
    });
    await publishCurrentGraphNativeRouteFixtures();

    const upstreamResponses = [
      new Response('bad gateway', { status: 502 }),
      new Response(JSON.stringify({
        id: 'cmpl-ok',
        object: 'text_completion',
        choices: [{ text: 'ok' }],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 2,
          total_tokens: 3,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ];
    fetchMock.mockImplementation(async (url: unknown) => {
      const rawUrl = String(url || '');
      if (rawUrl.endsWith('/api/pricing')) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const next = upstreamResponses.shift();
      if (!next) {
        throw new Error(`unexpected fetch ${rawUrl}`);
      }
      return next;
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/completions',
      headers: {
        authorization: 'Bearer sk-downstream',
      },
      payload: {
        model: 'gpt-4o-mini',
        prompt: 'hello',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'cmpl-ok',
      object: 'text_completion',
    });
    const upstreamFetchUrls = fetchMock.mock.calls
      .map((call) => String(call[0] || ''))
      .filter((url) => !url.endsWith('/api/pricing'));
    expect(upstreamFetchUrls).toEqual([
      'https://api-a.example.com/v1/completions',
      'https://api-b.example.com/v1/completions',
    ]);

    const storedEndpoints = await db.select().from(schema.siteApiEndpoints)
      .where(eq(schema.siteApiEndpoints.siteId, site.id))
      .orderBy(asc(schema.siteApiEndpoints.sortOrder), asc(schema.siteApiEndpoints.id))
      .all();
    expect(storedEndpoints[0]).toMatchObject({
      url: 'https://api-a.example.com',
      lastFailureReason: 'HTTP 502: [upstream:/v1/completions] Upstream returned HTTP 502: bad gateway',
    });
    expect(storedEndpoints[0]?.cooldownUntil).toBeTruthy();
    expect(storedEndpoints[1]).toMatchObject({
      url: 'https://api-b.example.com',
    });
    expect(storedEndpoints[1]?.lastSelectedAt).toBeTruthy();
  });
});
