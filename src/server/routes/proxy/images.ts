import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getProxyAuthContext } from '../../middleware/auth.js';
import { detectDownstreamClientContext } from '../../proxy-core/downstreamClientContext.js';
import {
  ensureModelAllowedForDownstreamKey,
  getDownstreamRoutingPolicy,
} from '../../proxy-core/downstreamPolicy.js';
import { getTesterForcedExecutionAttemptId } from '../../proxy-core/executionAttemptSelection.js';
import { executeImagesEditProxySurface } from '../../proxy-core/surfaces/imagesEditProxySurface.js';
import { ensureMultipartBufferParser, parseMultipartFormData } from '../../proxy-core/surfaces/multipart.js';

export async function imagesProxyRoute(app: FastifyInstance) {
  ensureMultipartBufferParser(app);

  app.post('/v1/images/edits', async (request: FastifyRequest, reply: FastifyReply) => {
    const multipartForm = await parseMultipartFormData(request);
    const jsonBody = !multipartForm && request.body && typeof request.body === 'object'
      ? request.body as Record<string, unknown>
      : null;
    const requestedModel = typeof multipartForm?.get('model') === 'string'
      ? String(multipartForm.get('model')).trim()
      : (typeof jsonBody?.model === 'string' ? jsonBody.model.trim() : '') || 'gpt-image-1';
    if (!await ensureModelAllowedForDownstreamKey(request, reply, requestedModel)) return;

    const downstreamPath = '/v1/images/edits';
    const requestPayload = jsonBody || Object.fromEntries(multipartForm?.entries?.() || []);
    const result = await executeImagesEditProxySurface({
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

  app.post('/v1/images/variations', async (_request: FastifyRequest, reply: FastifyReply) => (
    reply.code(400).send({
      error: { message: 'Image variations are not supported', type: 'invalid_request_error' },
    })
  ));
}
