import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inventory: vi.fn(),
  runtimeFacts: vi.fn(),
  cachedCatalogs: vi.fn(),
  readCache: vi.fn(),
  writeCache: vi.fn(),
  clearCache: vi.fn(),
  runningTask: vi.fn(),
  queueRefresh: vi.fn(),
  quoteEndpoint: vi.fn(),
  quoteReference: vi.fn(),
}));

vi.mock('./compiledRuntimeInventoryService.js', () => ({
  listActiveCompiledRuntimeModelInventory: mocks.inventory,
}));
vi.mock('./modelsMarketplaceRuntimeFactsService.js', () => ({
  listModelsMarketplaceRuntimeFacts: mocks.runtimeFacts,
}));
vi.mock('./providerPricingCatalogCacheService.js', () => ({
  listCachedProviderPricingCatalogs: mocks.cachedCatalogs,
}));
vi.mock('./modelsMarketplaceCacheService.js', () => ({
  readModelsMarketplaceCache: mocks.readCache,
  writeModelsMarketplaceCache: mocks.writeCache,
  clearModelsMarketplaceCache: mocks.clearCache,
  resetModelsMarketplaceCacheForTests: vi.fn(),
}));
vi.mock('./backgroundTaskService.js', () => ({
  getRunningTaskByDedupeKey: mocks.runningTask,
}));
vi.mock('./routeRefreshWorkflow.js', () => ({
  queueRefreshModelsAndRebuildRoutesTask: mocks.queueRefresh,
}));
vi.mock('./pricingQuoteService.js', () => ({
  quoteEndpointPricing: mocks.quoteEndpoint,
  quoteReferencePricing: mocks.quoteReference,
}));

import { getModelsMarketplaceReadModel } from './modelsMarketplaceReadModelService.js';

function attempt(input: {
  executionAttemptId: string;
  executionTargetId: number;
}) {
  return {
    executionAttemptId: input.executionAttemptId,
    executionTargetId: input.executionTargetId,
    endpointId: 'runtime-endpoint-one',
    modelName: 'upstream-model',
    enabled: true,
    executionTarget: {
      id: input.executionTargetId,
      credentialBindingId: 77,
      endpointProfileId: 9,
    },
    state: null,
    account: {
      id: 11,
      username: 'account-one',
      status: 'active',
      unitCost: null,
      balance: null,
    },
    site: {
      id: 5,
      name: 'site-one',
      platform: 'new-api',
      status: 'active',
    },
    token: {
      id: 13,
      name: 'token-one',
      enabled: true,
      isDefault: true,
      valueStatus: 'ready',
      tokenGroup: null,
    },
    latencyMs: null,
  };
}

describe('modelsMarketplaceReadModelService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readCache.mockReturnValue(null);
    mocks.runningTask.mockReturnValue(null);
    mocks.cachedCatalogs.mockResolvedValue([]);
    mocks.runtimeFacts.mockResolvedValue({
      recentHealthLogs: [],
      recentPricingLogs: [],
    });
    mocks.inventory.mockResolvedValue([{
      modelName: 'public-model',
      planId: 'opaque-plan',
      entryNodeId: 'opaque-entry',
      executionAttempts: [
        attempt({ executionAttemptId: 'opaque-attempt-a', executionTargetId: 21 }),
        attempt({ executionAttemptId: 'opaque-attempt-b', executionTargetId: 22 }),
      ],
      invalidExecutionAttempts: [],
    }]);
  });

  it('keeps endpoint, execution-attempt and credential counts at their native grains', async () => {
    const result = await getModelsMarketplaceReadModel({
      query: {},
      refreshRequested: false,
      includePricing: false,
    });

    expect(result.models[0]).toMatchObject({
      endpointCount: 1,
      executionAttemptCount: 2,
      credentialCount: 1,
      accountCount: 1,
      accounts: [{
        endpointCount: 1,
        executionAttemptCount: 2,
        credentialCount: 1,
      }],
      siteCounts: {
        'site-one': {
          endpointCount: 1,
          executionAttemptCount: 2,
          credentialCount: 1,
        },
      },
    });
  });

  it('uses terminal request observations for model success rate', async () => {
    mocks.runtimeFacts.mockResolvedValue({
      recentHealthLogs: [{
        routeEntrypointId: 'opaque-entry',
        status: 'success',
        latencyMs: 400,
      }],
      recentPricingLogs: [],
    });

    const result = await getModelsMarketplaceReadModel({
      query: {},
      refreshRequested: false,
      includePricing: false,
    });

    expect(result.models[0]).toMatchObject({
      successRate: 100,
      avgLatency: 400,
    });
  });
});
