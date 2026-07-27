import type React from 'react';
import { VChart } from '@visactor/react-vchart';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button/index.js';
import { ButtonGroup } from '../ui/button-group/index.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card/index.js';

export function ChartShell({
  title,
  icon,
  actions,
  children,
  className,
}: {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('animate-fade-in', className)}>
      {(title || actions) && (
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          {title ? (
            <CardTitle className="inline-flex min-w-0 items-center gap-1.5">
              {icon}
              <span className="truncate">{title}</span>
            </CardTitle>
          ) : (
            <span />
          )}
          {actions}
        </CardHeader>
      )}
      <CardContent className={title || actions ? undefined : 'pt-3'}>{children}</CardContent>
    </Card>
  );
}

export function ChartFrame({
  spec,
  height = 300,
}: {
  spec: Record<string, unknown>;
  height?: number;
}) {
  return (
    <div className="w-full" style={{ height }}>
      <VChart spec={spec as any} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

export function ChartMetricToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ key: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <ButtonGroup>
      {options.map((option) => (
        <Button
          key={option.key}
          type="button"
          size="sm"
          variant={value === option.key ? 'default' : 'outline'}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </Button>
      ))}
    </ButtonGroup>
  );
}

export function ChartLegendSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-sm"
      style={{ backgroundColor: color }}
    />
  );
}
