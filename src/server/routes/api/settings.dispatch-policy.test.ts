import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getRouteRuntimeCacheStats, setCachedActiveRouteRuntimeArtifact } from '../../services/routeRuntimeCacheService.js';

describe('settings dispatch policy APIs', () => {
  let app: FastifyInstance;
  let dataDir = '';

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-dispatch-policy-api-'));
    process.env.DATA_DIR = dataDir;
    const migrate = await import('../../db/migrate.js');
    await migrate.runSqliteMigrations();
    const routes = await import('./dispatchPolicyRoutes.js');
    const settings = await import('./settings.js');
    const runtime = await import('./routeRuntimeRoutes.js');
    app = Fastify();
    await app.register(routes.dispatchPolicyRoutes);
    await app.register(settings.settingsRoutes);
    await app.register(runtime.routeRuntimeRoutes);
  });

  afterAll(async () => { await app.close(); delete process.env.DATA_DIR; });

  it('validates CEL policy definitions and simulates without state mutation', async () => {
    const policy = { id: 'cost', name: 'Cost', kind: 'cel', selectionMode: 'weighted', contributionExpression: 'runtime.routingSignals.normalizedCostScore' };
    const validation = await app.inject({ method: 'POST', url: '/api/dispatch-policies/validate', payload: { policy } });
    expect(validation.statusCode).toBe(200);
    expect(validation.json()).toMatchObject({ success: true, errors: [] });

    const simulation = await app.inject({ method: 'POST', url: '/api/dispatch-policies/simulate', payload: {
      mode: 'synthetic',
      policy: { kind: 'inline', policy },
      options: [
        { id: 'a', runtime: { routingSignals: { normalizedCostScore: 0.2 } } },
        { id: 'b', runtime: { routingSignals: { normalizedCostScore: 0.8 } } },
      ],
    } });
    expect(simulation.statusCode).toBe(200);
    expect(simulation.json()).toMatchObject({ success: true, simulation: { selectedOptionId: 'b', options: [expect.objectContaining({ id: 'a', probability: 0.2 }), expect.objectContaining({ id: 'b', probability: 0.8 })] } });
  });

  it('returns validation errors and rejects simulations without compiled options', async () => {
    const validation = await app.inject({ method: 'POST', url: '/api/dispatch-policies/validate', payload: { policy: { id: 'bad', name: 'Bad', kind: 'cel', selectionMode: 'weighted' } } });
    expect(validation.statusCode).toBe(400);
    expect(validation.json().errors).toEqual(expect.any(Array));
    const simulation = await app.inject({ method: 'POST', url: '/api/dispatch-policies/simulate', payload: { mode: 'synthetic', policy: { kind: 'inherit_default' } } });
    expect(simulation.statusCode).toBe(400);
  });

  it('uses only the strict policy API and preserves falsy request payload roots', async () => {
    const oldRoute = await app.inject({
      method: 'POST',
      url: '/api/settings/dispatch-policies/validate',
      payload: {},
    });
    expect(oldRoute.statusCode).toBe(404);

    const nullRequest = await app.inject({
      method: 'POST',
      url: '/api/dispatch-policies/simulate',
      payload: {
        mode: 'synthetic',
        policy: { kind: 'inherit_default' },
        options: [{ id: 'a' }],
        request: null,
      },
    });
    expect(nullRequest.statusCode).toBe(400);
    expect(nullRequest.json()).toMatchObject({ success: false, code: 'invalid_request' });

    const falsyPayload = await app.inject({
      method: 'POST',
      url: '/api/dispatch-policies/simulate',
      payload: {
        mode: 'synthetic',
        policy: {
          kind: 'inline',
          policy: {
            id: 'falsy',
            name: 'Falsy payload',
            kind: 'cel',
            selectionMode: 'weighted',
            contributionExpression: 'request.payload == false ? self.weight : 0.0',
          },
        },
        options: [{ id: 'a', weight: 1 }, { id: 'b', weight: 3 }],
        request: { payload: false },
      },
    });
    expect(falsyPayload.statusCode).toBe(200);
    expect(falsyPayload.json().simulation.options.map((option: { probability: number }) => option.probability))
      .toEqual([0.25, 0.75]);
  });

  it('invalidates the production runtime cache when the policy registry changes', async () => {
    setCachedActiveRouteRuntimeArtifact('runtime-artifact-99', { id: 99 });
    const before = getRouteRuntimeCacheStats().generation;
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/runtime',
      payload: {
        dispatchPolicyRegistry: {
          defaultPolicyId: 'stable',
          policies: [{ id: 'stable', name: 'Stable', kind: 'builtin', selectionMode: 'ordered', builtin: 'stable_first' }],
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(getRouteRuntimeCacheStats()).toMatchObject({
      generation: before + 1,
      activeRuntime: { present: false },
      lastInvalidation: { reason: 'routing-weights-mutated' },
    });
  });

  it('exposes runtime cache status and refreshes it through a background task', async () => {
    setCachedActiveRouteRuntimeArtifact('runtime-artifact-77', { id: 77 });
    const status = await app.inject({ method: 'GET', url: '/api/route-runtime/cache' });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      ttlMs: expect.any(Number),
      activeRuntime: { present: true, artifactId: 'runtime-artifact-77' },
    });
    const generation = getRouteRuntimeCacheStats().generation;
    const refresh = await app.inject({ method: 'POST', url: '/api/route-runtime/cache/refresh' });
    expect(refresh.statusCode).toBe(202);
    expect(refresh.json()).toMatchObject({ success: true, jobId: expect.any(String) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getRouteRuntimeCacheStats().generation).toBeGreaterThan(generation);
  });
});
