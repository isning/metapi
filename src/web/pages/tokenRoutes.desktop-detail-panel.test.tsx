import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import TokenRoutes, { DesktopDetailPanelPresence } from './TokenRoutes.js';

const { apiMock, getBrandMock, routeGraphWorkbenchRenderMock } = vi.hoisted(() => ({
  apiMock: {
    getRoutesSummary: vi.fn(),
    getRouteGraphActive: vi.fn(),
    getRouteTargets: vi.fn(),
    getModelTokenCandidates: vi.fn(),
    getRouteDecision: vi.fn(),
    getRouteDecisionsBatch: vi.fn(),
    getRouteWideDecisionsBatch: vi.fn(),
    updateRoute: vi.fn(),
    rebuildRoutes: vi.fn(),
    deleteRoute: vi.fn(),
    deleteChannel: vi.fn(),
  },
  getBrandMock: vi.fn(),
  routeGraphWorkbenchRenderMock: vi.fn(),
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (node: unknown) => node,
  };
});

vi.mock('../components/useIsMobile.js', () => ({
  useIsMobile: () => false,
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

vi.mock('../components/ui/tabs/index.js', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const TabsContext = React.createContext({
    value: '',
    onValueChange: (_value: string) => {},
  });
  const Tabs = ({
    value,
    defaultValue,
    onValueChange,
    children,
    ...props
  }: {
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => {
    const [internalValue, setInternalValue] = React.useState(defaultValue || '');
    const currentValue = value ?? internalValue;
    const handleValueChange = (nextValue: string) => {
      if (value === undefined) setInternalValue(nextValue);
      onValueChange?.(nextValue);
    };
    return React.createElement(
      TabsContext.Provider,
      { value: { value: currentValue, onValueChange: handleValueChange } },
      React.createElement('div', props, children),
    );
  };
  const TabsList = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    React.createElement('div', { role: 'tablist', ...props }, children)
  );
  const TabsTrigger = ({
    value,
    children,
    ...props
  }: {
    value: string;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => {
    const context = React.useContext(TabsContext);
    return React.createElement('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': context.value === value,
      value,
      ...props,
      onMouseDown: () => context.onValueChange(value),
      onClick: () => context.onValueChange(value),
    }, children);
  };
  const TabsContent = ({
    value,
    children,
    ...props
  }: {
    value: string;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => {
    const context = React.useContext(TabsContext);
    return context.value === value ? React.createElement('div', props, children) : null;
  };
  return { Tabs, TabsList, TabsTrigger, TabsContent };
});

vi.mock('./token-routes/RouteGraphWorkbench.js', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const actual = await vi.importActual<typeof import('./token-routes/RouteGraphWorkbench.js')>('./token-routes/RouteGraphWorkbench.js');
  return {
    ...actual,
    default: (props: Record<string, unknown>) => {
      routeGraphWorkbenchRenderMock(props);
      return React.createElement('div', {
        'data-testid': 'route-graph-workbench',
        'data-mode': props.mode,
      }, `RouteGraphWorkbench:${String(props.mode || 'graph')}`);
    },
  };
});

function collectText(node: ReactTestInstance): string {
  return (node.children || []).map((child) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

function findRouteWorkbench(root: ReactTestRenderer): ReactTestInstance {
  return root.root.find((node) => (
    node.type === 'section'
    && String(node.props.className || '').includes('route-workbench')
  ));
}

async function switchDesktopWorkbenchTab(root: ReactTestRenderer, value: string) {
  const routeWorkbench = findRouteWorkbench(root);
  const tabButton = routeWorkbench.findAll((node) => (
    node.type === 'button'
    && node.props.role === 'tab'
    && node.props.value === value
    && typeof node.props.onMouseDown === 'function'
  ))[0];
  if (!tabButton) throw new Error(`desktop workbench ${value} tab not found`);
  await act(async () => {
    tabButton.props.onMouseDown({
      button: 0,
      ctrlKey: false,
      defaultPrevented: false,
      preventDefault: vi.fn(),
    });
  });
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TokenRoutes desktop detail panel', () => {
  const originalIntersectionObserver = globalThis.IntersectionObserver;
  const originalMatchMedia = globalThis.matchMedia;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.IntersectionObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      readonly root = null;
      readonly rootMargin = '0px';
      readonly thresholds = [];
    } as unknown as typeof IntersectionObserver;
    const defaultMatchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));
    globalThis.matchMedia = defaultMatchMedia as unknown as typeof matchMedia;
    if (typeof window !== 'undefined') {
      window.matchMedia = defaultMatchMedia as unknown as typeof window.matchMedia;
    }
    getBrandMock.mockReset();
    getBrandMock.mockReturnValue(null);
    routeGraphWorkbenchRenderMock.mockReset();
    apiMock.getRoutesSummary.mockResolvedValue([
      {
        id: 1,
        modelMapping: null,
        match: { kind: 'model', requestedModelPattern: 'gpt-4o-mini', displayName: 'gpt-4o-mini' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'gpt-4o-mini', displayIcon: null },
        routingStrategy: 'weighted',
        enabled: true,
        channelCount: 1,
        enabledChannelCount: 1,
        siteNames: ['site-a'],
        decisionSnapshot: null,
        decisionRefreshedAt: null,
      },
      {
        id: 2,
        modelMapping: null,
        match: { kind: 'model', requestedModelPattern: 'claude-3.7-sonnet', displayName: 'claude-3.7-sonnet' },
        backend: { kind: 'supply' },
        presentation: { displayName: 'claude-3.7-sonnet', displayIcon: null },
        routingStrategy: 'weighted',
        enabled: true,
        channelCount: 1,
        enabledChannelCount: 1,
        siteNames: ['site-b'],
        decisionSnapshot: null,
        decisionRefreshedAt: null,
      },
    ]);
    apiMock.getRouteGraphActive.mockResolvedValue({
      sourceGraph: {
        version: 1,
        nodes: [],
        edges: [],
        macros: [],
      },
    });
    apiMock.getRouteTargets.mockResolvedValue([
      {
        id: 11,
        accountId: 101,
        tokenId: 1001,
        sourceModel: 'gpt-4o-mini',
        priority: 0,
        weight: 1,
        enabled: true,
        manualOverride: false,
        successCount: 0,
        failCount: 0,
        account: { username: 'user_a' },
        site: { id: 1, name: 'site-a', platform: 'openai' },
        token: { id: 1001, name: 'token-a', accountId: 101, enabled: true, isDefault: true },
      },
    ]);
    apiMock.getModelTokenCandidates.mockResolvedValue({ models: {} });
    apiMock.getRouteDecision.mockResolvedValue({ decision: null });
    apiMock.getRouteDecisionsBatch.mockResolvedValue({ decisions: {} });
    apiMock.getRouteWideDecisionsBatch.mockResolvedValue({ decisions: {} });
    apiMock.updateRoute.mockResolvedValue({});
    apiMock.rebuildRoutes.mockResolvedValue({ rebuild: { createdRoutes: 0, createdTargets: 0 } });
    apiMock.deleteRoute.mockResolvedValue({});
    apiMock.deleteChannel.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
    globalThis.IntersectionObserver = originalIntersectionObserver;
    globalThis.matchMedia = originalMatchMedia;
    if (typeof window !== 'undefined') {
      window.matchMedia = originalMatchMedia as typeof window.matchMedia;
    }
  });

  it('keeps summary cards stable and opens a separate desktop detail panel', async () => {
    let root!: ReactTestRenderer;

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

      expect(apiMock.getRouteGraphActive).not.toHaveBeenCalled();

      const listWorkbenchLayout = root.root.find((node) => (
        node.type === 'div'
        && String(node.props.className || '').includes('route-list-workbench-layout')
      ));
      expect(String(listWorkbenchLayout.props.className || '')).toContain('min-w-0');
      expect(String(listWorkbenchLayout.props.className || '')).toContain('xl:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.18fr)]');

      const routeListPane = root.root.find((node) => (
        node.type === 'div'
        && String(node.props.className || '').includes('route-list-pane')
      ));
      expect(String(routeListPane.props.className || '')).toContain('min-w-0');
      expect(String(routeListPane.props.className || '')).not.toContain('overflow-hidden');

      const routeWorkbench = root.root.find((node) => (
        node.type === 'section'
        && String(node.props.className || '').includes('route-workbench')
      ));
      expect(String(routeWorkbench.props.className || '')).toContain('min-w-0');
      expect(String(routeWorkbench.props.className || '')).not.toContain('overflow-hidden');

      expect(root.root.findAll((node) => (
        node.type === 'div'
        && String(node.props.className || '').includes('route-card-collapsed')
      ))).toHaveLength(2);

      const firstSummaryCard = root.root.find((node) => (
        node.type === 'div'
        && String(node.props.className || '').includes('route-card-collapsed')
        && collectText(node).includes('gpt-4o-mini')
      ));
      expect(String(firstSummaryCard.props.className || '')).toContain('min-w-0');
      expect(String(firstSummaryCard.props.className || '')).not.toContain('overflow-hidden');
      expect(firstSummaryCard.findAll((node) => node.type === 'svg')).toHaveLength(0);

      await act(async () => {
        await firstSummaryCard.props.onClick();
      });
      await flushMicrotasks();

      const collapsedCardsAfterExpand = root.root.findAll((node) => (
        node.type === 'div'
        && String(node.props.className || '').includes('route-card-collapsed')
      ));
      expect(collapsedCardsAfterExpand).toHaveLength(2);

      const detailPanels = root.root.findAll((node) => (
        node.type === 'div'
        && String(node.props.className || '').includes('route--detail-panel')
      ));
      expect(detailPanels).toHaveLength(1);
      const detailPanelText = collectText(detailPanels[0]!);
      expect(detailPanelText).toContain('gpt-4o-mini');
      expect(detailPanelText).toContain('路由策略');
    } finally {
      root?.unmount();
    }
  });

  it('switches the persistent workbench when another summary card is selected', async () => {
    let root!: ReactTestRenderer;

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

      const secondSummaryCard = root.root.find((node) => (
        node.type === 'div'
        && String(node.props.className || '').includes('route-card-collapsed')
        && collectText(node).includes('claude-3.7-sonnet')
      ));

      await act(async () => {
        await secondSummaryCard.props.onClick();
      });
      await flushMicrotasks();

      const detailPanels = root.root.findAll((node) => (
        node.type === 'div'
        && String(node.props.className || '').includes('route--detail-panel')
      ));
      expect(detailPanels).toHaveLength(1);
      expect(collectText(detailPanels[0]!)).toContain('claude-3.7-sonnet');

      const detailPanelPresence = root.root.findAll((node) => (
        node.type === 'div'
        && String(node.props.className || '').includes('route-detail-panel-presence')
      ));
      expect(detailPanelPresence).toHaveLength(0);

      const firstSummaryCardAfterSwitch = root.root.find((node) => (
        node.type === 'div'
        && String(node.props.className || '').includes('route-card-collapsed')
        && collectText(node).includes('gpt-4o-mini')
      ));
      expect(String(firstSummaryCardAfterSwitch.props.className || '')).not.toContain('is-active');
      const secondSummaryCardAfterSwitch = root.root.find((node) => (
        node.type === 'div'
        && String(node.props.className || '').includes('route-card-collapsed')
        && collectText(node).includes('claude-3.7-sonnet')
      ));
      expect(String(secondSummaryCardAfterSwitch.props.className || '')).toContain('is-active');
    } finally {
      root?.unmount();
    }
  });

  it('does not schedule a close timer before the desktop detail panel has ever opened', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    let root!: ReactTestRenderer;

    try {
      await act(async () => {
        root = create(
          <DesktopDetailPanelPresence open={false}>
            {() => <div>detail</div>}
          </DesktopDetailPanelPresence>,
        );
      });
      await flushMicrotasks();

      expect(root.toJSON()).toBeNull();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      root?.unmount();
      vi.useRealTimers();
    }
  });

  it('does not render a collapse action inside the persistent desktop workbench', async () => {
    let root!: ReactTestRenderer;

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

      const collapseButtons = root.root.findAll((node) => (
        node.type === 'button'
        && collectText(node).includes('收起详情')
      ));
      expect(collapseButtons).toHaveLength(0);

      const detailPanels = root.root.findAll((node) => (
        node.type === 'div'
        && String(node.props.className || '').includes('route--detail-panel')
      ));
      expect(detailPanels).toHaveLength(1);
    } finally {
      root?.unmount();
    }
  });

  it('binds automatic route groups to the generated native macro in the desktop workbench', async () => {
    apiMock.getRouteGraphActive.mockResolvedValue({
      sourceGraph: {
        version: 1,
        nodes: [
          {
            id: 'route-endpoint:supply:upstream-model:openai:credential:gpt-4o-mini:abc12345',
            type: 'route_endpoint',
            enabled: true,
            visibility: 'internal',
            ownership: 'auto_generated',
            endpointId: 'route-endpoint:supply:upstream-model:openai:credential:gpt-4o-mini:abc12345',
            routeId: 1,
          },
        ],
        edges: [],
        macros: [
          {
            id: 'auto-model:gpt-4o-mini',
            kind: 'candidate_selector',
            enabled: true,
            visibility: 'public',
            ownership: 'auto_generated',
            name: 'gpt-4o-mini',
            config: {
              surface: {
                entry: {
                  kind: 'external',
                  visibility: 'public',
                  match: {
                    kind: 'model',
                    requestedModelPattern: 'gpt-4o-mini',
                    displayName: 'gpt-4o-mini',
                    routeId: 1,
                  },
                },
                output: 'route',
              },
              policy: { strategy: 'weighted' },
              groups: [
                {
                  id: 'source:1',
                  enabled: true,
                  priority: 0,
                  input: {
                    kind: 'route_endpoints',
                    endpointIds: ['route-endpoint:supply:upstream-model:openai:credential:gpt-4o-mini:abc12345'],
                  },
                },
              ],
            },
          },
        ],
      },
    });
    let root!: ReactTestRenderer;

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

      expect(apiMock.getRouteGraphActive).not.toHaveBeenCalled();

      await switchDesktopWorkbenchTab(root, 'macro');
      await flushMicrotasks();

      expect(apiMock.getRouteGraphActive).toHaveBeenCalledTimes(1);

      const routeWorkbench = root.root.find((node) => (
        node.type === 'section'
        && String(node.props.className || '').includes('route-workbench')
      ));
      const workbenchText = collectText(routeWorkbench);
      expect(workbenchText).toContain('Macrogpt-4o-mini');
      expect(workbenchText).not.toContain('未绑定 Macro');
    } finally {
      root?.unmount();
    }
  });

  it('renders generated graph preview rows and focuses the matching graph node', async () => {
    const productEndpointId = 'route-endpoint:product:route:1';
    apiMock.getRouteGraphActive.mockResolvedValue({
      sourceGraph: {
        version: 1,
        nodes: [
          {
            id: productEndpointId,
            type: 'route_endpoint',
            enabled: true,
            visibility: 'internal',
            ownership: 'auto_generated',
            endpointKind: 'route_product',
            endpointId: productEndpointId,
            routeEndpointId: productEndpointId,
            routeId: 1,
          },
        ],
        edges: [],
        macros: [
          {
            id: 'auto-model:gpt-4o-mini',
            kind: 'candidate_selector',
            enabled: true,
            visibility: 'public',
            ownership: 'auto_generated',
            name: 'gpt-4o-mini',
            config: {
              surface: {
                entry: {
                  kind: 'external',
                  visibility: 'public',
                  match: {
                    kind: 'model',
                    requestedModelPattern: 'gpt-4o-mini',
                    displayName: 'gpt-4o-mini',
                    routeId: 1,
                  },
                },
                output: 'route',
              },
              policy: { strategy: 'weighted' },
              groups: [
                {
                  id: 'source:1',
                  enabled: true,
                  priority: 0,
                  input: {
                    kind: 'route_endpoints',
                    endpointIds: [productEndpointId],
                  },
                },
              ],
            },
          },
        ],
      },
    });
    let root!: ReactTestRenderer;

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

      expect(apiMock.getRouteGraphActive).not.toHaveBeenCalled();

      await switchDesktopWorkbenchTab(root, 'generated');
      await flushMicrotasks();

      expect(apiMock.getRouteGraphActive).toHaveBeenCalledTimes(1);

      const routeWorkbench = findRouteWorkbench(root);
      const workbenchText = collectText(routeWorkbench);
      expect(workbenchText).toContain(productEndpointId);
      expect(workbenchText).toContain('路由 1');

      const endpointButton = routeWorkbench.find((node) => (
        node.type === 'button'
        && collectText(node).includes(productEndpointId)
      ));

      await act(async () => {
        endpointButton.props.onClick();
      });
      await flushMicrotasks();

      const graphRenders = routeGraphWorkbenchRenderMock.mock.calls
        .map((call) => call[0] as { mode?: string; focusIntent?: unknown })
        .filter((props) => props.mode === 'graph');
      const graphRender = graphRenders[graphRenders.length - 1];
      expect(graphRender?.focusIntent).toMatchObject({
        kind: 'node',
        nodeId: productEndpointId,
        macroId: 'auto-model:gpt-4o-mini',
      });
    } finally {
      root?.unmount();
    }
  });

  it('keeps the route workbench JSON preview from expanding the page width', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/web/pages/TokenRoutes.tsx', 'utf8');

    expect(source).toContain('value="json" className="min-w-0 max-w-full overflow-hidden"');
    expect(source).toContain('min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-words');
  });
});
