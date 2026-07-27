import type { FastifyInstance } from 'fastify';
import {
  getRouteRuntimeCacheStatus,
  requestRouteRuntimeCacheRefresh,
} from '../../services/routeRuntimeCacheMaintenanceService.js';

export async function routeRuntimeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/route-runtime/cache', async () => getRouteRuntimeCacheStatus());

  app.post('/api/route-runtime/cache/refresh', async (_request, reply) => {
    const { task, reused } = requestRouteRuntimeCacheRefresh();
    return reply.code(202).send({
      success: true,
      queued: !reused,
      reused,
      jobId: task.id,
    });
  });
}
