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
    billingSummary,
    debugTrace,
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
    billingSummary,
    debugTrace,
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
        billingSummary: {
          quote: {
            amount: 0.0088,
            unit: 'currency',
            currency: 'USD',
            source: 'provider_catalog',
            sourceId: null,
            estimateLevel: 'exact',
            planFingerprint: 'plan:test',
          },
          cacheReadTokens: 227072,
          cacheCreationTokens: 1024,
        },
        debugTrace: {
          id: 701,
          createdAt: '2026-03-28 18:00:00',
          requestedModel: 'gpt-4o',
          downstreamPath: '/v1/responses',
          finalStatus: 'failed',
          finalHttpStatus: 502,
          finalUpstreamPath: '/responses',
          clientKind: 'codex',
          sessionId: 'sess-debug-1',
          selectedExecutionAttemptId: 'attempt:test:101',
        },
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

function buildProxyDebugTraceDetail(options?: { includeBodies?: boolean; attemptId?: number }) {
  const includeBodies = options?.includeBodies === true;
  const includeTraceBodies = includeBodies && options?.attemptId == null;
  const includeAttemptBodies = includeBodies && (options?.attemptId == null || options?.attemptId === 9001);
  return {
    trace: {
      id: 701,
      requestedModel: 'gpt-4o',
      sessionId: 'sess-debug-1',
      downstreamPath: '/v1/responses',
      finalStatus: 'failed',
      finalHttpStatus: 502,
      finalUpstreamPath: '/responses',
      clientKind: 'codex',
      selectedExecutionAttemptId: 'attempt:test:101',
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
      finalResponseHeadersJson: '{\n  "x-request-id": "req_final"\n}',
      runtimeTraceJson: '{\n  "context": { "downstreamFormat": "openai/responses" }\n}',
      ...(includeTraceBodies ? {
        requestBodyJson: '{\n  "model": "gpt-4o"\n}',
        finalResponseBodyJson: '{\n  "error": "bad gateway"\n}',
      } : {}),
    },
    attempts: [
      {
        id: 9001,
        attemptIndex: 0,
        executionAttemptId: 'attempt:test:101',
        endpoint: 'openai/responses',
        endpointType: 'openai.responses',
        requestPath: '/v1/responses',
        targetUrl: 'https://upstream.example.com/responses',
        runtimeExecutor: 'default',
        requestHeadersJson: '{\n  "content-type": "application/json"\n}',
        responseStatus: 502,
        responseHeadersJson: '{\n  "x-request-id": "req_1"\n}',
        rawErrorText: 'bad gateway',
        recoverApplied: true,
        downgradeDecision: false,
        downgradeReason: null,
        ...(includeAttemptBodies ? {
          requestBodyJson: '{\n  "model": "gpt-4o"\n}',
          responseBodyJson: '{\n  "error": "bad gateway"\n}',
          memoryWriteJson: '{\n  "blocked": ["responses"]\n}',
        } : {}),
      },
    ],
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
        decision: {
          selectedAlternativeId: 'choice:primary',
          selectors: [{
            selectorId: 'selector:weighted',
            nodeId: 'selector:gpt-4o',
            mode: 'weighted',
            policySource: 'inline',
            policyId: 'policy:cost-aware',
            policyKind: 'builtin',
            selectionMode: 'weighted',
            selectedChoiceId: 'choice:primary',
            candidates: [
              {
                choiceId: 'choice:primary',
                endpointId: 'endpoint:gpt-4o',
                executionTargetIds: [12],
                targets: [{
                  executionTargetId: 12,
                  executionAttemptId: 'attempt:gpt-4o:primary',
                  upstreamModel: 'gpt-4o',
                  credential: {
                    site: { id: 2, name: 'main-site', url: 'https://main-site.example.com', platform: 'new-api' },
                    account: { id: 3, username: 'tester', status: 'active' },
                    token: { id: 8, name: 'Premium Token', tokenGroup: 'premium', enabled: true, valueStatus: 'ready', source: 'manual' },
                  },
                }],
                enabled: true,
                eligible: true,
                selected: true,
                weight: 80,
                contribution: 0.9,
                order: 0,
                score: 72,
              },
              {
                choiceId: 'choice:secondary',
                endpointId: 'endpoint:gpt-4o:secondary',
                executionTargetIds: [15],
                targets: [{
                  executionTargetId: 15,
                  executionAttemptId: 'attempt:gpt-4o:secondary',
                  upstreamModel: 'gpt-4o',
                  credential: {
                    site: { id: 4, name: 'backup-site', url: 'https://backup-site.example.com', platform: 'one-hub' },
                    account: { id: 5, username: 'backup-user', status: 'active' },
                    token: { id: 9, name: 'Backup Token', tokenGroup: 'fallback', enabled: true, valueStatus: 'ready', source: 'manual' },
                  },
                }],
                enabled: true,
                eligible: false,
                selected: false,
                weight: 20,
                contribution: 0.4,
                order: 1,
                score: 8,
              },
            ],
          }],
          fallbackStages: [{
            fallbackId: 'fallback:gpt-4o',
            stageId: 'stage:secondary',
            stageIndex: 1,
            nodeId: 'selector:gpt-4o',
          }],
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
          affinity: {
            mode: 'pool',
            selectedPoolId: 'pool:fallback',
            selectedExecutionTargetId: 12,
            primaryPoolId: 'pool:primary',
            primaryExecutionTargetId: 15,
            primaryRevision: 2,
            fallback: true,
            promoteOnSuccess: true,
            bindingOutcome: 'promoted',
            resultingPrimaryPoolId: 'pool:fallback',
            resultingPrimaryExecutionTargetId: 12,
            resultingRevision: 3,
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
    apiMock.getProxyDebugTraceDetail.mockResolvedValue(buildProxyDebugTraceDetail());
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
      expect(text).toContain('客户端应用');
      expect(text).toContain('客户端配置档');
      expect(text).toContain('Chat Completions');
      expect(text).toContain('/v1/chat/completions');
      expect(text).toContain('缓存读227,072');
      expect(text).toContain('缓存写1,024');
      expect(text).toContain('USD 0.0088 · 精确');
      expect(text).toContain('流式');
      expect(text).toContain('首字延迟');
      expect(text).toContain('80ms');
    } finally {
      await act(async () => {
        root?.unmount();
      });
    }
  });

  it('integrates matching debug evidence and session identity into the request row', async () => {
    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider><ProxyLogs /></ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const row = root.root.find((node) => node.type === 'tr' && node.props['data-testid'] === 'proxy-log-row-request:test:101');
      expect(collectText(row)).toContain('sess-debug-1');
      expect(row.findAll((node) => node.props['aria-label'] === '已采集调试信息')).toHaveLength(1);
      expect(root.root.findAll((node) => node.props['data-debug-trace-panel-body'] === true)).toHaveLength(0);
    } finally {
      await act(async () => root?.unmount());
    }
  });

  it('groups scheduler counters with their target and labels them as selection-time state', async () => {
    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider><ProxyLogs /></ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const row = root.root.find((node) => (
        node.type === 'tr' && node.props['data-testid'] === 'proxy-log-row-request:test:101'
      ));
      await act(async () => row.props.onClick());
      await flushMicrotasks();

      const targetNode = root.root.find((node) => (
        typeof node.props.className === 'string'
        && node.props.className.includes('proxy-log-decision-node-token')
      ));
      const targetText = collectText(targetNode);
      expect(targetText).toContain('本次执行目标');
      expect(targetText).toContain('main-site · tester');
      expect(targetText).toContain('模型调用 KeyPremium Token');
      expect(targetText).not.toContain('站点main-site');
      expect(targetText).not.toContain('账号tester');
      expect(targetText).not.toContain('实际模型gpt-4o');
      expect(targetText).not.toContain('ready');
      expect(targetText).toContain('选择前状态');
      expect(targetText).toContain('成功 11');
      expect(targetText).toContain('失败 2');
      const selectionState = targetNode.find((node) => (
        node.props['aria-label'] === '选择前状态'
      ));
      expect(selectionState.props['aria-description']).toBe('路由作出选择前读取，不含本次结果');

      const detachedStats = root.root.find((node) => (
        node.props.className === 'proxy-log-decision-stats'
      ));
      expect(collectText(detachedStats)).not.toContain('成功 11');
      expect(collectText(detachedStats)).not.toContain('失败 2');
    } finally {
      await act(async () => root?.unmount());
    }
  });

  it('refreshes an expanded request detail when later attempts arrive', async () => {
    const initialRequest = {
      ...buildProxyRequestFixture({
        id: 160,
        createdAt: '2026-08-17 14:34:17',
        modelRequested: 'gpt-5.6-terra',
        modelActual: 'gpt-5.6-terra',
        status: 'retried',
        httpStatus: 403,
        latencyMs: 800,
        username: 'Krill',
        siteName: 'Krill Coding',
        tokenName: 'default',
        executionAttemptId: 'attempt:krill',
      }),
      status: 'running',
      httpStatus: null,
      completedAt: null,
      finalExecutionAttemptId: null,
      debugTrace: {
        id: 7160,
        updatedAt: '2026-08-17 14:34:17',
        selectedExecutionAttemptId: 'attempt:krill',
        finalStatus: null,
        finalHttpStatus: null,
      },
    };

    const completedRequestBase = buildProxyRequestFixture({
      id: 161,
      createdAt: '2026-08-17 14:34:57',
      modelRequested: 'gpt-5.6-terra',
      modelActual: 'gpt-5.6-terra',
      status: 'success',
      httpStatus: 200,
      latencyMs: 38_000,
      username: 'a1208733578',
      siteName: '猫肥',
      tokenName: 'metapi Sub',
      executionAttemptId: 'attempt:cat-sub',
    });
    const completedRequest = {
      ...completedRequestBase,
      id: initialRequest.id,
      startedAt: initialRequest.startedAt,
      attempts: [
        initialRequest.attempts[0],
        completedRequestBase.attempts[0],
      ],
      decisionSnapshot: {
        source: 'snapshot',
        capturedAt: '2026-08-17 14:34:57',
        request: { downstreamPath: '/v1/responses', stream: true },
        compiledRuntime: {
          runtimeArtifactId: 'runtime-artifact:retry-success',
          bundleHash: 'bundle:retry-success',
        },
        match: {
          requestedModel: 'gpt-5.6-terra',
          actualModel: 'gpt-5.6-terra',
          planId: 'entry:gpt-5.6-terra',
          entryId: 'entry:gpt-5.6-terra',
          publicModelName: 'gpt-5.6-terra',
          terminalKind: 'endpoint',
        },
        metadata: {
          graph: null,
          plan: null,
          selection: null,
          endpoint: null,
          executionAttempt: null,
        },
        decision: null,
        endpoint: {
          endpointId: 'endpoint:cat-sub',
          executionTargetId: 589,
          compatibilityPolicy: null,
        },
        executionAttempt: {
          executionAttemptId: 'attempt:cat-sub',
          model: 'gpt-5.6-terra',
          executionTargetId: 589,
          accountId: 24,
          tokenId: 22,
          siteId: 29,
          credential: {
            site: { id: 29, name: '猫肥', url: 'https://example.test', platform: 'sub2api' },
            account: { id: 24, username: 'a1208733578', status: 'active' },
            token: { id: 22, name: 'metapi Sub', tokenGroup: '32', enabled: true, valueStatus: 'ready', source: 'sync' },
          },
          affinity: null,
        },
        requestUsage: { inputBytes: 128, maxOutputTokens: null },
        state: {
          failureOverlay: {
            disabledExecutionAttemptIds: ['attempt:krill'],
            disabledExecutionTargetIds: [1293],
          },
          executionAttemptState: null,
        },
        filters: { endpointPreference: 'responses', postBuild: null },
        syntheticResponse: null,
      },
      debugTrace: {
        ...initialRequest.debugTrace,
        updatedAt: '2026-08-17 14:34:57',
        selectedExecutionAttemptId: 'attempt:cat-sub',
        finalStatus: 'success',
        finalHttpStatus: 200,
        finalUpstreamPath: '/v1/responses',
      },
    };

    apiMock.getProxyLogs
      .mockResolvedValueOnce(buildListResponse({ items: [initialRequest] }))
      .mockResolvedValue(buildListResponse({ items: [completedRequest] }));
    apiMock.getProxyRequestLogDetail
      .mockResolvedValueOnce(initialRequest)
      .mockResolvedValue(completedRequest);

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider><ProxyLogs /></ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const row = root.root.find((node) => (
        node.type === 'tr'
        && node.props['data-testid'] === `proxy-log-row-${initialRequest.id}`
      ));
      await act(async () => row.props.onClick());
      await flushMicrotasks();
      expect(collectText(root.root)).toContain('Krill Coding');
      expect(apiMock.getProxyRequestLogDetail).toHaveBeenCalledTimes(1);
      expect(apiMock.getProxyDebugTraceDetail).toHaveBeenCalledTimes(1);

      const refresh = root.root.find((node) => (
        node.type === 'button' && collectText(node) === '刷新'
      ));
      await act(async () => refresh.props.onClick());
      await flushMicrotasks();
      await flushMicrotasks();

      const refreshedText = collectText(root.root);
      expect(apiMock.getProxyRequestLogDetail).toHaveBeenCalledTimes(2);
      expect(apiMock.getProxyDebugTraceDetail).toHaveBeenCalledTimes(2);
      expect(refreshedText).toContain('执行尝试 1');
      expect(refreshedText).toContain('执行尝试 2');
      expect(refreshedText).toContain('Krill Coding');
      expect(refreshedText).toContain('猫肥');
      expect(refreshedText).toContain('a1208733578');
      expect(refreshedText).toContain('metapi Sub');
      expect(refreshedText).toContain('路由结果');
      expect(refreshedText).toContain('关联尝试 2');
      const firstAttempt = root.root.find((node) => (
        node.props['data-testid'] === 'proxy-log-execution-attempt-160'
      ));
      const secondAttempt = root.root.find((node) => (
        node.props['data-testid'] === 'proxy-log-execution-attempt-161'
      ));
      expect(collectText(firstAttempt)).not.toContain('已选目标');
      expect(collectText(secondAttempt)).toContain('已选目标');
    } finally {
      await act(async () => root?.unmount());
    }
  });

  it('edits debug capture settings without loading a separate trace feed', async () => {
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
      expect(root.root.findAll((node) => node.props['data-debug-trace-panel-body'] === true)).toHaveLength(0);

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
      await act(async () => root?.unmount());
    }
  });

  it('loads request-linked diagnostic evidence on expand and opens only raw payloads in a viewer', async () => {
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

      const requestRow = root.root.find((node) => (
        node.type === 'tr'
        && node.props['data-testid'] === 'proxy-log-row-request:test:101'
      ));

      await act(async () => {
        requestRow.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.getProxyDebugTraceDetail).toHaveBeenCalledWith(701);
      expect(collectText(root.root)).toContain('调试详情');
      expect(collectText(root.root)).toContain('原始下游请求头');
      expect(collectText(root.root)).toContain('最终响应头');
      expect(collectText(root.root)).toContain('执行尝试');
      expect(collectText(root.root)).toContain('1 次上游调用');
      expect(collectText(root.root)).not.toContain('查看详情');
      expect(collectText(root.root)).not.toContain('Bearer demo');
      expect(root.root.findAll((node) => node.props['aria-label'] === '选择详情').length).toBeGreaterThan(0);

      const expandAttemptButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && node.props['aria-label'] === '展开 上游调用 1'
      ));

      await act(async () => {
        expandAttemptButton.props.onClick({ defaultPrevented: false });
      });
      await flushMicrotasks();

      const attemptText = collectText(root.root);
      expect(attemptText).toContain('OpenAI Responses');
      expect(attemptText).toContain('openai.responses');
      expect(attemptText).toContain('上游交换数据');
      expect(attemptText).toContain('发送到上游');
      expect(attemptText).toContain('上游返回');
      expect(attemptText).toContain('请求头');
      expect(attemptText).toContain('响应体');
      expect(attemptText).not.toContain('请求/响应头');
      expect(attemptText).toContain('下游交换数据');
      expect(attemptText.match(/OpenAI Responses/g)?.length).toBe(1);

      const expandHeadersButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && node.props['aria-label'] === '展开 原始下游请求头'
      ));

      await act(async () => {
        expandHeadersButton.props.onClick({ defaultPrevented: false });
      });
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('Bearer demo');

      const viewRawButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && node.props['aria-label'] === '查看原始下游请求头原始内容'
      ));

      await act(async () => {
        viewRawButton.props.onClick({ stopPropagation: () => undefined, preventDefault: () => undefined });
      });
      await flushMicrotasks();

      expect(root.root.findAll((node) => node.props.role === 'dialog').length).toBeGreaterThan(0);
      expect(collectText(root.root)).toContain('原始下游请求头');

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
      await act(async () => root?.unmount());
    }
  });

  it('loads large trace bodies only after a body disclosure is opened', async () => {
    apiMock.getProxyDebugTraceDetail.mockImplementation((_id: number, options?: { includeBodies?: boolean; attemptId?: number }) => (
      Promise.resolve(buildProxyDebugTraceDetail({
        includeBodies: options?.includeBodies === true,
        attemptId: options?.attemptId,
      }))
    ));
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider><ProxyLogs /></ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const requestRow = root.root.find((node) => (
        node.type === 'tr' && node.props['data-testid'] === 'proxy-log-row-request:test:101'
      ));
      await act(async () => requestRow.props.onClick());
      await flushMicrotasks();

      expect(apiMock.getProxyDebugTraceDetail).toHaveBeenCalledTimes(1);
      expect(apiMock.getProxyDebugTraceDetail).toHaveBeenLastCalledWith(701);

      const expandAttemptButton = root.root.find((node) => (
        node.type === 'button' && node.props['aria-label'] === '展开 上游调用 1'
      ));
      await act(async () => expandAttemptButton.props.onClick({ defaultPrevented: false }));

      const expandRequestBodyButton = root.root.find((node) => (
        node.type === 'button' && node.props['aria-label'] === '展开 请求体'
      ));
      await act(async () => expandRequestBodyButton.props.onClick({ defaultPrevented: false }));
      await flushMicrotasks();

      expect(apiMock.getProxyDebugTraceDetail).toHaveBeenCalledTimes(2);
      expect(apiMock.getProxyDebugTraceDetail).toHaveBeenLastCalledWith(701, {
        includeBodies: true,
        attemptId: 9001,
      });
      expect(collectText(root.root)).toContain('"model": "gpt-4o"');
    } finally {
      await act(async () => root?.unmount());
    }
  });

  it('shows a recorded-empty state after runtime updates finish loading', async () => {
    apiMock.getProxyDebugTraceDetail.mockImplementation((_id: number, options?: { includeBodies?: boolean; attemptId?: number }) => {
      const detail = buildProxyDebugTraceDetail({
        includeBodies: options?.includeBodies === true,
        attemptId: options?.attemptId,
      });
      if (options?.includeBodies && options?.attemptId === 9001) {
        delete detail.attempts[0].memoryWriteJson;
      }
      return Promise.resolve(detail);
    });
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider><ProxyLogs /></ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const requestRow = root.root.find((node) => (
        node.type === 'tr' && node.props['data-testid'] === 'proxy-log-row-request:test:101'
      ));
      await act(async () => requestRow.props.onClick());
      await flushMicrotasks();

      const expandAttemptButton = root.root.find((node) => (
        node.type === 'button' && node.props['aria-label'] === '展开 上游调用 1'
      ));
      await act(async () => expandAttemptButton.props.onClick({ defaultPrevented: false }));

      const expandRuntimeUpdateButton = root.root.find((node) => (
        node.type === 'button' && node.props['aria-label'] === '展开 运行时状态更新'
      ));
      await act(async () => expandRuntimeUpdateButton.props.onClick({ defaultPrevented: false }));
      await flushMicrotasks();

      expect(apiMock.getProxyDebugTraceDetail).toHaveBeenLastCalledWith(701, {
        includeBodies: true,
        attemptId: 9001,
      });
      let runtimeUpdateDisclosure: ReactTestInstance | null = expandRuntimeUpdateButton;
      while (
        runtimeUpdateDisclosure
        && runtimeUpdateDisclosure.props.className !== 'proxy-log-disclosure'
      ) {
        runtimeUpdateDisclosure = runtimeUpdateDisclosure.parent;
      }
      expect(runtimeUpdateDisclosure).not.toBeNull();
      expect(collectText(runtimeUpdateDisclosure!)).toContain('本次执行未更新端点运行时状态');
      expect(collectText(runtimeUpdateDisclosure!)).not.toContain('展开后加载原始内容');
    } finally {
      await act(async () => root?.unmount());
    }
  });

  it('nests each captured upstream exchange under its owning graph execution attempt', async () => {
    const firstAttempt = buildProxyRequestFixture({
      id: 301,
      createdAt: '2026-03-09 18:00:00',
      modelRequested: 'gpt-4o',
      status: 'failed',
      latencyMs: 180,
      executionAttemptId: 'attempt:primary',
      siteName: 'primary-site',
      username: 'primary-user',
      tokenName: 'primary-key',
    });
    const secondAttempt = {
      ...firstAttempt.attempts[0],
      id: 302,
      status: 'success',
      httpStatus: 200,
      executionAttemptId: 'attempt:fallback',
      siteName: 'primary-site',
      username: 'primary-user',
      tokenName: 'fallback-key',
    };
    const request = {
      ...firstAttempt,
      status: 'success',
      httpStatus: 200,
      finalExecutionAttemptId: 'attempt:fallback',
      attempts: [firstAttempt.attempts[0], secondAttempt],
      debugTrace: {
        id: 702,
        requestId: firstAttempt.id,
        createdAt: '2026-03-09 18:00:00',
        downstreamPath: '/v1/responses',
        selectedExecutionAttemptId: 'attempt:fallback',
        finalStatus: 'success',
        finalHttpStatus: 200,
        finalUpstreamPath: '/v1/chat/completions',
      },
    };
    apiMock.getProxyLogs.mockResolvedValue(buildListResponse({ items: [request] }));
    apiMock.getProxyRequestLogDetail.mockResolvedValue(request);
    apiMock.getProxyDebugTraceDetail.mockResolvedValue({
      trace: {
        id: 702,
        selectedExecutionAttemptId: 'attempt:fallback',
      },
      attempts: [
        {
          id: 9101,
          attemptIndex: 0,
          executionAttemptId: 'attempt:primary',
          endpoint: 'responses',
          endpointType: 'openai.responses',
          requestPath: '/v1/responses',
          targetUrl: 'https://primary.example/v1/responses',
          runtimeExecutor: 'default',
          responseStatus: 503,
          rawErrorText: 'primary unavailable',
        },
        {
          id: 9102,
          attemptIndex: 1,
          executionAttemptId: 'attempt:fallback',
          endpoint: 'chat',
          endpointType: 'openai.chat_completions',
          requestPath: '/v1/chat/completions',
          targetUrl: 'https://fallback.example/v1/chat/completions',
          runtimeExecutor: 'default',
          responseStatus: 200,
        },
      ],
    });
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider><ProxyLogs /></ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const requestRow = root.root.find((node) => (
        node.type === 'tr' && node.props['data-testid'] === 'proxy-log-row-request:test:301'
      ));
      await act(async () => requestRow.props.onClick());
      await flushMicrotasks();

      const primaryAttempt = root.root.find((node) => node.props['data-testid'] === 'proxy-log-execution-attempt-301');
      const fallbackAttempt = root.root.find((node) => node.props['data-testid'] === 'proxy-log-execution-attempt-302');
      expect(collectText(primaryAttempt)).toContain('OpenAI Responses');
      expect(collectText(primaryAttempt)).not.toContain('OpenAI Chat Completions');
      expect(collectText(fallbackAttempt)).toContain('OpenAI Chat Completions');
      expect(collectText(fallbackAttempt)).not.toContain('OpenAI Responses');
      expect(collectText(primaryAttempt)).toContain('1 次上游调用');
      expect(collectText(fallbackAttempt)).toContain('1 次上游调用');
      expect(collectText(primaryAttempt)).toContain('primary-site · primary-user');
      expect(collectText(primaryAttempt)).toContain('模型调用 Keyprimary-key');
      expect(collectText(fallbackAttempt)).toContain('primary-site · primary-user');
      expect(collectText(fallbackAttempt)).toContain('模型调用 Keyfallback-key');
    } finally {
      await act(async () => root?.unmount());
    }
  });

  it('explains a site endpoint cooldown when an attempt has no upstream exchange', async () => {
    const request = buildProxyRequestFixture({
      id: 303,
      createdAt: '2026-03-09 18:00:00',
      modelRequested: 'gpt-4o',
      status: 'failed',
      executionAttemptId: 'attempt:cooldown',
      siteName: 'cooldown-site',
      username: 'cooldown-account',
      tokenName: 'primary-key',
      debugTrace: {
        id: 703,
        requestId: 'request:test:303',
        createdAt: '2026-03-09 18:00:00',
        downstreamPath: '/v1/chat/completions',
        finalStatus: 'failed',
      },
    });
    apiMock.getProxyLogs.mockResolvedValue(buildListResponse({ items: [request] }));
    apiMock.getProxyRequestLogDetail.mockResolvedValue(request);
    apiMock.getProxyDebugTraceDetail.mockResolvedValue({
      trace: {
        id: 703,
        selectedExecutionAttemptId: 'attempt:cooldown',
        runtimeTraceJson: JSON.stringify({
          preflightOutcomes: [{
            executionAttemptId: 'attempt:cooldown',
            kind: 'site_api_endpoint_pool_unavailable',
            reason: 'all_endpoints_cooling_down',
            configuredEndpointCount: 1,
            enabledEndpointCount: 1,
            coolingDownEndpointCount: 1,
            nextAvailableAt: '2026-03-09T18:05:00.000Z',
            endpointFailures: [{
              endpointId: 21,
              url: 'https://api-cooling.example.com',
              enabled: true,
              cooldownUntil: '2026-03-09T18:05:00.000Z',
              lastFailureReason: 'HTTP 502: fetch failed',
            }],
          }],
        }),
      },
      attempts: [],
    });
    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider><ProxyLogs /></ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();
      const requestRow = root.root.find((node) => (
        node.type === 'tr' && node.props['data-testid'] === 'proxy-log-row-request:test:303'
      ));
      await act(async () => requestRow.props.onClick());
      await flushMicrotasks();
      const attempt = root.root.find((node) => node.props['data-testid'] === 'proxy-log-execution-attempt-303');
      expect(collectText(attempt)).toContain('请求未发送上游');
      expect(collectText(attempt)).toContain('全部 1 个 API 地址处于冷却退避中');
      expect(collectText(attempt)).toContain('冷却至');
      expect(collectText(attempt)).toContain('HTTP 502: fetch failed');
      expect(collectText(attempt)).toContain('https://api-cooling.example.com');
      expect(collectText(attempt)).not.toContain('上游交换数据');
    } finally {
      await act(async () => root?.unmount());
    }
  });

  it('keeps trace loading failures inline and retries without reopening the request', async () => {
    apiMock.getProxyDebugTraceDetail.mockRejectedValueOnce(new Error('trace temporarily unavailable'));
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider><ProxyLogs /></ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const requestRow = root.root.find((node) => (
        node.type === 'tr' && node.props['data-testid'] === 'proxy-log-row-request:test:101'
      ));
      await act(async () => requestRow.props.onClick());
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('trace temporarily unavailable');
      const retryButton = root.root.find((node) => (
        node.type === 'button' && collectText(node).includes('重试诊断加载')
      ));
      await act(async () => retryButton.props.onClick());
      await flushMicrotasks();

      expect(apiMock.getProxyDebugTraceDetail).toHaveBeenCalledTimes(2);
      expect(collectText(root.root)).toContain('调试详情');
      expect(collectText(root.root)).not.toContain('trace temporarily unavailable');
    } finally {
      await act(async () => root?.unmount());
    }
  });

  it('does not render an empty diagnostic section when a request has no linked trace', async () => {
    const requestWithoutTrace = buildProxyRequestFixture({
      id: 202,
      createdAt: '2026-03-09 17:00:00',
      modelRequested: 'gpt-4o-mini',
      status: 'success',
      latencyMs: 75,
      debugTrace: null,
    });
    apiMock.getProxyLogs.mockResolvedValue(buildListResponse({ items: [requestWithoutTrace] }));
    apiMock.getProxyRequestLogDetail.mockResolvedValue(requestWithoutTrace);
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider><ProxyLogs /></ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const requestRow = root.root.find((node) => (
        node.type === 'tr' && node.props['data-testid'] === 'proxy-log-row-request:test:202'
      ));
      await act(async () => requestRow.props.onClick());
      await flushMicrotasks();

      expect(apiMock.getProxyDebugTraceDetail).not.toHaveBeenCalled();
      expect(root.root.findAll((node) => String(node.props['data-testid'] || '').startsWith('proxy-log-debug-evidence-'))).toHaveLength(0);
    } finally {
      await act(async () => root?.unmount());
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

  it('shows a rewritten upstream model only once in the desktop overview row', async () => {
    apiMock.getProxyLogs.mockResolvedValue(buildListResponse({
      items: [
        buildProxyRequestFixture({
          id: 303,
          createdAt: '2026-03-09 16:00:00',
          modelRequested: 'gpt-4o',
          modelActual: 'gpt-4o-mini',
          status: 'success',
          latencyMs: 120,
          username: 'tester',
          siteName: 'main-site',
          tokenName: 'site-key-main',
        }),
      ],
      total: 1,
    }));
    let root!: WebTestRenderer;

    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider><ProxyLogs /></ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const row = root.root.find((node) => (
        node.type === 'tr' && node.props['data-testid'] === 'proxy-log-row-request:test:303'
      ));
      expect(collectText(row).match(/gpt-4o-mini/g)).toHaveLength(1);
    } finally {
      await act(async () => root?.unmount());
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
          tokenName: 'site-key-main',
          tokenGroup: 'production',
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
      expect(rowText).toContain('tester');
      expect(rowText).toContain('site-key-main');
      expect(rowText).toContain('production');
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
      expect(expandedText).toContain('选择前状态');
      expect(expandedText).toContain('plan:gpt-4o');
      expect(expandedText).toContain('endpoint:gpt-4o');
      expect(expandedText).toContain('Premium Token');
      expect(expandedText).toContain('attempt:gpt-4o:primary');
      expect(expandedText).not.toContain('dispatcher:gpt-4o');
      expect(expandedText).not.toContain('arg:gpt-4o');
      expect(expandedText).not.toContain('entry:legacy');
      expect(expandedText).toContain('执行尝试');
      expect(expandedText).toContain('公开模型');
      expect(expandedText).toContain('Premium Token');
      expect(expandedText).toContain('main-site');
      const usageDisclosure = root.root.find((node) => (
        node.type === 'button' && node.props['aria-label'] === '展开 用量与费用'
      ));
      await act(async () => usageDisclosure.props.onClick({ defaultPrevented: false }));
      const usageText = collectText(root.root);
      expect(usageText).toContain('历史运行表现');
      expect(usageText).toContain('近 30 天');
      expect(usageText).toContain('87.5%');
      expect(usageText).toContain('230ms');
      expect(usageText).toContain('调用');
      expect(usageText).toContain('120');
      expect(usageText).not.toContain('105 / 120');

      const selectionSteps = root.root.find((node) => (
        node.type === 'button' && node.props['aria-label'] === '选择详情'
      ));
      await act(async () => {
        selectionSteps.props.onClick({ defaultPrevented: false });
      });
      const decisionText = collectText(root.root);
      expect(decisionText).toContain('policy:cost-aware');
      expect(decisionText).toContain('选择步骤 1');
      expect(decisionText).toContain('main-site');
      expect(decisionText).toContain('tester · Premium Token');
      expect(decisionText).toContain('backup-site');
      expect(decisionText).toContain('backup-user · Backup Token');
      expect(decisionText).toContain('不可用');
      expect(decisionText).toContain('权重 80 × 贡献 0.9');
      expect(decisionText).toContain('stage:secondary');
      expect(decisionText).toContain('已提升为 Primary');
      expect(decisionText).toContain('pool:fallback');
      expect(decisionText).not.toContain('pages.proxyLogs.');
      expect(decisionText).not.toContain('components.modelRouteFlow.');

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

  it('renders request-level unavailable routing evidence when no attempt was executed', async () => {
    apiMock.getProxyRequestLogDetail.mockResolvedValue(buildProxyRequestFixture({
      id: 101,
      createdAt: '2026-03-09 16:00:00',
      modelRequested: 'gpt-unavailable',
      status: 'failure',
      errorMessage: '所有执行尝试均不可用，请稍后重试',
      decisionSnapshot: {
        source: 'snapshot',
        capturedAt: '2026-03-09 15:56:30',
        request: { downstreamPath: '/v1/responses', stream: true },
        compiledRuntime: {
          runtimeArtifactId: 'runtime-artifact-unavailable',
          bundleHash: 'bundle-unavailable',
          program: null,
        },
        match: {
          requestedModel: 'gpt-unavailable',
          actualModel: null,
          planId: 'plan:gpt-unavailable',
          entryId: 'entry:gpt-unavailable',
          publicModelName: 'gpt-unavailable',
          terminalKind: 'endpoint',
        },
        metadata: {
          graph: null,
          plan: null,
          selection: null,
          endpoint: null,
          executionAttempt: null,
        },
        decision: {
          selectedAlternativeId: 'choice:cooldown',
          selectors: [],
          fallbackStages: [],
          unavailable: {
            reason: 'execution_attempts_exhausted',
            rejectedAttempts: [
              { executionAttemptId: 'program:macro:route:managed:19a74079-3e2e-4753-9a5c-c9c5e80ce0ef:entry:candidate:macro:route:managed:19a74079-3e2e-4753-9a5c-c9c5e80ce0ef:edge:candidate:fallback-stage:managed:5625f9e5-cec1-4971-baf5-32e06ce5418d:route-endpoint:managed:8631ed20-133d-4cc8-ac3a-7ce238614d26', executionTargetId: 12, reason: 'cooldown' },
              { executionAttemptId: 'program:macro:route:managed:19a74079-3e2e-4753-9a5c-c9c5e80ce0ef:entry:candidate:macro:route:managed:19a74079-3e2e-4753-9a5c-c9c5e80ce0ef:edge:candidate:fallback-stage:managed:5625f9e5-cec1-4971-baf5-32e06ce5418d:route-endpoint:managed:8631ed20-133d-4cc8-ac3a-7ce238614d11', executionTargetId: 15, reason: 'missing_token' },
            ],
          },
        },
        endpoint: null,
        executionAttempt: null,
        requestUsage: { inputBytes: 64, maxOutputTokens: null },
        state: {
          failureOverlay: {
            disabledExecutionAttemptIds: ['attempt:cooldown', 'attempt:no-key'],
            disabledExecutionTargetIds: [12, 15],
          },
          executionAttemptState: null,
        },
        filters: { endpointPreference: 'responses', postBuild: {} },
        syntheticResponse: null,
      },
    }));

    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/logs']}>
            <ToastProvider><ProxyLogs /></ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();
      const row = root.root.find((node) => (
        node.type === 'tr' && node.props['data-testid'] === 'proxy-log-row-request:test:101'
      ));
      await act(async () => row.props.onClick());
      await flushMicrotasks();

      expect(collectText(root.root)).not.toContain('未记录路由运行快照');
      const selectionSteps = root.root.find((node) => (
        node.type === 'button' && node.props['aria-label'] === '选择详情'
      ));
      await act(async () => selectionSteps.props.onClick({ defaultPrevented: false }));
      const text = collectText(root.root);
      expect(text).toContain('候选不可用明细');
      expect(text).toContain('2 个候选不可用');
      expect(text).toContain('失败退避中');
      expect(text).toContain('缺少可用模型调用 Key');
      expect(text).toContain('执行尝试');
      expect(text).not.toContain('program:macro:route:managed:19a74079-3e2e-4753-9a5c-c9c5e80ce0ef');
      expect(root.root.findAll((node) => node.props['data-full-value']?.endsWith('8631ed20-133d-4cc8-ac3a-7ce238614d26')).length).toBe(1);
      expect(text).not.toContain('#12');
      expect(text).not.toContain('#15');
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
