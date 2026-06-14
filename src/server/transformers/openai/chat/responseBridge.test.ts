import { describe, expect, it } from 'vitest';

import {
  buildNormalizedFinalToOpenAiChatChunks,
  buildNormalizedFinalToOpenAiChatPayload,
  normalizeOpenAiChatFinalToNormalized,
  openAiChatResponseBridge,
} from './responseBridge.js';
import { openAiChatOutbound } from './outbound.js';

describe('openai chat response bridge', () => {
  it('normalizes final chat payloads into normalized responses', () => {
    const normalized = normalizeOpenAiChatFinalToNormalized({
      id: 'chatcmpl-1',
      model: 'gpt-5',
      created: 123,
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: 'hello',
          reasoning_content: 'think',
        },
      }],
    }, 'gpt-5');

    expect(normalized).toMatchObject({
      id: 'chatcmpl-1',
      model: 'gpt-5',
      content: 'hello',
      reasoningContent: 'think',
      finishReason: 'stop',
    });
  });

  it('builds final chat payloads and synthetic chunks from normalized responses', () => {
    const normalized = {
      id: 'chatcmpl-1',
      model: 'gpt-5',
      created: 123,
      content: 'hello',
      reasoningContent: 'think',
      finishReason: 'stop',
      toolCalls: [],
    };

    const payload = buildNormalizedFinalToOpenAiChatPayload(normalized as any, {
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    });
    const chunks = buildNormalizedFinalToOpenAiChatChunks(normalized as any);

    expect(payload).toMatchObject({
      id: 'chatcmpl-1',
      model: 'gpt-5',
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
      },
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: 'hello',
          reasoning_content: 'think',
        },
      }],
    });
    expect(chunks[0]).toMatchObject({
      id: 'chatcmpl-1',
      model: 'gpt-5',
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: 'hello',
        },
      }],
    });
  });

  it('preserves tool-call semantics when bridging normalized tool-turn finals back to chat payloads', () => {
    const normalized = {
      id: 'chatcmpl-tool-1',
      model: 'gpt-5',
      created: 123,
      content: '',
      reasoningContent: 'plan first',
      finishReason: 'tool_calls',
      toolCalls: [{
        id: 'call_1',
        name: 'lookup_weather',
        arguments: '{"city":"Shanghai"}',
      }],
    };

    const payload = buildNormalizedFinalToOpenAiChatPayload(normalized as any, {
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    });
    const chunks = buildNormalizedFinalToOpenAiChatChunks(normalized as any);

    expect(payload).toMatchObject({
      id: 'chatcmpl-tool-1',
      model: 'gpt-5',
      choices: [{
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: '',
          reasoning_content: 'plan first',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'lookup_weather',
              arguments: '{"city":"Shanghai"}',
            },
          }],
        },
      }],
    });
    expect(chunks[0]).toMatchObject({
      id: 'chatcmpl-tool-1',
      model: 'gpt-5',
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: '',
          reasoning_content: 'plan first',
          tool_calls: [{
            index: 0,
            id: 'call_1',
            type: 'function',
            function: {
              name: 'lookup_weather',
              arguments: '{"city":"Shanghai"}',
            },
          }],
        },
      }],
    });
    expect(chunks[1]).toMatchObject({
      choices: [{
        index: 0,
        finish_reason: 'tool_calls',
      }],
    });
  });

  it('preserves reasoning whitespace and tool calls from upstream chat finals', () => {
    const normalized = normalizeOpenAiChatFinalToNormalized({
      id: 'chatcmpl-deepseek',
      model: 'deepseek-reasoner',
      choices: [{
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: '',
          reasoning_content: ' first token\n next token ',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'Glob',
              arguments: '{"pattern":"README*"}',
            },
          }],
        },
      }],
    }, 'deepseek-reasoner');

    expect(normalized.reasoningContent).toBe(' first token\n next token ');
    expect((normalized as any).choices[0].reasoningContent).toBe(' first token\n next token ');
    expect(normalized.toolCalls).toEqual([{
      id: 'call_1',
      name: 'Glob',
      arguments: '{"pattern":"README*"}',
    }]);
    expect(normalized.finishReason).toBe('tool_calls');
  });

  it('preserves reasoning whitespace from structured chat content fallback paths', () => {
    const normalized = normalizeOpenAiChatFinalToNormalized({
      id: 'chatcmpl-structured-reasoning',
      model: 'deepseek-reasoner',
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: {
            reasoning_content: ' first structured token ',
          },
        },
      }],
    }, 'deepseek-reasoner');

    expect(normalized.reasoningContent).toBe(' first structured token ');
    expect((normalized as any).choices[0].reasoningContent).toBe(' first structured token ');
  });

  it('drops nameless upstream chat tool calls instead of preserving invalid tool history', () => {
    const normalized = normalizeOpenAiChatFinalToNormalized({
      id: 'chatcmpl-invalid-tool',
      model: 'deepseek-reasoner',
      choices: [{
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call_missing_name',
            type: 'function',
            function: {
              arguments: '{"pattern":"README*"}',
            },
          }],
        },
      }],
    }, 'deepseek-reasoner');

    expect(normalized.toolCalls).toEqual([]);
    expect((normalized as any).choices[0].toolCalls).toEqual([]);
  });

  it('drops idless upstream chat tool calls instead of preserving invalid tool history', () => {
    const normalized = normalizeOpenAiChatFinalToNormalized({
      id: 'chatcmpl-idless-tool',
      model: 'deepseek-reasoner',
      choices: [{
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            type: 'function',
            function: {
              name: 'Glob',
              arguments: '{"pattern":"README*"}',
            },
          }],
        },
      }],
    }, 'deepseek-reasoner');

    expect(normalized.toolCalls).toEqual([]);
    expect((normalized as any).choices[0].toolCalls).toEqual([]);
  });

  it('builds synthetic chunks for multi-choice finals even when some choices omit toolCalls', () => {
    const chunks = buildNormalizedFinalToOpenAiChatChunks({
      id: 'chatcmpl-multi-1',
      model: 'gpt-5',
      created: 123,
      content: '',
      reasoningContent: '',
      finishReason: 'stop',
      toolCalls: [],
      choices: [
        {
          index: 0,
          role: 'assistant',
          content: '',
          toolCalls: [{
            id: 'call_multi_1',
            name: 'lookup_weather',
            arguments: '{"city":"Paris"}',
          }],
          finishReason: 'tool_calls',
        },
        {
          index: 1,
          role: 'assistant',
          content: 'done',
          finishReason: 'stop',
        },
      ],
    } as any);

    expect(chunks[0]).toMatchObject({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{
              id: 'call_multi_1',
              type: 'function',
            }],
          },
        },
        {
          index: 1,
          delta: {
            role: 'assistant',
            content: 'done',
          },
        },
      ],
    });
    expect(chunks[1]).toMatchObject({
      choices: [
        { index: 0, finish_reason: 'tool_calls' },
        { index: 1, finish_reason: 'stop' },
      ],
    });
  });

  it('keeps the outbound facade pointed at the response bridge object', () => {
    expect(openAiChatOutbound).toBe(openAiChatResponseBridge);
  });
});
