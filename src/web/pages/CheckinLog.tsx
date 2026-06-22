import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { MobileCard, MobileField } from "../components/MobileCard.js";
import ResponsiveFilterPanel from "../components/ResponsiveFilterPanel.js";
import { useToast } from "../components/Toast.js";
import { useIsMobile } from "../components/useIsMobile.js";
import {
  formatCheckinLogTime,
  parseServerUtcDateTime,
} from "./helpers/checkinLogTime.js";
import { tr } from "../i18n.js";
import { Button } from '../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import { Skeleton } from '../components/ui/skeleton/index.js';
import ToneBadge from '../components/ToneBadge.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import { Alert, AlertDescription } from '../components/ui/alert/index.js';
import { Card, CardContent } from '../components/ui/card/index.js';
import { Input } from '../components/ui/input/index.js';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs/index.js';
import { DataTable } from '../components/ui/data-table/index.js';
import PageHeader from '../components/workspace/PageHeader.js';
import PageShell from '../components/workspace/PageShell.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table/index.js';

type LogFilter = "all" | "success" | "failed" | "skipped";

type FailureReason = {
  code: string;
  category: string;
  title: string;
  actionHint: string;
  detailHint: string;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateTimeInputValue(value: Date) {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}T${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
}

function getTodayTimeRangeInput(now = new Date()): {
  from: string;
  to: string;
} {
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  );
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    0,
    0,
  );
  return {
    from: formatDateTimeInputValue(start),
    to: formatDateTimeInputValue(end),
  };
}

function parseLocalDateTimeInput(value: string): Date | null {
  const text = value.trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export default function CheckinLog() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const isMobile = useIsMobile();
  const toast = useToast();

  function getStatus(log: any): "success" | "failed" | "skipped" {
    const raw = (log.checkin_logs?.status || log.status || "failed") as string;
    if (raw === "success" || raw === "skipped") return raw;
    return "failed";
  }

  function getCreatedAtDate(log: any): Date | null {
    const createdAt = log.checkin_logs?.createdAt || log.createdAt;
    return parseServerUtcDateTime(createdAt);
  }

  const initialTimeRange = useMemo(() => getTodayTimeRangeInput(), []);
  const [fromInput, setFromInput] = useState(initialTimeRange.from);
  const [toInput, setToInput] = useState(initialTimeRange.to);

  const fromRaw = useMemo(
    () => parseLocalDateTimeInput(fromInput),
    [fromInput],
  );
  const toRaw = useMemo(() => parseLocalDateTimeInput(toInput), [toInput]);
  const fromMs = fromRaw?.getTime() ?? null;
  const toMs = toRaw?.getTime() ?? null;
  const toExclusiveMs = toMs === null ? null : toMs + 60_000;

  const hasInvalidTimeRange = Boolean(
    fromMs !== null && toMs !== null && fromMs >= toMs,
  );

  const timeFilteredLogs = useMemo(() => {
    if (hasInvalidTimeRange) return [];

    return logs.filter((log) => {
      const createdAtDate = getCreatedAtDate(log);
      if (!createdAtDate) return false;

      const createdAtMs = createdAtDate.getTime();
      if (fromMs !== null && createdAtMs < fromMs) return false;
      if (toExclusiveMs !== null && createdAtMs >= toExclusiveMs) return false;
      return true;
    });
  }, [fromMs, hasInvalidTimeRange, logs, toExclusiveMs]);

  const statusFilteredLogs = useMemo(
    () =>
      filter === "all"
        ? timeFilteredLogs
        : timeFilteredLogs.filter((log) => getStatus(log) === filter),
    [filter, timeFilteredLogs],
  );

  // 兼容旧命名：后面渲染统一用 filtered
  const filtered = statusFilteredLogs;

  const countBy = useMemo(
    () => (target: Exclude<LogFilter, "all">) =>
      timeFilteredLogs.filter((log) => getStatus(log) === target).length,
    [timeFilteredLogs],
  );

  const clearTimeRange = () => {
    setFromInput("");
    setToInput("");
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getCheckinLogs("limit=100");
      setLogs(Array.isArray(data) ? data : []);
    } catch (e: any) {
      toast.error(e.message || tr('pages.checkinLog.failedLoadCheckRecords'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleTriggerAll = async () => {
    setTriggering(true);
    try {
      const res = await api.triggerCheckinAll();
      if (res?.queued) {
        toast.info(res.message || tr('pages.checkinLog.signHasStartedPleaseCheckSignRecord'));
      } else {
        toast.success(res?.message || tr('pages.checkinLog.signHasBeenExecuted'));
      }
      await load();
    } catch (e: any) {
      toast.error(e.message || tr('pages.checkinLog.failedTriggerSign'));
    } finally {
      setTriggering(false);
    }
  };

  const statusLabel = (status: "success" | "failed" | "skipped") => {
    if (status === "success") return tr('pages.checkinLog.success');
    if (status === "skipped") return tr('pages.checkinLog.jumpOver');
    return tr('pages.checkinLog.failed');
  };

  const statusClass = (status: "success" | "failed" | "skipped") => {
    if (status === "success") return "success";
    if (status === "skipped") return "muted";
    return "error";
  };

  const getFailureReason = (log: any): FailureReason | null => {
    const reason = log.failureReason as FailureReason | undefined;
    if (!reason || !reason.code) return null;
    return reason;
  };

  const timeRangeControls = (
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1">
        <span className="text-xs font-medium text-muted-foreground">{tr('pages.checkinLog.start')}</span>
        <Input
          type="datetime-local"
          value={fromInput}
          max={toInput || undefined}
          onChange={(e) => setFromInput(e.target.value)}
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs font-medium text-muted-foreground">{tr('pages.checkinLog.end')}</span>
        <Input
          type="datetime-local"
          value={toInput}
          min={fromInput || undefined}
          onChange={(e) => setToInput(e.target.value)}
        />
      </label>
      <Button variant="outline"
        type="button"
       
        onClick={clearTimeRange}
      >
        {tr('pages.checkinLog.clearfilter')}
      </Button>
    </div>
  );

  const filterTabs = (
    <Tabs value={filter} onValueChange={(value) => setFilter(value as LogFilter)}>
      <TabsList className="flex h-auto flex-wrap">
      {[
        { key: "all" as const, label: tr('components.notificationPanel.all'), count: timeFilteredLogs.length },
        { key: "success" as const, label: tr('pages.checkinLog.success'), count: countBy("success") },
        { key: "failed" as const, label: tr('pages.checkinLog.failed'), count: countBy("failed") },
        { key: "skipped" as const, label: tr('pages.checkinLog.jumpOver'), count: countBy("skipped") },
      ].map((tab) => (
        <TabsTrigger
          key={tab.key}
          value={tab.key}
          className="gap-1"
        >
          {tab.label}{" "}
          <span className="tabular-nums opacity-70">
            {tab.count}
          </span>
        </TabsTrigger>
      ))}
      </TabsList>
    </Tabs>
  );

  return (
    <PageShell>
      <PageHeader
        title={tr('app.checkLogs')}
        description={tr('pages.checkinLog.checkLogsSubtitle')}
        actions={(
        <Button type="button"
          onClick={handleTriggerAll}
          disabled={triggering}
         
        >
          {triggering ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              {tr('pages.checkinLog.zh')}
            </>
          ) : (
            tr('pages.checkinLog.runAllCheckIns')
          )}
        </Button>
        )}
      />

      <ResponsiveFilterPanel
        isMobile={isMobile}
        mobileOpen={showFilters}
        onMobileOpen={() => setShowFilters(true)}
        onMobileClose={() => setShowFilters(false)}
        mobileTitle={tr('pages.checkinLog.filtercheckLogs')}
        mobileContent={(
          <div className="grid gap-3">
            {timeRangeControls}
            {hasInvalidTimeRange && (
              <Alert variant="destructive">
                <AlertDescription>{tr('pages.checkinLog.endtimeStarttime')}</AlertDescription>
              </Alert>
            )}
            {filterTabs}
          </div>
        )}
        desktopContent={(
          <Card className="mb-3">
            <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-72">{filterTabs}</div>
            <div className="flex flex-wrap items-center gap-3">
              {timeRangeControls}
            </div>
            {hasInvalidTimeRange && (
              <div className="w-full rounded-md border border-destructive/40 p-3 text-sm text-destructive">
                {tr('pages.checkinLog.endtimeStarttime')}
              </div>
            )}
            </CardContent>
          </Card>
        )}
      />

      {loading ? (
        <Card>
          <CardContent className="grid gap-3 p-6">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-14" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyStateBlock title={tr('pages.checkinLog.nonecheckLogs')} description={tr('pages.checkinLog.runAllCheckInsStart')} />
      ) : isMobile ? (
          <div className="grid gap-3">
            {filtered.map((log: any) => {
              const status = getStatus(log);
              const reason = getFailureReason(log);
              const isExpanded =
                expandedLogId === (log.checkin_logs?.id || log.id);
              const logId = log.checkin_logs?.id || log.id;
              return (
                <MobileCard
                  key={logId}
                  title={log.accounts?.username || tr('pages.accounts.unknown2')}
                  headerActions={
                    <ToneBadge tone={statusClass(status)}
                     
                     
                    >
                      {statusLabel(status)}
                    </ToneBadge>
                  }
                  footerActions={
                    <Button variant="ghost" size="sm"
                      type="button"
                     
                      onClick={() =>
                        setExpandedLogId(isExpanded ? null : logId)
                      }
                    >
                      {isExpanded ? tr('pages.accounts.collapse') : tr('pages.accounts.details')}
                    </Button>
                  }
                >
                  <MobileField
                    label={tr('pages.checkinLog.time')}
                    value={formatCheckinLogTime(
                      log.checkin_logs?.createdAt || log.createdAt,
                    )}
                  />
                  <MobileField
                    label={tr('components.searchModal.sites2')}
                    value={
                      log.sites?.url ? (
                        <a
                          href={log.sites.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex"
                        >
                          <ToneBadge tone="-muted"
                           
                           
                          >
                            {log.sites?.name || "-"}
                          </ToneBadge>
                        </a>
                      ) : (
                        <ToneBadge tone="-muted"
                         
                         
                        >
                          {log.sites?.name || "-"}
                        </ToneBadge>
                      )
                    }
                  />
                  <MobileField
                    label={tr('pages.checkinLog.category')}
                    value={
                      reason ? (
                        <ToneBadge tone="-info"
                         
                          data-tooltip={reason.detailHint}
                        >
                          {reason.title}
                        </ToneBadge>
                      ) : (
                        <ToneBadge tone="-muted">-</ToneBadge>
                      )
                    }
                  />
                  <MobileField
                    label={tr('pages.checkinLog.reward')}
                    value={log.checkin_logs?.reward || "-"}
                  />
                  {isExpanded ? (
                    <div className="mt-3 grid gap-2">
                      <MobileField
                        label={tr('pages.checkinLog.info')}
                        stacked
                        value={log.checkin_logs?.message || log.message}
                      />
                      <MobileField
                        label={tr('pages.checkinLog.suggestion')}
                        stacked
                        value={reason?.actionHint || "-"}
                      />
                    </div>
                  ) : null}
                </MobileCard>
              );
            })}
          </div>
        ) : (
          <DataTable minWidth={1120} density="compact">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr('pages.checkinLog.time')}</TableHead>
                <TableHead>{tr('components.searchModal.accounts2')}</TableHead>
                <TableHead>{tr('components.searchModal.sites2')}</TableHead>
                <TableHead>{tr('components.notificationPanel.status')}</TableHead>
                <TableHead>{tr('pages.checkinLog.category')}</TableHead>
                <TableHead>{tr('pages.checkinLog.info')}</TableHead>
                <TableHead>{tr('pages.checkinLog.suggestion')}</TableHead>
                <TableHead>{tr('pages.checkinLog.reward')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((log: any) => {
                const status = getStatus(log);
                const reason = getFailureReason(log);
                return (
                  <TableRow key={log.checkin_logs?.id || log.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatCheckinLogTime(
                        log.checkin_logs?.createdAt || log.createdAt,
                      )}
                    </TableCell>
                    <TableCell className="font-semibold">
                      {log.accounts?.username || tr('pages.accounts.unknown2')}
                    </TableCell>
                    <TableCell>
                      {log.sites?.url ? (
                        <a
                          href={log.sites.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex"
                        >
                          <ToneBadge tone="-muted"
                           
                           
                          >
                            {log.sites?.name || "-"}
                          </ToneBadge>
                        </a>
                      ) : (
                        <ToneBadge tone="-muted"
                         
                         
                        >
                          {log.sites?.name || "-"}
                        </ToneBadge>
                      )}
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone={statusClass(status)}>
                        {statusLabel(status)}
                      </ToneBadge>
                    </TableCell>
                    <TableCell>
                      {reason ? (
                        <ToneBadge tone="-info"
                         
                          data-tooltip={reason.detailHint}
                        >
                          {reason.title}
                        </ToneBadge>
                      ) : (
                        <ToneBadge tone="-muted">-</ToneBadge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-sm truncate">
                        {log.checkin_logs?.message || log.message}
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-xs text-muted-foreground" data-tooltip={reason?.detailHint || ""}>
                      <span
                      >
                        {reason?.actionHint || "-"}
                      </span>
                    </TableCell>
                    <TableCell>{log.checkin_logs?.reward || "-"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            </Table>
          </DataTable>
        )}
    </PageShell>
  );
}
