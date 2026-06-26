import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { MobileCard, MobileField } from '../components/MobileCard.js';
import ResponsiveFilterPanel from '../components/ResponsiveFilterPanel.js';
import { useToast } from '../components/Toast.js';
import { useIsMobile } from '../components/useIsMobile.js';
import { formatDateTimeLocal } from './helpers/checkinLogTime.js';
import { buildEventNavigationPath } from './helpers/navigationFocus.js';
import ModernSelect from '../components/ModernSelect.js';
import { tr } from '../i18n.js';
import { Button } from '../components/ui/button/index.js';
import { Check, Copy, ExternalLink, LoaderCircle, MoveUpRight } from 'lucide-react';
import { Skeleton } from '../components/ui/skeleton/index.js';
import ToneBadge from '../components/ToneBadge.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import { Card, CardContent } from '../components/ui/card/index.js';
import { Switch } from '../components/ui/switch/index.js';
import { DataTable } from '../components/ui/data-table/index.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table/index.js';
import * as Sheet from '../components/ui/sheet/index.js';
import { Badge } from '../components/ui/badge/index.js';
import type { InboxAction, InboxDetailBlock, InboxItem } from '../../shared/inbox.js';

type ProgramEvent = InboxItem;

const PAGE_SIZE = 50;

const TYPE_OPTIONS = [
  { value: '', label: tr('pages.programLogs.allTypes') },
  { value: 'checkin', label: tr('components.notificationPanel.sign') },
  { value: 'balance', label: tr('components.notificationPanel.balance') },
  { value: 'token', label: tr('components.notificationPanel.token') },
  { value: 'proxy', label: tr('components.notificationPanel.proxy') },
  { value: 'status', label: tr('components.notificationPanel.status') },
  { value: 'site_notice', label: tr('app.sites') },
];

const SCOPE_OPTIONS = [
  { value: '', label: tr('pages.programLogs.allScopes') },
  { value: 'notification', label: tr('pages.programLogs.scope.notification') },
  { value: 'attention', label: tr('pages.programLogs.scope.attention') },
  { value: 'activity', label: tr('pages.programLogs.scope.activity') },
  { value: 'announcement', label: tr('pages.programLogs.scope.announcement') },
];

const STATE_OPTIONS = [
  { value: '', label: tr('pages.programLogs.allStates') },
  { value: 'open', label: tr('pages.programLogs.state.open') },
  { value: 'read', label: tr('pages.programLogs.state.read') },
  { value: 'acknowledged', label: tr('pages.programLogs.state.acknowledged') },
  { value: 'snoozed', label: tr('pages.programLogs.state.snoozed') },
  { value: 'resolved', label: tr('pages.programLogs.state.resolved') },
];

function readUrlFilters(search: string) {
  const params = new URLSearchParams(search);
  return {
    type: params.get('type') || '',
    scope: params.get('scope') || '',
    state: params.get('state') || '',
    unread: params.get('read') === 'false',
  };
}

function buildEventFilterParams(filters: { type?: string; scope?: string; state?: string; unread?: boolean }, includeRead = true) {
  const params = new URLSearchParams();
  if (filters.type) params.set('type', filters.type);
  if (filters.scope) params.set('scope', filters.scope);
  if (filters.state) params.set('state', filters.state);
  if (includeRead && filters.unread) params.set('read', 'false');
  return params;
}

function levelLabel(level: string) {
  if (level === 'error') return { label: tr('pages.programLogs.mistake'), cls: 'error' };
  if (level === 'warning') return { label: tr('pages.programLogs.warning'), cls: 'warning' };
  return { label: tr('pages.checkinLog.info'), cls: 'info' };
}

function eventStatusLabel(row: ProgramEvent) {
  if (row.state === 'resolved') return { label: tr('pages.programLogs.state.resolved'), cls: 'success' };
  if (row.state === 'acknowledged') return { label: tr('pages.programLogs.state.acknowledged'), cls: 'info' };
  if (row.state === 'snoozed') return { label: tr('pages.programLogs.state.snoozed'), cls: 'warning' };
  const text = `${row.title || ''} ${row.summary || ''} ${row.message || ''}`.toLowerCase();

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
      return { label: tr('pages.checkinLog.failed'), cls: 'error' };
    }
    if ((summary.success ?? 0) > 0) {
      return { label: tr('pages.checkinLog.success'), cls: 'success' };
    }
    if ((summary.skipped ?? 0) > 0) {
      return { label: tr('pages.checkinLog.jumpOver'), cls: 'warning' };
    }
    return { label: tr('pages.checkinLog.success'), cls: 'success' };
  }

  if (text.includes(tr('pages.checkinLog.failed')) || text.includes('failed') || text.includes('error')) {
    return { label: tr('pages.checkinLog.failed'), cls: 'error' };
  }
  if (text.includes(tr('pages.checkinLog.jumpOver')) || text.includes('skipped')) {
    return { label: tr('pages.checkinLog.jumpOver'), cls: 'warning' };
  }
  if (text.includes(tr('pages.programLogs.progress')) || text.includes(tr('app.started')) || text.includes('running') || text.includes('pending')) {
    return { label: tr('pages.programLogs.progress'), cls: 'info' };
  }
  if (text.includes(tr('pages.checkinLog.success')) || text.includes(tr('pages.programLogs.completed')) || text.includes('completed') || text.includes('finished')) {
    return { label: tr('pages.checkinLog.success'), cls: 'success' };
  }

  if (row.level === 'error') return { label: tr('pages.accounts.error'), cls: 'error' };
  if (row.level === 'warning') return { label: tr('pages.programLogs.warning'), cls: 'warning' };
  return { label: tr('pages.checkinLog.info'), cls: 'info' };
}

function severityTone(severity?: string | null) {
  if (severity === 'critical') return 'error';
  if (severity === 'warning') return 'warning';
  if (severity === 'success') return 'success';
  return 'info';
}

function scopeLabel(scope?: string | null) {
  return tr(`pages.programLogs.scope.${scope || 'activity'}`);
}

function renderDetailBlock(block: InboxDetailBlock, index: number) {
  const title = block.title ? <div className="mb-2 font-medium">{block.title}</div> : null;
  if (block.type === 'text') {
    return <div key={index} className="rounded-md border p-3 text-sm">{title}<p className="whitespace-pre-wrap text-muted-foreground">{block.text}</p></div>;
  }
  if (block.type === 'kv') {
    return (
      <div key={index} className="rounded-md border p-3 text-sm">
        {title}
        <dl className="grid gap-2">
          {block.rows.map((row, rowIndex) => (
            <div key={`${row.label}-${rowIndex}`} className="grid grid-cols-[minmax(7rem,0.4fr)_1fr] gap-3">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  if (block.type === 'metrics') {
    return (
      <div key={index} className="rounded-md border p-3 text-sm">
        {title}
        <div className="grid gap-2 sm:grid-cols-2">
          {block.items.map((item, itemIndex) => (
            <div key={`${item.label}-${itemIndex}`} className="rounded-md bg-muted/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className="font-medium">{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (block.type === 'list') {
    return (
      <div key={index} className="rounded-md border p-3 text-sm">
        {title}
        <ul className="grid gap-1 text-muted-foreground">
          {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
        </ul>
      </div>
    );
  }
  if (block.type === 'code') {
    return (
      <div key={index} className="rounded-md border p-3 text-sm">
        {title}
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs"><code>{block.value}</code></pre>
      </div>
    );
  }
  if (block.type === 'table') {
    return (
      <div key={index} className="overflow-hidden rounded-md border text-sm">
        {block.title ? <div className="border-b px-3 py-2 font-medium">{block.title}</div> : null}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>{block.columns.map((column) => <TableHead key={column}>{column}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {block.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, cellIndex) => <TableCell key={cellIndex}>{cell}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }
  return null;
}

export default function ProgramLogs() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialFilters = useMemo(() => readUrlFilters(location.search), []);
  const [events, setEvents] = useState<ProgramEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filterType, setFilterType] = useState(initialFilters.type);
  const [filterScope, setFilterScope] = useState(initialFilters.scope);
  const [filterState, setFilterState] = useState(initialFilters.state);
  const [onlyUnread, setOnlyUnread] = useState(initialFilters.unread);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [rowLoading, setRowLoading] = useState<Record<number, boolean>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ProgramEvent | null>(null);
  const isMobile = useIsMobile();
  const toast = useToast();

  useEffect(() => {
    const next = readUrlFilters(location.search);
    setFilterType(next.type);
    setFilterScope(next.scope);
    setFilterState(next.state);
    setOnlyUnread(next.unread);
    setOffset(0);
    setHasMore(true);
  }, [location.search]);

  const load = async (silent = false, append = false) => {
    if (append) setLoadingMore(true);
    else if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const nextOffset = append ? offset : 0;
      const params = buildEventFilterParams({
        type: filterType,
        scope: filterScope,
        state: filterState,
        unread: onlyUnread,
      });
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(nextOffset));
      const rows = await api.getEvents(params.toString());
      const safeRows = Array.isArray(rows) ? rows : [];
      setEvents((prev) => (append ? [...prev, ...safeRows] : safeRows));
      const loaded = append ? nextOffset + safeRows.length : safeRows.length;
      setOffset(loaded);
      setHasMore(safeRows.length >= PAGE_SIZE);
    } catch (e: any) {
      toast.error(e.message || tr('pages.programLogs.loaderLogFailed'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, [filterType, filterScope, filterState, onlyUnread]);

  const updateFilters = (next: { type?: string; scope?: string; state?: string; unread?: boolean }) => {
    const type = next.type ?? filterType;
    const scope = next.scope ?? filterScope;
    const state = next.state ?? filterState;
    const unread = next.unread ?? onlyUnread;
    const params = new URLSearchParams(location.search);
    if (type) params.set('type', type); else params.delete('type');
    if (scope) params.set('scope', scope); else params.delete('scope');
    if (state) params.set('state', state); else params.delete('state');
    if (unread) params.set('read', 'false'); else params.delete('read');
    const nextSearch = params.toString();
    navigate(nextSearch ? `/events?${nextSearch}` : '/events', { replace: true });
  };

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
        return prev.flatMap((item) => {
          if (item.id !== id) return [item];
          const nextItem = {
            ...item,
            read: true,
            state: item.scope === 'attention' ? item.state : 'read',
          } satisfies ProgramEvent;
          if (filterState && nextItem.state !== filterState) return [];
          return [nextItem];
        });
      });
    });
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      const params = buildEventFilterParams({
        type: filterType,
        scope: filterScope,
        state: filterState,
      }, false);
      await api.markAllEventsRead(params.toString());
      if (onlyUnread) setEvents([]);
      else await load(true);
      toast.success(tr('pages.programLogs.markedAllRead'));
    } catch (e: any) {
      toast.error(e.message || tr('pages.programLogs.markingFailed'));
    } finally {
      setMarkingAll(false);
    }
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      const params = buildEventFilterParams({
        type: filterType,
        scope: filterScope,
        state: filterState,
        unread: onlyUnread,
      });
      await api.clearEvents(params.toString());
      setEvents([]);
      setOffset(0);
      setHasMore(false);
      toast.success(tr('pages.programLogs.logHasBeenCleared'));
    } catch (e: any) {
      toast.error(e.message || tr('pages.programLogs.clearingFailed'));
    } finally {
      setClearing(false);
    }
  };

  const openEventTarget = (row: ProgramEvent) => {
    const navigateAction = row.actions?.find((action) => action.kind === 'navigate' && action.href);
    navigate(navigateAction?.href || buildEventNavigationPath(row));
  };

  const runAction = async (row: ProgramEvent, action: InboxAction) => {
    try {
      if (action.kind === 'navigate' && action.href) {
        navigate(action.href);
        return;
      }
      if (action.kind === 'external' && action.href) {
        window.open(action.href, '_blank', 'noopener,noreferrer');
        return;
      }
      if (action.kind === 'copy' && action.value) {
        await navigator.clipboard?.writeText(action.value);
        toast.success(tr('pages.programLogs.copied'));
        return;
      }
      if (action.kind === 'invoke' && action.command) {
        const response = await api.applyEventAction(row.id, { command: action.command as any });
        setEvents((prev) => prev.map((item) => (item.id === row.id ? response.item : item)));
        setSelectedEvent(response.item);
        toast.success(tr('pages.programLogs.actionApplied'));
      }
    } catch (e: any) {
      toast.error(e.message || tr('pages.programLogs.actionFailed'));
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">{tr('app.systemLogs')}</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline"
            onClick={() => load(true)}
            disabled={refreshing}
           
           
          >
            {refreshing ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.downstreamKeys.refreshing')}</> : tr('pages.accounts.refresh')}
          </Button>
          <Button type="button" variant="outline"
            onClick={markAllRead}
            disabled={markingAll}
           
           
          >
            {markingAll ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.programLogs.marking')}</> : tr('pages.programLogs.markAllRead')}
          </Button>
          <Button type="button" variant="destructive" size="sm"
            onClick={clearAll}
            disabled={clearing}
           
          >
            {clearing ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.programLogs.clearing')}</> : tr('pages.programLogs.clearLogs')}
          </Button>
        </div>
      </div>

      <ResponsiveFilterPanel
        isMobile={isMobile}
        mobileOpen={showFilters}
        onMobileOpen={() => setShowFilters(true)}
        onMobileClose={() => setShowFilters(false)}
        mobileTitle={tr('pages.programLogs.filtersystemLogs')}
        mobileContent={(
          <div className="grid gap-3">
            <ModernSelect
              size="sm"
              value={filterType}
              onChange={(nextValue) => updateFilters({ type: nextValue })}
              options={TYPE_OPTIONS.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
              placeholder={tr('pages.programLogs.allTypes')}
            />
            <ModernSelect
              size="sm"
              value={filterScope}
              onChange={(nextValue) => updateFilters({ scope: nextValue })}
              options={SCOPE_OPTIONS}
              placeholder={tr('pages.programLogs.allScopes')}
            />
            <ModernSelect
              size="sm"
              value={filterState}
              onChange={(nextValue) => updateFilters({ state: nextValue })}
              options={STATE_OPTIONS}
              placeholder={tr('pages.programLogs.allStates')}
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch
                aria-label={tr('pages.programLogs.unreadOnly')}
                checked={onlyUnread}
                onCheckedChange={(checked) => {
                  setOffset(0);
                  setHasMore(true);
                  updateFilters({ unread: checked });
                }}
              />
              {tr('pages.programLogs.unreadOnly')}
            </label>
            <div className="text-xs text-muted-foreground">
              {tr('pages.models.total')} {visibleRows.length} {tr('pages.programLogs.items')}
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
                onChange={(nextValue) => updateFilters({ type: nextValue })}
                options={TYPE_OPTIONS.map((item) => ({
                  value: item.value,
                  label: item.label,
                }))}
                placeholder={tr('pages.programLogs.allTypes')}
              />
            </div>
            <div className="min-w-44">
              <ModernSelect
                size="sm"
                value={filterScope}
                onChange={(nextValue) => updateFilters({ scope: nextValue })}
                options={SCOPE_OPTIONS}
                placeholder={tr('pages.programLogs.allScopes')}
              />
            </div>
            <div className="min-w-44">
              <ModernSelect
                size="sm"
                value={filterState}
                onChange={(nextValue) => updateFilters({ state: nextValue })}
                options={STATE_OPTIONS}
                placeholder={tr('pages.programLogs.allStates')}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Switch
                aria-label={tr('pages.programLogs.unreadOnly')}
                checked={onlyUnread}
                onCheckedChange={(checked) => {
                  setOffset(0);
                  setHasMore(true);
                  updateFilters({ unread: checked });
                }}
              />
              {tr('pages.programLogs.unreadOnly')}
            </label>

            <div className="ml-auto text-xs text-muted-foreground">
              {tr('pages.models.total')} {visibleRows.length} {tr('pages.programLogs.items')}
            </div>
            </CardContent>
          </Card>
        )}
      />

      {loading ? (
        <Card>
          <CardContent className="grid gap-2 p-5">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
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
                      <ToneBadge tone="-muted">{tr('pages.programLogs.read')}</ToneBadge>
                    ) : (
                      <Button variant="ghost" size="sm"
                        type="button"
                        onClick={() => markOneRead(row.id)}
                        disabled={!!rowLoading[row.id]}
                       
                      >
                        {rowLoading[row.id] ? <LoaderCircle className="size-4 animate-spin" /> : tr('pages.programLogs.markRead')}
                      </Button>
                    )
                  )}
                >
                  <MobileField label={tr('pages.checkinLog.time')} value={formatDateTimeLocal(row.createdAt)} />
                  <MobileField label={tr('pages.programLogs.type')} value={<ToneBadge tone="-muted">{row.type || '-'}</ToneBadge>} />
                  <MobileField label={tr('pages.programLogs.level')} value={<ToneBadge tone={level.cls}>{level.label}</ToneBadge>} />
                  <MobileField label={tr('components.notificationPanel.status')} value={<ToneBadge tone={eventStatus.cls}>{eventStatus.label}</ToneBadge>} />
                  <MobileField label={tr('pages.programLogs.content')} value={row.summary || row.message || '-'} stacked />
                  <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setSelectedEvent(row)}>
                      {tr('pages.programLogs.details')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => openEventTarget(row)}>
                      <MoveUpRight className="size-4" />
                      {tr('pages.programLogs.openTarget')}
                    </Button>
                  </div>
                </MobileCard>
              );
            }) : (
              <EmptyStateBlock title={tr('pages.programLogs.noLogs')} description={tr('pages.programLogs.filteritemsSystemLogs')} />
            )}
          </div>
        ) : visibleRows.length > 0 ? (
          <DataTable minWidth={1060} density="compact">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">{tr('pages.checkinLog.time')}</TableHead>
                <TableHead className="w-24">{tr('pages.programLogs.type')}</TableHead>
                <TableHead className="w-24">{tr('pages.programLogs.level')}</TableHead>
                <TableHead className="w-64">{tr('pages.programLogs.title')}</TableHead>
                <TableHead>{tr('pages.programLogs.content')}</TableHead>
                <TableHead className="w-28">{tr('components.notificationPanel.status')}</TableHead>
                <TableHead className="w-36 text-right">{tr('pages.accounts.actions2')}</TableHead>
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
                      {row.summary || row.message || '-'}
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone={eventStatus.cls}>
                        {eventStatus.label}
                      </ToneBadge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {row.read ? (
                          <ToneBadge tone="-muted">{tr('pages.programLogs.read')}</ToneBadge>
                        ) : (
                          <ToneBadge tone="-warning">{tr('pages.programLogs.unread')}</ToneBadge>
                        )}
                        {!row.read && (
                          <Button type="button" variant="ghost" size="sm"
                            onClick={() => markOneRead(row.id)}
                            disabled={!!rowLoading[row.id]}
                           
                          >
                            {rowLoading[row.id] ? <LoaderCircle className="size-4 animate-spin" /> : tr('pages.programLogs.markRead')}
                          </Button>
                        )}
                        <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedEvent(row)}>
                          {tr('pages.programLogs.details')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            </Table>
          </DataTable>
        ) : (
          <EmptyStateBlock title={tr('pages.programLogs.noLogs')} description={tr('pages.programLogs.filteritemsSystemLogs')} />
        )}

      {!loading && visibleRows.length > 0 && hasMore && (
        <div className="flex justify-center">
          <Button type="button" variant="outline"
           
            onClick={() => load(false, true)}
            disabled={loadingMore}
           
          >
            {loadingMore ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.oAuthManagement.loading')}</> : tr('pages.programLogs.loadMore')}
          </Button>
        </div>
      )}

      <Sheet.Root open={!!selectedEvent} onOpenChange={(nextOpen) => { if (!nextOpen) setSelectedEvent(null); }}>
        <Sheet.Content side="right" className="flex h-full w-[min(92vw,680px)] max-w-none flex-col p-0" onClose={() => setSelectedEvent(null)}>
          {selectedEvent && (
            <>
              <Sheet.Header className="border-b px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
                  <div className="min-w-0">
                    <Sheet.Title className="truncate">{selectedEvent.title}</Sheet.Title>
                    <Sheet.Description className="mt-1">
                      {selectedEvent.summary || selectedEvent.message || tr('pages.programLogs.noDetails')}
                    </Sheet.Description>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <ToneBadge tone={severityTone(selectedEvent.severity)}>
                      {tr(`pages.programLogs.severity.${selectedEvent.severity}`)}
                    </ToneBadge>
                    <Badge variant="outline">{scopeLabel(selectedEvent.scope)}</Badge>
                    <Badge variant="outline">{selectedEvent.category || selectedEvent.type || 'system'}</Badge>
                  </div>
                </div>
              </Sheet.Header>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="grid gap-4">
                  <div className="grid gap-2 rounded-md border p-3 text-sm">
                    <div className="grid grid-cols-[8rem_1fr] gap-3">
                      <span className="text-muted-foreground">{tr('pages.checkinLog.time')}</span>
                      <span>{formatDateTimeLocal(selectedEvent.createdAt)}</span>
                    </div>
                    <div className="grid grid-cols-[8rem_1fr] gap-3">
                      <span className="text-muted-foreground">{tr('pages.programLogs.lastSeen')}</span>
                      <span>{formatDateTimeLocal(selectedEvent.lastSeenAt || selectedEvent.createdAt)}</span>
                    </div>
                    {selectedEvent.subject && (
                      <div className="grid grid-cols-[8rem_1fr] gap-3">
                        <span className="text-muted-foreground">{tr('pages.programLogs.subject')}</span>
                        <span className="min-w-0 break-words">{selectedEvent.subject.label || selectedEvent.subject.id || selectedEvent.subject.type}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-[8rem_1fr] gap-3">
                      <span className="text-muted-foreground">{tr('pages.programLogs.state')}</span>
                      <span>{tr(`pages.programLogs.state.${selectedEvent.state}`)}</span>
                    </div>
                  </div>

                  {selectedEvent.description && selectedEvent.description !== selectedEvent.summary && (
                    <div className="rounded-md border p-3 text-sm">
                      <div className="mb-2 font-medium">{tr('pages.programLogs.description')}</div>
                      <p className="whitespace-pre-wrap text-muted-foreground">{selectedEvent.description}</p>
                    </div>
                  )}

                  {selectedEvent.details.length > 0 ? (
                    <div className="grid gap-3">
                      <div className="text-sm font-medium">{tr('pages.programLogs.details')}</div>
                      {selectedEvent.details.map(renderDetailBlock)}
                    </div>
                  ) : (
                    <EmptyStateBlock
                      className="rounded-md border"
                      title={tr('pages.programLogs.noDetails')}
                      description={tr('pages.programLogs.noDetailsDescription')}
                    />
                  )}
                </div>
              </div>
              <Sheet.Footer className="border-t px-5 py-3">
                <div className="flex w-full flex-wrap justify-between gap-2">
                  <Button type="button" variant="outline" onClick={() => openEventTarget(selectedEvent)}>
                    <MoveUpRight className="size-4" />
                    {tr('pages.programLogs.openTarget')}
                  </Button>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => navigator.clipboard?.writeText(JSON.stringify(selectedEvent, null, 2))}>
                      <Copy className="size-4" />
                      {tr('pages.programLogs.copyJson')}
                    </Button>
                    {selectedEvent.actions.map((action) => {
                      const Icon = action.kind === 'copy'
                        ? Copy
                        : action.kind === 'external'
                          ? ExternalLink
                          : action.command === 'resolve'
                            ? Check
                            : MoveUpRight;
                      return (
                        <Button
                          key={action.id}
                          type="button"
                          variant={action.variant || 'outline'}
                          onClick={() => runAction(selectedEvent, action)}
                        >
                          <Icon className="size-4" />
                          {action.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </Sheet.Footer>
            </>
          )}
        </Sheet.Content>
      </Sheet.Root>
    </div>
  );
}
