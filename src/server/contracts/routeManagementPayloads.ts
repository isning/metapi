import { z } from 'zod';
import {
  validateNativeRouteGraphSourcePolicies,
} from '../../shared/routeGraph.js';
import type { RouteGraphEdge, RouteGraphMacro, RouteGraphNode } from '../../shared/routeGraph.js';
import type {
  RouteGraphWorkspaceConnectionCreateCommand,
  RouteGraphWorkspaceConnectionDraftCommand,
  RouteGraphWorkspaceMacroCreateCommand,
  RouteGraphWorkspaceMacroDraft,
  RouteGraphWorkspaceNodeCreateCommand,
  RouteGraphWorkspaceNodeReservationCommand,
  RouteGraphWorkspaceNodeDraft,
  RouteGraphWorkspaceOperationBatchReplayCommand,
  RouteGraphWorkspaceOperationsCommand,
  RouteGraphWorkspaceRemovalImpactCommand,
} from '../../shared/routeGraphOperations.js';

const NODE_COMMON_KEYS = ['id', 'localRef', 'type', 'name', 'enabled', 'ownership', 'position', 'provenance', 'dynamicPorts', 'metadata'];
const NODE_KEYS: Record<string, string[]> = {
  entry: ['match'],
  route_endpoint: ['routeEndpointId', 'endpointKind', 'exposure', 'resolutionStatus', 'ownerKind', 'sourceKind', 'resolvesTo', 'backend', 'match', 'config', 'compatibilityPolicy'],
  filter: ['operations'],
  dispatcher: ['mode', 'ordering', 'policy'],
  synthetic_endpoint: ['statusCode', 'message', 'headers', 'body'],
};

const routeGraphPortPayloadSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  direction: z.enum(['input', 'output']),
  kind: z.enum(['request', 'bidirect', 'route']),
  manualEdgePolicy: z.enum(['allow', 'deny']),
  required: z.boolean().optional(),
  multiple: z.boolean().optional(),
  collection: z.object({
    type: z.enum(['single', 'arr', 'set']),
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
  }).strict().optional(),
  enabled: z.boolean().optional(),
  description: z.string().min(1).optional(),
}).strict();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validatePortList(value: unknown, context: z.RefinementCtx, path: Array<string | number>): void {
  if (z.array(routeGraphPortPayloadSchema).safeParse(value).success) return;
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message: 'Each route graph port must declare manualEdgePolicy as allow or deny.',
  });
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: string[], context: z.RefinementCtx): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) context.addIssue({ code: z.ZodIssueCode.unrecognized_keys, keys: [key] });
  }
}

function validateNodeTransportKeys(value: Record<string, unknown>, context: z.RefinementCtx): void {
  rejectUnknownKeys(value, [...NODE_COMMON_KEYS, ...(NODE_KEYS[String(value.type)] || [])], context);
  if (Object.prototype.hasOwnProperty.call(value, 'dynamicPorts')) {
    validatePortList(value.dynamicPorts, context, ['dynamicPorts']);
  }
}

function validateMacroPortContracts(value: Record<string, unknown>, context: z.RefinementCtx): void {
  const config = asRecord(value.config);
  const surface = config && asRecord(config.surface);
  if (!surface || !Object.prototype.hasOwnProperty.call(surface, 'ports')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['config', 'surface', 'ports'],
      message: 'Candidate selector surfaces must declare their ports explicitly.',
    });
    return;
  }
  validatePortList(surface.ports, context, ['config', 'surface', 'ports']);
}

const routeGroupCandidateCreatePayloadSchema = z.object({
  sourceRef: z.string().uuid(),
  stageId: z.string().min(1).optional(),
  weight: z.number().optional(),
}).strict();

const routeGroupCandidateBatchCreatePayloadSchema = z.object({
  sourceRefs: z.array(z.string().uuid()).min(1),
  stageId: z.string().min(1).optional(),
}).strict();

const routeGroupCandidateUpdatePayloadSchema = z.object({
  stageId: z.string().min(1).optional(),
  weight: z.number().optional(),
  enabled: z.boolean().optional(),
}).strict();

const routeRebuildPayloadSchema = z.object({
  refreshModels: z.boolean().optional(),
  wait: z.boolean().optional(),
}).strict();

const routeGraphAuthoringElementRefSchema = z.object({
  kind: z.enum(['node', 'macro']),
  id: z.string().min(1).optional(),
  localRef: z.string().min(1).optional(),
}).strict().refine((value) => Boolean(value.id) !== Boolean(value.localRef), {
  message: 'An edge endpoint must reference exactly one existing id or localRef.',
});

// Full-graph authoring is a command, not a persistence DTO. New elements are
// named only by local references; Graph services allocate opaque durable IDs.
const routeGraphAuthoringPayloadSchema = z.object({
  nodes: z.array(z.object({
    type: z.enum(['entry', 'route_endpoint', 'filter', 'dispatcher', 'synthetic_endpoint']),
    id: z.string().min(1).optional(),
    localRef: z.string().min(1).optional(),
  }).passthrough().superRefine((value, context) => {
    validateNodeTransportKeys(value, context);
    if (value.type === 'route_endpoint' && value.localRef && Object.prototype.hasOwnProperty.call(value, 'routeEndpointId')) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'New route endpoints receive routeEndpointId from the server.' });
    }
  }).refine((value) => Boolean(value.id) !== Boolean(value.localRef), {
    message: 'Each node must use exactly one existing id or localRef.',
  })),
  macros: z.array(z.object({
    kind: z.literal('candidate_selector'),
    id: z.string().min(1).optional(),
    localRef: z.string().min(1).optional(),
  }).passthrough().superRefine((value, context) => {
    rejectUnknownKeys(value, ['id', 'localRef', 'kind', 'enabled', 'ownership', 'name', 'config', 'position', 'metadata'], context);
    validateMacroPortContracts(value, context);
  }).refine((value) => Boolean(value.id) !== Boolean(value.localRef), {
    message: 'Each macro must use exactly one existing id or localRef.',
  })).optional(),
  edges: z.array(z.object({
    id: z.string().optional(),
    localRef: z.string().min(1).optional(),
    source: routeGraphAuthoringElementRefSchema,
    target: routeGraphAuthoringElementRefSchema,
    sourcePortId: z.string().min(1),
    targetPortId: z.string().min(1),
    kind: z.enum(['request_flow', 'bidirect_flow', 'route_flow']),
    ownership: z.enum(['manual', 'system', 'derived']),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).strict().refine((value) => Boolean(value.id) !== Boolean(value.localRef), {
    message: 'Each edge must use exactly one existing id or localRef.',
  })),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

// Workspace upserts carry complete resident graph elements. Transport-level
// validation owns their common shape; native compilation owns type-specific
// graph semantics after the operations are overlaid on the full draft.
const routeGraphWorkspaceNodePayloadSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['entry', 'route_endpoint', 'filter', 'dispatcher', 'synthetic_endpoint']),
  enabled: z.boolean(),
  ownership: z.enum(['manual', 'system', 'derived']),
}).passthrough().superRefine(validateNodeTransportKeys).transform((value) => value as unknown as RouteGraphNode);

const routeGraphWorkspaceNodeDraftPayloadSchema = z.object({
  type: z.enum(['entry', 'route_endpoint', 'filter', 'dispatcher', 'synthetic_endpoint']),
  enabled: z.boolean(),
  ownership: z.literal('manual'),
}).passthrough().superRefine((value, context) => {
  validateNodeTransportKeys(value, context);
  if (value.type === 'route_endpoint' && Object.prototype.hasOwnProperty.call(value, 'routeEndpointId')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'New route endpoints receive routeEndpointId from the server.' });
  }
}).transform((value) => value as unknown as RouteGraphWorkspaceNodeDraft);

const routeGraphWorkspaceMacroPayloadSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('candidate_selector'),
  enabled: z.boolean(),
  ownership: z.enum(['manual', 'system']),
  config: z.record(z.string(), z.unknown()),
}).passthrough().superRefine((value, context) => {
  rejectUnknownKeys(value, ['id', 'kind', 'enabled', 'ownership', 'name', 'config', 'position', 'metadata'], context);
  validateMacroPortContracts(value, context);
}).transform((value) => value as unknown as RouteGraphMacro);

const routeGraphWorkspaceMacroDraftPayloadSchema = z.object({
  kind: z.literal('candidate_selector'),
  enabled: z.boolean(),
  ownership: z.literal('manual'),
  config: z.record(z.string(), z.unknown()),
}).passthrough().superRefine((value, context) => {
  rejectUnknownKeys(value, ['kind', 'enabled', 'ownership', 'name', 'config', 'position', 'metadata'], context);
  validateMacroPortContracts(value, context);
}).transform((value) => value as unknown as RouteGraphWorkspaceMacroDraft);

const routeGraphWorkspaceEdgePayloadSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  sourcePortId: z.string().min(1),
  targetNodeId: z.string().min(1),
  targetPortId: z.string().min(1),
  kind: z.enum(['request_flow', 'bidirect_flow', 'route_flow']),
  ownership: z.enum(['manual', 'system', 'derived']),
}).passthrough().superRefine((value, context) => rejectUnknownKeys(value, ['id', 'sourceNodeId', 'sourcePortId', 'targetNodeId', 'targetPortId', 'kind', 'ownership', 'metadata'], context)).transform((value) => value as RouteGraphEdge);

const routeGraphWorkspaceOperationPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('upsert_node'), node: routeGraphWorkspaceNodePayloadSchema }),
  z.object({ kind: z.literal('remove_node'), nodeId: z.string().min(1) }),
  z.object({ kind: z.literal('upsert_macro'), macro: routeGraphWorkspaceMacroPayloadSchema }),
  z.object({ kind: z.literal('remove_macro'), macroId: z.string().min(1) }),
  z.object({ kind: z.literal('upsert_edge'), edge: routeGraphWorkspaceEdgePayloadSchema }),
  z.object({ kind: z.literal('remove_edge'), edgeId: z.string().min(1) }),
]);

const routeGraphWorkspaceOperationsPayloadSchema = z.object({
  revision: z.string().min(1),
  operations: z.array(routeGraphWorkspaceOperationPayloadSchema).min(1).max(100),
}).strict();

const routeGraphWorkspaceNodeCreatePayloadSchema = z.object({
  revision: z.string().min(1),
  node: routeGraphWorkspaceNodeDraftPayloadSchema,
}).strict();

const routeGraphWorkspaceNodeReservationPayloadSchema = z.object({
  node: routeGraphWorkspaceNodeDraftPayloadSchema,
}).strict();

const routeGraphWorkspaceMacroCreatePayloadSchema = z.object({
  revision: z.string().min(1),
  macro: routeGraphWorkspaceMacroDraftPayloadSchema,
}).strict();

const routeGraphWorkspaceValidationPayloadSchema = z.object({
  revision: z.string().min(1),
  operations: z.array(routeGraphWorkspaceOperationPayloadSchema).max(100),
}).strict();

const routeGraphWorkspaceOperationBatchReplayPayloadSchema = z.object({
  revision: z.string().min(1),
  direction: z.enum(['undo', 'replay']),
}).strict();

const routeGraphWorkspaceElementRefPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('macro'), id: z.string().min(1) }).strict(),
]);

const routeGraphWorkspaceConnectionEndpointPayloadSchema = z.object({
  element: routeGraphWorkspaceElementRefPayloadSchema,
  portId: z.string().min(1),
}).strict();

const routeGraphWorkspaceConnectionCreatePayloadSchema = z.object({
  revision: z.string().min(1),
  first: routeGraphWorkspaceConnectionEndpointPayloadSchema,
  second: routeGraphWorkspaceConnectionEndpointPayloadSchema,
  replacingEdgeId: z.string().min(1).optional(),
}).strict();

const routeGraphWorkspaceConnectionDraftPayloadSchema = routeGraphWorkspaceConnectionCreatePayloadSchema.extend({
  operations: z.array(routeGraphWorkspaceOperationPayloadSchema).max(100),
});

const routeGraphWorkspaceConnectionTargetQueryPayloadSchema = z.object({
  revision: z.string().min(1),
  operations: z.array(routeGraphWorkspaceOperationPayloadSchema).max(100),
  source: routeGraphWorkspaceConnectionEndpointPayloadSchema,
  replacingEdgeId: z.string().min(1).nullable().optional(),
}).strict();

const routeGraphWorkspaceRemovalImpactPayloadSchema = z.object({
  revision: z.string().min(1),
  element: routeGraphWorkspaceElementRefPayloadSchema,
}).strict();

export type RouteGroupCandidateBatchCreatePayload = z.output<typeof routeGroupCandidateBatchCreatePayloadSchema>;
export type RouteGroupCandidateCreatePayload = z.output<typeof routeGroupCandidateCreatePayloadSchema>;
export type RouteGroupCandidateUpdatePayload = z.output<typeof routeGroupCandidateUpdatePayloadSchema>;
export type RouteRebuildPayload = z.output<typeof routeRebuildPayloadSchema>;
export type RouteGraphAuthoringPayload = z.output<typeof routeGraphAuthoringPayloadSchema>;
export type RouteGraphWorkspaceOperationsPayload = RouteGraphWorkspaceOperationsCommand;
export type RouteGraphWorkspaceNodeCreatePayload = RouteGraphWorkspaceNodeCreateCommand;
export type RouteGraphWorkspaceNodeReservationPayload = RouteGraphWorkspaceNodeReservationCommand;
export type RouteGraphWorkspaceMacroCreatePayload = RouteGraphWorkspaceMacroCreateCommand;
export type RouteGraphWorkspaceValidationPayload = RouteGraphWorkspaceOperationsCommand;
export type RouteGraphWorkspaceOperationBatchReplayPayload = RouteGraphWorkspaceOperationBatchReplayCommand;
export type RouteGraphWorkspaceConnectionCreatePayload = RouteGraphWorkspaceConnectionCreateCommand;
export type RouteGraphWorkspaceConnectionDraftPayload = RouteGraphWorkspaceConnectionDraftCommand;
export type RouteGraphWorkspaceRemovalImpactPayload = RouteGraphWorkspaceRemovalImpactCommand;
function normalizeRouteManagementPayloadInput(input: unknown): unknown {
  return input === undefined ? {} : input;
}

function formatRouteManagementPayloadError(error: z.ZodError): string {
  const firstIssue = error.issues[0];
  if (firstIssue?.code === 'unrecognized_keys') {
    return 'Invalid route management payload.';
  }
  const [firstPath] = firstIssue?.path ?? [];
  if (!firstPath) {
    return '请求体必须是对象';
  }
  if (firstPath === 'sourceRef') {
    return 'Invalid sourceRef. Expected opaque source reference.';
  }
  if (firstPath === 'stageId') {
    return 'Invalid stageId. Expected opaque stage id.';
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
  if (firstPath === 'sourceRefs') {
    return 'Invalid sourceRefs. Expected opaque source reference array.';
  }
  return 'Invalid route management payload.';
}

function parseRouteManagementPayload<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): { success: true; data: z.output<T> } | { success: false; error: string } {
  const result = schema.safeParse(normalizeRouteManagementPayloadInput(input));
  if (!result.success) {
    return {
      success: false,
      error: formatRouteManagementPayloadError(result.error),
    };
  }
  return {
    success: true,
    data: result.data,
  };
}

function routeGraphSourcePolicyError(source: unknown): string | null {
  return validateNativeRouteGraphSourcePolicies(source)[0] || null;
}

export function parseRouteGroupCandidateCreatePayload(input: unknown):
{ success: true; data: RouteGroupCandidateCreatePayload } | { success: false; error: string } {
  return parseRouteManagementPayload(routeGroupCandidateCreatePayloadSchema, input);
}

export function parseRouteGroupCandidateBatchCreatePayload(input: unknown):
{ success: true; data: RouteGroupCandidateBatchCreatePayload } | { success: false; error: string } {
  return parseRouteManagementPayload(routeGroupCandidateBatchCreatePayloadSchema, input);
}

export function parseRouteGroupCandidateUpdatePayload(input: unknown):
{ success: true; data: RouteGroupCandidateUpdatePayload } | { success: false; error: string } {
  return parseRouteManagementPayload(routeGroupCandidateUpdatePayloadSchema, input);
}

export function parseRouteRebuildPayload(input: unknown):
{ success: true; data: RouteRebuildPayload } | { success: false; error: string } {
  return parseRouteManagementPayload(routeRebuildPayloadSchema, input);
}

export function parseRouteGraphAuthoringPayload(input: unknown):
{ success: true; data: RouteGraphAuthoringPayload } | { success: false; error: string } {
  const parsed = parseRouteManagementPayload(routeGraphAuthoringPayloadSchema, input);
  if (!parsed.success) return parsed;
  const error = routeGraphSourcePolicyError(parsed.data);
  return error ? { success: false, error } : parsed;
}

export function parseRouteGraphWorkspaceOperationsPayload(input: unknown):
{ success: true; data: RouteGraphWorkspaceOperationsPayload } | { success: false; error: string } {
  return parseRouteManagementPayload(routeGraphWorkspaceOperationsPayloadSchema, input);
}

export function parseRouteGraphWorkspaceNodeCreatePayload(input: unknown):
{ success: true; data: RouteGraphWorkspaceNodeCreatePayload } | { success: false; error: string } {
  return parseRouteManagementPayload(routeGraphWorkspaceNodeCreatePayloadSchema, input);
}

export function parseRouteGraphWorkspaceNodeReservationPayload(input: unknown):
{ success: true; data: RouteGraphWorkspaceNodeReservationPayload } | { success: false; error: string } {
  return parseRouteManagementPayload(routeGraphWorkspaceNodeReservationPayloadSchema, input);
}

export function parseRouteGraphWorkspaceMacroCreatePayload(input: unknown):
{ success: true; data: RouteGraphWorkspaceMacroCreatePayload } | { success: false; error: string } {
  return parseRouteManagementPayload(routeGraphWorkspaceMacroCreatePayloadSchema, input);
}

export function parseRouteGraphWorkspaceValidationPayload(input: unknown):
{ success: true; data: RouteGraphWorkspaceValidationPayload } | { success: false; error: string } {
  return parseRouteManagementPayload(routeGraphWorkspaceValidationPayloadSchema, input);
}

export function parseRouteGraphWorkspaceOperationBatchReplayPayload(input: unknown):
{ success: true; data: RouteGraphWorkspaceOperationBatchReplayPayload } | { success: false; error: string } {
  return parseRouteManagementPayload(routeGraphWorkspaceOperationBatchReplayPayloadSchema, input);
}

export function parseRouteGraphWorkspaceConnectionCreatePayload(input: unknown):
{ success: true; data: RouteGraphWorkspaceConnectionCreatePayload } | { success: false; error: string } {
  return parseRouteManagementPayload(routeGraphWorkspaceConnectionCreatePayloadSchema, input);
}

export function parseRouteGraphWorkspaceConnectionDraftPayload(input: unknown):
{ success: true; data: RouteGraphWorkspaceConnectionDraftPayload } | { success: false; error: string } {
  return parseRouteManagementPayload(routeGraphWorkspaceConnectionDraftPayloadSchema, input);
}

export function parseRouteGraphWorkspaceConnectionTargetQueryPayload(input: unknown) {
  return parseRouteManagementPayload(routeGraphWorkspaceConnectionTargetQueryPayloadSchema, input);
}

export function parseRouteGraphWorkspaceRemovalImpactPayload(input: unknown):
{ success: true; data: RouteGraphWorkspaceRemovalImpactPayload } | { success: false; error: string } {
  return parseRouteManagementPayload(routeGraphWorkspaceRemovalImpactPayloadSchema, input);
}
