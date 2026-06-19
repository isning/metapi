import React from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card/index.js';
import { cn } from '../lib/utils.js';

type MobileCardProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  headerActions?: React.ReactNode;
  footerActions?: React.ReactNode;
  compact?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
};

type MobileFieldProps = {
  label: React.ReactNode;
  value: React.ReactNode;
  stacked?: boolean;
};

export function MobileCard({
  title,
  subtitle,
  actions,
  headerActions,
  footerActions,
  compact = false,
  className = '',
  bodyClassName = '',
  children,
}: MobileCardProps) {
  const resolvedHeaderActions = headerActions ?? actions;
  return (
    <Card data-mobile-list-item="true" className={cn(compact ? 'p-0' : undefined, className)}>
      <CardHeader className={cn('flex-row items-start justify-between gap-3', compact && 'p-2')}>
        <div className="min-w-0 flex-1">
          <CardTitle className="break-words">{title}</CardTitle>
          {subtitle ? <CardDescription className="mt-1 break-words">{subtitle}</CardDescription> : null}
        </div>
        {resolvedHeaderActions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{resolvedHeaderActions}</div> : null}
      </CardHeader>
      <CardContent className={cn('grid gap-2', compact && 'p-2 pt-0', bodyClassName)}>{children}</CardContent>
      {footerActions ? <CardFooter className={cn('flex-wrap justify-end', compact && 'p-2')}>{footerActions}</CardFooter> : null}
    </Card>
  );
}

export function MobileField({ label, value, stacked = false }: MobileFieldProps) {
  return (
    <div className={cn('grid gap-1 text-sm', !stacked && 'grid-cols-[minmax(5rem,auto)_1fr] items-start gap-x-3')}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn('min-w-0 break-words text-foreground', !stacked && 'text-right')}>{value}</div>
    </div>
  );
}
