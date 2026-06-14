import { headerValueToString } from '../platforms/headers.js';
import type { PassthroughHeadersConfig } from './types.js';

export const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export const BLOCKED_PASSTHROUGH_HEADERS = new Set([
  'host',
  'content-type',
  'content-length',
  'accept-encoding',
  'cookie',
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
]);

export const GENERIC_PASSTHROUGH_ALLOWED_HEADERS = new Set([
  'accept',
  'accept-language',
  'conversation-id',
  'conversation_id',
  'openai-beta',
  'originator',
  'session-id',
  'session_id',
  'user-agent',
  'x-codex-beta-features',
  'x-codex-turn-metadata',
  'x-codex-turn-state',
]);

export const METAPI_INTERNAL_HEADER_BLOCKLIST = new Set([
  'x-metapi-tester-request',
  'x-metapi-tester-forced-channel-id',
  'x-metapi-responses-websocket-mode',
  'x-metapi-responses-websocket-transport',
]);

export function shouldSkipPassthroughHeader(key: string): boolean {
  const lower = key.toLowerCase();
  if (HOP_BY_HOP_HEADERS.has(lower) || BLOCKED_PASSTHROUGH_HEADERS.has(lower)) return true;
  if (METAPI_INTERNAL_HEADER_BLOCKLIST.has(lower)) return true;
  if (lower.startsWith('x-metapi-')) return true;
  if (!GENERIC_PASSTHROUGH_ALLOWED_HEADERS.has(lower)) return true;
  return false;
}

export function extractCustomPassthroughHeaders(options: {
  headers?: Record<string, unknown>;
  defaultAllowlist: Set<string>;
  defaultBlockedList: Set<string>;
  defaultPrefixes?: string[];
  config?: PassthroughHeadersConfig;
}): Record<string, string> {
  const { headers, defaultAllowlist, defaultBlockedList, defaultPrefixes = [], config } = options;
  if (!headers) return {};

  const customAllow = new Set(config?.allowlist?.map((h: string) => h.toLowerCase()) || []);
  const customBlock = new Set(config?.blocklist?.map((h: string) => h.toLowerCase()) || []);
  const customPrefixes = config?.forwardAllMatchedPrefixes?.map((p: string) => p.toLowerCase()) || [];

  const forwarded: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = rawKey.toLowerCase();
    if (!key) continue;

    if (
      HOP_BY_HOP_HEADERS.has(key) ||
      defaultBlockedList.has(key) ||
      METAPI_INTERNAL_HEADER_BLOCKLIST.has(key) ||
      key.startsWith('x-metapi-') ||
      customBlock.has(key)
    ) {
      continue;
    }

    const isAllowed = (
      customAllow.has(key) ||
      defaultAllowlist.has(key) ||
      defaultPrefixes.some((pref: string) => key.startsWith(pref)) ||
      customPrefixes.some((pref: string) => key.startsWith(pref))
    );
    if (!isAllowed) continue;

    const value = headerValueToString(rawValue);
    if (!value) continue;
    forwarded[key] = value;
  }

  return forwarded;
}

export function extractSafePassthroughHeaders(
  headers?: Record<string, unknown>,
  config?: PassthroughHeadersConfig,
): Record<string, string> {
  return extractCustomPassthroughHeaders({
    headers,
    defaultAllowlist: GENERIC_PASSTHROUGH_ALLOWED_HEADERS,
    defaultBlockedList: BLOCKED_PASSTHROUGH_HEADERS,
    config,
  });
}

export function extractClaudePassthroughHeaders(
  headers?: Record<string, unknown>,
  config?: PassthroughHeadersConfig,
): Record<string, string> {
  return extractCustomPassthroughHeaders({
    headers,
    defaultAllowlist: new Set(),
    defaultBlockedList: BLOCKED_PASSTHROUGH_HEADERS,
    defaultPrefixes: ['anthropic-', 'x-claude-', 'x-stainless-'],
    config,
  });
}

export function extractResponsesPassthroughHeaders(
  headers?: Record<string, unknown>,
  config?: PassthroughHeadersConfig,
): Record<string, string> {
  return extractCustomPassthroughHeaders({
    headers,
    defaultAllowlist: new Set([
      'originator',
      'user-agent',
      'session-id',
      'session_id',
      'conversation-id',
      'conversation_id',
      'version',
    ]),
    defaultBlockedList: BLOCKED_PASSTHROUGH_HEADERS,
    defaultPrefixes: ['openai-', 'x-openai-', 'x-stainless-', 'chatgpt-'],
    config,
  });
}

export function extractCodexPassthroughHeaders(
  headers?: Record<string, unknown>,
  config?: PassthroughHeadersConfig,
): Record<string, string> {
  return extractCustomPassthroughHeaders({
    headers,
    defaultAllowlist: new Set(['version', 'x-responsesapi-include-timing-metrics']),
    defaultBlockedList: BLOCKED_PASSTHROUGH_HEADERS,
    config,
  });
}
