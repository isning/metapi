import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { api, type DownstreamApiKeyTrendResponse } from '../../api.js';
import { useToast } from '../../components/Toast.js';
import { readClientTimeZone } from '../helpers/siteAnnouncementPresentation.js';
import { Badge } from '../../components/ui/badge/index.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card/index.js';
import { ScrollArea } from '../../components/ui/scroll-area/index.js';
import * as Sheet from '../../components/ui/sheet/index.js';
import { Skeleton } from '../../components/ui/skeleton/index.js';
import {
  formatCompactTokens,
  formatIso,
  formatMoney,
  type OverviewResponse,
  RangeToggle,
  resolveOverviewUsageByRange,
  StatusBadge,
  TagChips,
  TrendChartFallback,
  type Range,
  type SummaryItem,
} from './shared.js';

import { tr } from '../../i18n.js';
const DownstreamKeyTrendChart = lazy(() => import('../../components/charts/DownstreamKeyTrendChart.js'));
type DownstreamKeyTrendBucket = import('../../components/charts/DownstreamKeyTrendChart.js').DownstreamKeyTrendBucket;

type DownstreamKeyDrawerProps = {
  open: boolean;
  onClose: () => void;
  item: SummaryItem | null;
  initialRange: Range;
};

export default function DownstreamKeyDrawer({
  open,
  onClose,
  item,
  initialRange,
}: DownstreamKeyDrawerProps) {
  const toast = useToast();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [trendRange, setTrendRange] = useState<Range>(initialRange);
  const [trendLoading, setTrendLoading] = useState(false);
  const [buckets, setBuckets] = useState<DownstreamKeyTrendBucket[]>([]);
  const [trendBucketSeconds, setTrendBucketSeconds] = useState<number>(initialRange === 'all' ? 86400 : 3600);
  const viewerTimeZone = useMemo(() => readClientTimeZone(), []);

  useEffect(() => {
    if (!open) return;
    setTrendRange(initialRange);
    setTrendBucketSeconds(initialRange === 'all' ? 86400 : 3600);
  }, [open, initialRange]);

  useEffect(() => {
    if (!open || !item?.id) return;
    let cancelled = false;
    setOverview(null);
    setOverviewLoading(true);
    api.getDownstreamApiKeyOverview(item.id)
      .then((res: any) => {
        if (cancelled) return;
        setOverview(res as OverviewResponse);
      })
      .catch((err: any) => {
        if (cancelled) return;
        toast.error(err?.message || tr('pages.downstreamKeys.downstreamKeyDrawer.keyFailed'));
      })
      .finally(() => {
        if (cancelled) return;
        setOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, item?.id, toast]);

  useEffect(() => {
    if (!open || !item?.id) return;
    let cancelled = false;
    const fallbackBucketSeconds = trendRange === 'all' ? 86400 : 3600;
    setBuckets([]);
    setTrendBucketSeconds(fallbackBucketSeconds);
    setTrendLoading(true);
    const trendParams = trendRange === 'all' && viewerTimeZone
      ? { range: trendRange, timeZone: viewerTimeZone }
      : { range: trendRange };
    api.getDownstreamApiKeyTrend(item.id, trendParams)
      .then((res: DownstreamApiKeyTrendResponse) => {
        if (cancelled) return;
        setBuckets(Array.isArray(res.buckets) ? res.buckets : []);
        const nextBucketSeconds = Number(res.bucketSeconds);
        setTrendBucketSeconds(Number.isFinite(nextBucketSeconds) && nextBucketSeconds > 0 ? nextBucketSeconds : fallbackBucketSeconds);
      })
      .catch((err: any) => {
        if (cancelled) return;
        toast.error(err?.message || tr('pages.downstreamKeys.downstreamKeyDrawer.failed'));
      })
      .finally(() => {
        if (cancelled) return;
        setTrendLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, item?.id, trendRange, toast, viewerTimeZone]);

  const currentRangeUsage = resolveOverviewUsageByRange(overview, trendRange) || item?.rangeUsage || null;

  return (
    <Sheet.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Sheet.Content side="right" className="flex h-full w-[min(92vw,560px)] max-w-none flex-col p-0" onClose={onClose}>
        <Sheet.Header className="border-b px-4 py-4">
          <div className="flex flex-wrap items-start gap-3 pr-8">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Sheet.Title className="truncate">{item?.name || '--'}</Sheet.Title>
                <StatusBadge enabled={!!item?.enabled} />
              </div>
              <Sheet.Description>{item?.keyMasked || '****'}</Sheet.Description>
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant={item?.groupName ? 'default' : 'secondary'}>
                  {item?.groupName ? `主分组 · ${item.groupName}` : tr('pages.downstreamKeys.ungrouped')}
                </Badge>
                <TagChips tags={item?.tags || []} accent maxVisible={4} />
              </div>
            </div>
          </div>
        </Sheet.Header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4">
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <CardTitle>{tr('pages.downstreamKeys.downstreamKeyDrawer.usageTrend')}</CardTitle>
                  <CardDescription>{tr('pages.downstreamKeys.downstreamKeyDrawer.timeViewingrequestTokensCost')}</CardDescription>
                </div>
                <RangeToggle range={trendRange} onChange={setTrendRange} />
              </CardHeader>
              <CardContent>
                <Suspense fallback={<TrendChartFallback height={260} />}>
                  <DownstreamKeyTrendChart buckets={buckets} bucketSeconds={trendBucketSeconds} loading={trendLoading} height={260} />
                </Suspense>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{tr('pages.proxyLogs.basicInfo')}</CardTitle>
              </CardHeader>
              <CardContent>
                {overviewLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : (
                  <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <InfoCell label={tr('pages.downstreamKeys.recentUsage')} value={formatIso(item?.lastUsedAt)} />
                    <InfoCell label={tr('pages.downstreamKeys.downstreamKeyDrawer.totalRequests')} value={(item?.usedRequests || 0).toLocaleString()} />
                    <InfoCell label={tr('pages.downstreamKeys.cost')} value={formatMoney(Number(item?.usedCost || 0))} />
                    <InfoCell label={tr('pages.downstreamKeys.downstreamKeyDrawer.time')} value={formatIso(item?.expiresAt)} />
                    <InfoCell label={tr('pages.downstreamKeys.primaryGroup')} value={item?.groupName || tr('pages.downstreamKeys.ungrouped')} />
                    <div className="space-y-1 sm:col-span-2">
                      <div className="text-xs text-muted-foreground">{tr('pages.downstreamKeys.tags2')}</div>
                      <TagChips tags={item?.tags || []} accent maxVisible={6} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{tr('pages.downstreamKeys.downstreamKeyDrawer.currentRangeSummary')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <InfoCell label="Tokens" value={formatCompactTokens(currentRangeUsage?.totalTokens || 0)} strong />
                  <InfoCell label={tr('components.charts.downstreamKeyTrendChart.requests')} value={(currentRangeUsage?.totalRequests || 0).toLocaleString()} strong />
                  <InfoCell label={tr('components.modelAnalysisPanel.successRate')} value={currentRangeUsage?.successRate == null ? '--' : `${currentRangeUsage.successRate}%`} strong />
                  <InfoCell label={tr('components.charts.downstreamKeyTrendChart.cost')} value={formatMoney(Number(currentRangeUsage?.totalCost || 0))} strong />
                </div>
              </CardContent>
            </Card>

            {overview?.usage ? (
              <Card>
                <CardHeader>
                  <CardTitle>{tr('pages.downstreamKeys.downstreamKeyDrawer.fixedWindowComparison')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {[
                      { label: '24h', data: overview.usage.last24h },
                      { label: '7d', data: overview.usage.last7d },
                      { label: tr('components.notificationPanel.all'), data: overview.usage.all },
                    ].map((section) => (
                      <Card key={section.label}>
                        <CardContent className="space-y-2 pt-3 text-sm">
                          <div className="font-semibold">{section.label}</div>
                          <InfoCell label="Tokens" value={formatCompactTokens(section.data?.totalTokens || 0)} strong />
                          <InfoCell label={tr('components.charts.downstreamKeyTrendChart.requests')} value={(section.data?.totalRequests || 0).toLocaleString()} strong />
                          <InfoCell label={tr('components.modelAnalysisPanel.successRate')} value={section.data?.successRate == null ? '--' : `${section.data.successRate}%`} strong />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </ScrollArea>
      </Sheet.Content>
    </Sheet.Root>
  );
}

function InfoCell({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={strong ? 'font-semibold' : 'font-medium'}>{value}</div>
    </div>
  );
}
