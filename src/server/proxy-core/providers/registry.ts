import { antigravityProviderProfile } from './antigravityProviderProfile.js';
import { anthropicProviderProfile } from './anthropicProviderProfile.js';
import { claudeProviderProfile } from './claudeProviderProfile.js';
import { codexProviderProfile } from './codexProviderProfile.js';
import { geminiCliProviderProfile } from './geminiCliProviderProfile.js';
import { geminiProviderProfile } from './geminiProviderProfile.js';
import { openaiProviderProfile } from './openaiProviderProfile.js';
import type { ProviderProfile } from './types.js';

const providerProfilesByPlatform: Record<string, ProviderProfile> = {
  codex: codexProviderProfile,
  claude: claudeProviderProfile,
  'gemini-cli': geminiCliProviderProfile,
  antigravity: antigravityProviderProfile,
  openai: openaiProviderProfile,
  gemini: geminiProviderProfile,
  anthropic: anthropicProviderProfile,
};

export function resolveProviderProfile(sitePlatform?: string | null): ProviderProfile | null {
  const normalized = typeof sitePlatform === 'string' ? sitePlatform.trim().toLowerCase() : '';
  return providerProfilesByPlatform[normalized] ?? null;
}
