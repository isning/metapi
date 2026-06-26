import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Bell, Check, CheckCircle2, Copy, ExternalLink, KeyRound, Loader2, Megaphone, Server, Wallet } from 'lucide-react';
import { api } from '../api.js';
import { formatDateTimeMinuteLocal } from '../pages/helpers/checkinLogTime.js';
import { buildEventNavigationPath } from '../pages/helpers/navigationFocus.js';
import { useI18n, tr } from '../i18n.js';
import type { InboxAction, InboxItem } from '../../shared/inbox.js';
import { Badge } from './ui/badge/index.js';
import { Button } from './ui/button/index.js';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card/index.js';
import { ScrollArea } from './ui/scroll-area/index.js';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs/index.js';

const typeLabels: Record<string, string> = {
  checkin: tr('components.notificationPanel.sign'),
  balance: tr('components.notificationPanel.balance'),
  token: tr('components.notificationPanel.token'),
  proxy: tr('components.notificationPanel.proxy'),
  status: tr('components.notificationPanel.status'),
  site_notice: tr('app.sites'),
};

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  checkin: CheckCircle2,
  balance: Wallet,
  token: KeyRound,
  proxy: Server,
  status: Activity,
  site_notice: Megaphone,
};

const scopeLabels: Record<string, string> = {
  notification: 'components.notificationPanel.scope.notification',
  attention: 'components.notificationPanel.scope.attention',
  activity: 'components.notificationPanel.scope.activity',
  announcement: 'components.notificationPanel.scope.announcement',
};

const severityVariants: Record<string, React.ComponentProps<typeof Badge>['variant']> = {
  critical: 'destructive',
  warning: 'warning',
  success: 'success',
  info: 'secondary',
};

export default function NotificationPanel({
  open,
  onClose,
  anchorRef,
  onUnreadCountChange,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onUnreadCountChange?: (count: number) => void;
}) {
  const { t: tr } = useI18n();
  const [events, setEvents] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('');
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('scope', 'notification');
      if (filter) params.set('type', filter);
      const data = await api.getEvents(params.toString());
      setEvents(data);

      const hasUnread = Array.isArray(data) && data.some((e: any) => !e.read);
      if (hasUnread) {
        api.markAllEventsRead('scope=notification').catch(() => {});
        onUnreadCountChange?.(0);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filter, onUnreadCountChange]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (
        panelRef.current
        && !panelRef.current.contains(event.target as Node)
        && anchorRef.current
        && !anchorRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorRef, onClose, open]);

  const clearAll = async () => {
    await api.clearEvents('scope=notification');
    setEvents([]);
    onUnreadCountChange?.(0);
  };

  const runAction = async (ev: InboxItem, action: InboxAction) => {
    if (action.kind === 'navigate' && action.href) {
      onClose();
      navigate(action.href);
      return;
    }
    if (action.kind === 'external' && action.href) {
      window.open(action.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action.kind === 'copy' && action.value) {
      await navigator.clipboard?.writeText(action.value);
      return;
    }
    if (action.kind === 'invoke' && action.command) {
      const response = await api.applyEventAction(ev.id, { command: action.command as any });
      setEvents((prev) => prev.map((item) => (item.id === ev.id ? response.item : item)));
      return;
    }
  };

  if (!open) return null;

  return (
    <Card ref={panelRef} className="absolute right-0 top-full z-50 mt-1 w-[360px] overflow-hidden p-0">
      <CardHeader className="flex flex-row items-center justify-between border-b p-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bell className="size-4" />
          {tr('app.notifications')}
        </CardTitle>
        <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
          {tr('components.notificationPanel.clear')}
        </Button>
      </CardHeader>

      <Tabs value={filter || 'all'} onValueChange={(nextValue) => setFilter(nextValue === 'all' ? '' : nextValue)}>
        <div className="border-b p-2">
          <TabsList className="flex h-auto w-full flex-wrap justify-start">
            {['', 'checkin', 'balance', 'token', 'proxy', 'status', 'site_notice'].map((filterType) => (
              <TabsTrigger key={filterType || 'all'} value={filterType || 'all'} className="text-foreground">
                {filterType ? (() => {
                  const Icon = typeIcons[filterType] || Bell;
                  return <Icon className="size-3.5" />;
                })() : <Bell className="size-3.5" />}
                {filterType ? tr(typeLabels[filterType] || filterType) : tr('components.notificationPanel.all')}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      <CardContent className="p-0">
        <ScrollArea className="h-[360px]">
        {loading && (
          <div className="flex items-center justify-center p-5 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        )}
        {!loading && events.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {tr('components.notificationPanel.noNotifications')}
          </div>
        )}
        {events.map((ev: any) => {
          const navigateAction = ev.actions?.find((action: InboxAction) => action.kind === 'navigate' && action.href);
          const targetPath = navigateAction?.href || buildEventNavigationPath(ev);
          const openTarget = () => {
            onClose();
            navigate(targetPath);
          };
          const visibleActions = (ev.actions || [])
            .filter((action: InboxAction) => action.kind !== 'navigate' || action.href !== targetPath)
            .filter((action: InboxAction) => action.placement !== 'overflow')
            .slice(0, 2);
          return (
            <div key={ev.id} className="border-b">
              <div className="p-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start px-2 py-2 text-left"
                  onClick={openTarget}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <Badge variant={severityVariants[ev.severity] || 'secondary'} className="mt-0.5 px-1.5">
                      {tr(`components.notificationPanel.severity.${ev.severity}`)}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">{ev.title}</span>
                        <Badge variant="outline" className="shrink-0">
                          {tr(scopeLabels[ev.scope] || ev.scope)}
                        </Badge>
                        <Badge variant="outline" className="shrink-0">
                          {tr(typeLabels[ev.type || ''] || ev.category || ev.type || 'system')}
                        </Badge>
                      </div>
                      <div className="whitespace-normal text-xs leading-relaxed text-muted-foreground">{ev.summary || ev.message}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDateTimeMinuteLocal(ev.lastSeenAt || ev.createdAt)}</span>
                        {ev.occurrenceCount > 1 && <span>×{ev.occurrenceCount}</span>}
                      </div>
                    </div>
                  </div>
                </Button>
                {visibleActions.length > 0 && (
                  <div className="mt-1 flex flex-wrap justify-end gap-1 px-2">
                    {visibleActions.map((action: InboxAction) => {
                      const Icon = action.kind === 'copy'
                        ? Copy
                        : action.kind === 'external'
                          ? ExternalLink
                          : action.command === 'resolve'
                            ? Check
                            : Activity;
                      return (
                        <Button
                          key={action.id}
                          type="button"
                          size="sm"
                          variant={action.variant || 'outline'}
                          onClick={() => runAction(ev, action)}
                        >
                          <Icon className="size-3.5" />
                          {action.label}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
