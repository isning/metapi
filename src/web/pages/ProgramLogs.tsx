import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { MobileCard, MobileField } from '../components/MobileCard.js';
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.js';
import { useToast } from '../components/Toast.js';
import { useIsMobile } from '../components/useIsMobile.js';
import { formatDateTimeLocal } from './helpers/checkinLogTime.js';
import ModernSelect from '../components/ModernSelect.js';
import { tr } from '../i18n.js';
import { Button } from '../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import { Skeleton } from '../components/ui/skeleton/index.js';
import ToneBadge from '../components/ToneBadge.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import { Card, CardContent } from '../components/ui/card/index.js';
import { Switch } from '../components/ui/switch/index.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table/index.js';

type ProgramEvent = {
  id: number;
  type: string;
  title: string;
  message?: string | null;
  level: 'info' | 'warning' | 'error';
  read: boolean;
  relatedId?: number | null;
  relatedType?: string | null;
  createdAt?: string | null;
};

const PAGE_SIZE = 50;

const TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'checkin', label: '签到' },
  { value: 'balance', label: '余额' },
  { value: 'token', label: '令牌' },
  { value: 'proxy', label: '代理' },
  { value: 'status', label: '状态' },
  { value: 'site_notice', label: '站点公告' },
];

function levelLabel(level: string) {
  if (level === 'error') return { label: '错误', cls: 'error' };
  if (level === 'warning') return { label: '警告', cls: 'warning' };
  return { label: '信息', cls: 'info' };
}

function eventStatusLabel(row: ProgramEvent) {
  const text = `${row.title || ''} ${row.message || ''}`.toLowerCase();

  const parseCount = (pattern: RegExp): number | undefined => {
    const match = text.match(pattern);
    if (!match?.[1]) return undefined;
    const value = Number.parseInt(match[1], 10);
    return Number.isFinite(value) ? value : undefined;
  };

  const summary = {
    success: parseCount(/成功[^\d]{0,6}(\d+)/i) ?? parseCount(/success(?:ful)?[^\d]{0,6}(\d+)/i),
    skipped: parseCount(/跳过[^\d]{0,6}(\d+)/i) ?? parseCount(/skipped?[^\d]{0,6}(\d+)/i),
    failed: parseCount(/失败[^\d]{0,6}(\d+)/i) ?? parseCount(/failed[^\d]{0,6}(\d+)/i),
  };

  if (summary.failed !== undefined || summary.success !== undefined || summary.skipped !== undefined) {
    if ((summary.failed ?? 0) > 0) {
      return { label: '失败', cls: 'error' };
    }
    if ((summary.success ?? 0) > 0) {
      return { label: '成功', cls: 'success' };
    }
    if ((summary.skipped ?? 0) > 0) {
      return { label: '跳过', cls: 'warning' };
    }
    return { label: '成功', cls: 'success' };
  }

  if (text.includes('失败') || text.includes('failed') || text.includes('error')) {
    return { label: '失败', cls: 'error' };
  }
  if (text.includes('跳过') || text.includes('skipped')) {
    return { label: '跳过', cls: 'warning' };
  }
  if (text.includes('进行中') || text.includes('已开始') || text.includes('running') || text.includes('pending')) {
    return { label: '进行中', cls: 'info' };
  }
  if (text.includes('成功') || text.includes('已完成') || text.includes('completed') || text.includes('finished')) {
    return { label: '成功', cls: 'success' };
  }

  if (row.level === 'error') return { label: '异常', cls: 'error' };
  if (row.level === 'warning') return { label: '警告', cls: 'warning' };
  return { label: '信息', cls: 'info' };
}

export default function ProgramLogs() {
  const [events, setEvents] = useState<ProgramEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [rowLoading, setRowLoading] = useState<Record<number, boolean>>({});
  const [showFilters, setShowFilters] = useState(false);
  const isMobile = useIsMobile();
  const toast = useToast();

  const load = async (silent = false, append = false) => {
    if (append) setLoadingMore(true);
    else if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const nextOffset = append ? offset : 0;
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(nextOffset));
      if (filterType) params.set('type', filterType);
      if (onlyUnread) params.set('read', 'false');
      const rows = await api.getEvents(params.toString());
      const safeRows = Array.isArray(rows) ? rows : [];
      setEvents((prev) => (append ? [...prev, ...safeRows] : safeRows));
      const loaded = append ? nextOffset + safeRows.length : safeRows.length;
      setOffset(loaded);
      setHasMore(safeRows.length >= PAGE_SIZE);
    } catch (e: any) {
      toast.error(e.message || '加载程序日志失败');
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, [filterType, onlyUnread]);

  const visibleRows = useMemo(() => events, [events]);

  const withRowLoading = async (id: number, fn: () => Promise<void>) => {
    setRowLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await fn();
    } finally {
      setRowLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const markOneRead = async (id: number) => {
    await withRowLoading(id, async () => {
      await api.markEventRead(id);
      setEvents((prev) => {
        if (onlyUnread) return prev.filter((item) => item.id !== id);
        return prev.map((item) => (item.id === id ? { ...item, read: true } : item));
      });
    });
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await api.markAllEventsRead();
      if (onlyUnread) setEvents([]);
      else setEvents((prev) => prev.map((item) => ({ ...item, read: true })));
      toast.success('已标记全部为已读');
    } catch (e: any) {
      toast.error(e.message || '标记失败');
    } finally {
      setMarkingAll(false);
    }
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      await api.clearEvents();
      setEvents([]);
      setOffset(0);
      setHasMore(false);
      toast.success('日志已清空');
    } catch (e: any) {
      toast.error(e.message || '清空失败');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">{tr('程序日志')}</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline"
            onClick={() => load(true)}
            disabled={refreshing}
           
           
          >
            {refreshing ? <><LoaderCircle className="size-4 animate-spin" /> 刷新中...</> : '刷新'}
          </Button>
          <Button type="button" variant="outline"
            onClick={markAllRead}
            disabled={markingAll}
           
           
          >
            {markingAll ? <><LoaderCircle className="size-4 animate-spin" /> 标记中...</> : '全部已读'}
          </Button>
          <Button type="button" variant="destructive" size="sm"
            onClick={clearAll}
            disabled={clearing}
           
          >
            {clearing ? <><LoaderCircle className="size-4 animate-spin" /> 清空中...</> : '清空日志'}
          </Button>
        </div>
      </div>

      <ResponsiveFilterPanel
        isMobile={isMobile}
        mobileOpen={showFilters}
        onMobileOpen={() => setShowFilters(true)}
        onMobileClose={() => setShowFilters(false)}
        mobileTitle="筛选程序日志"
        mobileContent={(
          <div className="grid gap-3">
            <ModernSelect
              size="sm"
              value={filterType}
              onChange={(nextValue) => setFilterType(nextValue)}
              options={TYPE_OPTIONS.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
              placeholder="全部类型"
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch
                aria-label="仅看未读"
                checked={onlyUnread}
                onCheckedChange={(checked) => {
                  setOffset(0);
                  setHasMore(true);
                  setOnlyUnread(checked);
                }}
              />
              仅看未读
            </label>
            <div className="text-xs text-muted-foreground">
              共 {visibleRows.length} 条
            </div>
          </div>
        )}
        desktopContent={(
          <Card className="mb-3">
            <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-44">
              <ModernSelect
                size="sm"
                value={filterType}
                onChange={(nextValue) => setFilterType(nextValue)}
                options={TYPE_OPTIONS.map((item) => ({
                  value: item.value,
                  label: item.label,
                }))}
                placeholder="全部类型"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Switch
                aria-label="仅看未读"
                checked={onlyUnread}
                onCheckedChange={(checked) => {
                  setOffset(0);
                  setHasMore(true);
                  setOnlyUnread(checked);
                }}
              />
              仅看未读
            </label>

            <div className="ml-auto text-xs text-muted-foreground">
              共 {visibleRows.length} 条
            </div>
            </CardContent>
          </Card>
        )}
      />

      <Card className="overflow-hidden">
        {loading ? (
          <CardContent className="grid gap-2 p-5">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        ) : isMobile ? (
          <div className="grid gap-3">
            {visibleRows.length > 0 ? visibleRows.map((row) => {
              const level = levelLabel(row.level || 'info');
              const eventStatus = eventStatusLabel(row);
              return (
                <MobileCard
                  key={row.id}
                  title={row.title || '-'}
                  headerActions={(
                    <ToneBadge tone={eventStatus.cls}>
                      {eventStatus.label}
                    </ToneBadge>
                  )}
                  footerActions={(
                    row.read ? (
                      <ToneBadge tone="-muted">已读</ToneBadge>
                    ) : (
                      <Button variant="ghost" size="sm"
                        type="button"
                        onClick={() => markOneRead(row.id)}
                        disabled={!!rowLoading[row.id]}
                       
                      >
                        {rowLoading[row.id] ? <LoaderCircle className="size-4 animate-spin" /> : '标记已读'}
                      </Button>
                    )
                  )}
                >
                  <MobileField label="时间" value={formatDateTimeLocal(row.createdAt)} />
                  <MobileField label="类型" value={<ToneBadge tone="-muted">{row.type || '-'}</ToneBadge>} />
                  <MobileField label="级别" value={<ToneBadge tone={level.cls}>{level.label}</ToneBadge>} />
                  <MobileField label="状态" value={<ToneBadge tone={eventStatus.cls}>{eventStatus.label}</ToneBadge>} />
                  <MobileField label="内容" value={row.message || '-'} stacked />
                </MobileCard>
              );
            }) : (
              <EmptyStateBlock title="暂无日志" description="当前筛选条件下没有程序日志。" />
            )}
          </div>
        ) : visibleRows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">时间</TableHead>
                <TableHead className="w-24">类型</TableHead>
                <TableHead className="w-24">级别</TableHead>
                <TableHead className="w-64">标题</TableHead>
                <TableHead>内容</TableHead>
                <TableHead className="w-28">状态</TableHead>
                <TableHead className="w-36 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row, idx) => {
                const level = levelLabel(row.level || 'info');
                const eventStatus = eventStatusLabel(row);
                return (
                  <TableRow key={row.id} className={`animate-slide-up stagger-${Math.min(idx + 1, 5)}`}>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTimeLocal(row.createdAt)}
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone="-muted">
                        {row.type || '-'}
                      </ToneBadge>
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone={level.cls}>
                        {level.label}
                      </ToneBadge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {row.title || '-'}
                    </TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">
                      {row.message || '-'}
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone={eventStatus.cls}>
                        {eventStatus.label}
                      </ToneBadge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {row.read ? (
                          <ToneBadge tone="-muted">已读</ToneBadge>
                        ) : (
                          <ToneBadge tone="-warning">未读</ToneBadge>
                        )}
                        {!row.read && (
                          <Button type="button" variant="ghost" size="sm"
                            onClick={() => markOneRead(row.id)}
                            disabled={!!rowLoading[row.id]}
                           
                          >
                            {rowLoading[row.id] ? <LoaderCircle className="size-4 animate-spin" /> : '标记已读'}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <EmptyStateBlock title="暂无日志" description="当前筛选条件下没有程序日志。" />
        )}
      </Card>

      {!loading && visibleRows.length > 0 && hasMore && (
        <div className="flex justify-center">
          <Button type="button" variant="outline"
           
            onClick={() => load(false, true)}
            disabled={loadingMore}
           
          >
            {loadingMore ? <><LoaderCircle className="size-4 animate-spin" /> 加载中...</> : '加载更多'}
          </Button>
        </div>
      )}
    </div>
  );
}
