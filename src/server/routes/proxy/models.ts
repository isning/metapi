import { FastifyInstance } from 'fastify';
import { listModelsSurface, retrieveModelSurface } from '../../proxy-core/surfaces/modelsSurface.js';
import * as routeRefreshWorkflow from '../../services/routeRefreshWorkflow.js';
import { getDownstreamRoutingPolicy } from '../../proxy-core/downstreamPolicy.js';
import { tokenRouter } from '../../services/tokenRouter.js';
import { isModelAllowedByPolicyOrAllowedRoutes } from '../../services/downstreamApiKeyService.js';

function wantsClaudeModelFormat(headers: Record<string, unknown>): boolean {
  return typeof headers['anthropic-version'] === 'string'
    || typeof headers['x-api-key'] === 'string';
}

export async function modelsProxyRoute(app: FastifyInstance) {
  app.get('/v1/models', async (request) => {
    const downstreamPolicy = getDownstreamRoutingPolicy(request);
    return listModelsSurface({
      downstreamPolicy,
      responseFormat: wantsClaudeModelFormat(request.headers) ? 'claude' : 'openai',
      tokenRouter,
      refreshModelsAndRebuildRoutes: routeRefreshWorkflow.refreshModelsAndRebuildRoutes,
      isModelAllowed: isModelAllowedByPolicyOrAllowedRoutes,
    });
  });

  app.get('/v1/models/:model', async (request, reply) => {
    const downstreamPolicy = getDownstreamRoutingPolicy(request);
    const params = request.params as { model?: string };
    const result = await retrieveModelSurface({
      modelId: params.model || '',
      downstreamPolicy,
      responseFormat: wantsClaudeModelFormat(request.headers) ? 'claude' : 'openai',
      tokenRouter,
      refreshModelsAndRebuildRoutes: routeRefreshWorkflow.refreshModelsAndRebuildRoutes,
      isModelAllowed: isModelAllowedByPolicyOrAllowedRoutes,
    });
    return reply.code(result.statusCode).send(result.payload);
  });

}
