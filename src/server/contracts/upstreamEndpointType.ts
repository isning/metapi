export type UpstreamEndpointType = string;

const API_TYPE_ENDPOINT_TYPES: Record<string, UpstreamEndpointType> = {
  openai_chat_completions: 'openai.chat_completions',
  newapi_chat_completions: 'openai.chat_completions',
  openai_responses: 'openai.responses',
  newapi_responses: 'openai.responses',
  anthropic_messages: 'anthropic.messages',
  openai_embeddings: 'openai.embeddings',
  openai_completions: 'openai.completions',
  openai_images_generations: 'openai.images.generations',
  openai_images_edits: 'openai.images.edits',
  openai_videos_generations: 'openai.videos.generations',
  openai_videos: 'openai.videos',
  gemini_generate_content: 'gemini.generate_content',
  custom_http: 'custom.http',
  vendor_native: 'custom.vendor_native',
};

const UPSTREAM_ENDPOINT_TYPES: Record<string, UpstreamEndpointType> = {
  chat: 'openai.chat_completions',
  messages: 'anthropic.messages',
  responses: 'openai.responses',
  gemini: 'gemini.generate_content',
  embeddings: 'openai.embeddings',
  completions: 'openai.completions',
  'images/generations': 'openai.images.generations',
  'images/edits': 'openai.images.edits',
  'videos/generations': 'openai.videos.generations',
  videos: 'openai.videos',
};

function normalizedCustomType(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '_');
  return normalized ? `custom:${normalized}` : 'custom.http';
}

export function endpointTypeFromApiType(apiType?: string | null): UpstreamEndpointType | null {
  const normalized = String(apiType || '').trim().toLowerCase();
  return API_TYPE_ENDPOINT_TYPES[normalized] || null;
}

export function endpointTypeFromUpstreamEndpoint(
  endpoint?: string | null,
): UpstreamEndpointType | null {
  const normalized = String(endpoint || '').trim().toLowerCase();
  return UPSTREAM_ENDPOINT_TYPES[normalized] || null;
}

export function endpointTypeFromRequest(input: {
  path?: string | null;
  downstreamFormat?: string | null;
}): UpstreamEndpointType {
  const format = String(input.downstreamFormat || '').trim().toLowerCase();
  const knownFormat = (
    format === 'responses'
    || format === 'responses.websocket'
    || format === 'openai/chat'
    || format === 'claude'
    || format === 'anthropic/messages'
    || format === 'gemini'
    || format === 'openai/embeddings'
    || format === 'openai/completions'
    || format === 'openai/images'
    || format === 'openai/videos'
    || /^(?:openai|anthropic|gemini)\.[a-z0-9._-]+$/u.test(format)
  );
  if (format && !knownFormat) {
    if (/^custom(?::|\.)[a-z0-9._-]+$/u.test(format)) return format;
    return normalizedCustomType(format);
  }

  const path = String(input.path || '').trim().toLowerCase().replace(/\/+$/u, '');
  if (path.includes(':websocket')) return 'openai.responses.websocket';
  if (path.includes('/messages/count_tokens')) return 'anthropic.messages.count_tokens';
  if (path.includes('/messages')) return 'anthropic.messages';
  if (path.includes('/responses/compact')) return 'openai.responses.compact';
  if (path.includes('/responses')) return 'openai.responses';
  if (path.includes('/embeddings')) return 'openai.embeddings';
  if (path.includes('/images/edits')) return 'openai.images.edits';
  if (path.includes('/images')) return 'openai.images.generations';
  if (path.includes('/videos')) return 'openai.videos';
  if (path.includes('generatecontent')) return 'gemini.generate_content';
  if (path.includes('counttokens')) return 'gemini.count_tokens';
  if (path.includes('/chat/completions')) return 'openai.chat_completions';
  if (path.includes('/completions')) return 'openai.completions';

  if (/^(?:openai|anthropic|gemini)\.[a-z0-9._-]+$/u.test(format)) return format;
  if (format === 'responses') return 'openai.responses';
  if (format === 'responses.websocket') return 'openai.responses.websocket';
  if (format === 'openai/chat') return 'openai.chat_completions';
  if (format === 'claude' || format === 'anthropic/messages') return 'anthropic.messages';
  if (format === 'gemini') return 'gemini.generate_content';
  if (format === 'openai/embeddings') return 'openai.embeddings';
  if (format === 'openai/completions') return 'openai.completions';
  if (format === 'openai/images') return 'openai.images.generations';
  if (format === 'openai/videos') return 'openai.videos';
  return format ? normalizedCustomType(format) : 'custom.http';
}
