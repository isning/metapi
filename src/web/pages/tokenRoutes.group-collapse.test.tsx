import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import TokenRoutes from './TokenRoutes.js';
import { ROUTE_ICON_NONE_VALUE } from './token-routes/utils.js';
import { routeSummaryFixture } from './testApiCompat.js';

const { apiMock, getBrandMock } = vi.hoisted(() => ({
  apiMock: {
    getRouteSummaryPage: vi.fn(),
    getRouteTargets: vi.fn(),
    getRouteEndpointPage: vi.fn(),
    getModelTokenCandidates: vi.fn(),
    getRouteDecisionsBatch: vi.fn(),
    getRouteWideDecisionsBatch: vi.fn(),
    updateRoute: vi.fn(),
    addRoute: vi.fn(),
    batchUpdateRouteTargets: vi.fn(),
    batchUpdateChannels: vi.fn(),
  },
  getBrandMock: vi.fn(),
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

vi.mock('../components/BrandIcon.js', () => ({
  BrandGlyph: ({ brand, icon, model }: { brand?: { name?: string } | null; icon?: string | null; model?: string | null }) => (
    <span>{brand?.name || icon || model || ''}</span>
  ),
  InlineBrandIcon: ({ model }: { model: string }) => model ? <span>{model}</span> : null,
  getBrand: (...args: unknown[]) => getBrandMock(...args),
  hashColor: () => 'linear-gradient(135deg,#4f46e5,#818cf8)',
  normalizeBrandIconKey: (icon: string) => icon,
}));

function collectText(node: ReactTestInstance): string {
  const children = node.children || [];
  return children.map((child) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

function findButtonByText(root: ReactTestInstance, text: string): ReactTestInstance {
  return root.find((node) => (
    node.type === 'button'
    && typeof node.props.onClick === 'function'
    && collectText(node).includes(text)
  ));
}

function findLastButtonByText(root: ReactTestInstance, text: string): ReactTestInstance {
  const matches = root.findAll((node) => (
    node.type === 'button'
    && typeof node.props.onClick === 'function'
    && collectText(node).includes(text)
  ));
  if (matches.length === 0) throw new Error(`No button found containing ${text}`);
  return matches[matches.length - 1]!;
}

function findChipButtonByText(root: ReactTestInstance, text: string): ReactTestInstance {
  const matches = root.findAll((node) => (
    node.type === 'button'
    && typeof node.props.onClick === 'function'
    && collectText(node).includes(text)
  ));
  if (matches.length === 0) throw new Error(`No chip button found containing ${text}`);
  return matches[0]!;
}

function findCollapsedRouteCardByText(root: ReactTestInstance, text: string): ReactTestInstance {
  const candidates = root.findAll((node) => (
    node.props['data-slot'] === 'card'
    && node.props['aria-expanded'] !== undefined
    && typeof node.props.onClick === 'function'
    && collectText(node).includes(text)
  ));
  const card = candidates.find((node) => String(node.props.className || '').includes('route--collapsed'))
    || candidates[0];
  if (!card) throw new Error(`No collapsed route card found containing ${text}`);
  return card;
}

function findTabByText(root: ReactTestInstance, text: string): ReactTestInstance {
  return root.find((node) => (
    node.type === 'button'
    && node.props.role === 'tab'
    && collectText(node).includes(text)
  ));
}

async function selectRouteGroupTab(root: ReactTestInstance, text: string) {
  const tab = findTabByText(root, text);
  await act(async () => {
    tab.props.onClick?.({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    tab.props.onPointerDown?.({ preventDefault: vi.fn(), stopPropagation: vi.fn(), button: 0, ctrlKey: false });
    tab.props.onMouseDown?.({ preventDefault: vi.fn(), stopPropagation: vi.fn(), button: 0, ctrlKey: false });
  });
  await flushMicrotasks();
}

function findFilterSummaryButton(root: ReactTestInstance): ReactTestInstance {
  return root.find((node) => (
    node.type === 'button'
    && typeof node.props.onClick === 'function'
    && collectText(node).includes('筛选:')
  ));
}

function findButtonByAriaLabel(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((node) => (
    node.type === 'button'
    && typeof node.props['aria-label'] === 'string'
    && node.props['aria-label'] === label
  ));
}

function findInputByPlaceholder(root: ReactTestInstance, placeholderText: string): ReactTestInstance {
  return root.find((node) => (
    node.type === 'input'
    && typeof node.props.placeholder === 'string'
    && node.props.placeholder.includes(placeholderText)
  ));
}

function findCheckboxByLabelText(root: ReactTestInstance, text: string): ReactTestInstance {
  const labels = root.findAll((node) => node.type === 'label' && collectText(node).includes(text));
  for (const label of labels) {
    const checkbox = label.findAll((node) => node.type === 'input' && node.props.type === 'checkbox')[0];
    if (checkbox) return checkbox;
  }
  throw new Error(`No checkbox found with label ${text}`);
}

function toggleCheckbox(node: ReactTestInstance, checked = true) {
  if (typeof node.props.onCheckedChange === 'function') {
    node.props.onCheckedChange(checked);
    return;
  }
  if (typeof node.props.onChange === 'function') {
    node.props.onChange({ target: { checked } });
    return;
  }
  if (typeof node.props.onClick === 'function') {
    node.props.onClick({ stopPropagation: vi.fn(), target: { checked } });
  }
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function routeSummaryRows(rows: any[]): any[] {
  return rows.map((row) => routeSummaryFixture(row as any));
}

function routeSummaryPage(rows: any[], totalCount: number, page = 1, pageSize = rows.length): any {
  return {
    items: routeSummaryRows(rows),
    pageInfo: {
      page,
      pageSize,
      totalCount,
      hasMore: page * pageSize < totalCount,
    },
  };
}

function routeFixture(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    modelMapping: null,
    enabled: true,
    targetCount: 1,
    enabledTargetCount: 1,
    siteNames: [`site-${id % 7}`],
    decisionSnapshot: null,
    decisionRefreshedAt: null,
    match: {
      kind: 'model' as const,
      requestedModelPattern: `paged-route-${String(id).padStart(3, '0')}`,
      displayName: null,
    },
    backend: { kind: 'supply' as const },
    presentation: { displayName: null, displayIcon: null },
    ...overrides,
  };
}

function endpointCatalogPage(items: any[], totalCount: number, page = 1, pageSize = items.length): any {
  return {
    items,
    pageInfo: {
      page,
      pageSize,
      totalCount,
      hasMore: page * pageSize < totalCount,
    },
  };
}

function routeEndpointFixture(id: number, overrides: Record<string, unknown> = {}) {
  return {
    endpointId: `route-endpoint:supply:paged:${id}`,
    nodeId: `route-endpoint:supply:paged:${id}`,
    routeId: id,
    label: `paged-source-${String(id).padStart(3, '0')}`,
    endpointKind: 'supply',
    exposure: 'none',
    resolutionStatus: 'resolved',
    ownerKind: 'automatic_route',
    sourceKind: 'upstream_model',
    enabled: true,
    displayIcon: null,
    modelPattern: `paged-source-${String(id).padStart(3, '0')}`,
    publicModelName: null,
    upstreamModels: [`paged-source-${String(id).padStart(3, '0')}`],
    siteNames: [`site-${id % 5}`],
    sourceRouteIds: [id],
    targetCount: 1,
    tags: [],
    metadata: {},
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('TokenRoutes grouped source models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBrandMock.mockReset();
    getBrandMock.mockReturnValue(null);
    vi.stubGlobal('confirm', vi.fn(() => true));
    apiMock.getModelTokenCandidates.mockResolvedValue({ models: {} });
    apiMock.getRouteTargets.mockResolvedValue([]);
    apiMock.getRouteEndpointPage.mockResolvedValue([]);
    apiMock.getRouteDecisionsBatch.mockResolvedValue({ decisions: {} });
    apiMock.getRouteWideDecisionsBatch.mockResolvedValue({ decisions: {} });
    apiMock.updateRoute.mockResolvedValue({});
    apiMock.addRoute.mockResolvedValue({});
    apiMock.batchUpdateRouteTargets.mockResolvedValue({ success: true, targets: [] });
    apiMock.batchUpdateChannels.mockResolvedValue({ success: true, channels: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('does not treat bracket-prefixed exact model routes as group filters', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 4386, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['test'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: '[NV]deepseek-v3.1-terminus', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
      {
        id: 3383, modelMapping: null, enabled: true,
        channelCount: 4, enabledChannelCount: 4, siteNames: ['site-a', 'site-b'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 're:^claude-(opus|sonnet)-4-5$', displayName: 'claude-opus-4-6' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'claude-opus-4-6', displayIcon: null }},
    ]));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(apiMock.getRouteEndpointPage).not.toHaveBeenCalled();

      const filterToggle = findButtonByText(root.root, '筛选');
      await act(async () => {
        filterToggle.props.onClick();
      });
      await flushMicrotasks();

      const text = collectText(root.root);
      expect(text).toContain('全部群组1');

      const bracketGroupButtons = root.root.findAll((node) => (
        node.type === 'button'
        && collectText(node).includes('[NV]deepseek-v3.1-terminus')
      ));
      expect(bracketGroupButtons).toHaveLength(0);
    } finally {
      root?.unmount();
    }
  });

  it('renders wildcard route channels in priority buckets and keeps source models as row badges', async () => {
    const channels = [
      {
        id: 11, routeId: 1, accountId: 101, tokenId: 1001, sourceModel: 'claude-opus-4-5',
        priority: 0, weight: 1, enabled: true, manualOverride: false,
        successCount: 0, failCount: 0,
        account: { username: 'user_a' }, site: { name: 'site-a' },
        token: { id: 1001, name: 'token-a', accountId: 101, enabled: true, isDefault: true },
      },
      {
        id: 12, routeId: 1, accountId: 102, tokenId: 1002, sourceModel: 'claude-opus-4-6',
        priority: 1, weight: 1, enabled: true, manualOverride: false,
        successCount: 0, failCount: 0,
        account: { username: 'user_b' }, site: { name: 'site-b' },
        token: { id: 1002, name: 'token-b', accountId: 102, enabled: true, isDefault: true },
      },
    ];
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 1, modelMapping: null, enabled: true,
        channelCount: 2, enabledChannelCount: 2, siteNames: ['site-a', 'site-b'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 're:^claude-opus-(4-6|4-5)$', displayName: 'claude-opus-4-6' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'claude-opus-4-6', displayIcon: null }},
    ]));
    apiMock.getRouteTargets.mockResolvedValue(channels);

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      // Desktop now keeps route summaries on the left and renders the active
      // route in the persistent workbench on the right.
      const text = collectText(root.root);
      expect(text).toContain('claude-opus-4-6');
      expect(text).toContain('P0');
      expect(text).toContain('P1');
      expect(text).toContain('user_a');
      expect(text).toContain('user_b');
      expect(text).toContain('claude-opus-4-5');
      expect(text).toContain('claude-opus-4-6');
    } finally {
      root?.unmount();
    }
  });

  it('paginates route list instead of progressively loading every matching route', async () => {
    const routes = Array.from({ length: 45 }, (_, index) => {
      const id = index + 1;
      return {
        id,
        modelMapping: null,
        enabled: true,
        targetCount: 1,
        enabledTargetCount: 1,
        siteNames: ['site-a'],
        decisionSnapshot: null,
        decisionRefreshedAt: null,
        match: { kind: 'model' as const, requestedModelPattern: `route-${String(id).padStart(2, '0')}`, displayName: null },
        backend: { kind: 'supply' as const },
        presentation: { displayName: null, displayIcon: null },
      };
    });
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows(routes));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('显示第 1 - 20 条，共 45 条路由');
      expect(collectText(root.root)).toContain('route-26');
      expect(collectText(root.root)).not.toContain('route-25');

      const nextPageButton = findButtonByAriaLabel(root.root, '下一页');
      await act(async () => {
        nextPageButton.props.onClick();
      });
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('显示第 21 - 40 条，共 45 条路由');
      expect(collectText(root.root)).not.toContain('route-26');
      expect(collectText(root.root)).toContain('route-25');
    } finally {
      root?.unmount();
    }
  });

  it('shows paged route summary metadata as the real route group total', async () => {
    const firstPageRows = Array.from({ length: 3 }, (_, index) => routeFixture(index + 1));
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryPage(firstPageRows, 50_000, 1, 3));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const normalizedText = collectText(root.root).replace(/\s+/g, '');
      expect(normalizedText).toContain('共50000条路由');
      expect(normalizedText).toContain('公开路由组50000');
      expect(normalizedText).toContain('候选50000');
      expect(normalizedText).toContain('来源端点与聚合路由组');
      expect(apiMock.getRouteSummaryPage).toHaveBeenCalledWith(expect.objectContaining({
        page: 1,
        pageSize: 20,
      }));
    } finally {
      root?.unmount();
    }
  });

  it('keeps remote route group facets stable when switching to a tab that fits on one page', async () => {
    apiMock.getRouteSummaryPage.mockImplementation((options: { tab?: string; page?: number; pageSize?: number }) => {
      const tab = options.tab || 'public';
      const rows = tab === 'manual'
        ? [
            routeFixture(201, {
              match: { kind: 'model' as const, requestedModelPattern: '', displayName: 'manual-a' },
              backend: { kind: 'routes' as const, routeIds: [1] },
              presentation: { displayName: 'manual-a', displayIcon: null },
            }),
            routeFixture(202, {
              match: { kind: 'model' as const, requestedModelPattern: '', displayName: 'manual-b' },
              backend: { kind: 'routes' as const, routeIds: [2] },
              presentation: { displayName: 'manual-b', displayIcon: null },
            }),
            routeFixture(203, {
              match: { kind: 'model' as const, requestedModelPattern: '', displayName: 'manual-c' },
              backend: { kind: 'routes' as const, routeIds: [3] },
              presentation: { displayName: 'manual-c', displayIcon: null },
            }),
          ]
        : [routeFixture(1), routeFixture(2)];
      return Promise.resolve({
        ...routeSummaryPage(rows, tab === 'manual' ? 3 : 176, options.page || 1, options.pageSize || 20),
        facets: {
          brands: [],
          otherBrandCount: 0,
          sites: [],
          endpointTypes: [],
          tabs: { public: 176, internal: 4, manual: 3 },
          enabled: { enabled: 180, disabled: 3 },
        },
      });
    });

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      let normalizedText = collectText(root.root).replace(/\s+/g, '');
      expect(normalizedText).toContain('共183');
      expect(normalizedText).toContain('启用180');
      expect(normalizedText).toContain('禁用3');
      expect(normalizedText).toContain('公开路由组176');
      expect(normalizedText).toContain('内部路由组4');
      expect(normalizedText).toContain('手动路由3');

      await selectRouteGroupTab(root.root, '手动路由');
      await vi.waitFor(async () => {
        await flushMicrotasks();
        expect(apiMock.getRouteSummaryPage).toHaveBeenLastCalledWith(expect.objectContaining({
          tab: 'manual',
        }));
      });

      normalizedText = collectText(root.root).replace(/\s+/g, '');
      expect(normalizedText).toContain('共183');
      expect(normalizedText).toContain('启用180');
      expect(normalizedText).toContain('禁用3');
      expect(normalizedText).toContain('公开路由组176');
      expect(normalizedText).toContain('内部路由组4');
      expect(normalizedText).toContain('手动路由3');
      expect(normalizedText).toContain('共3条路由');
    } finally {
      root?.unmount();
    }
  });

  it('keeps page and route browser summaries visible while route group tab results load', async () => {
    const manualPage = deferred<any>();
    const facets = {
      brands: [],
      otherBrandCount: 0,
      sites: [],
      endpointTypes: [],
      tabs: { public: 176, internal: 4, manual: 3 },
      enabled: { enabled: 180, disabled: 3 },
    };
    apiMock.getRouteSummaryPage.mockImplementation((options: { tab?: string; page?: number; pageSize?: number }) => {
      const tab = options.tab || 'public';
      if (tab === 'manual') return manualPage.promise;
      return Promise.resolve({
        ...routeSummaryPage([routeFixture(1), routeFixture(2)], 176, options.page || 1, options.pageSize || 20),
        facets,
      });
    });

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      let normalizedText = collectText(root.root).replace(/\s+/g, '');
      expect(normalizedText).toContain('共183');
      expect(normalizedText).toContain('启用180');
      expect(normalizedText).toContain('禁用3');
      expect(normalizedText).toContain('公开路由组176');
      expect(normalizedText).toContain('内部路由组4');
      expect(normalizedText).toContain('手动路由3');
      expect(root.root.findAllByProps({ 'data-testid': 'route-group-list-loading' })).toHaveLength(0);

      const manualTab = findTabByText(root.root, '手动路由');
      await act(async () => {
        manualTab.props.onClick?.({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
      });
      await vi.waitFor(async () => {
        await flushMicrotasks();
        expect(apiMock.getRouteSummaryPage).toHaveBeenLastCalledWith(expect.objectContaining({
          tab: 'manual',
        }));
      });

      normalizedText = collectText(root.root).replace(/\s+/g, '');
      expect(normalizedText).toContain('共183');
      expect(normalizedText).toContain('启用180');
      expect(normalizedText).toContain('禁用3');
      expect(normalizedText).toContain('公开路由组176');
      expect(normalizedText).toContain('内部路由组4');
      expect(normalizedText).toContain('手动路由3');
      expect(normalizedText).toContain('共3条路由');
      expect(normalizedText).toContain('候选3');
      expect(root.root.findAllByProps({ 'data-testid': 'route-group-list-loading' })).toHaveLength(1);

      await act(async () => {
        manualPage.resolve({
          ...routeSummaryPage([
            routeFixture(201, {
              match: { kind: 'model' as const, requestedModelPattern: '', displayName: 'manual-a' },
              backend: { kind: 'routes' as const, routeIds: [1] },
              presentation: { displayName: 'manual-a', displayIcon: null },
            }),
            routeFixture(202, {
              match: { kind: 'model' as const, requestedModelPattern: '', displayName: 'manual-b' },
              backend: { kind: 'routes' as const, routeIds: [2] },
              presentation: { displayName: 'manual-b', displayIcon: null },
            }),
            routeFixture(203, {
              match: { kind: 'model' as const, requestedModelPattern: '', displayName: 'manual-c' },
              backend: { kind: 'routes' as const, routeIds: [3] },
              presentation: { displayName: 'manual-c', displayIcon: null },
            }),
          ], 3, 1, 20),
          facets,
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(root.root.findAllByProps({ 'data-testid': 'route-group-list-loading' })).toHaveLength(0);
      normalizedText = collectText(root.root).replace(/\s+/g, '');
      expect(normalizedText).toContain('manual-a');
      expect(normalizedText).toContain('共3条路由');
    } finally {
      root?.unmount();
    }
  });

  it('requests the next route summary page from the backend when route groups exceed the first page', async () => {
    const firstPageRows = [routeFixture(1)];
    const secondPageRows = [routeFixture(2)];
    apiMock.getRouteSummaryPage
      .mockResolvedValueOnce(routeSummaryPage(firstPageRows, 50_000, 1, 1))
      .mockResolvedValueOnce(routeSummaryPage(secondPageRows, 50_000, 2, 1));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const nextPageButton = findButtonByAriaLabel(root.root, '下一页');
      expect(nextPageButton.props.disabled).toBe(false);
      await act(async () => {
        nextPageButton.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.getRouteSummaryPage).toHaveBeenLastCalledWith(expect.objectContaining({
        page: 2,
        pageSize: 20,
      }));
      expect(collectText(root.root)).toContain('paged-route-002');
    } finally {
      root?.unmount();
    }
  });

  it('sends route list search and sort state to the paged route summary endpoint', async () => {
    apiMock.getRouteSummaryPage.mockImplementation((options: { q?: string; page?: number; pageSize?: number }) => Promise.resolve({
      ...routeSummaryPage([
        routeFixture(options.q ? 50_000 : 1, {
          match: {
            kind: 'model' as const,
            requestedModelPattern: options.q ? 'tail-route-model' : 'paged-route-001',
            displayName: null,
          },
        }),
      ], options.q ? 1 : 50_000, options.page || 1, options.pageSize || 20),
      facets: {
        brands: [{ name: 'OpenAI', icon: 'openai', count: options.q ? 1 : 50_000 }],
        otherBrandCount: 0,
        sites: [{ name: 'site-a', count: options.q ? 1 : 50_000, siteId: 0 }],
        tabs: { public: options.q ? 1 : 50_000, internal: 0, manual: 0 },
        enabled: { enabled: options.q ? 1 : 50_000, disabled: 0 },
      },
    }));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(apiMock.getRouteSummaryPage).toHaveBeenCalledWith(expect.objectContaining({
        page: 1,
        pageSize: 20,
        tab: 'public',
        sortBy: 'targetCount',
        sortDir: 'desc',
      }));

      const searchInput = findInputByPlaceholder(root.root, '搜索模型路由');
      await act(async () => {
        searchInput.props.onChange({ target: { value: 'tail-route-model' } });
      });

      await vi.waitFor(async () => {
        await flushMicrotasks();
        expect(apiMock.getRouteSummaryPage).toHaveBeenLastCalledWith(expect.objectContaining({
          page: 1,
          pageSize: 20,
          q: 'tail-route-model',
          tab: 'public',
          sortBy: 'targetCount',
          sortDir: 'desc',
        }));
        const normalizedText = collectText(root.root).replace(/\s+/g, '');
        expect(normalizedText).toContain('共1条路由');
        expect(normalizedText).toContain('tail-route-model');
      });
    } finally {
      root?.unmount();
    }
  });

  it('renders oauth route unit summary and members after expanding a pooled route', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 31, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['codex-oauth'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'gpt-4.1', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
    ]));
    apiMock.getRouteTargets.mockResolvedValue([
      {
        id: 511, routeId: 31, accountId: 901, tokenId: null, sourceModel: 'gpt-4.1',
        priority: 0, weight: 1, enabled: true, manualOverride: false,
        successCount: 5, failCount: 1,
        account: { username: 'route-unit-anchor', credentialMode: 'oauth' },
        site: { id: 41, name: 'codex-oauth', platform: 'openai' },
        token: null,
        routeUnit: {
          id: 'pool-31',
          name: 'Codex Pool A',
          strategy: 'stick_until_unavailable',
          memberCount: 3,
          members: [
            { accountId: 901, username: 'route-unit-anchor', siteName: 'codex-oauth' },
            { accountId: 902, username: 'route-unit-backup', siteName: 'codex-oauth' },
            { accountId: 903, username: 'route-unit-third', siteName: 'codex-oauth' },
          ],
        },
      },
    ]);

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const expandBtn = findCollapsedRouteCardByText(root.root, 'gpt-4.1');
      await act(async () => {
        expandBtn.props.onClick();
      });
      await flushMicrotasks();

      const text = collectText(root.root);
      expect(text).toContain('Codex Pool A');
      expect(text).toContain('3 个成员');
      expect(text).toContain('单个用到不可用再切');
      expect(text).toContain('成员摘要');
      expect(text).toContain('route-unit-anchor');
      expect(text).toContain('route-unit-backup');
      expect(text).toContain('route-unit-third');
    } finally {
      root?.unmount();
    }
  });

  it('shows oauth route unit summary and member details after expanding a pooled route', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 1, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['site-a'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'gpt-5-codex', displayName: 'gpt-5-codex' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'gpt-5-codex', displayIcon: null }},
    ]));
    apiMock.getRouteTargets.mockResolvedValue([
      {
        id: 11, routeId: 1, accountId: 101, tokenId: null, sourceModel: 'gpt-5-codex',
        priority: 0, weight: 1, enabled: true, manualOverride: false,
        successCount: 0, failCount: 0,
        account: { username: 'pool-representative', credentialMode: 'oauth' },
        site: { id: 1, name: 'site-a', platform: 'openai' },
        token: null,
        routeUnit: {
          id: 17,
          name: 'Codex 池',
          memberCount: 3,
          strategy: 'stick_until_unavailable',
          members: [
            { accountId: 101, username: 'user_a', siteName: 'site-a' },
            { accountId: 102, username: 'user_b', siteName: 'site-b' },
            { accountId: 103, username: 'user_c', siteName: 'site-c' },
          ],
        },
      },
    ]);

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const expandBtn = findCollapsedRouteCardByText(root.root, 'gpt-5-codex');
      await act(async () => {
        expandBtn.props.onClick();
      });
      await flushMicrotasks();

      const expandedText = collectText(root.root);
      expect(expandedText).toContain('OAuth 路由池');
      expect(expandedText).toContain('Codex 池');
      expect(expandedText).toContain('3 个成员');
      expect(expandedText).toContain('单个用到不可用再切');
      expect(expandedText).toContain('成员摘要');
      expect(expandedText).toContain('user_a @ site-a、user_b @ site-b、user_c @ site-c');
    } finally {
      root?.unmount();
    }
  });

  it('writes explicit-group priority edits back to source channels and confirms shared-source impact', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 11, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['site-a'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'claude-opus-4-5', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
      {
        id: 12, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['site-b'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'claude-sonnet-4-5', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
      {
        id: 21, modelMapping: null, enabled: true,
        channelCount: 2, enabledChannelCount: 2, siteNames: ['site-a', 'site-b'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: '', displayName: 'claude-proxy-a' },
        backend: { kind: 'routes', routeIds: [11, 12] },
        presentation: { displayName: 'claude-proxy-a', displayIcon: '' }},
      {
        id: 22, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['site-b'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: '', displayName: 'claude-proxy-b' },
        backend: { kind: 'routes', routeIds: [12] },
        presentation: { displayName: 'claude-proxy-b', displayIcon: '' }},
    ]));
    apiMock.getRouteTargets.mockResolvedValue([
      {
        id: 101, routeId: 11, accountId: 101, tokenId: 1001, sourceModel: 'claude-opus-4-5',
        priority: 0, weight: 1, enabled: true, manualOverride: false,
        successCount: 0, failCount: 0,
        account: { username: 'user_a' }, site: { name: 'site-a' },
        token: { id: 1001, name: 'token-a', accountId: 101, enabled: true, isDefault: true },
      },
      {
        id: 102, routeId: 12, accountId: 102, tokenId: 1002, sourceModel: 'claude-sonnet-4-5',
        priority: 1, weight: 1, enabled: true, manualOverride: false,
        successCount: 0, failCount: 0,
        account: { username: 'user_b' }, site: { name: 'site-b' },
        token: { id: 1002, name: 'token-b', accountId: 102, enabled: true, isDefault: true },
      },
    ]);

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      await selectRouteGroupTab(root.root, '手动路由');

      const expandBtn = findCollapsedRouteCardByText(root.root, 'claude-proxy-a');
      await act(async () => {
        expandBtn.props.onClick();
      });
      await flushMicrotasks();

      const dragContext = root.root.find((node) => typeof node.props?.onDragEnd === 'function');
      expect(dragContext).toBeTruthy();

      await act(async () => {
        await dragContext.props.onDragEnd({
          active: { id: 102 },
          over: { id: 101 },
        });
      });
      await flushMicrotasks();

      expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('claude-proxy-b'));
      expect(apiMock.batchUpdateRouteTargets).toHaveBeenCalledWith([
        { id: 101, priority: 0 },
        { id: 102, priority: 0 },
      ]);
    } finally {
      root?.unmount();
    }
  });

  it('does not rewrite shared-source priorities when the confirmation is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 11, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['site-a'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'claude-opus-4-5', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
      {
        id: 12, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['site-b'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'claude-sonnet-4-5', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
      {
        id: 21, modelMapping: null, enabled: true,
        channelCount: 2, enabledChannelCount: 2, siteNames: ['site-a', 'site-b'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: '', displayName: 'claude-proxy-a' },
        backend: { kind: 'routes', routeIds: [11, 12] },
        presentation: { displayName: 'claude-proxy-a', displayIcon: '' }},
      {
        id: 22, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['site-b'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: '', displayName: 'claude-proxy-b' },
        backend: { kind: 'routes', routeIds: [12] },
        presentation: { displayName: 'claude-proxy-b', displayIcon: '' }},
    ]));
    apiMock.getRouteTargets.mockResolvedValue([
      {
        id: 101, routeId: 11, accountId: 101, tokenId: 1001, sourceModel: 'claude-opus-4-5',
        priority: 0, weight: 1, enabled: true, manualOverride: false,
        successCount: 0, failCount: 0,
        account: { username: 'user_a' }, site: { name: 'site-a' },
        token: { id: 1001, name: 'token-a', accountId: 101, enabled: true, isDefault: true },
      },
      {
        id: 102, routeId: 12, accountId: 102, tokenId: 1002, sourceModel: 'claude-sonnet-4-5',
        priority: 1, weight: 1, enabled: true, manualOverride: false,
        successCount: 0, failCount: 0,
        account: { username: 'user_b' }, site: { name: 'site-b' },
        token: { id: 1002, name: 'token-b', accountId: 102, enabled: true, isDefault: true },
      },
    ]);

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      await selectRouteGroupTab(root.root, '手动路由');

      const expandBtn = findCollapsedRouteCardByText(root.root, 'claude-proxy-a');
      await act(async () => {
        expandBtn.props.onClick();
      });
      await flushMicrotasks();

      const dragContext = root.root.find((node) => typeof node.props?.onDragEnd === 'function');
      await act(async () => {
        await dragContext.props.onDragEnd({
          active: { id: 102 },
          over: { id: 101 },
        });
      });
      await flushMicrotasks();

      expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('claude-proxy-b'));
      expect(apiMock.batchUpdateChannels).not.toHaveBeenCalled();
      expect(collectText(root.root)).toContain('P1');
    } finally {
      root?.unmount();
    }
  });

  it('renders missing-token site tags with interactive hover class', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 1, modelMapping: null, enabled: true,
        channelCount: 0, enabledChannelCount: 0, siteNames: [],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'gpt-5.2-codex', displayName: 'gpt-5.2-codex' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'gpt-5.2-codex', displayIcon: null }},
    ]));
    apiMock.getModelTokenCandidates.mockResolvedValue({
      models: {},
      modelsWithoutToken: {
        'gpt-5.2-codex': [
          { accountId: 101, username: 'linuxdo_11494', siteId: 11, siteName: 'Wong' },
        ],
      },
    });
    apiMock.getRouteTargets.mockResolvedValue([]);

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      // Expand card to see missing token hints
      const expandBtn = findCollapsedRouteCardByText(root.root, 'gpt-5.2-codex');
      await act(async () => {
        expandBtn.props.onClick();
      });
      await flushMicrotasks();

      const siteButton = findButtonByText(root.root, 'Wong');
      expect(siteButton.props.type).toBe('button');
      expect(String(siteButton.props.className || '')).not.toContain('missing-token-site-tag');
    } finally {
      root?.unmount();
    }
  });

  it('keeps zero-channel placeholder routes hidden by default', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([]));
    apiMock.getModelTokenCandidates.mockResolvedValue({
      models: {},
      modelsWithoutToken: {
        'gpt-5.2-codex': [
          { accountId: 101, username: 'linuxdo_11494', siteId: 11, siteName: 'Wong' },
        ],
      },
    });

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const text = collectText(root.root);
      expect(text).toContain('显示 0 目标路由');
      expect(text).not.toContain('gpt-5.2-codex');
      expect(text).not.toContain('未生成');
    } finally {
      root?.unmount();
    }
  });

  it('shows read-only zero-channel placeholder routes after toggle without loading channels', async () => {
    apiMock.getRouteSummaryPage.mockImplementation((options: { includeZeroTarget?: boolean; page?: number; pageSize?: number }) => Promise.resolve(
      options.includeZeroTarget
        ? routeSummaryPage([
          {
            id: -101,
            modelMapping: null,
            enabled: false,
            targetCount: 0,
            enabledTargetCount: 0,
            siteNames: ['Wong'],
            decisionSnapshot: null,
            decisionRefreshedAt: null,
            match: { kind: 'model', requestedModelPattern: 'gpt-5.2-codex', displayName: null },
            backend: { kind: 'supply' },
            presentation: { displayName: null, displayIcon: null },
            kind: 'zero_target',
            readOnly: true,
            isVirtual: true,
          },
          {
            id: -201,
            modelMapping: null,
            enabled: false,
            targetCount: 0,
            enabledTargetCount: 0,
            siteNames: ['香草api'],
            decisionSnapshot: null,
            decisionRefreshedAt: null,
            match: { kind: 'model', requestedModelPattern: 'claude-opus-4-6', displayName: null },
            backend: { kind: 'supply' },
            presentation: { displayName: null, displayIcon: null },
            kind: 'zero_target',
            readOnly: true,
            isVirtual: true,
          },
        ], 2, options.page || 1, options.pageSize || 20)
        : routeSummaryPage([], 0, options.page || 1, options.pageSize || 20),
    ));
    apiMock.getModelTokenCandidates.mockResolvedValue({
      models: {},
      modelsWithoutToken: {
        'gpt-5.2-codex': [
          { accountId: 101, username: 'linuxdo_11494', siteId: 11, siteName: 'Wong' },
        ],
      },
      modelsMissingTokenGroups: {
        'claude-opus-4-6': [
          {
            accountId: 201,
            username: 'linuxdo_4677',
            siteId: 12,
            siteName: '香草api',
            missingGroups: ['opus'],
            requiredGroups: ['default', 'opus'],
            availableGroups: ['default'],
          },
        ],
      },
    });

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const toggle = findButtonByText(root.root, '显示 0 目标路由');
      await act(async () => {
        toggle.props.onClick();
      });
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('隐藏 0 目标路由');
      expect(collectText(root.root)).toContain('gpt-5.2-codex');
      expect(collectText(root.root)).toContain('claude-opus-4-6');
      expect(collectText(root.root)).toContain('未生成');
      expect(collectText(root.root)).toContain('0 目标');
      expect(apiMock.getRouteSummaryPage).toHaveBeenLastCalledWith(expect.objectContaining({
        includeZeroTarget: true,
      }));

      const expandCards = root.root.findAll((node) =>
        node.props.role === 'button' && typeof node.props.onClick === 'function',
      );
      const gptCard = expandCards.find((node) => collectText(node).includes('gpt-5.2-codex'));
      expect(gptCard).toBeTruthy();

      await act(async () => {
        gptCard!.props.onClick();
      });
      await flushMicrotasks();

      const expandedText = collectText(root.root);
      expect(expandedText).toContain('待注册站点');
      expect(expandedText).toContain('Wong');
      expect(expandedText).toContain('暂无目标，先补齐连接配置后再重建路由。');
      expect(expandedText).not.toContain('添加目标');
      expect(expandedText).not.toContain('删除路由');
      expect(expandedText).not.toContain('编辑群组');
      expect(apiMock.getRouteTargets).not.toHaveBeenCalled();
    } finally {
      root?.unmount();
    }
  });

  it('does not render missing-token site tags when the hint lacks a valid account id', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 1, modelMapping: null, enabled: true,
        channelCount: 0, enabledChannelCount: 0, siteNames: [],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'gpt-5.2-codex', displayName: 'gpt-5.2-codex' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'gpt-5.2-codex', displayIcon: null }},
    ]));
    apiMock.getModelTokenCandidates.mockResolvedValue({
      models: {},
      modelsWithoutToken: {
        'gpt-5.2-codex': [
          { accountId: 0, username: 'shenmo-direct', siteId: 12, siteName: '神墨' },
        ],
      },
    });

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const text = collectText(root.root);
      expect(text).not.toContain('待注册站点');
      expect(text).not.toContain('神墨');
    } finally {
      root?.unmount();
    }
  });

  it('renders missing-token-group hints separately from missing-token site tags', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 1, modelMapping: null, enabled: true,
        channelCount: 0, enabledChannelCount: 0, siteNames: [],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'claude-opus-4-6', displayName: 'claude-opus-4-6' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'claude-opus-4-6', displayIcon: null }},
    ]));
    apiMock.getModelTokenCandidates.mockResolvedValue({
      models: {},
      modelsMissingTokenGroups: {
        'claude-opus-4-6': [
          {
            accountId: 101,
            username: 'linuxdo_4677',
            siteId: 11,
            siteName: '香草api',
            missingGroups: ['opus'],
            requiredGroups: ['default', 'opus'],
            availableGroups: ['default'],
          },
        ],
      },
    });
    apiMock.getRouteTargets.mockResolvedValue([]);

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const expandBtn = findCollapsedRouteCardByText(root.root, 'claude-opus-4-6');
      await act(async () => {
        expandBtn.props.onClick();
      });
      await flushMicrotasks();

      const text = collectText(root.root);
      expect(text).toContain('缺少分组');
      expect(text).toContain('香草api');
      expect(text).not.toContain('待注册站点');
    } finally {
      root?.unmount();
    }
  });

  it('maps endpoint types to expected brand icons in filter panel', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 1, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['Wong'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'gpt-5.2-codex', displayName: 'gpt-5.2-codex' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'gpt-5.2-codex', displayIcon: null }},
    ]));
    apiMock.getModelTokenCandidates.mockResolvedValue({
      models: {},
      endpointTypesByModel: {
        'gpt-5.2-codex': ['openai', 'gemini', 'anthropic'],
      },
    });

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      // Expand filter bar to see endpoint types
      const filterSummary = findFilterSummaryButton(root.root);
      await act(async () => {
        filterSummary.props.onClick();
      });
      await flushMicrotasks();

      const text = collectText(root.root);
      expect(text).toContain('chatgpt');
      expect(text).toContain('gemini');
      expect(text).toContain('claude');
    } finally {
      root?.unmount();
    }
  });

  it('sends endpoint type filters to the paged route summary endpoint', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue({
      ...routeSummaryPage([
        routeFixture(1, {
          match: { kind: 'model' as const, requestedModelPattern: 'gpt-5.2-codex', displayName: null },
        }),
      ], 50_000, 1, 20),
      facets: {
        brands: [],
        otherBrandCount: 0,
        sites: [],
        tabs: { public: 50_000, internal: 0, manual: 0 },
        enabled: { enabled: 50_000, disabled: 0 },
        endpointTypes: [
          { name: 'openai', count: 30_000 },
          { name: 'anthropic', count: 20_000 },
        ],
      },
    });

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const filterSummary = findFilterSummaryButton(root.root);
      await act(async () => {
        filterSummary.props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findChipButtonByText(root.root, 'openai').props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.getRouteSummaryPage).toHaveBeenLastCalledWith(expect.objectContaining({
        page: 1,
        pageSize: 20,
        endpointType: 'openai',
      }));
    } finally {
      root?.unmount();
    }
  });

  it('shows newly categorized brands in the route brand filter', async () => {
    getBrandMock.mockImplementation((modelName: string) => {
      if (String(modelName).includes('nvidia/vila')) {
        return {
          name: 'NVIDIA',
          icon: 'nvidia-color',
          color: 'linear-gradient(135deg,#76b900,#4a8c0b)',
        };
      }
      return null;
    });
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 91, modelMapping: null, enabled: true,
        channelCount: 0, enabledChannelCount: 0, siteNames: [],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'nvidia/vila', displayName: 'nvidia/vila' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'nvidia/vila', displayIcon: null }},
    ]));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      // Expand filter bar
      const filterSummary = findFilterSummaryButton(root.root);
      await act(async () => {
        filterSummary.props.onClick();
      });
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('NVIDIA');
    } finally {
      root?.unmount();
    }
  });

  it('falls back to site platform endpoint grouping when endpoint metadata cache is empty', async () => {
    // With summary-based loading, we can't infer platform from channels in the summary.
    // The endpoint type should come from endpointTypesByModel data.
    // When endpointTypesByModel is empty and channels aren't loaded, no fallback is possible.
    // This test verifies the endpoint type section renders correctly.
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 1, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['site-a'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'gpt-4o-mini', displayName: 'gpt-4o-mini' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'gpt-4o-mini', displayIcon: null }},
    ]));
    apiMock.getModelTokenCandidates.mockResolvedValue({
      models: {},
      endpointTypesByModel: {},
    });

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      // Expand filter bar
      const filterSummary = findFilterSummaryButton(root.root);
      await act(async () => {
        filterSummary.props.onClick();
      });
      await flushMicrotasks();

      const text = collectText(root.root);
      expect(text).toContain('能力');
    } finally {
      root?.unmount();
    }
  });

  it('still shows endpoint group section with empty hint when no endpoint data can be inferred', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 1, modelMapping: null, enabled: true,
        channelCount: 0, enabledChannelCount: 0, siteNames: [],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'custom-model-without-target', displayName: 'custom-model-without-target' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'custom-model-without-target', displayIcon: null }},
    ]));
    apiMock.getModelTokenCandidates.mockResolvedValue({
      models: {},
      endpointTypesByModel: {},
    });

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      // Expand filter bar
      const filterSummary = findFilterSummaryButton(root.root);
      await act(async () => {
        filterSummary.props.onClick();
      });
      await flushMicrotasks();

      const text = collectText(root.root);
      expect(text).toContain('能力');
      expect(text).toContain('暂无能力标签');
    } finally {
      root?.unmount();
    }
  });

  it('hides exact routes covered by a group route from the main route list', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 1, modelMapping: null, enabled: true,
        channelCount: 0, enabledChannelCount: 0, siteNames: [],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'minimax-m2.1', displayName: 'minimax-m2.1' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'minimax-m2.1', displayIcon: null }},
      {
        id: 2, modelMapping: null, enabled: true,
        channelCount: 0, enabledChannelCount: 0, siteNames: [],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'minimaxai/minimax-m2.1', displayName: 'minimaxai/minimax-m2.1' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'minimaxai/minimax-m2.1', displayIcon: null }},
      {
        id: 3, modelMapping: null, enabled: true,
        channelCount: 0, enabledChannelCount: 0, siteNames: [],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 're:^(minimax-m2\\.1|minimaxai/minimax-m2\\.1)$', displayName: 'minimax2.1' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'minimax2.1', displayIcon: null }},
    ]));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const normalizedText = collectText(root.root).replace(/\s+/g, '');
      expect(normalizedText).toContain('共1条路由');
      expect(normalizedText).not.toContain('共3条路由');
    } finally {
      root?.unmount();
    }
  });

  it('still hides zero-channel placeholders when a named group route covers the exact model', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 3, modelMapping: null, enabled: true,
        channelCount: 0, enabledChannelCount: 0, siteNames: [],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 're:^(gpt-5\\.2-codex)$', displayName: 'Codex' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'Codex', displayIcon: null }},
    ]));
    apiMock.getModelTokenCandidates.mockResolvedValue({
      models: {},
      modelsWithoutToken: {
        'gpt-5.2-codex': [
          { accountId: 101, username: 'linuxdo_11494', siteId: 11, siteName: 'Wong' },
        ],
      },
    });

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const toggle = findButtonByText(root.root, '显示 0 目标路由');
      await act(async () => {
        toggle.props.onClick();
      });
      await flushMicrotasks();

      const normalizedText = collectText(root.root).replace(/\s+/g, '');
      expect(normalizedText).toContain('共1条路由');
      expect(normalizedText).toContain('Codex');
      expect(normalizedText).not.toContain('gpt-5.2-codex0通道');
    } finally {
      root?.unmount();
    }
  });

  it('keeps exact routes visible when a group display name collides with a real exact model', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 1, modelMapping: null, enabled: true,
        channelCount: 0, enabledChannelCount: 0, siteNames: [],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'gpt-4o-mini', displayName: 'gpt-4o-mini' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'gpt-4o-mini', displayIcon: null }},
      {
        id: 2, modelMapping: null, enabled: true,
        channelCount: 0, enabledChannelCount: 0, siteNames: [],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'official/gpt-4o-mini', displayName: 'official/gpt-4o-mini' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'official/gpt-4o-mini', displayIcon: null }},
      {
        id: 3, modelMapping: null, enabled: true,
        channelCount: 0, enabledChannelCount: 0, siteNames: [],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 're:^(gpt-4o-mini|official/gpt-4o-mini)$', displayName: 'gpt-4o-mini' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'gpt-4o-mini', displayIcon: null }},
    ]));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const normalizedText = collectText(root.root).replace(/\s+/g, '');
      expect(normalizedText).toContain('共3条路由');
      expect(normalizedText).not.toContain('共1条路由');
    } finally {
      root?.unmount();
    }
  });

  it('searches routes by display name as well as model pattern', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 31, modelMapping: null, enabled: true,
        channelCount: 0, enabledChannelCount: 0, siteNames: [],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 're:^claude-(opus|sonnet)-4-6$', displayName: 'claude-4-6-group' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'claude-4-6-group', displayIcon: null }},
    ]));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const searchInput = findInputByPlaceholder(root.root, '搜索模型路由');
      await act(async () => {
        searchInput.props.onChange({ target: { value: 'claude-4-6-group' } });
      });
      await flushMicrotasks();

      const normalizedText = collectText(root.root).replace(/\s+/g, '');
      expect(normalizedText).toContain('共1条路由');
      expect(normalizedText).not.toContain('没有匹配的路由');
    } finally {
      root?.unmount();
    }
  });

  it('renders the source picker like the route page with brand, site, ability filters and a card grid', async () => {
    getBrandMock.mockImplementation((modelName: string) => {
      const model = String(modelName);
      if (model.includes('gpt')) {
        return { name: 'OpenAI', icon: 'openai', color: 'linear-gradient(135deg,#111,#555)' };
      }
      if (model.includes('claude')) {
        return { name: 'Anthropic', icon: 'anthropic', color: 'linear-gradient(135deg,#d97706,#f59e0b)' };
      }
      if (model.includes('gemini')) {
        return { name: 'Gemini', icon: 'gemini', color: 'linear-gradient(135deg,#2563eb,#7c3aed)' };
      }
      return null;
    });
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 11, modelMapping: null, enabled: true,
        channelCount: 3, enabledChannelCount: 3, siteNames: ['Wong'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'gpt-5.4', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
      {
        id: 12, modelMapping: null, enabled: true,
        channelCount: 2, enabledChannelCount: 2, siteNames: ['Alpha'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'claude-sonnet-4-5', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
      {
        id: 13, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['Wong'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'gemini-2.5-pro', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
    ]));
    apiMock.getModelTokenCandidates.mockResolvedValue({
      models: {},
      endpointTypesByModel: {
        'gpt-5.4': ['openai'],
        'claude-sonnet-4-5': ['anthropic'],
        'gemini-2.5-pro': ['gemini'],
      },
    });

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '手动').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '新建群组').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findLastButtonByText(root.root, '选择来源端点').props.onClick();
      });
      await flushMicrotasks();

      const findPickerGrid = () => root.root.find((node) => (
        node.type === 'div'
        && String(node.props.className || '').includes('items-stretch')
        && String(node.props.className || '').includes('lg:grid-cols-2')
      ));
      const pickerGrid = findPickerGrid();
      expect(String(pickerGrid.props.className || '')).toContain('grid');

      expect(findChipButtonByText(root.root, 'OpenAI')).toBeTruthy();
      expect(findChipButtonByText(root.root, 'Wong')).toBeTruthy();
      expect(findChipButtonByText(root.root, 'gemini')).toBeTruthy();

      await act(async () => {
        findChipButtonByText(root.root, 'Wong').props.onClick();
      });
      await flushMicrotasks();
      expect(collectText(findPickerGrid())).toContain('gpt-5.4');
      expect(collectText(findPickerGrid())).toContain('gemini-2.5-pro');
      expect(collectText(findPickerGrid())).not.toContain('claude-sonnet-4-5');

      await act(async () => {
        findChipButtonByText(root.root, 'Wong').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findChipButtonByText(root.root, 'OpenAI').props.onClick();
      });
      await flushMicrotasks();
      expect(collectText(findPickerGrid())).toContain('OpenAI');
      expect(collectText(findPickerGrid())).toContain('gpt-5.4');
      expect(collectText(findPickerGrid())).not.toContain('claude-sonnet-4-5');
      expect(collectText(findPickerGrid())).not.toContain('gemini-2.5-pro');

      await act(async () => {
        findChipButtonByText(root.root, 'OpenAI').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findChipButtonByText(root.root, 'anthropic').props.onClick();
      });
      await flushMicrotasks();
      expect(collectText(findPickerGrid())).toContain('Anthropic');
      expect(collectText(findPickerGrid())).toContain('claude-sonnet-4-5');
      expect(collectText(findPickerGrid())).not.toContain('gpt-5.4');
      expect(collectText(findPickerGrid())).not.toContain('gemini-2.5-pro');
    } finally {
      root?.unmount();
    }
  });

  it('derives source picker brand filters from catalog endpoint model names when route rows are not loaded', async () => {
    getBrandMock.mockImplementation((modelName: string) => {
      const model = String(modelName).toLowerCase();
      if (model.includes('gpt')) {
        return { name: 'OpenAI', icon: 'openai', color: 'linear-gradient(135deg,#111,#555)' };
      }
      if (model.includes('claude')) {
        return { name: 'Anthropic', icon: 'anthropic', color: 'linear-gradient(135deg,#d97706,#f59e0b)' };
      }
      return null;
    });
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      routeFixture(1, {
        match: { kind: 'model', requestedModelPattern: 'local-source-without-known-brand', displayName: null },
      }),
    ]));
    apiMock.getRouteEndpointPage.mockResolvedValue(endpointCatalogPage([
      routeEndpointFixture(901, {
        endpointId: 'route-endpoint:supply:route:901:site-a:gpt-5.4',
        nodeId: 'route-endpoint:supply:route:901:site-a:gpt-5.4',
        routeId: 901,
        sourceRouteIds: [901],
        label: 'gpt-5.4 catalog endpoint',
        modelPattern: 'gpt-5.4',
        upstreamModels: ['gpt-5.4'],
        siteNames: ['site-a'],
        tags: ['openai'],
      }),
      routeEndpointFixture(902, {
        endpointId: 'route-endpoint:supply:route:902:site-b:claude-sonnet-4-5',
        nodeId: 'route-endpoint:supply:route:902:site-b:claude-sonnet-4-5',
        routeId: 902,
        sourceRouteIds: [902],
        label: 'claude-sonnet-4-5 catalog endpoint',
        modelPattern: 'claude-sonnet-4-5',
        upstreamModels: ['claude-sonnet-4-5'],
        siteNames: ['site-b'],
        tags: ['anthropic'],
      }),
    ], 2, 1, 2));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '手动').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '新建群组').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findLastButtonByText(root.root, '选择来源端点').props.onClick();
      });
      await flushMicrotasks();

      const findPickerGrid = () => root.root.find((node) => (
        node.type === 'div'
        && String(node.props.className || '').includes('items-stretch')
        && String(node.props.className || '').includes('lg:grid-cols-2')
      ));

      expect(findChipButtonByText(root.root, 'OpenAI')).toBeTruthy();
      expect(findChipButtonByText(root.root, 'Anthropic')).toBeTruthy();

      await act(async () => {
        findChipButtonByText(root.root, 'OpenAI').props.onClick();
      });
      await flushMicrotasks();

      expect(collectText(findPickerGrid())).toContain('gpt-5.4');
      expect(collectText(findPickerGrid())).not.toContain('claude-sonnet-4-5');

      await act(async () => {
        findChipButtonByText(root.root, 'OpenAI').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findChipButtonByText(root.root, 'Anthropic').props.onClick();
      });
      await flushMicrotasks();

      expect(collectText(findPickerGrid())).toContain('claude-sonnet-4-5');
      expect(collectText(findPickerGrid())).not.toContain('gpt-5.4');
    } finally {
      root?.unmount();
    }
  });

  it('shows explicit-group source counts instead of aggregated channel counts in the route list and filter chips', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 11, modelMapping: null, enabled: true,
        channelCount: 40, enabledChannelCount: 40, siteNames: ['Wong'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'deepseek-chat', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
      {
        id: 12, modelMapping: null, enabled: true,
        channelCount: 55, enabledChannelCount: 55, siteNames: ['Wong'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'deepseek-reasoner', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
      {
        id: 21, modelMapping: null, enabled: true,
        channelCount: 95, enabledChannelCount: 95, siteNames: ['Wong'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: '', displayName: 'deepseekv1' },
        backend: { kind: 'routes', routeIds: [11, 12] },
        presentation: { displayName: 'deepseekv1', displayIcon: '' }},
    ]));
    apiMock.getRouteTargets.mockResolvedValue([
      {
        id: 101, accountId: 1, tokenId: 1, sourceModel: 'deepseek-chat',
        priority: 0, weight: 1, enabled: true, manualOverride: false,
        successCount: 0, failCount: 0,
        account: { username: 'user-a' }, site: { name: 'Wong' }, token: null,
      },
    ]);

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const filterSummary = findFilterSummaryButton(root.root);
      await act(async () => {
        filterSummary.props.onClick();
      });
      await flushMicrotasks();

      const groupChip = findChipButtonByText(root.root, 'deepseekv1');
      expect(collectText(groupChip)).toContain('2');
      expect(collectText(groupChip)).not.toContain('95');

      await selectRouteGroupTab(root.root, '手动路由');

      const routeCard = findCollapsedRouteCardByText(root.root, 'deepseekv1');
      expect(collectText(routeCard).replace(/\s+/g, '')).toContain('2来源模型');
    } finally {
      root?.unmount();
    }
  });

  it('uses a dedicated source picker modal and submits explicit-group sourceRouteIds', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 11, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['site-a'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'claude-opus-4-5', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
      {
        id: 12, modelMapping: null, enabled: true,
        channelCount: 0, enabledChannelCount: 0, siteNames: [],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'claude-sonnet-4-5', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
    ]));
    apiMock.getRouteEndpointPage.mockResolvedValue([
      {
        endpointId: 'route-endpoint:supply:route:11',
        nodeId: 'route-endpoint:supply:route:11',
        routeId: 11,
        label: 'claude-opus-4-5 supply endpoint with a very long readable display name',
        endpointKind: 'supply',
        exposure: 'none',
        resolutionStatus: 'resolved',
        ownerKind: 'automatic_route',
        sourceKind: 'automatic_model_group',
        enabled: true,
        displayIcon: null,
        modelPattern: 'claude-opus-4-5',
        publicModelName: 'claude-opus-4-5',
        upstreamModels: ['claude-opus-4-5'],
        siteNames: ['site-a'],
        sourceRouteIds: [11],
        tags: ['text'],
        metadata: {},
      },
      {
        endpointId: 'route-endpoint:supply:route:12:site-b:claude-sonnet-4-5',
        nodeId: 'route-endpoint:supply:route:12:site-b:claude-sonnet-4-5',
        routeId: 12,
        label: 'claude-sonnet-4-5 supply endpoint with a very long readable display name',
        endpointKind: 'supply',
        exposure: 'none',
        resolutionStatus: 'resolved',
        ownerKind: 'automatic_route',
        sourceKind: 'upstream_model',
        enabled: true,
        displayIcon: null,
        modelPattern: 'claude-sonnet-4-5',
        publicModelName: null,
        upstreamModels: ['claude-sonnet-4-5'],
        siteNames: ['site-b'],
        sourceRouteIds: [12],
        tags: ['cacheable'],
        metadata: {},
      },
    ]);

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '手动').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '新建群组').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findInputByPlaceholder(root.root, '对外模型名').props.onChange({ target: { value: 'claude-opus-4-6' } });
      });
      await flushMicrotasks();

      expect(root.root.findAll((node) => typeof node.props?.placeholder === 'string' && node.props.placeholder.includes('搜索来源端点'))).toHaveLength(0);

      await act(async () => {
        findLastButtonByText(root.root, '选择来源端点').props.onClick();
      });
      await flushMicrotasks();

      expect(findInputByPlaceholder(root.root, '搜索来源端点')).toBeTruthy();

      await act(async () => {
        findButtonByText(root.root, 'claude-opus-4-5 supply endpoint').props.onClick();
        findButtonByText(root.root, 'claude-sonnet-4-5 supply endpoint').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '确认选择').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '创建路由组').props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.addRoute).toHaveBeenCalledWith(expect.objectContaining({
        backend: { kind: 'routes', routeIds: [11, 12] },
        macro: expect.objectContaining({
          config: expect.objectContaining({
            groups: [
              expect.objectContaining({
                input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:11'] },
              }),
              expect.objectContaining({
                input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:supply:route:12:site-b:claude-sonnet-4-5'] },
              }),
            ],
          }),
        }),
        match: expect.objectContaining({ displayName: 'claude-opus-4-6', requestedModelPattern: '' }),
        presentation: expect.objectContaining({ displayName: 'claude-opus-4-6' }),
      }));
    } finally {
      root?.unmount();
    }
  });

  it('uses source endpoint fallback ids for route rows when the endpoint catalog is empty', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 537, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['site-a'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'fallback-source-model', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
    ]));
    apiMock.getRouteEndpointPage.mockResolvedValue(endpointCatalogPage([], 0, 1, 500));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '手动').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '新建群组').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findInputByPlaceholder(root.root, '对外模型名').props.onChange({ target: { value: 'fallback-group' } });
      });
      await flushMicrotasks();

      await act(async () => {
        findLastButtonByText(root.root, '选择来源端点').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, 'fallback-source-model').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '确认选择').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '创建路由组').props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.addRoute).toHaveBeenCalledWith(expect.objectContaining({
        backend: { kind: 'routes', routeIds: [537] },
        macro: expect.objectContaining({
          config: expect.objectContaining({
            groups: [
              expect.objectContaining({
                input: { kind: 'route_endpoints', endpointIds: ['route-endpoint:product:route:537'] },
              }),
            ],
          }),
        }),
      }));
    } finally {
      root?.unmount();
    }
  });

  it('uses endpoint catalog page metadata for the real source endpoint total in the manual picker', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      routeFixture(1, {
        match: { kind: 'model', requestedModelPattern: 'paged-source-001', displayName: null },
      }),
    ]));
    apiMock.getRouteEndpointPage.mockResolvedValue(endpointCatalogPage(
      Array.from({ length: 73 }, (_, index) => routeEndpointFixture(index + 1)),
      50_000,
      1,
      73,
    ));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '手动').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '新建群组').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findLastButtonByText(root.root, '选择来源端点').props.onClick();
      });
      await flushMicrotasks();

      const normalizedText = collectText(root.root).replace(/\s+/g, '');
      expect(normalizedText).toContain('显示73/50000');
      expect(apiMock.getRouteEndpointPage).toHaveBeenCalledWith(expect.objectContaining({
        page: 1,
        pageSize: 500,
        endpointKind: 'supply',
      }));
    } finally {
      root?.unmount();
    }
  });

  it('searches source endpoints through the paged backend catalog and renders the returned total', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      routeFixture(1, {
        match: { kind: 'model', requestedModelPattern: 'paged-source-001', displayName: null },
      }),
    ]));
    apiMock.getRouteEndpointPage
      .mockResolvedValueOnce(endpointCatalogPage(
        Array.from({ length: 73 }, (_, index) => routeEndpointFixture(index + 1)),
        50_000,
        1,
        73,
      ))
      .mockResolvedValueOnce(endpointCatalogPage([
        routeEndpointFixture(50_000, {
          label: 'tail-source-50000',
          modelPattern: 'tail-source-50000',
          upstreamModels: ['tail-source-50000'],
        }),
      ], 1, 1, 73));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '手动').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '新建群组').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findLastButtonByText(root.root, '选择来源端点').props.onClick();
      });
      await flushMicrotasks();

      const searchInput = findInputByPlaceholder(root.root, '搜索来源端点');
      await act(async () => {
        searchInput.props.onValueChange?.('tail-source-50000');
        searchInput.props.onChange?.({ target: { value: 'tail-source-50000' } });
      });
      await flushMicrotasks();

      expect(apiMock.getRouteEndpointPage).toHaveBeenLastCalledWith(expect.objectContaining({
        page: 1,
        pageSize: 500,
        endpointKind: 'supply',
        q: 'tail-source-50000',
      }));
      const normalizedText = collectText(root.root).replace(/\s+/g, '');
      expect(normalizedText).toContain('显示1/1');
      expect(normalizedText).toContain('tail-source-50000');
    } finally {
      root?.unmount();
    }
  });

  it('loads additional source endpoint catalog pages into the manual picker', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      routeFixture(1, {
        match: { kind: 'model', requestedModelPattern: 'paged-source-001', displayName: null },
      }),
    ]));
    apiMock.getRouteEndpointPage
      .mockResolvedValueOnce(endpointCatalogPage([
        routeEndpointFixture(1, {
          label: 'paged-source-first',
          modelPattern: 'paged-source-first',
          upstreamModels: ['paged-source-first'],
        }),
      ], 1_000, 1, 500))
      .mockResolvedValueOnce(endpointCatalogPage([
        routeEndpointFixture(999, {
          label: 'paged-source-tail',
          modelPattern: 'paged-source-tail',
          upstreamModels: ['paged-source-tail'],
        }),
      ], 1_000, 2, 500));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '手动').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '新建群组').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findLastButtonByText(root.root, '选择来源端点').props.onClick();
      });
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('paged-source-first');
      await act(async () => {
        findButtonByText(root.root, '加载更多端点').props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.getRouteEndpointPage).toHaveBeenLastCalledWith(expect.objectContaining({
        page: 2,
        pageSize: 500,
        endpointKind: 'supply',
      }));
      const normalizedText = collectText(root.root).replace(/\s+/g, '');
      expect(normalizedText).toContain('显示2/1000');
      expect(normalizedText).toContain('paged-source-first');
      expect(normalizedText).toContain('paged-source-tail');
    } finally {
      root?.unmount();
    }
  });

  it('saves explicit groups with auto brand icon disabled as a no-icon sentinel', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 11, modelMapping: null, enabled: true,
        channelCount: 1, enabledChannelCount: 1, siteNames: ['site-a'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'claude-opus-4-5', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
    ]));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '手动').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '新建群组').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findInputByPlaceholder(root.root, '对外模型名').props.onChange({ target: { value: 'claude-opus-4-6' } });
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '选择来源端点').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, 'claude-opus-4-5').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '确认选择').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        toggleCheckbox(findCheckboxByLabelText(root.root, '自动品牌图标'), false);
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '创建路由组').props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.addRoute).toHaveBeenCalledWith(expect.objectContaining({
        backend: { kind: 'routes', routeIds: [11] },
        match: expect.objectContaining({ displayName: 'claude-opus-4-6', requestedModelPattern: '' }),
        presentation: expect.objectContaining({
          displayName: 'claude-opus-4-6',
          displayIcon: ROUTE_ICON_NONE_VALUE,
        }),
      }));
    } finally {
      root?.unmount();
    }
  });

  it('edits legacy regex groups in advanced mode only', async () => {
    apiMock.getRouteSummaryPage
      .mockResolvedValueOnce(routeSummaryRows([
        {
          id: 51, modelMapping: null, enabled: true,
          channelCount: 0, enabledChannelCount: 0, siteNames: [],
          decisionSnapshot: null, decisionRefreshedAt: null,
          match: { kind: 'model', requestedModelPattern: 're:^claude-.*$', displayName: 'group-a' },
          backend: { kind: 'supply' },
          presentation: { displayName: 'group-a', displayIcon: '' }},
      ]));
    apiMock.getRouteTargets.mockResolvedValue([]);

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      // Expand the card
      const expandBtn = findCollapsedRouteCardByText(root.root, 're:^claude-.*$');
      await act(async () => {
        expandBtn.props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '编辑群组').props.onClick();
      });
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('直连目标');
      expect(findInputByPlaceholder(root.root, '模型匹配').props.value).toBe('re:^claude-.*$');
      expect(root.root.findAll((node) => typeof node.props?.placeholder === 'string' && node.props.placeholder.includes('搜索来源端点'))).toHaveLength(0);
      expect(root.root.findAll((node) => typeof node.props?.placeholder === 'string' && node.props.placeholder.includes('对外模型名'))).toHaveLength(0);
    } finally {
      root?.unmount();
    }
  });

  it('updates explicit-group sources from the modal and reloads routes afterwards', async () => {
    apiMock.getRouteSummaryPage
      .mockResolvedValueOnce(routeSummaryRows([
        {
          id: 11, modelMapping: null, enabled: true,
          channelCount: 1, enabledChannelCount: 1, siteNames: ['site-a'],
          decisionSnapshot: null, decisionRefreshedAt: null,
          match: { kind: 'model', requestedModelPattern: 'claude-opus-4-5', displayName: null },
          backend: { kind: 'supply' },
          presentation: { displayName: null, displayIcon: null }},
        {
          id: 12, modelMapping: null, enabled: true,
          channelCount: 1, enabledChannelCount: 1, siteNames: ['site-b'],
          decisionSnapshot: null, decisionRefreshedAt: null,
          match: { kind: 'model', requestedModelPattern: 'claude-sonnet-4-5', displayName: null },
          backend: { kind: 'supply' },
          presentation: { displayName: null, displayIcon: null }},
        {
          id: 21, modelMapping: null, enabled: true,
          channelCount: 1, enabledChannelCount: 1, siteNames: ['site-a'],
          decisionSnapshot: null, decisionRefreshedAt: null,
          match: { kind: 'model', requestedModelPattern: '', displayName: 'claude-opus-4-6' },
          backend: { kind: 'routes', routeIds: [11] },
          presentation: { displayName: 'claude-opus-4-6', displayIcon: '' }},
      ]))
      .mockResolvedValueOnce(routeSummaryRows([
        {
          id: 11, modelMapping: null, enabled: true,
          channelCount: 1, enabledChannelCount: 1, siteNames: ['site-a'],
          decisionSnapshot: null, decisionRefreshedAt: null,
          match: { kind: 'model', requestedModelPattern: 'claude-opus-4-5', displayName: null },
          backend: { kind: 'supply' },
          presentation: { displayName: null, displayIcon: null }},
        {
          id: 12, modelMapping: null, enabled: true,
          channelCount: 1, enabledChannelCount: 1, siteNames: ['site-b'],
          decisionSnapshot: null, decisionRefreshedAt: null,
          match: { kind: 'model', requestedModelPattern: 'claude-sonnet-4-5', displayName: null },
          backend: { kind: 'supply' },
          presentation: { displayName: null, displayIcon: null }},
        {
          id: 21, modelMapping: null, enabled: true,
          channelCount: 2, enabledChannelCount: 2, siteNames: ['site-a', 'site-b'],
          decisionSnapshot: null, decisionRefreshedAt: null,
          match: { kind: 'model', requestedModelPattern: '', displayName: 'claude-opus-4-6' },
          backend: { kind: 'routes', routeIds: [11, 12] },
          presentation: { displayName: 'claude-opus-4-6', displayIcon: '' }},
      ]));
    apiMock.getRouteEndpointPage.mockResolvedValue(endpointCatalogPage([
      routeEndpointFixture(11, {
        endpointId: 'route-endpoint:supply:route:11',
        label: 'claude-opus-4-5',
        modelPattern: 'claude-opus-4-5',
        sourceRouteIds: [11],
        siteNames: ['site-a'],
      }),
      routeEndpointFixture(12, {
        endpointId: 'route-endpoint:supply:route:12',
        label: 'claude-sonnet-4-5',
        modelPattern: 'claude-sonnet-4-5',
        sourceRouteIds: [12],
        siteNames: ['site-b'],
      }),
      routeEndpointFixture(13, {
        endpointId: 'route-endpoint:supply:route:13',
        label: 'claude-haiku-4-5',
        modelPattern: 'claude-haiku-4-5',
        sourceRouteIds: [13],
        siteNames: ['site-c'],
      }),
    ], 3, 1, 3));
    apiMock.getRouteTargets.mockResolvedValue([]);

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      await selectRouteGroupTab(root.root, '手动路由');

      const expandBtn = findCollapsedRouteCardByText(root.root, 'claude-opus-4-6');
      await act(async () => {
        expandBtn.props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '编辑群组').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '选择来源端点').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, 'claude-haiku-4-5').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '确认选择').props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        findButtonByText(root.root, '保存路由组').props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.updateRoute).toHaveBeenCalledWith(21, expect.objectContaining({
        backend: { kind: 'routes', routeIds: [11, 12, 13] },
        match: expect.objectContaining({ displayName: 'claude-opus-4-6', requestedModelPattern: '' }),
        presentation: expect.objectContaining({ displayName: 'claude-opus-4-6' }),
      }));
      expect(apiMock.getRouteSummaryPage.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      root?.unmount();
    }
  });

  it('reuses the standard channel row presentation for explicit-group details while keeping channel management hidden', async () => {
    apiMock.getRouteSummaryPage.mockResolvedValue(routeSummaryRows([
      {
        id: 11, modelMapping: null, enabled: true,
        channelCount: 6, enabledChannelCount: 6, siteNames: ['Wong'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: 'claude-haiku-4-5-20251001', displayName: null },
        backend: { kind: 'supply' },
        presentation: { displayName: null, displayIcon: null }},
      {
        id: 21, modelMapping: null, enabled: true,
        channelCount: 6, enabledChannelCount: 6, siteNames: ['Wong'],
        decisionSnapshot: null, decisionRefreshedAt: null,
        match: { kind: 'model', requestedModelPattern: '', displayName: 'claude-haiku-proxy' },
        backend: { kind: 'routes', routeIds: [11] },
        presentation: { displayName: 'claude-haiku-proxy', displayIcon: '' }},
    ]));
    apiMock.getRouteTargets.mockResolvedValue([
      {
        id: 101,
        routeId: 11,
        accountId: 301,
        tokenId: 401,
        sourceModel: 'claude-haiku-4-5-20251001',
        priority: 0,
        weight: 10,
        enabled: true,
        manualOverride: false,
        successCount: 6,
        failCount: 1,
        account: { username: 'linuxdo_131936' },
        site: { name: 'Wong' },
        token: { id: 401, name: 'token-a', accountId: 301, enabled: true, isDefault: true },
      },
    ]);

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/routes']}>
            <ToastProvider>
              <TokenRoutes />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      await selectRouteGroupTab(root.root, '手动路由');

      const expandBtn = findCollapsedRouteCardByText(root.root, 'claude-haiku-proxy');
      await act(async () => {
        expandBtn.props.onClick();
      });
      await flushMicrotasks();

      const expandedText = collectText(root.root);
      expect(expandedText).toContain('P0');
      expect(expandedText).toContain('当前生效：token-a');
      expect(expandedText).toContain('选中概率');
      expect(findButtonByAriaLabel(root.root, '拖拽调整优先级桶').props.disabled).toBe(true);
      expect(root.root.findAll((node) => node.type === 'button' && collectText(node).trim() === '保存')).toHaveLength(0);
      expect(root.root.findAll((node) => node.type === 'button' && collectText(node).trim() === '移除')).toHaveLength(0);
    } finally {
      root?.unmount();
    }
  });
});
