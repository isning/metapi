import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { insertAndGetById } from '../db/insertHelpers.js';
import { isApiKeyAccount } from './accountExtraConfig.js';
import { listAllAccountTokens } from './accountTokenService.js';

export type SiteApiKeyMigrationSummary = {
  migrated: number;
  deduped: number;
  clearedSites: number;
  warned: number;
};

function normalizeTokenValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isApiKeyConnection(account: typeof schema.accounts.$inferSelect): boolean {
  return isApiKeyAccount(account);
}

async function clearSiteApiKey(siteId: number) {
  await db.update(schema.sites)
    .set({
      apiKey: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.sites.id, siteId))
    .run();
}

export async function migrateSiteApiKeysToAccounts(): Promise<SiteApiKeyMigrationSummary> {
  const summary: SiteApiKeyMigrationSummary = {
    migrated: 0,
    deduped: 0,
    clearedSites: 0,
    warned: 0,
  };

  const sites = await db.select().from(schema.sites).all();
  if (sites.length === 0) return summary;

  const accounts = await db.select().from(schema.accounts).all();
  const accountTokens = await listAllAccountTokens();
  let nextSortOrder = accounts.reduce((max, account) => Math.max(max, account.sortOrder || 0), -1) + 1;

  for (const site of sites) {
    const siteApiKey = normalizeTokenValue(site.apiKey);
    if (!siteApiKey) continue;

    let targetAccount = accounts.find((account) => (
      account.siteId === site.id
      && isApiKeyConnection(account)
      && accountTokens.some((token) => (
        token.accountId === account.id
        && normalizeTokenValue(token.token) === siteApiKey
      ))
    )) || null;

    if (targetAccount) {
      summary.deduped += 1;
    } else {
      targetAccount = await db.transaction(async (tx) => {
        const created = await insertAndGetById<typeof schema.accounts.$inferSelect>({
          txDb: tx,
          table: schema.accounts,
          idColumn: schema.accounts.id,
          values: {
            siteId: site.id,
            username: null,
            credentialMode: 'apikey',
            credential: '',
            credentialKind: 'none',
            checkinEnabled: false,
            status: 'active',
            isPinned: false,
            sortOrder: nextSortOrder,
          },
          insertErrorMessage: 'failed to create migrated site account',
          loadErrorMessage: 'failed to create migrated site account',
        });
        const inserted = await tx.insert(schema.accountTokens).values({
          accountId: created.id,
          name: 'default',
          token: siteApiKey,
          tokenGroup: 'default',
          valueStatus: 'ready',
          source: 'migration',
          enabled: true,
          isDefault: true,
        }).run();
        if (!inserted) throw new Error('failed to create migrated site API key');
        return created;
      });
      accounts.push(targetAccount);
      nextSortOrder += 1;
      summary.migrated += 1;
    }

    await clearSiteApiKey(site.id);
    summary.clearedSites += 1;
  }

  return summary;
}
