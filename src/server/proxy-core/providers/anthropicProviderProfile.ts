import { claudeProviderProfile } from './claudeProviderProfile.js';
import type { ProviderProfile } from './types.js';

export const anthropicProviderProfile: ProviderProfile = {
  ...claudeProviderProfile,
  id: 'anthropic',
};
