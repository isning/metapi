import { claudePlatformProfile } from './claude.js';
import type { PlatformProfile } from './types.js';

export const anthropicPlatformProfile: PlatformProfile = {
  ...claudePlatformProfile,
  id: 'anthropic',
};
