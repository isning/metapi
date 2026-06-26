import type { PreparedPlatformRequest, PreparePlatformRequestInput, PlatformProfile } from './types.js';
import { nativeReasoningCompatibilityPolicy } from './compatibilityPolicy.js';

export const geminiPlatformProfile: PlatformProfile = {
  id: 'gemini',
  defaultCompatibilityPolicy: nativeReasoningCompatibilityPolicy,
  prepareRequest(input: PreparePlatformRequestInput): PreparedPlatformRequest {
    const siteUrl = typeof input.siteUrl === 'string' ? input.siteUrl.trim().toLowerCase() : '';
    const openAiCompatBase = /\/openai(?:\/|$)/.test(siteUrl);

    let path = '/v1beta/openai/chat/completions';
    if (input.targetPath?.endsWith('/responses')) {
      path = openAiCompatBase ? '/responses' : '/v1beta/openai/responses';
    } else {
      path = openAiCompatBase ? '/chat/completions' : '/v1beta/openai/chat/completions';
    }

    return {
      path,
      headers: input.baseHeaders || {},
      body: input.openaiBody,
      runtime: {
        executor: 'default',
        modelName: input.modelName,
        stream: input.stream,
        oauthProjectId: input.oauthProjectId || null,
        action: input.action,
      },
    };
  },
};
