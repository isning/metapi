import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';

type DbModule = typeof import('../db/index.js');
type ModelServiceModule = typeof import('./modelService.js');
type RouteGraphServiceModule = typeof import('./routeGraphService.js');

describe('rebuildTokenRoutesFromAvailability', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let rebuildTokenRoutesFromAvailability: ModelServiceModule['rebuildTokenRoutesFromAvailability'];
  let publishRouteGraphSource: RouteGraphServiceModule['publishRouteGraphSource'];
  let getActiveRouteGraphVersion: RouteGraphServiceModule['getActiveRouteGraphVersion'];
  let loadRouteGraphRouteTableBindings: RouteGraphServiceModule['loadRouteGraphRouteTableBindings'];
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-model-service-'));
    process.env.DATA_DIR = dataDir;

    await import('../db/migrate.js');
    const dbModule = await import('../db/index.js');
    const modelService = await import('./modelService.js');
    const routeGraphService = await import('./routeGraphService.js');

    db = dbModule.db;
    schema = dbModule.schema;
    rebuildTokenRoutesFromAvailability = modelService.rebuildTokenRoutesFromAvailability;
    publishRouteGraphSource = routeGraphService.publishRouteGraphSource;
    getActiveRouteGraphVersion = routeGraphService.getActiveRouteGraphVersion;
    loadRouteGraphRouteTableBindings = routeGraphService.loadRouteGraphRouteTableBindings;
  });

  beforeEach(async () => {
    await db.delete(schema.routeGraphDrafts).run();
    await db.delete(schema.routeGraphActiveVersion).run();
    await db.delete(schema.routeGraphVersions).run();
    await db.delete(schema.routeGroupCandidates).run();
    await db.delete(schema.routeGroupBuckets).run();
    await db.delete(schema.routeSupplyEndpointState).run();
    await db.delete(schema.routeSupplyEndpoints).run();
    await db.delete(schema.routeGroups).run();
    await db.delete(schema.routeEndpointTargets).run();
    await db.delete(schema.tokenRoutes).run();
    await db.delete(schema.tokenModelAvailability).run();
    await db.delete(schema.modelAvailability).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
  });

  async function findRouteByExposedModel(model: string) {
    const bindings = await loadRouteGraphRouteTableBindings();
    const binding = Array.from(bindings.values()).find((item) => item.modelPattern === model);
    if (!binding) return null;
    return await db.select().from(schema.tokenRoutes)
      .where(eq(schema.tokenRoutes.id, binding.routeId))
      .get();
  }

  it('creates an exact route with an account-direct channel for apikey model availability', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'apikey-site',
      url: 'https://apikey-site.example.com',
      platform: 'new-api',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'apikey-user',
      accessToken: '',
      apiToken: 'sk-apikey-route',
      status: 'active',
      extraConfig: JSON.stringify({ credentialMode: 'apikey' }),
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'gpt-5.2-codex',
      available: true,
      latencyMs: 1200,
      checkedAt: '2026-03-08T08:00:00.000Z',
    }).run();

    const rebuild = await rebuildTokenRoutesFromAvailability();

    expect(rebuild.models).toBe(1);

    const route = await findRouteByExposedModel('gpt-5.2-codex');
    expect(route).toBeDefined();

    const channels = await db.select().from(schema.routeEndpointTargets)
      .where(and(
        eq(schema.routeEndpointTargets.routeId, route!.id),
        eq(schema.routeEndpointTargets.accountId, account.id),
      ))
      .all();

    expect(channels).toHaveLength(1);
    expect(channels[0]?.tokenId ?? null).toBeNull();
    expect(channels[0]?.manualOverride).toBe(false);

    const routeGroup = await db.select().from(schema.routeGroups)
      .where(and(
        eq(schema.routeGroups.kind, 'automatic'),
        eq(schema.routeGroups.groupKey, 'upstream:gpt-5.2-codex'),
      ))
      .get();
    expect(routeGroup).toBeDefined();
    expect(routeGroup?.legacyRouteId).toBe(route!.id);

    const supplyEndpoints = await db.select().from(schema.routeSupplyEndpoints).all();
    expect(supplyEndpoints).toHaveLength(1);
    expect(supplyEndpoints[0]).toMatchObject({
      upstreamModelName: 'gpt-5.2-codex',
      legacyTargetId: channels[0]!.id,
    });

    const candidates = await db.select().from(schema.routeGroupCandidates)
      .where(eq(schema.routeGroupCandidates.groupId, routeGroup!.id))
      .all();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      candidateKind: 'supply_endpoint',
      supplyEndpointId: supplyEndpoints[0]!.id,
    });
  });

  it('ignores hidden account_tokens for direct apikey connections when rebuilding routes', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'apikey-legacy-site',
      url: 'https://apikey-legacy.example.com',
      platform: 'new-api',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'apikey-legacy-user',
      accessToken: '',
      apiToken: 'sk-direct-credential',
      status: 'active',
      extraConfig: JSON.stringify({ credentialMode: 'apikey' }),
    }).returning().get();

    const hiddenToken = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'legacy-hidden',
      token: 'sk-hidden-legacy-token',
      source: 'legacy',
      enabled: true,
      isDefault: true,
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'gpt-4.1',
      available: true,
      latencyMs: 200,
      checkedAt: '2026-03-20T08:00:00.000Z',
    }).run();

    await db.insert(schema.tokenModelAvailability).values({
      tokenId: hiddenToken.id,
      modelName: 'gpt-4.1',
      available: true,
      latencyMs: 180,
      checkedAt: '2026-03-20T08:00:00.000Z',
    }).run();

    const rebuild = await rebuildTokenRoutesFromAvailability();

    expect(rebuild.models).toBe(1);

    const route = await findRouteByExposedModel('gpt-4.1');
    expect(route).toBeDefined();

    const channels = await db.select().from(schema.routeEndpointTargets)
      .where(and(
        eq(schema.routeEndpointTargets.routeId, route!.id),
        eq(schema.routeEndpointTargets.accountId, account.id),
      ))
      .all();

    expect(channels).toHaveLength(1);
    expect(channels[0]?.tokenId ?? null).toBeNull();
  });

  it('creates an exact route with an account-direct channel for oauth model availability', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'codex-site',
      url: 'https://chatgpt.com/backend-api/codex',
      platform: 'codex',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'codex-user@example.com',
      accessToken: 'oauth-access-token',
      apiToken: null,
      status: 'active',
      extraConfig: JSON.stringify({
        credentialMode: 'session',
        oauth: {
          provider: 'codex',
          accountId: 'chatgpt-account-123',
          email: 'codex-user@example.com',
          planType: 'team',
        },
      }),
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'gpt-5.2-codex',
      available: true,
      latencyMs: 320,
      checkedAt: '2026-03-17T00:00:00.000Z',
    }).run();

    const rebuild = await rebuildTokenRoutesFromAvailability();

    expect(rebuild.models).toBe(1);

    const route = await findRouteByExposedModel('gpt-5.2-codex');
    expect(route).toBeDefined();

    const channels = await db.select().from(schema.routeEndpointTargets)
      .where(and(
        eq(schema.routeEndpointTargets.routeId, route!.id),
        eq(schema.routeEndpointTargets.accountId, account.id),
      ))
      .all();

    expect(channels).toHaveLength(1);
    expect(channels[0]?.tokenId ?? null).toBeNull();
    expect(channels[0]?.manualOverride).toBe(false);
  });

  it('creates an exact route with an account-direct channel for oauth accounts stored via structured identity columns', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'codex-site-structured',
      url: 'https://chatgpt.com/backend-api/codex',
      platform: 'codex',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'codex-structured@example.com',
      accessToken: 'oauth-access-token',
      apiToken: null,
      status: 'active',
      oauthProvider: 'codex',
      oauthAccountKey: 'chatgpt-account-structured-123',
      extraConfig: JSON.stringify({
        credentialMode: 'session',
        oauth: {
          email: 'codex-structured@example.com',
          planType: 'team',
        },
      }),
    }).returning().get();

    await db.insert(schema.modelAvailability).values({
      accountId: account.id,
      modelName: 'gpt-5.2-codex',
      available: true,
      latencyMs: 320,
      checkedAt: '2026-04-01T00:00:00.000Z',
    }).run();

    const rebuild = await rebuildTokenRoutesFromAvailability();

    expect(rebuild.models).toBe(1);

    const route = await findRouteByExposedModel('gpt-5.2-codex');
    expect(route).toBeDefined();

    const channels = await db.select().from(schema.routeEndpointTargets)
      .where(and(
        eq(schema.routeEndpointTargets.routeId, route!.id),
        eq(schema.routeEndpointTargets.accountId, account.id),
      ))
      .all();

    expect(channels).toHaveLength(1);
    expect(channels[0]?.tokenId ?? null).toBeNull();
    expect(channels[0]?.manualOverride).toBe(false);
  });

  it('removes stale exact routes and keeps wildcard routes on rebuild', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'site-1',
      url: 'https://site-1.example.com',
      platform: 'new-api',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'user-1',
      accessToken: 'access-1',
      status: 'active',
    }).returning().get();

    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'default',
      token: 'sk-test',
      source: 'manual',
      enabled: true,
      isDefault: true,
    }).returning().get();

    await db.insert(schema.tokenModelAvailability).values({
      tokenId: token.id,
      modelName: 'latest-model',
      available: true,
    }).run();

    const staleRoute = await db.insert(schema.tokenRoutes).values({
      displayName: 'old-model',
      enabled: true,
    }).returning().get();

    await db.insert(schema.routeEndpointTargets).values({
      routeId: staleRoute.id,
      accountId: account.id,
      tokenId: token.id,
      priority: 0,
      weight: 10,
      enabled: true,
      manualOverride: false,
    }).run();

    const wildcardRoute = await db.insert(schema.tokenRoutes).values({
      displayName: 'gpt-*',
      enabled: true,
    }).returning().get();

    await db.insert(schema.routeEndpointTargets).values({
      routeId: wildcardRoute.id,
      accountId: account.id,
      tokenId: token.id,
      priority: 0,
      weight: 10,
      enabled: true,
      manualOverride: false,
    }).run();

    const rebuild = await rebuildTokenRoutesFromAvailability();

    expect(rebuild.models).toBe(1);
    expect(rebuild.removedRoutes).toBe(1);

    const oldRoute = await db.select().from(schema.tokenRoutes).where(eq(schema.tokenRoutes.id, staleRoute.id)).get();
    expect(oldRoute).toBeUndefined();

    const oldChannels = await db.select().from(schema.routeEndpointTargets).where(eq(schema.routeEndpointTargets.routeId, staleRoute.id)).all();
    expect(oldChannels).toHaveLength(0);

    const latestRoute = await findRouteByExposedModel('latest-model');
    expect(latestRoute).toBeDefined();
    const latestChannels = await db.select().from(schema.routeEndpointTargets)
      .where(and(eq(schema.routeEndpointTargets.routeId, latestRoute!.id), eq(schema.routeEndpointTargets.tokenId, token.id)))
      .all();
    expect(latestChannels.length).toBeGreaterThan(0);

    const wildcardRouteAfter = await db.select().from(schema.tokenRoutes).where(eq(schema.tokenRoutes.id, wildcardRoute.id)).get();
    expect(wildcardRouteAfter).toBeDefined();
  });

  it('keeps automatic and manual route groups separate when model names overlap', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'manual-overlap-site',
      url: 'https://manual-overlap.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'overlap-user',
      accessToken: 'access-token',
      status: 'active',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'overlap-token',
      token: 'sk-overlap',
      source: 'manual',
      enabled: true,
      isDefault: true,
    }).returning().get();

    const manualRoute = await db.insert(schema.tokenRoutes).values({
      displayName: 'deepseek-v4-flash-rerouted',
      enabled: true,
    }).returning().get();
    await db.insert(schema.routeGroups).values({
      kind: 'manual',
      groupKey: 'manual:deepseek-v4-flash-rerouted',
      publicModelName: 'deepseek-v4-flash-rerouted',
      displayName: 'deepseek-v4-flash-rerouted',
      visibility: 'public',
      enabled: true,
      routingStrategy: 'weighted',
      sourceMode: 'manual',
      legacyRouteId: manualRoute.id,
      syncStatus: 'active',
    }).run();

    await db.insert(schema.tokenModelAvailability).values({
      tokenId: token.id,
      modelName: 'deepseek-v4-flash',
      available: true,
    }).run();

    await rebuildTokenRoutesFromAvailability();

    const automaticGroup = await db.select().from(schema.routeGroups)
      .where(and(
        eq(schema.routeGroups.kind, 'automatic'),
        eq(schema.routeGroups.groupKey, 'upstream:deepseek-v4-flash'),
      ))
      .get();
    expect(automaticGroup).toBeDefined();
    expect(automaticGroup?.legacyRouteId).not.toBe(manualRoute.id);

    const manualGroup = await db.select().from(schema.routeGroups)
      .where(and(
        eq(schema.routeGroups.kind, 'manual'),
        eq(schema.routeGroups.groupKey, 'manual:deepseek-v4-flash-rerouted'),
      ))
      .get();
    expect(manualGroup?.legacyRouteId).toBe(manualRoute.id);

    const automaticRoute = await findRouteByExposedModel('deepseek-v4-flash');
    expect(automaticRoute?.id).toBe(automaticGroup?.legacyRouteId);
  });

  it('rebuilds automatic projection routes without deleting manual graph nodes', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'site-graph',
      url: 'https://site-graph.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'graph-user',
      accessToken: 'access-token',
      status: 'active',
    }).returning().get();

    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'graph-token',
      token: 'sk-graph',
      source: 'manual',
      enabled: true,
      isDefault: true,
    }).returning().get();

    await db.insert(schema.tokenModelAvailability).values({
      tokenId: token.id,
      modelName: 'auto-generated-model',
      available: true,
    }).run();

    const manualGraph = {
      version: 1,
      nodes: [
        {
          id: 'filter:manual:reasoning',
          type: 'filter',
          name: 'Manual reasoning policy',
          enabled: true,
          visibility: 'internal',
          ownership: 'manual',
          operations: [{ type: 'set_payload', path: 'reasoning_effort', value: 'medium' }],
        },
      ],
      edges: [],
      macros: [],
    };
    const published = await publishRouteGraphSource({ sourceGraph: manualGraph, createdBy: 'test', allowDiagnostics: true });
    expect(published.ok).toBe(true);

    const rebuild = await rebuildTokenRoutesFromAvailability();
    expect(rebuild.createdRoutes).toBe(1);

    const generatedRoute = await findRouteByExposedModel('auto-generated-model');
    expect(generatedRoute).toBeDefined();

    const active = await getActiveRouteGraphVersion();
    expect(active?.id).toBe(published.ok ? published.version.id : undefined);
    expect(active?.sourceGraph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'filter:manual:reasoning',
        ownership: 'manual',
      }),
    ]));
    expect(active?.sourceGraph.nodes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'route-endpoint:product:auto-model:auto-generated-model' }),
    ]));
  });

  it('keeps rebuild heap growth bounded when many unrelated route targets exist', async () => {
    const forceGc = () => (globalThis as { gc?: () => void }).gc?.();
    const modelCount = 180;
    const unrelatedTargetCount = 2_000;
    const strictHeapBudgetBytes = 96 * 1024 * 1024;
    const ciHeapBudgetBytes = 512 * 1024 * 1024;

    const site = await db.insert(schema.sites).values({
      name: 'memory-pressure-site',
      url: 'https://memory-pressure.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();

    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'memory-pressure-user',
      accessToken: '',
      apiToken: 'sk-memory-pressure',
      status: 'active',
      extraConfig: JSON.stringify({ credentialMode: 'apikey' }),
    }).returning().get();

    const unrelatedRoute = await db.insert(schema.tokenRoutes).values({
      displayName: 'manual-memory-pressure-*',
      enabled: true,
    }).returning().get();

    for (let offset = 0; offset < modelCount; offset += 50) {
      const rows = Array.from({ length: Math.min(50, modelCount - offset) }, (_, index) => ({
        accountId: account.id,
        modelName: `memory-pressure-model-${String(offset + index).padStart(4, '0')}`,
        available: true,
        latencyMs: 100 + index,
        checkedAt: '2026-06-28T00:00:00.000Z',
      }));
      await db.insert(schema.modelAvailability).values(rows).run();
    }

    for (let offset = 0; offset < unrelatedTargetCount; offset += 200) {
      const rows = Array.from({ length: Math.min(200, unrelatedTargetCount - offset) }, (_, index) => ({
        routeId: unrelatedRoute.id,
        accountId: account.id,
        tokenId: null,
        sourceModel: `unrelated-memory-pressure-${offset + index}`,
        priority: 0,
        weight: 10,
        enabled: true,
        manualOverride: true,
      }));
      await db.insert(schema.routeEndpointTargets).values(rows).run();
    }

    forceGc();
    const beforeHeap = process.memoryUsage().heapUsed;
    const rebuild = await rebuildTokenRoutesFromAvailability();
    forceGc();
    const afterHeap = process.memoryUsage().heapUsed;
    const heapDelta = Math.max(0, afterHeap - beforeHeap);
    const activeVersions = await db.select({ id: schema.routeGraphVersions.id }).from(schema.routeGraphVersions).all();
    const bindings = await loadRouteGraphRouteTableBindings();
    const rebuiltBindings = Array.from(bindings.values()).filter((binding) => (
      binding.modelPattern.startsWith('memory-pressure-model-')
    ));

    expect(rebuild.models).toBe(modelCount);
    expect(heapDelta).toBeLessThan((globalThis as { gc?: () => void }).gc ? strictHeapBudgetBytes : ciHeapBudgetBytes);
    expect(activeVersions).toHaveLength(0);
    expect(rebuiltBindings).toHaveLength(modelCount);

    const unrelatedTargetsAfter = await db.select({ id: schema.routeEndpointTargets.id })
      .from(schema.routeEndpointTargets)
      .where(eq(schema.routeEndpointTargets.routeId, unrelatedRoute.id))
      .all();
    expect(unrelatedTargetsAfter).toHaveLength(unrelatedTargetCount);
  }, 30_000);
});
