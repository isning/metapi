import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ModelTesterProxyEnvelope } from '../../../shared/modelTesterProxy.js';
import { parseModelTesterProxyPayload } from '../../contracts/modelTesterProxyPayload.js';
import {
  executeModelTesterProxyBuffered,
  executeModelTesterProxyStream,
  ModelTesterTransportError,
  ModelTesterUpstreamError,
} from '../../proxy-core/surfaces/modelTesterProxySurface.js';
import { ModelTesterProxyJobService } from '../../services/modelTesterProxyJobService.js';

function sendExecutionError(reply: FastifyReply, error: unknown) {
  if (error instanceof ModelTesterUpstreamError) {
    return reply.code(error.statusCode).send(error.responsePayload);
  }
  const code = error instanceof ModelTesterTransportError
    ? error.code
    : 'model_tester_transport_failed';
  return reply.code(502).send({ success: false, code, params: {} });
}

function jobNotFound(reply: FastifyReply, jobId: string) {
  return reply.code(404).send({
    success: false,
    code: 'model_tester_job_not_found',
    params: { jobId },
  });
}

async function sendStreamingEnvelope(
  envelope: ReturnType<typeof parseModelTesterProxyPayload> & { success: true },
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const controller = new AbortController();
  const abort = () => { if (!controller.signal.aborted) controller.abort(); };
  const close = () => { if (!reply.raw.writableEnded) abort(); };
  request.raw.on('aborted', abort);
  reply.raw.on('close', close);

  try {
    await executeModelTesterProxyStream(envelope.data, {
      start() {
        reply.hijack();
        reply.raw.statusCode = 200;
        reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-Accel-Buffering', 'no');
      },
      write(chunk) { reply.raw.write(Buffer.from(chunk)); },
      interrupted(error) {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({
            success: false, code: error.code, params: error.params,
          })}\n\n`);
        }
      },
    }, controller.signal);
  } catch (error) {
    if (!reply.sent) return sendExecutionError(reply, error);
  } finally {
    request.raw.off?.('aborted', abort);
    reply.raw.off?.('close', close);
    if (reply.sent && !reply.raw.writableEnded) reply.raw.end();
  }
}

export async function testRoutes(app: FastifyInstance) {
  const jobs = new ModelTesterProxyJobService();
  jobs.startCleanup();
  app.addHook('onClose', async () => jobs.stopCleanup());

  app.post<{ Body: ModelTesterProxyEnvelope }>('/api/test/proxy', async (request, reply) => {
    const parsed = parseModelTesterProxyPayload(request.body);
    if (!parsed.success) return reply.code(400).send(parsed.error);
    try {
      return reply.send(await executeModelTesterProxyBuffered(parsed.data));
    } catch (error) {
      return sendExecutionError(reply, error);
    }
  });

  app.post<{ Body: ModelTesterProxyEnvelope }>('/api/test/proxy/stream', async (request, reply) => {
    const parsed = parseModelTesterProxyPayload(request.body);
    if (!parsed.success) return reply.code(400).send(parsed.error);
    return sendStreamingEnvelope(parsed, request, reply);
  });

  app.post<{ Body: ModelTesterProxyEnvelope }>('/api/test/proxy/jobs', async (request, reply) => {
    const parsed = parseModelTesterProxyPayload(request.body);
    if (!parsed.success) return reply.code(400).send(parsed.error);
    return reply.code(202).send(jobs.start(parsed.data));
  });

  app.get<{ Params: { jobId: string } }>('/api/test/proxy/jobs/:jobId', async (request, reply) => {
    const job = jobs.get(request.params.jobId);
    return job ? reply.send(job) : jobNotFound(reply, request.params.jobId);
  });

  app.delete<{ Params: { jobId: string } }>('/api/test/proxy/jobs/:jobId', async (request, reply) => (
    jobs.delete(request.params.jobId)
      ? reply.send({ success: true })
      : jobNotFound(reply, request.params.jobId)
  ));
}
