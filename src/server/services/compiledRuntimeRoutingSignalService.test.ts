import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointPricingSupply } from './pricingQuoteService.js';
import {
  buildRuntimeRoutingSignalMap,
  type RuntimeRoutingSignalContext,
} from './compiledRuntimeRoutingSignalService.js';
import {
  recordCacheAffinityObservation,
  resetCacheAffinityObservationsForTest,
} from './cacheAffinityObservationService.js';

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

function cacheAwareQuote(input: {
  supply: EndpointPricingSupply;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
}) {
  const inputTokens = input.usage?.inputTokens || 0;
  const outputTokens = input.usage?.outputTokens || 0;
  const cacheReadTokens = input.usage?.cacheReadTokens || 0;
  const cacheWriteTokens = input.usage?.cacheWriteTokens || 0;
  const totalCost = inputTokens + outputTokens + cacheReadTokens * 0.1 + cacheWriteTokens * 1.25;
  const quote = quoteForSupply(input.supply);
  quote.endpoint.summary = {
    ...quote.endpoint.summary,
    inputPerMillion: 1,
    outputPerMillion: 1,
    cacheReadPerMillion: 0.1,
    cacheWritePerMillion: 1.25,
    totalCost,
  };
  quote.effectiveCost.walletCostBaseCurrency = totalCost;
  return quote;
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
    resetCacheAffinityObservationsForTest();
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

  it('uses observed cache savings in cost scoring without creating strict affinity', async () => {
    quoteEndpointPricingMock.mockImplementation(async (input: Parameters<typeof cacheAwareQuote>[0]) => cacheAwareQuote(input));
    recordCacheAffinityObservation({
      executionTargetId: 1,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:shared-prefix',
      promptTokens: 100,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      promptTokensIncludeCache: true,
    });

    const signals = await buildRuntimeRoutingSignalMap({
      contexts: [
        context({ executionAttemptId: 'ea_warm', executionTargetId: 1, entryId: 'entry:cache' }),
        context({ executionAttemptId: 'ea_cold', executionTargetId: 2, entryId: 'entry:cache' }),
      ],
      request: {
        endpointType: 'openai.responses',
        payload: { input: 'hello' },
        clientContext: { contentAffinityKey: 'content:shared-prefix' },
      },
    });

    expect(signals.get('ea_warm')?.cost.routingCost).toBeLessThan(signals.get('ea_cold')?.cost.routingCost || 0);
    expect(signals.get('ea_warm')?.normalizedCostScore).toBe(1);
    expect(signals.get('ea_cold')?.normalizedCostScore).toBe(0);
    expect(quoteEndpointPricingMock.mock.calls.some(([input]) => (
      input.usage?.cacheReadTokens === 80 && input.usage?.inputTokens === 20
    ))).toBe(true);
  });

  it('does not reuse cache evidence across endpoint types', async () => {
    quoteEndpointPricingMock.mockImplementation(async (input: Parameters<typeof cacheAwareQuote>[0]) => cacheAwareQuote(input));
    recordCacheAffinityObservation({
      executionTargetId: 1,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:shared-prefix',
      promptTokens: 100,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
    });

    const signals = await buildRuntimeRoutingSignalMap({
      contexts: [
        context({ executionAttemptId: 'ea_a', executionTargetId: 1, entryId: 'entry:cache' }),
        context({ executionAttemptId: 'ea_b', executionTargetId: 2, entryId: 'entry:cache' }),
      ],
      request: {
        endpointType: 'anthropic.messages',
        clientContext: { contentAffinityKey: 'content:shared-prefix' },
      },
    });

    expect(signals.get('ea_a')?.cost.routingCost).toBe(signals.get('ea_b')?.cost.routingCost);
    expect(signals.get('ea_a')?.normalizedCostScore).toBe(0.5);
    expect(signals.get('ea_b')?.normalizedCostScore).toBe(0.5);
  });

  it('falls back to cold cost when cache pricing is unavailable', async () => {
    recordCacheAffinityObservation({
      executionTargetId: 1,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:shared-prefix',
      promptTokens: 100,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
    });

    const signals = await buildRuntimeRoutingSignalMap({
      contexts: [
        context({ executionAttemptId: 'ea_a', executionTargetId: 1, entryId: 'entry:cache' }),
        context({ executionAttemptId: 'ea_b', executionTargetId: 2, entryId: 'entry:cache' }),
      ],
      request: {
        endpointType: 'openai.responses',
        clientContext: { contentAffinityKey: 'content:shared-prefix' },
      },
    });

    expect(signals.get('ea_a')?.cost.routingCost).toBe(signals.get('ea_b')?.cost.routingCost);
    expect(signals.get('ea_a')?.normalizedCostScore).toBe(0.5);
  });

  it('includes observed cache creation charges in miss cost', async () => {
    quoteEndpointPricingMock.mockImplementation(async (input: Parameters<typeof cacheAwareQuote>[0]) => cacheAwareQuote(input));
    recordCacheAffinityObservation({
      executionTargetId: 1,
      endpointType: 'anthropic.messages',
      contentAffinityKey: 'content:shared-prefix',
      promptTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 80,
    });

    const signals = await buildRuntimeRoutingSignalMap({
      contexts: [context({ executionTargetId: 1, entryId: 'entry:cache' })],
      request: {
        endpointType: 'anthropic.messages',
        clientContext: { contentAffinityKey: 'content:shared-prefix' },
      },
    });

    expect(quoteEndpointPricingMock.mock.calls.some(([input]) => (
      input.usage?.cacheWriteTokens === 80 && input.usage?.inputTokens === 20
    ))).toBe(true);
    expect(signals.get('ea_1')?.cost.routingCost).toBeGreaterThan(300);
  });

  it('blends hit, hit-write, and miss-write scenarios into the expected routing cost', async () => {
    quoteEndpointPricingMock.mockImplementation(async (input: Parameters<typeof cacheAwareQuote>[0]) => cacheAwareQuote(input));
    recordCacheAffinityObservation({
      executionTargetId: 1,
      endpointType: 'anthropic.messages',
      contentAffinityKey: 'content:mixed-prefix',
      promptTokens: 100,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
      promptTokensIncludeCache: true,
    });
    recordCacheAffinityObservation({
      executionTargetId: 1,
      endpointType: 'anthropic.messages',
      contentAffinityKey: 'content:mixed-prefix',
      promptTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 50,
      promptTokensIncludeCache: true,
    });

    const signals = await buildRuntimeRoutingSignalMap({
      contexts: [context({ executionTargetId: 1, entryId: 'entry:mixed-cache' })],
      request: {
        endpointType: 'anthropic.messages',
        clientContext: { contentAffinityKey: 'content:mixed-prefix' },
      },
    });

    // One hit and one miss plus the virtual miss gives P(hit) = 1/3.
    // Expected: (230.5 * 1/3) + (312.5 * 2/3) = 285.1666...
    expect(signals.get('ea_1')?.cost.expected?.effectiveCost).toBeCloseTo(285.166667);
    // P90 has the same cache mix and 200 more output tokens; routing adds 25% tail risk.
    expect(signals.get('ea_1')?.cost.routingCost).toBeCloseTo(335.166667);
  });

  it('uses cache observations with reference usage when request history has no P50 forecast', async () => {
    quoteEndpointPricingMock.mockImplementation(async (input: Parameters<typeof cacheAwareQuote>[0]) => cacheAwareQuote(input));
    loadCompiledRuntimeUsageForecastMock.mockResolvedValue({
      status: 'insufficient_data',
      sampleCount: 0,
      confidence: 0,
      maxOutputTokens: null,
    });
    recordCacheAffinityObservation({
      executionTargetId: 1,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:first-request',
      promptTokens: 100,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      promptTokensIncludeCache: true,
    });

    const signals = await buildRuntimeRoutingSignalMap({
      contexts: [context({ executionTargetId: 1, entryId: 'entry:first-request' })],
      request: {
        endpointType: 'openai.responses',
        payload: { input: 'first request without usage history' },
        clientContext: { contentAffinityKey: 'content:first-request' },
      },
    });

    expect(signals.get('ea_1')?.cost.forecast).toMatchObject({
      sampleCount: 0,
      confidence: 0,
      estimatedInputTokens: 500_000,
      expectedOutputTokens: 500_000,
    });
    expect(signals.get('ea_1')?.cost.routingCost).toBe(820_000);
  });

  it('falls back to the cold quote when cache-write pricing required by a warm hit is absent', async () => {
    quoteEndpointPricingMock.mockImplementation(async (input: Parameters<typeof cacheAwareQuote>[0]) => {
      const quote = cacheAwareQuote(input);
      quote.endpoint.summary.cacheWritePerMillion = null;
      return quote;
    });
    recordCacheAffinityObservation({
      executionTargetId: 1,
      endpointType: 'anthropic.messages',
      contentAffinityKey: 'content:write-price-missing',
      promptTokens: 100,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
      promptTokensIncludeCache: true,
    });

    const signals = await buildRuntimeRoutingSignalMap({
      contexts: [context({ executionTargetId: 1, entryId: 'entry:missing-cache-write-price' })],
      request: {
        endpointType: 'anthropic.messages',
        clientContext: { contentAffinityKey: 'content:write-price-missing' },
      },
    });

    expect(signals.get('ea_1')?.cost.expected?.effectiveCost).toBe(300);
    expect(signals.get('ea_1')?.cost.routingCost).toBe(350);
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

    expect(quoteEndpointPricingMock).toHaveBeenCalledTimes(4);
    expect(quoteEndpointPricingMock.mock.calls.map((call) => call[0].supply.provider)).toEqual([
      'codex',
      'openai',
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
    expect(signals.get('ea_codex')?.cost).toMatchObject({
      status: 'available',
      forecast: { sampleCount: 0, confidence: 0, expectedOutputTokens: 500_000 },
      routingCost: 0.8,
    });
    expect(signals.get('ea_openai')?.cost.routingCost).toBe(0.2);
    expect(signals.get('ea_openai')?.normalizedCostScore).toBe(1);
    expect(signals.get('ea_codex')?.normalizedCostScore).toBe(0);
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
