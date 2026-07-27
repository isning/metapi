import { z } from 'zod';
import type {
  DispatchPolicySimulationCommand,
  DispatchPolicyValidationCommand,
} from '../../shared/dispatchPolicyApi.js';

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));

const requestSchema = z.object({
  requestedModel: z.string().nullable().optional(),
  payload: jsonValueSchema.optional(),
  normalizedPayload: jsonValueSchema.optional(),
  headers: z.record(z.string(), z.unknown()).nullable().optional(),
  method: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  query: z.record(z.string(), z.unknown()).nullable().optional(),
  clientContext: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict();

const definitionSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  kind: z.enum(['cel', 'builtin']),
  selectionMode: z.enum(['weighted', 'ordered', 'round_robin', 'direct']),
  eligibilityExpression: z.string().optional(),
  contributionExpression: z.string().optional(),
  orderExpression: z.string().optional(),
  selectExpression: z.string().optional(),
  builtin: z.enum(['weighted', 'round_robin', 'stable_first']).optional(),
}).strict();

const policyRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inherit_default') }).strict(),
  z.object({ kind: z.literal('registry'), policyId: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal('inline'), policy: definitionSchema }).strict(),
  z.object({ kind: z.literal('builtin'), builtin: z.enum(['weighted', 'round_robin', 'stable_first']) }).strict(),
]);

const optionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().optional(),
  enabled: z.boolean().optional(),
  weight: z.number().finite().optional(),
  order: z.number().finite().optional(),
  runtime: z.record(z.string(), z.unknown()).optional(),
  selection: z.record(z.string(), z.unknown()).optional(),
  endpoint: z.record(z.string(), z.unknown()).optional(),
  executionAttempt: z.record(z.string(), z.unknown()).optional(),
  plan: z.record(z.string(), z.unknown()).optional(),
  graph: z.record(z.string(), z.unknown()).optional(),
}).strict();

const simulationSchema = z.union([
  z.object({
    mode: z.literal('synthetic'),
    policy: policyRefSchema,
    options: z.array(optionSchema).min(1),
    request: requestSchema.optional(),
  }).strict(),
  z.object({
    mode: z.literal('compiled_runtime'),
    inspectOnly: z.literal(true),
    policy: policyRefSchema,
    model: z.string().trim().min(1),
    request: requestSchema.optional(),
  }).strict(),
  z.object({
    mode: z.literal('compiled_runtime'),
    inspectOnly: z.literal(false).optional(),
    policy: policyRefSchema,
    model: z.string().trim().min(1),
    selectorId: z.string().trim().min(1),
    request: requestSchema.optional(),
  }).strict(),
]);

export type DispatchPolicyPayloadError = {
  path: string;
  code: string;
  message: string;
};

function errors(error: z.ZodError): DispatchPolicyPayloadError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

export function parseDispatchPolicyValidationCommand(input: unknown):
  | { success: true; data: DispatchPolicyValidationCommand }
  | { success: false; errors: DispatchPolicyPayloadError[] } {
  const parsed = z.object({ policy: definitionSchema }).strict().safeParse(input);
  return parsed.success
    ? { success: true, data: parsed.data as DispatchPolicyValidationCommand }
    : { success: false, errors: errors(parsed.error) };
}

export function parseDispatchPolicySimulationCommand(input: unknown):
  | { success: true; data: DispatchPolicySimulationCommand; requestKnown: boolean }
  | { success: false; errors: DispatchPolicyPayloadError[] } {
  const parsed = simulationSchema.safeParse(input);
  return parsed.success
    ? {
        success: true,
        data: parsed.data as DispatchPolicySimulationCommand,
        requestKnown: Object.prototype.hasOwnProperty.call(parsed.data, 'request'),
      }
    : { success: false, errors: errors(parsed.error) };
}
