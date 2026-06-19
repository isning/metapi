import { Suspense, lazy, useEffect, useState, useCallback, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, Building2, Clock3, ExternalLink, Gauge, RefreshCw, Server, Zap } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "../components/Toast.js";
import { useIsMobile } from "../components/useIsMobile.js";
import { formatCompactTokenMetric } from "../numberFormat.js";
import { Button } from '../components/ui/button/index.js';
import { Skeleton } from '../components/ui/skeleton/index.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card/index.js';
import ToneBadge from '../components/ToneBadge.js';
import { cn } from "../lib/utils.js";

const ModelAnalysisPanel = lazy(
  () => import("../components/ModelAnalysisPanel.js"),
);
const SiteDistributionChart = lazy(
  () => import("../components/charts/SiteDistributionChart.js"),
);
const SiteTrendChart = lazy(
  () => import("../components/charts/SiteTrendChart.js"),
);

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "🌙 夜深了";
  if (hour < 11) return "☀️ 早上好";
  if (hour < 13) return "👋 中午好";
  if (hour < 18) return "🌤️ 下午好";
  return "🌙 晚上好";
}

function safeNumber(value: unknown): number {
  if (
    typeof value !== "number" ||
    Number.isNaN(value) ||
    !Number.isFinite(value)
  )
    return 0;
  return value;
}

function ChartFallback({ height = 280 }: { height?: number }) {
  const frameClass = height >= 320 ? "min-h-80" : "min-h-64";
  return (
    <Card className={cn("p-4", frameClass)}>
      <Skeleton className="mb-2 h-5 w-40" />
      <Skeleton className={cn("w-full", height >= 320 ? "h-64" : "h-48")} />
    </Card>
  );
}

function StatCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {children}
      </CardContent>
    </Card>
  );
}

function StatRow({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
    </div>
  );
}

function MetricBadge({ value }: { value: number | null | undefined }) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return <ToneBadge tone="muted">未知</ToneBadge>;
  }
  if (value >= 95) return <ToneBadge tone="success">稳定</ToneBadge>;
  if (value >= 80) return <ToneBadge tone="warning">波动</ToneBadge>;
  return <ToneBadge tone="danger">异常</ToneBadge>;
}

function LatencyBadge({ ms }: { ms: number | null | undefined }) {
  if (typeof ms !== "number" || Number.isNaN(ms) || !Number.isFinite(ms)) {
    return <ToneBadge tone="muted">延迟 —</ToneBadge>;
  }
  if (ms <= 800) return <ToneBadge tone="success">{ms}ms</ToneBadge>;
  if (ms <= 1800) return <ToneBadge tone="warning">{ms}ms</ToneBadge>;
  return <ToneBadge tone="danger">{ms}ms</ToneBadge>;
}

function AvailabilityCell({
  bucket,
  siteId,
  siteName,
}: {
  bucket: SiteAvailabilityBucket;
  siteId: number;
  siteName: string;
}) {
  const availability = bucket.availabilityPercent;
  const toneClass =
    bucket.totalRequests <= 0
      ? "bg-muted"
      : typeof availability === "number" && availability >= 95
        ? "bg-primary"
        : typeof availability === "number" && availability >= 80
          ? "bg-secondary"
          : "bg-destructive";

  return (
    <Link
      to={buildAvailabilityBucketLogsRoute(siteId, bucket)}
      className={cn(
        "h-3 rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        toneClass,
        bucket.totalRequests <= 0 && "opacity-40",
      )}
      title={[
        formatAvailabilityBucketLabel(bucket),
        bucket.totalRequests > 0
          ? `可用性 ${formatAvailabilityPercent(bucket.availabilityPercent)}`
          : "无请求",
        `${bucket.successCount} 成功 / ${bucket.failedCount} 失败`,
        bucket.averageLatencyMs != null
          ? `平均响应 ${bucket.averageLatencyMs}ms`
          : "平均响应 —",
      ].join(" | ")}
      aria-label={`${siteName} ${formatAvailabilityBucketLabel(bucket)} 使用日志`}
    />
  );
}

type SiteSpeedState =
  | { status: "loading" }
  | { status: "timeout" }
  | { status: "done"; ms: number }
  | undefined;

type SiteAvailabilityBucket = {
  startUtc?: string | null;
  label: string;
  totalRequests: number;
  successCount: number;
  failedCount: number;
  availabilityPercent: number | null;
  averageLatencyMs: number | null;
};

type SiteAvailabilitySummary = {
  siteId: number;
  siteName: string;
  siteUrl?: string | null;
  platform?: string | null;
  totalRequests: number;
  successCount: number;
  failedCount: number;
  availabilityPercent: number | null;
  averageLatencyMs: number | null;
  buckets: SiteAvailabilityBucket[];
};

function formatAvailabilityPercent(value: number | null | undefined): string {
  if (
    typeof value !== "number" ||
    Number.isNaN(value) ||
    !Number.isFinite(value)
  )
    return "—";
  return `${Math.round(value)}%`;
}

function padDateTimeSegment(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateTimeRouteValue(value: Date): string {
  return `${value.getFullYear()}-${padDateTimeSegment(value.getMonth() + 1)}-${padDateTimeSegment(value.getDate())}T${padDateTimeSegment(value.getHours())}:${padDateTimeSegment(value.getMinutes())}`;
}

function buildSiteLogsRoute(
  siteId: number,
  range?: { from: Date; to: Date },
): string {
  const params = new URLSearchParams();
  params.set("siteId", String(siteId));
  if (range) {
    params.set("from", formatDateTimeRouteValue(range.from));
    params.set("to", formatDateTimeRouteValue(range.to));
  }
  return `/logs?${params.toString()}`;
}

function buildSiteLast24hLogsRoute(siteId: number): string {
  const now = new Date();
  const from = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours() - 23,
    0,
    0,
    0,
  );
  const to = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours() + 1,
    0,
    0,
    0,
  );
  return buildSiteLogsRoute(siteId, { from, to });
}

function parseAvailabilityBucketStart(startUtc?: string | null): Date | null {
  const text = (startUtc || "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseAvailabilityBucketLabel(label: string): Date | null {
  const match = label.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "0"] = match;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    0,
  );
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatAvailabilityBucketLabel(bucket: SiteAvailabilityBucket): string {
  const parsed =
    parseAvailabilityBucketStart(bucket.startUtc) ||
    parseAvailabilityBucketLabel(bucket.label);
  if (!parsed) return bucket.label;
  return `${parsed.getFullYear()}-${padDateTimeSegment(parsed.getMonth() + 1)}-${padDateTimeSegment(parsed.getDate())} ${padDateTimeSegment(parsed.getHours())}:${padDateTimeSegment(parsed.getMinutes())}:${padDateTimeSegment(parsed.getSeconds())}`;
}

function buildAvailabilityBucketLogsRoute(
  siteId: number,
  bucket: SiteAvailabilityBucket,
): string {
  const start =
    parseAvailabilityBucketStart(bucket.startUtc) ||
    parseAvailabilityBucketLabel(bucket.label);
  if (!start) return buildSiteLast24hLogsRoute(siteId);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return buildSiteLogsRoute(siteId, { from: start, to: end });
}

export default function Dashboard({
  adminName = "\u7ba1\u7406\u5458",
}: {
  adminName?: string;
}) {
  const isMobile = useIsMobile();
  const [data, setData] = useState<any>(null);
  const [insightsData, setInsightsData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [siteDistribution, setSiteDistribution] = useState<any[]>([]);
  const [siteTrend, setSiteTrend] = useState<any[]>([]);
  const [siteLoading, setSiteLoading] = useState(true);
  const [sites, setSites] = useState<any[]>([]);
  const [siteSpeedStates, setSiteSpeedStates] = useState<
    Record<string, SiteSpeedState>
  >({});
  const [trendDays, setTrendDays] = useState(7);
  const [showInactiveSites, setShowInactiveSites] = useState(false);
  const toast = useToast();
  const normalizedAdminName = (adminName || "").trim() || "\u7ba1\u7406\u5458";

  const getSiteSpeedKey = (site: any, idx: number) => String(site?.id ?? idx);

  const setSiteSpeedState = (siteKey: string, nextState: SiteSpeedState) => {
    setSiteSpeedStates((current) => ({ ...current, [siteKey]: nextState }));
  };

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const result = await api.getDashboardSnapshot(
          silent ? { refresh: true } : undefined,
        );
        setData(result);
      } catch (err: any) {
        const message = err?.message || "加载仪表盘失败";
        setError(message);
        if (silent) toast.error(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [toast],
  );

  const loadInsights = useCallback(async (forceRefresh = false) => {
    setInsightsLoading(true);
    try {
      const result = await api.getDashboardInsights(
        forceRefresh ? { refresh: true } : undefined,
      );
      setInsightsData(result);
    } catch (err) {
      console.error("Failed to load dashboard insights:", err);
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  const loadSiteStats = useCallback(
    async (forceRefresh = false) => {
      setSiteLoading(true);
      try {
        const snapshot = await api.getSiteSnapshot(
          trendDays,
          forceRefresh ? { refresh: true } : undefined,
        );
        setSiteDistribution(snapshot.distribution || []);
        setSiteTrend(snapshot.trend || []);
        const siteRows = Array.isArray(snapshot.sites) ? snapshot.sites : [];
        setSites(siteRows.filter((site: any) => site?.status !== "disabled"));
        setSiteSpeedStates({});
      } catch (err) {
        console.error("Failed to load site stats:", err);
      } finally {
        setSiteLoading(false);
      }
    },
    [trendDays],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  useEffect(() => {
    loadSiteStats();
  }, [loadSiteStats]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const pollDashboard = async () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      )
        return;
      try {
        const next = await api.getDashboardSnapshot();
        if (!disposed) setData(next);
      } catch {
        // ignore polling errors
      }
    };

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        void pollDashboard();
      }, 30000);
    };

    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const handleVisibilityChange = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      ) {
        void pollDashboard();
        start();
      } else {
        stop();
      }
    };

    handleVisibilityChange();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      disposed = true;
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-20" />
              </CardHeader>
              <CardContent className="grid gap-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="grid gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          {getGreeting() + "\uFF0C" + normalizedAdminName}
        </h2>
        <Card>
          <CardContent className="grid justify-items-center gap-3 p-12 text-center">
            <AlertTriangle className="size-10 text-destructive" />
            <div className="font-semibold">加载失败</div>
            <div className="text-sm text-muted-foreground">{error}</div>
            <Button type="button" onClick={() => load()}>
              重试
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalBalance = safeNumber(data?.totalBalance);
  const totalUsed = safeNumber(data?.totalUsed || 0);
  const todaySpend = safeNumber(data?.todaySpend || 0);
  const todayReward = safeNumber(data?.todayReward || 0);
  const activeAccounts = safeNumber(data?.activeAccounts);
  const totalAccounts = safeNumber(data?.totalAccounts);
  const todaySuccess = safeNumber(data?.todayCheckin?.success);
  const todayTotal = safeNumber(data?.todayCheckin?.total);
  const proxy24hSuccess = safeNumber(data?.proxy24h?.success);
  const proxy24hTotal = safeNumber(data?.proxy24h?.total);
  const totalTokens = safeNumber(data?.proxy24h?.totalTokens);
  const performanceWindowSeconds = Math.max(
    1,
    safeNumber(data?.performance?.windowSeconds) || 60,
  );
  const requestsPerMinute = safeNumber(data?.performance?.requestsPerMinute);
  const tokensPerMinute = safeNumber(data?.performance?.tokensPerMinute);
  const rawSiteAvailability: SiteAvailabilitySummary[] = Array.isArray(
    insightsData?.siteAvailability,
  )
    ? insightsData.siteAvailability
    : [];
  const activeSites = rawSiteAvailability
    .filter((s) => s.totalRequests > 0)
    .sort((a, b) => (b.totalRequests || 0) - (a.totalRequests || 0));
  const inactiveSites = rawSiteAvailability.filter(
    (s) => !s.totalRequests || s.totalRequests === 0,
  );
  const siteAvailability = showInactiveSites
    ? [...activeSites, ...inactiveSites]
    : activeSites;

  const renderSiteSpeedLabel = (site: any, idx: number) => {
    const siteKey = getSiteSpeedKey(site, idx);
    const speedState = siteSpeedStates[siteKey];

    if (!speedState || speedState.status === "loading") {
      return speedState ? "..." : "测速";
    }

    if (speedState.status === "timeout") {
      return "超时";
    }

    const ms = speedState.ms;
    return `${ms}ms`;
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">
          {getGreeting() + "\uFF0C" + normalizedAdminName}
        </h2>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void load(true);
              void loadInsights(true);
              void loadSiteStats(true);
            }}
            disabled={refreshing}
           
            data-tooltip="刷新"
            aria-label="刷新"
          >
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard title="账户数据">
          <StatRow
            label="当前余额"
            value={`$${totalBalance.toFixed(2)}`}
            note={`今日 +${todayReward.toFixed(2)}`}
          />
          <StatRow
            label="累计消耗"
            value={`$${totalUsed.toFixed(2)}`}
            note={`今日 -${todaySpend.toFixed(2)}`}
          />
        </StatCard>

        <StatCard title="使用统计">
          <StatRow label="24h 请求" value={Math.round(proxy24hTotal).toLocaleString()} />
          <StatRow label="成功请求" value={Math.round(proxy24hSuccess).toLocaleString()} />
        </StatCard>

        <StatCard title="资源消耗">
          <StatRow label="活跃账户" value={`${Math.round(activeAccounts)}/${Math.round(totalAccounts)}`} />
          <StatRow label="24h Tokens" value={formatCompactTokenMetric(totalTokens)} />
        </StatCard>

        <StatCard title="签到状态">
          <StatRow label="今日签到" value={`${Math.round(todaySuccess)}/${Math.round(todayTotal)}`} />
          <StatRow
            label="成功率"
            value={`${todayTotal > 0 ? Math.round((todaySuccess / todayTotal) * 100) : 0}%`}
          />
        </StatCard>

        <StatCard title="性能指标">
          <StatRow
            label="RPM"
            value={Math.round(requestsPerMinute).toLocaleString()}
            note={`最近 ${performanceWindowSeconds} 秒请求`}
          />
          <StatRow
            label="TPM"
            value={formatCompactTokenMetric(tokensPerMinute)}
            note={`最近 ${performanceWindowSeconds} 秒 Tokens`}
          />
        </StatCard>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4" />
          站点分析
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <Button
              key={d}
              type="button"
              size="sm"
              variant={trendDays === d ? "default" : "outline"}
              onClick={() => setTrendDays(d)}
            >
              {d}天
            </Button>
          ))}
        </div>
      </div>

      <div className={cn("grid gap-4", !isMobile && "lg:grid-cols-2")}>
        <div>
          <Suspense fallback={<ChartFallback height={320} />}>
            <SiteDistributionChart
              data={siteDistribution}
              loading={siteLoading}
            />
          </Suspense>
        </div>
        <div>
          <Suspense fallback={<ChartFallback height={320} />}>
            <SiteTrendChart data={siteTrend} loading={siteLoading} />
          </Suspense>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" />
              站点可用性观测
              <ToneBadge tone="info">
                {activeSites.length}/{rawSiteAvailability.length}
              </ToneBadge>
            </CardTitle>
            <CardDescription>最近 24 小时 · 每个色块表示 1 小时 · 按使用量排序</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>低</span>
              <span className="h-3 w-6 rounded-sm bg-destructive" />
              <span className="h-3 w-6 rounded-sm bg-secondary" />
              <span className="h-3 w-6 rounded-sm bg-primary" />
              <span>高</span>
            </div>
            {inactiveSites.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowInactiveSites((v) => !v)}
              >
                {showInactiveSites
                  ? "隐藏未使用"
                  : `显示未使用 (${inactiveSites.length})`}
              </Button>
            )}
          </div>
        </CardHeader>

        {insightsLoading && rawSiteAvailability.length === 0 ? (
          <CardContent className="grid gap-3">
            {[...Array(4)].map((_, index) => (
              <Card key={index}>
                <CardContent className="grid gap-2 p-4">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-5 w-full" />
                </CardContent>
              </Card>
            ))}
          </CardContent>
        ) : siteAvailability.length > 0 ? (
          <CardContent className="grid gap-3">
            {siteAvailability.map((site) => (
              <Card
                key={site.siteId}
                className={cn(site.totalRequests <= 0 && "opacity-70")}
              >
                <CardContent className="grid gap-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{site.siteName}</span>
                      <MetricBadge value={site.availabilityPercent} />
                    {site.platform && (
                      <ToneBadge tone="info">
                        {site.platform}
                      </ToneBadge>
                    )}
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link to={buildSiteLast24hLogsRoute(site.siteId)}>
                        查看日志
                      </Link>
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {formatAvailabilityPercent(site.availabilityPercent)}
                    </span>
                    <LatencyBadge ms={site.averageLatencyMs} />
                    <span>{Math.round(site.totalRequests || 0)} 次</span>
                  </div>
                  <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-1">
                  {site.buckets.map((bucket, index) => (
                    <AvailabilityCell
                      key={`${site.siteId}-${index}`}
                      bucket={bucket}
                      siteId={site.siteId}
                      siteName={site.siteName}
                    />
                  ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </CardContent>
        ) : (
          <CardContent>
            <div className="grid justify-items-center gap-2 p-8 text-center">
              <Activity className="size-10 text-muted-foreground" />
              <div className="font-medium">
              暂无站点观测数据
              </div>
              <div className="text-sm text-muted-foreground">
              有代理请求后，这里会自动生成每个站点的可用性条和平均响应速度。
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      <div className={cn("grid gap-4", !isMobile && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="size-4" />
              模型数据分析
            </CardTitle>
          </CardHeader>
          <CardContent>
          {insightsLoading && !insightsData ? (
            <ChartFallback height={260} />
          ) : (
            <Suspense fallback={<ChartFallback height={260} />}>
              <ModelAnalysisPanel data={insightsData?.modelAnalysis} />
            </Suspense>
          )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Server className="size-4" />
              站点信息
            </CardTitle>
            {sites.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  await Promise.all(
                    sites.map(async (s: any, idx: number) => {
                      const siteKey = getSiteSpeedKey(s, idx);
                      setSiteSpeedState(siteKey, { status: "loading" });
                      try {
                        const start = performance.now();
                        await fetch(`${s.url}/v1/models`, {
                          method: "GET",
                          mode: "no-cors",
                        });
                        const ms = Math.round(performance.now() - start);
                        setSiteSpeedState(siteKey, { status: "done", ms });
                      } catch {
                        setSiteSpeedState(siteKey, { status: "timeout" });
                      }
                    }),
                  );
                  toast.success("全部测速完成");
                }}
              >
                <Zap className="size-3" />
                一键测速
              </Button>
            )}
          </CardHeader>
          <CardContent className="grid gap-3">
            {sites.length > 0 ? (
              sites.map((site: any, idx: number) => (
                <Card key={site.id || idx}>
                  <CardContent className="grid gap-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">
                      {site.name}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                      onClick={async () => {
                        const siteKey = getSiteSpeedKey(site, idx);
                        setSiteSpeedState(siteKey, { status: "loading" });
                        try {
                          const start = performance.now();
                          await fetch(`${site.url}/v1/models`, {
                            method: "GET",
                            mode: "no-cors",
                          });
                          const ms = Math.round(performance.now() - start);
                          setSiteSpeedState(siteKey, { status: "done", ms });
                          toast.success(`${site.name}: ${ms}ms`);
                        } catch {
                          setSiteSpeedState(siteKey, { status: "timeout" });
                          toast.error(`${site.name}: 测速失败`);
                        }
                      }}
                    >
                        <Gauge className="size-3" />
                      <span>{renderSiteSpeedLabel(site, idx)}</span>
                    </Button>
                      <Button asChild variant="outline" size="sm">
                        <a href={site.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="size-3" />
                          跳转
                        </a>
                      </Button>
                    </div>
                    <a
                      href={site.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-xs text-muted-foreground hover:text-foreground"
                    >
                      {site.url}
                    </a>
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="grid justify-items-center gap-2 p-6 text-center">
                <Server className="size-10 text-muted-foreground" />
                <div className="text-sm font-semibold">
                  代理端点可用
                </div>
                <div className="text-xs text-muted-foreground">
                  使用{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    /v1/chat/completions
                  </code>{" "}
                  访问
                </div>
              </div>
            )}
            <div className="border-t pt-3">
              <div className="text-xs text-muted-foreground">
                24h 活跃调用
              </div>
              <div className="text-lg font-bold">
                {proxy24hTotal > 0
                  ? `${Math.round(proxy24hSuccess)}/${Math.round(proxy24hTotal)}`
                  : "—"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
