import { antigravityPlatformProfile } from './antigravity.js';
import { anthropicPlatformProfile } from './anthropic.js';
import { claudePlatformProfile } from './claude.js';
import { codexPlatformProfile } from './codex.js';
import { geminiCliPlatformProfile } from './geminiCli.js';
import { geminiPlatformProfile } from './gemini.js';
import { openaiPlatformProfile } from './openai.js';
import type { PlatformProfile } from './types.js';

const platformProfilesById: Record<string, PlatformProfile> = {
  codex: codexPlatformProfile,
  claude: claudePlatformProfile,
  'gemini-cli': geminiCliPlatformProfile,
  antigravity: antigravityPlatformProfile,
  openai: openaiPlatformProfile,
  gemini: geminiPlatformProfile,
  anthropic: anthropicPlatformProfile,
};

export function resolvePlatformProfile(sitePlatform?: string | null): PlatformProfile | null {
  const normalized = typeof sitePlatform === 'string' ? sitePlatform.trim().toLowerCase() : '';
  return platformProfilesById[normalized] ?? null;
}
