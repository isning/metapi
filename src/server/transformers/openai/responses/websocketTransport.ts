import { randomUUID } from 'node:crypto';

export type NormalizedResponsesWebsocketRequest =
  | {
    ok: true;
    request: Record<string, unknown>;
    nextRequestSnapshot: Record<string, unknown>;
  }
  | {
    ok: false;
    status: number;
    message: string;
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneJsonObject<T>(value: T): T {
  return structuredClone(value);
}

function toResponseInputArray(value: unknown): unknown[] {
  return Array.isArray(value) ? cloneJsonObject(value) : [];
}

export function normalizeResponsesWebsocketRequest(input: {
  parsed: Record<string, unknown>;
  lastRequest: Record<string, unknown> | null;
  lastResponseOutput: unknown[];
  supportsIncrementalInput: boolean;
}): NormalizedResponsesWebsocketRequest {
  const { parsed, lastRequest, lastResponseOutput, supportsIncrementalInput } = input;
  const requestType = asTrimmedString(parsed.type);
  if (requestType !== 'response.create' && requestType !== 'response.append') {
    return {
      ok: false,
      status: 400,
      message: `unsupported websocket request type: ${requestType || 'unknown'}`,
    };
  }

  if (!lastRequest) {
    if (requestType !== 'response.create') {
      return {
        ok: false,
        status: 400,
        message: 'websocket request received before response.create',
      };
    }
    const next = cloneJsonObject(parsed);
    delete next.type;
    if (!supportsIncrementalInput && parsed.generate === false) {
      delete next.generate;
    }
    next.stream = true;
    if (!Array.isArray(next.input)) next.input = [];
    const modelName = asTrimmedString(next.model);
    if (!modelName) {
      return {
        ok: false,
        status: 400,
        message: 'missing model in response.create request',
      };
    }
    return {
      ok: true,
      request: next,
      nextRequestSnapshot: cloneJsonObject(next),
    };
  }

  if (!Array.isArray(parsed.input)) {
    return {
      ok: false,
      status: 400,
      message: 'websocket request requires array field: input',
    };
  }

  const next = cloneJsonObject(parsed);
  delete next.type;
  next.stream = true;
  if (!('model' in next) && typeof lastRequest.model === 'string') {
    next.model = lastRequest.model;
  }
  if (!('instructions' in next) && lastRequest.instructions !== undefined) {
    next.instructions = cloneJsonObject(lastRequest.instructions);
  }

  if (supportsIncrementalInput && requestType === 'response.create' && asTrimmedString(parsed.previous_response_id)) {
    return {
      ok: true,
      request: next,
      nextRequestSnapshot: cloneJsonObject(next),
    };
  }

  const mergedInput = [
    ...toResponseInputArray(lastRequest.input),
    ...cloneJsonObject(lastResponseOutput),
    ...cloneJsonObject(parsed.input),
  ];
  delete next.previous_response_id;
  next.input = mergedInput;

  return {
    ok: true,
    request: next,
    nextRequestSnapshot: cloneJsonObject(next),
  };
}

export function shouldHandleResponsesWebsocketPrewarmLocally(input: {
  parsed: Record<string, unknown>;
  lastRequest: Record<string, unknown> | null;
  supportsIncrementalInput: boolean;
}): boolean {
  if (input.supportsIncrementalInput || input.lastRequest) return false;
  if (asTrimmedString(input.parsed.type) !== 'response.create') return false;
  return input.parsed.generate === false;
}

export function isResponsesWebsocketTerminalPayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const type = asTrimmedString(payload.type);
  return type === 'response.completed' || type === 'response.failed' || type === 'response.incomplete';
}

export function synthesizePrewarmResponsePayloads(request: Record<string, unknown>) {
  const responseId = `resp_prewarm_${randomUUID()}`;
  const modelName = asTrimmedString(request.model) || 'unknown';
  const createdAt = Math.floor(Date.now() / 1000);
  return [
    {
      type: 'response.created',
      response: {
        id: responseId,
        object: 'response',
        created_at: createdAt,
        status: 'in_progress',
        model: modelName,
        output: [],
      },
    },
    {
      type: 'response.completed',
      response: {
        id: responseId,
        object: 'response',
        created_at: createdAt,
        status: 'completed',
        model: modelName,
        output: [],
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        },
      },
    },
  ];
}

export function collectResponsesWebsocketOutput(payloads: unknown[]): unknown[] {
  const outputByIndex = new Map<number, unknown>();
  let completedOutput: unknown[] | null = null;
  const fallbackStatusForType = (type: string): string => {
    if (type === 'response.completed') return 'completed';
    if (type === 'response.failed') return 'failed';
    return 'incomplete';
  };

  for (const payload of payloads) {
    if (!isRecord(payload)) continue;
    const type = asTrimmedString(payload.type);
    if ((type === 'response.output_item.added' || type === 'response.output_item.done')
      && Number.isInteger(payload.output_index)
      && payload.item !== undefined) {
      outputByIndex.set(Number(payload.output_index), cloneJsonObject(payload.item));
      continue;
    }
    if (
      isResponsesWebsocketTerminalPayload(payload)
      && isRecord(payload.response)
      && Array.isArray(payload.response.output)
    ) {
      const terminalOutput = cloneJsonObject(payload.response.output);
      if (terminalOutput.length > 0 || outputByIndex.size === 0) {
        completedOutput = terminalOutput;
      }
      continue;
    }
    if (
      isResponsesWebsocketTerminalPayload(payload)
      && isRecord(payload.response)
      && typeof payload.response.output_text === 'string'
      && payload.response.output_text.trim()
    ) {
      completedOutput = [{
        id: `msg_${asTrimmedString(payload.response.id) || type}`,
        type: 'message',
        role: 'assistant',
        status: asTrimmedString(payload.response.status) || fallbackStatusForType(type),
        content: [{
          type: 'output_text',
          text: payload.response.output_text,
        }],
      }];
      continue;
    }
    if (Array.isArray(payload.output)) {
      const terminalOutput = cloneJsonObject(payload.output);
      if (terminalOutput.length > 0 || outputByIndex.size === 0) {
        completedOutput = terminalOutput;
      }
      continue;
    }
    if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
      const fallbackStatus = asTrimmedString(payload.status) || fallbackStatusForType(type || 'response.completed');
      completedOutput = [{
        id: `msg_${type || 'response'}`,
        type: 'message',
        role: 'assistant',
        status: fallbackStatus,
        content: [{
          type: 'output_text',
          text: payload.output_text,
        }],
      }];
    }
  }

  if (completedOutput) return completedOutput;
  return [...outputByIndex.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, value]) => value);
}
