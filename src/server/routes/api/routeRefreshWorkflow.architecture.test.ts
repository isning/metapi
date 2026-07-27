import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function expectNoDirectModelServiceRouteRefresh(source: string): void {
  expect(source).not.toMatch(/import\s*\{[^}]*\brefreshModelsAndRebuildRoutes\b[^}]*\}\s*from\s*['"][^'"]*modelService\.js['"]/m);
  expect(source).not.toMatch(/import\s*\{[^}]*\brebuildManagedRouteGroupsFromAvailability\b[^}]*\}\s*from\s*['"][^'"]*modelService\.js['"]/m);
}

function expectImportsRouteRefreshWorkflow(source: string): void {
  expect(source).toMatch(
    /import\s+\*\s+as\s+routeRefreshWorkflow\s+from\s+['"][^'"]*routeRefreshWorkflow\.js['"]/m,
  );
}

function expectCallsCompiledRuntimeSelection(source: string): void {
  expect(source).toMatch(
    /\bselect(?:Proxy|Surface)ExecutionAttempt\s*\(|\bselectSurfaceRuntimeDecision(?:InSession)?\s*\(/,
  );
}

function expectCallsRebuildRoutesOnly(source: string): void {
  expect(source).toMatch(/\brouteRefreshWorkflow\.rebuildRoutesOnly\s*\(/);
}

describe('route refresh workflow architecture boundaries', () => {
  it('keeps api controllers on the shared route refresh workflow instead of modelService', () => {
    const routeGroupRoutesSource = readSource('./routeGroupRoutes.ts');
    const compositionRootSource = readSource('./tokens.ts');
    const settingsSource = readSource('./settings.ts');
    const statsSource = readSource('./stats.ts');

    for (const source of [routeGroupRoutesSource, settingsSource, statsSource]) {
      expectImportsRouteRefreshWorkflow(source);
      expectNoDirectModelServiceRouteRefresh(source);
    }

    expectNoDirectModelServiceRouteRefresh(compositionRootSource);
    expect(compositionRootSource).not.toContain('routeRefreshWorkflow');
    expectCallsRebuildRoutesOnly(routeGroupRoutesSource);
    expectCallsRebuildRoutesOnly(statsSource);
  });

  it('keeps proxy fallback refreshes and scheduler hooks on the route refresh workflow', () => {
    const completionsSource = readSource('../../proxy-core/formats/completions.ts');
    const embeddingsSource = readSource('../../proxy-core/formats/embeddings.ts');
    const imagesSource = readSource('../proxy/images.ts');
    const imagesSurfaceSource = readSource('../../proxy-core/surfaces/imagesEditProxySurface.ts');
    const modelsRouteSource = readSource('../proxy/models.ts');
    const searchSource = readSource('../proxy/search.ts');
    const searchSurfaceSource = readSource('../../proxy-core/surfaces/searchProxySurface.ts');
    const videosSource = readSource('../proxy/videos.ts');
    const videoSurfaceSource = readSource('../../proxy-core/surfaces/videoProxySurface.ts');
    const compiledSurfaceRunnerSource = readSource('../../proxy-core/orchestration/compiledHttpSurfaceRunner.ts');
    const schedulerSource = readSource('../../services/checkinScheduler.ts');
    const oauthServiceSource = readSource('../../services/oauth/service.ts');
    const sharedOrchestrationSource = readSource('../../proxy-core/orchestration/sharedProxyOrchestration.ts');
    const genericOrchestratorSource = readSource('../../proxy-core/orchestration/genericProxyOrchestrator.ts');
    const modelListOrchestratorSource = readSource('../../proxy-core/orchestration/modelListOrchestrator.ts');
    const geminiAdapterSource = readSource('../../proxy-core/formats/gemini.ts');

    for (const source of [schedulerSource, oauthServiceSource]) {
      expectImportsRouteRefreshWorkflow(source);
      expectNoDirectModelServiceRouteRefresh(source);
    }

    for (const source of [
      completionsSource,
      embeddingsSource,
      imagesSource,
      modelsRouteSource,
      searchSource,
      videosSource,
      sharedOrchestrationSource,
      modelListOrchestratorSource,
    ]) {
      expectNoDirectModelServiceRouteRefresh(source);
    }

    for (const source of [sharedOrchestrationSource, genericOrchestratorSource, compiledSurfaceRunnerSource]) {
      expectCallsCompiledRuntimeSelection(source);
    }
    expect(imagesSource).toContain('executeImagesEditProxySurface');
    expect(searchSource).toContain('executeSearchProxySurface');
    expect(videosSource).toContain('executeVideoCreateProxySurface');
    for (const source of [imagesSurfaceSource, searchSurfaceSource, videoSurfaceSource]) {
      expect(source).toContain('executeCompiledHttpSurface');
    }

    expect(modelListOrchestratorSource).not.toContain('routeRefreshWorkflow');
    expect(modelListOrchestratorSource).not.toContain('refreshModelsAndRebuildRoutes');
    expect(modelListOrchestratorSource).not.toContain('rebuildRoutesOnly');
    expect(modelListOrchestratorSource).not.toContain('modelService.js');
    expect(modelListOrchestratorSource).toMatch(/\bselectModelListTarget\s*\(/);
    expect(modelListOrchestratorSource).toContain('previewRouteRuntimeDecision');
    expect(modelListOrchestratorSource).toContain('compiledRuntimeInventoryService.js');
    expect(modelListOrchestratorSource).toContain('listActiveCompiledRuntimeModelEntrypoints');
    expect(modelListOrchestratorSource).not.toContain('routeGraphService.js');
    expect(modelListOrchestratorSource).not.toContain('ensureActiveRouteGraphVersion');
    expect(modelListOrchestratorSource).not.toContain('routeTableProjectionService.js');
    expect(geminiAdapterSource).toContain('modelListModelProbes: GEMINI_MODEL_PROBES');
  });

  it('keeps full availability route rebuilds out of the synchronous server startup path', () => {
    const serverEntrySource = readSource('../../index.ts');

    expect(serverEntrySource).not.toMatch(/\brouteRefreshWorkflow\.rebuildRoutesOnly\s*\(/);
    expect(serverEntrySource).not.toMatch(/\brouteRefreshWorkflow\.refreshModelsAndRebuildRoutes\s*\(/);
    expect(serverEntrySource).not.toContain('syncRouteBindingProjectionsFromRouteTable');
    expect(serverEntrySource).not.toContain('ensureActiveRouteGraphVersion');
    expect(serverEntrySource).not.toContain('syncRouteBindingProjectionsFromRouteGraphSource');
  });
});
