import { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
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
import {
  importPricingReferenceCatalog,
  loadPricingReferenceCatalog,
  reloadPricingReferenceCatalogScheduler,
  savePricingReferenceCatalog,
  syncPricingReferenceCatalogFromConfiguredUrl,
} from '../../services/pricingReferenceCatalogService.js';
import {
  calculateRoutingFallbackUnitCostFromPlatformPricingConfig,
  loadPlatformPricingConfig,
  savePlatformPricingConfig,
} from '../../services/platformPricingConfigService.js';
import { clearEndpointPricingReferenceCache } from '../../services/endpointPricingService.js';
import {
  createWalletAcquisitionProfile,
  deleteWalletAcquisitionProfile,
  getWalletAcquisitionProfile,
  listWalletAcquisitionProfiles,
  updateWalletAcquisitionProfile,
  type WalletAcquisitionProfilePayload,
} from '../../services/walletAcquisitionService.js';
import {
  createFxRateSnapshot,
  deleteFxRateSnapshot,
  getFxRateSnapshot,
  listFxRateSnapshots,
  updateFxRateSnapshot,
  type FxRateSnapshotPayload,
} from '../../services/fxRateService.js';
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

type WalletQuery = {
  siteId?: string;
  accountId?: string;
  tokenId?: string;
  enabled?: string;
};

type WalletBody = Partial<WalletAcquisitionProfilePayload>;

type FxQuery = {
  fromCurrency?: string;
  toCurrency?: string;
};

type FxBody = Partial<FxRateSnapshotPayload>;

export async function upstreamCostPricingRoutes(app: FastifyInstance) {
  app.get('/api/pricing/reference-config', async () => {
    return await loadPricingReferenceConfig();
  });

  app.put<{ Body: Record<string, unknown> }>('/api/pricing/reference-config', async (request, reply) => {
    try {
      const saved = await savePricingReferenceConfig(request.body);
      await reloadPricingReferenceCatalogScheduler();
      clearEndpointPricingReferenceCache();
      return saved;
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.get('/api/pricing/reference-catalog', async () => {
    return await loadPricingReferenceCatalog();
  });

  app.put<{ Body: Record<string, unknown> }>('/api/pricing/reference-catalog', async (request, reply) => {
    try {
      const saved = await savePricingReferenceCatalog(request.body);
      clearEndpointPricingReferenceCache();
      return saved;
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.post<{ Body: { data?: unknown; replace?: unknown } }>('/api/pricing/reference-catalog/import', async (request, reply) => {
    try {
      const result = await importPricingReferenceCatalog(request.body?.data, {
        sourceType: 'imported',
        replace: request.body?.replace === true,
      });
      clearEndpointPricingReferenceCache();
      return result;
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.post('/api/pricing/reference-catalog/sync', async (_request, reply) => {
    try {
      const result = await syncPricingReferenceCatalogFromConfiguredUrl();
      clearEndpointPricingReferenceCache();
      return result ?? { skipped: true };
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.get('/api/pricing/platform-config', async () => {
    return await loadPlatformPricingConfig();
  });

  app.put<{ Body: Record<string, unknown> }>('/api/pricing/platform-config', async (request, reply) => {
    try {
      const saved = await savePlatformPricingConfig(request.body);
      config.routingFallbackUnitCost = calculateRoutingFallbackUnitCostFromPlatformPricingConfig(saved);
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

  app.get<{ Querystring: WalletQuery }>('/api/pricing/wallet-acquisition', async (request) => {
    return await listWalletAcquisitionProfiles({
      siteId: parseOptionalPositiveInt(request.query.siteId),
      accountId: parseOptionalPositiveInt(request.query.accountId),
      tokenId: parseOptionalPositiveInt(request.query.tokenId),
      enabled: parseOptionalBoolean(request.query.enabled),
    });
  });

  app.get<{ Params: { id: string } }>('/api/pricing/wallet-acquisition/:id', async (request, reply) => {
    const id = parseRequiredPositiveInt(request.params.id, 'id');
    const profile = await getWalletAcquisitionProfile(id);
    if (!profile) return reply.code(404).send({ error: 'Wallet acquisition profile not found' });
    return profile;
  });

  app.post<{ Body: WalletBody }>('/api/pricing/wallet-acquisition', async (request, reply) => {
    try {
      const created = await createWalletAcquisitionProfile(normalizeWalletBody(request.body));
      clearEndpointPricingReferenceCache();
      return reply.code(201).send(created);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.patch<{ Params: { id: string }; Body: WalletBody }>('/api/pricing/wallet-acquisition/:id', async (request, reply) => {
    try {
      const id = parseRequiredPositiveInt(request.params.id, 'id');
      const updated = await updateWalletAcquisitionProfile(id, normalizeWalletPatchBody(request.body));
      if (!updated) return reply.code(404).send({ error: 'Wallet acquisition profile not found' });
      clearEndpointPricingReferenceCache();
      return updated;
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/pricing/wallet-acquisition/:id', async (request, reply) => {
    const id = parseRequiredPositiveInt(request.params.id, 'id');
    const deleted = await deleteWalletAcquisitionProfile(id);
    if (!deleted) return reply.code(404).send({ error: 'Wallet acquisition profile not found' });
    clearEndpointPricingReferenceCache();
    return { success: true };
  });

  app.get<{ Querystring: FxQuery }>('/api/pricing/fx-rates', async (request) => {
    return await listFxRateSnapshots({
      fromCurrency: normalizeOptionalString(request.query.fromCurrency),
      toCurrency: normalizeOptionalString(request.query.toCurrency),
    });
  });

  app.get<{ Params: { id: string } }>('/api/pricing/fx-rates/:id', async (request, reply) => {
    const id = parseRequiredPositiveInt(request.params.id, 'id');
    const snapshot = await getFxRateSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: 'Unit conversion snapshot not found' });
    return snapshot;
  });

  app.post<{ Body: FxBody }>('/api/pricing/fx-rates', async (request, reply) => {
    try {
      const created = await createFxRateSnapshot(normalizeFxBody(request.body));
      clearEndpointPricingReferenceCache();
      return reply.code(201).send(created);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.patch<{ Params: { id: string }; Body: FxBody }>('/api/pricing/fx-rates/:id', async (request, reply) => {
    try {
      const id = parseRequiredPositiveInt(request.params.id, 'id');
      const updated = await updateFxRateSnapshot(id, normalizeFxPatchBody(request.body));
      if (!updated) return reply.code(404).send({ error: 'Unit conversion snapshot not found' });
      clearEndpointPricingReferenceCache();
      return updated;
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/pricing/fx-rates/:id', async (request, reply) => {
    const id = parseRequiredPositiveInt(request.params.id, 'id');
    const deleted = await deleteFxRateSnapshot(id);
    if (!deleted) return reply.code(404).send({ error: 'Unit conversion snapshot not found' });
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

function normalizeWalletBody(body: WalletBody): WalletAcquisitionProfilePayload {
  return {
    scope: body.scope as WalletAcquisitionProfilePayload['scope'],
    siteId: parseRequiredPositiveInt(body.siteId, 'siteId'),
    accountId: parseOptionalPositiveInt(body.accountId) ?? null,
    tokenId: parseOptionalPositiveInt(body.tokenId) ?? null,
    inheritance: body.inheritance,
    walletUnit: normalizeOptionalString(body.walletUnit) ?? undefined,
    faceValuePrice: parseNullableNumber(body.faceValuePrice),
    rechargeDiscount: parseNullableNumber(body.rechargeDiscount),
    dailyEarnedBalance: parseNullableNumber(body.dailyEarnedBalance),
    dailyEarnedBalanceSource: body.dailyEarnedBalanceSource,
    observedWindowDays: parseNullablePositiveInt(body.observedWindowDays),
    confidence: body.confidence,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    notes: normalizeOptionalString(body.notes),
  };
}

function normalizeWalletPatchBody(body: WalletBody): Partial<WalletAcquisitionProfilePayload> {
  const result: Partial<WalletAcquisitionProfilePayload> = {};
  if (body.scope !== undefined) result.scope = body.scope as WalletAcquisitionProfilePayload['scope'];
  if (body.siteId !== undefined) result.siteId = parseRequiredPositiveInt(body.siteId, 'siteId');
  if (body.accountId !== undefined) result.accountId = parseOptionalPositiveInt(body.accountId) ?? null;
  if (body.tokenId !== undefined) result.tokenId = parseOptionalPositiveInt(body.tokenId) ?? null;
  if (body.inheritance !== undefined) result.inheritance = body.inheritance;
  if (body.walletUnit !== undefined) result.walletUnit = normalizeOptionalString(body.walletUnit);
  if (body.faceValuePrice !== undefined) result.faceValuePrice = parseNullableNumber(body.faceValuePrice);
  if (body.rechargeDiscount !== undefined) result.rechargeDiscount = parseNullableNumber(body.rechargeDiscount);
  if (body.dailyEarnedBalance !== undefined) result.dailyEarnedBalance = parseNullableNumber(body.dailyEarnedBalance);
  if (body.dailyEarnedBalanceSource !== undefined) result.dailyEarnedBalanceSource = body.dailyEarnedBalanceSource;
  if (body.observedWindowDays !== undefined) result.observedWindowDays = parseNullablePositiveInt(body.observedWindowDays);
  if (body.confidence !== undefined) result.confidence = body.confidence;
  if (body.enabled !== undefined) result.enabled = !!body.enabled;
  if (body.notes !== undefined) result.notes = normalizeOptionalString(body.notes);
  return result;
}

function normalizeFxBody(body: FxBody): FxRateSnapshotPayload {
  return {
    fromCurrency: normalizeRequiredString(body.fromCurrency, 'fromCurrency'),
    toCurrency: normalizeRequiredString(body.toCurrency, 'toCurrency'),
    rate: parseRequiredPositiveNumber(body.rate, 'rate'),
    source: body.source,
    capturedAt: normalizeOptionalString(body.capturedAt),
    notes: normalizeOptionalString(body.notes),
  };
}

function normalizeFxPatchBody(body: FxBody): Partial<FxRateSnapshotPayload> {
  const result: Partial<FxRateSnapshotPayload> = {};
  if (body.fromCurrency !== undefined) result.fromCurrency = normalizeRequiredString(body.fromCurrency, 'fromCurrency');
  if (body.toCurrency !== undefined) result.toCurrency = normalizeRequiredString(body.toCurrency, 'toCurrency');
  if (body.rate !== undefined) result.rate = parseRequiredPositiveNumber(body.rate, 'rate');
  if (body.source !== undefined) result.source = body.source;
  if (body.capturedAt !== undefined) result.capturedAt = normalizeOptionalString(body.capturedAt);
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

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseRequiredPositiveNumber(value: unknown, label: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${label} must be a positive number.`);
  return numeric;
}

function parseNullablePositiveInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  return parseRequiredPositiveInt(value, 'value');
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
