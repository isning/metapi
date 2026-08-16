import type {
  ModelsMarketplaceAccount,
  ModelsMarketplaceMeasuredPricing,
  ModelsMarketplaceMeta,
  ModelsMarketplaceModel,
  ModelsMarketplacePricingSource,
  ModelsMarketplaceRuntimeIssue,
} from '../../shared/modelsMarketplace.js';
import { ACCOUNT_TOKEN_VALUE_STATUS_READY } from './accountTokenService.js';
import { getRunningTaskByDedupeKey } from './backgroundTaskService.js';
import { listActiveCompiledRuntimeModelInventory } from './compiledRuntimeInventoryService.js';
import { getLocalRangeStartUtc, getRecentMinuteRangeStartUtc } from './localTimeService.js';
import {
  clearModelsMarketplaceCache,
  readModelsMarketplaceCache,
  resetModelsMarketplaceCacheForTests,
  writeModelsMarketplaceCache,
} from './modelsMarketplaceCacheService.js';
import {
  buildModelsMarketplacePage,
  type ModelsMarketplaceQuery,
} from './modelsMarketplaceProjectionService.js';
import { listModelsMarketplaceRuntimeFacts } from './modelsMarketplaceRuntimeFactsService.js';
import { comparePricingSummaries } from './pricingComparisonService.js';
import {
  quoteEndpointPricing,
  quoteReferencePricing,
  type PricingResolution,
} from './pricingQuoteService.js';
import { listCachedProviderPricingCatalogs } from './providerPricingCatalogCacheService.js';
import { parseProxyLogBillingDetails } from './proxyLogStore.js';
import { queueRefreshModelsAndRebuildRoutesTask } from './routeRefreshWorkflow.js';
import type { UpstreamPricingCatalog } from './upstreamPricingCatalog.js';

type MeasuredPricingAggregate = {
  inputWeightedTotal: number;
  inputWeight: number;
  outputWeightedTotal: number;
  outputWeight: number;
  sampleCount: number;
  lastMeasuredAt: string | null;
};

type ModelMetadataAggregate = {
  description: string | null;
  tags: Set<string>;
  supportedEndpointTypes: Set<string>;
};

type AccountAggregate = {
  id: number;
  site: string;
  username: string | null;
  latency: number | null;
  balance: number | null;
  tokens: Map<number, { id: number; name: string; isDefault: boolean }>;
  credentialKeys: Set<string>;
  endpointIds: Set<string>;
  executionAttemptIds: Set<string>;
};

type SiteTopologyAggregate = {
  endpointIds: Set<string>;
  executionAttemptIds: Set<string>;
  credentialKeys: Set<string>;
};

type ModelAggregate = {
  name: string;
  runtimeInventoryIssues: ModelsMarketplaceRuntimeIssue[];
  accountsById: Map<number, AccountAggregate>;
  endpointIds: Set<string>;
  executionAttemptIds: Set<string>;
  siteTopology: Map<string, SiteTopologyAggregate>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readRecordNumber(
  record: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  if (!record) return null;
  const value = record[key];
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundPricingValue(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function ensureModel(
  models: Map<string, ModelAggregate>,
  modelNameInput: unknown,
): ModelAggregate | null {
  const modelName = text(modelNameInput);
  if (!modelName) return null;
  const key = modelName.toLowerCase();
  const existing = models.get(key);
  if (existing) return existing;
  const created: ModelAggregate = {
    name: modelName,
    runtimeInventoryIssues: [],
    accountsById: new Map(),
    endpointIds: new Set(),
    executionAttemptIds: new Set(),
    siteTopology: new Map(),
  };
  models.set(key, created);
  return created;
}

function credentialKey(attempt: Awaited<ReturnType<typeof listActiveCompiledRuntimeModelInventory>>[number]['executionAttempts'][number]): string {
  const bindingId = Number(attempt.executionTarget.credentialBindingId);
  if (Number.isSafeInteger(bindingId) && bindingId > 0) return `binding:${bindingId}`;
  if (attempt.token) return `token:${attempt.token.id}`;
  return `account:${attempt.account.id}:profile:${attempt.executionTarget.endpointProfileId ?? '-'}`;
}

function ensureAccount(model: ModelAggregate, attempt: Awaited<ReturnType<typeof listActiveCompiledRuntimeModelInventory>>[number]['executionAttempts'][number]): AccountAggregate {
  const existing = model.accountsById.get(attempt.account.id);
  if (existing) {
    if (existing.latency == null) existing.latency = attempt.latencyMs;
    else if (attempt.latencyMs != null) existing.latency = Math.min(existing.latency, attempt.latencyMs);
    return existing;
  }
  const created: AccountAggregate = {
    id: attempt.account.id,
    site: attempt.site.name,
    username: attempt.account.username,
    latency: attempt.latencyMs,
    balance: attempt.account.balance,
    tokens: new Map(),
    credentialKeys: new Set(),
    endpointIds: new Set(),
    executionAttemptIds: new Set(),
  };
  model.accountsById.set(created.id, created);
  return created;
}

function ensureSiteTopology(model: ModelAggregate, siteName: string): SiteTopologyAggregate {
  const existing = model.siteTopology.get(siteName);
  if (existing) return existing;
  const created: SiteTopologyAggregate = {
    endpointIds: new Set(),
    executionAttemptIds: new Set(),
    credentialKeys: new Set(),
  };
  model.siteTopology.set(siteName, created);
  return created;
}

function mergeCatalogMetadata(input: {
  metadataByModel: Map<string, ModelMetadataAggregate>;
  publicModelName: string;
  upstreamModelName: string;
  catalog: UpstreamPricingCatalog;
}): void {
  const metadata = input.catalog.models.get(input.upstreamModelName)
    || Array.from(input.catalog.models.values()).find((model) => (
      model.modelName.toLowerCase() === input.upstreamModelName.toLowerCase()
    ));
  if (!metadata) return;
  const key = input.publicModelName.toLowerCase();
  const aggregate = input.metadataByModel.get(key) || {
    description: null,
    tags: new Set<string>(),
    supportedEndpointTypes: new Set<string>(),
  };
  if (!aggregate.description && metadata.modelDescription) aggregate.description = metadata.modelDescription;
  for (const tag of metadata.tags || []) aggregate.tags.add(tag);
  for (const endpointType of metadata.supportedEndpointTypes || []) {
    aggregate.supportedEndpointTypes.add(endpointType);
  }
  input.metadataByModel.set(key, aggregate);
}

function aggregateMeasuredPricing(
  aggregates: Map<string, MeasuredPricingAggregate>,
  modelName: string,
  fact: Awaited<ReturnType<typeof listModelsMarketplaceRuntimeFacts>>['recentPricingLogs'][number],
): void {
  if (fact.status !== 'success' || !modelName) return;
  const billingDetails = parseProxyLogBillingDetails(fact.billingDetails);
  const breakdown = isRecord(billingDetails?.breakdown) ? billingDetails.breakdown : null;
  if (!breakdown) return;
  const inputPrice = readRecordNumber(breakdown, 'inputPerMillion');
  const outputPrice = readRecordNumber(breakdown, 'outputPerMillion');
  if (inputPrice == null && outputPrice == null) return;
  const usage = isRecord(billingDetails?.usage) ? billingDetails.usage : null;
  const inputWeight = Math.max(
    1,
    readRecordNumber(usage, 'billablePromptTokens')
      ?? readRecordNumber(usage, 'promptTokens')
      ?? 0,
  );
  const outputWeight = Math.max(1, readRecordNumber(usage, 'completionTokens') ?? 0);
  const aggregate = aggregates.get(modelName) || {
    inputWeightedTotal: 0,
    inputWeight: 0,
    outputWeightedTotal: 0,
    outputWeight: 0,
    sampleCount: 0,
    lastMeasuredAt: null,
  };
  aggregate.sampleCount += 1;
  if (inputPrice != null) {
    aggregate.inputWeightedTotal += inputPrice * inputWeight;
    aggregate.inputWeight += inputWeight;
  }
  if (outputPrice != null) {
    aggregate.outputWeightedTotal += outputPrice * outputWeight;
    aggregate.outputWeight += outputWeight;
  }
  if (fact.createdAt && (!aggregate.lastMeasuredAt || fact.createdAt > aggregate.lastMeasuredAt)) {
    aggregate.lastMeasuredAt = fact.createdAt;
  }
  aggregates.set(modelName, aggregate);
}

async function buildMeasuredPricing(
  aggregates: Map<string, MeasuredPricingAggregate>,
): Promise<Map<string, ModelsMarketplaceMeasuredPricing>> {
  const result = new Map<string, ModelsMarketplaceMeasuredPricing>();
  await Promise.all(Array.from(aggregates.entries()).map(async ([modelName, aggregate]) => {
    const inputPerMillion = aggregate.inputWeight > 0
      ? roundPricingValue(aggregate.inputWeightedTotal / aggregate.inputWeight)
      : null;
    const outputPerMillion = aggregate.outputWeight > 0
      ? roundPricingValue(aggregate.outputWeightedTotal / aggregate.outputWeight)
      : null;
    const totalCost = inputPerMillion != null && outputPerMillion != null
      ? roundPricingValue(inputPerMillion + outputPerMillion)
      : null;
    const referenceQuote = await quoteReferencePricing({
      subject: { modelName },
      usageProfile: 'preview_1m_io',
    });
    const comparison = comparePricingSummaries(
      { inputPerMillion, outputPerMillion, totalCost },
      referenceQuote.reference?.summary ?? null,
    );
    result.set(modelName, {
      currency: null,
      inputPerMillion,
      outputPerMillion,
      totalCost,
      inputMultiplier: comparison.inputMultiplier,
      outputMultiplier: comparison.outputMultiplier,
      totalMultiplier: comparison.totalMultiplier,
      sampleCount: aggregate.sampleCount,
      lastMeasuredAt: aggregate.lastMeasuredAt,
    });
  }));
  return result;
}

function upsertPricingSource(input: {
  sourceMap: Map<string, { modelKey: string; source: ModelsMarketplacePricingSource }>;
  modelName: string;
  siteId: number;
  siteName: string;
  accountId: number;
  username: string | null;
  tokenGroup: string | null;
  resolution: PricingResolution;
}): void {
  const modelKey = input.modelName.toLowerCase();
  const group = text(input.tokenGroup) || 'default';
  const key = `${modelKey}:${input.siteId}:${input.accountId}`;
  const source = input.sourceMap.get(key)?.source || {
    siteId: input.siteId,
    siteName: input.siteName,
    accountId: input.accountId,
    username: input.username,
    ownerBy: null,
    enableGroups: [],
    groupPricing: {},
  };
  if (!source.enableGroups.includes(group)) source.enableGroups.push(group);
  const summary = input.resolution.summary;
  source.groupPricing[group] = {
    quotaType: summary.requestCost != null
      && summary.inputPerMillion == null
      && summary.outputPerMillion == null ? 1 : 0,
    ...(summary.inputPerMillion != null ? { inputPerMillion: summary.inputPerMillion } : {}),
    ...(summary.outputPerMillion != null ? { outputPerMillion: summary.outputPerMillion } : {}),
    ...(summary.requestCost != null ? { perCallTotal: summary.requestCost } : {}),
  };
  input.sourceMap.set(key, { modelKey, source });
}

async function loadPricingSources(
  inventory: Awaited<ReturnType<typeof listActiveCompiledRuntimeModelInventory>>,
): Promise<Map<string, ModelsMarketplacePricingSource[]>> {
  const sourceMap = new Map<string, { modelKey: string; source: ModelsMarketplacePricingSource }>();
  await Promise.all(inventory.flatMap((entrypoint) => entrypoint.executionAttempts.map(async (attempt) => {
    if (!attempt.enabled || attempt.account.status !== 'active' || attempt.site.status !== 'active') return;
    if (attempt.token && (!attempt.token.enabled || attempt.token.valueStatus !== ACCOUNT_TOKEN_VALUE_STATUS_READY)) return;
    const quote = await quoteEndpointPricing({
      supply: {
        siteId: attempt.site.id,
        accountId: attempt.account.id,
        tokenId: attempt.token?.id ?? undefined,
        tokenGroup: attempt.token?.tokenGroup ?? null,
        provider: attempt.site.platform,
        modelName: attempt.modelName,
      },
      usageProfile: 'preview_1m_io',
      includeReference: false,
      providerCatalogMode: 'cache_only',
    });
    if (!quote.endpoint || quote.endpoint.source === 'system_default' || quote.endpoint.sourceType === 'system_default') return;
    upsertPricingSource({
      sourceMap,
      modelName: entrypoint.modelName,
      siteId: attempt.site.id,
      siteName: attempt.site.name,
      accountId: attempt.account.id,
      username: attempt.account.username,
      tokenGroup: attempt.token?.tokenGroup ?? null,
      resolution: quote.endpoint,
    });
  })));
  const byModel = new Map<string, ModelsMarketplacePricingSource[]>();
  for (const { modelKey, source } of sourceMap.values()) {
    const sources = byModel.get(modelKey) || [];
    sources.push({
      ...source,
      enableGroups: source.enableGroups.sort((left, right) => left.localeCompare(right)),
    });
    byModel.set(modelKey, sources);
  }
  return byModel;
}

function modelRows(input: {
  models: Map<string, ModelAggregate>;
  health: Map<string, { success: number; total: number; totalLatency: number }>;
  metadata: Map<string, ModelMetadataAggregate>;
  pricingSources: Map<string, ModelsMarketplacePricingSource[]>;
  measuredPricing: Map<string, ModelsMarketplaceMeasuredPricing>;
}): ModelsMarketplaceModel[] {
  return Array.from(input.models.values()).map((model) => {
    const accounts: ModelsMarketplaceAccount[] = Array.from(model.accountsById.values()).map((account) => ({
      id: account.id,
      site: account.site,
      username: account.username,
      latency: account.latency,
      balance: account.balance,
      tokens: Array.from(account.tokens.values()),
      managedTokenCount: account.tokens.size,
      credentialCount: account.credentialKeys.size,
      endpointCount: account.endpointIds.size,
      executionAttemptCount: account.executionAttemptIds.size,
    }));
    const latencyValues = accounts
      .map((account) => account.latency)
      .filter((latency): latency is number => latency != null && Number.isFinite(latency));
    const accountAvgLatency = latencyValues.length > 0
      ? latencyValues.reduce((sum, latency) => sum + latency, 0) / latencyValues.length
      : null;
    const health = input.health.get(model.name);
    const metadata = input.metadata.get(model.name.toLowerCase());
    const siteCounts = Object.fromEntries(Array.from(model.siteTopology.entries()).map(([site, aggregate]) => [
      site,
      {
        endpointCount: aggregate.endpointIds.size,
        executionAttemptCount: aggregate.executionAttemptIds.size,
        credentialCount: aggregate.credentialKeys.size,
      },
    ]));
    return {
      name: model.name,
      accountCount: accounts.length,
      tokenCount: accounts.reduce((sum, account) => sum + account.managedTokenCount, 0),
      managedTokenCount: accounts.reduce((sum, account) => sum + account.managedTokenCount, 0),
      credentialCount: new Set(Array.from(model.siteTopology.values()).flatMap((site) => Array.from(site.credentialKeys))).size,
      endpointCount: model.endpointIds.size,
      executionAttemptCount: model.executionAttemptIds.size,
      avgLatency: health?.total
        ? Math.round(health.totalLatency / health.total)
        : accountAvgLatency == null ? null : Math.round(accountAvgLatency),
      successRate: health?.total
        ? Math.round((health.success / health.total) * 1000) / 10
        : null,
      description: metadata?.description || null,
      tags: metadata ? Array.from(metadata.tags).sort((left, right) => left.localeCompare(right)) : [],
      supportedEndpointTypes: metadata
        ? Array.from(metadata.supportedEndpointTypes).sort((left, right) => left.localeCompare(right))
        : [],
      pricingSources: input.pricingSources.get(model.name.toLowerCase()) || [],
      runtimeInventoryIssues: model.runtimeInventoryIssues,
      measuredEntryPricing: input.measuredPricing.get(model.name) || null,
      accounts,
      siteCounts,
    };
  }).sort((left, right) => right.accountCount - left.accountCount);
}

async function buildModelsMarketplaceModels(includePricing: boolean): Promise<ModelsMarketplaceModel[]> {
  const inventory = await listActiveCompiledRuntimeModelInventory();
  const routeEntrypointModelNames = new Map<string, string>();
  const models = new Map<string, ModelAggregate>();
  const metadata = new Map<string, ModelMetadataAggregate>();
  const catalogsByScope = new Map<string, UpstreamPricingCatalog>();
  for (const snapshot of await listCachedProviderPricingCatalogs()) {
    if (snapshot.catalog) catalogsByScope.set(`${snapshot.siteId}:${snapshot.accountId ?? '-'}`, snapshot.catalog);
  }

  for (const entrypoint of inventory) {
    const model = ensureModel(models, entrypoint.modelName);
    if (!model) continue;
    routeEntrypointModelNames.set(entrypoint.entryNodeId, model.name);
    for (const issue of entrypoint.invalidExecutionAttempts) {
      model.runtimeInventoryIssues.push({
        level: issue.reason === 'missing_execution_target_identity' ? 'error' : 'warn',
        code: 'compiled_runtime_invalid_execution_attempt',
        ...issue,
      });
    }
    for (const attempt of entrypoint.executionAttempts) {
      const catalog = catalogsByScope.get(`${attempt.site.id}:${attempt.account.id}`)
        || catalogsByScope.get(`${attempt.site.id}:-`);
      if (catalog) mergeCatalogMetadata({
        metadataByModel: metadata,
        publicModelName: model.name,
        upstreamModelName: attempt.modelName,
        catalog,
      });
      if (!attempt.enabled || attempt.account.status !== 'active' || attempt.site.status !== 'active') continue;
      if (attempt.token && (!attempt.token.enabled || attempt.token.valueStatus !== ACCOUNT_TOKEN_VALUE_STATUS_READY)) continue;
      const account = ensureAccount(model, attempt);
      if (attempt.token) account.tokens.set(attempt.token.id, {
        id: attempt.token.id,
        name: attempt.token.name,
        isDefault: !!attempt.token.isDefault,
      });
      const credential = credentialKey(attempt);
      account.credentialKeys.add(credential);
      account.endpointIds.add(attempt.endpointId);
      account.executionAttemptIds.add(attempt.executionAttemptId);
      model.endpointIds.add(attempt.endpointId);
      model.executionAttemptIds.add(attempt.executionAttemptId);
      const site = ensureSiteTopology(model, attempt.site.name);
      site.credentialKeys.add(credential);
      site.endpointIds.add(attempt.endpointId);
      site.executionAttemptIds.add(attempt.executionAttemptId);
    }
  }

  const { recentHealthLogs, recentPricingLogs } = await listModelsMarketplaceRuntimeFacts({
    realtimeHealthStart: getRecentMinuteRangeStartUtc(5),
    pricingStart: getLocalRangeStartUtc(7),
  });
  const health = new Map<string, { success: number; total: number; totalLatency: number }>();
  for (const fact of recentHealthLogs) {
    const modelName = routeEntrypointModelNames.get(text(fact.routeEntrypointId));
    if (!modelName) continue;
    const aggregate = health.get(modelName) || { success: 0, total: 0, totalLatency: 0 };
    aggregate.total += 1;
    if (fact.status === 'success') aggregate.success += 1;
    if (fact.latencyMs != null) aggregate.totalLatency += fact.latencyMs;
    health.set(modelName, aggregate);
  }
  const measuredAggregates = new Map<string, MeasuredPricingAggregate>();
  for (const fact of recentPricingLogs) {
    const modelName = routeEntrypointModelNames.get(text(fact.routeEntrypointId));
    if (modelName) aggregateMeasuredPricing(measuredAggregates, modelName, fact);
  }
  const [pricingSources, measuredPricing] = await Promise.all([
    includePricing ? loadPricingSources(inventory) : Promise.resolve(new Map<string, ModelsMarketplacePricingSource[]>()),
    buildMeasuredPricing(measuredAggregates),
  ]);
  return modelRows({ models, health, metadata, pricingSources, measuredPricing });
}

export function resetModelsMarketplaceReadModelForTests(): void {
  resetModelsMarketplaceCacheForTests();
}

export async function getModelsMarketplaceReadModel(input: {
  query: ModelsMarketplaceQuery;
  refreshRequested: boolean;
  includePricing: boolean;
}) {
  let refreshQueued = false;
  let refreshReused = false;
  let refreshJobId: string | null = null;
  if (input.refreshRequested) {
    clearModelsMarketplaceCache();
    const { task, reused } = queueRefreshModelsAndRebuildRoutesTask({ source: 'models_marketplace' });
    refreshQueued = !reused;
    refreshReused = reused;
    refreshJobId = task.id;
  }
  const runningTask = getRunningTaskByDedupeKey('refresh-models-and-rebuild-routes');
  if (!refreshJobId && runningTask) refreshJobId = runningTask.id;
  const meta: ModelsMarketplaceMeta = {
    refreshRequested: input.refreshRequested,
    refreshQueued,
    refreshReused,
    refreshRunning: !!runningTask,
    refreshJobId,
    includePricing: input.includePricing,
  };
  if (!input.refreshRequested) {
    const cached = readModelsMarketplaceCache({ includePricing: input.includePricing });
    if (cached) return buildModelsMarketplacePage(cached, input.query, { ...meta, cacheHit: true });
  }
  const models = await buildModelsMarketplaceModels(input.includePricing);
  writeModelsMarketplaceCache({ includePricing: input.includePricing }, models);
  return buildModelsMarketplacePage(models, input.query, meta);
}
