import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { formatUtcSqlDateTime } from './localTimeService.js';

export type CompiledRuntimeExecutionSession = {
  requestId: string;
  startedAtMs: number;
  downstreamPath: string;
  isStream: boolean | null;
};

export type CompiledRuntimeExecutionTerminal = {
  status: 'success' | 'failure';
  httpStatus: number;
  executionAttemptId?: string | null;
  runtimeEndpointId?: string | null;
  isStream?: boolean | null;
  downstreamApiKeyId?: number | null;
  latencyMs?: number | null;
  firstTokenLatencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  billingDetails?: unknown;
  errorMessage?: string | null;
  actualModel?: string | null;
  siteId?: number | null;
  accountId?: number | null;
  decisionSnapshot?: unknown;
};

function serializeJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function serializeDecisionSnapshot(
  session: CompiledRuntimeExecutionSession,
  value: unknown,
): string | null {
  if (value == null) return null;
  const body = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
  return JSON.stringify({
    capturedAt: new Date(session.startedAtMs).toISOString(),
    request: {
      downstreamPath: session.downstreamPath,
      stream: session.isStream,
    },
    ...body,
  });
}

export async function startCompiledRuntimeExecutionSession(input: {
  downstreamPath: string;
  requestedModel?: string | null;
  isStream?: boolean | null;
  downstreamApiKeyId?: number | null;
}): Promise<CompiledRuntimeExecutionSession> {
  const requestId = randomUUID();
  const startedAtMs = Date.now();
  await db.insert(schema.proxyRequests).values({
    id: requestId,
    downstreamPath: input.downstreamPath,
    requestedModel: input.requestedModel ?? null,
    isStream: input.isStream ?? null,
    downstreamApiKeyId: input.downstreamApiKeyId ?? null,
    status: 'started',
    startedAt: formatUtcSqlDateTime(new Date(startedAtMs)),
  }).run();
  return {
    requestId,
    startedAtMs,
    downstreamPath: input.downstreamPath,
    isStream: input.isStream ?? null,
  };
}

export async function resumeCompiledRuntimeExecutionSession(
  requestId: string,
): Promise<CompiledRuntimeExecutionSession | null> {
  const normalizedId = String(requestId || '').trim();
  if (!normalizedId) return null;
  const row = await db.select({
    status: schema.proxyRequests.status,
    startedAt: schema.proxyRequests.startedAt,
    downstreamPath: schema.proxyRequests.downstreamPath,
    isStream: schema.proxyRequests.isStream,
  }).from(schema.proxyRequests)
    .where(eq(schema.proxyRequests.id, normalizedId))
    .get();
  if (!row || row.status !== 'started') return null;
  const startedAtMs = Date.parse(String(row.startedAt || '').replace(' ', 'T') + 'Z');
  return {
    requestId: normalizedId,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
    downstreamPath: row.downstreamPath,
    isStream: row.isStream == null ? null : Boolean(row.isStream),
  };
}

export async function bindCompiledRuntimeExecutionDecision(input: {
  session: CompiledRuntimeExecutionSession;
  routeEntrypointId: string;
  runtimeEndpointId: string;
  executionAttemptId: string;
  runtimeBundleHash?: string | null;
  decisionSnapshot?: unknown;
}): Promise<void> {
  await db.update(schema.proxyRequests).set({
    routeEntrypointId: input.routeEntrypointId,
    runtimeEndpointId: input.runtimeEndpointId,
    finalExecutionAttemptId: input.executionAttemptId,
    runtimeBundleHash: input.runtimeBundleHash ?? null,
    decisionSnapshot: serializeDecisionSnapshot(input.session, input.decisionSnapshot),
  }).where(and(
    eq(schema.proxyRequests.id, input.session.requestId),
    eq(schema.proxyRequests.status, 'started'),
  )).run();
}

export async function bindCompiledRuntimeUnavailableDecision(input: {
  session: CompiledRuntimeExecutionSession;
  routeEntrypointId?: string | null;
  runtimeBundleHash?: string | null;
  decisionSnapshot: unknown;
}): Promise<void> {
  await db.update(schema.proxyRequests).set({
    routeEntrypointId: input.routeEntrypointId ?? null,
    runtimeEndpointId: null,
    finalExecutionAttemptId: null,
    runtimeBundleHash: input.runtimeBundleHash ?? null,
    decisionSnapshot: serializeDecisionSnapshot(input.session, input.decisionSnapshot),
  }).where(and(
    eq(schema.proxyRequests.id, input.session.requestId),
    eq(schema.proxyRequests.status, 'started'),
  )).run();
}

export async function completeCompiledRuntimeExecutionSession(
  session: CompiledRuntimeExecutionSession,
  terminal: CompiledRuntimeExecutionTerminal,
): Promise<void> {
  await db.update(schema.proxyRequests).set({
    status: terminal.status,
    httpStatus: terminal.httpStatus,
    finalExecutionAttemptId: terminal.executionAttemptId ?? null,
    actualModel: terminal.actualModel ?? null,
    finalSiteId: terminal.siteId ?? null,
    finalAccountId: terminal.accountId ?? null,
    runtimeEndpointId: terminal.runtimeEndpointId ?? null,
    isStream: terminal.isStream ?? null,
    latencyMs: terminal.latencyMs ?? Math.max(0, Date.now() - session.startedAtMs),
    firstTokenLatencyMs: terminal.firstTokenLatencyMs ?? null,
    promptTokens: terminal.promptTokens ?? null,
    completionTokens: terminal.completionTokens ?? null,
    totalTokens: terminal.totalTokens ?? null,
    estimatedCost: terminal.estimatedCost ?? null,
    billingDetails: serializeJson(terminal.billingDetails),
    ...(terminal.decisionSnapshot === undefined
      ? {}
      : { decisionSnapshot: serializeDecisionSnapshot(session, terminal.decisionSnapshot) }),
    errorMessage: terminal.errorMessage ?? null,
    completedAt: formatUtcSqlDateTime(new Date()),
  }).where(and(
    eq(schema.proxyRequests.id, session.requestId),
    eq(schema.proxyRequests.status, 'started'),
  )).run();
}
