import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY,
  normalizeUpstreamCompatibilityPolicy,
  parseUpstreamCompatibilityPolicyJson,
  resolveUpstreamCompatibilityPolicy,
} from './upstreamCompatibilityPolicy.js';

describe('upstream compatibility policy contract', () => {
  it('defaults reasoning history transport to native structured carriers', () => {
    expect(resolveUpstreamCompatibilityPolicy()).toEqual(DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY);
  });

  it('deep-merges scalar and object overrides across inheritance layers', () => {
    const policy = resolveUpstreamCompatibilityPolicy(
      {
        reasoningHistory: {
          transport: {
            mode: 'content_think_tag',
            maxReasoningBytes: 1024,
            overflow: 'drop',
            thinkTag: {
              openTag: '<reasoning>',
            },
          },
        },
      },
      {
        reasoningHistory: {
          transport: {
            thinkTag: {
              closeTag: '</reasoning>',
            },
            applyTo: {
              assistantToolCalls: false,
            },
          },
        },
      },
    );

    expect(policy.reasoningHistory.transport).toEqual({
      mode: 'content_think_tag',
      maxReasoningBytes: 1024,
      overflow: 'drop',
      thinkTag: {
        openTag: '<reasoning>',
        closeTag: '</reasoning>',
        separator: '\n\n',
      },
      applyTo: {
        assistantHistory: true,
        assistantToolCalls: false,
        responseContinuation: true,
      },
      toolCallMessageBehavior: 'same_as_assistant',
    });
  });

  it('treats null as an explicit reset to resolved defaults', () => {
    const policy = resolveUpstreamCompatibilityPolicy(
      {
        reasoningHistory: {
          transport: {
            mode: 'content_think_tag',
            thinkTag: {
              openTag: '<r>',
              closeTag: '</r>',
            },
            applyTo: {
              assistantHistory: false,
            },
          },
        },
        payloadDefaults: [{ path: 'a', value: 1 }],
      },
      {
        reasoningHistory: {
          transport: null,
        },
        payloadDefaults: null,
      },
    );

    expect(policy.reasoningHistory.transport).toEqual(DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY.reasoningHistory.transport);
    expect(policy.payloadDefaults).toEqual([]);
  });

  it('normalizes unknown values out of stored policy JSON', () => {
    expect(parseUpstreamCompatibilityPolicyJson(JSON.stringify({
      reasoningHistory: {
        transport: {
          mode: 'passthrough',
          maxReasoningBytes: '2048',
          overflow: 'explode',
          toolCallMessageBehavior: 'drop',
          thinkTag: {
            openTag: '<think>',
            separator: '',
          },
          applyTo: {
            assistantToolCalls: true,
            responseContinuation: 'yes',
          },
        },
      },
    }))).toEqual({
      reasoningHistory: {
        transport: {
          maxReasoningBytes: 2048,
          toolCallMessageBehavior: 'drop',
          thinkTag: {
            openTag: '<think>',
            separator: '',
          },
          applyTo: {
            assistantToolCalls: true,
          },
        },
      },
    });
  });

  it('returns undefined for empty or invalid policy input', () => {
    expect(normalizeUpstreamCompatibilityPolicy({})).toBeUndefined();
    expect(parseUpstreamCompatibilityPolicyJson('not json')).toBeUndefined();
  });
});
