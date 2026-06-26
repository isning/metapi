import type { ReactNode } from 'react';
import { Card, CardContent } from '../ui/card/index.js';

type MetricTone = 'default' | 'success' | 'warning' | 'destructive' | 'muted';

const toneClassName: Record<MetricTone, string> = {
  default: 'text-foreground',
  success: 'text-foreground',
  warning: 'text-warning',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
};

type MetricTileProps = {
  label: ReactNode;
  value: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: MetricTone;
};

export default function MetricTile({
  label,
  value,
  description,
  icon,
  tone = 'default',
}: MetricTileProps) {
  return (
    <Card>
      <CardContent className="grid gap-1.5 p-3">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {icon ? <span className="inline-flex shrink-0 items-center">{icon}</span> : null}
          <span className="min-w-0 truncate">{label}</span>
        </div>
        <div className={`min-w-0 truncate font-mono text-lg font-semibold tabular-nums ${toneClassName[tone]}`}>
          {value}
        </div>
        {description ? (
          <div className="min-w-0 truncate text-xs text-muted-foreground">
            {description}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
