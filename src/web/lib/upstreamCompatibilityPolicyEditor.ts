export type ReasoningHistoryTransportMode = 'inherit' | 'native' | 'content_think_tag' | 'drop';
export type ReasoningHistoryOverflowMode = 'inherit' | 'truncate' | 'drop';
export type ToolCallMessageBehaviorMode = 'inherit' | 'same_as_assistant' | 'native' | 'drop';

export type UpstreamCompatibilityPolicyForm = {
  mode: ReasoningHistoryTransportMode;
  maxReasoningBytes: string;
  overflow: ReasoningHistoryOverflowMode;
  assistantHistory: 'inherit' | 'true' | 'false';
  assistantToolCalls: 'inherit' | 'true' | 'false';
  responseContinuation: 'inherit' | 'true' | 'false';
  toolCallMessageBehavior: ToolCallMessageBehaviorMode;
  openTag: string;
  closeTag: string;
  separator: string;
  advancedJson: string;
  advancedEnabled: boolean;
};

type PolicyRecord = Record<string, unknown>;

const DEFAULT_OPEN_TAG = '<think>';
const DEFAULT_CLOSE_TAG = '</think>';
const DEFAULT_SEPARATOR = '\n\n';

function isRecord(value: unknown): value is PolicyRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readTransport(policy: unknown): PolicyRecord {
  if (!isRecord(policy)) return {};
  const reasoningHistory = isRecord(policy.reasoningHistory) ? policy.reasoningHistory : {};
  return isRecord(reasoningHistory.transport) ? reasoningHistory.transport : {};
}

function readBooleanMode(value: unknown): 'inherit' | 'true' | 'false' {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return 'inherit';
}

function parsePolicyJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed);
}

function pushDefined(target: PolicyRecord, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

function booleanModeToValue(value: 'inherit' | 'true' | 'false'): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function normalizeMaxBytes(value: string): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.trunc(numeric);
}

export function emptyUpstreamCompatibilityPolicyForm(): UpstreamCompatibilityPolicyForm {
  return {
    mode: 'inherit',
    maxReasoningBytes: '',
    overflow: 'inherit',
    assistantHistory: 'inherit',
    assistantToolCalls: 'inherit',
    responseContinuation: 'inherit',
    toolCallMessageBehavior: 'inherit',
    openTag: DEFAULT_OPEN_TAG,
    closeTag: DEFAULT_CLOSE_TAG,
    separator: DEFAULT_SEPARATOR,
    advancedJson: '',
    advancedEnabled: false,
  };
}

export function formatCompatibilityPolicyJson(policy: unknown): string {
  if (!isRecord(policy)) return '';
  return JSON.stringify(policy, null, 2);
}

export function policyFormFromStoredValue(value: unknown): UpstreamCompatibilityPolicyForm {
  const form = emptyUpstreamCompatibilityPolicyForm();
  let parsed: unknown = value;
  if (typeof value === 'string' && value.trim()) {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {
        ...form,
        advancedJson: value,
        advancedEnabled: true,
      };
    }
  }
  if (!isRecord(parsed)) return form;

  const transport = readTransport(parsed);
  const mode = transport.mode;
  if (mode === 'native' || mode === 'content_think_tag' || mode === 'drop') form.mode = mode;
  if (typeof transport.maxReasoningBytes === 'number' && Number.isFinite(transport.maxReasoningBytes)) {
    form.maxReasoningBytes = String(Math.trunc(transport.maxReasoningBytes));
  }
  if (transport.overflow === 'truncate' || transport.overflow === 'drop') form.overflow = transport.overflow;

  const applyTo = isRecord(transport.applyTo) ? transport.applyTo : {};
  form.assistantHistory = readBooleanMode(applyTo.assistantHistory);
  form.assistantToolCalls = readBooleanMode(applyTo.assistantToolCalls);
  form.responseContinuation = readBooleanMode(applyTo.responseContinuation);

  if (
    transport.toolCallMessageBehavior === 'same_as_assistant'
    || transport.toolCallMessageBehavior === 'native'
    || transport.toolCallMessageBehavior === 'drop'
  ) {
    form.toolCallMessageBehavior = transport.toolCallMessageBehavior;
  }

  const thinkTag = isRecord(transport.thinkTag) ? transport.thinkTag : {};
  form.openTag = asString(thinkTag.openTag) || DEFAULT_OPEN_TAG;
  form.closeTag = asString(thinkTag.closeTag) || DEFAULT_CLOSE_TAG;
  form.separator = typeof thinkTag.separator === 'string' ? thinkTag.separator : DEFAULT_SEPARATOR;
  form.advancedJson = formatCompatibilityPolicyJson(parsed);
  return form;
}

export function serializeCompatibilityPolicyForm(
  form: UpstreamCompatibilityPolicyForm,
): { ok: true; policy: PolicyRecord | null } | { ok: false; error: string } {
  if (form.advancedEnabled) {
    try {
      const parsed = parsePolicyJson(form.advancedJson);
      if (parsed === undefined) return { ok: true, policy: null };
      if (!isRecord(parsed)) return { ok: false, error: 'Compatibility policy JSON must be an object.' };
      return { ok: true, policy: parsed };
    } catch {
      return { ok: false, error: 'Compatibility policy JSON is invalid.' };
    }
  }

  const transport: PolicyRecord = {};
  if (form.mode !== 'inherit') transport.mode = form.mode;
  const maxBytes = normalizeMaxBytes(form.maxReasoningBytes);
  if (form.maxReasoningBytes.trim() && maxBytes === undefined) {
    return { ok: false, error: 'maxReasoningBytes must be a positive integer.' };
  }
  pushDefined(transport, 'maxReasoningBytes', maxBytes);
  if (form.overflow !== 'inherit') transport.overflow = form.overflow;

  const thinkTag: PolicyRecord = {};
  if (form.openTag && form.openTag !== DEFAULT_OPEN_TAG) thinkTag.openTag = form.openTag;
  if (form.closeTag && form.closeTag !== DEFAULT_CLOSE_TAG) thinkTag.closeTag = form.closeTag;
  if (form.separator !== DEFAULT_SEPARATOR) thinkTag.separator = form.separator;
  if (Object.keys(thinkTag).length > 0) transport.thinkTag = thinkTag;

  const applyTo: PolicyRecord = {};
  pushDefined(applyTo, 'assistantHistory', booleanModeToValue(form.assistantHistory));
  pushDefined(applyTo, 'assistantToolCalls', booleanModeToValue(form.assistantToolCalls));
  pushDefined(applyTo, 'responseContinuation', booleanModeToValue(form.responseContinuation));
  if (Object.keys(applyTo).length > 0) transport.applyTo = applyTo;

  if (form.toolCallMessageBehavior !== 'inherit') {
    transport.toolCallMessageBehavior = form.toolCallMessageBehavior;
  }

  if (Object.keys(transport).length <= 0) return { ok: true, policy: null };
  return {
    ok: true,
    policy: {
      reasoningHistory: {
        transport,
      },
    },
  };
}

export function describeCompatibilityPolicy(value: unknown): string {
  const transport = readTransport(typeof value === 'string' && value.trim() ? safeParseJson(value) : value);
  const mode = asString(transport.mode) || 'inherit';
  const maxReasoningBytes = typeof transport.maxReasoningBytes === 'number'
    ? ` / ${Math.trunc(transport.maxReasoningBytes)} bytes`
    : '';
  return `${mode}${maxReasoningBytes}`;
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
