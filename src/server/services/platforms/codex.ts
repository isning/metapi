import {
  BasePlatformAdapter,
  type BalanceInfo,
  type CheckinResult,
  type PlatformCredentialCapabilities,
  type PlatformCredentialContext,
  type UserInfo,
} from './base.js';

function normalizeBaseUrl(baseUrl: string): string {
  let normalized = (baseUrl || '').trim();
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export class CodexAdapter extends BasePlatformAdapter {
  readonly platformName = 'codex';

  override get credentialCapabilities(): PlatformCredentialCapabilities {
    return {
      session: false,
      apiKey: false,
      sessionCredentialOptions: [],
    };
  }

  async detect(url: string): Promise<boolean> {
    const normalized = normalizeBaseUrl(url).toLowerCase();
    return normalized.includes('chatgpt.com/backend-api/codex');
  }

  override async login(_baseUrl: string, _username: string, _password: string) {
    return { success: false as const, message: 'codex oauth login is managed via OAuth flow' };
  }

  override async getUserInfo(_input: PlatformCredentialContext): Promise<UserInfo | null> {
    return null;
  }

  async checkin(_input: PlatformCredentialContext): Promise<CheckinResult> {
    return { success: false, message: 'codex oauth connections do not support checkin' };
  }

  async getBalance(_input: PlatformCredentialContext): Promise<BalanceInfo> {
    return { balance: 0, used: 0, quota: 0 };
  }

  async getModels(_input: PlatformCredentialContext): Promise<string[]> {
    return [];
  }
}
