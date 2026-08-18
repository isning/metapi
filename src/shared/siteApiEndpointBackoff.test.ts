import { describe, expect, it } from 'vitest';
import {
  normalizeSiteApiEndpointBackoffOverride,
  normalizeSiteApiEndpointBackoffPolicy,
  resolveSiteApiEndpointBackoffPolicy,
} from './siteApiEndpointBackoff.js';

describe('site API endpoint backoff policy', () => {
  it('normalizes the bounded semantic failure classes', () => {
    expect(normalizeSiteApiEndpointBackoffPolicy({
      cooldownSec: 90,
      cooldownOn: ['transport', 'rate_limit'],
    })).toEqual({ cooldownSec: 90, cooldownOn: ['transport', 'rate_limit'] });
    expect(normalizeSiteApiEndpointBackoffPolicy({
      cooldownSec: 90,
      cooldownOn: ['model_or_channel'],
    })).toBeNull();
  });

  it('supports inherited custom and disabled policies without treating invalid values as disabled', () => {
    expect(resolveSiteApiEndpointBackoffPolicy(null)).toMatchObject({
      cooldownSec: 300,
      cooldownOn: ['transport', 'gateway'],
    });
    const disabled = normalizeSiteApiEndpointBackoffOverride({ mode: 'disabled' });
    expect(disabled).toEqual({ mode: 'disabled' });
    expect(resolveSiteApiEndpointBackoffPolicy(disabled)).toBeNull();
    expect(normalizeSiteApiEndpointBackoffOverride({ mode: 'custom', policy: { cooldownSec: 0, cooldownOn: [] } })).toBeNull();
  });
});
