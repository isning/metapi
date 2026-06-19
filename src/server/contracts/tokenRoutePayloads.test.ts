import { describe, expect, it } from 'vitest';
import {
  parseRouteChannelBatchCreatePayload,
  parseRouteChannelCreatePayload,
  parseRouteChannelUpdatePayload,
  parseRouteGraphSourcePayload,
  parseRouteRebuildPayload,
  parseTokenRouteBatchPayload,
  parseTokenRouteCreatePayload,
  parseTokenRouteUpdatePayload,
} from './tokenRoutePayloads.js';

describe('token route payload contracts', () => {
  it('accepts graph-native token route payloads', () => {
    expect(parseTokenRouteCreatePayload({
      match: {
        kind: 'model',
        requestedModelPattern: 'gpt-*',
        displayName: 'GPT',
      },
      backend: {
        kind: 'routes',
        routeIds: [1, 2],
      },
      macro: {
        id: 'macro-1',
        kind: 'candidate-group',
      },
      presentation: {
        displayName: 'GPT',
        displayIcon: null,
      },
      modelMapping: null,
      routingStrategy: 'round_robin',
      enabled: true,
      extra: 'kept',
    })).toEqual({
      success: true,
      data: {
        match: {
          kind: 'model',
          requestedModelPattern: 'gpt-*',
          displayName: 'GPT',
        },
        backend: {
          kind: 'routes',
          routeIds: [1, 2],
        },
        macro: {
          id: 'macro-1',
          kind: 'candidate-group',
        },
        presentation: {
          displayName: 'GPT',
          displayIcon: null,
        },
        modelMapping: null,
        routingStrategy: 'round_robin',
        enabled: true,
        extra: 'kept',
      },
    });

    expect(parseTokenRouteUpdatePayload({ backend: { kind: 'channels' }, enabled: false })).toEqual({
      success: true,
      data: { backend: { kind: 'channels' }, enabled: false },
    });
  });

  it('normalizes legacy pattern and explicit-group token route payloads', () => {
    expect(parseTokenRouteCreatePayload({
      modelPattern: 'deepseek-*',
      displayName: 'DeepSeek',
      displayIcon: 'brain',
      routeMode: 'pattern',
    })).toEqual({
      success: true,
      data: {
        modelPattern: 'deepseek-*',
        displayName: 'DeepSeek',
        displayIcon: 'brain',
        routeMode: 'pattern',
        match: {
          kind: 'model',
          requestedModelPattern: 'deepseek-*',
          displayName: 'DeepSeek',
        },
        backend: { kind: 'channels' },
        presentation: {
          displayName: 'DeepSeek',
          displayIcon: 'brain',
        },
      },
    });

    expect(parseTokenRouteCreatePayload({
      routeMode: 'explicit_group',
      displayName: 'Fast Group',
      sourceRouteIds: ['1', 2, 0, 'bad'],
    })).toEqual({
      success: true,
      data: {
        routeMode: 'explicit_group',
        displayName: 'Fast Group',
        sourceRouteIds: ['1', 2, 0, 'bad'],
        match: {
          kind: 'model',
          requestedModelPattern: '',
          displayName: 'Fast Group',
        },
        backend: {
          kind: 'routes',
          routeIds: [1, 2],
        },
        presentation: {
          displayName: 'Fast Group',
          displayIcon: null,
        },
      },
    });
  });

  it('accepts route channel, rebuild, batch, and graph source payloads', () => {
    expect(parseRouteChannelCreatePayload({
      accountId: 1,
      tokenId: null,
      sourceModel: 'gpt-4.1',
      priority: 0,
      weight: 10,
    })).toMatchObject({ success: true });
    expect(parseRouteChannelBatchCreatePayload({
      channels: [{ accountId: 1, tokenId: 2, sourceModel: 'gpt-4.1' }],
    })).toMatchObject({ success: true });
    expect(parseRouteChannelUpdatePayload({
      tokenId: null,
      sourceModel: null,
      priority: 1,
      weight: 20,
      enabled: false,
    })).toMatchObject({ success: true });
    expect(parseTokenRouteBatchPayload({ ids: [1], action: 'delete' })).toEqual({
      success: true,
      data: { ids: [1], action: 'delete' },
    });
    expect(parseRouteRebuildPayload(undefined)).toEqual({ success: true, data: {} });
    expect(parseRouteGraphSourcePayload({
      version: 1,
      nodes: [{ id: 'entry', type: 'entry' }],
      macros: [{ id: 'macro-1', kind: 'candidate-group' }],
      edges: [{ sourceNodeId: 'entry', targetNodeId: 'macro:macro-1' }],
      metadata: { owner: 'test' },
    })).toMatchObject({ success: true });
  });

  it('returns field-specific validation messages', () => {
    const cases: Array<[string, () => unknown, string]> = [
      ['non-object', () => parseTokenRouteCreatePayload([]), '请求体必须是对象'],
      ['match', () => parseTokenRouteCreatePayload({ match: null, backend: { kind: 'channels' } }), 'Invalid match. Expected Route Graph match object.'],
      ['backend', () => parseTokenRouteCreatePayload({ match: {}, backend: { kind: 'routes', routeIds: [0] } }), 'Invalid backend. Expected Route Graph backend object.'],
      ['presentation', () => parseTokenRouteUpdatePayload({ presentation: { displayIcon: 1 } }), 'Invalid presentation. Expected Route Graph presentation object.'],
      ['displayName', () => parseTokenRouteUpdatePayload({ match: { displayName: 1 } }), 'Invalid match. Expected Route Graph match object.'],
      ['modelMapping', () => parseTokenRouteUpdatePayload({ modelMapping: 1 }), 'Invalid modelMapping. Expected string or null.'],
      ['routingStrategy', () => parseTokenRouteUpdatePayload({ routingStrategy: 1 }), 'Invalid routingStrategy. Expected string.'],
      ['enabled', () => parseTokenRouteUpdatePayload({ enabled: 'yes' }), 'Invalid enabled. Expected boolean.'],
      ['ids', () => parseTokenRouteBatchPayload({ ids: [0] }), 'Invalid ids. Expected number[].'],
      ['action', () => parseTokenRouteBatchPayload({ action: 1 }), 'Invalid action. Expected string.'],
      ['accountId', () => parseRouteChannelCreatePayload({ accountId: 0 }), 'Invalid accountId. Expected positive number.'],
      ['tokenId', () => parseRouteChannelCreatePayload({ accountId: 1, tokenId: 0 }), 'Invalid tokenId. Expected positive number or null.'],
      ['sourceModel', () => parseRouteChannelUpdatePayload({ sourceModel: 1 }), 'Invalid sourceModel. Expected string or null.'],
      ['priority', () => parseRouteChannelUpdatePayload({ priority: 'high' }), 'Invalid priority. Expected number.'],
      ['weight', () => parseRouteChannelUpdatePayload({ weight: 'heavy' }), 'Invalid weight. Expected number.'],
      ['refreshModels', () => parseRouteRebuildPayload({ refreshModels: 'yes' }), 'Invalid refreshModels. Expected boolean.'],
      ['wait', () => parseRouteRebuildPayload({ wait: 'yes' }), 'Invalid wait. Expected boolean.'],
      ['nodes', () => parseRouteGraphSourcePayload({ nodes: [{ id: '', type: 'entry' }], edges: [] }), 'Invalid route graph nodes. Expected typed node array.'],
      ['edges', () => parseRouteGraphSourcePayload({ nodes: [], edges: [{ sourceNodeId: '' }] }), 'Invalid route graph edges. Expected edge array.'],
      ['channels empty', () => parseRouteChannelBatchCreatePayload({ channels: [] }), 'Invalid channels. Expected channel array.'],
      ['channels accountId', () => parseRouteChannelBatchCreatePayload({ channels: [{ accountId: 0 }] }), 'Invalid channels[].accountId. Expected positive number.'],
      ['channels tokenId', () => parseRouteChannelBatchCreatePayload({ channels: [{ accountId: 1, tokenId: 0 }] }), 'Invalid channels[].tokenId. Expected positive number or null.'],
      ['channels sourceModel', () => parseRouteChannelBatchCreatePayload({ channels: [{ accountId: 1, sourceModel: 1 }] }), 'Invalid channels[].sourceModel. Expected string.'],
    ];

    for (const [name, parse, error] of cases) {
      expect(parse(), name).toEqual({ success: false, error });
    }
  });
});
