import { describe, expect, it } from 'vitest';

import { withAdminAuthorization } from './e2eApiHeaders.js';

describe('e2e api headers', () => {
  it('injects the admin bearer token', () => {
    expect(withAdminAuthorization('admin-token')).toEqual({
      Authorization: 'Bearer admin-token',
    });
  });

  it('preserves non-auth headers', () => {
    expect(withAdminAuthorization('admin-token', {
      accept: 'application/json',
      'x-test-scenario': 'route-graph',
    })).toEqual({
      accept: 'application/json',
      'x-test-scenario': 'route-graph',
      Authorization: 'Bearer admin-token',
    });
  });

  it('prevents caller-provided authorization from overriding the admin token', () => {
    expect(withAdminAuthorization('admin-token', {
      authorization: 'Bearer wrong-token',
      Authorization: 'Bearer also-wrong',
    })).toEqual({
      Authorization: 'Bearer admin-token',
    });
  });
});
