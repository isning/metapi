import { describe, expect, it } from 'vitest';

import {
  applyOpenAiChatStreamEvent,
  createOpenAiChatAggregateState,
  finalizeOpenAiChatAggregate,
  OpenAiChatStreamAggregateLimitError,
} from './aggregator.js';

describe('openai chat stream aggregator', () => {
  it('does not finalize nameless tool-call deltas as valid tool calls', () => {
    const state = createOpenAiChatAggregateState();

    applyOpenAiChatStreamEvent(state, {
      choiceEvents: [{
        index: 0,
        toolCallDeltas: [{
          index: 0,
          id: 'call_missing_name',
          argumentsDelta: '{"pattern":"README*"}',
        }],
        finishReason: 'tool_calls',
      }],
    });

    const finalized = finalizeOpenAiChatAggregate(state, {
      id: 'chatcmpl-invalid-tool',
      model: 'deepseek-reasoner',
      created: 123,
      content: '',
      reasoningContent: '',
      finishReason: 'stop',
      toolCalls: [],
    });

    expect(finalized.toolCalls).toEqual([]);
    expect(finalized.finishReason).toBe('stop');
    expect((finalized as any).choices[0].toolCalls).toEqual([]);
    expect((finalized as any).choices[0].finishReason).toBe('stop');
  });

  it('drops tool-call deltas with empty ids and names instead of emitting invalid tool calls', () => {
    const state = createOpenAiChatAggregateState();

    applyOpenAiChatStreamEvent(state, {
      choiceEvents: [{
        index: 0,
        toolCallDeltas: [
          {
            index: 0,
            id: '',
            name: '',
            argumentsDelta: '',
          },
          {
            index: 1,
            id: 'call_valid',
            name: 'lookup_weather',
            argumentsDelta: '{"city":"Shanghai"}',
          },
        ],
      }],
    });

    const finalized = finalizeOpenAiChatAggregate(state, {
      id: 'chatcmpl-empty-tool',
      model: 'deepseek-reasoner',
      created: 123,
      content: '',
      reasoningContent: '',
      finishReason: 'stop',
      toolCalls: [],
    });

    expect(finalized.toolCalls).toEqual([
      {
        id: 'call_valid',
        name: 'lookup_weather',
        arguments: '{"city":"Shanghai"}',
      },
    ]);
    expect((finalized as any).choices[0].toolCalls).toEqual([
      {
        id: 'call_valid',
        name: 'lookup_weather',
        arguments: '{"city":"Shanghai"}',
      },
    ]);
  });

  it('preserves whitespace exactly across streamed reasoning fragments', () => {
    const state = createOpenAiChatAggregateState();

    applyOpenAiChatStreamEvent(state, {
      choiceEvents: [{
        index: 0,
        reasoningDelta: 'plan ',
      }],
    });
    applyOpenAiChatStreamEvent(state, {
      choiceEvents: [{
        index: 0,
        reasoningDelta: 'with spaces\n',
      }],
    });
    applyOpenAiChatStreamEvent(state, {
      choiceEvents: [{
        index: 0,
        reasoningDelta: ' before action',
        finishReason: 'stop',
      }],
    });

    const finalized = finalizeOpenAiChatAggregate(state, {
      id: 'chatcmpl-reasoning-space',
      model: 'deepseek-reasoner',
      created: 123,
      content: '',
      reasoningContent: '',
      finishReason: 'stop',
      toolCalls: [],
    });

    expect(finalized.reasoningContent).toBe('plan with spaces\n before action');
    expect((finalized as any).choices[0].reasoningContent).toBe('plan with spaces\n before action');
  });

  it('merges fragmented tool arguments only after a valid tool identity arrives', () => {
    const state = createOpenAiChatAggregateState();

    applyOpenAiChatStreamEvent(state, {
      choiceEvents: [{
        index: 0,
        toolCallDeltas: [{
          index: 0,
          argumentsDelta: '{"pattern"',
        }],
      }],
    });
    applyOpenAiChatStreamEvent(state, {
      choiceEvents: [{
        index: 0,
        toolCallDeltas: [{
          index: 0,
          id: 'call_glob',
          name: 'Glob',
          argumentsDelta: ':"README*"}',
        }],
        finishReason: 'tool_calls',
      }],
    });

    const finalized = finalizeOpenAiChatAggregate(state, {
      id: 'chatcmpl-fragmented-tool',
      model: 'deepseek-reasoner',
      created: 123,
      content: '',
      reasoningContent: '',
      finishReason: 'stop',
      toolCalls: [],
    });

    expect(finalized.finishReason).toBe('tool_calls');
    expect(finalized.toolCalls).toEqual([
      {
        id: 'call_glob',
        name: 'Glob',
        arguments: '{"pattern":"README*"}',
      },
    ]);
  });

  it('rejects streamed reasoning that exceeds the configured aggregate limit', () => {
    const state = createOpenAiChatAggregateState({ maxReasoningBytes: 8 });

    expect(() => applyOpenAiChatStreamEvent(state, {
      choiceEvents: [{
        index: 0,
        reasoningDelta: '123456789',
      }],
    })).toThrow(OpenAiChatStreamAggregateLimitError);

    const finalized = finalizeOpenAiChatAggregate(state, {
      id: 'chatcmpl-reasoning-limit',
      model: 'deepseek-reasoner',
      created: 123,
      content: '',
      reasoningContent: '',
      finishReason: 'stop',
      toolCalls: [],
    });
    expect(finalized.reasoningContent).toBe('');
  });

  it('rejects streamed tool arguments that exceed the configured aggregate limit', () => {
    const state = createOpenAiChatAggregateState({ maxToolArgumentBytes: 8 });

    expect(() => applyOpenAiChatStreamEvent(state, {
      choiceEvents: [{
        index: 0,
        toolCallDeltas: [{
          index: 0,
          id: 'call_1',
          name: 'lookup',
          argumentsDelta: '{"long":1}',
        }],
      }],
    })).toThrow(OpenAiChatStreamAggregateLimitError);
  });

  it('enforces the total streamed aggregate byte limit across content and reasoning', () => {
    const state = createOpenAiChatAggregateState({ maxAggregateBytes: 10 });

    applyOpenAiChatStreamEvent(state, {
      choiceEvents: [{
        index: 0,
        contentDelta: '12345',
      }],
    });

    expect(() => applyOpenAiChatStreamEvent(state, {
      choiceEvents: [{
        index: 0,
        reasoningDelta: '678901',
      }],
    })).toThrow(OpenAiChatStreamAggregateLimitError);
  });
});
