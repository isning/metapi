import { describe, expect, it } from 'vitest';
import { analyzeResponsesRuntimeCapability } from './responsesCapabilityAnalysis.js';

describe('analyzeResponsesRuntimeCapability', () => {
  it('allows the lossless bridge subset to retain existing compatibility fallback', () => {
    expect(analyzeResponsesRuntimeCapability({
      model: 'gpt-5',
      input: [{
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      }],
      tools: [{
        type: 'function',
        name: 'get_weather',
        parameters: { type: 'object' },
      }],
      tool_choice: 'auto',
    })).toBeUndefined();
  });

  it('requires native Responses for all Responses-only tools and stateful fields', () => {
    const requirement = analyzeResponsesRuntimeCapability({
      model: 'gpt-5',
      input: 'hello',
      conversation: 'conv_123',
      previous_response_id: 'resp_123',
      background: true,
      tools: [
        { type: 'web_search_preview' },
        { type: 'file_search', vector_store_ids: ['vs_123'] },
        { type: 'computer', computer_environment: 'browser' },
        { type: 'mcp', server_label: 'remote' },
        { type: 'code_interpreter', container: { type: 'auto' } },
        { type: 'shell' },
        { type: 'image_generation' },
      ],
    });

    expect(requirement).toMatchObject({
      acceptableApiTypes: ['openai_responses', 'newapi_responses'],
      lossPolicy: 'native_required',
      fallbackPolicy: 'single_native_variant',
    });
    expect(requirement?.diagnostics?.map((diagnostic) => diagnostic.values?.feature)).toEqual(expect.arrayContaining([
      'native.responses.field.conversation',
      'native.responses.field.previous_response_id',
      'native.responses.field.background',
      'native.responses.tool.web_search_preview',
      'native.responses.tool.file_search',
      'native.responses.tool.computer',
      'native.responses.tool.mcp',
      'native.responses.tool.code_interpreter',
      'native.responses.tool.shell',
      'native.responses.tool.image_generation',
    ]));
  });

  it('requires native Responses for extension input items instead of dropping them in chat fallback', () => {
    const requirement = analyzeResponsesRuntimeCapability({
      model: 'gpt-5',
      input: [
        { type: 'mcp_approval_response', approval_request_id: 'apr_123', approve: true },
        { type: 'computer_call_output', call_id: 'call_123', output: { type: 'computer_screenshot', image_url: 'https://example.com/a.png' } },
        { type: 'item_reference', id: 'msg_123' },
      ],
    });

    expect(requirement?.diagnostics?.map((diagnostic) => diagnostic.values?.feature)).toEqual(expect.arrayContaining([
      'native.responses.input_item.mcp_approval_response',
      'native.responses.input_item.computer_call_output',
      'native.responses.input_item.item_reference',
    ]));
  });

  it('requires native Responses when Codex declares additional custom tools in input', () => {
    const requirement = analyzeResponsesRuntimeCapability({
      model: 'gpt-5.6-terra',
      input: [
        {
          type: 'additional_tools',
          role: 'developer',
          tools: [{
            type: 'custom',
            name: 'exec',
            format: { type: 'grammar', syntax: 'lark', definition: 'start: SOURCE' },
          }],
        },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      ],
    });

    expect(requirement).toMatchObject({
      acceptableApiTypes: ['openai_responses', 'newapi_responses'],
      lossPolicy: 'native_required',
      fallbackPolicy: 'single_native_variant',
    });
    expect(requirement?.diagnostics?.map((diagnostic) => diagnostic.values?.feature)).toContain(
      'native.responses.input_item.additional_tools',
    );
  });
});
