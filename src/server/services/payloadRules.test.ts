import { describe, expect, it } from 'vitest';
import {
  applyPayloadRules,
  createEmptyPayloadRulesConfig,
  deletePayloadPath,
  hasPayloadPath,
  parsePayloadRulesConfigInput,
  setPayloadPath,
} from './payloadRules.js';

describe('parsePayloadRulesConfigInput', () => {
  it('accepts CPA-style dashed raw keys and normalizes them to camelCase sections', () => {
    const result = parsePayloadRulesConfigInput({
      override: [
        {
          models: [{ name: 'gpt-*', protocol: 'codex' }],
          params: {
            'reasoning.effort': 'high',
          },
        },
      ],
      'override-raw': [
        {
          models: [{ name: 'gpt-*', protocol: 'codex' }],
          params: {
            response_format: '{"type":"json_schema"}',
          },
        },
      ],
      filter: [
        {
          models: [{ name: 'gpt-*', protocol: 'codex' }],
          params: ['safety_identifier'],
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.normalized).toEqual({
      ...createEmptyPayloadRulesConfig(),
      override: [
        {
          models: [{ name: 'gpt-*', protocol: 'codex' }],
          params: {
            'reasoning.effort': 'high',
          },
        },
      ],
      overrideRaw: [
        {
          models: [{ name: 'gpt-*', protocol: 'codex' }],
          params: {
            response_format: '{"type":"json_schema"}',
          },
        },
      ],
      filter: [
        {
          models: [{ name: 'gpt-*', protocol: 'codex' }],
          params: ['safety_identifier'],
        },
      ],
    });
  });

  it('rejects invalid raw JSON fragments', () => {
    const result = parsePayloadRulesConfigInput({
      'override-raw': [
        {
          models: [{ name: 'gpt-*', protocol: 'codex' }],
          params: {
            response_format: '{invalid-json',
          },
        },
      ],
    });

    expect(result).toEqual({
      success: false,
      message: 'Payload 规则 override-raw 第 1 条的 response_format 不是合法 JSON',
    });
  });

  it('rejects unknown sections so the settings UI cannot silently save ignored data', () => {
    const result = parsePayloadRulesConfigInput({
      override: [],
      unexpected: [],
    });

    expect(result).toEqual({
      success: false,
      message: 'Payload 规则包含未知分组：unexpected',
    });
  });
});

describe('payload rule application', () => {
  it('applies defaults only when missing, then overrides, raw JSON values and filters by model/protocol', () => {
    const result = applyPayloadRules({
      rules: {
        default: [
          {
            models: [{ name: 'deepseek-*', protocol: 'openai' }],
            params: {
              reasoning_effort: 'medium',
              'metadata.source': 'default-rule',
            },
          },
        ],
        defaultRaw: [
          {
            models: [{ name: 'deepseek-*', protocol: 'openai' }],
            params: {
              thinking: '{"type":"enabled"}',
            },
          },
        ],
        override: [
          {
            models: [{ name: 'deepseek-*', protocol: 'openai' }],
            params: {
              reasoning_effort: 'high',
            },
          },
        ],
        overrideRaw: [
          {
            models: [{ name: 'deepseek-*', protocol: 'openai' }],
            params: {
              response_format: '{"type":"json_object"}',
            },
          },
        ],
        filter: [
          {
            models: [{ name: 'deepseek-*', protocol: 'openai' }],
            params: ['debug.removeMe'],
          },
          {
            models: [{ name: 'deepseek-*', protocol: 'claude' }],
            params: ['debug.keepMe'],
          },
        ],
      },
      payload: {
        model: 'deepseek-reasoner',
        reasoning_effort: 'low',
        debug: { keepMe: true, removeMe: true },
      },
      requestedModel: 'deepseek-reasoner',
      protocol: 'openai',
    });

    expect(result).toEqual({
      model: 'deepseek-reasoner',
      reasoning_effort: 'high',
      metadata: { source: 'default-rule' },
      thinking: { type: 'enabled' },
      response_format: { type: 'json_object' },
      debug: { keepMe: true },
    });
  });

  it('matches either requested or upstream model and keeps the original payload immutable', () => {
    const payload = {
      model: 'upstream-model',
      nested: { value: 'client' },
    };

    const result = applyPayloadRules({
      rules: {
        ...createEmptyPayloadRulesConfig(),
        default: [
          {
            models: [{ name: 'public-*' }],
            params: { 'nested.defaulted': true },
          },
        ],
        override: [
          {
            models: [{ name: 'upstream-*' }],
            params: { 'nested.value': 'server' },
          },
        ],
      },
      payload,
      requestedModel: 'public-model',
      modelName: 'upstream-model',
    });

    expect(result).toEqual({
      model: 'upstream-model',
      nested: { value: 'server', defaulted: true },
    });
    expect(payload).toEqual({
      model: 'upstream-model',
      nested: { value: 'client' },
    });
  });

  it('sets, checks and deletes nested object and array payload paths deterministically', () => {
    const payload: Record<string, unknown> = {};

    setPayloadPath(payload, 'messages.0.content.0.text', 'hello');
    setPayloadPath(payload, 'metadata.trace.id', 'trace-1');

    expect(payload).toEqual({
      messages: [{ content: [{ text: 'hello' }] }],
      metadata: { trace: { id: 'trace-1' } },
    });
    expect(hasPayloadPath(payload, 'messages.0.content.0.text')).toBe(true);
    expect(hasPayloadPath(payload, 'messages.1.content')).toBe(false);

    deletePayloadPath(payload, 'messages.0.content.0');
    deletePayloadPath(payload, 'metadata.trace.id');

    expect(payload).toEqual({
      messages: [{ content: [] }],
      metadata: { trace: {} },
    });
  });
});
