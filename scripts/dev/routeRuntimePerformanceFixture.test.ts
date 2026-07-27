import { describe, expect, it } from 'vitest';

import { compileRouteGraphSource } from '../../src/shared/routeGraph.js';
import {
  buildComplexRouteGraphSourceFixture,
  complexRouteGraphModelName,
  type SeededRouteRuntimeEndpointRoute,
} from './routeRuntimePerformanceFixture.js';

describe('route runtime performance fixture', () => {
  it('builds a real complex active route graph fixture for memory gates', () => {
    const sourceEndpointRoutes: SeededRouteRuntimeEndpointRoute[] = Array.from({ length: 8 }, (_, index) => ({
      publicModelName: `perf-group-${index}`,
      upstreamModelName: `perf-source-${index}`,
      executionTargetId: index + 101,
      routeEndpointId: `fixture-endpoint-${index}`,
    }));

    const source = buildComplexRouteGraphSourceFixture({
      sourceEndpointRoutes,
      accountId: 1,
      tokenId: 2,
      groupCount: 4,
      fallbackStageCount: 3,
      endpointsPerFallbackStage: 2,
    });

    expect(source.macros).toHaveLength(4);
    expect(source.macros?.[0]?.config.groups).toHaveLength(3);
    expect(source.macros?.[0]).toMatchObject({
      kind: 'candidate_selector',
      ownership: 'manual',
      config: {
        surface: {
          entry: {
            kind: 'external',
            match: { displayName: complexRouteGraphModelName(0) },
          },
        },
        policy: { kind: 'builtin', builtin: 'weighted' },
      },
    });
    expect(JSON.stringify(source)).not.toContain('"priority"');
    expect(JSON.stringify(source)).not.toContain('"routingStrategy"');
    expect(JSON.stringify(source)).not.toContain('"bucketId"');

    const compiled = compileRouteGraphSource(source, { includePrimitiveSource: false });

    expect(compiled.ok).toBe(true);
    expect(compiled.compiled.compiledRouterBundle).not.toHaveProperty('version');
    expect(compiled.compiled.compiledRouterBundle?.plans).toHaveLength(4);
    expect(compiled.compiled.compiledRouterBundle?.plans[0]?.executionAlternatives).toHaveLength(6);
    expect(JSON.stringify(compiled.compiled)).not.toContain('"programBundle"');
    expect(JSON.stringify(compiled.compiled)).not.toContain('"flatProgramBundle"');
  });

  it('uses the runtime execution-key registry field rather than the retired supply key', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(
      new URL('./routeRuntimePerformanceFixture.ts', import.meta.url),
      'utf8',
    ));
    expect(source).toContain('executionKey');
    expect(source).not.toContain('supplyKey');
  });
});
