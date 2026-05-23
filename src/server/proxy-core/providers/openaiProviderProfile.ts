import type { PreparedProviderRequest, PrepareProviderRequestInput, ProviderProfile } from './types.js';

export const openaiProviderProfile: ProviderProfile = {
  id: 'openai',
  prepareRequest(input: PrepareProviderRequestInput): PreparedProviderRequest {
    let path = '/v1/chat/completions';
    if (input.endpoint === 'messages') {
      path = '/v1/messages';
    } else if (input.endpoint === 'responses') {
      path = '/v1/responses';
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
