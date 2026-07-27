import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledRouterBundle } from '../../shared/compiledRuntime.js';
import type { CompiledRuntimeProjection } from './compiledRuntimeProjectionService.js';

const quoteEndpointPricingMock = vi.hoisted(() => vi.fn());
const quoteReferencePricingMock = vi.hoisted(() => vi.fn());

vi.mock('./pricingQuoteService.js', () => ({
  quoteEndpointPricing: quoteEndpointPricingMock,
  quoteReferencePricing: quoteReferencePricingMock,
}));

function runtime(overrides: Partial<CompiledRuntimeProjection> = {}): CompiledRuntimeProjection {
  return {
    runtimeRef: {
      artifactId: 'runtime-artifact-1',

      bundleHash: 'hash',
    },
    match: {
      requestedModel: 'public-model',
      planId: 'plan:public-model',
      entryNodeId: 'entry.public',
      publicModelName: 'public-model',
    },
    alternatives: [
      {
        alternativeId: 'alt:a',
        kind: 'execution_attempt',
        enabled: true,
        endpointId: 'endpoint:a',
        nodeId: 'endpoint:a',
        routeId: 11,
        model: 'upstream-a',
        executionAttemptIds: ['ea_2t'],
        selectionTerms: [{
          termId: 'term:attempt',
          optionId: 'ea_2t',
          mode: 'execution_attempt',
          policy: {
            source: 'builtin',
            id: 'weighted',
            kind: 'builtin',
            selectionMode: 'weighted',
          },
          enabled: true,
          weight: 1,
          order: 0,
        }],
        probability: 0.25,
        probabilityStatus: 'static',
        syntheticResponse: null,
      },
      {
        alternativeId: 'alt:b',
        kind: 'execution_attempt',
        enabled: true,
        endpointId: 'endpoint:b',
        nodeId: 'endpoint:b',
        routeId: 11,
        model: 'upstream-b',
        executionAttemptIds: ['ea_2u'],
        selectionTerms: [{
          termId: 'term:attempt',
          optionId: 'ea_2u',
          mode: 'execution_attempt',
          policy: {
            source: 'builtin',
            id: 'weighted',
            kind: 'builtin',
            selectionMode: 'weighted',
          },
          enabled: true,
          weight: 3,
          order: 1,
        }],
        probability: 0.75,
        probabilityStatus: 'static',
        syntheticResponse: null,
      },
    ],
    endpoints: [
      {
        endpointId: 'endpoint:a',
        nodeId: 'endpoint:a',
        routeId: 11,
        alternativeIds: ['alt:a'],
        executionAttemptIds: ['ea_2t'],
      },
      {
        endpointId: 'endpoint:b',
        nodeId: 'endpoint:b',
        routeId: 11,
        alternativeIds: ['alt:b'],
        executionAttemptIds: ['ea_2u'],
      },
    ],
    executionAttempts: [
      {
        executionAttemptId: 'ea_2t',
        alternativeId: 'alt:a',
        endpointId: 'endpoint:a',
        nodeId: 'endpoint:a',
        routeId: 11,
        executionTargetId: 101,
        model: 'upstream-a',
        modelSource: 'fixed',
        enabled: true,
        siteId: 1,
        siteName: 'site-a',
        siteUrl: null,
        sitePlatform: 'openai',
        accountId: 11,
        accountLabel: 'account-a',
        tokenId: 111,
        tokenLabel: 'token-a',
        tokenGroup: 'group-a',
        weight: 1,
        probability: 0.25,
        probabilityStatus: 'static',
        health: {
          successRate: null,
          totalCalls: 0,
          avgLatencyMs: null,
          cooldownUntil: null,
          consecutiveFailureCount: null,
        },
      },
      {
        executionAttemptId: 'ea_2u',
        alternativeId: 'alt:b',
        endpointId: 'endpoint:b',
        nodeId: 'endpoint:b',
        routeId: 11,
        executionTargetId: 102,
        model: 'upstream-b',
        modelSource: 'fixed',
        enabled: true,
        siteId: 2,
        siteName: 'site-b',
        siteUrl: null,
        sitePlatform: 'openai',
        accountId: 22,
        accountLabel: 'account-b',
        tokenId: 222,
        tokenLabel: 'token-b',
        tokenGroup: null,
        weight: 3,
        probability: 0.75,
        probabilityStatus: 'static',
        health: {
          successRate: null,
          totalCalls: 0,
          avgLatencyMs: null,
          cooldownUntil: null,
          consecutiveFailureCount: null,
        },
      },
    ],
    selected: {
      alternativeId: 'alt:b',
      endpointId: 'endpoint:b',
      routeId: 11,
      executionAttemptId: 'ea_2u',
      accountId: 22,
      tokenId: 222,
      siteId: 2,
      actualModel: 'upstream-b',
      selectionSource: 'compiled_runtime',
    },
    filters: {
      preSelectionApplied: [],
      postBuild: {
        payload: [],
        headers: [],
      },
    },
    syntheticResponse: null,
    ...overrides,
  };
}

function mockEndpointQuotes() {
  quoteReferencePricingMock.mockResolvedValue({
    reference: null,
  });
  quoteEndpointPricingMock.mockImplementation(async ({ supply }: { supply: { modelName: string } }) => {
    const isA = supply.modelName === 'upstream-a';
    return {
      endpoint: {
        source: 'manual_binding',
        sourceId: isA ? 1 : 2,
        matchedScope: 'token_model',
        sourceType: 'user',
        planFingerprint: null,
        estimateLevel: 'exact',
        evaluation: null,
        diagnostics: [],
        summary: {
          inputPerMillion: isA ? 2 : 10,
          outputPerMillion: isA ? 4 : 20,
          cacheReadPerMillion: null,
          cacheWritePerMillion: null,
          reasoningPerMillion: null,
          requestCost: null,
          totalCost: isA ? 6 : 14,
        },
      },
      effectiveCost: null,
      reference: null,
      comparison: {
        inputMultiplier: null,
        outputMultiplier: null,
        totalMultiplier: null,
      },
      diagnostics: [],
    };
  });
}

function bundleForRouteEntryPricing(includeFirstTransportBinding = true): CompiledRouterBundle {
  return {
    hash: 'pricing-bundle',
    matcher: {
      exact: {
        'public-model': { programId: 'plan:public-model' },
      },
      normalizedExact: {},
      patterns: [],
    },
    diagnostics: [],
    planIndex: {
      'plan:public-model': 0,
    },
    plans: [{
      id: 'plan:public-model',
      entryNodeId: 'entry.public',
      publicModelName: 'public-model',
      enabled: true,
      filterStages: [],
      executionAlternatives: [
        {
          alternativeId: 'alt:a',
          kind: 'execution_attempt',
          enabled: true,
          filterStageIndexes: [],
          selectionTerms: [{
            termId: 'term:attempt',
            nodeId: 'term:attempt',
            mode: 'execution_attempt',
            policy: { kind: 'builtin', builtin: 'weighted' },
            optionId: 'a',
            optionIndex: 0,
            optionKind: 'route',
            enabled: true,
            weight: 1,
            order: 0,
            sourceRef: {},
          }],
          terminal: {
            kind: 'supply',
            endpointId: 'endpoint:a',
            nodeId: 'endpoint:a',
            targetSelectionPolicy: { kind: 'builtin', builtin: 'weighted' },
            sourceRef: {},
          },
          endpoint: {
            endpointId: 'endpoint:a',
            nodeId: 'endpoint:a',
            model: 'upstream-a',
            sourceRef: {},
          },
          executionAttempt: {
            endpointId: 'endpoint:a',
            executionAttemptId: 'ea_2t',
            targetId: 'compiled-target-a',
            nodeId: 'endpoint:a',
            model: 'upstream-a',
            modelSource: 'fixed',
            enabled: true,
            siteId: 1,
            accountId: 11,
            tokenId: 111,
            weight: 1,
            ...(includeFirstTransportBinding
              ? { transportBinding: { kind: 'execution_target' as const, executionTargetId: 101 } }
              : {}),
            metadata: { tokenGroup: 'group-a' },
            sourceRef: {},
          },
          syntheticResponse: null,
          lineage: {
            terminalRef: 'endpoint:a',
            selectionPath: [{ termId: 'term:attempt', optionId: 'a' }],
          },
        },
        {
          alternativeId: 'alt:b',
          kind: 'execution_attempt',
          enabled: true,
          filterStageIndexes: [],
          selectionTerms: [{
            termId: 'term:attempt',
            nodeId: 'term:attempt',
            mode: 'execution_attempt',
            policy: { kind: 'builtin', builtin: 'weighted' },
            optionId: 'b',
            optionIndex: 1,
            optionKind: 'route',
            enabled: true,
            weight: 3,
            order: 1,
            sourceRef: {},
          }],
          terminal: {
            kind: 'supply',
            endpointId: 'endpoint:b',
            nodeId: 'endpoint:b',
            targetSelectionPolicy: { kind: 'builtin', builtin: 'weighted' },
            sourceRef: {},
          },
          endpoint: {
            endpointId: 'endpoint:b',
            nodeId: 'endpoint:b',
            model: 'upstream-b',
            sourceRef: {},
          },
          executionAttempt: {
            endpointId: 'endpoint:b',
            executionAttemptId: 'ea_2u',
            targetId: 'compiled-target-b',
            nodeId: 'endpoint:b',
            model: 'upstream-b',
            modelSource: 'fixed',
            enabled: true,
            siteId: 2,
            accountId: 22,
            tokenId: 222,
            weight: 3,
            transportBinding: { kind: 'execution_target', executionTargetId: 102 },
            metadata: {},
            sourceRef: {},
          },
          syntheticResponse: null,
          lineage: {
            terminalRef: 'endpoint:b',
            selectionPath: [{ termId: 'term:attempt', optionId: 'b' }],
          },
        },
      ],
      sourceRef: {},
    }],
  } as unknown as CompiledRouterBundle;
}

describe('routeEntryPricingService', () => {
  beforeEach(() => {
    quoteEndpointPricingMock.mockReset();
    quoteReferencePricingMock.mockReset();
  });

  it('calculates theoretical entry pricing from compiled runtime execution attempt probabilities', async () => {
    mockEndpointQuotes();

    const { estimateCompiledRuntimeEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateCompiledRuntimeEntryPricing({
      runtime: runtime(),
    });

    expect(estimate).toMatchObject({
      inputPerMillion: 8,
      outputPerMillion: 16,
      totalCost: 12,
      inputMultiplier: null,
      outputMultiplier: null,
      totalMultiplier: null,
      reference: null,
      sourceCount: 2,
      selectionMode: 'weighted',
      estimateLevel: 'exact',
    });
    expect(estimate?.executionAttempts.map((attempt) => ({
      id: attempt.executionAttemptId,
      modelName: attempt.modelName,
      probability: attempt.probability,
    }))).toEqual([
      { id: 'ea_2t', modelName: 'upstream-a', probability: 0.25 },
      { id: 'ea_2u', modelName: 'upstream-b', probability: 0.75 },
    ]);
    expect(quoteEndpointPricingMock).toHaveBeenCalledWith(expect.objectContaining({
      allowProviderCatalog: true,
      providerCatalogMode: 'cache_only',
      supply: expect.objectContaining({
        tokenGroup: 'group-a',
      }),
    }));
  });

  it('does not price compiled runtime execution attempts by falling back to the requested model', async () => {
    mockEndpointQuotes();

    const { estimateCompiledRuntimeEntryPricing } = await import('./routeEntryPricingService.js');
    const base = runtime();
    const estimate = await estimateCompiledRuntimeEntryPricing({
      runtime: runtime({
        executionAttempts: [
          { ...base.executionAttempts[0], model: '' },
          base.executionAttempts[1],
        ],
      }),
    });

    expect(quoteEndpointPricingMock).toHaveBeenCalledTimes(1);
    expect(quoteEndpointPricingMock).toHaveBeenCalledWith(expect.objectContaining({
      supply: expect.objectContaining({ modelName: 'upstream-b' }),
    }));
    expect(quoteEndpointPricingMock).not.toHaveBeenCalledWith(expect.objectContaining({
      supply: expect.objectContaining({ modelName: 'public-model' }),
    }));
    expect(estimate?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'warn',
        message: 'Missing upstream model for execution attempt ea_2t.',
      }),
    ]));
    expect(estimate?.executionAttempts.find((attempt) => attempt.executionAttemptId === 'ea_2t')).toMatchObject({
      modelName: '',
      totalCost: null,
      effectiveCost: null,
    });
  });

  it('uses canonical execution attempt ids when estimating entry pricing from a compiled bundle', async () => {
    mockEndpointQuotes();

    const { estimateRouteEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateRouteEntryPricing({
      bundle: bundleForRouteEntryPricing(),
      requestedModel: 'public-model',
    });

    expect(estimate?.executionAttempts.map((attempt) => ({
      id: attempt.executionAttemptId,
      probability: attempt.probability,
    }))).toEqual([
      { id: 'ea_2t', probability: 0.25 },
      { id: 'ea_2u', probability: 0.75 },
    ]);
  });

  it('skips compiled bundle targets that do not carry a transport binding', async () => {
    mockEndpointQuotes();

    const { estimateRouteEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateRouteEntryPricing({
      bundle: bundleForRouteEntryPricing(false),
      requestedModel: 'public-model',
    });

    expect(estimate?.executionAttempts.map((attempt) => attempt.executionAttemptId)).toEqual(['ea_2u']);
    expect(quoteEndpointPricingMock).toHaveBeenCalledTimes(1);
  });

  it('does not price fixed compiled bundle targets by falling back to the requested model', async () => {
    mockEndpointQuotes();

    const bundle = bundleForRouteEntryPricing();
    const plan = bundle.plans[0]!;
    plan.executionAlternatives[0]!.executionAttempt!.model = '';

    const { estimateRouteEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateRouteEntryPricing({
      bundle,
      requestedModel: 'public-model',
    });

    expect(quoteEndpointPricingMock).toHaveBeenCalledTimes(1);
    expect(quoteEndpointPricingMock).toHaveBeenCalledWith(expect.objectContaining({
      supply: expect.objectContaining({ modelName: 'upstream-b' }),
    }));
    expect(quoteEndpointPricingMock).not.toHaveBeenCalledWith(expect.objectContaining({
      supply: expect.objectContaining({ modelName: 'public-model' }),
    }));
    expect(estimate?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'warn',
        message: 'Missing upstream model for execution attempt ea_2t.',
      }),
    ]));
  });

  it('does not treat system default pricing as a concrete compiled runtime entry price', async () => {
    quoteReferencePricingMock.mockResolvedValue({
      reference: null,
    });
    quoteEndpointPricingMock.mockResolvedValue({
      endpoint: {
        source: 'system_default',
        sourceId: null,
        matchedScope: 'system_default',
        sourceType: 'system_default',
        planFingerprint: null,
        estimateLevel: 'estimated',
        evaluation: null,
        diagnostics: [],
        summary: {
          inputPerMillion: 1,
          outputPerMillion: 1,
          totalCost: 2,
        },
      },
      effectiveCost: {
        estimateLevel: 'estimated',
        walletCostBaseCurrency: 2,
        baseCostUnit: 'USD',
        freeQuotaDaysCost: null,
        balanceBurn: [],
        walletUnit: null,
        faceValuePrice: null,
        rechargeDiscount: null,
        dailyEarnedBalance: null,
        unitConversionRate: null,
        acquisitionProfile: null,
        diagnostics: [],
      },
      reference: null,
      comparison: {
        inputMultiplier: null,
        outputMultiplier: null,
        totalMultiplier: null,
      },
      diagnostics: [],
    });

    const { estimateCompiledRuntimeEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateCompiledRuntimeEntryPricing({
      runtime: runtime(),
    });

    expect(estimate).toMatchObject({
      inputPerMillion: null,
      outputPerMillion: null,
      totalCost: null,
      sourceCount: 0,
      estimateLevel: 'static_estimate',
    });
    expect(estimate?.executionAttempts).toEqual([
      expect.objectContaining({
        inputPerMillion: null,
        outputPerMillion: null,
        totalCost: null,
        effectiveCost: null,
        matchedScope: null,
      }),
      expect.objectContaining({
        inputPerMillion: null,
        outputPerMillion: null,
        totalCost: null,
        effectiveCost: null,
        matchedScope: null,
      }),
    ]);
  });

  it('calculates entry multipliers against the public model reference price', async () => {
    mockEndpointQuotes();
    quoteReferencePricingMock.mockResolvedValue({
      reference: {
        source: 'official_reference',
        summary: {
          inputPerMillion: 4,
          outputPerMillion: 8,
          cacheReadPerMillion: null,
          cacheWritePerMillion: null,
          reasoningPerMillion: null,
          requestCost: null,
          totalCost: 6,
        },
      },
    });

    const { estimateCompiledRuntimeEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateCompiledRuntimeEntryPricing({
      runtime: runtime(),
    });

    expect(estimate).toMatchObject({
      inputPerMillion: 8,
      outputPerMillion: 16,
      totalCost: 12,
      inputMultiplier: 2,
      outputMultiplier: 2,
      totalMultiplier: 2,
      reference: {
        inputPerMillion: 4,
        outputPerMillion: 8,
        totalCost: 6,
      },
    });
  });

  it('weights advanced pricing components with explicit route-flow usage', async () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 2_000_000,
      cacheReadTokens: 500_000,
      cacheWriteTokens: 100_000,
      reasoningTokens: 250_000,
      requestCount: 1,
    };
    quoteReferencePricingMock.mockResolvedValue({
      reference: null,
      usage,
    });
    quoteEndpointPricingMock.mockImplementation(async ({ supply, usage: quotedUsage }: {
      supply: { modelName: string };
      usage: typeof usage;
    }) => {
      const isA = supply.modelName === 'upstream-a';
      const summary = {
        inputPerMillion: isA ? 2 : 10,
        outputPerMillion: isA ? 4 : 20,
        cacheReadPerMillion: isA ? 1 : 2,
        cacheWritePerMillion: isA ? 3 : 6,
        reasoningPerMillion: isA ? 5 : 10,
        requestCost: isA ? 0.1 : 0.2,
        totalCost: isA ? 12.15 : 54.3,
      };
      return {
        endpoint: {
          source: 'manual_binding',
          sourceId: isA ? 1 : 2,
          matchedScope: 'token_model',
          sourceType: 'user',
          planFingerprint: null,
          estimateLevel: 'exact',
          diagnostics: [],
          summary,
          evaluation: {
            catalogEntryId: null,
            source: 'user_override',
            usageHash: 'hash',
            planFingerprint: 'plan',
            totalCost: summary.totalCost,
            subtotalCost: summary.totalCost,
            adjustmentCost: 0,
            estimateLevel: 'exact',
            components: [
              { componentId: 'input', kind: 'input_tokens', quantity: quotedUsage.inputTokens, scale: 1_000_000, unitPrice: summary.inputPerMillion, cost: summary.inputPerMillion, role: 'charge' },
              { componentId: 'output', kind: 'output_tokens', quantity: quotedUsage.outputTokens, scale: 1_000_000, unitPrice: summary.outputPerMillion, cost: summary.outputPerMillion * 2, role: 'charge' },
              { componentId: 'cache_read', kind: 'cache_read_tokens', quantity: quotedUsage.cacheReadTokens, scale: 1_000_000, unitPrice: summary.cacheReadPerMillion, cost: summary.cacheReadPerMillion * 0.5, role: 'charge' },
              { componentId: 'cache_write', kind: 'cache_write_tokens', quantity: quotedUsage.cacheWriteTokens, scale: 1_000_000, unitPrice: summary.cacheWritePerMillion, cost: summary.cacheWritePerMillion * 0.1, role: 'charge' },
              { componentId: 'reasoning', kind: 'reasoning_tokens', quantity: quotedUsage.reasoningTokens, scale: 1_000_000, unitPrice: summary.reasoningPerMillion, cost: summary.reasoningPerMillion * 0.25, role: 'charge' },
              { componentId: 'request', kind: 'request', quantity: quotedUsage.requestCount, scale: 1, unitPrice: summary.requestCost, cost: summary.requestCost, role: 'charge' },
              { componentId: 'tool-call', kind: 'tool_call', quantity: isA ? 2 : 4, scale: 1, unitPrice: 0.03, cost: isA ? 0.06 : 0.12, role: 'charge', tierId: 'tier-tools', quantityPricingMode: 'graduated_tier', allowanceApplied: isA ? 1 : 2, overlayIds: ['overlay-tools'] },
              { componentId: 'promo-credit', kind: 'custom', quantity: 1, scale: 1, unitPrice: 0.5, cost: -0.5, role: 'discount', overlayIds: ['promo'] },
            ],
            equivalentMultipliers: {},
            diagnostics: [],
          },
        },
        usage: quotedUsage,
        effectiveCost: null,
        reference: null,
        comparison: {
          inputMultiplier: null,
          outputMultiplier: null,
          totalMultiplier: null,
        },
        diagnostics: [],
      };
    });

    const { estimateCompiledRuntimeEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateCompiledRuntimeEntryPricing({
      runtime: runtime(),
      usage,
    });

    expect(quoteEndpointPricingMock).toHaveBeenCalledWith(expect.objectContaining({
      providerCatalogMode: 'cache_only',
      usageProfile: 'actual',
      usage,
    }));
    expect(quoteReferencePricingMock).toHaveBeenCalledWith(expect.objectContaining({
      usageProfile: 'actual',
      usage,
    }));
    expect(estimate).toMatchObject({
      inputPerMillion: 8,
      outputPerMillion: 16,
      cacheReadPerMillion: 1.75,
      cacheWritePerMillion: 5.25,
      reasoningPerMillion: 8.75,
      requestCost: 0.175,
      totalCost: 43.7625,
      usage,
    });
    expect(estimate?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'cache_read_tokens', unitPrice: 1.75, cost: 0.875 }),
      expect.objectContaining({ kind: 'cache_write_tokens', unitPrice: 5.25, cost: 0.525 }),
      expect.objectContaining({ kind: 'reasoning_tokens', unitPrice: 8.75, cost: 2.1875 }),
      expect.objectContaining({ kind: 'request', unitPrice: 0.175, cost: 0.175 }),
      expect.objectContaining({
        componentId: 'tool-call',
        kind: 'tool_call',
        role: 'charge',
        tierId: 'tier-tools',
        quantityPricingMode: 'graduated_tier',
        allowanceApplied: 1.75,
        overlayIds: ['overlay-tools'],
        unitPrice: 0.03,
        cost: 0.105,
      }),
      expect.objectContaining({
        componentId: 'promo-credit',
        kind: 'custom',
        role: 'discount',
        overlayIds: ['promo'],
        unitPrice: 0.5,
        cost: -0.5,
      }),
    ]));
    expect(estimate?.executionAttempts[0]).toMatchObject({
      resolution: {
        source: 'manual_binding',
        matchedScope: 'token_model',
        evaluation: {
          components: expect.arrayContaining([
            expect.objectContaining({
              componentId: 'tool-call',
              kind: 'tool_call',
              tierId: 'tier-tools',
              quantityPricingMode: 'graduated_tier',
              allowanceApplied: 1,
              overlayIds: ['overlay-tools'],
            }),
            expect.objectContaining({
              componentId: 'promo-credit',
              kind: 'custom',
              role: 'discount',
              overlayIds: ['promo'],
            }),
          ]),
        },
      },
      comparison: {
        inputMultiplier: null,
        outputMultiplier: null,
        totalMultiplier: null,
      },
      quoteDiagnostics: [],
    });
  });

  it('marks dynamic execution attempt probabilities as incomplete without fallback price estimates', async () => {
    mockEndpointQuotes();

    const dynamicRuntime = runtime({
      executionAttempts: runtime().executionAttempts.map((attempt) => ({
        ...attempt,
        probability: null,
        probabilityStatus: 'dynamic',
      })),
    });
    const { estimateCompiledRuntimeEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateCompiledRuntimeEntryPricing({
      runtime: dynamicRuntime,
    });

    expect(estimate).toMatchObject({
      inputPerMillion: null,
      outputPerMillion: null,
      totalCost: null,
      sourceCount: 2,
      selectionMode: 'weighted',
      estimateLevel: 'incomplete',
    });
    expect(estimate?.executionAttempts.map((attempt) => ({
      modelName: attempt.modelName,
      probability: attempt.probability,
    }))).toEqual([
      { modelName: 'upstream-a', probability: null },
      { modelName: 'upstream-b', probability: null },
    ]);
  });
});
