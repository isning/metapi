import { reportProxyAllFailed } from '../../services/alertService.js';
import { getProxyMaxTargetRetries } from '../../services/proxyTargetRetry.js';
import { SiteApiEndpointRequestError } from '../../services/siteApiEndpointService.js';
import {
  recordRouteRuntimeExecutionAttemptSuccess,
  type RouteRuntimeExecutionAttempt,
} from '../../services/routeRuntimeExecutionService.js';
import type { RouteExecutionScope } from '../../services/routeExecutionScopeTypes.js';
import type { CompiledRouteRuntimeRequest } from '../../services/compiledRuntimeRequestTypes.js';
import {
  bindCompiledRuntimeExecutionDecision,
  completeCompiledRuntimeExecutionSession,
  startCompiledRuntimeExecutionSession,
} from '../../services/compiledRuntimeExecutionSessionService.js';
import type { DownstreamRoutingPolicy } from '../../services/downstreamPolicyTypes.js';
import type { DownstreamClientContext } from '../downstreamClientContext.js';
import { recordManagedKeyBillingUsage } from '../../services/downstreamApiKeyService.js';
import {
  buildForcedExecutionAttemptUnavailableMessage,
  canRetryExecutionAttemptSelection,
} from '../executionAttemptSelection.js';
import {
  bindSurfaceStickyTarget,
  buildSurfaceStickySessionKey,
  clearSurfaceStickyTarget,
  createSurfaceRuntimeDecisionSession,
  createSurfaceFailureToolkit,
  getSurfaceStickyPreferredTargetId,
  markSurfaceExecutionAttemptStarted,
  previewSurfaceRuntimeDecisionInSession,
  selectSurfaceRuntimeDecisionInSession,
} from './sharedProxyOrchestration.js';

export type CompiledHttpSurfaceSuccess = {
  statusCode: number;
  payload: unknown;
  firstByteLatencyMs?: number | null;
  firstTokenLatencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  billingDetails?: unknown;
  upstreamPath?: string | null;
};

export type CompiledHttpSurfaceResult = {
  statusCode: number;
  payload: unknown;
};

export class CompiledHttpSurfaceDetectedFailure extends Error {
  readonly status: number;
  readonly firstByteLatencyMs: number | null;
  readonly upstreamPath: string | null;

  constructor(message: string, input?: {
    status?: number;
    firstByteLatencyMs?: number | null;
    upstreamPath?: string | null;
  }) {
    super(message);
    this.name = 'CompiledHttpSurfaceDetectedFailure';
    this.status = input?.status ?? 502;
    this.firstByteLatencyMs = input?.firstByteLatencyMs ?? null;
    this.upstreamPath = input?.upstreamPath ?? null;
  }
}

export async function executeCompiledHttpSurface(input: {
  warningScope: string;
  downstreamPath: string;
  requestedModel: string;
  request: CompiledRouteRuntimeRequest;
  downstreamPolicy: DownstreamRoutingPolicy;
  forcedExecutionAttemptId: string | null;
  downstreamApiKeyId: number | null;
  clientContext: DownstreamClientContext;
  executeAttempt: (attempt: RouteRuntimeExecutionAttempt) => Promise<CompiledHttpSurfaceSuccess>;
}): Promise<CompiledHttpSurfaceResult> {
  const stickySessionKey = buildSurfaceStickySessionKey({
    clientContext: input.clientContext,
    requestedModel: input.requestedModel,
    downstreamPath: input.downstreamPath,
    downstreamApiKeyId: input.downstreamApiKeyId,
  });
  const excludeTargetIds: number[] = [];
  let retryCount = 0;
  let routeExecutionScope: RouteExecutionScope | null = null;
  const executionSession = await startCompiledRuntimeExecutionSession({
    downstreamPath: input.downstreamPath,
    requestedModel: input.requestedModel,
    isStream: false,
    downstreamApiKeyId: input.downstreamApiKeyId,
  });
  const runtimeDecisionSession = await createSurfaceRuntimeDecisionSession({
    requestedModel: input.requestedModel,
    request: input.request,
    downstreamPolicy: input.downstreamPolicy,
    forcedExecutionAttemptId: input.forcedExecutionAttemptId,
    stickyExecutionTargetId: getSurfaceStickyPreferredTargetId(stickySessionKey),
  });
  const failureToolkit = createSurfaceFailureToolkit({
    requestId: executionSession.requestId,
    executionSession,
    warningScope: input.warningScope,
    downstreamPath: input.downstreamPath,
    clientContext: input.clientContext,
    downstreamApiKeyId: input.downstreamApiKeyId,
  });
  const canContinue = async (status: number, message: string) => (
    failureToolkit.isRetryable(status, message)
    && canRetryExecutionAttemptSelection(retryCount, input.forcedExecutionAttemptId)
    && await previewSurfaceRuntimeDecisionInSession({
      session: runtimeDecisionSession,
      excludeTargetIds,
      retryCount: retryCount + 1,
      routeExecutionScope,
    }) !== null
  );

  while (retryCount <= getProxyMaxTargetRetries()) {
    const decision = await selectSurfaceRuntimeDecisionInSession({
      session: runtimeDecisionSession,
      excludeTargetIds,
      retryCount,
      routeExecutionScope,
    });
    if (decision?.kind === 'synthetic_response') {
      await completeCompiledRuntimeExecutionSession(executionSession, {
        status: 'failure',
        httpStatus: decision.statusCode,
        isStream: false,
        errorMessage: decision.message,
      });
      return {
        statusCode: decision.statusCode,
        payload: { error: { message: decision.message, type: 'server_error' } },
      };
    }
    const selected = decision?.kind === 'execution_attempt' ? decision.attempt : null;
    if (!selected) {
      const message = buildForcedExecutionAttemptUnavailableMessage(input.forcedExecutionAttemptId);
      await reportProxyAllFailed({
        model: input.requestedModel,
        reason: input.forcedExecutionAttemptId ? message : 'No available execution attempts after retries',
      });
      await completeCompiledRuntimeExecutionSession(executionSession, {
        status: 'failure',
        httpStatus: 503,
        isStream: false,
        errorMessage: message,
      });
      return { statusCode: 503, payload: { error: { message, type: 'server_error' } } };
    }

    excludeTargetIds.push(selected.target.id);
    routeExecutionScope = selected.routeExecutionScope ?? routeExecutionScope;
    await bindCompiledRuntimeExecutionDecision({
      requestId: executionSession.requestId,
      routeEntrypointId: selected.routeEntrypointId,
      runtimeEndpointId: selected.runtimeEndpointId,
      executionAttemptId: selected.executionAttemptId,
      runtimeBundleHash: selected.routeRuntimeSnapshot.compiledRuntime.bundleHash,
      decisionSnapshot: selected.routeRuntimeSnapshot,
    });
    const startedAtMs = Date.now();
    try {
      await markSurfaceExecutionAttemptStarted({ selected });
      const success = await input.executeAttempt(selected);
      const latencyMs = Date.now() - startedAtMs;
      await recordBestEffort(input.warningScope, 'record execution attempt success', () => (
        recordRouteRuntimeExecutionAttemptSuccess({
          executionTargetId: selected.executionTargetId,
          accountId: selected.account.id,
          latencyMs,
        })
      ));
      bindSurfaceStickyTarget({ stickySessionKey, selected });
      await failureToolkit.log({
        selected,
        modelRequested: input.requestedModel,
        status: 'success',
        httpStatus: success.statusCode,
        isStream: false,
        firstByteLatencyMs: success.firstByteLatencyMs ?? null,
        firstTokenLatencyMs: success.firstTokenLatencyMs ?? null,
        latencyMs,
        errorMessage: null,
        retryCount,
        promptTokens: success.promptTokens ?? null,
        completionTokens: success.completionTokens ?? null,
        totalTokens: success.totalTokens ?? null,
        estimatedCost: success.estimatedCost ?? undefined,
        billingDetails: success.billingDetails,
        upstreamPath: success.upstreamPath ?? input.downstreamPath,
      });
      if (input.downstreamApiKeyId != null && success.billingDetails != null) {
        await recordBestEffort(input.warningScope, 'record downstream billing usage', () => (
          recordManagedKeyBillingUsage({
            keyId: input.downstreamApiKeyId!,
            billingDetails: success.billingDetails,
            siteId: selected.site.id,
            accountId: selected.account.id,
          })
        ));
      }
      return {
        statusCode: success.statusCode,
        payload: success.payload,
      };
    } catch (error: any) {
      const detected = error instanceof CompiledHttpSurfaceDetectedFailure;
      const upstream = error instanceof SiteApiEndpointRequestError;
      const status = detected ? error.status : upstream ? (error.status || 502) : 502;
      const message = error?.message || 'network failure';
      const firstByteLatencyMs = detected
        ? error.firstByteLatencyMs
        : upstream
          ? error.firstByteLatencyMs
          : null;
      const willContinue = await canContinue(status, message);
      const outcome = detected
        ? await failureToolkit.handleDetectedFailure({
          selected,
          requestedModel: input.requestedModel,
          modelName: selected.actualModel,
          failure: { status, reason: message },
          isStream: false,
          firstByteLatencyMs,
          latencyMs: Date.now() - startedAtMs,
          retryCount,
          willContinue,
          upstreamPath: error.upstreamPath ?? input.downstreamPath,
        })
        : await failureToolkit.handleUpstreamFailure({
          selected,
          requestedModel: input.requestedModel,
          modelName: selected.actualModel,
          status,
          errText: message,
          rawErrText: upstream ? error.rawErrText : message,
          isStream: false,
          firstByteLatencyMs,
          latencyMs: Date.now() - startedAtMs,
          retryCount,
          willContinue,
        });
      if (outcome.action === 'retry') {
        clearSurfaceStickyTarget({ stickySessionKey, selected });
        retryCount += 1;
        continue;
      }
      return { statusCode: outcome.status, payload: outcome.payload };
    }
  }

  throw new Error(`${input.warningScope} compiled runtime loop exhausted without a terminal result`);
}

async function recordBestEffort(
  warningScope: string,
  label: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    console.warn(`[proxy/${warningScope}] failed to ${label}`, error);
  }
}
