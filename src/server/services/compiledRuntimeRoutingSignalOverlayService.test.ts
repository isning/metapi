import { describe, expect, it } from 'vitest';
import type { CompiledExecutionAlternative, CompiledRouterPlan } from '../../shared/compiledRuntime.js';
import { compiledRuntimeSignalAttemptFromAlternative } from './compiledRuntimeRoutingSignalOverlayService.js';

function alternative(overrides: Partial<CompiledExecutionAlternative['executionAttempt']> = {}): CompiledExecutionAlternative {
  return {
    alternativeId: 'alt:a',
    kind: 'execution_attempt',
    enabled: true,
    filterStageIndexes: [],
    selectionTerms: [{
      termId: 'dispatcher:a',
      nodeId: 'dispatcher:a',
      mode: 'execution_attempt',
      policy: { kind: 'builtin', builtin: 'weighted' },
      optionId: 'a',
      optionIndex: 0,
      optionKind: 'route',
      enabled: true,
      weight: 10,
      order: 0,
      sourceRef: {},
    }],
    terminal: {
      kind: 'supply',
      endpointId: 'endpoint:a',
      nodeId: 'endpoint:a',
      sourceRef: {},
    },
    endpoint: null,
    executionAttempt: {
      endpointId: 'endpoint:a',
      executionAttemptId: 'opaque-attempt:a',
      targetId: 'target:a',
      nodeId: 'endpoint:a',
      model: 'upstream-a',
      modelSource: 'fixed',
      enabled: true,
      siteId: 1,
      accountId: 11,
      tokenId: 111,
      weight: 10,
      transportBinding: { kind: 'execution_target', executionTargetId: 101 },
      sourceRef: {},
      ...overrides,
    },
    syntheticResponse: null,
  };
}

const plan: Pick<CompiledRouterPlan, 'id' | 'entryNodeId' | 'publicModelName'> = {
  id: 'plan:public-model',
  entryNodeId: 'entry:public-model',
  publicModelName: 'public-model',
};

describe('compiledRuntimeSignalAttemptFromAlternative', () => {
  it('does not derive a fixed attempt model from the plan public model', () => {
    const attempt = compiledRuntimeSignalAttemptFromAlternative({
      alternative: alternative({ model: '' }),
      plan,
      index: 0,
    });

    expect(attempt).toBeNull();
  });

  it('uses the plan public model only for explicit request-model attempts', () => {
    const attempt = compiledRuntimeSignalAttemptFromAlternative({
      alternative: alternative({ model: '', modelSource: 'request' }),
      plan,
      index: 0,
    });

    expect(attempt).toMatchObject({
      executionAttemptId: 'opaque-attempt:a',
      executionTargetId: 101,
      model: 'public-model',
    });
  });
});
