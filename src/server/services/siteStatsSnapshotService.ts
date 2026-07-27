import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { getLocalRangeStartDayKey } from "./localTimeService.js";
import {
  readSnapshotCache,
  type SnapshotEnvelope,
} from "./snapshotCacheService.js";
import {
  toRoundedMicroNumber,
} from "./statsShared.js";
import { createAdminSnapshotPersistence } from "./adminSnapshotStore.js";
import {
  runUsageAggregationProjectionPass,
} from "./usageAggregationService.js";
import {
  valueWalletBalanceInBaseUnit,
} from "./walletBalanceValuationService.js";
import { listValuedRequestCostFacts } from "./billingCostValuationService.js";

export type SiteStatsSnapshotPayload = {
  distribution: Array<{
    siteId: number;
    siteName: string;
    platform: string | null;
    totalBalance: number;
    rawBalance: number;
    rawBalanceUnit: string | null;
    rawBalanceUnitMixed: boolean;
    baseCostUnit: string;
    valuedAccountCount: number;
    valuationWarningCount: number;
    totalSpend: number;
    spendKnownObservationCount: number;
    spendUnknownObservationCount: number;
    spendIncompatibleObservationCount: number;
    accountCount: number;
  }>;
  trend: Array<{
    date: string;
    sites: Record<string, { spend: number; calls: number }>;
  }>;
  sites: Array<typeof schema.sites.$inferSelect>;
};

const SITE_STATS_TTL_MS = 15_000;

async function loadSiteStatsSnapshotPayload(
  days: number,
): Promise<SiteStatsSnapshotPayload> {
  const sinceDay = getLocalRangeStartDayKey(days);
  await runUsageAggregationProjectionPass();

  const [trendRows, sites, accountRows, valuedCosts] =
    await Promise.all([
    db
      .select()
      .from(schema.siteDayUsage)
      .where(sql`${schema.siteDayUsage.localDay} >= ${sinceDay}`)
      .all(),
    db
      .select()
      .from(schema.sites)
      .where(eq(schema.sites.status, "active"))
      .all(),
    db
      .select({
        accountId: schema.accounts.id,
        siteId: schema.sites.id,
        siteName: schema.sites.name,
        platform: schema.sites.platform,
        balance: schema.accounts.balance,
      })
      .from(schema.accounts)
      .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
      .where(eq(schema.sites.status, "active"))
      .all(),
    listValuedRequestCostFacts(),
  ]);

  const spendBySiteId = new Map<number, {
    amount: number;
    known: number;
    unknown: number;
    incompatible: number;
  }>();
  for (const fact of valuedCosts.facts) {
    const current = spendBySiteId.get(fact.siteId) || { amount: 0, known: 0, unknown: 0, incompatible: 0 };
    current.amount += fact.amount ?? 0;
    current.known += fact.knownObservationCount;
    current.unknown += fact.unknownObservationCount;
    current.incompatible += fact.incompatibleObservationCount;
    spendBySiteId.set(fact.siteId, current);
  }

  const valuationRows = await Promise.all(accountRows.map(async (row) => ({
    row,
    valuation: await valueWalletBalanceInBaseUnit({
      siteId: row.siteId,
      accountId: row.accountId,
      balance: row.balance,
    }),
  })));

  const distributionBySiteId = new Map<number, {
    siteId: number;
    siteName: string;
    platform: string | null;
    totalBalance: number;
    rawBalance: number;
    rawBalanceUnits: Set<string>;
    baseCostUnit: string;
    valuedAccountCount: number;
    valuationWarningCount: number;
    totalSpend: number;
    spendKnownObservationCount: number;
    spendUnknownObservationCount: number;
    spendIncompatibleObservationCount: number;
    accountCount: number;
  }>();

  for (const { row, valuation } of valuationRows) {
    const current = distributionBySiteId.get(row.siteId) || {
      siteId: row.siteId,
      siteName: row.siteName,
      platform: row.platform,
      totalBalance: 0,
      rawBalance: 0,
      rawBalanceUnits: new Set<string>(),
      baseCostUnit: valuation.baseCostUnit,
      valuedAccountCount: 0,
      valuationWarningCount: 0,
      totalSpend: toRoundedMicroNumber(spendBySiteId.get(row.siteId)?.amount || 0),
      spendKnownObservationCount: spendBySiteId.get(row.siteId)?.known || 0,
      spendUnknownObservationCount: spendBySiteId.get(row.siteId)?.unknown || 0,
      spendIncompatibleObservationCount: spendBySiteId.get(row.siteId)?.incompatible || 0,
      accountCount: 0,
    };
    current.accountCount += 1;
    current.rawBalance += valuation.balance;
    if (valuation.walletUnit) current.rawBalanceUnits.add(valuation.walletUnit);
    if (valuation.normalizedValue != null) {
      current.totalBalance += valuation.normalizedValue;
      current.valuedAccountCount += 1;
    }
    current.valuationWarningCount += valuation.diagnostics.filter((item) => item.level === 'warn' || item.level === 'error').length;
    distributionBySiteId.set(row.siteId, current);
  }

  const distribution = [...distributionBySiteId.values()].map((row) => {
    const rawBalanceUnits = [...row.rawBalanceUnits];
    return {
      siteId: row.siteId,
      siteName: row.siteName,
      platform: row.platform,
      totalBalance: toRoundedMicroNumber(row.totalBalance),
      rawBalance: toRoundedMicroNumber(row.rawBalance),
      rawBalanceUnit: rawBalanceUnits.length === 1 ? rawBalanceUnits[0] : null,
      rawBalanceUnitMixed: rawBalanceUnits.length > 1,
      baseCostUnit: row.baseCostUnit,
      valuedAccountCount: row.valuedAccountCount,
      valuationWarningCount: row.valuationWarningCount,
      totalSpend: row.totalSpend,
      spendKnownObservationCount: row.spendKnownObservationCount,
      spendUnknownObservationCount: row.spendUnknownObservationCount,
      spendIncompatibleObservationCount: row.spendIncompatibleObservationCount,
      accountCount: row.accountCount,
    };
  });

  const dayMap: Record<
    string,
    Record<string, { spend: number; calls: number }>
  > = {};
  const activeSiteById = new Map<number, (typeof schema.sites.$inferSelect)>(
    sites.map((site) => [site.id, site]),
  );
  for (const row of trendRows) {
    const site = activeSiteById.get(row.siteId);
    if (!site) continue;
    const siteName = site.name || "unknown";
    const date = row.localDay;

    if (!dayMap[date]) dayMap[date] = {};
    if (!dayMap[date][siteName])
      dayMap[date][siteName] = { spend: 0, calls: 0 };

    dayMap[date][siteName].calls += Number(row.totalCalls || 0);
  }

  for (const fact of valuedCosts.facts) {
    if (fact.bucketStart < sinceDay || fact.amount == null) continue;
    const site = activeSiteById.get(fact.siteId);
    if (!site) continue;
    const siteName = site.name || "unknown";
    if (!dayMap[fact.bucketStart]) dayMap[fact.bucketStart] = {};
    if (!dayMap[fact.bucketStart][siteName]) {
      dayMap[fact.bucketStart][siteName] = { spend: 0, calls: 0 };
    }
    dayMap[fact.bucketStart][siteName].spend += fact.amount;
  }

  const trend = Object.entries(dayMap)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({
      date,
      sites: Object.fromEntries(
        Object.entries(value).map(([siteName, stats]) => [
          siteName,
          {
            spend: toRoundedMicroNumber(stats.spend),
            calls: stats.calls,
          },
        ]),
      ),
    }));

  return {
    distribution,
    trend,
    sites,
  };
}

export async function getSiteStatsSnapshot(options?: {
  days?: number;
  forceRefresh?: boolean;
}): Promise<SnapshotEnvelope<SiteStatsSnapshotPayload>> {
  const days = Math.max(1, Math.trunc(options?.days || 7));
  return readSnapshotCache({
    namespace: "site-stats",
    key: JSON.stringify({ days }),
    ttlMs: SITE_STATS_TTL_MS,
    forceRefresh: options?.forceRefresh,
    persistence: createAdminSnapshotPersistence<SiteStatsSnapshotPayload>({
      namespace: "site-stats",
      key: JSON.stringify({ days }),
    }),
    loader: async () => loadSiteStatsSnapshotPayload(days),
  });
}
