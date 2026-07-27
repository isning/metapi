import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getProxyAuthContext } from '../../middleware/auth.js';
import { detectDownstreamClientContext } from '../../proxy-core/downstreamClientContext.js';
import {
  ensureModelAllowedForDownstreamKey,
  getDownstreamRoutingPolicy,
} from '../../proxy-core/downstreamPolicy.js';
import { getTesterForcedExecutionAttemptId } from '../../proxy-core/executionAttemptSelection.js';
import { ensureMultipartBufferParser, parseMultipartFormData } from '../../proxy-core/surfaces/multipart.js';
import {
  executeVideoCreateProxySurface,
  executeVideoTaskDeleteSurface,
  executeVideoTaskReadSurface,
  type VideoTaskSurfaceResult,
} from '../../proxy-core/surfaces/videoProxySurface.js';

export async function videosProxyRoute(app: FastifyInstance) {
  ensureMultipartBufferParser(app);

  app.post('/v1/videos', async (request: FastifyRequest, reply: FastifyReply) => {
    const multipartForm = await parseMultipartFormData(request);
    const jsonBody = !multipartForm && request.body && typeof request.body === 'object'
      ? request.body as Record<string, unknown>
      : null;
    const requestedModel = typeof multipartForm?.get('model') === 'string'
      ? String(multipartForm.get('model')).trim()
      : typeof jsonBody?.model === 'string' ? jsonBody.model.trim() : '';
    if (!requestedModel) {
      return reply.code(400).send({ error: { message: 'model is required', type: 'invalid_request_error' } });
    }
    if (!await ensureModelAllowedForDownstreamKey(request, reply, requestedModel)) return;
    const downstreamPath = '/v1/videos';
    const requestPayload = jsonBody || Object.fromEntries(multipartForm?.entries?.() || []);
    const result = await executeVideoCreateProxySurface({
      multipartForm,
      jsonBody,
      requestPayload,
      requestedModel,
      downstreamPolicy: await getDownstreamRoutingPolicy(request),
      forcedExecutionAttemptId: getTesterForcedExecutionAttemptId({
        headers: request.headers as Record<string, unknown>,
        clientIp: request.ip,
      }),
      downstreamApiKeyId: getProxyAuthContext(request)?.keyId ?? null,
      clientContext: detectDownstreamClientContext({
        downstreamPath,
        headers: request.headers as Record<string, unknown>,
        body: requestPayload,
      }),
      headers: request.headers as Record<string, unknown>,
      method: request.method,
      query: (request.query || {}) as Record<string, unknown>,
    });
    return reply.code(result.statusCode).send(result.payload);
  });

  app.get('/v1/videos/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => (
    sendVideoTaskResult(reply, await executeVideoTaskReadSurface(request.params.id))
  ));
  app.delete('/v1/videos/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => (
    sendVideoTaskResult(reply, await executeVideoTaskDeleteSurface(request.params.id))
  ));
}

function sendVideoTaskResult(reply: FastifyReply, result: VideoTaskSurfaceResult) {
  if (result.contentType) reply.type(result.contentType);
  return result.payload === undefined
    ? reply.code(result.statusCode).send()
    : reply.code(result.statusCode).send(result.payload);
}
