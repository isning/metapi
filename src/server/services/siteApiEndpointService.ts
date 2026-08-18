import { asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { RETRYABLE_TIMEOUT_PATTERNS } from './proxyRetryPolicy.js';
import {
  DEFAULT_SITE_API_ENDPOINT_BACKOFF_POLICY,
  normalizeSiteApiEndpointBackoffOverride,
  resolveSiteApiEndpointBackoffPolicy,
  type SiteApiEndpointBackoffFailureClass,
  type SiteApiEndpointBackoffOverride,
  type SiteApiEndpointBackoffPolicy,
} from '../../shared/siteApiEndpointBackoff.js';

const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 422]);
const NETWORK_FAILURE_PATTERNS = [
  /network error/i,
  /fetch failed/i,
  /socket hang up/i,
  /econnreset/i,
  /econnrefused/i,
  /enotfound/i,
  /ehostunreach/i,
  /ecanceled/i,
  ...RETRYABLE_TIMEOUT_PATTERNS,
];

export const SITE_API_ENDPOINT_COOLDOWN_MS = DEFAULT_SITE_API_ENDPOINT_BACKOFF_POLICY.cooldownSec * 1000;

type SiteRow = typeof schema.sites.$inferSelect;
type SiteApiEndpointRow = typeof schema.siteApiEndpoints.$inferSelect;

export interface SiteApiEndpointTarget {
  kind: 'site-fallback' | 'endpoint';
  siteId: number;
  endpointId: number | null;
  baseUrl: string;
  configuredEndpointCount: number;
  endpoint: SiteApiEndpointRow | null;
}

export interface SiteApiEndpointFailureInput {
  status?: number | null;
  message?: string | null;
  error?: unknown;
}

export interface SiteApiEndpointFailureDisposition {
  failureClass: SiteApiEndpointBackoffFailureClass | 'model_or_channel' | 'request';
  cooldownAddress: boolean;
  rotateToNextEndpoint: boolean;
  failureReason: string;
}

export interface RecordedSiteApiEndpointFailure extends SiteApiEndpointFailureDisposition {
  cooldownUntil: string | null;
}

export type SiteApiEndpointPoolUnavailableReason =
  | 'all_endpoints_cooling_down'
  | 'all_endpoints_disabled'
  | 'no_eligible_endpoint';

export type SiteApiEndpointPoolUnavailableDetails = {
  reason: SiteApiEndpointPoolUnavailableReason;
  configuredEndpointCount: number;
  enabledEndpointCount: number;
  coolingDownEndpointCount: number;
  nextAvailableAt: string | null;
  endpointFailures: Array<{
    endpointId: number;
    url: string;
    enabled: boolean;
    cooldownUntil: string | null;
    lastFailureReason: string | null;
  }>;
};

export class SiteApiEndpointPoolUnavailableError extends Error {
  readonly details: SiteApiEndpointPoolUnavailableDetails;

  constructor(details: SiteApiEndpointPoolUnavailableDetails) {
    super('当前站点的 API 请求地址均不可用');
    this.name = 'SiteApiEndpointPoolUnavailableError';
    this.details = details;
  }
}

export class SiteApiEndpointRequestError extends Error {
  readonly status: number | null;
  readonly rawErrText: string | null;
  readonly firstByteLatencyMs: number | null;

  constructor(message: string, options?: {
    status?: number | null;
    rawErrText?: string | null;
    firstByteLatencyMs?: number | null;
    cause?: unknown;
  }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'SiteApiEndpointRequestError';
    this.status = typeof options?.status === 'number' ? options.status : null;
    this.rawErrText = typeof options?.rawErrText === 'string' && options.rawErrText.trim()
      ? options.rawErrText
      : null;
    this.firstByteLatencyMs = typeof options?.firstByteLatencyMs === 'number' && Number.isFinite(options.firstByteLatencyMs)
      ? options.firstByteLatencyMs
      : null;
  }
}

export function normalizeSiteApiEndpointBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function toIsoTimestamp(now?: string | Date): string {
  if (typeof now === 'string' && now.trim()) return now;
  if (now instanceof Date) return now.toISOString();
  return new Date().toISOString();
}

function compareNullableTimeAsc(left?: string | null, right?: string | null): number {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

function isEndpointCoolingDown(endpoint: SiteApiEndpointRow, nowIso: string): boolean {
  return !!endpoint.cooldownUntil && endpoint.cooldownUntil > nowIso;
}

function siteApiEndpointBackoffOverride(site: SiteRow): SiteApiEndpointBackoffOverride | null {
  if (typeof site.apiEndpointBackoffPolicy !== 'string' || !site.apiEndpointBackoffPolicy.trim()) return null;
  try {
    return normalizeSiteApiEndpointBackoffOverride(JSON.parse(site.apiEndpointBackoffPolicy));
  } catch {
    return null;
  }
}

function extractFailureMessage(input: SiteApiEndpointFailureInput): string {
  const direct = typeof input.message === 'string' ? input.message.trim() : '';
  if (direct) return direct;
  const errorMessage = input.error instanceof Error ? input.error.message.trim() : '';
  return errorMessage;
}

function extractFailureDetail(input: SiteApiEndpointFailureInput): string {
  const raw = input.error instanceof SiteApiEndpointRequestError ? input.error.rawErrText : null;
  return [extractFailureMessage(input), raw].filter(Boolean).join('\n').toLowerCase();
}

function formatFailureReason(status: number | null, message: string): string {
  if (status && message) {
    if (message.match(new RegExp(`^HTTP\\s+${status}\\b`, 'i'))) {
      return message;
    }
    return `HTTP ${status}: ${message}`;
  }
  if (status) return `HTTP ${status}`;
  return message || 'endpoint failure';
}

function parseStatusFromFailureMessage(message: string): number | null {
  const matched = message.match(/\bHTTP\s+(\d{3})\b/i);
  if (!matched) return null;
  const status = Number.parseInt(matched[1] || '', 10);
  return Number.isFinite(status) ? status : null;
}

export function classifySiteApiEndpointFailure(
  input: SiteApiEndpointFailureInput,
  policy: SiteApiEndpointBackoffPolicy | null = DEFAULT_SITE_API_ENDPOINT_BACKOFF_POLICY,
): SiteApiEndpointFailureDisposition {
  const message = extractFailureMessage(input);
  const detail = extractFailureDetail(input);
  const status = typeof input.status === 'number'
    ? input.status
    : parseStatusFromFailureMessage(message);
  const failureReason = formatFailureReason(status, message);

  // A model/channel error can be wrapped by aggregators in a 429/5xx. It must
  // remain local to the execution target rather than poisoning every model on
  // this site API address.
  if (/(?:get_channel_failed|model[_\s-]?(?:not[_\s-]?found|overloaded|unavailable)|(?:model|deployment)[^\n]{0,80}(?:capacity|overload|unavailable|not found|does not exist|unsupported)|(?:capacity|overloaded)[^\n]{0,80}(?:model|deployment)|insufficient[_\s-]?quota)/i.test(detail)) {
    return { failureClass: 'model_or_channel', cooldownAddress: false, rotateToNextEndpoint: false, failureReason };
  }

  if (status === 408 || NETWORK_FAILURE_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      failureClass: 'transport',
      cooldownAddress: policy?.cooldownOn.includes('transport') === true,
      rotateToNextEndpoint: true,
      failureReason,
    };
  }

  if (status === 429 || /\b(rate[ _-]?limit|too many requests)\b/i.test(detail)) {
    return {
      failureClass: 'rate_limit',
      cooldownAddress: policy?.cooldownOn.includes('rate_limit') === true,
      rotateToNextEndpoint: true,
      failureReason,
    };
  }

  if (status !== null) {
    if ([502, 503, 504].includes(status)) {
      return {
        failureClass: 'gateway',
        cooldownAddress: policy?.cooldownOn.includes('gateway') === true,
        rotateToNextEndpoint: true,
        failureReason,
      };
    }
    if (status >= 500) {
      return {
        failureClass: 'upstream_server',
        cooldownAddress: policy?.cooldownOn.includes('upstream_server') === true,
        rotateToNextEndpoint: true,
        failureReason,
      };
    }
    if (NON_RETRYABLE_STATUS_CODES.has(status)) {
      return { failureClass: 'request', cooldownAddress: false, rotateToNextEndpoint: false, failureReason };
    }
  }

  return { failureClass: 'request', cooldownAddress: false, rotateToNextEndpoint: false, failureReason };
}

export async function selectSiteApiEndpointTarget(
  site: SiteRow,
  now?: string | Date,
  options?: { excludeEndpointIds?: ReadonlySet<number> },
): Promise<SiteApiEndpointTarget | null> {
  const nowIso = toIsoTimestamp(now);
  const endpoints = await db.select().from(schema.siteApiEndpoints)
    .where(eq(schema.siteApiEndpoints.siteId, site.id))
    .orderBy(asc(schema.siteApiEndpoints.sortOrder), asc(schema.siteApiEndpoints.id))
    .all();

  if (endpoints.length === 0) {
    return {
      kind: 'site-fallback',
      siteId: site.id,
      endpointId: null,
      baseUrl: normalizeSiteApiEndpointBaseUrl(site.url),
      configuredEndpointCount: 0,
      endpoint: null,
    };
  }

  const eligible = endpoints
    .filter((endpoint) => (
      (endpoint.enabled ?? true)
      && !isEndpointCoolingDown(endpoint, nowIso)
      && !options?.excludeEndpointIds?.has(endpoint.id)
    ))
    .sort((left, right) => {
      const sortOrder = (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
      if (sortOrder !== 0) return sortOrder;
      const selectionOrder = compareNullableTimeAsc(left.lastSelectedAt, right.lastSelectedAt);
      if (selectionOrder !== 0) return selectionOrder;
      return (left.id ?? 0) - (right.id ?? 0);
    });

  const selected = eligible[0];
  if (!selected) return null;

  return {
    kind: 'endpoint',
    siteId: site.id,
    endpointId: selected.id,
    baseUrl: normalizeSiteApiEndpointBaseUrl(selected.url),
    configuredEndpointCount: endpoints.length,
    endpoint: selected,
  };
}

export async function describeUnavailableSiteApiEndpointPool(
  site: SiteRow,
  now?: string | Date,
): Promise<SiteApiEndpointPoolUnavailableDetails> {
  const nowIso = toIsoTimestamp(now);
  const endpoints = await db.select().from(schema.siteApiEndpoints)
    .where(eq(schema.siteApiEndpoints.siteId, site.id))
    .orderBy(asc(schema.siteApiEndpoints.sortOrder), asc(schema.siteApiEndpoints.id))
    .all();
  const enabled = endpoints.filter((endpoint) => endpoint.enabled ?? true);
  const coolingDown = enabled.filter((endpoint) => isEndpointCoolingDown(endpoint, nowIso));
  const nextAvailableAt = coolingDown
    .map((endpoint) => endpoint.cooldownUntil)
    .filter((value): value is string => !!value)
    .sort()[0] ?? null;
  const reason: SiteApiEndpointPoolUnavailableReason = (
    enabled.length === 0
      ? 'all_endpoints_disabled'
      : coolingDown.length === enabled.length
        ? 'all_endpoints_cooling_down'
        : 'no_eligible_endpoint'
  );

  return {
    reason,
    configuredEndpointCount: endpoints.length,
    enabledEndpointCount: enabled.length,
    coolingDownEndpointCount: coolingDown.length,
    nextAvailableAt,
    endpointFailures: endpoints.map((endpoint) => ({
      endpointId: endpoint.id,
      url: normalizeSiteApiEndpointBaseUrl(endpoint.url),
      enabled: endpoint.enabled ?? true,
      cooldownUntil: endpoint.cooldownUntil,
      lastFailureReason: endpoint.lastFailureReason,
    })),
  };
}

export async function resolveSiteApiBaseUrl(
  site: SiteRow,
  now?: string | Date,
): Promise<string | null> {
  const target = await selectSiteApiEndpointTarget(site, now);
  return target?.baseUrl || null;
}

export async function requireSiteApiBaseUrl(
  site: SiteRow,
  now?: string | Date,
): Promise<string> {
  const baseUrl = await resolveSiteApiBaseUrl(site, now);
  if (baseUrl) return baseUrl;
  throw new Error('当前站点的 API 请求地址均不可用');
}

export async function recordSiteApiEndpointFailure(
  endpointId: number,
  input: SiteApiEndpointFailureInput,
  now?: string | Date,
  options?: { policyOverride?: SiteApiEndpointBackoffOverride | null; defaultPolicy?: SiteApiEndpointBackoffPolicy },
): Promise<RecordedSiteApiEndpointFailure> {
  const nowIso = toIsoTimestamp(now);
  const policy = resolveSiteApiEndpointBackoffPolicy(
    options?.policyOverride,
    options?.defaultPolicy || DEFAULT_SITE_API_ENDPOINT_BACKOFF_POLICY,
  );
  const disposition = classifySiteApiEndpointFailure(input, policy);
  const cooldownUntil = disposition.cooldownAddress
    ? new Date(Date.parse(nowIso) + (policy?.cooldownSec || 0) * 1000).toISOString()
    : null;

  if (!disposition.rotateToNextEndpoint) {
    return {
      ...disposition,
      cooldownUntil,
    };
  }

  await db.update(schema.siteApiEndpoints).set({
    cooldownUntil: disposition.cooldownAddress
      ? cooldownUntil
      : sql`CASE WHEN ${schema.siteApiEndpoints.cooldownUntil} > ${nowIso} THEN ${schema.siteApiEndpoints.cooldownUntil} ELSE NULL END`,
    lastFailedAt: disposition.cooldownAddress
      ? nowIso
      : sql`CASE WHEN ${schema.siteApiEndpoints.cooldownUntil} > ${nowIso} THEN ${schema.siteApiEndpoints.lastFailedAt} ELSE ${nowIso} END`,
    lastFailureReason: disposition.cooldownAddress
      ? disposition.failureReason
      : sql`CASE WHEN ${schema.siteApiEndpoints.cooldownUntil} > ${nowIso} THEN ${schema.siteApiEndpoints.lastFailureReason} ELSE ${disposition.failureReason} END`,
    updatedAt: nowIso,
  }).where(eq(schema.siteApiEndpoints.id, endpointId)).run();

  return {
    ...disposition,
    cooldownUntil,
  };
}

export async function recordSiteApiEndpointSuccess(
  endpointId: number,
  now?: string | Date,
): Promise<void> {
  const nowIso = toIsoTimestamp(now);
  await db.update(schema.siteApiEndpoints).set({
    cooldownUntil: null,
    lastSelectedAt: nowIso,
    lastFailureReason: null,
    updatedAt: nowIso,
  }).where(eq(schema.siteApiEndpoints.id, endpointId)).run();
}

export async function runWithSiteApiEndpointPool<T>(
  site: SiteRow,
  operation: (target: SiteApiEndpointTarget) => Promise<T>,
): Promise<T> {
  const policyOverride = siteApiEndpointBackoffOverride(site);
  const attemptedEndpointIds = new Set<number>();
  let lastError: unknown;

  while (true) {
    const target = await selectSiteApiEndpointTarget(site, undefined, {
      excludeEndpointIds: attemptedEndpointIds,
    });
    if (!target) {
      if (lastError) throw lastError;
      throw new SiteApiEndpointPoolUnavailableError(
        await describeUnavailableSiteApiEndpointPool(site),
      );
    }

    try {
      const result = await operation(target);
      if (target.endpointId) {
        try {
          await recordSiteApiEndpointSuccess(target.endpointId);
        } catch (error) {
          console.warn('[siteApiEndpointService] failed to record endpoint success', error);
        }
      }
      return result;
    } catch (error) {
      lastError = error;
      if (!target.endpointId) {
        throw error;
      }

      const recordedFailure = await recordSiteApiEndpointFailure(target.endpointId, {
        status: error instanceof SiteApiEndpointRequestError ? error.status : undefined,
        message: error instanceof Error ? error.message : String(error ?? ''),
        error,
      }, undefined, { policyOverride, defaultPolicy: config.siteApiEndpointBackoffDefault });
      if (!recordedFailure.rotateToNextEndpoint) {
        throw error;
      }

      attemptedEndpointIds.add(target.endpointId);
    }
  }
}
