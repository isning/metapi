import { fetch } from 'undici';
import { config } from '../../config.js';
import { getProxyUrlFromExtraConfig } from '../../services/accountExtraConfig.js';
import { withSiteRecordProxyRequestInit } from '../../services/siteProxy.js';
import { runWithSiteApiEndpointPool, SiteApiEndpointRequestError } from '../../services/siteApiEndpointService.js';
import type { DownstreamRoutingPolicy } from '../../services/downstreamPolicyTypes.js';
import type { DownstreamClientContext } from '../downstreamClientContext.js';
import { fetchWithObservedFirstByte, getObservedResponseMeta } from '../firstByteTimeout.js';
import { buildCompiledRouteRuntimeRequestSnapshot } from '../orchestration/compiledRouteRuntimeRequest.js';
import { executeCompiledHttpSurface, type CompiledHttpSurfaceResult } from '../orchestration/compiledHttpSurfaceRunner.js';
import { buildUpstreamUrl } from '../orchestration/upstreamRequest.js';
import { readRuntimeResponseText } from '../executors/types.js';

export async function executeSearchProxySurface(input: {
  body: Record<string, unknown>;
  maxResults: number;
  requestedModel: string;
  downstreamPolicy: DownstreamRoutingPolicy;
  forcedExecutionAttemptId: string | null;
  downstreamApiKeyId: number | null;
  clientContext: DownstreamClientContext;
  headers: Record<string, unknown>;
  method: string;
  query: Record<string, unknown>;
}): Promise<CompiledHttpSurfaceResult> {
  const downstreamPath = '/v1/search';
  const request = buildCompiledRouteRuntimeRequestSnapshot({
    requestedModel: input.requestedModel,
    payload: input.body,
    normalizedPayload: input.body,
    headers: input.headers,
    method: input.method,
    path: downstreamPath,
    query: input.query,
    clientContext: input.clientContext,
    downstreamApiKeyId: input.downstreamApiKeyId,
  });
  const firstByteTimeoutMs = Math.max(0, Math.trunc((config.proxyFirstByteTimeoutSec || 0) * 1000));

  return executeCompiledHttpSurface({
    warningScope: 'search',
    downstreamPath,
    requestedModel: input.requestedModel,
    request,
    downstreamPolicy: input.downstreamPolicy,
    forcedExecutionAttemptId: input.forcedExecutionAttemptId,
    downstreamApiKeyId: input.downstreamApiKeyId,
    clientContext: input.clientContext,
    executeAttempt: async (selected) => {
      const forwardBody = {
        ...input.body,
        max_results: input.maxResults,
        model: selected.actualModel,
      };
      const { upstream, text, firstByteLatencyMs } = await runWithSiteApiEndpointPool(selected.site, async (target) => {
        const startedAtMs = Date.now();
        const targetUrl = buildUpstreamUrl(target.baseUrl, '/v1/search');
        const response = await fetchWithObservedFirstByte(
          async (signal) => fetch(targetUrl, withSiteRecordProxyRequestInit(selected.site, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${selected.tokenValue}`,
            },
            body: JSON.stringify(forwardBody),
            signal,
          }, getProxyUrlFromExtraConfig(selected.account.extraConfig))),
          { firstByteTimeoutMs, startedAtMs },
        );
        const observedFirstByteLatencyMs = getObservedResponseMeta(response)?.firstByteLatencyMs ?? null;
        const responseText = await readRuntimeResponseText(response);
        if (!response.ok) {
          throw new SiteApiEndpointRequestError(responseText || 'unknown error', {
            status: response.status,
            rawErrText: responseText || null,
            firstByteLatencyMs: observedFirstByteLatencyMs,
          });
        }
        return { upstream: response, text: responseText, firstByteLatencyMs: observedFirstByteLatencyMs };
      });
      let payload: unknown;
      try { payload = JSON.parse(text); } catch { payload = { data: [] }; }
      return {
        statusCode: upstream.status,
        payload,
        firstByteLatencyMs,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        upstreamPath: '/v1/search',
      };
    },
  });
}
