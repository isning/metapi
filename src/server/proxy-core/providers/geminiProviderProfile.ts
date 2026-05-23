import type { PreparedProviderRequest, PrepareProviderRequestInput, ProviderProfile } from './types.js';

export const geminiProviderProfile: ProviderProfile = {
  id: 'gemini',
  prepareRequest(input: PrepareProviderRequestInput): PreparedProviderRequest {
    const siteUrl = typeof input.siteUrl === 'string' ? input.siteUrl.trim().toLowerCase() : '';
    const openAiCompatBase = /\/openai(?:\/|$)/.test(siteUrl);

    let path = '/v1beta/openai/chat/completions';
    if (input.endpoint === 'responses') {
      path = openAiCompatBase ? '/responses' : '/v1beta/openai/responses';
    } else {
      path = openAiCompatBase ? '/chat/completions' : '/v1beta/openai/chat/completions';
    }

    return {
      path,
      headers: input.baseHeaders,
      body: input.body,
      runtime: {
        executor: 'default',
        modelName: input.modelName,
        stream: input.stream,
        oauthProjectId: input.oauthProjectId,
        action: input.action,
      },
    };
  },
};
