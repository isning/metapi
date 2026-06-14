import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DownstreamProtocolAdapter } from '../formats/types.js';
import { handleGenericSurfaceRequest } from '../orchestration/genericProxyOrchestrator.js';
import { handleModelListSurfaceRequest } from '../orchestration/modelListOrchestrator.js';
import { ensureResponsesWebsocketTransport } from '../orchestration/responsesWebsocketFlow.js';

function isResponsesRoute(adapter: DownstreamProtocolAdapter): boolean {
  return adapter.format === 'responses';
}

async function replyResponsesWebsocketUpgradeRequired(reply: FastifyReply) {
  return reply.code(426).send({
    error: {
      message: 'WebSocket upgrade required for GET /v1/responses',
      type: 'invalid_request_error',
    },
  });
}

export async function registerDownstreamProtocolSurface(
  app: FastifyInstance,
  adapter: DownstreamProtocolAdapter,
): Promise<void> {
  if (isResponsesRoute(adapter)) {
    ensureResponsesWebsocketTransport(app);
    app.get('/v1/responses', async (_request: FastifyRequest, reply: FastifyReply) =>
      replyResponsesWebsocketUpgradeRequired(reply));
  }

  for (const route of adapter.modelListRoutes || []) {
    app.get(route, async (request: FastifyRequest, reply: FastifyReply) => {
      return handleModelListSurfaceRequest(request, reply, adapter);
    });
  }

  for (const route of adapter.routes) {
    app.post(route, async (request: FastifyRequest, reply: FastifyReply) => {
      const downstreamPath = (request.raw.url || request.url || route).split('?')[0] || route;
      return handleGenericSurfaceRequest(request, reply, adapter, downstreamPath);
    });
  }
}
