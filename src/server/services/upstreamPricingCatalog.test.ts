import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAdapterMock } = vi.hoisted(() => ({
  getAdapterMock: vi.fn(),
}));

vi.mock('./platforms/index.js', () => ({
  getAdapter: (...args: unknown[]) => getAdapterMock(...args),
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
        accessToken: 'session-token',
        apiToken: 'api-token',
        extraConfig: JSON.stringify({ platformUserId: 42 }),
      },
    });

    expect(catalog?.models.size).toBe(1);
    expect(getAdapterMock).toHaveBeenCalledWith('new-api');
    expect(getPricingCatalog).toHaveBeenNthCalledWith(1, 'https://newapi.example.com', {
      token: 'session-token',
      tokenKind: 'access_token',
      platformUserId: 42,
    });
    expect(getPricingCatalog).toHaveBeenNthCalledWith(2, 'https://newapi.example.com', {
      token: 'api-token',
      tokenKind: 'api_token',
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
        accessToken: null,
        apiToken: 'api-token',
        extraConfig: JSON.stringify({ platformUserId: 42 }),
      },
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
