import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAdapterMock } = vi.hoisted(() => ({
  getAdapterMock: vi.fn(),
}));
const { refreshAccountSessionFromAutoReloginMock } = vi.hoisted(() => ({
  refreshAccountSessionFromAutoReloginMock: vi.fn(),
}));

vi.mock('./platforms/index.js', () => ({
  getAdapter: (...args: unknown[]) => getAdapterMock(...args),
}));

vi.mock('./accountAutoReloginService.js', () => ({
  refreshAccountSessionFromAutoRelogin: (...args: unknown[]) => refreshAccountSessionFromAutoReloginMock(...args),
}));

import {
  fetchUpstreamPricingCatalog,
} from './upstreamPricingCatalogService.js';
import {
  normalizeCommonPricingPayload,
  normalizeOneHubPricingPayload,
} from './upstreamPricingCatalog.js';

describe('upstreamPricingCatalogService', () => {
  beforeEach(() => {
    getAdapterMock.mockReset();
    refreshAccountSessionFromAutoReloginMock.mockReset();
    refreshAccountSessionFromAutoReloginMock.mockResolvedValue(null);
  });

  it('builds platform pricing credentials from account and site context', async () => {
    const getPricingCatalog = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        models: new Map([['gpt-4o-mini', {
          modelName: 'gpt-4o-mini',
          quotaType: 0,
          modelRatio: 1,
          completionRatio: 1,
          modelPrice: null,
          enableGroups: ['default'],
        }]]),
        groupRatio: { default: 1 },
      });
    getAdapterMock.mockReturnValue({ getPricingCatalog });

    const catalog = await fetchUpstreamPricingCatalog({
      site: {
        id: 1,
        url: 'https://newapi.example.com/',
        platform: 'newapi',
        apiKey: 'site-key',
      },
      account: {
        id: 2,
        username: 'user-7788',
        credential: 'session-token',
        extraConfig: JSON.stringify({ platformUserId: 42 }),
      },
      upstreamCredential: { token: 'api-token', tokenKind: 'api_token' },
    });

    expect(catalog?.models.size).toBe(1);
    expect(getAdapterMock).toHaveBeenCalledWith('new-api');
    expect(getPricingCatalog).toHaveBeenNthCalledWith(1, 'https://newapi.example.com', {
      token: 'api-token',
      tokenKind: 'api_token',
      platformUserId: 42,
    });
    expect(getPricingCatalog).toHaveBeenNthCalledWith(2, 'https://newapi.example.com', {
      token: 'session-token',
      tokenKind: 'access_token',
      platformUserId: 42,
    });
  });

  it('skips missing account credentials before falling back to site key and public pricing', async () => {
    const getPricingCatalog = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        models: new Map([['site-priced-model', {
          modelName: 'site-priced-model',
          quotaType: 0,
          modelRatio: 1,
          completionRatio: 1,
          modelPrice: null,
          enableGroups: ['default'],
        }]]),
        groupRatio: { default: 1 },
      });
    getAdapterMock.mockReturnValue({ getPricingCatalog });

    const catalog = await fetchUpstreamPricingCatalog({
      site: {
        id: 1,
        url: 'https://newapi.example.com/',
        platform: 'newapi',
        apiKey: 'site-key',
      },
      account: {
        id: 2,
        username: 'user-7788',
        credential: null,
        extraConfig: JSON.stringify({ platformUserId: 42 }),
      },
      upstreamCredential: { token: 'api-token', tokenKind: 'api_token' },
    });

    expect(catalog?.models.has('site-priced-model')).toBe(true);
    expect(getPricingCatalog).toHaveBeenCalledTimes(2);
    expect(getPricingCatalog).toHaveBeenNthCalledWith(1, 'https://newapi.example.com', {
      token: 'api-token',
      tokenKind: 'api_token',
      platformUserId: 42,
    });
    expect(getPricingCatalog).toHaveBeenNthCalledWith(2, 'https://newapi.example.com', {
      token: 'site-key',
      tokenKind: 'site_api_key',
      platformUserId: 42,
    });
  });

  it('continues to later credentials after a credential-specific pricing catalog failure', async () => {
    const getPricingCatalog = vi.fn()
      .mockRejectedValueOnce(new Error('api key rejected'))
      .mockResolvedValueOnce({
        models: new Map([['api-priced-model', {
          modelName: 'api-priced-model',
          quotaType: 0,
          modelRatio: 1,
          completionRatio: 1,
          modelPrice: null,
          enableGroups: ['default'],
        }]]),
        groupRatio: { default: 1 },
      });
    getAdapterMock.mockReturnValue({ getPricingCatalog });

    const catalog = await fetchUpstreamPricingCatalog({
      site: {
        id: 1,
        url: 'https://newapi.example.com/',
        platform: 'newapi',
        apiKey: null,
      },
      account: {
        id: 2,
        username: 'user-7788',
        credential: 'session-token',
        extraConfig: JSON.stringify({ platformUserId: 42 }),
      },
      upstreamCredential: { token: 'rejected-api-token', tokenKind: 'api_token' },
    });

    expect(catalog?.models.has('api-priced-model')).toBe(true);
    expect(getPricingCatalog).toHaveBeenCalledTimes(2);
  });

  it('reports pricing catalog credential failures instead of returning unavailable', async () => {
    const getPricingCatalog = vi.fn()
      .mockRejectedValueOnce(new Error('api key rejected'))
      .mockRejectedValueOnce(new Error('session expired'))
      .mockResolvedValueOnce(null);
    getAdapterMock.mockReturnValue({ getPricingCatalog });

    await expect(fetchUpstreamPricingCatalog({
      site: {
        id: 1,
        url: 'https://newapi.example.com/',
        platform: 'newapi',
        apiKey: null,
      },
      account: {
        id: 2,
        username: 'user-7788',
        credential: 'expired-session-token',
        extraConfig: JSON.stringify({ platformUserId: 42 }),
      },
      upstreamCredential: { token: 'rejected-api-token', tokenKind: 'api_token' },
    })).rejects.toThrow('api_token: api key rejected; access_token: session expired');
  });

  it('relogs in once after all existing credentials and public pricing are unavailable', async () => {
    const catalog = {
      models: new Map([['account-priced-model', {
        modelName: 'account-priced-model',
        quotaType: 0,
        modelRatio: 1,
        completionRatio: 1,
        modelPrice: null,
        enableGroups: ['default'],
      }]]),
      groupRatio: { default: 1 },
    };
    const getPricingCatalog = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(catalog);
    getAdapterMock.mockReturnValue({ getPricingCatalog });
    refreshAccountSessionFromAutoReloginMock.mockResolvedValue('fresh-session-token');

    const input = {
      site: { id: 1, url: 'https://newapi.example.com', platform: 'new-api', apiKey: null },
      account: {
        id: 2,
        username: 'user-7788',
        credential: 'expired-session-token',
        extraConfig: JSON.stringify({ autoRelogin: { username: 'user-7788', passwordCipher: 'cipher' } }),
      },
    };
    const result = await fetchUpstreamPricingCatalog(input);

    expect(result).toBe(catalog);
    expect(refreshAccountSessionFromAutoReloginMock).toHaveBeenCalledWith(input.account, input.site);
    expect(getPricingCatalog).toHaveBeenLastCalledWith('https://newapi.example.com', {
      token: 'fresh-session-token',
      tokenKind: 'access_token',
      platformUserId: 7788,
    });
  });

  it('preserves missing direct token prices instead of coercing them to zero', () => {
    const common = normalizeCommonPricingPayload({
      data: [{
        model_name: 'deepseek-v4-flash',
        quota_type: 0,
        model_ratio: 1,
        completion_ratio: 1,
        model_price: { input: 0.7 },
      }],
    });
    expect(common?.models.get('deepseek-v4-flash')?.modelPrice).toEqual({ input: 0.7 });

    const oneHub = normalizeOneHubPricingPayload({
      data: {
        'deepseek-v4-flash': {
          price: { type: 'tokens', input: 0.7 },
        },
      },
    }, {});
    expect(oneHub?.models.get('deepseek-v4-flash')?.modelPrice).toEqual({ input: 0.7 });
  });
});
