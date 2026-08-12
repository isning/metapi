import { fetch } from 'undici';
import { config } from '../../config.js';
import { getProxyUrlFromExtraConfig } from '../../services/accountExtraConfig.js';
import { buildProxyBillingDetails } from '../../services/modelPricingService.js';
import { withSiteRecordProxyRequestInit } from '../../services/siteProxy.js';
import { runWithSiteApiEndpointPool, SiteApiEndpointRequestError } from '../../services/siteApiEndpointService.js';
import type { DownstreamRoutingPolicy } from '../../services/downstreamPolicyTypes.js';
import type { DownstreamClientContext } from '../downstreamClientContext.js';
import { fetchWithObservedFirstByte, getObservedResponseMeta } from '../firstByteTimeout.js';
import { cloneFormDataWithOverrides } from './multipart.js';
import { buildCompiledRouteRuntimeRequestSnapshot } from '../orchestration/compiledRouteRuntimeRequest.js';
import {
  CompiledHttpSurfaceDetectedFailure,
  executeCompiledHttpSurface,
  type CompiledHttpSurfaceResult,
} from '../orchestration/compiledHttpSurfaceRunner.js';
import { buildUpstreamUrl } from '../orchestration/upstreamRequest.js';
import { readRuntimeResponseText } from '../executors/types.js';

export async function executeImagesEditProxySurface(input: {
  multipartForm: FormData | null;
  jsonBody: Record<string, unknown> | null;
  requestPayload: Record<string, unknown>;
  requestedModel: string;
  downstreamPolicy: DownstreamRoutingPolicy;
  forcedExecutionAttemptId: string | null;
  downstreamApiKeyId: number | null;
  clientContext: DownstreamClientContext;
  headers: Record<string, unknown>;
  method: string;
  query: Record<string, unknown>;
}): Promise<CompiledHttpSurfaceResult> {
  const downstreamPath = '/v1/images/edits';
  const request = buildCompiledRouteRuntimeRequestSnapshot({
    requestedModel: input.requestedModel,
    payload: input.requestPayload,
    normalizedPayload: input.requestPayload,
    headers: input.headers,
    method: input.method,
    path: downstreamPath,
    query: input.query,
    clientContext: input.clientContext,
    downstreamApiKeyId: input.downstreamApiKeyId,
  });
  const firstByteTimeoutMs = Math.max(0, Math.trunc((config.proxyFirstByteTimeoutSec || 0) * 1000));

  return executeCompiledHttpSurface({
    warningScope: 'images',
    downstreamPath,
    requestedModel: input.requestedModel,
    request,
    downstreamPolicy: input.downstreamPolicy,
    forcedExecutionAttemptId: input.forcedExecutionAttemptId,
    downstreamApiKeyId: input.downstreamApiKeyId,
    clientContext: input.clientContext,
    executeAttempt: async (selected) => {
      const { upstream, text, firstByteLatencyMs } = await runWithSiteApiEndpointPool(selected.site, async (target) => {
        const startedAtMs = Date.now();
        const targetUrl = buildUpstreamUrl(target.baseUrl, downstreamPath, {
          basePathMode: target.endpoint?.basePathMode as 'protocol_default' | 'complete_api_prefix' | undefined,
        });
        const requestInit = input.multipartForm
          ? withSiteRecordProxyRequestInit(selected.site, {
            method: 'POST',
            headers: { Authorization: `Bearer ${selected.tokenValue}` },
            body: cloneFormDataWithOverrides(input.multipartForm, { model: selected.actualModel }) as any,
          }, getProxyUrlFromExtraConfig(selected.account.extraConfig))
          : withSiteRecordProxyRequestInit(selected.site, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${selected.tokenValue}`,
            },
            body: JSON.stringify({ ...(input.jsonBody || {}), model: selected.actualModel }),
          }, getProxyUrlFromExtraConfig(selected.account.extraConfig));
        const response = await fetchWithObservedFirstByte(
          async (signal) => fetch(targetUrl, { ...requestInit, signal }),
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
      try {
        payload = JSON.parse(text);
      } catch {
        throw new CompiledHttpSurfaceDetectedFailure(text || 'Upstream returned malformed JSON', {
          firstByteLatencyMs,
          upstreamPath: downstreamPath,
        });
      }
      let billingDetails: Awaited<ReturnType<typeof buildProxyBillingDetails>> = null;
      try {
        billingDetails = await buildProxyBillingDetails({
          site: selected.site,
          account: selected.account,
          tokenId: selected.token?.id ?? selected.target.tokenId ?? null,
          upstreamGroup: selected.token?.tokenGroup ?? null,
          modelName: selected.actualModel,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        });
      } catch (error) {
        console.warn('[proxy/images] failed to estimate proxy cost', error);
      }
      return {
        statusCode: upstream.status,
        payload,
        firstByteLatencyMs,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        ...(billingDetails ? {
          estimatedCost: billingDetails.quote.amount,
          billingDetails,
        } : {}),
        upstreamPath: downstreamPath,
      };
    },
  });
}
