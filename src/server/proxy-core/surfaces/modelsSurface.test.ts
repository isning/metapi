import { describe, expect, it, vi } from 'vitest';

import { listModelsSurface, retrieveModelSurface } from './modelsSurface.js';

describe('listModelsSurface', () => {
  it('returns OpenAI list shape and hides models without a resolvable channel', async () => {
    const result = await listModelsSurface({
      downstreamPolicy: { type: 'all' },
      responseFormat: 'openai',
      listModelNames: vi.fn().mockResolvedValue(['routable-model', 'orphan-model']),
      canSelectModel: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
      isModelAllowed: vi.fn().mockResolvedValue(true),
      now: () => new Date('2026-03-19T00:00:00.000Z'),
    });

    expect(result).toEqual({
      object: 'list',
      data: [
        {
          id: 'routable-model',
          object: 'model',
          created: 1773878400,
          owned_by: 'metapi',
        },
      ],
    });
  });

  it('returns Claude list shape when requested', async () => {
    const result = await listModelsSurface({
      downstreamPolicy: { type: 'all' },
      responseFormat: 'claude',
      listModelNames: vi.fn().mockResolvedValue(['claude-opus-4-6']),
      canSelectModel: vi.fn().mockResolvedValue(true),
      isModelAllowed: vi.fn().mockResolvedValue(true),
      now: () => new Date('2026-03-19T00:00:00.000Z'),
    });

    expect(result).toEqual({
      data: [
        {
          id: 'claude-opus-4-6',
          type: 'model',
          display_name: 'claude-opus-4-6',
          created_at: '2026-03-19T00:00:00.000Z',
        },
      ],
      first_id: 'claude-opus-4-6',
      last_id: 'claude-opus-4-6',
      has_more: false,
    });
  });

  it('returns an empty read without refreshing when downstream policy filters every model', async () => {
    const listModelNames = vi.fn().mockResolvedValue(['blocked-model']);
    const refreshModelsAndRebuildRoutes = vi.fn().mockResolvedValue(undefined);
    const isModelAllowed = vi.fn().mockResolvedValue(false);
    const canSelectModel = vi.fn().mockResolvedValue(true);

    const result = await listModelsSurface({
      downstreamPolicy: { type: 'whitelist' },
      responseFormat: 'openai',
      listModelNames,
      canSelectModel,
      isModelAllowed,
      now: () => new Date('2026-03-19T00:00:00.000Z'),
    });

    expect(refreshModelsAndRebuildRoutes).not.toHaveBeenCalled();
    expect(result).toEqual({
      object: 'list',
      data: [],
    });
  });
});

describe('retrieveModelSurface', () => {
  it('returns OpenAI model shape for a routable model', async () => {
    const result = await retrieveModelSurface({
      modelId: 'gpt-4.1',
      downstreamPolicy: { type: 'all' },
      responseFormat: 'openai',
      listModelNames: vi.fn(),
      canSelectModel: vi.fn().mockResolvedValue(true),
      isModelAllowed: vi.fn().mockResolvedValue(true),
      now: () => new Date('2026-03-19T00:00:00.000Z'),
    });

    expect(result).toEqual({
      statusCode: 200,
      payload: {
        id: 'gpt-4.1',
        object: 'model',
        created: 1773878400,
        owned_by: 'metapi',
      },
    });
  });

  it('returns model_not_found without refreshing for an unroutable model', async () => {
    const canSelectModel = vi.fn().mockResolvedValue(false);
    const refreshModelsAndRebuildRoutes = vi.fn().mockResolvedValue(undefined);

    const result = await retrieveModelSurface({
      modelId: 'missing-model',
      downstreamPolicy: { type: 'all' },
      responseFormat: 'openai',
      listModelNames: vi.fn(),
      canSelectModel,
      isModelAllowed: vi.fn().mockResolvedValue(true),
      now: () => new Date('2026-03-19T00:00:00.000Z'),
    });

    expect(refreshModelsAndRebuildRoutes).not.toHaveBeenCalled();
    expect(canSelectModel).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      statusCode: 404,
      payload: {
        error: {
          message: "Model 'missing-model' not found",
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      },
    });
  });

  it('hides search pseudo models from single-model retrieval', async () => {
    const result = await retrieveModelSurface({
      modelId: '__search',
      downstreamPolicy: { type: 'all' },
      responseFormat: 'openai',
      listModelNames: vi.fn(),
      canSelectModel: vi.fn(),
      isModelAllowed: vi.fn().mockResolvedValue(true),
    });

    expect(result.statusCode).toBe(404);
  });
});
