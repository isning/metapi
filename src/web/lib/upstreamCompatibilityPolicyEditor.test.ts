import { describe, expect, it } from 'vitest';
import {
  emptyUpstreamCompatibilityPolicyForm,
  isCompatibilityPolicyFormInherited,
  policyFormFromStoredValue,
  serializeCompatibilityPolicyForm,
} from './upstreamCompatibilityPolicyEditor.js';

describe('upstream compatibility policy editor helper', () => {
  it('serializes an untouched form as clearing the local override', () => {
    expect(serializeCompatibilityPolicyForm(emptyUpstreamCompatibilityPolicyForm())).toEqual({
      ok: true,
      policy: null,
    });
    expect(isCompatibilityPolicyFormInherited(emptyUpstreamCompatibilityPolicyForm())).toBe(true);
  });

  it('serializes reasoning transport form fields into the policy contract', () => {
    const result = serializeCompatibilityPolicyForm({
      ...emptyUpstreamCompatibilityPolicyForm(),
      mode: 'content_think_tag',
      maxReasoningBytes: '1048576',
      overflow: 'drop',
      assistantToolCalls: 'false',
      toolCallMessageBehavior: 'native',
      openTag: '<reason>',
      closeTag: '</reason>',
      separator: '\n',
    });

    expect(result).toEqual({
      ok: true,
      policy: {
        reasoningHistory: {
          transport: {
            mode: 'content_think_tag',
            maxReasoningBytes: 1048576,
            overflow: 'drop',
            thinkTag: {
              openTag: '<reason>',
              closeTag: '</reason>',
              separator: '\n',
            },
            applyTo: {
              assistantToolCalls: false,
            },
            toolCallMessageBehavior: 'native',
          },
        },
      },
    });
    expect(isCompatibilityPolicyFormInherited({
      ...emptyUpstreamCompatibilityPolicyForm(),
      mode: 'content_think_tag',
    })).toBe(false);
  });

  it('round-trips stored policy values into editable form state', () => {
    const form = policyFormFromStoredValue(JSON.stringify({
      reasoningHistory: {
        transport: {
          mode: 'drop',
          maxReasoningBytes: 2048,
          applyTo: {
            assistantHistory: false,
            responseContinuation: true,
          },
        },
      },
    }));

    expect(form).toMatchObject({
      mode: 'drop',
      maxReasoningBytes: '2048',
      assistantHistory: 'false',
      responseContinuation: 'true',
    });
    expect(form.advancedJson).toContain('"mode": "drop"');
  });

  it('validates advanced JSON before saving', () => {
    expect(serializeCompatibilityPolicyForm({
      ...emptyUpstreamCompatibilityPolicyForm(),
      advancedEnabled: true,
      advancedJson: '{',
    })).toEqual({
      ok: false,
      error: 'Compatibility policy JSON is invalid.',
    });
  });
});
