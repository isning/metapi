import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { fetch } from 'undici';
import { db, schema } from '../../db/index.js';
import { isModelAllowedByPolicyOrAllowedRoutes } from '../../services/downstreamApiKeyService.js';
import { ensureActiveRouteGraphVersion } from '../../services/routeGraphService.js';
import { tokenRouter } from '../../services/tokenRouter.js';
import * as routeRefreshWorkflow from '../../services/routeRefreshWorkflow.js';
import { readRuntimeResponseText } from '../executors/types.js';
import type { DownstreamProtocolAdapter } from '../formats/types.js';
import { getDownstreamRoutingPolicy } from '../downstreamPolicy.js';
import { getTesterForcedTargetId, canRetryTargetSelection, buildForcedTargetUnavailableMessage } from '../targetSelection.js';

type ListedModel = { name: string; displayName: string };

function extractListedModelName(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const rawName = typeof (item as { name?: unknown }).name === 'string'
    ? (item as { name: string }).name.trim()
    : '';
  if (!rawName) return '';
  return rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName;
}

function hasDownstreamModelRestrictions(policy: { supportedModels?: unknown; allowedRouteIds?: unknown; denyAllWhenEmpty?: unknown }): boolean {
  const supportedModels = Array.isArray(policy.supportedModels) ? policy.supportedModels : [];
  const allowedRouteIds = Array.isArray(policy.allowedRouteIds) ? policy.allowedRouteIds : [];
  return supportedModels.length > 0 || allowedRouteIds.length > 0 || policy.denyAllWhenEmpty === true;
}

async function filterListedModelsForPolicy(
  payload: unknown,
  request: FastifyRequest,
): Promise<unknown> {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { models?: unknown[] }).models)) {
    return payload;
  }

  const policy = getDownstreamRoutingPolicy(request);
  if (!hasDownstreamModelRestrictions(policy)) {
    return payload;
  }

  const filteredModels: unknown[] = [];
  for (const item of (payload as { models: unknown[] }).models) {
    const modelName = extractListedModelName(item);
    if (!modelName) continue;
    if (!await isModelAllowedByPolicyOrAllowedRoutes(modelName, policy)) continue;
    const decision = await tokenRouter.explainSelection?.(modelName, [], policy);
    if (decision && typeof decision.selectedTargetId !== 'number') continue;
    filteredModels.push(item);
  }

  return {
    ...(payload as Record<string, unknown>),
    models: filteredModels,
  };
}

async function readRouteAwareModels(request: FastifyRequest): Promise<ListedModel[]> {
  const policy = getDownstreamRoutingPolicy(request);
  const rows = await db.select({ modelName: schema.modelAvailability.modelName })
    .from(schema.modelAvailability)
    .innerJoin(schema.accounts, eq(schema.modelAvailability.accountId, schema.accounts.id))
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .where(and(
      eq(schema.modelAvailability.available, true),
      eq(schema.accounts.status, 'active'),
      eq(schema.sites.status, 'active'),
    ))
    .all();
  const activeGraph = await ensureActiveRouteGraphVersion();
  const publicGraphModels = (activeGraph.compiledGraph.publicModels || [])
    .map((item) => String(item.model || '').trim())
    .filter(Boolean);
  const routableModels = typeof tokenRouter.getAvailableModels === 'function'
    ? await tokenRouter.getAvailableModels()
    : [];
  const deduped = Array.from(new Set([
    ...rows.map((row) => String(row.modelName || '').trim()).filter(Boolean),
    ...publicGraphModels,
    ...routableModels,
  ])).sort();

  const allowed: ListedModel[] = [];
  for (const modelName of deduped) {
    if (!await isModelAllowedByPolicyOrAllowedRoutes(modelName, policy)) continue;
    const decision = await tokenRouter.explainSelection?.(modelName, [], policy);
    if (decision && typeof decision.selectedTargetId !== 'number') continue;
    allowed.push({
      name: `models/${modelName}`,
      displayName: modelName,
    });
  }
  return allowed;
}

async function selectModelListTarget(
  request: FastifyRequest,
  adapter: DownstreamProtocolAdapter,
  forcedTargetId: number | null,
  excludeTargetIds: number[],
  retryCount: number,
) {
  const policy = getDownstreamRoutingPolicy(request);
  for (const modelName of adapter.modelListModelProbes || []) {
    const selected = forcedTargetId !== null
      ? await tokenRouter.selectPreferredTarget(modelName, forcedTargetId, policy, excludeTargetIds)
      : retryCount === 0
        ? await tokenRouter.selectTarget(modelName, policy)
        : await tokenRouter.selectNextTarget(modelName, excludeTargetIds, policy);
    if (selected) return selected;
  }
  return null;
}

export async function handleModelListSurfaceRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  adapter: DownstreamProtocolAdapter,
) {
  const forcedTargetId = getTesterForcedTargetId({
    headers: request.headers as Record<string, unknown>,
    clientIp: request.ip,
  });
  const excludeTargetIds: number[] = [];
  let retryCount = 0;
  let lastStatus = 503;
  let lastText = forcedTargetId
    ? buildForcedTargetUnavailableMessage(forcedTargetId)
    : 'No available targets for model list';
  let lastContentType = 'application/json';

  while (retryCount <= 3) {
    const selected = await selectModelListTarget(request, adapter, forcedTargetId, excludeTargetIds, retryCount);
    if (!selected) {
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
        let models = await readRouteAwareModels(request);
        if (models.length <= 0) {
          await routeRefreshWorkflow.refreshModelsAndRebuildRoutes();
          models = await readRouteAwareModels(request);
        }
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
        await tokenRouter.recordFailure?.(selected.target.id, {
          status: upstream.status,
          errorText: text,
        });
        if (canRetryTargetSelection(retryCount, forcedTargetId)) {
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
      await tokenRouter.recordFailure?.(selected.target.id, {
        errorText: error instanceof Error ? error.message : 'Model list upstream request failed',
      });
      lastStatus = 502;
      lastText = JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : 'Model list upstream request failed',
          type: 'upstream_error',
        },
      });
      if (canRetryTargetSelection(retryCount, forcedTargetId)) {
        retryCount += 1;
        continue;
      }
      return reply.code(lastStatus).type('application/json').send(lastText);
    }
  }

  return reply.code(lastStatus).type(lastContentType).send(lastText);
}
