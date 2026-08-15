import { and, eq, gte, lt } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import {
  resolveStoredAccountCredentialMode,
  buildAccountConnectionValues,
  type StoredAccountCredentialMode,
} from "./accountExtraConfig.js";
import {
  buildAccountCapabilities,
  type AccountCapabilities,
} from './accountCapabilities.js';
import { getAdapter } from './platforms/index.js';
import {
  buildRuntimeHealthForAccount,
  type RuntimeHealthInfo,
} from "./accountHealthService.js";
import { parseCheckinRewardAmount } from "./checkinRewardParser.js";
import { getLocalDayRangeUtc } from "./localTimeService.js";
import {
  clearSnapshotCache,
  readSnapshotCache,
  type SnapshotEnvelope,
} from "./snapshotCacheService.js";
import { estimateRewardWithTodayIncomeFallback } from "./todayIncomeRewardService.js";
import { createAdminSnapshotPersistence, deleteAdminSnapshot } from "./adminSnapshotStore.js";
import { listValuedRequestCostFacts } from "./billingCostValuationService.js";
import { buildApiKeyAccountHealth, listAccountTokenHealth } from './accountTokenHealthService.js';

export type AccountOverviewRow = typeof schema.accounts.$inferSelect & {
  site: typeof schema.sites.$inferSelect;
  credentialMode: StoredAccountCredentialMode;
  capabilities: AccountCapabilities;
  todaySpend: number;
  todaySpendUnit: string;
  todaySpendKnownObservationCount: number;
  todaySpendUnknownObservationCount: number;
  todaySpendIncompatibleObservationCount: number;
  todayReward: number;
  runtimeHealth: RuntimeHealthInfo;
  apiKeyHealth: RuntimeHealthInfo | null;
  accountConnectionFields: readonly unknown[];
  connectionValues: Record<string, unknown>;
};

export type AccountsSnapshotPayload = {
  accounts: AccountOverviewRow[];
  sites: Array<typeof schema.sites.$inferSelect>;
};

const ACCOUNTS_SNAPSHOT_TTL_MS = 15_000;
const accountsSnapshotPersistence =
  createAdminSnapshotPersistence<AccountsSnapshotPayload>({
    namespace: "accounts-snapshot",
    key: "all",
  });

/** Invalidates the shared account/site picker snapshot after catalog writes. */
export async function invalidateAccountsSnapshot(): Promise<void> {
  clearSnapshotCache("accounts-snapshot");
  await deleteAdminSnapshot({ namespace: "accounts-snapshot", key: "all" });
}

function resolveStoredCredentialMode(
  account: typeof schema.accounts.$inferSelect,
): StoredAccountCredentialMode {
  return resolveStoredAccountCredentialMode(account);
}

function buildCapabilitiesForAccount(
  account: typeof schema.accounts.$inferSelect,
): AccountCapabilities {
  return buildAccountCapabilities(account);
}

async function loadAccountsSnapshotPayload(): Promise<AccountsSnapshotPayload> {
  const [rows, sites] = await Promise.all([
    db
      .select()
      .from(schema.accounts)
      .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
      .all(),
    db.select().from(schema.sites).all(),
  ]);

  const { localDay, startUtc, endUtc } = getLocalDayRangeUtc();

  const [valuedCosts, todayCheckins, accountTokens] = await Promise.all([
    listValuedRequestCostFacts({ fromDay: localDay, toDay: localDay }),
    db
      .select({
        accountId: schema.checkinLogs.accountId,
        reward: schema.checkinLogs.reward,
        message: schema.checkinLogs.message,
      })
      .from(schema.checkinLogs)
      .where(
        and(
          gte(schema.checkinLogs.createdAt, startUtc),
          lt(schema.checkinLogs.createdAt, endUtc),
          eq(schema.checkinLogs.status, "success"),
        ),
      )
      .all(),
    db.select().from(schema.accountTokens).all(),
  ]);

  const tokenHealthById = await listAccountTokenHealth(accountTokens.map((token) => token.id));
  const tokensByAccountId = new Map<number, typeof accountTokens>();
  for (const token of accountTokens) {
    const current = tokensByAccountId.get(token.accountId) || [];
    current.push(token);
    tokensByAccountId.set(token.accountId, current);
  }

  const spendByAccount = new Map<number, { amount: number; known: number; unknown: number; incompatible: number }>();
  for (const fact of valuedCosts.facts) {
    const current = spendByAccount.get(fact.accountId) || { amount: 0, known: 0, unknown: 0, incompatible: 0 };
    current.amount += fact.amount ?? 0;
    current.known += fact.knownObservationCount;
    current.unknown += fact.unknownObservationCount;
    current.incompatible += fact.incompatibleObservationCount;
    spendByAccount.set(fact.accountId, current);
  }

  const rewardByAccount: Record<number, number> = {};
  const successCountByAccount: Record<number, number> = {};
  const parsedRewardCountByAccount: Record<number, number> = {};
  for (const log of todayCheckins) {
    successCountByAccount[log.accountId] =
      (successCountByAccount[log.accountId] || 0) + 1;
    const rewardNum =
      parseCheckinRewardAmount(log.reward) ||
      parseCheckinRewardAmount(log.message);
    if (rewardNum <= 0) continue;
    rewardByAccount[log.accountId] =
      (rewardByAccount[log.accountId] || 0) + rewardNum;
    parsedRewardCountByAccount[log.accountId] =
      (parsedRewardCountByAccount[log.accountId] || 0) + 1;
  }

  return {
    accounts: rows.map((row) => {
      const credentialMode = resolveStoredCredentialMode(row.accounts);
      const capabilities = buildCapabilitiesForAccount(row.accounts);
      const apiKeyHealth = credentialMode === 'apikey'
        ? buildApiKeyAccountHealth(tokensByAccountId.get(row.accounts.id) || [], tokenHealthById)
        : null;
      return {
        ...row.accounts,
        site: {
          ...row.sites,
          credentialCapabilities: getAdapter(row.sites.platform)?.credentialCapabilities,
        },
        credentialMode,
        capabilities,
        todaySpend: Math.round((spendByAccount.get(row.accounts.id)?.amount || 0) * 1_000_000) / 1_000_000,
        todaySpendUnit: valuedCosts.baseCostUnit,
        todaySpendKnownObservationCount: spendByAccount.get(row.accounts.id)?.known || 0,
        todaySpendUnknownObservationCount: spendByAccount.get(row.accounts.id)?.unknown || 0,
        todaySpendIncompatibleObservationCount: spendByAccount.get(row.accounts.id)?.incompatible || 0,
        todayReward:
          Math.round(
            estimateRewardWithTodayIncomeFallback({
              day: localDay,
              successCount: successCountByAccount[row.accounts.id] || 0,
              parsedRewardCount:
                parsedRewardCountByAccount[row.accounts.id] || 0,
              rewardSum: rewardByAccount[row.accounts.id] || 0,
              extraConfig: row.accounts.extraConfig,
            }) * 1_000_000,
          ) / 1_000_000,
        runtimeHealth: buildRuntimeHealthForAccount({
          accountStatus: row.accounts.status,
          siteStatus: row.sites.status,
          extraConfig: row.accounts.extraConfig,
          credentialMode: row.accounts.credentialMode,
          oauthProvider: row.accounts.oauthProvider,
          sessionCapable: capabilities.canRefreshBalance,
        }),
        apiKeyHealth,
        accountConnectionFields: getAdapter(row.sites.platform)?.accountConnectionFields || [],
        connectionValues: buildAccountConnectionValues(
          getAdapter(row.sites.platform)?.accountConnectionFields || [],
          row.accounts.extraConfig,
        ),
      };
    }),
    sites: sites.map((site) => ({
      ...site,
      accountConnectionFields: getAdapter(site.platform)?.accountConnectionFields || [],
      credentialCapabilities: getAdapter(site.platform)?.credentialCapabilities,
    })),
  };
}

export async function getAccountsSnapshot(options?: {
  forceRefresh?: boolean;
}): Promise<SnapshotEnvelope<AccountsSnapshotPayload>> {
  return readSnapshotCache({
    namespace: "accounts-snapshot",
    key: "all",
    ttlMs: ACCOUNTS_SNAPSHOT_TTL_MS,
    forceRefresh: options?.forceRefresh,
    persistence: accountsSnapshotPersistence,
    loader: loadAccountsSnapshotPayload,
  });
}
