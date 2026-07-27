import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import ProxyLogs from './ProxyLogs.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getProxyLogs: vi.fn(),
    getProxyLogsQuery: vi.fn(),
    getProxyLogsMeta: vi.fn(),
    getProxyRequestLogDetail: vi.fn(),
    getProxyDebugTraces: vi.fn(),
    getProxyDebugTraceDetail: vi.fn(),
    getRuntimeSettings: vi.fn(),
    getSites: vi.fn(),
    updateRuntimeSettings: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

function collectText(node: ReactTestInstance): string {
  return (node.children || []).map((child) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function costSummary(amount: number) {
  return {
    amounts: [{
      amount,
      unit: 'currency' as const,
      currency: 'USD',
      source: 'provider_catalog',
      sourceId: null,
      estimateLevel: 'exact',
      planFingerprint: 'plan:test',
      observationCount: 1,
    }],
    knownObservationCount: 1,
    unknownObservationCount: 0,
  };
}

function buildProxyRequestFixture(input: Record<string, any>) {
  const {
    id,
    createdAt,
    modelRequested,
    status,
    latencyMs,
    firstTokenLatencyMs,
    isStream,
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCost,
    errorMessage,
    decisionSnapshot,
    runtimeUsage,
    billingDetails,
    ...attemptFacts
  } = input;
  const executionAttemptId = String(input.executionAttemptId || `attempt:test:${id}`);
  return {
    id: `request:test:${id}`,
    downstreamPath: '/v1/chat/completions',
    requestedModel: modelRequested,
    routeEntrypointId: input.routeEntrypointId || 'entry:test',
    runtimeEndpointId: input.runtimeEndpointId || 'endpoint:test',
    finalExecutionAttemptId: executionAttemptId,
    runtimeBundleHash: 'bundle:test',
    status,
    httpStatus: status === 'success' ? 200 : 502,
    isStream: isStream ?? null,
    latencyMs: latencyMs ?? null,
    firstTokenLatencyMs: firstTokenLatencyMs ?? null,
    promptTokens: promptTokens ?? null,
    completionTokens: completionTokens ?? null,
    totalTokens: totalTokens ?? null,
    estimatedCost: estimatedCost ?? null,
    errorMessage: errorMessage ?? null,
    startedAt: createdAt,
    completedAt: createdAt,
    attempts: [{
      ...attemptFacts,
      id,
      createdAt,
      modelRequested,
      status,
      latencyMs,
      firstTokenLatencyMs,
      isStream,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCost,
      errorMessage,
      executionAttemptId,
      billingDetails,
    }],
    decisionSnapshot,
    runtimeUsage,
    billingDetails,
  };
}

function buildListResponse(overrides?: Partial<{
  items: any[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    totalCount: number;
    successCount: number;
    failedCount: number;
    cost: ReturnType<typeof costSummary>;
    totalTokensAll: number;
  };
}>) {
  return {
    items: [
      buildProxyRequestFixture({
        id: 101,
        createdAt: '2026-03-09 16:00:00',
        modelRequested: 'gpt-4o',
        modelActual: 'gpt-4o',
        status: 'success',
        latencyMs: 120,
        firstByteLatencyMs: 35,
        firstTokenLatencyMs: 80,
        isStream: true,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        retryCount: 0,
        estimatedCost: 1.23,
        errorMessage: 'downstream: /v1/chat upstream: /api/chat',
        username: 'tester',
        siteName: 'main-site',
        siteUrl: 'https://main-site.example.com',
        clientFamily: 'codex',
        clientAppId: 'cherry_studio',
        clientAppName: 'Cherry Studio',
        clientConfidence: 'heuristic',
        downstreamKeyName: '移动端灰度',
        downstreamKeyGroupName: '项目A',
        downstreamKeyTags: ['VIP', '灰度'],
      }),
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    summary: {
      totalCount: 12,
      successCount: 8,
      failedCount: 4,
      cost: costSummary(1.23),
      totalTokensAll: 15,
    },
    clientOptions: [
      { value: 'app:cherry_studio', label: '应用 · Cherry Studio' },
      { value: 'family:codex', label: '协议 · Codex' },
    ],
    ...overrides,
  };
}

describe('ProxyLogs server-driven page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const localStorageState = new Map<string, string>();
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => (localStorageState.has(key) ? localStorageState.get(key)! : null)),
        setItem: vi.fn((key: string, value: string) => {
          localStorageState.set(String(key), String(value));
        }),
        removeItem: vi.fn((key: string) => {
          localStorageState.delete(String(key));
        }),
        clear: vi.fn(() => {
          localStorageState.clear();
        }),
      },
      configurable: true,
      writable: true,
    });
    apiMock.getSites.mockResolvedValue([
      { id: 9, name: 'main-site', status: 'active' },
      { id: 12, name: 'backup-site', status: 'active' },
    ]);
    apiMock.getRuntimeSettings.mockResolvedValue({
      proxyDebugTraceEnabled: false,
      proxyDebugCaptureHeaders: true,
      proxyDebugCaptureBodies: false,
      proxyDebugCaptureStreamChunks: false,
      proxyDebugFilterSessionId: '',
      proxyDebugFilterClientKind: '',
      proxyDebugFilterModel: '',
      proxyDebugRetentionHours: 24,
      proxyDebugMaxBodyBytes: 262144,
    });
    apiMock.getProxyLogs.mockResolvedValue(buildListResponse());
    apiMock.getProxyLogsQuery.mockImplementation((params: any) =>
      apiMock.getProxyLogs(params),
    );
    apiMock.getProxyLogsMeta.mockResolvedValue({
      summary: buildListResponse().summary,
      clientOptions: buildListResponse().clientOptions,
      sites: [
        { id: 1, name: 'main-site', status: 'active' },
        { id: 2, name: 'backup-site', status: 'active' },
      ],
    });
    apiMock.getProxyRequestLogDetail.mockResolvedValue(buildProxyRequestFixture({
      id: 101,
      createdAt: '2026-03-09 16:00:00',
      modelRequested: 'gpt-4o',
      modelActual: 'gpt-4o',
      status: 'success',
      latencyMs: 120,
      firstByteLatencyMs: 35,
      firstTokenLatencyMs: 80,
      isStream: true,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      retryCount: 0,
      estimatedCost: 1.23,
      errorMessage: 'downstream: /v1/chat upstream: /api/chat',
      username: 'tester',
      siteName: 'main-site',
      siteUrl: 'https://main-site.example.com',
      clientFamily: 'codex',
      clientAppId: 'cherry_studio',
      clientAppName: 'Cherry Studio',
      clientConfidence: 'heuristic',
      downstreamKeyName: '移动端灰度',
      downstreamKeyGroupName: '项目A',
      downstreamKeyTags: ['VIP', '灰度'],
      decisionSnapshot: {
        source: 'snapshot',
        capturedAt: '2026-03-09 15:56:30',
        request: {
          downstreamPath: '/v1/chat/completions',
          stream: true,
        },
        compiledRuntime: {
          runtimeArtifactId: 'runtime-artifact-8',

          bundleHash: 'hash-proxy-log',
        },
        match: {
          requestedModel: 'gpt-4o',
          actualModel: 'gpt-4o',
          planId: 'plan:gpt-4o',
          entryId: 'entry:gpt-4o',
          terminalKind: 'endpoint',
          publicModelName: 'gpt-4o',
        },
        endpoint: {
          endpointId: 'endpoint:gpt-4o',
          executionTargetId: 12,
          compatibilityPolicy: null,
        },
        executionAttempt: {
          executionAttemptId: 'attempt:gpt-4o:primary',
          model: 'gpt-4o',
          executionTargetId: 12,
          accountId: 3,
          tokenId: 8,
          siteId: 2,
          credential: {
            site: {
              id: 2,
              name: 'main-site',
              url: 'https://main-site.example.com',
              platform: 'new-api',
            },
            account: {
              id: 3,
              username: 'tester',
              status: 'active',
            },
            token: {
              id: 8,
              name: 'Premium Token',
              tokenGroup: 'premium',
              enabled: true,
              valueStatus: 'ready',
              source: 'manual',
            },
            oauthRouteUnitId: null,
          },
        },
        state: {
          failureOverlay: {
            disabledExecutionAttemptIds: [],
            disabledExecutionTargetIds: [],
          },
          executionAttemptState: {
            executionTargetId: 12,
            successCount: 11,
            failCount: 2,
            totalLatencyMs: 3000,
            totalCost: 0.4,
            consecutiveFailCount: 1,
            cooldownLevel: 0,
            cooldownUntil: null,
            lastUsedAt: '2026-03-09 15:55:00',
            lastSelectedAt: '2026-03-09 15:56:00',
            lastFailAt: null,
          },
        },
        filters: {
          endpointPreference: 'chat',
          postBuild: null,
        },
        syntheticResponse: null,
      },
      runtimeUsage: {
        windowDays: 30,
        fromLocalDay: '2026-02-08',
        toLocalDay: '2026-03-09',
        entry: {
          scope: 'entry',
          identity: '31',
          totalCalls: 120,
          successCalls: 108,
          failedCalls: 12,
          successRate: 90,
          totalTokens: 64000,
          cost: costSummary(4.2),
          averageLatencyMs: 240,
          latencyCount: 120,
        },
        endpoint: {
          scope: 'endpoint',
          identity: 'endpoint:gpt-4o',
          totalCalls: 88,
          successCalls: 77,
          failedCalls: 11,
          successRate: 87.5,
          totalTokens: 42000,
          cost: costSummary(2.8),
          averageLatencyMs: 260,
          latencyCount: 88,
        },
        executionAttempt: {
          scope: 'executionAttempt',
          identity: 'attempt:gpt-4o:primary',
          totalCalls: 80,
          successCalls: 72,
          failedCalls: 8,
          successRate: 90,
          totalTokens: 39000,
          cost: costSummary(2.4),
          averageLatencyMs: 230,
          latencyCount: 80,
        },
        model: {
          scope: 'model',
          identity: 'gpt-4o',
          totalCalls: 160,
          successCalls: 140,
          failedCalls: 20,
          successRate: 87.5,
          totalTokens: 88000,
          cost: costSummary(5.6),
          averageLatencyMs: 250,
          latencyCount: 160,
        },
      },
      billingDetails: {
        breakdown: {
          inputPerMillion: 1,
          outputPerMillion: 2,
          cacheReadPerMillion: 0,
          cacheCreationPerMillion: 0,
          inputCost: 0.1,
          outputCost: 0.2,
          cacheReadCost: 0,
          cacheCreationCost: 0,
          totalCost: 0.3,
        },
        pricing: {
          modelRatio: 1,
          completionRatio: 1,
          cacheRatio: 0,
          cacheCreationRatio: 0,
          groupRatio: 1,
        },
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          billablePromptTokens: 10,
          promptTokensIncludeCache: false,
        },
      },
    }));
    apiMock.getProxyDebugTraces.mockResolvedValue({
      items: [
        {
          id: 701,
          createdAt: '2026-03-28 18:00:00',
          requestedModel: 'gpt-4o',
          downstreamPath: '/v1/responses',
          finalStatus: 'failed',
          finalUpstreamPath: '/responses',
          clientKind: 'codex',
          sessionId: 'sess-debug-1',
        },
      ],
    });
    apiMock.getProxyDebugTraceDetail.mockResolvedValue({
      trace: {
        id: 701,
        requestedModel: 'gpt-4o',
        sessionId: 'sess-debug-1',
        downstreamPath: '/v1/responses',
        finalStatus: 'failed',
        finalHttpStatus: 502,
        finalUpstreamPath: '/responses',
        clientKind: 'codex',
        selectedExecutionAttemptId: 'ea_2j',
        routeEntrypointId: 'entry:gpt-4o',
        runtimeEndpointId: 'endpoint:gpt-4o:responses',
        selectedSiteId: 12,
        selectedSitePlatform: 'new-api',
        selectedSiteDisplay: {
          id: 12,
          label: 'main-site',
          platform: 'new-api',
          url: 'https://upstream.example.com',
        },
        requestHeadersJson: '{\n  "authorization": "Bearer demo"\n}',
        runtimeTraceJson: '{\n  "context": { "downstreamFormat": "openai/responses" }\n}',
      },
      attempts: [
        {
          id: 9001,
          attemptIndex: 0,
          endpoint: 'openai/responses',
          requestPath: '/v1/responses',
          targetUrl: 'https://upstream.example.com/responses',
          runtimeExecutor: 'default',
          requestHeadersJson: '{\n  "content-type": "application/json"\n}',
          requestBodyJson: '{\n  "model": "gpt-4o"\n}',
          responseStatus: 502,
          responseHeadersJson: '{\n  "x-request-id": "req_1"\n}',
          responseBodyJson: '{\n  "error": "bad gateway"\n}',
          rawErrorText: 'bad gateway',
          recoverApplied: true,
          downgradeDecision: false,
          downgradeReason: null,
          memoryWriteJson: '{\n  "blocked": ["responses"]\n}',
        },
      ],
    });
    apiMock.updateRuntimeSettings.mockResolvedValue({
      success: true,
      proxyDebugTraceEnabled: true,
      proxyDebugCaptureHeaders: true,
      proxyDebugCaptureBodies: true,
      proxyDebugCaptureStreamChunks: false,
      proxyDebugFilterSessionId: 'sess-debug-1',
      proxyDebugFilterClientKind: 'codex',
      proxyDebugFilterModel: 'gpt-4o',
      proxyDebugRetentionHours: 12,
      proxyDebugMaxBodyBytes: 131072,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('requests paginated data from the server and renders server summary counts', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(apiMock.getProxyLogs).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
        status: 'all',
        search: '',
      });

      const text = collectText(root!.root);
      expect(text).toContain('花费USD 1.23');
      expect(text).toContain('全部 12');
      expect(text).toContain('成功 8');
      expect(text).toContain('失败 4');
      expect(text).toContain('Cherry Studio');
      expect(text).toContain('Codex');
      expect(text).toContain('推测');
      expect(text).toContain('下游 Key: 移动端灰度');
      expect(text).toContain('流式');
      expect(text).toContain('首字延迟');
      expect(text).toContain('80ms');
    } finally {
      await act(async () => {
        root?.unmount();
      });
    }
  });

  it('shows proxy debug traces inline and edits settings through the modal', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(apiMock.getRuntimeSettings).toHaveBeenCalled();
      expect(apiMock.getProxyDebugTraces).toHaveBeenCalled();
      expect(collectText(root.root)).toContain('最近调试追踪');
      expect(collectText(root.root)).toContain('sess-debug-1');

      const debugSettingsButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && collectText(node).trim() === '调试设置'
      ));

      await act(async () => {
        debugSettingsButton.props.onClick();
      });
      await flushMicrotasks();

      const traceEnabledToggle = root.root.find((node) => (
        node.props['data-debug-setting'] === 'trace-enabled'
        && typeof node.props.onCheckedChange === 'function'
      ));
      const captureBodiesToggle = root.root.find((node) => (
        node.props['data-debug-setting'] === 'capture-bodies'
        && typeof node.props.onCheckedChange === 'function'
      ));
      const sessionInput = root.root.find((node) => (
        node.type === 'input'
        && node.props['data-debug-setting'] === 'target-session-id'
      ));
      const retentionInput = root.root.find((node) => (
        node.type === 'input'
        && node.props['data-debug-setting'] === 'retention-hours'
      ));

      await act(async () => {
        traceEnabledToggle.props.onCheckedChange(true);
        captureBodiesToggle.props.onCheckedChange(true);
        sessionInput.props.onChange({ target: { value: 'sess-debug-1' } });
        retentionInput.props.onChange({ target: { value: '12' } });
      });

      const saveButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && collectText(node).trim() === '保存调试设置'
      ));

      await act(async () => {
        saveButton.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.updateRuntimeSettings).toHaveBeenCalledWith(expect.objectContaining({
        proxyDebugTraceEnabled: true,
        proxyDebugCaptureBodies: true,
        proxyDebugFilterSessionId: 'sess-debug-1',
        proxyDebugRetentionHours: 12,
      }));
    } finally {
      root?.unmount();
    }
  });

  it('paginates debug traces in groups of five instead of rendering the whole trace list at once', async () => {
    apiMock.getProxyDebugTraces.mockResolvedValue({
      items: Array.from({ length: 7 }, (_, index) => ({
        id: 701 + index,
        createdAt: `2026-03-28 18:0${index}:00`,
        requestedModel: `gpt-4o-mini-${index + 1}`,
        downstreamPath: '/v1/responses',
        finalStatus: index % 2 === 0 ? 'failed' : 'success',
        finalUpstreamPath: '/responses',
        clientKind: 'codex',
        sessionId: `sess-debug-${index + 1}`,
      })),
    });

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('显示第 1 - 5 条，共 7 条');
      expect(collectText(root.root)).toContain('sess-debug-1');
      expect(collectText(root.root)).not.toContain('sess-debug-6');

      const detailButtons = root.root.findAll((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && collectText(node).trim() === '查看详情'
      ));
      expect(detailButtons).toHaveLength(5);

      const nextPageButton = root.root.find((node) => (
        node.type === 'button'
        && node.props['aria-label'] === '调试追踪下一页'
      ));

      await act(async () => {
        nextPageButton.props.onClick();
      });
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('显示第 6 - 7 条，共 7 条');
      expect(collectText(root.root)).toContain('sess-debug-6');
      expect(collectText(root.root)).not.toContain('sess-debug-1');
    } finally {
      root?.unmount();
    }
  });

  it('allows collapsing and expanding the debug trace panel to reduce page footprint', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const toggleButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && node.props['data-debug-trace-panel-toggle'] === true
      ));
      const panelBody = root.root.find((node) => (
        node.type === 'div'
        && node.props['data-debug-trace-panel-body'] === true
      ));

      expect(toggleButton.props['aria-expanded']).toBe(true);
      expect(String(panelBody.props.className || '')).toContain('is-open');

      await act(async () => {
        toggleButton.props.onClick();
      });
      await flushMicrotasks();

      const collapsedToggleButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && node.props['data-debug-trace-panel-toggle'] === true
      ));
      const collapsedPanelBody = root.root.find((node) => (
        node.type === 'div'
        && node.props['data-debug-trace-panel-body'] === true
      ));

      expect(collapsedToggleButton.props['aria-expanded']).toBe(false);
      expect(String(collapsedPanelBody.props.className || '')).not.toContain('is-open');

      await act(async () => {
        collapsedToggleButton.props.onClick();
      });
      await flushMicrotasks();

      const expandedToggleButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && node.props['data-debug-trace-panel-toggle'] === true
      ));
      const expandedPanelBody = root.root.find((node) => (
        node.type === 'div'
        && node.props['data-debug-trace-panel-body'] === true
      ));

      expect(expandedToggleButton.props['aria-expanded']).toBe(true);
      expect(String(expandedPanelBody.props.className || '')).toContain('is-open');
    } finally {
      root?.unmount();
    }
  });

  it('remembers the collapsed debug trace panel state across remounts', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const toggleButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && node.props['data-debug-trace-panel-toggle'] === true
      ));

      await act(async () => {
        toggleButton.props.onClick();
      });
      await flushMicrotasks();

      expect(globalThis.localStorage.setItem).toHaveBeenCalledWith('metapi.proxyLogs.debugTracePanelExpanded', 'false');

      await act(async () => {
        root.unmount();
      });

      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const restoredToggleButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && node.props['data-debug-trace-panel-toggle'] === true
      ));
      const restoredPanelBody = root.root.find((node) => (
        node.type === 'div'
        && node.props['data-debug-trace-panel-body'] === true
      ));

      expect(globalThis.localStorage.getItem).toHaveBeenCalledWith('metapi.proxyLogs.debugTracePanelExpanded');
      expect(restoredToggleButton.props['aria-expanded']).toBe(false);
      expect(String(restoredPanelBody.props.className || '')).not.toContain('is-open');
    } finally {
      root?.unmount();
    }
  });

  it('opens debug trace detail on demand instead of preloading the first trace inline', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(apiMock.getProxyDebugTraceDetail).not.toHaveBeenCalled();

      const viewDetailButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && collectText(node).trim() === '查看详情'
      ));

      await act(async () => {
        viewDetailButton.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.getProxyDebugTraceDetail).toHaveBeenCalledWith(701);
      expect(collectText(root.root)).toContain('原始下游请求头');
      expect(collectText(root.root)).toContain('Attempt 时间线');
      expect(collectText(root.root)).toContain('ea_2j');
      expect(collectText(root.root)).toContain('gpt-4o');
      expect(collectText(root.root)).not.toContain('GPT-4o production route (#31)');
      expect(collectText(root.root)).toContain('main-site · new-api');
      expect(collectText(root.root)).not.toContain('main-site · new-api (#12)');
      expect(collectText(root.root)).toContain('运行时状态更新');
    } finally {
      root?.unmount();
    }
  });

  it('polls debug traces after tracing is enabled so new results are not hidden behind the settings modal', async () => {
    vi.useFakeTimers();
    apiMock.getRuntimeSettings.mockResolvedValue({
      proxyDebugTraceEnabled: true,
      proxyDebugCaptureHeaders: true,
      proxyDebugCaptureBodies: false,
      proxyDebugCaptureStreamChunks: false,
      proxyDebugFilterSessionId: '',
      proxyDebugFilterClientKind: '',
      proxyDebugFilterModel: '',
      proxyDebugRetentionHours: 24,
      proxyDebugMaxBodyBytes: 262144,
    });

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const initialCalls = apiMock.getProxyDebugTraces.mock.calls.length;

      await act(async () => {
        vi.advanceTimersByTime(2100);
      });
      await flushMicrotasks();

      expect(apiMock.getProxyDebugTraces.mock.calls.length).toBeGreaterThan(initialCalls);
    } finally {
      await act(async () => {
        root?.unmount();
      });
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('keeps debug trace detail visible during polling refresh instead of flashing back to loading', async () => {
    vi.useFakeTimers();
    apiMock.getRuntimeSettings.mockResolvedValue({
      proxyDebugTraceEnabled: true,
      proxyDebugCaptureHeaders: true,
      proxyDebugCaptureBodies: false,
      proxyDebugCaptureStreamChunks: false,
      proxyDebugFilterSessionId: '',
      proxyDebugFilterClientKind: '',
      proxyDebugFilterModel: '',
      proxyDebugRetentionHours: 24,
      proxyDebugMaxBodyBytes: 262144,
    });

    let resolveDetail!: (value: any) => void;
    apiMock.getProxyDebugTraceDetail
      .mockResolvedValueOnce({
        trace: {
          id: 701,
          requestedModel: 'gpt-4o',
          sessionId: 'sess-debug-1',
          requestHeadersJson: '{\"before\":true}',
        },
        attempts: [],
      })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveDetail = resolve;
      }));

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const viewDetailButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && collectText(node).trim() === '查看详情'
      ));

      await act(async () => {
        viewDetailButton.props.onClick();
      });
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('原始下游请求头');
      expect(collectText(root.root)).not.toContain('加载追踪详情中...');

      await act(async () => {
        vi.advanceTimersByTime(2100);
      });
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('原始下游请求头');
      expect(collectText(root.root)).not.toContain('加载追踪详情中...');

      await act(async () => {
        resolveDetail({
          trace: {
            id: 701,
            requestedModel: 'gpt-4o',
            sessionId: 'sess-debug-1',
            requestHeadersJson: '{\"after\":true}',
          },
          attempts: [],
        });
      });
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('原始下游请求头');
      expect(collectText(root.root)).not.toContain('加载追踪详情中...');
    } finally {
      await act(async () => {
        root?.unmount();
      });
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('copies the saved request headers content from the trace detail modal', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const viewDetailButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && collectText(node).trim() === '查看详情'
      ));

      await act(async () => {
        viewDetailButton.props.onClick();
      });
      await flushMicrotasks();

      expect(collectText(root.root)).not.toContain('Bearer demo');

      const expandHeadersButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && node.props['aria-label'] === '展开原始下游请求头'
      ));

      await act(async () => {
        expandHeadersButton.props.onClick({ defaultPrevented: false });
      });
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('Bearer demo');

      const copyButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && node.props['aria-label'] === '复制原始下游请求头'
      ));

      await act(async () => {
        copyButton.props.onClick({ stopPropagation: () => undefined, preventDefault: () => undefined });
      });
      await flushMicrotasks();

      expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledWith('{\n  "authorization": "Bearer demo"\n}');
    } finally {
      root?.unmount();
    }
  });

  it('keeps the model badge sized to the model name in desktop rows', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const modelBadge = root!.root.find((node) => (
        node.type === 'span'
        && collectText(node) === 'gpt-4o'
        && node.props.style?.display === 'inline-flex'
      ));

      expect(modelBadge.props.style?.whiteSpace).toBe('nowrap');
    } finally {
      root?.unmount();
    }
  });

  it('renders explicit client self-reports before protocol-family fallback labels', async () => {
    apiMock.getProxyLogs.mockResolvedValue(buildListResponse({
      items: [
        buildProxyRequestFixture({
          id: 101,
          createdAt: '2026-03-09 16:00:00',
          modelRequested: 'gpt-4o',
          modelActual: 'gpt-4o',
          status: 'success',
          latencyMs: 120,
          firstByteLatencyMs: 22,
          isStream: false,
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          retryCount: 0,
          estimatedCost: 1.23,
          errorMessage: 'downstream: /v1/responses upstream: /v1/responses',
          username: 'tester',
          siteName: 'main-site',
          siteUrl: 'https://main-site.example.com',
          clientFamily: 'codex',
          clientAppId: 'openclaw',
          clientAppName: 'openclaw',
          clientConfidence: 'exact',
          downstreamKeyName: '移动端灰度',
          downstreamKeyGroupName: '项目A',
          downstreamKeyTags: ['VIP', '灰度'],
        }),
      ],
    }));

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const row = root!.root.find((node) => (
        node.type === 'tr' && node.props['data-testid'] === 'proxy-log-row-request:test:101'
      ));
      const rowText = collectText(row);
      expect(rowText).toContain('openclaw');
      expect(rowText).toContain('Codex');
      expect(rowText).not.toContain('推测');
    } finally {
      root?.unmount();
    }
  });

  it('re-queries the server for status, client, and search changes instead of filtering locally', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const failedTab = root!.root.findAll((node) => (
        node.type === 'button' && collectText(node).includes('失败')
      ))[0];
      await act(async () => {
        failedTab.props.onClick();
      });
      await flushMicrotasks();

      const clientSelectTrigger = root!.root.findAll((node) => (
        node.type === 'button'
        && node.props.role === 'combobox'
      ))[0];
      expect(clientSelectTrigger).toBeDefined();

      await act(async () => {
        clientSelectTrigger.props.onClick();
      });
      const clientOption = root!.root.find((node) => (
        node.type === 'button'
        && node.props.role === 'option'
        && collectText(node).includes('应用 · Cherry Studio')
      ));
      await act(async () => {
        clientOption.props.onClick();
      });
      await flushMicrotasks();

      const searchInput = root!.root.find((node) => (
        node.type === 'input' && node.props.placeholder === '搜索模型、下游 Key、主分组、标签...'
      ));
      await act(async () => {
        searchInput.props.onChange({ target: { value: 'mini' } });
      });
      await flushMicrotasks();

      expect(apiMock.getProxyLogs).toHaveBeenNthCalledWith(2, {
        limit: 20,
        offset: 0,
        status: 'failed',
        search: '',
      });
      expect(apiMock.getProxyLogs).toHaveBeenNthCalledWith(3, {
        limit: 20,
        offset: 0,
        status: 'failed',
        search: '',
        client: 'app:cherry_studio',
      });
      expect(apiMock.getProxyLogs).toHaveBeenLastCalledWith({
        limit: 20,
        offset: 0,
        status: 'failed',
        search: 'mini',
        client: 'app:cherry_studio',
      });
    } finally {
      root?.unmount();
    }
  });

  it('loads detail on first expand and reuses the cached detail on re-expand', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const row = root!.root.find((node) => (
        node.type === 'tr' && node.props['data-testid'] === 'proxy-log-row-request:test:101'
      ));

      await act(async () => {
        row.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.getProxyRequestLogDetail).toHaveBeenCalledTimes(1);
      const expandedText = collectText(root.root);
      expect(expandedText).toContain('路由决策快照');
      expect(expandedText).toContain('请求时记录');
      expect(expandedText).toContain('plan:gpt-4o');
      expect(expandedText).toContain('endpoint:gpt-4o');
      expect(expandedText).toContain('Premium Token');
      expect(expandedText).toContain('attempt:gpt-4o:primary');
      expect(expandedText).not.toContain('dispatcher:gpt-4o');
      expect(expandedText).not.toContain('arg:gpt-4o');
      expect(expandedText).not.toContain('entry:legacy');
      expect(expandedText).toContain('运行时统计');
      expect(expandedText).toContain('近 30 天');
      expect(expandedText).toContain('执行目标');
      expect(expandedText).toContain('#12');
      expect(expandedText).toContain('公开模型');
      expect(expandedText).toContain('Premium Token');
      expect(expandedText).toContain('main-site');
      expect(expandedText).toContain('87.5%');
      expect(expandedText).toContain('230ms');

      await act(async () => {
        row.props.onClick();
      });
      await flushMicrotasks();

      await act(async () => {
        row.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.getProxyRequestLogDetail).toHaveBeenCalledTimes(1);
      expect(apiMock.getProxyRequestLogDetail).toHaveBeenCalledWith('request:test:101');
    } finally {
      root?.unmount();
    }
  });

  it('renders unknown usage as -- instead of 0 in the server-driven table', async () => {
    apiMock.getProxyLogs.mockResolvedValue(buildListResponse({
      items: [
        buildProxyRequestFixture({
          id: 101,
          createdAt: '2026-03-09 16:00:00',
          modelRequested: 'gpt-5',
          modelActual: 'gpt-5',
          status: 'success',
          latencyMs: 120,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          usageSource: 'unknown',
          retryCount: 0,
          estimatedCost: 0,
          errorMessage: '[downstream:/v1/chat/completions] [upstream:/v1/chat/completions] [usage:unknown]',
          username: 'tester',
          siteName: 'main-site',
          siteUrl: 'https://main-site.example.com',
          clientFamily: 'codex',
          clientAppId: 'cherry_studio',
          clientAppName: 'Cherry Studio',
          clientConfidence: 'heuristic',
        }),
      ],
      summary: {
        totalCount: 1,
        successCount: 1,
        failedCount: 0,
        cost: costSummary(0),
        totalTokensAll: 0,
      },
    }));

    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const row = root!.root.find((node) => (
        node.type === 'tr' && node.props['data-testid'] === 'proxy-log-row-request:test:101'
      ));
      const rowText = collectText(row);
      expect(rowText).toContain('--');
      expect(rowText).not.toContain('输入0');
    } finally {
      root?.unmount();
    }
  });

  it('hydrates site and time filters from the route query', async () => {
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs?siteId=9&client=family%3Acodex&from=2026-03-09T08:00&to=2026-03-09T09:00']}>
            <ToastProvider>
              <ProxyLogs />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const expectedFrom = new Date(2026, 2, 9, 8, 0).toISOString();
      const expectedTo = new Date(2026, 2, 9, 9, 0).toISOString();
      expect(apiMock.getProxyLogs).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
        status: 'all',
        search: '',
        siteId: 9,
        client: 'family:codex',
        from: expectedFrom,
        to: expectedTo,
      });

      const rendered = JSON.stringify(root!.toJSON());
      expect(rendered).toContain('main-site');
    } finally {
      root?.unmount();
    }
  });
});
