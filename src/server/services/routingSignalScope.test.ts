import { describe, expect, it } from 'vitest';
import {
  collectCompiledRuntimeRoutingSignalSharedTermIds,
  compiledRuntimeRoutingSignalScopeId,
} from './compiledRuntimeRoutingSignalScope.js';

describe('compiled runtime routing signal scopes', () => {
  it('uses the shared dispatcher term for alternatives selected by one dispatcher', () => {
    const alternatives = [
      { selectionTerms: [{ termId: 'entry', mode: 'route' }, { termId: 'dispatcher', mode: 'execution_attempt' }] },
      { selectionTerms: [{ termId: 'entry', mode: 'route' }, { termId: 'dispatcher', mode: 'execution_attempt' }] },
    ];
    const sharedTermIds = collectCompiledRuntimeRoutingSignalSharedTermIds(alternatives);

    expect(compiledRuntimeRoutingSignalScopeId({
      planId: 'plan-1',
      selectionTerms: alternatives[0]?.selectionTerms,
      sharedTermIds,
    })).toBe('plan-1:dispatcher');
  });

  it('gives a direct execution attempt a stable scope when no selection term exists', () => {
    expect(compiledRuntimeRoutingSignalScopeId({ planId: 'plan-1', selectionTerms: [] }))
      .toBe('plan-1:execution_attempt');
  });
});
