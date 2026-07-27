import type { PreparedPlatformRequest, PreparePlatformRequestInput, PlatformProfile } from './types.js';
import { nativeReasoningCompatibilityPolicy } from './compatibilityPolicy.js';

export const openaiPlatformProfile: PlatformProfile = {
  id: 'openai',
  defaultCompatibilityPolicy: nativeReasoningCompatibilityPolicy,
  prepareRequest(input: PreparePlatformRequestInput): PreparedPlatformRequest {
    const path = input.targetPath || '/v1/chat/completions';

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
