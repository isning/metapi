import type { PreparedPlatformRequest, PreparePlatformRequestInput, PlatformAction, PlatformProfile } from './types.js';
import { resolveAntigravityPlatformAction } from './antigravityRuntime.js';
import { protocolAdapters } from '../formats/protocolAdapters.js';
import { nativeReasoningCompatibilityPolicy } from './compatibilityPolicy.js';

const ANTIGRAVITY_RUNTIME_USER_AGENT = 'antigravity/1.19.6 darwin/arm64';

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolvePath(action: PlatformAction): string {
  if (action === 'countTokens') return '/v1internal:countTokens';
  if (action === 'streamGenerateContent') return '/v1internal:streamGenerateContent?alt=sse';
  return '/v1internal:generateContent';
}

export const antigravityPlatformProfile: PlatformProfile = {
  id: 'antigravity',
  defaultCompatibilityPolicy: nativeReasoningCompatibilityPolicy,
  prepareRequest(input: PreparePlatformRequestInput): PreparedPlatformRequest {
    const action = resolveAntigravityPlatformAction(input.action, input.stream, input.modelName);
    const projectId = asTrimmedString(input.oauthProjectId);
    const downstreamHeaders = (input.downstreamHeaders || {}) as Record<string, string>;
    const baseHeaders = (input.baseHeaders || {}) as Record<string, string>;

    const path = resolvePath(action);

    const authorization = baseHeaders.Authorization || baseHeaders.authorization
      || downstreamHeaders.Authorization || downstreamHeaders.authorization || '';

    return {
      path,
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        Accept: action === 'streamGenerateContent' ? 'text/event-stream' : 'application/json',
        'User-Agent': ANTIGRAVITY_RUNTIME_USER_AGENT,
      },
      body: {
        project: projectId,
        model: input.modelName,
        request: input.openaiBody,
      },
      runtime: {
        executor: 'antigravity',
        modelName: input.modelName,
        stream: input.stream,
        oauthProjectId: projectId,
        action,
      },
    };
  },
  createStreamReader(upstreamReader: ReadableStreamDefaultReader<Uint8Array>): any {
    return protocolAdapters.geminiCli.createStreamReader(upstreamReader);
  },
};
