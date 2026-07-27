import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8').replace(/\r\n/g, '\n');
}

function walkSources(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (path.endsWith('/db/generated')) continue;
      result.push(...walkSources(path));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(path)) continue;
    if (path.endsWith('.test.ts') || path.endsWith('.test.tsx') || path.endsWith('.architecture.test.ts')) continue;
    result.push(path);
  }
  return result;
}

function walkSourcesWithJs(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (path.endsWith('/db/generated')) continue;
      result.push(...walkSourcesWithJs(path));
      continue;
    }
    if (!/\.(ts|tsx|js)$/.test(path)) continue;
    if (path.endsWith('.test.ts') || path.endsWith('.test.tsx') || path.endsWith('.architecture.test.ts')) continue;
    result.push(path);
  }
  return result;
}

function productionSources(roots: string[]): Array<{ path: string; text: string }> {
  return roots.flatMap((root) => walkSources(resolve(repoRoot, root)))
    .map((path) => ({
      path: relative(repoRoot, path),
      text: readFileSync(path, 'utf8').replace(/\r\n/g, '\n'),
    }));
}

function productionSourcesWithJs(roots: string[]): Array<{ path: string; text: string }> {
  return roots.flatMap((root) => walkSourcesWithJs(resolve(repoRoot, root)))
    .map((path) => ({
      path: relative(repoRoot, path),
      text: readFileSync(path, 'utf8').replace(/\r\n/g, '\n'),
    }));
}

function sourceBlock(text: string, startNeedle: string, endNeedle: string): string {
  const start = text.indexOf(startNeedle);
  const end = text.indexOf(endNeedle, start + startNeedle.length);
  expect(start, `missing block start: ${startNeedle}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing block end: ${endNeedle}`).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe('route graph native terminology architecture', () => {
  it('keeps route runtime snapshot APIs out of retired route-decision terminology', () => {
    const sources = productionSources(['src/server', 'src/web', 'src/shared']);
    const allowedPhysicalStorageFiles = new Set([
      'src/server/db/schema.ts',
      'src/server/db/index.ts',
      'src/server/db/migrate.ts',
      'src/server/services/databaseMigrationService.ts',
    ]);
    const forbidden = [
      `Route${'Decision'}`,
      `route${'Decision'}`,
      `decision${'RefreshedAt'}`,
    ];
    const violations = sources.flatMap(({ path, text }) => {
      if (allowedPhysicalStorageFiles.has(path)) return [];
      return forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps removed model route-target APIs out of production and shared test adapters', () => {
    const sources = [
      ...productionSources(['src/server', 'src/web']),
      { path: 'src/testing/webApiMock.ts', text: readRepoFile('src/testing/webApiMock.ts') },
    ];
    const forbidden = [
      '/route-targets',
      'getModelRouteTargets',
      '{ targets: decision.candidates }',
    ];

    const violations = sources.flatMap(({ path, text }) => (
      forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`)
    ));

    expect(violations).toEqual([]);
  });

  it('keeps durable Graph identity allocation on the server authoring boundary', () => {
    const webSources = productionSourcesWithJs(['src/web']);
    const durableIdentityPrefixes = [
      'manual:node:',
      'manual:macro:',
      'manual:edge:',
      'route:managed:',
      'route-endpoint:managed:',
    ];
    const violations = webSources.flatMap(({ path, text }) => (
      durableIdentityPrefixes
        .filter((prefix) => text.includes(prefix))
        .map((prefix) => `${path}: ${prefix}`)
    ));

    expect(violations).toEqual([]);
    const graphService = readRepoFile('src/server/services/routeGraphService.ts');
    expect(graphService).toContain('New ${kind} requires a localRef');
    expect(graphService).toContain('New edge requires a localRef');
  });

  it('keeps route summary DTOs candidate-oriented', () => {
    const files = [
      'src/server/routes/api/tokens.ts',
      'src/server/services/routeSummaryProjectionService.ts',
      'src/web/api.ts',
      'src/web/pages/token-routes/RouteGroupWorkspace.tsx',
      'src/web/pages/TokenRoutes.tsx',
      'src/shared/routeGroupManagement.d.ts',
    ];
    const forbidden = [
      'targetCount',
      'enabledTargetCount',
      'includeZeroTarget',
      'sortBy?: "targetCount"',
      'sortBy: "targetCount"',
    ];
    const violations = files.flatMap((path) => {
      const text = readRepoFile(path);
      return forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps route rebuild results free of retired channel vocabulary', () => {
    const files = [
      'src/server/services/modelService.ts',
      'src/server/routes/api/tokens.ts',
      'src/server/routes/api/stats.ts',
      'src/server/routes/api/settings.ts',
      'src/web/pages/TokenRoutes.tsx',
    ];
    const forbidden = [
      'createdChannels',
      'removedChannels',
      '新增目标',
      '移除目标',
    ];
    const violations = files.flatMap((path) => {
      const text = readRepoFile(path);
      return forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps row-id graph identity construction out of production code', () => {
    const sources = productionSources(['src/server', 'src/web', 'src/shared']);
    const forbidden = [
      /`entry:route:\$\{/,
      /`dispatcher:route:\$\{/,
      /`route:\$\{[^`]*\}:model-group`/,
      /`route-endpoint:product:route:\$\{/,
      /groupKey\s*=\s*`route:\$\{/,
    ];

    const violations = sources.flatMap(({ path, text }) => (
      forbidden
        .filter((pattern) => pattern.test(text))
        .map((pattern) => `${path}: ${pattern}`)
    ));

    expect(violations).toEqual([]);
  });

  it('keeps graph and runtime identity prefix construction centralized', () => {
    const allowedIdentityFactories = new Set([
      'src/shared/routingIdentity.js',
      'src/web/pages/token-routes/routeGraphIdentity.ts',
    ]);
    const sources = productionSourcesWithJs(['src/server', 'src/web', 'src/shared'])
      .filter(({ path }) => !allowedIdentityFactories.has(path));
    const forbidden = [
      /`entry:[^`]*\$\{/,
      /`dispatcher:[^`]*\$\{/,
      /`route-endpoint:[^`]*\$\{/,
      /`route:[^`]*\$\{/,
      /`macro:[^`]*\$\{/,
      /`edge:[^`]*\$\{/,
    ];

    const violations = sources.flatMap(({ path, text }) => (
      forbidden
        .filter((pattern) => pattern.test(text))
        .map((pattern) => `${path}: ${pattern}`)
    ));

    expect(violations).toEqual([]);
  });

  it('keeps graph macro flow-node identity parsing centralized', () => {
    const allowedIdentityParsers = new Set([
      'src/shared/routingIdentity.js',
      'src/web/pages/token-routes/routeGraphIdentity.ts',
    ]);
    const sources = productionSourcesWithJs(['src/server', 'src/web', 'src/shared'])
      .filter(({ path }) => !allowedIdentityParsers.has(path));
    const forbidden = [
      /startsWith\(['"]macro:['"]\)/,
      /replace\(\s*\/\^macro:/,
      /slice\(\s*['"]macro:['"]\.length/,
    ];

    const violations = sources.flatMap(({ path, text }) => (
      forbidden
        .filter((pattern) => pattern.test(text))
        .map((pattern) => `${path}: ${pattern}`)
    ));

    expect(violations).toEqual([]);
  });

  it('keeps route group and supply persistence key construction centralized', () => {
    const allowedIdentityFactories = new Set([
      'src/shared/routingIdentity.js',
    ]);
    const sources = productionSourcesWithJs(['src/server', 'src/web', 'src/shared'])
      .filter(({ path }) => !allowedIdentityFactories.has(path));
    const forbidden = [
      /`upstream:\$\{/,
      /startsWith\(['"]upstream:['"]\)/,
      /`route-unit:\$\{/,
      /\$\{[^`]*tokenId\s*\?\?\s*['"]account['"][^`]*\}/,
    ];

    const violations = sources.flatMap(({ path, text }) => (
      forbidden
        .filter((pattern) => pattern.test(text))
        .map((pattern) => `${path}: ${pattern}`)
    ));

    expect(violations).toEqual([]);
  });

  it('keeps source route graph free of compiled execution-attempt fields', () => {
    const files = [
      'src/shared/routeGraph.d.ts',
      'src/shared/routeGraph.js',
      'src/server/services/routeGraphService.ts',
    ];
    const forbidden = [
      'RouteDispatcherCandidateAttempt',
      'candidateAttempts',
      'candidateAttemptsByEndpointId',
      'attemptSelection',
      'inline_candidates',
      'normalizeRouteDispatcherCandidateAttempt',
    ];
    const violations = files.flatMap((path) => {
      const text = readRepoFile(path);
      return forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('does not expose compiled-runtime materialization from the source Graph module', () => {
    const files = [
      'src/shared/routeGraph.js',
      'src/shared/routeGraph.d.ts',
    ];
    const forbidden = [
      'export function compactCompiledRouterBundle',
      'export function materializeCompiledRouterPlan',
      'export function getCompiledRouterPlanById',
      'export function getCompiledRouterExecutionTargetIds',
      'export function compactCompiledRouterBundle(',
      'export function materializeCompiledRouterPlan(',
      'export function getCompiledRouterPlanById(',
      'export function getCompiledRouterExecutionTargetIds(',
    ];
    const violations = files.flatMap((path) => {
      const text = readRepoFile(path);
      return forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps compiled-runtime packing and materialization implemented only by the runtime module', () => {
    const sourceGraph = readRepoFile('src/shared/routeGraph.js');
    const forbidden = [
      'function packedTupleValue(',
      'function createPackedExecutionTable(',
      'function packedExecutionTable(',
      'function packedExecutionAlternativeToCompiled(',
      'function compactCompiledRouterBundle(',
      'function materializeCompiledRouterPlan(',
      'function getCompiledRouterPlanById(',
      'function getCompiledRouterExecutionTargetIds(',
    ];
    expect(forbidden.filter((pattern) => sourceGraph.includes(pattern))).toEqual([]);
  });

  it('does not let runtime services import compiled contracts from the source Graph module', () => {
    const runtimeFiles = [
      'src/server/services/compiledRuntimeInventoryService.ts',
      'src/server/services/compiledRuntimeProjectionService.ts',
      'src/server/services/compiledRuntimeRoutingSignalOverlayService.ts',
      'src/server/services/routeRuntimeArtifactService.ts',
      'src/server/services/routeRuntimeEvaluatorService.ts',
      'src/server/services/routeRuntimeExecutionService.ts',
    ];
    const violations = runtimeFiles
      .filter((path) => readRepoFile(path).includes("shared/routeGraph.js"));
    expect(violations).toEqual([]);
  });

  it('keeps Graph endpoint aliases out of compiled-runtime DTOs and CEL scopes', () => {
    const files = [
      'src/server/proxy-core/apiVariants.ts',
      'src/server/services/compiledRuntimeSelectorScopes.ts',
      'src/server/services/routeRuntimeEvaluatorService.ts',
      'src/server/services/routeRuntimeExecutionService.ts',
    ];
    const violations = files
      .filter((path) => readRepoFile(path).includes('routeEndpointId'));
    expect(violations).toEqual([]);
  });

  it('keeps Route Group summary persistence outside the HTTP adapter', () => {
    const adapter = readRepoFile('src/server/routes/api/routeGroupRoutes.ts');
    const compositionRoot = readRepoFile('src/server/routes/api/tokens.ts');
    expect(adapter).not.toContain("../../db/index.js");
    expect(adapter).toContain('routeGroupManagementReadModelService');
    expect(compositionRoot).not.toContain("../../db/index.js");
    expect(compositionRoot).not.toContain('loadRouteGroupManagementReadModel');
  });

  it('keeps source route graph free of legacy numeric route identity fields', () => {
    const files = [
      'src/shared/routeGraph.d.ts',
      'src/shared/routeGraph.js',
      'src/server/services/routeGraphService.ts',
    ];
    const forbidden = [
      'routeId',
      'legacyRouteId',
      'sourceRouteId',
      'entryRouteId',
      'routeIds',
      'sourceRouteIds',
      'localRouteId',
      'localRouteIds',
    ];
    const violations = files.flatMap((path) => {
      const text = readRepoFile(path);
      return forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps route-group management provenance out of graph artifacts', () => {
    const files = [
      'src/shared/routeGraph.d.ts',
      'src/shared/routeGraph.js',
      'src/server/services/routeRuntimeArtifactService.ts',
    ];
    const forbidden = [
      'route_group_projection',
      'group.kind',
      'group.sourceMode',
    ];
    const violations = files.flatMap((path) => {
      const text = readRepoFile(path);
      return forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps inferred product-endpoint roots out of compiled runtime contracts', () => {
    const files = [
      'src/shared/compiledRuntime.d.ts',
      'src/shared/routeGraph.d.ts',
      'src/shared/routeGraph.js',
      'src/server/services/compiledRuntimeSelectorScopes.ts',
    ];
    const violations = files
      .filter((path) => readRepoFile(path).includes('rootEndpointId'));
    expect(violations).toEqual([]);
  });

  it('keeps compiled runtime artifacts free of old compiled graph debug shape', () => {
    const files = [
      'src/shared/routeGraph.d.ts',
      'src/shared/routeGraph.js',
      'src/server/services/routeRuntimeArtifactService.ts',
    ];
    const forbidden = [
      /compiled\.(entries|routeEndpoints|nodesById|edgesBySource|edgesByFromPort|terminals|publicModels)\b/,
      /compiledGraph\.(entries|routeEndpoints|nodesById|edgesBySource|edgesByFromPort|terminals|publicModels)\b/,
      `hasFullCompiled${'Graph'}DebugPayload`,
    ];
    const violations = files.flatMap((path) => {
      const text = readRepoFile(path);
      return forbidden
        .filter((pattern) => typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text))
        .map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps token route frontend helpers and i18n keys fallback-stage-oriented', () => {
    const files = [
      'src/web/pages/TokenRoutes.tsx',
      'src/web/pages/ModelTester.tsx',
      'src/web/pages/token-routes/fallbackStageOrdering.ts',
      'src/web/pages/token-routes/routeGraphRegistry.ts',
      'src/web/pages/token-routes/routeGraphViewModel.ts',
      'src/web/pages/token-routes/RouteGroupWorkspace.tsx',
      'src/web/pages/token-routes/useRouteGroupFallbackStages.ts',
      'src/web/i18n/resources/pages.ts',
    ];
    const forbidden = [
      'normalizeTargets',
      'getTargetDecisionState',
      'TargetDecisionState',
      'splitPriorityBucketAfterTarget',
      'showZeroTargetRoutes',
      'bucketTargetCount',
      'zero_target',
      'pages.tokenRoutes.addtargets',
      'pages.tokenRoutes.targetsstatusfailed',
      'pages.tokenRoutes.confirmRemovetargets',
      'pages.tokenRoutes.targetRemoved',
      'pages.tokenRoutes.targetTokenUpdated',
      'pages.tokenRoutes.targetMissingExactModelCannotUseSiteBlocklist',
      'pages.tokenRoutes.failedRemoveTarget',
      'pages.tokenRoutes.failedSaveTargetPriorityRolledBack',
      'pages.tokenRoutes.groupsMatchtargets',
      'pages.tokenRoutes.routeCard.nonetargets',
      'pages.tokenRoutes.sortableTargetRow',
      'pages.tokenRoutes.utils.noTargetAvailable',
      'pages.modelTester.targets',
      'pages.modelTester.targetsFailed',
      'pages.modelTester.loadingTargets',
      'pages.modelTester.forcedCandidate',
      'pages.modelTester.forcedCandidatesFailed',
      'pages.modelTester.loadingCandidates',
      'pages.modelTester.customRequestmodeCandidatesNotAvailable',
      'pages.modelTester.defaultautomaticCandidates',
      'pages.modelTester.deleteCandidates',
      'oneUpstreamTarget',
      'syntheticTarget',
      'synthetic target',
      'automaticModelGroup',
      'automatic model group',
      '自动模型组',
    ];
    const violations = files.flatMap((path) => {
      const text = readRepoFile(path);
      return forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps tester fixed selection execution-attempt-oriented without target/candidate envelopes', () => {
    const files = [
      'src/server/routes/api/test.ts',
      'src/server/proxy-core/executionAttemptSelection.ts',
      'src/server/proxy-core/formats/headerPassthrough.ts',
      'src/server/proxy-core/orchestration/genericProxyOrchestrator.ts',
      'src/server/proxy-core/orchestration/modelListOrchestrator.ts',
      'src/server/proxy-core/orchestration/sharedProxyOrchestration.ts',
      'src/web/pages/ModelTester.tsx',
      'src/web/pages/helpers/modelTesterSession.ts',
      'src/web/api.ts',
      'src/testing/webApiMock.ts',
    ];
    const forbidden = [
      'forcedTargetId',
      'getTesterForcedTargetId',
      'normalizeForcedTargetId',
      'TESTER_FORCED_TARGET_HEADER',
      'x-metapi-tester-forced-target-id',
      'forcedCandidateId',
      'getTesterForcedCandidateId',
      'normalizeForcedCandidateId',
      'TESTER_FORCED_CANDIDATE_HEADER',
      'x-metapi-tester-forced-candidate-id',
    ];
    const violations = files.flatMap((path) => {
      const text = readRepoFile(path);
      return forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps proxy debug trace transport on execution-attempt naming', () => {
    const files = [
      'src/server/db/schema.ts',
      'src/server/services/proxyDebugTraceStore.ts',
      'src/server/routes/proxy/debugTrace.relay.test.ts',
      'src/web/pages/ProxyLogs.tsx',
      'src/web/api.ts',
    ];
    const forbidden = [
      'stickyHitTargetId',
      'selectedExecutionAttemptDisplay',
      'proxyDebugTarget',
      'proxy_debug_target_session_id',
      'PROXY_DEBUG_TARGET_SESSION_ID',
    ];
    const violations = files.flatMap((path) => {
      const text = readRepoFile(path);
      return forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps backup import/export on current route runtime tables only', () => {
    const backupService = readRepoFile('src/server/services/backupService.ts');
    const exportStart = backupService.indexOf('async function exportAccountsSection');
    const exportEnd = backupService.indexOf('async function exportPreferencesSection', exportStart);
    const exportBlock = backupService.slice(exportStart, exportEnd);
    const coerceStart = backupService.indexOf('function coerceAccountsSection');
    const coerceEnd = backupService.indexOf('function coercePreferencesSection', coerceStart);
    const coerceBlock = backupService.slice(coerceStart, coerceEnd);
    const importExportPage = readRepoFile('src/web/pages/ImportExport.tsx');
    const legacyEndpointTargets = `routeEndpoint${'Targets'}`;
    const legacyChannels = `route${'Channels'}`;
    const legacyTokenRoutes = `token${'Routes'}`;

    expect(exportStart).toBeGreaterThanOrEqual(0);
    expect(exportEnd).toBeGreaterThan(exportStart);
    expect(exportBlock).toContain('runtimeExecutionTargets');
    expect(exportBlock).toContain('routeGraph');
    expect(exportBlock).not.toContain(legacyEndpointTargets);
    expect(exportBlock).not.toContain(legacyChannels);
    expect(coerceBlock).toContain('runtimeExecutionTargets');
    expect(coerceBlock).toContain('routeGraph');
    expect(coerceBlock).not.toContain(legacyEndpointTargets);
    expect(coerceBlock).not.toContain(legacyChannels);
    expect(coerceBlock).not.toContain(legacyTokenRoutes);
    expect(backupService).not.toContain('function synthesizeNativeRouteGroupsFromLegacyTargets');
    expect(importExportPage).toContain('accountsSection?.runtimeExecutionTargets');
    expect(importExportPage).toContain('accountsSection?.routeGraph');
    expect(importExportPage).not.toContain(legacyEndpointTargets);
    expect(importExportPage).not.toContain(legacyChannels);
    expect(importExportPage).not.toContain(legacyTokenRoutes);
  });

  it('keeps retired route endpoint target references inside schema drop boundaries only', () => {
    const sources = [
      ...productionSources(['src/server', 'src/web']),
      ...['scripts/dev'].flatMap((root) => productionSources([root])),
    ];
    const allowedByPath = new Map<string, string[]>([
      [
        'src/server/db/migrate.ts',
        ['route_endpoint_targets'],
      ],
      [
        'src/server/db/schemaArtifactGenerator.ts',
        ['route_endpoint_targets', 'endpoint-targets'],
      ],
      [
        'src/server/services/backupImportMigration.ts',
        ['route_endpoint_targets', `routeEndpoint${'Targets'}`],
      ],
    ]);
    const forbidden = [
      'route_endpoint_targets',
      `routeEndpoint${'Targets'}`,
      'endpoint-targets',
    ];
    const violations = sources.flatMap(({ path, text }) => {
      const hits = forbidden.filter((pattern) => text.includes(pattern));
      if (hits.length === 0) return [];
      const allowedPatterns = allowedByPath.get(path);
      if (allowedPatterns && hits.every((hit) => allowedPatterns.includes(hit))) {
        return [];
      }
      return hits.map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps proxy-core behind compiled runtime execution boundaries', () => {
    const sources = productionSources(['src/server/proxy-core']);
    const forbidden = [
      'tokenRouter',
      'TokenRouter',
      'selectTarget',
      'selectNextTarget',
      'previewSelectedExecutionAttempt',
      'invalidateTokenRouterCache',
      '__tokenRouterTestUtils',
      'routeRuntimeEvaluatorService',
      'evaluateActiveRouteRuntimeForModel',
      'routeGroupCandidateService',
      'routeGroupCandidateSnapshotService',
      'routeGroupPersistenceService',
      'routeGroupTargetService',
      'routeGraphFilters',
      'selected.routeGraph?.',
      'codexWebsocketTarget.routeGraph?.',
      'routeGraph?:',
    ];
    const violations = sources.flatMap(({ path, text }) => (
      forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`)
    ));

    expect(violations).toEqual([]);
  });

  it('keeps the legacy token router selector removed from production code', () => {
    expect(existsSync(new URL('../../services/tokenRouter.ts', import.meta.url))).toBe(false);
    const sources = productionSources(['src/server']);
    const violations = sources.flatMap(({ path, text }) => {
      const importsTokenRouter = /from ['"][^'"]*tokenRouter\.js['"]/.test(text)
        || /import\([^)]*tokenRouter\.js['"]\)/.test(text);
      return importsTokenRouter ? [`${path}: imports removed tokenRouter module`] : [];
    });

    expect(violations).toEqual([]);
  });

  it('keeps model-facing inventory APIs on compiled runtime sources', () => {
    const statsRoute = readRepoFile('src/server/routes/api/stats.ts');
    const marketplaceReadModel = readRepoFile('src/server/services/modelsMarketplaceReadModelService.ts');
    const searchRoute = readRepoFile('src/server/routes/api/search.ts');

    expect(statsRoute).toContain('getModelsMarketplaceReadModel');
    expect(statsRoute).not.toContain('listActiveCompiledRuntimeModelInventory');
    expect(marketplaceReadModel).toContain('listActiveCompiledRuntimeModelInventory');
    expect(marketplaceReadModel).not.toMatch(/routeGroup/i);
    expect(statsRoute).not.toContain('routeGroupCandidateSnapshotService');
    expect(statsRoute).not.toContain('loadRouteGroupCandidateJoinRowsForRouteIds');
    expect(statsRoute).not.toContain('route-target:');

    expect(searchRoute).toContain('listActiveCompiledRuntimeModelInventory');
    expect(searchRoute).not.toContain('schema.modelAvailability');
    expect(searchRoute).not.toContain('schema.tokenModelAvailability');
  });

  it('keeps proxy execution behind the route runtime execution facade', () => {
    const sources = [
      ...productionSources([
        'src/server/proxy-core',
        'src/server/routes/proxy',
      ]),
      { path: 'src/server/services/routeFlowService.ts', text: readRepoFile('src/server/services/routeFlowService.ts') },
      { path: 'src/server/services/executionTargetRecoveryProbeService.ts', text: readRepoFile('src/server/services/executionTargetRecoveryProbeService.ts') },
      { path: 'src/server/services/routeGroupRuntimeStateService.ts', text: readRepoFile('src/server/services/routeGroupRuntimeStateService.ts') },
      { path: 'src/server/services/routeRuntimeDecisionSnapshotService.ts', text: readRepoFile('src/server/services/routeRuntimeDecisionSnapshotService.ts') },
      { path: 'src/testing/proxyRelayHarness.ts', text: readRepoFile('src/testing/proxyRelayHarness.ts') },
      { path: 'scripts/dev/route-runtime-performance-gate.ts', text: readRepoFile('scripts/dev/route-runtime-performance-gate.ts') },
      { path: 'scripts/dev/route-runtime-throughput-benchmark.ts', text: readRepoFile('scripts/dev/route-runtime-throughput-benchmark.ts') },
      { path: 'scripts/dev/route-http-rps-benchmark.ts', text: readRepoFile('scripts/dev/route-http-rps-benchmark.ts') },
    ];
    const violations = sources.flatMap(({ path, text }) => {
      const importsInternalCompiledRuntimeExecution = /compiledRuntimeExecutionService\.js/.test(text)
        || /routeRuntimeEvaluatorService\.js/.test(text)
        || /\bevaluateCompiledRuntimeArtifact\b/.test(text)
        || /\bevaluateActiveRouteRuntimeForModel\b/.test(text);
      return importsInternalCompiledRuntimeExecution
        ? [`${path}: imports internal compiled runtime execution implementation`]
        : [];
    });

    expect(violations).toEqual([]);
    for (const { path, text } of sources) {
      if (!path.startsWith('scripts/dev/route-runtime') && path !== 'scripts/dev/route-http-rps-benchmark.ts') continue;
      expect(text).toContain('routeRuntimeExecutionService');
    }
  });

  it('keeps special proxy routes as Fastify adapters', () => {
    const adapters = [
      'src/server/routes/proxy/search.ts',
      'src/server/routes/proxy/images.ts',
      'src/server/routes/proxy/videos.ts',
    ];
    const forbidden = [
      "from 'undici'",
      'routeRuntimeExecutionService',
      'compiledRuntimeExecutionSessionService',
      'proxyVideoTaskStore',
      'estimateProxyCost',
      'runWithSiteApiEndpointPool',
      'shouldRetryProxyRequest',
    ];
    const violations = adapters.flatMap((path) => {
      const text = readRepoFile(path);
      return forbidden.filter((term) => text.includes(term)).map((term) => `${path}: ${term}`);
    });
    expect(violations).toEqual([]);
    expect(readRepoFile('src/server/routes/proxy/search.ts')).toContain('executeSearchProxySurface');
    expect(readRepoFile('src/server/routes/proxy/images.ts')).toContain('executeImagesEditProxySurface');
    expect(readRepoFile('src/server/routes/proxy/videos.ts')).toContain('executeVideoCreateProxySurface');
  });

  it('keeps runtime artifact construction out of the source graph service', () => {
    const routeGraphService = readRepoFile('src/server/services/routeGraphService.ts');
    const routeTableRuntimeArtifactPath = resolve(repoRoot, 'src/server/services/routeTableRuntimeArtifactService.ts');
    const runtimeSignalOverlay = readRepoFile('src/server/services/compiledRuntimeRoutingSignalOverlayService.ts');
    const runtimeExecution = readRepoFile('src/server/services/routeRuntimeExecutionService.ts');
    const runtimeArtifact = readRepoFile('src/server/services/routeRuntimeArtifactService.ts');
    const schema = readRepoFile('src/server/db/schema.ts');
    const runtimeObservability = readRepoFile('src/server/services/compiledRuntimeObservabilityService.ts');
    const forbiddenInGraphService = [
      'buildRouteTableRuntimeBundleFromContext',
      'buildRouteTableRuntimeAlternative',
      'loadRouteTableRuntimeArtifactForModel',
      'getRouteTableRuntimeArtifactForModel',
      'attachCompiledRuntimeRoutingSignals',
      'overlayCompiledRuntimeRoutingSignals(',
      'quoteEndpointPricing',
      'ROUTE_TABLE_MIN_EFFECTIVE_UNIT_COST',
      'ROUTE_TABLE_RUNTIME_MODEL_CACHE_LIMIT',
      'RouteTableRuntimeIndex',
    ];
    const violations = forbiddenInGraphService
      .filter((pattern) => routeGraphService.includes(pattern))
      .map((pattern) => `routeGraphService.ts: ${pattern}`);

    expect(violations).toEqual([]);
    expect(existsSync(routeTableRuntimeArtifactPath)).toBe(false);
    expect(runtimeExecution).not.toContain('getRouteTableRuntimeArtifactForModel');
    expect(runtimeExecution).not.toContain('getRouteTableRuntimeExecutionTargetIdentity');
    expect(runtimeArtifact).not.toContain('schema.routeGraphVersions');
    expect(runtimeArtifact).not.toContain('schema.routeGraphActiveVersion');
    expect(sourceBlock(schema, 'export const routeGraphVersions', 'export const routeGraphDrafts'))
      .not.toContain('compiledGraphJson');
    expect(schema).toContain("compiledRuntimeArtifacts = sqliteTable('compiled_runtime_artifacts'");
    expect(schema).toContain("compiledRuntimeActiveArtifact = sqliteTable('compiled_runtime_active_artifact'");
    expect(runtimeObservability).not.toContain("'route_table'");
    expect(runtimeSignalOverlay).toContain('attachCompiledRuntimeRoutingSignals');
    expect(runtimeSignalOverlay).toContain('overlayCompiledRuntimeRoutingSignals');
    expect(runtimeSignalOverlay).toContain('buildCompiledRuntimeRoutingSignalContexts');
    expect(runtimeSignalOverlay).not.toContain('routeGroupCandidateSnapshotService');
    expect(runtimeSignalOverlay).not.toContain('RouteGroupCandidate');
  });

  it('keeps compiled runtime routing signals out of source metadata scopes', () => {
    const selectorEngine = readRepoFile('src/server/services/selectorEngine.ts');
    const runtimeSignalOverlay = readRepoFile('src/server/services/compiledRuntimeRoutingSignalOverlayService.ts');

    expect(selectorEngine).not.toContain('metadata.routingSignals');
    expect(selectorEngine).not.toContain(`candidate.metadata.${'final' + 'Contribution'}`);
    expect(selectorEngine).not.toContain('metadata: input.candidate.metadata');

    const forbiddenSignalMetadataWrites = [
      /metadata:\s*\{[^}]*routingSignals/s,
      /routingSignals,\s*\n\s*\}/,
    ];
    const metadataWriteBlocks = [
      ...runtimeSignalOverlay.matchAll(/metadata:\s*\{[\s\S]*?\n\s*\}/g),
    ].map((match) => match[0]);
    const violations = metadataWriteBlocks.filter((block) => (
      forbiddenSignalMetadataWrites.some((pattern) => pattern.test(block))
    ));

    expect(violations).toEqual([]);
    expect(runtimeSignalOverlay).toContain('runtime: {');
    expect(runtimeSignalOverlay).toContain('routingSignals');
  });

  it('centralizes compiled runtime selector CEL scope injection', () => {
    const scopeModule = readRepoFile('src/server/services/compiledRuntimeSelectorScopes.ts');
    const consumers = [
      'src/server/services/routeRuntimeEvaluatorService.ts',
      'src/server/services/compiledRuntimeProjectionService.ts',
      'src/server/services/compiledRuntimeProbabilityService.ts',
    ].map((path) => ({ path, text: readRepoFile(path) }));
    const duplicatedScopeHelperNames = [
      'function selectorPlanScope',
      'function selectorGraphScope',
      'function selectorSelectionScope',
      'function selectorEndpointScope',
      'function selectorExecutionAttemptScope',
      'function pricingPlanScope',
      'function pricingGraphScope',
      'function pricingSelectionScope',
      'function pricingEndpointScope',
      'function pricingExecutionAttemptScope',
      'function runtimeCandidateForAlternativeOption',
      'function runtimeCandidateForTermOption',
      'function runtimeCandidateFromAlternativeTermOption',
    ];
    const violations = consumers.flatMap(({ path, text }) => (
      duplicatedScopeHelperNames
        .filter((name) => text.includes(name))
        .map((name) => `${path}: ${name}`)
    ));

    expect(scopeModule).toContain('buildCompiledRuntimeSelectorCandidate');
    expect(scopeModule).toContain('compiledRuntimeSelectionScope');
    expect(scopeModule).toContain('compiledRuntimeEndpointScope');
    expect(scopeModule).toContain('compiledRuntimeExecutionAttemptScope');
    for (const { text } of consumers) expect(text).toContain('./compiledRuntimeSelectorScopes.js');
    expect(consumers[0]!.text).toContain('compiledRuntimeSelectorState');
    expect(consumers[0]!.text).toContain('buildCompiledRuntimeSelectorCandidate');
    expect(consumers[1]!.text).toContain('compiledRuntimeSelectorStateForRequest');
    expect(consumers[2]!.text).toContain('buildCompiledRuntimeSelectorCandidate');
    const entryPricing = readRepoFile('src/server/services/routeEntryPricingService.ts');
    expect(entryPricing).toContain('estimateCompiledRuntimeAlternativeProbabilities');
    expect(violations).toEqual([]);
  });

  it('keeps route runtime performance scripts on the compiled runtime selector', () => {
    const scripts = [
      'scripts/dev/route-runtime-performance-gate.ts',
      'scripts/dev/route-runtime-throughput-benchmark.ts',
      'scripts/dev/route-http-rps-benchmark.ts',
    ];
    const forbidden = [
      'tokenRouter',
      'TokenRouter',
      'selectTarget',
      'selectNextTarget',
      'previewSelectedExecutionAttempt',
      'invalidateTokenRouterCache',
      '__tokenRouterTestUtils',
      'routeRuntimeEvaluatorService',
      'evaluateActiveRouteRuntimeForModel',
      'synchronizeActiveRouteGraphVersion',
    ];
    const violations = scripts.flatMap((path) => {
      const text = readRepoFile(path);
      return forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
    for (const path of scripts) {
      expect(readRepoFile(path)).toContain('routeRuntimeExecutionService');
    }
    const startupGate = readRepoFile('scripts/dev/route-startup-memory-gate.ts');
    expect(startupGate).toContain('publishSeededRouteRuntimeFixture');
    expect(startupGate).toContain('ROUTE_RUNTIME_STORAGE_ARTIFACT_BYTE_LIMIT');
    expect(startupGate).toContain('compiledRuntimeArtifacts');
    expect(startupGate).not.toContain('compiledGraphJson');
    expect(startupGate).not.toContain('synchronizeActiveRouteGraphVersion');
  });

  it('keeps runtime-facing proxy DTOs compiled-runtime native', () => {
    const sharedProxy = readRepoFile('src/server/proxy-core/orchestration/sharedProxyOrchestration.ts');
    const proxyLogStore = readRepoFile('src/server/services/proxyLogStore.ts');
    const webApi = readRepoFile('src/web/api.ts');
    const compiledRuntimeProjection = readRepoFile('src/server/services/compiledRuntimeProjectionService.ts');
    const modelRouteFlow = readRepoFile('src/web/components/ModelRouteFlow.tsx');

    const blocks = [
      {
        label: 'SurfaceSelectedExecutionAttempt',
        text: sourceBlock(sharedProxy, 'type SurfaceSelectedExecutionAttempt = {', 'type SurfaceFailureResponse = {'),
      },
      {
        label: 'ProxyExecutionAttemptLog',
        text: sourceBlock(webApi, 'export type ProxyExecutionAttemptLog = {', 'export type ProxyRequestLog = {'),
      },
      {
        label: 'ProxyLogInsertInput',
        text: sourceBlock(proxyLogStore, 'export type ProxyLogInsertInput = {', 'function buildProxyLogCoreSelectFields()'),
      },
      {
        label: 'ProxyRequestLogDetail',
        text: sourceBlock(webApi, 'export type ProxyRequestLogDetail = ProxyRequestLog & {', 'export type ProxyLogsSummary = {'),
      },
      {
        label: 'RuntimeExecutionAttemptProjection',
        text: sourceBlock(compiledRuntimeProjection, 'export type RuntimeExecutionAttemptProjection = {', 'export type CompiledRuntimeProjection = {'),
      },
      {
        label: 'ModelRouteFlow RuntimeExecutionAttemptProjection',
        text: sourceBlock(modelRouteFlow, 'export type RuntimeExecutionAttemptProjection = {', 'type CompiledRuntimeProjection = {'),
      },
    ];
    const forbidden = [
      'routeGraphVersionId',
      'routeSupplyId',
      'routeExecutionTargetId',
      'disabledRuntimeExecutionTargetIds',
      'routeGraph?:',
      'routeGraph:',
      'routeGroup',
      'candidateId',
      'selectedCandidateId',
      'graphRef',
      'graphVersionId',
      'runtimeVersionId',
    ];
    const violations = blocks.flatMap(({ label, text }) => (
      forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${label}: ${pattern}`)
    ));

    expect(violations).toEqual([]);
    const proxyLogRuntimeSnapshotBlocks = blocks.filter((block) => (
      block.label === 'ProxyRequestLogDetail'
      || block.label === 'ProxyLogInsertInput'
    ));
    const proxyLogForbidden = [
      'ProxyLogRuntimeDispatcherSnapshot',
      'dispatcherNodeId',
      'selectedArgRef',
      'entryNodeId',
      'endpointNodeId',
      'terminalNodeId',
    ];
    const proxyLogViolations = proxyLogRuntimeSnapshotBlocks.flatMap(({ label, text }) => (
      proxyLogForbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${label}: ${pattern}`)
    ));
    expect(proxyLogViolations).toEqual([]);
    expect(blocks.find((block) => block.label === 'SurfaceSelectedExecutionAttempt')?.text).toContain('runtimeArtifactId');
    expect(blocks.find((block) => block.label === 'ProxyExecutionAttemptLog')?.text).toContain('runtimeArtifactId');
    expect(blocks.find((block) => block.label === 'ProxyRequestLogDetail')?.text).toContain('decisionSnapshot?: RouteRuntimeSnapshot');
    expect(blocks.find((block) => block.label === 'ProxyLogInsertInput')?.text).not.toContain('routeRuntimeSnapshot');
    expect(blocks.find((block) => block.label === 'RuntimeExecutionAttemptProjection')?.text).toContain('executionTargetId');
    expect(blocks.find((block) => block.label === 'ModelRouteFlow RuntimeExecutionAttemptProjection')?.text).toContain('executionTargetId');
  });

  it('keeps proxy request logs request-native with nested attempt observations', () => {
    const readModel = readRepoFile('src/server/services/proxyRequestLogReadModelService.ts');
    const statsRoute = readRepoFile('src/server/routes/api/stats.ts');
    const webApi = readRepoFile('src/web/api.ts');

    expect(readModel).toContain('from(schema.proxyRequests)');
    expect(readModel).toContain('attempts: attempts.get(request.id) || []');
    expect(readModel).not.toContain('listProxyLogPage');
    expect(statsRoute).toContain('"/api/stats/proxy-logs/:requestId"');
    const requestDetailRoute = sourceBlock(
      statsRoute,
      '"/api/stats/proxy-logs/:requestId"',
      '"/api/stats/proxy-debug/traces"',
    );
    expect(requestDetailRoute).not.toContain('Number.parseInt(');
    expect(requestDetailRoute).toContain('request.params.requestId');
    expect(webApi).toContain('export type ProxyRequestLog = {');
    expect(webApi).toContain('attempts: ProxyExecutionAttemptLog[]');
    expect(webApi).not.toContain('export type ProxyLogListItem = {');
    expect(webApi).not.toContain('getProxyLogDetail:');
  });

  it('keeps compiled runtime metadata and overlays execution-target-oriented', () => {
    const compiledRuntimeProjection = readRepoFile('src/server/services/compiledRuntimeProjectionService.ts');
    const compiledRuntimeExecution = readRepoFile('src/server/services/routeRuntimeExecutionService.ts');
    const routeRuntimeEvaluator = readRepoFile('src/server/services/routeRuntimeEvaluatorService.ts');
    const routeGroupRuntimeState = readRepoFile('src/server/services/routeGroupRuntimeStateService.ts');
    const decisionSnapshot = readRepoFile('src/server/services/routeRuntimeDecisionSnapshotService.ts');
    const executionScopeTypes = readRepoFile('src/server/services/routeExecutionScopeTypes.ts');

    const runtimeBlocks = [
      {
        label: 'compiled runtime projection metadata reader',
        text: [
          sourceBlock(compiledRuntimeProjection, 'function executionAttemptIdForTarget', 'function termProjection'),
          sourceBlock(compiledRuntimeProjection, 'executionAttempts.push({', 'health: {'),
        ].join('\n'),
      },
      {
        label: 'compiled runtime selector overlay',
        text: sourceBlock(compiledRuntimeExecution, 'function executionTargetIdFromSelection', 'export async function recordRouteRuntimeExecutionAttemptSelected'),
      },
      {
        label: 'runtime failure overlay',
        text: sourceBlock(routeRuntimeEvaluator, 'export type RouteRuntimeFailureOverlay = {', 'function mergeRuntimeAlternativeSnapshots'),
      },
      {
        label: 'route group runtime state resolver',
        text: sourceBlock(routeGroupRuntimeState, 'export async function clearRouteGroupFailureState', 'return { success: true, routeGroupKey, clearedExecutionTargets };'),
      },
      {
        label: 'request decision failure overlay snapshot',
        text: sourceBlock(decisionSnapshot, 'function parseState', 'function parseFilters'),
      },
      {
        label: 'route execution failure overlay type',
        text: sourceBlock(executionScopeTypes, 'export type RouteExecutionFailureOverlay = {', 'export type RouteExecutionScope = {'),
      },
    ];
    const oldRouteTableTerms = [
      'tokenRoutes',
      'routeGroupSources',
      'routeBindingProjections',
      'legacyRouteId',
      'sourceRouteId',
      'entryRouteId',
    ];
    const oldRouteTableViolations = runtimeBlocks.flatMap(({ label, text }) => (
      oldRouteTableTerms
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${label}: ${pattern}`)
    ));
    expect(oldRouteTableViolations).toEqual([]);

    const runtimeSupplyStorageTerms = [
      'routeExecutionTargetId',
      'routeExecutionTargetIds',
      'disabledRuntimeExecutionTargetIds',
    ];
    const runtimeSupplyStorageViolations = runtimeBlocks.flatMap(({ label, text }) => (
      runtimeSupplyStorageTerms
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${label}: ${pattern}`)
    ));

    expect(runtimeSupplyStorageViolations).toEqual([]);
    for (const block of runtimeBlocks) {
      expect(/executionTarget|ExecutionTarget/.test(block.text), block.label).toBe(true);
    }
    expect(routeRuntimeEvaluator).toContain('disabledExecutionTargetIds?: number[]');
    expect(executionScopeTypes).toContain('disabledExecutionTargetIds?: number[]');
  });

  it('does not retain a Route Group-to-Graph projection builder', () => {
    expect(existsSync(resolve(repoRoot, 'src/server/services/routeGroupGraphProjectionService.ts'))).toBe(false);
  });

  it('keeps Route Group facade identities delegated to the shared allocator', () => {
    const facade = readRepoFile('src/server/services/routeGroupGraphFacadeService.ts');

    expect(existsSync(resolve(repoRoot, 'src/server/services/routeGroupGraphAuthoringService.ts'))).toBe(false);
    expect(facade).toContain('createManagedRouteGraphElementId');
    expect(facade).not.toContain('createRouteBuilderMacroId');
    expect(facade).not.toContain('createRouteProductEndpointId');
    expect(facade).not.toContain('createRouteSupplyEndpointId');
  });

  it('stores proxy debug routing state as one runtime-native trace object', () => {
    const files = [
      'src/server/db/schema.ts',
      'src/server/services/proxyDebugTraceStore.ts',
      'src/server/services/proxyDebugTraceRuntime.ts',
      'src/server/proxy-core/orchestration/genericProxyOrchestrator.ts',
      'src/web/api.ts',
      'src/web/pages/ProxyLogs.tsx',
    ];
    const retired = [
      'endpointCandidatesJson',
      'endpointRuntimeStateJson',
      'routeRuntimeSummaryJson',
      'updateProxyDebugTraceCandidates',
      'safeUpdateSurfaceProxyDebugCandidates',
    ];
    const violations = files.flatMap((path) => {
      const text = readRepoFile(path);
      return retired.filter((term) => text.includes(term)).map((term) => `${path}: ${term}`);
    });
    expect(violations).toEqual([]);
    expect(readRepoFile('src/server/db/schema.ts')).toContain('runtimeTraceJson');
    expect(readRepoFile('src/server/services/proxyDebugTraceStore.ts')).toContain('updateProxyDebugTraceRuntime');
    expect(readRepoFile('src/web/api.ts')).toContain('runtimeTraceJson?: string | null');
  });

  it('keeps runtime boundary helpers off route-supply DTO naming', () => {
    const usageAggregation = readRepoFile('src/server/services/usageAggregationService.ts');
    const executionTargetRecoveryProbe = readRepoFile('src/server/services/executionTargetRecoveryProbeService.ts');
    const proxyRelayHarness = readRepoFile('src/testing/proxyRelayHarness.ts');
    const routeGroupMemberTestUtils = readRepoFile('src/testing/routeGroupMemberTestUtils.ts');

    const usageBlocks = [
      {
        label: 'usage aggregation log projection',
        text: sourceBlock(usageAggregation, 'type ProxyLogProjectionRow = {', 'type SiteDayUsageDeltaRow = {'),
      },
      {
        label: 'usage aggregation route runtime delta',
        text: sourceBlock(usageAggregation, 'type RouteRuntimeDayUsageDeltaRow = {', 'type ProjectionBatchDelta = {'),
      },
      {
        label: 'usage aggregation identity key',
        text: sourceBlock(usageAggregation, 'function buildRuntimeIdentityKey', 'function clearAnalyticsSnapshots'),
      },
    ];
    const strictBlocks = [
      {
        label: 'execution target recovery probe',
        text: executionTargetRecoveryProbe,
      },
      {
        label: 'proxy relay harness',
        text: proxyRelayHarness,
      },
    ];
    const oldRuntimeTerms = [
      'routeSupplyId',
      'routeExecutionTargetId',
      'routeExecutionTargetIds',
      'routeGraphVersionId',
      'disabledRuntimeExecutionTargetIds',
      'routeSupplyEndpointRef',
    ];
    const violations = [
      ...usageBlocks.flatMap(({ label, text }) => (
        oldRuntimeTerms
          .filter((pattern) => text.includes(pattern))
          .map((pattern) => `${label}: ${pattern}`)
      )),
      ...strictBlocks.flatMap(({ label, text }) => (
        oldRuntimeTerms
          .filter((pattern) => text.includes(pattern))
          .map((pattern) => `${label}: ${pattern}`)
      )),
    ];

    expect(violations).toEqual([]);
    expect(usageAggregation).toContain('runtimeEndpointId: schema.proxyLogs.runtimeEndpointId');
    expect(usageAggregation).toContain('executionTargetId: schema.proxyLogs.executionTargetId');
    expect(usageAggregation).toContain('runtimeEndpointId: row.runtimeEndpointId');
    expect(usageAggregation).toContain('executionTargetId: row.executionTargetId');
    expect(routeGroupMemberTestUtils).toContain('getExecutionTargetIdForMember');
  });

  it('keeps route execution scope off ambiguous candidate terminology', () => {
    const text = readRepoFile('src/server/services/routeExecutionScopeTypes.ts');
    const forbidden = [
      'RouteExecutionDispatcherArg',
      'selectedDispatcherArgRef',
      'allowedRouteGroupCandidateIds',
      'dispatcherArgs',
      'disabledDispatcherArgRefs',
      'disabledRouteGroupCandidateIds',
      'routeGroupCandidateIds',
      'RouteExecutionCandidate',
      'selectedCandidateId',
      'allowedCandidateIds',
      'candidates: RouteExecution',
      'disabledCandidateIds',
      'candidateIds:',
      'supplyCandidateId',
      'routeSupplyEndpointRef',
    ];
    const violations = forbidden
      .filter((pattern) => text.includes(pattern))
      .map((pattern) => `routeExecutionScopeTypes.ts: ${pattern}`);

    expect(violations).toEqual([]);
    expect(text).toContain('disabledExecutionAttemptIds');
    expect(text).toContain('disabledExecutionTargetIds');
    expect(text).toContain('runtimeArtifactId');
    expect(text).not.toContain('scopeId');
    expect(text).not.toContain('graphVersion');
  });

  it('keeps proxy log runtime usage scopes compiled-runtime native', () => {
    const routeRuntimeUsage = readRepoFile('src/server/services/routeRuntimeUsageService.ts');
    const webApi = readRepoFile('src/web/api.ts');
    const proxyLogs = readRepoFile('src/web/pages/ProxyLogs.tsx');
    const pagesI18n = readRepoFile('src/web/i18n/resources/pages.ts');
    const blocks = [
      {
        label: 'RouteRuntimeUsageSummary',
        text: sourceBlock(routeRuntimeUsage, 'export type RouteRuntimeUsageScope =', 'type AggregateRow = {'),
      },
      {
        label: 'ProxyLogRuntimeUsageSummary',
        text: sourceBlock(webApi, 'export type ProxyLogRuntimeUsageScope = {', 'export type ProxyRequestLogDetail = ProxyRequestLog & {'),
      },
      {
        label: 'RuntimeUsageSummaryBlock',
        text: sourceBlock(proxyLogs, 'function listRuntimeUsageScopes', 'function formatRuntimeUsageSuccessRate'),
      },
    ];
    const forbidden = [
      '| "target"',
      "| 'target'",
      'target: RouteRuntimeUsageScope',
      'target: ProxyLogRuntimeUsageScope',
      'runtimeUsage.target',
      'scope === "target"',
      'runtimeScopeTarget',
      'executionTargetId?: number',
    ];
    const violations = blocks.flatMap(({ label, text }) => (
      forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${label}: ${pattern}`)
    ));

    expect(violations).toEqual([]);
    expect(pagesI18n).not.toContain('pages.proxyLogs.runtimeScopeTarget');
    for (const block of blocks) {
      expect(block.text).toContain('executionAttempt');
      expect(block.text).toContain('endpoint');
      expect(block.text).toContain('entry');
    }
  });

  it('keeps marketplace, playground, and proxy logs frontend reads off source graph management APIs', () => {
    const files = [
      'src/web/pages/Models.tsx',
      'src/web/pages/ModelTester.tsx',
      'src/web/pages/ProxyLogs.tsx',
      'src/web/pages/models/ModelApiTab.tsx',
      'src/web/pages/models/ModelDetailsWorkspace.tsx',
      'src/web/pages/models/ModelOverviewTab.tsx',
      'src/web/pages/models/ModelPerformanceTab.tsx',
      'src/web/pages/models/modelDetailsView.ts',
      'src/web/components/ModelRouteFlow.tsx',
    ];
    const forbidden = [
      'api.getRouteGroup',
      'api.createRouteGroup',
      'api.updateRouteGroup',
      'api.deleteRouteGroup',
      'api.batchUpdateRouteGroups',
      'api.getRouteGraph',
      'api.publishRouteGraph',
      'api.updateRouteGraph',
      'api.getModelTokenCandidates',
      '/api/route-groups',
      '/api/route-graph',
      '/api/models/token-candidates',
      'route_candidate',
    ];
    const violations = files.flatMap((path) => {
      const text = readRepoFile(path);
      return forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
    expect(readRepoFile('src/web/pages/Models.tsx')).toContain('getModelsMarketplace');
    expect(readRepoFile('src/web/pages/ModelTester.tsx')).toContain('getModelRouteFlow');
    expect(readRepoFile('src/web/pages/ProxyLogs.tsx')).toContain('compiledRuntime');
  });

  it('keeps model route flow reads behind the compiled runtime read model', () => {
    const text = readRepoFile('src/server/services/routeFlowService.ts');
    const forbidden = [
      'routeRuntimeEvaluatorService',
      'evaluateActiveRouteRuntimeForModel',
      'getActiveRouteGraphRuntimeVersion',
      'ensureActiveRouteGraphVersion',
    ];
    const violations = forbidden.filter((pattern) => text.includes(pattern));

    expect(violations).toEqual([]);
    expect(text).toContain('buildRouteRuntimeProjection');
  });

  it('keeps route-group wrapper scope out of compiled runtime artifacts and selection metadata', () => {
    const files = [
      'src/server/services/routeRuntimeArtifactService.ts',
      'src/server/services/routeRuntimeExecutionService.ts',
      'src/server/services/routeRuntimeDecisionSnapshotService.ts',
      'src/shared/routeRuntimeSnapshot.js',
      'src/shared/routeRuntimeSnapshot.d.ts',
    ];
    const forbidden = [
      'routeGroupScopes',
      'metadata.plan.routeGroupIds',
      'routeGroupIds } : planMetadata',
      'routeGroupIds.length > 0 ? { ...planMetadata',
    ];
    const violations = files.flatMap((path) => {
      const text = readRepoFile(path);
      return forbidden
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => `${path}: ${pattern}`);
    });

    expect(violations).toEqual([]);
    const downstreamPolicySource = readRepoFile('src/server/services/downstreamApiKeyService.ts');
    const compiledInventorySource = readRepoFile('src/server/services/compiledRuntimeInventoryService.ts');
    expect(downstreamPolicySource).toContain('allowedPlanIds');
    expect(downstreamPolicySource).not.toContain('routeGroups');
    expect(compiledInventorySource).not.toContain('routeGroups');
  });
});
