import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getProxyAuthContext } from '../../middleware/auth.js';
import {
  ensureModelAllowedForDownstreamKey,
  getDownstreamRoutingPolicy,
} from '../../proxy-core/downstreamPolicy.js';
import { detectDownstreamClientContext } from '../../proxy-core/downstreamClientContext.js';
import { getTesterForcedExecutionAttemptId } from '../../proxy-core/executionAttemptSelection.js';
import { executeSearchProxySurface } from '../../proxy-core/surfaces/searchProxySurface.js';

const DEFAULT_SEARCH_MODEL = '__search';
const DEFAULT_MAX_RESULTS = 10;
const MAX_MAX_RESULTS = 20;

export async function searchProxyRoute(app: FastifyInstance) {
  app.post('/v1/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as Record<string, unknown>;
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      return reply.code(400).send({ error: { message: 'query is required', type: 'invalid_request_error' } });
    }
    if (body.stream === true) {
      return reply.code(400).send({
        error: { message: 'search does not support streaming', type: 'invalid_request_error' },
      });
    }
    const maxResults = body.max_results == null
      ? DEFAULT_MAX_RESULTS
      : typeof body.max_results === 'number' && Number.isInteger(body.max_results)
        ? body.max_results
        : NaN;
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_MAX_RESULTS) {
      return reply.code(400).send({
        error: {
          message: `max_results must be an integer between 1 and ${MAX_MAX_RESULTS}`,
          type: 'invalid_request_error',
        },
      });
    }
    const requestedModel = typeof body.model === 'string' && body.model.trim()
      ? body.model.trim()
      : DEFAULT_SEARCH_MODEL;
    if (!await ensureModelAllowedForDownstreamKey(request, reply, requestedModel)) return;

    const downstreamPath = '/v1/search';
    const result = await executeSearchProxySurface({
      body,
      maxResults,
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
        body,
      }),
      headers: request.headers as Record<string, unknown>,
      method: request.method,
      query: (request.query || {}) as Record<string, unknown>,
    });
    return reply.code(result.statusCode).send(result.payload);
  });
}
