import type { UpstreamCompatibilityPolicy } from '../../contracts/upstreamCompatibilityPolicy.js';

export const nativeReasoningCompatibilityPolicy: UpstreamCompatibilityPolicy = {
  reasoningHistory: {
    transport: {
      mode: 'native',
    },
  },
};
