import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_DOWNSTREAM_ROUTING_POLICY } from '../../services/downstreamPolicyTypes.js';
import {
  getCacheAffinityObservation,
  resetCacheAffinityObservationsForTest,
} from '../../services/cacheAffinityObservationService.js';

const selectRouteRuntimeExecutionAttemptMock = vi.fn();
const recordRouteRuntimeExecutionAttemptStartedMock = vi.fn();
const recordRouteRuntimeExecutionAttemptFailureMock = vi.fn();
const recordRouteRuntimeExecutionAttemptSuccessMock = vi.fn();
const composeProxyLogMessageMock = vi.fn();
const formatUtcSqlDateTimeMock = vi.fn();
const insertProxyLogMock = vi.fn();
const resolveTargetProxyUrlMock = vi.fn();
const withSiteRecordProxyRequestInitMock = vi.fn();
const dispatchRuntimeRequestMock = vi.fn();
const reportProxyAllFailedMock = vi.fn();
const reportTokenExpiredMock = vi.fn();
const isTokenExpiredErrorMock = vi.fn();
const shouldRetryProxyRequestMock = vi.fn();
const recordOauthQuotaHeadersSnapshotMock = vi.fn();
const recordOauthQuotaResetHintMock = vi.fn();
const resolveProxyUsageWithSelfLogFallbackMock = vi.fn();
const resolveProxyLogBillingMock = vi.fn();
const refreshOauthAccessTokenSingleflightMock = vi.fn();
const getStickyTargetIdMock = vi.fn();
const bindStickyTargetMock = vi.fn();
const clearStickyTargetMock = vi.fn();
const acquireTargetLeaseMock = vi.fn();
const buildStickySessionKeyMock = vi.fn();
let consoleWarnMock: ReturnType<typeof vi.spyOn>;
let consoleErrorMock: ReturnType<typeof vi.spyOn>;

const runtimeIdentity = {
  executionAttemptId: 'ea_11',
  routeEntrypointId: 'entry:gpt-5.2',
  runtimeEndpointId: 'endpoint:gpt-5.2:upstream',
  runtimeArtifactId: 'runtime-artifact-42',
  executionTargetId: 11,
};

vi.mock('../../services/routeRuntimeExecutionService.js', () => ({
  createRouteRuntimeDecisionSession: vi.fn(),
  selectRouteRuntimeDecisionInSession: vi.fn(),
  previewRouteRuntimeDecisionInSession: vi.fn(),
  selectRouteRuntimeDecision: vi.fn(),
  previewRouteRuntimeDecision: vi.fn(),
  selectRouteRuntimeExecutionAttempt: (...args: unknown[]) => selectRouteRuntimeExecutionAttemptMock(...args),
  recordRouteRuntimeExecutionAttemptStarted: (...args: unknown[]) => recordRouteRuntimeExecutionAttemptStartedMock(...args),
  recordRouteRuntimeExecutionAttemptFailure: (...args: unknown[]) => recordRouteRuntimeExecutionAttemptFailureMock(...args),
  recordRouteRuntimeExecutionAttemptSuccess: (...args: unknown[]) => recordRouteRuntimeExecutionAttemptSuccessMock(...args),
}));

vi.mock('../../services/proxyTargetCoordinator.js', () => ({
  proxyTargetCoordinator: {
    getStickyTargetId: (...args: unknown[]) => getStickyTargetIdMock(...args),
    bindStickyTarget: (...args: unknown[]) => bindStickyTargetMock(...args),
    clearStickyTarget: (...args: unknown[]) => clearStickyTargetMock(...args),
    acquireTargetLease: (...args: unknown[]) => acquireTargetLeaseMock(...args),
    buildStickySessionKey: (...args: unknown[]) => buildStickySessionKeyMock(...args),
  },
}));

vi.mock('../../services/proxyLogMessage.js', () => ({
  composeProxyLogMessage: (...args: unknown[]) => composeProxyLogMessageMock(...args),
}));

vi.mock('../../services/localTimeService.js', () => ({
  formatUtcSqlDateTime: (...args: unknown[]) => formatUtcSqlDateTimeMock(...args),
}));

vi.mock('../../services/proxyLogStore.js', () => ({
  insertProxyLog: (...args: unknown[]) => insertProxyLogMock(...args),
}));

vi.mock('../../services/siteProxy.js', () => ({
  resolveChannelProxyUrl: (...args: unknown[]) => resolveTargetProxyUrlMock(...args),
  withSiteRecordProxyRequestInit: (...args: unknown[]) => withSiteRecordProxyRequestInitMock(...args),
}));

vi.mock('../../services/runtimeDispatch.js', () => ({
  dispatchRuntimeRequest: (...args: unknown[]) => dispatchRuntimeRequestMock(...args),
}));

vi.mock('../../services/alertService.js', () => ({
  reportProxyAllFailed: (...args: unknown[]) => reportProxyAllFailedMock(...args),
  reportTokenExpired: (...args: unknown[]) => reportTokenExpiredMock(...args),
}));

vi.mock('../../services/alertRules.js', () => ({
  isTokenExpiredError: (...args: unknown[]) => isTokenExpiredErrorMock(...args),
}));

vi.mock('../../services/proxyRetryPolicy.js', () => ({
  shouldRetryProxyRequest: (...args: unknown[]) => shouldRetryProxyRequestMock(...args),
  shouldAbortSameSiteEndpointFallback: () => false,
}));

vi.mock('../../services/oauth/quota.js', () => ({
  recordOauthQuotaHeadersSnapshot: (...args: unknown[]) => recordOauthQuotaHeadersSnapshotMock(...args),
  recordOauthQuotaResetHint: (...args: unknown[]) => recordOauthQuotaResetHintMock(...args),
}));

vi.mock('../../services/proxyUsageFallbackService.js', () => ({
  resolveProxyUsageWithSelfLogFallback: (...args: unknown[]) => resolveProxyUsageWithSelfLogFallbackMock(...args),
}));

vi.mock('../../services/proxyBilling.js', () => ({
  resolveProxyLogBilling: (...args: unknown[]) => resolveProxyLogBillingMock(...args),
}));

vi.mock('../../services/oauth/refreshSingleflight.js', () => ({
  refreshOauthAccessTokenSingleflight: (...args: unknown[]) => refreshOauthAccessTokenSingleflightMock(...args),
}));

describe('selectSurfaceExecutionAttempt', () => {
  beforeEach(() => {
    resetCacheAffinityObservationsForTest();
    selectRouteRuntimeExecutionAttemptMock.mockReset();
    recordRouteRuntimeExecutionAttemptStartedMock.mockReset();
    recordRouteRuntimeExecutionAttemptFailureMock.mockReset();
    recordRouteRuntimeExecutionAttemptSuccessMock.mockReset();
    composeProxyLogMessageMock.mockReset();
    formatUtcSqlDateTimeMock.mockReset();
    insertProxyLogMock.mockReset();
    resolveTargetProxyUrlMock.mockReset();
    withSiteRecordProxyRequestInitMock.mockReset();
    dispatchRuntimeRequestMock.mockReset();
    reportProxyAllFailedMock.mockReset();
    reportTokenExpiredMock.mockReset();
    isTokenExpiredErrorMock.mockReset();
    shouldRetryProxyRequestMock.mockReset();
    recordOauthQuotaHeadersSnapshotMock.mockReset();
    recordOauthQuotaResetHintMock.mockReset();
    resolveProxyUsageWithSelfLogFallbackMock.mockReset();
    resolveProxyLogBillingMock.mockReset();
    refreshOauthAccessTokenSingleflightMock.mockReset();
    getStickyTargetIdMock.mockReset();
    bindStickyTargetMock.mockReset();
    clearStickyTargetMock.mockReset();
    acquireTargetLeaseMock.mockReset();
    buildStickySessionKeyMock.mockReset();
    consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('delegates first-attempt selection to the compiled runtime executor', async () => {
    const selected = { target: { id: 11 } };
    selectRouteRuntimeExecutionAttemptMock.mockResolvedValueOnce(selected);

    const { selectSurfaceExecutionAttempt } = await import('./sharedProxyOrchestration.js');
    const result = await selectSurfaceExecutionAttempt({
      requestedModel: 'gpt-5.2',
      downstreamPolicy: EMPTY_DOWNSTREAM_ROUTING_POLICY,
      excludeTargetIds: [],
      retryCount: 0,
    });

    expect(result).toBe(selected);
    expect(selectRouteRuntimeExecutionAttemptMock).toHaveBeenCalledWith({
      requestedModel: 'gpt-5.2',
      downstreamPolicy: EMPTY_DOWNSTREAM_ROUTING_POLICY,
      retryCount: 0,
      stickyExecutionTargetId: null,
      forcedExecutionAttemptId: undefined,
      disabledExecutionTargetIds: [],
      disabledExecutionAttemptIds: undefined,
    });
  });

  it('passes failed execution targets to the compiled runtime executor on retries', async () => {
    const selected = { target: { id: 22 } };
    selectRouteRuntimeExecutionAttemptMock.mockResolvedValueOnce(selected);

    const { selectSurfaceExecutionAttempt } = await import('./sharedProxyOrchestration.js');
    const result = await selectSurfaceExecutionAttempt({
      requestedModel: 'gpt-5.2',
      downstreamPolicy: EMPTY_DOWNSTREAM_ROUTING_POLICY,
      excludeTargetIds: [11],
      retryCount: 1,
    });

    expect(result).toBe(selected);
    expect(selectRouteRuntimeExecutionAttemptMock).toHaveBeenCalledWith(expect.objectContaining({
      requestedModel: 'gpt-5.2',
      retryCount: 1,
      disabledExecutionTargetIds: [11],
    }));
  });

  it('passes the sticky execution target to the compiled runtime executor on the first attempt', async () => {
    const selected = { target: { id: 55 } };
    getStickyTargetIdMock.mockReturnValueOnce(55);
    selectRouteRuntimeExecutionAttemptMock.mockResolvedValueOnce(selected);

    const { selectSurfaceExecutionAttempt } = await import('./sharedProxyOrchestration.js');
    const result = await selectSurfaceExecutionAttempt({
      requestedModel: 'gpt-5.2',
      downstreamPolicy: EMPTY_DOWNSTREAM_ROUTING_POLICY,
      excludeTargetIds: [],
      retryCount: 0,
      stickySessionKey: 'sticky-session',
    });

    expect(result).toBe(selected);
    expect(selectRouteRuntimeExecutionAttemptMock).toHaveBeenCalledWith(expect.objectContaining({
      stickyExecutionTargetId: 55,
      forcedExecutionAttemptId: undefined,
    }));
  });

  it('passes forced tester execution attempts to the compiled runtime executor', async () => {
    const selected = { target: { id: 88 } };
    getStickyTargetIdMock.mockReturnValueOnce(55);
    selectRouteRuntimeExecutionAttemptMock.mockResolvedValueOnce(selected);

    const { selectSurfaceExecutionAttempt } = await import('./sharedProxyOrchestration.js');
    const result = await selectSurfaceExecutionAttempt({
      requestedModel: 'gpt-5.2',
      downstreamPolicy: EMPTY_DOWNSTREAM_ROUTING_POLICY,
      excludeTargetIds: [],
      retryCount: 0,
      stickySessionKey: 'sticky-session',
      forcedExecutionAttemptId: 'ea_88',
    });

    expect(result).toBe(selected);
    expect(selectRouteRuntimeExecutionAttemptMock).toHaveBeenCalledWith(expect.objectContaining({
      stickyExecutionTargetId: 55,
      forcedExecutionAttemptId: 'ea_88',
    }));
  });

  it('returns null when the compiled runtime executor cannot select an execution attempt', async () => {
    selectRouteRuntimeExecutionAttemptMock.mockResolvedValueOnce(null);

    const { selectSurfaceExecutionAttempt } = await import('./sharedProxyOrchestration.js');
    const result = await selectSurfaceExecutionAttempt({
      requestedModel: 'gpt-5.2',
      downstreamPolicy: EMPTY_DOWNSTREAM_ROUTING_POLICY,
      excludeTargetIds: [],
      retryCount: 0,
      forcedExecutionAttemptId: 'ea_91',
    });

    expect(result).toBeNull();
    expect(selectRouteRuntimeExecutionAttemptMock).toHaveBeenCalledWith(expect.objectContaining({
      forcedExecutionAttemptId: 'ea_91',
    }));
  });

  it('records the selected execution target immediately before upstream execution', async () => {
    const { markSurfaceExecutionAttemptStarted } = await import('./sharedProxyOrchestration.js');

    await markSurfaceExecutionAttemptStarted({
      selected: {
        executionTargetId: 11,
      } as any,
    });

    expect(recordRouteRuntimeExecutionAttemptStartedMock).toHaveBeenCalledWith({
      executionTargetId: 11,
    });
  });

  it('writes proxy logs through the shared log formatter and store', async () => {
    composeProxyLogMessageMock.mockReturnValue('normalized error');
    formatUtcSqlDateTimeMock.mockReturnValue('2026-03-21 22:00:00');
    insertProxyLogMock.mockResolvedValue(undefined);

    const { writeSurfaceProxyLog } = await import('./sharedProxyOrchestration.js');
    await writeSurfaceProxyLog({
      warningScope: 'chat',
      selected: {
        target: { id: 11, routeId: 22 },
        account: { id: 33 },
        site: {},
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      modelRequested: 'gpt-5.2',
      status: 'retried',
      httpStatus: 502,
      latencyMs: 1200,
      errorMessage: 'upstream failed',
      retryCount: 1,
      downstreamPath: '/v1/chat/completions',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      estimatedCost: 0.42,
      billingDetails: { source: 'test' },
      upstreamPath: '/v1/responses',
      usageSource: 'self-log',
      clientContext: {
        clientKind: 'codex',
        clientAppId: 'app-id',
        clientAppName: 'App',
        clientConfidence: 'exact',
        sessionId: 'sess-1',
        traceHint: 'trace-1',
      },
      downstreamApiKeyId: 44,
    });

    expect(composeProxyLogMessageMock).toHaveBeenCalledWith({
      clientKind: 'codex',
      sessionId: 'sess-1',
      traceHint: 'trace-1',
      downstreamPath: '/v1/chat/completions',
      upstreamPath: '/v1/responses',
      usageSource: 'self-log',
      errorMessage: 'upstream failed',
    });
    expect(insertProxyLogMock).toHaveBeenCalledWith({
      requestId: null,
      executionAttemptId: 'ea_11',
      accountId: 33,
      downstreamApiKeyId: 44,
      modelRequested: 'gpt-5.2',
      modelActual: 'upstream-model',
      routeEntrypointId: runtimeIdentity.routeEntrypointId,
      runtimeEndpointId: runtimeIdentity.runtimeEndpointId,
      runtimeArtifactId: runtimeIdentity.runtimeArtifactId,
      executionTargetId: runtimeIdentity.executionTargetId,
      status: 'retried',
      httpStatus: 502,
      isStream: null,
      firstByteLatencyMs: null,
      firstTokenLatencyMs: null,
      latencyMs: 1200,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      estimatedCost: 0.42,
      billingDetails: { source: 'test' },
      clientFamily: 'codex',
      clientAppId: 'app-id',
      clientAppName: 'App',
      clientConfidence: 'exact',
      errorMessage: 'normalized error',
      retryCount: 1,
      createdAt: '2026-03-21 22:00:00',
    });
  });

  it('keeps unavailable billing cost unknown when writing a proxy log', async () => {
    composeProxyLogMessageMock.mockReturnValue(null);
    formatUtcSqlDateTimeMock.mockReturnValue('2026-03-21 22:00:00');
    insertProxyLogMock.mockResolvedValue(undefined);

    const { writeSurfaceProxyLog } = await import('./sharedProxyOrchestration.js');
    await writeSurfaceProxyLog({
      warningScope: 'chat',
      selected: {
        target: { id: 11 },
        account: { id: 33 },
        site: {},
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      modelRequested: 'gpt-5.2',
      status: 'success',
      httpStatus: 200,
      latencyMs: 1200,
      errorMessage: null,
      retryCount: 0,
      downstreamPath: '/v1/chat/completions',
    });

    expect(insertProxyLogMock).toHaveBeenCalledWith(expect.objectContaining({
      estimatedCost: null,
    }));
  });

  it('persists runtime entry and endpoint identity on proxy logs', async () => {
    composeProxyLogMessageMock.mockReturnValue(null);
    formatUtcSqlDateTimeMock.mockReturnValue('2026-03-21 22:00:00');
    insertProxyLogMock.mockResolvedValue(undefined);

    const { writeSurfaceProxyLog } = await import('./sharedProxyOrchestration.js');
    await writeSurfaceProxyLog({
      warningScope: 'chat',
      selected: {
        target: { id: 11, routeId: 22 },
        account: { id: 33 },
        site: {},
        actualModel: 'upstream-model',
        ...runtimeIdentity,
        routeEntrypointId: 'entry:selected',
        runtimeEndpointId: 'endpoint:selected',
        runtimeArtifactId: 'runtime-artifact-42',
        executionTargetId: 7,
      },
      modelRequested: 'public-model',
      status: 'success',
      httpStatus: 200,
      latencyMs: 88,
      errorMessage: null,
      retryCount: 0,
      downstreamPath: '/v1/chat/completions',
    });

    expect(insertProxyLogMock).toHaveBeenCalledWith(expect.objectContaining({
      modelRequested: 'public-model',
      modelActual: 'upstream-model',
      routeEntrypointId: 'entry:selected',
      runtimeEndpointId: 'endpoint:selected',
      runtimeArtifactId: 'runtime-artifact-42',
      executionTargetId: 7,
    }));
  });

  it('builds runtime dispatch requests with site proxy initialization', async () => {
    const site = { url: 'https://upstream.example.com' };
    const request = {
      endpoint: 'responses' as const,
      path: '/v1/responses',
      headers: { authorization: 'Bearer test' },
      body: { model: 'gpt-5.2', input: 'hello' },
      runtime: { executor: 'default' as const },
    };
    resolveTargetProxyUrlMock.mockReturnValue('http://proxy.example.com');
    withSiteRecordProxyRequestInitMock.mockImplementation(async (_site, init, proxyUrl) => ({
      ...init,
      proxyUrl,
    }));
    dispatchRuntimeRequestMock.mockResolvedValue('ok');

    const { createSurfaceDispatchRequest } = await import('./sharedProxyOrchestration.js');
    const dispatchRequest = createSurfaceDispatchRequest({
      site,
      accountExtraConfig: '{"proxyUrl":"http://proxy.example.com"}',
    });
    const result = await dispatchRequest(request, 'https://target.example.com/v1/responses');

    expect(result).toBe('ok');
    expect(resolveTargetProxyUrlMock).toHaveBeenCalledWith(
      site,
      '{"proxyUrl":"http://proxy.example.com"}',
    );
    expect(dispatchRuntimeRequestMock).toHaveBeenCalledTimes(1);
    const dispatchArg = dispatchRuntimeRequestMock.mock.calls[0]?.[0];
    expect(dispatchArg.siteUrl).toBe('https://upstream.example.com');
    expect(dispatchArg.targetUrl).toBe('https://target.example.com/v1/responses');
    expect(dispatchArg.request).toBe(request);
    return dispatchArg.buildInit('https://target.example.com/v1/responses', {
      headers: { authorization: 'Bearer test' },
      body: { model: 'gpt-5.2', input: 'hello' },
    }).then((init: Record<string, unknown>) => {
      expect(withSiteRecordProxyRequestInitMock).toHaveBeenCalledWith(site, {
        method: 'POST',
        headers: { authorization: 'Bearer test' },
        body: JSON.stringify({ model: 'gpt-5.2', input: 'hello' }),
      }, 'http://proxy.example.com');
      expect(init).toEqual({
        method: 'POST',
        headers: { authorization: 'Bearer test' },
        body: JSON.stringify({ model: 'gpt-5.2', input: 'hello' }),
        proxyUrl: 'http://proxy.example.com',
      });
    });
  });

  it('retries retryable upstream HTTP failures through the shared failure toolkit', async () => {
    composeProxyLogMessageMock.mockReturnValue('normalized error');
    formatUtcSqlDateTimeMock.mockReturnValue('2026-03-21 22:00:00');
    insertProxyLogMock.mockResolvedValue(undefined);
    shouldRetryProxyRequestMock.mockReturnValue(true);
    isTokenExpiredErrorMock.mockReturnValue(false);
    recordOauthQuotaResetHintMock.mockResolvedValue(null);

    const { createSurfaceFailureToolkit } = await import('./sharedProxyOrchestration.js');
    const toolkit = createSurfaceFailureToolkit({
      warningScope: 'chat',
      downstreamPath: '/v1/chat/completions',
      clientContext: null,
      downstreamApiKeyId: 44,
    });

    const result = await toolkit.handleUpstreamFailure({
      selected: {
        target: { id: 11, routeId: 22 },
        account: { id: 33, username: 'oauth-user' },
        site: { name: 'Codex OAuth' },
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      requestedModel: 'gpt-5.2',
      modelName: 'upstream-model',
      status: 429,
      errText: 'quota exceeded',
      rawErrText: '{"error":"quota exceeded"}',
      latencyMs: 1200,
      retryCount: 0,
      willContinue: true,
    });

    expect(result).toEqual({ action: 'retry' });
    expect(recordRouteRuntimeExecutionAttemptFailureMock).toHaveBeenCalledWith({
      executionTargetId: 11,
      status: 429,
      errorText: '{"error":"quota exceeded"}',
    });
    expect(recordOauthQuotaResetHintMock).toHaveBeenCalledWith({
      accountId: 33,
      statusCode: 429,
      errorText: '{"error":"quota exceeded"}',
    });
    expect(reportProxyAllFailedMock).not.toHaveBeenCalled();
    expect(insertProxyLogMock).toHaveBeenCalledWith(expect.objectContaining({
      executionAttemptId: 'ea_11',
      accountId: 33,
      downstreamApiKeyId: 44,
      modelRequested: 'gpt-5.2',
      modelActual: 'upstream-model',
      status: 'retried',
      httpStatus: 429,
      latencyMs: 1200,
      errorMessage: 'normalized error',
      retryCount: 0,
    }));
  });

  it('keeps retryable failures on the retry path even when quota hint recording fails', async () => {
    composeProxyLogMessageMock.mockReturnValue('normalized error');
    formatUtcSqlDateTimeMock.mockReturnValue('2026-03-21 22:00:00');
    insertProxyLogMock.mockResolvedValue(undefined);
    shouldRetryProxyRequestMock.mockReturnValue(true);
    isTokenExpiredErrorMock.mockReturnValue(false);
    recordOauthQuotaResetHintMock.mockRejectedValue(new Error('hint failed'));

    const { createSurfaceFailureToolkit } = await import('./sharedProxyOrchestration.js');
    const toolkit = createSurfaceFailureToolkit({
      warningScope: 'chat',
      downstreamPath: '/v1/chat/completions',
      clientContext: null,
      downstreamApiKeyId: null,
    });

    await expect(toolkit.handleUpstreamFailure({
      selected: {
        target: { id: 11, routeId: 22 },
        account: { id: 33, username: 'oauth-user' },
        site: { name: 'Codex OAuth' },
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      requestedModel: 'gpt-5.2',
      modelName: 'upstream-model',
      status: 429,
      errText: 'quota exceeded',
      rawErrText: '{"error":"quota exceeded"}',
      latencyMs: 1200,
      retryCount: 0,
      willContinue: true,
    })).resolves.toEqual({ action: 'retry' });
  });

  it('returns a terminal upstream error response and reports token expiration when retries stop', async () => {
    composeProxyLogMessageMock.mockReturnValue('normalized error');
    formatUtcSqlDateTimeMock.mockReturnValue('2026-03-21 22:00:00');
    insertProxyLogMock.mockResolvedValue(undefined);
    shouldRetryProxyRequestMock.mockReturnValue(false);
    isTokenExpiredErrorMock.mockReturnValue(true);
    recordOauthQuotaResetHintMock.mockResolvedValue(null);

    const { createSurfaceFailureToolkit } = await import('./sharedProxyOrchestration.js');
    const toolkit = createSurfaceFailureToolkit({
      warningScope: 'responses',
      downstreamPath: '/v1/responses',
      clientContext: null,
      downstreamApiKeyId: null,
    });

    const result = await toolkit.handleUpstreamFailure({
      selected: {
        target: { id: 11, routeId: 22 },
        account: { id: 33, username: 'oauth-user' },
        site: { name: 'Codex OAuth' },
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      requestedModel: 'gpt-5.2',
      modelName: 'upstream-model',
      status: 401,
      errText: 'expired token',
      rawErrText: 'expired token',
      latencyMs: 900,
      retryCount: 2,
      willContinue: false,
    });

    expect(result).toEqual({
      action: 'respond',
      status: 401,
      payload: {
        error: {
          message: 'expired token',
          type: 'upstream_error',
        },
      },
    });
    expect(reportTokenExpiredMock).toHaveBeenCalledWith({
      accountId: 33,
      username: 'oauth-user',
      siteName: 'Codex OAuth',
      credentialKind: 'session',
      detail: 'HTTP 401',
    });
    expect(reportProxyAllFailedMock).toHaveBeenCalledWith({
      model: 'gpt-5.2',
      reason: 'upstream returned HTTP 401',
    });
  });

  it('classifies an explicit API-key target separately from an access-token target', async () => {
    composeProxyLogMessageMock.mockReturnValue('normalized error');
    formatUtcSqlDateTimeMock.mockReturnValue('2026-03-21 22:00:00');
    insertProxyLogMock.mockResolvedValue(undefined);
    shouldRetryProxyRequestMock.mockReturnValue(false);
    isTokenExpiredErrorMock.mockReturnValue(true);
    recordOauthQuotaResetHintMock.mockResolvedValue(null);

    const { createSurfaceFailureToolkit } = await import('./sharedProxyOrchestration.js');
    const toolkit = createSurfaceFailureToolkit({
      warningScope: 'chat',
      downstreamPath: '/v1/chat/completions',
      clientContext: null,
      downstreamApiKeyId: null,
    });

    await toolkit.handleUpstreamFailure({
      selected: {
        target: { id: 11, routeId: 22 },
        account: {
          id: 33,
          username: 'apikey-user',
          credential: '',
          credentialMode: 'apikey',
          credentialKind: 'none',
          extraConfig: null,
        },
        site: { name: 'NewAPI' },
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      requestedModel: 'gpt-5.2',
      modelName: 'upstream-model',
      status: 401,
      errText: 'invalid token',
      rawErrText: 'invalid token',
      latencyMs: 900,
      retryCount: 0,
      willContinue: false,
    });

    expect(reportTokenExpiredMock).toHaveBeenCalledWith(expect.objectContaining({
      credentialKind: 'apikey',
    }));
  });

  it('returns terminal failures even when final alerting throws', async () => {
    composeProxyLogMessageMock.mockReturnValue('normalized error');
    formatUtcSqlDateTimeMock.mockReturnValue('2026-03-21 22:00:00');
    insertProxyLogMock.mockResolvedValue(undefined);
    shouldRetryProxyRequestMock.mockReturnValue(false);
    isTokenExpiredErrorMock.mockReturnValue(true);
    recordOauthQuotaResetHintMock.mockResolvedValue(null);
    reportTokenExpiredMock.mockRejectedValue(new Error('token alert failed'));

    const { createSurfaceFailureToolkit } = await import('./sharedProxyOrchestration.js');
    const toolkit = createSurfaceFailureToolkit({
      warningScope: 'responses',
      downstreamPath: '/v1/responses',
      clientContext: null,
      downstreamApiKeyId: null,
    });

    await expect(toolkit.handleUpstreamFailure({
      selected: {
        target: { id: 11, routeId: 22 },
        account: { id: 33, username: 'oauth-user' },
        site: { name: 'Codex OAuth' },
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      requestedModel: 'gpt-5.2',
      modelName: 'upstream-model',
      status: 401,
      errText: 'expired token',
      rawErrText: 'expired token',
      latencyMs: 900,
      retryCount: 2,
      willContinue: false,
    })).resolves.toEqual({
      action: 'respond',
      status: 401,
      payload: {
        error: {
          message: 'expired token',
          type: 'upstream_error',
        },
      },
    });
  });

  it('handles detected proxy failures through the shared failure toolkit', async () => {
    composeProxyLogMessageMock.mockReturnValue('normalized error');
    formatUtcSqlDateTimeMock.mockReturnValue('2026-03-21 22:00:00');
    insertProxyLogMock.mockResolvedValue(undefined);
    shouldRetryProxyRequestMock.mockReturnValue(false);

    const { createSurfaceFailureToolkit } = await import('./sharedProxyOrchestration.js');
    const toolkit = createSurfaceFailureToolkit({
      warningScope: 'chat',
      downstreamPath: '/v1/chat/completions',
      clientContext: null,
      downstreamApiKeyId: null,
    });

    const result = await toolkit.handleDetectedFailure({
      selected: {
        target: { id: 11, routeId: 22 },
        account: { id: 33, username: 'oauth-user' },
        site: { name: 'Codex OAuth' },
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      requestedModel: 'gpt-5.2',
      modelName: 'upstream-model',
      failure: {
        status: 500,
        reason: 'upstream failure',
      },
      latencyMs: 700,
      retryCount: 2,
      willContinue: false,
      promptTokens: 12,
      completionTokens: 4,
      totalTokens: 16,
      upstreamPath: '/v1/responses',
    });

    expect(result).toEqual({
      action: 'respond',
      status: 500,
      payload: {
        error: {
          message: 'upstream failure',
          type: 'upstream_error',
        },
      },
    });
    expect(recordRouteRuntimeExecutionAttemptFailureMock).toHaveBeenCalledWith({
      executionTargetId: 11,
      status: 500,
      errorText: 'upstream failure',
    });
    expect(reportProxyAllFailedMock).toHaveBeenCalledWith({
      model: 'gpt-5.2',
      reason: 'upstream failure',
    });
    expect(recordOauthQuotaResetHintMock).not.toHaveBeenCalled();
  });

  it('records stream failures with error text even without a runtime status code', async () => {
    composeProxyLogMessageMock.mockReturnValue('normalized error');
    formatUtcSqlDateTimeMock.mockReturnValue('2026-03-21 22:00:00');
    insertProxyLogMock.mockResolvedValue(undefined);

    const { createSurfaceFailureToolkit } = await import('./sharedProxyOrchestration.js');
    const toolkit = createSurfaceFailureToolkit({
      warningScope: 'responses',
      downstreamPath: '/v1/responses',
      clientContext: null,
      downstreamApiKeyId: null,
    });

    await toolkit.recordStreamFailure({
      selected: {
        target: { id: 11, routeId: 22 },
        account: { id: 33, username: 'oauth-user' },
        site: { name: 'Codex OAuth' },
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      requestedModel: 'gpt-5.2',
      modelName: 'upstream-model',
      errorMessage: 'stream exploded',
      latencyMs: 450,
      retryCount: 1,
    });

    expect(recordRouteRuntimeExecutionAttemptFailureMock).toHaveBeenCalledWith({
      executionTargetId: 11,
      errorText: 'stream exploded',
    });
  });

  it('refreshes oauth tokens through the shared recover helper and retries the rebuilt request', async () => {
    const refreshedResponse = {
      ok: true,
      status: 200,
      text: vi.fn(),
    };
    const selected = {
      account: {
        id: 33,
        credential: 'old-access-token',
        extraConfig: '{"oauth":{"refreshToken":"refresh"}}',
      },
      tokenValue: 'old-access-token',
    };
    const ctx = {
      request: {
        endpoint: 'responses' as const,
        path: '/v1/responses',
        headers: { authorization: 'Bearer old-access-token' },
        body: { model: 'gpt-5.2' },
      },
      response: {
        ok: false,
        status: 401,
        text: vi.fn(),
      },
      rawErrText: 'expired token',
    };
    refreshOauthAccessTokenSingleflightMock.mockResolvedValue({
      accessToken: 'new-access-token',
      extraConfig: '{"oauth":{"refreshToken":"refresh-next"}}',
    });
    const dispatchRequest = vi.fn().mockResolvedValue(refreshedResponse);

    const { trySurfaceOauthRefreshRecovery } = await import('./sharedProxyOrchestration.js');
    const result = await trySurfaceOauthRefreshRecovery({
      ctx: ctx as any,
      selected,
      siteUrl: 'https://upstream.example.com',
      buildRequest: () => ({
        endpoint: 'responses',
        path: '/v1/responses',
        headers: { authorization: `Bearer ${selected.tokenValue}` },
        body: { model: 'gpt-5.2' },
      }),
      dispatchRequest,
    });

    expect(refreshOauthAccessTokenSingleflightMock).toHaveBeenCalledWith(33);
    expect(selected.tokenValue).toBe('new-access-token');
    expect(selected.account.credential).toBe('new-access-token');
    expect(selected.account.extraConfig).toBe('{"oauth":{"refreshToken":"refresh-next"}}');
    expect(dispatchRequest).toHaveBeenCalledWith(expect.objectContaining({
      headers: { authorization: 'Bearer new-access-token' },
    }), 'https://upstream.example.com/v1/responses');
    expect(result).toEqual({
      request: {
        endpoint: 'responses',
        path: '/v1/responses',
        headers: { authorization: 'Bearer new-access-token' },
        body: { model: 'gpt-5.2' },
      },
      targetUrl: 'https://upstream.example.com/v1/responses',
      upstream: refreshedResponse,
      upstreamPath: '/v1/responses',
    });
  });

  it('updates the recover context with the refreshed failure response when oauth refresh retry still fails', async () => {
    const refreshedResponse = {
      ok: false,
      status: 403,
      text: vi.fn().mockResolvedValue('account mismatch'),
    };
    const ctx = {
      request: {
        endpoint: 'responses' as const,
        path: '/v1/responses',
        headers: { authorization: 'Bearer old-access-token' },
        body: { model: 'gpt-5.2' },
      },
      response: {
        ok: false,
        status: 401,
        text: vi.fn(),
      },
      rawErrText: 'expired token',
    };
    const selected = {
      account: {
        id: 33,
        credential: 'old-access-token',
        extraConfig: '{"oauth":{"refreshToken":"refresh"}}',
      },
      tokenValue: 'old-access-token',
    };
    refreshOauthAccessTokenSingleflightMock.mockResolvedValue({
      accessToken: 'new-access-token',
      extraConfig: '{"oauth":{"refreshToken":"refresh-next"}}',
    });

    const { trySurfaceOauthRefreshRecovery } = await import('./sharedProxyOrchestration.js');
    const result = await trySurfaceOauthRefreshRecovery({
      ctx: ctx as any,
      selected,
      siteUrl: 'https://upstream.example.com',
      buildRequest: () => ({
        endpoint: 'responses',
        path: '/v1/responses',
        headers: { authorization: `Bearer ${selected.tokenValue}` },
        body: { model: 'gpt-5.2' },
      }),
      dispatchRequest: vi.fn().mockResolvedValue(refreshedResponse),
    });

    expect(result).toBeNull();
    expect(ctx.request.headers).toEqual({ authorization: 'Bearer new-access-token' });
    expect(ctx.response).toBe(refreshedResponse);
    expect(ctx.rawErrText).toBe('account mismatch');
  });

  it('records shared success bookkeeping with usage fallback, billing, and success logging', async () => {
    resolveProxyUsageWithSelfLogFallbackMock.mockResolvedValue({
      promptTokens: 20,
      completionTokens: 8,
      totalTokens: 28,
      recoveredFromSelfLog: true,
      estimatedCostFromQuota: 0.42,
      selfLogBillingMeta: null,
      usageSource: 'self-log',
    });
    resolveProxyLogBillingMock.mockResolvedValue({
      estimatedCost: 0.42,
      billingDetails: { source: 'pricing-test' },
    });
    const logSuccess = vi.fn().mockResolvedValue(undefined);
    const recordDownstreamBilling = vi.fn();

    const { recordSurfaceSuccess } = await import('./sharedProxyOrchestration.js');
    const result = await recordSurfaceSuccess({
      selected: {
        target: { id: 11, routeId: 22 },
        account: { id: 33, username: 'oauth-user' },
        site: { id: 44, url: 'https://upstream.example.com', platform: 'codex', name: 'Codex OAuth' },
        tokenValue: 'live-token',
        tokenName: 'default',
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      requestedModel: 'gpt-5.2',
      modelName: 'upstream-model',
      parsedUsage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        promptTokensIncludeCache: null,
      },
      requestStartedAtMs: 1000,
      isStream: true,
      firstByteLatencyMs: 42,
      firstTokenLatencyMs: 123,
      latencyMs: 250,
      retryCount: 1,
      upstreamPath: '/v1/responses',
      logSuccess,
      recordDownstreamBilling,
    });

    expect(resolveProxyUsageWithSelfLogFallbackMock).toHaveBeenCalledWith({
      site: { id: 44, url: 'https://upstream.example.com', platform: 'codex', name: 'Codex OAuth' },
      account: { id: 33, username: 'oauth-user' },
      tokenValue: 'live-token',
      tokenName: 'default',
      modelName: 'upstream-model',
      requestStartedAtMs: 1000,
      requestEndedAtMs: 1250,
      localLatencyMs: 250,
      upstreamUsagePresent: true,
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    });
    expect(resolveProxyLogBillingMock).toHaveBeenCalledWith({
      site: { id: 44, url: 'https://upstream.example.com', platform: 'codex', name: 'Codex OAuth' },
      account: { id: 33, username: 'oauth-user' },
      tokenId: null,
      upstreamGroup: null,
      modelName: 'upstream-model',
      parsedUsage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        promptTokensIncludeCache: null,
      },
      resolvedUsage: {
        promptTokens: 20,
        completionTokens: 8,
        totalTokens: 28,
        recoveredFromSelfLog: true,
        estimatedCostFromQuota: 0.42,
        selfLogBillingMeta: null,
        usageSource: 'self-log',
      },
    });
    expect(recordRouteRuntimeExecutionAttemptSuccessMock).toHaveBeenCalledWith({
      executionTargetId: 11,
      accountId: 33,
      modelName: 'upstream-model',
      latencyMs: 250,
    });
    expect(recordDownstreamBilling).toHaveBeenCalledWith({
      billingDetails: { source: 'pricing-test' },
      siteId: 44,
      accountId: 33,
    });
    expect(logSuccess).toHaveBeenCalledWith({
      selected: {
        target: { id: 11, routeId: 22 },
        account: { id: 33, username: 'oauth-user' },
        site: { id: 44, url: 'https://upstream.example.com', platform: 'codex', name: 'Codex OAuth' },
        tokenValue: 'live-token',
        tokenName: 'default',
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      modelRequested: 'gpt-5.2',
      status: 'success',
      httpStatus: 200,
      isStream: true,
      firstByteLatencyMs: 42,
      firstTokenLatencyMs: 123,
      latencyMs: 250,
      errorMessage: null,
      retryCount: 1,
      promptTokens: 20,
      completionTokens: 8,
      totalTokens: 28,
      usageSource: 'self-log',
      estimatedCost: 0.42,
      billingDetails: { source: 'pricing-test' },
      upstreamPath: '/v1/responses',
    });
    expect(result).toEqual({
      resolvedUsage: {
        promptTokens: 20,
        completionTokens: 8,
        totalTokens: 28,
        recoveredFromSelfLog: true,
        estimatedCostFromQuota: 0.42,
        selfLogBillingMeta: null,
        usageSource: 'self-log',
      },
      estimatedCost: 0.42,
      billingDetails: { source: 'pricing-test' },
    });
  });

  it('persists the selected token group and cache-priced billing detail without recomputing it', async () => {
    const billingDetails = {
      quote: {
        amount: 0.0168,
        unit: 'currency',
        currency: 'USD',
        source: 'provider_catalog',
        sourceId: null,
        matchedScope: 'provider_catalog',
        estimateLevel: 'exact',
        planFingerprint: 'sub2api-premium',
      },
      usage: {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        cacheReadTokens: 300,
        cacheCreationTokens: 100,
        billablePromptTokens: 600,
        promptTokensIncludeCache: true,
      },
      breakdown: {
        inputCost: 0.006,
        outputCost: 0.01,
        cacheReadCost: 0.0003,
        cacheCreationCost: 0.0005,
        totalCost: 0.0168,
      },
    };
    resolveProxyUsageWithSelfLogFallbackMock.mockResolvedValue({
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      recoveredFromSelfLog: false,
      estimatedCostFromQuota: 0,
      selfLogBillingMeta: null,
      usageSource: 'upstream',
    });
    resolveProxyLogBillingMock.mockResolvedValue({ estimatedCost: 0.0168, billingDetails });
    const logSuccess = vi.fn().mockResolvedValue(undefined);
    const recordDownstreamBilling = vi.fn().mockResolvedValue(undefined);

    const { recordSurfaceSuccess } = await import('./sharedProxyOrchestration.js');
    await recordSurfaceSuccess({
      selected: {
        target: { id: 11 },
        account: { id: 33 },
        site: { id: 44, url: 'https://sub2api.example.com', platform: 'sub2api' },
        token: { id: 55, tokenGroup: 'premium' },
        tokenValue: 'sk-token',
        actualModel: 'gpt-4o',
        ...runtimeIdentity,
      },
      requestedModel: 'gpt-4o',
      modelName: 'gpt-4o',
      parsedUsage: {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        cacheReadTokens: 300,
        cacheCreationTokens: 100,
        promptTokensIncludeCache: true,
      },
      requestStartedAtMs: 1000,
      isStream: false,
      latencyMs: 250,
      retryCount: 0,
      upstreamPath: '/v1/chat/completions',
      logSuccess,
      recordDownstreamBilling,
    });

    expect(resolveProxyLogBillingMock).toHaveBeenCalledWith(expect.objectContaining({
      tokenId: 55,
      upstreamGroup: 'premium',
      parsedUsage: expect.objectContaining({
        cacheReadTokens: 300,
        cacheCreationTokens: 100,
        promptTokensIncludeCache: true,
      }),
    }));
    expect(recordDownstreamBilling).toHaveBeenCalledWith({
      billingDetails,
      siteId: 44,
      accountId: 33,
    });
    expect(logSuccess).toHaveBeenCalledWith(expect.objectContaining({
      estimatedCost: 0.0168,
      billingDetails,
    }));
  });

  it('records explicit upstream cache evidence under the actual endpoint identity', async () => {
    resolveProxyUsageWithSelfLogFallbackMock.mockResolvedValue({
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      recoveredFromSelfLog: false,
      estimatedCostFromQuota: 0,
      selfLogBillingMeta: null,
      usageSource: 'upstream',
    });
    resolveProxyLogBillingMock.mockResolvedValue({ estimatedCost: 0.1, billingDetails: null });

    const { recordSurfaceSuccess } = await import('./sharedProxyOrchestration.js');
    await recordSurfaceSuccess({
      selected: {
        target: { id: 11 },
        account: { id: 33 },
        site: { id: 44, url: 'https://upstream.example.com', platform: 'openai' },
        tokenValue: 'live-token',
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      requestedModel: 'gpt-5.2',
      modelName: 'upstream-model',
      parsedUsage: {
        promptTokens: 100,
        completionTokens: 10,
        totalTokens: 110,
        cacheReadTokens: 80,
        cacheCreationTokens: 5,
        promptTokensIncludeCache: true,
      },
      upstreamUsagePresent: true,
      upstreamCacheUsagePresent: true,
      contentAffinityKey: 'content:abc',
      endpointType: 'openai.chat_completions',
      requestEndpointType: 'openai.responses',
      requestStartedAtMs: 1000,
      latencyMs: 250,
      retryCount: 0,
      logSuccess: vi.fn().mockResolvedValue(undefined),
    });

    expect(getCacheAffinityObservation({
      executionTargetId: 11,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
    })).toMatchObject({
      hitProbability: 0.5,
      cachedReadFraction: 0.8,
      hitCacheWriteFraction: 0.05,
    });
  });

  it('does not infer a cache miss from ordinary upstream token usage', async () => {
    resolveProxyUsageWithSelfLogFallbackMock.mockResolvedValue({
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      recoveredFromSelfLog: false,
      estimatedCostFromQuota: 0,
      selfLogBillingMeta: null,
      usageSource: 'upstream',
    });
    resolveProxyLogBillingMock.mockResolvedValue({ estimatedCost: 0.1, billingDetails: null });

    const { recordSurfaceSuccess } = await import('./sharedProxyOrchestration.js');
    await recordSurfaceSuccess({
      selected: {
        target: { id: 11 },
        account: { id: 33 },
        site: { id: 44, url: 'https://upstream.example.com', platform: 'openai' },
        tokenValue: 'live-token',
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      requestedModel: 'gpt-5.2',
      modelName: 'upstream-model',
      parsedUsage: {
        promptTokens: 100,
        completionTokens: 10,
        totalTokens: 110,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        promptTokensIncludeCache: true,
      },
      upstreamUsagePresent: true,
      upstreamCacheUsagePresent: false,
      contentAffinityKey: 'content:abc',
      endpointType: 'openai.responses',
      requestStartedAtMs: 1000,
      latencyMs: 250,
      retryCount: 0,
      logSuccess: vi.fn().mockResolvedValue(undefined),
    });

    expect(getCacheAffinityObservation({
      executionTargetId: 11,
      endpointType: 'openai.responses',
      contentAffinityKey: 'content:abc',
    })).toBeNull();
  });

  it('logs unknown usage as null tokens while preserving success bookkeeping', async () => {
    resolveProxyUsageWithSelfLogFallbackMock.mockResolvedValue({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      recoveredFromSelfLog: false,
      estimatedCostFromQuota: 0,
      selfLogBillingMeta: null,
      usageSource: 'unknown',
    });
    resolveProxyLogBillingMock.mockResolvedValue({
      estimatedCost: 0,
      billingDetails: null,
    });
    const logSuccess = vi.fn().mockResolvedValue(undefined);

    const { recordSurfaceSuccess } = await import('./sharedProxyOrchestration.js');
    await recordSurfaceSuccess({
      selected: {
        target: { id: 11, routeId: 22 },
        account: { id: 33, username: 'oauth-user' },
        site: { id: 44, url: 'https://upstream.example.com', platform: 'new-api', name: 'Upstream' },
        tokenValue: 'live-token',
        tokenName: 'default',
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      requestedModel: 'gpt-5.2',
      modelName: 'upstream-model',
      parsedUsage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        promptTokensIncludeCache: null,
      },
      requestStartedAtMs: 1000,
      latencyMs: 250,
      retryCount: 0,
      upstreamPath: '/v1/chat/completions',
      logSuccess,
    });

    expect(resolveProxyUsageWithSelfLogFallbackMock).toHaveBeenCalledWith(expect.objectContaining({
      upstreamUsagePresent: false,
    }));
    expect(logSuccess).toHaveBeenCalledWith(expect.objectContaining({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      usageSource: 'unknown',
    }));
  });

  it('captures codex quota headers from successful upstream responses as best-effort bookkeeping', async () => {
    resolveProxyUsageWithSelfLogFallbackMock.mockResolvedValue({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      recoveredFromSelfLog: false,
      estimatedCostFromQuota: 0,
      selfLogBillingMeta: null,
      usageSource: 'upstream',
    });
    resolveProxyLogBillingMock.mockResolvedValue({
      estimatedCost: 0.12,
      billingDetails: null,
    });
    recordOauthQuotaHeadersSnapshotMock.mockResolvedValue(null);
    const logSuccess = vi.fn().mockResolvedValue(undefined);

    const { recordSurfaceSuccess } = await import('./sharedProxyOrchestration.js');
    await recordSurfaceSuccess({
      selected: {
        target: { id: 11, routeId: 22 },
        account: { id: 33, username: 'oauth-user' },
        site: { id: 44, url: 'https://upstream.example.com', platform: 'codex', name: 'Codex OAuth' },
        tokenValue: 'live-token',
        tokenName: 'default',
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      requestedModel: 'gpt-5.2',
      modelName: 'upstream-model',
      parsedUsage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        promptTokensIncludeCache: null,
      },
      requestStartedAtMs: 1000,
      latencyMs: 250,
      retryCount: 0,
      upstreamPath: '/v1/responses',
      upstreamHeaders: new Headers({
        'x-codex-primary-used-percent': '61',
        'x-codex-secondary-used-percent': '13',
      }),
      logSuccess,
    });

    await vi.waitFor(() => {
      expect(recordOauthQuotaHeadersSnapshotMock).toHaveBeenCalledWith({
        accountId: 33,
        headers: expect.any(Headers),
      });
    });
  });

  it('treats success metrics as best-effort when requested', async () => {
    resolveProxyUsageWithSelfLogFallbackMock.mockRejectedValueOnce(new Error('billing failed'));
    const logSuccess = vi.fn().mockResolvedValue(undefined);
    const recordDownstreamBilling = vi.fn();

    const { recordSurfaceSuccess } = await import('./sharedProxyOrchestration.js');
    const result = await recordSurfaceSuccess({
      selected: {
        target: { id: 11, routeId: 22 },
        account: { id: 33, username: 'oauth-user' },
        site: { id: 44, url: 'https://upstream.example.com', platform: 'codex', name: 'Codex OAuth' },
        tokenValue: 'live-token',
        tokenName: 'default',
        actualModel: 'upstream-model',
        ...runtimeIdentity,
      },
      requestedModel: 'gpt-5.2',
      modelName: 'upstream-model',
      parsedUsage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        promptTokensIncludeCache: null,
      },
      requestStartedAtMs: 1000,
      latencyMs: 250,
      retryCount: 1,
      upstreamPath: '/v1/responses',
      logSuccess,
      recordDownstreamBilling,
      bestEffortMetrics: {
        errorLabel: '[proxy/chat] failed to record success metrics',
      },
    });

    expect(consoleErrorMock).toHaveBeenCalledWith(
      '[proxy/chat] failed to record success metrics',
      expect.any(Error),
    );
    expect(recordRouteRuntimeExecutionAttemptSuccessMock).toHaveBeenCalledWith({
      executionTargetId: 11,
      accountId: 33,
      modelName: 'upstream-model',
      latencyMs: 250,
    });
    expect(recordDownstreamBilling).not.toHaveBeenCalled();
    expect(logSuccess).toHaveBeenCalledWith(expect.objectContaining({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      estimatedCost: null,
      billingDetails: null,
    }));
    expect(result).toEqual({
      resolvedUsage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        recoveredFromSelfLog: false,
        estimatedCostFromQuota: 0,
        selfLogBillingMeta: null,
        usageSource: 'upstream',
      },
      estimatedCost: null,
      billingDetails: null,
    });
  });
});
