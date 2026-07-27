import {
  DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY,
  type ResolvedUpstreamCompatibilityPolicy,
} from '../../contracts/upstreamCompatibilityPolicy.js';
import { limitReasoningHistoryText } from '../shared/reasoningHistoryPolicy.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item)) as T;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]),
    ) as T;
  }
  return value;
}

function extractReasoningText(message: Record<string, unknown>): string {
  for (const key of ['reasoning_content', 'reasoning', 'thinking']) {
    const value = message[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

function removeReasoningCarriers(message: Record<string, unknown>): void {
  delete message.reasoning_content;
  delete message.reasoning;
  delete message.thinking;
  delete message.reasoning_signature;
  delete message.signature;
}

function prependThinkTagToContent(input: {
  content: unknown;
  reasoning: string;
  policy: ResolvedUpstreamCompatibilityPolicy;
}): string | Array<Record<string, unknown>> {
  const { openTag, closeTag, separator } = input.policy.reasoningHistory.transport.thinkTag;
  const taggedReasoning = `${openTag}\n${input.reasoning}\n${closeTag}${separator}`;
  if (Array.isArray(input.content)) {
    return [
      {
        type: 'text',
        text: taggedReasoning,
      },
      ...input.content
        .filter((item): item is Record<string, unknown> => isRecord(item))
        .map((item) => cloneJsonValue(item)),
    ];
  }
  return `${taggedReasoning}${typeof input.content === 'string' ? input.content : ''}`;
}

function resolveAssistantReasoningTransportMode(input: {
  message: Record<string, unknown>;
  policy: ResolvedUpstreamCompatibilityPolicy;
}): 'native' | 'content_think_tag' | 'drop' {
  const transport = input.policy.reasoningHistory.transport;
  const hasToolCalls = Array.isArray(input.message.tool_calls) && input.message.tool_calls.length > 0;
  if (hasToolCalls) {
    if (!transport.applyTo.assistantToolCalls) return 'drop';
    if (transport.toolCallMessageBehavior !== 'same_as_assistant') {
      return transport.toolCallMessageBehavior;
    }
  } else if (!transport.applyTo.assistantHistory) {
    return 'drop';
  }
  return transport.mode;
}

export function applyOpenAiChatReasoningHistoryTransport(
  body: Record<string, unknown>,
  policy: ResolvedUpstreamCompatibilityPolicy = DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY,
): Record<string, unknown> {
  if (!Array.isArray(body.messages)) return cloneJsonValue(body);

  return {
    ...cloneJsonValue(body),
    messages: body.messages.map((rawMessage) => {
      if (!isRecord(rawMessage)) return cloneJsonValue(rawMessage);
      const message = cloneJsonValue(rawMessage);
      const role = typeof message.role === 'string' ? message.role.trim().toLowerCase() : '';
      if (role !== 'assistant') return message;

      const rawReasoning = extractReasoningText(message);
      const limitedReasoning = limitReasoningHistoryText(rawReasoning, policy);
      const reasoning = limitedReasoning.text;
      const hasReasoningSignature = (
        typeof message.reasoning_signature === 'string' && message.reasoning_signature.length > 0
      ) || (
        typeof message.signature === 'string' && message.signature.length > 0
      );
      if (!rawReasoning && !hasReasoningSignature) return message;
      if (limitedReasoning.dropped) {
        removeReasoningCarriers(message);
        return message;
      }

      const mode = resolveAssistantReasoningTransportMode({ message, policy });
      if (mode === 'drop') {
        removeReasoningCarriers(message);
        return message;
      }

      if (mode === 'content_think_tag') {
        removeReasoningCarriers(message);
        if (reasoning) {
          message.content = prependThinkTagToContent({
            content: message.content,
            reasoning,
            policy,
          });
        }
        return message;
      }

      delete message.reasoning;
      delete message.thinking;
      if (reasoning) message.reasoning_content = reasoning;
      if (typeof message.signature === 'string' && !message.reasoning_signature) {
        message.reasoning_signature = message.signature;
      }
      delete message.signature;
      return message;
    }),
  };
}
