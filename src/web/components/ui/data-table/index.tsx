import * as React from 'react';
import { cn } from '../../../lib/utils.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyIcon, EmptyTitle } from '../empty/index.js';

type DataTableProps = React.HTMLAttributes<HTMLDivElement> & {
  minWidth?: number | string;
  density?: 'default' | 'compact';
};

const DataTable = React.forwardRef<HTMLDivElement, DataTableProps>(
  ({ className, children, minWidth, density = 'default', style, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="data-table"
      data-density={density}
      className={cn(
        'group/data-table overflow-hidden rounded-md border',
        density === 'compact' && '[&_td]:py-2 [&_th]:h-9',
        className,
      )}
      {...props}
    >
      <div data-slot="data-table-scroll" className="w-full overflow-x-auto">
        <div
          data-slot="data-table-inner"
          className="min-w-full"
          style={{
            minWidth: typeof minWidth === 'number' ? `${minWidth}px` : minWidth,
            ...style,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  ),
);
DataTable.displayName = 'DataTable';

const DataTableToolbar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="data-table-toolbar"
      className={cn('flex flex-wrap items-center justify-between gap-2 px-3 py-2', className)}
      {...props}
    />
  ),
);
DataTableToolbar.displayName = 'DataTableToolbar';

const DataTableEmpty = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
}>(({ className, icon, title, description, ...props }, ref) => (
  <Empty
    ref={ref}
    data-slot="data-table-empty"
    className={cn('min-h-52', className)}
    {...props}
  >
    <EmptyHeader>
      {icon ? <EmptyIcon>{icon}</EmptyIcon> : null}
      <EmptyTitle>{title}</EmptyTitle>
      {description ? <EmptyDescription>{description}</EmptyDescription> : null}
    </EmptyHeader>
  </Empty>
));
DataTableEmpty.displayName = 'DataTableEmpty';

export { DataTable, DataTableToolbar, DataTableEmpty };
