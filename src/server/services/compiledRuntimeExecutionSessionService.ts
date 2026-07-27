import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { formatUtcSqlDateTime } from './localTimeService.js';

export type CompiledRuntimeExecutionSession = {
  requestId: string;
  startedAtMs: number;
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
};

function serializeJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
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
  return { requestId, startedAtMs };
}

export async function resumeCompiledRuntimeExecutionSession(
  requestId: string,
): Promise<CompiledRuntimeExecutionSession | null> {
  const normalizedId = String(requestId || '').trim();
  if (!normalizedId) return null;
  const row = await db.select({
    status: schema.proxyRequests.status,
    startedAt: schema.proxyRequests.startedAt,
  }).from(schema.proxyRequests)
    .where(eq(schema.proxyRequests.id, normalizedId))
    .get();
  if (!row || row.status !== 'started') return null;
  const startedAtMs = Date.parse(String(row.startedAt || '').replace(' ', 'T') + 'Z');
  return {
    requestId: normalizedId,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
  };
}

export async function bindCompiledRuntimeExecutionDecision(input: {
  requestId: string;
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
    decisionSnapshot: serializeJson(input.decisionSnapshot),
  }).where(and(
    eq(schema.proxyRequests.id, input.requestId),
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
    errorMessage: terminal.errorMessage ?? null,
    completedAt: formatUtcSqlDateTime(new Date()),
  }).where(and(
    eq(schema.proxyRequests.id, session.requestId),
    eq(schema.proxyRequests.status, 'started'),
  )).run();
}
