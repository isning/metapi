import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../config.js';

const fetchMock = vi.fn();

vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  return {
    ...actual,
    fetch: (...args: unknown[]) => fetchMock(...args),
  };
});

describe('/api/test proxy tester routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { testRoutes } = await import('./test.js');
    app = Fastify();
    await app.register(testRoutes);
  });

  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects proxy paths outside the allowlist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/test/proxy',
      payload: {
        method: 'POST',
        path: '/admin/secret',
        requestKind: 'json',
        jsonBody: {},
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      code: 'model_tester_path_not_allowed',
      params: { path: '/admin/secret' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards raw json bodies without dropping extra proxy fields', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      object: 'response',
      output_text: 'ok',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const rawPayload = {
      model: 'gpt-5.2',
      include: ['reasoning.encrypted_content'],
      reasoning: { effort: 'medium' },
      metadata: { source: 'tester' },
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/test/proxy',
      payload: {
        method: 'POST',
        path: '/v1/responses',
        requestKind: 'json',
        rawMode: true,
        rawJsonText: JSON.stringify(rawPayload),
      },
    });

    expect(response.statusCode).toBe(200);
    const [targetUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(targetUrl).toBe(`http://127.0.0.1:${config.port}/v1/responses`);
    expect(JSON.parse(String(requestInit.body))).toEqual({
      ...rawPayload,
      stream: false,
    });
  });

  it('rejects empty multipart envelopes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/test/proxy',
      payload: {
        method: 'POST',
        path: '/v1/images/edits',
        requestKind: 'multipart',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      code: 'model_tester_multipart_body_required',
      params: {},
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows multipart /v1/files uploads through the proxy tester', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      id: 'file_demo_123',
      object: 'file',
      filename: 'notes.txt',
      bytes: 11,
      purpose: 'user_data',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/test/proxy',
      payload: {
        method: 'POST',
        path: '/v1/files',
        requestKind: 'multipart',
        multipartFields: {
          purpose: 'user_data',
        },
        multipartFiles: [
          {
            field: 'file',
            name: 'notes.txt',
            mimeType: 'text/plain',
            dataUrl: 'data:text/plain;base64,aGVsbG8gZmlsZXM=',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const [targetUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit & { body?: { constructor?: { name?: string } } }];
    expect(targetUrl).toBe(`http://127.0.0.1:${config.port}/v1/files`);
    expect(requestInit.method).toBe('POST');
    expect(requestInit.body?.constructor?.name).toBe('FormData');
  });

  it('does not register the retired chat compatibility API', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/test/chat',
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

});
