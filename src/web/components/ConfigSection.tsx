import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/utils.js';

type ConfigSectionProps = HTMLAttributes<HTMLDivElement> & {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
};

function ConfigSection({
  title,
  description,
  actions,
  compact = false,
  className,
  children,
  ...props
}: ConfigSectionProps) {
  return (
    <section
      className={cn('flex flex-col gap-2.5 rounded-lg border bg-muted', compact ? 'p-2.5' : 'p-3', className)}
      {...props}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <div className="text-sm font-semibold">{title}</div>
          {description ? <div className="text-xs leading-relaxed text-muted-foreground">{description}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function ConfigSectionItem({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border bg-card p-2.5', className)} {...props} />;
}

export { ConfigSection, ConfigSectionItem };
