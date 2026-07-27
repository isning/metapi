import { describe, expect, it, vi } from 'vitest';

import { createChatProxyStreamSession } from './proxyStream.js';

function streamReaderFromText(text: string) {
  const encoded = new TextEncoder().encode(text);
  let read = false;
  return {
    async read() {
      if (read) return { done: true as const };
      read = true;
      return { done: false as const, value: encoded };
    },
    async cancel() {
      return undefined;
    },
    releaseLock() {},
  };
}

describe('createChatProxyStreamSession', () => {
  it('reports meaningful output only when the first assistant token is observed', async () => {
    const onMeaningfulOutput = vi.fn();
    const lines: string[] = [];
    let ended = false;
    const session = createChatProxyStreamSession({
      downstreamFormat: 'openai',
      modelName: 'gpt-4o-mini',
      successfulUpstreamPath: '/v1/chat/completions',
      onMeaningfulOutput,
      writeLines: (nextLines) => {
        lines.push(...nextLines);
      },
      writeRaw: (chunk) => {
        lines.push(chunk);
      },
    });

    const roleOnly = {
      id: 'chatcmpl_test',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o-mini',
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    };
    const content = {
      id: 'chatcmpl_test',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o-mini',
      choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }],
    };
    const done = {
      id: 'chatcmpl_test',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o-mini',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };
    const stream = [
      `data: ${JSON.stringify(roleOnly)}\n\n`,
      `data: ${JSON.stringify(content)}\n\n`,
      `data: ${JSON.stringify(done)}\n\n`,
      'data: [DONE]\n\n',
    ].join('');

    const result = await session.run(streamReaderFromText(stream), {
      end() {
        ended = true;
      },
    });

    expect(result).toEqual({ status: 'completed', errorMessage: null });
    expect(ended).toBe(true);
    expect(lines.join('')).toContain('hello');
    expect(onMeaningfulOutput).toHaveBeenCalledTimes(1);
  });

  it('reports meaningful output when an Anthropic messages stream is converted to OpenAI chat chunks', async () => {
    const onMeaningfulOutput = vi.fn();
    const lines: string[] = [];
    const session = createChatProxyStreamSession({
      downstreamFormat: 'openai',
      modelName: 'deepseek-ai/DeepSeek-V4-Flash',
      successfulUpstreamPath: '/v1/messages',
      onMeaningfulOutput,
      writeLines: (nextLines) => {
        lines.push(...nextLines);
      },
      writeRaw: (chunk) => {
        lines.push(chunk);
      },
    });
    const messageStart = {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'deepseek-ai/DeepSeek-V4-Flash',
        content: [],
      },
    };
    const textDelta = {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: 'hello',
      },
    };
    const messageStop = { type: 'message_stop' };
    const stream = [
      `event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify(textDelta)}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify(messageStop)}\n\n`,
    ].join('');

    const result = await session.run(streamReaderFromText(stream), {
      end() {},
    });

    expect(result).toEqual({ status: 'completed', errorMessage: null });
    expect(lines.join('')).toContain('hello');
    expect(onMeaningfulOutput).toHaveBeenCalledTimes(1);
  });
});
