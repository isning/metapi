import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import Models from './Models.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getModelsMarketplace: vi.fn(),
    getModelRouteFlow: vi.fn(),
    getModelRouteFlowDiagnostics: vi.fn(),
    getModelRuntimeObservability: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

vi.mock('../components/ModelRouteFlow.js', () => ({
  default: () => null,
}));

type WebTestRenderer = ReturnType<typeof create>;

function collectText(node: ReactTestInstance): string {
  const children = node.children || [];
  return children.map((child) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

function findButtonByText(root: ReactTestInstance, text: string): ReactTestInstance {
  const matches = root.findAll((node) => (
    node.type === 'button'
    && typeof node.props.onClick === 'function'
    && collectText(node).includes(text)
  ));
  if (matches.length === 0) {
    throw new Error(`No button found containing ${text}`);
  }
  return matches[0]!;
}

function findButtonsByText(root: ReactTestInstance, text: string): ReactTestInstance[] {
  return root.findAll((node) => (
    node.type === 'button'
    && typeof node.props.onClick === 'function'
    && collectText(node).includes(text)
  ));
}

function findButtonByAriaLabel(root: ReactTestInstance, label: string): ReactTestInstance {
  const button = root.findAll((node) => (
    node.type === 'button'
    && node.props['aria-label'] === label
    && typeof node.props.onClick === 'function'
  ))[0];
  if (!button) {
    throw new Error(`No button found with aria-label ${label}`);
  }
  return button;
}

function findTabTriggerByValue(root: ReactTestInstance, value: string): ReactTestInstance {
  const trigger = root.findAll((node) => (
    node.props.value === value
    && typeof node.props.onPointerEnter === 'function'
    && typeof node.props.onMouseEnter === 'function'
    && typeof node.props.onFocus === 'function'
  ))[0];
  if (!trigger) {
    throw new Error(`No tab trigger found for ${value}`);
  }
  return trigger;
}

function findTabsRootByValue(root: ReactTestInstance, value: string): ReactTestInstance {
  const tabsRoot = root.findAll((node) => (
    node.props.value === value
    && typeof node.props.onValueChange === 'function'
  ))[0];
  if (!tabsRoot) {
    throw new Error(`No tabs root found for ${value}`);
  }
  return tabsRoot;
}

function createMarketplaceModel(name: string, site = 'Demo Site') {
  return {
    name,
    accountCount: 1,
    tokenCount: 1,
    avgLatency: 320,
    successRate: 98,
    description: null,
    tags: [],
    supportedEndpointTypes: [],
    pricingSources: [],
    measuredEntryPricing: null,
    accounts: [
      {
        id: 1,
        site,
        username: 'tester',
        latency: 320,
        balance: 12.5,
        tokens: [{ id: 1, name: 'default', isDefault: true }],
      },
    ],
  };
}

function createRuntimeObservability(range: '5m' | '15m' | '1h' | '6h' | '24h' | '7d' | '30d', successRate: number | null, avgLatencyMs: number | null) {
  return {
    requestedModel: 'gpt-4o',
    matched: true,
    entry: null,
    health: {
      status: successRate == null ? 'unknown' : successRate >= 90 ? 'healthy' : 'degraded',
      successRate,
      totalCalls: successRate == null ? 0 : 10,
      successCalls: successRate == null ? 0 : Math.round(successRate / 10),
      failedCalls: successRate == null ? 0 : 10 - Math.round(successRate / 10),
      avgLatencyMs,
      latencySamples: avgLatencyMs == null ? 0 : 10,
      source: successRate == null ? 'none' : 'entry_projection',
      window: {
        range,
        windowDays: 1,
        fromLocalDay: '2026-07-07',
        toLocalDay: '2026-07-07',
      },
    },
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
    history: {
      range,
      buckets: [],
      granularity: range === '24h' || range === '7d' || range === '30d' ? 'day' : 'minute',
      emptyReason: successRate == null ? 'no_logs' : null,
    },
    diagnostics: [],
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advancePrefetchIntent() {
  await act(async () => {
    vi.advanceTimersByTime(100);
    await Promise.resolve();
  });
  await flushMicrotasks();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function LocationProbe({ onChange }: { onChange: (value: string) => void }) {
  const location = useLocation();
  onChange(`${location.pathname}${location.search}`);
  return null;
}

describe('Models marketplace text', () => {
  const originalDocument = globalThis.document;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalWindow = globalThis.window;
  const originalMatchMedia = globalThis.matchMedia;

  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getModelRouteFlow.mockResolvedValue({ flow: null });
    apiMock.getModelRouteFlowDiagnostics.mockResolvedValue({
      success: true,
      diagnostics: {
        requestedModel: 'gpt-4o',
        actualModel: 'gpt-4o',
        matched: true,
        entryId: 'entry:route-fixture:gpt-4o',
        selectedEndpointId: null,
        selectedAccountId: null,
        diagnostics: [{ level: 'info', message: 'compiled route ready' }],
        projectedAt: '2026-07-07T00:00:00.000Z',
      },
    });
    apiMock.getModelRuntimeObservability.mockResolvedValue({
      success: true,
      observability: {
        requestedModel: 'gpt-4o',
        matched: false,
        entry: null,
        health: {
          status: 'unknown',
          successRate: null,
          totalCalls: 0,
          successCalls: 0,
          failedCalls: 0,
          avgLatencyMs: null,
          latencySamples: 0,
          source: 'none',
          window: {
            range: '24h',
            windowDays: 1,
            fromLocalDay: '2026-07-06',
            toLocalDay: '2026-07-06',
          },
        },
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
        history: {
          range: '24h',
          buckets: [],
          granularity: 'day',
          emptyReason: 'unmatched',
        },
        diagnostics: [],
      },
    });
    globalThis.document = {
      documentElement: {
        getAttribute: () => 'light',
      },
    } as unknown as Document;
    globalThis.MutationObserver = class {
      observe() {}
      disconnect() {}
    } as unknown as typeof MutationObserver;
    apiMock.getModelsMarketplace.mockResolvedValue({
      models: [
        {
          name: 'gpt-4o',
          accountCount: 1,
          tokenCount: 1,
          avgLatency: 320,
          successRate: 98,
          description: null,
          tags: [],
          supportedEndpointTypes: [],
          pricingSources: [
            {
              siteId: 1,
              siteName: 'Demo Site',
              accountId: 1,
              username: 'tester',
              ownerBy: null,
              enableGroups: [],
              groupPricing: {
                default: {
                  quotaType: 0,
                  inputPerMillion: 4,
                  outputPerMillion: 12,
                },
              },
            },
          ],
          measuredEntryPricing: {
            inputPerMillion: 5,
            outputPerMillion: 15,
            sampleCount: 2,
            lastMeasuredAt: '2026-06-20T00:00:00Z',
          },
          accounts: [
            {
              id: 1,
              site: 'Demo Site',
              username: 'tester',
              latency: 320,
              balance: 12.5,
              tokens: [{ id: 1, name: 'default', isDefault: true }],
            },
          ],
        },
      ],
      pageInfo: { page: 1, pageSize: 20, totalCount: 1, hasMore: false },
      facets: {
        brands: [{ name: 'OpenAI', icon: 'openai', count: 1 }],
        otherBrandCount: 0,
        sites: [{ name: 'Demo Site', count: 1 }],
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    globalThis.document = originalDocument;
    globalThis.MutationObserver = originalMutationObserver;
    globalThis.window = originalWindow;
    globalThis.matchMedia = originalMatchMedia;
  });

  it('renders readable Chinese labels and fallback descriptions for marketplace models', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const initialText = collectText(root!.root);
      expect(initialText).toContain('品牌');
      expect(initialText).toContain('排序方式');
      expect(initialText).toContain('模型广场');

      const cards = findButtonsByText(root!.root, 'gpt-4o');
      expect(cards.length).toBeGreaterThan(0);

      await act(async () => {
        cards[0]!.props.onClick();
      });
      await flushMicrotasks();

      const expandedText = collectText(root!.root);
      expect(expandedText).toContain('当前上游仅返回模型 ID，未返回描述字段。');
      expect(expandedText).toContain('基础信息');
      expect(expandedText).toContain('站点');
      expect(expandedText).toContain('余额');
      expect(expandedText).toContain('实测 entry 价格');
      expect(expandedText).toContain('5 / 1M');
      expect(expandedText).toContain('输入参考倍率 未配置参考价');
      expect(expandedText).toContain('理论入口价格');
      expect(expandedText).toContain('暂无可用的理论 entry 价格');
      expect(expandedText).toContain('暂无价格明细');
      expect(expandedText).not.toContain('$4 / 1M');
      expect(expandedText).not.toContain('$12 / 1M');
    } finally {
      root?.unmount();
    }
  });

  it('keeps a deep-linked selected model while the marketplace list is loading', async () => {
    const marketplace = deferred<{
      models: ReturnType<typeof createMarketplaceModel>[];
      pageInfo: { page: number; pageSize: number; totalCount: number; hasMore: boolean };
      facets: { brands: { name: string; icon: string; count: number }[]; otherBrandCount: number; sites: { name: string; count: number }[] };
    }>();
    apiMock.getModelsMarketplace.mockReturnValueOnce(marketplace.promise);
    apiMock.getModelRouteFlow.mockResolvedValue({ flow: { requestedModel: 'gpt-4o', matched: true, diagnostics: [] } });
    let currentLocation = '';
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models?model=gpt-4o&tab=routing']}>
            <LocationProbe onChange={(value) => { currentLocation = value; }} />
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });

      expect(currentLocation).toBe('/models?model=gpt-4o&tab=routing');

      await act(async () => {
        marketplace.resolve({
          models: [createMarketplaceModel('gpt-4o')],
          pageInfo: { page: 1, pageSize: 20, totalCount: 1, hasMore: false },
          facets: {
            brands: [{ name: 'OpenAI', icon: 'openai', count: 1 }],
            otherBrandCount: 0,
            sites: [{ name: 'Demo Site', count: 1 }],
          },
        });
        await marketplace.promise;
      });
      await flushMicrotasks();

      expect(currentLocation).toBe('/models?model=gpt-4o&tab=routing');
      expect(apiMock.getModelRouteFlow).toHaveBeenCalledWith('gpt-4o');
      expect(collectText(root!.root)).toContain('gpt-4o');
      expect(collectText(root!.root)).not.toContain('Select a model');
    } finally {
      root?.unmount();
    }
  });

  it.each(['routing', 'api', 'diagnostics'] as const)('lazy-loads only route flow for the %s tab', async (tab) => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={[`/models?model=gpt-4o&tab=${tab}`]}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(apiMock.getModelRouteFlow).toHaveBeenCalledWith('gpt-4o');
      expect(apiMock.getModelRuntimeObservability).not.toHaveBeenCalled();
    } finally {
      root?.unmount();
    }
  });

  it('lazy-loads route flow and summary observability for the overview tab', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models?model=gpt-4o&tab=overview']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(apiMock.getModelRouteFlow).toHaveBeenCalledWith('gpt-4o');
      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledWith('gpt-4o', { range: '6h' });
    } finally {
      root?.unmount();
    }
  });

  it('prefetches performance observability on tab hover without switching tabs', async () => {
    let currentLocation = '';
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models?model=gpt-4o&tab=routing']}>
            <LocationProbe onChange={(value) => { currentLocation = value; }} />
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();
      expect(apiMock.getModelRouteFlow).toHaveBeenCalledWith('gpt-4o');
      expect(apiMock.getModelRuntimeObservability).not.toHaveBeenCalled();
      apiMock.getModelRouteFlow.mockClear();
      vi.useFakeTimers();

      const performanceTab = findTabTriggerByValue(root!.root, 'performance');
      await act(async () => {
        performanceTab.props.onPointerEnter();
      });
      await flushMicrotasks();
      expect(apiMock.getModelRuntimeObservability).not.toHaveBeenCalled();
      await advancePrefetchIntent();

      expect(currentLocation).toBe('/models?model=gpt-4o&tab=routing');
      expect(apiMock.getModelRouteFlow).not.toHaveBeenCalled();
      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledTimes(1);
      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledWith('gpt-4o', { range: '6h' });

      await act(async () => {
        performanceTab.props.onFocus();
      });
      await advancePrefetchIntent();

      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledTimes(1);

      const tabsRoot = findTabsRootByValue(root!.root, 'routing');
      await act(async () => {
        tabsRoot.props.onValueChange('performance');
      });
      await flushMicrotasks();

      expect(currentLocation).toBe('/models?model=gpt-4o&tab=performance');
      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledTimes(1);
    } finally {
      root?.unmount();
    }
  });

  it('prefetches route flow on route-backed tab focus without duplicating requests', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models?model=gpt-4o&tab=performance']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();
      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledWith('gpt-4o', { range: '6h' });
      expect(apiMock.getModelRouteFlow).not.toHaveBeenCalled();
      apiMock.getModelRuntimeObservability.mockClear();
      vi.useFakeTimers();

      const apiTab = findTabTriggerByValue(root!.root, 'api');
      await act(async () => {
        apiTab.props.onFocus();
      });
      await flushMicrotasks();
      expect(apiMock.getModelRouteFlow).not.toHaveBeenCalled();
      await advancePrefetchIntent();

      expect(apiMock.getModelRuntimeObservability).not.toHaveBeenCalled();
      expect(apiMock.getModelRouteFlow).toHaveBeenCalledTimes(1);
      expect(apiMock.getModelRouteFlow).toHaveBeenCalledWith('gpt-4o');

      await act(async () => {
        apiTab.props.onMouseEnter();
      });
      await advancePrefetchIntent();

      expect(apiMock.getModelRouteFlow).toHaveBeenCalledTimes(1);
    } finally {
      root?.unmount();
    }
  });

  it('prefetches diagnostics entries without prefetching diagnostics JSON', async () => {
    let currentLocation = '';
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models?model=gpt-4o&tab=performance']}>
            <LocationProbe onChange={(value) => { currentLocation = value; }} />
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();
      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledWith('gpt-4o', { range: '6h' });
      expect(apiMock.getModelRouteFlow).not.toHaveBeenCalled();
      apiMock.getModelRuntimeObservability.mockClear();
      vi.useFakeTimers();

      const diagnosticsTab = findTabTriggerByValue(root!.root, 'diagnostics');
      await act(async () => {
        diagnosticsTab.props.onPointerEnter();
      });
      await flushMicrotasks();
      expect(apiMock.getModelRouteFlow).not.toHaveBeenCalled();
      expect(apiMock.getModelRouteFlowDiagnostics).not.toHaveBeenCalled();
      await advancePrefetchIntent();

      expect(currentLocation).toBe('/models?model=gpt-4o&tab=performance');
      expect(apiMock.getModelRouteFlow).not.toHaveBeenCalled();
      expect(apiMock.getModelRouteFlowDiagnostics).toHaveBeenCalledTimes(1);
      expect(apiMock.getModelRouteFlowDiagnostics).toHaveBeenCalledWith('gpt-4o');
      expect(apiMock.getModelRuntimeObservability).not.toHaveBeenCalled();
      expect(collectText(root!.root)).not.toContain('compiled route ready');

      const tabsRoot = findTabsRootByValue(root!.root, 'performance');
      await act(async () => {
        tabsRoot.props.onValueChange('diagnostics');
      });
      await flushMicrotasks();

      expect(currentLocation).toBe('/models?model=gpt-4o&tab=diagnostics');
      expect(collectText(root!.root)).toContain('compiled route ready');
      expect(apiMock.getModelRouteFlow).toHaveBeenCalledTimes(1);
      expect(apiMock.getModelRouteFlow).toHaveBeenCalledWith('gpt-4o');
      expect(apiMock.getModelRouteFlowDiagnostics).toHaveBeenCalledTimes(1);
    } finally {
      root?.unmount();
    }
  });

  it('prefetches the current tab data before switching models', async () => {
    apiMock.getModelsMarketplace.mockResolvedValue({
      models: [
        createMarketplaceModel('gpt-4o'),
        createMarketplaceModel('gpt-4o-mini'),
      ],
      pageInfo: { page: 1, pageSize: 20, totalCount: 2, hasMore: false },
      facets: {
        brands: [{ name: 'OpenAI', icon: 'openai', count: 2 }],
        otherBrandCount: 0,
        sites: [{ name: 'Demo Site', count: 2 }],
      },
    });
    let currentLocation = '';
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models?model=gpt-4o&tab=performance']}>
            <LocationProbe onChange={(value) => { currentLocation = value; }} />
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();
      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledWith('gpt-4o', { range: '6h' });
      expect(apiMock.getModelRouteFlow).not.toHaveBeenCalled();
      apiMock.getModelRuntimeObservability.mockClear();
      vi.useFakeTimers();

      const nextModelButton = findButtonByText(root!.root, 'gpt-4o-mini');
      await act(async () => {
        nextModelButton.props.onPointerEnter();
      });
      await flushMicrotasks();
      expect(apiMock.getModelRuntimeObservability).not.toHaveBeenCalled();

      await act(async () => {
        nextModelButton.props.onPointerLeave();
      });
      await advancePrefetchIntent();
      expect(apiMock.getModelRuntimeObservability).not.toHaveBeenCalled();

      await act(async () => {
        nextModelButton.props.onPointerEnter();
      });
      await advancePrefetchIntent();

      expect(currentLocation).toBe('/models?model=gpt-4o&tab=performance');
      expect(apiMock.getModelRouteFlow).not.toHaveBeenCalled();
      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledTimes(1);
      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledWith('gpt-4o-mini', { range: '6h' });

      await act(async () => {
        nextModelButton.props.onClick();
      });
      await flushMicrotasks();

      expect(currentLocation).toBe('/models?model=gpt-4o-mini&tab=performance');
      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledTimes(1);
    } finally {
      root?.unmount();
    }
  });

  it('settles route-flow loading after StrictMode remounts effects', async () => {
    apiMock.getModelsMarketplace.mockResolvedValue({
      models: [createMarketplaceModel('gpt-4o')],
      pageInfo: { page: 1, pageSize: 20, totalCount: 1, hasMore: false },
      facets: {
        brands: [{ name: 'OpenAI', icon: 'openai', count: 1 }],
        otherBrandCount: 0,
        sites: [{ name: 'Demo Site', count: 1 }],
      },
    });
    const routeFlow = deferred<{ flow: { requestedModel: string; matched: boolean; diagnostics: unknown[] } }>();
    apiMock.getModelRouteFlow.mockReturnValue(routeFlow.promise);
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <StrictMode>
            <MemoryRouter initialEntries={['/models?model=gpt-4o&tab=overview']}>
              <ToastProvider>
                <Models />
              </ToastProvider>
            </MemoryRouter>
          </StrictMode>,
        );
      });
      await flushMicrotasks();
      expect(collectText(root!.root)).toContain('路由摘要');
      expect(collectText(root!.root)).not.toContain('加载中');
      expect(collectText(root!.root)).not.toContain('暂无路由流程');

      await act(async () => {
        routeFlow.resolve({ flow: { requestedModel: 'gpt-4o', matched: true, diagnostics: [] } });
        await routeFlow.promise;
      });
      await flushMicrotasks();

      expect(collectText(root!.root)).not.toContain('加载中');
    } finally {
      root?.unmount();
    }
  });

  it('refreshes runtime observability while the performance tab is visible', async () => {
    vi.useFakeTimers();
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models?tab=performance']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();
      await act(async () => {
        findButtonByText(root!.root, 'gpt-4o').props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledWith('gpt-4o', { range: '6h' });
      expect(apiMock.getModelRouteFlow).not.toHaveBeenCalled();
      const initialCalls = apiMock.getModelRuntimeObservability.mock.calls.length;

      await act(async () => {
        vi.advanceTimersByTime(15_000);
        await Promise.resolve();
      });
      await flushMicrotasks();

      expect(apiMock.getModelRuntimeObservability.mock.calls.length).toBeGreaterThan(initialCalls);
      expect(apiMock.getModelRuntimeObservability).toHaveBeenLastCalledWith('gpt-4o', { range: '6h' });
    } finally {
      root?.unmount();
    }
  });

  it('keeps detail header metrics on the stable summary window when performance range changes', async () => {
    apiMock.getModelsMarketplace.mockResolvedValue({
      models: [{
        ...createMarketplaceModel('gpt-4o'),
        successRate: 12,
        avgLatency: 9000,
      }],
      pageInfo: { page: 1, pageSize: 20, totalCount: 1, hasMore: false },
      facets: {
        brands: [{ name: 'OpenAI', icon: 'openai', count: 1 }],
        otherBrandCount: 0,
        sites: [{ name: 'Demo Site', count: 1 }],
      },
    });
    apiMock.getModelRuntimeObservability.mockImplementation((_modelName: string, options: { range: '5m' | '15m' | '1h' | '6h' | '24h' | '7d' | '30d' }) => Promise.resolve({
      success: true,
      observability: options.range === '5m'
        ? createRuntimeObservability('5m', null, null)
        : createRuntimeObservability('6h', 97, 640),
    }));
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models?model=gpt-4o&tab=performance']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledWith('gpt-4o', { range: '6h' });
      expect(collectText(root!.root)).toContain('成功率 97%');
      expect(collectText(root!.root)).toContain('延迟 640ms');

      await act(async () => {
        findButtonByText(root!.root, '5m').props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledWith('gpt-4o', { range: '5m' });
      const text = collectText(root!.root);
      expect(text).toContain('成功率 97%');
      expect(text).toContain('延迟 640ms');
      expect(text).toContain('成功率不可用');
    } finally {
      root?.unmount();
    }
  });

  it('does not start another runtime observability refresh while the current one is pending', async () => {
    vi.useFakeTimers();
    const pending = deferred<Awaited<ReturnType<typeof apiMock.getModelRuntimeObservability>>>();
    const fallback = {
      success: true,
      observability: {
        requestedModel: 'gpt-4o',
        matched: false,
        entry: null,
        health: {
          status: 'unknown',
          successRate: null,
          totalCalls: 0,
          successCalls: 0,
          failedCalls: 0,
          avgLatencyMs: null,
          latencySamples: 0,
          source: 'none',
          window: {
            range: '6h',
            windowDays: 1,
            fromLocalDay: '2026-07-06',
            toLocalDay: '2026-07-06',
          },
        },
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
        history: {
          range: '6h',
          buckets: [],
          granularity: 'minute',
          emptyReason: 'unmatched',
        },
        diagnostics: [],
      },
    };
    apiMock.getModelRuntimeObservability.mockReturnValueOnce(pending.promise);
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models?tab=performance']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();
      await act(async () => {
        findButtonByText(root!.root, 'gpt-4o').props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(15_000);
        await Promise.resolve();
      });
      await flushMicrotasks();

      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledTimes(1);

      await act(async () => {
        pending.resolve(fallback);
        await Promise.resolve();
      });
      await flushMicrotasks();
    } finally {
      root?.unmount();
    }
  });

  it('refreshes route flow and runtime observability from the model details refresh button', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();
      await act(async () => {
        findButtonByText(root!.root, 'gpt-4o').props.onClick();
      });
      await flushMicrotasks();
      apiMock.getModelRouteFlow.mockClear();
      apiMock.getModelRuntimeObservability.mockClear();

      await act(async () => {
        findButtonByAriaLabel(root!.root, '刷新模型').props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.getModelRouteFlow).toHaveBeenCalledWith('gpt-4o');
      expect(apiMock.getModelRuntimeObservability).toHaveBeenCalledWith('gpt-4o', { range: '6h' });
    } finally {
      root?.unmount();
    }
  });

  it('renders server marketplace totals and fetches the next marketplace page', async () => {
    apiMock.getModelsMarketplace.mockImplementation((options: { page: number; pageSize: number }) => Promise.resolve({
      models: [
        createMarketplaceModel(options.page === 2 ? 'gpt-page-2' : 'gpt-page-1'),
      ],
      pageInfo: {
        page: options.page,
        pageSize: options.pageSize,
        totalCount: 50_000,
        hasMore: true,
      },
      facets: {
        brands: [{ name: 'OpenAI', icon: 'openai', count: 50_000 }],
        otherBrandCount: 0,
        sites: [{ name: 'Demo Site', count: 50_000 }],
      },
    }));

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(collectText(root!.root)).toContain('共 50000 个模型');
      expect(collectText(root!.root)).toContain('gpt-page-1');

      await act(async () => {
        findButtonByAriaLabel(root!.root, '下一页').props.onClick();
      });

      await vi.waitFor(async () => {
        await flushMicrotasks();
        expect(apiMock.getModelsMarketplace).toHaveBeenCalledWith(expect.objectContaining({
          page: 2,
          pageSize: 20,
          sortBy: 'accountCount',
          sortDir: 'desc',
        }));
        expect(collectText(root!.root)).toContain('gpt-page-2');
      });
    } finally {
      root?.unmount();
    }
  });

  it('keeps the settled marketplace list visible while the next query is pending', async () => {
    const nextPage = deferred<{
      models: ReturnType<typeof createMarketplaceModel>[];
      pageInfo: { page: number; pageSize: number; totalCount: number; hasMore: boolean };
      facets: { brands: { name: string; icon: string; count: number }[]; otherBrandCount: number; sites: { name: string; count: number }[] };
    }>();
    apiMock.getModelsMarketplace
      .mockResolvedValueOnce({
        models: [createMarketplaceModel('gpt-page-1')],
        pageInfo: { page: 1, pageSize: 20, totalCount: 50_000, hasMore: true },
        facets: {
          brands: [{ name: 'OpenAI', icon: 'openai', count: 50_000 }],
          otherBrandCount: 0,
          sites: [{ name: 'Demo Site', count: 50_000 }],
        },
      })
      .mockReturnValueOnce(nextPage.promise);

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(collectText(root!.root)).toContain('gpt-page-1');

      await act(async () => {
        findButtonByAriaLabel(root!.root, '下一页').props.onClick();
      });
      await vi.waitFor(() => {
        expect(apiMock.getModelsMarketplace).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
      });

      const pendingText = collectText(root!.root);
      expect(pendingText).toContain('gpt-page-1');
      expect(pendingText).not.toContain('gpt-page-2');

      await act(async () => {
        nextPage.resolve({
          models: [createMarketplaceModel('gpt-page-2')],
          pageInfo: { page: 2, pageSize: 20, totalCount: 50_000, hasMore: true },
          facets: {
            brands: [{ name: 'OpenAI', icon: 'openai', count: 50_000 }],
            otherBrandCount: 0,
            sites: [{ name: 'Demo Site', count: 50_000 }],
          },
        });
        await nextPage.promise;
      });
      await flushMicrotasks();

      expect(collectText(root!.root)).toContain('gpt-page-2');
    } finally {
      root?.unmount();
    }
  });

  it('sends marketplace search terms to the server and renders the returned result', async () => {
    apiMock.getModelsMarketplace.mockImplementation((options: { q?: string }) => Promise.resolve({
      models: [
        createMarketplaceModel(options.q ? 'tail-marketplace-model' : 'gpt-page-1'),
      ],
      pageInfo: {
        page: 1,
        pageSize: 20,
        totalCount: options.q ? 1 : 50_000,
        hasMore: !options.q,
      },
      facets: {
        brands: [{ name: 'OpenAI', icon: 'openai', count: options.q ? 1 : 50_000 }],
        otherBrandCount: 0,
        sites: [{ name: 'Demo Site', count: options.q ? 1 : 50_000 }],
      },
    }));

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const searchInput = root!.root.find((node) => (
        node.type === 'input'
        && node.props.type === 'search'
      ));
      await act(async () => {
        searchInput.props.onChange({ target: { value: 'tail-marketplace-model' } });
      });

      await vi.waitFor(async () => {
        await flushMicrotasks();
        expect(apiMock.getModelsMarketplace).toHaveBeenCalledWith(expect.objectContaining({
          page: 1,
          pageSize: 20,
          q: 'tail-marketplace-model',
        }));
        const text = collectText(root!.root);
        expect(text).toContain('共 1 个模型');
        expect(text).toContain('tail-marketplace-model');
      });
    } finally {
      root?.unmount();
    }
  });

  it('debounces marketplace search and only requests the final typed value', async () => {
    vi.useFakeTimers();
    apiMock.getModelsMarketplace.mockImplementation((options: { q?: string }) => Promise.resolve({
      models: [
        createMarketplaceModel(options.q ? `${options.q}-result` : 'gpt-page-1'),
      ],
      pageInfo: {
        page: 1,
        pageSize: 20,
        totalCount: options.q ? 1 : 50_000,
        hasMore: !options.q,
      },
      facets: {
        brands: [{ name: 'OpenAI', icon: 'openai', count: options.q ? 1 : 50_000 }],
        otherBrandCount: 0,
        sites: [{ name: 'Demo Site', count: options.q ? 1 : 50_000 }],
      },
    }));

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();
      apiMock.getModelsMarketplace.mockClear();

      const findSearchInput = () => root!.root.find((node) => (
        node.type === 'input'
        && node.props.type === 'search'
      ));

      await act(async () => {
        findSearchInput().props.onChange({ target: { value: 'deep' } });
      });
      await act(async () => {
        vi.advanceTimersByTime(120);
      });
      await act(async () => {
        findSearchInput().props.onChange({ target: { value: 'deepseek' } });
      });
      await act(async () => {
        vi.advanceTimersByTime(120);
      });
      await act(async () => {
        findSearchInput().props.onChange({ target: { value: 'deepseek-v4' } });
      });
      await act(async () => {
        vi.advanceTimersByTime(299);
        await Promise.resolve();
      });
      await flushMicrotasks();

      expect(apiMock.getModelsMarketplace).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });
      await flushMicrotasks();

      expect(apiMock.getModelsMarketplace).toHaveBeenCalledTimes(1);
      expect(apiMock.getModelsMarketplace).toHaveBeenCalledWith(expect.objectContaining({
        page: 1,
        pageSize: 20,
        q: 'deepseek-v4',
        includePricing: false,
      }));
      expect(collectText(root!.root)).toContain('deepseek-v4-result');
    } finally {
      root?.unmount();
    }
  });

  it('shows newly recognized brands in the marketplace filter panel', async () => {
    apiMock.getModelsMarketplace.mockResolvedValue({
      models: [
        {
          name: 'nvidia/vila',
          accountCount: 1,
          tokenCount: 1,
          avgLatency: 210,
          successRate: 97,
          description: null,
          tags: [],
          supportedEndpointTypes: [],
          pricingSources: [],
          accounts: [
            {
              id: 1,
              site: '公益站 A',
              username: 'tester',
              latency: 210,
              balance: 6.5,
              tokens: [{ id: 1, name: 'default', isDefault: true }],
            },
          ],
        },
        {
          name: 'deepl-zh-en',
          accountCount: 1,
          tokenCount: 1,
          avgLatency: 160,
          successRate: 99,
          description: null,
          tags: [],
          supportedEndpointTypes: [],
          pricingSources: [],
          accounts: [
            {
              id: 2,
              site: '公益站 B',
              username: 'tester',
              latency: 160,
              balance: 8.8,
              tokens: [{ id: 2, name: 'default', isDefault: true }],
            },
          ],
        },
      ],
    });

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const text = collectText(root!.root);
      expect(text).toContain('NVIDIA');
      expect(text).toContain('DeepL');
      expect(text).not.toContain('其他未归类的模型');
    } finally {
      root?.unmount();
    }
  });

  it('shows newly added provider fallback brands without losing vendor brands in the filter panel', async () => {
    apiMock.getModelsMarketplace.mockResolvedValue({
      models: [
        {
          name: 'openrouter/openrouter-auto',
          accountCount: 1,
          tokenCount: 1,
          avgLatency: 180,
          successRate: 99,
          description: null,
          tags: [],
          supportedEndpointTypes: [],
          pricingSources: [],
          accounts: [
            {
              id: 1,
              site: '平台站 A',
              username: 'tester',
              latency: 180,
              balance: 9.9,
              tokens: [{ id: 1, name: 'default', isDefault: true }],
            },
          ],
        },
        {
          name: 'deepinfra/meta-llama/llama-3.3-70b-instruct',
          accountCount: 1,
          tokenCount: 1,
          avgLatency: 240,
          successRate: 98,
          description: null,
          tags: [],
          supportedEndpointTypes: [],
          pricingSources: [],
          accounts: [
            {
              id: 2,
              site: '平台站 B',
              username: 'tester',
              latency: 240,
              balance: 7.2,
              tokens: [{ id: 2, name: 'default', isDefault: true }],
            },
          ],
        },
        {
          name: 'groq/compound-beta',
          accountCount: 1,
          tokenCount: 1,
          avgLatency: 95,
          successRate: 99,
          description: null,
          tags: [],
          supportedEndpointTypes: [],
          pricingSources: [],
          accounts: [
            {
              id: 3,
              site: '平台站 C',
              username: 'tester',
              latency: 95,
              balance: 5.1,
              tokens: [{ id: 3, name: 'default', isDefault: true }],
            },
          ],
        },
      ],
    });

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const text = collectText(root!.root);
      expect(text).toContain('OpenRouter');
      expect(text).toContain('Meta');
      expect(text).toContain('Groq');
      expect(text).not.toContain('其他未归类的模型');
    } finally {
      root?.unmount();
    }
  });

  it('shows user-reported recognizable brands in the marketplace filter panel', async () => {
    apiMock.getModelsMarketplace.mockResolvedValue({
      models: [
        {
          name: 'xiaomi/mimo-v2-pro',
          accountCount: 1,
          tokenCount: 1,
          avgLatency: 180,
          successRate: 99,
          description: null,
          tags: [],
          supportedEndpointTypes: [],
          pricingSources: [],
          accounts: [
            {
              id: 1,
              site: '平台站 A',
              username: 'tester',
              latency: 180,
              balance: 9.9,
              tokens: [{ id: 1, name: 'default', isDefault: true }],
            },
          ],
        },
        {
          name: 'arcee-ai/trinity-mini',
          accountCount: 1,
          tokenCount: 1,
          avgLatency: 240,
          successRate: 98,
          description: null,
          tags: [],
          supportedEndpointTypes: [],
          pricingSources: [],
          accounts: [
            {
              id: 2,
              site: '平台站 B',
              username: 'tester',
              latency: 240,
              balance: 7.2,
              tokens: [{ id: 2, name: 'default', isDefault: true }],
            },
          ],
        },
        {
          name: 'amazon/nova-premier-v1',
          accountCount: 1,
          tokenCount: 1,
          avgLatency: 95,
          successRate: 99,
          description: null,
          tags: [],
          supportedEndpointTypes: [],
          pricingSources: [],
          accounts: [
            {
              id: 3,
              site: '平台站 C',
              username: 'tester',
              latency: 95,
              balance: 5.1,
              tokens: [{ id: 3, name: 'default', isDefault: true }],
            },
          ],
        },
        {
          name: 'LongCat-Flash-Lite',
          accountCount: 1,
          tokenCount: 1,
          avgLatency: 95,
          successRate: 99,
          description: null,
          tags: [],
          supportedEndpointTypes: [],
          pricingSources: [],
          accounts: [
            {
              id: 4,
              site: '平台站 D',
              username: 'tester',
              latency: 95,
              balance: 5.1,
              tokens: [{ id: 4, name: 'default', isDefault: true }],
            },
          ],
        },
      ],
    });

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const text = collectText(root!.root);
      expect(text).toContain('Xiaomi MiMo');
      expect(text).toContain('Arcee');
      expect(text).toContain('Amazon Nova');
      expect(text).toContain('LongCat');
      expect(text).not.toContain('其他未归类的模型');
    } finally {
      root?.unmount();
    }
  });

  it('keeps a visible mobile filter entry on small screens', async () => {
    const nextWindow = (originalWindow ? { ...originalWindow } : {}) as Window & typeof globalThis;
    nextWindow.innerWidth = 768;
    nextWindow.addEventListener = nextWindow.addEventListener || (() => {});
    nextWindow.removeEventListener = nextWindow.removeEventListener || (() => {});
    nextWindow.setTimeout = nextWindow.setTimeout || globalThis.setTimeout.bind(globalThis);
    nextWindow.clearTimeout = nextWindow.clearTimeout || globalThis.clearTimeout.bind(globalThis);
    nextWindow.requestAnimationFrame = nextWindow.requestAnimationFrame || ((callback: FrameRequestCallback) => globalThis.setTimeout(() => callback(Date.now()), 0) as unknown as number);
    nextWindow.cancelAnimationFrame = nextWindow.cancelAnimationFrame || ((id: number) => globalThis.clearTimeout(id));
    nextWindow.matchMedia = (() => ({
      matches: true,
      media: '(max-width: 768px)',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    globalThis.window = nextWindow;
    globalThis.matchMedia = nextWindow.matchMedia;

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(collectText(root!.root)).toContain('筛选');
    } finally {
      root?.unmount();
    }
  });

  it('keeps the mobile filter entry visible even while the first screen is still loading', async () => {
    globalThis.window = {
      innerWidth: 768,
      addEventListener: () => {},
      removeEventListener: () => {},
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      requestAnimationFrame: (callback: FrameRequestCallback) => globalThis.setTimeout(() => callback(Date.now()), 0) as unknown as number,
      cancelAnimationFrame: (id: number) => globalThis.clearTimeout(id),
    } as unknown as Window & typeof globalThis;
    apiMock.getModelsMarketplace.mockImplementation(() => new Promise(() => {}));

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });

      expect(collectText(root!.root)).toContain('筛选');
    } finally {
      root?.unmount();
    }
  });

  it('limits expanded account and pricing detail to the selected site filter', async () => {
    apiMock.getModelsMarketplace.mockResolvedValue({
      models: [
        {
          name: 'gpt-4o',
          accountCount: 2,
          tokenCount: 3,
          avgLatency: 500,
          successRate: 96,
          description: 'demo model',
          tags: ['chat'],
          supportedEndpointTypes: ['openai'],
          pricingSources: [
            {
              siteId: 1,
              siteName: '站点 A',
              accountId: 1,
              username: 'user-a',
              ownerBy: null,
              enableGroups: [],
              groupPricing: {
                default: {
                  quotaType: 0,
                  inputPerMillion: 1,
                  outputPerMillion: 2,
                },
              },
            },
            {
              siteId: 2,
              siteName: '站点 B',
              accountId: 2,
              username: 'user-b',
              ownerBy: null,
              enableGroups: [],
              groupPricing: {
                default: {
                  quotaType: 0,
                  inputPerMillion: 3,
                  outputPerMillion: 4,
                },
              },
            },
          ],
          accounts: [
            {
              id: 1,
              site: '站点 A',
              username: 'user-a',
              latency: 320,
              balance: 12.5,
              tokens: [
                { id: 1, name: 'token-a-1', isDefault: true },
                { id: 2, name: 'token-a-2', isDefault: false },
              ],
            },
            {
              id: 2,
              site: '站点 B',
              username: 'user-b',
              latency: 680,
              balance: 8.4,
              tokens: [
                { id: 3, name: 'token-b-1', isDefault: true },
              ],
            },
          ],
        },
      ],
    });

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const siteFilterItem = findButtonByText(root!.root, '站点 A');

      apiMock.getModelsMarketplace.mockResolvedValueOnce({
        models: [{
          name: 'gpt-4o',
          accountCount: 1,
          tokenCount: 2,
          managedTokenCount: 2,
          credentialCount: 1,
          endpointCount: 1,
          executionAttemptCount: 1,
          avgLatency: 320,
          successRate: 96,
          description: 'demo model',
          tags: ['chat'],
          supportedEndpointTypes: ['openai'],
          runtimeInventoryIssues: [],
          pricingSources: [{
            siteId: 1,
            siteName: '站点 A',
            accountId: 1,
            username: 'user-a',
            ownerBy: null,
            enableGroups: [],
            groupPricing: { default: { quotaType: 0, inputPerMillion: 1, outputPerMillion: 2 } },
          }],
          measuredEntryPricing: null,
          accounts: [{
            id: 1,
            site: '站点 A',
            username: 'user-a',
            latency: 320,
            unitCost: null,
            balance: 12.5,
            tokens: [
              { id: 1, name: 'token-a-1', isDefault: true },
              { id: 2, name: 'token-a-2', isDefault: false },
            ],
            managedTokenCount: 2,
            credentialCount: 1,
            endpointCount: 1,
            executionAttemptCount: 1,
          }],
          siteCounts: { '站点 A': { endpointCount: 1, executionAttemptCount: 1, credentialCount: 1 } },
        }],
      });

      await act(async () => {
        siteFilterItem.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.getModelsMarketplace).toHaveBeenLastCalledWith(expect.objectContaining({ site: '站点 A' }));

      const cards = findButtonsByText(root!.root, 'gpt-4o');
      expect(cards.length).toBeGreaterThan(0);

      await act(async () => {
        cards[0]!.props.onClick();
      });
      await flushMicrotasks();

      const workspaceText = collectText(root!.root);
      expect(workspaceText).toContain('站点 A');
      expect(workspaceText).toContain('user-a');
      expect(workspaceText).toContain('token-a-1');
      expect(workspaceText).not.toContain('user-b');
      expect(workspaceText).not.toContain('token-b-1');
    } finally {
      root?.unmount();
    }
  });

  it('re-sorts models using site-scoped counts after selecting a site filter', async () => {
    apiMock.getModelsMarketplace.mockResolvedValue({
      models: [
        {
          name: 'gpt-4o',
          accountCount: 4,
          tokenCount: 4,
          avgLatency: 300,
          successRate: 98,
          description: null,
          tags: [],
          supportedEndpointTypes: [],
          pricingSources: [],
          accounts: [
            {
              id: 1,
              site: '站点 A',
              username: 'user-a-1',
              latency: 300,
              balance: 8,
              tokens: [{ id: 1, name: 'token-a-1', isDefault: true }],
            },
            {
              id: 2,
              site: '站点 B',
              username: 'user-b-1',
              latency: 200,
              balance: 8,
              tokens: [{ id: 2, name: 'token-b-1', isDefault: true }],
            },
            {
              id: 3,
              site: '站点 B',
              username: 'user-b-2',
              latency: 250,
              balance: 8,
              tokens: [{ id: 3, name: 'token-b-2', isDefault: true }],
            },
            {
              id: 4,
              site: '站点 B',
              username: 'user-b-3',
              latency: 260,
              balance: 8,
              tokens: [{ id: 4, name: 'token-b-3', isDefault: true }],
            },
          ],
        },
        {
          name: 'claude-3-5-sonnet',
          accountCount: 2,
          tokenCount: 2,
          avgLatency: 420,
          successRate: 95,
          description: null,
          tags: [],
          supportedEndpointTypes: [],
          pricingSources: [],
          accounts: [
            {
              id: 5,
              site: '站点 A',
              username: 'user-a-2',
              latency: 410,
              balance: 9,
              tokens: [{ id: 5, name: 'token-a-2', isDefault: true }],
            },
            {
              id: 6,
              site: '站点 A',
              username: 'user-a-3',
              latency: 430,
              balance: 9,
              tokens: [{ id: 6, name: 'token-a-3', isDefault: true }],
            },
          ],
        },
      ],
    });

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const siteFilterItem = findButtonByText(root!.root, '站点 A');

      apiMock.getModelsMarketplace.mockResolvedValueOnce({
        models: [
          {
            name: 'claude-3-5-sonnet',
            accountCount: 2,
            tokenCount: 2,
            managedTokenCount: 2,
            credentialCount: 2,
            endpointCount: 2,
            executionAttemptCount: 2,
            avgLatency: 420,
            successRate: 95,
            description: null,
            tags: [],
            supportedEndpointTypes: [],
            runtimeInventoryIssues: [],
            pricingSources: [],
            measuredEntryPricing: null,
            accounts: [],
            siteCounts: { '站点 A': { endpointCount: 2, executionAttemptCount: 2, credentialCount: 2 } },
          },
          {
            name: 'gpt-4o',
            accountCount: 1,
            tokenCount: 1,
            managedTokenCount: 1,
            credentialCount: 1,
            endpointCount: 1,
            executionAttemptCount: 1,
            avgLatency: 300,
            successRate: 98,
            description: null,
            tags: [],
            supportedEndpointTypes: [],
            runtimeInventoryIssues: [],
            pricingSources: [],
            measuredEntryPricing: null,
            accounts: [],
            siteCounts: { '站点 A': { endpointCount: 1, executionAttemptCount: 1, credentialCount: 1 } },
          },
        ],
      });

      await act(async () => {
        siteFilterItem.props.onClick();
      });
      await flushMicrotasks();

      const cards = root!.root.findAll((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && typeof node.props.className === 'string'
        && node.props.className.includes('h-auto')
        && (collectText(node).includes('claude-3-5-sonnet') || collectText(node).includes('gpt-4o'))
      ));

      expect(cards.length).toBe(2);
      expect(collectText(cards[0]!)).toContain('claude-3-5-sonnet');
      expect(collectText(cards[1]!)).toContain('gpt-4o');
    } finally {
      root?.unmount();
    }
  });

  it('renders unknown latency instead of falling back to another site latency', async () => {
    apiMock.getModelsMarketplace.mockResolvedValue({
      models: [
        {
          name: 'gpt-4o',
          accountCount: 2,
          tokenCount: 2,
          avgLatency: 680,
          successRate: 93,
          description: null,
          tags: [],
          supportedEndpointTypes: [],
          pricingSources: [],
          accounts: [
            {
              id: 1,
              site: '站点 A',
              username: 'user-a',
              latency: null,
              balance: 12,
              tokens: [{ id: 1, name: 'token-a', isDefault: true }],
            },
            {
              id: 2,
              site: '站点 B',
              username: 'user-b',
              latency: 680,
              balance: 12,
              tokens: [{ id: 2, name: 'token-b', isDefault: true }],
            },
          ],
        },
      ],
    });

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/models']}>
            <ToastProvider>
              <Models />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const siteFilterItem = findButtonByText(root!.root, '站点 A');

      apiMock.getModelsMarketplace.mockResolvedValueOnce({
        models: [{
          name: 'gpt-4o',
          accountCount: 1,
          tokenCount: 1,
          managedTokenCount: 1,
          credentialCount: 1,
          endpointCount: 1,
          executionAttemptCount: 1,
          avgLatency: null,
          successRate: 93,
          description: null,
          tags: [],
          supportedEndpointTypes: [],
          runtimeInventoryIssues: [],
          pricingSources: [],
          measuredEntryPricing: null,
          accounts: [],
          siteCounts: { '站点 A': { endpointCount: 1, executionAttemptCount: 1, credentialCount: 1 } },
        }],
      });

      await act(async () => {
        siteFilterItem.props.onClick();
      });
      await flushMicrotasks();

      const modelButton = findButtonByText(root!.root, 'gpt-4o');
      expect(collectText(modelButton)).toContain('延迟 不可用');
      expect(collectText(root!.root)).not.toContain('680ms');
    } finally {
      root?.unmount();
    }
  });
});
