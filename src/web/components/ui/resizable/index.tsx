import * as React from 'react';
import { GripVertical } from 'lucide-react';
import * as ResizablePrimitive from 'react-resizable-panels';
import { cn } from '../../../lib/utils.js';

type ResizablePanelGroupProps = React.ComponentProps<typeof ResizablePrimitive.Group> & {
  orientation?: 'horizontal' | 'vertical';
};

const ResizablePanelGroup = ({
  className,
  orientation = 'horizontal',
  ...props
}: ResizablePanelGroupProps) => (
  <ResizablePrimitive.Group
    orientation={orientation}
    className={cn('flex h-full w-full', orientation === 'vertical' && 'flex-col', className)}
    {...props}
  />
);

const ResizablePanel = ResizablePrimitive.Panel;

type ResizableHandleProps = React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean;
  orientation?: 'horizontal' | 'vertical';
};

const ResizableHandle = ({
  withHandle,
  className,
  orientation,
  ...props
}: ResizableHandleProps) => (
  <ResizablePrimitive.Separator
    className={cn(
      'relative flex items-center justify-center bg-border',
      orientation === 'vertical' ? 'h-px w-full' : 'w-px',
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="size-2.5" />
      </div>
    )}
  </ResizablePrimitive.Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
