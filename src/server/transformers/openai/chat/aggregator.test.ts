import { describe, expect, it } from 'vitest';

import {
  applyOpenAiChatStreamEvent,
  createOpenAiChatAggregateState,
  finalizeOpenAiChatAggregate,
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
});
