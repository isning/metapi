import { createChatEndpointStrategy } from '../../transformers/shared/chatEndpointStrategy.js';
import {
  promoteRequiredEndpointCandidateAfterProtocolError,
  type CompatibilityEndpoint,
} from '../orchestration/endpointCompatibility.js';
import { unwrapGeminiCliPayload } from '../../transformers/gemini/generate-content/cliBridge.js';
import { createGeminiCliStreamReader } from '../../transformers/gemini/generate-content/cliBridge.js';
import { geminiGenerateContentTransformer } from '../../transformers/gemini/generate-content/index.js';
import { openAiResponsesTransformer } from '../../transformers/openai/responses/index.js';
import { anthropicMessagesTransformer } from '../../transformers/anthropic/messages/index.js';
import {
  inferInputFileMimeType,
  normalizeInputFileBlock,
} from '../../transformers/shared/inputFile.js';
import {
  extractResponsesTerminalResponseId,
  isResponsesPreviousResponseNotFoundError,
  shouldInferResponsesPreviousResponseId,
  stripResponsesPreviousResponseId,
  withResponsesPreviousResponseId,
} from '../../transformers/openai/responses/continuation.js';
import {
  collectResponsesWebsocketOutput,
  isResponsesWebsocketTerminalPayload,
  normalizeResponsesWebsocketRequest,
  shouldHandleResponsesWebsocketPrewarmLocally,
  synthesizePrewarmResponsePayloads,
} from '../../transformers/openai/responses/websocketTransport.js';

export type { CompatibilityEndpoint };

export const protocolAdapters = {
  anthropic: {
    createStreamContext: anthropicMessagesTransformer.createStreamContext,
    createDownstreamContext: anthropicMessagesTransformer.createDownstreamContext,
    serializeUpstreamFinalAsStream: anthropicMessagesTransformer.serializeUpstreamFinalAsStream,
    transformFinalResponse: anthropicMessagesTransformer.transformFinalResponse,
    serializeFinalResponse: anthropicMessagesTransformer.serializeFinalResponse,
  },
  chat: {
    createEndpointStrategy: createChatEndpointStrategy,
    promoteRequiredEndpointCandidateAfterProtocolError,
  },
  responses: {
    createEndpointStrategy: openAiResponsesTransformer.compatibility.createEndpointStrategy,
    pullSseEvents: openAiResponsesTransformer.pullSseEvents,
    createStreamContext: openAiResponsesTransformer.createStreamContext,
    transformStreamEvent: openAiResponsesTransformer.transformStreamEvent,
    aggregator: {
      createState: openAiResponsesTransformer.aggregator.createState,
      serialize: openAiResponsesTransformer.aggregator.serialize,
    },
    extractTerminalResponseId: extractResponsesTerminalResponseId,
    isPreviousResponseNotFoundError: isResponsesPreviousResponseNotFoundError,
    shouldInferPreviousResponseId: shouldInferResponsesPreviousResponseId,
    stripPreviousResponseId: stripResponsesPreviousResponseId,
    withPreviousResponseId: withResponsesPreviousResponseId,
    websocket: {
      normalizeRequest: normalizeResponsesWebsocketRequest,
      shouldHandlePrewarmLocally: shouldHandleResponsesWebsocketPrewarmLocally,
      synthesizePrewarmResponsePayloads,
      collectOutput: collectResponsesWebsocketOutput,
      isTerminalPayload: isResponsesWebsocketTerminalPayload,
    },
  },
  geminiCli: {
    unwrapPayload: unwrapGeminiCliPayload,
    createStreamReader: createGeminiCliStreamReader,
  },
  gemini: {
    stream: {
      parseGeminiStreamPayload: geminiGenerateContentTransformer.stream.parseGeminiStreamPayload,
      createAggregateState: geminiGenerateContentTransformer.stream.createAggregateState,
      applyAggregate: geminiGenerateContentTransformer.stream.applyAggregate,
      serializeAggregateJsonPayload: geminiGenerateContentTransformer.stream.serializeAggregateJsonPayload,
    },
  },
  inputFile: {
    inferMimeType: inferInputFileMimeType,
    normalizeBlock: normalizeInputFileBlock,
  },
};
