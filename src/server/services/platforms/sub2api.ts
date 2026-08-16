import {
  ApiTokenInfo,
  BasePlatformAdapter,
  CheckinResult,
  BalanceInfo,
  CreateApiTokenOptions,
  SubscriptionPlanSummary,
  SubscriptionSummary,
  type SiteAnnouncement,
  type AccountConnectionField,
  type PlatformCredentialCapabilities,
  type PlatformCredentialContext,
  UserInfo,
} from './base.js';
import type {
  UpstreamDirectModelPrice,
  UpstreamPricingCatalog,
  UpstreamPricingModel,
} from '../upstreamPricingCatalog.js';
import { stripTrailingSlashes } from '../urlNormalization.js';

function normalizeBaseUrl(baseUrl: string): string {
  return stripTrailingSlashes(baseUrl || '');
}

/**
 * Sub2API adapter.
 *
 * Sub2API uses JWT-based auth with endpoints under /api/v1/*.
 * It does NOT support: login or check-in.
 * Balance is derived from a USD amount returned by /api/v1/auth/me.
 */
export class Sub2ApiAdapter extends BasePlatformAdapter {
  readonly platformName = 'sub2api';

  override get credentialCapabilities(): PlatformCredentialCapabilities {
    return {
      session: true,
      apiKey: true,
      sessionCredentialOptions: [{
        kind: 'access_token',
        labelI18nKey: 'pages.accounts.credentialKindAccessToken',
        commentI18nKey: 'pages.accounts.credentialKindAccessTokenComment',
        placeholderI18nKey: 'pages.accounts.credentialPlaceholderAccessToken',
      }],
    };
  }

  override readonly accountConnectionFields: readonly AccountConnectionField[] = [
    {
      key: 'sub2apiAuth.refreshToken',
      labelI18nKey: 'pages.accounts.refreshToken',
      commentI18nKey: 'pages.accounts.configurationRefreshTokenMetapiJwtExpired401',
      placeholderI18nKey: 'pages.accounts.sub2apiRefreshTokenAutomatic',
      inputType: 'password',
      storagePath: 'sub2apiAuth.refreshToken',
      secret: true,
    },
    {
      key: 'sub2apiAuth.tokenExpiresAt',
      labelI18nKey: 'pages.accounts.tokenExpires',
      commentI18nKey: 'pages.accounts.tokenExpiresComment',
      inputType: 'number',
      storagePath: 'sub2apiAuth.tokenExpiresAt',
    },
  ];

  private roundCurrency(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
  }

  private parsePositiveInteger(raw: unknown): number | undefined {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
    if (typeof raw === 'string') {
      const parsed = Number.parseInt(raw.trim(), 10);
      if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }
    return undefined;
  }

  private parseNonNegativeInteger(raw: unknown): number | undefined {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return Math.trunc(raw);
    if (typeof raw === 'string') {
      const parsed = Number.parseInt(raw.trim(), 10);
      if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
    }
    return undefined;
  }

  private parseNonNegativeNumber(raw: unknown): number | undefined {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
      return this.roundCurrency(raw);
    }
    if (typeof raw === 'string') {
      const parsed = Number(raw.trim());
      if (Number.isFinite(parsed) && parsed >= 0) {
        return this.roundCurrency(parsed);
      }
    }
    return undefined;
  }

  private parseFiniteNumber(raw: unknown): number | undefined {
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : Number.NaN;
    return Number.isFinite(value) ? value : undefined;
  }

  private parseSub2ApiTokenPrice(raw: unknown): UpstreamDirectModelPrice | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    // Sub2API exposes USD/token. Metapi's catalog contract uses USD/1M tokens.
    const perMillion = (keys: string[]) => {
      for (const key of keys) {
        const parsed = this.parseFiniteNumber(value[key]);
        if (parsed !== undefined && parsed >= 0) return parsed * 1_000_000;
      }
      return undefined;
    };
    const input = perMillion(['input_price', 'inputPrice']);
    const output = perMillion(['output_price', 'outputPrice']);
    const cacheRead = perMillion(['cache_read_price', 'cacheReadPrice']);
    const cacheWrite = perMillion(['cache_write_price', 'cacheWritePrice']);
    if (input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) return null;
    return {
      ...(input === undefined ? {} : { input }),
      ...(output === undefined ? {} : { output }),
      ...(cacheRead === undefined ? {} : { cacheRead }),
      ...(cacheWrite === undefined ? {} : { cacheWrite }),
    };
  }

  private parseSub2ApiModelPricing(raw: unknown): {
    quotaType: number;
    modelPrice: number | UpstreamDirectModelPrice;
  } | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const billingMode = typeof value.billing_mode === 'string' ? value.billing_mode.trim().toLowerCase() : 'token';
    if (billingMode === 'per_request') {
      const requestPrice = this.parseFiniteNumber(value.per_request_price ?? value.perRequestPrice);
      return requestPrice === undefined || requestPrice < 0
        ? null
        : { quotaType: 1, modelPrice: requestPrice };
    }
    const modelPrice = this.parseSub2ApiTokenPrice(raw);
    return modelPrice ? { quotaType: 0, modelPrice } : null;
  }

  private parseSub2ApiCatalog(
    channelsPayload: unknown,
    groupsPayload: unknown,
    ratesPayload: unknown,
  ): UpstreamPricingCatalog | null {
    const channels = this.parseSub2ApiEnvelope<any>(channelsPayload, '/api/v1/channels/available');
    const groups = this.parseSub2ApiEnvelope<any>(groupsPayload, '/api/v1/groups/available');
    const rates = this.parseSub2ApiEnvelope<any>(ratesPayload, '/api/v1/groups/rates');
    const groupRatio: Record<string, number> = { default: 1 };
    const groupItems = Array.isArray(groups) ? groups : [];
    const rateOverrides = rates && typeof rates === 'object' && !Array.isArray(rates)
      ? rates as Record<string, unknown>
      : {};
    for (const group of groupItems) {
      const id = this.parsePositiveInteger(group?.id);
      if (!id) continue;
      const key = String(id);
      const ratio = this.parseFiniteNumber(rateOverrides[key])
        ?? this.parseFiniteNumber(group?.rate_multiplier)
        ?? 1;
      if (ratio > 0) groupRatio[key] = ratio;
    }

    const models = new Map<string, UpstreamPricingModel>();
    const channelItems = Array.isArray(channels) ? channels : [];
    for (const channel of channelItems) {
      const sections = Array.isArray(channel?.platforms) ? channel.platforms : [];
      for (const section of sections) {
        const sectionGroups = Array.isArray(section?.groups) ? section.groups : [];
        const groupKeys = sectionGroups
          .map((group: any) => this.parsePositiveInteger(group?.id))
          .filter((id: number | undefined): id is number => id !== undefined)
          .map(String);
        const supportedModels = Array.isArray(section?.supported_models) ? section.supported_models : [];
        for (const rawModel of supportedModels) {
          const modelName = typeof rawModel?.name === 'string' ? rawModel.name.trim() : '';
          const pricing = this.parseSub2ApiModelPricing(rawModel?.pricing);
          if (!modelName || !pricing || groupKeys.length === 0) continue;
          const existing = models.get(modelName);
          const groupPrices = { ...(existing?.groupPrices || {}) };
          for (const groupKey of groupKeys) groupPrices[groupKey] = pricing.modelPrice;
          models.set(modelName, {
            modelName,
            quotaType: pricing.quotaType,
            modelRatio: 1,
            completionRatio: 1,
            modelPrice: existing?.modelPrice ?? pricing.modelPrice,
            groupPrices,
            enableGroups: Array.from(new Set([...(existing?.enableGroups || []), ...groupKeys])),
            modelDescription: typeof channel?.description === 'string' ? channel.description : null,
          });
        }
      }
    }
    if (models.size === 0) {
      throw new Error('Sub2API returned no priced models from /api/v1/channels/available; enable available_channels_enabled upstream.');
    }
    return { models, groupRatio };
  }

  private parseDateTime(raw: unknown): string | undefined {
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

  private parseSubscriptionItem(raw: unknown): SubscriptionPlanSummary | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const item = raw as Record<string, unknown>;
    const group = item.group && typeof item.group === 'object' && !Array.isArray(item.group)
      ? item.group as Record<string, unknown>
      : null;

    const normalized: SubscriptionPlanSummary = {};

    const id = this.parsePositiveInteger(item.id);
    if (id) normalized.id = id;

    const groupId = this.parsePositiveInteger(item.group_id ?? item.groupId ?? group?.id);
    if (groupId) normalized.groupId = groupId;

    const groupNameCandidates = [
      item.group_name,
      item.groupName,
      item.name,
      item.title,
      group?.name,
      group?.title,
    ];
    for (const candidate of groupNameCandidates) {
      if (typeof candidate !== 'string') continue;
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      normalized.groupName = trimmed;
      break;
    }

    if (typeof item.status === 'string' && item.status.trim()) {
      normalized.status = item.status.trim();
    }

    const expiresAt = this.parseDateTime(
      item.expires_at
      ?? item.expiresAt
      ?? item.expired_at
      ?? item.expiredAt
      ?? item.end_at
      ?? item.endAt
      ?? item.end_time
      ?? item.endTime
      ?? item.current_period_end
      ?? item.currentPeriodEnd,
    );
    if (expiresAt) normalized.expiresAt = expiresAt;

    const dailyUsedUsd = this.parseNonNegativeNumber(item.daily_used_usd ?? item.dailyUsedUsd);
    if (dailyUsedUsd !== undefined) normalized.dailyUsedUsd = dailyUsedUsd;

    const dailyLimitUsd = this.parseNonNegativeNumber(item.daily_limit_usd ?? item.dailyLimitUsd);
    if (dailyLimitUsd !== undefined) normalized.dailyLimitUsd = dailyLimitUsd;

    const weeklyUsedUsd = this.parseNonNegativeNumber(item.weekly_used_usd ?? item.weeklyUsedUsd);
    if (weeklyUsedUsd !== undefined) normalized.weeklyUsedUsd = weeklyUsedUsd;

    const weeklyLimitUsd = this.parseNonNegativeNumber(item.weekly_limit_usd ?? item.weeklyLimitUsd);
    if (weeklyLimitUsd !== undefined) normalized.weeklyLimitUsd = weeklyLimitUsd;

    const monthlyUsedUsd = this.parseNonNegativeNumber(
      item.monthly_used_usd
      ?? item.monthlyUsedUsd
      ?? item.used_usd
      ?? item.usedUsd
      ?? item.total_used_usd
      ?? item.totalUsedUsd,
    );
    if (monthlyUsedUsd !== undefined) normalized.monthlyUsedUsd = monthlyUsedUsd;

    const monthlyLimitUsd = this.parseNonNegativeNumber(
      item.monthly_limit_usd
      ?? item.monthlyLimitUsd
      ?? item.limit_usd
      ?? item.limitUsd
      ?? item.total_limit_usd
      ?? item.totalLimitUsd,
    );
    if (monthlyLimitUsd !== undefined) normalized.monthlyLimitUsd = monthlyLimitUsd;

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  private parseSubscriptionItems(raw: unknown): SubscriptionPlanSummary[] {
    const rawItems = (() => {
      if (Array.isArray(raw)) return raw;
      if (raw && typeof raw === 'object') {
        const body = raw as Record<string, unknown>;
        if (Array.isArray(body.subscriptions)) return body.subscriptions;
        if (Array.isArray(body.items)) return body.items;
        if (Array.isArray(body.list)) return body.list;
        if (Array.isArray(body.data)) return body.data;
      }
      return [];
    })();

    return rawItems
      .map((item) => this.parseSubscriptionItem(item))
      .filter((item): item is SubscriptionPlanSummary => !!item);
  }

  private buildSubscriptionSummary(payload: unknown): SubscriptionSummary {
    const body = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    const subscriptions = this.parseSubscriptionItems(payload);
    const activeCount = this.parseNonNegativeInteger(body.active_count ?? body.activeCount);
    const totalUsedUsd = this.parseNonNegativeNumber(body.total_used_usd ?? body.totalUsedUsd);
    const inferredUsedUsd = subscriptions.reduce((sum, item) => sum + (item.monthlyUsedUsd || 0), 0);

    return {
      activeCount: activeCount ?? subscriptions.length,
      totalUsedUsd: totalUsedUsd ?? this.roundCurrency(inferredUsedUsd),
      subscriptions,
    };
  }

  private async fetchSubscriptionSummary(baseUrl: string, accessToken: string): Promise<SubscriptionSummary | undefined> {
    const headers = this.buildAuthHeader(accessToken);
    const summaryEndpoint = '/api/v1/subscriptions/summary';

    try {
      const res = await this.fetchJson<any>(`${baseUrl}${summaryEndpoint}`, { headers });
      const data = this.parseSub2ApiEnvelope<any>(res, summaryEndpoint);
      return this.buildSubscriptionSummary(data);
    } catch {}

    const fallbackEndpoints = ['/api/v1/subscriptions/active'];
    for (const endpoint of fallbackEndpoints) {
      try {
        const res = await this.fetchJson<any>(`${baseUrl}${endpoint}`, { headers });
        const data = this.parseSub2ApiEnvelope<any>(res, endpoint);
        return this.buildSubscriptionSummary(data);
      } catch {}
    }

    return undefined;
  }

  private stripBearerPrefix(value?: string | null): string {
    const trimmed = (value || '').trim();
    if (!trimmed) return '';
    return trimmed.replace(/^bearer\s+/i, '').trim();
  }

  private normalizeTokenKeyForCompare(value?: string | null): string {
    return this.stripBearerPrefix(value);
  }

  private buildAuthHeader(accessToken: string): Record<string, string> {
    const normalized = this.stripBearerPrefix(accessToken);
    return { Authorization: `Bearer ${normalized}` };
  }

  private parseTokenEnabled(status: unknown): boolean {
    if (typeof status === 'boolean') return status;
    if (typeof status === 'number') return status === 1;
    if (typeof status !== 'string') return true;
    const normalized = status.trim().toLowerCase();
    if (!normalized) return true;
    if (['inactive', 'disabled', 'false', '0', 'off'].includes(normalized)) return false;
    if (['active', 'enabled', 'true', '1', 'on'].includes(normalized)) return true;
    return true;
  }

  private parseTokenItems(payload: any): Array<{ id: number; key: string; name: string; enabled: boolean; tokenGroup: string | null }> {
    const source = payload?.data ?? payload;
    const rawItems = (() => {
      if (Array.isArray(source)) return source;
      if (Array.isArray(source?.items)) return source.items;
      if (Array.isArray(source?.list)) return source.list;
      if (Array.isArray(source?.data)) return source.data;
      return [];
    })();

    const items: Array<{ id: number; key: string; name: string; enabled: boolean; tokenGroup: string | null }> = [];
    for (const item of rawItems) {
      const key = typeof item?.key === 'string' ? item.key.trim() : '';
      if (!key) continue;
      const id = Number.parseInt(String(item?.id), 10);
      if (!Number.isFinite(id) || id <= 0) continue;
      const name = typeof item?.name === 'string' && item.name.trim()
        ? item.name.trim()
        : `token-${id}`;
      const tokenGroup = (() => {
        const fromNumeric = Number.parseInt(String(item?.group_id ?? item?.groupId ?? ''), 10);
        if (Number.isFinite(fromNumeric) && fromNumeric > 0) return String(fromNumeric);
        const fromText = typeof item?.group_name === 'string'
          ? item.group_name.trim()
          : (typeof item?.group === 'string' ? item.group.trim() : '');
        return fromText || null;
      })();
      items.push({
        id,
        key,
        name,
        enabled: this.parseTokenEnabled(item?.status),
        tokenGroup,
      });
    }
    return items;
  }

  private parseGroupItems(payload: any): string[] {
    const source = payload?.data ?? payload;
    const rawItems = (() => {
      if (Array.isArray(source)) return source;
      if (Array.isArray(source?.items)) return source.items;
      if (Array.isArray(source?.list)) return source.list;
      if (Array.isArray(source?.groups)) return source.groups;
      if (Array.isArray(source?.data)) return source.data;
      return [];
    })();

    const groups: string[] = [];
    for (const item of rawItems) {
      if (item == null) continue;
      if (typeof item === 'number' && Number.isFinite(item) && item > 0) {
        groups.push(String(Math.trunc(item)));
        continue;
      }
      if (typeof item === 'string') {
        const normalized = item.trim();
        if (normalized) groups.push(normalized);
        continue;
      }
      if (typeof item !== 'object') continue;

      const numericCandidates = [
        (item as any).group_id,
        (item as any).groupId,
        (item as any).id,
        (item as any).value,
      ];
      let picked = '';
      for (const candidate of numericCandidates) {
        const parsed = Number.parseInt(String(candidate), 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          picked = String(parsed);
          break;
        }
      }
      if (picked) {
        groups.push(picked);
        continue;
      }

      const textCandidates = [
        (item as any).name,
        (item as any).group_name,
        (item as any).groupName,
        (item as any).title,
        (item as any).label,
        (item as any).code,
      ];
      for (const candidate of textCandidates) {
        if (typeof candidate !== 'string') continue;
        const normalized = candidate.trim();
        if (!normalized) continue;
        groups.push(normalized);
        break;
      }
    }

    return Array.from(new Set(groups));
  }

  private async listGroups(baseUrl: string, accessToken: string): Promise<string[]> {
    const endpoints = [
      '/api/v1/groups/available',
      '/api/v1/groups?page=1&page_size=100',
      '/api/v1/groups',
      '/api/v1/group?page=1&page_size=100',
      '/api/v1/group',
    ];

    const headers = this.buildAuthHeader(accessToken);
    for (const endpoint of endpoints) {
      try {
        const res = await this.fetchJson<any>(`${baseUrl}${endpoint}`, {
          headers,
        });
        const parsed = (() => {
          try {
            return this.parseSub2ApiEnvelope<any>(res, endpoint);
          } catch {
            return res;
          }
        })();
        const groups = this.parseGroupItems(parsed);
        if (groups.length > 0) return groups;
      } catch {}
    }

    return [];
  }

  private parseGroupIdsFromTokenPayload(payload: any): string[] {
    const source = payload?.data ?? payload;
    const rawItems = (() => {
      if (Array.isArray(source)) return source;
      if (Array.isArray(source?.items)) return source.items;
      if (Array.isArray(source?.list)) return source.list;
      if (Array.isArray(source?.data)) return source.data;
      return [];
    })();

    const groups: string[] = [];
    for (const item of rawItems) {
      if (!item || typeof item !== 'object') continue;
      const groupId = Number.parseInt(String((item as any).group_id ?? (item as any).groupId ?? ''), 10);
      if (!Number.isFinite(groupId) || groupId <= 0) continue;
      groups.push(String(groupId));
    }
    return Array.from(new Set(groups));
  }

  private async inferGroupsFromKeys(baseUrl: string, accessToken: string): Promise<string[]> {
    const endpoints = [
      '/api/v1/keys?page=1&page_size=100',
      '/api/v1/api-keys?page=1&page_size=100',
    ];

    const headers = this.buildAuthHeader(accessToken);
    for (const endpoint of endpoints) {
      try {
        const res = await this.fetchJson<any>(`${baseUrl}${endpoint}`, {
          headers,
        });
        const parsed = (() => {
          try {
            return this.parseSub2ApiEnvelope<any>(res, endpoint);
          } catch {
            return res;
          }
        })();
        const groups = this.parseGroupIdsFromTokenPayload(parsed);
        if (groups.length > 0) return groups;
      } catch {}
    }

    return [];
  }

  private extractModelIds(payload: any): string[] {
    const source = payload?.data ?? payload;
    const rawModels = (() => {
      if (Array.isArray(source)) return source;
      if (Array.isArray(source?.items)) return source.items;
      if (Array.isArray(source?.models)) return source.models;
      return [];
    })();

    const models = rawModels
      .map((item: any) => (typeof item === 'string' ? item : item?.id ?? item?.name))
      .map((value: unknown) => String(value || '').trim())
      .map((value: string) => value.replace(/^models\//i, ''))
      .filter(Boolean);
    return Array.from(new Set(models));
  }

  private resolveRouteEndpoints(baseUrl: string): string[] {
    const normalizedBase = normalizeBaseUrl(baseUrl);
    if (!normalizedBase) return [];
    if (/\/models$/i.test(normalizedBase)) return [normalizedBase];
    if (/\/(?:antigravity\/)?v\d+(?:\.\d+)?(?:beta)?$/i.test(normalizedBase)) {
      return [`${normalizedBase}/models`];
    }
    if (/\/antigravity$/i.test(normalizedBase)) {
      return [
        `${normalizedBase}/v1/models`,
        `${normalizedBase}/v1beta/models`,
      ];
    }
    return [
      `${normalizedBase}/v1/models`,
      `${normalizedBase}/api/v1/models`,
      `${normalizedBase}/v1beta/models`,
      `${normalizedBase}/antigravity/v1beta/models`,
    ];
  }

  private resolveManagementBaseUrl(baseUrl: string): string {
    let normalizedBase = normalizeBaseUrl(baseUrl);
    if (!normalizedBase) return normalizedBase;

    const suffixes = [
      '/models',
      '/antigravity',
      '/antigravity/v1beta',
      '/antigravity/v1',
      '/api/v1',
      '/v1beta',
      '/v1',
    ];

    let changed = true;
    while (changed) {
      changed = false;
      for (const suffix of suffixes) {
        if (!normalizedBase.toLowerCase().endsWith(suffix)) continue;
        const trimmed = normalizeBaseUrl(normalizedBase.slice(0, -suffix.length));
        if (!trimmed || trimmed === normalizedBase) continue;
        normalizedBase = trimmed;
        changed = true;
        break;
      }
    }

    return normalizedBase;
  }

  private async listApiKeys(baseUrl: string, accessToken: string): Promise<Array<{ id: number; key: string; name: string; enabled: boolean; tokenGroup: string | null }>> {
    const endpoints = [
      '/api/v1/keys?page=1&page_size=100',
      '/api/v1/api-keys?page=1&page_size=100',
    ];

    const headers = this.buildAuthHeader(accessToken);
    for (const endpoint of endpoints) {
      try {
        const res = await this.fetchJson<any>(`${baseUrl}${endpoint}`, {
          headers,
        });
        const data = this.parseSub2ApiEnvelope<any>(res, endpoint);
        const items = this.parseTokenItems(data);
        if (items.length > 0) return items;
      } catch {}
    }

    return [];
  }

  private async fetchModelsByToken(baseUrl: string, token: string): Promise<string[]> {
    const authToken = this.normalizeTokenKeyForCompare(token);
    if (!authToken) return [];

    for (const url of this.resolveRouteEndpoints(baseUrl)) {
      try {
        const res = await this.fetchJson<any>(url, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const models = this.extractModelIds(res);
        if (models.length > 0) return models;
      } catch {}
    }

    return [];
  }

  private resolveExpiresInDays(expiredTime?: number): number | undefined {
    if (!Number.isFinite(expiredTime)) return undefined;
    const raw = Math.trunc(expiredTime as number);
    if (raw <= 0) return undefined;
    const expiresAtMs = raw > 10_000_000_000 ? raw : raw * 1000;
    const deltaMs = expiresAtMs - Date.now();
    const days = Math.max(1, Math.ceil(deltaMs / (24 * 60 * 60 * 1000)));
    return Number.isFinite(days) ? Math.min(days, 3650) : undefined;
  }

  async detect(url: string): Promise<boolean> {
    const normalized = (url || '').toLowerCase();
    if (normalized.includes('sub2api')) return true;

    const base = normalizeBaseUrl(url);
    const { fetch } = await import('undici');
    const probeEndpoint = async (path: string) => {
      try {
        return await fetch(`${base}${path}`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        return null;
      }
    };

    const matchSub2ApiErrorEnvelope = async (res: {
      headers: { get(name: string): string | null };
      json: () => Promise<unknown>;
    } | null): Promise<boolean> => {
      if (!res) return false;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) return false;
      const body = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') return false;
      const rawCode = body.code;
      const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
      const message = typeof body.message === 'string' ? body.message.trim().toLowerCase() : '';

      if (code === 'UNAUTHORIZED' || code === 'API_KEY_REQUIRED') return true;
      if (
        message.includes('authorization header is required')
        || message.includes('api key is required')
      ) {
        return true;
      }

      // Some Sub2API variants return numeric success envelope for authorized calls.
      if (typeof rawCode === 'number' && rawCode === 0) {
        return Object.prototype.hasOwnProperty.call(body, 'data');
      }

      return false;
    };

    const authProbe = await probeEndpoint('/api/v1/auth/me');
    if (await matchSub2ApiErrorEnvelope(authProbe)) return true;

    const modelsProbe = await probeEndpoint('/v1/models');
    if (await matchSub2ApiErrorEnvelope(modelsProbe)) return true;

    // Last fallback: many Sub2API UIs expose an identifying title on root.
    const rootProbe = await probeEndpoint('/');
    if (!rootProbe) return false;
    const rootType = rootProbe.headers.get('content-type') || '';
    if (!rootType.toLowerCase().includes('text/html')) return false;
    const rootText = await rootProbe.text().catch(() => '');
    return /<title>\s*sub2api\b/i.test(rootText);
  }

  /**
   * Parse the Sub2API { code, message, data } envelope.
   * code === 0 means success; anything else is an error.
   */
  private parseSub2ApiEnvelope<T>(body: any, endpoint: string): T {
    if (!body || typeof body !== 'object') {
      throw new Error(`Invalid response from ${endpoint}`);
    }
    if (typeof body.code !== 'number') {
      throw new Error(`Invalid response format from ${endpoint}`);
    }
    if (body.code !== 0) {
      const message = typeof body.message === 'string' && body.message.trim()
        ? body.message.trim()
        : `Error code ${body.code} from ${endpoint}`;
      throw new Error(message);
    }
    if (body.data === undefined) {
      throw new Error(`Missing data in response from ${endpoint}`);
    }
    return body.data as T;
  }

  /**
   * Extract display name: prefer username, fall back to email local part.
   */
  private getDisplayName(username?: string, email?: string): string {
    const name = (username || '').trim();
    if (name) return name;
    const mail = (email || '').trim();
    if (!mail) return '';
    const atIndex = mail.indexOf('@');
    return atIndex > 0 ? mail.slice(0, atIndex) : mail;
  }

  /**
   * Fetch user data from /api/v1/auth/me.
   */
  private async fetchAuthMe(baseUrl: string, accessToken: string): Promise<{
    id: number;
    username: string;
    email: string;
    balance: number;
  }> {
    const endpoint = '/api/v1/auth/me';
    const res = await this.fetchJson<any>(`${baseUrl}${endpoint}`, {
      headers: this.buildAuthHeader(accessToken),
    });
    const data = this.parseSub2ApiEnvelope<any>(res, endpoint);

    const id = typeof data.id === 'number' ? data.id
      : typeof data.id === 'string' ? Number.parseInt(data.id, 10)
      : NaN;
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(`Invalid user ID in response from ${endpoint}`);
    }

    const balance = typeof data.balance === 'number' ? data.balance
      : typeof data.balance === 'string' ? Number.parseFloat(data.balance)
      : 0;

    return {
      id,
      username: typeof data.username === 'string' ? data.username : '',
      email: typeof data.email === 'string' ? data.email : '',
      balance: Number.isFinite(balance) ? balance : 0,
    };
  }

  /**
   * Convert USD balance to internal quota unit.
   * Uses the same conversion factor as all-api-hub (500000 per USD).
   */
  private usdToQuota(balanceUsd: number): number {
    return Math.round(Math.max(0, balanceUsd) * 500000);
  }

  // --- Login: Not supported (JWT only) ---
  override async login(
    _baseUrl: string,
    _username: string,
    _password: string,
  ): Promise<{ success: false; message: string }> {
    return { success: false, message: 'Sub2API uses JWT authentication; login is not supported' };
  }

  // --- User Info ---
  override async getUserInfo(input: PlatformCredentialContext): Promise<UserInfo | null> {
    const baseUrl = input.endpoint.baseUrl;
    const accessToken = input.account.credential;
    try {
      const user = await this.fetchAuthMe(baseUrl, accessToken);
      return {
        username: this.getDisplayName(user.username, user.email),
        email: user.email || undefined,
      };
    } catch {
      return null;
    }
  }

  // --- Check-in: Not supported ---
  async checkin(_input: PlatformCredentialContext): Promise<CheckinResult> {
    return { success: false, message: 'Check-in is not supported by Sub2API' };
  }

  // --- Balance ---
  async getBalance(input: PlatformCredentialContext): Promise<BalanceInfo> {
    const baseUrl = input.endpoint.baseUrl;
    const accessToken = input.account.credential;
    const normalizedBase = normalizeBaseUrl(baseUrl);
    const [user, subscriptionSummary] = await Promise.all([
      this.fetchAuthMe(normalizedBase, accessToken),
      this.fetchSubscriptionSummary(normalizedBase, accessToken),
    ]);
    const quotaValue = this.usdToQuota(user.balance);
    // Sub2API only provides current balance, no usage breakdown
    return {
      balance: quotaValue / 500000,
      used: 0,
      quota: quotaValue / 500000,
      subscriptionSummary,
    };
  }

  // --- Models: Standard OpenAI-compatible endpoint ---
  async getModels(input: PlatformCredentialContext): Promise<string[]> {
    const baseUrl = input.endpoint.baseUrl;
    const apiToken = this.modelCredential(input);
    const normalizedBase = normalizeBaseUrl(baseUrl);
    return this.fetchModelsByToken(normalizedBase, apiToken);
  }

  override async getPricingCatalog(input: PlatformCredentialContext): Promise<UpstreamPricingCatalog | null> {
    const baseUrl = input.endpoint.baseUrl;
    const token = this.normalizeTokenKeyForCompare(this.pricingCredential(input));
    if (!token) return null;
    const managementBase = this.resolveManagementBaseUrl(baseUrl);
    const headers = this.buildAuthHeader(token);
    const [channels, groups, rates] = await Promise.all([
      this.fetchJson<unknown>(`${managementBase}/api/v1/channels/available`, { headers }),
      this.fetchJson<unknown>(`${managementBase}/api/v1/groups/available`, { headers }),
      this.fetchJson<unknown>(`${managementBase}/api/v1/groups/rates`, { headers }),
    ]);
    return this.parseSub2ApiCatalog(channels, groups, rates);
  }

  override async getSiteAnnouncements(input: PlatformCredentialContext): Promise<SiteAnnouncement[]> {
    const baseUrl = input.endpoint.baseUrl;
    const accessToken = input.account.credential;
    try {
      const endpoint = '/api/v1/announcements?page=1&page_size=100';
      const res = await this.fetchJson<any>(`${normalizeBaseUrl(baseUrl)}${endpoint}`, {
        headers: this.buildAuthHeader(accessToken),
      });
      const data = this.parseSub2ApiEnvelope<any>(res, endpoint);
      const rawItems = Array.isArray(data)
        ? data
        : (Array.isArray(data?.items) ? data.items : []);
      const rows: SiteAnnouncement[] = [];
      for (const item of rawItems) {
        const id = Number.parseInt(String(item?.id), 10);
        if (!Number.isFinite(id) || id <= 0) continue;
        const title = typeof item?.title === 'string' ? item.title.trim() : '';
        const content = typeof item?.content === 'string' ? item.content.trim() : '';
        if (!title && !content) continue;
        rows.push({
          sourceKey: `announcement:${id}`,
          title: title || `Announcement ${id}`,
          content: content || title,
          level: 'info',
          startsAt: typeof item?.starts_at === 'string' ? item.starts_at : undefined,
          endsAt: typeof item?.ends_at === 'string' ? item.ends_at : undefined,
          upstreamCreatedAt: typeof item?.created_at === 'string' ? item.created_at : undefined,
          upstreamUpdatedAt: typeof item?.updated_at === 'string' ? item.updated_at : undefined,
          rawPayload: item,
        });
      }
      return rows;
    } catch {
      return [];
    }
  }

  override async getApiTokens(input: PlatformCredentialContext): Promise<ApiTokenInfo[]> {
    const baseUrl = input.endpoint.baseUrl;
    const accessToken = input.account.credential;
    try {
      const keys = await this.listApiKeys(normalizeBaseUrl(baseUrl), accessToken);
      return keys.map((item) => {
        const tokenInfo: ApiTokenInfo = {
          name: item.name,
          key: item.key,
          enabled: item.enabled,
        };
        if (item.tokenGroup) tokenInfo.tokenGroup = item.tokenGroup;
        return tokenInfo;
      });
    } catch {
      return [];
    }
  }

  override async getApiToken(input: PlatformCredentialContext): Promise<string | null> {
    const tokens = await this.getApiTokens(input);
    return tokens.find((token) => token.enabled !== false)?.key || tokens[0]?.key || null;
  }

  override async getUserGroups(input: PlatformCredentialContext): Promise<string[]> {
    const baseUrl = input.endpoint.baseUrl;
    const accessToken = input.account.credential;
    const normalizedBase = normalizeBaseUrl(baseUrl);
    const directGroups = await this.listGroups(normalizedBase, accessToken);
    if (directGroups.length > 0) return directGroups;

    const inferredFromKeys = await this.inferGroupsFromKeys(normalizedBase, accessToken);
    if (inferredFromKeys.length > 0) return inferredFromKeys;

    return ['default'];
  }

  override async createApiToken(input: PlatformCredentialContext & { options?: CreateApiTokenOptions }): Promise<boolean> {
    const baseUrl = input.endpoint.baseUrl;
    const accessToken = input.account.credential;
    const options = input.options;
    const normalizedBase = normalizeBaseUrl(baseUrl);
    const payload: Record<string, unknown> = {
      name: (options?.name || '').trim() || 'metapi',
    };

    const groupId = Number.parseInt((options?.group || '').trim(), 10);
    if (Number.isFinite(groupId) && groupId > 0) {
      payload.group_id = groupId;
    }

    const expiresInDays = this.resolveExpiresInDays(options?.expiredTime);
    if (expiresInDays) {
      payload.expires_in_days = expiresInDays;
    }

    if (options?.unlimitedQuota === false && Number.isFinite(options.remainQuota)) {
      payload.quota = Math.max(0, Number(options.remainQuota));
    }

    const endpoints = ['/api/v1/keys', '/api/v1/api-keys'];
    const headers = this.buildAuthHeader(accessToken);
    for (const endpoint of endpoints) {
      try {
        const res = await this.fetchJson<any>(`${normalizedBase}${endpoint}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        this.parseSub2ApiEnvelope<any>(res, endpoint);
        return true;
      } catch {}
    }

    return false;
  }

  override async deleteApiToken(input: PlatformCredentialContext): Promise<boolean> {
    const baseUrl = input.endpoint.baseUrl;
    const accessToken = input.account.credential;
    const tokenKey = input.token?.token || '';
    const targetKey = this.normalizeTokenKeyForCompare(tokenKey);
    if (!targetKey) return false;

    const normalizedBase = normalizeBaseUrl(baseUrl);
    let tokenId: number | null = null;
    try {
      const items = await this.listApiKeys(normalizedBase, accessToken);
      tokenId = items.find((item) => this.normalizeTokenKeyForCompare(item.key) === targetKey)?.id || null;
    } catch {
      return false;
    }

    // Upstream key already absent means local deletion is safe.
    if (!tokenId) return true;

    const endpoints = [
      `/api/v1/keys/${tokenId}`,
      `/api/v1/api-keys/${tokenId}`,
    ];
    const headers = this.buildAuthHeader(accessToken);
    for (const endpoint of endpoints) {
      try {
        const res = await this.fetchJson<any>(`${normalizedBase}${endpoint}`, {
          method: 'DELETE',
          headers,
        });
        this.parseSub2ApiEnvelope<any>(res, endpoint);
        return true;
      } catch {}
    }

    return false;
  }
}
