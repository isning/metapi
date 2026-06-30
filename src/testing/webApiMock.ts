import { vi } from 'vitest';

export function createWebApiMock(overrides: Record<string, unknown> = {}) {
  return {
    getRouteGraphActive: vi.fn(),
    getRouteGraphDraft: vi.fn().mockResolvedValue({
      draft: {
        workingGraph: { version: 1, nodes: [], edges: [], macros: [], metadata: {} },
        diagnostics: [],
      },
    }),
    validateRouteGraph: vi.fn().mockResolvedValue({ ok: true, diagnostics: [] }),
    saveRouteGraphDraft: vi.fn().mockResolvedValue({
      draft: {
        workingGraph: { version: 1, nodes: [], edges: [], macros: [], metadata: {} },
        diagnostics: [],
      },
    }),
    publishRouteGraphDraft: vi.fn().mockResolvedValue({ ok: true, version: null, diagnostics: [] }),
    rebaseRouteGraphDraft: vi.fn().mockResolvedValue({
      draft: {
        workingGraph: { version: 1, nodes: [], edges: [], macros: [], metadata: {} },
        diagnostics: [],
      },
    }),
    discardRouteGraphDraft: vi.fn().mockResolvedValue({}),
    compileRouteGraph: vi.fn().mockResolvedValue({ ok: true, diagnostics: [] }),
    getModelRouteFlow: vi.fn().mockResolvedValue({ flow: null }),
    getModelsMarketplace: vi.fn().mockResolvedValue({
      models: [],
      pageInfo: { page: 1, pageSize: 0, totalCount: 0, hasMore: false },
      facets: { brands: [], otherBrandCount: 0, sites: [] },
    }),
    getRouteSummaryPage: vi.fn().mockResolvedValue({
      items: [],
      pageInfo: { page: 1, pageSize: 0, totalCount: 0, hasMore: false },
    }),
    getRouteEndpointTargets: vi.fn().mockResolvedValue([]),
    getModelTokenCandidates: vi.fn().mockResolvedValue({ models: {} }),
    getRouteDecisionsBatch: vi.fn().mockResolvedValue({ decisions: {} }),
    getRouteWideDecisionsBatch: vi.fn().mockResolvedValue({ decisions: {} }),
    ...overrides,
  };
}
