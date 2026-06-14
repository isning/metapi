import { FastifyInstance } from 'fastify';
import { proxyAuthMiddleware } from '../../middleware/auth.js';
import { getAllDownstreamProtocolAdapters } from '../../proxy-core/formats/registry.js';
import { registerDownstreamProtocolSurface } from '../../proxy-core/surfaces/downstreamProtocolSurface.js';
import { modelsProxyRoute } from './models.js';
import { imagesProxyRoute } from './images.js';
import { searchProxyRoute } from './search.js';
import { videosProxyRoute } from './videos.js';
import { filesProxyRoute } from './files.js';

export async function proxyRoutes(app: FastifyInstance) {
  // Auth middleware
  app.addHook('onRequest', async (request, reply) => {
    await proxyAuthMiddleware(request, reply);
  });

  // Dynamically registers all pluggable downstream protocol adapters and their endpoints!
  for (const adapter of getAllDownstreamProtocolAdapters()) {
    await registerDownstreamProtocolSurface(app, adapter);
  }

  // Register remaining standalone proxy endpoints
  await app.register(modelsProxyRoute);
  await app.register(searchProxyRoute);
  await app.register(filesProxyRoute);
  await app.register(imagesProxyRoute);
  await app.register(videosProxyRoute);
}
