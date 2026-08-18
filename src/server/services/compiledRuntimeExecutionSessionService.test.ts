import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

describe('compiledRuntimeExecutionSessionService', () => {
  let db: typeof import('../db/index.js')['db'];
  let schema: typeof import('../db/index.js')['schema'];
  let service: typeof import('./compiledRuntimeExecutionSessionService.js');

  beforeAll(async () => {
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'metapi-execution-session-'));
    const migrate = await import('../db/migrate.js');
    await migrate.runSqliteMigrations();
    ({ db, schema } = await import('../db/index.js'));
    service = await import('./compiledRuntimeExecutionSessionService.js');
  });

  it('persists the final affinity outcome instead of the initial pending snapshot', async () => {
    const session = await service.startCompiledRuntimeExecutionSession({
      downstreamPath: '/v1/responses',
      requestedModel: 'gpt-5.6',
      isStream: true,
    });
    const snapshot = {
      executionAttempt: {
        affinity: {
          bindingOutcome: 'pending',
          resultingPrimaryPoolId: null,
          resultingRevision: null,
        },
      },
    };
    await service.bindCompiledRuntimeExecutionDecision({
      session,
      routeEntrypointId: 'entry:gpt-5.6',
      runtimeEndpointId: 'endpoint:gpt-5.6',
      executionAttemptId: 'attempt:gpt-5.6',
      decisionSnapshot: snapshot,
    });

    snapshot.executionAttempt.affinity.bindingOutcome = 'promoted';
    snapshot.executionAttempt.affinity.resultingPrimaryPoolId = 'pool:recovered';
    snapshot.executionAttempt.affinity.resultingRevision = 3;
    await service.completeCompiledRuntimeExecutionSession(session, {
      status: 'success',
      httpStatus: 200,
      decisionSnapshot: snapshot,
    });

    const row = await db.select({ decisionSnapshot: schema.proxyRequests.decisionSnapshot })
      .from(schema.proxyRequests)
      .where(eq(schema.proxyRequests.id, session.requestId))
      .get();
    expect(JSON.parse(row?.decisionSnapshot || '{}')).toMatchObject({
      executionAttempt: {
        affinity: {
          bindingOutcome: 'promoted',
          resultingPrimaryPoolId: 'pool:recovered',
          resultingRevision: 3,
        },
      },
    });
  });

  it('preserves a bound decision snapshot when terminal callers omit it', async () => {
    const session = await service.startCompiledRuntimeExecutionSession({
      downstreamPath: '/v1/chat/completions',
    });
    await service.bindCompiledRuntimeExecutionDecision({
      session,
      routeEntrypointId: 'entry:legacy',
      runtimeEndpointId: 'endpoint:legacy',
      executionAttemptId: 'attempt:legacy',
      decisionSnapshot: { evidence: 'preserved' },
    });
    await service.completeCompiledRuntimeExecutionSession(session, {
      status: 'failure',
      httpStatus: 502,
      errorMessage: 'upstream failed',
    });

    const row = await db.select({ decisionSnapshot: schema.proxyRequests.decisionSnapshot })
      .from(schema.proxyRequests)
      .where(eq(schema.proxyRequests.id, session.requestId))
      .get();
    expect(JSON.parse(row?.decisionSnapshot || '{}')).toMatchObject({
      request: { downstreamPath: '/v1/chat/completions', stream: null },
      evidence: 'preserved',
    });
  });

  it('persists request-level unavailable decisions without fabricating an endpoint or attempt', async () => {
    const session = await service.startCompiledRuntimeExecutionSession({
      downstreamPath: '/v1/responses',
      requestedModel: 'unavailable-model',
    });
    await service.bindCompiledRuntimeUnavailableDecision({
      session,
      routeEntrypointId: 'entry:unavailable-model',
      runtimeBundleHash: 'bundle:unavailable',
      decisionSnapshot: { decision: { unavailable: { reason: 'execution_attempts_exhausted' } } },
    });
    await service.completeCompiledRuntimeExecutionSession(session, {
      status: 'failure',
      httpStatus: 503,
      errorMessage: 'all attempts unavailable',
    });

    const row = await db.select().from(schema.proxyRequests)
      .where(eq(schema.proxyRequests.id, session.requestId))
      .get();
    expect(row).toMatchObject({
      routeEntrypointId: 'entry:unavailable-model',
      runtimeEndpointId: null,
      finalExecutionAttemptId: null,
      runtimeBundleHash: 'bundle:unavailable',
    });
    expect(JSON.parse(row?.decisionSnapshot || '{}')).toMatchObject({
      decision: { unavailable: { reason: 'execution_attempts_exhausted' } },
    });
  });
});
