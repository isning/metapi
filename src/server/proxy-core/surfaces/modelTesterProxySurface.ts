import { fetch, File, FormData } from 'undici';
import type { ValidatedModelTesterProxyEnvelope } from '../../contracts/modelTesterProxyPayload.js';
import { config } from '../../config.js';
import { readRuntimeResponseText } from '../executors/types.js';
import {
  TESTER_FORCED_EXECUTION_ATTEMPT_HEADER,
  TESTER_REQUEST_HEADER,
} from '../executionAttemptSelection.js';

type UndiciRequestInit = Parameters<typeof fetch>[1];

export class ModelTesterUpstreamError extends Error {
  constructor(
    readonly statusCode: number,
    readonly responsePayload: unknown,
  ) {
    super(`Model tester upstream request failed with status ${statusCode}`);
    this.name = 'ModelTesterUpstreamError';
  }
}

export class ModelTesterTransportError extends Error {
  constructor(
    readonly code: 'model_tester_transport_failed' | 'model_tester_stream_body_missing',
    readonly params: Record<string, string | number | boolean | null> = {},
  ) {
    super(code);
    this.name = 'ModelTesterTransportError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeErrorPayload(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text, type: 'upstream_error' } };
  }
}

function createDefaultHeaders(path: string): Record<string, string> {
  if (/^\/v1\/messages$/i.test(path)) {
    return {
      'x-api-key': config.proxyToken,
      'anthropic-version': '2023-06-01',
    };
  }
  if (/^\/(?:gemini\/[^/]+\/models\/.+|v1beta\/models\/.+)$/i.test(path)) {
    return { 'x-goog-api-key': config.proxyToken };
  }
  return { Authorization: `Bearer ${config.proxyToken}` };
}

function applyStreamOverride(value: unknown, forceStream: boolean): unknown {
  return isRecord(value) ? { ...value, stream: forceStream } : value;
}

function serializeJsonBody(
  envelope: ValidatedModelTesterProxyEnvelope,
  forceStream: boolean,
): string {
  if (envelope.requestKind !== 'json') return '';
  if (envelope.rawMode) {
    try {
      return JSON.stringify(applyStreamOverride(JSON.parse(envelope.rawJsonText), forceStream));
    } catch {
      return envelope.rawJsonText;
    }
  }
  return JSON.stringify(applyStreamOverride(envelope.jsonBody ?? { stream: forceStream }, forceStream));
}

function decodeDataUrl(dataUrl: string): { mimeType: string; bytes: Uint8Array } {
  const match = /^data:([^;,]+)?;base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) throw new ModelTesterTransportError('model_tester_transport_failed');
  return {
    mimeType: match[1] || 'application/octet-stream',
    bytes: Uint8Array.from(Buffer.from(match[2], 'base64')),
  };
}

async function buildRequestInit(
  envelope: ValidatedModelTesterProxyEnvelope,
  forceStream: boolean,
): Promise<UndiciRequestInit> {
  const headers = createDefaultHeaders(envelope.path);
  headers[TESTER_REQUEST_HEADER] = '1';
  if (envelope.forcedExecutionAttemptId) {
    headers[TESTER_FORCED_EXECUTION_ATTEMPT_HEADER] = envelope.forcedExecutionAttemptId;
  }

  if (envelope.requestKind === 'json') {
    headers['Content-Type'] = 'application/json';
    return { method: envelope.method, headers, body: serializeJsonBody(envelope, forceStream) };
  }
  if (envelope.requestKind === 'multipart') {
    const formData = new FormData();
    for (const [field, value] of Object.entries(envelope.multipartFields || {})) {
      formData.append(field, value);
    }
    for (const file of envelope.multipartFiles || []) {
      const decoded = decodeDataUrl(file.dataUrl);
      formData.append(file.field, new File([decoded.bytes], file.name, {
        type: file.mimeType || decoded.mimeType,
      }));
    }
    return { method: envelope.method, headers, body: formData };
  }
  return { method: envelope.method, headers };
}

async function executeFetch(
  envelope: ValidatedModelTesterProxyEnvelope,
  forceStream: boolean,
  signal?: AbortSignal,
) {
  try {
    return await fetch(`http://127.0.0.1:${config.port}${envelope.path}`, {
      ...(await buildRequestInit(envelope, forceStream)),
      signal,
    });
  } catch (error) {
    if (error instanceof ModelTesterTransportError || (error as { name?: string }).name === 'AbortError') {
      throw error;
    }
    throw new ModelTesterTransportError('model_tester_transport_failed');
  }
}

async function requireSuccessfulResponse(response: Awaited<ReturnType<typeof fetch>>) {
  if (response.ok) return response;
  const text = await readRuntimeResponseText(response);
  throw new ModelTesterUpstreamError(response.status, normalizeErrorPayload(text));
}

export async function executeModelTesterProxyBuffered(
  envelope: ValidatedModelTesterProxyEnvelope,
  options: { signal?: AbortSignal; forceStream?: boolean } = {},
): Promise<unknown> {
  const response = await requireSuccessfulResponse(await executeFetch(
    envelope,
    options.forceStream === true,
    options.signal,
  ));
  const text = await readRuntimeResponseText(response);
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function executeModelTesterProxyStream(
  envelope: ValidatedModelTesterProxyEnvelope,
  sink: {
    start(): void;
    write(chunk: Uint8Array | string): void;
    interrupted(error: ModelTesterTransportError): void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const response = await requireSuccessfulResponse(await executeFetch(envelope, true, signal));
  const contentType = response.headers.get('content-type') || '';
  sink.start();

  try {
    if (contentType.includes('text/event-stream')) {
      const reader = response.body?.getReader();
      if (!reader) throw new ModelTesterTransportError('model_tester_stream_body_missing');
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) sink.write(value);
        }
      } finally {
        try { await reader.cancel(); } catch { /* stream is already closed */ }
        reader.releaseLock();
      }
      return;
    }

    const text = await readRuntimeResponseText(response);
    for (const line of text.split(/\r?\n/)) sink.write(`data: ${line}\n`);
    sink.write('\ndata: [DONE]\n\n');
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw error;
    sink.interrupted(error instanceof ModelTesterTransportError
      ? error
      : new ModelTesterTransportError('model_tester_transport_failed'));
  }
}
