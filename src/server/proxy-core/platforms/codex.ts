import type { PreparedPlatformRequest, PreparePlatformRequestInput, PlatformProfile } from './types.js';
import { config } from '../../config.js';
import { buildCodexRuntimeHeaders, getInputHeader, getCodexSessionHeaderValue } from './headers.js';
import { runCodexHttpSessionTask } from '../runtime/codexHttpSessionQueue.js';

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const codexPlatformProfile: PlatformProfile = {
  id: 'codex',
  prepareRequest(input: PreparePlatformRequestInput): PreparedPlatformRequest {
    const isCodexOauth = asTrimmedString(input.oauthProvider).toLowerCase() === 'codex';
    const websocketTransport = input.responsesWebsocketTransport === true;
    const configuredUserAgent = isCodexOauth ? asTrimmedString(config.codexHeaderDefaults.userAgent) : '';
    const configuredBetaFeatures = (
      isCodexOauth && websocketTransport
        ? asTrimmedString(config.codexHeaderDefaults.betaFeatures)
        : ''
    );
    const downstreamHeaders = (input.downstreamHeaders || {}) as Record<string, string>;
    const baseHeaders = (input.baseHeaders || {}) as Record<string, string>;
    const platformHeaders = (input.platformHeaders || {}) as Record<string, string>;

    const headers = buildCodexRuntimeHeaders({
      baseHeaders: baseHeaders,
      platformHeaders,
      stream: input.stream,
      explicitSessionId: asTrimmedString(input.codexExplicitSessionId) || null,
      continuityKey: asTrimmedString(input.codexSessionCacheKey) || null,
      userAgentOverride: configuredUserAgent || null,
      codexBetaFeatures: getInputHeader(downstreamHeaders, 'x-codex-beta-features') || configuredBetaFeatures,
      codexTurnState: getInputHeader(downstreamHeaders, 'x-codex-turn-state'),
      codexTurnMetadata: getInputHeader(downstreamHeaders, 'x-codex-turn-metadata'),
      timingMetrics: getInputHeader(downstreamHeaders, 'x-responsesapi-include-timing-metrics'),
      openAiBeta: getInputHeader(downstreamHeaders, 'openai-beta')
        || (websocketTransport ? asTrimmedString(config.codexResponsesWebsocketBeta) : null),
    });

    const body = input.openaiBody;

    let path = '/responses';
    if (input.targetPath?.endsWith('/chat/completions')) {
      path = '/chat/completions';
    }

    return {
      path,
      headers,
      body,
      runtime: {
        executor: 'codex',
        modelName: input.modelName,
        stream: input.stream,
        oauthProjectId: asTrimmedString(input.oauthProjectId) || null,
      },
    };
  },
  async runSessionTask<T>(
    context: {
      siteId: number;
      accountId: number;
      channelId: number;
      headers: Record<string, string>;
      codexSessionStoreKey?: string | null;
    },
    task: () => Promise<T>
  ): Promise<T> {
    const sessionId = getCodexSessionHeaderValue(context.headers);
    return runCodexHttpSessionTask(
      context.codexSessionStoreKey || sessionId,
      task
    );
  },
  shouldTryOAuthRecovery(options: {
    status: number;
    response: { headers: { get(name: string): string | null } };
    rawErrText: string;
  }): boolean {
    if (options.status === 401) return true;
    if (options.status !== 403) return false;
    const authenticate = options.response.headers.get('www-authenticate') || '';
    const combined = `${authenticate}\n${options.rawErrText || ''}`;
    return /\b(invalid_token|expired_token|expired|invalid|unauthorized|account mismatch|authentication)\b/i.test(combined);
  },
};
