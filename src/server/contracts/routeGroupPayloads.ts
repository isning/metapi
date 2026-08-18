import { z } from "zod";
import { normalizeRouteFailureBackoffPolicy } from "../../shared/routeGraph.js";

const inlineDispatchPolicySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(["cel", "builtin"]),
    selectionMode: z.enum(["weighted", "ordered", "round_robin", "direct"]),
    eligibilityExpression: z.string().optional(),
    contributionExpression: z.string().optional(),
    orderExpression: z.string().optional(),
    selectExpression: z.string().optional(),
    builtin: z.enum(["weighted", "round_robin", "stable_first"]).optional(),
  })
  .strict();

const dispatcherPolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inherit_default") }).strict(),
  z
    .object({ kind: z.literal("registry"), policyId: z.string().min(1) })
    .strict(),
  z
    .object({ kind: z.literal("inline"), policy: inlineDispatchPolicySchema })
    .strict(),
  z
    .object({
      kind: z.literal("builtin"),
      builtin: z.enum(["weighted", "round_robin", "stable_first"]),
    })
    .strict(),
]);
const failureBackoffPolicySchema = z.object({
  failureThreshold: z.number().int().min(1).max(100),
  levelsSec: z.array(z.number().int().nonnegative()).min(1).max(32),
  maxSec: z.number().int().positive().max(30 * 24 * 60 * 60),
}).strict().refine((policy) => normalizeRouteFailureBackoffPolicy(policy) !== null, {
  message: "Backoff levels must be nondecreasing and no greater than maxSec.",
});
const failureBackoffOverrideSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("custom"), policy: failureBackoffPolicySchema }).strict(),
  z.object({ mode: z.literal("disabled") }).strict(),
]);

const crossScopeFallbackSchema = z.enum(["deny", "temporary", "promote_on_success"]);
const affinityPolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inherit_default") }).strict(),
  z.object({ kind: z.literal("disabled") }).strict(),
  z.object({
    kind: z.literal("pool"),
    ttlSec: z.number().int().min(30).optional(),
    crossPoolFallback: crossScopeFallbackSchema,
  }).strict(),
  z.object({
    kind: z.literal("target"),
    ttlSec: z.number().int().min(30).optional(),
    crossTargetFallback: crossScopeFallbackSchema,
  }).strict(),
]);
const affinityConfigSchema = z.object({
  policy: affinityPolicySchema,
  pools: z.array(z.object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1).optional(),
    members: z.array(z.object({
      kind: z.literal("execution_target"),
      sourceRef: z.string().trim().min(1),
    }).strict()),
  }).strict()).optional(),
}).strict();

const presentationSchema = z
  .object({
    displayName: z.union([z.string(), z.null()]).optional(),
    displayIcon: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

const modelSchema = z
  .object({
    publicName: z.string().min(1),
    upstreamName: z.union([z.string().min(1), z.null()]).optional(),
  })
  .strict();

const sourceReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("execution_target"),
      sourceRef: z.string().uuid(),
    })
    .strict(),
  z.object({ kind: z.literal("route_group"), id: z.string().min(1) }).strict(),
]);

const sourceSelectionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("explicit"),
      sources: z.array(sourceReferenceSchema),
    })
    .strict(),
  z
    .object({ kind: z.literal("model_pattern"), pattern: z.string().min(1) })
    .strict(),
]);

const routeGroupCreateSchema = z
  .object({
    model: modelSchema,
    sourceSelection: sourceSelectionSchema.optional(),
    presentation: presentationSchema.optional(),
    dispatcherPolicy: z.union([dispatcherPolicySchema, z.null()]).optional(),
    failureBackoff: z.union([failureBackoffOverrideSchema, z.null()]).optional(),
    affinity: z.union([affinityConfigSchema, z.null()]).optional(),
    modelMapping: z.union([z.string(), z.null()]).optional(),
    filters: z.unknown().optional(),
    visibility: z.enum(["public", "internal"]).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const routeGroupUpdateSchema = z
  .object({
    model: modelSchema.optional(),
    sourceSelection: sourceSelectionSchema.optional(),
    presentation: presentationSchema.optional(),
    dispatcherPolicy: z.union([dispatcherPolicySchema, z.null()]).optional(),
    failureBackoff: z.union([failureBackoffOverrideSchema, z.null()]).optional(),
    affinity: z.union([affinityConfigSchema, z.null()]).optional(),
    modelMapping: z.union([z.string(), z.null()]).optional(),
    filters: z.unknown().optional(),
    visibility: z.enum(["public", "internal"]).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const routeGroupBatchSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1),
    action: z.enum(["enable", "disable", "set_internal", "set_public"]),
  })
  .strict();

const fallbackStagePayloadSchema = z
  .object({
    label: z.union([z.string(), z.null()]).optional(),
    enabled: z.boolean().optional(),
    dispatcherPolicy: z.union([dispatcherPolicySchema, z.null()]).optional(),
    placement: z.object({
      afterStageId: z.string().min(1),
      candidateId: z.string().min(1),
    }).strict().optional(),
  })
  .strict();

const fallbackStageOrderSchema = z
  .object({
    stageIds: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.stageIds).size !== value.stageIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stageIds"],
        message: "stageIds must contain unique stage IDs.",
      });
    }
  });

const candidateStageUpdateSchema = z
  .object({
    id: z.string().trim().min(1),
    stageId: z.string().trim().min(1),
    sortOrder: z.number().finite().nonnegative().transform(Math.trunc).optional(),
  })
  .strict();

const candidateStageUpdatesSchema = z
  .object({
    updates: z.array(candidateStageUpdateSchema).min(1),
    manuallyAdjustedCandidateIds: z.array(z.string().trim().min(1)).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const updateIds = new Set(value.updates.map((update) => update.id));
    for (const [index, id] of (value.manuallyAdjustedCandidateIds || []).entries()) {
      if (!updateIds.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manuallyAdjustedCandidateIds", index],
          message: "Adjusted candidate IDs must reference this update batch.",
        });
      }
    }
  });

export type RouteGroupCreatePayload = z.output<typeof routeGroupCreateSchema>;
export type RouteGroupUpdatePayload = z.output<typeof routeGroupUpdateSchema>;
export type RouteGroupBatchPayload = z.output<typeof routeGroupBatchSchema>;
export type RouteGroupExplicitSourceReference = z.output<
  typeof sourceReferenceSchema
>;
export type RouteGroupSourceSelection = z.output<typeof sourceSelectionSchema>;
export type RouteGroupDispatcherPolicyPayload = z.output<typeof dispatcherPolicySchema>;
export type RouteGroupFallbackStagePayload = z.output<typeof fallbackStagePayloadSchema>;
export type RouteGroupFallbackStageOrderPayload = z.output<typeof fallbackStageOrderSchema>;
export type RouteGroupCandidateStageUpdatesPayload = z.output<typeof candidateStageUpdatesSchema>;

function parse<T extends z.ZodType>(
  schema: T,
  input: unknown,
): { success: true; data: z.output<T> } | { success: false; error: string } {
  const result = schema.safeParse(input === undefined ? {} : input);
  if (result.success) return { success: true, data: result.data };
  const path = result.error.issues[0]?.path.join(".") || "";
  return {
    success: false,
    error: path
      ? `Invalid route group payload: ${path}.`
      : "Invalid route group payload.",
  };
}

export function parseRouteGroupCreatePayload(input: unknown) {
  return parse(routeGroupCreateSchema, input);
}

export function parseRouteGroupUpdatePayload(input: unknown) {
  return parse(routeGroupUpdateSchema, input);
}

export function parseRouteGroupBatchPayload(input: unknown) {
  return parse(routeGroupBatchSchema, input);
}

export function parseRouteGroupFallbackStagePayload(input: unknown) {
  return parse(fallbackStagePayloadSchema, input);
}

export function parseRouteGroupFallbackStageOrderPayload(input: unknown) {
  return parse(fallbackStageOrderSchema, input);
}

export function parseRouteGroupCandidateStageUpdatesPayload(input: unknown) {
  return parse(candidateStageUpdatesSchema, input);
}
