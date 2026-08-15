import {
  BasePlatformAdapter,
  type BalanceInfo,
  type CheckinResult,
  type PlatformCredentialCapabilities,
  type PlatformCredentialContext,
  type UserInfo,
} from './base.js';
import {
  ANTIGRAVITY_CLIENT_METADATA,
  ANTIGRAVITY_GOOGLE_API_CLIENT,
  ANTIGRAVITY_UPSTREAM_BASE_URL,
  ANTIGRAVITY_USER_AGENT,
} from '../oauth/antigravityProvider.js';

function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl || '').replace(/\/+$/, '');
}

function extractAntigravityModelNames(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as { models?: unknown };
  if (record.models && typeof record.models === 'object' && !Array.isArray(record.models)) {
    return Object.keys(record.models).map((name) => name.trim()).filter(Boolean);
  }
  if (Array.isArray(record.models)) {
    return record.models.flatMap((item) => {
      if (typeof item === 'string') return item.trim() ? [item.trim()] : [];
      if (!item || typeof item !== 'object') return [];
      const id = typeof (item as { id?: unknown }).id === 'string'
        ? (item as { id: string }).id.trim()
        : (typeof (item as { name?: unknown }).name === 'string'
          ? (item as { name: string }).name.trim()
          : '');
      return id ? [id] : [];
    });
  }
  return [];
}

export class AntigravityAdapter extends BasePlatformAdapter {
  readonly platformName = 'antigravity';

  override get credentialCapabilities(): PlatformCredentialCapabilities {
    return {
      session: false,
      apiKey: false,
      sessionCredentialOptions: [],
    };
  }

  async detect(url: string): Promise<boolean> {
    const normalized = (url || '').toLowerCase();
    return normalized.includes('antigravity');
  }

  override async login(_baseUrl: string, _username: string, _password: string) {
    return { success: false, message: 'login endpoint not supported' };
  }

  override async getUserInfo(_input: PlatformCredentialContext): Promise<UserInfo | null> {
    return null;
  }

  async checkin(_input: PlatformCredentialContext): Promise<CheckinResult> {
    return { success: false, message: 'checkin endpoint not supported' };
  }

  async getBalance(_input: PlatformCredentialContext): Promise<BalanceInfo> {
    return { balance: 0, used: 0, quota: 0 };
  }

  async getModels(input: PlatformCredentialContext): Promise<string[]> {
    const baseUrl = input.endpoint.baseUrl;
    const accessToken = this.modelCredential(input);
    try {
      const payload = await this.fetchJson<{ models?: unknown }>(
        `${normalizeBaseUrl(baseUrl || ANTIGRAVITY_UPSTREAM_BASE_URL)}/v1internal:fetchAvailableModels`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'User-Agent': ANTIGRAVITY_USER_AGENT,
            'X-Goog-Api-Client': ANTIGRAVITY_GOOGLE_API_CLIENT,
            'Client-Metadata': ANTIGRAVITY_CLIENT_METADATA,
          },
          body: JSON.stringify({}),
        },
      );
      return extractAntigravityModelNames(payload);
    } catch {
      return [];
    }
  }
}
