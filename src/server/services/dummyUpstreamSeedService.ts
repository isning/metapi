import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { listAccountTokens } from './accountTokenService.js';
import { requireInsertedRowId } from '../db/insertHelpers.js';
import { ACCOUNT_TOKEN_VALUE_STATUS_READY } from './accountTokenService.js';
import * as routeRefreshWorkflow from './routeRefreshWorkflow.js';
import { getActiveRouteGraphSourceVersion, publishRouteGraphSource } from './routeGraphService.js';
import {
  replaceRouteGroupFacadeMacroInSource,
  routeGroupFacadeModelName,
} from './routeGroupGraphFacadeAccessService.js';

const DUMMY_SITE_NAME = 'Metapi Dummy Upstreams';
const DUMMY_SITE_URL = 'https://dummy-upstreams.metapi.local';
const DUMMY_SITE_PLATFORM = 'new-api';
const DUMMY_ACCOUNT_USERNAME = 'dummy-upstream';

const DUMMY_UPSTREAM_MODELS = [
  { name: 'dummy-openai-chat', tokenName: 'dummy-openai', weight: 30 },
  { name: 'dummy-claude-messages', tokenName: 'dummy-claude', weight: 20 },
  { name: 'dummy-gemini-generate-content', tokenName: 'dummy-gemini', weight: 10 },
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
    credential: 'dummy-session-token',
    credentialMode: 'session',
    credentialKind: 'access_token',
    status: 'active',
    extraConfig: JSON.stringify({
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
  const tokens = await listAccountTokens(accountId);
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

async function applyDummyRouteWeights(): Promise<void> {
  const active = await getActiveRouteGraphSourceVersion();
  if (!active) return;
  let source = active.sourceGraph;
  let changed = false;
  for (const definition of DUMMY_UPSTREAM_MODELS) {
    const modelName = definition.name.toLowerCase();
    const macro = (source.macros || []).find((candidate) => (
      candidate.kind === 'candidate_selector'
      && routeGroupFacadeModelName(candidate).toLowerCase() === modelName
    ));
    if (!macro) continue;
    const nextMacro = {
      ...macro,
      config: {
        ...macro.config,
        groups: macro.config.groups.map((stage) => ({
          ...stage,
          members: (stage.members || []).map((member) => ({ ...member, weight: definition.weight })),
        })),
      },
    };
    source = replaceRouteGroupFacadeMacroInSource(source, nextMacro);
    changed = true;
  }
  if (!changed) return;
  const published = await publishRouteGraphSource({ sourceGraph: source, createdBy: 'dummy-upstream-seed' });
  if (!published.ok) {
    throw new Error(`Failed to apply dummy route weights: ${published.diagnostics.map((item) => item.message).join('; ')}`);
  }
}

async function loadRouteRuntimeGraphSummary(): Promise<{ graphNodes: number; graphEdges: number }> {
  const active = await getActiveRouteGraphSourceVersion();
  if (!active) return { graphNodes: 0, graphEdges: 0 };
  return {
    graphNodes: active.sourceGraph.nodes.length + (active.sourceGraph.macros || []).length,
    graphEdges: active.sourceGraph.edges.length,
  };
}

export async function seedDummyUpstreamRoutes(): Promise<DummyUpstreamSeedSummary> {
  const site = await ensureDummySite();
  const account = await ensureDummyAccount(site.id);
  const tokenIds: number[] = [];

  for (const model of DUMMY_UPSTREAM_MODELS) {
    tokenIds.push(await ensureDummyToken(account.id, model.tokenName, model.name));
  }

  const rebuild = await routeRefreshWorkflow.rebuildRoutesOnly();

  await applyDummyRouteWeights();

  const routeRuntimeSummary = await loadRouteRuntimeGraphSummary();

  return {
    siteId: site.id,
    accountId: account.id,
    tokenIds,
    modelNames: DUMMY_UPSTREAM_MODELS.map((model) => model.name),
    routes: DUMMY_UPSTREAM_MODELS.length,
    channels: tokenIds.length,
    graphNodes: routeRuntimeSummary.graphNodes,
    graphEdges: routeRuntimeSummary.graphEdges,
    rebuild,
  };
}
