import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteProgramBundleV3 } from '../../shared/routeGraph.js';

const quoteEndpointPricingMock = vi.hoisted(() => vi.fn());
const quoteReferencePricingMock = vi.hoisted(() => vi.fn());

vi.mock('./pricingQuoteService.js', () => ({
  quoteEndpointPricing: quoteEndpointPricingMock,
  quoteReferencePricing: quoteReferencePricingMock,
}));

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
          totalCostUsd: isA ? 6 : 14,
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

function bundleWithWeightedTargets(): RouteProgramBundleV3 {
  return {
    version: 3,
    matcher: {
      exact: {
        'public-model': {
          programId: 'program:public-model',
          entryNodeId: 'entry:public-model',
          publicModelName: 'public-model',
          sourceRef: {},
        },
      },
      normalizedExact: {},
      patterns: [],
    },
    programs: [{
      id: 'program:public-model',
      entryNodeId: 'entry:public-model',
      publicModelName: 'public-model',
      enabled: true,
      startOpId: 'select:supply',
      sourceRef: {},
      ops: [{
        id: 'select:supply',
        op: 'select_supply',
        endpointId: 'endpoint:public-model',
        nodeId: 'route-endpoint:public-model',
        routeId: null,
        targetSelectionPolicy: { strategy: 'weighted' },
        targets: [
          {
            endpointId: 'endpoint:public-model',
            targetId: 'target:a',
            nodeId: 'route-endpoint:public-model',
            targetId: '101',
            model: 'upstream-a',
            enabled: true,
            siteId: 1,
            accountId: 11,
            tokenId: 111,
            weight: 1,
            priority: 0,
            sourceRef: {},
          },
          {
            endpointId: 'endpoint:public-model',
            targetId: 'target:b',
            nodeId: 'route-endpoint:public-model',
            targetId: '102',
            model: 'upstream-b',
            enabled: true,
            siteId: 2,
            accountId: 22,
            tokenId: 222,
            weight: 3,
            priority: 0,
            sourceRef: {},
          },
        ],
        sourceRef: {},
      }],
    }],
    endpointCatalog: {
      byId: {},
      publicEntries: {},
      supplyTargets: {},
    },
    debug: {
      sourceRefs: {},
    },
    diagnostics: [],
  };
}

function bundleWithTargetPolicy(policy: Record<string, unknown>): RouteProgramBundleV3 {
  const bundle = bundleWithWeightedTargets();
  const selectSupply = bundle.programs[0]?.ops[0];
  if (selectSupply?.op === 'select_supply') {
    selectSupply.targetSelectionPolicy = policy;
    selectSupply.targets[0]!.metadata = { quality: 5, costRank: 1 };
    selectSupply.targets[1]!.metadata = { quality: 10, costRank: 2 };
  }
  return bundle;
}

function bundleWithDynamicDispatchPolicy(): RouteProgramBundleV3 {
  return {
    version: 3,
    matcher: {
      exact: {
        'public-model': {
          programId: 'program:public-model',
          entryNodeId: 'entry:public-model',
          publicModelName: 'public-model',
          sourceRef: {},
        },
      },
      normalizedExact: {},
      patterns: [],
    },
    programs: [{
      id: 'program:public-model',
      entryNodeId: 'entry:public-model',
      publicModelName: 'public-model',
      enabled: true,
      startOpId: 'dispatch:route',
      sourceRef: {},
      ops: [
        {
          id: 'dispatch:route',
          op: 'dispatch',
          mode: 'route',
          nodeId: 'dispatcher:public-model',
          policy: { strategy: 'weighted', score: 'payload.currentModel == "fast" ? candidate.weight : 1' },
          candidates: [
            {
              id: 'route:a',
              kind: 'route',
              enabled: true,
              weight: 1,
              priority: 0,
              targetOpId: 'select:a',
              metadata: {},
              sourceRef: {},
            },
            {
              id: 'route:b',
              kind: 'route',
              enabled: true,
              weight: 3,
              priority: 0,
              targetOpId: 'select:b',
              metadata: {},
              sourceRef: {},
            },
          ],
          sourceRef: {},
        },
        {
          id: 'select:a',
          op: 'select_supply',
          endpointId: 'endpoint:a',
          nodeId: 'route-endpoint:a',
          routeId: null,
          targetSelectionPolicy: { strategy: 'weighted' },
          targets: [{
            endpointId: 'endpoint:a',
            targetId: 'target:a',
            nodeId: 'route-endpoint:a',
            targetId: '101',
            model: 'upstream-a',
            enabled: true,
            siteId: 1,
            accountId: 11,
            tokenId: 111,
            weight: 1,
            priority: 0,
            sourceRef: {},
          }],
          sourceRef: {},
        },
        {
          id: 'select:b',
          op: 'select_supply',
          endpointId: 'endpoint:b',
          nodeId: 'route-endpoint:b',
          routeId: null,
          targetSelectionPolicy: { strategy: 'weighted' },
          targets: [{
            endpointId: 'endpoint:b',
            targetId: 'target:b',
            nodeId: 'route-endpoint:b',
            targetId: '102',
            model: 'upstream-b',
            enabled: true,
            siteId: 2,
            accountId: 22,
            tokenId: 222,
            weight: 1,
            priority: 0,
            sourceRef: {},
          }],
          sourceRef: {},
        },
      ],
    }],
    endpointCatalog: {
      byId: {},
      publicEntries: {},
      supplyTargets: {},
    },
    debug: {
      sourceRefs: {},
    },
    diagnostics: [],
  };
}

describe('routeEntryPricingService', () => {
  beforeEach(() => {
    quoteEndpointPricingMock.mockReset();
    quoteReferencePricingMock.mockReset();
  });

  it('calculates theoretical entry pricing from route selection probabilities', async () => {
    mockEndpointQuotes();

    const { estimateRouteEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateRouteEntryPricing({
      bundle: bundleWithWeightedTargets(),
      requestedModel: 'public-model',
    });

    expect(estimate).toMatchObject({
      inputPerMillion: 8,
      outputPerMillion: 16,
      totalCostUsd: 12,
      inputMultiplier: null,
      outputMultiplier: null,
      totalMultiplier: null,
      reference: null,
      sourceCount: 2,
      strategy: 'weighted',
      estimateLevel: 'exact',
    });
    expect(estimate?.candidates.map((candidate) => ({
      modelName: candidate.modelName,
      probability: candidate.probability,
    }))).toEqual([
      { modelName: 'upstream-a', probability: 0.25 },
      { modelName: 'upstream-b', probability: 0.75 },
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
          requestUsd: null,
          totalCostUsd: 6,
        },
      },
    });

    const { estimateRouteEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateRouteEntryPricing({
      bundle: bundleWithWeightedTargets(),
      requestedModel: 'public-model',
    });

    expect(estimate).toMatchObject({
      inputPerMillion: 8,
      outputPerMillion: 16,
      totalCostUsd: 12,
      inputMultiplier: 2,
      outputMultiplier: 2,
      totalMultiplier: 2,
      reference: {
        inputPerMillion: 4,
        outputPerMillion: 8,
        totalCostUsd: 6,
      },
    });
  });

  it('recalculates theoretical entry pricing from runtime probability overrides', async () => {
    mockEndpointQuotes();

    const {
      applyRuntimeEntryPricingProbabilities,
      estimateRouteEntryPricing,
    } = await import('./routeEntryPricingService.js');
    const estimate = await estimateRouteEntryPricing({
      bundle: bundleWithWeightedTargets(),
      requestedModel: 'public-model',
    });
    const runtimeEstimate = applyRuntimeEntryPricingProbabilities({
      estimate,
      overrides: [
        { targetId: 101, probability: 0.9 },
        { targetId: 102, probability: 0.1 },
      ],
    });

    expect(runtimeEstimate).toMatchObject({
      inputPerMillion: 2.8,
      outputPerMillion: 5.6,
      totalCostUsd: 6.8,
      inputMultiplier: null,
      outputMultiplier: null,
      totalMultiplier: null,
      sourceCount: 2,
      estimateLevel: 'exact',
    });
    expect(runtimeEstimate?.candidates.map((candidate) => ({
      modelName: candidate.modelName,
      probability: candidate.probability,
    }))).toEqual([
      { modelName: 'upstream-a', probability: 0.9 },
      { modelName: 'upstream-b', probability: 0.1 },
    ]);
  });

  it('recalculates reference multipliers when runtime probabilities override static estimates', async () => {
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
          requestUsd: null,
          totalCostUsd: 4,
        },
      },
    });

    const {
      applyRuntimeEntryPricingProbabilities,
      estimateRouteEntryPricing,
    } = await import('./routeEntryPricingService.js');
    const estimate = await estimateRouteEntryPricing({
      bundle: bundleWithWeightedTargets(),
      requestedModel: 'public-model',
    });
    const runtimeEstimate = applyRuntimeEntryPricingProbabilities({
      estimate,
      overrides: [
        { targetId: 101, probability: 0.9 },
        { targetId: 102, probability: 0.1 },
      ],
    });

    expect(runtimeEstimate).toMatchObject({
      inputPerMillion: 2.8,
      outputPerMillion: 5.6,
      totalCostUsd: 6.8,
      inputMultiplier: 0.7,
      outputMultiplier: 0.7,
      totalMultiplier: 1.7,
    });
  });

  it('uses static metadata CEL score policies for probability estimates', async () => {
    mockEndpointQuotes();

    const { estimateRouteEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateRouteEntryPricing({
      bundle: bundleWithTargetPolicy({
        strategy: 'weighted',
        score: 'candidate.metadata.quality - candidate.metadata.costRank',
      }),
      requestedModel: 'public-model',
    });

    expect(estimate?.estimateLevel).toBe('exact');
    expect(estimate?.inputPerMillion).toBe(10);
    expect(estimate?.candidates.map((candidate) => ({
      modelName: candidate.modelName,
      probability: candidate.probability,
    }))).toEqual([
      { modelName: 'upstream-a', probability: 0 },
      { modelName: 'upstream-b', probability: 1 },
    ]);
  });

  it('marks request-dependent CEL probabilities as unavailable', async () => {
    mockEndpointQuotes();

    const { estimateRouteEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateRouteEntryPricing({
      bundle: bundleWithTargetPolicy({
        strategy: 'weighted',
        score: 'payload.currentModel == "fast" ? candidate.weight : 1',
      }),
      requestedModel: 'public-model',
    });

    expect(estimate?.estimateLevel).toBe('incomplete');
    expect(estimate?.inputPerMillion).toBe(8);
    expect(estimate?.outputPerMillion).toBe(16);
    expect(estimate?.candidates.map((candidate) => ({
      modelName: candidate.modelName,
      probability: candidate.probability,
    }))).toEqual([
      { modelName: 'upstream-a', probability: null },
      { modelName: 'upstream-b', probability: null },
    ]);
  });

  it('keeps reachable targets when dispatch probability depends on the request', async () => {
    mockEndpointQuotes();

    const { estimateRouteEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateRouteEntryPricing({
      bundle: bundleWithDynamicDispatchPolicy(),
      requestedModel: 'public-model',
    });

    expect(estimate?.estimateLevel).toBe('incomplete');
    expect(estimate?.inputPerMillion).toBe(6);
    expect(estimate?.outputPerMillion).toBe(12);
    expect(estimate?.candidates.map((candidate) => ({
      modelName: candidate.modelName,
      probability: candidate.probability,
    }))).toEqual([
      { modelName: 'upstream-a', probability: null },
      { modelName: 'upstream-b', probability: null },
    ]);
  });

  it('uses target weights as an incomplete estimate when router-deferred probabilities are unavailable', async () => {
    mockEndpointQuotes();

    const bundle = bundleWithTargetPolicy({ strategy: 'defer_to_router' });
    const { estimateRouteEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateRouteEntryPricing({
      bundle,
      requestedModel: 'public-model',
    });

    expect(estimate).toMatchObject({
      inputPerMillion: 8,
      outputPerMillion: 16,
      totalCostUsd: 12,
      sourceCount: 2,
      strategy: 'defer_to_router',
      estimateLevel: 'incomplete',
    });
    expect(estimate?.candidates.map((candidate) => ({
      modelName: candidate.modelName,
      probability: candidate.probability,
    }))).toEqual([
      { modelName: 'upstream-a', probability: 0.25 },
      { modelName: 'upstream-b', probability: 0.75 },
    ]);
  });
});
