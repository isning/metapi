import { describe, expect, it } from 'vitest';

import { compileRouteGraphSource } from '../../src/shared/routeGraph.js';
import {
  buildComplexRouteGraphSourceFixture,
  complexRouteGraphModelName,
  type SeededRouteRuntimeRoute,
} from './routeRuntimePerformanceFixture.js';

describe('route runtime performance fixture', () => {
  it('builds a real complex active route graph fixture for memory gates', () => {
    const sourceRoutes: SeededRouteRuntimeRoute[] = Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      displayName: `perf-source-${index}`,
      targetId: index + 101,
    }));

    const source = buildComplexRouteGraphSourceFixture({
      sourceRoutes,
      accountId: 1,
      tokenId: 2,
      groupCount: 4,
      candidateGroupsPerModel: 3,
      endpointsPerCandidateGroup: 2,
    });

    expect(source.macros).toHaveLength(4);
    expect(source.macros?.[0]).toMatchObject({
      kind: 'candidate_selector',
      visibility: 'public',
      ownership: 'manual',
      config: {
        surface: {
          entry: {
            kind: 'external',
            visibility: 'public',
            match: { displayName: complexRouteGraphModelName(0) },
          },
        },
        policy: { strategy: 'priority_order' },
      },
    });

    const compiled = compileRouteGraphSource(source, {
      includeLegacyBundles: false,
      includePrimitiveSource: false,
    });

    expect(compiled.ok).toBe(true);
    expect(compiled.compiled.compiledRouterBundle?.version).toBe(2);
    expect(compiled.compiled.compiledRouterBundle?.plans).toHaveLength(4);
    expect(compiled.compiled.compiledRouterBundle?.plans[0]?.candidates).toHaveLength(6);
    expect(JSON.stringify(compiled.compiled)).not.toContain('"programBundle"');
    expect(JSON.stringify(compiled.compiled)).not.toContain('"flatProgramBundle"');
  });
});
