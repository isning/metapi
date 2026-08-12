import { fetch } from 'undici';
import { getProxyUrlFromExtraConfig } from '../../services/accountExtraConfig.js';
import { buildProxyBillingDetails } from '../../services/modelPricingService.js';
import {
  deleteProxyVideoTaskByPublicId,
  getProxyVideoTaskByPublicId,
  refreshProxyVideoTaskSnapshot,
  resolveProxyVideoTaskSite,
  saveProxyVideoTask,
} from '../../services/proxyVideoTaskStore.js';
import { shouldRetryProxyRequest } from '../../services/proxyRetryPolicy.js';
import { withSiteProxyRequestInit, withSiteRecordProxyRequestInit } from '../../services/siteProxy.js';
import { runWithSiteApiEndpointPool, SiteApiEndpointRequestError } from '../../services/siteApiEndpointService.js';
import type { DownstreamRoutingPolicy } from '../../services/downstreamPolicyTypes.js';
import type { DownstreamClientContext } from '../downstreamClientContext.js';
import { cloneFormDataWithOverrides } from './multipart.js';
import { buildCompiledRouteRuntimeRequestSnapshot } from '../orchestration/compiledRouteRuntimeRequest.js';
import {
  CompiledHttpSurfaceDetectedFailure,
  executeCompiledHttpSurface,
  type CompiledHttpSurfaceResult,
} from '../orchestration/compiledHttpSurfaceRunner.js';
import { buildUpstreamUrl } from '../orchestration/upstreamRequest.js';
import { readRuntimeResponseText } from '../executors/types.js';

export type VideoTaskSurfaceResult = {
  statusCode: number;
  payload?: unknown;
  contentType?: string | null;
};

function withPublicVideoId(payload: unknown, publicId: string): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  return { ...(payload as Record<string, unknown>), id: publicId };
}

export async function executeVideoCreateProxySurface(input: {
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
  const downstreamPath = '/v1/videos';
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

  return executeCompiledHttpSurface({
    warningScope: 'videos',
    downstreamPath,
    requestedModel: input.requestedModel,
    request,
    downstreamPolicy: input.downstreamPolicy,
    forcedExecutionAttemptId: input.forcedExecutionAttemptId,
    downstreamApiKeyId: input.downstreamApiKeyId,
    clientContext: input.clientContext,
    executeAttempt: async (selected) => {
      const { upstream, text, baseUrl } = await runWithSiteApiEndpointPool(selected.site, async (target) => {
        const targetUrl = buildUpstreamUrl(target.baseUrl, downstreamPath, {
          basePathMode: target.endpoint?.basePathMode as 'protocol_default' | 'complete_api_prefix' | undefined,
        });
        const accountProxy = getProxyUrlFromExtraConfig(selected.account.extraConfig);
        const requestInit = input.multipartForm
          ? withSiteRecordProxyRequestInit(selected.site, {
            method: 'POST',
            headers: { Authorization: `Bearer ${selected.tokenValue}` },
            body: cloneFormDataWithOverrides(input.multipartForm, { model: selected.actualModel }) as any,
          }, accountProxy)
          : withSiteRecordProxyRequestInit(selected.site, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${selected.tokenValue}`,
            },
            body: JSON.stringify({ ...(input.jsonBody || {}), model: selected.actualModel }),
          }, accountProxy);
        const response = await fetch(targetUrl, requestInit);
        const responseText = await readRuntimeResponseText(response);
        if (!response.ok) {
          throw new SiteApiEndpointRequestError(responseText || 'unknown error', {
            status: response.status,
            rawErrText: responseText || null,
          });
        }
        return { baseUrl: target.baseUrl, upstream: response, text: responseText };
      });
      let payload: Record<string, unknown>;
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        payload = parsed;
      } catch {
        throw new CompiledHttpSurfaceDetectedFailure('Upstream video response did not include a JSON object', {
          upstreamPath: downstreamPath,
        });
      }
      const upstreamVideoId = typeof payload.id === 'string' ? payload.id.trim() : '';
      if (!upstreamVideoId) {
        throw new CompiledHttpSurfaceDetectedFailure('Upstream video response did not include id', {
          upstreamPath: downstreamPath,
        });
      }
      const mapping = await saveProxyVideoTask({
        upstreamVideoId,
        siteUrl: baseUrl,
        tokenValue: selected.tokenValue,
        requestedModel: input.requestedModel,
        actualModel: selected.actualModel,
        executionTargetId: selected.executionTargetId,
        accountId: typeof selected.account.id === 'number' ? selected.account.id : null,
        statusSnapshot: payload,
        upstreamResponseMeta: {
          contentType: upstream.headers.get('content-type') || 'application/json',
        },
        lastUpstreamStatus: upstream.status,
      });
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
        console.warn('[proxy/videos] failed to estimate proxy cost', error);
      }
      return {
        statusCode: upstream.status,
        payload: withPublicVideoId(payload, mapping.publicId),
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

export async function executeVideoTaskReadSurface(publicId: string): Promise<VideoTaskSurfaceResult> {
  const mapping = await getProxyVideoTaskByPublicId(publicId);
  if (!mapping) return videoTaskNotFound();
  try {
    const { upstream } = await requestMappedVideoTaskUpstream(mapping, 'GET');
    const text = await readRuntimeResponseText(upstream);
    try {
      const payload = JSON.parse(text);
      await refreshProxyVideoTaskSnapshot(mapping.publicId, {
        statusSnapshot: payload,
        upstreamResponseMeta: { contentType: upstream.headers.get('content-type') || 'application/json' },
        lastUpstreamStatus: upstream.status,
      });
      return { statusCode: upstream.status, payload: withPublicVideoId(payload, mapping.publicId) };
    } catch {
      return {
        statusCode: upstream.status,
        payload: text,
        contentType: upstream.headers.get('content-type') || 'application/json',
      };
    }
  } catch (error) {
    return mapVideoTaskEndpointFailure(error);
  }
}

export async function executeVideoTaskDeleteSurface(publicId: string): Promise<VideoTaskSurfaceResult> {
  const mapping = await getProxyVideoTaskByPublicId(publicId);
  if (!mapping) return videoTaskNotFound();
  try {
    const { upstream } = await requestMappedVideoTaskUpstream(mapping, 'DELETE');
    if (upstream.ok) {
      await deleteProxyVideoTaskByPublicId(mapping.publicId);
      return { statusCode: upstream.status };
    }
    const text = await readRuntimeResponseText(upstream);
    return {
      statusCode: upstream.status,
      payload: { error: { message: text || 'Upstream delete failed', type: 'upstream_error' } },
    };
  } catch (error) {
    return mapVideoTaskEndpointFailure(error);
  }
}

async function requestMappedVideoTaskUpstream(
  mapping: NonNullable<Awaited<ReturnType<typeof getProxyVideoTaskByPublicId>>>,
  method: 'GET' | 'DELETE',
) {
  const buildRequest = async (
    baseUrl: string,
    basePathMode?: 'protocol_default' | 'complete_api_prefix',
  ) => {
    const targetUrl = buildUpstreamUrl(baseUrl, `/v1/videos/${encodeURIComponent(mapping.upstreamVideoId)}`, {
      basePathMode,
    });
    const upstream = await fetch(targetUrl, await withSiteProxyRequestInit(targetUrl, {
      method,
      headers: { Authorization: `Bearer ${mapping.tokenValue}` },
    }));
    if (!upstream.ok) {
      const errorText = await readRuntimeResponseText(upstream.clone());
      if (shouldRetryProxyRequest(upstream.status, errorText || `HTTP ${upstream.status}`)) {
        throw new SiteApiEndpointRequestError(errorText || `HTTP ${upstream.status}`, {
          status: upstream.status,
          rawErrText: errorText || null,
        });
      }
    }
    return { upstream };
  };
  const site = await resolveProxyVideoTaskSite(mapping.accountId);
  return site
    ? runWithSiteApiEndpointPool(site, (target) => buildRequest(
        target.baseUrl,
        target.endpoint?.basePathMode as 'protocol_default' | 'complete_api_prefix' | undefined,
      ))
    : buildRequest(mapping.siteUrl);
}

function videoTaskNotFound(): VideoTaskSurfaceResult {
  return { statusCode: 404, payload: { error: { message: 'Video task not found', type: 'not_found_error' } } };
}

function mapVideoTaskEndpointFailure(error: unknown): VideoTaskSurfaceResult {
  if (!(error instanceof SiteApiEndpointRequestError)
    && !(typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'SiteApiEndpointRequestError')) {
    throw error;
  }
  const failure = error as { status?: number | null; rawErrText?: string | null; message?: string | null };
  const statusCode = typeof failure.status === 'number' && failure.status > 0 ? failure.status : 502;
  const rawText = typeof failure.rawErrText === 'string' && failure.rawErrText.trim()
    ? failure.rawErrText
    : typeof failure.message === 'string' ? failure.message.trim() : '';
  if (!rawText) {
    return { statusCode, payload: { error: { message: 'Upstream request failed', type: 'upstream_error' } } };
  }
  try {
    return { statusCode, payload: JSON.parse(rawText) };
  } catch {
    return { statusCode, payload: rawText, contentType: 'text/plain' };
  }
}
