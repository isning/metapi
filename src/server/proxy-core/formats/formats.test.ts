import { describe, expect, it } from 'vitest';
import { getAllDownstreamProtocolAdapters } from './registry.js';
import { openaiChatProtocolAdapter } from './openaiChat.js';
import { claudeProtocolAdapter } from './claude.js';
import { responsesProtocolAdapter } from './responses.js';

describe('downstream protocol adapters', () => {
  it('correctly returns all registered downstream protocol adapters', () => {
    const adapters = getAllDownstreamProtocolAdapters();
    expect(adapters.length).toBe(8);
    const formats = adapters.map(d => d.format);
    expect(formats).toContain('openai/chat');
    expect(formats).toContain('claude');
    expect(formats).toContain('responses');
    expect(formats).toContain('gemini');
    expect(formats).toContain('openai/embeddings');
    expect(formats).toContain('openai/completions');
    expect(formats).toContain('openai/images');
    expect(formats).toContain('openai/videos');
  });

  it('correctly parses openai/chat downstream requests', () => {
    const adapter = openaiChatProtocolAdapter;
    const parsed = adapter.parseRequest({
      model: 'gpt-4o',
      stream: true,
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(parsed.modelName).toBe('gpt-4o');
    expect(parsed.stream).toBe(true);
    expect(parsed.standardBody).toMatchObject({ model: 'gpt-4o', stream: true });
  });

  it('correctly parses claude downstream requests stripping continuation keys', () => {
    const adapter = claudeProtocolAdapter;
    const parsed = adapter.parseRequest({
      model: 'claude-3-5-sonnet',
      stream: false,
      previous_response_id: 'some-id',
      prompt_cache_key: 'cache-key',
    });
    expect(parsed.modelName).toBe('claude-3-5-sonnet');
    expect(parsed.stream).toBe(false);
    expect(parsed.standardBody.previous_response_id).toBeUndefined();
    expect(parsed.standardBody.prompt_cache_key).toBeUndefined();
  });

  it('extracts safe passthrough headers based on downstream format policies', () => {
    const openai = openaiChatProtocolAdapter;
    const headers = openai.extractPassthroughHeaders({
      accept: 'application/json',
      'x-metapi-tester-request': '1',
      authorization: 'Bearer secret',
      'user-agent': 'client-agent',
    });
    expect(headers.accept).toBe('application/json');
    expect(headers['user-agent']).toBe('client-agent');
    expect(headers['x-metapi-tester-request']).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
  });
});
