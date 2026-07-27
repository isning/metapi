import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CompiledRouterBundle } from '../../shared/compiledRuntime.js';
import type { ActiveRouteRuntimeArtifact } from './routeRuntimeArtifactService.js';

let activeArtifact: ActiveRouteRuntimeArtifact | null = null;

vi.mock('./routeRuntimeArtifactService.js', () => ({
  getCachedActiveRouteRuntimeArtifact: () => activeArtifact,
  getActiveRouteRuntimeArtifact: async () => activeArtifact,
}));

type DbModule = typeof import('../db/index.js');
type InventoryModule = typeof import('./compiledRuntimeInventoryService.js');

function bundleWithAttempts(input: {
  goodExecutionTargetId: number;
  missingModelExecutionTargetId: number;
}): CompiledRouterBundle {
  return {
    hash: 'inventory-bundle',
    matcher: {
      exact: {
        'public-model': {
          programId: 'plan:public-model',
          publicModelName: 'public-model',
          entryNodeId: 'entry.public',
        },
      },
      normalizedExact: {},
      patterns: [],
    },
    diagnostics: [],
    planIndex: {
      'plan:public-model': 0,
    },
    plans: [{
      id: 'plan:public-model',
      entryNodeId: 'entry.public',
      publicModelName: 'public-model',
      enabled: true,
      filterStages: [],
      executionAlternatives: [
        {
          alternativeId: 'alt:good',
          kind: 'execution_attempt',
          enabled: true,
          filterStageIndexes: [],
          selectionTerms: [{
            termId: 'dispatcher:attempt',
            nodeId: 'dispatcher:attempt',
            mode: 'execution_attempt',
            policy: { kind: 'builtin', builtin: 'weighted' },
            optionId: 'good',
            optionIndex: 0,
            optionKind: 'route',
            enabled: true,
            weight: 10,
            order: 0,
            sourceRef: {},
          }],
          terminal: {
            kind: 'supply',
            endpointId: 'endpoint:good',
            nodeId: 'endpoint:good',
            sourceRef: {},
          },
          endpoint: null,
          executionAttempt: {
            endpointId: 'endpoint:good',
            executionAttemptId: 'attempt:good',
            targetId: 'target:good',
            nodeId: 'endpoint:good',
            model: 'upstream-good',
            modelSource: 'fixed',
            enabled: true,
            siteId: 1,
            accountId: 1,
            tokenId: null,
            weight: 10,
            transportBinding: { kind: 'execution_target', executionTargetId: input.goodExecutionTargetId },
            sourceRef: {},
          },
          syntheticResponse: null,
        },
        {
          alternativeId: 'alt:missing-model',
          kind: 'execution_attempt',
          enabled: true,
          filterStageIndexes: [],
          selectionTerms: [{
            termId: 'dispatcher:attempt',
            nodeId: 'dispatcher:attempt',
            mode: 'execution_attempt',
            policy: { kind: 'builtin', builtin: 'weighted' },
            optionId: 'missing-model',
            optionIndex: 1,
            optionKind: 'route',
            enabled: true,
            weight: 10,
            order: 1,
            sourceRef: {},
          }],
          terminal: {
            kind: 'supply',
            endpointId: 'endpoint:missing-model',
            nodeId: 'endpoint:missing-model',
            sourceRef: {},
          },
          endpoint: null,
          executionAttempt: {
            endpointId: 'endpoint:missing-model',
            executionAttemptId: 'attempt:missing-model',
            targetId: 'target:missing-model',
            nodeId: 'endpoint:missing-model',
            model: '',
            modelSource: 'fixed',
            enabled: true,
            siteId: 1,
            accountId: 1,
            tokenId: null,
            weight: 10,
            transportBinding: { kind: 'execution_target', executionTargetId: input.missingModelExecutionTargetId },
            sourceRef: {},
          },
          syntheticResponse: null,
        },
      ],
      sourceRef: {},
    }],
  };
}

describe('compiledRuntimeInventoryService', () => {
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let closeDbConnections: DbModule['closeDbConnections'];
  let listActiveCompiledRuntimeModelInventory: InventoryModule['listActiveCompiledRuntimeModelInventory'];

  beforeAll(async () => {
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'metapi-compiled-runtime-inventory-'));
    const migrate = await import('../db/migrate.js');
    await migrate.runSqliteMigrations();
    const dbModule = await import('../db/index.js');
    const service = await import('./compiledRuntimeInventoryService.js');
    db = dbModule.db;
    schema = dbModule.schema;
    closeDbConnections = dbModule.closeDbConnections;
    listActiveCompiledRuntimeModelInventory = service.listActiveCompiledRuntimeModelInventory;
  });

  beforeEach(async () => {
    activeArtifact = null;
    await db.delete(schema.runtimeExecutionTargetState).run();
    await db.delete(schema.runtimeExecutionTargets).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await closeDbConnections?.();
    delete process.env.DATA_DIR;
  });

  it('does not derive a fixed attempt model from the entrypoint or supply endpoint row', async () => {
    const site = await db.insert(schema.sites).values({
      name: 'Inventory Site',
      url: 'https://inventory.example.com',
      platform: 'new-api',
      status: 'active',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'inventory-account',
      accessToken: 'access-token',
      apiToken: 'sk-inventory',
      status: 'active',
    }).returning().get();
    const goodSupply = await db.insert(schema.runtimeExecutionTargets).values({
      executionKey: 'inventory:good',
      siteId: site.id,
      accountId: account.id,
      tokenId: null,
      upstreamModelName: 'upstream-good',
      normalizedModelName: 'upstream-good',
      enabled: true,
      discovered: false,
      source: 'test',
    }).returning().get();
    const missingModelSupply = await db.insert(schema.runtimeExecutionTargets).values({
      executionKey: 'inventory:missing-model',
      siteId: site.id,
      accountId: account.id,
      tokenId: null,
      upstreamModelName: 'upstream-from-db-row',
      normalizedModelName: 'upstream-from-db-row',
      enabled: true,
      discovered: false,
      source: 'test',
    }).returning().get();

    activeArtifact = {
      id: 1,
      compiledGraph: {
        hash: 'inventory-bundle',
        compiledRouterBundle: bundleWithAttempts({
          goodExecutionTargetId: goodSupply.id,
          missingModelExecutionTargetId: missingModelSupply.id,
        }),
      },
    };
    await db.insert(schema.runtimeExecutionTargetState).values({
      executionTargetId: goodSupply.id,
      successCount: 2,
      failCount: 8,
      totalLatencyMs: 400,
      latencySampleCount: 2,
    }).run();

    const inventory = await listActiveCompiledRuntimeModelInventory();

    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({
      modelName: 'public-model',
      planId: 'plan:public-model',
      entryNodeId: 'entry.public',
    });
    expect(inventory[0]?.executionAttempts.map((attempt) => ({
      executionTargetId: attempt.executionTargetId,
      modelName: attempt.modelName,
      latencyMs: attempt.latencyMs,
    }))).toEqual([{
      executionTargetId: goodSupply.id,
      modelName: 'upstream-good',
      latencyMs: 200,
    }]);
    expect(inventory[0]?.invalidExecutionAttempts).toEqual([
      expect.objectContaining({
        alternativeId: 'alt:missing-model',
        reason: 'missing_model',
        executionTargetId: missingModelSupply.id,
      }),
    ]);
  });
});
