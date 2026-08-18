import { describe, expect, it } from 'vitest';
import {
  normalizeEntryAffinityConfig,
  normalizeGlobalRouteAffinityPolicy,
  normalizeRouteAffinityPolicy,
  resolveRouteAffinityPolicy,
  validateEntryAffinityConfig,
} from './routeAffinity.js';

describe('route affinity contract', () => {
  it('defaults source policies to inheritance and global policies to disabled', () => {
    expect(normalizeRouteAffinityPolicy(null)).toEqual({ kind: 'inherit_default' });
    expect(normalizeGlobalRouteAffinityPolicy({ kind: 'inherit_default' })).toEqual({ kind: 'disabled' });
    expect(resolveRouteAffinityPolicy({ kind: 'inherit_default' }, {
      kind: 'pool',
      ttlSec: 60,
      crossPoolFallback: 'temporary',
    })).toEqual({ kind: 'pool', ttlSec: 60, crossPoolFallback: 'temporary' });
  });

  it('normalizes entry-local pool membership by stable source reference', () => {
    expect(normalizeEntryAffinityConfig({
      policy: { kind: 'pool', ttlSec: 90, crossPoolFallback: 'promote_on_success' },
      pools: [{
        id: 'shared-a',
        members: [
          { kind: 'execution_target', sourceRef: ' target-a ' },
          { kind: 'execution_target', sourceRef: 'target-a' },
          { kind: 'other', sourceRef: 'ignored' },
        ],
      }],
    })).toEqual({
      policy: { kind: 'pool', ttlSec: 90, crossPoolFallback: 'promote_on_success' },
      pools: [{ id: 'shared-a', members: [{ kind: 'execution_target', sourceRef: 'target-a' }] }],
    });
  });

  it('rejects duplicate pool ids and cross-pool target membership', () => {
    expect(validateEntryAffinityConfig({
      pools: [
        { id: 'a', members: [{ kind: 'execution_target', sourceRef: 'target-a' }] },
        { id: 'a', members: [{ kind: 'execution_target', sourceRef: 'target-b' }] },
        { id: 'b', members: [{ kind: 'execution_target', sourceRef: 'target-a' }] },
      ],
    })).toEqual([
      'Affinity pool id a is duplicated.',
      'Execution target target-a belongs to more than one affinity pool.',
    ]);
  });

  it('always materializes a bounded TTL for malformed source policies', () => {
    expect(normalizeRouteAffinityPolicy({ kind: 'target', ttlSec: 0, crossTargetFallback: 'deny' })).toEqual({
      kind: 'target',
      ttlSec: 1800,
      crossTargetFallback: 'deny',
    });
  });
});
