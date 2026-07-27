import { describe, expect, it } from 'vitest';
import { buildRouteSummaryProjectionPage } from './routeSummaryProjectionService.js';

function routeSummaryRow(input: {
  id: string;
  model: string;
  visibility?: 'public' | 'internal';
  manual?: boolean;
}) {
  return {
    id: input.id,
    kind: input.manual ? 'manual' : 'automatic',
    sourceMode: input.manual ? 'manual' : 'auto',
    model: { publicName: input.model, upstreamName: input.model, normalizedName: input.model.toLowerCase() },
    presentation: {
      displayName: input.manual ? input.model : null,
      displayIcon: null,
    },
    filters: null,
    dispatcherPolicy: null,
    visibility: input.visibility || 'public',
    enabled: true,
    sourceSelection: { kind: 'explicit' as const, sources: [] },
    candidateCount: 1,
    enabledCandidateCount: 1,
    siteNames: [],
  };
}

describe('routeSummaryProjectionService', () => {
  it('builds route group tab facets from the search-filtered read model', () => {
    const page = buildRouteSummaryProjectionPage([
      routeSummaryRow({ id: 'automatic:deepseek-v4-flash', model: 'deepseek-v4-flash' }),
      routeSummaryRow({ id: 'automatic:gpt-4o', model: 'gpt-4o' }),
      routeSummaryRow({ id: 'automatic:internal-router', model: 'internal-router', visibility: 'internal' }),
      routeSummaryRow({ id: 'manual:manual-router', model: 'manual-router', manual: true }),
    ], {
      page: '1',
      pageSize: '20',
      q: 'deepseek',
      tab: 'public',
    });

    expect(page.items.map((item: any) => item.id)).toEqual(['automatic:deepseek-v4-flash']);
    expect(page.pageInfo.totalCount).toBe(1);
    expect(page.summary).toEqual({ candidateCount: 1 });
    expect(page.facets.tabs).toEqual({
      public: 1,
      internal: 0,
      manual: 0,
    });
  });

  it('classifies graph-native endpoint-reference automatic groups by route group metadata', () => {
    const automaticEndpointReferenceGroup = routeSummaryRow({
      id: 'upstream:deepseek-ai/deepseek-v4-flash',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
    });
    const manualGroup = routeSummaryRow({
      id: 'manual:deepseek-v4-flash-rerouted',
      model: 'deepseek-v4-flash-rerouted',
      manual: true,
    });

    const publicPage = buildRouteSummaryProjectionPage([
      automaticEndpointReferenceGroup,
      manualGroup,
    ], {
      page: '1',
      pageSize: '20',
      tab: 'public',
    });
    const manualPage = buildRouteSummaryProjectionPage([
      automaticEndpointReferenceGroup,
      manualGroup,
    ], {
      page: '1',
      pageSize: '20',
      tab: 'manual',
    });

    expect(publicPage.items.map((item: any) => item.id)).toEqual(['upstream:deepseek-ai/deepseek-v4-flash']);
    expect(publicPage.facets.tabs).toEqual({
      public: 1,
      internal: 0,
      manual: 1,
    });
    expect(manualPage.items.map((item: any) => item.id)).toEqual(['manual:deepseek-v4-flash-rerouted']);
  });
});
