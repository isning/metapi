import React from 'react';
import { DEBUG_TABS, type DebugTab } from '../helpers/modelTesterSession.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card/index.js';
import { ScrollArea } from '../../components/ui/scroll-area/index.js';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs/index.js';

type DebugTimelineEntry = {
  at: string;
  level: 'info' | 'warn' | 'error';
  text: string;
};

type DebugPanelPresence = {
  shouldRender: boolean;
  isVisible: boolean;
};

type DebugPanelProps = {
  presence: DebugPanelPresence;
  isMobile: boolean;
  debugTimestamp: string | null;
  activeDebugTab: DebugTab;
  onTabChange: (tab: DebugTab) => void;
  debugTabContent: string;
  debugTimeline: DebugTimelineEntry[];
};

export default function DebugPanel({
  presence,
  isMobile,
  debugTimestamp,
  activeDebugTab,
  onTabChange,
  debugTabContent,
  debugTimeline,
}: DebugPanelProps) {
  if (!presence.shouldRender) {
    return null;
  }

  return (
    <Card
      className={`panel-presence flex flex-col p-3 ${presence.isVisible ? '' : 'is-closing'} ${isMobile ? 'order-3' : 'max-h-[740px] min-h-[680px]'}`.trim()}
    >
      <CardHeader className="flex-row items-center justify-between gap-3 p-0 pb-2 space-y-0">
        <CardTitle>调试</CardTitle>
        <div className="text-xs text-muted-foreground">
          {debugTimestamp ? new Date(debugTimestamp).toLocaleString() : '--'}
        </div>
      </CardHeader>

      <Tabs value={activeDebugTab} onValueChange={(value) => onTabChange(value as DebugTab)} className="mb-2">
        <TabsList>
          <TabsTrigger value={DEBUG_TABS.PREVIEW}>预览</TabsTrigger>
          <TabsTrigger value={DEBUG_TABS.REQUEST}>请求</TabsTrigger>
          <TabsTrigger value={DEBUG_TABS.RESPONSE}>响应</TabsTrigger>
        </TabsList>
      </Tabs>

      <ScrollArea className="min-h-0 flex-1 rounded-md border">
        <pre className="m-0 whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed">
          {debugTabContent || '// 暂无数据'}
        </pre>
      </ScrollArea>

      <CardTitle className="mt-3 text-xs">时间线</CardTitle>
      <CardContent className="mt-1.5 min-h-28 max-h-44 overflow-y-auto rounded-md border p-2">
        {debugTimeline.length === 0 ? (
          <div className="text-xs text-muted-foreground">暂无事件。</div>
        ) : (
          <div className="grid gap-1.5">
            {debugTimeline.map((item, index) => (
              <div key={`${item.at}-${index}`} className="text-xs leading-relaxed text-muted-foreground">
                <span className="mr-1.5 inline-block min-w-10 font-semibold uppercase text-foreground">
                  {item.level}
                </span>
                <span className="mr-1.5 text-muted-foreground">
                  {new Date(item.at).toLocaleTimeString()}
                </span>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
