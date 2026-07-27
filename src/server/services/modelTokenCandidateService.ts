import { and, eq } from "drizzle-orm";
import { config } from "../config.js";
import { db, schema } from "../db/index.js";
import { requiresManagedAccountTokens } from "./accountExtraConfig.js";
import { ACCOUNT_TOKEN_VALUE_STATUS_READY } from "./accountTokenService.js";
import { fetchModelPricingCatalog } from "./modelPricingService.js";
import { readModelsMarketplaceCache } from "./modelsMarketplaceCacheService.js";

type MissingTokenAccount = {
  accountId: number;
  username: string | null;
  siteId: number;
  siteName: string;
};

type MissingTokenGroupAccount = MissingTokenAccount & {
  missingGroups: string[];
  requiredGroups: string[];
  availableGroups: string[];
  groupCoverageUncertain?: boolean;
};

export type ModelTokenCandidatesPayload = {
  models: Record<string, Array<{
    accountId: number;
    tokenId: number;
    tokenName: string;
    isDefault: boolean;
    username: string | null;
    siteId: number;
    siteName: string;
  }>>;
  modelsWithoutToken: Record<string, MissingTokenAccount[]>;
  modelsMissingTokenGroups: Record<string, MissingTokenGroupAccount[]>;
  endpointTypesByModel: Record<string, string[]>;
};

function resolveTokenGroupLabel(tokenGroup: string | null, tokenName: string | null): string | null {
  const explicit = (tokenGroup || "").trim();
  if (explicit) return explicit;

  const name = (tokenName || "").trim();
  if (!name) return null;
  const normalized = name.toLowerCase();
  if (
    normalized === "default" ||
    normalized === "默认" ||
    /^default($|[-_\s])/.test(normalized)
  ) {
    return "default";
  }
  if (/^token-\d+$/.test(normalized)) return null;
  return name;
}

export function buildEndpointTypesByModelFromMarketplaceCache(): Record<string, string[]> {
  const endpointTypesByModel: Record<string, string[]> = {};
  const cachedPricing = readModelsMarketplaceCache(true);
  const cachedBase = cachedPricing || readModelsMarketplaceCache(false);
  if (!cachedBase) return endpointTypesByModel;

  for (const model of cachedBase) {
    if (
      Array.isArray(model.supportedEndpointTypes) &&
      model.supportedEndpointTypes.length > 0
    ) {
      endpointTypesByModel[model.name] = model.supportedEndpointTypes;
    }
  }
  return endpointTypesByModel;
}

export async function buildModelTokenCandidatesPayload(): Promise<ModelTokenCandidatesPayload> {
  const globalAllowedModels = new Set(
    config.globalAllowedModels
      .map((model) => model.toLowerCase().trim())
      .filter(Boolean),
  );

  const rows = await db
    .select()
    .from(schema.tokenModelAvailability)
    .innerJoin(
      schema.accountTokens,
      eq(schema.tokenModelAvailability.tokenId, schema.accountTokens.id),
    )
    .innerJoin(
      schema.accounts,
      eq(schema.accountTokens.accountId, schema.accounts.id),
    )
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .where(
      and(
        eq(schema.tokenModelAvailability.available, true),
        eq(schema.accountTokens.enabled, true),
        eq(schema.accountTokens.valueStatus, ACCOUNT_TOKEN_VALUE_STATUS_READY),
        eq(schema.accounts.status, "active"),
        eq(schema.sites.status, "active"),
      ),
    )
    .all();
  const availableModelRows = await db
    .select({
      modelName: schema.modelAvailability.modelName,
      accountId: schema.accounts.id,
      username: schema.accounts.username,
      siteId: schema.sites.id,
      siteName: schema.sites.name,
      accessToken: schema.accounts.accessToken,
      apiToken: schema.accounts.apiToken,
      extraConfig: schema.accounts.extraConfig,
    })
    .from(schema.modelAvailability)
    .innerJoin(
      schema.accounts,
      eq(schema.modelAvailability.accountId, schema.accounts.id),
    )
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .where(
      and(
        eq(schema.modelAvailability.available, true),
        eq(schema.accounts.status, "active"),
        eq(schema.sites.status, "active"),
      ),
    )
    .all();

  const result: ModelTokenCandidatesPayload["models"] = {};
  const coveredAccountModelSet = new Set<string>();
  const coveredGroupsByAccountModel = new Map<string, Map<string, string>>();
  const unknownGroupCoverageByAccountModel = new Set<string>();
  const modelsWithoutToken: ModelTokenCandidatesPayload["modelsWithoutToken"] = {};
  const modelsMissingTokenGroups: ModelTokenCandidatesPayload["modelsMissingTokenGroups"] = {};
  let hasAnyTokenGroupSignals = false;

  for (const row of rows) {
    const modelName = (row.token_model_availability.modelName || "").trim();
    if (!modelName) continue;
    const accountModelKey = `${row.accounts.id}::${modelName.toLowerCase()}`;
    coveredAccountModelSet.add(accountModelKey);

    const resolvedTokenGroup = resolveTokenGroupLabel(
      row.account_tokens.tokenGroup,
      row.account_tokens.name,
    );
    if (resolvedTokenGroup) {
      hasAnyTokenGroupSignals = true;
      if (!coveredGroupsByAccountModel.has(accountModelKey)) {
        coveredGroupsByAccountModel.set(accountModelKey, new Map<string, string>());
      }
      const groupKey = resolvedTokenGroup.toLowerCase();
      if (!coveredGroupsByAccountModel.get(accountModelKey)!.has(groupKey)) {
        coveredGroupsByAccountModel.get(accountModelKey)!.set(groupKey, resolvedTokenGroup);
      }
    } else {
      unknownGroupCoverageByAccountModel.add(accountModelKey);
    }

    if (!result[modelName]) result[modelName] = [];
    if (result[modelName].some((item) => item.tokenId === row.account_tokens.id)) continue;
    result[modelName].push({
      accountId: row.accounts.id,
      tokenId: row.account_tokens.id,
      tokenName: row.account_tokens.name,
      isDefault: !!row.account_tokens.isDefault,
      username: row.accounts.username,
      siteId: row.sites.id,
      siteName: row.sites.name,
    });
  }

  for (const row of availableModelRows) {
    if (!requiresManagedAccountTokens(row)) continue;
    const modelName = (row.modelName || "").trim();
    if (!modelName) continue;
    const coverageKey = `${row.accountId}::${modelName.toLowerCase()}`;
    if (coveredAccountModelSet.has(coverageKey)) continue;
    if (!modelsWithoutToken[modelName]) modelsWithoutToken[modelName] = [];
    if (modelsWithoutToken[modelName].some((item) => item.accountId === row.accountId)) continue;
    modelsWithoutToken[modelName].push({
      accountId: row.accountId,
      username: row.username,
      siteId: row.siteId,
      siteName: row.siteName,
    });
  }

  const accountIdsForGroupHints = new Set(
    availableModelRows
      .filter((row) => requiresManagedAccountTokens(row))
      .map((row) => row.accountId),
  );
  const requiredGroupsByAccountModel = new Map<string, Map<string, string>>();
  const hasPotentialGroupHints = hasAnyTokenGroupSignals || unknownGroupCoverageByAccountModel.size > 0;

  if (hasPotentialGroupHints && accountIdsForGroupHints.size > 0) {
    const accountRows = await db
      .select()
      .from(schema.accounts)
      .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
      .where(
        and(
          eq(schema.accounts.status, "active"),
          eq(schema.sites.status, "active"),
        ),
      )
      .all();

    const metadataResults = await Promise.all(
      accountRows
        .filter((row) => accountIdsForGroupHints.has(row.accounts.id))
        .map(async (row) => {
          try {
            const catalog = await fetchModelPricingCatalog({
              site: {
                id: row.sites.id,
                url: row.sites.url,
                platform: row.sites.platform,
                apiKey: row.sites.apiKey,
              },
              account: {
                id: row.accounts.id,
                username: row.accounts.username,
                accessToken: row.accounts.accessToken,
                apiToken: row.accounts.apiToken,
                extraConfig: row.accounts.extraConfig,
              },
              modelName: "__metadata__",
              totalTokens: 0,
            });
            return { accountId: row.accounts.id, catalog };
          } catch {
            return {
              accountId: row.accounts.id,
              catalog: null as Awaited<ReturnType<typeof fetchModelPricingCatalog>>,
            };
          }
        }),
    );

    for (const result of metadataResults) {
      if (!result.catalog) continue;
      for (const model of result.catalog.models) {
        const modelName = (model.modelName || "").trim();
        if (!modelName) continue;
        const groups = new Map<string, string>();
        for (const rawGroup of model.enableGroups || []) {
          const group = String(rawGroup || "").trim();
          if (!group) continue;
          const groupKey = group.toLowerCase();
          if (!groups.has(groupKey)) groups.set(groupKey, group);
        }
        if (groups.size === 0) continue;
        requiredGroupsByAccountModel.set(`${result.accountId}::${modelName.toLowerCase()}`, groups);
      }
    }
  }

  for (const row of availableModelRows) {
    if (!requiresManagedAccountTokens(row)) continue;
    const modelName = (row.modelName || "").trim();
    if (!modelName) continue;
    const accountModelKey = `${row.accountId}::${modelName.toLowerCase()}`;

    const requiredGroups = requiredGroupsByAccountModel.get(accountModelKey);
    if (!requiredGroups || requiredGroups.size === 0) continue;

    const availableGroups = coveredGroupsByAccountModel.get(accountModelKey) || new Map<string, string>();
    const missingGroups = Array.from(requiredGroups.entries())
      .filter(([groupKey]) => !availableGroups.has(groupKey))
      .map(([, label]) => label);
    if (missingGroups.length === 0) continue;

    if (!modelsMissingTokenGroups[modelName]) modelsMissingTokenGroups[modelName] = [];
    if (modelsMissingTokenGroups[modelName].some((item) => item.accountId === row.accountId)) continue;
    const hintRow: MissingTokenGroupAccount = {
      accountId: row.accountId,
      username: row.username,
      siteId: row.siteId,
      siteName: row.siteName,
      missingGroups: missingGroups.sort((a, b) => a.localeCompare(b)),
      requiredGroups: Array.from(requiredGroups.values()).sort((a, b) => a.localeCompare(b)),
      availableGroups: Array.from(availableGroups.values()).sort((a, b) => a.localeCompare(b)),
    };
    if (unknownGroupCoverageByAccountModel.has(accountModelKey)) {
      hintRow.groupCoverageUncertain = true;
    }
    modelsMissingTokenGroups[modelName].push(hintRow);
  }

  const endpointTypesByModel = buildEndpointTypesByModelFromMarketplaceCache();
  if (globalAllowedModels.size === 0) {
    return {
      models: result,
      modelsWithoutToken,
      modelsMissingTokenGroups,
      endpointTypesByModel,
    };
  }

  const filteredResult: typeof result = {};
  const filteredModelsWithoutToken: typeof modelsWithoutToken = {};
  const filteredModelsMissingTokenGroups: typeof modelsMissingTokenGroups = {};
  for (const [modelName, candidates] of Object.entries(result)) {
    if (globalAllowedModels.has(modelName.toLowerCase().trim())) filteredResult[modelName] = candidates;
  }
  for (const [modelName, accounts] of Object.entries(modelsWithoutToken)) {
    if (globalAllowedModels.has(modelName.toLowerCase().trim())) filteredModelsWithoutToken[modelName] = accounts;
  }
  for (const [modelName, accounts] of Object.entries(modelsMissingTokenGroups)) {
    if (globalAllowedModels.has(modelName.toLowerCase().trim())) filteredModelsMissingTokenGroups[modelName] = accounts;
  }

  return {
    models: filteredResult,
    modelsWithoutToken: filteredModelsWithoutToken,
    modelsMissingTokenGroups: filteredModelsMissingTokenGroups,
    endpointTypesByModel,
  };
}
