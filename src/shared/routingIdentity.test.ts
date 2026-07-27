import { describe, expect, it } from 'vitest';

import {
  classifyRoutingIdentity,
  createAutomaticRouteGroupKey,
  createRouteProgramEdgeId,
  createRouteSupplyCredentialKey,
  createRuntimeExecutionTargetIdFromIdentity,
  createRouteBuilderMacroId,
  createManagedRouteGraphElementId,
  createRuntimeExecutionTargetIdFromSupplyKey,
  createRouteSupplyKey,
  isAutomaticRouteGroupKey,
  isRouteMacroSemanticNodeId,
  isRouteMacroDispatcherNodeId,
  stableRoutingIdentityHash,
} from './routingIdentity.js';

describe('routingIdentity', () => {
  it('builds route graph identities from stable text ids', () => {
    expect(createRouteBuilderMacroId('DeepSeek V4 Flash')).toBe('route:deepseek-v4-flash');
    expect(createManagedRouteGraphElementId('member', 'a3c8f0')).toBe('dispatcher-member:managed:a3c8f0');
  });


  it('builds deterministic endpoint identities without display-name sensitivity', () => {
    const first = createRuntimeExecutionTargetIdFromIdentity({
      provider: 'ModelScope',
      credentialFingerprint: 'abc123',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
    });
    const second = createRuntimeExecutionTargetIdFromIdentity({
      model: 'deepseek-ai/DeepSeek-V4-Flash',
      credentialFingerprint: 'abc123',
      provider: 'ModelScope',
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^route-endpoint:supply:upstream-model:modelscope:abc123:deepseek-ai-deepseek-v4-flash:[a-f0-9]{8}$/);
    expect(() => createRuntimeExecutionTargetIdFromIdentity(null)).toThrow('Route supply endpoint identity must be an object');
    expect(() => createRuntimeExecutionTargetIdFromIdentity({
      model: 'deepseek-ai/DeepSeek-V4-Flash',
      provider: 'ModelScope',
    })).toThrow('Route supply endpoint identity must include provider, credentialFingerprint, and model');
    expect(createRuntimeExecutionTargetIdFromSupplyKey('upstream:deepseek-ai/DeepSeek-V4-Flash|modelscope|abc123')).toMatch(
      /^route-endpoint:supply:upstream-model:supply-key:[a-f0-9]{16}:deepseek-ai-deepseek-v4-flash:[a-f0-9]{16}$/,
    );
  });

  it('centralizes route group and route supply persistence keys without changing their storage shape', () => {
    expect(createAutomaticRouteGroupKey('deepseek-ai/DeepSeek-V4-Flash')).toBe('upstream:deepseek-ai/deepseek-v4-flash');
    expect(isAutomaticRouteGroupKey('upstream:deepseek-ai/deepseek-v4-flash')).toBe(true);
    expect(isAutomaticRouteGroupKey('manual:deepseek-ai/deepseek-v4-flash')).toBe(false);

    expect(createRouteSupplyCredentialKey({ accountId: 12, tokenId: null })).toBe('12:account');
    expect(createRouteSupplyCredentialKey({ accountId: 12, tokenId: 34 })).toBe('12:34');
    expect(createRouteSupplyCredentialKey({ accountId: 12, tokenId: 34, oauthRouteUnitId: 56 })).toBe('route-unit:56');
    expect(() => createRouteSupplyCredentialKey({ tokenId: 34 })).toThrow('Route supply credential identity must include accountId');

    expect(createRouteSupplyKey({
      modelName: 'DeepSeek-AI/DeepSeek-V4-Flash',
      accountId: 12,
      tokenId: null,
    })).toBe('upstream:deepseek-ai/deepseek-v4-flash|12:account');
    expect(createRouteSupplyKey({
      modelName: 'DeepSeek-AI/DeepSeek-V4-Flash',
      credentialKey: 'route-unit:56',
    })).toBe('upstream:deepseek-ai/deepseek-v4-flash|route-unit:56');
  });

  it('classifies routing identity families without parsing ownership details', () => {
    expect(classifyRoutingIdentity('entry:public').kind).toBe('entry');
    expect(classifyRoutingIdentity('dispatcher:weighted').kind).toBe('dispatcher');
    expect(classifyRoutingIdentity('route-endpoint:product:route:deepseek').kind).toBe('unknown');
    expect(classifyRoutingIdentity('route-endpoint:supply:upstream-model:a:b:c:d').kind).toBe('execution_target');
    expect(classifyRoutingIdentity(createRouteBuilderMacroId('deepseek')).kind).toBe('unknown');
    expect(classifyRoutingIdentity('macro:deepseek').kind).toBe('macro');
    expect(classifyRoutingIdentity('edge:a:b:c:d').kind).toBe('edge');
    expect(classifyRoutingIdentity('alternative:plan:endpoint').kind).toBe('compiled_alternative');
    expect(classifyRoutingIdentity('attempt:plan:endpoint:0').kind).toBe('compiled_attempt');
    expect(classifyRoutingIdentity('plan:deepseek').kind).toBe('compiled_plan');
    expect(classifyRoutingIdentity('not-an-id').kind).toBe('unknown');
  });

  it('keeps stable hash independent from object key order', () => {
    expect(stableRoutingIdentityHash({ b: 2, a: 1 })).toBe(stableRoutingIdentityHash({ a: 1, b: 2 }));
  });

  it('builds route program edge ids from concrete node and port identities', () => {
    expect(createRouteProgramEdgeId('entry.public', 'request.out', 'dispatcher.weighted', 'request.in')).toBe(
      'edge:entry.public:request.out:dispatcher.weighted:request.in',
    );
  });

  it('recognizes generated macro dispatcher identities without callers parsing IDs', () => {
    expect(isRouteMacroDispatcherNodeId('macro:route:example:dispatcher', 'route:example')).toBe(true);
    expect(isRouteMacroDispatcherNodeId('macro:route:example:fallback-stage:backup:dispatcher', 'route:example')).toBe(true);
    expect(isRouteMacroDispatcherNodeId('macro:route:other:dispatcher', 'route:example')).toBe(false);
  });

  it('recognizes semantic macro nodes without exposing prefix parsing to callers', () => {
    expect(isRouteMacroSemanticNodeId('macro:route:example')).toBe(true);
    expect(isRouteMacroSemanticNodeId('macro:route:example:dispatcher')).toBe(false);
    expect(isRouteMacroSemanticNodeId('macro:route:example:candidate:stage:endpoint:target')).toBe(false);
  });
});
