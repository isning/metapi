import { afterEach, describe, expect, it } from 'vitest';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';

import { preflightExternalBaseUrl } from './e2ePreflight.js';

type TestServer = {
  baseUrl: string;
  close: () => Promise<void>;
  requests: Array<{ url: string; authorization: string | undefined }>;
};

async function createServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<TestServer> {
  const requests: TestServer['requests'] = [];
  const server = http.createServer((request, response) => {
    requests.push({
      url: request.url || '',
      authorization: request.headers.authorization,
    });
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind to a TCP port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

const servers: TestServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('e2e external base URL preflight', () => {
  it('skips preflight when E2E_BASE_URL is not set', async () => {
    await expect(preflightExternalBaseUrl({})).resolves.toBeUndefined();
  });

  it('accepts a built Metapi app with an authenticated admin info endpoint', async () => {
    const server = await createServer((request, response) => {
      if (request.url === '/logo.png') {
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end('logo');
        return;
      }
      if (request.url === '/api/settings/auth/info' && request.headers.authorization === 'Bearer custom-admin') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ masked: 'cust****dmin' }));
        return;
      }
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized' }));
    });
    servers.push(server);

    await expect(preflightExternalBaseUrl({
      E2E_BASE_URL: server.baseUrl,
      E2E_AUTH_TOKEN: 'custom-admin',
    })).resolves.toBeUndefined();
    expect(server.requests.map((request) => request.url)).toEqual([
      '/logo.png',
      '/api/settings/auth/info',
    ]);
  });

  it('rejects targets that do not serve built app assets', async () => {
    const server = await createServer((_request, response) => {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('missing static asset');
    });
    servers.push(server);

    await expect(preflightExternalBaseUrl({ E2E_BASE_URL: server.baseUrl }))
      .rejects.toThrow(/does not look like a built Metapi app[\s\S]*missing static asset/);
  });

  it('rejects targets that do not accept the configured admin token', async () => {
    const server = await createServer((request, response) => {
      if (request.url === '/logo.png') {
        response.writeHead(200);
        response.end('logo');
        return;
      }
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 'missing_bearer_token' }));
    });
    servers.push(server);

    await expect(preflightExternalBaseUrl({ E2E_BASE_URL: server.baseUrl }))
      .rejects.toThrow(/not ready for authenticated Metapi E2E tests[\s\S]*missing_bearer_token/);
    expect(server.requests.find((request) => request.url === '/api/settings/auth/info')?.authorization)
      .toBe('Bearer test-admin-token');
  });

  it('wraps network failures with a diagnostic preflight message', async () => {
    await expect(preflightExternalBaseUrl({
      E2E_BASE_URL: 'http://127.0.0.1:65534',
    }, { timeoutMs: 100 }))
      .rejects.toThrow(/E2E_BASE_URL preflight failed for http:\/\/127\.0\.0\.1:65534\/logo\.png/);
  });
});
