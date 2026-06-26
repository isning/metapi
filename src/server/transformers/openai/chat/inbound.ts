import { parseDownstreamChatRequest } from '../../shared/normalized.js';
import { createProtocolRequestEnvelope } from '../../shared/protocolModel.js';
import { extractChatRequestMetadata } from './helpers.js';
import type { OpenAiChatParsedRequest, OpenAiChatRequestEnvelope } from './model.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeToolName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeOpenAiChatTools(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.tools)) return body;

  const tools = body.tools.flatMap((tool): unknown[] => {
    if (!isRecord(tool)) return [];
    const type = normalizeToolName(tool.type).toLowerCase();
    if (type !== 'function' || !isRecord(tool.function)) return [];

    const name = normalizeToolName(tool.function.name);
    if (!name) return [];

    return [{
      ...tool,
      type: 'function',
      function: {
        ...tool.function,
        name,
      },
    }];
  });

  const next = { ...body };
  if (tools.length > 0) {
    next.tools = tools;
  } else {
    delete next.tools;
    delete next.tool_choice;
  }
  return next;
}

export const openAiChatInbound = {
  parse(body: unknown): { value?: OpenAiChatRequestEnvelope; error?: { statusCode: number; payload: unknown } } {
    const parsed = parseDownstreamChatRequest(body, 'openai') as {
      value?: OpenAiChatParsedRequest;
      error?: { statusCode: number; payload: unknown };
    };
    if (parsed.error) {
      return { error: parsed.error };
    }
    if (!parsed.value) {
      return {
        error: {
          statusCode: 400,
          payload: {
            error: {
              message: 'invalid chat request',
              type: 'invalid_request_error',
            },
          },
        },
      };
    }

    const sanitizedParsedValue = {
      ...parsed.value,
      upstreamBody: sanitizeOpenAiChatTools(parsed.value.upstreamBody),
    };
    const metadata = extractChatRequestMetadata(body);
    return {
      value: createProtocolRequestEnvelope({
        protocol: 'openai/chat',
        model: sanitizedParsedValue.requestedModel,
        stream: sanitizedParsedValue.isStream,
        rawBody: body,
        parsed: sanitizedParsedValue,
        ...(metadata ? { metadata } : {}),
      }),
    };
  },
};
