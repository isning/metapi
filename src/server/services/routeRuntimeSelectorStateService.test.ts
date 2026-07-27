import { beforeEach, describe, expect, it } from 'vitest';
import {
  commitRouteRuntimeSelectorStateProposal,
  createRouteRuntimeSelectorStateProposal,
  getRouteRuntimeSelectorStateStore,
  invalidateRouteRuntimeSelectorState,
} from './routeRuntimeSelectorStateService.js';

describe('routeRuntimeSelectorStateService', () => {
  beforeEach(() => invalidateRouteRuntimeSelectorState());

  it('reuses selector state only for the same immutable runtime version', () => {
    const first = getRouteRuntimeSelectorStateStore(11);
    first['dispatcher:round-robin'] = 3;

    expect(getRouteRuntimeSelectorStateStore(11)).toBe(first);
    expect(getRouteRuntimeSelectorStateStore(11)).toEqual({
      'dispatcher:round-robin': 3,
    });

    const nextVersion = getRouteRuntimeSelectorStateStore(12);
    expect(nextVersion).not.toBe(first);
    expect(nextVersion).toEqual({});
  });

  it('commits one proposal and rejects another proposal from the same stale base', () => {
    const first = createRouteRuntimeSelectorStateProposal(31);
    const second = createRouteRuntimeSelectorStateProposal(31);
    first.proposed['selector:a:round_robin'] = 1;
    second.proposed['selector:a:round_robin'] = 1;

    expect(commitRouteRuntimeSelectorStateProposal(first)).toBe(true);
    expect(commitRouteRuntimeSelectorStateProposal(second)).toBe(false);
    expect(getRouteRuntimeSelectorStateStore(31)).toEqual({ 'selector:a:round_robin': 1 });
  });

  it('commits independent selector keys without treating the full artifact state as conflicting', () => {
    const first = createRouteRuntimeSelectorStateProposal(41);
    const second = createRouteRuntimeSelectorStateProposal(41);
    first.proposed['selector:a:round_robin'] = 1;
    second.proposed['selector:b:round_robin'] = 1;

    expect(commitRouteRuntimeSelectorStateProposal(first)).toBe(true);
    expect(commitRouteRuntimeSelectorStateProposal(second)).toBe(true);
    expect(getRouteRuntimeSelectorStateStore(41)).toEqual({
      'selector:a:round_robin': 1,
      'selector:b:round_robin': 1,
    });
  });

  it('exposes committed state through enumeration while keeping writes private until commit', () => {
    const state = getRouteRuntimeSelectorStateStore(51);
    state.existing = 1;
    const proposal = createRouteRuntimeSelectorStateProposal(51);
    proposal.proposed.next = 2;

    expect({ ...proposal.proposed }).toEqual({ existing: 1, next: 2 });
    expect(state).toEqual({ existing: 1 });
    expect(commitRouteRuntimeSelectorStateProposal(proposal)).toBe(true);
    expect(state).toEqual({ existing: 1, next: 2 });
  });

  it('drops all selector state when runtime caches are invalidated', () => {
    const beforeInvalidation = getRouteRuntimeSelectorStateStore(21);
    beforeInvalidation.cursor = 8;

    invalidateRouteRuntimeSelectorState();

    const afterInvalidation = getRouteRuntimeSelectorStateStore(21);
    expect(afterInvalidation).not.toBe(beforeInvalidation);
    expect(afterInvalidation).toEqual({});
  });
});
