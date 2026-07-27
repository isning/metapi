import { anthropicMessagesTransformer } from '../../anthropic/messages/index.js';
import { createProxyStreamLifecycle } from '../../shared/protocolLifecycle.js';
import { type DownstreamFormat, type ParsedSseEvent } from '../../shared/normalized.js';
import {
  createOpenAiChatAggregateState,
  applyOpenAiChatStreamEvent,
  finalizeOpenAiChatAggregate,
  OpenAiChatStreamAggregateLimitError,
} from './aggregator.js';
import {
  buildNormalizedFinalToOpenAiChatChunks,
  normalizeOpenAiChatFinalToNormalized,
} from './responseBridge.js';
import { openAiChatStream } from './streamBridge.js';
import { config } from '../../../config.js';

type StreamReader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<unknown>;
  releaseLock(): void;
};

type ChatProxyStreamSessionInput = {
  downstreamFormat: DownstreamFormat;
  modelName: string;
  successfulUpstreamPath: string;
  onParsedPayload?: (payload: unknown) => void;
  onMeaningfulOutput?: () => void;
  writeLines: (lines: string[]) => void;
  writeRaw: (chunk: string) => void;
};

type ResponseSink = {
  end(): void;
};

type ChatProxyStreamResult = {
  status: 'completed' | 'failed';
  errorMessage: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

function hasMeaningfulClaudeContentBlock(block: unknown): boolean {
  if (!isRecord(block)) return false;
  const blockType = typeof block.type === 'string' ? block.type : '';
  if (blockType === 'text') return hasText(block.text);
  if (blockType === 'thinking') return hasText(block.thinking ?? block.text);
  if (blockType === 'redacted_thinking') return hasText(block.data);
  if (blockType === 'tool_use') {
    if (hasText(block.id) || hasText(block.name)) return true;
    if (isRecord(block.input)) return Object.keys(block.input).length > 0;
    return hasText(block.input);
  }
  return false;
}

function hasMeaningfulClaudePayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const payloadType = typeof payload.type === 'string' ? payload.type : '';
  if (payloadType === 'message_start' && isRecord(payload.message)) {
    const content = payload.message.content;
    return Array.isArray(content) && content.some(hasMeaningfulClaudeContentBlock);
  }
  if (payloadType === 'content_block_start') {
    return hasMeaningfulClaudeContentBlock(payload.content_block);
  }
  if (payloadType !== 'content_block_delta' || !isRecord(payload.delta)) return false;

  const delta = payload.delta;
  const deltaType = typeof delta.type === 'string' ? delta.type : '';
  if (deltaType === 'text_delta') return hasText(delta.text);
  if (deltaType === 'thinking_delta') return hasText(delta.thinking ?? delta.text);
  if (deltaType === 'input_json_delta') return hasText(delta.partial_json);
  return false;
}

function hasMeaningfulNormalizedStreamEvent(event: {
  contentDelta?: string;
  reasoningDelta?: string;
  redactedReasoningContent?: string;
  toolCallDeltas?: Array<{ id?: string; name?: string; argumentsDelta?: string }>;
}): boolean {
  if (hasText(event.contentDelta)) return true;
  if (hasText(event.reasoningDelta)) return true;
  if (hasText(event.redactedReasoningContent)) return true;
  return Array.isArray(event.toolCallDeltas)
    && event.toolCallDeltas.some((toolCall) => (
      hasText(toolCall.id)
      || hasText(toolCall.name)
      || hasText(toolCall.argumentsDelta)
    ));
}

export function createChatProxyStreamSession(input: ChatProxyStreamSessionInput) {
  const downstreamTransformer = input.downstreamFormat === 'claude'
    ? anthropicMessagesTransformer
    : {
      createStreamContext: openAiChatStream.createContext,
      transformStreamEvent: openAiChatStream.normalizeEvent,
      serializeStreamEvent: openAiChatStream.serializeEvent,
      serializeDone: openAiChatStream.serializeDone,
      pullSseEvents: openAiChatStream.pullSseEvents,
    };
  const streamContext = downstreamTransformer.createStreamContext(input.modelName);
  const claudeContext = anthropicMessagesTransformer.createDownstreamContext();
  const chatAggregateState = input.downstreamFormat === 'openai'
    ? createOpenAiChatAggregateState({
      maxReasoningBytes: config.proxyStreamMaxReasoningBytes,
      maxContentBytes: config.proxyStreamMaxContentBytes,
      maxToolArgumentBytes: config.proxyStreamMaxToolArgumentBytes,
      maxAggregateBytes: config.proxyStreamMaxAggregateBytes,
    })
    : null;
  let finalized = false;
  let terminalResult: ChatProxyStreamResult = {
    status: 'completed',
    errorMessage: null,
  };
  let terminalNormalizedFinal: ReturnType<typeof normalizeOpenAiChatFinalToNormalized> | null = null;
  let forwardedDownstreamOutput = false;
  let openAiStreamHasMeaningfulOutput = false;
  let claudeStreamHasMeaningfulOutput = false;
  let meaningfulOutputObserved = false;
  const pendingWrites: string[] = [];

  const extractFailureMessage = (payload: unknown, fallback = 'upstream stream failed'): string => {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      if (record.error && typeof record.error === 'object' && !Array.isArray(record.error)) {
        const message = (record.error as Record<string, unknown>).message;
        if (typeof message === 'string' && message.trim()) return message.trim();
      }
      if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
      if (record.response && typeof record.response === 'object' && !Array.isArray(record.response)) {
        const responseError = (record.response as Record<string, unknown>).error;
        if (responseError && typeof responseError === 'object' && !Array.isArray(responseError)) {
          const message = (responseError as Record<string, unknown>).message;
          if (typeof message === 'string' && message.trim()) return message.trim();
        }
      }
    }
    return fallback;
  };

  const markFailed = (payload: unknown, fallbackMessage?: string) => {
    terminalResult = {
      status: 'failed',
      errorMessage: extractFailureMessage(payload, fallbackMessage),
    };
  };

  const hasMeaningfulChatAggregateOutput = (): boolean => {
    if (input.downstreamFormat !== 'openai' || !chatAggregateState) return false;
    for (const choice of chatAggregateState.choices.values()) {
      if (choice.content.length > 0) return true;
      if (choice.reasoning.length > 0) return true;
      if (choice.toolCalls.some((item) => item.id || item.name || item.arguments)) return true;
    }
    return false;
  };

  const hasMeaningfulNormalizedFinalOutput = (): boolean => {
    if (!terminalNormalizedFinal) return false;
    const choices = Array.isArray(terminalNormalizedFinal.choices)
      ? terminalNormalizedFinal.choices
      : [];
    if (choices.some((choice) => (
      choice.content.length > 0
      || choice.reasoningContent.length > 0
      || choice.toolCalls.some((toolCall) => toolCall.id || toolCall.name || toolCall.arguments)
    ))) {
      return true;
    }
    if (terminalNormalizedFinal.content.length > 0) return true;
    if (terminalNormalizedFinal.reasoningContent.length > 0) return true;
    return terminalNormalizedFinal.toolCalls.some((toolCall) => toolCall.id || toolCall.name || toolCall.arguments);
  };

  const flushPendingWrites = () => {
    if (pendingWrites.length <= 0) return;
    input.writeLines([...pendingWrites]);
    pendingWrites.length = 0;
  };

  const shouldBufferUntilMeaningfulOutput = (): boolean => (
    config.proxyEmptyContentFailEnabled
    && (input.downstreamFormat === 'openai' || input.downstreamFormat === 'claude')
  );

  const emitLines = (lines: string[], options?: { meaningful?: boolean; force?: boolean }) => {
    if (lines.length <= 0) return;
    if (options?.meaningful && !meaningfulOutputObserved) {
      meaningfulOutputObserved = true;
      input.onMeaningfulOutput?.();
    }
    if (!shouldBufferUntilMeaningfulOutput()) {
      input.writeLines(lines);
      return;
    }
    if (forwardedDownstreamOutput) {
      input.writeLines(lines);
      return;
    }
    if (options?.force) {
      pendingWrites.length = 0;
      forwardedDownstreamOutput = true;
      input.writeLines(lines);
      return;
    }
    if (options?.meaningful) {
      forwardedDownstreamOutput = true;
      flushPendingWrites();
      input.writeLines(lines);
      return;
    }
    pendingWrites.push(...lines);
  };

  const emitRaw = (chunk: string, options?: { meaningful?: boolean; force?: boolean }) => {
    if (!chunk) return;
    if (options?.meaningful && !meaningfulOutputObserved) {
      meaningfulOutputObserved = true;
      input.onMeaningfulOutput?.();
    }
    if (!shouldBufferUntilMeaningfulOutput()) {
      input.writeRaw(chunk);
      return;
    }
    if (forwardedDownstreamOutput) {
      input.writeRaw(chunk);
      return;
    }
    if (options?.force) {
      pendingWrites.length = 0;
      forwardedDownstreamOutput = true;
      input.writeRaw(chunk);
      return;
    }
    if (options?.meaningful) {
      forwardedDownstreamOutput = true;
      flushPendingWrites();
      input.writeRaw(chunk);
      return;
    }
    pendingWrites.push(chunk);
  };

  const shouldFailEmptyChatCompletion = (): boolean => {
    if (!config.proxyEmptyContentFailEnabled) return false;
    if (terminalResult.status === 'failed') return false;
    if (input.downstreamFormat === 'openai' && (openAiStreamHasMeaningfulOutput || hasMeaningfulChatAggregateOutput())) return false;
    if (input.downstreamFormat === 'claude' && claudeStreamHasMeaningfulOutput) return false;
    if (hasMeaningfulNormalizedFinalOutput()) return false;
    return true;
  };

  const hasMeaningfulOpenAiOutput = (): boolean => (
    openAiStreamHasMeaningfulOutput || hasMeaningfulChatAggregateOutput()
  );

  const finalize = () => {
    if (finalized) return;
    finalized = true;

    if (shouldFailEmptyChatCompletion()) {
      markFailed({
        error: {
          message: 'Upstream returned empty content',
        },
      }, 'Upstream returned empty content');
      return;
    }

    if (shouldBufferUntilMeaningfulOutput() && !forwardedDownstreamOutput) {
      forwardedDownstreamOutput = true;
      flushPendingWrites();
    }

    // For native Anthropic streams, EOF without message_stop is not a clean
    // completion. Forward the partial stream as-is instead of fabricating an
    // end_turn/message_stop pair that makes clients think the run finished.
    if (input.downstreamFormat === 'claude' && !claudeContext.doneSent) {
      return;
    }

    if (
      input.downstreamFormat === 'openai'
      && terminalResult.status !== 'failed'
      && chatAggregateState
      && chatAggregateState.choices.size > 0
    ) {
      const needsTerminalFinishChunk = Array.from(chatAggregateState.choices.values())
        .some((choice) => !choice.finishReason);
      if (needsTerminalFinishChunk) {
        const terminalChunk = buildNormalizedFinalToOpenAiChatChunks(
          finalizeOpenAiChatAggregate(chatAggregateState, {
            id: streamContext.id,
            model: streamContext.model,
            created: streamContext.created,
            content: '',
            reasoningContent: '',
            finishReason: 'stop',
            toolCalls: [],
          }),
        ).slice(-1)[0];
        if (terminalChunk) {
          emitLines([`data: ${JSON.stringify(terminalChunk)}\n\n`], { meaningful: hasMeaningfulOpenAiOutput() });
        }
      }
    }

    emitLines(downstreamTransformer.serializeDone(streamContext, claudeContext), {
      meaningful: input.downstreamFormat === 'claude'
        ? claudeStreamHasMeaningfulOutput
        : hasMeaningfulOpenAiOutput(),
    });
  };

  const handleEventBlock = async (eventBlock: ParsedSseEvent): Promise<boolean> => {
    if (eventBlock.data === '[DONE]') {
      finalize();
      return true;
    }

    let parsedPayload: unknown = null;
    if (input.downstreamFormat === 'claude') {
      const consumed = anthropicMessagesTransformer.consumeSseEventBlock(
        eventBlock,
        streamContext,
        claudeContext,
        input.modelName,
      );
      parsedPayload = consumed.parsedPayload;
      if (parsedPayload && typeof parsedPayload === 'object') {
        input.onParsedPayload?.(parsedPayload);
        if (hasMeaningfulClaudePayload(parsedPayload)) {
          claudeStreamHasMeaningfulOutput = true;
        }
      }
      if (consumed.handled) {
        const payloadType = isRecord(parsedPayload) && typeof parsedPayload.type === 'string'
          ? parsedPayload.type
          : '';
        const isFailurePayload = payloadType === 'error';
        if (isFailurePayload) {
          markFailed(parsedPayload);
        }
        emitLines(consumed.lines, {
          meaningful: claudeStreamHasMeaningfulOutput,
          force: isFailurePayload,
        });
        if (consumed.done) {
          finalize();
        }
        return consumed.done;
      }
    } else {
      try {
        parsedPayload = JSON.parse(eventBlock.data);
      } catch {
        parsedPayload = null;
      }
      if (parsedPayload && typeof parsedPayload === 'object') {
        input.onParsedPayload?.(parsedPayload);
      }
    }

    if (parsedPayload && typeof parsedPayload === 'object') {
      const payloadType = typeof (parsedPayload as Record<string, unknown>).type === 'string'
        ? String((parsedPayload as Record<string, unknown>).type)
        : '';
      const isFailurePayload = payloadType === 'response.failed' || payloadType === 'error';
      if (isFailurePayload) {
        markFailed(parsedPayload);
      }
      const normalizedEvent = downstreamTransformer.transformStreamEvent(parsedPayload, streamContext, input.modelName);
      const normalizedHasMeaningfulOutput = hasMeaningfulNormalizedStreamEvent(normalizedEvent);
      if (normalizedHasMeaningfulOutput) {
        if (input.downstreamFormat === 'claude') {
          claudeStreamHasMeaningfulOutput = true;
        } else if (input.downstreamFormat === 'openai') {
          openAiStreamHasMeaningfulOutput = true;
        }
      }
      if (input.downstreamFormat === 'openai' && chatAggregateState) {
        try {
          applyOpenAiChatStreamEvent(chatAggregateState, normalizedEvent);
        } catch (error) {
          if (error instanceof OpenAiChatStreamAggregateLimitError) {
            markFailed({
              error: {
                message: error.message,
                type: 'upstream_response_too_large',
              },
            }, error.message);
            return true;
          }
          throw error;
        }
      }
      emitLines(
        downstreamTransformer.serializeStreamEvent(normalizedEvent, streamContext, claudeContext),
        {
          meaningful: input.downstreamFormat === 'claude'
            ? claudeStreamHasMeaningfulOutput
            : hasMeaningfulOpenAiOutput(),
          force: isFailurePayload,
        },
      );
      return input.downstreamFormat === 'claude' && claudeContext.doneSent;
    }

    if (input.downstreamFormat === 'openai') {
      emitRaw(`data: ${eventBlock.data}\n\n`, { meaningful: true });
      return false;
    }

    claudeStreamHasMeaningfulOutput = true;
    emitLines(anthropicMessagesTransformer.serializeStreamEvent({
      contentDelta: eventBlock.data,
    }, streamContext, claudeContext), { meaningful: true });
    return claudeContext.doneSent;
  };

  return {
    consumeUpstreamFinalPayload(payload: unknown, fallbackText: string, response?: ResponseSink): ChatProxyStreamResult {
      if (payload && typeof payload === 'object') {
        input.onParsedPayload?.(payload);
      }
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const payloadType = typeof (payload as Record<string, unknown>).type === 'string'
          ? String((payload as Record<string, unknown>).type)
          : '';
        if (payloadType === 'response.failed' || payloadType === 'error') {
          markFailed(payload);
        }
      }
      if (input.downstreamFormat === 'openai') {
        const normalizedFinal = normalizeOpenAiChatFinalToNormalized(payload, input.modelName, fallbackText);
        terminalNormalizedFinal = normalizedFinal;
        streamContext.id = normalizedFinal.id;
        streamContext.model = normalizedFinal.model;
        streamContext.created = normalizedFinal.created;
        emitLines(
          buildNormalizedFinalToOpenAiChatChunks(normalizedFinal)
            .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
          { meaningful: hasMeaningfulNormalizedFinalOutput() },
        );
      } else {
        emitLines(
          anthropicMessagesTransformer.serializeUpstreamFinalAsStream(
            payload,
            input.modelName,
            fallbackText,
            streamContext,
            claudeContext,
          ),
          { meaningful: true },
        );
      }
      finalize();
      response?.end();
      return terminalResult;
    },
    async run(reader: StreamReader | null | undefined, response: ResponseSink): Promise<ChatProxyStreamResult> {
      const lifecycle = createProxyStreamLifecycle<ParsedSseEvent>({
        reader,
        response,
        pullEvents: (buffer) => downstreamTransformer.pullSseEvents(buffer),
        handleEvent: handleEventBlock,
        onEof: finalize,
        maxBufferBytes: config.proxyStreamMaxSseBufferBytes,
        onLimitExceeded: (message) => {
          markFailed({
            error: {
              message,
              type: 'upstream_response_too_large',
            },
          }, message);
        },
      });
      await lifecycle.run();
      return terminalResult;
    },
  };
}
