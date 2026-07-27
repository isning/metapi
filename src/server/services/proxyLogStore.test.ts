import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbInsertMock,
  dbInsertValuesMock,
  dbInsertRunMock,
  proxyLogsSchema,
} = vi.hoisted(() => ({
  dbInsertMock: vi.fn(),
  dbInsertValuesMock: vi.fn(),
  dbInsertRunMock: vi.fn(),
  proxyLogsSchema: {
    id: 'id',
    executionAttemptId: 'execution_attempt_id',
    accountId: 'account_id',
    modelRequested: 'model_requested',
    modelActual: 'model_actual',
    routeEntrypointId: 'route_entrypoint_id',
    runtimeEndpointId: 'runtime_endpoint_id',
    runtimeArtifactId: 'runtime_artifact_id',
    executionTargetId: 'execution_target_id',
    status: 'status',
    httpStatus: 'http_status',
    isStream: 'is_stream',
    firstByteLatencyMs: 'first_byte_latency_ms',
    latencyMs: 'latency_ms',
    promptTokens: 'prompt_tokens',
    completionTokens: 'completion_tokens',
    totalTokens: 'total_tokens',
    estimatedCost: 'estimated_cost',
    billingDetails: 'billing_details',
    clientFamily: 'client_family',
    clientAppId: 'client_app_id',
    clientAppName: 'client_app_name',
    clientConfidence: 'client_confidence',
    errorMessage: 'error_message',
    retryCount: 'retry_count',
    createdAt: 'created_at',
  },
}));

vi.mock('../db/index.js', () => ({
  db: {
    insert: (...args: unknown[]) => dbInsertMock(...args),
  },
  schema: {
    proxyLogs: proxyLogsSchema,
  },
}));

import { insertProxyLog, parseProxyLogBillingDetails, withProxyLogSelectFields } from './proxyLogStore.js';

describe('proxyLogStore', () => {
  beforeEach(() => {
    dbInsertMock.mockReset();
    dbInsertValuesMock.mockReset();
    dbInsertRunMock.mockReset();
    dbInsertMock.mockReturnValue({
      values: (...args: unknown[]) => dbInsertValuesMock(...args),
    });
    dbInsertValuesMock.mockReturnValue({
      run: (...args: unknown[]) => dbInsertRunMock(...args),
    });
  });

  it('surfaces schema drift from proxy log reads without compatibility retries', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('column proxy_logs.billing_details does not exist'));

    await expect(withProxyLogSelectFields(runner, { includeBillingDetails: true }))
      .rejects.toThrow('column proxy_logs.billing_details does not exist');
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('accepts parsed billing details objects for helper-level callers', () => {
    expect(parseProxyLogBillingDetails({
      source: 'pricing',
      usd: 1.25,
    })).toEqual({
      source: 'pricing',
      usd: 1.25,
    });
  });

  it('surfaces schema drift from proxy log writes without dropping fields', async () => {
    dbInsertRunMock.mockRejectedValueOnce(new Error('column proxy_logs.billing_details does not exist'));

    await expect(insertProxyLog({
      modelRequested: 'gpt-5',
      billingDetails: { total: 1 },
    })).rejects.toThrow('column proxy_logs.billing_details does not exist');
    expect(dbInsertValuesMock).toHaveBeenCalledTimes(1);
  });

  it('writes structured client fields when the schema supports them', async () => {
    await insertProxyLog({
      modelRequested: 'gpt-5',
      clientFamily: 'codex',
      clientAppId: 'cherry_studio',
      clientAppName: 'Cherry Studio',
      clientConfidence: 'exact',
    });

    expect(dbInsertValuesMock).toHaveBeenCalledTimes(1);
    expect(dbInsertValuesMock.mock.calls[0][0]).toMatchObject({
      modelRequested: 'gpt-5',
      clientFamily: 'codex',
      clientAppId: 'cherry_studio',
      clientAppName: 'Cherry Studio',
      clientConfidence: 'exact',
    });
  });

  it('preserves null token fields instead of coercing unknown usage to zero', async () => {
    await insertProxyLog({
      modelRequested: 'gpt-5',
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });

    expect(dbInsertValuesMock).toHaveBeenCalledTimes(1);
    expect(dbInsertValuesMock.mock.calls[0][0]).toMatchObject({
      modelRequested: 'gpt-5',
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
  });

  it.each([
    ['omitted', {}, null],
    ['explicitly unknown', { estimatedCost: null }, null],
    ['explicitly free', { estimatedCost: 0 }, 0],
  ])('persists %s billing cost without conflating unknown and free', async (_label, values, expected) => {
    await insertProxyLog({
      modelRequested: 'gpt-5',
      ...values,
    });

    expect(dbInsertValuesMock).toHaveBeenCalledTimes(1);
    expect(dbInsertValuesMock.mock.calls[0][0]).toMatchObject({
      modelRequested: 'gpt-5',
      estimatedCost: expected,
    });
  });

  it('maps runtime execution identity to first-class proxy log storage fields', async () => {
    await insertProxyLog({
      modelRequested: 'public-model',
      modelActual: 'upstream-model',
      executionAttemptId: 'rse:7',
      routeEntrypointId: 'entry:public-model',
      runtimeEndpointId: 'endpoint:upstream-model',
      runtimeArtifactId: 'runtime-artifact-42',
      executionTargetId: 7,
    });

    expect(dbInsertValuesMock).toHaveBeenCalledTimes(1);
    expect(dbInsertValuesMock.mock.calls[0][0]).toMatchObject({
      modelRequested: 'public-model',
      modelActual: 'upstream-model',
      executionAttemptId: 'rse:7',
      routeEntrypointId: 'entry:public-model',
      runtimeEndpointId: 'endpoint:upstream-model',
      runtimeArtifactId: 'runtime-artifact-42',
      executionTargetId: 7,
    });
  });

});
