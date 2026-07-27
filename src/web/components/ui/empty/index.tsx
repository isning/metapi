import * as React from 'react';
import { cn } from '../../../lib/utils.js';

const Empty = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col items-center justify-center gap-2 p-8 text-center', className)}
      {...props}
    />
  ),
);
Empty.displayName = 'Empty';

const EmptyHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col items-center gap-2', className)} {...props} />
  ),
);
EmptyHeader.displayName = 'EmptyHeader';

const EmptyIcon = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-muted-foreground', className)} {...props} />
  ),
);
EmptyIcon.displayName = 'EmptyIcon';

const EmptyTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm font-semibold text-foreground', className)} {...props} />
  ),
);
EmptyTitle.displayName = 'EmptyTitle';

const EmptyDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
EmptyDescription.displayName = 'EmptyDescription';

export { Empty, EmptyHeader, EmptyIcon, EmptyTitle, EmptyDescription };
