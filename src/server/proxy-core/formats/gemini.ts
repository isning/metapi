import { TextDecoder } from 'node:util';
import type { BuildUpstreamRequestInput, DownstreamProtocolAdapter, ParsedDownstreamRequest, PassthroughHeadersConfig, TransformRequestContext } from './types.js';
import { extractSafePassthroughHeaders } from './headerPassthrough.js';
import { buildUpstreamEndpointRequest } from './upstreamRequestBuilder.js';
import { geminiGenerateContentTransformer, normalizeUpstreamFinalResponse } from './geminiProtocolFacade.js';
import { parseProxyUsage } from '../../services/proxyUsageParser.js';
import { resolveAntigravityPlatformAction } from '../platforms/antigravityRuntime.js';
import type { PlatformAction } from '../platforms/types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePlatform(platform: unknown): string {
  return asTrimmedString(platform).toLowerCase();
}

function isDirectGeminiFamilyPlatform(platform: unknown): boolean {
  const normalized = normalizePlatform(platform);
  return normalized === 'gemini' || normalized === 'gemini-cli' || normalized === 'antigravity';
}

function isInternalGeminiPlatform(platform: unknown): boolean {
  const normalized = normalizePlatform(platform);
  return normalized === 'gemini-cli' || normalized === 'antigravity';
}

function parseInternalAction(path: string): 'generateContent' | 'streamGenerateContent' | 'countTokens' {
  if (path.includes('countTokens')) return 'countTokens';
  if (path.includes('streamGenerateContent')) return 'streamGenerateContent';
  return 'generateContent';
}

function parseGeminiRequest(body: unknown, context?: TransformRequestContext) {
  const rawBody = isRecord(body) ? body : {};
  const downstreamPath = context?.downstreamPath || '';
  const isInternal = downstreamPath.startsWith('/v1internal');
  if (isInternal) {
    const action = parseInternalAction(downstreamPath);
    const requestedModel = asTrimmedString(rawBody.model);
    const requestBody = { ...rawBody };
    delete requestBody.model;
    const normalizedBody = action === 'countTokens'
      ? requestBody
      : geminiGenerateContentTransformer.inbound.normalizeRequest(requestBody, requestedModel);
    const openaiBody = action === 'countTokens'
      ? requestBody
      : geminiGenerateContentTransformer.compatibility.buildOpenAiBodyFromGeminiRequest({
        body: normalizedBody,
        modelName: requestedModel,
        stream: action === 'streamGenerateContent',
      });
    return {
      requestedModel,
      isStream: action === 'streamGenerateContent',
      normalizedBody,
      openaiBody,
      action,
      internalDownstream: true,
      wantsSseEnvelope: action === 'streamGenerateContent',
      apiVersion: 'v1beta',
      modelActionPath: `models/${requestedModel}:${action}`,
    };
  }

  const parsedPath = geminiGenerateContentTransformer.parseProxyRequestPath({
    rawUrl: context?.rawUrl || '',
    params: context?.params as { geminiApiVersion?: string } | undefined,
  });
  const action = parsedPath.modelActionPath.endsWith(':countTokens')
    ? 'countTokens'
    : (parsedPath.isStreamAction ? 'streamGenerateContent' : 'generateContent');
  const wantsSseEnvelope = parsedPath.isStreamAction
    && /(?:^|[?&])alt=sse(?:&|$)/i.test(context?.rawUrl || '');
  const normalizedBody = geminiGenerateContentTransformer.inbound.normalizeRequest(
    rawBody,
    parsedPath.requestedModel,
  );
  const openaiBody = geminiGenerateContentTransformer.compatibility.buildOpenAiBodyFromGeminiRequest({
    body: normalizedBody,
    modelName: parsedPath.requestedModel,
    stream: parsedPath.isStreamAction,
  });
  return {
    requestedModel: parsedPath.requestedModel,
    isStream: wantsSseEnvelope,
    normalizedBody,
    openaiBody,
    action,
    wantsSseEnvelope,
    apiVersion: parsedPath.apiVersion,
    modelActionPath: parsedPath.modelActionPath,
  };
}

function buildGeminiNativePath(input: {
  apiVersion: string;
  modelActionPath: string;
  actualModel: string;
  tokenValue: string;
  query?: Record<string, unknown>;
}) {
  const actualModelAction = input.modelActionPath.replace(
    /^models\/[^:]+/,
    `models/${input.actualModel}`,
  );
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query || {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.set(key, String(value));
    }
  }
  if (input.tokenValue && !params.has('key')) {
    params.set('key', input.tokenValue);
  }
  const suffix = params.toString();
  return `/${input.apiVersion.replace(/^\/+/, '')}/${actualModelAction.replace(/^\/+/, '')}${suffix ? `?${suffix}` : ''}`;
}

function buildInternalGeminiPath(action: 'generateContent' | 'streamGenerateContent' | 'countTokens') {
  if (action === 'countTokens') return '/v1internal:countTokens';
  if (action === 'streamGenerateContent') return '/v1internal:streamGenerateContent?alt=sse';
  return '/v1internal:generateContent';
}

const GEMINI_MODEL_PROBES = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-pro',
];

const GEMINI_CLI_STATIC_MODELS = [
  { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
  { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
  { name: 'models/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite' },
  { name: 'models/gemini-3-pro-preview', displayName: 'Gemini 3 Pro Preview' },
  { name: 'models/gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview' },
  { name: 'models/gemini-3-flash-preview', displayName: 'Gemini 3 Flash Preview' },
  { name: 'models/gemini-3.1-flash-lite-preview', displayName: 'Gemini 3.1 Flash Lite Preview' },
];

export const geminiProtocolAdapter: DownstreamProtocolAdapter = {
  format: 'gemini',
  modelListRoutes: [
    '/v1beta/models',
    '/gemini/:geminiApiVersion/models',
  ],
  modelListModelProbes: GEMINI_MODEL_PROBES,
  routes: [
    '/v1beta/models/*',
    '/gemini/:geminiApiVersion/models/*',
    '/v1internal::generateContent',
    '/v1internal::streamGenerateContent',
    '/v1internal::countTokens',
  ],
  headerRule: {},
  parseRequest(
    _body: unknown,
    _headers?: Record<string, unknown>,
    _config?: PassthroughHeadersConfig,
  ): ParsedDownstreamRequest {
    return {
      modelName: '',
      stream: false,
      standardBody: {},
    };
  },
  extractPassthroughHeaders(headers?: Record<string, unknown>, config?: PassthroughHeadersConfig): Record<string, string> {
    return extractSafePassthroughHeaders(headers, config);
  },
  buildModelListRequest(input) {
    const apiVersion = geminiGenerateContentTransformer.resolveProxyApiVersion(
      input.params as { geminiApiVersion?: string } | undefined,
    );
    return {
      url: geminiGenerateContentTransformer.resolveModelsUrl(input.siteUrl, apiVersion, input.tokenValue),
      path: `/${apiVersion}/models`,
    };
  },
  getStaticModelList(input) {
    return normalizePlatform(input.sitePlatform) === 'gemini-cli'
      ? GEMINI_CLI_STATIC_MODELS
      : null;
  },
  shouldUseLocalModelList(input) {
    return !isDirectGeminiFamilyPlatform(input.sitePlatform);
  },
  formatModelList(models) {
    return { models };
  },
  transformRequest(body: unknown, _headers?: Record<string, unknown>, context?: TransformRequestContext) {
    const parsed = parseGeminiRequest(body, context);
    if (!parsed.requestedModel) {
      return {
        error: {
          statusCode: 400,
          payload: {
            error: { message: 'Gemini model path is required', type: 'invalid_request_error' },
          },
        },
      };
    }
    return {
      value: {
        requestedModel: parsed.requestedModel,
        isStream: parsed.isStream,
        openaiBody: parsed.openaiBody,
        endpointCandidates: ['responses'],
        requestKind: 'gemini-generate-content',
        disableCrossProtocolFallback: true,
          extraContext: {
            apiVersion: parsed.apiVersion,
            modelActionPath: parsed.modelActionPath,
            normalizedBody: parsed.normalizedBody,
            action: parsed.action,
            internalDownstream: (parsed as any).internalDownstream === true,
            wantsSseEnvelope: (parsed as any).wantsSseEnvelope === true,
            query: context?.query || {},
          },
      },
    };
  },
  buildUpstreamRequest(input: BuildUpstreamRequestInput) {
    const extra = input.transformed.extraContext || {};
    let action: PlatformAction = (extra.action === 'countTokens' || extra.action === 'streamGenerateContent')
      ? extra.action
      : 'generateContent';
    const platform = normalizePlatform(input.site.platform);
    if (platform === 'antigravity') {
      action = resolveAntigravityPlatformAction(action, input.isStream, input.modelName);
    }

    if (isDirectGeminiFamilyPlatform(platform)) {
      if (isInternalGeminiPlatform(platform)) {
        if (platform === 'gemini-cli' && !input.oauth?.projectId) {
          const error = new Error('Gemini CLI OAuth project is missing') as Error & { status?: number; payload?: unknown };
          error.status = 500;
          error.payload = {
            error: {
              message: 'Gemini CLI OAuth project is missing',
              type: 'server_error',
            },
          };
          throw error;
        }
        return {
          endpoint: input.endpoint,
          path: buildInternalGeminiPath(action),
          headers: {
            ...input.platformHeaders,
            Authorization: `Bearer ${input.tokenValue}`,
            'Content-Type': 'application/json',
            ...(action === 'streamGenerateContent' ? { Accept: 'text/event-stream' } : {}),
          },
          body: action === 'countTokens'
            ? { request: extra.normalizedBody as Record<string, unknown> }
            : {
              project: input.oauth?.projectId || '',
              model: input.modelName,
              request: extra.normalizedBody as Record<string, unknown>,
            },
          runtime: {
            executor: platform === 'gemini-cli' ? 'gemini-cli' : 'antigravity',
            modelName: input.modelName,
            stream: action === 'streamGenerateContent',
            oauthProjectId: input.oauth?.projectId || null,
            action,
          },
        };
      }

      return {
        endpoint: input.endpoint,
        path: buildGeminiNativePath({
          apiVersion: asTrimmedString(extra.apiVersion) || 'v1beta',
          modelActionPath: asTrimmedString(extra.modelActionPath),
          actualModel: input.modelName,
          tokenValue: input.tokenValue,
          query: extra.query as Record<string, unknown> | undefined,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        body: extra.normalizedBody as Record<string, unknown>,
        runtime: {
          executor: 'default',
          modelName: input.modelName,
          stream: action === 'streamGenerateContent',
          action,
        },
      };
    }

    const upstreamRequest = buildUpstreamEndpointRequest({
      endpoint: input.endpoint,
      modelName: input.modelName,
      stream: input.isStream,
      tokenValue: input.tokenValue,
      oauthProvider: input.oauth?.provider,
      oauthProjectId: input.oauth?.projectId,
      sitePlatform: input.site.platform,
      siteUrl: input.site.url,
      openaiBody: input.transformed.openaiBody,
      downstreamFormat: 'gemini' as any,
      downstreamHeaders: input.downstreamHeaders,
      passthroughHeaders: input.passthroughHeaders,
      platformHeaders: input.platformHeaders,
    });
    return {
      endpoint: input.endpoint,
      path: upstreamRequest.path,
      headers: upstreamRequest.headers,
      body: upstreamRequest.body,
      runtime: upstreamRequest.runtime,
    };
  },
  createStreamSession(options: any) {
    const aggregateState = geminiGenerateContentTransformer.stream.createAggregateState();
    return {
      async run(reader: any, response: { end(): void }) {
        if (!reader) return { status: 'ok' as const };
        const decoder = new TextDecoder();
        if (options.extraContext?.internalDownstream === true) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!value) continue;
              options.writeRaw(decoder.decode(value, { stream: true }));
            }
            const tail = decoder.decode();
            if (tail) options.writeRaw(tail);
            response.end();
            return { status: 'ok' as const };
          } catch (error) {
            return {
              status: 'failed' as const,
              errorMessage: error instanceof Error ? error.message : 'Gemini stream transform failed',
            };
          }
        }
        let rest = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            const chunk = decoder.decode(value, { stream: true });
              const consumed = geminiGenerateContentTransformer.stream.consumeUpstreamSseBuffer(
                aggregateState,
                rest + chunk,
              );
              rest = consumed.rest;
              options.onParsedPayload?.(aggregateState);
              options.writeLines(consumed.lines);
          }
          const tail = decoder.decode();
          if (tail) {
            const consumed = geminiGenerateContentTransformer.stream.consumeUpstreamSseBuffer(
              aggregateState,
              rest + tail,
            );
            options.onParsedPayload?.(aggregateState);
            options.writeLines(consumed.lines);
          }
          response.end();
          return { status: 'ok' as const };
        } catch (error) {
          return {
            status: 'failed' as const,
            errorMessage: error instanceof Error ? error.message : 'Gemini stream transform failed',
          };
        }
      },
      consumeUpstreamFinalPayload(payload: unknown, _rawText: string, response: { end(): void }) {
        const serialized = payload && typeof payload === 'object' && Array.isArray((payload as any).candidates)
          ? geminiGenerateContentTransformer.outbound.serializeAggregateResponse(payload)
          : geminiGenerateContentTransformer.compatibility.serializeNormalizedFinalToGemini({
            normalized: normalizeUpstreamFinalResponse(payload, options.modelName, ''),
            usage: parseProxyUsage(payload),
          });
        const downstreamPayload = options.extraContext?.internalDownstream === true
          ? { response: serialized }
          : serialized;
        options.onParsedPayload?.(serialized);
        options.writeLines([`data: ${JSON.stringify(downstreamPayload)}\n\n`]);
        response.end();
        return { status: 'ok' as const };
      },
    };
  },
  transformResponse(options: any) {
    if (options.extraContext?.action === 'countTokens') {
      return options.upstreamBody;
    }
    if (
      options.extraContext?.action === 'streamGenerateContent'
      && options.extraContext?.wantsSseEnvelope !== true
      && Array.isArray(options.upstreamBody)
    ) {
      return options.upstreamBody;
    }
    if (typeof options.upstreamBody === 'string' && options.upstreamBody.includes('data:')) {
      const aggregateState = geminiGenerateContentTransformer.stream.createAggregateState();
      const normalizedSse = options.upstreamBody.replace(/^data:\s*(.+)$/gm, (_line: string, jsonText: string) => {
        try {
          const parsed = JSON.parse(jsonText);
          return `data: ${JSON.stringify(parsed?.response || parsed)}`;
        } catch {
          return `data: ${jsonText}`;
        }
      });
      geminiGenerateContentTransformer.stream.consumeUpstreamSseBuffer(aggregateState, normalizedSse);
      const serialized = geminiGenerateContentTransformer.outbound.serializeAggregateResponse(aggregateState);
      return options.extraContext?.internalDownstream === true ? { response: serialized } : serialized;
    }
    if (options.upstreamBody && typeof options.upstreamBody === 'object' && Array.isArray(options.upstreamBody.candidates)) {
      const serialized = geminiGenerateContentTransformer.outbound.serializeAggregateResponse(options.upstreamBody);
      return options.extraContext?.internalDownstream === true ? { response: serialized } : serialized;
    }
    const normalized = normalizeUpstreamFinalResponse(
      options.upstreamBody,
      options.modelName,
      options.fallbackText || '',
    );
    const serialized = geminiGenerateContentTransformer.compatibility.serializeNormalizedFinalToGemini({
      normalized,
      usage: parseProxyUsage(options.upstreamBody),
    });
    return options.extraContext?.internalDownstream === true ? { response: serialized } : serialized;
  },
};
