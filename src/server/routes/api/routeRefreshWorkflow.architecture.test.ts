import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function expectNoDirectModelServiceRouteRefresh(source: string): void {
  expect(source).not.toMatch(/import\s*\{[^}]*\brefreshModelsAndRebuildRoutes\b[^}]*\}\s*from\s*['"][^'"]*modelService\.js['"]/m);
  expect(source).not.toMatch(/import\s*\{[^}]*\brebuildTokenRoutesFromAvailability\b[^}]*\}\s*from\s*['"][^'"]*modelService\.js['"]/m);
}

function expectImportsRouteRefreshWorkflow(source: string): void {
  expect(source).toMatch(
    /import\s+\*\s+as\s+routeRefreshWorkflow\s+from\s+['"][^'"]*routeRefreshWorkflow\.js['"]/m,
  );
}

function expectCallsSelectProxyTargetForAttempt(source: string): void {
  expect(source).toMatch(/\bselect(?:Proxy|Surface)TargetForAttempt\s*\(/);
}

function expectCallsRebuildRoutesOnly(source: string): void {
  expect(source).toMatch(/\brouteRefreshWorkflow\.rebuildRoutesOnly\s*\(/);
}

describe('route refresh workflow architecture boundaries', () => {
  it('keeps api controllers on the shared route refresh workflow instead of modelService', () => {
    const tokensSource = readSource('./tokens.ts');
    const settingsSource = readSource('./settings.ts');
    const statsSource = readSource('./stats.ts');

    for (const source of [tokensSource, settingsSource, statsSource]) {
      expectImportsRouteRefreshWorkflow(source);
      expectNoDirectModelServiceRouteRefresh(source);
    }

    expectCallsRebuildRoutesOnly(tokensSource);
    expectCallsRebuildRoutesOnly(statsSource);
  });

  it('keeps proxy fallback refreshes and scheduler hooks on the route refresh workflow', () => {
    const completionsSource = readSource('../../proxy-core/formats/completions.ts');
    const embeddingsSource = readSource('../../proxy-core/formats/embeddings.ts');
    const imagesSource = readSource('../proxy/images.ts');
    const modelsRouteSource = readSource('../proxy/models.ts');
    const searchSource = readSource('../proxy/search.ts');
    const videosSource = readSource('../proxy/videos.ts');
    const schedulerSource = readSource('../../services/checkinScheduler.ts');
    const oauthServiceSource = readSource('../../services/oauth/service.ts');
    const sharedOrchestrationSource = readSource('../../proxy-core/orchestration/sharedProxyOrchestration.ts');
    const genericOrchestratorSource = readSource('../../proxy-core/orchestration/genericProxyOrchestrator.ts');
    const modelListOrchestratorSource = readSource('../../proxy-core/orchestration/modelListOrchestrator.ts');
    const geminiAdapterSource = readSource('../../proxy-core/formats/gemini.ts');
    const targetSelectionSource = readSource('../../proxy-core/targetSelection.ts');

    for (const source of [schedulerSource, oauthServiceSource, targetSelectionSource]) {
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

    for (const source of [
      imagesSource,
      searchSource,
      videosSource,
      sharedOrchestrationSource,
      genericOrchestratorSource,
    ]) {
      expectCallsSelectProxyTargetForAttempt(source);
    }

    expectImportsRouteRefreshWorkflow(modelListOrchestratorSource);
    expect(modelListOrchestratorSource).toMatch(/\bselectModelListTarget\s*\(/);
    expect(geminiAdapterSource).toContain('modelListModelProbes: GEMINI_MODEL_PROBES');
  });
});
