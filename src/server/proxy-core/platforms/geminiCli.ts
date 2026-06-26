import type { PreparedPlatformRequest, PreparePlatformRequestInput, PlatformAction, PlatformProfile } from './types.js';
import { buildGeminiCliRuntimeHeaders } from './headers.js';
import { protocolAdapters } from '../formats/protocolAdapters.js';
import { nativeReasoningCompatibilityPolicy } from './compatibilityPolicy.js';

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveAction(action: PlatformAction | undefined, stream: boolean): PlatformAction {
  if (action) return action;
  return stream ? 'streamGenerateContent' : 'generateContent';
}

function resolvePath(action: PlatformAction): string {
  if (action === 'countTokens') return '/v1internal:countTokens';
  if (action === 'streamGenerateContent') return '/v1internal:streamGenerateContent?alt=sse';
  return '/v1internal:generateContent';
}

export const geminiCliPlatformProfile: PlatformProfile = {
  id: 'gemini-cli',
  defaultCompatibilityPolicy: nativeReasoningCompatibilityPolicy,
  prepareRequest(input: PreparePlatformRequestInput): PreparedPlatformRequest {
    const projectId = asTrimmedString(input.oauthProjectId);
    if (!projectId) {
      throw new Error('gemini-cli oauth project id missing');
    }
    const action = resolveAction(input.action, input.stream);
    const downstreamHeaders = (input.downstreamHeaders || {}) as Record<string, string>;
    const baseHeaders = (input.baseHeaders || {}) as Record<string, string>;
    const platformHeaders = (input.platformHeaders || {}) as Record<string, string>;

    const headers = buildGeminiCliRuntimeHeaders({
      baseHeaders: baseHeaders,
      platformHeaders,
      modelName: input.modelName,
      stream: action === 'streamGenerateContent',
    });

    const path = resolvePath(action);

    return {
      path,
      headers,
      body: {
        project: projectId,
        model: input.modelName,
        request: input.openaiBody,
      },
      runtime: {
        executor: 'gemini-cli',
        modelName: input.modelName,
        stream: action === 'streamGenerateContent',
        oauthProjectId: projectId,
        action,
      },
    };
  },
  createStreamReader(upstreamReader: ReadableStreamDefaultReader<Uint8Array>): any {
    return protocolAdapters.geminiCli.createStreamReader(upstreamReader);
  },
};
