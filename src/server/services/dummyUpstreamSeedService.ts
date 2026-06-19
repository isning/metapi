import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireInsertedRowId } from '../db/insertHelpers.js';
import { ACCOUNT_TOKEN_VALUE_STATUS_READY } from './accountTokenService.js';
import * as routeRefreshWorkflow from './routeRefreshWorkflow.js';
import { compileRouteGraphSource } from '../../shared/routeGraph.js';
import { ensureActiveRouteGraphVersion } from './routeGraphService.js';

const DUMMY_SITE_NAME = 'Metapi Dummy Upstreams';
const DUMMY_SITE_URL = 'https://dummy-upstreams.metapi.local';
const DUMMY_SITE_PLATFORM = 'new-api';
const DUMMY_ACCOUNT_USERNAME = 'dummy-upstream';

const DUMMY_UPSTREAM_MODELS = [
  { name: 'dummy-openai-chat', tokenName: 'dummy-openai', priority: 0, weight: 30 },
  { name: 'dummy-claude-messages', tokenName: 'dummy-claude', priority: 1, weight: 20 },
  { name: 'dummy-gemini-generate-content', tokenName: 'dummy-gemini', priority: 2, weight: 10 },
] as const;

export type DummyUpstreamSeedSummary = {
  siteId: number;
  accountId: number;
  tokenIds: number[];
  modelNames: string[];
  routes: number;
  channels: number;
  graphNodes: number;
  graphEdges: number;
  rebuild: Awaited<ReturnType<typeof routeRefreshWorkflow.rebuildRoutesOnly>>;
};

async function ensureDummySite(): Promise<typeof schema.sites.$inferSelect> {
  const existing = await db.select().from(schema.sites)
    .where(eq(schema.sites.url, DUMMY_SITE_URL))
    .get();
  if (existing) {
    if (existing.status !== 'active') {
      await db.update(schema.sites)
        .set({ status: 'active', updatedAt: new Date().toISOString() })
        .where(eq(schema.sites.id, existing.id))
        .run();
      return { ...existing, status: 'active' };
    }
    return existing;
  }

  const inserted = await db.insert(schema.sites).values({
    name: DUMMY_SITE_NAME,
    url: DUMMY_SITE_URL,
    platform: DUMMY_SITE_PLATFORM,
    status: 'active',
    globalWeight: 1,
    sortOrder: 999,
  }).run();
  const siteId = requireInsertedRowId(inserted, 'Failed to create dummy upstream site');
  const created = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).get();
  if (!created) throw new Error('Failed to load dummy upstream site');
  return created;
}

async function ensureDummyAccount(siteId: number): Promise<typeof schema.accounts.$inferSelect> {
  const accounts = await db.select().from(schema.accounts)
    .where(eq(schema.accounts.siteId, siteId))
    .all();
  const existing = accounts.find((account) => account.username === DUMMY_ACCOUNT_USERNAME);
  if (existing) {
    if (existing.status !== 'active') {
      await db.update(schema.accounts)
        .set({ status: 'active', updatedAt: new Date().toISOString() })
        .where(eq(schema.accounts.id, existing.id))
        .run();
      return { ...existing, status: 'active' };
    }
    return existing;
  }

  const inserted = await db.insert(schema.accounts).values({
    siteId,
    username: DUMMY_ACCOUNT_USERNAME,
    accessToken: 'dummy-session-token',
    apiToken: 'sk-dummy-upstream-account',
    status: 'active',
    extraConfig: JSON.stringify({
      credentialMode: 'session',
      dummyUpstream: true,
    }),
  }).run();
  const accountId = requireInsertedRowId(inserted, 'Failed to create dummy upstream account');
  const created = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
  if (!created) throw new Error('Failed to load dummy upstream account');
  return created;
}

async function ensureDummyToken(accountId: number, tokenName: string, modelName: string): Promise<number> {
  const tokenValue = `sk-${tokenName}-route-graph-test`;
  const tokens = await db.select().from(schema.accountTokens)
    .where(eq(schema.accountTokens.accountId, accountId))
    .all();
  const existing = tokens.find((token) => token.name === tokenName || token.token === tokenValue);
  let tokenId = existing?.id ?? null;

  if (existing) {
    await db.update(schema.accountTokens)
      .set({
        name: tokenName,
        token: tokenValue,
        tokenGroup: 'dummy-upstreams',
        valueStatus: ACCOUNT_TOKEN_VALUE_STATUS_READY,
        source: 'manual',
        enabled: true,
        isDefault: tokenName === DUMMY_UPSTREAM_MODELS[0].tokenName,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.accountTokens.id, existing.id))
      .run();
  } else {
    const inserted = await db.insert(schema.accountTokens).values({
      accountId,
      name: tokenName,
      token: tokenValue,
      tokenGroup: 'dummy-upstreams',
      valueStatus: ACCOUNT_TOKEN_VALUE_STATUS_READY,
      source: 'manual',
      enabled: true,
      isDefault: tokenName === DUMMY_UPSTREAM_MODELS[0].tokenName,
    }).run();
    tokenId = requireInsertedRowId(inserted, 'Failed to create dummy upstream token');
  }

  if (!tokenId) throw new Error('Failed to resolve dummy upstream token id');
  await ensureTokenModelAvailability(tokenId, modelName);
  return tokenId;
}

async function ensureTokenModelAvailability(tokenId: number, modelName: string): Promise<void> {
  const existing = await db.select().from(schema.tokenModelAvailability)
    .where(eq(schema.tokenModelAvailability.tokenId, tokenId))
    .all();
  const row = existing.find((item) => item.modelName === modelName);
  if (row) {
    await db.update(schema.tokenModelAvailability)
      .set({
        available: true,
        latencyMs: 25,
        checkedAt: new Date().toISOString(),
      })
      .where(eq(schema.tokenModelAvailability.id, row.id))
      .run();
    return;
  }
  await db.insert(schema.tokenModelAvailability).values({
    tokenId,
    modelName,
    available: true,
    latencyMs: 25,
    checkedAt: new Date().toISOString(),
  }).run();
}

async function applyDummyRouteWeights(modelName: string, priority: number, weight: number): Promise<void> {
  const active = await ensureActiveRouteGraphVersion();
  const compiled = compileRouteGraphSource(active.sourceGraph);
  const entry = compiled.compiled.entries.find((item) => item.publicModelName === modelName);
  const routeId = Number(entry?.match?.routeId || 0);
  if (!Number.isFinite(routeId) || routeId <= 0) return;

  const channels = await db.select().from(schema.routeChannels)
    .where(eq(schema.routeChannels.routeId, Math.trunc(routeId)))
    .all();
  for (const channel of channels) {
    await db.update(schema.routeChannels)
      .set({ priority, weight })
      .where(eq(schema.routeChannels.id, channel.id))
      .run();
  }
}

export async function seedDummyUpstreamRoutes(): Promise<DummyUpstreamSeedSummary> {
  const site = await ensureDummySite();
  const account = await ensureDummyAccount(site.id);
  const tokenIds: number[] = [];

  for (const model of DUMMY_UPSTREAM_MODELS) {
    tokenIds.push(await ensureDummyToken(account.id, model.tokenName, model.name));
  }

  const rebuild = await routeRefreshWorkflow.rebuildRoutesOnly();

  for (const model of DUMMY_UPSTREAM_MODELS) {
    await applyDummyRouteWeights(model.name, model.priority, model.weight);
  }

  const active = await ensureActiveRouteGraphVersion();

  return {
    siteId: site.id,
    accountId: account.id,
    tokenIds,
    modelNames: DUMMY_UPSTREAM_MODELS.map((model) => model.name),
    routes: DUMMY_UPSTREAM_MODELS.length,
    channels: tokenIds.length,
    graphNodes: active.sourceGraph.nodes.length,
    graphEdges: active.sourceGraph.edges.length,
    rebuild,
  };
}
