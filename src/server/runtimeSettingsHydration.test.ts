import { afterEach, describe, expect, it } from 'vitest';

import { config } from './config.js';
import { applyRuntimeSettings } from './runtimeSettingsHydration.js';

const originalConfig = structuredClone(config);

afterEach(() => {
  Object.assign(config, structuredClone(originalConfig));
});

describe('applyRuntimeSettings', () => {
  it('hydrates persisted runtime settings that should survive restarts', () => {
    config.disableCrossProtocolFallback = false;
    config.responsesUpstreamTransportMode = 'auto';
    config.responsesCompactFallbackToResponsesEnabled = false;
    config.webhookEnabled = true;
    config.barkEnabled = true;
    config.serverChanEnabled = true;
    config.globalAllowedModels = [];
    config.routeAffinityDefault = { kind: 'disabled' };
    config.siteApiEndpointBackoffDefault = { cooldownSec: 300, cooldownOn: ['transport', 'gateway'] };

    applyRuntimeSettings(new Map([
      ['disable_cross_protocol_fallback', JSON.stringify(true)],
      ['responses_upstream_transport_mode', JSON.stringify('follow_downstream')],
      ['responses_compact_fallback_to_responses_enabled', JSON.stringify(true)],
      ['webhook_enabled', JSON.stringify(false)],
      ['bark_enabled', JSON.stringify(false)],
      ['serverchan_enabled', JSON.stringify(false)],
      ['global_allowed_models', JSON.stringify(['gpt-5.4', ' claude-3.7-sonnet '])],
      ['proxy_execution_attempts_exhausted_message', JSON.stringify('All routes are currently unavailable')],
      ['route_affinity_default_v1', JSON.stringify({
        kind: 'pool',
        ttlSec: 1200,
        crossPoolFallback: 'promote_on_success',
      })],
      ['site_api_endpoint_backoff_default_v1', JSON.stringify({
        cooldownSec: 90,
        cooldownOn: ['transport', 'gateway', 'rate_limit'],
      })],
    ]));

    expect(config.disableCrossProtocolFallback).toBe(true);
    expect(config.responsesUpstreamTransportMode).toBe('follow_downstream');
    expect(config.responsesCompactFallbackToResponsesEnabled).toBe(true);
    expect(config.webhookEnabled).toBe(false);
    expect(config.barkEnabled).toBe(false);
    expect(config.serverChanEnabled).toBe(false);
    expect(config.globalAllowedModels).toEqual(['gpt-5.4', 'claude-3.7-sonnet']);
    expect(config.proxyExecutionAttemptsExhaustedMessage).toBe('All routes are currently unavailable');
    expect(config.routeAffinityDefault).toEqual({
      kind: 'pool',
      ttlSec: 1200,
      crossPoolFallback: 'promote_on_success',
    });
    expect(config.siteApiEndpointBackoffDefault).toEqual({
      cooldownSec: 90,
      cooldownOn: ['transport', 'gateway', 'rate_limit'],
    });
  });

  it('normalizes smtpPort to a positive integer during hydration', () => {
    config.smtpPort = 587;

    applyRuntimeSettings(new Map([
      ['smtp_port', JSON.stringify(587.9)],
    ]));

    expect(config.smtpPort).toBe(587);
  });

  it('hydrates legacy double-encoded global model allowlist values', () => {
    config.globalAllowedModels = [];

    applyRuntimeSettings(new Map([
      ['global_allowed_models', JSON.stringify(JSON.stringify(['model-alpha', ' model-beta ', 'model-gamma']))],
    ]));

    expect(config.globalAllowedModels).toEqual(['model-alpha', 'model-beta', 'model-gamma']);
  });
});
