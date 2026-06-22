import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteProgramBundleV3 } from '../../shared/routeGraph.js';

const evaluateUpstreamCostPricingMock = vi.hoisted(() => vi.fn());

vi.mock('./upstreamCostPricingService.js', () => ({
  evaluateUpstreamCostPricing: evaluateUpstreamCostPricingMock,
}));

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
        nodeId: 'model-endpoint:public-model',
        routeId: null,
        targetSelectionPolicy: { strategy: 'weighted' },
        targets: [
          {
            endpointId: 'endpoint:public-model',
            targetId: 'target:a',
            nodeId: 'model-endpoint:public-model',
            channelId: '101',
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
            nodeId: 'model-endpoint:public-model',
            channelId: '102',
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

describe('routeEntryPricingService', () => {
  beforeEach(() => {
    evaluateUpstreamCostPricingMock.mockReset();
  });

  it('calculates theoretical entry pricing from route selection probabilities', async () => {
    evaluateUpstreamCostPricingMock.mockImplementation(async ({ modelName }: { modelName: string }) => ({
      matchedScope: 'token_model',
      pricing: { id: modelName === 'upstream-a' ? 1 : 2 },
      evaluation: {
        totalCostUsd: modelName === 'upstream-a' ? 6 : 14,
        components: [
          {
            kind: 'input_tokens',
            unitPriceUsd: modelName === 'upstream-a' ? 2 : 10,
            costUsd: 0,
          },
          {
            kind: 'output_tokens',
            unitPriceUsd: modelName === 'upstream-a' ? 4 : 20,
            costUsd: 0,
          },
        ],
      },
    }));

    const { estimateRouteEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateRouteEntryPricing({
      bundle: bundleWithWeightedTargets(),
      requestedModel: 'public-model',
    });

    expect(estimate).toMatchObject({
      inputPerMillion: 8,
      outputPerMillion: 16,
      totalCostUsd: 12,
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
});
