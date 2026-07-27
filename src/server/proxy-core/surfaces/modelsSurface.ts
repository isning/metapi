function isSearchPseudoModel(modelName: string): boolean {
  const normalized = (modelName || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized === '__search' || /^__.+_search$/.test(normalized);
}

type ModelsSurfaceInput = {
  downstreamPolicy: unknown;
  responseFormat: 'openai' | 'claude';
  listModelNames(): Promise<string[]>;
  canSelectModel(modelName: string, downstreamPolicy: unknown): Promise<boolean>;
  isModelAllowed(modelName: string, downstreamPolicy: unknown): Promise<boolean>;
  now?: () => Date;
};

type RetrieveModelSurfaceInput = ModelsSurfaceInput & {
  modelId: string;
};

async function readVisibleModels(input: ModelsSurfaceInput): Promise<string[]> {
  const deduped = Array.from(new Set(await input.listModelNames()))
    .filter((modelName) => !isSearchPseudoModel(modelName))
    .sort();
  const allowed: string[] = [];
  for (const modelName of deduped) {
    if (!await input.isModelAllowed(modelName, input.downstreamPolicy)) {
      continue;
    }
    const canSelect = await input.canSelectModel(modelName, input.downstreamPolicy);
    if (canSelect) {
      allowed.push(modelName);
    }
  }
  return allowed;
}

export async function listModelsSurface(input: ModelsSurfaceInput) {
  const models = await readVisibleModels(input);

  const now = input.now?.() ?? new Date();
  if (input.responseFormat === 'claude') {
    const data = models.map((id) => ({
      id,
      type: 'model' as const,
      display_name: id,
      created_at: now.toISOString(),
    }));
    return {
      data,
      first_id: data[0]?.id || null,
      last_id: data[data.length - 1]?.id || null,
      has_more: false,
    };
  }

  return {
    object: 'list' as const,
    data: models.map((id) => ({
      id,
      object: 'model' as const,
      created: Math.floor(now.getTime() / 1000),
      owned_by: 'metapi',
    })),
  };
}

function createModelPayload(id: string, responseFormat: 'openai' | 'claude', now: Date) {
  if (responseFormat === 'claude') {
    return {
      id,
      type: 'model' as const,
      display_name: id,
      created_at: now.toISOString(),
    };
  }

  return {
    id,
    object: 'model' as const,
    created: Math.floor(now.getTime() / 1000),
    owned_by: 'metapi',
  };
}

function modelNotFoundPayload(modelId: string) {
  return {
    error: {
      message: `Model '${modelId}' not found`,
      type: 'invalid_request_error',
      code: 'model_not_found',
    },
  };
}

export async function retrieveModelSurface(input: RetrieveModelSurfaceInput) {
  const modelId = input.modelId.trim();
  if (!modelId) {
    return {
      statusCode: 400,
      payload: {
        error: {
          message: 'model is required',
          type: 'invalid_request_error',
        },
      },
    };
  }

  if (isSearchPseudoModel(modelId) || !await input.isModelAllowed(modelId, input.downstreamPolicy)) {
    return {
      statusCode: 404,
      payload: modelNotFoundPayload(modelId),
    };
  }

  const canSelect = await input.canSelectModel(modelId, input.downstreamPolicy);

  if (!canSelect) {
    return {
      statusCode: 404,
      payload: modelNotFoundPayload(modelId),
    };
  }

  return {
    statusCode: 200,
    payload: createModelPayload(modelId, input.responseFormat, input.now?.() ?? new Date()),
  };
}
