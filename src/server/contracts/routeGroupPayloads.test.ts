import { describe, expect, it } from 'vitest';
import { parseRouteGroupCreatePayload, parseRouteGroupFallbackStagePayload } from './routeGroupPayloads.js';

describe('route group payloads', () => {
  it('accepts complete inline CEL policies', () => {
    expect(parseRouteGroupCreatePayload({
      model: { publicName: 'model-a' },
      dispatcherPolicy: {
        kind: 'inline',
        policy: {
          id: 'inline-a', name: 'Inline A', kind: 'cel', selectionMode: 'weighted',
          eligibilityExpression: 'true', contributionExpression: '0.5',
        },
      },
    })).toMatchObject({ success: true });
  });

  it('rejects malformed fallback-stage dispatcher policies at the command boundary', () => {
    expect(parseRouteGroupFallbackStagePayload({
      dispatcherPolicy: { kind: 'builtin', builtin: 'weighted', priority: 1 },
    }).success).toBe(false);
    expect(parseRouteGroupFallbackStagePayload({
      dispatcherPolicy: { kind: 'registry', policyId: 'cost-aware' },
      placement: { afterStageId: 'stage-a', candidateId: 'member-a' },
    }).success).toBe(true);
  });

  it('rejects unknown nested policy and presentation fields', () => {
    expect(parseRouteGroupCreatePayload({
      model: { publicName: 'model-a' },
      dispatcherPolicy: { kind: 'builtin', builtin: 'weighted', priority: 1 },
    })).toMatchObject({ success: false });
    expect(parseRouteGroupCreatePayload({
      model: { publicName: 'model-a' },
      presentation: { displayName: 'A', iconName: 'unknown' },
    })).toMatchObject({ success: false });
  });

  it('accepts valid failure backoff overrides and rejects invalid levels', () => {
    expect(parseRouteGroupCreatePayload({
      model: { publicName: 'model-a' },
      failureBackoff: { mode: 'custom', policy: { failureThreshold: 2, levelsSec: [0, 10, 60], maxSec: 60 } },
    })).toMatchObject({ success: true });
    expect(parseRouteGroupCreatePayload({
      model: { publicName: 'model-a' },
      failureBackoff: { mode: 'custom', policy: { failureThreshold: 2, levelsSec: [60, 10], maxSec: 60 } },
    })).toMatchObject({ success: false });
    expect(parseRouteGroupCreatePayload({
      model: { publicName: 'model-a' },
      failureBackoff: { mode: 'custom', policy: { failureThreshold: 2, levelsSec: [0, 61], maxSec: 60 } },
    })).toMatchObject({ success: false });
  });

  it('accepts Entry-scoped affinity policies and pools', () => {
    expect(parseRouteGroupCreatePayload({
      model: { publicName: 'model-a' },
      affinity: {
        policy: { kind: 'pool', ttlSec: 300, crossPoolFallback: 'promote_on_success' },
        pools: [{ id: 'primary', members: [{ kind: 'execution_target', sourceRef: 'target-a' }] }],
      },
    })).toMatchObject({ success: true });
  });
});
