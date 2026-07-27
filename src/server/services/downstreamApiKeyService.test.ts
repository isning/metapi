import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createGraphNativeRouteFixture,
  resetGraphNativeRouteFixtures,
} from '../test/graphNativeRouteFixtures.js';

type DbModule = typeof import('../db/index.js');
type ServiceModule = typeof import('./downstreamApiKeyService.js');
type ConfigModule = typeof import('../config.js');
type RouteGraphServiceModule = typeof import('./routeGraphService.js');

function billingDetails(amount: number, currency = 'USD') {
  return {
    quote: {
      amount,
      unit: 'currency' as const,
      currency,
      source: 'provider_catalog' as const,
      sourceId: 'catalog:downstream-budget-test',
      matchedScope: 'provider_catalog',
      estimateLevel: 'exact' as const,
      planFingerprint: 'sha256:downstream-budget-test',
    },
  };
}

function quotaBillingDetails(amount: number) {
  return {
    quote: {
      amount,
      unit: 'quota' as const,
      currency: null,
      source: 'self_log_quota' as const,
      sourceId: null,
      matchedScope: null,
      estimateLevel: 'exact' as const,
      planFingerprint: 'sha256:downstream-quota-test',
    },
  };
}

describe('downstreamApiKeyService', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let service: ServiceModule;
  let config: ConfigModule['config'];
  let invalidateRouteGraphReadCaches: RouteGraphServiceModule['invalidateRouteGraphReadCaches'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-downstream-key-'));
    process.env.DATA_DIR = dataDir;

    const migrate = await import('../db/migrate.js');
    await migrate.runSqliteMigrations();
    const dbModule = await import('../db/index.js');
    const configModule = await import('../config.js');
    const serviceModule = await import('./downstreamApiKeyService.js');
    const routeGraphService = await import('./routeGraphService.js');

    db = dbModule.db;
    schema = dbModule.schema;
    config = configModule.config;
    service = serviceModule;
    invalidateRouteGraphReadCaches = routeGraphService.invalidateRouteGraphReadCaches;
  });

  beforeEach(async () => {
    resetGraphNativeRouteFixtures();
    await db.delete(schema.downstreamApiKeys).run();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    invalidateRouteGraphReadCaches();
    config.proxyToken = 'sk-global-proxy-token';
  });

  afterAll(() => {
    resetGraphNativeRouteFixtures();
    invalidateRouteGraphReadCaches?.();
    delete process.env.DATA_DIR;
  });

  async function compiledPlanIdForModel(modelName: string): Promise<string> {
    const { listActiveCompiledRuntimeModelEntrypoints } = await import('./compiledRuntimeInventoryService.js');
    const entrypoint = (await listActiveCompiledRuntimeModelEntrypoints())
      .find((item) => item.modelName === modelName);
    if (!entrypoint) {
      throw new Error(`Missing compiled plan for ${modelName}`);
    }
    return entrypoint.planId;
  }

  it('authorizes global proxy token when no managed key matches', async () => {
    const result = await service.authorizeDownstreamToken('sk-global-proxy-token');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.key).toBeNull();
      expect(result.policy.allowedPlanIds).toEqual([]);
      expect(result.policy.supportedModels).toEqual([]);
    }
  });

  it('rejects managed keys by lifecycle guards (disabled, expired, over budget, over requests)', async () => {
    const now = Date.now();

    const disabled = await db.insert(schema.downstreamApiKeys).values({
      name: 'disabled',
      key: 'sk-disabled',
      enabled: false,
    }).returning().get();

    const expired = await db.insert(schema.downstreamApiKeys).values({
      name: 'expired',
      key: 'sk-expired',
      enabled: true,
      expiresAt: new Date(now - 60_000).toISOString(),
    }).returning().get();

    const overBudget = await db.insert(schema.downstreamApiKeys).values({
      name: 'over-budget',
      key: 'sk-over-budget',
      enabled: true,
      maxCost: 1,
      usedCost: 1.2,
    }).returning().get();

    const overRequests = await db.insert(schema.downstreamApiKeys).values({
      name: 'over-requests',
      key: 'sk-over-requests',
      enabled: true,
      maxRequests: 10,
      usedRequests: 10,
    }).returning().get();

    const r1 = await service.authorizeDownstreamToken(disabled.key);
    const r2 = await service.authorizeDownstreamToken(expired.key);
    const r3 = await service.authorizeDownstreamToken(overBudget.key);
    const r4 = await service.authorizeDownstreamToken(overRequests.key);

    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(r3.ok).toBe(false);
    expect(r4.ok).toBe(false);
  });

  it('parses policy fields and supports model matching patterns', async () => {
    const row = await db.insert(schema.downstreamApiKeys).values({
      name: 'project-a',
      key: 'sk-project-a',
      enabled: true,
      supportedModels: JSON.stringify(['re:^claude-(opus|sonnet)-4-6$', 'gpt-4o-mini']),
      allowedPlanIds: JSON.stringify(['program:entry:101', 'program:entry:102']),
      siteWeightMultipliers: JSON.stringify({ '1': 2.5, '7': 0.4 }),
    }).returning().get();

    const result = await service.authorizeDownstreamToken(row.key);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.key?.id).toBe(row.id);
    expect(result.policy.allowedPlanIds).toEqual(['program:entry:101', 'program:entry:102']);
    expect(result.policy.siteWeightMultipliers[1]).toBeCloseTo(2.5);
    expect(result.policy.siteWeightMultipliers[7]).toBeCloseTo(0.4);

    expect(service.isModelAllowedByPolicy('claude-opus-4-6', result.policy)).toBe(true);
    expect(service.isModelAllowedByPolicy('gpt-4o-mini', result.policy)).toBe(true);
    expect(service.isModelAllowedByPolicy('gemini-2.0-flash', result.policy)).toBe(false);
  });

  it('keeps all explicitly selected supported models when list exceeds 200 items', () => {
    const selectedModels = Array.from({ length: 260 }, (_, index) => `model-${String(index + 1).padStart(3, '0')}`);

    expect(service.normalizeSupportedModelsInput(selectedModels)).toEqual(selectedModels);
  });

  it('treats selected compiled plans as an additional allow scope (union semantics)', async () => {
    await createGraphNativeRouteFixture({
      modelPattern: 're:^claude-(opus|sonnet)-4-6$',
      displayName: 'claude-4-6-group',
      enabled: true,
    });

    const policy = {
      supportedModels: ['gpt-4o-mini'],
      allowedPlanIds: [await compiledPlanIdForModel('claude-4-6-group')],
      siteWeightMultipliers: {},
    };

    expect(service.isModelAllowedByPolicy('claude-4-6-group', policy)).toBe(false);
    expect(await service.isModelAllowedByPolicyOrAllowedPlans('claude-4-6-group', policy)).toBe(true);
    expect(await service.isModelAllowedByPolicyOrAllowedPlans('claude-opus-4-6', policy)).toBe(false);
    expect(await service.isModelAllowedByPolicyOrAllowedPlans('gpt-4o-mini', policy)).toBe(true);
    expect(await service.isModelAllowedByPolicyOrAllowedPlans('gemini-2.0-flash', policy)).toBe(false);
  });

  it('denies all models when both supportedModels and allowedPlanIds are empty', async () => {
    const policy = {
      supportedModels: [],
      allowedPlanIds: [],
      siteWeightMultipliers: {},
      denyAllWhenEmpty: true,
    };

    expect(await service.isModelAllowedByPolicyOrAllowedPlans('gpt-4o-mini', policy)).toBe(false);
    expect(await service.isModelAllowedByPolicyOrAllowedPlans('claude-opus-4-6', policy)).toBe(false);
  });

  it('authorizes a selected compiled plan public model only', async () => {
    await createGraphNativeRouteFixture({
      modelPattern: 'claude-opus-4-6',
      displayName: 'claude-opus-4-6',
      enabled: true,
    });

    const policy = {
      supportedModels: [],
      allowedPlanIds: [await compiledPlanIdForModel('claude-opus-4-6')],
      siteWeightMultipliers: {},
    };

    expect(await service.isModelAllowedByPolicyOrAllowedPlans('claude-opus-4-6', policy)).toBe(true);
    expect(await service.isModelAllowedByPolicyOrAllowedPlans('claude-sonnet-4-6', policy)).toBe(false);
  });

  it('only authorizes the public model exposed by the selected compiled plan', async () => {
    await createGraphNativeRouteFixture({
      modelPattern: 're:^claude-(opus|sonnet)-4-5$',
      displayName: 'claude-opus-4-6',
      enabled: true,
    });

    const policy = {
      supportedModels: [],
      allowedPlanIds: [await compiledPlanIdForModel('claude-opus-4-6')],
      siteWeightMultipliers: {},
    };

    expect(await service.isModelAllowedByPolicyOrAllowedPlans('claude-opus-4-6', policy)).toBe(true);
    expect(await service.isModelAllowedByPolicyOrAllowedPlans('claude-sonnet-4-5', policy)).toBe(false);
    expect(await service.isModelAllowedByPolicyOrAllowedPlans('claude-opus-4-5', policy)).toBe(false);
    expect(await service.isModelAllowedByPolicyOrAllowedPlans('gpt-4o-mini', policy)).toBe(false);
  });

  it('accumulates managed key request/cost usage and applies limits', async () => {
    const row = await db.insert(schema.downstreamApiKeys).values({
      name: 'metered-key',
      key: 'sk-metered-key',
      enabled: true,
      maxRequests: 2,
      maxCost: 1,
      usedRequests: 0,
      usedCost: 0,
    }).returning().get();

    await service.consumeManagedKeyRequest(row.id);
    await service.consumeManagedKeyRequest(row.id);
    await service.recordManagedKeyBillingUsage({
      keyId: row.id,
      billingDetails: billingDetails(0.4),
      siteId: null,
      accountId: null,
    });
    await service.recordManagedKeyBillingUsage({
      keyId: row.id,
      billingDetails: billingDetails(0.6),
      siteId: null,
      accountId: null,
    });
    const incompatible = await service.recordManagedKeyBillingUsage({
      keyId: row.id,
      billingDetails: billingDetails(10, 'CNY'),
      siteId: null,
      accountId: null,
    });
    const unknown = await service.recordManagedKeyBillingUsage({
      keyId: row.id,
      billingDetails: null,
      siteId: null,
      accountId: null,
    });
    const free = await service.recordManagedKeyBillingUsage({
      keyId: row.id,
      billingDetails: billingDetails(0),
      siteId: null,
      accountId: null,
    });

    const latest = await service.getDownstreamApiKeyById(row.id);
    expect(latest?.usedRequests).toBe(2);
    expect(latest?.usedCost).toBeCloseTo(1);
    expect(incompatible).toMatchObject({ knownObservationCount: 0, incompatibleObservationCount: 1 });
    expect(unknown).toMatchObject({ knownObservationCount: 0, unknownObservationCount: 1 });
    expect(free).toMatchObject({ amount: 0, knownObservationCount: 1 });

    const authResult = await service.authorizeDownstreamToken(row.key);
    expect(authResult.ok).toBe(false);
  });

  it('values quota billing through wallet acquisition cost before applying the managed-key budget', async () => {
    const { getDefaultPlatformPricingConfig, savePlatformPricingConfig } = await import('./platformPricingConfigService.js');
    await savePlatformPricingConfig({
      ...getDefaultPlatformPricingConfig(),
      walletDefaultValuation: {
        enabled: true,
        walletUnit: 'USD',
        faceValuePrice: 0.5,
        rechargeDiscount: 0.8,
        confidence: 'exact',
      },
    });
    const site = await db.insert(schema.sites).values({
      name: 'quota-budget-site',
      url: 'https://quota-budget.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'quota-budget-account',
      accessToken: 'quota-budget-token',
      status: 'active',
    }).returning().get();
    const key = await db.insert(schema.downstreamApiKeys).values({
      name: 'quota-budget-key',
      key: 'sk-quota-budget-key',
      enabled: true,
      usedCost: 0,
    }).returning().get();

    const valued = await service.recordManagedKeyBillingUsage({
      keyId: key.id,
      billingDetails: quotaBillingDetails(2),
      siteId: site.id,
      accountId: account.id,
    });

    expect(valued).toMatchObject({
      amount: 0.8,
      unit: 'USD',
      knownObservationCount: 1,
      unknownObservationCount: 0,
      incompatibleObservationCount: 0,
    });
    expect((await service.getDownstreamApiKeyById(key.id))?.usedCost).toBeCloseTo(0.8);
  });
});
