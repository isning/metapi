import { describe, expect, it } from 'vitest';
import {
  CODEX_DEFAULT_INSTRUCTIONS,
  normalizeCodexResponsesBodyForProxy,
} from './codexCompatibility.js';

describe('normalizeCodexResponsesBodyForProxy', () => {
  it('extracts codex system input into top-level instructions before proxying upstream', () => {
    const body = normalizeCodexResponsesBodyForProxy({
      input: [
        {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: 'be precise' }],
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }],
        },
      ],
      instructions: 'keep edits narrow',
      max_output_tokens: 512,
      max_completion_tokens: 256,
      max_tokens: 128,
      stream_options: { include_usage: true },
      temperature: 0.3,
      store: true,
    }, 'codex');

    expect(body).toEqual({
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }],
        },
      ],
      instructions: 'be precise\n\nkeep edits narrow',
      store: false,
      temperature: 0.3,
    });
  });

  it('keeps non-text system content in input while lifting only the text blocks into instructions', () => {
    const imageBlock = {
      type: 'input_image',
      image_url: 'https://example.com/reference.png',
    };

    const body = normalizeCodexResponsesBodyForProxy({
      input: [
        {
          type: 'message',
          role: 'system',
          content: [
            { type: 'input_text', text: 'keep the image context' },
            imageBlock,
          ],
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }],
        },
      ],
    }, 'codex');

    expect(body.instructions).toBe('keep the image context');
    expect(body.input).toEqual([
      {
        type: 'message',
        role: 'system',
        content: [imageBlock],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      },
    ]);
  });

  it('joins multiple text blocks with separators instead of squashing them together', () => {
    const body = normalizeCodexResponsesBodyForProxy({
      input: [
        {
          type: 'message',
          role: 'system',
          content: [
            { type: 'input_text', text: 'first line' },
            { type: 'input_text', text: 'second line' },
          ],
        },
      ],
    }, 'codex');

    expect(body.instructions).toBe('first line\nsecond line');
  });

  it('supplies a non-empty default instructions string for codex when missing', () => {
    const body = normalizeCodexResponsesBodyForProxy({
      input: 'hello',
    }, 'codex');

    expect(body).toEqual({
      input: 'hello',
      instructions: CODEX_DEFAULT_INSTRUCTIONS,
      store: false,
    });
  });

  it('preserves Codex additional_tools input without changing its declaration scope', () => {
    const exec = {
      type: 'custom',
      name: 'exec',
      description: 'Run JavaScript.',
      format: { type: 'grammar', syntax: 'lark', definition: 'start: SOURCE' },
    };
    const wait = {
      type: 'function',
      name: 'wait',
      parameters: { type: 'object', properties: {} },
    };

    const body = normalizeCodexResponsesBodyForProxy({
      input: [
        { type: 'additional_tools', role: 'developer', tools: [exec, wait] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      ],
      tools: [exec],
    }, 'codex');

    expect(body.tools).toEqual([exec]);
    expect(body.input).toEqual([
      { type: 'additional_tools', role: 'developer', tools: [exec, wait] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
    ]);
  });

  it('preserves legacy content-less message tool containers without rewriting them', () => {
    const exec = { type: 'custom', name: 'exec', description: 'Run JavaScript.' };
    const body = normalizeCodexResponsesBodyForProxy({
      input: [
        { type: 'message', role: 'developer', tools: [exec] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      ],
    }, 'codex');

    expect(body.tools).toBeUndefined();
    expect(body.input).toEqual([
      { type: 'message', role: 'developer', tools: [exec] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
    ]);
  });

  it('preserves legacy empty tool containers after generic normalization', () => {
    const exec = { type: 'custom', name: 'exec', description: 'Run JavaScript.' };
    const body = normalizeCodexResponsesBodyForProxy({
      input: [
        { type: 'message', role: 'developer', content: [], tools: [exec] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      ],
    }, 'codex');

    expect(body.tools).toBeUndefined();
    expect(body.input).toEqual([
      { type: 'message', role: 'developer', content: [], tools: [exec] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
    ]);
  });

  it('leaves non-codex bodies untouched', () => {
    const source = {
      input: 'hello',
      max_output_tokens: 512,
    };

    const body = normalizeCodexResponsesBodyForProxy(source, 'openai');

    expect(body).toBe(source);
  });
});
