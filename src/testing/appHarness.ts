import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
  type FastifyReply,
  type FastifyRequest,
  type InjectOptions,
} from 'fastify';

import { buildConfig, buildFastifyOptions, config } from '../server/config.js';
import { authMiddleware, proxyAuthMiddleware } from '../server/middleware/auth.js';

export type TestRouteRegistrar = (app: FastifyInstance) => Promise<void> | void;

export type TestAppAuthMode = 'none' | 'admin-api' | 'proxy';

export type TestAppOptions = {
  routes?: TestRouteRegistrar[];
  auth?: TestAppAuthMode;
  env?: NodeJS.ProcessEnv;
  fastifyOptions?: Partial<FastifyServerOptions>;
};

export type TestAppHandle = {
  app: FastifyInstance;
  inject: FastifyInstance['inject'];
  adminHeaders: (headers?: Record<string, string>) => Record<string, string>;
  proxyHeaders: (headers?: Record<string, string>) => Record<string, string>;
  close: () => Promise<void>;
};

function mergeBearerHeader(token: string, headers: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    ...headers,
  };
}

function shouldProtectAdminApiRoute(request: FastifyRequest): boolean {
  const path = String(request.raw.url || request.url || '').split('?')[0] || '';
  return path.startsWith('/api/') && path !== '/api/auth/login';
}

function installAuthHook(app: FastifyInstance, mode: TestAppAuthMode): void {
  if (mode === 'admin-api') {
    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      if (shouldProtectAdminApiRoute(request)) {
        await authMiddleware(request, reply);
      }
    });
    return;
  }

  if (mode === 'proxy') {
    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      await proxyAuthMiddleware(request, reply);
    });
  }
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestAppHandle> {
  const appConfig = buildConfig({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_TOKEN: options.env?.AUTH_TOKEN || process.env.AUTH_TOKEN || 'test-admin-token',
    PROXY_TOKEN: options.env?.PROXY_TOKEN || process.env.PROXY_TOKEN || 'test-proxy-token',
    ...options.env,
  });
  const previousAuthToken = config.authToken;
  const previousProxyToken = config.proxyToken;
  const previousAdminIpAllowlist = [...config.adminIpAllowlist];
  config.authToken = appConfig.authToken;
  config.proxyToken = appConfig.proxyToken;
  config.adminIpAllowlist = [];

  const app = Fastify({
    ...buildFastifyOptions(appConfig),
    ...options.fastifyOptions,
    logger: false,
  });

  try {
    installAuthHook(app, options.auth || 'none');

    for (const registerRoute of options.routes || []) {
      await app.register(registerRoute);
    }
  } catch (error) {
    config.authToken = previousAuthToken;
    config.proxyToken = previousProxyToken;
    config.adminIpAllowlist = previousAdminIpAllowlist;
    await app.close().catch(() => undefined);
    throw error;
  }

  return {
    app,
    inject: app.inject.bind(app) as FastifyInstance['inject'],
    adminHeaders: (headers = {}) => mergeBearerHeader(appConfig.authToken, headers),
    proxyHeaders: (headers = {}) => mergeBearerHeader(appConfig.proxyToken, headers),
    close: async () => {
      try {
        await app.close();
      } finally {
        config.authToken = previousAuthToken;
        config.proxyToken = previousProxyToken;
        config.adminIpAllowlist = previousAdminIpAllowlist;
      }
    },
  };
}

export function jsonInjectOptions(input: InjectOptions & { payload?: unknown }): InjectOptions {
  return {
    ...input,
    headers: {
      'content-type': 'application/json',
      ...(input.headers as Record<string, string> | undefined),
    },
  };
}
