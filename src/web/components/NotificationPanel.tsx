import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import { formatDateTimeMinuteLocal } from '../pages/helpers/checkinLogTime.js';
import { buildEventNavigationPath } from '../pages/helpers/navigationFocus.js';
import { useI18n } from '../i18n.js';
import { Badge } from './ui/badge/index.js';
import { Button } from './ui/button/index.js';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card/index.js';
import { ScrollArea } from './ui/scroll-area/index.js';

const typeLabels: Record<string, string> = {
  checkin: '签到',
  balance: '余额',
  token: '令牌',
  proxy: '代理',
  status: '状态',
  site_notice: '站点公告',
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
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('');
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filter ? `type=${filter}` : '';
      const data = await api.getEvents(params);
      setEvents(data);

      // Auto mark all as read on open
      const hasUnread = Array.isArray(data) && data.some((e: any) => !e.read);
      if (hasUnread) {
        api.markAllEventsRead().catch(() => {});
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
    await api.clearEvents();
    setEvents([]);
    onUnreadCountChange?.(0);
  };

  if (!open) return null;

  return (
    <Card ref={panelRef} className="absolute right-0 top-full z-50 mt-1 w-[360px] overflow-hidden p-0">
      <CardHeader className="flex flex-row items-center justify-between border-b p-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bell className="size-4" />
          {tr('通知')}
        </CardTitle>
        <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
          {tr('清空')}
        </Button>
      </CardHeader>

      <div className="flex flex-wrap gap-1 border-b p-2">
        {['', 'checkin', 'balance', 'token', 'proxy', 'status', 'site_notice'].map((filterType) => (
          <Button
            key={filterType}
            type="button"
            variant={filter === filterType ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilter(filterType)}
          >
            {filterType ? tr(typeLabels[filterType] || filterType) : tr('全部')}
          </Button>
        ))}
      </div>

      <CardContent className="p-0">
        <ScrollArea className="h-[360px]">
        {loading && (
          <div className="flex items-center justify-center p-5 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        )}
        {!loading && events.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {tr('暂无通知')}
          </div>
        )}
        {events.map((ev: any) => {
          const targetPath = buildEventNavigationPath(ev);
          const openTarget = () => {
            onClose();
            navigate(targetPath);
          };
          return (
            <Button
              key={ev.id}
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start rounded-none border-b p-3 text-left"
              onClick={openTarget}
            >
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <Badge variant={ev.level === 'error' ? 'destructive' : 'secondary'} className="mt-0.5 px-1.5">
                  {ev.level || 'info'}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{ev.title}</span>
                    <Badge variant="outline">
                    {tr(typeLabels[ev.type] || ev.type)}
                    </Badge>
                  </div>
                  <div className="whitespace-normal text-xs leading-relaxed text-muted-foreground">{ev.message}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                  {formatDateTimeMinuteLocal(ev.createdAt)}
                  </div>
                </div>
              </div>
            </Button>
          );
        })}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
