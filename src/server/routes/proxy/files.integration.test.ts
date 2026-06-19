import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProxyRelayHarness,
  type ProxyRelayHarness,
} from '../../../testing/proxyRelayHarness.js';

vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  return {
    ...actual,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
  };
});

function buildUploadBody(boundary: string, filename: string, contentType: string, content: string) {
  return Buffer.from(
    `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="purpose"\r\n\r\n`
      + `assistants\r\n`
      + `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`
      + `Content-Type: ${contentType}\r\n\r\n`
      + `${content}\r\n`
      + `--${boundary}--\r\n`,
  );
}

describe('/v1/files proxy storage integration', () => {
  let harness: ProxyRelayHarness;

  beforeAll(async () => {
    harness = await createProxyRelayHarness('metapi-files-integration-');
  });

  beforeEach(async () => {
    await harness.resetData();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('stores, lists, reads, and soft-deletes files scoped to the current managed key', async () => {
    const first = await harness.seedRoute({ model: 'files-owner-a' });
    const second = await harness.seedRoute({
      model: 'files-owner-b',
      siteUrl: 'https://upstream-b.test',
    });
    const boundary = 'metapi-files-boundary';

    const upload = await harness.app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: {
        'x-api-key': first.managedKey.key,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: buildUploadBody(boundary, 'notes.txt', 'text/plain', 'hello file owner'),
    });

    expect(upload.statusCode, upload.body).toBe(200);
    const uploaded = upload.json() as { id: string; object: string; filename: string; mime_type: string };
    expect(uploaded).toMatchObject({
      object: 'file',
      filename: 'notes.txt',
      mime_type: 'text/plain',
    });
    expect(uploaded.id).toMatch(/^file-metapi-/);

    const firstList = await harness.app.inject({
      method: 'GET',
      url: '/v1/files',
      headers: {
        'x-api-key': first.managedKey.key,
      },
    });
    expect(firstList.statusCode, firstList.body).toBe(200);
    expect(firstList.json()).toMatchObject({
      object: 'list',
      data: [
        expect.objectContaining({ id: uploaded.id, filename: 'notes.txt' }),
      ],
      has_more: false,
    });

    const secondList = await harness.app.inject({
      method: 'GET',
      url: '/v1/files',
      headers: {
        'x-api-key': second.managedKey.key,
      },
    });
    expect(secondList.statusCode, secondList.body).toBe(200);
    expect(secondList.json()).toEqual({
      object: 'list',
      data: [],
      has_more: false,
    });

    const content = await harness.app.inject({
      method: 'GET',
      url: `/v1/files/${uploaded.id}/content`,
      headers: {
        'x-api-key': first.managedKey.key,
      },
    });
    expect(content.statusCode, content.body).toBe(200);
    expect(content.headers['content-type']).toContain('text/plain');
    expect(content.body).toBe('hello file owner');

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/v1/files/${uploaded.id}`,
      headers: {
        'x-api-key': first.managedKey.key,
      },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toEqual({
      id: uploaded.id,
      object: 'file',
      deleted: true,
    });

    const afterDelete = await harness.app.inject({
      method: 'GET',
      url: `/v1/files/${uploaded.id}`,
      headers: {
        'x-api-key': first.managedKey.key,
      },
    });
    expect(afterDelete.statusCode, afterDelete.body).toBe(404);
  });
});
