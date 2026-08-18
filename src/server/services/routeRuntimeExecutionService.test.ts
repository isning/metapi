import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  compactCompiledRouterBundle,
  getCompiledRouterPlanById,
} from '../../shared/compiledRuntime.js';
import { getRouteRuntimeSelectorStateStore } from './routeRuntimeSelectorStateService.js';
import {
  createGraphNativeRouteFixture,
  publishCurrentGraphNativeRouteFixtures,
  resetGraphNativeRouteFixtures,
} from '../test/graphNativeRouteFixtures.js';
import {
  clearRouteGroupMemberTestData,
  getExecutionTargetIdForMember,
  insertRouteGroupMember,
} from '../../testing/routeGroupMemberTestUtils.js';
import type { RouteGroupCreatePayload } from '../contracts/routeGroupPayloads.js';
import { resolveFailureCooldownMs, resolveRouteFailureBackoffPolicy } from './routeRuntimeExecutionService.js';
import { proxyTargetCoordinator, resetProxyTargetCoordinatorState } from './proxyTargetCoordinator.js';

type DbModule = typeof import('../db/index.js');
type CompiledRuntimeExecutionModule = typeof import('./routeRuntimeExecutionService.js');
type RouteGraphServiceModule = typeof import('./routeGraphService.js');
type RouteRuntimeArtifactModule = typeof import('./routeRuntimeArtifactService.js');
type SiteCatalogMutationModule = typeof import('./siteCatalogMutationService.js');

describe('routeRuntimeExecutionService', () => {
  it('resolves failure cooldown by execution-attempt then candidate then group then macro precedence', () => {
    const global = { mode: 'custom', policy: { failureThreshold: 3, levelsSec: [0, 10], maxSec: 10 } } as const;
    expect(resolveRouteFailureBackoffPolicy({
      global,
      macro: { mode: 'custom', policy: { failureThreshold: 2, levelsSec: [0, 15], maxSec: 15 } },
      group: { mode: 'custom', policy: { failureThreshold: 2, levelsSec: [0, 20], maxSec: 20 } },
      candidate: { mode: 'disabled' },
      executionAttempt: { mode: 'custom', policy: { failureThreshold: 1, levelsSec: [0, 30], maxSec: 30 } },
    })).toEqual({ mode: 'custom', policy: { failureThreshold: 1, levelsSec: [0, 30], maxSec: 30 } });
    expect(resolveRouteFailureBackoffPolicy({ global, macro: { mode: 'disabled' } }))
      .toEqual({ mode: 'disabled' });
    expect(resolveFailureCooldownMs({
      consecutiveFailCount: 1,
      cooldownLevel: 0,
      policy: { mode: 'custom', policy: { failureThreshold: 2, levelsSec: [0, 5], maxSec: 5 } },
    })).toBe(0);
    expect(resolveFailureCooldownMs({
      consecutiveFailCount: 2,
      cooldownLevel: 0,
      policy: { mode: 'custom', policy: { failureThreshold: 2, levelsSec: [0, 5], maxSec: 5 } },
    })).toBe(5000);
    expect(resolveFailureCooldownMs({
      consecutiveFailCount: 2,
      cooldownLevel: 0,
      policy: { mode: 'disabled' },
    })).toBe(0);
  });
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let selectRouteRuntimeExecutionAttempt: CompiledRuntimeExecutionModule['selectRouteRuntimeExecutionAttempt'];
  let resolveRouteRuntimeSyntheticResponse: CompiledRuntimeExecutionModule['resolveRouteRuntimeSyntheticResponse'];
  let createRouteRuntimeDecisionSession: CompiledRuntimeExecutionModule['createRouteRuntimeDecisionSession'];
  let selectRouteRuntimeDecisionInSession: CompiledRuntimeExecutionModule['selectRouteRuntimeDecisionInSession'];
  let buildRouteRuntimeProjectionResult: CompiledRuntimeExecutionModule['buildRouteRuntimeProjection'];
  let recordRouteRuntimeExecutionAttemptStarted: CompiledRuntimeExecutionModule['recordRouteRuntimeExecutionAttemptStarted'];
  let recordRouteRuntimeExecutionAttemptSuccess: CompiledRuntimeExecutionModule['recordRouteRuntimeExecutionAttemptSuccess'];
  let recordRouteRuntimeExecutionAttemptFailure: CompiledRuntimeExecutionModule['recordRouteRuntimeExecutionAttemptFailure'];
  let markRouteRuntimeExecutionTargetRecovered: CompiledRuntimeExecutionModule['markRouteRuntimeExecutionTargetRecovered'];
  let clearRouteRuntimeExecutionAttemptFailureState: CompiledRuntimeExecutionModule['clearRouteRuntimeExecutionAttemptFailureState'];
  let invalidateRouteGraphReadCaches: RouteGraphServiceModule['invalidateRouteGraphReadCaches'];
  let saveRouteGraphDraft: RouteGraphServiceModule['saveRouteGraphDraft'];
  let publishRouteGraphDraft: RouteGraphServiceModule['publishRouteGraphDraft'];
  let invalidateRouteRuntimeArtifactReadCaches: RouteRuntimeArtifactModule['invalidateRouteRuntimeArtifactReadCaches'];
  let recordSiteCatalogMutation: SiteCatalogMutationModule['recordSiteCatalogMutation'];

  beforeAll(async () => {
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'metapi-compiled-runtime-execution-'));
    const migrate = await import('../db/migrate.js');
    await migrate.runSqliteMigrations();
    const dbModule = await import('../db/index.js');
    const compiledRuntimeExecution = await import('./routeRuntimeExecutionService.js');
    const routeGraphService = await import('./routeGraphService.js');
    const routeRuntimeArtifact = await import('./routeRuntimeArtifactService.js');
    const siteCatalogMutation = await import('./siteCatalogMutationService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    selectRouteRuntimeExecutionAttempt = compiledRuntimeExecution.selectRouteRuntimeExecutionAttempt;
    resolveRouteRuntimeSyntheticResponse = compiledRuntimeExecution.resolveRouteRuntimeSyntheticResponse;
    createRouteRuntimeDecisionSession = compiledRuntimeExecution.createRouteRuntimeDecisionSession;
    selectRouteRuntimeDecisionInSession = compiledRuntimeExecution.selectRouteRuntimeDecisionInSession;
    buildRouteRuntimeProjectionResult = compiledRuntimeExecution.buildRouteRuntimeProjection;
    recordRouteRuntimeExecutionAttemptStarted = compiledRuntimeExecution.recordRouteRuntimeExecutionAttemptStarted;
    recordRouteRuntimeExecutionAttemptSuccess = compiledRuntimeExecution.recordRouteRuntimeExecutionAttemptSuccess;
    recordRouteRuntimeExecutionAttemptFailure = compiledRuntimeExecution.recordRouteRuntimeExecutionAttemptFailure;
    markRouteRuntimeExecutionTargetRecovered = compiledRuntimeExecution.markRouteRuntimeExecutionTargetRecovered;
    clearRouteRuntimeExecutionAttemptFailureState = compiledRuntimeExecution.clearRouteRuntimeExecutionAttemptFailureState;
    invalidateRouteGraphReadCaches = routeGraphService.invalidateRouteGraphReadCaches;
    saveRouteGraphDraft = routeGraphService.saveRouteGraphDraft;
    publishRouteGraphDraft = routeGraphService.publishRouteGraphDraft;
    invalidateRouteRuntimeArtifactReadCaches = routeRuntimeArtifact.invalidateRouteRuntimeArtifactReadCaches;
    recordSiteCatalogMutation = siteCatalogMutation.recordSiteCatalogMutation;
  }, 60_000);

  beforeEach(async () => {
    resetGraphNativeRouteFixtures();
    await db.delete(schema.compiledRuntimeActiveArtifact).run();
    await db.delete(schema.compiledRuntimeArtifacts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphVersions).run();
    await clearRouteGroupMemberTestData();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
    invalidateRouteGraphReadCaches();
    resetProxyTargetCoordinatorState();
  });

  afterAll(() => {
    resetGraphNativeRouteFixtures();
    invalidateRouteGraphReadCaches?.();
    delete process.env.DATA_DIR;
  });

  async function seedRoute(input: {
    model: string;
    dispatcherPolicy?: RouteGroupCreatePayload['dispatcherPolicy'];
    candidates?: Array<{
      siteName: string;
      siteStatus?: string;
      sourceModel?: string;
      weight?: number;
      fallbackStageOrder?: number;
      withoutToken?: boolean;
    }>;
    affinity?: RouteGroupCreatePayload['affinity'];
  }) {
    const route = await createGraphNativeRouteFixture({
      modelPattern: input.model,
      displayName: input.model,
      dispatcherPolicy: input.dispatcherPolicy || { kind: 'builtin', builtin: 'weighted' },
    });
    const candidates = [];
    for (const candidateInput of input.candidates || [{ siteName: `${input.model}-site` }]) {
      const site = await db.insert(schema.sites).values({
        name: candidateInput.siteName,
        url: `https://${candidateInput.siteName}.example.com`,
        platform: 'new-api',
        status: candidateInput.siteStatus || 'active',
      }).returning().get();
      const account = await db.insert(schema.accounts).values({
        siteId: site.id,
        username: `${candidateInput.siteName}-user`,
        credential: `${candidateInput.siteName}-access`,

        status: 'active',
      }).returning().get();
      const token = candidateInput.withoutToken
        ? null
        : await db.insert(schema.accountTokens).values({
          accountId: account.id,
          name: `${candidateInput.siteName}-token`,
          token: `${candidateInput.siteName}-token-value`,
          enabled: true,
          isDefault: true,
        }).returning().get();
      const candidate = await insertRouteGroupMember({
        groupId: route.id,
        accountId: account.id,
        tokenId: token?.id ?? null,
        sourceModel: candidateInput.sourceModel ?? input.model,
        fallbackStageOrder: candidateInput.fallbackStageOrder ?? 0,
        weight: candidateInput.weight ?? 10,
        enabled: true,
      });
      const executionTargetId = await getExecutionTargetIdForMember(candidate.id);
      if (!executionTargetId) throw new Error(`Failed to resolve execution target for candidate ${candidate.id}`);
      candidates.push({
        site,
        account,
        token,
        candidate,
        executionTargetId,
      });
    }
    if (input.affinity) {
      const sourceRefs = await Promise.all(candidates.map(async (candidate) => (
        await db.select({ sourceRef: schema.runtimeExecutionTargets.sourceRef })
          .from(schema.runtimeExecutionTargets)
          .where(eq(schema.runtimeExecutionTargets.id, candidate.executionTargetId))
          .get()
      )));
      const { updateRouteGroupFromPayload } = await import('./routeGroupManagementService.js');
      const refs = sourceRefs.map((item) => item?.sourceRef).filter((item): item is string => !!item);
      await updateRouteGroupFromPayload(route.id, {
        affinity: {
          ...input.affinity,
          pools: input.affinity.pools?.map((pool) => ({
            ...pool,
            members: pool.members.map((member) => ({
              ...member,
              sourceRef: refs[Number(member.sourceRef)] || member.sourceRef,
            })),
          })),
        },
      });
    }
    const version = await publishCurrentGraphNativeRouteFixtures();
    const runtimePointer = await db.select().from(schema.compiledRuntimeActiveArtifact).get();
    if (!runtimePointer) throw new Error('Published test route is missing an active runtime artifact');
    invalidateRouteGraphReadCaches();
    const bundle = version.compiledGraph.compiledRouterBundle;
    if (!bundle) throw new Error('Published test route is missing a compiled runtime bundle');
    const attempts = bundle.plans.flatMap((storedPlan) => (
      getCompiledRouterPlanById(bundle, storedPlan.id)?.executionAlternatives || []
    )).flatMap((alternative) => alternative.executionAttempt ? [alternative.executionAttempt] : []);
    return {
      route,
      candidates: candidates.map((candidate) => {
        const attempt = attempts.find(
          (item) => item.transportBinding?.executionTargetId === candidate.executionTargetId,
        );
        if (!attempt?.executionAttemptId) {
          throw new Error(`Compiler did not issue an attempt identity for target ${candidate.executionTargetId}`);
        }
        return { ...candidate, executionAttemptId: attempt.executionAttemptId };
      }),
      version,
      runtimeArtifactId: runtimePointer.artifactId,
    };
  }

  it('persists round-robin selector state across production selections', async () => {
    const { candidates } = await seedRoute({
      model: 'runtime-round-robin',
      dispatcherPolicy: { kind: 'builtin', builtin: 'round_robin' },
      candidates: [{ siteName: 'rr-a' }, { siteName: 'rr-b' }],
    });
    const first = await selectRouteRuntimeExecutionAttempt({ requestedModel: 'runtime-round-robin' });
    const second = await selectRouteRuntimeExecutionAttempt({ requestedModel: 'runtime-round-robin' });
    expect(new Set([first?.executionTargetId, second?.executionTargetId])).toEqual(new Set(candidates.map((item) => item.executionTargetId)));
  });

  it('does not route a New API session connection without a model API key', async () => {
    const seeded = await seedRoute({
      model: 'runtime-new-api-session-without-model-key',
      candidates: [{
        siteName: 'new-api-session-only',
        withoutToken: true,
      }],
    });

    await expect(selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-new-api-session-without-model-key',
    })).resolves.toBeNull();

    const session = await createRouteRuntimeDecisionSession({
      requestedModel: 'runtime-new-api-session-without-model-key',
    });
    await expect(selectRouteRuntimeDecisionInSession(session)).resolves.toMatchObject({
      kind: 'unavailable',
      routeEntrypointId: expect.any(String),
      runtimeArtifactId: seeded.runtimeArtifactId,
      routeRuntimeSnapshot: {
        endpoint: null,
        executionAttempt: null,
        decision: {
          unavailable: {
            reason: 'execution_attempts_exhausted',
            rejectedAttempts: [{
              executionAttemptId: seeded.candidates[0]!.executionAttemptId,
              executionTargetId: seeded.candidates[0]!.executionTargetId,
              reason: 'missing_token',
            }],
          },
        },
      },
    });
  });

  it('returns request-level evidence when no compiled route matches the requested model', async () => {
    await seedRoute({ model: 'runtime-known-model' });
    const session = await createRouteRuntimeDecisionSession({ requestedModel: 'runtime-unknown-model' });

    await expect(selectRouteRuntimeDecisionInSession(session)).resolves.toMatchObject({
      kind: 'unavailable',
      routeEntrypointId: null,
      routeRuntimeSnapshot: {
        match: {
          requestedModel: 'runtime-unknown-model',
          planId: null,
          entryId: null,
        },
        decision: {
          unavailable: {
            reason: 'no_matching_route',
            rejectedAttempts: [],
          },
        },
      },
    });
    await expect(selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-unknown-model',
    })).resolves.toBeNull();
  });

  it('returns request-level evidence when no active runtime artifact exists', async () => {
    const session = await createRouteRuntimeDecisionSession({ requestedModel: 'runtime-without-artifact' });

    await expect(selectRouteRuntimeDecisionInSession(session)).resolves.toMatchObject({
      kind: 'unavailable',
      routeEntrypointId: null,
      runtimeArtifactId: null,
      routeRuntimeSnapshot: {
        decision: {
          unavailable: {
            reason: 'no_active_runtime',
            rejectedAttempts: [],
          },
        },
        endpoint: null,
        executionAttempt: null,
      },
    });
  });

  it('uses the account token value rather than the session connection credential', async () => {
    const { candidates } = await seedRoute({
      model: 'runtime-session-with-model-key',
      candidates: [{ siteName: 'new-api-session-with-key' }],
    });

    const selected = await selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-session-with-model-key',
    });

    expect(selected).toMatchObject({
      executionTargetId: candidates[0]!.executionTargetId,
      token: { id: candidates[0]!.token!.id },
      tokenValue: 'new-api-session-with-key-token-value',
    });
    expect(selected?.tokenValue).not.toBe('new-api-session-with-key-access');
  });

  it('uses edited site connection settings on the next dispatch', async () => {
    const { candidates } = await seedRoute({
      model: 'runtime-site-mutation',
      candidates: [{ siteName: 'runtime-site-mutation-site' }],
    });
    const candidate = candidates[0]!;

    await expect(selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-site-mutation',
    })).resolves.toMatchObject({
      site: { url: 'https://runtime-site-mutation-site.example.com' },
    });

    await db.update(schema.sites)
      .set({
        url: 'https://runtime-site-mutation-updated.example.com',
        customHeaders: JSON.stringify({ 'x-runtime-site': 'updated' }),
      })
      .where(eq(schema.sites.id, candidate.site.id))
      .run();
    await recordSiteCatalogMutation();

    await expect(selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-site-mutation',
    })).resolves.toMatchObject({
      site: {
        url: 'https://runtime-site-mutation-updated.example.com',
        customHeaders: JSON.stringify({ 'x-runtime-site': 'updated' }),
      },
    });
  });

  it('does not route a stale token bound to an OAuth account', async () => {
    const { candidates } = await seedRoute({
      model: 'runtime-oauth-with-legacy-token',
      candidates: [{ siteName: 'oauth-legacy-token' }],
    });
    await db.update(schema.accounts)
      .set({
        oauthProvider: 'codex',
        extraConfig: JSON.stringify({ oauth: { provider: 'codex' } }),
      })
      .where(eq(schema.accounts.id, candidates[0]!.account.id))
      .run();
    invalidateRouteGraphReadCaches('account-mutated');

    await expect(selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-oauth-with-legacy-token',
    })).resolves.toBeNull();
  });

  it('resolves a published synthetic route terminal through the runtime service', async () => {
    const saved = await saveRouteGraphDraft({
      nodes: [
        {
          id: 'entry.synthetic-runtime',
          type: 'entry',
          enabled: true,
          ownership: 'manual',
          match: { requestedModelPattern: 'synthetic-runtime-model' },
        },
        {
          id: 'terminal.synthetic-runtime',
          type: 'synthetic_endpoint',
          enabled: true,
          ownership: 'manual',
          statusCode: 429,
          message: 'Runtime synthetic fallback',
        },
      ],
      edges: [{
        id: 'entry-synthetic-runtime',
        sourceNodeId: 'entry.synthetic-runtime',
        sourcePortId: 'bidirect.out',
        targetNodeId: 'terminal.synthetic-runtime',
        targetPortId: 'bidirect.in',
        kind: 'bidirect_flow',
        ownership: 'manual',
      }],
      macros: [],
    });
    expect(saved.status).toBe('active');
    const published = await publishRouteGraphDraft();
    expect(published.ok).toBe(true);

    await expect(resolveRouteRuntimeSyntheticResponse({
      requestedModel: 'synthetic-runtime-model',
    })).resolves.toMatchObject({
      statusCode: 429,
      message: 'Runtime synthetic fallback',
      terminalNodeId: 'terminal.synthetic-runtime',
      terminalKind: 'synthetic_response',
    });
  });

  it('uses CEL from the published runtime artifact to select an execution target', async () => {
    const { candidates } = await seedRoute({
      model: 'runtime-cel-selection',
      dispatcherPolicy: {
        kind: 'inline',
        policy: {
          id: 'runtime-cel-selection',
          name: 'Runtime CEL selection',
          kind: 'cel',
          selectionMode: 'direct',
          selectExpression: 'size(request.payload) > 0 ? 1 : 0',
        },
      },
      candidates: [{ siteName: 'runtime-cel-a' }, { siteName: 'runtime-cel-b' }],
    });

    const selected = await selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-cel-selection',
      request: { requestedModel: 'runtime-cel-selection', payload: { tier: 'pro' } },
    });

    expect(selected?.executionTargetId).toBe(candidates[1]?.executionTargetId);
    expect(selected?.routeRuntimeSnapshot.decision?.selectedAlternativeId).toBeTruthy();
    expect(selected?.routeRuntimeSnapshot.decision?.selectors.length).toBeGreaterThan(0);
    expect(selected?.routeRuntimeSnapshot.decision?.selectors[0]?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        choiceId: expect.any(String),
        targets: expect.arrayContaining([
          expect.objectContaining({
            executionTargetId: candidates[1]!.executionTargetId,
            executionAttemptId: candidates[1]!.executionAttemptId,
            upstreamModel: 'runtime-cel-selection',
            credential: expect.objectContaining({
              site: expect.objectContaining({ name: 'runtime-cel-b' }),
              account: expect.objectContaining({ id: candidates[1]!.account.id }),
              token: expect.objectContaining({ id: candidates[1]!.token!.id }),
            }),
          }),
        ]),
        enabled: true,
        eligible: true,
        selected: true,
        weight: expect.any(Number),
        contribution: expect.any(Number),
        order: expect.any(Number),
        score: expect.any(Number),
      }),
    ]));
  });

  it('does not let read-only projections advance production round-robin state', async () => {
    await seedRoute({
      model: 'runtime-round-robin-projection',
      dispatcherPolicy: { kind: 'builtin', builtin: 'round_robin' },
      candidates: [{ siteName: 'rr-projection-a' }, { siteName: 'rr-projection-b' }],
    });
    const baseline = await selectRouteRuntimeExecutionAttempt({ requestedModel: 'runtime-round-robin-projection' });
    invalidateRouteRuntimeArtifactReadCaches();

    await buildRouteRuntimeProjectionResult({ requestedModel: 'runtime-round-robin-projection' });
    await buildRouteRuntimeProjectionResult({ requestedModel: 'runtime-round-robin-projection' });
    const afterProjections = await selectRouteRuntimeExecutionAttempt({ requestedModel: 'runtime-round-robin-projection' });

    expect(afterProjections?.executionTargetId).toBe(baseline?.executionTargetId);
  });

  it('pins one compiled artifact for the complete request decision session', async () => {
    const firstPublication = await seedRoute({ model: 'runtime-session-artifact' });
    const session = await createRouteRuntimeDecisionSession({
      requestedModel: 'runtime-session-artifact',
    });

    await createGraphNativeRouteFixture({
      modelPattern: 'runtime-session-second-route',
      displayName: 'runtime-session-second-route',
      dispatcherPolicy: { kind: 'builtin', builtin: 'weighted' },
    });
    await publishCurrentGraphNativeRouteFixtures();
    invalidateRouteRuntimeArtifactReadCaches();
    const activePointer = await db.select().from(schema.compiledRuntimeActiveArtifact).get();
    expect(activePointer?.artifactId).toBeTruthy();
    expect(activePointer?.artifactId).not.toBe(firstPublication.runtimeArtifactId);

    const sessionDecision = await selectRouteRuntimeDecisionInSession(session);
    const freshDecision = await selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-session-artifact',
    });

    expect(sessionDecision?.kind).toBe('execution_attempt');
    if (sessionDecision?.kind !== 'execution_attempt') throw new Error('Expected an execution attempt');
    expect(sessionDecision.attempt.runtimeArtifactId).toBe(firstPublication.runtimeArtifactId);
    expect(freshDecision?.runtimeArtifactId).toBe(activePointer?.artifactId);
  });

  it('keeps Entry Pool primary during temporary fallback and fails back after recovery', async () => {
    const { candidates } = await seedRoute({
      model: 'runtime-affinity-temporary',
      candidates: [{ siteName: 'affinity-primary', weight: 100 }, { siteName: 'affinity-fallback', weight: 1 }],
      affinity: {
        policy: { kind: 'pool', ttlSec: 300, crossPoolFallback: 'temporary' },
        pools: [{ id: 'primary', members: [{ kind: 'execution_target', sourceRef: '0' }] }],
      },
    });
    const key = 'key:test|generic|openai.chat_completions|runtime-affinity-temporary|session-1';
    const firstSession = await createRouteRuntimeDecisionSession({ requestedModel: 'runtime-affinity-temporary', affinityKey: key });
    const first = await selectRouteRuntimeDecisionInSession(firstSession);
    expect(first?.kind).toBe('execution_attempt');
    if (first?.kind !== 'execution_attempt' || !first.attempt.affinity) throw new Error('Expected initial affinity decision');
    expect(first.attempt.executionTargetId).toBe(candidates[0]!.executionTargetId);
    proxyTargetCoordinator.recordSuccessfulAffinitySelection(first.attempt.affinity);

    const fallbackSession = await createRouteRuntimeDecisionSession({ requestedModel: 'runtime-affinity-temporary', affinityKey: key });
    const fallback = await selectRouteRuntimeDecisionInSession(fallbackSession, {
      disabledExecutionTargetIds: [candidates[0]!.executionTargetId],
    });
    expect(fallback?.kind).toBe('execution_attempt');
    if (fallback?.kind !== 'execution_attempt' || !fallback.attempt.affinity) throw new Error('Expected temporary fallback');
    expect(fallback.attempt.executionTargetId).toBe(candidates[1]!.executionTargetId);
    expect(fallback.attempt.affinity.fallback).toBe(true);
    proxyTargetCoordinator.recordSuccessfulAffinitySelection(fallback.attempt.affinity);

    const recoveredSession = await createRouteRuntimeDecisionSession({ requestedModel: 'runtime-affinity-temporary', affinityKey: key });
    const recovered = await selectRouteRuntimeDecisionInSession(recoveredSession);
    expect(recovered?.kind).toBe('execution_attempt');
    if (recovered?.kind !== 'execution_attempt') throw new Error('Expected recovered primary');
    expect(recovered.attempt.executionTargetId).toBe(candidates[0]!.executionTargetId);
  });

  it('promotes a successful cross-pool fallback only after completion', async () => {
    const { candidates } = await seedRoute({
      model: 'runtime-affinity-promote',
      candidates: [{ siteName: 'promote-primary', weight: 100 }, { siteName: 'promote-fallback', weight: 1 }],
      affinity: {
        policy: { kind: 'pool', ttlSec: 300, crossPoolFallback: 'promote_on_success' },
        pools: [{ id: 'primary', members: [{ kind: 'execution_target', sourceRef: '0' }] }],
      },
    });
    const key = 'key:test|generic|openai.chat_completions|runtime-affinity-promote|session-1';
    const initial = await createRouteRuntimeDecisionSession({ requestedModel: 'runtime-affinity-promote', affinityKey: key });
    const initialDecision = await selectRouteRuntimeDecisionInSession(initial);
    if (initialDecision?.kind !== 'execution_attempt' || !initialDecision.attempt.affinity) throw new Error('Expected initial decision');
    proxyTargetCoordinator.recordSuccessfulAffinitySelection(initialDecision.attempt.affinity);
    const fallbackSession = await createRouteRuntimeDecisionSession({ requestedModel: 'runtime-affinity-promote', affinityKey: key });
    const fallback = await selectRouteRuntimeDecisionInSession(fallbackSession, { disabledExecutionTargetIds: [candidates[0]!.executionTargetId] });
    if (fallback?.kind !== 'execution_attempt' || !fallback.attempt.affinity) throw new Error('Expected promotion fallback');
    proxyTargetCoordinator.recordSuccessfulAffinitySelection(fallback.attempt.affinity);
    const promoted = proxyTargetCoordinator.getAffinityBinding(key);
    expect(promoted).toMatchObject({ scope: 'pool' });
    if (promoted?.scope !== 'pool') throw new Error('Expected pool binding');
    expect(promoted.primaryPoolId).not.toBe('primary');
  });

  it('records concurrent success counters atomically', async () => {
    const { candidates } = await seedRoute({ model: 'runtime-concurrent-success' });
    const executionTargetId = candidates[0]!.executionTargetId;
    await Promise.all(Array.from({ length: 20 }, () => recordRouteRuntimeExecutionAttemptSuccess({
      executionTargetId,
      latencyMs: 25,
    })));
    const state = await db.select().from(schema.runtimeExecutionTargetState)
      .where(eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId)).get();
    expect(state).toMatchObject({ successCount: 20, totalLatencyMs: 500, latencySampleCount: 20 });
  });

  it('clears cooldown after a recovery probe without fabricating traffic metrics', async () => {
    const { candidates } = await seedRoute({ model: 'runtime-recovery-probe' });
    const executionTargetId = candidates[0]!.executionTargetId;
    await recordRouteRuntimeExecutionAttemptSuccess({ executionTargetId, latencyMs: 120 });
    await recordRouteRuntimeExecutionAttemptSuccess({ executionTargetId, latencyMs: 180 });
    await recordRouteRuntimeExecutionAttemptFailure({ executionTargetId });
    await recordRouteRuntimeExecutionAttemptFailure({ executionTargetId });
    await recordRouteRuntimeExecutionAttemptFailure({ executionTargetId });

    await markRouteRuntimeExecutionTargetRecovered(executionTargetId);

    const state = await db.select().from(schema.runtimeExecutionTargetState)
      .where(eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId)).get();
    expect(state).toMatchObject({
      successCount: 2,
      failCount: 3,
      totalLatencyMs: 300,
      latencySampleCount: 2,
      consecutiveFailCount: 0,
      cooldownLevel: 0,
      cooldownUntil: null,
    });
  });

  it('advances cooldown only after consecutive failures and resets the streak on success', async () => {
    const { candidates } = await seedRoute({ model: 'runtime-failure-state' });
    const executionTargetId = candidates[0]!.executionTargetId;
    await recordRouteRuntimeExecutionAttemptFailure({ executionTargetId });
    await recordRouteRuntimeExecutionAttemptFailure({ executionTargetId });
    let state = await db.select().from(schema.runtimeExecutionTargetState)
      .where(eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId)).get();
    expect(state).toMatchObject({ failCount: 2, consecutiveFailCount: 2, cooldownLevel: 0 });

    await recordRouteRuntimeExecutionAttemptFailure({ executionTargetId });
    state = await db.select().from(schema.runtimeExecutionTargetState)
      .where(eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId)).get();
    expect(state).toMatchObject({ failCount: 3, consecutiveFailCount: 0, cooldownLevel: 1 });

    await recordRouteRuntimeExecutionAttemptFailure({ executionTargetId });
    await recordRouteRuntimeExecutionAttemptSuccess({ executionTargetId, latencyMs: 1 });
    state = await db.select().from(schema.runtimeExecutionTargetState)
      .where(eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId)).get();
    expect(state).toMatchObject({ failCount: 4, consecutiveFailCount: 0, cooldownLevel: 0, cooldownUntil: null });
  });

  it('exhausts unavailable targets without an arbitrary candidate limit', async () => {
    const candidates = Array.from({ length: 21 }, (_, index) => ({
      siteName: `runtime-exhaustion-${index}`,
      siteStatus: index < 20 ? 'disabled' : 'active',
    }));
    const seeded = await seedRoute({ model: 'runtime-exhaustion', candidates });
    const selected = await selectRouteRuntimeExecutionAttempt({ requestedModel: 'runtime-exhaustion' });
    expect(selected?.executionTargetId).toBe(seeded.candidates[20].executionTargetId);
  });

  it('commits one round-robin transition only after an available target is accepted', async () => {
    const seeded = await seedRoute({
      model: 'runtime-unavailable-round-robin',
      dispatcherPolicy: { kind: 'builtin', builtin: 'round_robin' },
      candidates: [
        { siteName: 'runtime-unavailable-first', siteStatus: 'disabled' },
        { siteName: 'runtime-available-second' },
      ],
    });

    const selected = await selectRouteRuntimeExecutionAttempt({ requestedModel: 'runtime-unavailable-round-robin' });

    expect(selected?.executionTargetId).toBe(seeded.candidates[1].executionTargetId);
    expect(Object.values(getRouteRuntimeSelectorStateStore(seeded.runtimeArtifactId))).toEqual([1]);
  });

  async function removeCompiledFixedAttemptModel(input: {
    runtimeArtifactId: string;
    executionTargetId: number;
  }) {
    const row = await db.select({
      artifactJson: schema.compiledRuntimeArtifacts.artifactJson,
    }).from(schema.compiledRuntimeArtifacts)
      .where(eq(schema.compiledRuntimeArtifacts.id, input.runtimeArtifactId))
      .get();
    if (!row?.artifactJson) throw new Error('Missing compiled runtime fixture');
    const artifact = JSON.parse(row.artifactJson) as {
      compiledRouterBundle?: import('../../shared/compiledRuntime.js').CompiledRouterBundle;
    };
    const bundle = artifact.compiledRouterBundle;
    if (!bundle) throw new Error('Missing compiled runtime bundle fixture');
    const plans = bundle.plans.map((storedPlan) => getCompiledRouterPlanById(bundle, storedPlan.id) || storedPlan);
    const attempt = plans.flatMap((plan) => plan.executionAlternatives || [])
      .map((alternative) => alternative.executionAttempt)
      .find((target) => target?.transportBinding?.executionTargetId === input.executionTargetId);
    if (!attempt) throw new Error(`Missing packed execution attempt for target ${input.executionTargetId}`);
    attempt.model = '';
    const { executionTable: _executionTable, ...expandedBundle } = bundle;
    artifact.compiledRouterBundle = compactCompiledRouterBundle({ ...expandedBundle, plans });
    await db.update(schema.compiledRuntimeArtifacts)
      .set({ artifactJson: JSON.stringify(artifact) })
      .where(eq(schema.compiledRuntimeArtifacts.id, input.runtimeArtifactId))
      .run();
    invalidateRouteRuntimeArtifactReadCaches();
    invalidateRouteGraphReadCaches();
  }

  it('selects execution attempts from compiled transport bindings', async () => {
    const { candidates, runtimeArtifactId } = await seedRoute({ model: 'runtime-metadata-model' });

    const selected = await selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-metadata-model',
    });
    const projection = await buildRouteRuntimeProjectionResult({
      requestedModel: 'runtime-metadata-model',
    });

    expect(selected).toMatchObject({
      executionAttemptId: candidates[0].executionAttemptId,
      runtimeArtifactId,
      executionTargetId: candidates[0].executionTargetId,
      actualModel: 'runtime-metadata-model',
    });
    expect(selected?.routeEntrypointId).toBe(projection.runtime?.match.entryNodeId);
    expect(selected?.routeEntrypointId).not.toBe(selected?.runtimeEndpointId);
    expect(projection.runtime?.selected.executionAttemptId).toBe(candidates[0].executionAttemptId);
    expect(selected?.routeRuntimeSnapshot).toMatchObject({
      compiledRuntime: {
        runtimeArtifactId,
      },
      match: {
        requestedModel: 'runtime-metadata-model',
        actualModel: 'runtime-metadata-model',
        planId: projection.runtime?.match.planId,
        entryId: projection.runtime?.match.entryNodeId,
        publicModelName: 'runtime-metadata-model',
        terminalKind: 'endpoint',
      },
      endpoint: {
        endpointId: selected?.runtimeEndpointId,
        executionTargetId: candidates[0].executionTargetId,
      },
      executionAttempt: {
        executionAttemptId: candidates[0].executionAttemptId,
        executionTargetId: candidates[0].executionTargetId,
        accountId: candidates[0].account.id,
        tokenId: candidates[0].token.id,
        siteId: candidates[0].site.id,
      },
    });
    expect(selected?.routeRuntimeSnapshot.compiledRuntime.bundleHash).toBeTruthy();
    expect(selected?.routeRuntimeSnapshot.metadata.executionAttempt).not.toHaveProperty('executionTargetId');
  });

  it('records selected fallback stages in the immutable decision snapshot', async () => {
    const { candidates } = await seedRoute({
      model: 'runtime-fallback-snapshot',
      candidates: [
        { siteName: 'fallback-stage-primary', siteStatus: 'disabled', fallbackStageOrder: 0 },
        { siteName: 'fallback-stage-secondary', fallbackStageOrder: 1 },
      ],
    });

    const selected = await selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-fallback-snapshot',
    });

    expect(selected?.executionTargetId).toBe(candidates[1]!.executionTargetId);
    expect(selected?.routeRuntimeSnapshot.decision?.fallbackStages).toEqual([
      expect.objectContaining({ stageIndex: 1 }),
    ]);
  });

  it('does not record selection state until a real upstream execution starts', async () => {
    const { candidates } = await seedRoute({ model: 'runtime-execution-start-model' });
    const executionTargetId = candidates[0]!.executionTargetId;

    const selected = await selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-execution-start-model',
    });
    const stateAfterSelection = await db.select().from(schema.runtimeExecutionTargetState)
      .where(eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId))
      .get();

    expect(selected?.executionTargetId).toBe(executionTargetId);
    expect(stateAfterSelection?.lastSelectedAt ?? null).toBeNull();

    await recordRouteRuntimeExecutionAttemptStarted({ executionTargetId });
    const stateAfterExecutionStart = await db.select().from(schema.runtimeExecutionTargetState)
      .where(eq(schema.runtimeExecutionTargetState.executionTargetId, executionTargetId))
      .get();

    expect(stateAfterExecutionStart?.lastSelectedAt).toBeTruthy();
  });

  it('does not derive a fixed execution attempt model from the supply endpoint row', async () => {
    const { candidates, runtimeArtifactId } = await seedRoute({
      model: 'runtime-missing-fixed-model',
      candidates: [{
        siteName: 'runtime-missing-fixed-model-site',
        sourceModel: 'runtime-upstream-from-supply-row',
      }],
    });
    await removeCompiledFixedAttemptModel({
      runtimeArtifactId,
      executionTargetId: candidates[0].executionTargetId,
    });

    await expect(selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-missing-fixed-model',
    })).rejects.toThrow('execution_attempt_invalid');
  });

  it('honors disabled execution target overlays during compiled runtime selection', async () => {
    const { candidates } = await seedRoute({
      model: 'runtime-overlay-model',
      candidates: [
        { siteName: 'runtime-overlay-a', weight: 100 },
        { siteName: 'runtime-overlay-b', weight: 1 },
      ],
    });

    const selected = await selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-overlay-model',
      disabledExecutionTargetIds: [candidates[0].executionTargetId],
    });

    expect(selected?.executionTargetId).toBe(candidates[1].executionTargetId);
    expect(selected?.routeExecutionScope?.failureOverlay.disabledExecutionTargetIds).toEqual([candidates[0].executionTargetId]);
  });

  it('uses forced and sticky execution attempts without exposing source graph targets', async () => {
    const { candidates } = await seedRoute({
      model: 'runtime-forced-model',
      candidates: [
        { siteName: 'runtime-forced-a', sourceModel: 'runtime-forced-upstream-a', weight: 100 },
        { siteName: 'runtime-forced-b', sourceModel: 'runtime-forced-upstream-b', weight: 1 },
      ],
    });

    const forced = await selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-forced-model',
      forcedExecutionAttemptId: candidates[1].executionAttemptId,
    });
    const sticky = await selectRouteRuntimeExecutionAttempt({
      requestedModel: 'runtime-forced-model',
      retryCount: 0,
      stickyExecutionTargetId: candidates[1].executionTargetId,
    });
    const projection = await buildRouteRuntimeProjectionResult({
      requestedModel: 'runtime-forced-model',
      forcedExecutionAttemptId: candidates[1].executionAttemptId,
    });

    expect(forced?.executionAttemptId).toBe(candidates[1].executionAttemptId);
    expect(forced?.executionTargetId).toBe(candidates[1].executionTargetId);
    expect(forced?.actualModel).toBe('runtime-forced-upstream-b');
    expect(forced?.runtimeEndpointId).toBe(projection.runtime?.selected.endpointId);
    expect(sticky?.executionAttemptId).toBe(candidates[1].executionAttemptId);
    expect(sticky?.executionTargetId).toBe(candidates[1].executionTargetId);
    expect(sticky?.actualModel).toBe('runtime-forced-upstream-b');
    expect(sticky?.runtimeEndpointId).toBe(projection.runtime?.selected.endpointId);
    expect(projection.selection?.selectedExecutionAttempt?.metadata).not.toHaveProperty('executionTargetId');
    expect(projection.selection?.selectedExecutionAttempt?.transportBinding).toEqual({
      kind: 'execution_target',
      executionTargetId: candidates[1].executionTargetId,
    });
    expect(projection.selection?.currentModel).toBe('runtime-forced-model');
    expect(projection.runtime?.selected.executionAttemptId).toBe(candidates[1].executionAttemptId);
    expect(projection.runtime?.selected.actualModel).toBe('runtime-forced-upstream-b');
  });

  it('clears runtime execution target failure state directly', async () => {
    const { candidates } = await seedRoute({ model: 'runtime-clear-state-model' });
    await recordRouteRuntimeExecutionAttemptFailure({
      executionTargetId: candidates[0].executionTargetId,
      status: 502,
      errorText: 'upstream failed',
      failureBackoff: { mode: 'custom', policy: { failureThreshold: 1, levelsSec: [0, 1], maxSec: 1 } },
    });
    const failedState = await db.select().from(schema.runtimeExecutionTargetState)
      .where(eq(schema.runtimeExecutionTargetState.executionTargetId, candidates[0].executionTargetId))
      .get();
    expect(failedState?.failCount).toBeGreaterThan(0);
    expect(failedState?.cooldownUntil).toBeTruthy();

    await expect(clearRouteRuntimeExecutionAttemptFailureState([candidates[0].executionTargetId])).resolves.toBe(1);
    const clearedState = await db.select().from(schema.runtimeExecutionTargetState)
      .where(eq(schema.runtimeExecutionTargetState.executionTargetId, candidates[0].executionTargetId))
      .get();
    expect(clearedState).toMatchObject({
      failCount: 0,
      cooldownUntil: null,
      lastFailAt: null,
      cooldownLevel: 0,
    });
  });
});
