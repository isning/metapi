import { describe, expect, it } from 'vitest';
import { buildModelDetailsView, type ModelRow } from './modelDetailsView.js';
import type { ModelRouteFlowData } from '../../components/ModelRouteFlow.js';

function model(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    name: 'public-model',
    accountCount: 1,
    tokenCount: 1,
    avgLatency: null,
    successRate: null,
    description: null,
    tags: [],
    supportedEndpointTypes: [],
    pricingSources: [{
      siteId: 1,
      siteName: 'fallback',
      accountId: 1,
      username: null,
      ownerBy: null,
      enableGroups: ['default'],
      groupPricing: {
        default: {
          quotaType: 0,
          inputPerMillion: 1,
          outputPerMillion: 2,
        },
      },
    }],
    accounts: [],
    ...overrides,
  };
}

function routeFlowWithTheoreticalPricing(): ModelRouteFlowData {
  return {
    version: 1,
    requestedModel: 'public-model',
    actualModel: 'public-model',
    matched: true,
    summary: [],
    nodes: [],
    edges: [],
    diagnostics: [],
    compiledAt: '2026-06-20T00:00:00.000Z',
    entryPricing: {
      theoretical: {
        inputPerMillion: 8,
        outputPerMillion: 16,
        totalCostUsd: 12,
        inputMultiplier: 4,
        outputMultiplier: 8,
        totalMultiplier: 3,
        reference: {
          inputPerMillion: 2,
          outputPerMillion: 2,
          cacheReadPerMillion: null,
          cacheWritePerMillion: null,
          reasoningPerMillion: null,
          requestUsd: null,
          totalCostUsd: 4,
        },
        effectiveCost: null,
        sourceCount: 2,
        estimateLevel: 'exact',
        strategy: 'weighted',
        diagnostics: [],
        candidates: [],
      },
    },
  };
}

describe('modelDetailsView pricing', () => {
  it('derives measured preview total and total multiplier from measured input/output rates', () => {
    const details = buildModelDetailsView({
      model: model({
        measuredEntryPricing: {
          inputPerMillion: 0.7,
          outputPerMillion: 1.4,
          totalCostUsd: 2.1,
          inputMultiplier: 0.2,
          outputMultiplier: 0.4,
          totalMultiplier: 0.3,
          sampleCount: 1,
          lastMeasuredAt: '2026-06-23T00:00:00.000Z',
        },
      }),
      brandName: null,
      routeFlow: null,
      routeFlowLoading: false,
      routeFlowError: '',
      metadataHydrating: false,
    });

    expect(details.pricing.measured).toMatchObject({
      inputPerMillion: 0.7,
      outputPerMillion: 1.4,
      totalCostUsd: 2.1,
      inputMultiplier: 0.2,
      outputMultiplier: 0.4,
      totalMultiplier: 0.3,
      sampleCount: 1,
    });
  });

  it('uses route-flow probability weighted theoretical entry pricing before metadata fallback', () => {
    const details = buildModelDetailsView({
      model: model(),
      brandName: null,
      routeFlow: routeFlowWithTheoreticalPricing(),
      routeFlowLoading: false,
      routeFlowError: '',
      metadataHydrating: false,
    });

    expect(details.pricing.theoretical).toMatchObject({
      inputPerMillion: 8,
      outputPerMillion: 16,
      totalCostUsd: 12,
      strategy: 'weighted',
      estimateLevel: 'exact',
      sourceCount: 2,
    });
  });

  it('falls back to marketplace pricing when route-flow theoretical pricing is entirely unknown', () => {
    const flow = routeFlowWithTheoreticalPricing();
    flow.entryPricing!.theoretical = {
      ...flow.entryPricing!.theoretical!,
      inputPerMillion: null,
      outputPerMillion: null,
      totalCostUsd: null,
      inputMultiplier: null,
      outputMultiplier: null,
      totalMultiplier: null,
      sourceCount: 2,
      estimateLevel: 'incomplete',
    };

    const details = buildModelDetailsView({
      model: model(),
      brandName: null,
      routeFlow: flow,
      routeFlowLoading: false,
      routeFlowError: '',
      metadataHydrating: false,
    });

    expect(details.pricing.theoretical).toMatchObject({
      inputPerMillion: 1,
      outputPerMillion: 2,
      inputMultiplier: null,
      outputMultiplier: null,
      sourceCount: 1,
    });
  });
});
