import { eq, isNotNull, isNull, or } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { invalidateRouteGraphReadCaches } from '../routeGraphService.js';
import { getOauthInfoFromExtraConfig } from './oauthAccount.js';

let inFlightOauthIdentityBackfill: Promise<number> | null = null;

type AccountOauthIdentity = Pick<
  typeof schema.accounts.$inferSelect,
  'extraConfig' | 'oauthProvider' | 'oauthAccountKey' | 'oauthProjectId'
>;

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildOauthIdentityBackfillPatch(
  account: AccountOauthIdentity,
): Partial<Pick<AccountOauthIdentity, 'oauthProvider' | 'oauthAccountKey' | 'oauthProjectId'>> | null {
  const legacyIdentity = getOauthInfoFromExtraConfig(account.extraConfig);
  if (!legacyIdentity?.provider) return null;

  const patch: Partial<Pick<AccountOauthIdentity, 'oauthProvider' | 'oauthAccountKey' | 'oauthProjectId'>> = {};
  if (!trimmed(account.oauthProvider)) patch.oauthProvider = legacyIdentity.provider;
  if (!trimmed(account.oauthAccountKey) && (legacyIdentity.accountKey || legacyIdentity.accountId)) {
    patch.oauthAccountKey = legacyIdentity.accountKey || legacyIdentity.accountId;
  }
  if (!trimmed(account.oauthProjectId) && legacyIdentity.projectId) {
    patch.oauthProjectId = legacyIdentity.projectId;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

async function runOauthIdentityBackfill(): Promise<number> {
  const rows = await db.select().from(schema.accounts)
    .where(or(
      isNotNull(schema.accounts.extraConfig),
      isNull(schema.accounts.oauthProvider),
    ))
    .all();

  let updated = 0;
  for (const row of rows) {
    const patch = buildOauthIdentityBackfillPatch(row);
    if (!patch) continue;
    await db.update(schema.accounts).set({
      ...patch,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.accounts.id, row.id)).run();
    updated += 1;
  }

  // This backfill also runs from the OAuth listing endpoint, after request
  // routing may already have cached account identities.
  if (updated > 0) {
    invalidateRouteGraphReadCaches('account-mutated');
  }

  return updated;
}

export async function ensureOauthIdentityBackfill(): Promise<number> {
  if (inFlightOauthIdentityBackfill) return inFlightOauthIdentityBackfill;

  inFlightOauthIdentityBackfill = (async () => {
    try {
      return await runOauthIdentityBackfill();
    } finally {
      inFlightOauthIdentityBackfill = null;
    }
  })();

  return inFlightOauthIdentityBackfill;
}
