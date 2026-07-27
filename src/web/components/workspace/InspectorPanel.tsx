import type { ReactNode } from 'react';
import * as Tabs from '../ui/tabs/index.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../ui/empty/index.js';

type InspectorPanelProps = {
  title?: ReactNode;
  description?: ReactNode;
  summary?: ReactNode;
  metrics?: ReactNode;
  config?: ReactNode;
  json?: ReactNode;
};

export default function InspectorPanel({
  title,
  description,
  summary,
  metrics,
  config,
  json,
}: InspectorPanelProps) {
  if (!title && !summary && !metrics && !config && !json) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No selection</EmptyTitle>
            <EmptyDescription>Select a graph node, diagnostic, or performance row.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <aside className="grid gap-3 p-4">
      <div>
        {title ? <div className="text-sm font-semibold">{title}</div> : null}
        {description ? <div className="mt-1 text-xs text-muted-foreground">{description}</div> : null}
      </div>
      <Tabs.Tabs defaultValue="summary">
        <Tabs.TabsList className="grid w-full grid-cols-4">
          <Tabs.TabsTrigger value="summary">Summary</Tabs.TabsTrigger>
          <Tabs.TabsTrigger value="metrics">Metrics</Tabs.TabsTrigger>
          <Tabs.TabsTrigger value="config">Config</Tabs.TabsTrigger>
          <Tabs.TabsTrigger value="json">JSON</Tabs.TabsTrigger>
        </Tabs.TabsList>
        <Tabs.TabsContent value="summary" className="mt-3">
          {summary ?? <Empty><EmptyHeader><EmptyTitle>No summary</EmptyTitle></EmptyHeader></Empty>}
        </Tabs.TabsContent>
        <Tabs.TabsContent value="metrics" className="mt-3">
          {metrics ?? <Empty><EmptyHeader><EmptyTitle>No metrics</EmptyTitle></EmptyHeader></Empty>}
        </Tabs.TabsContent>
        <Tabs.TabsContent value="config" className="mt-3">
          {config ?? <Empty><EmptyHeader><EmptyTitle>No config</EmptyTitle></EmptyHeader></Empty>}
        </Tabs.TabsContent>
        <Tabs.TabsContent value="json" className="mt-3">
          {json ?? <Empty><EmptyHeader><EmptyTitle>No JSON</EmptyTitle></EmptyHeader></Empty>}
        </Tabs.TabsContent>
      </Tabs.Tabs>
    </aside>
  );
}
