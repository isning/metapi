import { describe, expect, it } from 'vitest';
import { buildRouteSummaryProjectionPage } from './routeSummaryProjectionService.js';

function routeSummaryRow(input: {
  id: number;
  model: string;
  visibility?: 'public' | 'internal';
  manual?: boolean;
}) {
  return {
    id: input.id,
    match: {
      kind: 'model',
      requestedModelPattern: input.manual ? '' : input.model,
      displayName: input.manual ? input.model : null,
    },
    backend: input.manual ? { kind: 'routes', routeIds: [999] } : { kind: 'supply' },
    presentation: {
      displayName: input.manual ? input.model : null,
      displayIcon: null,
    },
    visibility: input.visibility || 'public',
    enabled: true,
    targetCount: 1,
    enabledTargetCount: 1,
    siteNames: [],
  };
}

describe('routeSummaryProjectionService', () => {
  it('keeps route group tab facets stable while search filters the current page', () => {
    const page = buildRouteSummaryProjectionPage([
      routeSummaryRow({ id: 1, model: 'deepseek-v4-flash' }),
      routeSummaryRow({ id: 2, model: 'gpt-4o' }),
      routeSummaryRow({ id: 3, model: 'internal-router', visibility: 'internal' }),
      routeSummaryRow({ id: 4, model: 'manual-router', manual: true }),
    ], {
      page: '1',
      pageSize: '20',
      q: 'deepseek',
      tab: 'public',
    });

    expect(page.items.map((item: any) => item.id)).toEqual([1]);
    expect(page.pageInfo.totalCount).toBe(1);
    expect(page.facets.tabs).toEqual({
      public: 2,
      internal: 1,
      manual: 1,
    });
  });
});
