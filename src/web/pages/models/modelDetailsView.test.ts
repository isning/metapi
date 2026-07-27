import { describe, expect, it } from 'vitest';
import {
  buildModelDetailsView,
  resolveModelDisplayMetrics,
  resolveVisiblePerformanceObservability,
  type ModelRow,
} from './modelDetailsView.js';
import type { ModelRouteFlowData } from '../../components/ModelRouteFlow.js';
import type { ModelRouteFlowDiagnostics, ModelRuntimeObservability } from '../../api.js';

function model(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    name: 'public-model',
    accountCount: 1,
    tokenCount: 1,
    managedTokenCount: 1,
    credentialCount: 1,
    endpointCount: 1,
    executionAttemptCount: 1,
    avgLatency: null,
    successRate: null,
    description: null,
    tags: [],
    supportedEndpointTypes: [],
    runtimeInventoryIssues: [],
    pricingSources: [{
      siteId: 1,
      siteName: 'fallback',
      accountId: 1,
      username: null,
      ownerBy: null,
      enableGroups: ['default'],
      groupPricing: {
        default: {
          quotaType: 0,
          inputPerMillion: 1,
          outputPerMillion: 2,
        },
      },
    }],
    measuredEntryPricing: null,
    accounts: [],
    siteCounts: {},
    ...overrides,
  };
}

function observability(overrides: Partial<ModelRuntimeObservability> = {}): ModelRuntimeObservability {
  return {
    requestedModel: 'public-model',
    matched: true,
    entry: {
      entryId: 'entry:route-fixture:public-model',
      displayName: 'public-model',
      requestedModel: 'public-model',
      actualModel: 'upstream-model',
    },
    health: {
      status: 'healthy',
      successRate: 100,
      totalCalls: 2,
      successCalls: 2,
      failedCalls: 0,
      avgLatencyMs: 200,
      latencySamples: 2,
      avgFirstTokenLatencyMs: 120,
      firstTokenLatencySamples: 2,
      avgOutputTokensPerSecond: 24,
      outputTokens: 96,
      outputTokenDurationMs: 4000,
      outputTokenSamples: 2,
      source: 'entry_projection',
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
      emptyReason: 'no_logs',
    },
    diagnostics: [],
    ...overrides,
  };
}

function routeFlowWithTheoreticalPricing(): ModelRouteFlowData {
  return {
    requestedModel: 'public-model',
    matched: true,
    diagnostics: [],
    compiledRuntime: null,
    projectedAt: '2026-06-20T00:00:00.000Z',
    entryPricing: {
      theoretical: {
        currency: 'USD',
        inputPerMillion: 8,
        outputPerMillion: 16,
        cacheReadPerMillion: 1,
        cacheWritePerMillion: null,
        reasoningPerMillion: 3,
        requestCost: 0.002,
        totalCost: 12,
        inputMultiplier: 4,
        outputMultiplier: 8,
        totalMultiplier: 3,
        components: [
          { componentId: 'input', kind: 'input_tokens', quantity: 1000000, scale: 1000000, currency: 'USD', unitPrice: 8, cost: 8, role: 'charge' },
          { componentId: 'output', kind: 'output_tokens', quantity: 1000000, scale: 1000000, currency: 'USD', unitPrice: 16, cost: 16, role: 'charge' },
          { componentId: 'cache_read', kind: 'cache_read_tokens', quantity: 500000, scale: 1000000, currency: 'USD', unitPrice: 1, cost: 0.5, role: 'charge' },
          { componentId: 'reasoning', kind: 'reasoning_tokens', quantity: 250000, scale: 1000000, currency: 'USD', unitPrice: 3, cost: 0.75, role: 'charge' },
          { componentId: 'request', kind: 'request', quantity: 1, scale: 1, currency: 'USD', unitPrice: 0.002, cost: 0.002, role: 'charge' },
        ],
        usage: {
          inputTokens: 1000000,
          outputTokens: 1000000,
          cacheReadTokens: 500000,
          reasoningTokens: 250000,
          requestCount: 1,
        },
        reference: {
          currency: 'USD',
          inputPerMillion: 2,
          outputPerMillion: 2,
          cacheReadPerMillion: null,
          cacheWritePerMillion: null,
          reasoningPerMillion: null,
          requestCost: null,
          totalCost: 4,
        },
        effectiveCost: null,
        sourceCount: 2,
        estimateLevel: 'exact',
        selectionMode: 'weighted',
        diagnostics: [],
        executionAttempts: [],
      },
    },
  };
}

describe('modelDetailsView pricing', () => {
  it('derives measured preview total and total multiplier from measured input/output rates', () => {
    const details = buildModelDetailsView({
      model: model({
        measuredEntryPricing: {
          currency: 'USD',
          inputPerMillion: 0.7,
          outputPerMillion: 1.4,
          totalCost: 2.1,
          inputMultiplier: 0.2,
          outputMultiplier: 0.4,
          totalMultiplier: 0.3,
          sampleCount: 1,
          lastMeasuredAt: '2026-06-23T00:00:00.000Z',
        },
      }),
      brandName: null,
      routeFlow: null,
      routeFlowLoading: false,
      routeFlowError: '',
      observability: null,
      observabilityLoading: false,
      observabilityError: '',
    });

    expect(details.pricing.measured).toMatchObject({
      inputPerMillion: 0.7,
      outputPerMillion: 1.4,
      totalCost: 2.1,
      inputMultiplier: 0.2,
      outputMultiplier: 0.4,
      totalMultiplier: 0.3,
      sampleCount: 1,
    });
    expect(details.pricing.theoretical).toBeNull();
  });

  it('uses route-flow probability weighted theoretical entry pricing before metadata fallback', () => {
    const details = buildModelDetailsView({
      model: model(),
      brandName: null,
      routeFlow: routeFlowWithTheoreticalPricing(),
      routeFlowLoading: false,
      routeFlowError: '',
      observability: null,
      observabilityLoading: false,
      observabilityError: '',
    });

    expect(details.pricing.theoretical).toMatchObject({
      inputPerMillion: 8,
      outputPerMillion: 16,
      totalCost: 12,
      selectionMode: 'weighted',
      estimateLevel: 'exact',
      sourceCount: 2,
      cacheReadPerMillion: 1,
      reasoningPerMillion: 3,
    });
    expect(details.diagnosticsPayload).toBe(details.routeFlow);
  });

  it('keeps incomplete route-flow theoretical pricing instead of falling back to marketplace metadata', () => {
    const flow = routeFlowWithTheoreticalPricing();
    flow.entryPricing!.theoretical = {
      ...flow.entryPricing!.theoretical!,
      inputPerMillion: null,
      outputPerMillion: null,
      totalCost: null,
      inputMultiplier: null,
      outputMultiplier: null,
      totalMultiplier: null,
      sourceCount: 2,
      estimateLevel: 'incomplete',
    };

    const details = buildModelDetailsView({
      model: model(),
      brandName: null,
      routeFlow: flow,
      routeFlowLoading: false,
      routeFlowError: '',
      observability: null,
      observabilityLoading: false,
      observabilityError: '',
    });

    expect(details.pricing.theoretical).toMatchObject({
      inputPerMillion: null,
      outputPerMillion: null,
      totalCost: null,
      inputMultiplier: null,
      outputMultiplier: null,
      sourceCount: 2,
      estimateLevel: 'incomplete',
    });
    expect(details.diagnosticsPayload).toBe(flow);
  });

  it('uses compiled runtime observability for model status before marketplace metrics', () => {
    const details = buildModelDetailsView({
      model: model({
        successRate: 20,
        avgLatency: 9000,
      }),
      brandName: null,
      routeFlow: null,
      routeFlowLoading: false,
      routeFlowError: '',
      observability: observability({
        health: {
          ...observability().health,
          status: 'healthy',
          successRate: 100,
          avgLatencyMs: 180,
        },
      }),
      observabilityLoading: false,
      observabilityError: '',
    });

    expect(details.status).toBe('healthy');
    expect(details.observability?.health.successRate).toBe(100);
  });

  it('exposes prefetched diagnostics entries separately from the full JSON payload lifecycle', () => {
    const routeDiagnostics: ModelRouteFlowDiagnostics = {
      requestedModel: 'public-model',
      actualModel: 'public-model',
      matched: true,
      entryId: 'entry:route-fixture:public-model',
      selectedEndpointId: null,
      selectedAccountId: null,
      diagnostics: [{ level: 'info', message: 'prefetched diagnostics' }],
      projectedAt: '2026-07-07T00:00:00.000Z',
    };
    const details = buildModelDetailsView({
      model: model(),
      brandName: null,
      routeFlow: null,
      routeFlowDiagnostics: routeDiagnostics,
      routeFlowLoading: true,
      routeFlowError: '',
      observability: null,
      observabilityLoading: false,
      observabilityError: '',
    });

    expect(details.diagnosticsView.items).toEqual(routeDiagnostics.diagnostics);
    expect(details.diagnosticsView.itemsLoading).toBe(false);
    expect(details.diagnosticsView.payload).toBeNull();
    expect(details.diagnosticsView.payloadLoading).toBe(true);
  });

  it('surfaces compiled runtime inventory issues in diagnostics without route-flow payload fallback', () => {
    const details = buildModelDetailsView({
      model: model({
        runtimeInventoryIssues: [{
          level: 'warn',
          code: 'compiled_runtime_invalid_execution_attempt',
          reason: 'missing_execution_target_id',
          alternativeId: 'alt:bad',
          executionAttemptId: null,
          executionTargetId: null,
          endpointId: 'endpoint:bad',
          modelName: null,
        }],
      }),
      brandName: null,
      routeFlow: null,
      routeFlowLoading: false,
      routeFlowError: '',
      observability: null,
      observabilityLoading: false,
      observabilityError: '',
    });

    expect(details.diagnosticsView.items).toEqual([
      expect.objectContaining({
        level: 'warn',
        message: expect.stringContaining('缺少执行目标 ID'),
      }),
    ]);
    expect(details.diagnosticsView.payload).toBeNull();
  });

  it('exposes route flow state for display components without requiring tab-level loading logic', () => {
    const flow = routeFlowWithTheoreticalPricing();
    const details = buildModelDetailsView({
      model: model(),
      brandName: null,
      routeFlow: flow,
      routeFlowLoading: true,
      routeFlowError: '',
      observability: null,
      observabilityLoading: false,
      observabilityError: '',
    });

    expect(details.routing).toMatchObject({
      flow,
      loading: true,
      refreshing: true,
      error: '',
      hasContent: true,
    });
    expect(details.overview.routeSummaryRefreshing).toBe(false);
  });

  it('uses upper-layer performance observability as the only data source for performance display state', () => {
    const runtime = observability();
    const details = buildModelDetailsView({
      model: model(),
      brandName: null,
      routeFlow: null,
      routeFlowLoading: false,
      routeFlowError: '',
      observability: null,
      observabilityLoading: false,
      observabilityError: '',
      performanceObservability: runtime,
      performanceObservabilityLoading: true,
      performanceObservabilityError: '',
    });

    expect(details.performance.observability).toBe(runtime);
    expect(details.performance.refreshing).toBe(true);
    expect(details.performance.initialLoading).toBe(false);
    expect(details.performance.successRate).toBe(100);
  });

  it('resolves visible performance observability only while the selected range is pending', () => {
    const runtime = observability();
    const settledByModel = { 'public-model': runtime };

    expect(resolveVisiblePerformanceObservability({
      modelName: 'public-model',
      current: null,
      currentLoaded: false,
      currentLoading: false,
      currentError: '',
      settledByModel,
    })).toBe(runtime);
    expect(resolveVisiblePerformanceObservability({
      modelName: 'public-model',
      current: null,
      currentLoaded: true,
      currentLoading: false,
      currentError: '',
      settledByModel,
    })).toBeNull();
    expect(resolveVisiblePerformanceObservability({
      modelName: 'other-model',
      current: null,
      currentLoaded: false,
      currentLoading: true,
      currentError: '',
      settledByModel,
    })).toBeNull();
  });

  it('does not fall back to stale marketplace health when runtime observability has no entry samples', () => {
    const metrics = resolveModelDisplayMetrics({
      observability: observability({
        health: {
          ...observability().health,
          status: 'unknown',
          source: 'none',
          totalCalls: 0,
          successCalls: 0,
          failedCalls: 0,
          successRate: null,
          avgLatencyMs: null,
          latencySamples: 0,
        },
      }),
    });

    expect(metrics).toEqual({
      successRate: null,
      avgLatency: null,
      avgFirstTokenLatency: null,
      avgOutputTokensPerSecond: null,
    });
  });

  it('does not use marketplace metrics when runtime observability has not loaded', () => {
    const metrics = resolveModelDisplayMetrics({
      observability: null,
    });

    expect(metrics).toEqual({
      successRate: null,
      avgLatency: null,
      avgFirstTokenLatency: null,
      avgOutputTokensPerSecond: null,
    });
  });

  it('uses runtime status for degraded executable entries', () => {
    const details = buildModelDetailsView({
      model: model({
        successRate: 20,
        avgLatency: 900,
      }),
      brandName: null,
      routeFlow: null,
      routeFlowLoading: false,
      routeFlowError: '',
      observability: observability({
        health: {
          ...observability().health,
          status: 'degraded',
          successRate: 50,
          totalCalls: 2,
          successCalls: 1,
          failedCalls: 1,
        },
      }),
      observabilityLoading: false,
      observabilityError: '',
    });

    expect(details.status).toBe('degraded');
  });

  it('does not infer detail status from marketplace metrics before runtime observability loads', () => {
    const details = buildModelDetailsView({
      model: model({
        successRate: 20,
        avgLatency: 9000,
      }),
      brandName: null,
      routeFlow: null,
      routeFlowLoading: false,
      routeFlowError: '',
      observability: null,
      observabilityLoading: false,
      observabilityError: '',
    });

    expect(details.status).toBe('unknown');
  });
});
