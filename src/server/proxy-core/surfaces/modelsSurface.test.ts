import { describe, expect, it, vi } from 'vitest';

import { listModelsSurface, retrieveModelSurface } from './modelsSurface.js';

describe('listModelsSurface', () => {
  it('returns OpenAI list shape and hides models without a resolvable channel', async () => {
    const result = await listModelsSurface({
      downstreamPolicy: { type: 'all' },
      responseFormat: 'openai',
      tokenRouter: {
        getAvailableModels: vi.fn().mockResolvedValue(['routable-model', 'orphan-model']),
        explainSelection: vi.fn()
          .mockResolvedValueOnce({ selectedTargetId: null })
          .mockResolvedValueOnce({ selectedTargetId: 11 }),
      },
      refreshModelsAndRebuildRoutes: vi.fn(),
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
      tokenRouter: {
        getAvailableModels: vi.fn().mockResolvedValue(['claude-opus-4-6']),
        explainSelection: vi.fn().mockResolvedValue({ selectedTargetId: 22 }),
      },
      refreshModelsAndRebuildRoutes: vi.fn(),
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

  it('applies downstream policy filtering before selection checks and refreshes once when the first read is empty', async () => {
    const getAvailableModels = vi.fn()
      .mockResolvedValueOnce(['blocked-model'])
      .mockResolvedValueOnce(['allowed-model']);
    const refreshModelsAndRebuildRoutes = vi.fn().mockResolvedValue(undefined);
    const isModelAllowed = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const explainSelection = vi.fn().mockResolvedValue({ selectedTargetId: 33 });

    const result = await listModelsSurface({
      downstreamPolicy: { type: 'whitelist' },
      responseFormat: 'openai',
      tokenRouter: {
        getAvailableModels,
        explainSelection,
      },
      refreshModelsAndRebuildRoutes,
      isModelAllowed,
      now: () => new Date('2026-03-19T00:00:00.000Z'),
    });

    expect(refreshModelsAndRebuildRoutes).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      object: 'list',
      data: [
        {
          id: 'allowed-model',
          object: 'model',
          created: 1773878400,
          owned_by: 'metapi',
        },
      ],
    });
  });
});

describe('retrieveModelSurface', () => {
  it('returns OpenAI model shape for a routable model', async () => {
    const result = await retrieveModelSurface({
      modelId: 'gpt-4.1',
      downstreamPolicy: { type: 'all' },
      responseFormat: 'openai',
      tokenRouter: {
        getAvailableModels: vi.fn(),
        explainSelection: vi.fn().mockResolvedValue({ selectedTargetId: 11 }),
      },
      refreshModelsAndRebuildRoutes: vi.fn(),
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

  it('refreshes once before returning model_not_found for an unroutable model', async () => {
    const explainSelection = vi.fn().mockResolvedValue({ selectedTargetId: null });
    const refreshModelsAndRebuildRoutes = vi.fn().mockResolvedValue(undefined);

    const result = await retrieveModelSurface({
      modelId: 'missing-model',
      downstreamPolicy: { type: 'all' },
      responseFormat: 'openai',
      tokenRouter: {
        getAvailableModels: vi.fn(),
        explainSelection,
      },
      refreshModelsAndRebuildRoutes,
      isModelAllowed: vi.fn().mockResolvedValue(true),
      now: () => new Date('2026-03-19T00:00:00.000Z'),
    });

    expect(refreshModelsAndRebuildRoutes).toHaveBeenCalledTimes(1);
    expect(explainSelection).toHaveBeenCalledTimes(2);
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
      tokenRouter: {
        getAvailableModels: vi.fn(),
        explainSelection: vi.fn(),
      },
      refreshModelsAndRebuildRoutes: vi.fn(),
      isModelAllowed: vi.fn().mockResolvedValue(true),
    });

    expect(result.statusCode).toBe(404);
  });
});
