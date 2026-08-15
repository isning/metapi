import { createHash } from 'node:crypto';
import type { RequestInit as UndiciRequestInit } from 'undici';
import { withAccountProxyOverride, withSiteProxyRequestInit } from '../siteProxy.js';
import type { UpstreamPricingCatalog } from '../upstreamPricingCatalog.js';

export interface CheckinResult {
  success: boolean;
  message: string;
  reward?: string;
}

export interface SubscriptionPlanSummary {
  id?: number;
  groupId?: number;
  groupName?: string;
  status?: string;
  expiresAt?: string;
  dailyUsedUsd?: number;
  dailyLimitUsd?: number;
  weeklyUsedUsd?: number;
  weeklyLimitUsd?: number;
  monthlyUsedUsd?: number;
  monthlyLimitUsd?: number;
}

export interface SubscriptionSummary {
  activeCount: number;
  totalUsedUsd: number;
  subscriptions: SubscriptionPlanSummary[];
}

export interface BalanceInfo {
  balance: number;
  used: number;
  quota: number;
  todayIncome?: number;
  todayQuotaConsumption?: number;
  subscriptionSummary?: SubscriptionSummary;
}

interface LoginResult {
  success: boolean;
  accessToken?: string;
  credentialKind?: 'session_cookie' | 'access_token';
  username?: string;
  message?: string;
}

export interface UserInfo {
  username: string;
  displayName?: string;
  email?: string;
  role?: number;
}

export interface TokenVerifyResult {
  tokenType: 'session' | 'apikey' | 'unknown';
  userInfo?: UserInfo | null;
  balance?: BalanceInfo | null;
  /** Model invocation credential discovered through an account-management API. */
  discoveredModelToken?: string | null;
  models?: string[];
}

export interface ApiTokenInfo {
  name: string;
  key: string;
  enabled?: boolean;
  tokenGroup?: string | null;
  extraConfig?: string | null;
}

/** Endpoint selected by the caller. Adapters own protocol-specific URL use. */
export interface ModelEndpoint {
  baseUrl: string;
  basePathMode?: 'protocol_default' | 'complete_api_prefix' | null;
}

/**
 * Persisted account connection material. `extraConfig` is intentionally
 * opaque here: only the owning adapter may interpret platform-specific keys.
 */
export interface AccountCredential {
  id: number | null;
  siteId: number | null;
  username: string | null;
  mode: 'session' | 'apikey' | 'oauth';
  credential: string;
  credentialKind: string;
  extraConfig: string | null;
}

/** Persisted model invocation credential owned by an account. */
export interface AccountTokenCredential {
  id: number | null;
  accountId: number | null;
  token: string;
  enabled: boolean;
  extraConfig: string | null;
}

export interface PlatformCredentialContext {
  endpoint: ModelEndpoint;
  account: AccountCredential;
  token: AccountTokenCredential | null;
}

export interface SiteAnnouncement {
  sourceKey: string;
  title: string;
  content: string;
  level: 'info' | 'warning' | 'error';
  sourceUrl?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  upstreamCreatedAt?: string | null;
  upstreamUpdatedAt?: string | null;
  rawPayload?: unknown;
}

export interface CreateApiTokenOptions {
  name?: string;
  group?: string;
  unlimitedQuota?: boolean;
  remainQuota?: number;
  expiredTime?: number;
  allowIps?: string;
  modelLimitsEnabled?: boolean;
  modelLimits?: string;
}

export type SessionCredentialOption = {
  kind: 'session_cookie' | 'access_token';
  labelI18nKey: string;
  commentI18nKey?: string;
  placeholderI18nKey?: string;
};

export type PlatformCredentialCapabilities = {
  session: boolean;
  apiKey: boolean;
  sessionCredentialOptions: readonly SessionCredentialOption[];
};

export type ModelRequestCredentialInput = {
  /** This is an execution credential, never an account connection credential. */
  kind: 'model_api_key' | 'oauth_access_token';
  credential: string;
};

export function buildDefaultModelRequestCredentialHeaders(input: ModelRequestCredentialInput): Record<string, string> {
  return input.credential.trim()
    ? { Authorization: `Bearer ${input.credential}` }
    : {};
}

const DEFAULT_CREDENTIAL_CAPABILITIES: PlatformCredentialCapabilities = {
  session: true,
  apiKey: true,
  // Adapters inheriting the base implementation use bearer access tokens.
  // Keep this explicit so clients never infer a cookie/session option from
  // the generic `session` capability.
  sessionCredentialOptions: [{
    kind: 'access_token',
    labelI18nKey: 'pages.accounts.credentialKindAccessToken',
    commentI18nKey: 'pages.accounts.credentialKindAccessTokenComment',
    placeholderI18nKey: 'pages.accounts.credentialPlaceholderAccessToken',
  }],
};

export type AccountConnectionField = {
  key: string;
  labelI18nKey: string;
  commentI18nKey?: string;
  placeholderI18nKey?: string;
  inputType: 'text' | 'number' | 'password';
  storagePath: string;
  secret?: boolean;
  /** Maps this declared value to a shared adapter runtime argument. */
  runtimeArgument?: 'platformUserId';
};

export interface PlatformAdapter {
  readonly platformName: string;
  readonly credentialCapabilities: PlatformCredentialCapabilities;
  readonly accountConnectionFields: readonly AccountConnectionField[];
  buildModelRequestCredentialHeaders(input: ModelRequestCredentialInput): Record<string, string>;
  runWithProxyOverride<T>(proxyUrl: string | null | undefined, operation: () => Promise<T>): Promise<T>;
  detect(url: string): Promise<boolean>;
  login(baseUrl: string, username: string, password: string): Promise<LoginResult>;
  getUserInfo(input: PlatformCredentialContext): Promise<UserInfo | null>;
  verifyToken(input: PlatformCredentialContext): Promise<TokenVerifyResult>;
  checkin(input: PlatformCredentialContext): Promise<CheckinResult>;
  getBalance(input: PlatformCredentialContext): Promise<BalanceInfo>;
  getModels(input: PlatformCredentialContext): Promise<string[]>;
  getApiToken(input: PlatformCredentialContext): Promise<string | null>;
  getApiTokens(input: PlatformCredentialContext): Promise<ApiTokenInfo[]>;
  getSiteAnnouncements(input: PlatformCredentialContext): Promise<SiteAnnouncement[]>;
  getAccountTokenGroups(input: PlatformCredentialContext): Promise<string[]>;
  getUserGroups(input: PlatformCredentialContext): Promise<string[]>;
  getPricingCatalog?(input: PlatformCredentialContext): Promise<UpstreamPricingCatalog | null>;
  createApiToken(input: PlatformCredentialContext & { options?: CreateApiTokenOptions }): Promise<boolean>;
  deleteApiToken(input: PlatformCredentialContext): Promise<boolean>;
}

export abstract class BasePlatformAdapter implements PlatformAdapter {
  abstract readonly platformName: string;

  get credentialCapabilities(): PlatformCredentialCapabilities {
    return DEFAULT_CREDENTIAL_CAPABILITIES;
  }

  readonly accountConnectionFields: readonly AccountConnectionField[] = [];

  buildModelRequestCredentialHeaders(input: ModelRequestCredentialInput): Record<string, string> {
    return buildDefaultModelRequestCredentialHeaders(input);
  }

  runWithProxyOverride<T>(
    proxyUrl: string | null | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    return withAccountProxyOverride(proxyUrl, operation);
  }

  abstract detect(url: string): Promise<boolean>;
  abstract checkin(input: PlatformCredentialContext): Promise<CheckinResult>;
  abstract getBalance(input: PlatformCredentialContext): Promise<BalanceInfo>;
  abstract getModels(input: PlatformCredentialContext): Promise<string[]>;

  protected modelCredential(input: PlatformCredentialContext): string {
    return input.token?.token || '';
  }

  /** Pricing endpoints may be authorized by either declared credential. */
  protected pricingCredential(input: PlatformCredentialContext): string {
    return input.token?.token || input.account.credential;
  }

  async verifyToken(input: PlatformCredentialContext): Promise<TokenVerifyResult> {
    if (input.account.mode === 'apikey') {
      try {
        const models = await this.getModels(input);
        if (models.length > 0) return { tokenType: 'apikey', models };
      } catch {}
      return { tokenType: 'unknown' };
    }

    const userInfo = await this.getUserInfo(input);
    if (!userInfo) return { tokenType: 'unknown' };

    let balance: BalanceInfo | null = null;
    try { balance = await this.getBalance(input); } catch {}
    let discoveredModelToken: string | null = null;
    try {
      const tokens = await this.getApiTokens(input);
      discoveredModelToken = tokens.find((item) => item.enabled !== false)?.key || tokens[0]?.key || null;
    } catch {}
    return { tokenType: 'session', userInfo, balance, discoveredModelToken };
  }

  async getUserInfo(input: PlatformCredentialContext): Promise<UserInfo | null> {
    try {
      const res = await this.fetchJson<any>(`${input.endpoint.baseUrl}/api/user/self`, {
        headers: { Authorization: `Bearer ${input.account.credential}` },
      });
      if (res?.success && res?.data) {
        return {
          username: res.data.username || res.data.display_name || '',
          displayName: res.data.display_name,
          email: res.data.email,
          role: res.data.role,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async login(baseUrl: string, username: string, password: string): Promise<LoginResult> {
    try {
      const res = await this.fetchJson<any>(`${baseUrl}/api/user/login`, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      if (res?.success && res?.data) {
        return {
          success: true,
          accessToken: typeof res.data === 'string' ? res.data : res.data.token || res.data.access_token,
          username,
        };
      }
      return { success: false, message: res?.message || '登录失败' };
    } catch (err: any) {
      return { success: false, message: err.message || '登录请求失败' };
    }
  }

  async getApiToken(_input: PlatformCredentialContext): Promise<string | null> {
    return null;
  }

  async getApiTokens(input: PlatformCredentialContext): Promise<ApiTokenInfo[]> {
    const token = await this.getApiToken(input);
    if (!token) return [];
    return [{ name: 'default', key: token, enabled: true, tokenGroup: 'default' }];
  }

  async getSiteAnnouncements(_input: PlatformCredentialContext): Promise<SiteAnnouncement[]> {
    return [];
  }

  async getAccountTokenGroups(input: PlatformCredentialContext): Promise<string[]> {
    if (input.account.mode !== 'session') return ['default'];
    return this.getUserGroups(input);
  }

  async createApiToken(_input: PlatformCredentialContext & { options?: CreateApiTokenOptions }): Promise<boolean> {
    return false;
  }

  async getUserGroups(_input: PlatformCredentialContext): Promise<string[]> {
    return ['default'];
  }

  async getPricingCatalog(_input: PlatformCredentialContext): Promise<UpstreamPricingCatalog | null> {
    return null;
  }

  async deleteApiToken(_input: PlatformCredentialContext): Promise<boolean> {
    return false;
  }

  protected async fetchJson<T>(url: string, options?: UndiciRequestInit): Promise<T> {
    const { fetch } = await import('undici');
    const requestOptions: UndiciRequestInit = {
      ...options,
      body: options?.body ?? undefined,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    };
    const proxiedRequestOptions = await withSiteProxyRequestInit(url, requestOptions);
    const res = await fetch(url, proxiedRequestOptions);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  protected buildNoticeSourceKey(content: string): string {
    const normalized = (content || '').trim();
    return `notice:${createHash('sha1').update(normalized).digest('hex')}`;
  }
}
