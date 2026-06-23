import { FastifyInstance } from 'fastify';
import {
  createSimpleTokenPricingPlan,
  createUpstreamCostPricing,
  deleteUpstreamCostPricing,
  evaluateUpstreamCostPricing,
  getUpstreamCostPricing,
  listUpstreamCostPricings,
  resolveUpstreamCostPricing,
  updateUpstreamCostPricing,
  type UpstreamCostPricingPayload,
} from '../../services/upstreamCostPricingService.js';
import {
  loadPricingReferenceConfig,
  savePricingReferenceConfig,
} from '../../services/pricingReferenceConfigService.js';
import { clearEndpointPricingReferenceCache } from '../../services/endpointPricingService.js';
import type { PricingPlan } from '../../pricing-core/index.js';

type Query = {
  siteId?: string;
  accountId?: string;
  tokenId?: string;
  modelName?: string;
  enabled?: string;
};

type Body = Partial<UpstreamCostPricingPayload> & {
  simpleTokenPricing?: {
    inputPerMillion?: unknown;
    outputPerMillion?: unknown;
    cacheReadPerMillion?: unknown;
    cacheWritePerMillion?: unknown;
    reasoningPerMillion?: unknown;
    requestUsd?: unknown;
  };
};

type ResolveQuery = {
  siteId?: string;
  accountId?: string;
  tokenId?: string;
  tokenGroup?: string;
  modelName?: string;
};

export async function upstreamCostPricingRoutes(app: FastifyInstance) {
  app.get('/api/pricing/reference-config', async () => {
    return await loadPricingReferenceConfig();
  });

  app.put<{ Body: Record<string, unknown> }>('/api/pricing/reference-config', async (request, reply) => {
    try {
      const saved = await savePricingReferenceConfig(request.body);
      clearEndpointPricingReferenceCache();
      return saved;
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.get<{ Querystring: Query }>('/api/pricing/upstream-cost', async (request) => {
    return await listUpstreamCostPricings({
      siteId: parseOptionalPositiveInt(request.query.siteId),
      accountId: parseOptionalPositiveInt(request.query.accountId),
      tokenId: parseOptionalPositiveInt(request.query.tokenId),
      modelName: normalizeOptionalString(request.query.modelName) ?? undefined,
      enabled: parseOptionalBoolean(request.query.enabled),
    });
  });

  app.get<{ Querystring: ResolveQuery }>('/api/pricing/upstream-cost/resolve', async (request, reply) => {
    try {
      const resolved = await resolveUpstreamCostPricing({
        siteId: parseRequiredPositiveInt(request.query.siteId, 'siteId'),
        accountId: parseOptionalPositiveInt(request.query.accountId),
        tokenId: parseOptionalPositiveInt(request.query.tokenId),
        tokenGroup: normalizeOptionalString(request.query.tokenGroup),
        modelName: normalizeRequiredString(request.query.modelName, 'modelName'),
      });
      return resolved ?? { pricing: null };
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.post<{
    Body: ResolveQuery & {
      usage?: Record<string, unknown>;
      context?: Record<string, unknown>;
    };
  }>('/api/pricing/upstream-cost/preview', async (request, reply) => {
    try {
      const evaluated = await evaluateUpstreamCostPricing({
        siteId: parseRequiredPositiveInt(request.body.siteId, 'siteId'),
        accountId: parseOptionalPositiveInt(request.body.accountId),
        tokenId: parseOptionalPositiveInt(request.body.tokenId),
        tokenGroup: normalizeOptionalString(request.body.tokenGroup),
        modelName: normalizeRequiredString(request.body.modelName, 'modelName'),
        usage: request.body.usage || {},
        context: normalizeContext(request.body.context),
      });
      return evaluated ?? { pricing: null, evaluation: null };
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.get<{ Params: { id: string } }>('/api/pricing/upstream-cost/:id', async (request, reply) => {
    const id = parseRequiredPositiveInt(request.params.id, 'id');
    const pricing = await getUpstreamCostPricing(id);
    if (!pricing) return reply.code(404).send({ error: 'Upstream cost pricing not found' });
    return pricing;
  });

  app.post<{ Body: Body }>('/api/pricing/upstream-cost', async (request, reply) => {
    try {
      const created = await createUpstreamCostPricing(normalizeBody(request.body));
      clearEndpointPricingReferenceCache();
      return reply.code(201).send(created);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/pricing/upstream-cost/:id', async (request, reply) => {
    try {
      const id = parseRequiredPositiveInt(request.params.id, 'id');
      const updated = await updateUpstreamCostPricing(id, normalizePatchBody(request.body));
      if (!updated) return reply.code(404).send({ error: 'Upstream cost pricing not found' });
      clearEndpointPricingReferenceCache();
      return updated;
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/pricing/upstream-cost/:id', async (request, reply) => {
    const id = parseRequiredPositiveInt(request.params.id, 'id');
    const deleted = await deleteUpstreamCostPricing(id);
    if (!deleted) return reply.code(404).send({ error: 'Upstream cost pricing not found' });
    clearEndpointPricingReferenceCache();
    return { success: true };
  });
}

function normalizeBody(body: Body): UpstreamCostPricingPayload {
  return {
    scope: body.scope as UpstreamCostPricingPayload['scope'],
    siteId: parseRequiredPositiveInt(body.siteId, 'siteId'),
    accountId: parseOptionalPositiveInt(body.accountId),
    tokenId: parseOptionalPositiveInt(body.tokenId),
    tokenGroup: normalizeOptionalString(body.tokenGroup),
    modelName: normalizeRequiredString(body.modelName, 'modelName'),
    displayName: normalizeOptionalString(body.displayName),
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    plan: resolvePlan(body),
    sourceType: body.sourceType,
    metadata: normalizeObject(body.metadata),
    notes: normalizeOptionalString(body.notes),
  };
}

function normalizePatchBody(body: Body): Partial<UpstreamCostPricingPayload> {
  const result: Partial<UpstreamCostPricingPayload> = {};
  if (body.scope !== undefined) result.scope = body.scope as UpstreamCostPricingPayload['scope'];
  if (body.siteId !== undefined) result.siteId = parseRequiredPositiveInt(body.siteId, 'siteId');
  if (body.accountId !== undefined) result.accountId = parseOptionalPositiveInt(body.accountId);
  if (body.tokenId !== undefined) result.tokenId = parseOptionalPositiveInt(body.tokenId);
  if (body.tokenGroup !== undefined) result.tokenGroup = normalizeOptionalString(body.tokenGroup);
  if (body.modelName !== undefined) result.modelName = normalizeRequiredString(body.modelName, 'modelName');
  if (body.displayName !== undefined) result.displayName = normalizeOptionalString(body.displayName);
  if (body.enabled !== undefined) result.enabled = !!body.enabled;
  if (body.plan !== undefined || body.simpleTokenPricing !== undefined) result.plan = resolvePlan(body);
  if (body.sourceType !== undefined) result.sourceType = body.sourceType;
  if (body.metadata !== undefined) result.metadata = normalizeObject(body.metadata);
  if (body.notes !== undefined) result.notes = normalizeOptionalString(body.notes);
  return result;
}

function resolvePlan(body: Body): PricingPlan {
  if (body.plan) return body.plan as PricingPlan;
  if (!body.simpleTokenPricing) throw new Error('plan or simpleTokenPricing is required.');
  return createSimpleTokenPricingPlan({
    inputPerMillion: parseOptionalNumber(body.simpleTokenPricing.inputPerMillion),
    outputPerMillion: parseOptionalNumber(body.simpleTokenPricing.outputPerMillion),
    cacheReadPerMillion: parseOptionalNumber(body.simpleTokenPricing.cacheReadPerMillion),
    cacheWritePerMillion: parseOptionalNumber(body.simpleTokenPricing.cacheWritePerMillion),
    reasoningPerMillion: parseOptionalNumber(body.simpleTokenPricing.reasoningPerMillion),
    requestUsd: parseOptionalNumber(body.simpleTokenPricing.requestUsd),
  });
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return parseRequiredPositiveInt(value, 'value');
}

function parseRequiredPositiveInt(value: unknown, label: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${label} must be a positive integer.`);
  return Math.trunc(numeric);
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeRequiredString(value: unknown, label: string): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeContext(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Invalid upstream cost pricing request.';
}
