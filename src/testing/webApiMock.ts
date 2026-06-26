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
    getModelsMarketplace: vi.fn().mockResolvedValue({ models: [] }),
    getRoutesSummary: vi.fn().mockResolvedValue([]),
    getRouteEndpointTargets: vi.fn().mockResolvedValue([]),
    getModelTokenCandidates: vi.fn().mockResolvedValue({ models: {} }),
    getRouteDecisionsBatch: vi.fn().mockResolvedValue({ decisions: {} }),
    getRouteWideDecisionsBatch: vi.fn().mockResolvedValue({ decisions: {} }),
    ...overrides,
  };
}
