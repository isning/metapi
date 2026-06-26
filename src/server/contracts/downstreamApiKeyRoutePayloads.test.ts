import { describe, expect, it } from 'vitest';
import {
  parseDownstreamApiKeyBatchPayload,
  parseDownstreamApiKeyPayload,
} from './downstreamApiKeyRoutePayloads.js';

describe('downstream API key route payload contracts', () => {
  it('accepts key settings including routing constraints and credential refs', () => {
    expect(parseDownstreamApiKeyPayload({
      name: 'customer-a',
      key: 'sk-a',
      description: null,
      groupName: 'paid',
      tags: ['team-a'],
      enabled: true,
      expiresAt: null,
      maxCost: '12.5',
      maxRequests: 1000,
      supportedModels: 'gpt-*',
      allowedRouteIds: ['1', 2],
      siteWeightMultipliers: { '1': '2' },
      excludedSiteIds: '3,4',
      excludedCredentialRefs: [
        { kind: 'account_token', siteId: '1', accountId: 2, tokenId: '3' },
        { kind: 'default_api_key', siteId: 1, accountId: '2' },
      ],
      extra: 'kept',
    })).toEqual({
      success: true,
      data: {
        name: 'customer-a',
        key: 'sk-a',
        description: null,
        groupName: 'paid',
        tags: ['team-a'],
        enabled: true,
        expiresAt: null,
        maxCost: '12.5',
        maxRequests: 1000,
        supportedModels: 'gpt-*',
        allowedRouteIds: ['1', 2],
        siteWeightMultipliers: { '1': '2' },
        excludedSiteIds: '3,4',
        excludedCredentialRefs: [
          { kind: 'account_token', siteId: '1', accountId: 2, tokenId: '3' },
          { kind: 'default_api_key', siteId: 1, accountId: '2' },
        ],
        extra: 'kept',
      },
    });
    expect(parseDownstreamApiKeyBatchPayload({ ids: [1], action: 'enable', tags: 'vip' })).toEqual({
      success: true,
      data: { ids: [1], action: 'enable', tags: 'vip' },
    });
  });

  it('returns field-specific validation messages', () => {
    const cases: Array<[string, () => unknown, string]> = [
      ['non-object payload', () => parseDownstreamApiKeyPayload([]), '参数无效：请求体必须是对象'],
      ['name', () => parseDownstreamApiKeyPayload({ name: 1 }), 'Invalid name. Expected string.'],
      ['key', () => parseDownstreamApiKeyPayload({ key: 1 }), 'Invalid key. Expected string.'],
      ['description', () => parseDownstreamApiKeyPayload({ description: 1 }), 'Invalid description. Expected string or null.'],
      ['groupName', () => parseDownstreamApiKeyPayload({ groupName: 1 }), 'Invalid groupName. Expected string or null.'],
      ['tags', () => parseDownstreamApiKeyPayload({ tags: [1] }), 'Invalid tags. Expected string or string[].'],
      ['enabled', () => parseDownstreamApiKeyPayload({ enabled: 'yes' }), 'Invalid enabled. Expected boolean.'],
      ['expiresAt', () => parseDownstreamApiKeyPayload({ expiresAt: 1 }), 'Invalid expiresAt. Expected string or null.'],
      ['maxCost', () => parseDownstreamApiKeyPayload({ maxCost: {} }), 'Invalid maxCost. Expected number, string, or null.'],
      ['maxRequests', () => parseDownstreamApiKeyPayload({ maxRequests: {} }), 'Invalid maxRequests. Expected number, string, or null.'],
      ['supportedModels', () => parseDownstreamApiKeyPayload({ supportedModels: [1] }), 'Invalid supportedModels. Expected string or string[].'],
      ['allowedRouteIds', () => parseDownstreamApiKeyPayload({ allowedRouteIds: {} }), 'Invalid allowedRouteIds. Expected string or array.'],
      ['siteWeightMultipliers', () => parseDownstreamApiKeyPayload({ siteWeightMultipliers: [] }), 'Invalid siteWeightMultipliers. Expected JSON object or string.'],
      ['excludedSiteIds', () => parseDownstreamApiKeyPayload({ excludedSiteIds: {} }), 'Invalid excludedSiteIds. Expected string or array.'],
      ['excludedCredentialRefs', () => parseDownstreamApiKeyPayload({ excludedCredentialRefs: [{ kind: 'unknown' }] }), 'Invalid excludedCredentialRefs. Expected JSON string or array.'],
      ['ids', () => parseDownstreamApiKeyBatchPayload({ ids: [0] }), 'Invalid ids. Expected number[].'],
      ['action', () => parseDownstreamApiKeyBatchPayload({ action: 1 }), 'Invalid action. Expected string.'],
      ['groupOperation', () => parseDownstreamApiKeyBatchPayload({ groupOperation: 1 }), 'Invalid groupOperation. Expected string.'],
      ['tagOperation', () => parseDownstreamApiKeyBatchPayload({ tagOperation: 1 }), 'Invalid tagOperation. Expected string.'],
    ];

    for (const [name, parse, error] of cases) {
      expect(parse(), name).toEqual({ success: false, error });
    }
  });
});
