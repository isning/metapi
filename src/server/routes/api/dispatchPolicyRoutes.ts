import type { FastifyInstance } from 'fastify';
import {
  parseDispatchPolicySimulationCommand,
  parseDispatchPolicyValidationCommand,
} from '../../contracts/dispatchPolicyPayloads.js';
import {
  DispatchPolicyToolingError,
  simulateDispatchPolicyCommand,
  validateDispatchPolicyCommand,
} from '../../services/dispatchPolicyToolingService.js';

export async function dispatchPolicyRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: unknown }>('/api/dispatch-policies/validate', async (request, reply) => {
    const parsed = parseDispatchPolicyValidationCommand(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, code: 'invalid_request', errors: parsed.errors });
    }
    const result = validateDispatchPolicyCommand(parsed.data);
    return result.success ? result : reply.code(400).send(result);
  });

  app.post<{ Body: unknown }>('/api/dispatch-policies/simulate', async (request, reply) => {
    const parsed = parseDispatchPolicySimulationCommand(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, code: 'invalid_request', errors: parsed.errors });
    }
    try {
      return await simulateDispatchPolicyCommand({
        command: parsed.data,
        requestKnown: parsed.requestKnown,
      });
    } catch (error) {
      if (error instanceof DispatchPolicyToolingError) {
        const statusCode = error.code === 'selector_required'
          ? 409
          : error.code === 'evaluation_failed' ? 422 : 400;
        return reply.code(statusCode).send({
          success: false,
          code: error.code,
          message: error.message,
          scopes: error.scopes,
        });
      }
      throw error;
    }
  });
}
