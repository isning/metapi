import { FastifyInstance } from 'fastify';
import { db, schema } from '../../db/index.js';
import { like, desc, eq, or } from 'drizzle-orm';
import { getProxyLogBaseSelectFields } from '../../services/proxyLogStore.js';
import { resolveStoredAccountCredentialMode } from '../../services/accountExtraConfig.js';
import { ACCOUNT_TOKEN_VALUE_STATUS_READY } from '../../services/accountTokenService.js';
import { listActiveCompiledRuntimeModelInventory } from '../../services/compiledRuntimeInventoryService.js';

function resolveAccountSearchSegment(account: typeof schema.accounts.$inferSelect): 'session' | 'apikey' | 'oauth' {
  const mode = resolveStoredAccountCredentialMode(account);
  return mode === 'oauth' ? 'oauth' : mode === 'apikey' ? 'apikey' : 'session';
}

function normalizeSearchQuery(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

function matchesApiKeyDisplayLabel(query: string): boolean {
  const normalized = normalizeSearchQuery(query);
  return [
    'apikey',
    'api key',
    'api-key',
    'api key 连接',
    'apikey 连接',
    'api key connection',
    'apikey connection',
  ].some((keyword) => normalized.includes(keyword));
}

export async function searchRoutes(app: FastifyInstance) {
  const proxyLogBaseFields = getProxyLogBaseSelectFields();

  app.post<{ Body: { query: string; limit?: number } }>('/api/search', async (request) => {
    const { query, limit = 20 } = request.body;
    if (!query || query.trim().length === 0) {
      return { accounts: [], accountTokens: [], sites: [], checkinLogs: [], proxyLogs: [], models: [] };
    }

    const q = `%${query.trim()}%`;
    const perCategory = Math.min(Math.ceil(limit / 6), 10);

    // Search sites
    const sites = await db.select().from(schema.sites)
      .where(or(
        like(schema.sites.name, q),
        like(schema.sites.url, q),
        like(schema.sites.platform, q),
      ))
      .limit(perCategory).all();
    // Deduplicate by id
    const uniqueSites = [...new Map(sites.map(s => [s.id, s])).values()].slice(0, perCategory);

    // Search accounts (join with sites for site name)
    const accountResults = await db.select().from(schema.accounts)
      .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
      .where(or(
        like(schema.accounts.username, q),
        like(schema.sites.name, q),
        like(schema.sites.platform, q),
      ))
      .limit(perCategory).all();
    const apiKeyLabelMatches = matchesApiKeyDisplayLabel(query);
    const apiKeyAccountResults = apiKeyLabelMatches
      ? await db.select().from(schema.accounts)
        .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
        .where(or(
          eq(schema.accounts.credentialMode, 'apikey'),
        ))
        .limit(perCategory)
        .all()
      : [];
    const accounts = [...new Map([...accountResults, ...apiKeyAccountResults].map((r) => [r.accounts.id, ({
      ...r.accounts,
      segment: resolveAccountSearchSegment(r.accounts),
      site: r.sites,
    })])).values()].slice(0, perCategory);

    // Search account tokens by token name/group/account/site
    const tokenResults = await db.select({
      account_tokens: {
        id: schema.accountTokens.id,
        accountId: schema.accountTokens.accountId,
        name: schema.accountTokens.name,
        tokenGroup: schema.accountTokens.tokenGroup,
        compatibilityPolicy: schema.accountTokens.compatibilityPolicy,
        valueStatus: schema.accountTokens.valueStatus,
        source: schema.accountTokens.source,
        enabled: schema.accountTokens.enabled,
        isDefault: schema.accountTokens.isDefault,
        createdAt: schema.accountTokens.createdAt,
        updatedAt: schema.accountTokens.updatedAt,
      },
      accounts: schema.accounts,
      sites: schema.sites,
    }).from(schema.accountTokens)
      .innerJoin(schema.accounts, eq(schema.accountTokens.accountId, schema.accounts.id))
      .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
      .where(or(
        like(schema.accountTokens.name, q),
        like(schema.accountTokens.tokenGroup, q),
        like(schema.accounts.username, q),
        like(schema.sites.name, q),
        like(schema.sites.platform, q),
      ))
      .orderBy(desc(schema.accountTokens.updatedAt))
      .limit(perCategory)
      .all();
    const accountTokens = tokenResults.map(r => ({
      ...r.account_tokens,
      account: {
        id: r.accounts.id,
        username: r.accounts.username,
        segment: resolveAccountSearchSegment(r.accounts),
      },
      site: r.sites,
    }));

    // Search checkin logs (by message)
    const checkinLogs = (await db.select().from(schema.checkinLogs)
      .innerJoin(schema.accounts, eq(schema.checkinLogs.accountId, schema.accounts.id))
      .where(like(schema.checkinLogs.message, q))
      .orderBy(desc(schema.checkinLogs.createdAt))
      .limit(perCategory).all())
      .map(r => ({ ...r.checkin_logs, account: r.accounts }));

    // Search proxy logs (by model name)
    const proxyLogs = await db.select(proxyLogBaseFields).from(schema.proxyLogs)
      .where(like(schema.proxyLogs.modelRequested, q))
      .orderBy(desc(schema.proxyLogs.createdAt))
      .limit(perCategory).all();

    // Search routeable models from the active compiled runtime inventory.
    const modelQuery = normalizeSearchQuery(query);
    const modelAgg = new Map<string, { tokenIds: Set<number>; accountIds: Set<number>; siteIds: Set<number> }>();
    const runtimeInventory = await listActiveCompiledRuntimeModelInventory();
    for (const entrypoint of runtimeInventory) {
      if (!normalizeSearchQuery(entrypoint.modelName).includes(modelQuery)) continue;
      const key = entrypoint.modelName;
      if (!modelAgg.has(key)) modelAgg.set(key, { tokenIds: new Set(), accountIds: new Set(), siteIds: new Set() });
      const agg = modelAgg.get(key)!;
      for (const attempt of entrypoint.executionAttempts) {
        if (
          !attempt.enabled ||
          attempt.account.status !== 'active' ||
          attempt.site.status !== 'active'
        ) continue;
        if (
          attempt.token &&
          (
            !attempt.token.enabled ||
            attempt.token.valueStatus !== ACCOUNT_TOKEN_VALUE_STATUS_READY
          )
        ) continue;
        agg.accountIds.add(attempt.account.id);
        agg.siteIds.add(attempt.site.id);
        if (attempt.token) agg.tokenIds.add(attempt.token.id);
      }
    }

    const models = Array.from(modelAgg.entries())
      .map(([name, agg]) => ({
        name,
        accountCount: agg.accountIds.size,
        tokenCount: agg.tokenIds.size,
        siteCount: agg.siteIds.size,
      }))
      .sort((a, b) => {
        if (b.accountCount !== a.accountCount) return b.accountCount - a.accountCount;
        if (b.tokenCount !== a.tokenCount) return b.tokenCount - a.tokenCount;
        return a.name.localeCompare(b.name);
      })
      .slice(0, perCategory);

    return { accounts, accountTokens, sites: uniqueSites, checkinLogs, proxyLogs, models };
  });
}
