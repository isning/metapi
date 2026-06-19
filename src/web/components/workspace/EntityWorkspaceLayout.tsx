import type { ReactNode } from 'react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '../ui/resizable/index.js';
import { ScrollArea } from '../ui/scroll-area/index.js';

type EntityWorkspaceLayoutProps = {
  index: ReactNode;
  workspace: ReactNode;
  inspector?: ReactNode;
  mobile?: boolean;
};

export default function EntityWorkspaceLayout({
  index,
  workspace,
  inspector,
  mobile = false,
}: EntityWorkspaceLayoutProps) {
  if (mobile) {
    return (
      <div className="grid min-h-[620px] gap-3">
        {workspace}
        {inspector}
        {index}
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-160px)] min-h-[680px] overflow-hidden rounded-lg border bg-card">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize="24%" minSize="18%" maxSize="34%">
          <ScrollArea className="h-full">
            {index}
          </ScrollArea>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="54%" minSize="36%">
          <ScrollArea className="h-full">
            {workspace}
          </ScrollArea>
        </ResizablePanel>
        {inspector ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="22%" minSize="18%" maxSize="32%">
              <ScrollArea className="h-full">
                {inspector}
              </ScrollArea>
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
    </div>
  );
}
