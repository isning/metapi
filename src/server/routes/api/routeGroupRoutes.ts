import type { FastifyInstance, FastifyReply } from 'fastify';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';

import {
  parseRouteGroupCandidateBatchCreatePayload,
  parseRouteGroupCandidateCreatePayload,
  parseRouteGroupCandidateUpdatePayload,
  parseRouteRebuildPayload,
} from '../../contracts/routeManagementPayloads.js';
import {
  parseRouteGroupBatchPayload,
  parseRouteGroupCandidateStageUpdatesPayload,
  parseRouteGroupCreatePayload,
  parseRouteGroupFallbackStageOrderPayload,
  parseRouteGroupFallbackStagePayload,
  parseRouteGroupUpdatePayload,
} from '../../contracts/routeGroupPayloads.js';
import { buildEndpointTypesByModelFromMarketplaceCache } from '../../services/modelTokenCandidateService.js';
import * as routeRefreshWorkflow from '../../services/routeRefreshWorkflow.js';
import {
  batchCreateRouteGroupCandidatesCommand,
  createRouteGroupCandidateCommand,
  deleteRouteGroupCandidateCommand,
  moveRouteGroupCandidatesCommand,
  restoreRouteGroupCandidateManagementCommand,
  updateRouteGroupCandidateCommand,
} from '../../services/routeGroupCandidateCommandService.js';
import { listRouteGroupCandidateCatalogPage } from '../../services/routeGroupCandidateService.js';
import {
  createRouteGroupFallbackStageWithProjection,
  deleteRouteGroupFallbackStage,
  fallbackStageDto,
  listRouteGroupFallbackStages,
  reorderRouteGroupFallbackStages,
  updateRouteGroupFallbackStage,
} from '../../services/routeGroupFallbackStageService.js';
import {
  batchUpdateRouteGroups,
  createRouteGroupFromPayload,
  deleteRouteGroupByKey,
  listRouteGroupSourceCatalogPage,
  loadRouteGroupByKey,
  RouteGroupSourceCatalogCursorError,
  updateRouteGroupFromPayload,
} from '../../services/routeGroupManagementService.js';
import {
  invalidateRouteGroupManagementReadModel,
  loadRouteGroupManagementReadModel,
} from '../../services/routeGroupManagementReadModelService.js';
import { clearRouteGroupFailureState } from '../../services/routeGroupRuntimeStateService.js';
import {
  buildRouteSummaryProjectionOverview,
  buildRouteSummaryProjectionPage,
  type RouteSummaryProjectionQuery,
} from '../../services/routeSummaryProjectionService.js';
import { RouteGraphSyncValidationError } from '../../services/routeGraphService.js';
import { RouteGroupCommandError } from '../../services/routeGroupCommandError.js';

function createSummaryReadLimiter(points = 60): RateLimiterMemory {
  return new RateLimiterMemory({
    keyPrefix: 'route-groups-summary-read',
    points,
    duration: 60,
  });
}

let summaryReadLimiter = createSummaryReadLimiter();

export function resetRouteGroupReadLimiterForTests(points = 60): void {
  summaryReadLimiter = createSummaryReadLimiter(points);
  invalidateRouteGroupManagementReadModel();
}

function sendRateLimit(reply: FastifyReply, error: unknown): void {
  const retryState = error instanceof RateLimiterRes ? error : null;
  const retryAfterSec = Math.max(1, Math.ceil((retryState?.msBeforeNext ?? 60_000) / 1000));
  reply
    .code(429)
    .header('retry-after', String(retryAfterSec))
    .send({ success: false, code: 'route_group_rate_limited', params: { retryAfterSec } });
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function routeGroupCommandStatus(code: RouteGroupCommandError['code']): number {
  if (code === 'route_group_not_found' || code === 'candidate_not_found' || code === 'fallback_stage_not_found') {
    return 404;
  }
  if (code === 'candidate_create_failed' || code === 'fallback_stage_projection_failed') return 500;
  return 400;
}

function routeGroupCommandResponse(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof RouteGroupCommandError) {
    return reply.code(routeGroupCommandStatus(error.code)).send({
      success: false,
      code: error.code,
      params: error.params,
    });
  }
  if (
    error instanceof RouteGraphSyncValidationError
    || (error instanceof Error
      && error.name === 'RouteGraphSyncValidationError'
      && Array.isArray((error as RouteGraphSyncValidationError).diagnostics))
  ) {
    const validationError = error as RouteGraphSyncValidationError;
    return reply.code(400).send({
      success: false,
      code: 'source_graph_invalid',
      params: {},
      diagnostics: validationError.diagnostics,
    });
  }
  throw error;
}

function invalidPayloadResponse(reply: FastifyReply, detail: string): FastifyReply {
  return reply.code(400).send({
    success: false,
    code: 'invalid_route_group_payload',
    params: { detail },
  });
}

function routeGroupCodeResponse(
  reply: FastifyReply,
  code: RouteGroupCommandError['code'],
  params: RouteGroupCommandError['params'] = {},
): FastifyReply {
  return routeGroupCommandResponse(new RouteGroupCommandError(code, params), reply);
}

async function consumeSummaryRead(requestIp: string, reply: FastifyReply): Promise<boolean> {
  try {
    await summaryReadLimiter.consume(requestIp);
    return true;
  } catch (error) {
    sendRateLimit(reply, error);
    return false;
  }
}

export async function registerRouteGroupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/route-groups/overview', async (request, reply) => {
    if (!await consumeSummaryRead(request.ip, reply)) return;
    const rows = await loadRouteGroupManagementReadModel();
    return buildRouteSummaryProjectionOverview(rows, {
      endpointTypesByModel: buildEndpointTypesByModelFromMarketplaceCache(),
    });
  });

  app.get<{
    Querystring: {
      paged?: string;
      page?: string;
      pageSize?: string;
    } & RouteSummaryProjectionQuery;
  }>('/api/route-groups', async (request, reply) => {
    if (!await consumeSummaryRead(request.ip, reply)) return;
    const rows = await loadRouteGroupManagementReadModel();
    return buildRouteSummaryProjectionPage(rows, request.query, {
      endpointTypesByModel: buildEndpointTypesByModelFromMarketplaceCache(),
    });
  });

  app.get<{
    Querystring: { q?: string; excludeGroupKey?: string; cursor?: string; limit?: string };
  }>('/api/route-groups/sources', async (request, reply) => {
    if (!await consumeSummaryRead(request.ip, reply)) return;
    try {
      return await listRouteGroupSourceCatalogPage({
        ...request.query,
        limit: Number(request.query.limit),
      });
    } catch (error) {
      if (error instanceof RouteGroupSourceCatalogCursorError) {
        return reply.code(error.code === 'stale_source_catalog_cursor' ? 409 : 400).send({
          success: false,
          code: error.code,
        });
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string }; Querystring: { q?: string; page?: string; pageSize?: string } }>(
    '/api/route-groups/:id/candidate-catalog',
    async (request, reply) => {
      try {
        return await listRouteGroupCandidateCatalogPage({
          groupId: normalizeText(request.params.id),
          query: request.query.q,
          page: Number(request.query.page),
          pageSize: Number(request.query.pageSize),
        });
      } catch (error) {
        return routeGroupCommandResponse(error, reply);
      }
    },
  );

  app.get<{ Params: { id: string } }>('/api/route-groups/:id/stages', async (request, reply) => {
    const group = await loadRouteGroupByKey(normalizeText(request.params.id));
    if (!group) return routeGroupCodeResponse(reply, 'route_group_not_found');
    const stages = await listRouteGroupFallbackStages(group.id);
    return { stages: stages.map(fallbackStageDto) };
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/route-groups/:id/stages', async (request, reply) => {
    const parsed = parseRouteGroupFallbackStagePayload(request.body);
    if (!parsed.success) return invalidPayloadResponse(reply, parsed.error);
    const { placement, ...stagePayload } = parsed.data;
    const group = await loadRouteGroupByKey(normalizeText(request.params.id));
    if (!group) return routeGroupCodeResponse(reply, 'route_group_not_found');
    const created = await createRouteGroupFallbackStageWithProjection(group.id, stagePayload, placement);
    return {
      success: true,
      stage: fallbackStageDto(created.stage),
      stages: created.stages.map(fallbackStageDto),
    };
  });

  app.put<{ Params: { id: string; stageId: string }; Body: unknown }>(
    '/api/route-groups/:id/stages/:stageId',
    async (request, reply) => {
      const parsed = parseRouteGroupFallbackStagePayload(request.body);
      if (!parsed.success) return invalidPayloadResponse(reply, parsed.error);
      const { placement, ...stagePayload } = parsed.data;
      if (placement) return routeGroupCodeResponse(reply, 'fallback_stage_placement_not_allowed');
      const group = await loadRouteGroupByKey(normalizeText(request.params.id));
      if (!group) return routeGroupCodeResponse(reply, 'route_group_not_found');
      const stageId = normalizeText(request.params.stageId);
      if (!stageId) return invalidPayloadResponse(reply, 'stageId');
      const stage = await updateRouteGroupFallbackStage(group.id, stageId, stagePayload);
      if (!stage) return routeGroupCodeResponse(reply, 'fallback_stage_not_found');
      return { success: true, stage: fallbackStageDto(stage) };
    },
  );

  app.put<{ Params: { id: string }; Body: unknown }>('/api/route-groups/:id/stages/order', async (request, reply) => {
    const parsed = parseRouteGroupFallbackStageOrderPayload(request.body);
    if (!parsed.success) return invalidPayloadResponse(reply, parsed.error);
    const group = await loadRouteGroupByKey(normalizeText(request.params.id));
    if (!group) return routeGroupCodeResponse(reply, 'route_group_not_found');
    try {
      const stages = await reorderRouteGroupFallbackStages(group.id, parsed.data.stageIds);
      return { success: true, stages: stages.map(fallbackStageDto) };
    } catch (error) {
      return routeGroupCommandResponse(error, reply);
    }
  });

  app.delete<{ Params: { id: string; stageId: string } }>(
    '/api/route-groups/:id/stages/:stageId',
    async (request, reply) => {
      const group = await loadRouteGroupByKey(normalizeText(request.params.id));
      if (!group) return routeGroupCodeResponse(reply, 'route_group_not_found');
      const stageId = normalizeText(request.params.stageId);
      if (!stageId) return invalidPayloadResponse(reply, 'stageId');
      try {
        const deleted = await deleteRouteGroupFallbackStage(group.id, stageId);
        if (!deleted) return routeGroupCodeResponse(reply, 'fallback_stage_not_found');
        return { success: true };
      } catch (error) {
        return routeGroupCommandResponse(error, reply);
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/route-groups/:id/failure-state', async (request, reply) => {
    try {
      return await clearRouteGroupFailureState(request.params.id);
    } catch (error) {
      return routeGroupCommandResponse(error, reply);
    }
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/route-groups/:id/candidates/batch',
    async (request, reply) => {
      const parsed = parseRouteGroupCandidateBatchCreatePayload(request.body);
      if (!parsed.success) return invalidPayloadResponse(reply, parsed.error);
      try {
        const result = await batchCreateRouteGroupCandidatesCommand({
          routeGroupId: request.params.id,
          sourceRefs: parsed.data.sourceRefs,
          stageId: parsed.data.stageId,
        });
        return { success: true, ...result };
      } catch (error) {
        return routeGroupCommandResponse(error, reply);
      }
    },
  );

  app.post<{ Body: unknown }>('/api/route-groups', async (request, reply) => {
    const parsed = parseRouteGroupCreatePayload(request.body);
    if (!parsed.success) return invalidPayloadResponse(reply, parsed.error);
    try {
      return await createRouteGroupFromPayload(parsed.data);
    } catch (error) {
      return routeGroupCommandResponse(error, reply);
    }
  });

  app.put<{ Params: { id: string }; Body: unknown }>('/api/route-groups/:id', async (request, reply) => {
    const parsed = parseRouteGroupUpdatePayload(request.body);
    if (!parsed.success) return invalidPayloadResponse(reply, parsed.error);
    try {
      const updated = await updateRouteGroupFromPayload(request.params.id, parsed.data);
      if (!updated) return routeGroupCodeResponse(reply, 'route_group_not_found');
      return updated;
    } catch (error) {
      return routeGroupCommandResponse(error, reply);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/route-groups/:id', async (request, reply) => {
    const deleted = await deleteRouteGroupByKey(request.params.id);
    if (!deleted) return routeGroupCodeResponse(reply, 'route_group_not_found');
    return { success: true };
  });

  app.post<{ Body: unknown }>('/api/route-groups/batch', async (request, reply) => {
    const parsed = parseRouteGroupBatchPayload(request.body);
    if (!parsed.success) return invalidPayloadResponse(reply, parsed.error);
    try {
      const updatedCount = await batchUpdateRouteGroups({
        ids: parsed.data.ids,
        action: parsed.data.action,
      });
      return { success: true, updatedCount };
    } catch (error) {
      return routeGroupCommandResponse(error, reply);
    }
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/api/route-groups/:id/candidates', async (request, reply) => {
    const parsed = parseRouteGroupCandidateCreatePayload(request.body);
    if (!parsed.success) return invalidPayloadResponse(reply, parsed.error);
    try {
      return await createRouteGroupCandidateCommand({
        routeGroupId: request.params.id,
        sourceRef: parsed.data.sourceRef,
        stageId: parsed.data.stageId,
        weight: parsed.data.weight,
      });
    } catch (error) {
      return routeGroupCommandResponse(error, reply);
    }
  });

  app.put<{ Params: { id: string }; Body: unknown }>(
    '/api/route-groups/:id/candidates/stages',
    async (request, reply) => {
      const parsed = parseRouteGroupCandidateStageUpdatesPayload(request.body);
      if (!parsed.success) return invalidPayloadResponse(reply, parsed.error);
      try {
        const moved = await moveRouteGroupCandidatesCommand({
          routeGroupId: request.params.id,
          updates: parsed.data.updates,
          manuallyAdjustedCandidateIds: parsed.data.manuallyAdjustedCandidateIds,
        });
        return { success: true, ...moved };
      } catch (error) {
        return routeGroupCommandResponse(error, reply);
      }
    },
  );

  app.delete<{ Params: { id: string; candidateId: string } }>(
    '/api/route-groups/:id/candidates/:candidateId/manual-adjustment',
    async (request, reply) => {
      const candidateId = normalizeText(request.params.candidateId);
      if (!candidateId) return invalidPayloadResponse(reply, 'candidateId');
      try {
        const restored = await restoreRouteGroupCandidateManagementCommand({
          routeGroupId: request.params.id,
          candidateIds: [candidateId],
        });
        return { success: true, ...restored };
      } catch (error) {
        return routeGroupCommandResponse(error, reply);
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/route-groups/:id/manual-adjustments', async (request, reply) => {
    try {
      const restored = await restoreRouteGroupCandidateManagementCommand({ routeGroupId: request.params.id });
      return { success: true, ...restored };
    } catch (error) {
      return routeGroupCommandResponse(error, reply);
    }
  });

  app.put<{ Params: { id: string; candidateId: string }; Body: unknown }>(
    '/api/route-groups/:id/candidates/:candidateId',
    async (request, reply) => {
      const parsed = parseRouteGroupCandidateUpdatePayload(request.body);
      if (!parsed.success) return invalidPayloadResponse(reply, parsed.error);
      try {
        return await updateRouteGroupCandidateCommand({
          routeGroupId: request.params.id,
          candidateId: request.params.candidateId,
          patch: {
            ...(parsed.data.stageId !== undefined ? { stageId: parsed.data.stageId } : {}),
            ...(parsed.data.weight !== undefined ? { weight: parsed.data.weight } : {}),
            ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
          },
        });
      } catch (error) {
        return routeGroupCommandResponse(error, reply);
      }
    },
  );

  app.delete<{ Params: { id: string; candidateId: string } }>(
    '/api/route-groups/:id/candidates/:candidateId',
    async (request, reply) => {
      try {
        await deleteRouteGroupCandidateCommand(request.params.id, request.params.candidateId);
        return { success: true };
      } catch (error) {
        return routeGroupCommandResponse(error, reply);
      }
    },
  );

  app.post<{ Body: unknown }>('/api/route-groups/rebuild', async (request, reply) => {
    const parsed = parseRouteRebuildPayload(request.body);
    if (!parsed.success) return invalidPayloadResponse(reply, parsed.error);
    if (parsed.data.refreshModels === false) {
      const rebuild = await routeRefreshWorkflow.rebuildRoutesOnly();
      return { success: true, rebuild };
    }
    if (parsed.data.wait) {
      const result = await routeRefreshWorkflow.refreshModelsAndRebuildRoutes();
      return { success: true, ...result };
    }

    const { task, reused } = routeRefreshWorkflow.queueRefreshModelsAndRebuildRoutesTask();
    return reply.code(202).send({
      success: true,
      queued: true,
      reused,
      taskId: task.id,
      task,
    });
  });
}
