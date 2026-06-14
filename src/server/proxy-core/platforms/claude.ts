import type { PreparedPlatformRequest, PreparePlatformRequestInput, PlatformProfile } from './types.js';
import {
  buildClaudeRuntimeHeaders,
  CLAUDE_API_KEY_DEFAULT_BETA_HEADER,
  CLAUDE_DEFAULT_BETA_HEADER,
  CLAUDE_TOKEN_COUNTING_BETA,
  getInputHeader,
} from './headers.js';
import { extractClaudePassthroughHeaders } from '../formats/headerPassthrough.js';

export const claudePlatformProfile: PlatformProfile = {
  id: 'claude',
  prepareRequest(input: PreparePlatformRequestInput): PreparedPlatformRequest {
    const isCountTokens = input.action === 'countTokens' || input.targetPath?.endsWith('/count_tokens');
    const path = input.targetPath || (isCountTokens ? '/v1/messages/count_tokens?beta=true' : '/v1/messages');

    const downstreamHeaders = (input.downstreamHeaders || {}) as Record<string, string>;
    const baseHeaders = (input.baseHeaders || {}) as Record<string, string>;
    const platformHeaders = (input.platformHeaders || {}) as Record<string, string>;

    const claudeHeaders = {
      ...extractClaudePassthroughHeaders(downstreamHeaders),
      ...platformHeaders,
    };

    const anthropicVersion = (
      getInputHeader(claudeHeaders, 'anthropic-version') ||
      '2023-06-01'
    );
    const isClaudeOauthUpstream = input.sitePlatform?.trim().toLowerCase() === 'claude'
      && input.oauthProvider === 'claude';

    const body = input.openaiBody;

    return {
      path,
      headers: buildClaudeRuntimeHeaders({
        baseHeaders: baseHeaders,
        claudeHeaders: claudeHeaders,
        anthropicVersion,
        stream: isCountTokens ? false : input.stream,
        isClaudeOauthUpstream,
        tokenValue: input.tokenValue,
        defaultBetaHeader: isClaudeOauthUpstream
          ? CLAUDE_DEFAULT_BETA_HEADER
          : CLAUDE_API_KEY_DEFAULT_BETA_HEADER,
        ...(isCountTokens ? { extraBetas: [CLAUDE_TOKEN_COUNTING_BETA] } : {}),
      }),
      body,
      runtime: {
        executor: 'claude',
        modelName: input.modelName,
        stream: isCountTokens ? false : input.stream,
        oauthProjectId: null,
        ...(isCountTokens ? { action: 'countTokens' } : {}),
      },
    };
  },
};
