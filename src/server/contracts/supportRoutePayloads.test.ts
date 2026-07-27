import { describe, expect, it } from 'vitest';
import {
  parseAuthChangePayload,
  parseMonitorConfigPayload,
  parseOauthConnectionProxyUpdatePayload,
  parseOauthConnectionRebindPayload,
  parseOauthImportPayload,
  parseOauthManualCallbackPayload,
  parseOauthQuotaBatchRefreshPayload,
  parseOauthRouteUnitCreatePayload,
  parseOauthRouteUnitUpdatePayload,
  parseOauthStartPayload,
  parseUpdateCenterConfigPayload,
  parseUpdateCenterDeployPayload,
  parseUpdateCenterRollbackPayload,
} from './supportRoutePayloads.js';

describe('support route payload contracts', () => {
  it('accepts auth, monitor, oauth, and update-center payloads', () => {
    expect(parseAuthChangePayload({ oldToken: 'old', newToken: 'new' })).toEqual({
      success: true,
      data: { oldToken: 'old', newToken: 'new' },
    });
    expect(parseMonitorConfigPayload(undefined)).toEqual({ success: true, data: {} });
    expect(parseMonitorConfigPayload({ ldohCookie: null })).toEqual({
      success: true,
      data: { ldohCookie: null },
    });
    expect(parseOauthStartPayload({
      accountId: 1,
      projectId: 'project',
      proxyUrl: null,
      useSystemProxy: false,
    })).toMatchObject({ success: true });
    expect(parseOauthManualCallbackPayload({ callbackUrl: 'http://localhost/callback' })).toMatchObject({
      success: true,
    });
    expect(parseOauthConnectionRebindPayload({ proxyUrl: 'http://proxy', useSystemProxy: true })).toMatchObject({
      success: true,
    });
    expect(parseOauthConnectionProxyUpdatePayload({ proxyUrl: null, useSystemProxy: false })).toMatchObject({
      success: true,
    });
    expect(parseOauthQuotaBatchRefreshPayload({ accountIds: [1, 2] })).toEqual({
      success: true,
      data: { accountIds: [1, 2] },
    });
    expect(parseOauthImportPayload({
      data: { accounts: [] },
      items: [{ id: 1 }],
      proxyUrl: null,
      useSystemProxy: false,
    })).toMatchObject({ success: true });
    expect(parseOauthRouteUnitCreatePayload({
      accountIds: [1],
      name: 'Pool',
      strategy: ' ROUND_ROBIN ',
    })).toEqual({
      success: true,
      data: { accountIds: [1], name: 'Pool', strategy: 'round_robin' },
    });
    expect(parseOauthRouteUnitUpdatePayload({ strategy: 'STICK_UNTIL_UNAVAILABLE' })).toEqual({
      success: true,
      data: { strategy: 'stick_until_unavailable' },
    });
    expect(parseUpdateCenterConfigPayload({
      enabled: true,
      helperBaseUrl: 'http://helper',
      namespace: 'default',
      releaseName: 'metapi',
      chartRef: 'metapi/chart',
      imageRepository: 'metapi',
      githubReleasesEnabled: true,
      dockerHubTagsEnabled: false,
      defaultDeploySource: 'github-release',
    })).toMatchObject({ success: true });
    expect(parseUpdateCenterDeployPayload({ source: 'docker-hub-tag', targetTag: 'latest' })).toMatchObject({
      success: true,
    });
    expect(parseUpdateCenterRollbackPayload({ targetRevision: '1' })).toMatchObject({ success: true });
  });

  it('returns field-specific validation messages', () => {
    const cases: Array<[string, () => unknown, string]> = [
      ['non-object', () => parseAuthChangePayload([]), '请求体必须是对象'],
      ['oldToken', () => parseAuthChangePayload({ oldToken: 1 }), 'Invalid oldToken. Expected string.'],
      ['newToken', () => parseAuthChangePayload({ newToken: 1 }), 'Invalid newToken. Expected string.'],
      ['ldohCookie', () => parseMonitorConfigPayload({ ldohCookie: 1 }), 'Invalid ldohCookie. Expected string or null.'],
      ['accountId', () => parseOauthStartPayload({ accountId: 0 }), 'Invalid accountId. Expected positive number.'],
      ['projectId', () => parseOauthStartPayload({ projectId: 1 }), 'Invalid projectId. Expected string.'],
      ['proxyUrl', () => parseOauthStartPayload({ proxyUrl: 1 }), 'Invalid proxyUrl. Expected string or null.'],
      ['useSystemProxy', () => parseOauthStartPayload({ useSystemProxy: 'yes' }), 'Invalid useSystemProxy. Expected boolean.'],
      ['accountIds', () => parseOauthQuotaBatchRefreshPayload({ accountIds: [0] }), 'Invalid accountIds. Expected positive number array.'],
      ['name', () => parseOauthRouteUnitCreatePayload({ name: 1 }), 'Invalid name. Expected string.'],
      ['strategy', () => parseOauthRouteUnitCreatePayload({ strategy: 'weighted' }), 'Invalid strategy. Expected round_robin/stick_until_unavailable.'],
      ['callbackUrl', () => parseOauthManualCallbackPayload({ callbackUrl: 1 }), 'Invalid callbackUrl. Expected string.'],
      ['items', () => parseOauthImportPayload({ items: [1] }), 'Invalid items. Expected object array.'],
      ['enabled', () => parseUpdateCenterConfigPayload({ enabled: 'yes' }), 'Invalid enabled. Expected boolean.'],
      ['helperBaseUrl', () => parseUpdateCenterConfigPayload({ helperBaseUrl: 1 }), 'Invalid helperBaseUrl. Expected string.'],
      ['namespace', () => parseUpdateCenterConfigPayload({ namespace: 1 }), 'Invalid namespace. Expected string.'],
      ['releaseName', () => parseUpdateCenterConfigPayload({ releaseName: 1 }), 'Invalid releaseName. Expected string.'],
      ['chartRef', () => parseUpdateCenterConfigPayload({ chartRef: 1 }), 'Invalid chartRef. Expected string.'],
      ['imageRepository', () => parseUpdateCenterConfigPayload({ imageRepository: 1 }), 'Invalid imageRepository. Expected string.'],
      ['githubReleasesEnabled', () => parseUpdateCenterConfigPayload({ githubReleasesEnabled: 'yes' }), 'Invalid githubReleasesEnabled. Expected boolean.'],
      ['dockerHubTagsEnabled', () => parseUpdateCenterConfigPayload({ dockerHubTagsEnabled: 'yes' }), 'Invalid dockerHubTagsEnabled. Expected boolean.'],
      ['defaultDeploySource', () => parseUpdateCenterConfigPayload({ defaultDeploySource: 'manual' }), 'Invalid defaultDeploySource. Expected docker-hub-tag/github-release.'],
      ['source', () => parseUpdateCenterDeployPayload({ source: 'manual' }), 'Invalid source. Expected docker-hub-tag/github-release.'],
      ['targetVersion', () => parseUpdateCenterDeployPayload({ targetVersion: 1 }), 'Invalid targetVersion. Expected string.'],
      ['targetTag', () => parseUpdateCenterDeployPayload({ targetTag: 1 }), 'Invalid targetTag. Expected string.'],
      ['targetDigest', () => parseUpdateCenterDeployPayload({ targetDigest: 1 }), 'Invalid targetDigest. Expected string.'],
      ['targetRevision', () => parseUpdateCenterRollbackPayload({ targetRevision: 1 }), 'Invalid targetRevision. Expected string.'],
    ];

    for (const [name, parse, error] of cases) {
      expect(parse(), name).toEqual({ success: false, error });
    }
  });
});
