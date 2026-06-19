import { z } from 'zod';

const routeChannelCreatePayloadSchema = z.object({
  accountId: z.number().int().positive(),
  tokenId: z.union([z.number().int().positive(), z.null()]).optional(),
  sourceModel: z.string().optional(),
  priority: z.number().optional(),
  weight: z.number().optional(),
}).passthrough();

const routeChannelBatchCreatePayloadSchema = z.object({
  channels: z.array(z.object({
    accountId: z.number().int().positive(),
    tokenId: z.union([z.number().int().positive(), z.null()]).optional(),
    sourceModel: z.string().optional(),
  }).passthrough()).min(1),
}).passthrough();

const routeChannelUpdatePayloadSchema = z.object({
  tokenId: z.union([z.number().int().positive(), z.null()]).optional(),
  sourceModel: z.union([z.string(), z.null()]).optional(),
  priority: z.number().optional(),
  weight: z.number().optional(),
  enabled: z.boolean().optional(),
}).passthrough();

const routeGraphMatchPayloadSchema = z.object({
  kind: z.literal('model').optional(),
  requestedModelPattern: z.string().optional(),
  displayName: z.union([z.string(), z.null()]).optional(),
}).passthrough();

const routeGraphBackendPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('channels'),
  }).passthrough(),
  z.object({
    kind: z.literal('routes'),
    routeIds: z.array(z.number().int().positive()).optional(),
  }).passthrough(),
]);

const routeGraphPresentationPayloadSchema = z.object({
  displayName: z.union([z.string(), z.null()]).optional(),
  displayIcon: z.union([z.string(), z.null()]).optional(),
}).passthrough();

const routeGraphMacroPayloadSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
}).passthrough();

const tokenRouteCreatePayloadSchema = z.object({
  match: routeGraphMatchPayloadSchema,
  backend: routeGraphBackendPayloadSchema,
  macro: routeGraphMacroPayloadSchema.optional(),
  presentation: routeGraphPresentationPayloadSchema.optional(),
  modelMapping: z.union([z.string(), z.null()]).optional(),
  routingStrategy: z.string().optional(),
  enabled: z.boolean().optional(),
}).passthrough();

const tokenRouteUpdatePayloadSchema = z.object({
  match: routeGraphMatchPayloadSchema.optional(),
  backend: routeGraphBackendPayloadSchema.optional(),
  macro: routeGraphMacroPayloadSchema.optional(),
  presentation: routeGraphPresentationPayloadSchema.optional(),
  modelMapping: z.union([z.string(), z.null()]).optional(),
  routingStrategy: z.string().optional(),
  enabled: z.boolean().optional(),
}).passthrough();

const tokenRouteBatchPayloadSchema = z.object({
  ids: z.array(z.number().int().positive()).optional(),
  action: z.string().optional(),
}).passthrough();

const routeRebuildPayloadSchema = z.object({
  refreshModels: z.boolean().optional(),
  wait: z.boolean().optional(),
}).passthrough();

const routeGraphSourcePayloadSchema = z.object({
  version: z.literal(1).optional(),
  nodes: z.array(z.object({
    id: z.string().min(1),
    type: z.string().min(1),
  }).passthrough()),
  macros: z.array(z.object({
    id: z.string().min(1),
    kind: z.string().min(1),
  }).passthrough()).optional(),
  edges: z.array(z.object({
    id: z.string().optional(),
    sourceNodeId: z.string().min(1),
    targetNodeId: z.string().min(1),
  }).passthrough()),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export type RouteChannelBatchCreatePayload = z.output<typeof routeChannelBatchCreatePayloadSchema>;
export type RouteChannelCreatePayload = z.output<typeof routeChannelCreatePayloadSchema>;
export type RouteChannelUpdatePayload = z.output<typeof routeChannelUpdatePayloadSchema>;
export type RouteRebuildPayload = z.output<typeof routeRebuildPayloadSchema>;
export type RouteGraphSourcePayload = z.output<typeof routeGraphSourcePayloadSchema>;
export type TokenRouteBatchPayload = z.output<typeof tokenRouteBatchPayloadSchema>;
export type TokenRouteCreatePayload = z.output<typeof tokenRouteCreatePayloadSchema>;
export type TokenRouteUpdatePayload = z.output<typeof tokenRouteUpdatePayloadSchema>;

function normalizeTokenRoutePayloadInput(input: unknown): unknown {
  return input === undefined ? {} : input;
}

function normalizeLegacyTokenRoutePayloadInput(input: unknown): unknown {
  const raw = normalizeTokenRoutePayloadInput(input);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  if (record.match !== undefined || record.backend !== undefined) return raw;
  const hasLegacyRouteShape = record.modelPattern !== undefined
    || record.routeMode !== undefined
    || record.sourceRouteIds !== undefined
    || record.displayName !== undefined
    || record.displayIcon !== undefined;
  if (!hasLegacyRouteShape) return raw;

  const routeMode = typeof record.routeMode === 'string' ? record.routeMode : 'pattern';
  const displayName = typeof record.displayName === 'string' || record.displayName === null
    ? record.displayName
    : null;
  const modelPattern = typeof record.modelPattern === 'string'
    ? record.modelPattern
    : (typeof displayName === 'string' ? displayName : '');
  const sourceRouteIds = Array.isArray(record.sourceRouteIds)
    ? record.sourceRouteIds.filter((value): value is number => Number.isFinite(Number(value)) && Number(value) > 0).map((value) => Math.trunc(Number(value)))
    : [];

  if (routeMode === 'explicit_group') {
    return {
      ...record,
      match: {
        kind: 'model',
        requestedModelPattern: '',
        displayName: displayName || modelPattern,
      },
      backend: {
        kind: 'routes',
        routeIds: sourceRouteIds,
      },
      presentation: {
        displayName: displayName || modelPattern,
        displayIcon: record.displayIcon ?? null,
      },
    };
  }

  return {
    ...record,
    match: {
      kind: 'model',
      requestedModelPattern: modelPattern,
      displayName,
    },
    backend: { kind: 'channels' },
    presentation: {
      displayName,
      displayIcon: record.displayIcon ?? null,
    },
  };
}

function formatTokenRoutePayloadError(error: z.ZodError): string {
  const firstIssue = error.issues[0];
  const [firstPath, secondPath, thirdPath] = firstIssue?.path ?? [];
  if (!firstPath) {
    return '请求体必须是对象';
  }
  if (firstPath === 'match') {
    return 'Invalid match. Expected Route Graph match object.';
  }
  if (firstPath === 'backend') {
    return 'Invalid backend. Expected Route Graph backend object.';
  }
  if (firstPath === 'presentation') {
    return 'Invalid presentation. Expected Route Graph presentation object.';
  }
  if (firstPath === 'displayIcon' || secondPath === 'displayIcon') {
    return 'Invalid displayIcon. Expected string or null.';
  }
  if (firstPath === 'displayName' || secondPath === 'displayName') {
    return 'Invalid displayName. Expected string or null.';
  }
  if (firstPath === 'modelMapping') {
    return 'Invalid modelMapping. Expected string or null.';
  }
  if (firstPath === 'routingStrategy') {
    return 'Invalid routingStrategy. Expected string.';
  }
  if (firstPath === 'enabled') {
    return 'Invalid enabled. Expected boolean.';
  }
  if (firstPath === 'routeIds' || secondPath === 'routeIds') {
    return 'Invalid backend.routeIds. Expected number[].';
  }
  if (firstPath === 'ids') {
    return 'Invalid ids. Expected number[].';
  }
  if (firstPath === 'action') {
    return 'Invalid action. Expected string.';
  }
  if (firstPath === 'accountId') {
    return 'Invalid accountId. Expected positive number.';
  }
  if (firstPath === 'tokenId') {
    return 'Invalid tokenId. Expected positive number or null.';
  }
  if (firstPath === 'sourceModel') {
    return 'Invalid sourceModel. Expected string or null.';
  }
  if (firstPath === 'priority') {
    return 'Invalid priority. Expected number.';
  }
  if (firstPath === 'weight') {
    return 'Invalid weight. Expected number.';
  }
  if (firstPath === 'refreshModels') {
    return 'Invalid refreshModels. Expected boolean.';
  }
  if (firstPath === 'wait') {
    return 'Invalid wait. Expected boolean.';
  }
  if (firstPath === 'nodes') {
    return 'Invalid route graph nodes. Expected typed node array.';
  }
  if (firstPath === 'edges') {
    return 'Invalid route graph edges. Expected edge array.';
  }
  if (firstPath === 'channels' && thirdPath === 'accountId') {
    return 'Invalid channels[].accountId. Expected positive number.';
  }
  if (firstPath === 'channels' && thirdPath === 'tokenId') {
    return 'Invalid channels[].tokenId. Expected positive number or null.';
  }
  if (firstPath === 'channels' && thirdPath === 'sourceModel') {
    return 'Invalid channels[].sourceModel. Expected string.';
  }
  if (firstPath === 'channels') {
    return 'Invalid channels. Expected channel array.';
  }
  return 'Invalid token route payload.';
}

function parseTokenRoutePayload<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): { success: true; data: z.output<T> } | { success: false; error: string } {
  const result = schema.safeParse(normalizeTokenRoutePayloadInput(input));
  if (!result.success) {
    return {
      success: false,
      error: formatTokenRoutePayloadError(result.error),
    };
  }
  return {
    success: true,
    data: result.data,
  };
}

export function parseTokenRouteCreatePayload(input: unknown):
{ success: true; data: TokenRouteCreatePayload } | { success: false; error: string } {
  return parseTokenRoutePayload(tokenRouteCreatePayloadSchema, normalizeLegacyTokenRoutePayloadInput(input));
}

export function parseTokenRouteUpdatePayload(input: unknown):
{ success: true; data: TokenRouteUpdatePayload } | { success: false; error: string } {
  return parseTokenRoutePayload(tokenRouteUpdatePayloadSchema, normalizeLegacyTokenRoutePayloadInput(input));
}

export function parseTokenRouteBatchPayload(input: unknown):
{ success: true; data: TokenRouteBatchPayload } | { success: false; error: string } {
  return parseTokenRoutePayload(tokenRouteBatchPayloadSchema, input);
}

export function parseRouteChannelCreatePayload(input: unknown):
{ success: true; data: RouteChannelCreatePayload } | { success: false; error: string } {
  return parseTokenRoutePayload(routeChannelCreatePayloadSchema, input);
}

export function parseRouteChannelBatchCreatePayload(input: unknown):
{ success: true; data: RouteChannelBatchCreatePayload } | { success: false; error: string } {
  return parseTokenRoutePayload(routeChannelBatchCreatePayloadSchema, input);
}

export function parseRouteChannelUpdatePayload(input: unknown):
{ success: true; data: RouteChannelUpdatePayload } | { success: false; error: string } {
  return parseTokenRoutePayload(routeChannelUpdatePayloadSchema, input);
}

export function parseRouteRebuildPayload(input: unknown):
{ success: true; data: RouteRebuildPayload } | { success: false; error: string } {
  return parseTokenRoutePayload(routeRebuildPayloadSchema, input);
}

export function parseRouteGraphSourcePayload(input: unknown):
{ success: true; data: RouteGraphSourcePayload } | { success: false; error: string } {
  return parseTokenRoutePayload(routeGraphSourcePayloadSchema, input);
}
