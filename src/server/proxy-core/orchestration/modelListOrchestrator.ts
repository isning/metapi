import type { FastifyReply, FastifyRequest } from 'fastify';
import { fetch } from 'undici';
import {
  previewRouteRuntimeDecision,
} from '../../services/routeRuntimeExecutionService.js';
import { readRuntimeResponseText } from '../executors/types.js';
import type { DownstreamProtocolAdapter } from '../formats/types.js';
import { getDownstreamRoutingPolicy } from '../downstreamPolicy.js';
import {
  buildForcedExecutionAttemptUnavailableMessage,
  canRetryExecutionAttemptSelection,
  getTesterForcedExecutionAttemptId,
} from '../executionAttemptSelection.js';
import { buildCompiledRouteRuntimeRequestSnapshot } from './compiledRouteRuntimeRequest.js';
import {
  listActiveCompiledRuntimeModelEntrypoints,
} from '../../services/compiledRuntimeInventoryService.js';
import type { DownstreamRoutingPolicy } from '../../services/downstreamPolicyTypes.js';
import { matchesModelPattern } from '../../../shared/modelPatternMatcher.js';

type ListedModel = { name: string; displayName: string };

function extractListedModelName(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const rawName = typeof (item as { name?: unknown }).name === 'string'
    ? (item as { name: string }).name.trim()
    : '';
  if (!rawName) return '';
  return rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName;
}

function hasDownstreamModelRestrictions(policy: { supportedModels?: unknown; allowedPlanIds?: unknown; denyAllWhenEmpty?: unknown }): boolean {
  const supportedModels = Array.isArray(policy.supportedModels) ? policy.supportedModels : [];
  const allowedPlanIds = Array.isArray(policy.allowedPlanIds) ? policy.allowedPlanIds : [];
  return supportedModels.length > 0 || allowedPlanIds.length > 0 || policy.denyAllWhenEmpty === true;
}

async function filterListedModelsForPolicy(
  payload: unknown,
  request: FastifyRequest,
): Promise<unknown> {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { models?: unknown[] }).models)) {
    return payload;
  }

  const policy = await getDownstreamRoutingPolicy(request);
  if (!hasDownstreamModelRestrictions(policy)) {
    return payload;
  }

  const filteredModels: unknown[] = [];
  for (const item of (payload as { models: unknown[] }).models) {
    const modelName = extractListedModelName(item);
    if (!modelName) continue;
    if (!await isModelAllowedByRuntimePolicy(modelName, policy)) continue;
    filteredModels.push(item);
  }

  return {
    ...(payload as Record<string, unknown>),
    models: filteredModels,
  };
}

async function readRouteAwareModels(policy: DownstreamRoutingPolicy): Promise<ListedModel[]> {
  const allowedPlanIds = Array.isArray(policy.allowedPlanIds)
    ? policy.allowedPlanIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const entrypoints = await listActiveCompiledRuntimeModelEntrypoints();
  const routeScopedPlanIds = new Set(allowedPlanIds);
  const hasPatternRules = Array.isArray(policy.supportedModels) && policy.supportedModels.length > 0;
  const unrestricted = !hasPatternRules && allowedPlanIds.length === 0 && policy.denyAllWhenEmpty !== true;
  const deduped = entrypoints.sort((left, right) => left.modelName.localeCompare(right.modelName));

  const allowed: ListedModel[] = [];
  for (const entrypoint of deduped) {
    const modelName = entrypoint.modelName;
    const routeAllowed = routeScopedPlanIds.has(entrypoint.planId);
    const patternAllowed = hasPatternRules && policy.supportedModels.some((pattern) => matchesModelPattern(modelName, pattern));
    if (!unrestricted && !routeAllowed && !patternAllowed) continue;
    allowed.push({
      name: `models/${modelName}`,
      displayName: modelName,
    });
  }
  return allowed;
}

async function isModelAllowedByRuntimePolicy(
  modelName: string,
  policy: DownstreamRoutingPolicy,
): Promise<boolean> {
  const supportedPatterns = Array.isArray(policy.supportedModels) ? policy.supportedModels : [];
  const allowedPlanIds = Array.isArray(policy.allowedPlanIds)
    ? policy.allowedPlanIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const hasPatternRules = supportedPatterns.length > 0;
  const hasPlanRules = allowedPlanIds.length > 0;
  if (!hasPatternRules && !hasPlanRules) return policy.denyAllWhenEmpty === true ? false : true;
  if (hasPatternRules && supportedPatterns.some((pattern) => matchesModelPattern(modelName, pattern))) {
    return true;
  }
  if (!hasPlanRules) return false;
  const normalizedModel = modelName.toLowerCase();
  const allowedPlanIdSet = new Set(allowedPlanIds);
  const entrypoints = await listActiveCompiledRuntimeModelEntrypoints();
  return entrypoints.some((entrypoint) => (
    entrypoint.modelName.toLowerCase() === normalizedModel
    && allowedPlanIdSet.has(entrypoint.planId)
  ));
}

async function selectModelListTarget(
  request: FastifyRequest,
  adapter: DownstreamProtocolAdapter,
  forcedExecutionAttemptId: string | null,
  excludeTargetIds: number[],
  retryCount: number,
) {
  const policy = await getDownstreamRoutingPolicy(request);
  const compiledRouteRequest = buildCompiledRouteRuntimeRequestSnapshot({
    headers: request.headers as Record<string, unknown>,
    method: request.method,
    path: request.url || '/v1/models',
    query: (request.query || {}) as Record<string, unknown>,
  });
  for (const modelName of adapter.modelListModelProbes || []) {
    const decision = await previewRouteRuntimeDecision({
      requestedModel: modelName,
      request: {
        ...compiledRouteRequest,
        requestedModel: modelName,
      },
      downstreamPolicy: policy,
      retryCount,
      forcedExecutionAttemptId,
      disabledExecutionTargetIds: excludeTargetIds,
    });
    if (decision?.kind === 'execution_attempt') return decision.attempt;
  }
  return null;
}

export async function handleModelListSurfaceRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  adapter: DownstreamProtocolAdapter,
) {
  const forcedExecutionAttemptId = getTesterForcedExecutionAttemptId({
    headers: request.headers as Record<string, unknown>,
    clientIp: request.ip,
  });
  const policy = await getDownstreamRoutingPolicy(request);
  const allowedPlanIds = Array.isArray(policy.allowedPlanIds)
    ? policy.allowedPlanIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (allowedPlanIds.length > 0) {
    const models = await readRouteAwareModels(policy);
    return reply.code(200).send(adapter.formatModelList ? adapter.formatModelList(models) : { models });
  }
  const excludeTargetIds: number[] = [];
  let retryCount = 0;
  let lastStatus = 503;
  let lastText = forcedExecutionAttemptId
    ? buildForcedExecutionAttemptUnavailableMessage(forcedExecutionAttemptId)
    : 'No available execution attempt for model list';
  let lastContentType = 'application/json';

  while (retryCount <= 3) {
    const selected = await selectModelListTarget(request, adapter, forcedExecutionAttemptId, excludeTargetIds, retryCount);
    if (!selected) {
      const models = await readRouteAwareModels(await getDownstreamRoutingPolicy(request));
      if (models.length > 0) {
        return reply.code(200).send(adapter.formatModelList ? adapter.formatModelList(models) : { models });
      }
      return reply.code(lastStatus).type(lastContentType).send(lastText);
    }
    excludeTargetIds.push(selected.target.id);

    try {
      const staticModels = adapter.getStaticModelList?.({ sitePlatform: selected.site.platform });
      if (staticModels) {
        const payload = adapter.formatModelList
          ? adapter.formatModelList(staticModels)
          : { models: staticModels };
        return reply.code(200).send(await filterListedModelsForPolicy(payload, request));
      }

      if (adapter.shouldUseLocalModelList?.({ sitePlatform: selected.site.platform })) {
        const models = await readRouteAwareModels(policy);
        return reply.code(200).send(adapter.formatModelList ? adapter.formatModelList(models) : { models });
      }

      const built = adapter.buildModelListRequest?.({
        siteUrl: selected.site.url,
        tokenValue: selected.tokenValue,
        params: request.params as Record<string, unknown>,
      });
      if (!built) {
        return reply.code(501).send({
          error: { message: 'Model list is not supported for this protocol', type: 'invalid_request_error' },
        });
      }
      const upstream = await fetch(built.url, { method: 'GET' });
      const text = await readRuntimeResponseText(upstream);
      if (!upstream.ok) {
        lastStatus = upstream.status;
        lastText = text;
        lastContentType = upstream.headers.get('content-type') || 'application/json';
        if (canRetryExecutionAttemptSelection(retryCount, forcedExecutionAttemptId)) {
          retryCount += 1;
          continue;
        }
        return reply.code(lastStatus).type(lastContentType).send(lastText);
      }
      try {
        return reply.code(upstream.status).send(await filterListedModelsForPolicy(JSON.parse(text), request));
      } catch {
        return reply.code(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(text);
      }
    } catch (error) {
      lastStatus = 502;
      lastText = JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : 'Model list upstream request failed',
          type: 'upstream_error',
        },
      });
      if (canRetryExecutionAttemptSelection(retryCount, forcedExecutionAttemptId)) {
        retryCount += 1;
        continue;
      }
      return reply.code(lastStatus).type('application/json').send(lastText);
    }
  }

  return reply.code(lastStatus).type(lastContentType).send(lastText);
}
