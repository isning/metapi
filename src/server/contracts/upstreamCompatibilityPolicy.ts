export type ReasoningHistoryTransportMode = 'native' | 'content_think_tag' | 'drop';

export type ToolCallMessageBehavior = 'same_as_assistant' | 'native' | 'drop';
export type ReasoningHistoryOverflowBehavior = 'truncate' | 'drop';

export const DEFAULT_REASONING_HISTORY_MAX_BYTES = 16 * 1024 * 1024;
export const REASONING_HISTORY_MAX_BYTES_CEILING = 256 * 1024 * 1024;

export type ReasoningHistoryTransportPolicy = {
  mode?: ReasoningHistoryTransportMode | null;
  maxReasoningBytes?: number | null;
  overflow?: ReasoningHistoryOverflowBehavior | null;
  thinkTag?: {
    openTag?: string | null;
    closeTag?: string | null;
    separator?: string | null;
  } | null;
  applyTo?: {
    assistantHistory?: boolean | null;
    assistantToolCalls?: boolean | null;
    responseContinuation?: boolean | null;
  } | null;
  toolCallMessageBehavior?: ToolCallMessageBehavior | null;
};

export type UpstreamCompatibilityPolicy = {
  reasoningHistory?: {
    transport?: ReasoningHistoryTransportPolicy | null;
  } | null;
  payloadDefaults?: unknown[] | null;
  requestTransforms?: unknown[] | null;
};

export type ResolvedUpstreamCompatibilityPolicy = {
  reasoningHistory: {
      transport: {
        mode: ReasoningHistoryTransportMode;
        maxReasoningBytes: number;
        overflow: ReasoningHistoryOverflowBehavior;
        thinkTag: {
          openTag: string;
          closeTag: string;
        separator: string;
      };
      applyTo: {
        assistantHistory: boolean;
        assistantToolCalls: boolean;
        responseContinuation: boolean;
      };
      toolCallMessageBehavior: ToolCallMessageBehavior;
    };
  };
  payloadDefaults: unknown[];
  requestTransforms: unknown[];
};

export const DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY: ResolvedUpstreamCompatibilityPolicy = {
  reasoningHistory: {
    transport: {
      mode: 'native',
      maxReasoningBytes: DEFAULT_REASONING_HISTORY_MAX_BYTES,
      overflow: 'truncate',
      thinkTag: {
        openTag: '<think>',
        closeTag: '</think>',
        separator: '\n\n',
      },
      applyTo: {
        assistantHistory: true,
        assistantToolCalls: true,
        responseContinuation: true,
      },
      toolCallMessageBehavior: 'same_as_assistant',
    },
  },
  payloadDefaults: [],
  requestTransforms: [],
};

const VALID_REASONING_HISTORY_TRANSPORT_MODES = new Set<ReasoningHistoryTransportMode>([
  'native',
  'content_think_tag',
  'drop',
]);

const VALID_TOOL_CALL_MESSAGE_BEHAVIORS = new Set<ToolCallMessageBehavior>([
  'same_as_assistant',
  'native',
  'drop',
]);

const VALID_REASONING_HISTORY_OVERFLOW_BEHAVIORS = new Set<ReasoningHistoryOverflowBehavior>([
  'truncate',
  'drop',
]);

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

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asBoundedPositiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.min(
    REASONING_HISTORY_MAX_BYTES_CEILING,
    Math.max(1, Math.trunc(numeric)),
  );
}

function asReasoningHistoryTransportMode(value: unknown): ReasoningHistoryTransportMode | undefined {
  return VALID_REASONING_HISTORY_TRANSPORT_MODES.has(value as ReasoningHistoryTransportMode)
    ? value as ReasoningHistoryTransportMode
    : undefined;
}

function asToolCallMessageBehavior(value: unknown): ToolCallMessageBehavior | undefined {
  return VALID_TOOL_CALL_MESSAGE_BEHAVIORS.has(value as ToolCallMessageBehavior)
    ? value as ToolCallMessageBehavior
    : undefined;
}

function asReasoningHistoryOverflowBehavior(value: unknown): ReasoningHistoryOverflowBehavior | undefined {
  return VALID_REASONING_HISTORY_OVERFLOW_BEHAVIORS.has(value as ReasoningHistoryOverflowBehavior)
    ? value as ReasoningHistoryOverflowBehavior
    : undefined;
}

export function normalizeUpstreamCompatibilityPolicy(input: unknown): UpstreamCompatibilityPolicy | undefined {
  if (!isRecord(input)) return undefined;

  const policy: UpstreamCompatibilityPolicy = {};
  if (input.reasoningHistory === null) {
    policy.reasoningHistory = null;
  } else if (isRecord(input.reasoningHistory)) {
    const reasoningHistory: NonNullable<UpstreamCompatibilityPolicy['reasoningHistory']> = {};
    const rawTransport = input.reasoningHistory.transport;
    if (rawTransport === null) {
      reasoningHistory.transport = null;
    } else if (isRecord(rawTransport)) {
      const transport: ReasoningHistoryTransportPolicy = {};
      const mode = asReasoningHistoryTransportMode(rawTransport.mode);
      if (mode) transport.mode = mode;
      else if (rawTransport.mode === null) transport.mode = null;

      const maxReasoningBytes = asBoundedPositiveInteger(rawTransport.maxReasoningBytes);
      if (maxReasoningBytes !== undefined) transport.maxReasoningBytes = maxReasoningBytes;
      else if (rawTransport.maxReasoningBytes === null) transport.maxReasoningBytes = null;

      const overflow = asReasoningHistoryOverflowBehavior(rawTransport.overflow);
      if (overflow) transport.overflow = overflow;
      else if (rawTransport.overflow === null) transport.overflow = null;

      if (rawTransport.thinkTag === null) {
        transport.thinkTag = null;
      } else if (isRecord(rawTransport.thinkTag)) {
        const thinkTag: NonNullable<ReasoningHistoryTransportPolicy['thinkTag']> = {};
        if (rawTransport.thinkTag.openTag === null) thinkTag.openTag = null;
        else {
          const openTag = asNonEmptyString(rawTransport.thinkTag.openTag);
          if (openTag !== undefined) thinkTag.openTag = openTag;
        }
        if (rawTransport.thinkTag.closeTag === null) thinkTag.closeTag = null;
        else {
          const closeTag = asNonEmptyString(rawTransport.thinkTag.closeTag);
          if (closeTag !== undefined) thinkTag.closeTag = closeTag;
        }
        if (rawTransport.thinkTag.separator === null) thinkTag.separator = null;
        else if (typeof rawTransport.thinkTag.separator === 'string') {
          thinkTag.separator = rawTransport.thinkTag.separator;
        }
        if (Object.keys(thinkTag).length > 0) transport.thinkTag = thinkTag;
      }

      if (rawTransport.applyTo === null) {
        transport.applyTo = null;
      } else if (isRecord(rawTransport.applyTo)) {
        const applyTo: NonNullable<ReasoningHistoryTransportPolicy['applyTo']> = {};
        if (rawTransport.applyTo.assistantHistory === null) applyTo.assistantHistory = null;
        else {
          const assistantHistory = asBoolean(rawTransport.applyTo.assistantHistory);
          if (assistantHistory !== undefined) applyTo.assistantHistory = assistantHistory;
        }
        if (rawTransport.applyTo.assistantToolCalls === null) applyTo.assistantToolCalls = null;
        else {
          const assistantToolCalls = asBoolean(rawTransport.applyTo.assistantToolCalls);
          if (assistantToolCalls !== undefined) applyTo.assistantToolCalls = assistantToolCalls;
        }
        if (rawTransport.applyTo.responseContinuation === null) applyTo.responseContinuation = null;
        else {
          const responseContinuation = asBoolean(rawTransport.applyTo.responseContinuation);
          if (responseContinuation !== undefined) applyTo.responseContinuation = responseContinuation;
        }
        if (Object.keys(applyTo).length > 0) transport.applyTo = applyTo;
      }

      const toolCallMessageBehavior = asToolCallMessageBehavior(rawTransport.toolCallMessageBehavior);
      if (toolCallMessageBehavior) transport.toolCallMessageBehavior = toolCallMessageBehavior;
      else if (rawTransport.toolCallMessageBehavior === null) transport.toolCallMessageBehavior = null;

      if (Object.keys(transport).length > 0) reasoningHistory.transport = transport;
    }
    if (Object.keys(reasoningHistory).length > 0) policy.reasoningHistory = reasoningHistory;
  }

  if (input.payloadDefaults === null) policy.payloadDefaults = null;
  else if (Array.isArray(input.payloadDefaults)) policy.payloadDefaults = cloneJsonValue(input.payloadDefaults);

  if (input.requestTransforms === null) policy.requestTransforms = null;
  else if (Array.isArray(input.requestTransforms)) policy.requestTransforms = cloneJsonValue(input.requestTransforms);

  return Object.keys(policy).length > 0 ? policy : undefined;
}

export function parseUpstreamCompatibilityPolicyJson(input: unknown): UpstreamCompatibilityPolicy | undefined {
  if (!input) return undefined;
  if (isRecord(input)) return normalizeUpstreamCompatibilityPolicy(input);
  if (typeof input !== 'string') return undefined;
  try {
    return normalizeUpstreamCompatibilityPolicy(JSON.parse(input) as unknown);
  } catch {
    return undefined;
  }
}

function copyResolvedPolicy(policy: ResolvedUpstreamCompatibilityPolicy): ResolvedUpstreamCompatibilityPolicy {
  return cloneJsonValue(policy);
}

function resetResolvedReasoningHistory(
  target: ResolvedUpstreamCompatibilityPolicy,
): void {
  target.reasoningHistory = copyResolvedPolicy(DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY).reasoningHistory;
}

function resetResolvedTransport(
  target: ResolvedUpstreamCompatibilityPolicy,
): void {
  target.reasoningHistory.transport = copyResolvedPolicy(DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY).reasoningHistory.transport;
}

function applyPolicyLayer(
  target: ResolvedUpstreamCompatibilityPolicy,
  layer: UpstreamCompatibilityPolicy,
): void {
  if (layer.reasoningHistory === null) {
    resetResolvedReasoningHistory(target);
  } else if (layer.reasoningHistory) {
    const transport = layer.reasoningHistory.transport;
    if (transport === null) {
      resetResolvedTransport(target);
    } else if (transport) {
      if (transport.mode === null) target.reasoningHistory.transport.mode = DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY.reasoningHistory.transport.mode;
      else if (transport.mode) target.reasoningHistory.transport.mode = transport.mode;

      if (transport.maxReasoningBytes === null) {
        target.reasoningHistory.transport.maxReasoningBytes = DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY.reasoningHistory.transport.maxReasoningBytes;
      } else if (typeof transport.maxReasoningBytes === 'number') {
        target.reasoningHistory.transport.maxReasoningBytes = transport.maxReasoningBytes;
      }

      if (transport.overflow === null) {
        target.reasoningHistory.transport.overflow = DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY.reasoningHistory.transport.overflow;
      } else if (transport.overflow) {
        target.reasoningHistory.transport.overflow = transport.overflow;
      }

      if (transport.thinkTag === null) {
        target.reasoningHistory.transport.thinkTag = copyResolvedPolicy(DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY).reasoningHistory.transport.thinkTag;
      } else if (transport.thinkTag) {
        if (transport.thinkTag.openTag === null) {
          target.reasoningHistory.transport.thinkTag.openTag = DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY.reasoningHistory.transport.thinkTag.openTag;
        } else if (typeof transport.thinkTag.openTag === 'string') {
          target.reasoningHistory.transport.thinkTag.openTag = transport.thinkTag.openTag;
        }
        if (transport.thinkTag.closeTag === null) {
          target.reasoningHistory.transport.thinkTag.closeTag = DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY.reasoningHistory.transport.thinkTag.closeTag;
        } else if (typeof transport.thinkTag.closeTag === 'string') {
          target.reasoningHistory.transport.thinkTag.closeTag = transport.thinkTag.closeTag;
        }
        if (transport.thinkTag.separator === null) {
          target.reasoningHistory.transport.thinkTag.separator = DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY.reasoningHistory.transport.thinkTag.separator;
        } else if (typeof transport.thinkTag.separator === 'string') {
          target.reasoningHistory.transport.thinkTag.separator = transport.thinkTag.separator;
        }
      }

      if (transport.applyTo === null) {
        target.reasoningHistory.transport.applyTo = copyResolvedPolicy(DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY).reasoningHistory.transport.applyTo;
      } else if (transport.applyTo) {
        if (transport.applyTo.assistantHistory === null) {
          target.reasoningHistory.transport.applyTo.assistantHistory = DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY.reasoningHistory.transport.applyTo.assistantHistory;
        } else if (typeof transport.applyTo.assistantHistory === 'boolean') {
          target.reasoningHistory.transport.applyTo.assistantHistory = transport.applyTo.assistantHistory;
        }
        if (transport.applyTo.assistantToolCalls === null) {
          target.reasoningHistory.transport.applyTo.assistantToolCalls = DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY.reasoningHistory.transport.applyTo.assistantToolCalls;
        } else if (typeof transport.applyTo.assistantToolCalls === 'boolean') {
          target.reasoningHistory.transport.applyTo.assistantToolCalls = transport.applyTo.assistantToolCalls;
        }
        if (transport.applyTo.responseContinuation === null) {
          target.reasoningHistory.transport.applyTo.responseContinuation = DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY.reasoningHistory.transport.applyTo.responseContinuation;
        } else if (typeof transport.applyTo.responseContinuation === 'boolean') {
          target.reasoningHistory.transport.applyTo.responseContinuation = transport.applyTo.responseContinuation;
        }
      }

      if (transport.toolCallMessageBehavior === null) {
        target.reasoningHistory.transport.toolCallMessageBehavior = DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY.reasoningHistory.transport.toolCallMessageBehavior;
      } else if (transport.toolCallMessageBehavior) {
        target.reasoningHistory.transport.toolCallMessageBehavior = transport.toolCallMessageBehavior;
      }
    }
  }

  if (layer.payloadDefaults === null) target.payloadDefaults = [];
  else if (Array.isArray(layer.payloadDefaults)) target.payloadDefaults.push(...cloneJsonValue(layer.payloadDefaults));

  if (layer.requestTransforms === null) target.requestTransforms = [];
  else if (Array.isArray(layer.requestTransforms)) target.requestTransforms.push(...cloneJsonValue(layer.requestTransforms));
}

export function resolveUpstreamCompatibilityPolicy(
  ...layers: Array<UpstreamCompatibilityPolicy | null | undefined>
): ResolvedUpstreamCompatibilityPolicy {
  const resolved = copyResolvedPolicy(DEFAULT_RESOLVED_UPSTREAM_COMPATIBILITY_POLICY);
  for (const layer of layers) {
    if (!layer) continue;
    applyPolicyLayer(resolved, layer);
  }
  return resolved;
}
