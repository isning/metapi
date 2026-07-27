import { openaiChatProtocolAdapter } from './openaiChat.js';
import { claudeProtocolAdapter } from './claude.js';
import { responsesProtocolAdapter } from './responses.js';
import { geminiProtocolAdapter } from './gemini.js';
import { openaiEmbeddingsProtocolAdapter } from './embeddings.js';
import { openaiCompletionsProtocolAdapter } from './completions.js';
import { openaiImagesProtocolAdapter } from './images.js';
import { openaiVideosProtocolAdapter } from './videos.js';
import type { DownstreamProtocolAdapter } from './types.js';

const downstreamProtocolAdapters: DownstreamProtocolAdapter[] = [
  openaiChatProtocolAdapter,
  claudeProtocolAdapter,
  responsesProtocolAdapter,
  geminiProtocolAdapter,
  openaiEmbeddingsProtocolAdapter,
  openaiCompletionsProtocolAdapter,
  openaiImagesProtocolAdapter,
  openaiVideosProtocolAdapter,
];

export function getAllDownstreamProtocolAdapters(): DownstreamProtocolAdapter[] {
  return downstreamProtocolAdapters;
}
