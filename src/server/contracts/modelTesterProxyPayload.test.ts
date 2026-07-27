import { describe, expect, it } from 'vitest';
import { parseModelTesterProxyPayload } from './modelTesterProxyPayload.js';

describe('parseModelTesterProxyPayload', () => {
  it('parses every structured envelope field without reconstructing the execution identity', () => {
    expect(parseModelTesterProxyPayload({
      method: 'POST',
      path: 'https://localhost/v1/responses?trace=1',
      requestKind: 'json',
      stream: true,
      jobMode: true,
      rawMode: false,
      forcedExecutionAttemptId: ' attempt-issued-by-compiler ',
      jsonBody: ['arbitrary', 1, true, null],
    })).toEqual({
      success: true,
      data: {
        method: 'POST',
        path: '/v1/responses?trace=1',
        requestKind: 'json',
        stream: true,
        jobMode: true,
        rawMode: false,
        forcedExecutionAttemptId: 'attempt-issued-by-compiler',
        jsonBody: ['arbitrary', 1, true, null],
      },
    });
  });

  it('preserves raw JSON text as an explicitly separate body representation', () => {
    const rawJsonText = '{"model":"gpt-test","custom":true}';
    expect(parseModelTesterProxyPayload({
      method: 'POST',
      path: '/v1/chat/completions',
      requestKind: 'json',
      rawMode: true,
      rawJsonText,
    })).toMatchObject({ success: true, data: { rawMode: true, rawJsonText } });
  });

  it('parses multipart fields and files without accepting malformed members', () => {
    expect(parseModelTesterProxyPayload({
      method: 'POST',
      path: '/v1/files',
      requestKind: 'multipart',
      multipartFields: { purpose: 'assistants' },
      multipartFiles: [{
        field: 'file',
        name: 'sample.txt',
        mimeType: 'text/plain',
        dataUrl: 'data:text/plain;base64,aGVsbG8=',
      }],
    })).toMatchObject({
      success: true,
      data: {
        requestKind: 'multipart',
        multipartFields: { purpose: 'assistants' },
        multipartFiles: [{ field: 'file', name: 'sample.txt' }],
      },
    });
  });

  it.each([
    [{}, 'method'],
    [{ method: 'PATCH', path: '/v1/responses', requestKind: 'empty' }, 'method'],
    [{ method: 'POST', path: '/v1/responses', requestKind: 'other' }, 'requestKind'],
    [{ method: 'POST', path: '/api/accounts', requestKind: 'empty' }, undefined],
    [{ method: 'GET', path: '/v1/files', requestKind: 'json' }, undefined],
    [{ method: 'POST', path: '/v1/files', requestKind: 'multipart' }, undefined],
    [{ method: 'POST', path: '/v1/responses', requestKind: 'json', rawMode: true }, undefined],
    [{ method: 'POST', path: '/v1/responses', requestKind: 'empty', jsonBody: {} }, 'requestKind'],
    [{ method: 'POST', path: '/v1/responses', requestKind: 'empty', unexpected: true }, 'unexpected'],
  ])('rejects invalid or cross-kind payload fields %#', (input, field) => {
    const result = parseModelTesterProxyPayload(input);
    expect(result.success).toBe(false);
    if (!result.success && field !== undefined) expect(result.error.params.field).toBe(field);
  });
});
