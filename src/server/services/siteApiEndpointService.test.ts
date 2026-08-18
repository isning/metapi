import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';

type DbModule = typeof import('../db/index.js');
type SiteApiEndpointServiceModule = typeof import('./siteApiEndpointService.js');

describe('siteApiEndpointService', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let selectSiteApiEndpointTarget: SiteApiEndpointServiceModule['selectSiteApiEndpointTarget'];
  let recordSiteApiEndpointFailure: SiteApiEndpointServiceModule['recordSiteApiEndpointFailure'];
  let recordSiteApiEndpointSuccess: SiteApiEndpointServiceModule['recordSiteApiEndpointSuccess'];
  let runWithSiteApiEndpointPool: SiteApiEndpointServiceModule['runWithSiteApiEndpointPool'];
  let SiteApiEndpointPoolUnavailableError: SiteApiEndpointServiceModule['SiteApiEndpointPoolUnavailableError'];
  let SiteApiEndpointRequestError: SiteApiEndpointServiceModule['SiteApiEndpointRequestError'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-site-api-endpoint-service-'));
    process.env.DATA_DIR = dataDir;

    await import('../db/migrate.js');
    const dbModule = await import('../db/index.js');
    const serviceModule = await import('./siteApiEndpointService.js');

    db = dbModule.db;
    schema = dbModule.schema;
    selectSiteApiEndpointTarget = serviceModule.selectSiteApiEndpointTarget;
    recordSiteApiEndpointFailure = serviceModule.recordSiteApiEndpointFailure;
    recordSiteApiEndpointSuccess = serviceModule.recordSiteApiEndpointSuccess;
    runWithSiteApiEndpointPool = serviceModule.runWithSiteApiEndpointPool;
    SiteApiEndpointPoolUnavailableError = serviceModule.SiteApiEndpointPoolUnavailableError;
    SiteApiEndpointRequestError = serviceModule.SiteApiEndpointRequestError;
  });

  beforeEach(async () => {
    await db.delete(schema.siteApiEndpoints).run();
    await db.delete(schema.sites).run();
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
  });

  it('returns a synthetic site-url fallback when the site has no configured api endpoints', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'panel-only-site',
      url: 'https://panel.example.com/',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    const selected = await selectSiteApiEndpointTarget(site, '2026-03-31T12:00:00.000Z');

    expect(selected).toMatchObject({
      kind: 'site-fallback',
      siteId: site.id,
      endpointId: null,
      baseUrl: 'https://panel.example.com',
      configuredEndpointCount: 0,
    });
  });

  it('selects the least recently selected enabled endpoint when sort order is tied', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'pool-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    await db.insert(schema.siteApiEndpoints).values([
      {
        siteId: site.id,
        url: 'https://api-b.example.com',
        enabled: true,
        sortOrder: 1,
        lastSelectedAt: '2026-03-31T11:59:00.000Z',
      },
      {
        siteId: site.id,
        url: 'https://api-a.example.com/',
        enabled: true,
        sortOrder: 0,
        lastSelectedAt: '2026-03-31T11:00:00.000Z',
      },
    ]).run();

    const selected = await selectSiteApiEndpointTarget(site, '2026-03-31T12:00:00.000Z');

    expect(selected).toMatchObject({
      kind: 'endpoint',
      siteId: site.id,
      baseUrl: 'https://api-a.example.com',
      configuredEndpointCount: 2,
      endpoint: expect.objectContaining({
        url: 'https://api-a.example.com/',
        sortOrder: 0,
      }),
    });
  });

  it('prefers lower sortOrder before lastSelectedAt when selecting an enabled endpoint', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'ordered-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    await db.insert(schema.siteApiEndpoints).values([
      {
        siteId: site.id,
        url: 'https://api-secondary.example.com',
        enabled: true,
        sortOrder: 1,
        lastSelectedAt: '2026-03-31T11:00:00.000Z',
      },
      {
        siteId: site.id,
        url: 'https://api-primary.example.com',
        enabled: true,
        sortOrder: 0,
        lastSelectedAt: '2026-03-31T11:59:00.000Z',
      },
    ]).run();

    const selected = await selectSiteApiEndpointTarget(site, '2026-03-31T12:00:00.000Z');

    expect(selected).toMatchObject({
      kind: 'endpoint',
      siteId: site.id,
      baseUrl: 'https://api-primary.example.com',
      configuredEndpointCount: 2,
      endpoint: expect.objectContaining({
        url: 'https://api-primary.example.com',
        sortOrder: 0,
      }),
    });
  });

  it('skips disabled endpoints and endpoints that are still cooling down', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'filtered-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    await db.insert(schema.siteApiEndpoints).values([
      {
        siteId: site.id,
        url: 'https://api-disabled.example.com',
        enabled: false,
        sortOrder: 0,
      },
      {
        siteId: site.id,
        url: 'https://api-cooling.example.com',
        enabled: true,
        sortOrder: 1,
        cooldownUntil: '2026-03-31T12:05:00.000Z',
      },
      {
        siteId: site.id,
        url: 'https://api-ready.example.com',
        enabled: true,
        sortOrder: 2,
        cooldownUntil: '2026-03-31T11:55:00.000Z',
      },
    ]).run();

    const selected = await selectSiteApiEndpointTarget(site, '2026-03-31T12:00:00.000Z');

    expect(selected).toMatchObject({
      kind: 'endpoint',
      baseUrl: 'https://api-ready.example.com',
      configuredEndpointCount: 3,
    });
  });

  it('returns null when the site has configured api endpoints but none are currently eligible', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'exhausted-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    await db.insert(schema.siteApiEndpoints).values([
      {
        siteId: site.id,
        url: 'https://api-disabled.example.com',
        enabled: false,
        sortOrder: 0,
      },
      {
        siteId: site.id,
        url: 'https://api-cooling.example.com',
        enabled: true,
        sortOrder: 1,
        cooldownUntil: '2026-03-31T12:05:00.000Z',
      },
    ]).run();

    const selected = await selectSiteApiEndpointTarget(site, '2026-03-31T12:00:00.000Z');

    expect(selected).toBeNull();
  });

  it('preserves endpoint-pool cooldown details when no upstream request can start', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'cooling-pool-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api-cooling.example.com',
      enabled: true,
      cooldownUntil: '2999-03-31T12:05:00.000Z',
      lastFailureReason: 'HTTP 502: fetch failed',
    }).run();

    await expect(runWithSiteApiEndpointPool(site, async () => 'unreachable'))
      .rejects.toMatchObject({
        name: 'SiteApiEndpointPoolUnavailableError',
        details: {
          reason: 'all_endpoints_cooling_down',
          configuredEndpointCount: 1,
          enabledEndpointCount: 1,
          coolingDownEndpointCount: 1,
          nextAvailableAt: '2999-03-31T12:05:00.000Z',
          endpointFailures: [expect.objectContaining({
            url: 'https://api-cooling.example.com',
            enabled: true,
            lastFailureReason: 'HTTP 502: fetch failed',
          })],
        },
      });
    expect(SiteApiEndpointPoolUnavailableError).toBeTypeOf('function');
  });

  it('records retryable failures with a 5-minute cooldown', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'retryable-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    const endpoint = await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api-retryable.example.com',
      enabled: true,
      sortOrder: 0,
    }).returning().get();

    const result = await recordSiteApiEndpointFailure(endpoint.id, {
      status: 502,
      message: 'Bad gateway',
    }, '2026-03-31T12:00:00.000Z');

    expect(result).toMatchObject({
      cooldownAddress: true,
      rotateToNextEndpoint: true,
      cooldownUntil: '2026-03-31T12:05:00.000Z',
      failureReason: 'HTTP 502: Bad gateway',
    });

    const stored = await db.select().from(schema.siteApiEndpoints)
      .where(eq(schema.siteApiEndpoints.id, endpoint.id))
      .get();
    expect(stored).toMatchObject({
      cooldownUntil: '2026-03-31T12:05:00.000Z',
      lastFailedAt: '2026-03-31T12:00:00.000Z',
      lastFailureReason: 'HTTP 502: Bad gateway',
    });
  });

  it('parses retryable HTTP status codes from failure messages when no explicit status is provided', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'message-status-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    const endpoint = await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api-message-status.example.com',
      enabled: true,
      sortOrder: 0,
    }).returning().get();

    const result = await recordSiteApiEndpointFailure(endpoint.id, {
      message: 'HTTP 502: upstream temporarily unavailable',
    }, '2026-03-31T12:00:00.000Z');

    expect(result).toMatchObject({
      cooldownAddress: true,
      rotateToNextEndpoint: true,
      cooldownUntil: '2026-03-31T12:05:00.000Z',
      failureReason: 'HTTP 502: upstream temporarily unavailable',
    });
  });

  it('keeps auth and validation failures out of address health state', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'non-retryable-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    const endpoint = await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api-auth.example.com',
      enabled: true,
      sortOrder: 0,
      cooldownUntil: '2026-03-31T11:00:00.000Z',
    }).returning().get();

    const result = await recordSiteApiEndpointFailure(endpoint.id, {
      status: 401,
      message: 'Invalid token',
    }, '2026-03-31T12:00:00.000Z');

    expect(result).toMatchObject({
      cooldownAddress: false,
      rotateToNextEndpoint: false,
      cooldownUntil: null,
      failureReason: 'HTTP 401: Invalid token',
    });

    const stored = await db.select().from(schema.siteApiEndpoints)
      .where(eq(schema.siteApiEndpoints.id, endpoint.id))
      .get();
    expect(stored).toMatchObject({
      cooldownUntil: '2026-03-31T11:00:00.000Z',
      lastFailedAt: null,
      lastFailureReason: null,
    });
  });

  it('treats HTTP 408 as an address-level transport failure', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'request-timeout-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const endpoint = await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api-timeout.example.com',
      enabled: true,
    }).returning().get();

    const result = await recordSiteApiEndpointFailure(endpoint.id, {
      status: 408,
      message: 'Request timeout',
    }, '2026-03-31T12:00:00.000Z');

    expect(result).toMatchObject({
      failureClass: 'transport',
      cooldownAddress: true,
      rotateToNextEndpoint: true,
      cooldownUntil: '2026-03-31T12:05:00.000Z',
    });
  });

  it('does not let a concurrent non-address failure clear an active address cooldown', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'concurrent-failure-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const endpoint = await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api-concurrent.example.com',
      enabled: true,
      cooldownUntil: '2026-03-31T12:05:00.000Z',
    }).returning().get();

    await recordSiteApiEndpointFailure(endpoint.id, {
      status: 401,
      message: 'Invalid token',
    }, '2026-03-31T12:00:00.000Z');

    const stored = await db.select().from(schema.siteApiEndpoints)
      .where(eq(schema.siteApiEndpoints.id, endpoint.id))
      .get();
    expect(stored).toMatchObject({
      cooldownUntil: '2026-03-31T12:05:00.000Z',
      lastFailedAt: null,
      lastFailureReason: null,
    });
  });

  it('does not let a concurrent rotation-only failure replace an active cooldown reason', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'concurrent-rotation-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const endpoint = await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api-concurrent-rotation.example.com',
      enabled: true,
      cooldownUntil: '2026-03-31T12:05:00.000Z',
      lastFailedAt: '2026-03-31T11:59:59.000Z',
      lastFailureReason: 'HTTP 502: Bad gateway',
    }).returning().get();

    await recordSiteApiEndpointFailure(endpoint.id, {
      status: 429,
      message: 'Too many requests',
    }, '2026-03-31T12:00:00.000Z');

    const stored = await db.select().from(schema.siteApiEndpoints)
      .where(eq(schema.siteApiEndpoints.id, endpoint.id))
      .get();
    expect(stored).toMatchObject({
      cooldownUntil: '2026-03-31T12:05:00.000Z',
      lastFailedAt: '2026-03-31T11:59:59.000Z',
      lastFailureReason: 'HTTP 502: Bad gateway',
    });
  });

  it('keeps model and channel failures out of the site address cooldown even when upstream wraps them in a 5xx', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'model-failure-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const endpoint = await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api-model-failure.example.com',
      enabled: true,
    }).returning().get();
    const error = new SiteApiEndpointRequestError('upstream unavailable', {
      status: 503,
      rawErrText: '{"error":{"code":"get_channel_failed","message":"model capacity exhausted"}}',
    });

    const result = await recordSiteApiEndpointFailure(endpoint.id, {
      status: error.status,
      message: error.message,
      error,
    }, '2026-03-31T12:00:00.000Z');

    expect(result).toMatchObject({
      failureClass: 'model_or_channel',
      cooldownAddress: false,
      rotateToNextEndpoint: false,
      cooldownUntil: null,
    });
  });

  it('rotates a rate-limited request without cooling the address by default', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'rate-limit-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const endpoint = await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api-rate-limit.example.com',
      enabled: true,
    }).returning().get();

    const result = await recordSiteApiEndpointFailure(endpoint.id, {
      status: 429,
      message: 'Too many requests',
    }, '2026-03-31T12:00:00.000Z');

    expect(result).toMatchObject({
      failureClass: 'rate_limit',
      cooldownAddress: false,
      rotateToNextEndpoint: true,
      cooldownUntil: null,
    });

    await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api-rate-limit-fallback.example.com',
      enabled: true,
      sortOrder: 1,
    }).run();
    let calls = 0;
    const selectedUrl = await runWithSiteApiEndpointPool(site, async (target) => {
      calls += 1;
      if (calls === 1) throw new SiteApiEndpointRequestError('Too many requests', { status: 429 });
      return target.baseUrl;
    });
    expect(calls).toBe(2);
    expect(selectedUrl).toBe('https://api-rate-limit-fallback.example.com');
  });

  it('uses a configured rate-limit policy to cool an address for its configured duration', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'custom-rate-limit-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const endpoint = await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api-custom-rate-limit.example.com',
      enabled: true,
    }).returning().get();

    const result = await recordSiteApiEndpointFailure(endpoint.id, {
      status: 429,
      message: 'Too many requests',
    }, '2026-03-31T12:00:00.000Z', {
      policyOverride: { mode: 'custom', policy: { cooldownSec: 75, cooldownOn: ['rate_limit'] } },
    });

    expect(result).toMatchObject({
      failureClass: 'rate_limit',
      cooldownAddress: true,
      rotateToNextEndpoint: true,
      cooldownUntil: '2026-03-31T12:01:15.000Z',
    });
  });

  it('applies the stored site override when rotating a pooled request', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'stored-policy-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
      apiEndpointBackoffPolicy: JSON.stringify({
        mode: 'custom',
        policy: { cooldownSec: 75, cooldownOn: ['rate_limit'] },
      }),
    }).returning().get();
    const endpoints = await db.insert(schema.siteApiEndpoints).values([
      { siteId: site.id, url: 'https://api-primary.example.com', enabled: true, sortOrder: 0 },
      { siteId: site.id, url: 'https://api-fallback.example.com', enabled: true, sortOrder: 1 },
    ]).returning().all();
    let calls = 0;

    const result = await runWithSiteApiEndpointPool(site, async (target) => {
      calls += 1;
      if (calls === 1) {
        throw new SiteApiEndpointRequestError('Too many requests', { status: 429 });
      }
      return target.baseUrl;
    });

    expect(result).toBe('https://api-fallback.example.com');
    const first = await db.select().from(schema.siteApiEndpoints)
      .where(eq(schema.siteApiEndpoints.id, endpoints[0]!.id))
      .get();
    expect(first?.cooldownUntil).toBeTruthy();
  });

  it('clears cooldown metadata and updates lastSelectedAt after a recorded success', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'success-site',
      url: 'https://panel.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    const endpoint = await db.insert(schema.siteApiEndpoints).values({
      siteId: site.id,
      url: 'https://api-success.example.com',
      enabled: true,
      sortOrder: 0,
      cooldownUntil: '2026-03-31T12:05:00.000Z',
      lastFailedAt: '2026-03-31T12:00:00.000Z',
      lastFailureReason: 'HTTP 502: Bad gateway',
    }).returning().get();

    await recordSiteApiEndpointSuccess(endpoint.id, '2026-03-31T12:01:00.000Z');

    const stored = await db.select().from(schema.siteApiEndpoints)
      .where(eq(schema.siteApiEndpoints.id, endpoint.id))
      .orderBy(asc(schema.siteApiEndpoints.id))
      .get();
    expect(stored).toMatchObject({
      cooldownUntil: null,
      lastSelectedAt: '2026-03-31T12:01:00.000Z',
      lastFailureReason: null,
    });
  });
});
