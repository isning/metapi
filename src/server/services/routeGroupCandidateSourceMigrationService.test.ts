import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getActiveMock, publishMock } = vi.hoisted(() => ({
  getActiveMock: vi.fn(),
  publishMock: vi.fn(),
}));

vi.mock('./routeGraphService.js', () => ({
  getActiveRouteGraphSourceVersion: (...args: unknown[]) => getActiveMock(...args),
  publishRouteGraphSource: (...args: unknown[]) => publishMock(...args),
}));

describe('automatic Route Group candidate source migration', () => {
  beforeEach(() => {
    getActiveMock.mockReset();
    publishMock.mockReset();
  });

  it('publishes a normalized active graph once and is a no-op after migration', async () => {
    const sourceGraph = {
      nodes: [],
      edges: [],
      macros: [{
        id: 'automatic:model-a',
        kind: 'candidate_selector',
        ownership: 'system',
        enabled: true,
        config: {
          surface: { entry: { kind: 'none' }, output: 'route' },
          policy: { kind: 'inherit_default' },
          candidateSource: { kind: 'model_pattern', pattern: 'model-a' },
          groups: [{
            id: 'primary',
            enabled: true,
            input: { kind: 'synthetic', statusCode: 503 },
            members: [{ memberId: 'member:a', endpointId: 'endpoint:a' }],
          }],
        },
      }],
    };
    getActiveMock.mockResolvedValueOnce({ sourceGraph });
    publishMock.mockResolvedValueOnce({ ok: true, version: { version: 12 }, diagnostics: [] });

    const { migrateAutomaticRouteGroupCandidateSources } = await import('./routeGroupCandidateSourceMigrationService.js');
    await expect(migrateAutomaticRouteGroupCandidateSources()).resolves.toEqual({
      migratedRouteGroups: 1,
      publishedVersion: 12,
    });
    const publishedSource = publishMock.mock.calls[0]?.[0]?.sourceGraph;
    expect(publishedSource.macros[0].config).not.toHaveProperty('candidateSource');

    getActiveMock.mockResolvedValueOnce({ sourceGraph: publishedSource });
    await expect(migrateAutomaticRouteGroupCandidateSources()).resolves.toEqual({
      migratedRouteGroups: 0,
      publishedVersion: null,
    });
    expect(publishMock).toHaveBeenCalledTimes(1);
  });
});
