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
});
