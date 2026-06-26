import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { clearAuthSession, getAuthToken } from '../authSession.js';
import {
  DEBUG_TABS,
  DEFAULT_INPUTS,
  DEFAULT_MODE_STATE,
  DEFAULT_PARAMETER_ENABLED,
  MODEL_TESTER_STORAGE_KEY,
  MESSAGE_STATUS,
  buildApiPayload,
  buildEmbeddingsRequestEnvelope,
  buildFileUploadRequestEnvelope,
  buildGeminiNativeConversationProxyEnvelope,
  buildImagesEditRequestEnvelope,
  buildImagesGenerationsRequestEnvelope,
  buildRawProxyRequestEnvelope,
  buildSearchRequestEnvelope,
  buildVideoCreateRequestEnvelope,
  buildVideoInspectRequestEnvelope,
  attachForcedTargetToEnvelope,
  countConversationTurns,
  collectModelTesterModelNames,
  createLoadingAssistantMessage,
  createMessage,
  createConversationUserMessage,
  extractConversationUploadedFilesFromMessage,
  filterModelTesterModelNames,
  finalizeIncompleteMessage,
  findLastLoadingAssistantIndex,
  parseCustomRequestBody,
  parseModelTesterSession,
  processThinkTags,
  resolveConversationReplayFiles,
  serializeModelTesterSession,
  syncCustomRequestBodyToMessages,
  syncMessagesToCustomRequestBody,
  type ChatMessage,
  type ConversationDraftFile,
  type ConversationContentPart,
  type ConversationUploadedFile,
  type DebugTab,
  type ModelTesterInputs,
  type ModelTesterModeState,
    type ParameterEnabled,
    type PlaygroundMode,
    type PlaygroundProtocol,
    type PlaygroundMultipartFile,
    type ProxyTestEnvelope,
    type TestTargetFormat,
    type TestChatPayload,
  } from './helpers/modelTesterSession.js';
import {
  buildConversationFileAccept,
  buildConversationFileHint,
  isConversationUploadedFileSupported,
  resolveConversationFileCapability,
} from './helpers/conversationFileCapabilities.js';
import ConversationComposer from './model-tester/ConversationComposer.js';
import DebugPanel from './model-tester/DebugPanel.js';
import ModelRouteFlow, { type ModelRouteFlowData } from '../components/ModelRouteFlow.js';
import ModernSelect from '../components/ModernSelect.js';
import { useAnimatedVisibility } from '../components/useAnimatedVisibility.js';
import { useIsMobile } from '../components/useIsMobile.js';
import { tr } from '../i18n.js';
import { Button } from '../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import { Skeleton } from '../components/ui/skeleton/index.js';
import { Alert, AlertDescription } from '../components/ui/alert/index.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card/index.js';
import { ScrollArea } from '../components/ui/scroll-area/index.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import { Textarea } from '../components/ui/textarea/index.js';
import JsonCodeEditor from '../components/JsonCodeEditor.js';
import { Input } from '../components/ui/input/index.js';
import { Checkbox } from '../components/ui/checkbox/index.js';
import { Slider } from '../components/ui/slider/index.js';

type ChatJobResponse = {
  jobId: string;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  result?: unknown;
  error?: unknown;
};

type DebugTimelineEntry = {
  at: string;
  level: 'info' | 'warn' | 'error';
  text: string;
};

type UploadState = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

type ConversationFileState = ConversationDraftFile;
type ForcedTargetOption = {
  value: string;
  label: string;
  description?: string;
};

const POLL_INTERVAL_MS = 1200;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const createConversationFileLocalId = () =>
  `draft-file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const summarizeModeRequest = (
  mode: PlaygroundMode,
  input: string,
  modeState: ModelTesterModeState,
  videoAction: 'get' | 'delete',
): string => {
  if (mode === 'embeddings') return input.trim() || modeState.embeddingsInput.trim() || 'Embedding request';
  if (mode === 'search') return input.trim() || modeState.searchQuery.trim() || 'Search request';
  if (mode === 'images.generate' || mode === 'images.edit') return input.trim() || modeState.imagesPrompt.trim() || 'Image request';
  if (mode === 'videos.create') return input.trim() || modeState.videosPrompt.trim() || 'Video request';
  if (mode === 'videos.inspect') {
    const id = input.trim() || modeState.videosInspectId.trim();
    return `${videoAction.toUpperCase()} ${id || 'video'}`;
  }
  return input.trim();
};

const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
  reader.onerror = () => reject(reader.error || new Error(tr('pages.importExport.failedReadFile')));
  reader.readAsDataURL(file);
});

const formatJson = (value: unknown): string => {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const extractErrorMessage = (error: unknown): string => {
  const data = error as any;
  return data?.error?.message || data?.message || 'request failed';
};

const extractClaudeMessageContent = (result: any): { content: string; reasoningContent: string } => {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      contentParts.push(block.text);
      continue;
    }
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      reasoningParts.push(block.thinking);
      continue;
    }
    if (typeof block.text === 'string') {
      contentParts.push(block.text);
    }
  }

  return {
    content: contentParts.join(''),
    reasoningContent: reasoningParts.join('\n\n'),
  };
};

const extractResponsesContent = (result: any): { content: string; reasoningContent: string } => {
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];

  const pushContent = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0) contentParts.push(value);
  };
  const pushReasoning = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0) reasoningParts.push(value);
  };

  const directOutputText = result?.output_text;
  if (typeof directOutputText === 'string') {
    pushContent(directOutputText);
  } else if (Array.isArray(directOutputText)) {
    for (const item of directOutputText) {
      if (typeof item === 'string') {
        pushContent(item);
        continue;
      }
      if (item && typeof item === 'object' && typeof (item as any).text === 'string') {
        pushContent((item as any).text);
      }
    }
  }

  const outputs = Array.isArray(result?.output)
    ? result.output
    : (result && typeof result === 'object' && (Array.isArray(result?.content) || typeof result?.type === 'string'))
      ? [result]
      : [];
  for (const item of outputs) {
    if (!item || typeof item !== 'object') continue;
    const itemType = typeof item.type === 'string' ? item.type : '';

    if (itemType === 'output_text') {
      pushContent(item.text);
      continue;
    }

    if (itemType === 'reasoning') {
      if (typeof item.summary_text === 'string') pushReasoning(item.summary_text);
      if (typeof item.reasoning === 'string') pushReasoning(item.reasoning);
      if (Array.isArray(item.summary)) {
        for (const summaryItem of item.summary) {
          if (summaryItem && typeof summaryItem === 'object' && typeof (summaryItem as any).text === 'string') {
            pushReasoning((summaryItem as any).text);
          }
        }
      }
    }

    const content = Array.isArray((item as any).content) ? (item as any).content : [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const blockType = typeof (block as any).type === 'string' ? (block as any).type : '';
      if (blockType === 'output_text' || blockType === 'text') {
        pushContent((block as any).text);
        continue;
      }
      if (blockType.includes('reasoning')) {
        pushReasoning((block as any).text);
      }
    }
  }

  return {
    content: contentParts.join(''),
    reasoningContent: reasoningParts.join('\n\n'),
  };
};

const extractAssistantResult = (result: unknown): { content: string; reasoningContent: string } => {
  const data = result as any;
  let content = '';
  let reasoning = '';

  if (Array.isArray(data?.choices)) {
    const choice = data.choices[0];
    const maybeContent = choice?.message?.content ?? choice?.text ?? '';
    content = typeof maybeContent === 'string'
      ? maybeContent
      : Array.isArray(maybeContent)
        ? maybeContent
          .map((item) => item?.text ?? '')
          .join('')
        : '';
    reasoning = choice?.message?.reasoning_content || choice?.message?.reasoning || '';
  } else if (data?.type === 'message' && Array.isArray(data?.content)) {
    const parsedClaude = extractClaudeMessageContent(data);
    content = parsedClaude.content;
    reasoning = parsedClaude.reasoningContent;
  } else if (data?.object === 'response' || Array.isArray(data?.output) || typeof data?.output_text === 'string') {
    const parsedResponses = extractResponsesContent(data);
    content = parsedResponses.content;
    reasoning = parsedResponses.reasoningContent;
  } else if (Array.isArray(data?.candidates)) {
    const parts = data?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      content = parts
        .filter((item: any) => !(item?.thought === true))
        .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
        .join('');
      reasoning = parts
        .filter((item: any) => item?.thought === true)
        .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
        .join('');
    }
  }

  const processed = processThinkTags(content, reasoning);

  if (!processed.content && processed.reasoningContent) {
    return {
      content: '[Only reasoning returned]',
      reasoningContent: processed.reasoningContent,
    };
  }
  if (!processed.content && !processed.reasoningContent) {
    return {
      content: formatJson(result),
      reasoningContent: '',
    };
  }

  return processed;
};

const replaceMessageAt = (messages: ChatMessage[], index: number, nextMessage: ChatMessage): ChatMessage[] => [
  ...messages.slice(0, index),
  nextMessage,
  ...messages.slice(index + 1),
];

const applyAssistantSuccess = (messages: ChatMessage[], result: unknown): ChatMessage[] => {
  const { content, reasoningContent } = extractAssistantResult(result);
  const targetIndex = findLastLoadingAssistantIndex(messages);

  if (targetIndex === -1) {
    return [...messages, createMessage('assistant', content, {
      status: MESSAGE_STATUS.COMPLETE,
      reasoningContent: reasoningContent || null,
      isThinkingComplete: true,
      isReasoningExpanded: false,
      hasAutoCollapsed: true,
    })];
  }

  const current = messages[targetIndex];
  return replaceMessageAt(messages, targetIndex, {
    ...current,
    content,
    reasoningContent: reasoningContent || null,
    status: MESSAGE_STATUS.COMPLETE,
    isThinkingComplete: true,
    isReasoningExpanded: false,
    hasAutoCollapsed: true,
  });
};

const applyAssistantError = (messages: ChatMessage[], errorMessage: string): ChatMessage[] => {
  const targetIndex = findLastLoadingAssistantIndex(messages);
  if (targetIndex === -1) {
    return [...messages, createMessage('assistant', errorMessage, {
      status: MESSAGE_STATUS.ERROR,
      isThinkingComplete: true,
    })];
  }

  const current = messages[targetIndex];
  return replaceMessageAt(messages, targetIndex, {
    ...current,
    content: errorMessage,
    status: MESSAGE_STATUS.ERROR,
    isThinkingComplete: true,
  });
};

const applyAssistantStopped = (messages: ChatMessage[]): ChatMessage[] => {
  const targetIndex = findLastLoadingAssistantIndex(messages);
  if (targetIndex === -1) return messages;

  const current = messages[targetIndex];
  return replaceMessageAt(messages, targetIndex, finalizeIncompleteMessage({
    ...current,
    content: current.content || 'Generation stopped.',
  }));
};

const applyAssistantDelta = (
  messages: ChatMessage[],
  delta: { contentDelta?: string; reasoningDelta?: string },
): ChatMessage[] => {
  const targetIndex = findLastLoadingAssistantIndex(messages);
  if (targetIndex === -1) return messages;

  const current = messages[targetIndex];
  let next: ChatMessage = {
    ...current,
    status: MESSAGE_STATUS.INCOMPLETE,
  };

  const toIncrementalText = (existingText: string, incomingText?: string): string => {
    if (!incomingText) return '';
    if (!existingText) return incomingText;

    if (incomingText === existingText) return '';
    if (incomingText.startsWith(existingText)) {
      return incomingText.slice(existingText.length);
    }
    if (existingText.endsWith(incomingText)) return '';

    const maxOverlap = Math.min(existingText.length, incomingText.length);
    const MIN_OVERLAP = 8;
    for (let overlap = maxOverlap; overlap >= MIN_OVERLAP; overlap -= 1) {
      if (existingText.slice(-overlap) === incomingText.slice(0, overlap)) {
        return incomingText.slice(overlap);
      }
    }

    return incomingText;
  };

  if (delta.reasoningDelta) {
    const existingReasoning = next.reasoningContent || '';
    const reasoningAppend = toIncrementalText(existingReasoning, delta.reasoningDelta);
    if (reasoningAppend) {
      next = {
        ...next,
        reasoningContent: existingReasoning + reasoningAppend,
        isThinkingComplete: false,
      };
    }
  }

  if (delta.contentDelta) {
    const existingContent = next.content || '';
    const contentAppend = toIncrementalText(existingContent, delta.contentDelta);
    if (!contentAppend) {
      return replaceMessageAt(messages, targetIndex, next);
    }

    const hasReasoning = Boolean(next.reasoningContent);
    const shouldAutoCollapse = hasReasoning && !next.hasAutoCollapsed;
    next = {
      ...next,
      content: existingContent + contentAppend,
      isReasoningExpanded: shouldAutoCollapse ? false : next.isReasoningExpanded,
      hasAutoCollapsed: shouldAutoCollapse || next.hasAutoCollapsed,
    };
  }

  return replaceMessageAt(messages, targetIndex, next);
};

const parseStreamErrorText = async (response: Response): Promise<string> => {
  try {
    const text = await response.text();
    if (!text) return `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(text);
      return extractErrorMessage(parsed);
    } catch {
      return text;
    }
  } catch {
    return `HTTP ${response.status}`;
  }
};

const parseSseBlock = (block: string): { event: string; data: string | null } => {
  const lines = block.split(/\r?\n/);
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  return {
    event,
    data: dataLines.length > 0 ? dataLines.join('\n') : null,
  };
};

const parseAnyStreamDelta = (eventPayload: any): {
  contentDelta?: string;
  reasoningDelta?: string;
  done?: boolean;
} => {
  if (!eventPayload || typeof eventPayload !== 'object') return {};

  if (Array.isArray(eventPayload.choices)) {
    const choice = eventPayload.choices[0];
    const delta = choice?.delta || {};
    const reasoningDelta = typeof delta.reasoning_content === 'string'
      ? delta.reasoning_content
      : typeof delta.reasoning === 'string'
        ? delta.reasoning
        : '';
    const contentDelta = typeof delta.content === 'string'
      ? delta.content
      : typeof choice?.message?.content === 'string'
        ? choice.message.content
        : '';

    return {
      contentDelta: contentDelta || undefined,
      reasoningDelta: reasoningDelta || undefined,
      done: Boolean(choice?.finish_reason),
    };
  }

  if (typeof eventPayload.type === 'string') {
    // Responses stream emits a full-text summary again in several "done" events
    // (output_text.done/content_part.done/output_item.done/response.completed).
    // Treat those as structural events only; otherwise UI appends duplicate text.
    if (eventPayload.type === 'response.output_item.added' || eventPayload.type === 'response.output_item.done') {
      return {};
    }

    if (eventPayload.type === 'response.content_part.added' || eventPayload.type === 'response.content_part.done') {
      return {};
    }

    if (eventPayload.type === 'response.content_part.delta') {
      const delta = eventPayload.delta;
      if (typeof delta === 'string') return { contentDelta: delta || undefined };
      if (delta && typeof delta === 'object') {
        const parsed = extractResponsesContent(delta);
        if (parsed.content || parsed.reasoningContent) {
          return {
            contentDelta: parsed.content || undefined,
            reasoningDelta: parsed.reasoningContent || undefined,
          };
        }
        const text = typeof (delta as any).text === 'string' ? (delta as any).text : '';
        return { contentDelta: text || undefined };
      }
    }

    if (eventPayload.type === 'response.output_text.delta') {
      const text = typeof eventPayload.delta === 'string'
        ? eventPayload.delta
        : typeof eventPayload.text === 'string'
          ? eventPayload.text
          : '';
      return { contentDelta: text || undefined };
    }

    if (eventPayload.type === 'response.reasoning_summary_text.delta' || eventPayload.type === 'response.reasoning.delta') {
      const text = typeof eventPayload.delta === 'string'
        ? eventPayload.delta
        : typeof eventPayload.text === 'string'
          ? eventPayload.text
          : '';
      return { reasoningDelta: text || undefined };
    }

    if (eventPayload.type === 'response.output_text.done') return {};

    if (eventPayload.type === 'response.completed' || eventPayload.type === 'response.failed') {
      return { done: true };
    }

    if (eventPayload.type === 'content_block_delta') {
      const delta = eventPayload.delta || {};
      const deltaType = typeof delta.type === 'string' ? delta.type : '';
      const text = typeof delta.text === 'string' ? delta.text : '';
      if (deltaType === 'thinking_delta') {
        return { reasoningDelta: text || undefined };
      }
      return { contentDelta: text || undefined };
    }

    if (eventPayload.type === 'content_block_start') {
      const block = eventPayload.content_block || {};
      const text = typeof block.text === 'string' ? block.text : '';
      return { contentDelta: text || undefined };
    }

    if (eventPayload.type === 'message_delta') {
      const stopReason = eventPayload?.delta?.stop_reason || eventPayload?.stop_reason;
      return { done: Boolean(stopReason) };
    }

    if (eventPayload.type === 'message_stop') {
      return { done: true };
    }
  }

  if (Array.isArray(eventPayload.candidates)) {
    const parts = eventPayload?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      const reasoningDelta = parts
        .filter((item: any) => item?.thought === true)
        .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
        .join('');
      const contentDelta = parts
        .filter((item: any) => !(item?.thought === true))
        .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
        .join('');
      return {
        contentDelta: contentDelta || undefined,
        reasoningDelta: reasoningDelta || undefined,
        done: Boolean(eventPayload?.candidates?.[0]?.finishReason),
      };
    }
  }

  return {};
};

const toNumber = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const splitCsvOrLines = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const CONVERSATION_MODE_OPTIONS: Array<{ value: PlaygroundMode; label: string }> = [
  { value: 'conversation', label: tr('pages.modelTester.chat') },
  { value: 'embeddings', label: 'Embeddings' },
  { value: 'search', label: 'Search' },
  { value: 'images.generate', label: tr('pages.modelTester.imageGeneration') },
  { value: 'images.edit', label: tr('pages.modelTester.imageedit') },
  { value: 'videos.create', label: tr('pages.modelTester.videoCreation') },
  { value: 'videos.inspect', label: tr('pages.modelTester.delete') },
];

const PROTOCOL_OPTIONS: Array<{ value: PlaygroundProtocol; label: string }> = [
  { value: 'openai', label: 'OpenAI (/v1/chat/completions)' },
  { value: 'responses', label: 'OpenAI Responses (/v1/responses)' },
  { value: 'claude', label: 'Claude (/v1/messages)' },
  { value: 'gemini', label: 'Gemini Native (/gemini/v1beta/models/*)' },
];

function ParameterRow(props: {
  title: string;
  valueText?: string;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const {
    title,
    valueText,
    enabled,
    onToggle,
    disabled,
    children,
  } = props;
  return (
    <div className={`mb-3 ${enabled ? '' : 'opacity-60'}`.trim()}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="text-sm font-medium">
          {title}
          {valueText && <span className="ml-1.5 text-primary">{valueText}</span>}
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={enabled} onCheckedChange={() => onToggle()} disabled={disabled} /> {tr('pages.downstreamKeys.enabled')}
        </label>
      </div>
      {children}
    </div>
  );
}

export default function ModelTester() {
  const isMobile = useIsMobile();
  const [models, setModels] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [inputs, setInputs] = useState<ModelTesterInputs>(DEFAULT_INPUTS);
  const [modeState, setModeState] = useState<ModelTesterModeState>(DEFAULT_MODE_STATE);
  const [parameterEnabled, setParameterEnabled] = useState<ParameterEnabled>(DEFAULT_PARAMETER_ENABLED);
  const [forcedTargetId, setForcedTargetId] = useState<number | null>(null);
  const [forcedTargetOptions, setForcedTargetOptions] = useState<ForcedTargetOption[]>([]);
  const [loadingForcedTargets, setLoadingForcedTargets] = useState(false);
  const [forcedTargetHint, setForcedTargetHint] = useState('');
  const [forcedTargetHydrationReady, setForcedTargetHydrationReady] = useState(false);
  const [routeFlow, setRouteFlow] = useState<ModelRouteFlowData | null>(null);
  const [routeFlowLoading, setRouteFlowLoading] = useState(false);
  const [routeFlowError, setRouteFlowError] = useState('');

  const [sending, setSending] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);
  const [error, setError] = useState('');
  const [pendingPayload, setPendingPayload] = useState<TestChatPayload | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);

  const [customRequestMode, setCustomRequestMode] = useState(false);
  const [customRequestBody, setCustomRequestBody] = useState('');
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const debugPanelPresence = useAnimatedVisibility(showDebugPanel, 220);
  const [activeDebugTab, setActiveDebugTab] = useState<DebugTab>(DEBUG_TABS.PREVIEW);
  const [debugRequest, setDebugRequest] = useState('');
  const [debugResponse, setDebugResponse] = useState('');
  const [debugPreview, setDebugPreview] = useState('');
  const [debugTimeline, setDebugTimeline] = useState<DebugTimelineEntry[]>([]);
  const [debugTimestamp, setDebugTimestamp] = useState('');
  const [nonConversationResult, setNonConversationResult] = useState<unknown>(null);

  const [searchQueryValue, setSearchQueryValue] = useState('');
  const [searchAllowedDomains, setSearchAllowedDomains] = useState('');
  const [searchBlockedDomains, setSearchBlockedDomains] = useState('');
  const [searchMaxResults, setSearchMaxResults] = useState(10);
  const [embeddingInputText, setEmbeddingInputText] = useState('');
  const [assetPrompt, setAssetPrompt] = useState('');
  const [videoInspectId, setVideoInspectId] = useState('');
  const [videoInspectAction, setVideoInspectAction] = useState<'GET' | 'DELETE'>('GET');
  const [imageSourceFile, setImageSourceFile] = useState<UploadState | null>(null);
  const [imageMaskFile, setImageMaskFile] = useState<UploadState | null>(null);
  const [conversationFiles, setConversationFiles] = useState<ConversationFileState[]>([]);

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const conversationFileInputRef = useRef<HTMLInputElement>(null);
  const restoredSessionRef = useRef<ReturnType<typeof parseModelTesterSession>>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamStopRequestedRef = useRef(false);
  const conversationFileCapability = useMemo(
    () => resolveConversationFileCapability(inputs.protocol),
    [inputs.protocol],
  );
  const conversationFileSupported = conversationFileCapability.supported;
  const conversationFileAccept = useMemo(
    () => buildConversationFileAccept(conversationFileCapability),
    [conversationFileCapability],
  );
  const conversationFileHint = useMemo(
    () => buildConversationFileHint(conversationFileCapability),
    [conversationFileCapability],
  );

  const pushDebug = useCallback((level: DebugTimelineEntry['level'], text: string) => {
    const now = new Date().toISOString();
    setDebugTimeline((prev) => {
      const next = [...prev, { at: now, level, text }];
      return next.length > 200 ? next.slice(next.length - 200) : next;
    });
    setDebugTimestamp(now);
  }, []);

  const updateInput = useCallback(<K extends keyof ModelTesterInputs>(key: K, value: ModelTesterInputs[K]) => {
    setInputs((prev) => {
      if (key === 'protocol') {
        return {
          ...prev,
          protocol: value as ModelTesterInputs['protocol'],
        };
      }
      return { ...prev, [key]: value };
    });
  }, []);

  const updateModeState = useCallback(<K extends keyof ModelTesterModeState>(key: K, value: ModelTesterModeState[K]) => {
    setModeState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateProtocol = useCallback((protocol: PlaygroundProtocol) => {
    setInputs((prev) => ({
      ...prev,
      protocol,
    }));
  }, []);

  const toggleParameter = useCallback((key: keyof ParameterEnabled) => {
    setParameterEnabled((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  useEffect(() => {
    const restored = parseModelTesterSession(localStorage.getItem(MODEL_TESTER_STORAGE_KEY));
    restoredSessionRef.current = restored;
    if (!restored) return;

    setMessages(restored.messages);
    setInput(restored.input);
    setInputs(restored.inputs);
    setModeState(restored.modeState);
    setParameterEnabled(restored.parameterEnabled);
    setPendingPayload(restored.pendingPayload);
    setPendingJobId(restored.pendingJobId || null);
    setForcedTargetId(restored.forcedTargetId ?? null);
    setCustomRequestMode(restored.customRequestMode);
    setCustomRequestBody(restored.customRequestBody);
    setShowDebugPanel(restored.showDebugPanel);
    setActiveDebugTab(restored.activeDebugTab);
    setEmbeddingInputText(restored.modeState.embeddingsInput);
    setSearchQueryValue(restored.modeState.searchQuery);
    setSearchAllowedDomains(restored.modeState.searchAllowedDomains);
    setSearchBlockedDomains(restored.modeState.searchBlockedDomains);
    setAssetPrompt(restored.modeState.imagesPrompt || restored.modeState.videosPrompt);
    setVideoInspectId(restored.modeState.videosInspectId);
    setVideoInspectAction(restored.inputs.videoInspectAction === 'delete' ? 'DELETE' : 'GET');
    setConversationFiles(restored.conversationFiles);

    if (restored.pendingJobId) {
      setSending(true);
      setError(tr('pages.modelTester.unfinishedTasksFoundReconnecting'));
      pushDebug('info', `恢复任务 ${restored.pendingJobId}。`);
    } else if (restored.pendingPayload) {
      setError(tr('pages.modelTester.unfinishedRequestSnapshotFoundClickRetryContinue'));
      pushDebug('warn', tr('pages.modelTester.restorePendingRequestSnapshot'));
    }
  }, [pushDebug]);

  useEffect(() => {
    const fetchModels = async () => {
      setLoadingModels(true);
      try {
        const [marketResult, routesResult] = await Promise.allSettled([
          api.getModelsMarketplace({ includePricing: false }),
          api.getRoutes(),
        ]);

        if (marketResult.status === 'rejected' && routesResult.status === 'rejected') {
          throw marketResult.reason || routesResult.reason || new Error('failed to fetch models');
        }

        const names = collectModelTesterModelNames(
          marketResult.status === 'fulfilled' ? marketResult.value : null,
          routesResult.status === 'fulfilled' ? routesResult.value : null,
        );
        setModels(names);

        const restoredModel = restoredSessionRef.current?.inputs.model || '';
        const currentModel = inputs.model || '';
        const nextModel = restoredModel && names.includes(restoredModel)
          ? restoredModel
          : currentModel && names.includes(currentModel)
            ? currentModel
            : names[0] || '';

        if (nextModel) {
          setInputs((prev) => ({ ...prev, model: nextModel }));
        }
      } catch {
        setError(tr('pages.modelTester.failedLoadModelList'));
        pushDebug('error', tr('pages.modelTester.failedGetModelList'));
      } finally {
        setLoadingModels(false);
        setForcedTargetHydrationReady(true);
      }
    };

    void fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!forcedTargetHydrationReady) return;

    if (!inputs.model) {
      setForcedTargetOptions([]);
      setForcedTargetHint('');
      setForcedTargetId(null);
      return;
    }

    if (customRequestMode) {
      setForcedTargetOptions([]);
      setForcedTargetHint(tr('pages.modelTester.customRequestmodeTargetsnotAvailable'));
      setForcedTargetId(null);
      return;
    }

    if (inputs.mode === 'videos.inspect') {
      setForcedTargetOptions([]);
      setForcedTargetHint(tr('pages.modelTester.deleteTargets'));
      setForcedTargetId(null);
      return;
    }

    let cancelled = false;
    setLoadingForcedTargets(true);
    setForcedTargetHint('');

    void api.getRouteDecision(inputs.model)
      .then((result) => {
        if (cancelled) return;
        const candidates = Array.isArray((result as any)?.decision?.candidates)
          ? (result as any).decision.candidates as Array<Record<string, unknown>>
          : [];
        const nextOptions = candidates
          .filter((candidate) => candidate?.eligible === true && typeof candidate?.targetId === 'number')
          .map((candidate) => {
            const accountLabel = candidate.username || (candidate.accountId ? `account-${candidate.accountId}` : tr('pages.proxyLogs.unknownAccount'));
            const siteLabel = candidate.siteName || tr('pages.proxyLogs.unknownSite');
            const tokenLabel = candidate.tokenName || tr('pages.tokens.default');
            return {
              value: String(candidate.targetId),
              label: `${accountLabel} @ ${siteLabel} / ${tokenLabel} (P${candidate.priority ?? 0})`,
              description: typeof candidate.reason === 'string' && candidate.reason.trim().length > 0
                ? candidate.reason
                : undefined,
            };
          });
        setForcedTargetOptions(nextOptions);
        if (nextOptions.length === 0) {
          setForcedTargetHint(tr('pages.modelTester.modelnoneTargets2'));
        }
        if (typeof forcedTargetId === 'number' && !nextOptions.some((option) => option.value === String(forcedTargetId))) {
          setForcedTargetId(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setForcedTargetOptions([]);
        setForcedTargetHint(tr('pages.modelTester.targetsFailed'));
        setForcedTargetId(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingForcedTargets(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customRequestMode, forcedTargetHydrationReady, inputs.mode, inputs.model]);

  useEffect(() => {
    if (!forcedTargetHydrationReady || !inputs.model || customRequestMode) {
      setRouteFlow(null);
      setRouteFlowError('');
      setRouteFlowLoading(false);
      return;
    }

    let cancelled = false;
    setRouteFlowLoading(true);
    setRouteFlowError('');
    void api.getModelRouteFlow(inputs.model)
      .then((result) => {
        if (cancelled) return;
        setRouteFlow((result as { flow?: ModelRouteFlowData }).flow || null);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setRouteFlow(null);
        setRouteFlowError(extractErrorMessage(loadError) || tr('pages.modelTester.routesFailed'));
      })
      .finally(() => {
        if (!cancelled) setRouteFlowLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customRequestMode, forcedTargetHydrationReady, inputs.model]);

  useEffect(() => {
    if (!inputs.model) return;
    localStorage.setItem(MODEL_TESTER_STORAGE_KEY, serializeModelTesterSession({
      input,
      inputs,
      parameterEnabled,
      messages,
      conversationFiles,
      modeState: {
        embeddingsInput: embeddingInputText,
        searchQuery: searchQueryValue,
        searchAllowedDomains,
        searchBlockedDomains,
        imagesPrompt: inputs.mode === 'images.generate' || inputs.mode === 'images.edit' ? assetPrompt : '',
        imagesMaskDataUrl: imageMaskFile?.dataUrl || '',
        videosPrompt: inputs.mode === 'videos.create' ? assetPrompt : '',
        videosInspectId: videoInspectId,
        extraJson: customRequestBody,
      },
      pendingPayload,
      pendingJobId,
      forcedTargetId,
      customRequestMode,
      customRequestBody,
      showDebugPanel,
      activeDebugTab,
    }));
  }, [
    activeDebugTab,
    customRequestBody,
    customRequestMode,
    forcedTargetId,
    input,
    inputs,
    messages,
    conversationFiles,
    assetPrompt,
    customRequestBody,
    embeddingInputText,
    imageMaskFile?.dataUrl,
    parameterEnabled,
    pendingJobId,
    pendingPayload,
    searchAllowedDomains,
    searchBlockedDomains,
    searchQueryValue,
    showDebugPanel,
    videoInspectId,
  ]);

  const handleUploadChange = useCallback(async (
    fileList: FileList | null,
    setter: React.Dispatch<React.SetStateAction<UploadState | null>>,
  ) => {
    const file = fileList?.[0];
    if (!file) {
      setter(null);
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setter({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataUrl,
      });
    } catch (readError: any) {
      setError(readError?.message || tr('pages.importExport.failedReadFile'));
    }
  }, []);

  const handleConversationFilesChange = useCallback(async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (files.length <= 0) return;

    try {
      const nextFiles = await Promise.all(files.map(async (file) => ({
        localId: createConversationFileLocalId(),
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataUrl: await readFileAsDataUrl(file),
          fileId: null,
          status: 'pending' as const,
          errorMessage: null,
        })));
      const acceptedFiles = nextFiles.filter((file) => isConversationUploadedFileSupported(
        conversationFileCapability,
        { filename: file.name, mimeType: file.mimeType },
      ));
      const rejectedFiles = nextFiles.filter((file) => !isConversationUploadedFileSupported(
        conversationFileCapability,
        { filename: file.name, mimeType: file.mimeType },
      ));

      if (acceptedFiles.length > 0) {
        setConversationFiles((prev) => [...prev, ...acceptedFiles]);
        pushDebug('info', `已添加 ${acceptedFiles.length} 个会话附件。`);
      }

      if (rejectedFiles.length > 0) {
        const message = `当前协议不支持这些会话附件：${rejectedFiles.map((file) => file.name).join('、')}。${conversationFileHint}`;
        setError(message);
        pushDebug('warn', message);
      }
    } catch (readError: any) {
      const message = readError?.message || tr('pages.modelTester.attachmentsfailed2');
      setError(message);
      pushDebug('error', message);
    }
  }, [conversationFileCapability, conversationFileHint, pushDebug]);

  const removeConversationFile = useCallback((localId: string) => {
    if (sending) return;
    setConversationFiles((prev) => prev.filter((item) => item.localId !== localId));
  }, [sending]);

  const uploadConversationFiles = useCallback(async (): Promise<ConversationUploadedFile[]> => {
    if (conversationFiles.length <= 0) return [];

    const uploaded: ConversationUploadedFile[] = [];
    for (const item of conversationFiles) {
      if (item.fileId) {
        uploaded.push({
          fileId: item.fileId,
          filename: item.name,
          mimeType: item.mimeType,
        });
        continue;
      }

      setConversationFiles((prev) => prev.map((entry) => (
        entry.localId === item.localId
          ? { ...entry, status: 'uploading', errorMessage: null }
          : entry
      )));
      pushDebug('info', `正在上传附件：${item.name}`);

      try {
        const result = await api.proxyTest(buildFileUploadRequestEnvelope({
          name: item.name,
          mimeType: item.mimeType,
          dataUrl: item.dataUrl,
        })) as { id?: unknown; filename?: unknown; mime_type?: unknown };
        const fileId = typeof result?.id === 'string' ? result.id.trim() : '';
        if (!fileId) {
          throw new Error(tr('pages.modelTester.successFileId'));
        }
        const filename = typeof result?.filename === 'string' && result.filename.trim()
          ? result.filename.trim()
          : item.name;
        const mimeType = typeof result?.mime_type === 'string' && result.mime_type.trim()
          ? result.mime_type.trim()
          : item.mimeType;

        setConversationFiles((prev) => prev.map((entry) => (
          entry.localId === item.localId
            ? { ...entry, fileId, name: filename, mimeType, status: 'uploaded', errorMessage: null }
            : entry
        )));
        uploaded.push({ fileId, filename, mimeType });
        pushDebug('info', `附件上传完成：${filename} -> ${fileId}`);
      } catch (uploadError: any) {
        const message = uploadError?.message || tr('pages.modelTester.attachmentsFailed');
        setConversationFiles((prev) => prev.map((entry) => (
          entry.localId === item.localId
            ? { ...entry, status: 'error', errorMessage: message }
            : entry
        )));
        throw new Error(`${item.name}: ${message}`);
      }
    }

    return uploaded;
  }, [conversationFiles, pushDebug]);

  const inlineConversationFiles = useCallback((): ConversationUploadedFile[] =>
    conversationFiles.map((item) => ({
      fileId: item.fileId,
      filename: item.name,
      mimeType: item.mimeType,
      data: item.dataUrl,
    })), [conversationFiles]);

  const ensureSupportedConversationFiles = useCallback((files: ConversationUploadedFile[]): boolean => {
    const unsupported = files.filter((file) => !isConversationUploadedFileSupported(conversationFileCapability, file));
    if (unsupported.length <= 0) return true;

    const names = unsupported.map((file, index) => {
      const filename = typeof file.filename === 'string' ? file.filename.trim() : '';
      return filename || `附件${index + 1}`;
    });
    const message = `当前协议不支持这些会话附件：${names.join('、')}。${conversationFileHint}`;
    setError(message);
    pushDebug('warn', message);
    return false;
  }, [conversationFileCapability, conversationFileHint, pushDebug]);

  const loadLocalConversationFile = useCallback(async (fileId: string) => {
    const resolved = await api.getProxyFileContentDataUrl(fileId) as {
      filename?: string | null;
      mimeType?: string | null;
      data: string;
    };
    return {
      filename: resolved.filename || null,
      mimeType: resolved.mimeType || null,
      data: resolved.data,
    };
  }, []);

  const buildConversationMessagesWithSystem = useCallback((baseMessages: ChatMessage[]) => {
    if (!inputs.systemPrompt.trim()) return baseMessages;
    return [
      createMessage('system', inputs.systemPrompt.trim()),
      ...baseMessages,
    ];
  }, [inputs.systemPrompt]);

  const buildClaudeBodyFromMessages = useCallback((baseMessages: ChatMessage[]) => {
    const effectiveMessages = buildConversationMessagesWithSystem(baseMessages);
    const systemContents = effectiveMessages
      .filter((message) => message.role === 'system' || message.role === 'developer')
      .map((message) => message.content.trim())
      .filter(Boolean);
    const downstreamMessages = effectiveMessages
      .filter((message) => message.role !== 'system' && message.role !== 'developer')
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      }));

    return {
      model: inputs.model,
      stream: inputs.stream,
      max_tokens: parameterEnabled.max_tokens ? inputs.max_tokens : DEFAULT_INPUTS.max_tokens,
      ...(systemContents.length > 0 ? { system: systemContents.join('\n\n') } : {}),
      ...(parameterEnabled.temperature ? { temperature: inputs.temperature } : {}),
      ...(parameterEnabled.top_p ? { top_p: inputs.top_p } : {}),
      messages: downstreamMessages,
    };
  }, [buildConversationMessagesWithSystem, inputs.max_tokens, inputs.model, inputs.stream, inputs.temperature, inputs.top_p, parameterEnabled.max_tokens, parameterEnabled.temperature, parameterEnabled.top_p]);

  const buildResponsesBodyFromMessages = useCallback((baseMessages: ChatMessage[]) => {
    const effectiveMessages = buildConversationMessagesWithSystem(baseMessages);
    const systemContents = effectiveMessages
      .filter((message) => message.role === 'system' || message.role === 'developer')
      .map((message) => message.content.trim())
      .filter(Boolean);
    const downstreamMessages = effectiveMessages
      .filter((message) => message.role !== 'system' && message.role !== 'developer')
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      }));

    return {
      model: inputs.model,
      stream: inputs.stream,
      ...(parameterEnabled.temperature ? { temperature: inputs.temperature } : {}),
      ...(parameterEnabled.top_p ? { top_p: inputs.top_p } : {}),
      ...(parameterEnabled.max_tokens ? { max_output_tokens: inputs.max_tokens } : {}),
      ...(systemContents.length > 0 ? { instructions: systemContents.join('\n\n') } : {}),
      input: downstreamMessages.length === 1 && downstreamMessages[0].role === 'user' && systemContents.length === 0
        ? downstreamMessages[0].content
        : downstreamMessages,
    };
  }, [buildConversationMessagesWithSystem, inputs.max_tokens, inputs.model, inputs.stream, inputs.temperature, inputs.top_p, parameterEnabled.max_tokens, parameterEnabled.temperature, parameterEnabled.top_p]);

  const buildConversationProxyEnvelope = useCallback((baseMessages: ChatMessage[]): ProxyTestEnvelope => {
    const normalizedMessages = buildConversationMessagesWithSystem(baseMessages);

    if (customRequestMode) {
      const path = inputs.protocol === 'gemini'
        ? `/gemini/v1beta/models/${encodeURIComponent(inputs.model)}:generateContent${inputs.stream ? '?alt=sse' : ''}`
        : inputs.protocol === 'claude'
          ? '/v1/messages'
          : inputs.protocol === 'responses'
            ? '/v1/responses'
            : '/v1/chat/completions';

      return {
        method: 'POST',
        path,
        requestKind: 'json',
        stream: inputs.stream,
        jobMode: false,
        rawMode: true,
        rawJsonText: customRequestBody,
      };
    }

    if (inputs.protocol === 'claude') {
      return {
        method: 'POST',
        path: '/v1/messages',
        requestKind: 'json',
        stream: inputs.stream,
        jobMode: false,
        rawMode: false,
        jsonBody: buildClaudeBodyFromMessages(baseMessages),
      };
    }

    if (inputs.protocol === 'responses') {
      return {
        method: 'POST',
        path: '/v1/responses',
        requestKind: 'json',
        stream: inputs.stream,
        jobMode: false,
        rawMode: false,
        jsonBody: buildResponsesBodyFromMessages(baseMessages),
      };
    }

    if (inputs.protocol === 'gemini') {
      return buildGeminiNativeConversationProxyEnvelope(baseMessages, inputs, parameterEnabled);
    }

    const openAiEnvelope = buildApiPayload(normalizedMessages, { ...inputs, protocol: 'openai' }, parameterEnabled);
    const openAiPayload = (openAiEnvelope.jsonBody && typeof openAiEnvelope.jsonBody === 'object')
      ? { ...(openAiEnvelope.jsonBody as Record<string, unknown>) }
      : {};

    return {
      method: 'POST',
      path: '/v1/chat/completions',
      requestKind: 'json',
      stream: inputs.stream,
      jobMode: false,
      rawMode: false,
      jsonBody: openAiPayload,
    };
  }, [buildApiPayload, buildClaudeBodyFromMessages, buildConversationMessagesWithSystem, buildResponsesBodyFromMessages, customRequestBody, customRequestMode, inputs, parameterEnabled]);

  const forcedTargetSelectOptions = useMemo<ForcedTargetOption[]>(() => [
    {
      value: '__auto__',
      label: tr('pages.modelTester.automaticDefault'),
      description: tr('pages.modelTester.routesnormalselecttargets'),
    },
    ...forcedTargetOptions,
  ], [forcedTargetOptions]);

  const attachEnvelopeForcedTarget = useCallback((envelope: ProxyTestEnvelope) => (
    attachForcedTargetToEnvelope(envelope, forcedTargetId)
  ), [forcedTargetId]);

  const buildModeProxyEnvelope = useCallback((): ProxyTestEnvelope | null => {
    if (inputs.mode === 'embeddings') {
      const trimmed = embeddingInputText.trim();
      if (!trimmed) return null;
      return {
        method: 'POST',
        path: '/v1/embeddings',
        requestKind: 'json',
        stream: false,
        jobMode: false,
        rawMode: customRequestMode,
        ...(customRequestMode
          ? { rawJsonText: customRequestBody }
          : { jsonBody: { model: inputs.model, input: trimmed } }),
      };
    }

    if (inputs.mode === 'search') {
      if (!searchQueryValue.trim()) return null;
      return {
        method: 'POST',
        path: '/v1/search',
        requestKind: 'json',
        stream: false,
        jobMode: false,
        rawMode: customRequestMode,
        ...(customRequestMode
          ? { rawJsonText: customRequestBody }
          : {
            jsonBody: {
              model: inputs.model || '__search',
              query: searchQueryValue.trim(),
              max_results: Math.max(1, Math.min(20, Math.trunc(searchMaxResults || 10))),
              ...(splitCsvOrLines(searchAllowedDomains).length > 0 ? { allowed_domains: splitCsvOrLines(searchAllowedDomains) } : {}),
              ...(splitCsvOrLines(searchBlockedDomains).length > 0 ? { blocked_domains: splitCsvOrLines(searchBlockedDomains) } : {}),
            },
          }),
      };
    }

    if (inputs.mode === 'images.generate') {
      if (!assetPrompt.trim()) return null;
      return {
        method: 'POST',
        path: '/v1/images/generations',
        requestKind: 'json',
        stream: false,
        jobMode: false,
        rawMode: customRequestMode,
        ...(customRequestMode
          ? { rawJsonText: customRequestBody }
          : { jsonBody: { model: inputs.model, prompt: assetPrompt.trim() } }),
      };
    }

    if (inputs.mode === 'images.edit') {
      if (!assetPrompt.trim() || !imageSourceFile) return null;
      return {
        method: 'POST',
        path: '/v1/images/edits',
        requestKind: 'multipart',
        stream: false,
        jobMode: false,
        rawMode: false,
        multipartFields: {
          model: inputs.model,
          prompt: assetPrompt.trim(),
        },
        multipartFiles: [
          {
            field: 'image',
            name: imageSourceFile.name,
            mimeType: imageSourceFile.mimeType,
            dataUrl: imageSourceFile.dataUrl,
          },
          ...(imageMaskFile ? [{
            field: 'mask',
            name: imageMaskFile.name,
            mimeType: imageMaskFile.mimeType,
            dataUrl: imageMaskFile.dataUrl,
          }] : []),
        ],
      };
    }

    if (inputs.mode === 'videos.create') {
      if (!assetPrompt.trim()) return null;
      if (imageSourceFile) {
        return {
          method: 'POST',
          path: '/v1/videos',
          requestKind: 'multipart',
          stream: false,
          jobMode: false,
          rawMode: false,
          multipartFields: {
            model: inputs.model,
            prompt: assetPrompt.trim(),
          },
          multipartFiles: [
            {
              field: 'input_reference',
              name: imageSourceFile.name,
              mimeType: imageSourceFile.mimeType,
              dataUrl: imageSourceFile.dataUrl,
            },
          ],
        };
      }

      return {
        method: 'POST',
        path: '/v1/videos',
        requestKind: 'json',
        stream: false,
        jobMode: false,
        rawMode: customRequestMode,
        ...(customRequestMode
          ? { rawJsonText: customRequestBody }
          : { jsonBody: { model: inputs.model, prompt: assetPrompt.trim() } }),
      };
    }

    if (inputs.mode === 'videos.inspect') {
      if (!videoInspectId.trim()) return null;
      return {
        method: videoInspectAction,
        path: `/v1/videos/${encodeURIComponent(videoInspectId.trim())}`,
        requestKind: 'empty',
        stream: false,
        jobMode: false,
        rawMode: false,
      };
    }

    return null;
  }, [assetPrompt, customRequestBody, customRequestMode, embeddingInputText, imageMaskFile, imageSourceFile, inputs.mode, inputs.model, searchAllowedDomains, searchBlockedDomains, searchMaxResults, searchQueryValue, videoInspectAction, videoInspectId]);

  const previewPayload = useMemo(() => {
    if (inputs.mode !== 'conversation') {
      const envelope = buildModeProxyEnvelope();
      return envelope ? attachEnvelopeForcedTarget(envelope) : null;
    }
    if (customRequestMode) {
      const raw = customRequestBody.trim();
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return { _error: tr('pages.modelTester.modelError'), raw };
      }
    }
    if (inputs.protocol === 'gemini') {
      return attachEnvelopeForcedTarget(buildConversationProxyEnvelope(messages));
    }
    return attachEnvelopeForcedTarget(buildApiPayload(buildConversationMessagesWithSystem(messages), inputs, parameterEnabled));
  }, [attachEnvelopeForcedTarget, buildConversationMessagesWithSystem, buildConversationProxyEnvelope, buildModeProxyEnvelope, customRequestBody, customRequestMode, inputs, messages, parameterEnabled]);

  useEffect(() => {
    setDebugPreview(formatJson(previewPayload));
  }, [previewPayload]);

  const finalizeJob = useCallback((jobId: string) => {
    void api.deleteProxyTestJob(jobId).catch(() => { });
  }, []);

  useEffect(() => {
    if (!pendingJobId) return;

    let active = true;
    setSending(true);

    const pollTask = async () => {
      while (active) {
        try {
          const status = await api.getProxyTestJob(pendingJobId) as ChatJobResponse;
          if (!active) return;

          if (status.status === 'pending') {
            await wait(POLL_INTERVAL_MS);
            continue;
          }

          if (status.status === 'succeeded') {
            setMessages((prev) => applyAssistantSuccess(prev, status.result));
            setError('');
            setDebugResponse(formatJson(status.result));
            setActiveDebugTab(DEBUG_TABS.RESPONSE);
            pushDebug('info', `任务 ${pendingJobId} 已成功。`);
          } else if (status.status === 'cancelled') {
            setMessages((prev) => applyAssistantStopped(prev));
            setError(tr('pages.modelTester.buildWasCanceled'));
            setDebugResponse(formatJson(status.error));
            setActiveDebugTab(DEBUG_TABS.RESPONSE);
            pushDebug('warn', `任务 ${pendingJobId} 已取消。`);
          } else {
            const message = extractErrorMessage(status.error);
            setMessages((prev) => applyAssistantError(prev, message));
            setError(message);
            setDebugResponse(formatJson(status.error));
            setActiveDebugTab(DEBUG_TABS.RESPONSE);
            pushDebug('error', `任务 ${pendingJobId} 失败：${message}`);
          }

          setPendingJobId(null);
          setPendingPayload(null);
          setSending(false);
          finalizeJob(pendingJobId);
          return;
        } catch (pollError) {
          const message = (pollError as any)?.message || tr('pages.modelTester.unknownPollingError');
          pushDebug('warn', `轮询 ${pendingJobId} 失败一次：${message}`);
          await wait(POLL_INTERVAL_MS);
        }
      }
    };

    void pollTask();
    return () => {
      active = false;
    };
  }, [finalizeJob, pendingJobId, pushDebug]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const turnCount = useMemo(() => countConversationTurns(messages), [messages]);
  const filteredModels = useMemo(
    () => filterModelTesterModelNames(models, modelSearch),
    [modelSearch, models],
  );
  const currentModelVisible = useMemo(
    () => filteredModels.includes(inputs.model),
    [filteredModels, inputs.model],
  );
  const modelCountText = useMemo(() => {
    if (!modelSearch.trim()) return `共 ${models.length} 个模型`;
    return `匹配 ${filteredModels.length} / ${models.length}`;
  }, [filteredModels.length, modelSearch, models.length]);

  const modelSelectOptions = useMemo(
    () => filteredModels.map((item) => ({ value: item, label: item })),
    [filteredModels],
  );
  const canSend = useMemo(() => {
    if (sending || pendingJobId || !inputs.model) return false;
    if (inputs.mode !== 'conversation') {
      if (inputs.mode === 'embeddings') return Boolean(embeddingInputText.trim());
      if (inputs.mode === 'search') return Boolean(searchQueryValue.trim());
      if (inputs.mode === 'images.generate') return Boolean(assetPrompt.trim());
      if (inputs.mode === 'images.edit') return Boolean(assetPrompt.trim()) && Boolean(imageSourceFile);
      if (inputs.mode === 'videos.create') return Boolean(assetPrompt.trim());
      if (inputs.mode === 'videos.inspect') return Boolean(videoInspectId.trim());
      return false;
    }
    const hasPrompt = input.trim().length > 0;
    if (!customRequestMode) return hasPrompt || (conversationFileSupported && conversationFiles.length > 0);
    return hasPrompt || customRequestBody.trim().length > 0;
  }, [assetPrompt, conversationFileSupported, conversationFiles.length, customRequestBody, customRequestMode, embeddingInputText, imageSourceFile, input, inputs.mode, inputs.model, pendingJobId, searchQueryValue, sending, videoInspectId]);

  const startChatJob = useCallback(async (payload: TestChatPayload) => {
    try {
      setError('');
      setPendingPayload(payload);
      const created = await api.startProxyTestJob(payload) as { jobId: string };
      setPendingJobId(created.jobId);
      setSending(true);
      pushDebug('info', `已创建任务 ${created.jobId}。`);
    } catch (e: any) {
      const message = e?.message || tr('pages.modelTester.requestFailed');
      setMessages((prev) => applyAssistantError(prev, message));
      setError(message);
      setSending(false);
      setDebugResponse(formatJson({ error: { message } }));
      setActiveDebugTab(DEBUG_TABS.RESPONSE);
      pushDebug('error', `创建任务失败：${message}`);
    }
  }, [pushDebug]);

  const startStream = useCallback(async (payload: TestChatPayload) => {
    const controller = new AbortController();
    streamAbortRef.current = controller;
    streamStopRequestedRef.current = false;
    setSending(true);
    setPendingJobId(null);
    setPendingPayload(payload);
    pushDebug('info', tr('pages.modelTester.streamingRequestStarted'));

    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const rawEvents: string[] = [];
    const appendRawEvent = (raw: string) => {
      rawEvents.push(raw);
      if (rawEvents.length > 500) {
        rawEvents.splice(0, rawEvents.length - 500);
      }
      setDebugResponse(rawEvents.join('\n'));
    };

    try {
      const response = await api.proxyTestStream(payload, controller.signal);
      if (response.status === 401 || response.status === 403) {
        const hadToken = Boolean(getAuthToken(localStorage));
        clearAuthSession(localStorage);
        if (hadToken) window.location.reload();
        throw new Error(tr('pages.modelTester.sessionHasExpired'));
      }
      if (!response.ok) {
        throw new Error(await parseStreamErrorText(response));
      }
      if (!response.body) {
        throw new Error(tr('pages.modelTester.streamingResponseBodyEmpty'));
      }

      setActiveDebugTab(DEBUG_TABS.RESPONSE);
      const reader = response.body.getReader();
      let doneReceived = false;
      let hasAnyContent = false;
      let hasAnyReasoning = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          const parsed = parseSseBlock(chunk);
          if (!parsed.data) continue;
          appendRawEvent(parsed.data);

          if (parsed.data === '[DONE]') {
            doneReceived = true;
            pushDebug('info', tr('pages.modelTester.streamingDoneSignalReceived'));
            continue;
          }

          let eventPayload: any;
          try {
            eventPayload = JSON.parse(parsed.data);
          } catch {
            pushDebug('warn', `忽略非 JSON 的 SSE 数据块 (event=${parsed.event})。`);
            continue;
          }

          if (eventPayload?.error) {
            throw new Error(extractErrorMessage(eventPayload));
          }

          const delta = parseAnyStreamDelta(eventPayload);
          if (typeof delta.reasoningDelta === 'string' && delta.reasoningDelta.trim().length > 0) {
            hasAnyReasoning = true;
          }
          if (typeof delta.contentDelta === 'string' && delta.contentDelta.trim().length > 0) {
            hasAnyContent = true;
          }
          if (delta.reasoningDelta || delta.contentDelta) {
            setMessages((prev) => applyAssistantDelta(prev, {
              reasoningDelta: delta.reasoningDelta,
              contentDelta: delta.contentDelta,
            }));
          }
          if (delta.done) doneReceived = true;
        }
      }

      const emptyOutput = !hasAnyContent && !hasAnyReasoning;

      setMessages((prev) => {
        const idx = findLastLoadingAssistantIndex(prev);
        if (idx === -1) return prev;
        const finalized = finalizeIncompleteMessage(prev[idx]);
        if (emptyOutput && !(finalized.content || '').trim() && !(finalized.reasoningContent || '').trim()) {
          return replaceMessageAt(prev, idx, {
            ...finalized,
            content: tr('pages.modelTester.content'),
            status: MESSAGE_STATUS.ERROR,
            isThinkingComplete: true,
          });
        }
        return replaceMessageAt(prev, idx, {
          ...finalized,
          status: MESSAGE_STATUS.COMPLETE,
          isThinkingComplete: true,
        });
      });

      setPendingPayload(null);
      if (emptyOutput) {
        const message = tr('pages.modelTester.upstreamResponseContent');
        setError(message);
        pushDebug('error', tr('pages.modelTester.streamingContent'));
      } else {
        setError('');
        pushDebug(doneReceived ? 'info' : 'warn', doneReceived
          ? tr('pages.modelTester.streamingCompletedSuccessfully')
          : tr('pages.modelTester.streamingDidNotReceiveDoneSignalWas'));
      }
    } catch (streamError: any) {
      const abortedByUser = controller.signal.aborted && streamStopRequestedRef.current;
      const abortedUnexpectedly = controller.signal.aborted
        || streamError?.name === 'AbortError'
        || streamError?.message === 'This operation was aborted'
        || streamError?.message === 'The user aborted a request.';

      if (abortedByUser) {
        setMessages((prev) => applyAssistantStopped(prev));
        setError(tr('pages.modelTester.buildHasStopped'));
        pushDebug('warn', tr('pages.modelTester.streamingWasAbortedUser'));
      } else if (abortedUnexpectedly) {
        const message = tr('pages.modelTester.streamingConnectionInterruptedPleaseTryAgain');
        setMessages((prev) => applyAssistantError(prev, message));
        setError(message);
        pushDebug('error', `流式传输异常中断：${streamError?.message || 'AbortError'}`);
      } else {
        const rawMsg = streamError?.message || tr('pages.modelTester.streamingRequestFailed');
        const message = rawMsg === 'This operation was aborted' ? tr('pages.modelTester.operationAborted') : rawMsg;
        setMessages((prev) => applyAssistantError(prev, message));
        setError(message);
        pushDebug('error', `流式传输失败：${message}`);
      }
    } finally {
      if (streamAbortRef.current === controller) streamAbortRef.current = null;
      streamStopRequestedRef.current = false;
      setSending(false);
    }
  }, [pushDebug]);

  const startProxyStream = useCallback(async (
    envelope: ProxyTestEnvelope,
    nextMessages: ChatMessage[],
  ) => {
    const controller = new AbortController();
    streamAbortRef.current = controller;
    streamStopRequestedRef.current = false;
    setSending(true);
    setPendingJobId(null);
    setPendingPayload(null);
    setMessages(nextMessages);
    setError('');
    setActiveDebugTab(DEBUG_TABS.RESPONSE);
    pushDebug('info', `已开始代理流式请求：${envelope.path}`);

    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const rawEvents: string[] = [];
    const appendRawEvent = (raw: string) => {
      rawEvents.push(raw);
      if (rawEvents.length > 500) {
        rawEvents.splice(0, rawEvents.length - 500);
      }
      setDebugResponse(rawEvents.join('\n'));
    };

    try {
      const response = await api.proxyTestStream(envelope, controller.signal);
      if (!response.ok) {
        throw new Error(await parseStreamErrorText(response));
      }
      if (!response.body) {
        throw new Error(tr('pages.modelTester.streamingResponseBodyEmpty'));
      }

      const reader = response.body.getReader();
      let doneReceived = false;
      let hasAnyContent = false;
      let hasAnyReasoning = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          const parsed = parseSseBlock(chunk);
          if (!parsed.data) continue;
          appendRawEvent(parsed.data);

          if (parsed.data === '[DONE]') {
            doneReceived = true;
            continue;
          }

          let eventPayload: any;
          try {
            eventPayload = JSON.parse(parsed.data);
          } catch {
            continue;
          }

          if (eventPayload?.error) {
            throw new Error(extractErrorMessage(eventPayload));
          }

          const delta = parseAnyStreamDelta(eventPayload);
          if (typeof delta.reasoningDelta === 'string' && delta.reasoningDelta.trim().length > 0) {
            hasAnyReasoning = true;
          }
          if (typeof delta.contentDelta === 'string' && delta.contentDelta.trim().length > 0) {
            hasAnyContent = true;
          }
          if (delta.reasoningDelta || delta.contentDelta) {
            setMessages((prev) => applyAssistantDelta(prev, {
              reasoningDelta: delta.reasoningDelta,
              contentDelta: delta.contentDelta,
            }));
          }
          if (delta.done) doneReceived = true;
        }
      }

      const emptyOutput = !hasAnyContent && !hasAnyReasoning;

      setMessages((prev) => {
        const idx = findLastLoadingAssistantIndex(prev);
        if (idx === -1) return prev;
        const finalized = finalizeIncompleteMessage(prev[idx]);
        if (emptyOutput && !(finalized.content || '').trim() && !(finalized.reasoningContent || '').trim()) {
          return replaceMessageAt(prev, idx, {
            ...finalized,
            content: tr('pages.modelTester.content'),
            status: MESSAGE_STATUS.ERROR,
            isThinkingComplete: true,
          });
        }
        return replaceMessageAt(prev, idx, {
          ...finalized,
          status: MESSAGE_STATUS.COMPLETE,
          isThinkingComplete: true,
        });
      });

      if (emptyOutput) {
        const message = tr('pages.modelTester.upstreamResponseContent');
        setError(message);
        pushDebug('error', tr('pages.modelTester.proxyStreamingEmptyContent'));
      } else {
        setError('');
        pushDebug(doneReceived ? 'info' : 'warn', doneReceived
          ? tr('pages.modelTester.proxyStreamingCompleted')
          : tr('pages.modelTester.proxyStreamingCompletedWithoutDoneSignal'));
      }
    } catch (streamError: any) {
      const abortedByUser = controller.signal.aborted && streamStopRequestedRef.current;
      const abortedUnexpectedly = controller.signal.aborted
        || streamError?.name === 'AbortError'
        || streamError?.message === 'This operation was aborted'
        || streamError?.message === 'The user aborted a request.';

      if (abortedByUser) {
        setMessages((prev) => applyAssistantStopped(prev));
        setError(tr('pages.modelTester.buildHasStopped'));
      } else if (abortedUnexpectedly) {
        setMessages((prev) => applyAssistantError(prev, tr('pages.modelTester.streamingConnectionInterruptedPleaseTryAgain')));
        setError(tr('pages.modelTester.streamingConnectionInterruptedPleaseTryAgain'));
      } else {
        const message = streamError?.message || tr('pages.modelTester.streamingRequestFailed');
        setMessages((prev) => applyAssistantError(prev, message));
        setError(message);
      }
    } finally {
      if (streamAbortRef.current === controller) streamAbortRef.current = null;
      streamStopRequestedRef.current = false;
      setSending(false);
    }
  }, [pushDebug]);

  const dispatchPayload = useCallback(async (
    nextMessages: ChatMessage[],
    payload: TestChatPayload,
    options?: { syncedCustomBody?: string },
  ) => {
    const effectivePayload = attachEnvelopeForcedTarget(payload);
    setMessages(nextMessages);
    if (options?.syncedCustomBody !== undefined) {
      setCustomRequestBody(options.syncedCustomBody);
    }
    setError('');
    setPendingPayload(effectivePayload);
    setDebugRequest(formatJson(effectivePayload));
    setDebugResponse('');
    setActiveDebugTab(DEBUG_TABS.REQUEST);
    setDebugTimestamp(new Date().toISOString());

    if (effectivePayload.stream) {
      await startStream(effectivePayload);
    } else {
      await startChatJob(effectivePayload);
    }
  }, [attachEnvelopeForcedTarget, startChatJob, startStream]);

  const dispatchProxyEnvelope = useCallback(async (envelope: ProxyTestEnvelope, nextMessages?: ChatMessage[]) => {
    const effectiveEnvelope = attachEnvelopeForcedTarget(envelope);
    setError('');
    setDebugRequest(formatJson(effectiveEnvelope.rawMode
      ? { path: effectiveEnvelope.path, rawJsonText: effectiveEnvelope.rawJsonText, forcedTargetId: effectiveEnvelope.forcedTargetId }
      : effectiveEnvelope));
    setDebugResponse('');
    setActiveDebugTab(DEBUG_TABS.REQUEST);
    setDebugTimestamp(new Date().toISOString());

    if (effectiveEnvelope.stream && nextMessages) {
      await startProxyStream(effectiveEnvelope, nextMessages);
      return;
    }

    setSending(true);
    try {
      const result = await api.proxyTest(effectiveEnvelope);
      setDebugResponse(formatJson(result));
      setActiveDebugTab(DEBUG_TABS.RESPONSE);
      setNonConversationResult(result);

      if (nextMessages) {
        setMessages((prev) => applyAssistantSuccess(nextMessages, result));
      }

      setError('');
      pushDebug('info', `代理请求成功：${effectiveEnvelope.path}`);
    } catch (requestError: any) {
      const message = requestError?.message || tr('pages.modelTester.requestFailed');
      if (nextMessages) {
        setMessages((prev) => applyAssistantError(nextMessages, message));
      }
      setError(message);
      setDebugResponse(formatJson({ error: { message } }));
      setActiveDebugTab(DEBUG_TABS.RESPONSE);
      pushDebug('error', `代理请求失败：${message}`);
    } finally {
      setSending(false);
    }
  }, [attachEnvelopeForcedTarget, pushDebug, startProxyStream]);

  const buildPayloadWithMessages = useCallback((nextMessages: ChatMessage[]): {
    payload: TestChatPayload | null;
    syncedCustomBody?: string;
  } => {
    const effectiveMessages = buildConversationMessagesWithSystem(nextMessages);
    return {
      payload: customRequestMode
        ? buildRawProxyRequestEnvelope(
          'POST',
          buildConversationProxyEnvelope(effectiveMessages).path,
          'json',
          customRequestBody,
          { stream: inputs.stream, jobMode: !inputs.stream },
        )
        : buildApiPayload(
          effectiveMessages,
          { ...inputs, protocol: inputs.protocol as TestTargetFormat },
          parameterEnabled,
        ),
      syncedCustomBody: customRequestMode
        ? customRequestBody
        : syncMessagesToCustomRequestBody(customRequestBody, effectiveMessages, inputs),
    };
  }, [buildConversationMessagesWithSystem, buildConversationProxyEnvelope, customRequestBody, customRequestMode, inputs, parameterEnabled]);

  const sendWithPrompt = useCallback(async (
    prompt: string,
    baseMessages: ChatMessage[],
    files: ConversationUploadedFile[] = [],
  ) => {
    let resolvedFiles = files;
    try {
      resolvedFiles = await resolveConversationReplayFiles(files, inputs.protocol, loadLocalConversationFile);
    } catch (resolveError: any) {
      const message = resolveError?.message || tr('pages.modelTester.attachmentsfailed');
      setError(message);
      pushDebug('error', message);
      return;
    }
    if (!ensureSupportedConversationFiles(resolvedFiles)) {
      return;
    }
    const userMessage = createConversationUserMessage(prompt, resolvedFiles);
    const loadingAssistant = createLoadingAssistantMessage();
    const nextMessages = [...baseMessages, userMessage, loadingAssistant];
    const useProxyTransport = inputs.protocol === 'gemini' || customRequestMode;
    if (useProxyTransport) {
      await dispatchProxyEnvelope(buildConversationProxyEnvelope(nextMessages), nextMessages);
      return;
    }

    const { payload, syncedCustomBody } = buildPayloadWithMessages(nextMessages);

    if (!payload) {
      setError(tr('pages.modelTester.customRequestBodyInvalidDoesNotContain'));
      pushDebug('error', tr('pages.modelTester.buildingRequestFromCustomRequestBodyFailed'));
      return;
    }

    await dispatchPayload(nextMessages, payload, { syncedCustomBody });
  }, [buildConversationProxyEnvelope, buildPayloadWithMessages, createConversationUserMessage, customRequestMode, dispatchPayload, dispatchProxyEnvelope, ensureSupportedConversationFiles, inputs.protocol, loadLocalConversationFile, pushDebug]);

  const sendModeRequest = useCallback(async () => {
    const envelope = buildModeProxyEnvelope();
    if (!envelope) {
      setError(tr('pages.modelTester.completeRequiredInputsCurrentModeFirst'));
      return;
    }
    await dispatchProxyEnvelope(envelope);
  }, [buildModeProxyEnvelope, dispatchProxyEnvelope]);

  const send = useCallback(async () => {
    if (!canSend) return;

    if (inputs.mode !== 'conversation') {
      await sendModeRequest();
      return;
    }

    const trimmed = input.trim();
    if (conversationFiles.length > 0 && customRequestMode) {
      const message = tr('pages.modelTester.customRequestmodeAutomaticAttachmentsClosecustomRequestmodeRemoveattachments');
      setError(message);
      pushDebug('warn', message);
      return;
    }

    if (conversationFiles.length > 0 && !conversationFileSupported) {
      const message = conversationFileCapability.reason || tr('pages.modelTester.currentProtocolDoesNotSupportSessionAttachments');
      setError(message);
      pushDebug('warn', message);
      return;
    }

    if (!customRequestMode && conversationFileSupported && conversationFiles.length > 0) {
      setSending(true);
      try {
        const draftFiles = inlineConversationFiles();
        if (!ensureSupportedConversationFiles(draftFiles)) {
          setSending(false);
          return;
        }
        const uploadedFiles = conversationFileCapability.documentMode === 'inline_only'
          ? draftFiles
          : await uploadConversationFiles();
        setInput('');
        setConversationFiles([]);
        await sendWithPrompt(trimmed, messages, uploadedFiles);
      } catch (uploadError: any) {
        const message = uploadError?.message || tr('pages.modelTester.attachmentsFailed');
        setError(message);
        pushDebug('error', message);
        setSending(false);
      }
      return;
    }

    if (trimmed.length > 0) {
      setInput('');
      await sendWithPrompt(trimmed, messages);
      return;
    }

    if (!customRequestMode) return;
    const payload = parseCustomRequestBody(customRequestBody);
    if (!payload) {
      setError(tr('pages.modelTester.customRequestBodyMustValidJsonContain'));
      pushDebug('error', tr('pages.modelTester.sendingBlockedInvalidCustomRequestBody'));
      return;
    }

    const nextMessages = [...messages, createLoadingAssistantMessage()];
    await dispatchPayload(
      nextMessages,
      buildRawProxyRequestEnvelope(
        'POST',
        buildConversationProxyEnvelope(nextMessages).path,
        'json',
        customRequestBody,
        { stream: inputs.stream, jobMode: !inputs.stream },
      ),
    );
  }, [canSend, conversationFileCapability, conversationFileSupported, conversationFiles.length, customRequestBody, customRequestMode, dispatchPayload, ensureSupportedConversationFiles, inlineConversationFiles, input, inputs.mode, messages, pushDebug, sendModeRequest, sendWithPrompt, uploadConversationFiles]);

  const retryPending = useCallback(async () => {
    if (sending || pendingJobId || !pendingPayload) return;

    const nextMessages = (() => {
      const copied = [...messages];
      const last = copied[copied.length - 1];
      if (last?.role === 'assistant' && (last.status === MESSAGE_STATUS.ERROR || last.status === MESSAGE_STATUS.COMPLETE)) {
        copied.pop();
      }
      copied.push(createLoadingAssistantMessage());
      return copied;
    })();

    pushDebug('info', tr('pages.modelTester.pendingRequestBeingRetried'));
    await dispatchPayload(nextMessages, pendingPayload);
  }, [dispatchPayload, messages, pendingJobId, pendingPayload, pushDebug, sending]);

  const stopGenerating = useCallback(async () => {
    let hadWork = false;

    if (streamAbortRef.current) {
      hadWork = true;
      streamStopRequestedRef.current = true;
      try {
        streamAbortRef.current.abort();
      } catch {
        // no-op
      }
      streamAbortRef.current = null;
    }

    if (pendingJobId) {
      hadWork = true;
      const jobId = pendingJobId;
      setPendingJobId(null);
      try {
        await api.deleteProxyTestJob(jobId);
      } catch {
        // no-op
      }
    }

    if (!hadWork) return;
    setSending(false);
    setMessages((prev) => applyAssistantStopped(prev));
    setError(tr('pages.modelTester.buildHasStopped'));
    pushDebug('warn', tr('pages.modelTester.buildHasBeenStoppedUser'));
  }, [pendingJobId, pushDebug]);

  const clearChat = useCallback(() => {
    if (pendingJobId) {
      void api.deleteProxyTestJob(pendingJobId).catch(() => { });
    }
    if (streamAbortRef.current) {
      streamStopRequestedRef.current = true;
      try {
        streamAbortRef.current.abort();
      } catch {
        // no-op
      }
      streamAbortRef.current = null;
    }

    setMessages([]);
    setPendingPayload(null);
    setPendingJobId(null);
    setInput('');
    setError('');
    setSending(false);
    setEditingMessageId(null);
    setEditValue('');
    setDebugRequest('');
    setDebugResponse('');
    setDebugPreview('');
    setDebugTimeline([]);
    setDebugTimestamp('');
    setNonConversationResult(null);
    setSearchQueryValue('');
    setSearchAllowedDomains('');
    setSearchBlockedDomains('');
    setSearchMaxResults(10);
    setEmbeddingInputText('');
    setAssetPrompt('');
    setVideoInspectId('');
    setVideoInspectAction('GET');
    setImageSourceFile(null);
    setImageMaskFile(null);
    setConversationFiles([]);
    localStorage.removeItem(MODEL_TESTER_STORAGE_KEY);
    pushDebug('info', tr('pages.modelTester.conversationCleared'));
  }, [pendingJobId, pushDebug]);

  const toggleReasoning = useCallback((messageId: string) => {
    setMessages((prev) => prev.map((message) => {
      if (message.id !== messageId || message.role !== 'assistant') return message;
      return { ...message, isReasoningExpanded: !message.isReasoningExpanded };
    }));
  }, []);

  const copyMessage = useCallback(async (message: ChatMessage) => {
    const text = [
      message.reasoningContent ? `[reasoning]\n${message.reasoningContent}` : '',
      message.content,
    ].filter(Boolean).join('\n\n').trim();

    if (!text) {
      setError(tr('pages.modelTester.thereNoTextContentCopy'));
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      pushDebug('info', `已复制消息 ${message.id}。`);
    } catch {
      setError(tr('pages.modelTester.copyFailedPleaseCopyManually'));
    }
  }, [pushDebug]);

  const deleteMessage = useCallback((target: ChatMessage) => {
    if (sending) return;
    setMessages((prev) => {
      const index = prev.findIndex((msg) => msg.id === target.id);
      if (index === -1) return prev;
      if (target.role === 'user' && prev[index + 1]?.role === 'assistant') {
        return prev.filter((_, idx) => idx !== index && idx !== index + 1);
      }
      return prev.filter((msg) => msg.id !== target.id);
    });
    setEditingMessageId(null);
    setEditValue('');
    pushDebug('info', `已删除消息 ${target.id}。`);
  }, [pushDebug, sending]);

  const toggleAssistantRole = useCallback((target: ChatMessage) => {
    if (!(target.role === 'assistant' || target.role === 'system')) return;
    if (sending) return;
    setMessages((prev) => prev.map((msg) => {
      if (msg.id !== target.id) return msg;
      return { ...msg, role: msg.role === 'assistant' ? 'system' : 'assistant' };
    }));
  }, [sending]);

  const resetFromMessage = useCallback((target: ChatMessage) => {
    if (sending || pendingJobId) return;
    const index = messages.findIndex((msg) => msg.id === target.id);
    if (index === -1) return;

    let userIndex = -1;
    if (target.role === 'user') {
      userIndex = index;
    } else {
      for (let i = index - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'user') {
          userIndex = i;
          break;
        }
      }
    }

    if (userIndex === -1) {
      setError(tr('pages.modelTester.noUserMessageFoundRetry'));
      return;
    }

    const base = messages.slice(0, userIndex);
    const prompt = messages[userIndex].content;
    const files = extractConversationUploadedFilesFromMessage(messages[userIndex]);
    setEditingMessageId(null);
    setEditValue('');
    void sendWithPrompt(prompt, base, files);
  }, [messages, pendingJobId, sendWithPrompt, sending]);

  const startEditMessage = useCallback((target: ChatMessage) => {
    if (sending) return;
    setEditingMessageId(target.id);
    setEditValue(target.content);
  }, [sending]);

  const cancelEditMessage = useCallback(() => {
    setEditingMessageId(null);
    setEditValue('');
  }, []);

  const saveEditMessage = useCallback((retry = false) => {
    if (!editingMessageId) return;

    const targetIndex = messages.findIndex((message) => message.id === editingMessageId);
    if (targetIndex === -1) {
      cancelEditMessage();
      return;
    }

    const nextContent = editValue;
    const target = messages[targetIndex];
    const updated = messages.map((message, index) => (index === targetIndex
      ? { ...message, content: nextContent }
      : message));

    setMessages(updated);
    setEditingMessageId(null);
    setEditValue('');

    if (retry && target.role === 'user') {
      const base = updated.slice(0, targetIndex);
      void sendWithPrompt(nextContent, base, extractConversationUploadedFilesFromMessage(target));
    }
  }, [cancelEditMessage, editValue, editingMessageId, messages, sendWithPrompt]);

  const syncMessageToBody = useCallback(() => {
    const nextBody = syncMessagesToCustomRequestBody(customRequestBody, messages, inputs);
    setCustomRequestBody(nextBody);
    pushDebug('info', tr('pages.modelTester.messageHasBeenSynchronizedCustomRequestBody'));
  }, [customRequestBody, inputs, messages, pushDebug]);

  const syncBodyToMessage = useCallback(() => {
    const nextMessages = syncCustomRequestBodyToMessages(customRequestBody);
    if (!nextMessages) {
      setError(tr('pages.modelTester.thereNoValidMessageCustomRequestBody'));
      return;
    }
    setMessages(nextMessages);
    pushDebug('info', tr('pages.modelTester.customRequestBodyHasBeenSynchronizedMessage'));
  }, [customRequestBody, pushDebug]);

  const formatCustomBody = useCallback(() => {
    try {
      const parsed = JSON.parse(customRequestBody);
      setCustomRequestBody(JSON.stringify(parsed, null, 2));
      setError('');
    } catch (formatError: any) {
      setError(`JSON 解析错误：${formatError?.message || tr('pages.modelTester.invalidJson')}`);
    }
  }, [customRequestBody]);

  const debugTabContent = useMemo(() => {
    if (activeDebugTab === DEBUG_TABS.PREVIEW) return debugPreview;
    if (activeDebugTab === DEBUG_TABS.REQUEST) return debugRequest;
    return debugResponse;
  }, [activeDebugTab, debugPreview, debugRequest, debugResponse]);

  const layoutColumns = isMobile
    ? '1fr'
    : debugPanelPresence.shouldRender
    ? '340px minmax(0, 1fr) 360px'
    : '340px minmax(0, 1fr)';

  if (loadingModels) {
    return (
      <div className="animate-fade-in">
        <Skeleton className="mb-2 h-7 w-[200px]" />
        <Skeleton className="mb-3 h-28 w-full" />
        <Skeleton className="h-[520px] w-full" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">{tr('pages.modelTester.modelTesting')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr('pages.modelTester.supportedstreamingoutputMissionModeCustomRequestDebug')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline"
            onClick={() => setShowDebugPanel((prev) => !prev)}
           
           
          >
            {showDebugPanel ? tr('pages.modelTester.hideDebugging') : tr('pages.modelTester.showDebugging')}
          </Button>
          <Button type="button" variant="outline"
            onClick={() => { void retryPending(); }}
           
           
            disabled={sending || !!pendingJobId || !pendingPayload}
          >
            {tr('pages.dashboard.retry')}
          </Button>
          <Button type="button" variant="outline"
            onClick={() => { void stopGenerating(); }}
           
           
            disabled={!pendingJobId && !streamAbortRef.current}
          >
            {tr('pages.modelTester.stop')}
          </Button>
          <Button type="button" variant="outline"
            onClick={clearChat}
           
           
            disabled={messages.length === 0 && !pendingPayload && !pendingJobId}
          >
            {tr('pages.modelTester.clear')}
          </Button>
        </div>
      </div>

      <div className={`mb-4 grid gap-3 animate-slide-up stagger-1 ${isMobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
        <Card>
          <CardContent className="pt-3">
            <div className="text-xs text-muted-foreground">{tr('pages.modelTester.model')}</div>
            <div className="mt-1 text-2xl font-semibold">{models.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3">
            <div className="text-xs text-muted-foreground">{tr('pages.modelTester.model2')}</div>
            <div className="mt-1 break-all text-sm font-semibold">{inputs.model || tr('pages.modelTester.notSelected')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3">
            <div className="text-xs text-muted-foreground">{tr('pages.modelTester.chatTurns')}</div>
            <div className="mt-1 text-2xl font-semibold">{turnCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3">
            <div className="text-xs text-muted-foreground">{tr('pages.modelTester.mode')}</div>
            <div className="mt-1 text-sm font-semibold">
            {inputs.mode === 'conversation'
              ? (customRequestMode ? tr('pages.modelTester.customRequest') : (inputs.stream ? tr('pages.modelTester.streaming') : tr('pages.modelTester.missionMode')))
              : inputs.mode}
            {' / '}
            {inputs.protocol === 'claude'
              ? 'Claude'
              : inputs.protocol === 'responses'
                ? 'OpenAI Responses'
                : inputs.protocol === 'gemini'
                  ? 'Gemini'
                  : 'OpenAI'}
            </div>
          </CardContent>
        </Card>
      </div>

      <div
        className="animate-slide-up stagger-2"
        style={{
          display: 'grid',
          gridTemplateColumns: layoutColumns,
          gap: 16,
          alignItems: 'stretch',
        }}
      >
        <Card className={`p-4 ${isMobile ? 'order-2' : 'max-h-[740px] min-h-[680px] overflow-y-auto'}`}>
          <h3 className="mb-3 text-sm font-semibold">{tr('app.settings')}</h3>

          <div className="mb-3.5">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              {tr('pages.modelTester.testMode')}
            </div>
            <ModernSelect
              value={inputs.mode}
              onChange={(next) => {
                if (!next) return;
                updateInput('mode', next as PlaygroundMode);
              }}
              options={CONVERSATION_MODE_OPTIONS}
              placeholder={tr('pages.modelTester.selectTestMode')}
            />
          </div>

          <div className="mb-3.5">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">{tr('components.modelAnalysisPanel.model')}</div>
            <div className={`mb-1.5 flex gap-2 ${isMobile ? 'flex-col' : 'flex-row'}`}>
              <Input
                value={modelSearch}
                onChange={(event) => setModelSearch(event.target.value)}
                placeholder={tr('pages.modelTester.searchModelSupportsNameFragments')}
                className="flex-1"
                disabled={models.length === 0}
              />
              <Button variant="outline"
                type="button"
               
               
                onClick={() => setModelSearch('')}
                disabled={!modelSearch}
              >
                {tr('components.notificationPanel.clear')}
              </Button>
            </div>
            <div className="mb-1.5 text-xs text-muted-foreground">
              {modelCountText}
            </div>
            <ModernSelect
              value={currentModelVisible ? inputs.model : ''}
              onChange={(next) => {
                if (!next) return;
                updateInput('model', next);
              }}
              options={modelSelectOptions}
              placeholder={
                !currentModelVisible && !!inputs.model
                  ? `当前模型已被筛选：${inputs.model}`
                  : (models.length === 0
                    ? tr('pages.modelTester.noModelYet')
                    : (filteredModels.length === 0 ? tr('pages.modelTester.noMatchingModelFound') : tr('pages.modelTester.pleaseSelectModel')))
              }
              disabled={models.length === 0 || customRequestMode || filteredModels.length === 0}
              emptyLabel={tr('pages.modelTester.noMatchingModelFound')}
              menuMaxHeight={300}
            />
            {!currentModelVisible && !!inputs.model && (
              <div className="mt-1 text-xs text-muted-foreground">
                {tr('pages.modelTester.modelFilter')}{inputs.model}
              </div>
            )}
            {customRequestMode && (
              <div className="mt-1 text-xs text-muted-foreground">
                {tr('pages.modelTester.customRequestmodeModelselect')}
              </div>
            )}
          </div>

          <div className="mb-3.5">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              {tr('pages.modelTester.protocolOutputFormat')}
            </div>
            <ModernSelect
              value={inputs.protocol}
              onChange={(next) => {
                if (!next) return;
                updateProtocol(next as PlaygroundProtocol);
              }}
              options={PROTOCOL_OPTIONS}
              placeholder={tr('pages.modelTester.selectProtocol')}
            />
            <div className="mt-1 text-xs text-muted-foreground">
              {tr('pages.modelTester.chatmodeOpenaiResponsesClaudeGeminiNative')}
            </div>
          </div>

          <div className="mb-3.5">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              {tr('pages.modelTester.targets')}
            </div>
            <ModernSelect
              value={typeof forcedTargetId === 'number' ? String(forcedTargetId) : '__auto__'}
              onChange={(next) => {
                if (!next || next === '__auto__') {
                  setForcedTargetId(null);
                  return;
                }
                const parsed = Number.parseInt(next, 10);
                setForcedTargetId(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
              }}
              options={forcedTargetSelectOptions}
              placeholder={loadingForcedTargets ? tr('pages.modelTester.loadingTargets') : tr('pages.modelTester.automaticDefault')}
              disabled={customRequestMode || inputs.mode === 'videos.inspect' || loadingForcedTargets}
              emptyLabel={tr('pages.modelTester.modelnoneTargets')}
              menuMaxHeight={300}
            />
            <div className="mt-1 text-xs text-muted-foreground">
              {forcedTargetHint
                || (typeof forcedTargetId === 'number'
                  ? `已固定到目标 #${forcedTargetId}，失败不会自动切换。`
                  : tr('pages.modelTester.defaultautomaticTargets'))}
            </div>
          </div>

          <div className="mb-3.5">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              {tr('pages.modelTester.routes')}
            </div>
            <ModelRouteFlow
              flow={routeFlow}
              loading={routeFlowLoading}
              error={routeFlowError}
              compact
            />
          </div>

          {inputs.mode === 'conversation' && (
            <div className="mb-3.5">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                System Prompt
              </div>
              <Textarea
                value={inputs.systemPrompt}
                onChange={(event) => updateInput('systemPrompt', event.target.value)}
                rows={4}
                placeholder={tr('pages.modelTester.systemtipSendRequest')}
                className="resize-y leading-relaxed"
              />
            </div>
          )}

          <div className="mb-3.5 flex items-center justify-between gap-3">
            <div className="text-sm font-medium">{tr('pages.modelTester.streamingoutput')}</div>
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
               
                checked={inputs.stream}
                onCheckedChange={(checked) => updateInput('stream', checked === true)}
                disabled={customRequestMode || inputs.mode !== 'conversation'}
              />
              {tr('pages.downstreamKeys.enabled')}
            </label>
          </div>

          {inputs.mode !== 'conversation' && (
            <div className="mb-3.5 text-xs text-muted-foreground">
              {tr('pages.modelTester.modedefaultSyncrequestSearchEmbeddingsImagesVideosGeneral')}
            </div>
          )}

          <div className="mb-3.5 flex items-center justify-between gap-3">
            <div className="text-sm font-medium">{tr('pages.modelTester.customRequest2')}</div>
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
               
                checked={customRequestMode}
                onCheckedChange={(checked) => setCustomRequestMode(checked === true)}
              />
              {tr('pages.downstreamKeys.enabled')}
            </label>
          </div>

          <div className={`anim-collapse mb-3.5 ${customRequestMode ? 'is-open' : ''}`.trim()}>
            <div className="anim-collapse-inner">
              <JsonCodeEditor
                value={customRequestBody}
                onChange={setCustomRequestBody}
                placeholder='{"model":"gpt-4o-mini","targetFormat":"claude","messages":[{"role":"user","content":"hello"}],"stream":true}'
                minHeight={300}
                maxHeight={640}
                ariaLabel={tr('pages.modelTester.customRequest2')}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={formatCustomBody}>
                  {tr('pages.modelTester.formatJson')}
                </Button>
                {inputs.mode === 'conversation' && (
                  <>
                    <Button type="button" variant="outline" onClick={syncMessageToBody}>
                      {tr('pages.modelTester.gtRequest')}
                    </Button>
                    <Button type="button" variant="outline" onClick={syncBodyToMessage}>
                      {tr('pages.modelTester.requestGt')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>

            <div className="mb-2 text-xs font-medium text-muted-foreground">
              {tr('pages.modelTester.samplingParameters')}
            </div>

          <ParameterRow
            title={tr('pages.modelTester.temperature')}
            valueText={inputs.temperature.toFixed(2)}
            enabled={parameterEnabled.temperature}
            onToggle={() => toggleParameter('temperature')}
            disabled={customRequestMode}
          >
            <Slider
              min={0}
              max={2}
              step={0.1}
              value={[inputs.temperature]}
              onValueChange={([value]) => updateInput('temperature', toNumber(String(value), inputs.temperature))}
              disabled={!parameterEnabled.temperature || customRequestMode}
            />
          </ParameterRow>

          <ParameterRow
            title="Top P"
            valueText={inputs.top_p.toFixed(2)}
            enabled={parameterEnabled.top_p}
            onToggle={() => toggleParameter('top_p')}
            disabled={customRequestMode}
          >
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[inputs.top_p]}
              onValueChange={([value]) => updateInput('top_p', toNumber(String(value), inputs.top_p))}
              disabled={!parameterEnabled.top_p || customRequestMode}
            />
          </ParameterRow>

          <ParameterRow
            title={tr('pages.modelTester.frequencyPenalty')}
            valueText={inputs.frequency_penalty.toFixed(2)}
            enabled={parameterEnabled.frequency_penalty}
            onToggle={() => toggleParameter('frequency_penalty')}
            disabled={customRequestMode}
          >
            <Slider
              min={-2}
              max={2}
              step={0.1}
              value={[inputs.frequency_penalty]}
              onValueChange={([value]) => updateInput('frequency_penalty', toNumber(String(value), inputs.frequency_penalty))}
              disabled={!parameterEnabled.frequency_penalty || customRequestMode}
            />
          </ParameterRow>

          <ParameterRow
            title={tr('pages.modelTester.therePunishment')}
            valueText={inputs.presence_penalty.toFixed(2)}
            enabled={parameterEnabled.presence_penalty}
            onToggle={() => toggleParameter('presence_penalty')}
            disabled={customRequestMode}
          >
            <Slider
              min={-2}
              max={2}
              step={0.1}
              value={[inputs.presence_penalty]}
              onValueChange={([value]) => updateInput('presence_penalty', toNumber(String(value), inputs.presence_penalty))}
              disabled={!parameterEnabled.presence_penalty || customRequestMode}
            />
          </ParameterRow>

          <ParameterRow
            title={tr('pages.modelTester.maximumNumberTokens')}
            enabled={parameterEnabled.max_tokens}
            onToggle={() => toggleParameter('max_tokens')}
            disabled={customRequestMode}
          >
            <Input
              type="number"
              value={inputs.max_tokens}
              min={1}
              step={1}
              onChange={(event) => updateInput('max_tokens', toNumber(event.target.value, inputs.max_tokens))}
              disabled={!parameterEnabled.max_tokens || customRequestMode}
            />
          </ParameterRow>

          <ParameterRow
            title={tr('pages.modelTester.randomSeed')}
            valueText={inputs.seed === null ? tr('pages.modelTester.automatic') : String(inputs.seed)}
            enabled={parameterEnabled.seed}
            onToggle={() => toggleParameter('seed')}
            disabled={customRequestMode}
          >
            <Input
              type="number"
              value={inputs.seed ?? ''}
              min={0}
              step={1}
              placeholder={tr('pages.modelTester.optionalSeedValue')}
              onChange={(event) => {
                const raw = event.target.value.trim();
                updateInput('seed', raw.length === 0 ? null : toNumber(raw, 0));
              }}
              disabled={!parameterEnabled.seed || customRequestMode}
            />
          </ParameterRow>
        </Card>

        <Card className={`flex overflow-hidden ${isMobile ? 'order-1' : 'max-h-[740px] min-h-[680px]'} flex-col`}>
          <CardHeader className="flex-row items-center justify-between gap-3 border-b space-y-0">
            <CardTitle>{tr('pages.modelTester.chat')}</CardTitle>
            <div className="text-xs text-muted-foreground">
              {sending ? tr('pages.modelTester.generating') : tr('pages.modelTester.ready')}
            </div>
          </CardHeader>

          <ScrollArea className="min-h-72 flex-1 p-4">
            {inputs.mode !== 'conversation' ? (
              <div className="grid gap-3">
                <Card>
                  <CardContent className="pt-3">
                  <div className="mb-1.5 text-sm font-semibold">
                    {inputs.mode === 'embeddings' ? tr('pages.modelTester.embeddings')
                      : inputs.mode === 'search' ? tr('pages.modelTester.search')
                        : inputs.mode.startsWith('images') ? tr('pages.modelTester.imageResult')
                          : tr('pages.modelTester.videoTaskResult')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {tr('pages.modelTester.modeGeneralProxyTesterDebug')}
                  </div>
                  </CardContent>
                </Card>

                {Array.isArray((nonConversationResult as any)?.data) && (nonConversationResult as any).data.some((item: any) => item?.url || item?.b64_json) && (
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
                    {(nonConversationResult as any).data.map((item: any, index: number) => {
                      const imageSrc = typeof item?.url === 'string'
                        ? item.url
                        : (typeof item?.b64_json === 'string' ? `data:image/png;base64,${item.b64_json}` : '');
                      if (!imageSrc) return null;
                      return (
                        <div key={`image-${index}`} className="overflow-hidden rounded-md border bg-card">
                          <img src={imageSrc} alt={`generated-${index}`} className="block w-full" />
                        </div>
                      );
                    })}
                  </div>
                )}

                <pre className="m-0 whitespace-pre-wrap break-words rounded-md border bg-card p-3 font-mono text-xs leading-relaxed">
                  {nonConversationResult ? formatJson(nonConversationResult) : tr('pages.modelTester.noResults')}
                </pre>
              </div>
            ) : messages.length === 0 ? (
              <EmptyStateBlock title={tr('pages.modelTester.startChatTest')} description={tr('pages.modelTester.supportedstreamingmodeCustomRequestMode')} />
            ) : (
              <div className="grid gap-3">
                {messages.map((message) => {
                  const isUser = message.role === 'user';
                  const isSystem = message.role === 'system';
                  const isLoading = message.status === MESSAGE_STATUS.LOADING || message.status === MESSAGE_STATUS.INCOMPLETE;
                  const isError = message.status === MESSAGE_STATUS.ERROR;
                  const showReasoning = Boolean(message.reasoningContent);
                  const isEditing = editingMessageId === message.id;
                  const fileParts = Array.isArray(message.parts)
                    ? message.parts.filter((part): part is Extract<ConversationContentPart, { type: 'input_file' }> => part.type === 'input_file')
                    : [];

                  return (
                    <div
                      key={message.id}
                      className={`flex gap-2.5 animate-fade-in ${isUser ? 'flex-row-reverse' : ''}`.trim()}
                    >
                      <div className={`flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${isUser ? 'bg-primary text-primary-foreground' : isError ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground'}`}>
                        {isUser ? 'U' : (isSystem ? 'SYS' : 'AI')}
                      </div>

                      <div className={`flex min-w-0 flex-col gap-1.5 ${isMobile ? 'flex-1 max-w-full' : 'max-w-[78%]'}`}>
                        {showReasoning && (
                          <div className="overflow-hidden rounded-md border bg-muted/40">
                            <Button
                              type="button"
                              variant="ghost"
                              className="w-full justify-between"
                              onClick={() => toggleReasoning(message.id)}
                            >
                              <span>{isLoading ? tr('pages.modelTester.thinking') : tr('pages.modelTester.reasoningProcess')}</span>
                              <span>{message.isReasoningExpanded ? '▼' : '▶'}</span>
                            </Button>
                            <div className={`anim-collapse ${message.isReasoningExpanded ? 'is-open' : ''}`.trim()}>
                              <div className="anim-collapse-inner">
                                <div className="whitespace-pre-wrap border-t px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
                                  {message.reasoningContent}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className={`min-h-6 whitespace-pre-wrap break-words rounded-md px-3 py-2 text-sm leading-relaxed ${isUser ? 'bg-primary text-primary-foreground' : isError ? 'border border-destructive/50 text-destructive' : 'border bg-card text-card-foreground shadow-sm'}`}>
                          {isEditing ? (
                            <div className="grid gap-2">
                              <Textarea
                                value={editValue}
                                onChange={(event) => setEditValue(event.target.value)}
                                rows={3}
                                className="resize-y"
                              />
                              <div className="flex justify-end gap-2">
                                {message.role === 'user' && (
                                  <Button type="button" variant="outline" onClick={() => saveEditMessage(true)}>
                                    {tr('pages.modelTester.saveRetry')}
                                  </Button>
                                )}
                                <Button type="button" onClick={() => saveEditMessage(false)}>{tr('app.save')}</Button>
                                <Button type="button" variant="outline" onClick={cancelEditMessage}>{tr('app.cancel')}</Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {isLoading && <LoaderCircle className="size-4 animate-spin" />}
                              {message.content || (isLoading ? tr('pages.modelTester.thinking') : '')}
                            </>
                          )}
                        </div>

                        {!isEditing && fileParts.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {fileParts.map((part, index) => (
                              <span
                                key={`${message.id}-file-${part.fileId || part.filename || index}`}
                                className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
                                title={part.fileId || part.filename || tr('pages.modelTester.attachments')}
                              >
                                <span>📎</span>
                                <span className="truncate">
                                  {part.filename || part.fileId || tr('pages.modelTester.attachments')}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}

                        {!isEditing && (
                          <div className="flex flex-wrap gap-1.5">
                            {!isLoading && (
                              <Button type="button" variant="outline" onClick={() => resetFromMessage(message)} disabled={sending || Boolean(pendingJobId)}>
                                {tr('pages.dashboard.retry')}
                              </Button>
                            )}
                            <Button type="button" variant="outline" onClick={() => { void copyMessage(message); }}>
                              {tr('pages.modelTester.copy')}
                            </Button>
                            {!isLoading && (
                              <Button type="button" variant="outline" onClick={() => startEditMessage(message)} disabled={sending}>
                                {tr('pages.accounts.edit')}
                              </Button>
                            )}
                            {!isLoading && (
                              <Button type="button" variant="outline" onClick={() => deleteMessage(message)} disabled={sending}>
                                {tr('pages.accounts.delete3')}
                              </Button>
                            )}
                            {(message.role === 'assistant' || message.role === 'system') && !isLoading && (
                              <Button type="button" variant="outline" onClick={() => toggleAssistantRole(message)} disabled={sending}>
                                {message.role === 'assistant' ? tr('pages.modelTester.convertSystem') : tr('pages.modelTester.turnIntoAssistant')}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>
            )}
          </ScrollArea>

          <div className="border-t bg-card p-3.5">
            {error && (
              <Alert variant="destructive" className="mb-2.5 animate-scale-in">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {inputs.mode === 'conversation' ? (
              <ConversationComposer
                isMobile={isMobile}
                sending={sending}
                customRequestMode={customRequestMode}
                conversationFileCapability={conversationFileCapability}
                conversationFileSupported={conversationFileSupported}
                conversationFileAccept={conversationFileAccept}
                conversationFileHint={conversationFileHint}
                conversationFiles={conversationFiles}
                conversationFileInputRef={conversationFileInputRef}
                input={input}
                canSend={canSend}
                onInputChange={setInput}
                onFilesChange={handleConversationFilesChange}
                onRemoveConversationFile={removeConversationFile}
                onSend={send}
                onStop={stopGenerating}
              />
            ) : (
              <div className="flex flex-col gap-2.5">
                {inputs.mode === 'embeddings' && (
                  <Textarea
                    value={embeddingInputText}
                    onChange={(event) => setEmbeddingInputText(event.target.value)}
                    rows={4}
                    placeholder={tr('pages.modelTester.inputEmbeddingsTextSupportedItems')}
                    className="resize-y"
                  />
                )}
                {inputs.mode === 'search' && (
                  <>
                    <Textarea
                      value={searchQueryValue}
                      onChange={(event) => setSearchQueryValue(event.target.value)}
                      rows={3}
                      placeholder={tr('pages.modelTester.inputsearch')}
                      className="resize-y"
                    />
                    <div className={`grid gap-2.5 ${isMobile ? 'grid-cols-1' : 'grid-cols-[1fr_1fr_120px]'}`}>
                      <Input value={searchAllowedDomains} onChange={(event) => setSearchAllowedDomains(event.target.value)} placeholder={tr('pages.modelTester.allowedDomains')} />
                      <Input value={searchBlockedDomains} onChange={(event) => setSearchBlockedDomains(event.target.value)} placeholder={tr('pages.modelTester.blockedDomains')} />
                      <Input value={searchMaxResults} onChange={(event) => setSearchMaxResults(toNumber(event.target.value, 10))} type="number" min={1} max={20} />
                    </div>
                  </>
                )}
                {(inputs.mode === 'images.generate' || inputs.mode === 'images.edit' || inputs.mode === 'videos.create') && (
                  <>
                    <Textarea
                      value={assetPrompt}
                      onChange={(event) => setAssetPrompt(event.target.value)}
                      rows={3}
                      placeholder={inputs.mode === 'videos.create' ? tr('pages.modelTester.enterVideoGenerationPrompt') : tr('pages.modelTester.enterImagePrompt')}
                      className="resize-y"
                    />
                    {(inputs.mode === 'images.edit' || inputs.mode === 'videos.create') && (
                      <div className={`grid gap-2.5 ${isMobile || inputs.mode !== 'images.edit' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                        <label className="text-xs text-muted-foreground">
                          <div className="mb-1.5">{inputs.mode === 'images.edit' ? tr('pages.modelTester.sourceImage') : tr('pages.modelTester.referenceImage')}</div>
                          <Input type="file" accept="image/*" onChange={(event) => { void handleUploadChange(event.target.files, setImageSourceFile); }} />
                        </label>
                        {inputs.mode === 'images.edit' && (
                          <label className="text-xs text-muted-foreground">
                            <div className="mb-1.5">Mask</div>
                            <Input type="file" accept="image/*" onChange={(event) => { void handleUploadChange(event.target.files, setImageMaskFile); }} />
                          </label>
                        )}
                      </div>
                    )}
                  </>
                )}
                {inputs.mode === 'videos.inspect' && (
                  <div className={`grid gap-2.5 ${isMobile ? 'grid-cols-1' : 'grid-cols-[1fr_160px]'}`}>
                    <Input
                      value={videoInspectId}
                      onChange={(event) => setVideoInspectId(event.target.value)}
                      placeholder={tr('pages.modelTester.inputPublicVideoId')}
                    />
                    <ModernSelect
                      value={videoInspectAction}
                      onChange={(next) => {
                        if (!next) return;
                        setVideoInspectAction(next as 'GET' | 'DELETE');
                      }}
                      options={[
                        { value: 'GET', label: 'GET' },
                        { value: 'DELETE', label: 'DELETE' },
                      ]}
                    />
                  </div>
                )}

                <div className="flex justify-end">
                  <Button type="button"
                    onClick={() => { void send(); }}
                    disabled={!canSend}
                   
                   
                  >
                    {tr('pages.modelTester.sendRequest')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        <DebugPanel
          presence={debugPanelPresence}
          isMobile={isMobile}
          debugTimestamp={debugTimestamp}
          activeDebugTab={activeDebugTab}
          onTabChange={setActiveDebugTab}
          debugTabContent={debugTabContent}
          debugTimeline={debugTimeline}
        />
      </div>
    </div>
  );
}
