import { detectCliProfile } from './cliProfiles/registry.js';
import type {
  CliProfileClientConfidence,
  CliProfileId,
} from './cliProfiles/types.js';

export type DownstreamClientKind = CliProfileId;
export type DownstreamClientConfidence = CliProfileClientConfidence;

export type DownstreamClientContext = {
  clientKind: DownstreamClientKind;
  sessionId?: string;
  traceHint?: string;
  clientAppId?: string;
  clientAppName?: string;
  clientConfidence?: DownstreamClientConfidence;
};

type NormalizedClientHeaders = Record<string, string[]>;

type DownstreamClientBodySummary = {
  topLevelKeys: string[];
  metadataUserId: string | null;
  hasOpenCodeSystemPrompt: boolean;
};

type DownstreamClientFingerprintInput = {
  downstreamPath: string;
  headers: NormalizedClientHeaders;
  bodySummary: DownstreamClientBodySummary;
};

type DownstreamClientFingerprintRule = {
  id: string;
  name: string;
  priority: number;
  match(input: DownstreamClientFingerprintInput): DownstreamClientConfidence | null;
};

type DownstreamResolvedClientApp = {
  clientAppId: string;
  clientAppName: string;
  clientConfidence: DownstreamClientConfidence;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHeaderValues(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeHeaders(headers?: Record<string, unknown>): NormalizedClientHeaders {
  if (!headers) return {};

  const normalized: NormalizedClientHeaders = {};
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = rawKey.trim().toLowerCase();
    if (!key) continue;
    const values = normalizeHeaderValues(rawValue);
    if (values.length === 0) continue;
    normalized[key] = normalized[key]
      ? [...normalized[key], ...values]
      : values;
  }
  return normalized;
}

function headerEquals(headers: NormalizedClientHeaders, key: string, expected: string): boolean {
  const normalizedExpected = expected.trim().toLowerCase();
  return (headers[key.trim().toLowerCase()] || []).some((value) => value.trim().toLowerCase() === normalizedExpected);
}

function headerIncludes(headers: NormalizedClientHeaders, key: string, expectedFragment: string): boolean {
  const normalizedExpected = expectedFragment.trim().toLowerCase();
  return (headers[key.trim().toLowerCase()] || []).some((value) => value.trim().toLowerCase().includes(normalizedExpected));
}

function normalizeClientDisplayName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= 120 ? trimmed : trimmed.slice(0, 120).trim() || null;
}

function normalizeClientAppId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function parseExplicitClientSelfReportValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      for (const key of ['client', 'name', 'app']) {
        const raw = parsed[key];
        if (typeof raw !== 'string') continue;
        const normalized = normalizeClientDisplayName(raw);
        if (normalized) return normalized;
      }
    }
  } catch {
    return normalizeClientDisplayName(trimmed);
  }

  return null;
}

function buildBodySummary(body: unknown): DownstreamClientBodySummary {
  if (!isRecord(body)) {
    return {
      topLevelKeys: [],
      metadataUserId: null,
      hasOpenCodeSystemPrompt: false,
    };
  }

  const metadataUserId = isRecord(body.metadata) && typeof body.metadata.user_id === 'string'
    ? body.metadata.user_id.trim() || null
    : null;
  const systemPromptTexts = (
    typeof body.system === 'string'
      ? [body.system]
      : Array.isArray(body.system)
        ? body.system.map((entry) => {
          if (typeof entry === 'string') return entry;
          if (!isRecord(entry)) return '';
          return typeof entry.text === 'string' ? entry.text : '';
        })
        : []
  ).filter((entry) => entry.trim().length > 0);
  const normalizedSystemPrompt = systemPromptTexts
    .join('\n')
    .trim()
    .toLowerCase();
  const hasOpenCodeSystemPrompt = normalizedSystemPrompt.includes('you are opencode, an interactive cli tool')
    || normalizedSystemPrompt.includes('file called opencode.md');

  return {
    topLevelKeys: Object.keys(body).sort((left, right) => left.localeCompare(right)),
    metadataUserId,
    hasOpenCodeSystemPrompt,
  };
}

const appFingerprintRegistry: DownstreamClientFingerprintRule[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    priority: 110,
    match(input) {
      const hasTitle = headerIncludes(input.headers, 'x-title', 'opencode');
      const hasReferer = headerIncludes(input.headers, 'http-referer', 'opencode.ai')
        || headerIncludes(input.headers, 'referer', 'opencode.ai')
        || headerIncludes(input.headers, 'origin', 'opencode.ai');
      const hasUserAgent = headerIncludes(input.headers, 'user-agent', 'opencode/');

      if (hasTitle || hasReferer || hasUserAgent) {
        return 'exact';
      }

      return input.bodySummary.hasOpenCodeSystemPrompt ? 'heuristic' : null;
    },
  },
  {
    id: 'cherry_studio',
    name: 'Cherry Studio',
    priority: 100,
    match(input) {
      const hasTitle = headerEquals(input.headers, 'x-title', 'Cherry Studio');
      const hasReferer = headerEquals(input.headers, 'http-referer', 'https://cherry-ai.com')
        || headerEquals(input.headers, 'referer', 'https://cherry-ai.com');

      if (hasTitle && hasReferer) {
        return 'exact';
      }

      const weakSignals = [
        headerIncludes(input.headers, 'user-agent', 'cherrystudio'),
        headerIncludes(input.headers, 'x-title', 'cherry studio'),
        headerIncludes(input.headers, 'http-referer', 'cherry-ai.com'),
        headerIncludes(input.headers, 'referer', 'cherry-ai.com'),
      ];

      return weakSignals.some(Boolean) ? 'heuristic' : null;
    },
  },
];

function detectDownstreamClientFingerprint(input: {
  downstreamPath: string;
  headers?: Record<string, unknown>;
  body?: unknown;
}) {
  const fingerprintInput: DownstreamClientFingerprintInput = {
    downstreamPath: input.downstreamPath,
    headers: normalizeHeaders(input.headers),
    bodySummary: buildBodySummary(input.body),
  };

  let matchedRule: DownstreamClientFingerprintRule | null = null;
  let matchedConfidence: DownstreamClientConfidence | null = null;

  for (const rule of appFingerprintRegistry) {
    const confidence = rule.match(fingerprintInput);
    if (!confidence) continue;
    if (!matchedRule || rule.priority > matchedRule.priority) {
      matchedRule = rule;
      matchedConfidence = confidence;
    }
  }

  if (!matchedRule || !matchedConfidence) {
    return null;
  }

  return {
    clientAppId: matchedRule.id,
    clientAppName: matchedRule.name,
    clientConfidence: matchedConfidence,
  };
}

function detectExplicitClientSelfReport(headers: NormalizedClientHeaders): DownstreamResolvedClientApp | null {
  for (const value of headers['x-openai-client-user-agent'] || []) {
    const clientAppName = parseExplicitClientSelfReportValue(value);
    if (!clientAppName) continue;
    return {
      clientAppId: normalizeClientAppId(clientAppName) || 'self_reported_client',
      clientAppName,
      clientConfidence: 'exact',
    };
  }

  for (const value of headers['user-agent'] || []) {
    const normalized = value.trim().toLowerCase();
    if (!normalized.startsWith('openclaw/')) continue;
    return {
      clientAppId: 'openclaw',
      clientAppName: 'OpenClaw',
      clientConfidence: 'exact',
    };
  }

  return null;
}

function normalizeSessionAffinityId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= 256 ? trimmed : trimmed.slice(0, 256);
}

function firstHeaderValue(headers: NormalizedClientHeaders, keys: string[]): string | null {
  for (const key of keys) {
    const value = normalizeSessionAffinityId(headers[key]?.[0]);
    if (value) return value;
  }
  return null;
}

function firstRecordString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = normalizeSessionAffinityId(record[key]);
    if (value) return value;
  }
  return null;
}

function detectGenericSessionAffinityId(input: {
  headers: NormalizedClientHeaders;
  body?: unknown;
}): string | null {
  const headerSession = firstHeaderValue(input.headers, [
    'x-metapi-affinity-key',
    'x-metapi-session-id',
    'session_id',
    'session-id',
    'conversation_id',
    'conversation-id',
  ]);
  if (headerSession) return headerSession;

  const body = isRecord(input.body) ? input.body : null;
  const topLevelSession = firstRecordString(body, [
    'session_id',
    'sessionId',
    'conversation_id',
    'conversationId',
  ]);
  if (topLevelSession) return topLevelSession;

  const metadata = body && isRecord(body.metadata) ? body.metadata : null;
  return firstRecordString(metadata, [
    'session_id',
    'sessionId',
    'conversation_id',
    'conversationId',
  ]);
}

export function detectDownstreamClientContext(input: {
  downstreamPath: string;
  headers?: Record<string, unknown>;
  body?: unknown;
}): DownstreamClientContext {
  const detected = detectCliProfile(input);
  const normalizedHeaders = normalizeHeaders(input.headers);
  const sessionId = detected.sessionId || detectGenericSessionAffinityId({
    headers: normalizedHeaders,
    body: input.body,
  }) || undefined;
  const traceHint = detected.traceHint || sessionId;
  const explicitSelfReport = detectExplicitClientSelfReport(normalizedHeaders);
  const fingerprint = detectDownstreamClientFingerprint(input);
  const profileClientApp = fingerprint || explicitSelfReport
    ? null
    : (
      detected.clientAppId && detected.clientAppName
        ? {
          clientAppId: detected.clientAppId,
          clientAppName: detected.clientAppName,
          ...(detected.clientConfidence ? { clientConfidence: detected.clientConfidence } : {}),
        }
        : null
    );
  return {
    clientKind: detected.id,
    ...(sessionId ? { sessionId } : {}),
    ...(traceHint ? { traceHint } : {}),
    ...(explicitSelfReport || fingerprint || profileClientApp || {}),
  };
}
