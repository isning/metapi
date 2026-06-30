import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileRouteGraphSource } from '../../shared/routeGraph.js';
import type { CompiledRouterBundle } from '../../shared/routeGraph.js';

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

function compileBundle(source: unknown): CompiledRouterBundle {
  const compiled = compileRouteGraphSource(source);
  expect(compiled.ok).toBe(true);
  expect(compiled.compiled.compiledRouterBundle).toBeTruthy();
  return compiled.compiled.compiledRouterBundle!;
}

function bundleWithWeightedTargets(): CompiledRouterBundle {
  return compileBundle({
    version: 1,
    nodes: [
      { id: 'entry.public', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'public-model' } },
      {
        id: 'endpoint.public',
        type: 'route_endpoint',
        enabled: true,
        visibility: 'internal',
        ownership: 'manual',
        config: {
          targets: [
            { targetId: '101', model: 'upstream-a', enabled: true, siteId: 1, accountId: 11, tokenId: 111, weight: 1 },
            { targetId: '102', model: 'upstream-b', enabled: true, siteId: 2, accountId: 22, tokenId: 222, weight: 3 },
          ],
          targetSelection: { strategy: 'weighted' },
        },
      },
    ],
    edges: [
      { id: 'entry-endpoint', sourceNodeId: 'entry.public', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint.public', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
    ],
  });
}

function bundleWithTargetPolicy(policy: Record<string, unknown>): CompiledRouterBundle {
  const bundle = bundleWithWeightedTargets();
  const plan = bundle.plans[0];
  const terminal = plan?.candidates[0]?.terminal;
  if (terminal?.kind === 'supply') terminal.targetSelectionPolicy = policy;
  if (plan?.targets[0]) plan.targets[0].metadata = { quality: 5, costRank: 1 };
  if (plan?.targets[1]) plan.targets[1].metadata = { quality: 10, costRank: 2 };
  return bundle;
}

function bundleWithDynamicDispatchPolicy(): CompiledRouterBundle {
  return compileBundle({
    version: 1,
    nodes: [
      { id: 'entry.public', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'public-model' } },
      {
        id: 'dispatcher.public',
        type: 'dispatcher',
        enabled: true,
        visibility: 'internal',
        ownership: 'manual',
        mode: 'route',
        policy: { strategy: 'weighted', score: 'payload.currentModel == "fast" ? candidate.weight : 1' },
      },
      {
        id: 'endpoint.a',
        type: 'route_endpoint',
        enabled: true,
        visibility: 'internal',
        ownership: 'manual',
        metadata: { weight: 1 },
        config: { targets: [{ targetId: '101', model: 'upstream-a', enabled: true, siteId: 1, accountId: 11, tokenId: 111, weight: 1 }] },
      },
      {
        id: 'endpoint.b',
        type: 'route_endpoint',
        enabled: true,
        visibility: 'internal',
        ownership: 'manual',
        metadata: { weight: 3 },
        config: { targets: [{ targetId: '102', model: 'upstream-b', enabled: true, siteId: 2, accountId: 22, tokenId: 222, weight: 1 }] },
      },
    ],
    edges: [
      { id: 'entry-dispatcher', sourceNodeId: 'entry.public', sourcePortId: 'bidirect.out', targetNodeId: 'dispatcher.public', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      { id: 'a-dispatcher', sourceNodeId: 'endpoint.a', sourcePortId: 'route.out', targetNodeId: 'dispatcher.public', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
      { id: 'b-dispatcher', sourceNodeId: 'endpoint.b', sourcePortId: 'route.out', targetNodeId: 'dispatcher.public', targetPortId: 'route.in', kind: 'route_flow', ownership: 'manual' },
    ],
  });
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

  it('calculates theoretical entry pricing from a compiled router bundle without legacy program bundles', async () => {
    mockEndpointQuotes();
    const compiled = compileRouteGraphSource({
      version: 1,
      nodes: [
        { id: 'entry.public', type: 'entry', enabled: true, visibility: 'public', ownership: 'manual', match: { requestedModelPattern: 'public-model' } },
        {
          id: 'endpoint.public',
          type: 'route_endpoint',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          config: {
            targets: [
              { targetId: '101', model: 'upstream-a', enabled: true, siteId: 1, accountId: 11, tokenId: 111, weight: 1 },
              { targetId: '102', model: 'upstream-b', enabled: true, siteId: 2, accountId: 22, tokenId: 222, weight: 3 },
            ],
            targetSelection: { strategy: 'weighted' },
          },
        },
      ],
      edges: [
        { id: 'entry-endpoint', sourceNodeId: 'entry.public', sourcePortId: 'bidirect.out', targetNodeId: 'endpoint.public', targetPortId: 'bidirect.in', kind: 'bidirect_flow', ownership: 'manual' },
      ],
    });
    expect(compiled.ok).toBe(true);

    const { estimateRouteEntryPricing } = await import('./routeEntryPricingService.js');
    const estimate = await estimateRouteEntryPricing({
      bundle: compiled.compiled.compiledRouterBundle!,
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
