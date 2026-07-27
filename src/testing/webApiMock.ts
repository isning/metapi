import { vi } from 'vitest';

export function createWebApiMock(overrides: Record<string, unknown> = {}) {
  return {
    getRouteGraphActive: vi.fn(),
    getRouteGraphDraft: vi.fn().mockResolvedValue({
      draft: {
        workingGraph: { nodes: [], edges: [], macros: [], metadata: {} },
        diagnostics: [],
      },
    }),
    validateRouteGraph: vi.fn().mockResolvedValue({ ok: true, diagnostics: [] }),
    saveRouteGraphDraft: vi.fn().mockResolvedValue({
      draft: {
        workingGraph: { nodes: [], edges: [], macros: [], metadata: {} },
        diagnostics: [],
      },
    }),
    publishRouteGraphDraft: vi.fn().mockResolvedValue({ ok: true, version: null, diagnostics: [] }),
    rebaseRouteGraphDraft: vi.fn().mockResolvedValue({
      draft: {
        workingGraph: { nodes: [], edges: [], macros: [], metadata: {} },
        diagnostics: [],
      },
    }),
    discardRouteGraphDraft: vi.fn().mockResolvedValue({}),
    getModelRouteFlow: vi.fn().mockResolvedValue({ flow: null }),
    getModelRuntimeObservability: vi.fn().mockResolvedValue({
      success: true,
      observability: {
        requestedModel: '',
        matched: false,
        entry: null,
        health: { status: 'unknown', successRate: null, latencyMs: null, sampleCount: 0 },
        capabilitySummary: {
          supportedEndpointTypes: [],
          inputModalities: [],
          outputModalities: [],
          capabilities: [],
          contextLength: null,
          maxOutputTokens: null,
          source: 'none',
          partial: false,
        },
        executionAttempts: [],
        endpoints: [],
        history: { range: '6h', buckets: [], granularity: 'minute', emptyReason: 'unmatched' },
        diagnostics: [],
      },
    }),
    getModelsMarketplace: vi.fn().mockResolvedValue({
      models: [],
      pageInfo: { page: 1, pageSize: 0, totalCount: 0, hasMore: false },
      facets: { brands: [], otherBrandCount: 0, sites: [] },
    }),
    getRouteGroupPage: vi.fn().mockResolvedValue({
      items: [],
      pageInfo: { page: 1, pageSize: 0, totalCount: 0, hasMore: false },
    }),
    getRouteGroupOverview: vi.fn().mockResolvedValue({
      brands: [],
      otherBrandCount: 0,
      sites: [],
      endpointTypes: [],
      groups: [],
      tabs: { public: 0, internal: 0, manual: 0 },
      enabled: { enabled: 0, disabled: 0 },
    }),
    getRouteGroupFallbackStages: vi.fn().mockResolvedValue({ stages: [] }),
    getModelTokenCandidates: vi.fn().mockResolvedValue({ models: {} }),
    ...overrides,
  };
}
