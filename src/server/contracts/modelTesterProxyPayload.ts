import type { CompiledRuntimeJsonValue } from '../../shared/compiledRuntimeRequest.js';
import type {
  ModelTesterProxyCommandError,
  ModelTesterProxyEnvelope,
  ModelTesterProxyMethod,
  ModelTesterProxyMultipartFile,
} from '../../shared/modelTesterProxy.js';
import { normalizeForcedExecutionAttemptId } from '../proxy-core/executionAttemptSelection.js';

export type ValidatedModelTesterProxyEnvelope = ModelTesterProxyEnvelope & {
  method: ModelTesterProxyMethod;
  path: string;
  stream: boolean;
  jobMode: boolean;
  forcedExecutionAttemptId: string | null;
};

export type ModelTesterProxyPayloadParseResult =
  | { success: true; data: ValidatedModelTesterProxyEnvelope }
  | { success: false; error: ModelTesterProxyCommandError };

const ALLOWED_PROXY_PATH_PATTERNS: RegExp[] = [
  /^\/v1\/chat\/completions(?:\?.*)?$/i,
  /^\/v1\/files(?:\/[^/?#]+(?:\/content)?)?(?:\?.*)?$/i,
  /^\/v1\/responses(?:\/compact)?(?:\?.*)?$/i,
  /^\/v1\/messages(?:\?.*)?$/i,
  /^\/v1\/embeddings(?:\?.*)?$/i,
  /^\/v1\/search(?:\?.*)?$/i,
  /^\/v1\/images\/(?:generations|edits)(?:\?.*)?$/i,
  /^\/v1\/videos(?:\?.*)?$/i,
  /^\/v1\/videos\/[^/?#]+(?:\?.*)?$/i,
  /^\/gemini\/[^/]+\/models(?:\?.*)?$/i,
  /^\/gemini\/[^/]+\/models\/.+(?:\?.*)?$/i,
  /^\/v1beta\/models(?:\?.*)?$/i,
  /^\/v1beta\/models\/.+(?:\?.*)?$/i,
];

const ENVELOPE_FIELDS = new Set([
  'method',
  'path',
  'requestKind',
  'stream',
  'jobMode',
  'rawMode',
  'forcedExecutionAttemptId',
  'jsonBody',
  'rawJsonText',
  'multipartFields',
  'multipartFiles',
]);

function commandError(
  code: ModelTesterProxyCommandError['code'],
  params: ModelTesterProxyCommandError['params'] = {},
): ModelTesterProxyPayloadParseResult {
  return { success: false, error: { success: false, code, params } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is CompiledRuntimeJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function normalizeProxyPath(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      return `${url.pathname}${url.search}`;
    }
  } catch {
    return '';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function parseMultipartFiles(value: unknown): ModelTesterProxyMultipartFile[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const files: ModelTesterProxyMultipartFile[] = [];
  for (const item of value) {
    if (
      !isRecord(item)
      || typeof item.field !== 'string' || !item.field.trim()
      || typeof item.name !== 'string' || !item.name.trim()
      || typeof item.mimeType !== 'string' || !item.mimeType.trim()
      || typeof item.dataUrl !== 'string' || !item.dataUrl.trim()
    ) return null;
    files.push({
      field: item.field,
      name: item.name,
      mimeType: item.mimeType,
      dataUrl: item.dataUrl,
    });
  }
  return files;
}

export function parseModelTesterProxyPayload(input: unknown): ModelTesterProxyPayloadParseResult {
  if (!isRecord(input)) return commandError('model_tester_payload_invalid', { field: 'body' });
  const body = input;
  const unknownField = Object.keys(body).find((field) => !ENVELOPE_FIELDS.has(field));
  if (unknownField) return commandError('model_tester_payload_invalid', { field: unknownField });
  if (body.method !== 'POST' && body.method !== 'GET' && body.method !== 'DELETE') {
    return commandError('model_tester_payload_invalid', { field: 'method' });
  }
  if (body.requestKind !== 'json' && body.requestKind !== 'multipart' && body.requestKind !== 'empty') {
    return commandError('model_tester_payload_invalid', { field: 'requestKind' });
  }
  const method: ModelTesterProxyMethod = body.method;
  const path = normalizeProxyPath(body.path);
  if (!path) return commandError('model_tester_path_required');
  if (!ALLOWED_PROXY_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    return commandError('model_tester_path_not_allowed', { path });
  }

  const requestKind = body.requestKind;
  if (method !== 'POST' && requestKind !== 'empty') {
    return commandError('model_tester_method_body_not_allowed', { method, requestKind });
  }

  const base = {
    method,
    path,
    stream: body.stream === true,
    jobMode: body.jobMode === true,
    forcedExecutionAttemptId: normalizeForcedExecutionAttemptId(body.forcedExecutionAttemptId),
  };

  if (requestKind === 'empty') {
    if (
      body.rawMode === true
      || body.jsonBody !== undefined
      || body.rawJsonText !== undefined
      || body.multipartFields !== undefined
      || body.multipartFiles !== undefined
    ) return commandError('model_tester_payload_invalid', { field: 'requestKind' });
    return { success: true, data: { ...base, requestKind, rawMode: false } };
  }

  if (requestKind === 'json') {
    if (body.rawMode === true) {
      if (
        body.jsonBody !== undefined
        || body.multipartFields !== undefined
        || body.multipartFiles !== undefined
      ) return commandError('model_tester_payload_invalid', { field: 'rawMode' });
      if (typeof body.rawJsonText !== 'string' || !body.rawJsonText.trim()) {
        return commandError('model_tester_raw_json_required');
      }
      return {
        success: true,
        data: { ...base, requestKind, rawMode: true, rawJsonText: body.rawJsonText },
      };
    }
    if (
      body.rawJsonText !== undefined
      || body.multipartFields !== undefined
      || body.multipartFiles !== undefined
    ) return commandError('model_tester_payload_invalid', { field: 'requestKind' });
    if (body.jsonBody !== undefined && !isJsonValue(body.jsonBody)) {
      return commandError('model_tester_json_body_invalid');
    }
    return {
      success: true,
      data: { ...base, requestKind, rawMode: false, jsonBody: body.jsonBody as CompiledRuntimeJsonValue | undefined },
    };
  }

  if (body.rawMode === true || body.jsonBody !== undefined || body.rawJsonText !== undefined) {
    return commandError('model_tester_payload_invalid', { field: 'requestKind' });
  }

  const fields = isRecord(body.multipartFields)
    ? Object.fromEntries(Object.entries(body.multipartFields).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ))
    : {};
  const files = parseMultipartFiles(body.multipartFiles);
  if (!files) return commandError('model_tester_multipart_file_invalid');
  if (files.length === 0 && Object.keys(fields).length === 0) {
    return commandError('model_tester_multipart_body_required');
  }
  return {
    success: true,
    data: {
      ...base,
      requestKind,
      rawMode: false,
      multipartFields: fields,
      multipartFiles: files,
    },
  };
}
