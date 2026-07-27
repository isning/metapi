import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointPricingSupply } from './pricingQuoteService.js';
import {
  buildRuntimeRoutingSignalMap,
  type RuntimeRoutingSignalContext,
} from './compiledRuntimeRoutingSignalService.js';

const quoteEndpointPricingMock = vi.hoisted(() => vi.fn());
const loadCompiledRuntimeUsageForecastMock = vi.hoisted(() => vi.fn());

vi.mock('./pricingQuoteService.js', () => ({
  quoteEndpointPricing: quoteEndpointPricingMock,
}));

vi.mock('./compiledRuntimeUsageForecastService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./compiledRuntimeUsageForecastService.js')>();
  return {
    ...actual,
    loadCompiledRuntimeUsageForecast: loadCompiledRuntimeUsageForecastMock,
  };
});

function quoteForSupply(supply: EndpointPricingSupply) {
  const walletCost = supply.provider === 'codex' ? 0.8 : 0.2;
  const rawCost = walletCost * 10;
  return {
    subject: {
      kind: 'endpoint_supply',
      ...supply,
    },
    usageProfile: 'preview_1m_io',
    usage: {},
    endpoint: {
      source: 'manual_binding',
      sourceId: null,
      matchedScope: 'site_model',
      sourceType: 'user',
      planFingerprint: null,
      estimateLevel: 'exact',
      evaluation: null,
      summary: {
        inputPerMillion: rawCost / 2,
        outputPerMillion: rawCost / 2,
        cacheReadPerMillion: null,
        cacheWritePerMillion: null,
        reasoningPerMillion: null,
        requestCost: null,
        totalCost: rawCost,
      },
      diagnostics: [],
    },
    reference: null,
    effectiveCost: {
      estimateLevel: 'exact',
      walletCostBaseCurrency: walletCost,
      baseCostUnit: 'USD',
      freeQuotaDaysCost: null,
      balanceBurn: [{ unit: 'USD', amount: walletCost }],
      walletUnit: 'USD',
      faceValuePrice: null,
      rechargeDiscount: null,
      dailyEarnedBalance: null,
      unitConversionRate: null,
      acquisitionProfile: null,
      diagnostics: [],
    },
    comparison: {
      inputMultiplier: null,
      outputMultiplier: null,
      totalMultiplier: null,
    },
    diagnostics: [],
  };
}

function context(overrides: Partial<RuntimeRoutingSignalContext>): RuntimeRoutingSignalContext {
  return {
    executionAttemptId: 'ea_1',
    selectionGroupId: 'plan:public:term',
    enabled: true,
    siteId: 1,
    accountId: 1,
    tokenId: null,
    tokenGroup: null,
    provider: null,
    modelName: 'upstream-model',
    executionTargetId: 1,
    weight: 10,
    order: 0,
    accountBalance: 100,
    accountUnitCost: null,
    accountExtraConfig: null,
    accountOauthProvider: null,
    siteGlobalWeight: 1,
    health: {
      successRate: null,
      totalCalls: 0,
      avgLatencyMs: null,
      cooldownUntil: null,
      consecutiveFailureCount: null,
    },
    endpointState: {
      successCount: 0,
      failCount: 0,
      totalLatencyMs: 0,
      latencySampleCount: 0,
      totalCost: 0,
    },
    ...overrides,
  };
}

describe('buildRuntimeRoutingSignalMap', () => {
  beforeEach(() => {
    quoteEndpointPricingMock.mockReset();
    quoteEndpointPricingMock.mockImplementation(async (input: { supply: EndpointPricingSupply }) => quoteForSupply(input.supply));
    loadCompiledRuntimeUsageForecastMock.mockResolvedValue({
      status: 'available',
      sampleCount: 30,
      confidence: 1,
      estimatedInputTokens: 100,
      expectedOutputTokens: 200,
      p90OutputTokens: 400,
      maxOutputTokens: 512,
    });
  });

  it('uses the unified quote only as static metadata when no request-scoped forecast exists', async () => {
    const signals = await buildRuntimeRoutingSignalMap({
      contexts: [
        context({
          executionAttemptId: 'ea_codex',
          siteId: 10,
          accountId: 20,
          provider: 'codex',
        }),
        context({
          executionAttemptId: 'ea_openai',
          siteId: 11,
          accountId: 21,
          provider: 'openai',
        }),
      ],
    });

    expect(quoteEndpointPricingMock).toHaveBeenCalledTimes(2);
    expect(quoteEndpointPricingMock.mock.calls.map((call) => call[0].supply.provider)).toEqual([
      'codex',
      'openai',
    ]);
    expect(quoteEndpointPricingMock).toHaveBeenCalledWith(expect.objectContaining({
      allowProviderCatalog: true,
      providerCatalogMode: 'cache_only',
    }));
    expect(signals.get('ea_codex')).toMatchObject({
      referencePricing: {
        scenario: 'routing_reference',
        source: 'wallet_acquisition',
        rawCost: 8,
        effectiveCost: 0.8,
      },
    });
    expect(signals.get('ea_openai')).toMatchObject({
      referencePricing: {
        scenario: 'routing_reference',
        source: 'wallet_acquisition',
        rawCost: 2,
        effectiveCost: 0.2,
      },
    });
    expect(signals.get('ea_codex')?.cost.status).toBe('insufficient_data');
    expect(signals.get('ea_openai')?.normalizedCostScore).toBeNull();
    expect(signals.get('ea_codex')?.normalizedCostScore).toBeNull();
  });

  it('uses request-scoped historical usage with actual pricing evaluation for the routing cost component', async () => {
    const signals = await buildRuntimeRoutingSignalMap({
      contexts: [context({ entryId: 'entry:public-model', provider: 'openai' })],
      request: { payload: { messages: [{ role: 'user', content: 'hello' }], max_tokens: 512 } },
    });

    expect(loadCompiledRuntimeUsageForecastMock).toHaveBeenCalledWith(expect.objectContaining({
      entryId: 'entry:public-model',
    }));
    const actualCalls = quoteEndpointPricingMock.mock.calls
      .map(([input]) => input)
      .filter((input) => input.usageProfile === 'actual');
    expect(actualCalls).toHaveLength(4);
    expect(actualCalls.map((input) => input.usage)).toEqual([
      expect.objectContaining({ inputTokens: 100, outputTokens: 0, totalTokens: 100 }),
      expect.objectContaining({ inputTokens: 100, outputTokens: 200, totalTokens: 300 }),
      expect.objectContaining({ inputTokens: 100, outputTokens: 400, totalTokens: 500 }),
      expect.objectContaining({ inputTokens: 100, outputTokens: 512, totalTokens: 612 }),
    ]);
    expect(signals.get('ea_1')?.cost).toMatchObject({
      status: 'available',
      forecast: {
        sampleCount: 30,
        estimatedInputTokens: 100,
        expectedOutputTokens: 200,
        p90OutputTokens: 400,
      },
    });
  });

  it('uses a neutral normalized score when known values are equal', async () => {
    const signals = await buildRuntimeRoutingSignalMap({
      contexts: [
        context({ executionAttemptId: 'ea_a', entryId: 'entry:equal-cost', provider: 'openai' }),
        context({ executionAttemptId: 'ea_b', entryId: 'entry:equal-cost', provider: 'openai', executionTargetId: 2 }),
      ],
      request: { payload: { messages: [{ role: 'user', content: 'hello' }], max_tokens: 512 } },
    });

    expect(signals.get('ea_a')?.normalizedCostScore).toBe(0.5);
    expect(signals.get('ea_b')?.normalizedCostScore).toBe(0.5);
  });

  it('derives recent usage from the windowed health summary instead of lifetime target counters', async () => {
    const signals = await buildRuntimeRoutingSignalMap({
      contexts: [
        context({
          executionAttemptId: 'ea_quiet',
          health: { successRate: 1, totalCalls: 1, avgLatencyMs: 10, cooldownUntil: null, consecutiveFailureCount: 0 },
          endpointState: { successCount: 10_000, failCount: 0, totalLatencyMs: 0, latencySampleCount: 10_000, totalCost: 0 },
        }),
        context({
          executionAttemptId: 'ea_busy',
          executionTargetId: 2,
          health: { successRate: 1, totalCalls: 9, avgLatencyMs: 10, cooldownUntil: null, consecutiveFailureCount: 0 },
          endpointState: { successCount: 0, failCount: 0, totalLatencyMs: 0, latencySampleCount: 0, totalCost: 0 },
        }),
      ],
    });

    expect(signals.get('ea_quiet')?.recentUsage).toBe(1);
    expect(signals.get('ea_busy')?.recentUsage).toBe(9);
    expect(signals.get('ea_quiet')?.normalizedUsageScore).toBe(1);
    expect(signals.get('ea_busy')?.normalizedUsageScore).toBe(0);
  });

  it('preserves unknown routing facts as null while retaining explicit zero facts', async () => {
    const signals = await buildRuntimeRoutingSignalMap({
      contexts: [
        context({
          executionAttemptId: 'ea_unknown',
          siteId: 3,
          executionTargetId: 3,
          accountBalance: null,
          health: null,
          endpointState: null,
        }),
        context({
          executionAttemptId: 'ea_zero',
          executionTargetId: 2,
          accountBalance: 0,
          health: { successRate: null, totalCalls: 0, avgLatencyMs: null, cooldownUntil: null, consecutiveFailureCount: 0 },
          endpointState: { successCount: 0, failCount: 0, totalLatencyMs: 0, latencySampleCount: 0 },
        }),
      ],
    });

    expect(signals.get('ea_unknown')).toMatchObject({
      rawBalance: null,
      normalizedBalanceScore: null,
      recentUsage: null,
      normalizedUsageScore: null,
      successCount: null,
      failCount: null,
      totalLatencyMs: null,
      runtimeHealth: { status: 'unavailable', recentSampleCount: null },
      historicalHealth: { status: 'unavailable', totalCalls: null },
    });
    expect(signals.get('ea_zero')).toMatchObject({
      rawBalance: 0,
      recentUsage: 0,
      successCount: 0,
      failCount: 0,
      totalLatencyMs: 0,
      runtimeHealth: { status: 'insufficient_data', recentSampleCount: 0 },
      historicalHealth: { status: 'insufficient_data', totalCalls: 0 },
    });
  });
});
