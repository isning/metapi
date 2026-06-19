import { describe, expect, it } from 'vitest';

import {
  resolveUpstreamCompatibilityPolicy,
  type UpstreamCompatibilityPolicy,
} from '../../contracts/upstreamCompatibilityPolicy.js';
import {
  canonicalRequestFromOpenAiBody,
  canonicalRequestToOpenAiChatBody,
  createCanonicalRequestEnvelope,
} from './request.js';

function compatibilityPolicy(layer: UpstreamCompatibilityPolicy) {
  return resolveUpstreamCompatibilityPolicy(layer);
}

describe('canonical request helpers', () => {
  it('normalizes a count_tokens request without provider-owned fields', () => {
    const request = createCanonicalRequestEnvelope({
      operation: 'count_tokens',
      surface: 'anthropic-messages',
      cliProfile: 'claude_code',
      requestedModel: ' claude-sonnet-4-5 ',
      stream: false,
      continuation: {
        sessionId: '  session-1  ',
        promptCacheKey: '  cache-1  ',
      },
    });

    expect(request).toEqual({
      operation: 'count_tokens',
      surface: 'anthropic-messages',
      cliProfile: 'claude_code',
      requestedModel: 'claude-sonnet-4-5',
      stream: false,
      messages: [],
      continuation: {
        sessionId: 'session-1',
        promptCacheKey: 'cache-1',
      },
    });
  });

  it('defaults generate requests to generic profile and empty collections', () => {
    const request = createCanonicalRequestEnvelope({
      requestedModel: 'gpt-5.2-codex',
      surface: 'openai-responses',
    });

    expect(request).toEqual({
      operation: 'generate',
      surface: 'openai-responses',
      cliProfile: 'generic',
      requestedModel: 'gpt-5.2-codex',
      stream: false,
      messages: [],
    });
  });

  it('parses metadata and explicit function tool choice from OpenAI-compatible bodies', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'gpt-5',
        stream: true,
        metadata: { user_id: 'user-1' },
        tools: [{
          type: 'function',
          function: {
            name: 'Glob',
            description: 'Search files',
            strict: true,
            parameters: {
              type: 'object',
              properties: {
                pattern: { type: 'string' },
              },
            },
          },
        }],
        tool_choice: {
          type: 'function',
          function: {
            name: 'Glob',
          },
        },
        messages: [{ role: 'user', content: 'hello' }],
      },
      surface: 'openai-chat',
    });

    expect(request).toMatchObject({
      requestedModel: 'gpt-5',
      stream: true,
      metadata: { user_id: 'user-1' },
      tools: [{
        name: 'Glob',
        description: 'Search files',
        strict: true,
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
          },
        },
      }],
      toolChoice: {
        type: 'tool',
        name: 'Glob',
      },
    });
  });

  it('collects continuation session ids from OpenAI-compatible metadata and custom session fields', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'gpt-5',
        stream: false,
        session_id: 'session-body-1',
        conversation_id: 'conversation-body-1',
        metadata: {
          user_id: 'session-metadata-1',
        },
        messages: [{ role: 'user', content: 'hello' }],
      },
      surface: 'openai-chat',
    });

    expect(request).toMatchObject({
      continuation: {
        sessionId: 'session-metadata-1',
      },
    });
  });

  it('collects continuation turnState from OpenAI-compatible metadata namespace', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'gpt-5',
        stream: false,
        metadata: {
          metapi_turn_state: 'turn-state-1',
        },
        messages: [{ role: 'user', content: 'hello' }],
      },
      surface: 'openai-chat',
    });

    expect(request).toMatchObject({
      continuation: {
        turnState: 'turn-state-1',
      },
    });
  });

  it('materializes continuation session ids into metadata.user_id without overwriting explicit metadata', () => {
    const body = canonicalRequestToOpenAiChatBody({
      operation: 'generate',
      surface: 'anthropic-messages',
      cliProfile: 'claude_code',
      requestedModel: 'claude-sonnet-4-5',
      stream: false,
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      continuation: {
        sessionId: 'session-bridge-1',
        promptCacheKey: 'cache-1',
      },
      metadata: {
        existing: true,
      },
    });

    expect(body).toMatchObject({
      metadata: {
        existing: true,
        user_id: 'session-bridge-1',
      },
      prompt_cache_key: 'cache-1',
    });
  });

  it('materializes continuation turnState into metadata without overwriting explicit metadata', () => {
    const body = canonicalRequestToOpenAiChatBody({
      operation: 'generate',
      surface: 'openai-chat',
      cliProfile: 'codex',
      requestedModel: 'gpt-5',
      stream: true,
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      continuation: {
        turnState: 'turn-state-2',
      },
      metadata: {
        existing: true,
      },
    });

    expect(body).toMatchObject({
      metadata: {
        existing: true,
        metapi_turn_state: 'turn-state-2',
      },
    });
  });

  it('parses anthropic-shaped tools from compatibility bodies', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'gpt-5',
        tools: [{
          name: 'Glob',
          description: 'Search files',
          input_schema: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
            },
          },
        }],
        tool_choice: {
          type: 'tool',
          name: 'Glob',
        },
        messages: [{ role: 'user', content: 'hello' }],
      },
      surface: 'openai-chat',
    });

    expect(request.tools).toEqual([{
      name: 'Glob',
      description: 'Search files',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
        },
      },
    }]);
    expect(request.toolChoice).toEqual({
      type: 'tool',
      name: 'Glob',
    });
  });

  it('drops nameless assistant tool calls before rebuilding OpenAI-compatible upstream bodies', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'deepseek-reasoner',
        messages: [{
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call_missing_name',
            type: 'function',
            function: {
              arguments: '{"pattern":"README*"}',
            },
          }],
        }],
        tools: [{
          type: 'function',
          function: {
            name: 'Glob',
            parameters: { type: 'object' },
          },
        }],
      },
      surface: 'openai-chat',
    });

    const body = canonicalRequestToOpenAiChatBody(request);

    expect(JSON.stringify(body.messages)).not.toContain('call_missing_name');
    expect(JSON.stringify(body.messages)).not.toContain('tool_0');
    expect(body.tools).toEqual([{
      type: 'function',
      function: {
        name: 'Glob',
        parameters: { type: 'object' },
      },
    }]);
  });

  it('drops idless assistant tool calls before rebuilding OpenAI-compatible upstream bodies', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'deepseek-reasoner',
        messages: [{
          role: 'assistant',
          content: '',
          tool_calls: [{
            type: 'function',
            function: {
              name: 'Glob',
              arguments: '{"pattern":"README*"}',
            },
          }],
        }],
        tools: [{
          type: 'function',
          function: {
            name: 'Glob',
            parameters: { type: 'object' },
          },
        }],
      },
      surface: 'openai-chat',
    });

    const body = canonicalRequestToOpenAiChatBody(request);

    expect(JSON.stringify(body.messages)).not.toContain('Glob');
    expect(JSON.stringify(body.messages)).not.toContain('tool_0');
  });

  it('downgrades tool result messages without tool_call_id before rebuilding upstream bodies', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'deepseek-reasoner',
        messages: [{
          role: 'tool',
          content: '{"ok":true}',
        }],
      },
      surface: 'openai-chat',
    });

    const body = canonicalRequestToOpenAiChatBody(request);

    expect(request.messages).toEqual([
      {
        role: 'user',
        parts: [{
          type: 'text',
          text: '[tool_output_missing_call_id] {"ok":true}',
        }],
      },
    ]);
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: '[tool_output_missing_call_id] {"ok":true}',
      },
    ]);
  });

  it('preserves DeepSeek-style assistant reasoning whitespace through canonical chat round-trips', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'deepseek-reasoner',
        messages: [{
          role: 'assistant',
          content: '',
          reasoning_content: ' first step \n second step ',
        }],
      },
      surface: 'openai-chat',
    });

    const body = canonicalRequestToOpenAiChatBody(request);

    expect(body.messages).toEqual([{
      role: 'assistant',
      content: '',
      reasoning_content: ' first step \n second step ',
    }]);
  });

  it('can encode assistant reasoning history as think-tag content for compatible upstreams', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'self-hosted-reasoner',
        messages: [{
          role: 'assistant',
          reasoning_content: ' plan step 1 \n plan step 2 ',
          content: 'visible answer',
        }],
      },
      surface: 'openai-chat',
    });

    const body = canonicalRequestToOpenAiChatBody(request, {
      compatibilityPolicy: compatibilityPolicy({
        reasoningHistory: {
          transport: {
            mode: 'content_think_tag',
          },
        },
      }),
    });

    expect(body.messages).toEqual([{
      role: 'assistant',
      content: '<think>\n plan step 1 \n plan step 2 \n</think>\n\nvisible answer',
    }]);
  });

  it('drops assistant reasoning history when compatibility policy disables history transport', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'stateless-upstream',
        messages: [{
          role: 'assistant',
          reasoning_content: 'private reasoning',
          reasoning_signature: 'sig-private',
          content: 'visible answer',
        }],
      },
      surface: 'openai-chat',
    });

    const body = canonicalRequestToOpenAiChatBody(request, {
      compatibilityPolicy: compatibilityPolicy({
        reasoningHistory: {
          transport: {
            mode: 'drop',
          },
        },
      }),
    });

    expect(body.messages).toEqual([{
      role: 'assistant',
      content: 'visible answer',
    }]);
  });

  it('can force native reasoning on assistant tool-call messages while normal history uses think tags', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'mixed-tool-upstream',
        messages: [{
          role: 'assistant',
          reasoning_content: 'tool plan',
          content: '',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'Glob',
              arguments: '{"pattern":"README*"}',
            },
          }],
        }],
      },
      surface: 'openai-chat',
    });

    const body = canonicalRequestToOpenAiChatBody(request, {
      compatibilityPolicy: compatibilityPolicy({
        reasoningHistory: {
          transport: {
            mode: 'content_think_tag',
            toolCallMessageBehavior: 'native',
          },
        },
      }),
    });

    expect(body.messages).toEqual([{
      role: 'assistant',
      content: '',
      reasoning_content: 'tool plan',
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: {
          name: 'Glob',
          arguments: '{"pattern":"README*"}',
        },
      }],
    }]);
  });

  it('limits assistant reasoning history before encoding it into upstream chat history', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'limited-upstream',
        messages: [{
          role: 'assistant',
          reasoning_content: 'abcdef',
          content: 'visible answer',
        }],
      },
      surface: 'openai-chat',
    });

    const body = canonicalRequestToOpenAiChatBody(request, {
      compatibilityPolicy: compatibilityPolicy({
        reasoningHistory: {
          transport: {
            mode: 'content_think_tag',
            maxReasoningBytes: 3,
          },
        },
      }),
    });

    expect(body.messages).toEqual([{
      role: 'assistant',
      content: '<think>\nabc\n</think>\n\nvisible answer',
    }]);
  });

  it('builds metadata back into OpenAI chat requests', () => {
    const body = canonicalRequestToOpenAiChatBody({
      operation: 'generate',
      surface: 'openai-chat',
      cliProfile: 'generic',
      requestedModel: 'gpt-5',
      stream: false,
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      metadata: { user_id: 'user-1' },
      toolChoice: {
        type: 'tool',
        name: 'Glob',
      },
      tools: [{
        name: 'Glob',
        strict: true,
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
          },
        },
      }],
    });

    expect(body).toMatchObject({
      model: 'gpt-5',
      metadata: { user_id: 'user-1' },
      tool_choice: {
        type: 'function',
        function: {
          name: 'Glob',
        },
      },
      tools: [{
        type: 'function',
        function: {
          name: 'Glob',
          strict: true,
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
            },
          },
        },
      }],
    });
  });

  it('round-trips include continuity metadata back into OpenAI-compatible bodies', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'gpt-5',
        stream: true,
        include: ['reasoning.encrypted_content', 'message.input_image.image_url'],
        reasoning: {
          effort: 'high',
        },
        messages: [{ role: 'user', content: 'hello' }],
      },
      surface: 'openai-responses',
    });

    const body = canonicalRequestToOpenAiChatBody(request);

    expect(body).toMatchObject({
      model: 'gpt-5',
      reasoning_effort: 'high',
      include: ['reasoning.encrypted_content', 'message.input_image.image_url'],
    });
  });

  it('preserves extra fields on tool-shaped raw tool_choice objects', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'gpt-5',
        tool_choice: {
          type: 'tool',
          name: 'browser',
          mode: 'required',
          disable_parallel_tool_use: true,
        },
        messages: [{ role: 'user', content: 'hello' }],
      },
      surface: 'openai-responses',
    });

    const body = canonicalRequestToOpenAiChatBody(request);

    expect(body.tool_choice).toEqual({
      type: 'tool',
      name: 'browser',
      mode: 'required',
      disable_parallel_tool_use: true,
    });
  });

  it('preserves structured tool outputs and top-level attachments through canonical round-trips', () => {
    const request = createCanonicalRequestEnvelope({
      requestedModel: 'gpt-5',
      surface: 'openai-chat',
      attachments: [{
        kind: 'file',
        fileId: 'file-top-level',
      }],
      messages: [{
        role: 'tool',
        parts: [{
          type: 'tool_result',
          toolCallId: 'call_1',
          resultContent: [
            { type: 'text', text: 'tool result' },
            { type: 'image_url', image_url: { url: 'https://example.com/tool.png' } },
          ],
        } as any],
      }],
    });

    const body = canonicalRequestToOpenAiChatBody(request);

    expect(body.attachments).toEqual([{
      kind: 'file',
      fileId: 'file-top-level',
    }]);
    expect(body.messages).toEqual([{
      role: 'tool',
      tool_call_id: 'call_1',
      content: [
        { type: 'text', text: 'tool result' },
        { type: 'image_url', image_url: { url: 'https://example.com/tool.png' } },
      ],
    }]);
  });

  it('preserves richer Responses tools, raw tool_choice, assistant phase, and reasoning signatures through canonical round-trips', () => {
    const request = canonicalRequestFromOpenAiBody({
      body: {
        model: 'gpt-5',
        parallel_tool_calls: false,
        tools: [
          {
            type: 'custom',
            name: 'browser',
            description: 'browse the web',
            format: { type: 'text' },
          },
          {
            type: 'image_generation',
            background: 'transparent',
          },
        ],
        tool_choice: {
          type: 'allowed_tools',
          mode: 'auto',
          tools: [{ type: 'custom', name: 'browser' }],
        },
        messages: [
          {
            role: 'assistant',
            phase: 'analysis',
            reasoning_signature: 'sig_123',
            content: 'thinking',
          },
          {
            role: 'user',
            content: 'hello',
          },
        ],
      },
      surface: 'openai-responses',
    });

    const body = canonicalRequestToOpenAiChatBody(request);

    expect(body.parallel_tool_calls).toBe(false);
    expect(body.tools).toEqual([
      {
        type: 'custom',
        name: 'browser',
        description: 'browse the web',
        format: { type: 'text' },
      },
      {
        type: 'image_generation',
        background: 'transparent',
      },
    ]);
    expect(body.tool_choice).toEqual({
      type: 'allowed_tools',
      mode: 'auto',
      tools: [{ type: 'custom', name: 'browser' }],
    });
    expect(body.messages).toMatchObject([
      {
        role: 'assistant',
        phase: 'analysis',
        reasoning_signature: 'sig_123',
        content: 'thinking',
      },
      {
        role: 'user',
        content: 'hello',
      },
    ]);
  });

  it('writes raw canonical tool types back into OpenAI-compatible bodies when the raw payload omits the discriminator', () => {
    const request = createCanonicalRequestEnvelope({
      requestedModel: 'gpt-5',
      surface: 'openai-responses',
      tools: [{
        type: 'custom',
        raw: {
          name: 'browser',
          description: 'browse the web',
          format: { type: 'text' },
        },
      }],
    });

    const body = canonicalRequestToOpenAiChatBody(request);

    expect(body.tools).toEqual([{
      type: 'custom',
      name: 'browser',
      description: 'browse the web',
      format: { type: 'text' },
    }]);
  });
});
