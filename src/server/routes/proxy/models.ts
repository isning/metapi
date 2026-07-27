import { FastifyInstance } from 'fastify';
import { listModelsSurface, retrieveModelSurface } from '../../proxy-core/surfaces/modelsSurface.js';
import { getDownstreamRoutingPolicy } from '../../proxy-core/downstreamPolicy.js';
import { previewRouteRuntimeDecision, type RouteRuntimeDecisionInput } from '../../services/routeRuntimeExecutionService.js';
import { buildCompiledRouteRuntimeRequestSnapshot } from '../../proxy-core/orchestration/compiledRouteRuntimeRequest.js';
import { listActiveCompiledRuntimeModelNames } from '../../services/compiledRuntimeInventoryService.js';

type CompiledRuntimeRequestSnapshot = NonNullable<RouteRuntimeDecisionInput['request']>;

function wantsClaudeModelFormat(headers: Record<string, unknown>): boolean {
  return typeof headers['anthropic-version'] === 'string'
    || typeof headers['x-api-key'] === 'string';
}

async function listCompiledRuntimeModelNames(): Promise<string[]> {
  return await listActiveCompiledRuntimeModelNames();
}

async function canSelectCompiledRuntimeModel(
  modelName: string,
  downstreamPolicy: unknown,
  requestSnapshot?: CompiledRuntimeRequestSnapshot,
): Promise<boolean> {
  const decision = await previewRouteRuntimeDecision({
    requestedModel: modelName,
    request: requestSnapshot
      ? { ...requestSnapshot, requestedModel: modelName }
      : buildCompiledRouteRuntimeRequestSnapshot({ requestedModel: modelName }),
    downstreamPolicy: downstreamPolicy as RouteRuntimeDecisionInput['downstreamPolicy'],
    retryCount: 0,
  });
  return decision?.kind === 'execution_attempt';
}

export async function modelsProxyRoute(app: FastifyInstance) {
  app.get('/v1/models', async (request) => {
    const downstreamPolicy = await getDownstreamRoutingPolicy(request);
    const requestSnapshot = buildCompiledRouteRuntimeRequestSnapshot({
      headers: request.headers as Record<string, unknown>,
      method: request.method,
      path: request.url || '/v1/models',
      query: (request.query || {}) as Record<string, unknown>,
    });
    return listModelsSurface({
      downstreamPolicy,
      responseFormat: wantsClaudeModelFormat(request.headers) ? 'claude' : 'openai',
      listModelNames: listCompiledRuntimeModelNames,
      canSelectModel: (modelName, policy) => canSelectCompiledRuntimeModel(modelName, policy, requestSnapshot),
      isModelAllowed: async () => true,
    });
  });

  app.get('/v1/models/:model', async (request, reply) => {
    const downstreamPolicy = await getDownstreamRoutingPolicy(request);
    const params = request.params as { model?: string };
    const requestSnapshot = buildCompiledRouteRuntimeRequestSnapshot({
      headers: request.headers as Record<string, unknown>,
      method: request.method,
      path: request.url || '/v1/models/:model',
      query: (request.query || {}) as Record<string, unknown>,
    });
    const result = await retrieveModelSurface({
      modelId: params.model || '',
      downstreamPolicy,
      responseFormat: wantsClaudeModelFormat(request.headers) ? 'claude' : 'openai',
      listModelNames: listCompiledRuntimeModelNames,
      canSelectModel: (modelName, policy) => canSelectCompiledRuntimeModel(modelName, policy, requestSnapshot),
      isModelAllowed: async () => true,
    });
    return reply.code(result.statusCode).send(result.payload);
  });

  app.get('/v1beta/openai/models', async (request) => {
    const downstreamPolicy = await getDownstreamRoutingPolicy(request);
    const requestSnapshot = buildCompiledRouteRuntimeRequestSnapshot({
      headers: request.headers as Record<string, unknown>,
      method: request.method,
      path: request.url || '/v1beta/openai/models',
      query: (request.query || {}) as Record<string, unknown>,
    });
    return listModelsSurface({
      downstreamPolicy,
      responseFormat: 'openai',
      listModelNames: listCompiledRuntimeModelNames,
      canSelectModel: (modelName, policy) => canSelectCompiledRuntimeModel(modelName, policy, requestSnapshot),
      isModelAllowed: async () => true,
    });
  });
}
