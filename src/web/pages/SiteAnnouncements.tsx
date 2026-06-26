import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../components/Toast.js';
import { clearFocusParams, readFocusAnnouncementId } from './helpers/navigationFocus.js';
import {
  formatSiteAnnouncementSeenAt,
  readClientTimeZone,
  resolveSiteAnnouncementTimeZone,
  SiteAnnouncementContent,
} from './helpers/siteAnnouncementPresentation.js';
import { tr } from '../i18n.js';
import { Button } from '../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import ToneBadge from '../components/ToneBadge.js';
import { Card, CardContent } from '../components/ui/card/index.js';
import { Skeleton } from '../components/ui/skeleton/index.js';
import EmptyStateBlock from '../components/EmptyStateBlock.js';
import PageHeader from '../components/workspace/PageHeader.js';
import PageShell from '../components/workspace/PageShell.js';

type SiteAnnouncementRow = {
  id: number;
  siteId: number;
  platform: string;
  sourceKey: string;
  title: string;
  content: string;
  level: 'info' | 'warning' | 'error';
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  readAt?: string | null;
};

type SiteRow = {
  id: number;
  name: string;
  platform?: string | null;
};

function SiteAnnouncementsLoadingSkeleton() {
  return (
    <Card className="overflow-hidden" aria-busy="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <CardContent key={index} className="border-b p-4 last:border-b-0">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="grid min-w-0 flex-1 gap-2">
              <Skeleton className="h-5 w-64 max-w-full" />
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          </div>
          <div className="grid gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <Skeleton className="mt-3 h-3 w-48" />
        </CardContent>
      ))}
    </Card>
  );
}

export default function SiteAnnouncements() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<SiteAnnouncementRow[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [serverTimeZone, setServerTimeZone] = useState<string | undefined>(undefined);
  const [highlightAnnouncementId, setHighlightAnnouncementId] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerTimeZone = useMemo(() => readClientTimeZone(), []);
  const displayTimeZone = resolveSiteAnnouncementTimeZone(viewerTimeZone, serverTimeZone);

  const siteNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const site of sites) {
      map.set(site.id, site.name);
    }
    return map;
  }, [sites]);

  const load = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [announcementRows, siteRows, runtimeInfo] = await Promise.all([
        api.getSiteAnnouncements(),
        api.getSites(),
        api.getRuntimeSettings().catch(() => null),
      ]);
      setRows(Array.isArray(announcementRows) ? announcementRows : []);
      setSites(Array.isArray(siteRows) ? siteRows : []);
      const nextServerTimeZone = typeof runtimeInfo?.serverTimeZone === 'string'
        ? runtimeInfo.serverTimeZone.trim()
        : '';
      setServerTimeZone(nextServerTimeZone || undefined);
    } catch (error: any) {
      toast.error(error?.message || tr('pages.siteAnnouncements.sitesFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    return () => {
      const win = globalThis as typeof globalThis & {
        clearTimeout?: typeof clearTimeout;
      };
      if (highlightTimerRef.current && typeof win.clearTimeout === 'function') {
        win.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const focusAnnouncementId = readFocusAnnouncementId(location.search);
    if (!focusAnnouncementId || loading) return;
    const row = rowRefs.current.get(focusAnnouncementId);
    const nextSearch = clearFocusParams(location.search);
    const win = globalThis as typeof globalThis & {
      setTimeout?: typeof setTimeout;
      clearTimeout?: typeof clearTimeout;
    };
    if (!row) {
      navigate({ pathname: location.pathname, search: nextSearch }, { replace: true });
      return;
    }
    row.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    setHighlightAnnouncementId(focusAnnouncementId);
    if (highlightTimerRef.current && typeof win.clearTimeout === 'function') {
      win.clearTimeout(highlightTimerRef.current);
    }
    if (typeof win.setTimeout === 'function') {
      highlightTimerRef.current = win.setTimeout(() => {
        setHighlightAnnouncementId((current) => (current === focusAnnouncementId ? null : current));
      }, 2200);
    }
    navigate({ pathname: location.pathname, search: nextSearch }, { replace: true });
  }, [loading, location.pathname, location.search, navigate, rows]);

  const clearAll = async () => {
    setClearing(true);
    try {
      await api.clearSiteAnnouncements();
      setRows([]);
      toast.success(tr('pages.siteAnnouncements.clear'));
    } catch (error: any) {
      toast.error(error?.message || tr('pages.siteAnnouncements.clearFailed'));
    } finally {
      setClearing(false);
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await api.markAllSiteAnnouncementsRead();
      setRows((current) => current.map((row) => ({
        ...row,
        readAt: row.readAt || new Date().toISOString(),
      })));
      toast.success(tr('pages.programLogs.markedAllRead'));
    } catch (error: any) {
      toast.error(error?.message || tr('pages.programLogs.markingFailed'));
    } finally {
      setMarkingAll(false);
    }
  };

  const triggerSync = async () => {
    try {
      await api.syncSiteAnnouncements();
      toast.success(tr('pages.siteAnnouncements.sync'));
    } catch (error: any) {
      toast.error(error?.message || tr('pages.siteAnnouncements.syncFailed'));
    }
  };

  return (
    <PageShell>
      <PageHeader
        title={tr('app.sites')}
        description={tr('pages.siteAnnouncements.siteAnnouncementsSubtitle')}
        actions={(
          <>
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
          <Button type="button" variant="outline"
            onClick={triggerSync}
           
           
          >
            {tr('pages.siteAnnouncements.manualsync')}
          </Button>
          <Button type="button" variant="destructive" size="sm"
            onClick={clearAll}
            disabled={clearing}
           
          >
            {clearing ? <><LoaderCircle className="size-4 animate-spin" /> {tr('pages.programLogs.clearing')}</> : tr('pages.siteAnnouncements.clear2')}
          </Button>
          </>
        )}
      />

      {loading ? (
        <SiteAnnouncementsLoadingSkeleton />
      ) : (
        <Card className="overflow-hidden">
          {rows.length === 0 ? (
            <EmptyStateBlock title={tr('pages.siteAnnouncements.noAnnouncements')} description={tr('pages.siteAnnouncements.sites')} />
          ) : (
            rows.map((row, index) => (
              <div
                key={row.id}
                ref={(node) => {
                  if (node) rowRefs.current.set(row.id, node);
                  else rowRefs.current.delete(row.id);
                }}
                className={`border-b p-4 last:border-b-0 ${highlightAnnouncementId === row.id ? 'bg-muted' : ''}`.trim()}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-base font-semibold">{row.title}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ToneBadge tone="-muted">{siteNameById.get(row.siteId) || `站点 #${row.siteId}`}</ToneBadge>
                    <ToneBadge tone="-info">{row.platform}</ToneBadge>
                    <ToneBadge tone={row.readAt ? 'muted' : 'warning'}>{row.readAt ? tr('pages.programLogs.read') : tr('pages.programLogs.unread')}</ToneBadge>
                  </div>
                </div>
                <SiteAnnouncementContent content={row.content} />
                <div
                  className="mt-2 text-xs text-muted-foreground"
                  title={displayTimeZone ? `本地时区：${displayTimeZone}` : undefined}
                >
                  {tr('pages.siteAnnouncements.firstFound')}{formatSiteAnnouncementSeenAt(row.firstSeenAt || row.lastSeenAt || '', displayTimeZone)}
                </div>
              </div>
            ))
          )}
        </Card>
      )}
    </PageShell>
  );
}
