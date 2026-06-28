import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_VARIANT_CAPABILITY,
  apiTypeFromUpstreamEndpoint,
  buildApiAttemptPlan,
  buildDefaultApiEndpointProfile,
  buildSupplyTargetId,
  endpointCandidatesFromApiAttemptPlan,
  upstreamEndpointFromApiType,
  type CredentialEndpointBinding,
} from './apiVariants.js';

describe('apiVariants', () => {
  it('maps existing upstream endpoints to api types', () => {
    expect(apiTypeFromUpstreamEndpoint('chat')).toBe('openai_chat_completions');
    expect(apiTypeFromUpstreamEndpoint('responses')).toBe('openai_responses');
    expect(apiTypeFromUpstreamEndpoint('messages')).toBe('anthropic_messages');
    expect(apiTypeFromUpstreamEndpoint('embeddings')).toBe('openai_embeddings');

    expect(upstreamEndpointFromApiType('openai_chat_completions')).toBe('chat');
    expect(upstreamEndpointFromApiType('openai_responses')).toBe('responses');
    expect(upstreamEndpointFromApiType('anthropic_messages')).toBe('messages');
  });

  it('builds stable supply target ids from site, key, scope, and model', () => {
    expect(buildSupplyTargetId({
      siteId: 15,
      credentialId: 'key A',
      scopeKey: 'us-east',
      canonicalModel: 'GLM-5.1',
    })).toBe('supply-target:site-15:credential-key-a:us-east:glm-5.1');
  });

  it('preserves current endpoint candidate order through default bindings', () => {
    const plan = buildApiAttemptPlan({
      siteId: 1,
      credentialId: 2,
      modelName: 'gpt-test',
      siteUrl: 'https://api.example.com',
      endpointCandidates: ['responses', 'chat', 'messages'],
    });

    expect(endpointCandidatesFromApiAttemptPlan(plan)).toEqual(['responses', 'chat', 'messages']);
    expect(plan.attempts.map((attempt) => attempt.apiType)).toEqual([
      'openai_responses',
      'openai_chat_completions',
      'anthropic_messages',
    ]);
    expect(plan.attempts.map((attempt) => attempt.requestUrl)).toEqual([
      'https://api.example.com/v1/responses',
      'https://api.example.com/v1/chat/completions',
      'https://api.example.com/v1/messages',
    ]);
    expect(plan.diagnostics).toEqual([]);
  });

  it('plans executable request urls from endpoint profiles', () => {
    const chatProfile = {
      ...buildDefaultApiEndpointProfile({ siteId: 10, endpoint: 'chat' }),
      requestUrl: 'https://api.deepseek.com/chat/completions',
      defaultHeaders: {
        'x-provider': 'deepseek',
      },
    };
    const messagesProfile = {
      ...buildDefaultApiEndpointProfile({ siteId: 10, endpoint: 'messages' }),
      requestUrl: 'https://api.deepseek.com/anthropic/v1/messages',
    };
    const bindings: CredentialEndpointBinding[] = [
      {
        id: 'credential-endpoint:key-a:deepseek-chat',
        siteId: 10,
        credentialId: 'key-a',
        apiEndpointProfileId: chatProfile.id,
        enabled: true,
        support: 'supported',
        source: 'manual',
      },
      {
        id: 'credential-endpoint:key-a:deepseek-messages',
        siteId: 10,
        credentialId: 'key-a',
        apiEndpointProfileId: messagesProfile.id,
        enabled: true,
        support: 'supported',
        source: 'manual',
      },
    ];

    const plan = buildApiAttemptPlan({
      siteId: 10,
      credentialId: 'key-a',
      endpointCandidates: ['chat', 'messages'],
      endpointProfiles: [chatProfile, messagesProfile],
      credentialEndpointBindings: bindings,
      siteUrl: 'https://ignored.example.com',
    });

    expect(plan.attempts.map((attempt) => attempt.requestUrl)).toEqual([
      'https://api.deepseek.com/chat/completions',
      'https://api.deepseek.com/anthropic/v1/messages',
    ]);
    expect(plan.attempts[0]?.defaultHeaders).toEqual({
      'x-provider': 'deepseek',
    });
  });

  it('derives DeepSeek executable urls from the official root url', () => {
    const plan = buildApiAttemptPlan({
      siteId: 10,
      credentialId: 'key-a',
      siteUrl: 'https://api.deepseek.com',
      endpointCandidates: ['chat', 'messages'],
    });

    expect(plan.attempts.map((attempt) => attempt.requestUrl)).toEqual([
      'https://api.deepseek.com/chat/completions',
      'https://api.deepseek.com/anthropic/v1/messages',
    ]);
  });

  it('filters selectable attempts by credential endpoint bindings for the active site and key', () => {
    const chatProfile = buildDefaultApiEndpointProfile({ siteId: 10, endpoint: 'chat' });
    const responsesProfile = buildDefaultApiEndpointProfile({ siteId: 10, endpoint: 'responses' });
    const messagesProfile = buildDefaultApiEndpointProfile({ siteId: 10, endpoint: 'messages' });
    const otherSiteProfile = buildDefaultApiEndpointProfile({ siteId: 11, endpoint: 'messages' });
    const bindings: CredentialEndpointBinding[] = [
      {
        id: 'credential-endpoint:key-a:chat',
        siteId: 10,
        credentialId: 'key-a',
        apiEndpointProfileId: chatProfile.id,
        enabled: true,
        support: 'supported',
        source: 'manual',
      },
      {
        id: 'credential-endpoint:key-a:responses',
        siteId: 10,
        credentialId: 'key-a',
        apiEndpointProfileId: responsesProfile.id,
        enabled: false,
        support: 'supported',
        source: 'manual',
      },
      {
        id: 'credential-endpoint:key-b:responses',
        siteId: 10,
        credentialId: 'key-b',
        apiEndpointProfileId: responsesProfile.id,
        enabled: true,
        support: 'supported',
        source: 'manual',
      },
      {
        id: 'credential-endpoint:key-a:other-site-messages',
        siteId: 11,
        credentialId: 'key-a',
        apiEndpointProfileId: otherSiteProfile.id,
        enabled: true,
        support: 'supported',
        source: 'manual',
      },
    ];

    const plan = buildApiAttemptPlan({
      siteId: 10,
      credentialId: 'key-a',
      endpointProfiles: [chatProfile, responsesProfile, messagesProfile, otherSiteProfile],
      credentialEndpointBindings: bindings,
      endpointCandidates: ['responses', 'chat', 'messages'],
    });

    expect(endpointCandidatesFromApiAttemptPlan(plan)).toEqual(['chat', 'messages']);
    expect(plan.attempts).toHaveLength(2);
    expect(plan.attempts[0]).toMatchObject({
      apiType: 'openai_chat_completions',
      credentialEndpointBindingId: 'credential-endpoint:key-a:chat',
    });
    expect(plan.attempts[1]).toMatchObject({
      apiType: 'anthropic_messages',
      credentialEndpointBindingId: `credential-endpoint:key-a:${messagesProfile.id}`,
    });
    expect(plan.attempts[1]?.reason).toContain('default_binding');
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'credential_endpoint_binding.not_plannable',
    ]);
  });

  it('does not silently plan unknown bindings unless advanced policy allows them', () => {
    const profile = buildDefaultApiEndpointProfile({ siteId: 1, endpoint: 'responses' });
    const binding: CredentialEndpointBinding = {
      id: 'credential-endpoint:key-a:responses',
      siteId: 1,
      credentialId: 'key-a',
      apiEndpointProfileId: profile.id,
      enabled: true,
      support: 'unknown',
      source: 'discovered',
    };

    const defaultPlan = buildApiAttemptPlan({
      siteId: 1,
      credentialId: 'key-a',
      endpointProfiles: [profile],
      credentialEndpointBindings: [binding],
      endpointCandidates: ['responses'],
    });
    expect(defaultPlan.attempts).toEqual([]);
    expect(defaultPlan.diagnostics[0]).toMatchObject({
      code: 'credential_endpoint_binding.not_plannable',
      severity: 'info',
    });

    const advancedPlan = buildApiAttemptPlan({
      siteId: 1,
      credentialId: 'key-a',
      endpointProfiles: [profile],
      credentialEndpointBindings: [binding],
      endpointCandidates: ['responses'],
      policy: {
        allowUnknownBindings: true,
      },
    });
    expect(endpointCandidatesFromApiAttemptPlan(advancedPlan)).toEqual(['responses']);
  });

  it('pins endpoint variants without creating a separate graph candidate', () => {
    const plan = buildApiAttemptPlan({
      siteId: 1,
      credentialId: 2,
      endpointCandidates: ['chat', 'responses', 'messages'],
      policy: {
        pinnedApiType: 'openai_responses',
      },
    });

    expect(endpointCandidatesFromApiAttemptPlan(plan)).toEqual(['responses', 'chat', 'messages']);
    expect(plan.attempts[0]?.reason).toContain('pinned_api_type');
  });

  it('removes endpoint/model pairs rejected by recent observations', () => {
    const chatProfile = buildDefaultApiEndpointProfile({ siteId: 1, endpoint: 'chat' });
    const responsesProfile = buildDefaultApiEndpointProfile({ siteId: 1, endpoint: 'responses' });
    const bindings: CredentialEndpointBinding[] = [
      {
        id: 'credential-endpoint:key-a:chat',
        siteId: 1,
        credentialId: 'key-a',
        apiEndpointProfileId: chatProfile.id,
        enabled: true,
        support: 'supported',
        source: 'manual',
      },
      {
        id: 'credential-endpoint:key-a:responses',
        siteId: 1,
        credentialId: 'key-a',
        apiEndpointProfileId: responsesProfile.id,
        enabled: true,
        support: 'supported',
        source: 'manual',
      },
    ];

    const plan = buildApiAttemptPlan({
      siteId: 1,
      credentialId: 'key-a',
      modelName: 'gpt-test',
      endpointProfiles: [responsesProfile, chatProfile],
      credentialEndpointBindings: bindings,
      endpointModelObservations: [{
        siteId: 1,
        credentialId: 'key-a',
        apiEndpointProfileId: responsesProfile.id,
        modelName: 'gpt-test',
        status: 'rejected',
      }],
      endpointCandidates: ['responses', 'chat'],
    });

    expect(endpointCandidatesFromApiAttemptPlan(plan)).toEqual(['chat']);
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain('endpoint_model_observation.rejected');
  });

  it('inherits endpoint capability defaults and key-scoped overrides', () => {
    const profile = {
      ...buildDefaultApiEndpointProfile({ siteId: 1, endpoint: 'responses' }),
      capabilityDefaults: {
        ...DEFAULT_API_VARIANT_CAPABILITY,
        status: 'supported' as const,
        output: {
          ...DEFAULT_API_VARIANT_CAPABILITY.output,
          reasoning: 'native' as const,
        },
      },
    };
    const binding: CredentialEndpointBinding = {
      id: 'credential-endpoint:key-a:responses',
      siteId: 1,
      credentialId: 'key-a',
      apiEndpointProfileId: profile.id,
      enabled: true,
      support: 'supported',
      source: 'manual',
      capabilityOverride: {
        input: {
          tools: 'emulated',
        },
      },
    };

    const plan = buildApiAttemptPlan({
      siteId: 1,
      credentialId: 'key-a',
      endpointProfiles: [profile],
      credentialEndpointBindings: [binding],
      endpointCandidates: ['responses'],
    });

    expect(plan.variants[0]?.capability.status).toBe('supported');
    expect(plan.variants[0]?.capability.output.reasoning).toBe('native');
    expect(plan.variants[0]?.capability.input.tools).toBe('emulated');
  });
});
