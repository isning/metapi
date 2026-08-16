import { config } from '../config.js';
import type { SubscriptionPlanSummary, SubscriptionSummary } from './platforms/base.js';
import type { AccountConnectionField } from './platforms/base.js';

type AutoReloginConfig = {
  username?: unknown;
  passwordCipher?: unknown;
  updatedAt?: unknown;
};

type Sub2ApiAuthConfig = {
  refreshToken?: unknown;
  tokenExpiresAt?: unknown;
};

type Sub2ApiSubscriptionConfig = {
  updatedAt?: unknown;
  activeCount?: unknown;
  totalUsedUsd?: unknown;
  subscriptions?: unknown;
};

export type AccountCredentialMode = 'session' | 'apikey';
export type StoredAccountCredentialMode = 'session' | 'apikey' | 'oauth';
export type AccountCredentialKind =
  | 'session_cookie'
  | 'access_token'
  | 'oauth_access_token'
  | 'none';

type AccountExtraConfig = {
  platformUserId?: unknown;
  useSystemProxy?: unknown;
  oauth?: {
    provider?: unknown;
    [key: string]: unknown;
  };
  autoRelogin?: AutoReloginConfig;
  sub2apiAuth?: Sub2ApiAuthConfig;
  sub2apiSubscription?: Sub2ApiSubscriptionConfig;
  [key: string]: unknown;
};

type ExtraConfigInput = string | Record<string, unknown> | null | undefined;
type OauthProviderCarrier = {
  extraConfig?: ExtraConfigInput;
  oauthProvider?: unknown;
};
type OauthProviderInput = ExtraConfigInput | OauthProviderCarrier;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isOauthProviderCarrier(value: unknown): value is OauthProviderCarrier {
  return isRecord(value) && ('extraConfig' in value || 'oauthProvider' in value);
}

function parseExtraConfig(extraConfig?: ExtraConfigInput): AccountExtraConfig {
  if (!extraConfig) return {};
  if (isRecord(extraConfig)) return extraConfig as AccountExtraConfig;
  if (typeof extraConfig !== 'string') return {};
  try {
    const parsed = JSON.parse(extraConfig) as unknown;
    if (!isRecord(parsed)) return {};
    return parsed as AccountExtraConfig;
  } catch {
    return {};
  }
}

function pathSegments(path: string): string[] {
  return String(path || '').split('.').map((part) => part.trim()).filter(Boolean);
}

export function getExtraConfigPathValue(extraConfig: ExtraConfigInput, path: string): unknown {
  let current: unknown = parseExtraConfig(extraConfig);
  for (const segment of pathSegments(path)) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

export function mergeExtraConfigPath(
  extraConfig: ExtraConfigInput,
  path: string,
  value: unknown,
): string {
  const root = parseExtraConfig(extraConfig) as Record<string, unknown>;
  const segments = pathSegments(path);
  if (segments.length === 0) return JSON.stringify(root);
  let cursor = root;
  for (const segment of segments.slice(0, -1)) {
    const child = cursor[segment];
    if (!isRecord(child)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  const leaf = segments[segments.length - 1]!;
  if (value === undefined || value === null || value === '') delete cursor[leaf];
  else cursor[leaf] = value;
  return JSON.stringify(root);
}

export function applyAccountConnectionValues(
  extraConfig: ExtraConfigInput,
  fields: readonly AccountConnectionField[] | null | undefined,
  values: unknown,
): string {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return JSON.stringify(parseExtraConfig(extraConfig));
  }

  const record = values as Record<string, unknown>;
  let next = JSON.stringify(parseExtraConfig(extraConfig));
  for (const field of fields || []) {
    if (!Object.prototype.hasOwnProperty.call(record, field.key)) continue;
    const raw = record[field.key];
    // An unfilled secret control must not erase a previously saved value.
    if (field.secret && (raw === undefined || raw === null || String(raw).trim() === '')) continue;
    let normalized: unknown = raw;
    if (field.inputType === 'number' && typeof raw === 'string') {
      const parsed = Number(raw.trim());
      normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
    } else if (typeof raw === 'string') {
      normalized = raw.trim();
    }
    if (normalized !== undefined) {
      next = mergeExtraConfigPath(next, field.storagePath, normalized);
    }
  }
  return next;
}

export type AccountConnectionValue = unknown;

export function buildAccountConnectionValues(
  fields: readonly AccountConnectionField[],
  extraConfig: ExtraConfigInput,
): Record<string, AccountConnectionValue | unknown> {
  const result: Record<string, AccountConnectionValue | unknown> = {};
  for (const field of fields) {
    const value = getExtraConfigPathValue(extraConfig, field.storagePath);
    if (field.secret) {
      if (value !== undefined && value !== null) result[field.key] = value;
    } else if (value !== undefined && value !== null) {
      result[field.key] = value;
    }
  }
  return result;
}

function normalizeUserId(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  if (typeof raw === 'string') {
    const n = Number.parseInt(raw.trim(), 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return undefined;
}

function normalizeNonEmptyString(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTimestampMs(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function normalizeNonNegativeNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Math.round(raw * 1_000_000) / 1_000_000;
  }
  if (typeof raw === 'string') {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed * 1_000_000) / 1_000_000;
    }
  }
  return undefined;
}

function normalizeIsoDateTime(raw: unknown): string | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    const ms = raw > 10_000_000_000 ? raw : raw * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    return new Date(ms).toISOString();
  }

  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return undefined;
}

export function getProxyUrlFromExtraConfig(extraConfig?: ExtraConfigInput): string | null {
  const parsed = parseExtraConfig(extraConfig);
  return normalizeNonEmptyString(parsed.proxyUrl) ?? null;
}

export function getUseSystemProxyFromExtraConfig(extraConfig?: ExtraConfigInput): boolean {
  const parsed = parseExtraConfig(extraConfig);
  return parsed.useSystemProxy === true;
}

export function resolveProxyUrlFromExtraConfig(
  extraConfig?: ExtraConfigInput,
  systemProxyUrl = config.systemProxyUrl,
): string | null {
  const explicitProxyUrl = getProxyUrlFromExtraConfig(extraConfig);
  if (explicitProxyUrl) return explicitProxyUrl;
  if (!getUseSystemProxyFromExtraConfig(extraConfig)) return null;
  return normalizeNonEmptyString(systemProxyUrl) ?? null;
}

export function getPlatformUserIdFromExtraConfig(extraConfig?: ExtraConfigInput): number | undefined {
  const parsed = parseExtraConfig(extraConfig);
  return normalizeUserId(parsed.platformUserId);
}

type AccountManagementCredentialInput = {
  credential?: string | null;
  credentialMode?: unknown;
  oauthProvider?: unknown;
  extraConfig?: ExtraConfigInput;
};

/**
 * Resolve the credential for account-management APIs. Model invocation keys
 * are deliberately excluded: they belong to account_tokens.
 */
export function getAccountManagementCredential(
  account: AccountManagementCredentialInput,
): string | undefined {
  const mode = resolveStoredAccountCredentialMode(account);
  if (mode === 'apikey') return undefined;
  return normalizeNonEmptyString(account.credential);
}

type StoredAccountCredentialInput = {
  credentialMode?: unknown;
  oauthProvider?: unknown;
  extraConfig?: ExtraConfigInput;
};

export function resolveStoredAccountCredentialMode(
  account: StoredAccountCredentialInput,
): StoredAccountCredentialMode {
  if (
    normalizeNonEmptyString(account.oauthProvider)
    || getOauthProviderFromExtraConfig(account.extraConfig)
  ) return 'oauth';
  const storedMode = normalizeNonEmptyString(account.credentialMode)?.toLowerCase();
  if (storedMode === 'oauth' || storedMode === 'session' || storedMode === 'apikey') {
    return storedMode;
  }
  return 'session';
}

export function isApiKeyAccount(account: StoredAccountCredentialInput): boolean {
  return resolveStoredAccountCredentialMode(account) === 'apikey';
}

export function getOauthProviderFromExtraConfig(extraConfig?: ExtraConfigInput): string | undefined {
  const parsed = parseExtraConfig(extraConfig);
  return normalizeNonEmptyString(parsed.oauth?.provider);
}

function getOauthProvider(input?: OauthProviderInput): string | undefined {
  if (!isOauthProviderCarrier(input)) {
    return getOauthProviderFromExtraConfig(input);
  }
  return normalizeNonEmptyString(input.oauthProvider)
    ?? getOauthProviderFromExtraConfig(input.extraConfig);
}

export function hasOauthProvider(input?: OauthProviderInput): boolean {
  return !!getOauthProvider(input);
}

type DirectAccountRoutingInput = {
  credential?: string | null;
  credentialMode?: unknown;
  extraConfig?: ExtraConfigInput;
  oauthProvider?: string | null;
};

function hasCredentialValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function supportsDirectAccountRoutingConnection(account: DirectAccountRoutingInput): boolean {
  return resolveStoredAccountCredentialMode(account) === 'oauth'
    && hasCredentialValue(account.credential);
}

export function requiresManagedAccountTokens(account: DirectAccountRoutingInput): boolean {
  return resolveStoredAccountCredentialMode(account) !== 'oauth';
}

export type ManagedSub2ApiAuth = {
  refreshToken: string;
  tokenExpiresAt?: number;
};

export type StoredSub2ApiSubscriptionSummary = SubscriptionSummary & {
  updatedAt: number;
};

export function getSub2ApiAuthFromExtraConfig(extraConfig?: ExtraConfigInput): ManagedSub2ApiAuth | null {
  const parsed = parseExtraConfig(extraConfig);
  const raw = parsed.sub2apiAuth;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const refreshToken = normalizeNonEmptyString(raw.refreshToken);
  if (!refreshToken) return null;
  const tokenExpiresAt = normalizeTimestampMs(raw.tokenExpiresAt);
  return tokenExpiresAt
    ? { refreshToken, tokenExpiresAt }
    : { refreshToken };
}

function normalizeSubscriptionItem(raw: unknown): SubscriptionPlanSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const item = raw as Record<string, unknown>;
  const normalized: SubscriptionPlanSummary = {};

  const id = normalizeUserId(item.id);
  if (id) normalized.id = id;

  const groupId = normalizeUserId(item.groupId ?? item.group_id);
  if (groupId) normalized.groupId = groupId;

  const groupName = normalizeNonEmptyString(item.groupName ?? item.group_name);
  if (groupName) normalized.groupName = groupName;

  const status = normalizeNonEmptyString(item.status);
  if (status) normalized.status = status;

  const expiresAt = normalizeIsoDateTime(
    item.expiresAt
    ?? item.expires_at
    ?? item.expiredAt
    ?? item.expired_at
    ?? item.endAt
    ?? item.end_at,
  );
  if (expiresAt) normalized.expiresAt = expiresAt;

  const dailyUsedUsd = normalizeNonNegativeNumber(item.dailyUsedUsd ?? item.daily_used_usd);
  if (dailyUsedUsd !== undefined) normalized.dailyUsedUsd = dailyUsedUsd;

  const dailyLimitUsd = normalizeNonNegativeNumber(item.dailyLimitUsd ?? item.daily_limit_usd);
  if (dailyLimitUsd !== undefined) normalized.dailyLimitUsd = dailyLimitUsd;

  const weeklyUsedUsd = normalizeNonNegativeNumber(item.weeklyUsedUsd ?? item.weekly_used_usd);
  if (weeklyUsedUsd !== undefined) normalized.weeklyUsedUsd = weeklyUsedUsd;

  const weeklyLimitUsd = normalizeNonNegativeNumber(item.weeklyLimitUsd ?? item.weekly_limit_usd);
  if (weeklyLimitUsd !== undefined) normalized.weeklyLimitUsd = weeklyLimitUsd;

  const monthlyUsedUsd = normalizeNonNegativeNumber(item.monthlyUsedUsd ?? item.monthly_used_usd);
  if (monthlyUsedUsd !== undefined) normalized.monthlyUsedUsd = monthlyUsedUsd;

  const monthlyLimitUsd = normalizeNonNegativeNumber(item.monthlyLimitUsd ?? item.monthly_limit_usd);
  if (monthlyLimitUsd !== undefined) normalized.monthlyLimitUsd = monthlyLimitUsd;

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeSubscriptionItems(raw: unknown): SubscriptionPlanSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeSubscriptionItem(item))
    .filter((item): item is SubscriptionPlanSummary => !!item);
}

export function normalizeSub2ApiSubscriptionSummary(
  raw: unknown,
): StoredSub2ApiSubscriptionSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const body = raw as Record<string, unknown>;
  const subscriptions = normalizeSubscriptionItems(body.subscriptions);
  const activeCount = normalizeNonNegativeNumber(body.activeCount ?? body.active_count);
  const totalUsedUsd = normalizeNonNegativeNumber(body.totalUsedUsd ?? body.total_used_usd);
  const updatedAt = normalizeTimestampMs(body.updatedAt ?? body.updated_at);

  return {
    activeCount: Math.trunc(activeCount ?? subscriptions.length),
    totalUsedUsd: totalUsedUsd ?? 0,
    subscriptions,
    updatedAt: updatedAt ?? Date.now(),
  };
}

export function buildStoredSub2ApiSubscriptionSummary(
  summary: SubscriptionSummary,
  updatedAt = Date.now(),
): StoredSub2ApiSubscriptionSummary {
  return normalizeSub2ApiSubscriptionSummary({
    ...summary,
    updatedAt,
  }) || {
    activeCount: Math.max(0, Math.trunc(summary.activeCount || 0)),
    totalUsedUsd: normalizeNonNegativeNumber(summary.totalUsedUsd) ?? 0,
    subscriptions: normalizeSubscriptionItems(summary.subscriptions),
    updatedAt,
  };
}

export function getSub2ApiSubscriptionFromExtraConfig(
  extraConfig?: ExtraConfigInput,
): StoredSub2ApiSubscriptionSummary | null {
  const parsed = parseExtraConfig(extraConfig);
  return normalizeSub2ApiSubscriptionSummary(parsed.sub2apiSubscription);
}

export function guessPlatformUserIdFromUsername(username?: string | null): number | undefined {
  const text = (username || '').trim();
  if (!text) return undefined;
  const match = text.match(/(\d{3,8})$/);
  if (!match?.[1]) return undefined;
  return normalizeUserId(match[1]);
}

export function resolvePlatformUserId(extraConfig?: ExtraConfigInput, username?: string | null): number | undefined {
  return getPlatformUserIdFromExtraConfig(extraConfig) || guessPlatformUserIdFromUsername(username);
}

export function mergeAccountExtraConfig(
  extraConfig: ExtraConfigInput,
  patch: Record<string, unknown>,
): string {
  const merged: Record<string, unknown> = {
    ...parseExtraConfig(extraConfig),
    ...patch,
  };
  return JSON.stringify(merged);
}

export function getAutoReloginConfig(extraConfig?: ExtraConfigInput): {
  username: string;
  passwordCipher: string;
} | null {
  const parsed = parseExtraConfig(extraConfig);
  const relogin = parsed.autoRelogin;
  if (!relogin || typeof relogin !== 'object' || Array.isArray(relogin)) return null;

  const username = typeof relogin.username === 'string' ? relogin.username.trim() : '';
  const passwordCipher = typeof relogin.passwordCipher === 'string' ? relogin.passwordCipher.trim() : '';
  if (!username || !passwordCipher) return null;

  return { username, passwordCipher };
}
