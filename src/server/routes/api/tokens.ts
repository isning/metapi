import type { FastifyInstance } from 'fastify';

import { invalidateRouteGraphReadCaches } from '../../services/routeGraphService.js';
import { registerRouteGraphRoutes } from './routeGraphRoutes.js';
import { registerRouteGroupRoutes, resetRouteGroupReadLimiterForTests } from './routeGroupRoutes.js';

export function resetRouteManagementReadLimitersForTests(
  options: { summaryPoints?: number } = {},
): void {
  resetRouteGroupReadLimiterForTests(options.summaryPoints ?? 60);
  invalidateRouteGraphReadCaches('test-reset');
}

export async function tokensRoutes(app: FastifyInstance): Promise<void> {
  await registerRouteGraphRoutes(app);
  await registerRouteGroupRoutes(app);
}
